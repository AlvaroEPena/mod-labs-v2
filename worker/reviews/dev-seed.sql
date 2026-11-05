-- LOCAL DEV DATA ONLY: never run with --remote (the owner's rule: never publish invented reviews).
-- Apply with: npx wrangler d1 execute mod-labs-reviews --local --file worker/reviews/dev-seed.sql
-- Re-running replaces the previous seed rows. Times are relative to now (epoch ms).
DELETE FROM reviews WHERE name LIKE 'Local Test%';

INSERT INTO reviews (name, rating, service, source, body, status, created_at, approved_at) VALUES
  ('Local Test Ana', 5, 'Switch OLED', 'Instagram',
   'Local test review: dropped the console off in the morning and it was ready the same evening. Everything explained clearly.',
   'approved', CAST(strftime('%s', 'now') AS INTEGER) * 1000 - 9 * 86400000, CAST(strftime('%s', 'now') AS INTEGER) * 1000 - 8 * 86400000),
  ('Local Test Ben', 4, 'Repair', 'Google',
   'Local test review: joystick drift fixed.

Second paragraph to check spacing, plus <b>markup</b> that must show as text.',
   'approved', CAST(strftime('%s', 'now') AS INTEGER) * 1000 - 6 * 86400000, CAST(strftime('%s', 'now') AS INTEGER) * 1000 - 5 * 86400000),
  ('Local Test Cam', 5, NULL, 'A friend',
   'Local test review: no service picked, referred by a friend, to check the optional fields.',
   'approved', CAST(strftime('%s', 'now') AS INTEGER) * 1000 - 3 * 86400000, CAST(strftime('%s', 'now') AS INTEGER) * 1000 - 2 * 86400000),
  ('Local Test Dee', 5, 'Xbox 360 RGH', 'Other',
   'Local test review: the newest approved one, so it should be listed first.',
   'approved', CAST(strftime('%s', 'now') AS INTEGER) * 1000 - 2 * 86400000, CAST(strftime('%s', 'now') AS INTEGER) * 1000 - 1 * 86400000),
  ('Local Test Pending', 3, 'Custom build', 'Facebook',
   'Local test review: still pending, so it must never appear on the site.',
   'pending', CAST(strftime('%s', 'now') AS INTEGER) * 1000 - 3600000, NULL);
