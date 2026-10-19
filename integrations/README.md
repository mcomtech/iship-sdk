# iShip integrations

Connectors that let shops on other platforms ship with iShip. They are built in
two layers so each new platform reuses the hard parts.

| Directory | What it is |
| --- | --- |
| [`connect/`](connect) | `@iship/connect`: platform-neutral core. Thai address parsing, shipment planning, duplicate-safe creation, status mapping, token encryption, and the Shopify GraphQL documents and mappers. No framework dependencies. |
| [`shopify-app/`](shopify-app) | The Shopify app, built on Shopify's official React Router template. Webhooks, background worker, admin pages in Thai and English. |

TikTok Shop and Odoo are planned on the same core; see [`GUIDE.th.md`](GUIDE.th.md).

## How an order ships

1. Shopify sends `orders/create` or `orders/paid`. The webhook only records the
   order id and returns at once, because Shopify expects an answer within
   seconds and `createOrder` can take close to a minute.
2. The worker reads the order through GraphQL and decides:
   - unpaid and not cash on delivery: wait for `orders/paid`;
   - address cannot be read: **needs attention**, with the reasons;
   - otherwise **ready**, or straight to creation when automatic shipping is on.
3. Creation uses `SHP-<order id>` as iShip's `customOrderId`. A retry after a
   lost response is refused by iShip as a duplicate, and the worker then finds
   the first parcel instead of reporting an error.
4. The order is fulfilled in Shopify with the tracking number, which emails the
   customer if the merchant allows it.
5. Every few hours, or right after an iShip callback, the worker reads the
   parcel's status from iShip and adds a fulfillment event in Shopify.

## Thai addresses

Shopify has no subdistrict or district field. `parseThaiAddress` reads
`ต./ตำบล/แขวง`, `อ./อำเภอ/เขต` and `จ./จังหวัด` out of the address lines, even
when typed without spaces, takes the district from `city`, the province from
the ISO code or name, and expands `อ.เมือง` to `เมือง<province>`. Anything it
cannot find is reported, never invented. Merchants correct those orders on the
order's page, and only the corrected fields are stored.

## Developing

```bash
cd node && npm install && npm run build && cd ..
cd integrations/connect && npm install && npm test && cd ..
cd shopify-app && npm install
npm run typecheck && npm run lint && npm test
npm run check:graphql   # validates every GraphQL document against Shopify's 2026-10 schema
```

`check:graphql` downloads Shopify's published schema once, from the
`@shopify/dev-mcp` package, so it works without access to shopify.dev.

To run the app against a development store, see
[`shopify-app/README.md`](shopify-app/README.md).
