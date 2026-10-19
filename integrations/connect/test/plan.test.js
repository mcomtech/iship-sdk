import assert from "node:assert/strict";
import test from "node:test";

import { customOrderId, planShipment } from "../dist/index.js";

const settings = {
  origin: {
    name: "ร้านทดสอบ",
    phone: "0812345678",
    address: "44/247",
    subdistrict: "สายไหม",
    district: "สายไหม",
    province: "กรุงเทพมหานคร",
    zipcode: "10220",
  },
  courierCode: "AutoCourier",
  box: { widthCm: 20, lengthCm: 30, heightCm: 10 },
};

const order = (overrides = {}) => ({
  platform: "shopify",
  shop: "demo.myshopify.com",
  orderId: "5550001112223",
  orderName: "#1001",
  recipient: {
    name: "สมชาย ใจดี",
    phone: "0891234567",
    line1: "12/3 ต.สุเทพ อ.เมือง",
    provinceCode: "TH-50",
    zip: "50200",
    countryCode: "TH",
  },
  items: [
    { name: "เสื้อยืด - M", quantity: 2, unitPrice: 250, grams: 0 },
    { name: "หมวก", quantity: 1, unitPrice: 199.5, grams: 120 },
  ],
  codAmount: 0,
  currency: "THB",
  totalGrams: 0,
  ...overrides,
});

test("a prepaid order becomes a create request without products", () => {
  const plan = planShipment(order(), settings);

  assert.equal(plan.ok, true);
  assert.equal(plan.input.customOrderId, "SHP-5550001112223");
  assert.equal(plan.input.courierCode, "AutoCourier");
  assert.equal(plan.input.remark, "#1001");
  assert.equal(plan.input.to.district, "เมืองเชียงใหม่");
  // Two shirts at the 500 g default plus a 120 g hat.
  assert.deepEqual(plan.input.parcel, { weightKg: 1.12, widthCm: 20, lengthCm: 30, heightCm: 10 });
  assert.equal(plan.input.codAmount, undefined);
  assert.equal(plan.input.products, undefined);
});

test("the platform's total weight wins over per-item guesses", () => {
  const plan = planShipment(order({ totalGrams: 2350 }), settings);
  assert.equal(plan.input.parcel.weightKg, 2.35);
});

test("a COD order lists every item with the fields iShip requires", () => {
  const plan = planShipment(order({ codAmount: 699.5 }), settings);

  assert.equal(plan.ok, true);
  assert.equal(plan.input.codAmount, 699.5);
  assert.deepEqual(plan.input.products[0], {
    name: "เสื้อยืด - M",
    quantity: 2,
    price: 250,
    weightKg: 0.5,
    color: "-",
    widthCm: 20,
    lengthCm: 30,
    heightCm: 10,
  });
  assert.equal(plan.input.products[1].weightKg, 0.12);
});

test("problems are listed instead of a request", () => {
  const plan = planShipment(
    order({
      recipient: { name: "x", phone: "0891234567", line1: "12/3", zip: "50200", countryCode: "TH" },
      codAmount: 100,
      currency: "USD",
    }),
    { ...settings, origin: { ...settings.origin, zipcode: "" } },
  );

  assert.equal(plan.ok, false);
  const found = plan.problems.map((p) => `${p.field}:${p.code}`).sort();
  assert.deepEqual(found, ["cod:currency", "district:missing", "origin:incomplete", "province:missing", "subdistrict:missing"]);
});

test("corrections typed by the merchant make the order shippable", () => {
  const plan = planShipment(
    order({ recipient: { name: "x", phone: "0891234567", line1: "12/3", zip: "50200", provinceCode: "TH-50", countryCode: "TH" } }),
    settings,
    { overrides: { subdistrict: "สุเทพ", district: "เมืองเชียงใหม่" } },
  );
  assert.equal(plan.ok, true);
  assert.equal(plan.input.to.subdistrict, "สุเทพ");
});

test("customOrderId is stable and marks deliberate re-shipments", () => {
  assert.equal(customOrderId({ platform: "shopify", orderId: "42" }), "SHP-42");
  assert.equal(customOrderId({ platform: "shopify", orderId: "42" }, 2), "SHP-42-R2");
  assert.equal(customOrderId({ platform: "tiktok", orderId: "57" }), "TTS-57");
  assert.equal(planShipment(order(), settings, { attempt: 3 }).input.customOrderId, "SHP-5550001112223-R3");
});
