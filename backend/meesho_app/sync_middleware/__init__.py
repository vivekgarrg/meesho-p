"""
The Meesho sync's middleware: between what the sync worker reads from the
Meesho panel and the app's own tables.

The worker (Rails/Sidekiq, sync/) only fetches — it keeps each read as a
snapshot (MeeshoSyncSnapshot) or a downloaded file. Each middleware here then
does the same three things for its kind of data:

  1. normalize  — Meesho's shape → the shape of our table's row;
  2. validate   — every row must carry what the table needs; a row that
                  doesn't is rejected with the reason (counted, sampled, never
                  silently dropped);
  3. inject     — write it, with that table's rules (an order's status never
                  goes backwards, a delivered return stays delivered, a
                  payment not yet made never lands in the paid table, claim
                  work is never overwritten…), then invalidate the cached
                  screens — profit, dashboard — of every business it touched,
                  once, so they're recomputed from the new data.

  orders    → Order                 (orders.py)
  payments  → OrderPayment, AdsCost, ReferralPayment, CompensationRecovery,
              MeeshoOutstandingPayment (payments.py)
  returns   → ReturnDelivery        (returns.py)

Run by the worker through `manage.py meesho_inject` / `import_meesho_payments`;
checked against what Meesho said by `manage.py verify_meesho_sync`.
"""
