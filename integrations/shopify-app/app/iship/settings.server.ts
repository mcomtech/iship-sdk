import { randomBytes } from "node:crypto";

import { IShipClient, PRODUCTION, UAT } from "@iship/sdk";
import type { ShipperSettings } from "@iship/connect";
import { SecretBox } from "@iship/connect/secret";
import type { ShopSettings } from "@prisma/client";

import db from "../db.server";

let box: SecretBox | undefined;

/** Seals and opens iShip tokens. Throws when ISHIP_ENCRYPTION_KEY is not set. */
export function secretBox(): SecretBox {
  if (!box) {
    const key = process.env.ISHIP_ENCRYPTION_KEY;
    if (!key) {
      throw new Error(
        "ISHIP_ENCRYPTION_KEY is not set. Generate one with: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"",
      );
    }
    box = new SecretBox(key);
  }
  return box;
}

/** The shop's settings, creating the row with defaults on first use. */
export async function getSettings(shop: string): Promise<ShopSettings> {
  const existing = await db.shopSettings.findUnique({ where: { shop } });
  if (existing) return existing;
  return db.shopSettings.upsert({
    where: { shop },
    create: { shop, callbackSecret: randomBytes(24).toString("hex") },
    update: {},
  });
}

export function hasToken(settings: ShopSettings): boolean {
  return Boolean(settings.ishipToken);
}

/** An iShip client authenticated as this shop's iShip account, or undefined without a token. */
export function ishipClient(settings: ShopSettings): IShipClient | undefined {
  if (!settings.ishipToken) return undefined;
  return new IShipClient({
    token: secretBox().open(settings.ishipToken),
    baseUrl: settings.environment === "uat" ? UAT : PRODUCTION,
  });
}

/** An unauthenticated client for the shop's environment, for public endpoints like labels. */
export function publicClient(settings: Pick<ShopSettings, "environment">): IShipClient {
  return new IShipClient({ baseUrl: settings.environment === "uat" ? UAT : PRODUCTION });
}

export function shipperSettings(settings: ShopSettings): ShipperSettings {
  return {
    origin: {
      name: settings.originName,
      phone: settings.originPhone,
      address: settings.originAddress,
      subdistrict: settings.originSubdistrict,
      district: settings.originDistrict,
      province: settings.originProvince,
      zipcode: settings.originZipcode,
    },
    courierCode: settings.courierCode,
    box: { widthCm: settings.boxWidthCm, lengthCm: settings.boxLengthCm, heightCm: settings.boxHeightCm },
    categoryId: settings.categoryId,
    defaultItemGrams: settings.defaultItemGrams,
    platformName: "iship-shopify-app",
  };
}

export const codGateways = (settings: ShopSettings): string[] =>
  settings.codGateways
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

/** The URL iShip should post status callbacks to for this shop. */
export function callbackUrl(settings: ShopSettings): string {
  const base = (process.env.SHOPIFY_APP_URL ?? "").replace(/\/+$/, "");
  return `${base}/webhooks/iship/${settings.callbackSecret}`;
}

/** True when every field the sender address needs is filled in. */
export function originComplete(settings: ShopSettings): boolean {
  return Boolean(
    settings.originName &&
      settings.originPhone &&
      settings.originAddress &&
      settings.originSubdistrict &&
      settings.originDistrict &&
      settings.originProvince &&
      /^\d{5}$/.test(settings.originZipcode),
  );
}
