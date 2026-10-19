import type { ActionFunctionArgs } from "react-router";

import { authenticate } from "../shopify.server";
import { enqueueOrder } from "../iship/queue.server";

// Only records the order; the worker reads it through GraphQL and decides what to do.
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, payload } = await authenticate.webhook(request);
  const order = payload as { id?: number | string; name?: string };
  if (order.id !== undefined) await enqueueOrder(shop, String(order.id), String(order.name ?? order.id));
  return new Response();
};
