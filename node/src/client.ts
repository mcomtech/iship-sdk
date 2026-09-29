import { ApiError, AuthError, TransportError, ValidationError, unwrap } from "./errors.js";
import {
  Address,
  Balance,
  Box,
  Courier,
  CourierQuote,
  CreateOrderInput,
  CreatedOrder,
  Order,
  OrderQuery,
  OrderStatus,
  OrderStatusInfo,
  Parcel,
  PickupInput,
  Price,
  Product,
  Token,
  Trace,
  Tracking,
} from "./types.js";

/** The live iShip API. */
export const PRODUCTION = "https://app.iship.cloud";
/** The test environment. Orders created there are not real shipments. */
export const UAT = "https://app-uat.iship.cloud";

export interface ClientOptions {
  /** The account's API token. Account endpoints need it. */
  token?: string;
  /** Defaults to PRODUCTION. */
  baseUrl?: string;
  /** Defaults to 120000 ms, because createOrder can take close to a minute. */
  timeoutMs?: number;
  /** Defaults to globalThis.fetch. Replace it to add logging or to test offline. */
  fetch?: typeof globalThis.fetch;
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Client for the iShip shipping API.
 *
 * const iship = new IShipClient({ token: process.env.ISHIP_TOKEN });
 * const order = await iship.createOrder({ ... });
 */
export class IShipClient {
  private readonly baseUrl: string;
  private readonly token?: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof globalThis.fetch;

  constructor(options: ClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? PRODUCTION).replace(/\/+$/, "");
    this.token = options.token;
    this.timeoutMs = options.timeoutMs ?? 120_000;
    this.fetchImpl = options.fetch ?? globalThis.fetch;
  }

  /**
   * Exchange phone and password for an API token.
   *
   * An account has exactly one token: this call replaces it, so every existing
   * integration using the old token stops working immediately.
   */
  requestToken(phone: string, password: string): Promise<Token> {
    return this.send<Token>("POST", "/api/auth/requestToken", { body: { phone, password } });
  }

  /** A copy of this client that authenticates with `token`. */
  withToken(token: string): IShipClient {
    return new IShipClient({ token, baseUrl: this.baseUrl, timeoutMs: this.timeoutMs, fetch: this.fetchImpl });
  }

  // ---------------------------------------------------------------- public

  /** Standard box sizes, in centimetres. No token required. */
  boxes(): Promise<Box[]> {
    return this.send<Box[]>("GET", "/api/boxes");
  }

  /**
   * Price every courier for this route and parcel, at list prices.
   * Use checkPrice() for the prices this account actually pays.
   */
  recommendCouriers(from: Address, to: Address, parcel: Parcel): Promise<CourierQuote[]> {
    return this.send<CourierQuote[]>("POST", "/api/v2/courier/recommend", {
      body: { user_id: null, ...routeFields(from, to, parcel) },
    });
  }

  /** Public tracking for a parcel. Resolves to null when the number is unknown. */
  async tracking(trackNo: string): Promise<Tracking | null> {
    const result = await this.send<Tracking[]>("GET", `/api/v2/tracking/${encodeURIComponent(trackNo)}`);
    return result[0] ?? null;
  }

  /** Public URL of the A6 label PDF. Anyone with the URL can open it. */
  labelUrl(trackNos: string[]): string {
    if (trackNos.length === 0) throw new ValidationError("ต้องระบุเลขพัสดุอย่างน้อย 1 รายการ");
    return `${this.baseUrl}/api/download/pdf?tracks=${trackNos.map(encodeURIComponent).join(",")}`;
  }

  /** The label PDF itself. */
  async downloadLabel(trackNos: string[]): Promise<ArrayBuffer> {
    const response = await this.request("GET", this.labelUrl(trackNos), {});
    if (response.status >= 400) {
      throw new ApiError("ไม่สามารถดาวน์โหลดใบปะหน้าได้", String(response.status), {});
    }
    return response.arrayBuffer();
  }

  // ------------------------------------------------------------ token only

  /** Couriers this account may use. */
  couriers(): Promise<Courier[]> {
    return this.send<Courier[]>("GET", "/api/courier_code", { auth: true });
  }

  /** Status ids for queryOrders(). The same values are exported as OrderStatus. */
  orderStatuses(): Promise<OrderStatusInfo[]> {
    return this.send<OrderStatusInfo[]>("GET", "/api/order_statuses", { auth: true });
  }

  /** Price for one courier at this account's rates, including remote-area fees. */
  checkPrice(courierCode: string, from: Address, to: Address, parcel: Parcel): Promise<Price> {
    return this.send<Price>("POST", "/api/v2/check-price", {
      auth: true,
      body: { courier_code: courierCode, ...routeFields(from, to, parcel) },
    });
  }

