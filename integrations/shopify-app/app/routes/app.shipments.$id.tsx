import { useEffect } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Form, useActionData, useLoaderData, useNavigation } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import type { Address } from "@iship/sdk";
import { THAI_PROVINCES, applyOverrides, parseThaiAddress, shopify } from "@iship/connect";

import db from "../db.server";
import { authenticate } from "../shopify.server";
import { gql } from "../iship/admin.server";
import { localeFrom, translator, useT, type MessageKey } from "../iship/i18n";
import { describeProblem, parseProblems } from "../iship/problems";
import { createNow, ishipOrderId, reship } from "../iship/queue.server";
import { getSettings, ishipClient, publicClient } from "../iship/settings.server";
import { PRE_SHIPMENT_STATES, State } from "../iship/states";
import { kick } from "../iship/worker.server";

const FIELDS = ["name", "phone", "address", "subdistrict", "district", "province", "zipcode"] as const;
const CREATABLE: State[] = [State.Ready, State.NeedsReview, State.Created];
const CANCELLABLE: State[] = [State.Created, State.Fulfilled];

async function load(request: Request, id: string | undefined) {
  const context = await authenticate.admin(request);
  const shipment = await db.shipment.findFirst({ where: { id, shop: context.session.shop } });
  if (!shipment) throw new Response("Not found", { status: 404 });
  return { ...context, shipment };
}

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { admin, session, shipment } = await load(request, params.id);
  const settings = await getSettings(session.shop);

  const { order } = await gql<{ order: shopify.ShopifyOrderNode | null }>(admin, shopify.ORDER_QUERY, {
    id: shopify.orderGid(shipment.orderId),
  });
  const parsed = order ? parseThaiAddress(shopify.shopOrderFromShopify(session.shop, order, false).recipient) : null;
  const overrides = shipment.overrides ? (JSON.parse(shipment.overrides) as Partial<Address>) : {};
  const current = parsed ? applyOverrides(parsed, overrides).address : null;

  return {
    shipment: {
      id: shipment.id,
      orderId: shipment.orderId,
      orderName: shipment.orderName,
      state: shipment.state,
      progress: shipment.progress,
      trackingNumber: shipment.trackingNumber,
      courierCode: shipment.courierCode,
      error: shipment.error,
      orderCancelled: shipment.orderCancelled,
      problems: parseProblems(shipment.problems),
      warnings: parseProblems(shipment.warnings),
      ishipOrderId: ishipOrderId(shipment),
    },
    address: current,
    editable: (PRE_SHIPMENT_STATES as string[]).includes(shipment.state),
    labelUrl: shipment.trackingNumber ? publicClient(settings).labelUrl([shipment.trackingNumber]) : null,
  };
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { admin, session, shipment } = await load(request, params.id);
  const t = translator(localeFrom(request));
  const form = await request.formData();
  const intent = String(form.get("intent"));
  const shop = session.shop;
  const editable = (PRE_SHIPMENT_STATES as string[]).includes(shipment.state);

  switch (intent) {
    case "save": {
      if (!editable) return null;
      // Keep only what differs from the order, so later edits in Shopify still apply.
      const { order } = await gql<{ order: shopify.ShopifyOrderNode | null }>(admin, shopify.ORDER_QUERY, {
        id: shopify.orderGid(shipment.orderId),
      });
      const parsed = order ? parseThaiAddress(shopify.shopOrderFromShopify(shop, order, false).recipient).address : null;
      const overrides: Partial<Address> = {};
      for (const field of FIELDS) {
        const value = String(form.get(field) ?? "").trim();
        if (value && value !== parsed?.[field]) overrides[field] = value;
      }
      await db.shipment.update({
        where: { id: shipment.id },
        data: {
          overrides: Object.keys(overrides).length ? JSON.stringify(overrides) : null,
          state: shipment.state === State.Queued ? State.Queued : State.New,
          runAfter: new Date(),
        },
      });
      kick();
      return { message: t("detail.saved") };
    }

    case "create":
      if (shipment.state === State.Created) {
        await db.shipment.update({ where: { id: shipment.id }, data: { runAfter: new Date() } });
        kick();
      } else {
        await createNow(shop, [shipment.id]);
      }
      return { message: t("shipments.created", { count: 1 }) };

    case "drop":
      if (!editable) return null;
      await db.shipment.update({ where: { id: shipment.id }, data: { state: State.Skipped } });
      return { message: t("detail.dropped") };

    case "cancel": {
      if (!shipment.trackingNumber) return null;
      const client = ishipClient(await getSettings(shop));
      if (!client) return { error: t("shipments.setup") };
      try {
        await client.cancelOrder(shipment.trackingNumber);
        if (shipment.fulfillmentId) {
          await gql(admin, shopify.FULFILLMENT_CANCEL, { id: shipment.fulfillmentId });
        }
      } catch (error) {
        return { error: error instanceof Error ? error.message : String(error) };
      }
      await db.shipment.update({
        where: { id: shipment.id },
        data: { state: State.Cancelled, progress: "cancelled", syncAfter: null, fulfillmentId: null },
      });
      return { message: t("detail.cancelled") };
    }

    case "reship":
      if (shipment.state !== State.Cancelled || shipment.orderCancelled) return null;
      await reship(shipment);
      return { message: t("shipments.created", { count: 1 }) };
  }
  return null;
};

