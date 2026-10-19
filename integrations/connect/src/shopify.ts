/**
 * Shopify-specific pieces that do not need Shopify's libraries: the GraphQL
 * documents this integration sends, and mappings between Shopify's shapes and
 * the neutral ones in this package. Every document is checked against the
 * Admin API schema in the tests.
 */
import type { ShopOrder } from "./plan.js";
import type { Progress } from "./shipment.js";

/** Admin API version the documents below are written and tested against. */
export const SHOPIFY_API_VERSION = "2026-10";

/** The access scopes the app requests. */
export const SHOPIFY_SCOPES = [
  "read_orders",
  "write_merchant_managed_fulfillment_orders",
  "write_fulfillments",
] as const;

export const orderGid = (id: string | number): string =>
  String(id).startsWith("gid://") ? String(id) : `gid://shopify/Order/${id}`;

export const legacyId = (gid: string): string => gid.slice(gid.lastIndexOf("/") + 1);

// Only the fields shipping needs. Name, address and phone are protected
// customer data; email is deliberately not requested.
export const ORDER_QUERY = `#graphql
  query IShipOrder($id: ID!) {
    order(id: $id) {
      id
      legacyResourceId
      name
      createdAt
      cancelledAt
      requiresShipping
      displayFinancialStatus
      displayFulfillmentStatus
      paymentGatewayNames
      totalWeight
      totalOutstandingSet { shopMoney { amount currencyCode } }
      shippingAddress {
        name
        phone
        address1
        address2
        city
        province
        provinceCode
        zip
        countryCodeV2
      }
      lineItems(first: 100) {
        nodes {
          name
          currentQuantity
          requiresShipping
          originalUnitPriceSet { shopMoney { amount currencyCode } }
        }
      }
    }
  }
`;

/** Recent orders that still need shipping, for importing into the queue. */
export const UNFULFILLED_ORDERS_QUERY = `#graphql
  query IShipUnfulfilledOrders($first: Int!, $query: String!) {
    orders(first: $first, sortKey: CREATED_AT, reverse: true, query: $query) {
      nodes {
        id
        legacyResourceId
        name
        createdAt
      }
    }
  }
`;

/** Search string for UNFULFILLED_ORDERS_QUERY. */
export const UNFULFILLED_SEARCH = "fulfillment_status:unfulfilled AND status:open";

export const FULFILLMENT_ORDERS_QUERY = `#graphql
  query IShipFulfillmentOrders($id: ID!) {
    order(id: $id) {
      fulfillmentOrders(first: 20) {
        nodes {
          id
          status
          supportedActions { action }
        }
      }
    }
  }
`;

export const FULFILLMENT_CREATE = `#graphql
  mutation IShipFulfillmentCreate($fulfillment: FulfillmentInput!) {
    fulfillmentCreate(fulfillment: $fulfillment) {
      fulfillment { id status }
      userErrors { field message }
    }
  }
`;

export const FULFILLMENT_EVENT_CREATE = `#graphql
  mutation IShipFulfillmentEvent($event: FulfillmentEventInput!) {
    fulfillmentEventCreate(fulfillmentEvent: $event) {
      fulfillmentEvent { id status }
      userErrors { field message }
    }
  }
`;

export const FULFILLMENT_CANCEL = `#graphql
  mutation IShipFulfillmentCancel($id: ID!) {
    fulfillmentCancel(id: $id) {
      fulfillment { id status }
      userErrors { field message }
    }
  }
`;

export const ALL_DOCUMENTS = [
  ORDER_QUERY,
  UNFULFILLED_ORDERS_QUERY,
  FULFILLMENT_ORDERS_QUERY,
  FULFILLMENT_CREATE,
  FULFILLMENT_EVENT_CREATE,
  FULFILLMENT_CANCEL,
];

interface Money {
  shopMoney: { amount: string; currencyCode: string };
}

/** The `order` field of ORDER_QUERY's response. */
export interface ShopifyOrderNode {
  id: string;
  legacyResourceId: string;
  name: string;
  createdAt: string;
  cancelledAt: string | null;
  requiresShipping: boolean;
  displayFinancialStatus: string | null;
  displayFulfillmentStatus: string;
  paymentGatewayNames: string[];
  totalWeight: string | number | null;
  totalOutstandingSet: Money;
  shippingAddress: {
    name: string | null;
    phone: string | null;
    address1: string | null;
    address2: string | null;
    city: string | null;
    province: string | null;
    provinceCode: string | null;
    zip: string | null;
    countryCodeV2: string | null;
  } | null;
  lineItems: {
    nodes: {
      name: string;
      currentQuantity: number;
      requiresShipping: boolean;
      originalUnitPriceSet: Money;
    }[];
  };
}

