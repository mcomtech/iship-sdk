package iship

import (
	"fmt"
	"net/url"
	"regexp"
	"strconv"
)

// Address is a Thai address.
//
// iShip's wire format names these fields confusingly: its "*_district" holds the
// subdistrict and its "*_amphure" holds the district. These fields use the names
// you would write on an envelope and are mapped when sending.
type Address struct {
	Name  string
	Phone string
	// Address is the house number, street and building.
	Address string
	// Subdistrict is ตำบล / แขวง.
	Subdistrict string
	// District is อำเภอ / เขต.
	District string
	// Province is จังหวัด.
	Province string
	// Zipcode is the 5-digit postal code.
	Zipcode string
}

func (a Address) payload(prefix string) map[string]any {
	return map[string]any{
		prefix + "_name":     a.Name,
		prefix + "_phone":    a.Phone,
		prefix + "_address":  a.Address,
		prefix + "_district": a.Subdistrict,
		prefix + "_amphure":  a.District,
		prefix + "_province": a.Province,
		prefix + "_zipcode":  a.Zipcode,
	}
}

// Parcel is a parcel's weight in kilograms and size in centimetres.
type Parcel struct {
	WeightKg float64
	WidthCm  float64
	LengthCm float64
	HeightCm float64
}

func (p Parcel) payload() map[string]any {
	return map[string]any{
		"weight": p.WeightKg,
		"width":  p.WidthCm,
		"length": p.LengthCm,
		"height": p.HeightCm,
	}
}

// Product is one line item inside a COD shipment.
type Product struct {
	Name     string
	Quantity int
	Price    float64
	WeightKg float64
	Color    string
}

func (p Product) payload() map[string]any {
	item := map[string]any{
		"product_name":  p.Name,
		"product_qty":   p.Quantity,
		"product_price": p.Price,
	}
	if p.WeightKg > 0 {
		item["product_weight"] = p.WeightKg
	}
	if p.Color != "" {
		item["product_color"] = p.Color
	}
	return item
}

// AutoCourier lets iShip pick the courier from the account's area rules.
const AutoCourier = "AutoCourier"

// CreateOrder describes a shipment to create.
type CreateOrder struct {
	// CustomOrderID is your own order number. It is required: iShip rejects a
	// repeat of the same value, so retrying a create whose response you never
	// received cannot produce a second parcel. Reuse it when you retry.
	CustomOrderID string
	CourierCode   string
	From          Address
	To            Address
	Parcel        Parcel
	// CategoryID is one of the Category constants.
	CategoryID int
	// CODAmount is the amount to collect on delivery, in baht. Zero means no COD.
	CODAmount float64
	Remark    string
	Products  []Product
	// Insured buys parcel insurance and requires ProductValue.
	Insured      bool
	ProductValue float64
	// PlatformName identifies your system in iShip's logs.
	PlatformName string
}

func (o CreateOrder) payload() (map[string]any, error) {
	if o.CustomOrderID == "" {
		return nil, fmt.Errorf("iship: CustomOrderID ต้องไม่เป็นค่าว่าง เพราะใช้กันการสร้างรายการซ้ำ")
	}
	if o.Insured && o.ProductValue <= 0 {
		return nil, fmt.Errorf("iship: ซื้อประกันต้องระบุ ProductValue")
	}

	platform := o.PlatformName
	if platform == "" {
		platform = "iship-sdk-go"
	}

	body := routeFields(o.From, o.To, o.Parcel)
	body["platform_name"] = platform
	body["custom_order_id"] = o.CustomOrderID
	body["courier_code"] = o.CourierCode
	body["category_id"] = o.CategoryID
	body["cod_amount"] = o.CODAmount

	if o.Remark != "" {
		body["remark"] = o.Remark
	}
	if len(o.Products) > 0 {
		items := make([]map[string]any, len(o.Products))
		for i, p := range o.Products {
			items[i] = p.payload()
		}
		body["products"] = items
	}
	if o.Insured {
		body["is_insured"] = 1
		body["product_value"] = o.ProductValue
	}

	return body, nil
}

