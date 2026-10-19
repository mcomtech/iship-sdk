/**
 * Background processing for shipments.
 *
 * Webhooks only record that an order exists; this loop does the slow work:
 * reading the order, planning it, creating the iShip parcel (which can take
 * close to a minute), fulfilling the Shopify order with the tracking number,
 * and later copying status changes back as fulfillment events.
 *
 * Rows are claimed with a lease (`lockedUntil`), so running several app
 * instances is safe, and a crashed instance's work is picked up again once
 * its lease runs out.
 */
import {
  createShipment,
  isFinal,
  planShipment,
  progressOf,
  shopify,
  type PlanProblem,
} from "@iship/connect";
import type { Shipment, ShopSettings } from "@prisma/client";

import db from "../db.server";
import { unauthenticated } from "../shopify.server";
import { gql, type AdminGraphql } from "./admin.server";
import { codGateways, getSettings, ishipClient, shipperSettings } from "./settings.server";
import { State, WORKING_STATES } from "./states";

const TICK_MS = Number(process.env.ISHIP_WORKER_INTERVAL_MS ?? 15_000);
const LEASE_MS = 10 * 60_000;
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const SYNC_EVERY_MS = 3 * HOUR;
/** Unanswered create calls before a person is asked to look. */
const MAX_UNCERTAIN_TRIES = 8;

const after = (ms: number): Date => new Date(Date.now() + ms);
const backoff = (tries: number): number => Math.min(HOUR, MINUTE * 2 ** Math.max(0, tries - 1));
const message = (error: unknown): string => (error instanceof Error ? error.message : String(error));
const json = (value: unknown): string | null => (value === undefined || value === null ? null : JSON.stringify(value));

type OrderData = { order: shopify.ShopifyOrderNode | null };
type FulfillmentOrdersData = {
  order: { fulfillmentOrders: { nodes: { id: string; status: string; supportedActions: { action: string }[] }[] } } | null;
};

async function adminFor(shop: string): Promise<AdminGraphql> {
  const { admin } = await unauthenticated.admin(shop);
  return admin;
}

async function save(id: string, data: Parameters<typeof db.shipment.update>[0]["data"]): Promise<Shipment> {
  return db.shipment.update({ where: { id }, data: { ...data, lockedUntil: null } });
}

// ------------------------------------------------------------- courier names

const courierCache = new Map<string, { at: number; names: Map<string, string> }>();

/** The courier's display name for Shopify's tracking company, falling back to its code. */
async function courierName(settings: ShopSettings, code: string | null): Promise<string> {
  if (!code) return "iShip";
  const key = `${settings.shop}:${settings.environment}`;
  let cached = courierCache.get(key);
  if (!cached || Date.now() - cached.at > HOUR) {
    const client = ishipClient(settings);
    const couriers = client ? await client.couriers().catch(() => []) : [];
    cached = { at: Date.now(), names: new Map(couriers.map((c) => [c.code, c.name])) };
    courierCache.set(key, cached);
  }
  return cached.names.get(code) ?? code;
}

// ----------------------------------------------------------------- the steps