  /** Remaining credit on the account. */
  balance(): Promise<Balance> {
    return this.send<Balance>("GET", "/api/v2/check-balance", { auth: true });
  }

  /**
   * Create a shipment. This spends the account's credit.
   *
   * Retrying with the same customOrderId is safe: iShip rejects the duplicate
   * instead of creating a second parcel.
   */
  async createOrder(input: CreateOrderInput): Promise<CreatedOrder> {
    if (!input.customOrderId) {
      throw new ValidationError("customOrderId ต้องไม่เป็นค่าว่าง เพราะใช้กันการสร้างรายการซ้ำ");
    }
    if (input.insured && !input.productValue) {
      throw new ValidationError("ซื้อประกันต้องระบุ productValue");
    }
    if ((input.codAmount ?? 0) > 0 && !input.products?.length) {
      throw new ValidationError("รายการ COD ต้องระบุ products (รายละเอียดสินค้า) ด้วย");
    }
    for (const product of input.products ?? []) validateProduct(product);

    const body: Record<string, unknown> = {
      platform_name: input.platformName ?? "iship-sdk-node",
      custom_order_id: input.customOrderId,
      courier_code: input.courierCode,
      category_id: input.categoryId ?? 99,
      cod_amount: input.codAmount ?? 0,
      ...routeFields(input.from, input.to, input.parcel),
    };

    if (input.remark) body.remark = input.remark;
    if (input.products?.length) {
      body.products = input.products.map(productPayload);
    }
    if (input.insured) {
      body.is_insured = 1;
      body.product_value = input.productValue;
    }

    return this.send<CreatedOrder>("POST", "/api/create_order", { auth: true, body });
  }

  /** One order belonging to this account, or null when not found. */
  async getOrder(trackNo: string): Promise<Order | null> {
    try {
      return await this.send<Order>("GET", `/api/get_order/${encodeURIComponent(trackNo)}`, { auth: true });
    } catch (error) {
      if (error instanceof ApiError && error.code === "1004") return null;
      throw error;
    }
  }

  /** Orders of this account created in a date range. */
  async queryOrders(query: OrderQuery): Promise<Order[]> {
    for (const [name, value] of [
      ["startDate", query.startDate],
      ["endDate", query.endDate],
    ] as const) {
      if (!DATE_PATTERN.test(value)) throw new ValidationError(`${name} ต้องอยู่ในรูปแบบ YYYY-MM-DD`);
    }

    const search: Record<string, string> = { start_date: query.startDate, end_date: query.endDate };
    if (query.status !== undefined) search.status = String(query.status);
    if (query.courierCode) search.courier_code = query.courierCode;
    if (query.keyword) search.keyword = query.keyword;
    if (query.printed !== undefined) search.is_printed = query.printed ? "1" : "0";

    return this.send<Order[]>("GET", "/api/query_orders", { auth: true, search });
  }

  /** Full courier scan history for an order of this account. */
  traceOrder(trackNo: string): Promise<Trace> {
    return this.send<Trace>("POST", "/api/traces", { auth: true, body: { track_no: trackNo } });
  }

  /**
   * Cancel an order the courier has not collected yet.
   *
   * iShip reports success even when the courier refuses, so this reads the order
   * back and throws ApiError with code "not_cancelled" if it is still active.
   */
  async cancelOrder(trackNo: string): Promise<Order> {
    const order = await this.getOrder(trackNo);
    if (!order) throw new ApiError(`ไม่พบเลขพัสดุ ${trackNo} ในบัญชีนี้`, "1004", {});

    await this.send("POST", "/api/cancel_order", {
      auth: true,
      body: { courier_code: order.courier_code, track_no: trackNo },
    });

    const after = await this.getOrder(trackNo);
    if (!after || (after.status !== OrderStatus.Cancelled && !after.cancel_at)) {
      throw new ApiError(
        `ยกเลิกไม่สำเร็จ สถานะปัจจุบัน: ${after?.status_name ?? "ไม่ทราบ"}`,
        "not_cancelled",
        after ?? {},
      );
    }
    return after;
  }

  /** Remove an order from the account. Irreversible. */
  deleteOrder(trackNo: string): Promise<unknown> {
    return this.send("POST", "/api/confirm/delete_order", { auth: true, body: { track_no: trackNo } });
  }

