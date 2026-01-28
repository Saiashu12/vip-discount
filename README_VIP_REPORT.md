## VIP Reward & Perk System — Codebase Report

This document is a detailed, line-aware report of the VIP reward / perk system implemented in this repository. It explains how the current implementation works, lists each relevant file and its responsibilities, highlights inconsistencies and gaps, and provides recommended fixes and next steps.

Date: 2026-01-25

---

## Quick summary

- VIP customers are detected by a `VIP` tag on the Shopify Customer object.
- When an order is created, the app listens to the order creation webhook and credits points equal to 2 × order subtotal (floored to an integer).
- VIP points are stored in a `vipCustomer` table accessed via Prisma.
- The storefront theme block (`VIP_Reward.liquid`) displays available points and lets the customer enter points to redeem. Redeem posts to a server route which creates a Shopify discount code scoped to that customer and decrements their points.

Important caveats (found in the code):

- The codebase contains naming and schema inconsistencies (e.g., `totalPoints` vs `rewardPoints`, transaction fields mismatch). These must be reconciled before production use.
- There is no implemented logic to exclude special products from coupon application; the admin UI and exclusion enforcement are missing.

---

## Contract (short)

- Inputs: Shopify order webhooks; app-proxy requests from storefront (customerId); admin-authenticated requests for redeem.
- Outputs: VIP points credited to DB; a generated single-use discount code for the requesting customer; JSON responses for app proxy endpoints.
- Error modes: invalid webhook payload (ignored), non-VIP customers (ignored), insufficient points during redeem (400 error), invalid app-proxy signature (401), internal errors (500).

---

## File-by-file analysis

Below are the relevant files and what each one does (line-aware explanation and observations).

### app/shopify.server.js

- Purpose: Configures the Shopify App object (from @shopify/shopify-app-react-router). Exports `authenticate`, `registerWebhooks`, `sessionStorage`, etc.
- Notes:
  - Uses Prisma for session storage via `PrismaSessionStorage(prisma)`.
  - Important exported helpers used by other code: `authenticate`, `login`, `registerWebhooks`.

### app/db.server.js

- Purpose: Exports a singleton Prisma client instance usable across the app.
- Notes:
  - Uses a global variable in non-production to avoid multiple Prisma clients in dev.

### prisma/schema.prisma

- Purpose: Defines the database models used by Prisma.
- Current models (as shipped):
  - `Session` — Shopify app sessions.
  - `VipCustomer` with fields: id, shop, customerId (unique), rewardPoints (Int), createdAt, updatedAt.
  - `RewardTransaction` with fields: id, customerId, orderId, pointsEarned, pointsRedeemed, createdAt.
- Observations and inconsistencies:
  - The schema uses `rewardPoints` on `VipCustomer`. Several route handlers reference `totalPoints` instead. These are not the same name and will cause runtime errors unless reconciled.
  - `RewardTransaction` uses fields `pointsEarned` and `pointsRedeemed` while some handlers create transactions using different fields such as `points`, `type`, or `pointsRedeemed: null`. This mismatch must be fixed.

### app/routes/webhooks.orders.create.jsx

- Purpose: Handles the order creation webhook and credits VIP points.
- Behavior (step-by-step):
  1. Authenticates the webhook via `authenticate.webhook(request)` — obtains `admin`, `payload`, and `session`.
  2. Reads the customer from the webhook payload. If no customer, returns early.
  3. Uses the Admin GraphQL API to fetch the customer's tags via `admin.graphql` and checks whether `tags.includes('VIP')`.
  4. If the customer has the VIP tag, calculates points as `Math.floor(subtotal * 2)` where `subtotal` is `parseFloat(payload.subtotal_price || '0')`.
  5. Upserts a `vipCustomer` row using `db.vipCustomer.upsert({ where: { customerId }, update: { rewardPoints: { increment: points } }, create: { shop, customerId, rewardPoints: points } })`.
  6. Creates a `rewardTransaction` row with `{ customerId, orderId, pointsEarned: points, pointsRedeemed: null }`.
  7. Returns 200 "VIP points credited".
