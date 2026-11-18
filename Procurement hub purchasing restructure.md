# procurement-hub: purchasing and receiving restructure (M5.5)

The spec (Claude Doc "procurement-hub 技術規格") has a redesigned purchasing and receiving model. M4 and M5 were built on the old model (team orders, vendor transactions, per-item receipts and exceptions). Finish this list before starting M6. The project has no users yet: **do not keep old names, endpoints, or compatibility shims.** Spec section numbers are in brackets.

If any "standards alignment" item (separate list) is still open, finish it first.

## 0. The model in one paragraph

Three modules that work alone or chained: **purchase requests** (batches and items, the only team-bound part) → **purchasing** (vendor orders with lines) → **receiving** (deliveries matched to lines). Team orders are gone. A vendor order line always has a cost-attribution team; it may link to at most one item; an item may have many lines across vendor orders; line quantity may differ from the requested quantity. Purchaser and receiver are **global** roles. The batch moves to purchasing only after a manual **review confirmation**; after that, batch status is derived from item progress. Every mistaken action can be undone, newest first.

## 1. Roles and users [§6.1, §7.3, §8]

- New env vars `PURCHASER_ROLES`, `RECEIVER_ROLES` (same syntax and matching as `ADMIN_ROLES`; optional, unset = nobody has the role). Read from the token on every request.
- System admins do **not** implicitly have purchaser or receiver.
- `users.roleSnapshot` (fields per §9.1), refreshed whenever the role-mapping sync runs (token `iat` newer than `lastSyncedTokenIat`, §7.3). Use it **only** for notification targets and assignment candidates (`GET /users?role=`), never for authorization.
- `/me` adds `isPurchaser`, `isReceiver`.
- Batch assignments: `{approvers[], purchasers[]}`. Approvers are required team members. Purchasers are optional (any user from `roleSnapshot`) and only change notification targets and `/me/tasks`; they grant nothing. There is **no** receiver assignment. A member leaving a team loses only their **approver** assignments in that team. Assigned purchasers who no longer have the role are skipped for notifications (fallback: all purchasers).
- Implement the permission matrix in §8.3 exactly (it is split into 採購申請 / 採購 / 點收 / 共同).

## 2. Visibility [§8.2]

- Purchasers, receivers and system admins can read all vendor orders, lines, ledger entries, deliveries, the pending-match list, problems, and approved items of review-confirmed batches (only the purchasing fields listed in §8.2). System admins are read-only for purchasing and receiving, except that they can maintain the vendor list. For batches a purchaser/receiver cannot otherwise read, `GET /batches/{id}` and `/batches/{id}/items` return only approved items and the purchasing fields once the batch is review-confirmed, else 404.
- A regular user sees a vendor order line if they are a member of the line's team or can read the linked batch. Other lines are aggregated into "other teams: n lines, total". A vendor order with no visible line → 404.
- Order-level fields for regular users are filtered per §8.2: shared costs, team overrides, charge and ledger entries show only the amounts allocated to lines they can see; problems show quantity/type/resolution without delivery ids.
- Deliveries, `/delivery-lines*` and `/problems` are visible only to purchasers, receivers and system admins (404 for others).
- Every audit timeline, including the team timeline, returns only events of objects the caller can read; vendor-order events are filtered per line, and order-level money changes are summarized.

## 3. Data model [§9]

Add, change, or remove collections as §9.1 specifies. Highlights:

| Collection | Change |
|---|---|
| `referenceRates` | **New, global** (one doc per currency, Decimal128, with `version`). Remove `teams.referenceRates`. |
| `vendors` | New: name, aliases, defaultCurrency, website, notes, `active`. |
| `batches` | Add `reviewConfirmation {by, at, purchaseOutside}`, `statusBeforeCancel`; assignments as in §1; statuses per §10.1. |
| `items` | `vendor` string → `vendorId` + `vendorName`; add `unpurchasable`, computed `fulfillment`, `plannedQuantity`, `toPurchaseQuantity`, `orderedQuantity`, `receivedQuantity`, `costBase` (placed lines only). Remove `orderId`, `actualUnitPrice`. |
| `vendorOrders` | Replaces `vendorTransactions`. `VO-<n>` number, `version` (also bumped by every line/ledger write), vendorId, currency, vendor order number, shared costs, `teamCostOverrides` (validated on PUT and place; auto-cleared in draft when the team set changes), `chargedAmountBase`, status, computed `totals` (contains `provisional` and `incomplete[]`). |
| `vendorOrderLines` | New: vendorOrderId, teamId (required), optional itemId/batchId, name, sku, quantity, unitPrice (never back to null once placed), computed `returnedQuantity`/`expectedQuantity`/`receivedQuantity`/`openProblemQuantity`, closure, internal `version`, computed cost fields. |
| `ledgerEntries` | New (replaces adjustments): base-currency amount (refund negative), optional lineId, source (manual / problem / closure), voided. |
| `deliveries`, `deliveryLines`, `deliveryMatches` | New (replace receipts). Deliveries have `version`; matches have `voided`. |
| `lineProblems` | New (replace itemExceptions). Have `version` and `voided`. |
| `migrations` | Add `report` (items needing manual review). |
| `auditEvents` | Add `teamIds` so a vendor-order event appears in each involved team's timeline. |
| Removed | `orders`, `vendorTransactions`, `receipts`, `itemExceptions`, `adjustments`. |

