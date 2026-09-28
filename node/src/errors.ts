/** Base class for every error this SDK throws. */
export class IShipError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/**
 * iShip rejected the operation.
 *
 * The API answers HTTP 200 with `{"status": false, ...}` in that case, so this
 * error — not the status code — is how a failure surfaces. `code` is iShip's own
 * code, such as "1004" (not found) or "1013" (unknown courier).
 */
export class ApiError extends IShipError {
  constructor(
    message: string,
    readonly code: string,
    /** The whole response body, for codes this SDK does not model. */
    readonly payload: Record<string, unknown>,
  ) {
    super(message);
  }
}

/** The token is missing, wrong, or was replaced by a newer requestToken() call. */
export class AuthError extends IShipError {}

/** The request never produced a usable response: network failure, timeout, or a non-JSON body. */
export class TransportError extends IShipError {}

/** The arguments were rejected before any request was sent. */
export class ValidationError extends IShipError {}

const isSuccess = (status: unknown): boolean =>
  status === true || status === 1 || status === "1" || status === "success";

/**
 * Turns an iShip response into plain data, or throws.
 *
 * Endpoints that carry an envelope return their payload under `data`; the rest
 * (boxes, tracking, check-price) answer with the payload itself.
 */
export function unwrap(statusCode: number, body: string): unknown {
  let decoded: unknown;
  try {
    decoded = JSON.parse(body);
  } catch {
    throw new TransportError(`iShip API ตอบกลับไม่ใช่ JSON (HTTP ${statusCode})`);
  }

  if (Array.isArray(decoded)) return decoded;
  if (decoded === null || typeof decoded !== "object") {
    throw new TransportError(`iShip API ตอบกลับไม่ใช่ JSON (HTTP ${statusCode})`);
  }

  const envelope = decoded as Record<string, unknown>;

  if (statusCode === 401 || envelope.message === "Unauthenticated") {
    throw new AuthError("API token ไม่ถูกต้องหรือถูกแทนที่ด้วย token ใหม่แล้ว");
  }

  const failed = "status" in envelope && !isSuccess(envelope.status);
  if (failed || statusCode >= 400) {
    throw new ApiError(
      String(envelope.message ?? envelope.msg ?? "iShip API ปฏิเสธคำขอนี้"),
      String(envelope.code ?? statusCode),
      envelope,
    );
  }

  return "data" in envelope ? envelope.data : envelope;
}
