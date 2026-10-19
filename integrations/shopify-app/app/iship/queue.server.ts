/** Ways rows enter or move through the queue, used by webhooks and the admin pages. */
import { customOrderId, shopify } from "@iship/connect";
import type { Shipment } from "@prisma/client";

import db from "../db.server";
import { gql, type AdminGraphql } from "./admin.server";
import { PRE_SHIPMENT_STATES, State } from "./states";
import { kick } from "./worker.server";

/** Records an order so the worker looks at it. Safe to call for every order webhook. */
export async function enqueueOrder(shop: string, orderId: string, orderName: string): Promise<void> {
  const row = await db.shipment.upsert({
    where: { shop_orderId: { shop, orderId } },
    create: { shop, orderId, orderName, state: State.New },
    update: {},
  });
  // A payment arrived for an order that was waiting for one.
  if (row.state === State.AwaitingPayment) {
    await db.shipment.update({ where: { id: row.id }, data: { state: State.New, runAfter: new Date() } });
  }
  kick();
}

/** The order was cancelled in Shopify. */
export async function markOrderCancelled(shop: string, orderId: string): Promise<void> {
  await db.shipment.updateMany({
    where: { shop, orderId, state: { in: PRE_SHIPMENT_STATES } },
    data: { state: State.Cancelled },
  });
  // A parcel already exists: flag it so the merchant can cancel it at iShip.
  await db.shipment.updateMany({
    where: { shop, orderId, state: { in: [State.Created, State.Fulfilled] } },
    data: { orderCancelled: true },
  });
}

/** Adds the shop's most recent unfulfilled orders to the queue. Returns how many were new. */
export async function importUnfulfilled(admin: AdminGraphql, shop: string, limit = 50): Promise<number> {
  const data = await gql<{ orders: { nodes: { legacyResourceId: string; name: string }[] } }>(
    admin,
    shopify.UNFULFILLED_ORDERS_QUERY,
    { first: limit, query: shopify.UNFULFILLED_SEARCH },
  );

  let added = 0;
  for (const order of data.orders.nodes) {
    const existing = await db.shipment.findUnique({
      where: { shop_orderId: { shop, orderId: order.legacyResourceId } },
    });
    if (existing) continue;
    await db.shipment.create({
      data: { shop, orderId: order.legacyResourceId, orderName: order.name, state: State.New },
    });
    added++;
  }
  kick();
  return added;
}

/** The merchant asked for these orders to be shipped now. */
export async function createNow(shop: string, ids: string[]): Promise<number> {
  const { count } = await db.shipment.updateMany({
    where: { shop, id: { in: ids }, state: { in: [State.Ready, State.NeedsReview, State.New] } },
    data: { state: State.Queued, runAfter: new Date(), error: null },
  });
  kick();
  return count;
}

/** Re-checks the shop's waiting rows, e.g. after its settings changed. */
export async function wakeShop(shop: string): Promise<void> {
  await db.shipment.updateMany({
    where: { shop, state: { in: [State.Ready, State.NeedsReview] }, trackingNumber: null },
    data: { state: State.New, runAfter: new Date() },
  });
  await db.shipment.updateMany({
    where: { shop, state: { in: [State.New, State.Queued, State.Created] } },
    data: { runAfter: new Date() },
  });
  kick();
}

/** Starts again with a fresh iShip order id, after the first parcel was cancelled. */
export async function reship(shipment: Shipment): Promise<void> {
  await db.shipment.update({
    where: { id: shipment.id },
    data: {
      state: State.New,
      attempt: shipment.attempt + 1,
      trackingNumber: null,
      courierCode: null,
      fulfillmentId: null,
      progress: null,
      ishipStatus: null,
      syncAfter: null,
      uncertain: false,
      tries: 0,
      firstTriedAt: null,
      orderCancelled: false,
      problems: null,
      error: null,
      runAfter: new Date(),
    },
  });
  kick();
}

/** The iShip order id a row uses, for display. */
export const ishipOrderId = (row: Pick<Shipment, "orderId" | "attempt">): string =>
  customOrderId({ platform: "shopify", orderId: row.orderId }, row.attempt);