Create the new indexes in §9.2 in migration 0002.

## 4. State machines and undo [§10]

- **Batch** [§10.1]: transitions `open`, `start_review`, `close`, `reopen`, `cancel`, `uncancel`, `reject_proposal`, `withdraw_proposal`, `restore_proposal`, `confirm_review` (with optional `purchaseOutside`), `unconfirm_review`. `confirm_review` requires every non-withdrawn item to be approved or rejected. After confirmation, status is **derived** on every fulfillment change (`purchasing` / `receiving` / `completed`, both directions). The batch-level "ordering done" action is removed. `purchaseOutside` sets fulfillment `external` and completes the batch. A batch cannot be cancelled after confirmation.
- **Item** [§10.2]: review-decision undo (before confirmation); `fulfillment` is evaluated top-down from the §10.2 table: `external`, `unpurchasable`, `not_ordered`, `partially_ordered`, `received`, `closed`, `partially_received`, `ordered`. Items with `toPurchaseQuantity > 0` stay in the purchasing queue even after a partial order. "Unpurchasable" on an item that already has placed lines means "don't buy the remaining quantity". Withdrawn items have no undo, use `POST /items/{id}/copy` (same batch only).
- **Unplace** is also blocked while any linked item carries the unpurchasable mark (undo the mark first).
- **Batch cost** sums only items that have placed lines; items without placed lines neither add nor turn the batch total null.
- **Withdraw proposal** sets `statusBeforeCancel = proposed`; only `restore_proposal` undoes it (`uncancel` → `409 invalid_transition`). `unconfirm_review` removes draft lines of the batch's items and writes their content to audit (the only exception to "undo never deletes").
- **Vendor order and lines** [§10.3]: `draft` → `placed` (= checkout done at the vendor; unit prices required; vendor order number, shared costs, and charge can be filled later) → undo back to draft; `draft` ↔ `cancelled`. After placing, quantity/team/item link are locked; prices and accounting fields stay editable and recompute. Line states are computed top-down (§10.3): `cancelled`, `draft`, manual closure, `not_obtained` when expected quantity is 0 (everything returned), `received`, `partially_received`, `ordered`. Manual closure `short_accepted` / `not_obtained` with optional refund; a manually closed line accepts no new matches and blocks voiding/changing its matches and undoing its problem resolutions.
- **Quantity invariant** [§10.3]: `received + openProblem + returned ≤ quantity`, checked on every match change, resolution and resolution undo; violation → `422 line_quantity_exceeded` with the remaining capacity in `details`. Exchange-resolved quantity counts in none of them.
- **Refunds**: `refundBase` is entered positive and stored as negative `amountBase`; only `return_no_replace` and manual closure accept it, otherwise `400`.
- **Deliveries** [§10.4]: one delivery = one box, free-form lines (good qty, problem qty, type `damaged`/`wrong_item`, note). Matching splits quantities across **placed** lines; suggestions by exact SKU then name similarity, oldest order first. Unmatched lines stay pending or get "no match needed". **Over-delivery**: matching is capped at the line's remaining capacity; the excess stays pending and is marked "no match needed" (no problem created); if the vendor later charges for it, add a ledger entry on that line. Problem quantity creates an open problem; resolutions `exchange`, `return_no_replace` (+ optional refund), `accept`. Shortage needs no report. Changing a match voids the old one and creates a new one; voiding a delivery voids its matches; voiding a match voids its unresolved problems (resolved ones block).
- **Undo framework** [§10 intro, §10.5]: undo restores the previous state, never deletes (mark `voided`); audit for both; reason required; blocked → `409 blocked_by_dependency` with `details.blockers [{type, id, label}]`; emit `<event>.undone` only for user-triggered undo, not for the automatic knock-on changes (those are audit-only, actor `system:derive`). Implement every row of the §10.5 table.
- **Concurrency** [§10 intro]: every document read as a precondition is written back with a version bump in the same transaction (batch for review actions; item **and batch** for adding/removing lines and unpurchasable; every linked item, the batch and every line for place/unplace/cancel/uncancel; line for matching/resolution/closure; the vendor order for any write that changes it, its lines or ledger, including computed values from matching, resolutions and recompute). Internal write conflicts are retried by the server; only a stale client `If-Match` returns `409 version_conflict`.

