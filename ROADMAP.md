# FlipThatTech Dashboard — Milestone Roadmap

> Companion to [`ARCHITECTURE.md`](./ARCHITECTURE.md). This is the phased plan for
> getting from today's dashboard to the target platform. Phases are ordered so
> each unblocks the next and risk stays low. **Phase 0 is not yet implemented —
> pending review/approval of these documents.**

---

## Phase overview

| Phase | Theme | Unblocks |
|---|---|---|
| **0** | Foundation & hardening | A safe base for everything |
| **1** | Server-side write layer | All money/stock features |
| **2** | Device passport + catalog | Repair, warranty, IMEI history, resale-of-returns |
| **3** | Repair module | Core repair business |
| **4** | Procurement | Sourcing at scale |
| **5** | Warranty/RMA + POS depth | Customer trust + finance |
| **6** | Multi-location UI | Scale to multiple stores |
| **7** | Integrations + analytics | Growth |

---

## Phase 0 — Foundation & hardening

**Goal:** make the codebase safe to build on. No net-new features.

### Data-integrity bug fixes
- **Restore drops sales history.** `handleRestoreData` (App.tsx) syncs
  inventory/runners/dropOffs/settlements/notes but **not** `salesTransactions`
  or `customers`, while the export *includes* them → a restore silently loses
  sales history. Fix the asymmetry.
- **SKU counter race.** `handleGenerateSku` reads a client ref and writes back;
  two staff generating SKUs at once can collide. Interim fix client-side;
  fully resolved when `generateSku` moves server-side in Phase 1.
- **Accessory stock can go negative.** `commitSale` computes
  `max(0, current − sold)` from a client snapshot; concurrent sales read the
  same starting quantity. Interim guard now; fully resolved by the
  `stockMovements` ledger in Phase 1.

### Tests + CI
- Unit-test the pure modules: `services/rbac.ts`, `services/sku.ts`.
- Test `firestore.rules` against the **Firebase emulator** (the rules currently
  "can't be exercised in CI" per their own comments).
- Add **type-check + lint** to the deploy workflow (today it only builds).

### Type split (risk-reduction scope only)
- Begin splitting the `InventoryItem` god-type toward
  `SerializedDevice | StockItem`. Scope for Phase 0 = the split that reduces the
  most risk without a full rewrite; complete the union as later phases touch each
  area.

### Data-layer extraction
- Pull Firestore state/subscriptions out of `App.tsx` into per-domain hooks +
  a workspace context, **where it makes sense** — not a big-bang rewrite.

### Housekeeping
- Fix the env-var mismatch: `geminiService` reads `VITE_API_KEY` while
  `.env`/README reference `GEMINI_API_KEY` (AI likely silently disabled).
- Update the stale `DEPLOYMENT.md` (still describes the removed `2522` PIN flow).

**Exit criteria:** the three data-integrity bugs are fixed, CI runs
typecheck + unit tests + emulator rules tests, and `App.tsx` no longer owns the
raw Firestore wiring for at least the inventory domain.

---

## Phase 1 — Server-side write layer

**Goal:** stand up Cloud Functions and move critical writes server-side. This is
the architectural pivot; multi-location `locationId` enters the schema here.

- Scaffold `functions/` (gen 2), Blaze plan, deploy pipeline.
- Callables: `generateSku`, `commitSale`, `adjustStock`, `geminiProxy`,
  `disableUser` (with Admin SDK token revocation), `setUserRole`.
- Introduce the **`stockMovements` append-only ledger**; derive on-hand from it
  (with a cached `onHand` per item/location maintained in the same transaction).
- Add `locationId` to location-scoped writes (default single location for now).
- Shared **Zod schemas** validating every callable's input, reused by the client.
- Tighten security rules: money/stock/identity collections become
  server-write-only.

**Exit criteria:** SKU generation, sale commits, and stock changes are
transactional and server-mediated; the Gemini key is no longer in the client
bundle; disabling a user revokes their session.

---

## Phase 2 — Device passport + catalog

**Goal:** durable device identity and normalized product naming.

- `devices/{deviceId}` keyed by IMEI/serial + append-only `events` subcollection.
- `catalog/{productId}` product/model catalog.
- Inventory units and (later) repair jobs reference a `deviceId`.
- Backfill/link existing inventory rows to devices where IMEI is present.

**Exit criteria:** a device's full history (purchase → repair → sale → return)
is queryable from one record.

---

## Phase 3 — Repair module

**Goal:** core repair-shop workflow.

- `repairJobs` work orders: customer, device, intake condition, diagnosis,
  parts used, labor, technician assignment, status state machine, quote +
  approval.
- `parts` inventory, distinct from resale stock, decremented via the same
  `stockMovements` ledger.
- Callables: `createRepairJob`, `advanceRepairStatus`.

**Exit criteria:** a repair can be intake'd, quoted, worked, parts-consumed, and
closed, with the device passport updated.

---

## Phase 4 — Procurement

**Goal:** supplier-driven sourcing at scale.

- `suppliers` management.
- `purchaseOrders` with line items and status `draft → ordered → received`.
- `receivePurchaseOrder` callable: receiving creates stock-in movements with
  cost basis.
- Evolve runners/dropOffs/settlements into the broader sourcing module.

**Exit criteria:** stock can enter via POs with proper cost basis and supplier
attribution.

---

## Phase 5 — Warranty/RMA + POS depth

**Goal:** customer trust and financial completeness.

- `warranties` / `rmas` tied to devices and sales.
- Returns + refunds: `processReturn` / `processRefund` reverse stock + money
  atomically.
- POS: split/partial payments (`payments` records), more payment methods,
  receipts.

**Exit criteria:** a sale can be refunded/returned end-to-end, warranties are
tracked per device, and receipts are issued.

---

## Phase 6 — Multi-location UI

**Goal:** expose the location dimension baked in since Phase 1.

- Location switcher + per-location inventory/sales/reporting.
- `transferStock` between locations (already a movement type).
- Per-location user assignment and (optionally) per-location roles.

**Exit criteria:** a business can operate two or more stores with correct
per-location stock, sales, and reporting.

---

## Phase 7 — Integrations + analytics

**Goal:** growth features.

- Marketplace integrations (listing sync, order import).
- Scheduled daily rollup docs for dashboards.
- Firestore → BigQuery export for heavy/relational analytics.

**Exit criteria:** cross-channel selling and analytics without loading raw rows
to the client.

---

## Sequencing rationale

- **Phase 0 before features:** the data-integrity bugs corrupt real data and the
  lack of tests makes every later change risky.
- **Phase 1 before all money/stock features:** everything downstream writes
  money or stock; the transactional layer and ledger must exist first.
- **Device passport (Phase 2) before repair/warranty:** both depend on durable
  device identity.
- **`locationId` in Phase 1, UI in Phase 6:** carry the field early to avoid a
  costly backfill; expose it once the core domains exist.
</content>
