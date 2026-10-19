import assert from "node:assert/strict";
import test from "node:test";

import { IShipClient } from "@iship/sdk";

import { bangkokDate, createShipment, isFinal, progressOf } from "../dist/index.js";
import { SecretBox } from "../dist/secret.js";

function stub(...responses) {
  const calls = [];
  let index = 0;
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), method: init.method, body: init.body ? JSON.parse(init.body) : undefined });
    const next = responses[index++];
    if (next instanceof Error) throw next;
    return new Response(JSON.stringify(next?.body ?? {}), { status: next?.status ?? 200 });
  };
  return { client: new IShipClient({ token: "t", fetch: fetchImpl }), calls };
}

const input = {
  customOrderId: "SHP-1",
  courierCode: "AutoCourier",
  from: { name: "a", phone: "0812345678", address: "1", subdistrict: "ส", district: "อ", province: "กรุงเทพมหานคร", zipcode: "10220" },
  to: { name: "สมชาย", phone: "0891234567", address: "2", subdistrict: "ส", district: "อ", province: "เชียงใหม่", zipcode: "50200" },
  parcel: { weightKg: 1, widthCm: 10, lengthCm: 10, heightCm: 10 },
};

test("a created shipment reports the courier iShip picked", async () => {
  const { client, calls } = stub(
    { body: { status: true, data: { tracking_number: "TH123", ref: "R1", id: 1, user_id: 1 } } },
    { body: { status: true, data: { track_no: "TH123", courier_code: "FLASH", status: 1 } } },
  );

  const outcome = await createShipment(client, input);

  assert.deepEqual(outcome, { kind: "created", trackingNumber: "TH123", courierCode: "FLASH", recovered: false });
  assert.match(calls[1].url, /\/api\/get_order\/TH123$/);
});

test("a lost response is uncertain, not a failure", async () => {
  const { client } = stub(new TypeError("socket hang up"));
  const outcome = await createShipment(client, input);
  assert.equal(outcome.kind, "uncertain");
});

test("after an uncertain attempt, a duplicate rejection finds the first parcel", async () => {
  const { client, calls } = stub(
    { body: { status: false, code: "1004", message: "custom_order_id ซ้ำ" } },
    {
      body: {
        status: true,
        data: [
          { track_no: "OTHER", custom_order_id: "SHP-9", courier_code: "KERRY" },
          { track_no: "TH777", custom_order_id: "SHP-1", courier_code: "FLASH" },
        ],
      },
    },
  );

  const outcome = await createShipment(client, input, {
    previousAttemptUncertain: true,
    firstAttemptAt: new Date("2026-10-18T20:00:00Z"),
  });

  assert.deepEqual(outcome, { kind: "created", trackingNumber: "TH777", courierCode: "FLASH", recovered: true });
  const search = new URL(calls[1].url).searchParams;
  assert.equal(search.get("keyword"), "สมชาย");
  assert.equal(search.get("start_date"), "2026-10-18");
});

test("a rejection without an earlier uncertain attempt is reported as is", async () => {
  const { client, calls } = stub({ body: { status: false, code: "1013", message: "ไม่พบ courier_code" } });
  const outcome = await createShipment(client, { ...input, courierCode: "NOPE" });
  assert.deepEqual(outcome, { kind: "rejected", message: "ไม่พบ courier_code", code: "1013" });
  assert.equal(calls.length, 1);
});

test("a bad token is reported separately", async () => {
  const { client } = stub({ status: 401, body: { message: "Unauthenticated" } });
  assert.equal((await createShipment(client, input)).kind, "unauthorized");
});

test("iShip status ids map to platform-neutral progress", () => {
  assert.equal(progressOf(2), "picked_up");
  assert.equal(progressOf(13), "in_transit");
  assert.equal(progressOf(3), "delivered");
  assert.equal(progressOf(10), "returning");
  assert.equal(progressOf(12345), undefined);
  assert.ok(isFinal("delivered"));
  assert.ok(!isFinal("in_transit"));
});

test("dates are filed in Bangkok time", () => {
  assert.equal(bangkokDate(new Date("2026-10-18T18:30:00Z")), "2026-10-19");
});

test("sealed secrets open with the same key only", () => {
  const box = new SecretBox(SecretBox.generateKey());
  const sealed = box.seal("iship-token");
  assert.match(sealed, /^v1:/);
  assert.equal(box.open(sealed), "iship-token");
  assert.throws(() => new SecretBox(SecretBox.generateKey()).open(sealed));
  assert.throws(() => new SecretBox("short"));
});
