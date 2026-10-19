/**
 * Runs the shipment worker end to end against a real SQLite database, a fake
 * Shopify Admin API and a fake iShip API.
 */
import { readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const { prisma, admin, ishipFetch } = vi.hoisted(() => {
  // vi.hoisted runs before imports, so the client has to be required here.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { PrismaClient } = require("@prisma/client");
  const file = `${process.env.TMPDIR ?? "/tmp"}/iship-worker-${process.pid}.sqlite`;
  process.env.ISHIP_TEST_DB = file;
  process.env.ISHIP_ENCRYPTION_KEY = "0".repeat(64);
  process.env.SHOPIFY_APP_URL = "https://app.example";
  return {
    prisma: new PrismaClient({ datasources: { db: { url: `file:${file}` } } }),
    admin: { handlers: {} as Record<string, (vars: Record<string, unknown>) => unknown>, calls: [] as { op: string; vars: Record<string, unknown> }[] },
    ishipFetch: { handlers: {} as Record<string, (body: unknown, url: URL) => unknown>, calls: [] as { path: string; body: unknown }[] },
  };
});

vi.mock("../app/db.server", () => ({ default: prisma }));
vi.mock("../app/shopify.server", () => ({
  unauthenticated: {
    admin: async () => ({
      admin: {
        async graphql(query: string, options?: { variables?: Record<string, unknown> }) {
          const op = /(?:query|mutation)\s+(\w+)/.exec(query)![1];
          const vars = options?.variables ?? {};
          admin.calls.push({ op, vars });
          const handler = admin.handlers[op];
          if (!handler) throw new Error(`unexpected GraphQL operation ${op}`);
          return new Response(JSON.stringify({ data: handler(vars) }));
        },
      },
    }),
  },
}));

import { SecretBox } from "@iship/connect/secret";

import { enqueueOrder, createNow } from "../app/iship/queue.server";
import { tick } from "../app/iship/worker.server";

const shop = "demo.myshopify.com";

const orderNode = (overrides: Record<string, unknown> = {}) => ({
  id: "gid://shopify/Order/1001",
  legacyResourceId: "1001",
  name: "#1001",
  createdAt: "2026-10-18T10:00:00Z",
  cancelledAt: null,
  requiresShipping: true,
  displayFinancialStatus: "PAID",
  displayFulfillmentStatus: "UNFULFILLED",
  paymentGatewayNames: ["shopify_payments"],
  totalWeight: "800",
  totalOutstandingSet: { shopMoney: { amount: "0.0", currencyCode: "THB" } },
  shippingAddress: {
    name: "สมชาย ใจดี",
    phone: "+66891234567",
    address1: "12/3 ต.สุเทพ อ.เมือง",
    address2: null,
    city: null,
    province: "Chiang Mai",
    provinceCode: "TH-50",
    zip: "50200",
    countryCodeV2: "TH",
  },
  lineItems: {
    nodes: [
      { name: "เสื้อยืด", currentQuantity: 1, requiresShipping: true, originalUnitPriceSet: { shopMoney: { amount: "250.00", currencyCode: "THB" } } },
    ],
  },
  ...overrides,
});

const ok = (data: unknown) => ({ status: true, data });

async function resetDatabase() {
  await prisma.shipment.deleteMany();
  await prisma.shopSettings.deleteMany();
  await prisma.shopSettings.create({
    data: {
      shop,
      callbackSecret: "secret",
      ishipToken: new SecretBox("0".repeat(64)).seal("iship-token"),
      originName: "ร้านทดสอบ",
      originPhone: "0812345678",
      originAddress: "44/247",
      originSubdistrict: "สายไหม",
      originDistrict: "สายไหม",
      originProvince: "กรุงเทพมหานคร",
      originZipcode: "10220",
      autoCreate: true,
      trackingUrlTemplate: "https://track.example/{tracking}",
    },
  });
}

beforeAll(async () => {
  const migrations = join(process.cwd(), "prisma", "migrations");
  for (const dir of readdirSync(migrations).filter((d) => /^\d/.test(d)).sort()) {
    const sql = readFileSync(join(migrations, dir, "migration.sql"), "utf8");
    for (const statement of sql.split(/;\s*\n/).map((s) => s.trim()).filter((s) => s && !/^--[^\n]*$/.test(s))) {
      await prisma.$executeRawUnsafe(statement);
    }
  }

  vi.stubGlobal("fetch", async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    ishipFetch.calls.push({ path: url.pathname, body });
    const key = Object.keys(ishipFetch.handlers).find((prefix) => url.pathname.startsWith(prefix));
    if (!key) throw new Error(`unexpected iShip call ${url.pathname}`);
    const result = ishipFetch.handlers[key](body, url);
    if (result instanceof Error) throw result;
    return new Response(JSON.stringify(result));
  });
});

