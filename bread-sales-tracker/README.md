# Bread Sales — billing app for drivers + sales website for the owner

A simple system for a bakery that sells bread to kirana shops from delivery autos.

* **Drivers** use an Android app with very big buttons (Hindi or English): choose the **area**, choose the
  **shop**, press **+ / −** for each product, and the app shows the **exact total**. They choose
  Cash / UPI / Udhaar and press **Save bill**. No more adding up in their heads.
* **You (the owner)** see every bill on a website **as soon as it is saved**. The website has a cash tally
  for each driver, reports, shops, products and prices, and drivers.

![Driver app: home, area, shop, items, check, saved](docs/driver-app-flow.png)

![Typing a quantity, the day's bills with cash to hand over, and working without internet](docs/driver-app-more.png)

![Owner website: live dashboard](docs/admin-dashboard.jpg)

![Cash tally: expected cash per driver vs cash handed over](docs/admin-cash-tally.jpg)

---

## What it does

### Driver app (Android)

| Screen | What the driver does |
| --- | --- |
| Login | Mobile number + 4–6 digit PIN (once — the app stays logged in) |
| Home | Today's total, **New bill**, **My bills**. Shows if any bills are waiting for internet |
| Area → Shop | Big area buttons, then the shops of that area (with search). Shops already billed today get a ✓ and the amount. The search box on the area screen searches all shops |
| Items | All products with colour, name, local name and price. **+ / −** buttons, or tap the number to type it on a calculator pad (e.g. 24). The total updates live at the bottom |
| Check bill | Bill table (item, qty, rate, amount), the total in large digits, and how the shop paid: **Cash / UPI / Udhaar** |
| Saved | Big ✓ and the amount. **Share bill** on WhatsApp, **Next shop** |
| My bills | Bills for today, yesterday or any date. Shows **Cash to hand over**, UPI and udhaar. Each bill can be opened and shared, and cancelled within 30 minutes if it was a mistake |
| Add shop | If a new kirana shop wants bread, the driver can add it on the spot (marked “added by driver” on your website) |

**Works without internet.** Bills are saved on the phone first and sent automatically when the internet comes
back. The same bill is never counted twice. The shop list and prices are kept on the phone and refreshed
automatically when there is internet.

**Totals are always correct.** Prices come only from your website (drivers cannot change them).
All money is calculated in whole paise, and the server checks every bill total again before saving it.

### Owner website

| Page | Use it for |
| --- | --- |
| **Dashboard** | Today's sales, live (refreshes every 15 seconds): total, bills, shops visited, cash / UPI / udhaar, per driver, per area, products sold, last 14 days, latest bills |
| **Sales (bills)** | Every bill with filters (dates, driver, area, payment, cancelled, shop name or bill number). Open a bill to see the items; cancel a wrong bill (with a reason) or restore it. Download as CSV (opens in Excel) |
| **Cash tally** | At the end of the day: for each driver, **cash expected** (cash bills only), UPI and udhaar. Type the cash handed over and the page shows **Short ₹… / Extra ₹… / Matches**. If a late bill arrives after you tallied, the page warns you. After you tally a day, the driver can no longer cancel bills from that day on the phone |
| **Reports** | Any date range, grouped by product, shop, area, driver or day, with CSV download |
| **Shops (kirana)** | Search, filter by area, find shops with no bill for 3/7/30 days, add/edit/remove shops, see each shop's purchases (what they buy, average bill, udhaar, recent bills). **Import your whole shop list from Excel** |
| **Areas** | Add/rename areas, set their order in the app |
| **Products & prices** | Add products, change prices (with price history), colours, order in the app, hide products |
| **Drivers** | Add drivers (mobile + PIN), change PIN, turn off, log out a lost phone, unlock after wrong PINs, see today's sales and when the app was last used |
| **Settings** | Business name / phone / bill footer (shown on WhatsApp bills), change password, add more admin users (manager, accountant) |

The website also works on a phone.

---

## How the pieces fit

```
 Driver phones (Android app)                     You (browser)
        │  HTTPS, works offline + sync                │
        ▼                                             ▼
 ┌─────────────────────────── server ────────────────────────────┐
 │  Node.js API  (/api/driver/*, /api/admin/*)                   │
 │  Admin website (/)      Driver web app (/driver/, optional)   │
 └───────────────────────────────┬───────────────────────────────┘
                                 ▼
                           PostgreSQL database (+ daily backups)
```

| Folder | What is in it |
| --- | --- |
| `server/` | API server (Node.js 22, Express, PostgreSQL). Database tables in `server/migrations/`. Tests in `server/test/` |
| `admin-web/` | Owner website (React) |
| `driver-app/` | Driver app (React) and its Android project (`driver-app/android`, made with Capacitor) |
| `Dockerfile`, `docker-compose.yml`, `Caddyfile`, `deploy/` | Production setup: one container with everything, PostgreSQL, automatic HTTPS, daily backups |
| `render.yaml` | One-click setup on Render.com (alternative to your own server) |
| `../.github/workflows/bread-sales.yml` | GitHub Actions: tests, and **builds the Android APK** for you. This file has to sit in the repository's top-level `.github` folder |

---

## 1. Put the server online

You need the server online before giving the app to drivers. Choose **A** (cheapest, your own small server)
or **B** (no server to look after).

### A. Your own server (VPS) with Docker — recommended

Cost: a VPS with **2 GB RAM** (DigitalOcean / Hetzner / AWS Lightsail / Hostinger, ~₹500–900 per month)
and a domain name (~₹800 per year). An Indian region such as Mumbai or Bangalore is best.

1. **Domain:** in your domain's DNS settings add an **A record**, e.g. `sales.mybakery.in` → your server's IP address.
2. **Install Docker** on the server (Ubuntu): `curl -fsSL https://get.docker.com | sh`
3. **Get the code and settings:**
   ```bash
   git clone https://github.com/<you>/breadnew.git
   cd breadnew/bread-sales-tracker
   cp .env.example .env
   nano .env        # fill in DOMAIN, passwords, BUSINESS_NAME
   ```
   For the secrets, use `openssl rand -hex 32` for `JWT_SECRET` and a separate one for `POSTGRES_PASSWORD`.
4. **Start everything:**
   ```bash
   docker compose up -d --build
   ```
   The first build takes a few minutes. Caddy gets a free HTTPS certificate for your domain by itself.
5. Open `https://sales.mybakery.in`, log in with `ADMIN_USERNAME` / `ADMIN_PASSWORD` from `.env`, and
   **change the password** under Settings.

**Updating to a new version:** `git pull && docker compose up -d --build` (the database is kept; table changes are applied automatically).

**Backups:** a copy of the database is written every day to `bread-sales-tracker/backups/` (kept 30 days).
Copy that folder somewhere else regularly too (e.g. with `rclone` to Google Drive), so you still have
your data if the server itself is lost. To restore a backup:
```bash
gunzip -c backups/bread-2026-01-31_0400.sql.gz | docker compose exec -T db psql -U bread -d bread
```

Useful commands: `docker compose ps` (status), `docker compose logs -f app` (server log),
`docker compose restart app`.

> Small VPS with 1 GB RAM? Building may run out of memory. Add swap first:
> `sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile`

### B. Render.com (no server to manage)

1. Make an account at render.com and connect your GitHub.
2. **New → Blueprint**, pick this repository and set the Blueprint file to `bread-sales-tracker/render.yaml`.
   (If Render only looks at the repository root, copy `render.yaml` to the root first.)
3. Fill in `ADMIN_PASSWORD` and `BUSINESS_NAME` when asked. Render creates the database and the web
   service and gives you an `https://….onrender.com` address (you can add your own domain later).
4. Cost: roughly $7/month for the web service (Starter) + $6/month for the database (Basic) — check Render's
   current prices. Do not use the free plans for real data: free databases expire after 30 days and free web
   services go to sleep.

Paid Render databases include backups (see the database's Recovery / Backups page in the Render dashboard).

---

## 2. Set up your business in the website (first day)

1. **Products & prices** → add your ~17 products with the price you charge shops. Give each a colour and
   (optional) its Hindi/local name, then use ▲▼ to put them in the order the driver should see.
2. **Shops** → **Import from Excel / CSV**. Make a sheet with these columns (first row = headings):

   | Area | Shop name | Owner | Phone | Address |
   | --- | --- | --- | --- | --- |
   | Gandhi Nagar | Sharma Kirana | Ramesh Sharma | 9876543210 | Near Hanuman temple |
   | Station Road | Gupta General Store | | | Opp. bus stand |

   Copy the cells (with the heading row) and paste them in, or upload the CSV. Click **Check**, then
   **Import**. Areas are created automatically, and importing the same list again skips shops that already
   exist. Two shops with the same name in one area must be told apart, e.g. “Sharma Kirana (near temple)”.
3. **Drivers** → **Add driver** with name + mobile number. A PIN is suggested; give the mobile number and PIN
   to the driver.
4. **Settings** → business name, phone and the message printed at the bottom of shared bills.

> Want to try everything first with sample data (8 areas, 72 shops, 17 products, 4 drivers, 2 weeks of
> bills)? On a **test** server run `docker compose exec app node dist/scripts/seed-demo.js` (it refuses to
> run if you already have data). Demo drivers log in with 9000000001–9000000004, PIN 1234.

---

## 3. The Android app for drivers

GitHub builds the app for you (no Android Studio needed).

### One-time setup

1. **Tell the app your server address:** in GitHub, open the repository → **Settings → Secrets and
   variables → Actions → Variables → New repository variable**: name `API_BASE_URL`, value
   `https://sales.mybakery.in` (your address from step 1, must start with `https://`).
   If you skip this, the app asks for the address the first time it opens (tap “Server settings” on the
   login screen).
2. **Create the signing key** (needed so that app *updates* install over the old app). On any computer
   with Java:
   ```bash
   cd bread-sales-tracker/driver-app
   sh scripts/create-android-keystore.sh
   ```
   It prints four secrets to add under **Settings → Secrets and variables → Actions → Secrets**:
   `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`.
   **Keep the `.jks` file and password safe.** If you lose it, drivers must uninstall the app and install
   it again.

   Without these secrets GitHub still builds a **TEST** APK (`…-TEST.apk`). It works, but every build has a
   different signature, so updates cannot be installed over it. Use it only for trying out the app.

### Getting the APK

* Every push to GitHub runs **Actions → Bread Sales**. When it finishes, open the run and download
  **bread-sales-android-…** (a zip containing the `.apk`).
* For a release that's easy to share, create a tag: `git tag bread-sales-v1.0.0 && git push --tags`. The APK
  then appears under the repository's **Releases**, and you can send that link to drivers.
  Put that link in `APP_DOWNLOAD_URL` (in `.env`) so it is shown on the Drivers page.

### Installing on a driver's phone (Android 7 or newer)

1. Send the `.apk` to the phone (WhatsApp or the Releases link) and tap it.
2. Android asks to allow **“Install unknown apps”** for WhatsApp/Chrome — allow it, then **Install**.
3. Open **Bread Sales**, choose हिंदी or English, enter the driver's mobile number and PIN.
4. The app downloads the shop list and prices. From then on it works even without internet.

**Updating the app:** install the new APK over the old one. Saved bills and the login are kept, as long as
the release signing key from step 2 is used. Check that no bills are waiting to be sent first (the home
screen shows this).

**No Android app yet?** Drivers can use the same app in Chrome at `https://sales.mybakery.in/driver/`
(menu → “Add to Home screen”). It also keeps working without internet once opened.

### Driver quick guide (हिंदी में — ड्राइवर को समझाने के लिए)

1. **नया बिल** दबाएँ → अपना **एरिया** चुनें → **दुकान** चुनें (ऊपर नाम लिखकर भी खोज सकते हैं)।
2. हर सामान के आगे **+** दबाएँ (कम करने के लिए **−**)। ज़्यादा गिनती हो तो बीच वाला नंबर दबाकर सीधे लिखें।
3. नीचे **कुल** रकम दिखती है — यही दुकानदार से लेनी है। **आगे** दबाएँ।
4. बिल जाँचें, फिर चुनें दुकान ने कैसे पैसे दिए: **कैश / UPI / उधार** → **बिल सेव करें**।
5. **अगली दुकान** दबाएँ। इंटरनेट न हो तो भी बिल फ़ोन में सेव रहता है और नेट आते ही अपने आप चला जाता है।
6. शाम को **मेरे बिल** खोलें — **“जमा करने का कैश”** उतना कैश मालिक को देना है।
7. गलती से बिल बन गया? **मेरे बिल** → बिल खोलें → **यह बिल रद्द करें** (30 मिनट के अंदर), फिर सही बिल बनाएँ।

---

## 4. Everyday use for the owner

* **During the day:** the **Dashboard** shows bills arriving live. Click a driver or area to see their bills.
* **Evening:** open **Cash tally**, enter the cash each driver hands over and press **Save**. Check UPI
  amounts against your UPI app. Udhaar shows which shops took bread on credit (filter **Sales** by
  “Udhaar only” to follow up).
* **Wrong bill?** Find it under **Sales**, open it, **Cancel this bill…** with a reason. Cancelled bills stay
  visible (struck out) but are not counted anywhere.
* **Price change?** Edit the product. Phones pick up the new price within a few minutes when online. Bills
  made earlier keep their old price. A bill made with an old price list is marked “Old rate”.
* **Watch for:** many “Cancelled by driver” bills, shops not visited for days (Shops → “No bill for 7+
  days”), and differences in the cash tally.

---

## 5. Settings reference (`.env`)

| Variable | Default | Meaning |
| --- | --- | --- |
| `DOMAIN` | — | (docker compose) your web address for HTTPS |
| `POSTGRES_PASSWORD` | — | (docker compose) database password |
| `DATABASE_URL` | — | PostgreSQL address (set automatically by docker compose / Render) |
| `DATABASE_SSL` | off | `true` or `no-verify` if your database provider requires SSL |
| `JWT_SECRET` | — | long random text used to sign logins (required) |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | — | first admin account, created only when there is none |
| `BUSINESS_NAME` | My Bakery | first business name (change later in Settings) |
| `APP_TIMEZONE` | Asia/Kolkata | decides which day a bill belongs to |
| `DRIVER_CANCEL_WINDOW_MINUTES` | 30 | how long a driver can cancel their own bill (0 = never) |
| `APP_DOWNLOAD_URL` | — | link to the APK, shown on the Drivers page |
| `COOKIE_SECURE` | true | set `false` only when testing without HTTPS |
| `TRUST_PROXY` | 1 | number of proxies in front of the server (Caddy / Render) |
| `LOGIN_RATE_LIMIT` | 30 | login attempts allowed per network per 15 minutes |

---

## 6. Security

* Website login uses a secure, HTTP-only cookie; passwords and PINs are stored only as bcrypt hashes.
* Five wrong PINs lock that driver for 15 minutes, and logins per network are rate limited.
* Turning a driver off, or changing their PIN, logs their phone out immediately. If a phone is lost, use
  **Drivers → Log out phone**.
* The Android app only talks to `https://` servers and keeps its data out of phone backups.
* Keep `.env`, the signing key (`.jks`) and backups private. Never commit them to Git.

---

## 7. For developers

Requirements: Node.js 22+, PostgreSQL 14+ (or Docker).

```bash
# Server (http://localhost:8080)
cd server
cp .env.example .env              # points to postgres://bread:bread@localhost:5432/bread_dev
npm install
npm run seed:demo                 # optional demo data
npm run dev

# Admin website with hot reload (http://localhost:5173, calls the server on :8080)
cd admin-web && npm install && npm run dev

# Driver app in the browser (http://localhost:5174)
cd driver-app && npm install && npm run dev
```

Tests:

```bash
cd server && npm test             # API tests against a real PostgreSQL (TEST_DATABASE_URL, default bread_test)
cd driver-app && npm test         # bill total / merge logic
```

Android app locally (needs Android Studio / Android SDK + JDK 21):

```bash
cd driver-app
cp .env.android.example .env.android     # set VITE_API_BASE_URL
npm run build:android && npx cap sync android
cd android && ./gradlew assembleDebug    # or open the android folder in Android Studio
```

Changing the app id (`com.breadsales.driver`, needed before publishing on the Play Store): edit
`driver-app/capacitor.config.ts`, `android/app/build.gradle` (`namespace`, `applicationId`), the
`MainActivity` package and `android/app/src/main/res/values/strings.xml`. App icons are generated by
`node scripts/make-android-icons.cjs`.

### API overview

All amounts are integers in **paise** (₹42.50 = `4250`). Dates are `YYYY-MM-DD` in `APP_TIMEZONE`.

| Method & path | Who | Purpose |
| --- | --- | --- |
| `POST /api/driver/login` | driver | `{phone, pin}` → `{token, driver}` |
| `GET /api/driver/catalog` | driver | areas, shops, products with prices, business info |
| `POST /api/driver/sales` | driver | save a bill `{clientId, storeId, soldAt, paymentMode, items[{productId, quantity, unitPricePaise}], totalPaise}`. Sending the same `clientId` again returns the saved bill |
| `GET /api/driver/sales?date=` | driver | own bills for a day |
| `POST /api/driver/sales/:id/cancel` | driver | cancel own bill (time limit, not after the day is tallied) |
| `POST /api/driver/stores` | driver | add a shop |
| `POST /api/admin/login` | admin | sets the login cookie |
| `GET /api/admin/dashboard?date=` | admin | dashboard numbers |
| `GET /api/admin/sales` · `/sales/export.csv` · `/sales/:id` · `POST /sales/:id/cancel` · `/restore` | admin | bills |
| `GET/PUT/DELETE /api/admin/tally` | admin | cash tally per driver per day |
| `GET /api/admin/reports?groupBy=product\|store\|area\|driver\|day&format=json\|csv` | admin | reports |
| `/api/admin/areas`, `/stores` (+ `/import`, `/export.csv`), `/products` (+ `/reorder`, `/:id/price-history`), `/drivers` (+ `/:id/pin`, `/unlock`, `/logout`), `/settings`, `/admins`, `/password` | admin | manage data |
| `GET /api/health` | anyone | health check |
