-- 0004: shop details needed for the Tally bulk upload: pincode and GSTIN.
-- A shop with a GSTIN goes to Tally as "Regular"; without one as "Unregistered/Consumer".
-- New columns only (nothing is rebuilt); existing shops start without them.

ALTER TABLE stores ADD COLUMN pincode TEXT
  CHECK (pincode IS NULL OR (length(pincode) = 6 AND pincode GLOB '[1-9][0-9][0-9][0-9][0-9][0-9]'));

ALTER TABLE stores ADD COLUMN gstin TEXT
  CHECK (gstin IS NULL OR (length(gstin) = 15 AND gstin = upper(gstin)));
