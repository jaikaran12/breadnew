-- 0005: route planning and visit checks.
--
-- * stores: where each shop is (lat/lng). location_status says who placed it: 'owner' (set or checked by the
--   owner) or 'driver' (saved by a driver standing at the shop, waiting for the owner to check it).
-- * routes / route_stops: the shops a driver visits, in order, on given days of the week.
-- * visits: every time a driver records a bill or "no bill" at a shop, with where the phone was, how far that
--   is from the shop's saved location, and the verdict (ok / far / no GPS / shop has no location).
-- * route_days: the plan a driver had on a day (so later route changes do not rewrite old days).
--
-- Only new tables and new columns: an older version of the app keeps working on this database.

ALTER TABLE stores ADD COLUMN lat REAL CHECK (lat IS NULL OR (lat BETWEEN -90 AND 90));
ALTER TABLE stores ADD COLUMN lng REAL
  CHECK (lng IS NULL OR (lng BETWEEN -180 AND 180))
  CHECK ((lat IS NULL) = (lng IS NULL));
ALTER TABLE stores ADD COLUMN location_status TEXT
  CHECK (location_status IS NULL OR location_status IN ('owner', 'driver'))
  CHECK ((location_status IS NULL) = (lat IS NULL));
ALTER TABLE stores ADD COLUMN location_by_driver_id INTEGER REFERENCES drivers(id);
ALTER TABLE stores ADD COLUMN location_at TEXT;

CREATE TABLE routes (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  -- The driver who follows this route (NULL = not given to anyone yet).
  driver_id   INTEGER REFERENCES drivers(id),
  -- Days it runs: 1 = Monday … 7 = Sunday, e.g. '123456' = Monday to Saturday.
  days        TEXT NOT NULL DEFAULT '1234567' CHECK (days <> '' AND days NOT GLOB '*[^1-7]*'),
  is_active   INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  notes       TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE UNIQUE INDEX routes_name_key ON routes (lower(name));
CREATE INDEX routes_driver_idx ON routes (driver_id);

CREATE TABLE route_stops (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  route_id  INTEGER NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
  store_id  INTEGER NOT NULL REFERENCES stores(id),
  -- 1, 2, 3 … in the order the driver goes.
  position  INTEGER NOT NULL CHECK (position > 0),
  UNIQUE (route_id, store_id),
  UNIQUE (route_id, position)
);
CREATE INDEX route_stops_store_idx ON route_stops (store_id);

CREATE TABLE visits (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  -- Generated on the phone, so a visit sent twice is saved once.
  client_id             TEXT NOT NULL UNIQUE,
  driver_id             INTEGER NOT NULL REFERENCES drivers(id),
  store_id              INTEGER NOT NULL REFERENCES stores(id),
  -- The bill made at this visit (kind 'bill').
  sale_id               INTEGER REFERENCES sales(id) ON DELETE CASCADE,
  kind                  TEXT NOT NULL CHECK (kind IN ('bill', 'no_bill')),
  -- Why there was no bill: closed, stock_ok, owner_away, other.
  reason                TEXT,
  note                  TEXT,
  visited_at            TEXT NOT NULL,
  -- Business day in APP_TIMEZONE.
  visit_date            TEXT NOT NULL,
  -- The route the driver was following, if any.
  route_id              INTEGER REFERENCES routes(id) ON DELETE SET NULL,
  -- Where the phone was (NULL when the phone gave no location).
  lat                   REAL,
  lng                   REAL,
  accuracy_m            REAL,
  -- The shop's saved location at that moment, and who had saved it ('owner' / 'driver').
  shop_lat              REAL,
  shop_lng              REAL,
  shop_location_status  TEXT,
  -- Metres between the phone and the shop (when both are known), and the distance allowed at that moment.
  distance_m            INTEGER,
  radius_m              INTEGER NOT NULL,
  status                TEXT NOT NULL CHECK (status IN ('ok', 'far', 'no_gps', 'no_shop_location')),
  device_visited_at     TEXT,
  created_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK ((lat IS NULL) = (lng IS NULL)),
  CHECK (kind = 'no_bill' OR sale_id IS NOT NULL)
);
CREATE INDEX visits_date_idx ON visits (visit_date, driver_id);
CREATE INDEX visits_store_idx ON visits (store_id, visited_at);
-- One visit per bill.
CREATE UNIQUE INDEX visits_sale_key ON visits (sale_id) WHERE sale_id IS NOT NULL;

CREATE TABLE route_days (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  day         TEXT NOT NULL,
  driver_id   INTEGER NOT NULL REFERENCES drivers(id),
  route_id    INTEGER NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
  route_name  TEXT NOT NULL,
  -- JSON array of shop ids, in order.
  store_ids   TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  UNIQUE (day, driver_id, route_id)
);
