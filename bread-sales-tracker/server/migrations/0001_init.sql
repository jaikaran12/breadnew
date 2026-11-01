-- Bread Sales: initial schema (SQLite / Cloudflare D1)
-- Money is stored in whole paise (₹1 = 100 paise) so totals are always exact.
-- Timestamps are ISO-8601 UTC text, business dates are 'YYYY-MM-DD' text, booleans are 0/1.

CREATE TABLE app_settings (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE admins (
  id                     INTEGER PRIMARY KEY AUTOINCREMENT,
  name                   TEXT NOT NULL,
  username               TEXT NOT NULL,
  password_hash          TEXT NOT NULL,
  token_version          INTEGER NOT NULL DEFAULT 0,
  failed_login_attempts  INTEGER NOT NULL DEFAULT 0,
  locked_until           TEXT,
  last_login_at          TEXT,
  created_at             TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE UNIQUE INDEX admins_username_key ON admins (lower(username));

CREATE TABLE areas (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  is_active   INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE UNIQUE INDEX areas_name_key ON areas (lower(name));

CREATE TABLE drivers (
  id                     INTEGER PRIMARY KEY AUTOINCREMENT,
  name                   TEXT NOT NULL,
  phone                  TEXT NOT NULL,
  pin_hash               TEXT NOT NULL,
  vehicle_number         TEXT,
  is_active              INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  token_version          INTEGER NOT NULL DEFAULT 0,
  failed_login_attempts  INTEGER NOT NULL DEFAULT 0,
  locked_until           TEXT,
  last_login_at          TEXT,
  last_seen_at           TEXT,
  created_at             TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at             TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE UNIQUE INDEX drivers_phone_key ON drivers (phone);

CREATE TABLE stores (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  area_id               INTEGER NOT NULL REFERENCES areas(id),
  name                  TEXT NOT NULL,
  owner_name            TEXT,
  phone                 TEXT,
  address               TEXT,
  notes                 TEXT,
  is_active             INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_by_driver_id  INTEGER REFERENCES drivers(id),
  created_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX stores_area_idx ON stores (area_id);
-- Two shops with the same name in one area would be impossible for a driver to tell apart.
CREATE UNIQUE INDEX stores_area_name_key ON stores (area_id, lower(name));

CREATE TABLE products (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  name         TEXT NOT NULL,
  local_name   TEXT,
  price_paise  INTEGER NOT NULL CHECK (price_paise >= 0),
  color        TEXT NOT NULL DEFAULT '#C68B59',
  sort_order   INTEGER NOT NULL DEFAULT 0,
  is_active    INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE UNIQUE INDEX products_name_key ON products (lower(name));

CREATE TABLE product_price_history (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id           INTEGER NOT NULL REFERENCES products(id),
  old_price_paise      INTEGER,
  new_price_paise      INTEGER NOT NULL,
  changed_by_admin_id  INTEGER REFERENCES admins(id),
  changed_at           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX product_price_history_product_idx ON product_price_history (product_id, changed_at DESC);

CREATE TABLE sales (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  -- Generated on the phone. Lets the phone safely re-send a bill without creating a duplicate.
  client_id       TEXT NOT NULL UNIQUE,
  driver_id       INTEGER NOT NULL REFERENCES drivers(id),
  store_id        INTEGER NOT NULL REFERENCES stores(id),
  -- Area of the shop at the time of the sale (kept even if the shop moves area later).
  area_id         INTEGER NOT NULL REFERENCES areas(id),
  sold_at         TEXT NOT NULL,
  -- Business day of the sale in APP_TIMEZONE; used by all daily reports and the cash tally.
  sale_date       TEXT NOT NULL,
  payment_mode    TEXT NOT NULL CHECK (payment_mode IN ('cash', 'upi', 'credit')),
  total_paise     INTEGER NOT NULL CHECK (total_paise >= 0),
  total_quantity  INTEGER NOT NULL CHECK (total_quantity > 0),
  status          TEXT NOT NULL DEFAULT 'completed' CHECK (status IN ('completed', 'cancelled')),
  cancelled_at    TEXT,
  cancelled_by    TEXT CHECK (cancelled_by IN ('driver', 'admin')),
  cancel_reason   TEXT,
  -- Raw time reported by the phone (sold_at falls back to server time if the phone clock is way off).
  device_sold_at  TEXT,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX sales_sale_date_idx ON sales (sale_date);
CREATE INDEX sales_driver_date_idx ON sales (driver_id, sale_date);
CREATE INDEX sales_store_idx ON sales (store_id, sold_at);

CREATE TABLE sale_items (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  sale_id           INTEGER NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  product_id        INTEGER NOT NULL REFERENCES products(id),
  product_name      TEXT NOT NULL,
  unit_price_paise  INTEGER NOT NULL CHECK (unit_price_paise >= 0),
  -- Price list value on the server when the bill arrived (to spot bills made with an old price list).
  list_price_paise  INTEGER NOT NULL,
  quantity          INTEGER NOT NULL CHECK (quantity > 0),
  line_total_paise  INTEGER NOT NULL CHECK (line_total_paise >= 0),
  CHECK (line_total_paise = unit_price_paise * quantity),
  UNIQUE (sale_id, product_id)
);
CREATE INDEX sale_items_product_idx ON sale_items (product_id);

-- End-of-day cash tally: what the driver handed over vs what the bills say.
CREATE TABLE settlements (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  driver_id            INTEGER NOT NULL REFERENCES drivers(id),
  settle_date          TEXT NOT NULL,
  expected_cash_paise  INTEGER NOT NULL,
  cash_received_paise  INTEGER NOT NULL CHECK (cash_received_paise >= 0),
  note                 TEXT,
  settled_by_admin_id  INTEGER REFERENCES admins(id),
  settled_at           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (driver_id, settle_date)
);