/** Reads the order and decides what happens to it; creates the parcel when it should. */
async function evaluate(row: Shipment): Promise<void> {
  const settings = await getSettings(row.shop);
  const admin = await adminFor(row.shop);
  const { order: node } = await gql<OrderData>(admin, shopify.ORDER_QUERY, { id: shopify.orderGid(row.orderId) });

  if (!node) {
    await save(row.id, { state: State.Skipped, error: "Order not found in Shopify" });
    return;
  }

  const readiness = shopify.readiness(node, codGateways(settings));
  if (!readiness.ready) {
    const state =
      readiness.reason === "cancelled"
        ? State.Cancelled
        : readiness.reason === "awaiting_payment"
          ? State.AwaitingPayment
          : State.Skipped;
    await save(row.id, { state, orderName: node.name, error: null });
    return;
  }

  const order = shopify.shopOrderFromShopify(row.shop, node, readiness.cod);
  const overrides = row.overrides ? JSON.parse(row.overrides) : null;
  const plan = planShipment(order, shipperSettings(settings), { attempt: row.attempt, overrides });

  if (!plan.ok) {
    await save(row.id, {
      state: State.NeedsReview,
      orderName: node.name,
      problems: json(plan.problems),
      warnings: json(plan.warnings),
      error: null,
    });
    return;
  }

  const create = row.state === State.Queued || settings.autoCreate;
  if (!create) {
    await save(row.id, { state: State.Ready, orderName: node.name, problems: null, warnings: json(plan.warnings), error: null });
    return;
  }

  const client = ishipClient(settings);
  if (!client) {
    await save(row.id, { error: "iShip token is not set", runAfter: after(HOUR) });
    return;
  }

  // Mark the call as in flight before making it; see Shipment.uncertain.
  const firstTriedAt = row.firstTriedAt ?? new Date();
  await db.shipment.update({
    where: { id: row.id },
    data: { uncertain: true, tries: { increment: 1 }, firstTriedAt },
  });

  const outcome = await createShipment(client, plan.input, {
    previousAttemptUncertain: row.uncertain,
    firstAttemptAt: firstTriedAt,
  });

  switch (outcome.kind) {
    case "created": {
      const created = await save(row.id, {
        state: State.Created,
        orderName: node.name,
        trackingNumber: outcome.trackingNumber,
        courierCode: outcome.courierCode,
        uncertain: false,
        problems: null,
        warnings: json(plan.warnings),
        error: null,
        runAfter: new Date(),
      });
      await fulfil(created);
      return;
    }
    case "rejected":
      await save(row.id, {
        state: State.NeedsReview,
        uncertain: false,
        problems: json([{ field: "iship", code: "rejected" } satisfies IShipProblem]),
        error: outcome.code ? `${outcome.message} (${outcome.code})` : outcome.message,
      });
      return;
    case "unauthorized":
      // Nothing was created; keep whatever we knew before this call.
      await save(row.id, { uncertain: row.uncertain, error: outcome.message, runAfter: after(HOUR) });
      return;
    case "uncertain": {
      const tries = row.tries + 1;
      if (tries >= MAX_UNCERTAIN_TRIES) {
        await save(row.id, {
          state: State.NeedsReview,
          problems: json([{ field: "iship", code: "no_answer" } satisfies IShipProblem]),
          error: outcome.message,
        });
      } else {
        // Queued, not New: a parcel may exist now, so this row must not fall
        // back to "ready" if the merchant turns automatic shipping off.
        await save(row.id, { state: State.Queued, error: outcome.message, runAfter: after(backoff(tries)) });
      }
      return;
    }
  }
}

/** Problems that come from iShip rather than from the order. */
export type IShipProblem = { field: "iship"; code: "rejected" | "no_answer" };
export type Problem = PlanProblem | IShipProblem;

/** Marks the Shopify order fulfilled with the iShip tracking number. */
async function fulfil(row: Shipment): Promise<void> {
  if (!row.trackingNumber) return;
  const settings = await getSettings(row.shop);
  const admin = await adminFor(row.shop);

  const data = await gql<FulfillmentOrdersData>(admin, shopify.FULFILLMENT_ORDERS_QUERY, {
    id: shopify.orderGid(row.orderId),
  });
  const nodes = data.order?.fulfillmentOrders.nodes ?? [];
  const ids = shopify.fulfillableOrderIds(nodes);

  if (!ids.length) {
    if (nodes.length && nodes.every((n) => n.status === "CLOSED" || n.status === "CANCELLED")) {
      await save(row.id, {
        state: State.Fulfilled,
        error: "Order was fulfilled outside this app; the tracking number was not attached",
        syncAfter: new Date(),
      });
    } else {
      await save(row.id, { error: "No fulfillment order is open (it may be on hold)", runAfter: after(30 * MINUTE) });
    }
    return;
  }

  const company = await courierName(settings, row.courierCode);
  const result = await gql<{ fulfillmentCreate: { fulfillment: { id: string } | null } }>(
    admin,
    shopify.FULFILLMENT_CREATE,
    shopify.fulfillmentInput(
      ids,
      { company, number: row.trackingNumber, url: shopify.trackingUrl(settings.trackingUrlTemplate, row.trackingNumber) },
      settings.notifyCustomer,
    ),
  );

  await save(row.id, {
    state: State.Fulfilled,
    fulfillmentId: result.fulfillmentCreate.fulfillment?.id ?? null,
    error: null,
    syncAfter: after(HOUR),
  });
}