var datePattern = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}$`)

// OrderQuery filters QueryOrders. Dates are Gregorian, YYYY-MM-DD.
type OrderQuery struct {
	StartDate string
	EndDate   string
	// Status is one of the Status constants; zero means every status.
	Status      int
	CourierCode string
	// Keyword matches recipient name or address.
	Keyword string
	// Printed filters on whether the label was printed. Nil means either.
	Printed *bool
}

func (q OrderQuery) values() (url.Values, error) {
	for name, value := range map[string]string{"StartDate": q.StartDate, "EndDate": q.EndDate} {
		if !datePattern.MatchString(value) {
			return nil, fmt.Errorf("iship: %s ต้องอยู่ในรูปแบบ YYYY-MM-DD", name)
		}
	}

	values := url.Values{"start_date": {q.StartDate}, "end_date": {q.EndDate}}
	if q.Status != 0 {
		values.Set("status", strconv.Itoa(q.Status))
	}
	if q.CourierCode != "" {
		values.Set("courier_code", q.CourierCode)
	}
	if q.Keyword != "" {
		values.Set("keyword", q.Keyword)
	}
	if q.Printed != nil {
		values.Set("is_printed", boolToDigit(*q.Printed))
	}
	return values, nil
}

func boolToDigit(b bool) string {
	if b {
		return "1"
	}
	return "0"
}

// PickupRequest asks a courier to collect parcels.
type PickupRequest struct {
	CourierCode  string
	ContactName  string
	ContactPhone string
	// PickupAddress is the full address on one line, including subdistrict,
	// district, province and postal code.
	PickupAddress string
	ParcelCount   int
	Remark        string
}

func (p PickupRequest) payload() (map[string]any, error) {
	if p.ParcelCount < 1 {
		return nil, fmt.Errorf("iship: ParcelCount ต้องมากกว่า 0")
	}

	body := map[string]any{
		"courier_code":   p.CourierCode,
		"name":           p.ContactName,
		"phone":          p.ContactPhone,
		"pickup_address": p.PickupAddress,
		"parcel":         p.ParcelCount,
	}
	if p.Remark != "" {
		body["remark"] = p.Remark
	}
	return body, nil
}

// Token is the result of RequestToken.
type Token struct {
	Type        string `json:"type"`
	AccessToken string `json:"accessToken"`
	ExpireIn    int    `json:"expireIn"`
}

// Box is a standard box size, in centimetres.
type Box struct {
	ID     int     `json:"id"`
	Name   string  `json:"name"`
	Width  float64 `json:"width"`
	Length float64 `json:"length"`
	Height float64 `json:"height"`
	Unit   string  `json:"unit"`
}

// Courier is a courier this account may use.
type Courier struct {
	Code string `json:"code"`
	Name string `json:"name"`
}

// CourierQuote is one courier's price for a route, from RecommendCouriers.
type CourierQuote struct {
	CourierCode      string  `json:"courier_code"`
	Name             string  `json:"name"`
	Price            float64 `json:"price"`
	TotalPrice       float64 `json:"total_price"`
	RemoteAreaPrice  float64 `json:"remote_area_price"`
	FuelSurchargeFee float64 `json:"fuel_surcharge_fee"`
	MaxWeight        float64 `json:"max_weight"`
	ReturnFee        float64 `json:"return_fee"`
}

// Price is this account's price for one courier, from CheckPrice.
type Price struct {
	CourierCode string  `json:"courier_code"`
	Weight      float64 `json:"weight"`
	WeightUnit  string  `json:"weight_unit"`
	RemoteArea  string  `json:"remote_area"`
	Price       float64 `json:"price"`
	TotalPrice  float64 `json:"total_price"`
}

// Balance is the account's remaining credit.
type Balance struct {
	UserID     int     `json:"user_id"`
	Balance    float64 `json:"balance"`
	LastActive string  `json:"last_active"`
}

// CreatedOrder is what CreateOrder returns.
type CreatedOrder struct {
	Ref            string `json:"ref"`
	TrackingNumber string `json:"tracking_number"`
	SortCode       string `json:"sortCode"`
	DstStoreName   string `json:"dstStoreName"`
	ID             int    `json:"id"`
	UserID         int    `json:"user_id"`
}

// Order is a shipment belonging to the account. Fields iShip adds later are
// available through Raw.
type Order struct {
	ID            int     `json:"id"`
	TrackNo       string  `json:"track_no"`
	RefCode       string  `json:"ref_code"`
	CustomOrderID string  `json:"custom_order_id"`
	CourierCode   string  `json:"courier_code"`
	Status        int     `json:"status"`
	StatusName    string  `json:"status_name"`
	CODAmount     string  `json:"cod_amount"`
	DstName       string  `json:"dst_name"`
	DstPhone      string  `json:"dst_phone"`
	DstProvince   string  `json:"dst_province"`
	DstZipcode    string  `json:"dst_zipcode"`
	IsPrinted     int     `json:"is_printed"`
	CreatedAt     string  `json:"created_at"`
	PickedUpDate  string  `json:"pickedup_date"`
	DeliveredAt   string  `json:"delivered_at"`
	CancelAt      string  `json:"cancel_at"`
	Weight        float64 `json:"weight"`
}

// Trace is a parcel's scan history, from TraceOrder.
type Trace struct {
	CourierCode string      `json:"courier_code"`
	TrackNo     string      `json:"track_no"`
	Routes      []TraceStep `json:"trace_routes"`
}

// Tracking is public tracking data, from Tracking.
type Tracking struct {
	TrackNo     string      `json:"track_no"`
	CourierCode string      `json:"courier_code"`
	CourierName string      `json:"courier_name"`
	Traces      []TraceStep `json:"traces"`
}

// TraceStep is one courier scan.
type TraceStep struct {
	Status          string `json:"status"`
	StatusText      string `json:"status_text"`
	StatusDesc      string `json:"status_desc"`
	CurrentLocation string `json:"current_location"`
	Timestamp       string `json:"timestamp"`
}

// Pickup is a booked pickup, from RequestPickup.
type Pickup struct {
	TicketPickupID int    `json:"ticketPickupId"`
	ID             int    `json:"id"`
	CourierCode    string `json:"courier_code"`
	StaffInfoName  string `json:"staffInfoName"`
	StaffInfoPhone string `json:"staffInfoPhone"`
	SrcAddress     string `json:"src_address"`
}

// OrderStatusInfo is one entry from OrderStatuses.
type OrderStatusInfo struct {
	ID         int    `json:"id"`
	StatusCode string `json:"status_code"`
	Name       string `json:"name"`
}

// Order status ids, as returned by OrderStatuses.
const (
	StatusAwaitingPickup = 1  // รอเข้ารับพัสดุ
	StatusPickedUp       = 2  // พัสดุเข้าระบบ
	StatusDelivered      = 3  // จัดส่งแล้ว
	StatusIssue          = 4  // พัสดุมีปัญหา
	StatusCancelled      = 5  // ยกเลิก
	StatusProgress       = 6  // อยู่ระหว่างจัดส่ง
	StatusCannotPickup   = 7  // ไม่สามารถเข้ารับพัสดุ
	StatusNoCourier      = 8  // รอเลือกขนส่ง
	StatusWithBranch     = 9  // พัสดุถึงสถานีคัดแยก
	StatusReturning      = 10 // พัสดุตีกลับ
	StatusReturnSuccess  = 11 // ส่งคืนสำเร็จ
	StatusPaymentSuccess = 12 // ชำระเงินสำเร็จ
	StatusInTransit      = 13 // อยู่ระหว่างขนส่ง
	StatusCODRefund      = 14 // รายการขอเงินคืน
	StatusExpired        = 15 // หมดอายุ
	StatusClosed         = 99 // ปิดงาน
)

// Goods categories for CreateOrder.CategoryID.
const (
	CategoryDocument  = 0  // เอกสาร
	CategoryDryFood   = 1  // อาหารแห้ง
	CategoryHousehold = 2  // ของใช้
	CategoryIT        = 3  // อุปกรณ์ไอที
	CategoryClothing  = 4  // เสื้อผ้า
	CategoryMedia     = 5  // สื่อบันเทิง
	CategoryAutoParts = 6  // อะไหล่รถยนต์
	CategoryShoesBags = 7  // รองเท้า/กระเป๋า
	CategorySports    = 8  // อุปกรณ์กีฬา
	CategoryCosmetics = 9  // เครื่องสำอางค์
	CategoryFurniture = 10 // เฟอร์นิเจอร์
	CategoryFruit     = 11 // ผลไม้
	CategoryOther     = 99 // อื่นๆ
)
