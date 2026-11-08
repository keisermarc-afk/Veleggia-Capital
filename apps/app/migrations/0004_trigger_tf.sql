-- Trigger timeframe per asset (8 Nov 2026): '' = two 4H closes (default), '1H' = two 1H closes.
ALTER TABLE range_levels ADD COLUMN trigger_tf TEXT NOT NULL DEFAULT '';
