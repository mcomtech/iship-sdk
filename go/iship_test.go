package iship

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
)

func bangkokAddress() Address {
	return Address{
		Name: "ร้านทดสอบ", Phone: "0812345678", Address: "44/247",
		Subdistrict: "สายไหม", District: "สายไหม", Province: "กรุงเทพมหานคร", Zipcode: "10220",
	}
}

func chiangmaiAddress() Address {
	return Address{
		Name: "ผู้รับ", Phone: "0891234567", Address: "12/3",
		Subdistrict: "สุเทพ", District: "เมืองเชียงใหม่", Province: "เชียงใหม่", Zipcode: "50200",
	}
}

// stub replies with the given bodies in order and records every request.
func stub(t *testing.T, bodies ...string) (*Client, *[]*http.Request, *[]string) {
	t.Helper()
	var requests []*http.Request
	var payloads []string
	call := 0

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		requests = append(requests, r)
		payloads = append(payloads, string(body))

		w.Header().Set("Content-Type", "application/json")
		if call >= len(bodies) {
			t.Errorf("unexpected extra request to %s", r.URL.Path)
			w.Write([]byte(`{}`))
			return
		}
		w.Write([]byte(bodies[call]))
		call++
	}))
	t.Cleanup(server.Close)

	return New(WithToken("token"), WithBaseURL(server.URL), WithHTTPClient(server.Client())), &requests, &payloads
}

func TestFailureSentAsHTTP200BecomesAPIError(t *testing.T) {
	client, _, _ := stub(t, `{"status":false,"code":"1013","message":"ไม่พบข้อมูล courier_code นี้ในระบบ"}`)

	_, err := client.Couriers(context.Background())

	var apiErr *APIError
	if !errors.As(err, &apiErr) {
		t.Fatalf("expected *APIError, got %v", err)
	}
	if apiErr.Code != "1013" || apiErr.Message != "ไม่พบข้อมูล courier_code นี้ในระบบ" {
		t.Fatalf("unexpected error: %+v", apiErr)
	}
}

func TestUnauthenticatedBecomesAuthError(t *testing.T) {
	client, _, _ := stub(t, `{"status":false,"code":9999,"message":"Unauthenticated"}`)

	_, err := client.Balance(context.Background())

	var authErr *AuthError
	if !errors.As(err, &authErr) {
		t.Fatalf("expected *AuthError, got %v", err)
	}
}

func TestAccountEndpointNeedsToken(t *testing.T) {
	if _, err := New().Couriers(context.Background()); !errors.Is(err, ErrNoToken) {
		t.Fatalf("expected ErrNoToken, got %v", err)
	}
}

func TestNonJSONBodyBecomesTransportError(t *testing.T) {
	client, _, _ := stub(t, `<html>Bad Gateway</html>`)

	_, err := client.Couriers(context.Background())

	var transportErr *TransportError
	if !errors.As(err, &transportErr) {
		t.Fatalf("expected *TransportError, got %v", err)
	}
}

