package iship

import (
	"encoding/json"
	"fmt"
	"time"
)

// WebhookEvent is a parcel status callback from iShip.
//
// SECURITY: iShip does not sign webhook requests, so anyone who learns your
// callback URL can post a fake event. Treat a webhook as a signal to call
// GetOrder for the authoritative status, not as proof by itself.
type WebhookEvent struct {
	TrackingNumber    string  `json:"tracking"`
	RefCode           string  `json:"ref_code"`
	CourierCode       string  `json:"courier_code"`
	Status            string  `json:"status"`
	StatusDescription string  `json:"status_desc"`
	Price             float64 `json:"price"`
	WeightKg          float64 `json:"weight"`
	WidthCm           float64 `json:"width"`
	LengthCm          float64 `json:"length"`
	HeightCm          float64 `json:"height"`
	RemoteArea        int     `json:"remote_area"`
	OverSize          bool    `json:"is_over_size"`
	OverWeight        bool    `json:"is_over_weight"`
	Timestamp         int64   `json:"timestamp"`
}

// OccurredAt is the event time in Bangkok time.
func (e WebhookEvent) OccurredAt() time.Time {
	return time.Unix(e.Timestamp, 0).In(bangkok)
}

var bangkok = time.FixedZone("ICT", 7*60*60)

// ParseWebhook decodes a status callback body.
func ParseWebhook(body []byte) (WebhookEvent, error) {
	var event WebhookEvent
	if err := json.Unmarshal(body, &event); err != nil {
		return WebhookEvent{}, &TransportError{Err: err}
	}
	if event.TrackingNumber == "" {
		return WebhookEvent{}, &TransportError{Err: fmt.Errorf("webhook payload ไม่มีเลขพัสดุ")}
	}
	return event, nil
}
