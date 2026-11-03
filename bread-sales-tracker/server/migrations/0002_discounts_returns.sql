-- 0002: special rates for shops (discounts) and expired bread taken back (returns).
--
-- * store_discounts: a discount for one product at one shop: "percent" (value in hundredths of a percent,
--   so 250 = 2.5%) or "amount" (value = paise off each unit). The phones apply it automatically.
-- * sale_items: each line now keeps the discount given (line_total_paise is what the shop pays for the line).
-- * sale_returns: expired units the driver took back and replaced with fresh ones (no money).
-- * sales: a bill may now be "returns only" (nothing sold), and keeps its total discount and returned units.
--
-- SQLite cannot change existing columns, so the two bill tables are rebuilt and every row is copied.
-- The old sales table is renamed first, so no bill line is ever deleted along the way.

CREATE TABLE store_discounts (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  store_id    INTEGER NOT NULL REFERENCES stores(id),
  product_id  INTEGER NOT NULL REFERENCES products(id),
  kind        TEXT NOT NULL CHECK (kind IN ('percent', 'amount')),
  value       INTEGER NOT NULL CHECK (value > 0),
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK (kind <> 'percent' OR value <= 10000),
  UNIQUE (store_id, product_id)
);
CREATE INDEX store_discounts_product_idx ON store_discounts (product_id);

ALTER TABLE sales RENAME TO sales_old;

CREATE TABLE sales (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  -- Generated on the phone. Lets the phone safely re-send a bill without creating a duplicate.
  client_id          TEXT NOT NULL UNIQUE,
  driver_id          INTEGER NOT NULL REFERENCES drivers(id),
  store_id           INTEGER NOT NULL REFERENCES stores(id),
  -- Area of the shop at the time of the sale (kept even if the shop moves area later).
  area_id            INTEGER NOT NULL REFERENCES areas(id),
  sold_at            TEXT NOT NULL,
  -- Business day of the sale in APP_TIMEZONE; used by all daily reports and the cash tally.
  sale_date          TEXT NOT NULL,
  payment_mode       TEXT NOT NULL CHECK (payment_mode IN ('cash', 'upi', 'credit')),
  -- What the shop pays (after discounts).
  total_paise        INTEGER NOT NULL CHECK (total_paise >= 0),
  -- Units sold (0 for a visit where only expired bread was replaced).
  total_quantity     INTEGER NOT NULL CHECK (total_quantity >= 0),
  -- Total discount given on this bill.
  discount_paise     INTEGER NOT NULL DEFAULT 0 CHECK (discount_paise >= 0),
  -- Expired units taken back and replaced with fresh ones (no money).
  returned_quantity  INTEGER NOT NULL DEFAULT 0 CHECK (returned_quantity >= 0),
  status             TEXT NOT NULL DEFAULT 'completed' CHECK (status IN ('completed', 'cancelled')),
  cancelled_at       TEXT,
  cancelled_by       TEXT CHECK (cancelled_by IN ('driver', 'admin')),
  cancel_reason      TEXT,
  -- Raw time reported by the phone (sold_at falls back to server time if the phone clock is way off).
  device_sold_at     TEXT,
  created_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK (total_quantity + returned_quantity > 0)
);
INSERT INTO sales (id, client_id, driver_id, store_id, area_id, sold_at, sale_date, payment_mode, total_paise,
                   total_quantity, status, cancelled_at, cancelled_by, cancel_reason, device_sold_at, created_at)
  SELECT id, client_id, driver_id, store_id, area_id, sold_at, sale_date, payment_mode, total_paise,
         total_quantity, status, cancelled_at, cancelled_by, cancel_reason, device_sold_at, created_at
    FROM sales_old;

CREATE TABLE sale_items_new (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  sale_id              INTEGER NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  product_id           INTEGER NOT NULL REFERENCES products(id),
  product_name         TEXT NOT NULL,
  unit_price_paise     INTEGER NOT NULL CHECK (unit_price_paise >= 0),
  -- Price list value on the server when the bill arrived (to spot bills made with an old price list).
  list_price_paise     INTEGER NOT NULL,
  quantity             INTEGER NOT NULL CHECK (quantity > 0),
  -- Discount rule used by the phone for this line (NULL = no discount).
  discount_kind        TEXT CHECK (discount_kind IN ('percent', 'amount')),
  discount_value       INTEGER CHECK (discount_value > 0),
  discount_paise       INTEGER NOT NULL DEFAULT 0 CHECK (discount_paise >= 0),
  -- Discount the shop's rule on the server gave when the bill arrived (to spot old discount lists).
  list_discount_paise  INTEGER NOT NULL DEFAULT 0,
  -- What the shop pays for this line.
  line_total_paise     INTEGER NOT NULL CHECK (line_total_paise >= 0),
  CHECK (line_total_paise = unit_price_paise * quantity - discount_paise),
  CHECK ((discount_kind IS NULL) = (discount_value IS NULL)),
  UNIQUE (sale_id, product_id)
);
INSERT INTO sale_items_new (id, sale_id, product_id, product_name, unit_price_paise, list_price_paise, quantity,
                            line_total_paise)
  SELECT id, sale_id, product_id, product_name, unit_price_paise, list_price_paise, quantity, line_total_paise
    FROM sale_items;
DROP TABLE sale_items;
ALTER TABLE sale_items_new RENAME TO sale_items;
DROP TABLE sales_old;

CREATE INDEX sales_sale_date_idx ON sales (sale_date);
CREATE INDEX sales_driver_date_idx ON sales (driver_id, sale_date);
CREATE INDEX sales_store_idx ON sales (store_id, sold_at);
CREATE INDEX sale_items_product_idx ON sale_items (product_id);

CREATE TABLE sale_returns (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  sale_id           INTEGER NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  product_id        INTEGER NOT NULL REFERENCES products(id),
  product_name      TEXT NOT NULL,
  quantity          INTEGER NOT NULL CHECK (quantity > 0),
  -- Price list value of one unit when the bill arrived (what the replaced bread was worth).
  unit_price_paise  INTEGER NOT NULL CHECK (unit_price_paise >= 0),
  UNIQUE (sale_id, product_id)
);
CREATE INDEX sale_returns_product_idx ON sale_returns (product_id);
