/** A Thai address. */
export interface Address {
  name: string;
  phone: string;
  /** House number, street, building. */
  address: string;
  /** ตำบล / แขวง — sent as the API's confusingly named `*_district`. */
  subdistrict: string;
  /** อำเภอ / เขต — sent as the API's confusingly named `*_amphure`. */
  district: string;
  /** จังหวัด */
  province: string;
  /** 5-digit postal code. */
  zipcode: string;
}

/** Weight in kilograms, dimensions in centimetres. */
export interface Parcel {
  weightKg: number;
  widthCm: number;
  lengthCm: number;
  heightCm: number;
}

/**
 * One line item inside a COD shipment.
 *
 * iShip requires every field except `remark`, and it wants the item's size one of
 * two ways: either `size` as free text ("12 x 12 x 2", at most 128 bytes) or all
 * three of `widthCm`, `lengthCm` and `heightCm`. `size` wins when both are given.
 */
export interface Product {
  name: string;
  /** 1–999. */
  quantity: number;
  price: number;
  weightKg: number;
  /** Required by iShip; use a placeholder such as "-" when the goods have no colour. */
  color: string;
  /** Free-text size, an alternative to the three dimensions below. */
  size?: string;
  widthCm?: number;
  lengthCm?: number;
  heightCm?: number;
  remark?: string;
}

/** Let iShip pick the courier from the account's area rules. */
export const AUTO_COURIER = "AutoCourier";

/** A shipment to create. */
export interface CreateOrderInput {
  /**
   * Your own order number. Required: iShip rejects a repeat of the same value,
   * so retrying a create whose response you never saw cannot produce a second
   * parcel or spend credit twice. Reuse it when you retry.
   */
  customOrderId: string;
  courierCode: string;
  from: Address;
  to: Address;
  parcel: Parcel;
  /** One of the Category values. */
  categoryId?: number;
  /** Amount to collect on delivery, in baht. A COD shipment must also list `products`. */
  codAmount?: number;
  remark?: string;
  products?: Product[];
  /** Buys parcel insurance; requires productValue. */
  insured?: boolean;
  productValue?: number;
  /** Identifies your system in iShip's logs. */
  platformName?: string;
}

/** Filter for queryOrders(). Dates are Gregorian, YYYY-MM-DD. */
export interface OrderQuery {
  startDate: string;
  endDate: string;
  /** One of the OrderStatus values. */
  status?: number;
  courierCode?: string;
  /** Matches recipient name or address. */
  keyword?: string;
  printed?: boolean;
}

/** A request for a courier to collect parcels. */
export interface PickupInput {
  courierCode: string;
  contactName: string;
  contactPhone: string;
  /** Full address on one line, including subdistrict, district, province, zipcode. */
  pickupAddress: string;
  parcelCount: number;
  remark?: string;
}

export interface Token {
  type: string;
  accessToken: string;
  expireIn: number;
}

export interface Box {
  id: number;
  name: string;
  width: number;
  length: number;
  height: number;
  unit: string;
}

export interface Courier {
  code: string;
  name: string;
}

export interface CourierQuote {
  courier_code: string;
  name: string;
  price: number;
  total_price: number;
  remote_area_price: number;
  fuel_surcharge_fee: number;
  max_weight: number;
  return_fee: number;
}

export interface Price {
  courier_code: string;
  weight: number;
  weight_unit: string;
  remote_area: string;
  price: number;
  total_price: number;
}

export interface Balance {
  user_id: number;
  balance: number;
  last_active: string | null;
}

export interface CreatedOrder {
  ref: string;
  tracking_number: string;
  sortCode?: string;
  dstStoreName?: string;
  id: number;
  user_id: number;
}

/** A shipment belonging to the account. iShip returns more fields than these. */
export interface Order {
  id: number;
  track_no: string;
  ref_code: string;
  custom_order_id: string | null;
  courier_code: string;
  status: number;
  status_name: string;
  cod_amount: string;
  dst_name: string;
  dst_phone: string;
  dst_province: string;
  dst_zipcode: string;
  is_printed: number;
  created_at: string;
  pickedup_date: string | null;
  delivered_at: string | null;
  cancel_at: string | null;
  [key: string]: unknown;
}

export interface TraceStep {
  status: string;
  status_text: string;
  status_desc: string;
  current_location: string;
  timestamp: string;
}

export interface Trace {
  courier_code: string;
  track_no: string;
  trace_routes: TraceStep[];
}

export interface Tracking {
  track_no: string;
  courier_code: string;
  courier_name: string;
  traces?: TraceStep[];
}

export interface Pickup {
  ticketPickupId: number;
  id: number;
  courier_code?: string;
  staffInfoName?: string | null;
  staffInfoPhone?: string | null;
  src_address?: string;
}

export interface OrderStatusInfo {
  id: number;
  status_code: string;
  name: string;
}

/** Order status ids, as returned by orderStatuses(). */
export const OrderStatus = {
  AwaitingPickup: 1, // รอเข้ารับพัสดุ
  PickedUp: 2, // พัสดุเข้าระบบ
  Delivered: 3, // จัดส่งแล้ว
  Issue: 4, // พัสดุมีปัญหา
  Cancelled: 5, // ยกเลิก
  Progress: 6, // อยู่ระหว่างจัดส่ง
  CannotPickup: 7, // ไม่สามารถเข้ารับพัสดุ
  NoCourier: 8, // รอเลือกขนส่ง
  WithBranch: 9, // พัสดุถึงสถานีคัดแยก
  Returning: 10, // พัสดุตีกลับ
  ReturnSuccess: 11, // ส่งคืนสำเร็จ
  PaymentSuccess: 12, // ชำระเงินสำเร็จ
  InTransit: 13, // อยู่ระหว่างขนส่ง
  CodRefund: 14, // รายการขอเงินคืน
  Expired: 15, // หมดอายุ
  Closed: 99, // ปิดงาน
} as const;

/** Goods categories for CreateOrderInput.categoryId. */
export const Category = {
  Document: 0, // เอกสาร
  DryFood: 1, // อาหารแห้ง
  Household: 2, // ของใช้
  IT: 3, // อุปกรณ์ไอที
  Clothing: 4, // เสื้อผ้า
  Media: 5, // สื่อบันเทิง
  AutoParts: 6, // อะไหล่รถยนต์
  ShoesBags: 7, // รองเท้า/กระเป๋า
  Sports: 8, // อุปกรณ์กีฬา
  Cosmetics: 9, // เครื่องสำอางค์
  Furniture: 10, // เฟอร์นิเจอร์
  Fruit: 11, // ผลไม้
  Other: 99, // อื่นๆ
} as const;