## 5. Money [§11]

Rewrite the calculation in `internal/domain` as pure functions with table-driven tests. Follow steps 1–9 exactly: line amounts, shared-cost allocation (by line amount; team overrides then within-team; equal split on zero base), factor `f` (charge ÷ original, or 1 for base currency, or reference rate → `provisional`, else null), largest-remainder rounding to the target (floor toward −∞, then hand out the remaining minor units by largest remainder; ties by `lineNo`, `costBase` before `sharedBase`), ledger allocation, totals. Item and batch cost include placed lines only. **Invariant test:** `netBase = target + Σ ledger = Σ line totalBase`. Incomplete → null (not 0) with `incomplete[]` reasons. Estimates use global reference rates and never feed actual cost. Reference-rate writes do not recompute in the same transaction; they schedule `vendor_orders.recompute` keyed by currency [§13.1], which recomputes every non-cancelled order in that currency without a charged amount (including orders that were incomplete; deleting a rate makes provisional orders incomplete again).

## 6. Notifications [§12.2]

M5.5 only defines the event catalog. Call the existing event-emitting interface in the same transaction as the state change for every event in the §12.2 table, including `<event>.undone` (a no-op or outbox write is fine); actually sending notifications is M6. Recipient rules to implement in M6: `digestKey` = channel + target + (batchId | vendorOrderId | deliveryId); never notify the actor; skip assigned purchasers who lost the role; `delivery.needs_matching` falls back to all purchasers when there are no receivers.

## 7. Migration `0002_purchasing_restructure` [§13.2]

Idempotent; write a migration report (log + `migrations.report`) of anything needing manual review. Do not guess. Use the **actual** old enums and field names in the M4/M5 code; the table below names them by meaning.

