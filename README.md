# Luora OS

One place for every order from **Shopify, Allegro and Empik**, with shipping labels bought
through **InPost** and **Allegro Delivery (Wysyłam z Allegro)**.

- **Orders:** every marketplace in one list, synced every few minutes. You can filter, search, assign orders, tag them and add notes.
- **Labels:**
  - The app picks the carrier automatically: Allegro orders go through Allegro Delivery with the buyer's method, parcel-locker orders through InPost Paczkomat, everything else through InPost courier.
  - Staff can override the carrier, service and parcel on any order.
  - Labels come as PDF or ZPL, in A6 or A4.
- **Bulk labels:** select many orders, create all their labels at once, then print them as one PDF.
- **Tracking writeback:** the tracking number goes back to the marketplace and the order is marked shipped. Shopify creates a fulfilment, Allegro gets the waybill and `SENT`, and Empik gets tracking plus a shipment confirmation.
- **Workflow:** `new → processing → label created → shipped → delivered`, plus on hold and cancelled, with a full activity log on every order.
- **Stock sync:**
  - The app's stock is the master; every sale lowers it.
  - The new quantity is pushed to every listing with the same SKU.
  - A dry-run switch per account lets you watch what would be sent before going live.
- **Analytics:** revenue per day by marketplace, average order value, top products, labels by carrier, time to ship, and the open backlog.

## Quick start (demo mode, no accounts needed)

Requirements: Node 22.12+, pnpm 10, PostgreSQL 13+.

```bash
pnpm install
cp .env.example .env                 # INTEGRATIONS_MODE=mock is the default here
createdb luora                       # or point DATABASE_URL at any empty database
pnpm db:migrate
pnpm db:seed                         # admin user, demo accounts, shipping rules, products
pnpm dev                             # web app on http://localhost:3000
pnpm worker                          # in a second terminal: sync, labels, tracking, stock
```

Sign in with `ADMIN_EMAIL` / `ADMIN_PASSWORD` from `.env`.

In mock mode nothing is sent anywhere:

- Each marketplace generates 14 fake orders, plus a new one now and then.
- Labels are real PDFs marked "TEST LABEL".

With Docker, run `docker compose up -d --build`, then `docker compose run --rm worker pnpm db:seed`.

## Connecting real accounts

1. In `.env`:
   - Set `INTEGRATIONS_MODE=live`.
   - Set a real `ENCRYPTION_KEY` (`openssl rand -base64 32`). Credentials are stored encrypted with it, so keep it safe.
   - Set `APP_URL` to the public address of the app.
2. Go to **Settings → Integrations**, add each account, and press **Test**.
3. You can also check an account from the command line. This command is read-only: it never changes anything.
   ```bash
   pnpm integration:check "Allegro – main"
   ```

| Account | What you need | Where to get it |
|---|---|---|
| **Shopify** | Shop domain, Client ID, Client secret | Shopify **Dev Dashboard** → create an app, install it on the store. Since January 2026 new apps use client credentials, and tokens expire every 24 h (the app refreshes them automatically). A legacy `shpat_…` token also works. Scopes: `read_orders`, `read_products`, `read_locations`, `write_inventory`, `write_merchant_managed_fulfillment_orders`. |
| **Allegro** | Client ID, Client secret | [apps.developer.allegro.pl](https://apps.developer.allegro.pl) (or the sandbox). Set the redirect URI to `APP_URL/api/oauth/allegro/callback`, save the account, then press **Connect Allegro**. |
| **Empik** | Marketplace URL, API key | Empik seller panel → My account → API key (Empik runs on Mirakl). |
| **InPost** | API token, Organization ID | InPost Manager Paczek → My account → API (ShipX). A sandbox is available. |
| **Allegro Delivery** | A connected Allegro account, an IBAN for cash on delivery | No extra keys: it uses the Allegro account's connection. |

For Shopify you can also add webhooks for `orders/create` and `orders/updated`, pointing at the URL shown on the Integrations page. They make new orders appear within seconds instead of at the next sync.

Parcel locker codes for Shopify orders are read from order note attributes whose key contains `paczkomat`, `inpost_point`, `pickup_point`, and so on (you can change the list per account). If a code isn't found, it can be typed on the order page.

## How it works

```
Next.js app (UI + server actions + API routes) ─┐
                                                 ├── PostgreSQL (orders, labels, stock, pg-boss job queue)
Worker (pnpm worker) ────────────────────────────┘
   ├─ orders-sync       every N min per account → upsert orders, take stock
   ├─ shipment-create   buy label → poll until the carrier confirms → store PDF
   ├─ tracking-push     tracking number → marketplace, order → shipped
   ├─ stock-push        master stock → every linked listing (debounced per account)
   ├─ delivery-check    every 2 h: carrier tracking → order delivered
   └─ shipment-sweep / stock-reconcile   recover stuck labels, nightly stock drift check
```

- Each marketplace and carrier has an adapter in `src/server/integrations/`, made of three files:
  - `client.ts`: authentication, token refresh and retries.
  - `mapper.ts`: provider JSON ↔ the app's own types.
  - `adapter.ts`: the actions the rest of the app calls.
- The rest of the app only talks to the `MarketplaceAdapter` and `CarrierAdapter` interfaces.
- Business logic lives in `src/server/services/`: `orders`, `shipping`, `routing`, `workflow`, `tracking`, `inventory` and `analytics`.

Guards against buying a label twice:

- **Duplicate clicks:** the database allows only one live label per order.
- **Allegro retries:** Allegro label requests reuse the label's own id as the command id.
- **InPost retries:** InPost label requests are never retried automatically.
- **Stuck labels:** a sweep job re-checks labels left "pending" (for example after a worker restart) instead of buying again.

Why each API endpoint was chosen:

| Marketplace / carrier | Endpoints |
|---|---|
| **Allegro** | `/order/events` journal plus `/order/checkout-forms`; `/shipment-management/*` for labels |
| **Empik (Mirakl)** | OR11 (orders), OR21 (accept), OR23 + OR24 (tracking and shipment). Stock uses the **STO01** CSV import, not OF24, because OF24 resets every offer field you don't send. |
| **InPost ShipX** | `POST /v1/organizations/{id}/shipments`, polled until `confirmed`. InPost is moving merchants to its new Global API; that would be one more adapter behind the same interface. |

## Testing

```bash
pnpm lint && pnpm typecheck
pnpm test                                                   # unit + mocked-HTTP adapter tests
TEST_DATABASE_URL=postgres://…/luora_test pnpm test         # + the full flow against PostgreSQL
pnpm build && pnpm start & pnpm worker &                    # then, in mock mode:
PLAYWRIGHT_CHROMIUM_PATH=/path/to/chrome pnpm test:e2e      # browser test: login → label → batch → analytics
```

The adapter tests check requests and responses against payloads written from each provider's API documentation.

**Before going live, run one order through each sandbox.** Some request fields are the most likely to need adjusting against the real APIs, especially:

- InPost parcel and address options,
- Allegro shipment-management package fields,
- Mirakl carrier codes.

## Project layout

```
src/app/(app)/         orders, shipments, inventory, analytics, settings pages
src/app/api/           label downloads, Allegro OAuth, Shopify webhooks, health check
src/server/db/         Drizzle schema, migrations runner, seed
src/server/integrations/{marketplaces,carriers}/   one folder per provider (+ mock)
src/server/services/   business logic
src/server/jobs/       pg-boss queues and handlers
src/worker/            worker entry point
tests/                 Vitest (unit, adapter, database flow) and Playwright (e2e)
drizzle/               SQL migrations (generate with `pnpm db:generate`)
```
