-- Bread Sales: initial schema
-- All money is stored in whole paise (₹1 = 100 paise) so totals are always exact.

CREATE TABLE app_settings (
  key         text PRIMARY KEY,
  value       text NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE admins (
  id                     serial PRIMARY KEY,
  name                   text NOT NULL,
  username               text NOT NULL,
  password_hash          text NOT NULL,
  token_version          integer NOT NULL DEFAULT 0,
  failed_login_attempts  integer NOT NULL DEFAULT 0,
  locked_until           timestamptz,
  last_login_at          timestamptz,
  created_at             timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX admins_username_key ON admins (lower(username));

CREATE TABLE areas (
  id          serial PRIMARY KEY,
  name        text NOT NULL,
  sort_order  integer NOT NULL DEFAULT 0,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX areas_name_key ON areas (lower(name));

CREATE TABLE drivers (
  id                     serial PRIMARY KEY,
  name                   text NOT NULL,
  phone                  text NOT NULL,
  pin_hash               text NOT NULL,
  vehicle_number         text,
  is_active              boolean NOT NULL DEFAULT true,
  token_version          integer NOT NULL DEFAULT 0,
  failed_login_attempts  integer NOT NULL DEFAULT 0,
  locked_until           timestamptz,
  last_login_at          timestamptz,
  last_seen_at           timestamptz,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX drivers_phone_key ON drivers (phone);

CREATE TABLE stores (
  id                    serial PRIMARY KEY,
  area_id               integer NOT NULL REFERENCES areas(id),
  name                  text NOT NULL,
  owner_name            text,
  phone                 text,
  address               text,
  notes                 text,
  is_active             boolean NOT NULL DEFAULT true,
  created_by_driver_id  integer REFERENCES drivers(id),
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX stores_area_idx ON stores (area_id);
-- Two shops with the same name in one area would be impossible for a driver to tell apart.
CREATE UNIQUE INDEX stores_area_name_key ON stores (area_id, lower(name));

CREATE TABLE products (
  id           serial PRIMARY KEY,
  name         text NOT NULL,
  local_name   text,
  price_paise  integer NOT NULL CHECK (price_paise >= 0),
  color        text NOT NULL DEFAULT '#C68B59',
  sort_order   integer NOT NULL DEFAULT 0,
  is_active    boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX products_name_key ON products (lower(name));

CREATE TABLE product_price_history (
  id                   bigserial PRIMARY KEY,
  product_id           integer NOT NULL REFERENCES products(id),
  old_price_paise      integer,
  new_price_paise      integer NOT NULL,
  changed_by_admin_id  integer REFERENCES admins(id),
  changed_at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX product_price_history_product_idx ON product_price_history (product_id, changed_at DESC);

CREATE TABLE sales (
  id              bigserial PRIMARY KEY,
  -- Generated on the phone. Lets the phone safely re-send a bill without creating a duplicate.
  client_id       uuid NOT NULL UNIQUE,
  driver_id       integer NOT NULL REFERENCES drivers(id),
  store_id        integer NOT NULL REFERENCES stores(id),
  -- Area of the shop at the time of the sale (kept even if the shop moves area later).
  area_id         integer NOT NULL REFERENCES areas(id),
  sold_at         timestamptz NOT NULL,
  -- Business day of the sale in APP_TIMEZONE; used by all daily reports and the cash tally.
  sale_date       date NOT NULL,
  payment_mode    text NOT NULL CHECK (payment_mode IN ('cash', 'upi', 'credit')),
  total_paise     bigint NOT NULL CHECK (total_paise >= 0),
  total_quantity  integer NOT NULL CHECK (total_quantity > 0),
  status          text NOT NULL DEFAULT 'completed' CHECK (status IN ('completed', 'cancelled')),
  cancelled_at    timestamptz,
  cancelled_by    text CHECK (cancelled_by IN ('driver', 'admin')),
  cancel_reason   text,
  -- Raw time reported by the phone (sold_at falls back to server time if the phone clock is way off).
  device_sold_at  timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sales_sale_date_idx ON sales (sale_date);
CREATE INDEX sales_driver_date_idx ON sales (driver_id, sale_date);
CREATE INDEX sales_store_idx ON sales (store_id, sold_at DESC);
CREATE INDEX sales_sold_at_idx ON sales (sold_at DESC);

CREATE TABLE sale_items (
  id                bigserial PRIMARY KEY,
  sale_id           bigint NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  product_id        integer NOT NULL REFERENCES products(id),
  product_name      text NOT NULL,
  unit_price_paise  integer NOT NULL CHECK (unit_price_paise >= 0),
  -- Price list value on the server when the bill arrived (to spot bills made with an old price list).
  list_price_paise  integer NOT NULL,
  quantity          integer NOT NULL CHECK (quantity > 0),
  line_total_paise  bigint NOT NULL CHECK (line_total_paise >= 0),
  CONSTRAINT sale_items_line_total_check CHECK (line_total_paise = unit_price_paise::bigint * quantity),
  UNIQUE (sale_id, product_id)
);
CREATE INDEX sale_items_product_idx ON sale_items (product_id);

-- End-of-day cash tally: what the driver handed over vs what the bills say.
CREATE TABLE settlements (
  id                   serial PRIMARY KEY,
  driver_id            integer NOT NULL REFERENCES drivers(id),
  settle_date          date NOT NULL,
  expected_cash_paise  bigint NOT NULL,
  cash_received_paise  bigint NOT NULL CHECK (cash_received_paise >= 0),
  note                 text,
  settled_by_admin_id  integer REFERENCES admins(id),
  settled_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (driver_id, settle_date)
);
