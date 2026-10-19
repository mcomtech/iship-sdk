# iShip for Shopify

Ships Shopify orders with iShip: creates the parcel, fulfils the order with the
tracking number, prints labels and keeps the delivery status up to date.

Built on [Shopify's React Router app template](https://github.com/Shopify/shopify-app-template-react-router)
(commit `48b841a`, MIT licence in `LICENSE.md`). The iShip parts live in
`app/iship/`, the routes `app.*`, `webhooks.orders.*`, `webhooks.customers.*`,
`webhooks.shop.redact` and `webhooks.iship.$secret`, and `@iship/connect`.

## Run it against a development store

Needs Node 22.12+, a Shopify Partner account and a development store.

```bash
cd node && npm install && npm run build && cd ..
cd integrations/connect && npm install && cd ../shopify-app
npm install
npm run config:link        # pick or create the app in your Partner Dashboard
echo "ISHIP_ENCRYPTION_KEY=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")" >> .env
npm run dev                # tunnels, installs on your dev store, opens the app
```

Then open **Settings** in the app, paste an iShip token (use **Test (UAT)**
while testing) and fill in the sender address.

## Configuration

| Variable | Required | Purpose |
| --- | --- | --- |
| `ISHIP_ENCRYPTION_KEY` | yes | 32-byte key (64 hex characters) that encrypts each shop's iShip token. Losing it means every shop has to paste its token again. |
| `ISHIP_WORKER` | no | `off` stops this process from running the background worker, for setups that run it elsewhere. |
| `ISHIP_WORKER_INTERVAL_MS` | no | How often the worker looks for work. Defaults to 15000. |
| `SHOPIFY_*`, `SCOPES` | yes | Set by the Shopify CLI in development, by you in production. |

## Deploying

The worker runs inside the web process, so the host must keep one long-running
Node process (a VPS, Fly.io, Render, Railway). Serverless platforms that stop
the process between requests are not suitable. SQLite is fine for a single
instance on a persistent disk; for several instances, switch Prisma to
PostgreSQL first. Instances coordinate through row leases, so running more
than one is safe.

```bash
# from the repository root
docker build -f integrations/shopify-app/Dockerfile -t iship-shopify-app .
```

## Before submitting to the App Store

- Request **protected customer data** access in the Partner Dashboard for
  name, address and phone. The app reads nothing else about customers.
- Check the scopes in `shopify.app.toml` against what `npm run dev` reports.
  The set was chosen from Shopify's documentation for fulfillment apps and
  could not be verified against a live store here.
- Click through every form once on a real store. The pages use Polaris web
  components inside plain HTML forms, which is how Shopify documents them,
  but they have only been type-checked, not used in a browser.

## Tests

```bash
npm test               # worker and webhook routes against SQLite, with fake Shopify and iShip APIs
npm run check:graphql  # GraphQL documents against the 2026-10 Admin API schema
```