- Observations:
  - This route writes `rewardPoints`, which matches the Prisma schema, but other files expect `totalPoints`. Decide on one canonical field name.
  - The transaction creation uses `pointsEarned` which matches prisma schema; later redeem code uses different transaction fields. Standardize transactions.

### app/routes/api.vip-points.jsx

- Purpose: App-proxy endpoint to return the customer's available points to the storefront block.
- Behavior:
  1. Calls `authenticate.public.appProxy(request)` to validate the request originating from the store (app proxy signature).
  2. Reads `customerId` from query string.
  3. If `customerId` provided, finds `vipCustomer` by `customerId` and returns `{ points }` where currently `points = vip?.totalPoints || 0`.
- Observations:
  - This endpoint reads `totalPoints` but the Prisma schema currently defines `rewardPoints`. This will produce `undefined` and return 0 unless fixed.

### app/routes/redeem-points.jsx (admin-authenticated redeem handler)

- Purpose: Generates a discount code when the app owner (admin session) invokes the redeem action. This file appears to be the server-side endpoint used by the app to create coupons.
- Behavior (step-by-step):
  1. Authenticates the request using `authenticate.admin(request)` — therefore this route expects admin-level session credentials.
  2. Parses JSON body `{ customerId, points }`.
  3. Validates the customer exists and has enough points: `if (!vip || vip.totalPoints < points) return 400`.
  4. Creates a discount code using the Admin GraphQL API via `discountCodeBasicCreate` mutation, with:
     - code and title = `VIP-${customerId}-${Date.now()}`
     - `customerSelection` specifying the single allowed customer: `customers: ["gid://shopify/Customer/${customerId}"]`.
     - `usageLimit: 1` (single-use), `startsAt` now, and `customerGets.fixedAmount.amount = discountValue`.
  5. Decrements the customer's `totalPoints` by `points` via `db.vipCustomer.update({ data: { totalPoints: { decrement: points } } })`.
  6. Creates a `rewardTransaction` with `{ customerId, orderId: 'REDEEM', points, type: 'DEBIT' }`.
  7. Returns `{ discountCode: code }`.
- Observations & issues:
  - This file uses `totalPoints` and `rewardTransaction` fields `points` and `type`, which do not match the `schema.prisma` fields. This will raise runtime errors.
  - The route requires admin-level authentication (`authenticate.admin`) which means the redeem call must be proxied through a server-side admin session. The theme block calls `POST /apps/vip/redeem-points` directly from the browser; that would not include admin credentials. However, there is an alternate app-proxy handler (see below) that may be intended for storefront calls.

### app/routes/apps/vip/redeem-points.jsx (app-proxy variant)

- Purpose: An app-proxy aware version of redeem-points; currently it returns a logged JSON and demonstrates app-proxy auth checks.
- Behavior:
  - GET handler: authenticates app proxy and returns JSON stub.
  - POST handler: authenticates app proxy, parses body (JSON or form), looks up vip by `customerId` and logs the result, then returns `{ ok: true, logged: true }`.
- Observations:
  - This route does not create discounts or decrement points; it's a stub/logging endpoint. The theme block posts to `/apps/vip/redeem-points` without knowing whether it should hit the app-proxy version or the admin-auth route. The theme block posts to `/apps/vip/redeem-points` (path used by the app proxy), so this app-proxy route will run — but it does not create coupons. The admin-level `app/routes/redeem-points.jsx` is the one that creates coupons, but it is not reachable from the storefront without proper server mediation.

### extensions/theme-extension/blocks/VIP_Reward.liquid

- Purpose: Theme block inserted into the storefront (e.g., cart) to display available points and provide redeem UI.
- Behavior (line-by-line summary):
  - Renders markup: a placeholder showing "Available Reward Points" and an input and button to redeem.
  - Sets `const customerId = '{{ customer.id }}';` (liquid variable inserted into JS), then fetches points from `/apps/vip/api/vip-points?customerId=${customerId}`.
  - On click of Redeem, sends a POST to `/apps/vip/redeem-points` with `{ customerId, points }` and expects `{ discountCode }`. If returned, it navigates to `/discount/${discountCode}` which applies a discount code to the cart URL in Shopify storefronts.
