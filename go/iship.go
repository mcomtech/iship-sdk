// Package iship is a client for the iShip shipping API (https://app.iship.cloud).
//
//	client := iship.New(iship.WithToken("YOUR_API_TOKEN"))
//	order, err := client.CreateOrder(ctx, iship.CreateOrder{ /* ... */ })
package iship

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

const (
	// Production is the live iShip API.
	Production = "https://app.iship.cloud"
	// UAT is the test environment. Orders created there are not real shipments.
	UAT = "https://app-uat.iship.cloud"
)

// Client talks to the iShip API. It is safe for concurrent use.
type Client struct {
	baseURL string
	token   string
	http    *http.Client
}

// Option configures a Client.
type Option func(*Client)

// WithToken sets the account's API token. Account endpoints need it.
func WithToken(token string) Option { return func(c *Client) { c.token = token } }

// WithBaseURL points the client at another environment, such as UAT.
func WithBaseURL(baseURL string) Option {
	return func(c *Client) { c.baseURL = strings.TrimRight(baseURL, "/") }
}

// WithHTTPClient replaces the underlying HTTP client. The default allows 120s
// per request, because CreateOrder can take close to a minute on some accounts.
func WithHTTPClient(hc *http.Client) Option { return func(c *Client) { c.http = hc } }

// New builds a client. Without WithToken it can still call the public endpoints:
// Boxes, RecommendCouriers, Tracking and LabelURL.
func New(opts ...Option) *Client {
	c := &Client{baseURL: Production, http: &http.Client{Timeout: 120 * time.Second}}
	for _, opt := range opts {
		opt(c)
	}
	return c
}

// RequestToken exchanges phone and password for an API token.
//
// An account has exactly one token: this call replaces it, so every existing
// integration using the old token stops working immediately.
func (c *Client) RequestToken(ctx context.Context, phone, password string) (Token, error) {
	var out Token
	err := c.do(ctx, http.MethodPost, "/api/auth/requestToken", false, nil,
		map[string]string{"phone": phone, "password": password}, &out)
	return out, err
}

// ---------------------------------------------------------------- public

// Boxes lists the standard box sizes, in centimetres. No token required.
func (c *Client) Boxes(ctx context.Context) ([]Box, error) {
	var out []Box
	err := c.do(ctx, http.MethodGet, "/api/boxes", false, nil, nil, &out)
	return out, err
}

// RecommendCouriers prices every courier for this route and parcel, at list
// prices. Use CheckPrice for the prices this account actually pays.
func (c *Client) RecommendCouriers(ctx context.Context, from, to Address, parcel Parcel) ([]CourierQuote, error) {
	body := routeFields(from, to, parcel)
	body["user_id"] = nil

	var out []CourierQuote
	err := c.do(ctx, http.MethodPost, "/api/v2/courier/recommend", false, nil, body, &out)
	return out, err
}

// Tracking returns public tracking for a parcel, or ErrNotFound when the number
// is unknown to iShip.
func (c *Client) Tracking(ctx context.Context, trackNo string) (*Tracking, error) {
	var out []Tracking
	if err := c.do(ctx, http.MethodGet, "/api/v2/tracking/"+url.PathEscape(trackNo), false, nil, nil, &out); err != nil {
		return nil, err
	}
	if len(out) == 0 {
		return nil, ErrNotFound
	}
	return &out[0], nil
}

// LabelURL is the public URL of the A6 label PDF for these tracking numbers.
// Anyone with the URL can open it, so treat it as private.
func (c *Client) LabelURL(trackNos ...string) (string, error) {
	if len(trackNos) == 0 {
		return "", fmt.Errorf("iship: ต้องระบุเลขพัสดุอย่างน้อย 1 รายการ")
	}
	escaped := make([]string, len(trackNos))
	for i, t := range trackNos {
		escaped[i] = url.QueryEscape(t)
	}
	return c.baseURL + "/api/download/pdf?tracks=" + strings.Join(escaped, ","), nil
}

// DownloadLabel fetches the label PDF itself.
func (c *Client) DownloadLabel(ctx context.Context, trackNos ...string) ([]byte, error) {
	labelURL, err := c.LabelURL(trackNos...)
	if err != nil {
		return nil, err
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, labelURL, nil)
	if err != nil {
		return nil, &TransportError{Err: err}
	}
	res, err := c.http.Do(req)
	if err != nil {
		return nil, &TransportError{Err: err}
	}
	defer res.Body.Close()

	if res.StatusCode >= 400 {
		return nil, &APIError{Code: fmt.Sprint(res.StatusCode), Message: "ไม่สามารถดาวน์โหลดใบปะหน้าได้"}
	}
	return io.ReadAll(res.Body)
}

// ------------------------------------------------------------ token only

// Couriers lists the couriers this account may use.
func (c *Client) Couriers(ctx context.Context) ([]Courier, error) {
	var out []Courier
	err := c.do(ctx, http.MethodGet, "/api/courier_code", true, nil, nil, &out)
	return out, err
}

// OrderStatuses lists the status ids used by QueryOrders. The same values are
// available as constants: StatusDelivered and friends.
func (c *Client) OrderStatuses(ctx context.Context) ([]OrderStatusInfo, error) {
	var out []OrderStatusInfo
	err := c.do(ctx, http.MethodGet, "/api/order_statuses", true, nil, nil, &out)
	return out, err
}

