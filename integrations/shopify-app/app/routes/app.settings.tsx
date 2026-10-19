import { useEffect } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Form, useActionData, useLoaderData, useNavigation } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AUTO_COURIER, IShipClient, PRODUCTION, UAT } from "@iship/sdk";
import { THAI_PROVINCES, thaiProvince } from "@iship/connect";

import db from "../db.server";
import { authenticate } from "../shopify.server";
import { CATEGORY_IDS, localeFrom, translator, useT, type MessageKey } from "../iship/i18n";
import { wakeShop } from "../iship/queue.server";
import { callbackUrl, getSettings, ishipClient, secretBox } from "../iship/settings.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const settings = await getSettings(session.shop);

  let couriers: { code: string; name: string }[] = [];
  let balance: number | null = null;
  let connectionError: string | null = null;
  try {
    const client = ishipClient(settings);
    if (client) {
      [couriers, { balance }] = await Promise.all([client.couriers(), client.balance()]);
    }
  } catch (error) {
    connectionError = error instanceof Error ? error.message : String(error);
  }

  // Never send the sealed token or the callback secret field to the browser.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { ishipToken, callbackSecret, ...rest } = settings;
  return {
    settings: rest,
    tokenSaved: Boolean(ishipToken),
    callbackUrl: callbackUrl(settings),
    couriers,
    balance,
    connectionError,
    encryptionReady: Boolean(process.env.ISHIP_ENCRYPTION_KEY),
  };
};

const text = (form: FormData, name: string): string => String(form.get(name) ?? "").trim();

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const t = translator(localeFrom(request));
  const form = await request.formData();

  const numbers: [string, MessageKey][] = [
    ["boxWidthCm", "settings.boxWidth"],
    ["boxLengthCm", "settings.boxLength"],
    ["boxHeightCm", "settings.boxHeight"],
    ["defaultItemGrams", "settings.itemGrams"],
  ];
  const parsed: Record<string, number> = {};
  for (const [name, label] of numbers) {
    const value = Number(text(form, name));
    if (!Number.isFinite(value) || value <= 0) return { ok: false, error: t("settings.invalidNumber", { field: t(label) }) };
    parsed[name] = value;
  }

  const environment = text(form, "environment") === "uat" ? "uat" : "production";
  const data = {
    environment,
    originName: text(form, "originName"),
    originPhone: text(form, "originPhone").replace(/\D/g, ""),
    originAddress: text(form, "originAddress"),
    originSubdistrict: text(form, "originSubdistrict"),
    originDistrict: text(form, "originDistrict"),
    originProvince: thaiProvince(text(form, "originProvince")) ?? text(form, "originProvince"),
    originZipcode: text(form, "originZipcode"),
    courierCode: text(form, "courierCode") || AUTO_COURIER,
    boxWidthCm: parsed.boxWidthCm,
    boxLengthCm: parsed.boxLengthCm,
    boxHeightCm: parsed.boxHeightCm,
    defaultItemGrams: Math.round(parsed.defaultItemGrams),
    categoryId: Number(text(form, "categoryId")) || 99,
    autoCreate: form.get("autoCreate") !== null,
    notifyCustomer: form.get("notifyCustomer") !== null,
    codGateways: text(form, "codGateways"),
    trackingUrlTemplate: text(form, "trackingUrlTemplate"),
  };

  const token = text(form, "token");
  let ishipToken: string | undefined;
  if (token) {
    if (!process.env.ISHIP_ENCRYPTION_KEY) return { ok: false, error: t("settings.encryptionMissing") };
    // Check the token works before replacing the saved one.
    try {
      await new IShipClient({ token, baseUrl: environment === "uat" ? UAT : PRODUCTION }).balance();
    } catch (error) {
      return { ok: false, error: t("settings.connectionFailed", { error: error instanceof Error ? error.message : String(error) }) };
    }
    ishipToken = secretBox().seal(token);
  }

  await getSettings(shop);
  await db.shopSettings.update({ where: { shop }, data: { ...data, ...(ishipToken ? { ishipToken } : {}) } });
  await wakeShop(shop);
  return { ok: true, error: null };
};