func TestEnvelopeIsUnwrappedToData(t *testing.T) {
	client, _, _ := stub(t, `{"status":true,"code":"0000","data":[{"code":"FlashLive","name":"Flash Pro OK"}]}`)

	couriers, err := client.Couriers(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if len(couriers) != 1 || couriers[0].Code != "FlashLive" {
		t.Fatalf("unexpected couriers: %+v", couriers)
	}
}

func TestBareArrayResponseIsDecoded(t *testing.T) {
	client, _, _ := stub(t, `[{"id":2,"name":"กล่องเบอร์ A","width":14,"length":20,"height":6,"unit":"ซม"}]`)

	boxes, err := client.Boxes(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if len(boxes) != 1 || boxes[0].Width != 14 {
		t.Fatalf("unexpected boxes: %+v", boxes)
	}
}

func TestAddressFieldsMapToWireNames(t *testing.T) {
	client, _, payloads := stub(t, `{"status":true,"data":[]}`)

	if _, err := client.RecommendCouriers(context.Background(), bangkokAddress(), chiangmaiAddress(), Parcel{WeightKg: 1, WidthCm: 14, LengthCm: 20, HeightCm: 6}); err != nil {
		t.Fatal(err)
	}

	var sent map[string]any
	if err := json.Unmarshal([]byte((*payloads)[0]), &sent); err != nil {
		t.Fatal(err)
	}
	for field, want := range map[string]string{
		"src_district": "สายไหม",         // subdistrict
		"src_amphure":  "สายไหม",         // district
		"dst_district": "สุเทพ",          // subdistrict
		"dst_amphure":  "เมืองเชียงใหม่", // district
	} {
		if sent[field] != want {
			t.Errorf("%s: expected %q, got %v", field, want, sent[field])
		}
	}
	if sent["weight"] != float64(1) {
		t.Errorf("weight: expected 1 kg, got %v", sent["weight"])
	}
}

func TestCreateOrderRequiresDuplicateGuard(t *testing.T) {
	client, _, payloads := stub(t, `{"status":true,"data":{"tracking_number":"TH0147XXXX","ref":"REF1"}}`)

	order := CreateOrder{
		CustomOrderID: "SHOP-1001",
		CourierCode:   "FlashLive",
		From:          bangkokAddress(),
		To:            chiangmaiAddress(),
		Parcel:        Parcel{WeightKg: 1, WidthCm: 14, LengthCm: 20, HeightCm: 6},
		CategoryID:    CategoryClothing,
		CODAmount:     590,
		Products:      []Product{{Name: "เสื้อยืด", Quantity: 1, Price: 590, WeightKg: 0.3, Color: "ดำ", Size: "30 x 40 x 5"}},
	}

	created, err := client.CreateOrder(context.Background(), order)
	if err != nil {
		t.Fatal(err)
	}
	if created.TrackingNumber != "TH0147XXXX" {
		t.Fatalf("unexpected result: %+v", created)
	}

	var sent map[string]any
	json.Unmarshal([]byte((*payloads)[0]), &sent)
	if sent["custom_order_id"] != "SHOP-1001" || sent["cod_amount"] != float64(590) {
		t.Fatalf("unexpected payload: %v", sent)
	}

	order.CustomOrderID = ""
	if _, err := New(WithToken("t")).CreateOrder(context.Background(), order); err == nil {
		t.Fatal("expected an error when CustomOrderID is empty")
	}
}

func TestCODRequiresProductDetails(t *testing.T) {
	order := CreateOrder{
		CustomOrderID: "SHOP-1003", CourierCode: "FlashLive",
		From: bangkokAddress(), To: chiangmaiAddress(),
		Parcel: Parcel{WeightKg: 1, WidthCm: 14, LengthCm: 20, HeightCm: 6}, CODAmount: 590,
	}

	if _, err := New(WithToken("t")).CreateOrder(context.Background(), order); err == nil {
		t.Fatal("expected an error when a COD order lists no products")
	}
}

func TestProductSizeEitherWay(t *testing.T) {
	client, _, payloads := stub(t, `{"status":true,"data":{"tracking_number":"TH1"}}`)

	if _, err := client.CreateOrder(context.Background(), CreateOrder{
		CustomOrderID: "SHOP-1004", CourierCode: "FlashLive",
		From: bangkokAddress(), To: chiangmaiAddress(),
		Parcel: Parcel{WeightKg: 1, WidthCm: 14, LengthCm: 20, HeightCm: 6}, CODAmount: 1200,
		Products: []Product{
			{Name: "ALBUM 1", Quantity: 1, Price: 1200, WeightKg: 0.3, Color: "BLUE", WidthCm: 12, LengthCm: 12, HeightCm: 2},
			{Name: "ALBUM 2", Quantity: 2, Price: 600, WeightKg: 0.3, Color: "RED", Size: "12 x 12 x 2"},
		},
	}); err != nil {
		t.Fatal(err)
	}

	var sent struct {
		Products []map[string]any `json:"products"`
	}
	if err := json.Unmarshal([]byte((*payloads)[0]), &sent); err != nil {
		t.Fatal(err)
	}

	if sent.Products[0]["product_width"] != float64(12) {
		t.Errorf("dimensions should be sent when Size is empty: %v", sent.Products[0])
	}
	if _, ok := sent.Products[0]["product_size"]; ok {
		t.Errorf("product_size should be absent: %v", sent.Products[0])
	}
	if sent.Products[1]["product_size"] != "12 x 12 x 2" {
		t.Errorf("Size should replace the dimensions: %v", sent.Products[1])
	}
	if _, ok := sent.Products[1]["product_width"]; ok {
		t.Errorf("product_width should be absent when Size is set: %v", sent.Products[1])
	}
	if sent.Products[0]["product_color"] != "BLUE" || sent.Products[0]["product_weight"] != 0.3 {
		t.Errorf("unexpected product payload: %v", sent.Products[0])
	}
}

func TestProductValidation(t *testing.T) {
	valid := Product{Name: "ALBUM", Quantity: 1, Price: 1200, WeightKg: 0.3, Color: "BLUE", Size: "1 x 1 x 1"}

	cases := map[string]func(Product) Product{
		"no name":        func(p Product) Product { p.Name = ""; return p },
		"no colour":      func(p Product) Product { p.Color = ""; return p },
		"no weight":      func(p Product) Product { p.WeightKg = 0; return p },
		"no price":       func(p Product) Product { p.Price = 0; return p },
		"quantity 0":     func(p Product) Product { p.Quantity = 0; return p },
		"quantity 1000":  func(p Product) Product { p.Quantity = 1000; return p },
		"size too long":  func(p Product) Product { p.Size = strings.Repeat("x", 129); return p },
		"no size at all": func(p Product) Product { p.Size = ""; return p },
		"zero dimension": func(p Product) Product { p.Size = ""; p.WidthCm, p.LengthCm, p.HeightCm = 12, 12, 0; return p },
	}

	if err := valid.validate(); err != nil {
		t.Fatalf("the valid product was rejected: %v", err)
	}
	for name, breakIt := range cases {
		if err := breakIt(valid).validate(); err == nil {
			t.Errorf("%s: expected an error", name)
		}
	}
}

func TestInsuranceRequiresDeclaredValue(t *testing.T) {
	order := CreateOrder{
		CustomOrderID: "SHOP-1002", CourierCode: "FlashLive",
		From: bangkokAddress(), To: chiangmaiAddress(),
		Parcel: Parcel{WeightKg: 1}, Insured: true,
	}

	if _, err := New(WithToken("t")).CreateOrder(context.Background(), order); err == nil {
		t.Fatal("expected an error when ProductValue is missing")
	}
}

func TestCancelOrderVerifiesTheResult(t *testing.T) {
	active := `{"status":true,"data":{"courier_code":"FlashLive","status":1,"status_name":"รอเข้ารับพัสดุ"}}`
	client, _, _ := stub(t, active, `{"status":true,"code":200,"data":[]}`, active)

	_, err := client.CancelOrder(context.Background(), "TH0147XXXX")

	var apiErr *APIError
	if !errors.As(err, &apiErr) || apiErr.Code != "not_cancelled" {
		t.Fatalf("expected a not_cancelled APIError, got %v", err)
	}
}

func TestCancelOrderReturnsCancelledOrder(t *testing.T) {
	client, _, _ := stub(t,
		`{"status":true,"data":{"courier_code":"FlashLive","status":1}}`,
		`{"status":true,"code":200,"data":[]}`,
		`{"status":true,"data":{"status":5,"status_name":"ยกเลิก","cancel_at":"2026-09-28 10:00:00"}}`,
	)

	order, err := client.CancelOrder(context.Background(), "TH0147XXXX")
	if err != nil {
		t.Fatal(err)
	}
	if order.Status != StatusCancelled {
		t.Fatalf("unexpected status: %+v", order)
	}
}

func TestGetOrderReturnsErrNotFound(t *testing.T) {
	client, _, _ := stub(t, `{"status":false,"code":"1004","message":"The requested 'track_no' does not exist."}`)

	if _, err := client.GetOrder(context.Background(), "TH0000000000"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("expected ErrNotFound, got %v", err)
	}
}

func TestQueryOrdersBuildsQueryString(t *testing.T) {
	client, requests, _ := stub(t, `{"status":true,"data":[]}`)
	printed := false

	if _, err := client.QueryOrders(context.Background(), OrderQuery{
		StartDate: "2026-09-01", EndDate: "2026-09-28", Status: StatusDelivered, Printed: &printed,
	}); err != nil {
		t.Fatal(err)
	}

	query := (*requests)[0].URL.Query()
	if query.Get("start_date") != "2026-09-01" || query.Get("status") != "3" || query.Get("is_printed") != "0" {
		t.Fatalf("unexpected query: %v", query)
	}

	if _, err := client.QueryOrders(context.Background(), OrderQuery{StartDate: "01/09/2026", EndDate: "2026-09-28"}); err == nil {
		t.Fatal("expected an error for a malformed date")
	}
}

func TestLabelURL(t *testing.T) {
	url, err := New().LabelURL("TH01", "TH02")
	if err != nil {
		t.Fatal(err)
	}
	if url != "https://app.iship.cloud/api/download/pdf?tracks=TH01,TH02" {
		t.Fatalf("unexpected url: %s", url)
	}
	if _, err := New().LabelURL(); err == nil {
		t.Fatal("expected an error with no tracking numbers")
	}
}

func TestParseWebhook(t *testing.T) {
	event, err := ParseWebhook([]byte(`{"courier_code":"THP_eParcel","price":24,"ref_code":"APIS19613","status":"delivered","status_desc":"จัดส่งสำเร็จ","timestamp":1671251342,"tracking":"EA666581364TH","weight":0.16,"is_over_weight":true}`))
	if err != nil {
		t.Fatal(err)
	}
	if event.TrackingNumber != "EA666581364TH" || event.Status != "delivered" || !event.OverWeight {
		t.Fatalf("unexpected event: %+v", event)
	}
	if got := event.OccurredAt().Format("2006-01-02"); got != "2022-12-17" {
		t.Fatalf("unexpected time: %s", got)
	}
	if _, err := ParseWebhook([]byte(`not json`)); err == nil {
		t.Fatal("expected an error for a malformed body")
	}
}

// Live tests call the real public endpoints. Skip with ISHIP_SKIP_LIVE=1.
func TestLivePublicEndpoints(t *testing.T) {
	if os.Getenv("ISHIP_SKIP_LIVE") == "1" {
		t.Skip("ISHIP_SKIP_LIVE=1")
	}

	ctx := context.Background()
	client := New()

	boxes, err := client.Boxes(ctx)
	if err != nil {
		t.Fatalf("Boxes: %v", err)
	}
	if len(boxes) < 3 || boxes[0].Name == "" {
		t.Fatalf("unexpected boxes: %+v", boxes)
	}

	quotes, err := client.RecommendCouriers(ctx, bangkokAddress(), chiangmaiAddress(), Parcel{WeightKg: 1, WidthCm: 14, LengthCm: 20, HeightCm: 6})
	if err != nil {
		t.Fatalf("RecommendCouriers: %v", err)
	}
	if len(quotes) == 0 || quotes[0].CourierCode == "" || quotes[0].TotalPrice == 0 {
		t.Fatalf("unexpected quotes: %+v", quotes)
	}

	if _, err := client.Tracking(ctx, "TH0000000000"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("expected ErrNotFound for an unknown parcel, got %v", err)
	}

	var authErr *AuthError
	if _, err := New(WithToken("definitely-not-a-valid-token")).Balance(ctx); !errors.As(err, &authErr) {
		t.Fatalf("expected *AuthError for a bad token, got %v", err)
	}
}