// CheckPrice prices one courier at this account's rates, including remote-area fees.
func (c *Client) CheckPrice(ctx context.Context, courierCode string, from, to Address, parcel Parcel) (Price, error) {
	body := routeFields(from, to, parcel)
	body["courier_code"] = courierCode

	var out Price
	err := c.do(ctx, http.MethodPost, "/api/v2/check-price", true, nil, body, &out)
	return out, err
}

// Balance reports the credit left on the account.
func (c *Client) Balance(ctx context.Context) (Balance, error) {
	var out Balance
	err := c.do(ctx, http.MethodGet, "/api/v2/check-balance", true, nil, nil, &out)
	return out, err
}

// CreateOrder creates a shipment and spends the account's credit.
//
// Retrying with the same CustomOrderID is safe: iShip rejects the duplicate
// rather than creating a second parcel.
func (c *Client) CreateOrder(ctx context.Context, order CreateOrder) (CreatedOrder, error) {
	body, err := order.payload()
	if err != nil {
		return CreatedOrder{}, err
	}

	var out CreatedOrder
	err = c.do(ctx, http.MethodPost, "/api/create_order", true, nil, body, &out)
	return out, err
}

// GetOrder returns one order belonging to this account, or ErrNotFound.
func (c *Client) GetOrder(ctx context.Context, trackNo string) (*Order, error) {
	var out Order
	err := c.do(ctx, http.MethodGet, "/api/get_order/"+url.PathEscape(trackNo), true, nil, nil, &out)

	var apiErr *APIError
	if errorsAs(err, &apiErr) && apiErr.Code == "1004" {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return &out, nil
}

// QueryOrders lists this account's orders created in a date range.
func (c *Client) QueryOrders(ctx context.Context, query OrderQuery) ([]Order, error) {
	values, err := query.values()
	if err != nil {
		return nil, err
	}

	var out []Order
	err = c.do(ctx, http.MethodGet, "/api/query_orders", true, values, nil, &out)
	return out, err
}

// TraceOrder returns the courier scan history for one of this account's orders.
func (c *Client) TraceOrder(ctx context.Context, trackNo string) (Trace, error) {
	var out Trace
	err := c.do(ctx, http.MethodPost, "/api/traces", true, nil, map[string]string{"track_no": trackNo}, &out)
	return out, err
}

// CancelOrder cancels an order the courier has not collected yet.
//
// iShip reports success even when the courier refuses, so this reads the order
// back and returns an *APIError with Code "not_cancelled" if it is still active.
func (c *Client) CancelOrder(ctx context.Context, trackNo string) (*Order, error) {
	order, err := c.GetOrder(ctx, trackNo)
	if err != nil {
		return nil, err
	}

	body := map[string]string{"courier_code": order.CourierCode, "track_no": trackNo}
	if err := c.do(ctx, http.MethodPost, "/api/cancel_order", true, nil, body, nil); err != nil {
		return nil, err
	}

	after, err := c.GetOrder(ctx, trackNo)
	if err != nil {
		return nil, err
	}
	if after.Status != StatusCancelled && after.CancelAt == "" {
		return after, &APIError{
			Code:    "not_cancelled",
			Message: "ยกเลิกไม่สำเร็จ สถานะปัจจุบัน: " + after.StatusName,
		}
	}
	return after, nil
}

// DeleteOrder removes an order from the account. Irreversible.
func (c *Client) DeleteOrder(ctx context.Context, trackNo string) error {
	return c.do(ctx, http.MethodPost, "/api/confirm/delete_order", true, nil, map[string]string{"track_no": trackNo}, nil)
}

// RequestPickup asks a courier to collect parcels. This dispatches a real pickup.
func (c *Client) RequestPickup(ctx context.Context, pickup PickupRequest) (Pickup, error) {
	body, err := pickup.payload()
	if err != nil {
		return Pickup{}, err
	}

	var out Pickup
	err = c.do(ctx, http.MethodPost, "/api/request_courier", true, nil, body, &out)
	return out, err
}

// CancelPickup cancels a pickup booked with RequestPickup.
func (c *Client) CancelPickup(ctx context.Context, ticketPickupID string) error {
	return c.do(ctx, http.MethodGet, "/api/cancel-notify/"+url.PathEscape(ticketPickupID), true, nil, nil, nil)
}

// --------------------------------------------------------------- internal

func routeFields(from, to Address, parcel Parcel) map[string]any {
	fields := map[string]any{}
	for k, v := range from.payload("src") {
		fields[k] = v
	}
	for k, v := range to.payload("dst") {
		fields[k] = v
	}
	for k, v := range parcel.payload() {
		fields[k] = v
	}
	return fields
}

func (c *Client) do(ctx context.Context, method, path string, auth bool, query url.Values, body, out any) error {
	if auth && c.token == "" {
		return ErrNoToken
	}

	endpoint := c.baseURL + path
	if len(query) > 0 {
		endpoint += "?" + query.Encode()
	}

	var reader io.Reader
	if body != nil {
		encoded, err := json.Marshal(body)
		if err != nil {
			return fmt.Errorf("iship: encode request: %w", err)
		}
		reader = bytes.NewReader(encoded)
	}

	req, err := http.NewRequestWithContext(ctx, method, endpoint, reader)
	if err != nil {
		return &TransportError{Err: err}
	}
	req.Header.Set("Accept", "application/json")
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if c.token != "" {
		req.Header.Set("Authorization", "Bearer "+c.token)
	}

	res, err := c.http.Do(req)
	if err != nil {
		return &TransportError{Err: err}
	}
	defer res.Body.Close()

	raw, err := io.ReadAll(res.Body)
	if err != nil {
		return &TransportError{Err: err}
	}

	return unwrap(res.StatusCode, raw, out)
}
