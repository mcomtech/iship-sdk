# iShip SDK for Go

Requires Go 1.21+. No dependencies outside the standard library.

```bash
go get bitbucket.org/project-iship/iship-sdk/go
```

## Quick start

```go
package main

import (
	"context"
	"fmt"
	"os"
	"sort"

	iship "bitbucket.org/project-iship/iship-sdk/go"
)

func main() {
	ctx := context.Background()
	client := iship.New(iship.WithToken(os.Getenv("ISHIP_TOKEN")))

	from := iship.Address{
		Name: "ร้านทดสอบ", Phone: "0812345678", Address: "44/247",
		Subdistrict: "สายไหม", District: "สายไหม", Province: "กรุงเทพมหานคร", Zipcode: "10220",
	}
	to := iship.Address{
		Name: "คุณสมชาย", Phone: "0891234567", Address: "12/3",
		Subdistrict: "สุเทพ", District: "เมืองเชียงใหม่", Province: "เชียงใหม่", Zipcode: "50200",
	}
	box := iship.Parcel{WeightKg: 1, WidthCm: 14, LengthCm: 20, HeightCm: 6}

	quotes, err := client.RecommendCouriers(ctx, from, to, box)
	if err != nil {
		panic(err)
	}
	sort.Slice(quotes, func(i, j int) bool { return quotes[i].TotalPrice < quotes[j].TotalPrice })

	order, err := client.CreateOrder(ctx, iship.CreateOrder{
		CustomOrderID: "SHOP-1001", // your order number — also the duplicate guard
		CourierCode:   quotes[0].CourierCode,
		From:          from,
		To:            to,
		Parcel:        box,
		CategoryID:    iship.CategoryClothing,
		CODAmount:     590,
	})
	if err != nil {
		panic(err)
	}

	url, _ := client.LabelURL(order.TrackingNumber)
	fmt.Println(order.TrackingNumber, url)
}
```

## Errors

```go
order, err := client.CreateOrder(ctx, request)

var apiErr *iship.APIError
var authErr *iship.AuthError
var transportErr *iship.TransportError

switch {
case errors.As(err, &apiErr):
	// iShip rejected it; apiErr.Code is iShip's own code, e.g. "1013".
case errors.As(err, &authErr):
	// Token missing, wrong, or replaced by a newer RequestToken call.
case errors.As(err, &transportErr):
	// Network or timeout. Safe to retry with the SAME CustomOrderID.
case errors.Is(err, iship.ErrNotFound):
	// Unknown tracking number, or it belongs to another account.
}
```

Cancellation and timeouts come from the `context.Context` you pass in; the
client's own timeout is 120s by default, because `CreateOrder` can take close to
a minute on some accounts.

## Tests

```bash
go test ./...                      # unit tests plus live calls to the public endpoints
ISHIP_SKIP_LIVE=1 go test ./...
```

On macOS with Go 1.22 and Xcode 16's linker, `go test` can abort with
`missing LC_UUID`. Run `CGO_ENABLED=0 go test ./...`, or use Go 1.23+.