- Observations:
  - This block expects the app-proxy `/apps/vip/api/vip-points` to return points and `/apps/vip/redeem-points` to create a discount for the customer. In the current codebase, the proxy `apps/vip/redeem-points.jsx` does not create a discount — it only logs. The actual discount creation is in `app/routes/redeem-points.jsx`, which expects admin auth.
  - Redirecting to `/discount/<code>` is a valid Shopify storefront approach to apply a discount code, but it does not enforce checks on whether cart contains excluded products (there is no exclusion logic implemented).

---

## Data model issues & recommended schema changes

Observed mismatches:

- Code expects `vipCustomer.totalPoints` in several places (api.vip-points, redeem endpoint). Prisma schema uses `rewardPoints`.
- Transaction model used by some handlers differs from `RewardTransaction` in schema. Some code writes `pointsEarned`/`pointsRedeemed`, other code writes `points` and `type`.

Recommended schema (one consistent design):

model VipCustomer {
id Int @id @default(autoincrement())
shop String
customerId String @unique
totalPoints Int @default(0)
createdAt DateTime @default(now())
updatedAt DateTime @updatedAt
}

model RewardTransaction {
id Int @id @default(autoincrement())
customerId String
orderId String
points Int // positive for credit, negative for redeem
type String // 'CREDIT' | 'DEBIT' | other
metadata Json?
createdAt DateTime @default(now())
}

Notes:

- Rename fields to `totalPoints` for clarity and update all code references.
- Use a single `points` field in transactions with `type` to indicate credit or debit (keeps schema simpler).

---

## Redeem / coupon generation correctness and flow

Current behavior (intended):

- Storefront posts to `/apps/vip/redeem-points` with `{ customerId, points }`.
- Backend validates eligibility and creates a single-use discount code scoped to the specific customer via `discountCodeBasicCreate` GraphQL mutation.
- Backend decrements customer's points and logs a transaction.
- Frontend redirects shopper to `/discount/<code>` so Shopify applies the code to the cart.

Gaps actually present in the codebase:

- The app-proxy endpoint handler `app/routes/apps/vip/redeem-points.jsx` is a stub and does not create discounts.
- The real discount creation happens in `app/routes/redeem-points.jsx`, which requires `authenticate.admin(request)` (admin session). The storefront cannot directly call an admin-auth route.
- No server-side check verifies cart contents for excluded products before creating the discount.

Suggested approaches to fix redeem flow:

1. Decide whether coupon creation should happen via an app-proxy flow (signed request from storefront) or via the backend admin session.
   - For app-proxy: implement discount creation in the app-proxy POST handler and sign/validate app-proxy requests. The backend will need to use stored app admin session or an app access method to call the Admin API.
   - For admin-only creation: the storefront should call the app server (app proxy or regular endpoint) which will then internally call the admin-auth route code using stored session. This requires the app to hold an offline access token for the shop and be able to call Admin API on behalf of the shop.
2. Implement cart-check prior to creating coupon: use Storefront/Cart APIs or inspect the cart via app proxy request body to detect excluded products. If excluded products are present, respond with a clear error and do not create coupon.
3. Ensure the created discount has `customerSelection` set to the intended customer and `usageLimit: 1` (already present), and that we store the discount code in DB associated with that transaction so you can later validate usage.

---

## Excluded products and admin marking

What's missing:

- No admin UI or API to mark products as "special / excluded" exists.
- No logic in discount creation or redemption to exclude carts containing such products.

Suggested implementation:

1. Add a new Prisma table `ExcludedProduct { id, shop, productId, note, createdAt }`.
2. Build an admin UI inside the app (or an embedded page) to add/remove excluded products. Store product global id or numeric ID.
3. When creating a discount, set the discount's `appliesOncePerCustomer` or product-specific selectors appropriately. If Shopify GraphQL API supports excluding products directly, use prerequisites or product selectors; otherwise, do server-side cart check and refuse to create (or apply) the coupon.
4. Validate in redeem endpoint: fetch cart contents (either posted by app-proxy or via Storefront API) and check for excluded product IDs.

---

## Security and validation notes

