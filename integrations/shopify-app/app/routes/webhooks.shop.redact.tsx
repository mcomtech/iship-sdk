import type { ActionFunctionArgs } from "react-router";

import db from "../db.server";
import { authenticate } from "../shopify.server";

// Mandatory compliance webhook, sent 48 hours after uninstall: delete everything about the shop.
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop } = await authenticate.webhook(request);
  await db.$transaction([
    db.shipment.deleteMany({ where: { shop } }),
    db.complianceRequest.deleteMany({ where: { shop } }),
    db.shopSettings.deleteMany({ where: { shop } }),
    db.session.deleteMany({ where: { shop } }),
  ]);
  return new Response();
};