export default function Settings() {
  const { settings, tokenSaved, callbackUrl, couriers, balance, connectionError, encryptionReady } =
    useLoaderData<typeof loader>();
  const result = useActionData<typeof action>();
  const navigation = useNavigation();
  const shopify = useAppBridge();
  const t = useT();

  useEffect(() => {
    if (result?.ok) shopify.toast.show(t("settings.saved"));
  }, [result, shopify, t]);

  const checked = (on: boolean) => (on ? { checked: true } : {});

  return (
    <s-page heading={t("settings.heading")}>
      <Form method="post">
        <s-stack direction="block" gap="base">
          {result?.error && <s-banner tone="critical">{result.error}</s-banner>}
          {!encryptionReady && <s-banner tone="critical">{t("settings.encryptionMissing")}</s-banner>}

          <s-section heading={t("settings.account")}>
            <s-stack direction="block" gap="base">
              <s-password-field
                name="token"
                label={t("settings.token")}
                details={tokenSaved ? t("settings.tokenSaved") : t("settings.tokenHelp")}
                autocomplete="off"
              />
              {tokenSaved && <s-paragraph>{t("settings.tokenHelp")}</s-paragraph>}
              <s-select name="environment" label={t("settings.environment")} value={settings.environment}>
                <s-option value="production">{t("settings.production")}</s-option>
                <s-option value="uat">{t("settings.uat")}</s-option>
              </s-select>
              {balance !== null && <s-banner tone="success">{t("settings.balance", { balance })}</s-banner>}
              {connectionError && (
                <s-banner tone="critical">{t("settings.connectionFailed", { error: connectionError })}</s-banner>
              )}
            </s-stack>
          </s-section>

          <s-section heading={t("settings.origin")}>
            <s-stack direction="block" gap="base">
              <s-text-field name="originName" label={t("field.name")} value={settings.originName} />
              <s-text-field name="originPhone" label={t("field.phone")} value={settings.originPhone} />
              <s-text-field name="originAddress" label={t("field.address")} value={settings.originAddress} />
              <s-text-field name="originSubdistrict" label={t("field.subdistrict")} value={settings.originSubdistrict} />
              <s-text-field name="originDistrict" label={t("field.district")} value={settings.originDistrict} />
              <s-select name="originProvince" label={t("field.province")} value={settings.originProvince}>
                <s-option value="">–</s-option>
                {THAI_PROVINCES.map((province) => (
                  <s-option key={province} value={province}>
                    {province}
                  </s-option>
                ))}
              </s-select>
              <s-text-field name="originZipcode" label={t("field.zipcode")} value={settings.originZipcode} />
            </s-stack>
          </s-section>

          <s-section heading={t("settings.shipping")}>
            <s-stack direction="block" gap="base">
              <s-select name="courierCode" label={t("settings.courier")} value={settings.courierCode}>
                <s-option value={AUTO_COURIER}>{t("settings.autoCourier")}</s-option>
                {couriers.map((courier) => (
                  <s-option key={courier.code} value={courier.code}>
                    {courier.name}
                  </s-option>
                ))}
              </s-select>
              <s-number-field name="boxWidthCm" label={t("settings.boxWidth")} value={String(settings.boxWidthCm)} min={1} />
              <s-number-field name="boxLengthCm" label={t("settings.boxLength")} value={String(settings.boxLengthCm)} min={1} />
              <s-number-field name="boxHeightCm" label={t("settings.boxHeight")} value={String(settings.boxHeightCm)} min={1} />
              <s-number-field
                name="defaultItemGrams"
                label={t("settings.itemGrams")}
                value={String(settings.defaultItemGrams)}
                min={1}
              />
              <s-select name="categoryId" label={t("settings.category")} value={String(settings.categoryId)}>
                {CATEGORY_IDS.map((id) => (
                  <s-option key={id} value={String(id)}>
                    {t(`category.${id}` as MessageKey)}
                  </s-option>
                ))}
              </s-select>
            </s-stack>
          </s-section>

          <s-section heading={t("settings.automation")}>
            <s-stack direction="block" gap="base">
              <s-checkbox
                name="autoCreate"
                label={t("settings.autoCreate")}
                details={t("settings.autoCreateHelp")}
                {...checked(settings.autoCreate)}
              />
              <s-checkbox name="notifyCustomer" label={t("settings.notifyCustomer")} {...checked(settings.notifyCustomer)} />
              <s-text-area name="codGateways" label={t("settings.codGateways")} value={settings.codGateways} rows={3} />
              <s-url-field
                name="trackingUrlTemplate"
                label={t("settings.trackingTemplate")}
                value={settings.trackingUrlTemplate}
              />
            </s-stack>
          </s-section>

          <s-section heading={t("settings.callback")}>
            <s-stack direction="block" gap="base">
              <s-paragraph>{t("settings.callbackHelp")}</s-paragraph>
              <s-text-field label="Webhook URL" value={callbackUrl} readOnly />
            </s-stack>
          </s-section>

          <s-button type="submit" variant="primary" {...(navigation.state !== "idle" ? { loading: true } : {})}>
            {t("settings.save")}
          </s-button>
        </s-stack>
      </Form>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
