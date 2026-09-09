-- Reference schema for the institutional procurement lifecycle.
-- Application performs non-destructive startup upgrades.
CREATE EXTENSION IF NOT EXISTS pgcrypto;
-- See SQLAlchemy models for full definitions. Lifecycle tables include:
-- finance_reviews, procurement_decisions, vendors, purchase_orders,
-- delivery_receipts, acceptances, stock_entries, bills, payments,
-- utilization_certificates and amcs.
