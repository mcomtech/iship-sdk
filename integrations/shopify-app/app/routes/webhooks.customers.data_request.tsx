import type { ActionFunctionArgs } from "react-router";

import db from "../db.server";
import { authenticate } from "../shopify.server";

// Mandatory compliance webhook. The only customer data this app keeps is
// address corrections a merchant typed for an order, so the request is
// recorded for the operator to answer from the Shipment rows it names.
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload } = await authenticate.webhook(request);
  const body = payload as { customer?: { id?: number }; orders_requested?: number[] };
  await db.complianceRequest.create({
    data: {
      shop,
      topic,
      reference: JSON.stringify({ customerId: body.customer?.id ?? null, orders: body.orders_requested ?? [] }),
    },
  });
  return new Response();
};
