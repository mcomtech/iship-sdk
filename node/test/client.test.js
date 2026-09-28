import assert from "node:assert/strict";
import test from "node:test";

import {
  ApiError,
  AuthError,
  Category,
  IShipClient,
  OrderStatus,
  TransportError,
  UAT,
  ValidationError,
  parseWebhook,
} from "../dist/index.js";

const bangkok = {
  name: "ร้านทดสอบ",
  phone: "0812345678",
  address: "44/247",
  subdistrict: "สายไหม",
  district: "สายไหม",
  province: "กรุงเทพมหานคร",
  zipcode: "10220",
};

const chiangmai = {
  name: "ผู้รับ",
  phone: "0891234567",
  address: "12/3",
  subdistrict: "สุเทพ",
  district: "เมืองเชียงใหม่",
  province: "เชียงใหม่",
  zipcode: "50200",
};

const parcel = { weightKg: 1, widthCm: 14, lengthCm: 20, heightCm: 6 };

/** Replays canned responses and records every request. */
function stub(...responses) {
  const calls = [];
  let index = 0;

  const fetchImpl = async (url, init) => {
    calls.push({ url, init, body: init.body ? JSON.parse(init.body) : undefined });
    const next = responses[index++] ?? { body: {} };
    return new Response(typeof next.body === "string" ? next.body : JSON.stringify(next.body), {
      status: next.status ?? 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  return { client: new IShipClient({ token: "token", fetch: fetchImpl }), calls };
}

test("a failure sent as HTTP 200 becomes ApiError", async () => {
  const { client } = stub({ body: { status: false, code: "1013", message: "ไม่พบข้อมูล courier_code นี้ในระบบ" } });

  await assert.rejects(() => client.couriers(), (error) => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.code, "1013");
    assert.equal(error.message, "ไม่พบข้อมูล courier_code นี้ในระบบ");
    return true;
  });
});

test("Unauthenticated becomes AuthError", async () => {
  const { client } = stub({ body: { status: false, code: 9999, message: "Unauthenticated" } });

  await assert.rejects(() => client.balance(), AuthError);
});

test("account endpoints require a token", async () => {
  const client = new IShipClient();

  await assert.rejects(() => client.couriers(), AuthError);
});

test("a non-JSON body becomes TransportError", async () => {
  const { client } = stub({ body: "<html>Bad Gateway</html>", status: 502 });

  await assert.rejects(() => client.couriers(), TransportError);
});

test("the envelope is unwrapped to data", async () => {
  const { client } = stub({ body: { status: true, code: "0000", data: [{ code: "FlashLive", name: "Flash Pro OK" }] } });

  assert.deepEqual(await client.couriers(), [{ code: "FlashLive", name: "Flash Pro OK" }]);
});

test("a bare array response is returned as is", async () => {
  const { client } = stub({ body: [{ id: 2, name: "กล่องเบอร์ A", width: 14, length: 20, height: 6, unit: "ซม" }] });

  const boxes = await client.boxes();
  assert.equal(boxes[0].width, 14);
});

test("address fields map to the wire names iShip expects", async () => {
  const { client, calls } = stub({ body: { status: true, data: [] } });

  await client.recommendCouriers(bangkok, chiangmai, parcel);

  assert.equal(calls[0].body.src_district, "สายไหม", "subdistrict goes to src_district");
  assert.equal(calls[0].body.src_amphure, "สายไหม", "district goes to src_amphure");
  assert.equal(calls[0].body.dst_district, "สุเทพ", "subdistrict goes to dst_district");
  assert.equal(calls[0].body.dst_amphure, "เมืองเชียงใหม่", "district goes to dst_amphure");
  assert.equal(calls[0].body.weight, 1, "weight in kg");
});

test("createOrder sends the duplicate-guard id and requires one", async () => {
  const { client, calls } = stub({ body: { status: true, data: { tracking_number: "TH0147XXXX", ref: "REF1" } } });

  const created = await client.createOrder({
    customOrderId: "SHOP-1001",
    courierCode: "FlashLive",
    from: bangkok,
    to: chiangmai,
    parcel,
    categoryId: Category.Clothing,
    codAmount: 590,
  });

  assert.equal(created.tracking_number, "TH0147XXXX");
  assert.equal(calls[0].body.custom_order_id, "SHOP-1001");
  assert.equal(calls[0].body.category_id, 4);
  assert.equal(calls[0].body.cod_amount, 590);

  await assert.rejects(
    () => client.createOrder({ customOrderId: "", courierCode: "FlashLive", from: bangkok, to: chiangmai, parcel }),
    ValidationError,
  );
});

test("insurance requires a declared value", async () => {
  const { client } = stub();

  await assert.rejects(
    () =>
      client.createOrder({
        customOrderId: "SHOP-1002",
        courierCode: "FlashLive",
        from: bangkok,
        to: chiangmai,
        parcel,
        insured: true,
      }),
    ValidationError,
  );
});

test("cancelOrder verifies the order really was cancelled", async () => {
  const active = { body: { status: true, data: { courier_code: "FlashLive", status: 1, status_name: "รอเข้ารับพัสดุ" } } };
  const { client } = stub(active, { body: { status: true, code: 200, data: [] } }, active);

  await assert.rejects(() => client.cancelOrder("TH0147XXXX"), (error) => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.code, "not_cancelled");
    return true;
  });
});

