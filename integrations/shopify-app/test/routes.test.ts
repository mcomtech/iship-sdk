/** The webhook routes that change data: iShip callbacks and Shopify's compliance topics. */
import { readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const { prisma, webhook } = vi.hoisted(() => {
  // vi.hoisted runs before imports, so the client has to be required here.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { PrismaClient } = require("@prisma/client");
  const file = `${process.env.TMPDIR ?? "/tmp"}/iship-routes-${process.pid}.sqlite`;
  process.env.ISHIP_TEST_DB = file;
  return {
    prisma: new PrismaClient({ datasources: { db: { url: `file:${file}` } } }),
    webhook: { topic: "", payload: {} as unknown },
  };
});

vi.mock("../app/db.server", () => ({ default: prisma }));
vi.mock("../app/shopify.server", () => ({
  authenticate: {
    webhook: async () => ({ shop: "demo.myshopify.com", topic: webhook.topic, payload: webhook.payload }),
  },
  unauthenticated: { admin: async () => ({ admin: {} }) },
}));

import { action as ishipCallback } from "../app/routes/webhooks.iship.$secret";
import { action as customersRedact } from "../app/routes/webhooks.customers.redact";
import { action as shopRedact } from "../app/routes/webhooks.shop.redact";
import { action as orderCancelled } from "../app/routes/webhooks.orders.cancelled";

const shop = "demo.myshopify.com";
const args = (request: Request, params: Record<string, string> = {}) =>
  ({ request, params, context: {} }) as Parameters<typeof ishipCallback>[0];

beforeAll(async () => {
  const migrations = join(process.cwd(), "prisma", "migrations");
  for (const dir of readdirSync(migrations).filter((d) => /^\d/.test(d)).sort()) {
    const sql = readFileSync(join(migrations, dir, "migration.sql"), "utf8");
    for (const statement of sql.split(/;\s*\n/).map((s) => s.trim()).filter(Boolean)) {
      await prisma.$executeRawUnsafe(statement);
    }
  }
});

afterAll(async () => {
  await prisma.$disconnect();
  rmSync(process.env.ISHIP_TEST_DB!, { force: true });
});

beforeEach(async () => {
  await prisma.shipment.deleteMany();
  await prisma.shopSettings.deleteMany();
  await prisma.shopSettings.create({ data: { shop, callbackSecret: "s3cret" } });
  await prisma.shipment.create({
    data: {
      shop,
      orderId: "1001",
      orderName: "#1001",
      state: "fulfilled",
      trackingNumber: "TH0001",
      overrides: JSON.stringify({ phone: "0891234567" }),
      syncAfter: new Date(Date.now() + 3_600_000),
    },
  });
});

const post = (url: string, body: unknown) =>
  new Request(url, { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) });

describe("iShip status callback", () => {
  it("marks the parcel for an immediate status check", async () => {
    const response = await ishipCallback(
      args(post("https://app.example/webhooks/iship/s3cret", { tracking: "TH0001", status: "delivered" }), { secret: "s3cret" }),
    );
    expect(response.status).toBe(200);
    const row = await prisma.shipment.findFirstOrThrow();
    expect(row.syncAfter!.getTime()).toBeLessThanOrEqual(Date.now());
    // The body is only a hint; the status itself comes from iShip's API later.
    expect(row.progress).toBeNull();
  });

  it("rejects unknown secrets and malformed bodies", async () => {
    const wrong = await ishipCallback(args(post("https://app.example/webhooks/iship/x", { tracking: "TH0001" }), { secret: "x" }));
    expect(wrong.status).toBe(404);
    const bad = await ishipCallback(args(post("https://app.example/webhooks/iship/s3cret", "not json"), { secret: "s3cret" }));
    expect(bad.status).toBe(400);
  });
});

describe("Shopify webhooks", () => {
  it("customers/redact erases the merchant's corrections for the named orders", async () => {
    webhook.topic = "CUSTOMERS_REDACT";
    webhook.payload = { orders_to_redact: [1001] };
    await customersRedact(args(post("https://app.example/webhooks/customers/redact", {})));
    expect((await prisma.shipment.findFirstOrThrow()).overrides).toBeNull();
  });

  it("shop/redact deletes everything about the shop", async () => {
    webhook.topic = "SHOP_REDACT";
    webhook.payload = {};
    await shopRedact(args(post("https://app.example/webhooks/shop/redact", {})));
    expect(await prisma.shipment.count()).toBe(0);
    expect(await prisma.shopSettings.count()).toBe(0);
  });

  it("orders/cancelled flags a parcel that already exists", async () => {
    webhook.topic = "ORDERS_CANCELLED";
    webhook.payload = { id: 1001 };
    await orderCancelled(args(post("https://app.example/webhooks/orders/cancelled", {})));
    const row = await prisma.shipment.findFirstOrThrow();
    expect(row.state).toBe("fulfilled");
    expect(row.orderCancelled).toBe(true);
  });
});