- App-proxy endpoints must validate signatures — the code uses `authenticate.public.appProxy(request)` in several places; keep that.
- The current redeem handler that actually creates discounts requires admin authentication. If you open discount creation to app-proxy requests, ensure you still use stored admin session tokens on server to call the Admin API — do not embed admin secrets into the browser.
- Always validate `customerId` server-side: confirm the customer exists in the shop and owns the session/interaction. The code partially does that.
- Rate-limit and ensure the discount creation is one-off; store created discount IDs and associate with customer for later auditing.

---

## Endpoints & routes (summary)

- POST /apps/vip/redeem-points (app-proxy stub): `app/routes/apps/vip/redeem-points.jsx` — currently logs and returns OK; intended for storefront-facing redemption.
- POST /redeem-points (admin-protected): `app/routes/redeem-points.jsx` — creates discount via Admin GraphQL and decrements points; requires admin auth.
- GET /apps/vip/api/vip-points?customerId=...: `app/routes/api.vip-points.jsx` — returns points (but currently reads `totalPoints` which must be aligned).
- Webhook: order creation route `app/routes/webhooks.orders.create.jsx` — credits points when VIP customer places an order.

---

## Tests & validation you should run locally

1. Start the app and register webhooks. Use ngrok or Shopify dev tunnel to deliver order create webhooks.
2. Create a test customer in your dev shop and add `VIP` tag manually.
3. Place a test order (or simulate order create webhook payload) with subtotal to validate points are credited to DB.
4. Use the theme block in a test theme (or insert it into a cart) to fetch points via `/apps/vip/api/vip-points`.
5. Test redeem path: because the app-proxy redeem is a stub, decide whether to:
   - Implement discount creation in the app-proxy POST handler and test end-to-end, or
   - Create an admin-only UI for redemption that calls `app/routes/redeem-points.jsx` with stored admin session.

---

## Recommended immediate fixes (practical checklist)

1. Reconcile schema + code:
   - Update Prisma model `VipCustomer` to use `totalPoints` (or update code to use `rewardPoints`) consistently.
   - Update `RewardTransaction` fields to a single consistent format (e.g., `points` & `type`).
   - Create & run a migration.
2. Decide redemption flow and implement a single path:
   - Option A (app-proxy creation): implement the discount creation and DB updates in `app/routes/apps/vip/redeem-points.jsx`. Ensure you have access to Admin API tokens (offline token) to call `admin.graphql` from there.
   - Option B (server-created via admin session): implement an authenticated server endpoint that the app-proxy calls internally; the internal server call runs the admin-level `discountCodeBasicCreate` mutation.
3. Implement excluded-products support:
   - Add `ExcludedProduct` model and admin UI.
   - Add server-side cart validation before creating discount.
4. Store created discount code ID and associated metadata in DB for auditing and to ensure a code is used only once.
5. Add unit tests for: webhook handling, points calculation, redeem validation, and discount creation logic.

---

## How to run / try locally (quick)

1. Ensure environment variables: `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET`, `SHOPIFY_APP_URL`, `SCOPES`.
2. Start the app (dev):
   - Use your normal npm script (project root):

     npm run dev

3. Run Prisma Studio and inspect the `VipCustomer` and `RewardTransaction` tables:
   - npx prisma studio

4. To test webhooks locally, use `ngrok` or Shopify dev tunnel and register webhooks via the app.

---

## Final verification notes (what I ran)

- I inspected the following files to prepare this report:
  - `app/shopify.server.js`
  - `app/db.server.js`
  - `prisma/schema.prisma`
  - `app/routes/webhooks.orders.create.jsx`
  - `app/routes/api.vip-points.jsx`
  - `app/routes/redeem-points.jsx`
  - `app/routes/apps/vip/redeem-points.jsx`
  - `extensions/theme-extension/blocks/VIP_Reward.liquid`

- Key inconsistencies and missing features are noted above.

---

If you want, I can now:

1. Update the Prisma schema and code to use `totalPoints` everywhere and add the recommended `RewardTransaction` fields (plus create migration SQL). OR
2. Implement the app-proxy redeem flow to create discounts end-to-end and add excluded-product validation. OR
3. Create admin UI pages for marking excluded products.

Tell me which next step you prefer and I'll implement it (I can apply changes and run quick validations).
