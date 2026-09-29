# iShip SDK for Node

Requires Node 18+ (uses the built-in `fetch`). TypeScript types included.

npm cannot install from a subdirectory of a git repository, so install the
tarball attached to a release:

```bash
npm install https://github.com/mcomtech/iship-sdk/releases/download/v1.0.0/iship-sdk-1.0.0.tgz
```

Building it yourself works too: `cd node && npm install && npm pack`.

## Quick start

```ts
import { IShipClient, Category } from "@iship/sdk";

const iship = new IShipClient({ token: process.env.ISHIP_TOKEN });

const from = {
  name: "ร้านทดสอบ", phone: "0812345678", address: "44/247",
  subdistrict: "สายไหม", district: "สายไหม", province: "กรุงเทพมหานคร", zipcode: "10220",
};
const to = {
  name: "คุณสมชาย", phone: "0891234567", address: "12/3",
  subdistrict: "สุเทพ", district: "เมืองเชียงใหม่", province: "เชียงใหม่", zipcode: "50200",
};
const parcel = { weightKg: 1, widthCm: 14, lengthCm: 20, heightCm: 6 };

const quotes = await iship.recommendCouriers(from, to, parcel);
const cheapest = quotes.sort((a, b) => a.total_price - b.total_price)[0];

const order = await iship.createOrder({
  customOrderId: "SHOP-1001", // your order number — also the duplicate guard
  courierCode: cheapest.courier_code,
  from,
  to,
  parcel,
  categoryId: Category.Clothing,
  codAmount: 590,
});

console.log(order.tracking_number, iship.labelUrl([order.tracking_number]));
```

## Errors

```ts
import { ApiError, AuthError, TransportError, ValidationError } from "@iship/sdk";

try {
  await iship.createOrder(request);
} catch (error) {
  if (error instanceof ApiError) {
    // iShip rejected it; error.code is iShip's own code, e.g. "1013".
  } else if (error instanceof AuthError) {
    // Token missing, wrong, or replaced by a newer requestToken() call.
  } else if (error instanceof TransportError) {
    // Network or timeout. Safe to retry with the SAME customOrderId.
  } else if (error instanceof ValidationError) {
    // Rejected before any request was sent.
  }
}
```

## Webhooks (Express)

```ts
import { parseWebhook } from "@iship/sdk";

app.post("/webhooks/iship", express.json(), async (req, res) => {
  const event = parseWebhook(req.body);
  res.sendStatus(200);

  // iShip does not sign webhooks, so confirm the status before acting on it.
  const order = await iship.getOrder(event.trackingNumber);
});
```

## Testing without network

Pass your own `fetch` in the constructor:

```ts
const iship = new IShipClient({ token: "test", fetch: async () => new Response('{"status":true,"data":[]}') });
```

```bash
npm test                      # unit tests plus live calls to the public endpoints
ISHIP_SKIP_LIVE=1 npm test
```
