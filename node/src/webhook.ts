import { TransportError } from "./errors.js";

/**
 * A parcel status callback from iShip.
 *
 * SECURITY: iShip does not sign webhook requests, so anyone who learns your
 * callback URL can post a fake event. Treat a webhook as a signal to call
 * getOrder() for the authoritative status, not as proof by itself.
 */
export interface WebhookEvent {
  trackingNumber: string;
  refCode: string;
  courierCode: string;
  /** Courier status slug, e.g. "delivered". */
  status: string;
  statusDescription: string;
  price?: number;
  /** Weight the courier measured, in kilograms. */
  weightKg?: number;
  overSize: boolean;
  overWeight: boolean;
  occurredAt?: Date;
  raw: Record<string, unknown>;
}

/** Decodes a status callback body. */
export function parseWebhook(body: string | Record<string, unknown>): WebhookEvent {
  let data: unknown = body;
  if (typeof body === "string") {
    try {
      data = JSON.parse(body);
    } catch {
      throw new TransportError("webhook payload ไม่ใช่ JSON");
    }
  }

  if (data === null || typeof data !== "object" || !("tracking" in data)) {
    throw new TransportError("webhook payload ไม่มีเลขพัสดุ");
  }

  const raw = data as Record<string, unknown>;
  return {
    trackingNumber: String(raw.tracking),
    refCode: String(raw.ref_code ?? ""),
    courierCode: String(raw.courier_code ?? ""),
    status: String(raw.status ?? ""),
    statusDescription: String(raw.status_desc ?? ""),
    price: raw.price === undefined ? undefined : Number(raw.price),
    weightKg: raw.weight === undefined ? undefined : Number(raw.weight),
    overSize: Boolean(raw.is_over_size),
    overWeight: Boolean(raw.is_over_weight),
    occurredAt: raw.timestamp === undefined ? undefined : new Date(Number(raw.timestamp) * 1000),
    raw,
  };
}