/** Payment gateway names that mean "collect cash on delivery". */
export const DEFAULT_COD_GATEWAYS = ["Cash on Delivery (COD)", "COD", "เก็บเงินปลายทาง"];

const matchesGateway = (names: readonly string[], gateways: readonly string[]): boolean => {
  const wanted = new Set(gateways.map((g) => g.trim().toLowerCase()).filter(Boolean));
  return names.some((name) => wanted.has(name.trim().toLowerCase()));
};

/** Whether an order can be shipped now, and if not, why. */
export type Readiness =
  | { ready: true; cod: boolean }
  | { ready: false; reason: "cancelled" | "no_shipping" | "fulfilled" | "awaiting_payment" };

/**
 * Decides whether an order is ready to ship. Paid orders are; so are unpaid
 * orders paid by a cash-on-delivery gateway, since the courier collects.
 */
export function readiness(order: ShopifyOrderNode, codGateways: readonly string[] = DEFAULT_COD_GATEWAYS): Readiness {
  if (order.cancelledAt) return { ready: false, reason: "cancelled" };
  if (!order.requiresShipping || !order.shippingAddress) return { ready: false, reason: "no_shipping" };
  if (order.displayFulfillmentStatus === "FULFILLED") return { ready: false, reason: "fulfilled" };

  const cod = matchesGateway(order.paymentGatewayNames, codGateways) && Number(order.totalOutstandingSet.shopMoney.amount) > 0;
  if (cod) return { ready: true, cod: true };

  const paid = ["PAID", "PARTIALLY_REFUNDED"].includes(order.displayFinancialStatus ?? "");
  return paid ? { ready: true, cod: false } : { ready: false, reason: "awaiting_payment" };
}

/** The neutral order for a Shopify order. `cod` comes from readiness(). */
export function shopOrderFromShopify(shop: string, order: ShopifyOrderNode, cod: boolean): ShopOrder {
  const address = order.shippingAddress;
  const outstanding = order.totalOutstandingSet.shopMoney;

  return {
    platform: "shopify",
    shop,
    orderId: order.legacyResourceId,
    orderName: order.name,
    recipient: {
      name: address?.name,
      phone: address?.phone,
      line1: address?.address1,
      line2: address?.address2,
      city: address?.city,
      province: address?.province,
      provinceCode: address?.provinceCode,
      zip: address?.zip,
      countryCode: address?.countryCodeV2,
    },
    items: order.lineItems.nodes
      .filter((item) => item.requiresShipping && item.currentQuantity > 0)
      .map((item) => ({
        name: item.name,
        quantity: item.currentQuantity,
        unitPrice: Number(item.originalUnitPriceSet.shopMoney.amount),
        grams: 0,
      })),
    codAmount: cod ? Number(outstanding.amount) : 0,
    currency: outstanding.currencyCode,
    totalGrams: Number(order.totalWeight ?? 0) || 0,
  };
}

interface FulfillmentOrderNode {
  id: string;
  status: string;
  supportedActions: { action: string }[];
}

/** Fulfillment orders this app can fulfil: open, and allowing a fulfillment to be created. */
export function fulfillableOrderIds(nodes: readonly FulfillmentOrderNode[]): string[] {
  return nodes
    .filter((node) => ["OPEN", "IN_PROGRESS"].includes(node.status))
    .filter((node) => node.supportedActions.some((a) => a.action === "CREATE_FULFILLMENT"))
    .map((node) => node.id);
}

/** Variables for FULFILLMENT_CREATE. */
export function fulfillmentInput(
  fulfillmentOrderIds: readonly string[],
  tracking: { company: string; number: string; url?: string },
  notifyCustomer: boolean,
) {
  return {
    fulfillment: {
      lineItemsByFulfillmentOrder: fulfillmentOrderIds.map((fulfillmentOrderId) => ({ fulfillmentOrderId })),
      notifyCustomer,
      trackingInfo: {
        company: tracking.company,
        number: tracking.number,
        ...(tracking.url ? { url: tracking.url } : {}),
      },
    },
  };
}

const EVENT_STATUS: Partial<Record<Progress, string>> = {
  picked_up: "CARRIER_PICKED_UP",
  in_transit: "IN_TRANSIT",
  delivered: "DELIVERED",
  problem: "DELAYED",
  returning: "FAILURE",
  returned: "FAILURE",
};

/** The FulfillmentEventStatus for a parcel's progress, or undefined when Shopify has no event for it. */
export const shopifyEventStatus = (progress: Progress): string | undefined => EVENT_STATUS[progress];

/** Fills `{tracking}` in a merchant's tracking-page template. */
export function trackingUrl(template: string | null | undefined, trackingNumber: string): string | undefined {
  if (!template || !template.includes("{tracking}")) return undefined;
  return template.replaceAll("{tracking}", encodeURIComponent(trackingNumber));
}