  /** Ask a courier to collect parcels. This dispatches a real pickup. */
  async requestPickup(input: PickupInput): Promise<unknown> {
    if (input.parcelCount < 1) throw new ValidationError("parcelCount ต้องมากกว่า 0");

    return this.send("POST", "/api/request_courier", {
      auth: true,
      body: {
        courier_code: input.courierCode,
        name: input.contactName,
        phone: input.contactPhone,
        pickup_address: input.pickupAddress,
        parcel: input.parcelCount,
        ...(input.remark ? { remark: input.remark } : {}),
      },
    });
  }

  /** Cancel a pickup booked with requestPickup(). */
  cancelPickup(ticketPickupId: number | string): Promise<unknown> {
    return this.send("GET", `/api/cancel-notify/${encodeURIComponent(String(ticketPickupId))}`, { auth: true });
  }

  // --------------------------------------------------------------- internal

  private async send<T>(
    method: string,
    path: string,
    options: { auth?: boolean; body?: unknown; search?: Record<string, string> } = {},
  ): Promise<T> {
    if (options.auth && !this.token) {
      throw new AuthError("ต้องใส่ API token ก่อนเรียกเมธอดนี้");
    }

    const url = new URL(this.baseUrl + path);
    for (const [key, value] of Object.entries(options.search ?? {})) url.searchParams.set(key, value);

    const response = await this.request(method, url.toString(), { body: options.body });
    return unwrap(response.status, await response.text()) as T;
  }

  private async request(method: string, url: string, options: { body?: unknown }): Promise<Response> {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (this.token) headers.Authorization = `Bearer ${this.token}`;
    if (options.body !== undefined) headers["Content-Type"] = "application/json";

    try {
      return await this.fetchImpl(url, {
        method,
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      const timedOut = error instanceof DOMException && error.name === "TimeoutError";
      throw new TransportError(
        timedOut ? "iShip API ไม่ตอบกลับภายในเวลาที่กำหนด" : `เชื่อมต่อ iShip API ไม่ได้: ${String(error)}`,
      );
    }
  }
}

/**
 * iShip's wire format names the address fields confusingly: `*_district` holds
 * the subdistrict and `*_amphure` holds the district.
 */
function addressFields(address: Address, prefix: "src" | "dst"): Record<string, string> {
  return {
    [`${prefix}_name`]: address.name,
    [`${prefix}_phone`]: address.phone,
    [`${prefix}_address`]: address.address,
    [`${prefix}_district`]: address.subdistrict,
    [`${prefix}_amphure`]: address.district,
    [`${prefix}_province`]: address.province,
    [`${prefix}_zipcode`]: address.zipcode,
  };
}

function routeFields(from: Address, to: Address, parcel: Parcel): Record<string, unknown> {
  return {
    ...addressFields(from, "src"),
    ...addressFields(to, "dst"),
    weight: parcel.weightKg,
    width: parcel.widthCm,
    length: parcel.lengthCm,
    height: parcel.heightCm,
  };
}

const MAX_PRODUCT_SIZE_LENGTH = 128;
const MAX_PRODUCT_QUANTITY = 999;

function validateProduct(product: Product): void {
  const fail = (message: string): never => {
    throw new ValidationError(`สินค้า "${product.name}": ${message}`);
  };

  if (!product.name) fail("ต้องระบุชื่อสินค้า");
  if (!(product.quantity >= 1 && product.quantity <= MAX_PRODUCT_QUANTITY)) {
    fail(`จำนวนสินค้าต้องอยู่ระหว่าง 1 ถึง ${MAX_PRODUCT_QUANTITY}`);
  }
  if (!(product.price > 0)) fail("ต้องระบุราคาสินค้ามากกว่า 0");
  if (!(product.weightKg > 0)) fail("ต้องระบุน้ำหนักสินค้ามากกว่า 0");
  if (!product.color) fail("ต้องระบุสีสินค้า");

  if (product.size) {
    // iShip measures this limit in bytes, so Thai text counts more than its length.
    if (Buffer.byteLength(product.size) > MAX_PRODUCT_SIZE_LENGTH) {
      fail(`ขนาดสินค้าไม่เกิน ${MAX_PRODUCT_SIZE_LENGTH} ตัวอักษร`);
    }
  } else if (!(product.widthCm! > 0 && product.lengthCm! > 0 && product.heightCm! > 0)) {
    fail("ต้องระบุ size หรือ widthCm, lengthCm และ heightCm ครบทั้งสามค่า");
  }
}

function productPayload(product: Product): Record<string, unknown> {
  return {
    product_name: product.name,
    product_qty: product.quantity,
    product_price: product.price,
    product_weight: product.weightKg,
    product_color: product.color,
    ...(product.size
      ? { product_size: product.size }
      : { product_width: product.widthCm, product_length: product.lengthCm, product_height: product.heightCm }),
    ...(product.remark === undefined ? {} : { product_remark: product.remark }),
  };
}
