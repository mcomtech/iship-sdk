# iShip SDK

Official client libraries for the iShip shipping API (`https://app.iship.cloud`).

| Language | Package | Directory |
| --- | --- | --- |
| PHP 8.1+ | `iship/sdk` | [`php/`](php) |
| Go 1.21+ | `github.com/mcomtech/iship-sdk/go` | [`go/`](go) |
| Node 18+ / TypeScript | `@iship/sdk` | [`node/`](node) |

All three expose the same operations, the same field names and the same error
behaviour, so an integration can be ported between them by translating syntax only.

## Install

The three SDKs live in one repository, so each language installs it a little
differently. None of them needs a package-registry account.

### PHP

Add this repository to your `composer.json`, then require the package:

```bash
composer config repositories.iship vcs https://github.com/mcomtech/iship-sdk
composer require iship/sdk:^1.0
```

### Go

```bash
go get github.com/mcomtech/iship-sdk/go@latest
```

```go
import iship "github.com/mcomtech/iship-sdk/go"
```

The Go module lives in the `go/` subdirectory, so its version tags are prefixed:
`go/v1.0.0`, not `v1.0.0`.

### Node

npm cannot install from a subdirectory of a git repository, so install the
tarball attached to a release:

```bash
npm install https://github.com/mcomtech/iship-sdk/releases/download/v1.0.0/iship-sdk-1.0.0.tgz
```

```ts
import { IShipClient } from "@iship/sdk";
```

To pin a different version, change the tag in the URL. Building it yourself works
too: `cd node && npm install && npm pack`.

## Upgrading

Each release is tagged `v<version>` (plus `go/v<version>` for Go). `composer update
iship/sdk` and `go get -u` pick up new tags; for Node, install the newer tarball URL.

## Getting a token

`requestToken(phone, password)` returns the account's API token.

> **An account has exactly one token.** Requesting a new one immediately invalidates
> the previous token, so every existing integration on that account stops working.
> Request a token once, store it, and reuse it.

The token can do everything the account can do, including creating shipments that
spend credit. Treat it as a password.

## Operations

| Method | Endpoint | Token | Notes |
| --- | --- | --- | --- |
| `requestToken` | `POST /api/auth/requestToken` | – | Replaces the account's existing token |
| `boxes` | `GET /api/boxes` | – | Standard box sizes |
| `recommendCouriers` | `POST /api/v2/courier/recommend` | – | List prices for every courier |
| `tracking` | `GET /api/v2/tracking/{trackNo}` | – | Public tracking, no account data |
| `couriers` | `GET /api/courier_code` | ✓ | Couriers this account may use |
| `orderStatuses` | `GET /api/order_statuses` | ✓ | Status ids for `queryOrders` |
| `checkPrice` | `POST /api/v2/check-price` | ✓ | Price for this account |
| `balance` | `GET /api/v2/check-balance` | ✓ | Remaining credit |
| `createOrder` | `POST /api/create_order` | ✓ | **Spends credit** |
| `getOrder` | `GET /api/get_order/{trackNo}` | ✓ | Scoped to the token's account |
| `queryOrders` | `GET /api/query_orders` | ✓ | Scoped to the token's account |
| `traceOrder` | `POST /api/traces` | ✓ | Scoped to the token's account |
| `cancelOrder` | `POST /api/cancel_order` | ✓ | Only before pickup |
| `deleteOrder` | `POST /api/confirm/delete_order` | ✓ | Irreversible |
| `requestPickup` | `POST /api/request_courier` | ✓ | Dispatches a real courier |
| `cancelPickup` | `GET /api/cancel-notify/{id}` | ✓ | |
| `labelUrl` / `downloadLabel` | `GET /api/download/pdf?tracks=` | – | A6 label PDF |

## What the SDK handles for you

**Errors that arrive as HTTP 200.** The API answers `200 OK` with `{"status": false,
"code": "1004", "message": "..."}` when an operation fails. Code that only checks the
status code treats those as successes. The SDK raises `ApiError` (PHP `ApiException`,
Go `*APIError`) instead, carrying `code`, `message` and the raw payload.

**Thai address fields.** The API's `*_district` field holds the *subdistrict*
(ตำบล/แขวง) and `*_amphure` holds the *district* (อำเภอ/เขต). The SDK's `Address`
type names them `subdistrict` and `district` and maps them on the wire, so the
names match what you would write on an envelope.

**Duplicate shipments.** `createOrder` requires `customOrderId`. The API rejects a
repeat of the same value, so retrying a request whose response you never saw cannot
create a second parcel or spend credit twice. Reuse the same value when you retry.

**Slow creates.** `createOrder` takes close to a minute on some accounts, so the
default timeout is 120s and the SDK never retries a call that spends credit.

**Environment switching.** Point `baseUrl` at `https://app-uat.iship.cloud` for UAT.

## Webhooks

`Webhook.parse(body)` turns a status callback into a typed value.

> Webhook requests are not signed. Treat an event as a signal to call `getOrder`
> for the authoritative status rather than as proof of delivery on its own, keep
> your callback URL secret, and restrict it to iShip's source addresses where you can.

## Not covered yet

SameDay (MakeSend), Lalamove and international shipping. They live under
`/api/v2/express/*` and `/api/inter/*` and follow different conventions.
