package iship

import (
	"encoding/json"
	"errors"
	"fmt"
)

// ErrNotFound means the tracking number does not exist, or does not belong to
// this account.
var ErrNotFound = errors.New("iship: ไม่พบรายการนี้")

// ErrNoToken means an account endpoint was called without WithToken.
var ErrNoToken = errors.New("iship: ต้องใส่ API token ก่อนเรียกเมธอดนี้")

// APIError means iShip rejected the operation.
//
// The API answers HTTP 200 with {"status": false, ...} in that case, so this
// error — not the status code — is how a failure surfaces. Code is iShip's own
// code, such as "1004" (not found) or "1013" (unknown courier).
type APIError struct {
	Code    string
	Message string
	// Payload is the whole response body, for codes this SDK does not model.
	Payload map[string]any
}

func (e *APIError) Error() string { return fmt.Sprintf("iship: %s (code %s)", e.Message, e.Code) }

// AuthError means the token is missing, wrong, or was replaced by a newer
// RequestToken call.
type AuthError struct{ Message string }

func (e *AuthError) Error() string { return "iship: " + e.Message }

// TransportError means the request never produced a usable response: a network
// failure, a timeout, or a body that was not JSON.
type TransportError struct {
	Err error
}

func (e *TransportError) Error() string { return "iship: " + e.Err.Error() }
func (e *TransportError) Unwrap() error { return e.Err }

// errorsAs is errors.As, named so the call sites read clearly.
func errorsAs(err error, target any) bool { return errors.As(err, target) }

// unwrap turns an iShip response into out, or into an error.
func unwrap(statusCode int, raw []byte, out any) error {
	var envelope map[string]any
	if err := json.Unmarshal(raw, &envelope); err != nil {
		// Endpoints such as /api/boxes answer with a bare JSON array.
		if len(raw) > 0 && raw[0] == '[' {
			if out == nil {
				return nil
			}
			if err := json.Unmarshal(raw, out); err != nil {
				return &TransportError{Err: err}
			}
			return nil
		}
		return &TransportError{Err: fmt.Errorf("iShip API ตอบกลับไม่ใช่ JSON (HTTP %d)", statusCode)}
	}

	if statusCode == 401 || envelope["message"] == "Unauthenticated" {
		return &AuthError{Message: "API token ไม่ถูกต้องหรือถูกแทนที่ด้วย token ใหม่แล้ว"}
	}

	if status, ok := envelope["status"]; ok && !isSuccess(status) {
		return &APIError{Code: codeOf(envelope, statusCode), Message: messageOf(envelope), Payload: envelope}
	}
	if statusCode >= 400 {
		return &APIError{Code: codeOf(envelope, statusCode), Message: messageOf(envelope), Payload: envelope}
	}

	if out == nil {
		return nil
	}

	// Endpoints that carry an envelope return their payload under "data"; the
	// rest (check-price) answer with the payload itself.
	payload := raw
	if data, ok := envelope["data"]; ok {
		encoded, err := json.Marshal(data)
		if err != nil {
			return &TransportError{Err: err}
		}
		payload = encoded
	}

	if err := json.Unmarshal(payload, out); err != nil {
		return &TransportError{Err: err}
	}
	return nil
}

func isSuccess(status any) bool {
	switch v := status.(type) {
	case bool:
		return v
	case float64:
		return v == 1
	case string:
		return v == "success" || v == "1"
	default:
		return false
	}
}

func codeOf(envelope map[string]any, statusCode int) string {
	switch code := envelope["code"].(type) {
	case string:
		return code
	case float64:
		return fmt.Sprintf("%.0f", code)
	default:
		return fmt.Sprint(statusCode)
	}
}

func messageOf(envelope map[string]any) string {
	for _, key := range []string{"message", "msg"} {
		if text, ok := envelope[key].(string); ok && text != "" {
			return text
		}
	}
	return "iShip API ปฏิเสธคำขอนี้"
}
