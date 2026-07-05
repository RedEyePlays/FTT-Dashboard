# FlipThatTech Dashboard — Target Architecture

> Status: **Proposed / agreed baseline** (2026-07). This document describes where
> we are taking the platform, the decisions we've committed to, and the shape of
> the system we are building toward. It is the reference we agree on *before*
> implementing features. Companion: [`ROADMAP.md`](./ROADMAP.md) breaks the work
> into phased milestones.

---

## 1. Vision

FlipThatTech is evolving from an inventory + POS dashboard into a complete
**phone repair, inventory, and resale management platform** — effectively a
vertical ERP for a used-electronics business. Target capabilities:

- Repair job / work-order management
- Purchase orders + supplier management
- Customer history (purchases, repairs, warranties)
- Warranty / RMA tracking
- IMEI / device history ("device passport")
- Runner sourcing improvements
- Marketplace integrations
- Richer reporting & analytics
- POS depth: receipts, refunds, multiple/split payment methods
- **Scale to multiple store locations**
- **Server-side transactional workflows** for critical operations (SKU
  generation, sales commits, stock movements)

---

## 2. Committed architectural decisions

These are settled and drive the rest of the design:

1. **Stay on Firestore + Cloud Functions** (not Postgres) for the foreseeable
   future. Firestore keeps working auth, security rules, realtime multi-user
   sync, and offline. Relational-reporting gaps are covered by a stock-movement
   ledger + BigQuery, not a database migration.
2. **Introduce Firebase Cloud Functions (gen 2)** as a server-side write layer
   for all critical/money/stock/identity operations.
3. **Bake `locationId` into the schema now**, even though the multi-location UI
   ships later. Retrofitting a location dimension onto accumulated data is a
   painful backfill; carrying the field from the start is nearly free.
4. **Server-mediated writes for critical operations; realtime client reads.**
   Reads stay on `onSnapshot`. Writes to money/stock/identity go through
   callable functions, and security rules lock those collections to
   server-only writes.

---

## 3. The core shift: client-direct-writes → server-mediated writes

Today every mutation is a client `setDoc` / `writeBatch`. That is the root
cause of several classes of problem:

- SKU generation races (client-side counter in `meta/app`).
- Accessory stock can go negative under concurrent sales.
- The Gemini API key ships in the client bundle.
- `disabled` users are only signed out client-side; their token is not revoked.

For an ERP handling money and inventory across staff and locations, critical
writes must move server-side. **This is the single biggest change and most of
the roadmap depends on it.**

### Callable Cloud Functions (the write layer)

| Callable | Replaces / adds | Why server-side |
|---|---|---|
| `generateSku` | client counter in `meta/app` | atomic counter, no races |
| `commitSale` | client `commitSale()` batch | transactional stock + payments + device history |
| `adjustStock` / `transferStock` | inline `quantity` math | ledger-based, multi-location safe |
| `receivePurchaseOrder` | — | stock-in with cost basis |
| `processRefund` / `processReturn` | — | reverses stock + money atomically |
| `createRepairJob` / `advanceRepairStatus` | — | work-order state machine |
| `setUserRole` / `disableUser` | client `updateUserDoc` | Admin SDK token revocation (real disable) |
| `geminiProxy` | client `@google/genai` | hides API key, rate-limits |

**Reads stay client-side and realtime.** Only writes to money/stock/identity go
through callables. Rules then lock those collections to server-only writes, so a
modified client bundle cannot corrupt them.

---

## 4. Tenancy & multi-location model

- **Tenant / business** = `workspaceId` (unchanged). The isolation boundary.
- **Location** = a store within a business. New first-class dimension.

```
user_data/{workspaceId}/
  locations/{locationId}      one doc per store
```

- **Location-scoped** docs carry a `locationId` field: inventory, stock
  movements, sales, repair jobs, cash drawer, purchase orders.
- **Business-scoped** (shared across locations): suppliers, customers, users,
  device history, product catalog, warranties.
- **Users** gain `locationIds` + a default location. Per-location roles are a
  later refinement; the schema should not preclude them.

`locationId` is written from Phase 1 onward even while the UI still assumes a
single default location, so no backfill is needed when multi-location ships.

---

## 5. Domain model

Evolving from today's 9 collections into a real domain. Under
`user_data/{workspaceId}/`:

```
catalog/{productId}        product/model catalog — normalizes "iPhone 13 Pro" naming
devices/{deviceId}         canonical device by IMEI/serial (the "device passport")
  └─ events/{eventId}      append-only history: purchased → repaired → listed → sold → returned
inventory/{id}             resale stock unit → links to deviceId (serialized) OR stock line
parts/{id}                 repair parts inventory (distinct from resale stock)
stockMovements/{id}        append-only ledger of every qty change (in/out/transfer/adjust)
suppliers/{id}
purchaseOrders/{id}        + line items, status: draft → ordered → received
repairJobs/{id}            work orders: customer, device, diagnosis, parts, labor, tech, status, quote
warranties/{id} / rmas/{id}
salesTransactions/{id}
  payments/{id}            split/partial payments + refunds as their own records
customers/{id}             history aggregated from sales + repairs + warranties
runners / dropOffs / settlements   → evolve into the sourcing module
auditLogs/{id}             append-only (unchanged)
meta/app                   settings; SKU counters move server-side
```

Two ideas are load-bearing:

### 5.1 The device passport — `devices/{id}` + `events`

Today one inventory row == one lifecycle, so a phone that is
purchased → repaired → sold → returned → resold cannot be tracked as a single
device. A **canonical device keyed by IMEI/serial**, with an **append-only
event log**, is what makes IMEI history, warranty/RMA, and resale-of-returns
work. It underpins three roadmap items at once (IMEI history, warranty, repair).

Inventory units and repair jobs reference a `deviceId`; the device is the
durable identity, the inventory/repair rows are transient states.

### 5.2 Stock as an append-only ledger — `stockMovements`

Instead of mutating `quantity = max(0, q - sold)` on a doc, we write **movement
records** (in / out / transfer / adjust) and derive on-hand from them. Benefits:

- Eliminates the concurrent-decrement race (movements are additive, written in
  a transaction by a Function).
- Free auditability of every stock change.
- Location transfers and PO receiving fall out naturally as movement types.

This is the inventory equivalent of double-entry bookkeeping. A cached
`onHand` per (item, location) can be maintained by the same transaction for
fast reads.

---

## 6. Type system & shared validation

- Split the overloaded `InventoryItem` god-type into **discriminated unions**
  (`SerializedDevice | StockItem`) plus real `RepairJob`, `PurchaseOrder`,
  `Supplier`, `Device`, `Payment`, `Warranty` types.
- Put domain types + **Zod schemas** in a shared module consumed by **both** the
  client and the Cloud Functions, so the callable layer validates every write
  against the same contract the UI builds against. One source of truth for
  shape + validation.

---

## 7. Client architecture

- **Extract the data layer out of `App.tsx`** (currently ~800 lines of state):
  per-domain hooks (`useInventory`, `useRepairs`, `usePurchaseOrders`, …) plus a
  workspace/location context provider.
- **Add a router** (react-router). The single `view` string enum will not scale
  to a dozen feature areas. URL routing also gives deep links, back-button
  behavior, and per-module lazy code-splitting (repair, procurement, reporting
  load on demand).
- Consider **TanStack Query** for callable-function calls (caching, retries,
  optimistic updates) while keeping `onSnapshot` for realtime lists.

---

## 8. Reporting & analytics at scale

- Do **not** pull all rows to the client for analytics (today's dashboard does).
- Precompute **daily rollup docs** via a scheduled Function for dashboards.
- When reporting gets heavy, enable the **Firestore → BigQuery** extension for
  ad-hoc/relational analytics without touching the operational store.

---

## 9. Security & rules evolution

- Lock money/stock/identity collections to **server-only writes** (Functions use
  the Admin SDK and bypass rules; clients get `allow write: if false` on those
  paths, constrained reads only).
- Extend permission checks to be **per-location** as the location dimension
  comes online.
- Move `disabled`-user enforcement to **Admin SDK token revocation** so a
  disabled user is actually locked out server-side, not just client-side.
- Continue testing rules in the **Firebase emulator** (added in Phase 0) so the
  role model is exercised in CI rather than only in the console playground.

---

## 10. What stays the same

- Firebase Auth (email/password), the `workspaceId` isolation model, and the
  `user_data/{workspaceId}/…` path convention.
- Realtime `onSnapshot` subscriptions for lists.
- The append-only `auditLogs` design.
- React + Vite + Tailwind + Recharts front-end stack.

---

## 11. Open items / later decisions (not blocking)

- Marketplace integration mechanics (per-platform APIs, sync direction).
- Whether per-location roles become their own permission layer.
- Receipt rendering/printing pipeline (PDF vs thermal).
- Retention/pagination policy for `auditLogs`, `activityLog`, `stockMovements`.
- Cost basis / accounting method for inventory (FIFO vs average) once POs land.

These are deferred until their phase and do not affect the Phase 0–2 foundation.
</content>
</invoke>
