# Milestones — versions you can go back to

Each line is a finished, tested version that is safe to put back online. Newer versions only add to the
database (new tables and columns), so an older version keeps working on today's data and simply ignores
what it does not know; bills made in between are kept.

| Date | Version (commit code) | What it has |
|---|---|---|
| 15 Nov 2026 | `2f48d829d7dae8bab876db95738e1f45c18fb57a` | Bills with shop discounts, expired returns taken off the bill (net amount), Tally bulk-upload Excel, shop pincode and GSTIN, Tally export. **Before route planning.** |

## How to put a milestone back online

1. GitHub → **Actions** → **Bread Sales** → **Run workflow** (on the right).
2. Paste the milestone's **full commit code** from the table into **“To go back to an earlier version”**.
3. **Run workflow.** About 2 minutes later that version is online (website, driver app and server). The
   Android app needs nothing: it opens the website. No new app is published for a rollback.

To return to the newest version: run the workflow again with the box empty (or push a new change).

## Only if the data must go back too (rare)

Every deploy writes a **database restore point** at the top of its run summary (“Database restore point
before this deploy: …”) — the database just before that version changed it. In `bread-sales-tracker/server`
with `CLOUDFLARE_API_TOKEN` set: `npx wrangler d1 time-travel restore bread-sales --bookmark=<restore point>`.
Cloudflare keeps restore points for several days only, and going back removes everything recorded after that
moment (bills included) — download a backup first (website → Settings → Download backup now).
