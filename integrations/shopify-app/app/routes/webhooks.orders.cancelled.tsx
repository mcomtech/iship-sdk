import type { ActionFunctionArgs } from "react-router";

import { authenticate } from "../shopify.server";
import { markOrderCancelled } from "../iship/queue.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, payload } = await authenticate.webhook(request);
  const order = payload as { id?: number | string };
  if (order.id !== undefined) await markOrderCancelled(shop, String(order.id));
  return new Response();
};
