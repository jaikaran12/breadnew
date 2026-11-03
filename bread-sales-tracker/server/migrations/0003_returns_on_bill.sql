-- 0003: expired items taken back now count on the bill.
--
-- A bill shows what was given, what came back, and the difference: the net amount the shop pays.
-- * sale_returns: each returned line keeps the rate and the shop's discount used, and credit_paise, the value
--   taken off the bill (quantity × rate − discount), worked out exactly like a sold line.
--   Returns saved before this change cost nothing on their bill, so they keep credit_paise = 0.
-- * sales: total_paise is the net amount (given minus returned). It is below zero when the returns are worth
--   more than what was given (the shop gets money back). returned_paise is the value of the returns.
--
-- SQLite cannot change a column's rules, so the bill tables are rebuilt and every row is copied (as in 0002).
-- The old sales table is renamed first, so no bill line is ever deleted along the way.

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
  -- Net amount the shop pays: what was given (after discounts) minus the expired items taken back.
  -- Below zero when the returns are worth more than what was given: the shop gets that money back.
  total_paise        INTEGER NOT NULL,
  -- Units given (0 for a visit where expired items were only taken back).
  total_quantity     INTEGER NOT NULL CHECK (total_quantity >= 0),
  -- Total discount given on the units given.
  discount_paise     INTEGER NOT NULL DEFAULT 0 CHECK (discount_paise >= 0),
  -- Expired units taken back.
  returned_quantity  INTEGER NOT NULL DEFAULT 0 CHECK (returned_quantity >= 0),
  -- Value of the expired units taken back (already taken off total_paise).
  returned_paise     INTEGER NOT NULL DEFAULT 0 CHECK (returned_paise >= 0),
  status             TEXT NOT NULL DEFAULT 'completed' CHECK (status IN ('completed', 'cancelled')),
  cancelled_at       TEXT,
  cancelled_by       TEXT CHECK (cancelled_by IN ('driver', 'admin')),
  cancel_reason      TEXT,
  -- Raw time reported by the phone (sold_at falls back to server time if the phone clock is way off).
  device_sold_at     TEXT,
  created_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK (total_quantity + returned_quantity > 0),
  -- What was given is never below zero.
  CHECK (total_paise + returned_paise >= 0),
  CHECK (returned_paise = 0 OR returned_quantity > 0)
);
INSERT INTO sales (id, client_id, driver_id, store_id, area_id, sold_at, sale_date, payment_mode, total_paise,
                   total_quantity, discount_paise, returned_quantity, status, cancelled_at, cancelled_by,
                   cancel_reason, device_sold_at, created_at)
  SELECT id, client_id, driver_id, store_id, area_id, sold_at, sale_date, payment_mode, total_paise,
         total_quantity, discount_paise, returned_quantity, status, cancelled_at, cancelled_by,
         cancel_reason, device_sold_at, created_at
    FROM sales_old;

-- Bill lines: unchanged, rebuilt only so they point at the new sales table.
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
                            discount_kind, discount_value, discount_paise, list_discount_paise, line_total_paise)
  SELECT id, sale_id, product_id, product_name, unit_price_paise, list_price_paise, quantity,
         discount_kind, discount_value, discount_paise, list_discount_paise, line_total_paise
    FROM sale_items;
DROP TABLE sale_items;
ALTER TABLE sale_items_new RENAME TO sale_items;

CREATE TABLE sale_returns_new (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  sale_id              INTEGER NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  product_id           INTEGER NOT NULL REFERENCES products(id),
  product_name         TEXT NOT NULL,
  quantity             INTEGER NOT NULL CHECK (quantity > 0),
  -- Rate of one unit used for the credit (the phone's price list).
  unit_price_paise     INTEGER NOT NULL CHECK (unit_price_paise >= 0),
  -- Price list value on the server when the bill arrived (to spot bills made with an old price list).
  list_price_paise     INTEGER NOT NULL DEFAULT 0,
  -- The shop's discount used for these units (NULL = none), worked out as on a sold line.
  discount_kind        TEXT CHECK (discount_kind IN ('percent', 'amount')),
  discount_value       INTEGER CHECK (discount_value > 0),
  discount_paise       INTEGER NOT NULL DEFAULT 0 CHECK (discount_paise >= 0),
  list_discount_paise  INTEGER NOT NULL DEFAULT 0,
  -- Taken off the bill: quantity × rate − discount. 0 for returns saved before 0003 (they cost nothing then).
  credit_paise         INTEGER NOT NULL DEFAULT 0 CHECK (credit_paise >= 0),
  CHECK (credit_paise = unit_price_paise * quantity - discount_paise
         OR (credit_paise = 0 AND discount_paise = 0 AND discount_kind IS NULL)),
  CHECK ((discount_kind IS NULL) = (discount_value IS NULL)),
  UNIQUE (sale_id, product_id)
);
INSERT INTO sale_returns_new (id, sale_id, product_id, product_name, quantity, unit_price_paise, list_price_paise)
  SELECT id, sale_id, product_id, product_name, quantity, unit_price_paise, unit_price_paise
    FROM sale_returns;
DROP TABLE sale_returns;
ALTER TABLE sale_returns_new RENAME TO sale_returns;

DROP TABLE sales_old;

CREATE INDEX sales_sale_date_idx ON sales (sale_date);
CREATE INDEX sales_driver_date_idx ON sales (driver_id, sale_date);
CREATE INDEX sales_store_idx ON sales (store_id, sold_at);
CREATE INDEX sale_items_product_idx ON sale_items (product_id);
CREATE INDEX sale_returns_product_idx ON sale_returns (product_id);
