import {
  ApiError,
  AuthError,
  AUTO_COURIER,
  OrderStatus,
  TransportError,
  ValidationError,
  type CreateOrderInput,
  type IShipClient,
  type Order,
} from "@iship/sdk";

/** What happened when a shipment was created. */
export type CreateOutcome =
  /** The parcel exists at iShip. */
  | { kind: "created"; trackingNumber: string; courierCode: string; recovered: boolean }
  /** iShip refused it. A person has to change something before trying again. */
  | { kind: "rejected"; message: string; code?: string }
  /** The token is wrong or was replaced. Nothing will work until the merchant fixes it. */
  | { kind: "unauthorized"; message: string }
  /** No usable answer arrived. Retrying with the same input is safe. */
  | { kind: "uncertain"; message: string };

const DAY = 24 * 60 * 60 * 1000;

/** A date as YYYY-MM-DD in Thailand's time zone, which is how iShip files orders. */
export function bangkokDate(at: Date): string {
  return new Date(at.getTime() + 7 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/**
 * Looks for an order this integration already created, by its customOrderId.
 *
 * iShip has no lookup by that id, so this lists the account's orders for the
 * recipient's name around `since` and matches the id exactly.
 */
export async function findExisting(
  client: IShipClient,
  customOrderId: string,
  recipientName: string,
  since: Date,
): Promise<Order | undefined> {
  const orders = await client.queryOrders({
    startDate: bangkokDate(new Date(since.getTime() - DAY)),
    endDate: bangkokDate(new Date(Date.now() + DAY)),
    keyword: recipientName,
  });
  return orders.find((order) => order.custom_order_id === customOrderId);
}

/**
 * Creates the iShip shipment for a planned order.
 *
 * Pass `previousAttemptUncertain` when an earlier call with the same input
 * ended without an answer. iShip then rejects the repeat as a duplicate, and
 * this looks the first parcel up instead of reporting a rejection.
 */
export async function createShipment(
  client: IShipClient,
  input: CreateOrderInput,
  options: { previousAttemptUncertain?: boolean; firstAttemptAt?: Date } = {},
): Promise<CreateOutcome> {
  try {
    const created = await client.createOrder(input);
    let courierCode = input.courierCode;

    // With AutoCourier, iShip picks the courier; read back which one.
    if (courierCode === AUTO_COURIER) {
      const order = await client.getOrder(created.tracking_number).catch(() => null);
      if (order?.courier_code) courierCode = order.courier_code;
    }
    return { kind: "created", trackingNumber: created.tracking_number, courierCode, recovered: false };
  } catch (error) {
    if (error instanceof AuthError) return { kind: "unauthorized", message: error.message };
    if (error instanceof TransportError) return { kind: "uncertain", message: error.message };
    if (error instanceof ValidationError) return { kind: "rejected", message: error.message };

    if (error instanceof ApiError) {
      if (options.previousAttemptUncertain) {
        const existing = await findExisting(
          client,
          input.customOrderId,
          input.to.name,
          options.firstAttemptAt ?? new Date(),
        ).catch(() => undefined);
        if (existing) {
          return {
            kind: "created",
            trackingNumber: existing.track_no,
            courierCode: existing.courier_code,
            recovered: true,
          };
        }
      }
      return { kind: "rejected", message: error.message, code: error.code };
    }
    throw error;
  }
}

/** Where a parcel is, in terms every platform can show. */
export type Progress =
  | "awaiting_pickup"
  | "picked_up"
  | "in_transit"
  | "delivered"
  | "problem"
  | "returning"
  | "returned"
  | "cancelled";

const PROGRESS: Record<number, Progress> = {
  [OrderStatus.AwaitingPickup]: "awaiting_pickup",
  [OrderStatus.NoCourier]: "awaiting_pickup",
  [OrderStatus.PickedUp]: "picked_up",
  [OrderStatus.WithBranch]: "in_transit",
  [OrderStatus.InTransit]: "in_transit",
  [OrderStatus.Progress]: "in_transit",
  [OrderStatus.Delivered]: "delivered",
  [OrderStatus.PaymentSuccess]: "delivered",
  [OrderStatus.Closed]: "delivered",
  [OrderStatus.Issue]: "problem",
  [OrderStatus.CannotPickup]: "problem",
  [OrderStatus.Returning]: "returning",
  [OrderStatus.ReturnSuccess]: "returned",
  [OrderStatus.CodRefund]: "returned",
  [OrderStatus.Cancelled]: "cancelled",
  [OrderStatus.Expired]: "cancelled",
};

/** The progress an iShip status id stands for. Undefined for ids this does not know. */
export function progressOf(status: number | null | undefined): Progress | undefined {
  return status === null || status === undefined ? undefined : PROGRESS[status];
}

/** True once a parcel will not move again, so its status no longer needs polling. */
export function isFinal(progress: Progress | undefined): boolean {
  return progress === "delivered" || progress === "returned" || progress === "cancelled";
}