/** Copies the parcel's latest iShip status to Shopify as a fulfillment event. */
export async function syncStatus(row: Shipment): Promise<void> {
  if (!row.trackingNumber) return;
  const settings = await getSettings(row.shop);
  const client = ishipClient(settings);
  if (!client) {
    await save(row.id, { syncAfter: after(SYNC_EVERY_MS) });
    return;
  }

  const order = await client.getOrder(row.trackingNumber);
  if (!order) {
    await save(row.id, { syncAfter: after(SYNC_EVERY_MS) });
    return;
  }

  const progress = progressOf(order.status);
  if (progress && progress !== row.progress && row.fulfillmentId) {
    const status = shopify.shopifyEventStatus(progress);
    if (status) {
      const admin = await adminFor(row.shop);
      await gql(admin, shopify.FULFILLMENT_EVENT_CREATE, {
        event: {
          fulfillmentId: row.fulfillmentId,
          status,
          happenedAt: new Date().toISOString(),
          message: order.status_name,
        },
      });
    }
  }

  await save(row.id, {
    ishipStatus: order.status,
    progress: progress ?? row.progress,
    syncAfter: isFinal(progress) ? null : after(SYNC_EVERY_MS),
  });
}

// ------------------------------------------------------------------- the loop

async function claim(id: string): Promise<boolean> {
  const now = new Date();
  const { count } = await db.shipment.updateMany({
    where: { id, OR: [{ lockedUntil: null }, { lockedUntil: { lt: now } }] },
    data: { lockedUntil: new Date(now.getTime() + LEASE_MS) },
  });
  return count === 1;
}

/** Runs one step for one row, recording any unexpected error on the row. */
async function step(id: string, run: (row: Shipment) => Promise<void>): Promise<void> {
  if (!(await claim(id))) return;
  const row = await db.shipment.findUnique({ where: { id } });
  if (!row) return;
  try {
    await run(row);
  } catch (error) {
    console.error(`[iship] ${row.shop} order ${row.orderId}:`, error);
    await save(id, { error: message(error), runAfter: after(15 * MINUTE), syncAfter: row.syncAfter ? after(HOUR) : null });
  }
}

/** Processes everything that is due. Exported for tests and manual runs. */
export async function tick(): Promise<void> {
  const now = new Date();
  const unlocked = { OR: [{ lockedUntil: null }, { lockedUntil: { lt: now } }] };

  const due = await db.shipment.findMany({
    where: { state: { in: WORKING_STATES }, runAfter: { lte: now }, ...unlocked },
    orderBy: { runAfter: "asc" },
    take: 10,
  });
  for (const row of due) {
    await step(row.id, (fresh) => (fresh.state === State.Created ? fulfil(fresh) : evaluate(fresh)));
  }

  const syncing = await db.shipment.findMany({
    where: { state: State.Fulfilled, trackingNumber: { not: null }, syncAfter: { lte: now }, ...unlocked },
    orderBy: { syncAfter: "asc" },
    take: 20,
  });
  for (const row of syncing) await step(row.id, syncStatus);
}

const loop = globalThis as typeof globalThis & { __ishipWorker?: { timer: NodeJS.Timeout; running: boolean } };

async function runOnce(): Promise<void> {
  const worker = loop.__ishipWorker;
  if (!worker || worker.running) return;
  worker.running = true;
  try {
    await tick();
  } catch (error) {
    console.error("[iship] worker tick failed:", error);
  } finally {
    worker.running = false;
  }
}

/** Starts the loop once per process. Set ISHIP_WORKER=off to run it elsewhere. */
export function startWorker(): void {
  if (process.env.ISHIP_WORKER === "off" || loop.__ishipWorker) return;
  loop.__ishipWorker = { timer: setInterval(runOnce, TICK_MS), running: false };
  loop.__ishipWorker.timer.unref?.();
}

/** Asks the loop to run now instead of waiting for the next interval. */
export function kick(): void {
  setTimeout(runOnce, 0);
}