test("cancelOrder returns the cancelled order", async () => {
  const { client } = stub(
    { body: { status: true, data: { courier_code: "FlashLive", status: 1 } } },
    { body: { status: true, code: 200, data: [] } },
    { body: { status: true, data: { status: 5, status_name: "ยกเลิก", cancel_at: "2026-09-28 10:00:00" } } },
  );

  const order = await client.cancelOrder("TH0147XXXX");
  assert.equal(order.status, OrderStatus.Cancelled);
});

test("getOrder resolves to null when not found", async () => {
  const { client } = stub({ body: { status: false, code: "1004", message: "The requested 'track_no' does not exist." } });

  assert.equal(await client.getOrder("TH0000000000"), null);
});

test("queryOrders builds the query string", async () => {
  const { client, calls } = stub({ body: { status: true, data: [] } });

  await client.queryOrders({ startDate: "2026-09-01", endDate: "2026-09-28", status: OrderStatus.Delivered, printed: false });

  const url = new URL(calls[0].url);
  assert.equal(url.searchParams.get("start_date"), "2026-09-01");
  assert.equal(url.searchParams.get("status"), "3");
  assert.equal(url.searchParams.get("is_printed"), "0");

  await assert.rejects(() => client.queryOrders({ startDate: "01/09/2026", endDate: "2026-09-28" }), ValidationError);
});

test("labelUrl joins tracking numbers", () => {
  const client = new IShipClient();

  assert.equal(client.labelUrl(["TH01", "TH02"]), "https://app.iship.cloud/api/download/pdf?tracks=TH01,TH02");
  assert.throws(() => client.labelUrl([]), ValidationError);
});

test("baseUrl switches environments", async () => {
  const calls = [];
  const client = new IShipClient({
    baseUrl: UAT,
    fetch: async (url) => {
      calls.push(url);
      return new Response("[]", { status: 200 });
    },
  });

  await client.boxes();
  assert.ok(calls[0].startsWith("https://app-uat.iship.cloud/"));
});

test("webhook payloads parse", () => {
  const event = parseWebhook(
    '{"courier_code":"THP_eParcel","price":24,"ref_code":"APIS19613","status":"delivered","status_desc":"จัดส่งสำเร็จ","timestamp":1671251342,"tracking":"EA666581364TH","weight":0.16,"is_over_weight":true}',
  );

  assert.equal(event.trackingNumber, "EA666581364TH");
  assert.equal(event.status, "delivered");
  assert.equal(event.overWeight, true);
  assert.equal(event.overSize, false);
  assert.equal(event.occurredAt.toISOString().slice(0, 10), "2022-12-17");
  assert.throws(() => parseWebhook("not json"), TransportError);
});

// Live tests call the real public endpoints. Skip with ISHIP_SKIP_LIVE=1.
const live = process.env.ISHIP_SKIP_LIVE === "1" ? test.skip : test;

live("live: boxes() returns real box sizes", async () => {
  const boxes = await new IShipClient().boxes();

  assert.ok(boxes.length >= 3, "expected several boxes");
  assert.ok(boxes[0].name, "expected a name");
});

live("live: recommendCouriers() prices a real route", async () => {
  const quotes = await new IShipClient().recommendCouriers(bangkok, chiangmai, parcel);

  assert.ok(quotes.length > 0);
  assert.ok(quotes[0].courier_code);
  assert.ok(quotes[0].total_price > 0);
});

live("live: tracking() resolves to null for an unknown number", async () => {
  assert.equal(await new IShipClient().tracking("TH0000000000"), null);
});

live("live: a bad token fails as AuthError", async () => {
  await assert.rejects(() => new IShipClient({ token: "definitely-not-a-valid-token" }).balance(), AuthError);
});
