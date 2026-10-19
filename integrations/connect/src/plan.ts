import { AUTO_COURIER, type Address, type CreateOrderInput, type Product } from "@iship/sdk";

import { applyOverrides, isShippable, parseThaiAddress, type AddressIssue, type RawAddress } from "./address.js";

/** A shop order, reduced to what shipping it needs. Every platform maps into this. */
export interface ShopOrder {
  /** "shopify", "tiktok", ... Decides the prefix of the iShip order id. */
  platform: string;
  /** The shop's identifier on the platform, e.g. "my-store.myshopify.com". */
  shop: string;
  /** The platform's own order id. Must never change for the same order. */
  orderId: string;
  /** What the merchant calls the order, e.g. "#1001". Printed as the remark. */
  orderName: string;
  recipient: RawAddress;
  items: ShopOrderItem[];
  /** Money to collect on delivery. Zero for prepaid orders. */
  codAmount: number;
  /** ISO 4217 code of the amounts above. */
  currency: string;
  /** Total weight the platform knows, in grams. Zero when unknown. */
  totalGrams: number;
}

export interface ShopOrderItem {
  name: string;
  quantity: number;
  /** Price of one unit, in `currency`. */
  unitPrice: number;
  /** Weight of one unit in grams. Zero when unknown. */
  grams: number;
}

/** How a shop ships: set once per shop by the merchant. */
export interface ShipperSettings {
  /** The sender, printed on the label. */
  origin: Address;
  /** An iShip courier code, or AUTO_COURIER to let iShip choose. */
  courierCode: string;
  /** The box used when the platform does not say. */
  box: { widthCm: number; lengthCm: number; heightCm: number };
  /** One of the SDK's Category values. Defaults to Other (99). */
  categoryId?: number;
  /** Weight of one item when the platform has none, in grams. Defaults to 500. */
  defaultItemGrams?: number;
  /** Identifies the integration in iShip's logs. */
  platformName?: string;
}

/** Why an order cannot be shipped as it stands. */
export type PlanProblem =
  | AddressIssue
  | { field: "items"; code: "empty" | "quantity" }
  | { field: "cod"; code: "currency" }
  | { field: "origin"; code: "incomplete" };

export type ShipmentPlan =
  | { ok: true; input: CreateOrderInput; recipient: Address; warnings: PlanProblem[] }
  | { ok: false; recipient: Address; problems: PlanProblem[]; warnings: PlanProblem[] };

const PREFIX: Record<string, string> = { shopify: "SHP", tiktok: "TTS", odoo: "ODO" };

/**
 * The id iShip deduplicates on. It is stable for an order, so a retry of a
 * create whose answer never arrived cannot produce a second parcel. `attempt`
 * above 1 is for shipping the same order again on purpose, after the first
 * parcel was cancelled.
 */
export function customOrderId(order: Pick<ShopOrder, "platform" | "orderId">, attempt = 1): string {
  const prefix = PREFIX[order.platform] ?? order.platform.slice(0, 3).toUpperCase();
  const base = `${prefix}-${order.orderId}`;
  return attempt > 1 ? `${base}-R${attempt}` : base;
}

const round = (value: number, places: number): number => {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
};

const originComplete = (origin: Address): boolean =>
  Boolean(
    origin.name &&
      origin.phone &&
      origin.address &&
      origin.subdistrict &&
      origin.district &&
      origin.province &&
      /^\d{5}$/.test(origin.zipcode),
  );

/**
 * Turns an order into the request that creates its iShip shipment, or into the
 * list of things a person must fix first.
 *
 * `overrides` are corrections the merchant typed for this order's recipient.
 */
export function planShipment(
  order: ShopOrder,
  settings: ShipperSettings,
  options: { attempt?: number; overrides?: Partial<Address> | null } = {},
): ShipmentPlan {
  const parsed = applyOverrides(parseThaiAddress(order.recipient), options.overrides);
  const problems: PlanProblem[] = parsed.issues.filter((issue) => issue.code !== "guessed");
  const warnings: PlanProblem[] = parsed.issues.filter((issue) => issue.code === "guessed");

  if (!originComplete(settings.origin)) problems.push({ field: "origin", code: "incomplete" });

  const items = order.items.filter((item) => item.quantity > 0);
  if (!items.length) problems.push({ field: "items", code: "empty" });

  const cod = order.codAmount > 0;
  if (cod && order.currency.toUpperCase() !== "THB") problems.push({ field: "cod", code: "currency" });
  if (cod && items.some((item) => item.quantity > 999)) problems.push({ field: "items", code: "quantity" });

  if (problems.length) return { ok: false, recipient: parsed.address, problems, warnings };

  const itemGrams = settings.defaultItemGrams ?? 500;
  const unitGrams = (item: ShopOrderItem): number => (item.grams > 0 ? item.grams : itemGrams);
  const grams = order.totalGrams > 0 ? order.totalGrams : items.reduce((sum, item) => sum + unitGrams(item) * item.quantity, 0);

  const { widthCm, lengthCm, heightCm } = settings.box;

  const input: CreateOrderInput = {
    customOrderId: customOrderId(order, options.attempt),
    courierCode: settings.courierCode || AUTO_COURIER,
    from: settings.origin,
    to: parsed.address,
    parcel: { weightKg: Math.max(0.01, round(grams / 1000, 3)), widthCm, lengthCm, heightCm },
    categoryId: settings.categoryId ?? 99,
    remark: order.orderName.slice(0, 100),
    platformName: settings.platformName ?? `iship-connect-${order.platform}`,
  };

  if (cod) {
    input.codAmount = round(order.codAmount, 2);
    input.products = items.map(
      (item): Product => ({
        name: item.name.slice(0, 255),
        quantity: item.quantity,
        price: round(item.unitPrice, 2),
        weightKg: Math.max(0.01, round(unitGrams(item) / 1000, 3)),
        // iShip insists on a colour; platforms do not have one.
        color: "-",
        widthCm,
        lengthCm,
        heightCm,
      }),
    );
  }

  return { ok: true, input, recipient: parsed.address, warnings };
}

/** True when the plan has nothing a person must fix. */
export const isReady = (plan: ShipmentPlan): plan is Extract<ShipmentPlan, { ok: true }> => plan.ok;

export { isShippable };