function Intent({ value, label, tone, variant }: { value: string; label: string; tone?: "critical"; variant?: "primary" }) {
  const navigation = useNavigation();
  return (
    <Form method="post">
      <input type="hidden" name="intent" value={value} />
      <s-button
        type="submit"
        {...(tone ? { tone } : {})}
        {...(variant ? { variant } : {})}
        {...(navigation.state !== "idle" ? { loading: true } : {})}
      >
        {label}
      </s-button>
    </Form>
  );
}

export default function ShipmentDetail() {
  const { shipment, address, editable, labelUrl } = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>();
  const shopifyBridge = useAppBridge();
  const t = useT();

  useEffect(() => {
    if (result && "message" in result && result.message) shopifyBridge.toast.show(result.message);
  }, [result, shopifyBridge]);

  const state = shipment.state as State;
  const canCreate = CREATABLE.includes(state);
  const canCancel = Boolean(shipment.trackingNumber) && CANCELLABLE.includes(state);
  const canReship = state === State.Cancelled && Boolean(shipment.trackingNumber) && !shipment.orderCancelled;

  return (
    <s-page heading={shipment.orderName}>
      <s-link slot="breadcrumb-actions" href="/app">
        {t("detail.back")}
      </s-link>

      <s-stack direction="block" gap="base">
        {result && "error" in result && result.error && <s-banner tone="critical">{result.error}</s-banner>}
        {shipment.orderCancelled && <s-banner tone="warning">{t("detail.orderCancelled")}</s-banner>}

        <s-section>
          <s-stack direction="block" gap="small-200">
            <s-paragraph>
              <s-badge>{t(`state.${shipment.state}` as MessageKey)}</s-badge>
              {shipment.progress && (
                <s-text>
                  {" "}
                  {t("detail.progress")}: {t(`progress.${shipment.progress}` as MessageKey)}
                </s-text>
              )}
            </s-paragraph>
            <s-paragraph>
              {t("detail.ishipOrderId")}: {shipment.ishipOrderId}
            </s-paragraph>
            {shipment.trackingNumber && (
              <s-paragraph>
                {t("shipments.col.tracking")}: {shipment.trackingNumber}
                {shipment.courierCode ? ` · ${t("detail.courier")}: ${shipment.courierCode}` : ""}
              </s-paragraph>
            )}
          </s-stack>
        </s-section>

        {shipment.problems.length > 0 && (
          <s-section heading={t("detail.problems")}>
            <s-unordered-list>
              {shipment.problems.map((problem) => (
                <s-list-item key={`${problem.field}:${problem.code}`}>{describeProblem(t, problem)}</s-list-item>
              ))}
            </s-unordered-list>
          </s-section>
        )}

        {shipment.warnings.length > 0 && (
          <s-section heading={t("detail.warnings")}>
            <s-unordered-list>
              {shipment.warnings.map((problem) => (
                <s-list-item key={`${problem.field}:${problem.code}`}>{describeProblem(t, problem)}</s-list-item>
              ))}
            </s-unordered-list>
          </s-section>
        )}

        {shipment.error && (
          <s-section heading={t("detail.error")}>
            <s-paragraph>{shipment.error}</s-paragraph>
          </s-section>
        )}

        {address && editable && (
          <s-section heading={t("detail.recipient")}>
            <Form method="post">
              <input type="hidden" name="intent" value="save" />
              <s-stack direction="block" gap="base">
                <s-paragraph>{t("detail.recipientHelp")}</s-paragraph>
                {FIELDS.filter((f) => f !== "province").map((field) => (
                  <s-text-field key={field} name={field} label={t(`field.${field}`)} value={address[field]} />
                ))}
                <s-select name="province" label={t("field.province")} value={address.province}>
                  <s-option value="">–</s-option>
                  {THAI_PROVINCES.map((province) => (
                    <s-option key={province} value={province}>
                      {province}
                    </s-option>
                  ))}
                </s-select>
                <s-button type="submit">{t("detail.save")}</s-button>
              </s-stack>
            </Form>
          </s-section>
        )}

        <s-section>
          <s-stack direction="inline" gap="base">
            {canCreate && (
              <Intent
                value="create"
                variant="primary"
                label={state === State.Created ? t("detail.retry") : t("detail.createNow")}
              />
            )}
            {labelUrl && (
              <s-button href={labelUrl} target="_blank">
                {t("detail.label")}
              </s-button>
            )}
            {canCancel && <Intent value="cancel" tone="critical" label={t("detail.cancelShipment")} />}
            {canReship && <Intent value="reship" label={t("detail.reship")} />}
            {editable && <Intent value="drop" label={t("detail.drop")} />}
          </s-stack>
        </s-section>
      </s-stack>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