| Old | New |
|---|---|
| distinct item `vendor` strings | `vendors` (case-insensitive dedupe; first spelling as name, others as aliases); set item `vendorId`/`vendorName` |
| `teams.referenceRates` | global `referenceRates`: per currency, the most recently updated value across teams; report conflicts |
| `vendorTransactions` | `vendorOrders` (map the old status to `draft`/`placed`/`cancelled`; keep shared costs, charge, vendor order number; report any status with no clear mapping) |
| items with `orderId` | one `vendorOrderLine` each: quantity = item quantity, unitPrice = `actualUnitPrice`, teamId/batchId/itemId from the item |
| order-level allocations | `teamCostOverrides` |
| `adjustments` | `ledgerEntries` (item-level → that item's line) |
| `receipts` | one `delivery` per receipt with one line, matched to the item's line |
| `itemExceptions` | resolved → `lineProblems` with mapped resolution (+ ledger refund if any); open → open problems; anything without a quantity → report, not converted |
| every old batch status past review (the old ordering/receiving/completed states) | set `reviewConfirmation` from the audit event that left reviewing (`by`, `at`; `purchaseOutside = false`); then re-derive status per §10.1 |
| old batch orderer assignments | `assignments.purchasers`; old receiver assignments are dropped |
| placed transactions whose items lack `actualUnitPrice` | keep `placed` with `unitPrice = null` (cost becomes incomplete); report so a purchaser fills the price |
| receipts whose item ends up only on a draft/cancelled line | do not create matches (only placed lines can be matched); create the delivery line as pending and report |
| `auditEvents.teamId` | backfill `teamIds = [teamId]` (the only allowed audit mutation) |
| team orders not attached to a vendor transaction | draft vendor orders per vendor; report |
| old completed batches whose items were never ordered in the system | set `reviewConfirmation.purchaseOutside = true` (fulfillment `external`) so they stay `completed`; report |
| receipts that would break the quantity invariant | do not create the match; leave the delivery line pending; report |
| old exceptions | `lineProblems.deliveryMatchId` may be null only for migrated records |
| — | create §9.2 indexes; drop `orders`, `vendorTransactions`, `receipts`, `itemExceptions`, `adjustments` and their indexes, **except** a collection that still holds unconverted documents listed in the report (a later migration removes it after manual cleanup) |

After migrating, recompute every vendor order and assert the invariant; report any order where the computed `netBase` differs from the old recorded total.

## 8. API [§16]

- New errors: `409 blocked_by_dependency`, `422 line_quantity_exceeded`, `422 team_cost_overrides_mismatch`.
- If-Match [§16.1]: vendor order, line and ledger writes (including creates and line close/reopen) use the **vendor order** version; delivery-line matching and no-match use the **delivery** version; problems and items use their own; reference rates are per currency.
- Every undo is a `POST` with a `reason` body; use the exact paths in §16.2 (`/unplace`, `/uncancel`, `/reopen`, `/unresolve`, `/void`, `/review/undo`, `/unpurchasable/undo`, `/no-match/undo`, and the batch transitions `uncancel`, `restore_proposal`, `unconfirm_review`). No `DELETE` with a body.
- New query endpoints: `GET /vendor-order-lines?toClose=true`, `GET /purchasing/match-candidates?sku=&name=` (for entering a new box before it is saved). List responses carry the version needed for `If-Match` (`deliveryVersion`, problem `version`, `vendorOrderVersion`).
- Reference rates: `PUT/DELETE /reference-rates/{currency}`. Vendors: `GET /vendors?includeInactive=`. Close body `{type, reason, refundBase?}`; resolve body `{action, refundBase?, note?}`. `PUT /delivery-lines/{id}/matches` diffs by `vendorOrderLineId` (unchanged kept, changed voided and recreated, missing voided).
- Implement every endpoint in the §16.2 table; update `api/openapi.yaml` and contract tests.
- **Remove:** `/batches/{id}/orders`, `/orders/*`, `/vendor-transactions/*`, `/items/{id}/receipts`, `/items/{id}/exceptions`, `/exceptions/*`, `/orders/{id}/adjustments`, `/teams/{teamId}/reference-rates`.
- `/me/tasks` keys per §16.2. (The per-line cost report and CSV export [§15] are M7; if the old code already has a report or CSV import, keep it compiling against the new model but do not extend it here.)

## 9. Frontend [§17]

- New routes: `/purchasing`, `/vendor-orders`, `/vendor-orders/:id`, `/deliveries`, `/deliveries/new`, `/deliveries/:id`, `/receiving`, `/admin/vendors`, `/admin/reference-rates`. Remove `/vendor-transactions/:id` and the team reference-rates settings page.
- Batch tabs: Items, Review, Purchasing, Timeline.
- UX rules in §17.2: single-team flow on one screen, undo buttons with reason and blocker list, vendor order calculation breakdown with invariant check, mobile-first delivery entry, over-delivery hint with a "no match needed" shortcut, "copy as new item" for withdrawn items.
- `/receiving`: receivers see pending deliveries only; purchasers also see open problems and lines to close. The purchasing queue shows each item's remaining quantity.
- Item vendor field: vendor picker plus "other" free text. (Mapping lookup/CSV store names to vendors via aliases [§14.2, §15] is M7.)

## 10. Tests that must exist

- Domain: every §11 step, rounding edge cases, null propagation, invariant.
- Service: every row of §10.5 including blocker responses.
- Concurrency: two simultaneous matches to the same line that together exceed it → one gets `422 line_quantity_exceeded`; review decision vs. confirm_review race.
- End-to-end: acceptance items 6–9 in §21, item 5 checked through the vendor order `totals` and team cost from the API (not the CSV report), and the non-notification parts of items 3 and 4 (CSV import is M7, notifications are M6).

## 11. Delete items that were never reviewed [§10.2, §8.3, §16.2]

Added after the list above; implement with M5.5.

- New `DELETE /items/{id}` (requires `If-Match` with the item version; `204` on success).
- Allowed only when the batch is `draft`, `proposed` or `collecting`, the item is `pending`, and `firstReviewedAt` is null. Otherwise `422 item_not_deletable`. Requester for their own item; team admin (and system admin) for any item.
- New item field `firstReviewedAt`: set on the first review decision (approve/return/reject/force-reject) and **never cleared**, not even by review-decision undo. Migration 0002 backfills it from the earliest review audit event of each item.
- Deletion removes the document (hard delete, no undo). Write audit `item.deleted` with the full pre-delete content in `changes`. `seqNo` is not reused; deleted items do not count toward the 5000-item limit. No notification.
- Items that do not qualify (batch already in review, or the item was reviewed before, e.g. after the batch was reopened for collecting) keep the existing withdraw flow and "copy as new item".
- Frontend: show "Delete" (with a confirmation dialog) instead of "Withdraw" on items that qualify.
- Tests: delete allowed in collecting; refused in reviewing; refused for an item that was reviewed, then the batch reopened (even after the decision was undone); seqNo gap preserved; audit snapshot present.