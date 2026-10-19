import type { ActionFunctionArgs } from "react-router";
import { parseWebhook } from "@iship/sdk";

import db from "../db.server";
import { kick } from "../iship/worker.server";

/**
 * Status callbacks from iShip.
 *
 * iShip does not sign them, so the URL carries a per-shop secret and the body
 * is only a hint: it marks the parcel for an immediate status check, and the
 * worker reads the real status from iShip's API before telling Shopify.
 */
export const action = async ({ request, params }: ActionFunctionArgs) => {
  const settings = await db.shopSettings.findUnique({ where: { callbackSecret: params.secret ?? "" } });
  if (!settings) return new Response(null, { status: 404 });

  let trackingNumber: string;
  try {
    trackingNumber = parseWebhook(await request.text()).trackingNumber;
  } catch {
    return new Response(null, { status: 400 });
  }

  await db.shipment.updateMany({
    where: { shop: settings.shop, trackingNumber, state: "fulfilled" },
    data: { syncAfter: new Date() },
  });
  kick();
  return new Response();
};
