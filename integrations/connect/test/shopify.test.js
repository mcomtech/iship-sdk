import assert from "node:assert/strict";
import test from "node:test";

import { shopify } from "../dist/index.js";

const node = (overrides = {}) => ({
  id: "gid://shopify/Order/5550001112223",
  legacyResourceId: "5550001112223",
  name: "#1001",
  createdAt: "2026-10-18T10:00:00Z",
  cancelledAt: null,
  requiresShipping: true,
  displayFinancialStatus: "PAID",
  displayFulfillmentStatus: "UNFULFILLED",
  paymentGatewayNames: ["shopify_payments"],
  totalWeight: "1200",
  totalOutstandingSet: { shopMoney: { amount: "0.0", currencyCode: "THB" } },
  shippingAddress: {
    name: "สมชาย ใจดี",
    phone: "+66891234567",
    address1: "12/3 ต.สุเทพ",
    address2: null,
    city: "อ.เมือง",
    province: "Chiang Mai",
    provinceCode: "TH-50",
    zip: "50200",
    countryCodeV2: "TH",
  },
  lineItems: {
    nodes: [
      { name: "เสื้อยืด - M", currentQuantity: 2, requiresShipping: true, originalUnitPriceSet: { shopMoney: { amount: "250.00", currencyCode: "THB" } } },
      { name: "Gift card", currentQuantity: 1, requiresShipping: false, originalUnitPriceSet: { shopMoney: { amount: "500.00", currencyCode: "THB" } } },
      { name: "Removed", currentQuantity: 0, requiresShipping: true, originalUnitPriceSet: { shopMoney: { amount: "10.00", currencyCode: "THB" } } },
    ],
  },
  ...overrides,
});

test("paid orders are ready, unpaid ones wait, COD ones go now", () => {
  assert.deepEqual(shopify.readiness(node()), { ready: true, cod: false });
  assert.deepEqual(shopify.readiness(node({ displayFinancialStatus: "PENDING" })), { ready: false, reason: "awaiting_payment" });

  const cod = node({
    displayFinancialStatus: "PENDING",
    paymentGatewayNames: ["Cash on Delivery (COD)"],
    totalOutstandingSet: { shopMoney: { amount: "500.00", currencyCode: "THB" } },
  });
  assert.deepEqual(shopify.readiness(cod), { ready: true, cod: true });
  assert.deepEqual(shopify.readiness(node({ cancelledAt: "2026-10-18T11:00:00Z" })), { ready: false, reason: "cancelled" });
  assert.deepEqual(shopify.readiness(node({ shippingAddress: null })), { ready: false, reason: "no_shipping" });
});

test("a Shopify order maps to the neutral order", () => {
  const order = shopify.shopOrderFromShopify("demo.myshopify.com", node(), false);

  assert.equal(order.orderId, "5550001112223");
  assert.equal(order.totalGrams, 1200);
  assert.equal(order.codAmount, 0);
  assert.deepEqual(order.items, [{ name: "เสื้อยืด - M", quantity: 2, unitPrice: 250, grams: 0 }]);
  assert.equal(order.recipient.city, "อ.เมือง");
  assert.equal(order.recipient.provinceCode, "TH-50");
});

test("only open fulfillment orders that allow fulfilment are used", () => {
  const ids = shopify.fulfillableOrderIds([
    { id: "a", status: "OPEN", supportedActions: [{ action: "CREATE_FULFILLMENT" }] },
    { id: "b", status: "CLOSED", supportedActions: [] },
    { id: "c", status: "OPEN", supportedActions: [{ action: "REQUEST_FULFILLMENT" }] },
  ]);
  assert.deepEqual(ids, ["a"]);
});

test("fulfillment input carries the tracking details", () => {
  assert.deepEqual(shopify.fulfillmentInput(["a"], { company: "Flash Express", number: "TH1" }, true), {
    fulfillment: {
      lineItemsByFulfillmentOrder: [{ fulfillmentOrderId: "a" }],
      notifyCustomer: true,
      trackingInfo: { company: "Flash Express", number: "TH1" },
    },
  });
  assert.equal(shopify.trackingUrl("https://track.example/{tracking}", "TH 1"), "https://track.example/TH%201");
  assert.equal(shopify.trackingUrl("", "TH1"), undefined);
});

test("progress maps to Shopify event statuses", () => {
  assert.equal(shopify.shopifyEventStatus("picked_up"), "CARRIER_PICKED_UP");
  assert.equal(shopify.shopifyEventStatus("delivered"), "DELIVERED");
  assert.equal(shopify.shopifyEventStatus("awaiting_pickup"), undefined);
  assert.equal(shopify.orderGid("42"), "gid://shopify/Order/42");
  assert.equal(shopify.legacyId("gid://shopify/Order/42"), "42");
});