afterAll(async () => {
  await prisma.$disconnect();
  rmSync(process.env.ISHIP_TEST_DB!, { force: true });
});

beforeEach(async () => {
  await resetDatabase();
  admin.calls.length = 0;
  ishipFetch.calls.length = 0;
  admin.handlers = {
    IShipOrder: () => ({ order: orderNode() }),
    IShipFulfillmentOrders: () => ({
      order: { fulfillmentOrders: { nodes: [{ id: "gid://shopify/FulfillmentOrder/9", status: "OPEN", supportedActions: [{ action: "CREATE_FULFILLMENT" }] }] } },
    }),
    IShipFulfillmentCreate: () => ({ fulfillmentCreate: { fulfillment: { id: "gid://shopify/Fulfillment/77", status: "SUCCESS" }, userErrors: [] } }),
    IShipFulfillmentEvent: () => ({ fulfillmentEventCreate: { fulfillmentEvent: { id: "e1", status: "DELIVERED" }, userErrors: [] } }),
  };
  ishipFetch.handlers = {
    "/api/create_order": () => ok({ tracking_number: "TH0001", ref: "R", id: 1, user_id: 1 }),
    "/api/get_order/": () => ok({ track_no: "TH0001", courier_code: "FLASH", status: 1, status_name: "รอเข้ารับพัสดุ" }),
    "/api/courier_code": () => ok([{ code: "FLASH", name: "Flash Express" }]),
  };
});

const row = () => prisma.shipment.findUniqueOrThrow({ where: { shop_orderId: { shop, orderId: "1001" } } });

