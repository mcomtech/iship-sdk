import type { ActionFunctionArgs } from "react-router";

import db from "../db.server";
import { authenticate } from "../shopify.server";

// Mandatory compliance webhook: erase the customer's data from the named orders.
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, payload } = await authenticate.webhook(request);
  const orders = ((payload as { orders_to_redact?: number[] }).orders_to_redact ?? []).map(String);
  if (orders.length) {
    await db.shipment.updateMany({
      where: { shop, orderId: { in: orders } },
      data: { overrides: null },
    });
  }
  return new Response();
};
