import { useEffect } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Form, useActionData, useLoaderData, useNavigation } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { isFinal, progressOf } from "@iship/connect";

import db from "../db.server";
import { authenticate } from "../shopify.server";
import { localeFrom, translator, useT, type MessageKey } from "../iship/i18n";
import { createNow, importUnfulfilled } from "../iship/queue.server";
import { getSettings, hasToken, originComplete, publicClient } from "../iship/settings.server";
import { State } from "../iship/states";

const VIEWS = {
  attention: [State.NeedsReview],
  ready: [State.Ready, State.New, State.Queued, State.AwaitingPayment],
  shipped: [State.Created, State.Fulfilled],
  all: undefined,
} as const;
type View = keyof typeof VIEWS;

/** Rows the merchant can tick to create their shipments. */
const SELECTABLE: State[] = [State.Ready, State.NeedsReview];
/** Rows whose parcel exists at iShip. */
const LABELLED: State[] = [State.Created, State.Fulfilled];

const TONE: Record<string, "critical" | "warning" | "success" | "info" | "neutral"> = {
  [State.NeedsReview]: "critical",
  [State.Ready]: "info",
  [State.AwaitingPayment]: "warning",
  [State.Created]: "success",
  [State.Fulfilled]: "success",
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const url = new URL(request.url);
  const view = (url.searchParams.get("view") as View) in VIEWS ? (url.searchParams.get("view") as View) : "all";

  const settings = await getSettings(shop);
  const states = VIEWS[view];
  const rows = await db.shipment.findMany({
    where: { shop, ...(states ? { state: { in: [...states] } } : {}) },
    orderBy: { updatedAt: "desc" },
    take: 100,
  });
  const counts = await db.shipment.groupBy({ by: ["state"], where: { shop }, _count: true });

  // Labels only for parcels still on their way: not cancelled, not delivered.
  const tracking = rows
    .filter((r) => r.trackingNumber && LABELLED.includes(r.state as State) && !isFinal(progressOf(r.ishipStatus)))
    .map((r) => r.trackingNumber!);

  return {
    view,
    locale: localeFrom(request),
    setupDone: hasToken(settings) && originComplete(settings),
    autoCreate: settings.autoCreate,
    labelUrl: tracking.length ? publicClient(settings).labelUrl(tracking.slice(0, 50)) : null,
    counts: Object.fromEntries(counts.map((c) => [c.state, c._count])) as Record<string, number>,
    rows: rows.map((r) => ({
      id: r.id,
      orderName: r.orderName,
      state: r.state,
      progress: r.progress,
      trackingNumber: r.trackingNumber,
      error: r.error,
      orderCancelled: r.orderCancelled,
      updatedAt: r.updatedAt.toISOString(),
    })),
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const t = translator(localeFrom(request));
  const form = await request.formData();
  const intent = form.get("intent");

  if (intent === "import") {
    const count = await importUnfulfilled(admin, session.shop);
    return { message: t("shipments.imported", { count }) };
  }
  if (intent === "create") {
    const ids = form.getAll("ids").map(String).filter(Boolean);
    const count = await createNow(session.shop, ids);
    return { message: t("shipments.created", { count }) };
  }
  return null;
};

export default function Shipments() {
  const { view, rows, counts, setupDone, autoCreate, labelUrl, locale } = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>();
  const navigation = useNavigation();
  const shopify = useAppBridge();
  const t = useT();

  useEffect(() => {
    if (result?.message) shopify.toast.show(result.message);
  }, [result, shopify]);

  const busy = navigation.state !== "idle";
  const dateFormat = new Intl.DateTimeFormat(locale === "th" ? "th-TH" : "en-GB", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "Asia/Bangkok",
  });
  const readyCount = counts[State.Ready] ?? 0;
  const attentionCount = counts[State.NeedsReview] ?? 0;
  const views: [View, MessageKey, number | undefined][] = [
    ["all", "shipments.filter.all", undefined],
    ["attention", "shipments.filter.attention", attentionCount],
    ["ready", "shipments.filter.ready", readyCount],
    ["shipped", "shipments.filter.shipped", undefined],
  ];

  return (
    <s-page heading={t("shipments.heading")}>
      <Form method="post" slot="primary-action">
        <input type="hidden" name="intent" value="import" />
        <s-button type="submit" {...(busy ? { loading: true } : {})}>
          {t("shipments.import")}
        </s-button>
      </Form>

      {!setupDone && (
        <s-banner tone="warning">
          {t("shipments.setup")} <s-link href="/app/settings">{t("shipments.setupLink")}</s-link>
        </s-banner>
      )}

      <s-section>
        <s-stack direction="inline" gap="small-200">
          {views.map(([key, label, count]) => (
            <s-button key={key} href={`/app?view=${key}`} variant={key === view ? "primary" : "secondary"}>
              {t(label)}
              {count ? ` (${count})` : ""}
            </s-button>
          ))}
        </s-stack>
      </s-section>

      <s-section>
        {!autoCreate && readyCount > 0 && <s-paragraph>{t("shipments.manualHint")}</s-paragraph>}

        {rows.length === 0 ? (
          <s-paragraph>{t("shipments.empty")}</s-paragraph>
        ) : (
          <Form method="post">
            <input type="hidden" name="intent" value="create" />
            <s-stack direction="block" gap="base">
              <s-table>
                <s-table-header-row>
                  <s-table-header>{" "}</s-table-header>
                  <s-table-header>{t("shipments.col.order")}</s-table-header>
                  <s-table-header>{t("shipments.col.state")}</s-table-header>
                  <s-table-header>{t("shipments.col.tracking")}</s-table-header>
                  <s-table-header>{t("shipments.col.updated")}</s-table-header>
                </s-table-header-row>
                <s-table-body>
                  {rows.map((row) => (
                    <s-table-row key={row.id}>
                      <s-table-cell>
                        {SELECTABLE.includes(row.state as State) && (
                          <input
                            type="checkbox"
                            name="ids"
                            value={row.id}
                            aria-label={t("shipments.select", { order: row.orderName })}
                          />
                        )}
                      </s-table-cell>
                      <s-table-cell>
                        <s-link href={`/app/shipments/${row.id}`}>{row.orderName}</s-link>
                      </s-table-cell>
                      <s-table-cell>
                        <s-badge tone={TONE[row.state] ?? "neutral"}>{t(`state.${row.state}` as MessageKey)}</s-badge>
                        {row.progress && row.state === State.Fulfilled ? (
                          <s-text> {t(`progress.${row.progress}` as MessageKey)}</s-text>
                        ) : null}
                        {row.orderCancelled ? <s-badge tone="critical">{t("state.cancelled")}</s-badge> : null}
                      </s-table-cell>
                      <s-table-cell>{row.trackingNumber ?? "–"}</s-table-cell>
                      <s-table-cell>{dateFormat.format(new Date(row.updatedAt))}</s-table-cell>
                    </s-table-row>
                  ))}
                </s-table-body>
              </s-table>
              <s-stack direction="inline" gap="base">
                {(readyCount > 0 || attentionCount > 0) && (
                  <s-button type="submit" variant="primary" {...(busy || !setupDone ? { disabled: true } : {})}>
                    {t("shipments.createSelected")}
                  </s-button>
                )}
                {labelUrl && (
                  <s-button href={labelUrl} target="_blank">
                    {t("shipments.printLabels")}
                  </s-button>
                )}
              </s-stack>
            </s-stack>
          </Form>
        )}
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