describe("shipment worker", () => {
  it("creates the parcel and fulfils a paid order in one pass", async () => {
    await enqueueOrder(shop, "1001", "#1001");
    await tick();

    const shipment = await row();
    expect(shipment.state).toBe("fulfilled");
    expect(shipment.trackingNumber).toBe("TH0001");
    expect(shipment.courierCode).toBe("FLASH");
    expect(shipment.fulfillmentId).toBe("gid://shopify/Fulfillment/77");
    expect(shipment.uncertain).toBe(false);

    const create = ishipFetch.calls.find((c) => c.path === "/api/create_order")!.body as Record<string, unknown>;
    expect(create.custom_order_id).toBe("SHP-1001");
    expect(create.dst_amphure).toBe("เมืองเชียงใหม่");
    expect(create.dst_district).toBe("สุเทพ");
    expect(create.weight).toBe(0.8);

    const fulfil = admin.calls.find((c) => c.op === "IShipFulfillmentCreate")!.vars as {
      fulfillment: { trackingInfo: Record<string, string>; notifyCustomer: boolean };
    };
    expect(fulfil.fulfillment.trackingInfo).toEqual({
      company: "Flash Express",
      number: "TH0001",
      url: "https://track.example/TH0001",
    });
    expect(fulfil.fulfillment.notifyCustomer).toBe(true);
  });

  it("copies a status change to Shopify as a fulfillment event", async () => {
    await enqueueOrder(shop, "1001", "#1001");
    await tick();
    await prisma.shipment.updateMany({ data: { syncAfter: new Date(0) } });
    ishipFetch.handlers["/api/get_order/"] = () =>
      ok({ track_no: "TH0001", courier_code: "FLASH", status: 3, status_name: "จัดส่งแล้ว" });

    await tick();

    const shipment = await row();
    expect(shipment.progress).toBe("delivered");
    expect(shipment.syncAfter).toBeNull();
    const event = admin.calls.find((c) => c.op === "IShipFulfillmentEvent")!.vars as { event: Record<string, string> };
    expect(event.event).toMatchObject({ fulfillmentId: "gid://shopify/Fulfillment/77", status: "DELIVERED", message: "จัดส่งแล้ว" });
  });

  it("waits for the merchant in manual mode", async () => {
    await prisma.shopSettings.update({ where: { shop }, data: { autoCreate: false } });
    await enqueueOrder(shop, "1001", "#1001");
    await tick();

    expect((await row()).state).toBe("ready");
    expect(ishipFetch.calls.some((c) => c.path === "/api/create_order")).toBe(false);

    await createNow(shop, [(await row()).id]);
    await tick();
    expect((await row()).state).toBe("fulfilled");
  });

  it("holds unpaid orders until payment, but ships COD at once", async () => {
    admin.handlers.IShipOrder = () => ({ order: orderNode({ displayFinancialStatus: "PENDING" }) });
    await enqueueOrder(shop, "1001", "#1001");
    await tick();
    expect((await row()).state).toBe("awaiting_payment");

    admin.handlers.IShipOrder = () => ({
      order: orderNode({
        displayFinancialStatus: "PENDING",
        paymentGatewayNames: ["Cash on Delivery (COD)"],
        totalOutstandingSet: { shopMoney: { amount: "250.00", currencyCode: "THB" } },
      }),
    });
    await enqueueOrder(shop, "1001", "#1001");
    await tick();

    expect((await row()).state).toBe("fulfilled");
    const create = ishipFetch.calls.find((c) => c.path === "/api/create_order")!.body as Record<string, unknown>;
    expect(create.cod_amount).toBe(250);
    expect(create.products).toHaveLength(1);
  });

  it("sends an address it cannot read to review instead of to iShip", async () => {
    admin.handlers.IShipOrder = () => ({
      order: orderNode({ shippingAddress: { ...orderNode().shippingAddress, address1: "12/3", provinceCode: null, province: null } }),
    });
    await enqueueOrder(shop, "1001", "#1001");
    await tick();

    const shipment = await row();
    expect(shipment.state).toBe("needs_review");
    expect(JSON.parse(shipment.problems!).map((p: { field: string }) => p.field).sort()).toEqual([
      "district",
      "province",
      "subdistrict",
    ]);
    expect(ishipFetch.calls.some((c) => c.path === "/api/create_order")).toBe(false);
  });

  it("retries a lost response without creating a second parcel", async () => {
    ishipFetch.handlers["/api/create_order"] = () => new TypeError("socket hang up");
    await enqueueOrder(shop, "1001", "#1001");
    await tick();

    let shipment = await row();
    expect(shipment.state).toBe("queued");
    expect(shipment.uncertain).toBe(true);
    expect(shipment.tries).toBe(1);

    // The first call did reach iShip, so the retry is refused as a duplicate.
    ishipFetch.handlers["/api/create_order"] = () => ({ status: false, code: "1004", message: "custom_order_id ซ้ำ" });
    ishipFetch.handlers["/api/query_orders"] = () =>
      ok([{ track_no: "TH0042", custom_order_id: "SHP-1001", courier_code: "FLASH" }]);
    await prisma.shipment.updateMany({ data: { runAfter: new Date(0) } });
    await tick();

    shipment = await row();
    expect(shipment.state).toBe("fulfilled");
    expect(shipment.trackingNumber).toBe("TH0042");
    expect(shipment.uncertain).toBe(false);
  });

  it("puts a refusal from iShip in front of the merchant", async () => {
    ishipFetch.handlers["/api/create_order"] = () => ({ status: false, code: "1020", message: "เครดิตไม่พอ" });
    await enqueueOrder(shop, "1001", "#1001");
    await tick();

    const shipment = await row();
    expect(shipment.state).toBe("needs_review");
    expect(shipment.error).toBe("เครดิตไม่พอ (1020)");
    expect(shipment.uncertain).toBe(false);
  });
});
