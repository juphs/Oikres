# Oikres

Student lodge and room-share marketplace for UNIZIK, Awka (oikres.com).
Node.js 24, Express, EJS, plain CSS and JavaScript, SQLite (built into Node). No database server and no accounts are needed to run it.
Light and dark themes follow the device automatically. There is no theme button.

## Run it

You need **Node.js 24 or newer** (check with `node -v`). On Ubuntu, if yours is older: `curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/master/install.sh | bash`, open a new terminal, then `nvm install 24`.

```bash
npm install
cp .env.example .env
npm start
```

Open http://localhost:3000. The terminal prints a local admin sign-in (`admin@oikres.local` with the password from `.env`). Sign in at `/login`, then open `/admin`.

That is all. The first start creates the `data/` folder with the database and your uploads, adds the starter areas around UNIZIK, and creates the local admin. Photos and videos upload to `data/uploads` with no Cloudinary account, and emails are printed in the terminal.

Want sample lodges to look at? `npm run seed` adds labelled demo lodges (development only). `npm run seed:remove` deletes them.

## The admin has full control

Sign in as an administrator and open **Admin**. From the sidebar (desktop) or the tab strip (phone):

- **Site settings** change the site name, tagline, description, web address, support WhatsApp number and email, logo (with an optional dark-mode logo), app icon, and **all colours** with a Photoshop-style picker that supports transparency. Light and dark mode are set separately and each visitor sees the one their device uses. Quick presets, live preview and readability warnings are built in. You can also pause sign-ups, turn lodge review on or off, change the reconfirm and report rules, show an announcement banner, and switch on maintenance mode (administrators can still get in).
- **Users** search every account, edit details, verify email, set a new password, suspend or reactivate, make or remove administrators, send a reset email, **view the site as that person** (with a banner to return, recorded in the audit log), delete an account, or erase it completely. The last administrator is protected.
- **Lodges** approve or reject, edit any lodge, feature it (shown first), mark confirmed or rented, hide, suspend, or delete it for good.
- **Market** see every item for sale, approve (when pre-approval is on), hide, restore or delete it, and ban the seller. Pre-approval is off by default; turn it on in Site settings > Rules if you see scams.
- **Ads** create promo cards that show up inside the lodge list and the market list (see below).
- **Users** can also be **banned** (see below). **Listers** verify phone numbers and ID documents. **Reports** has four tabs: lodges, items, people and reviews. **Places** manage states, campuses, areas and junctions (see below). **Broadcast** sends a message to everyone, listers or administrators. **Audit log** records every admin action.

### Places: states, campuses and areas

Lodges and market items have a **state**, an optional **campus** and (lodges) an **area**. The forms offer them in that order, each list narrowing to the one before it, and the Browse and Market filters use the same lists. Anambra and UNIZIK exist from the start. To open a new city, go to **Admin > Places**: add the state, add its campuses, then its areas and junctions. The same area name (for example "GRA") can exist in different states. A hidden state, campus or area stops being offered in forms and filters but existing lodges keep showing.

### Market, profiles and reviews

- **Administrators' own posts go live at once**: your own lodges and market items skip the review queue, since you are the reviewer.
- **Video**: lodges (listers) and market items (anyone selling) can add one MP4 or MOV video. The video is always the first thing on the lodge page and the item page. Cards keep a photo as the cover and show a "Video" tag.
- **Market** (`/market`) is where students buy and sell. **Sell an item** (`/market/sell`) needs a signed-in account with a verified email. Buyers contact sellers on WhatsApp through a redirect, so the number is never printed on the page. Sellers manage items at `/market/mine` (edit, mark sold, sell again, delete).
- **Public profiles** (`/u/<id>`) show a person's lodges, items for sale, their star rating, how many people rated them, a breakdown by star, and every review. The rating also appears on lodge and item pages. Email addresses and phone numbers are never shown. Profiles are not indexed by search engines.
- **Reviews** are one per person, 1 to 5 stars with an optional comment, editable and deletable by the author. People cannot review themselves. Reviews from banned accounts stop counting. Admins can remove a review (the author cannot post another about that person).
- **Reports** can be sent about an item, a person or a review, by signed-in or anonymous visitors. An item is hidden automatically after the same number of different reporters as lodges (Site settings > Rules).

### Bans

On a person's admin page (or from any report) choose **Ban**, pick a reason and add a private note. The person is signed out at once and cannot sign in (they are told the account is banned, but only after entering the correct password). Their lodges and items are hidden, reviews they wrote stop counting, and open reports about them are closed. Their email stays on record so it cannot be used to sign up again, so **do not delete a banned account**. Their public profile shows a "banned" notice but never the reason. **Lift ban** lets them sign in again; their lodges and items stay hidden until you restore them. Administrators cannot be banned.

### Ads

**Admin > Ads > New ad**: a headline, optional text and image, a "Sponsored by" line, a label (default "Ad"), and a button that opens a web page, a page on this site, or a WhatsApp chat. Choose where it shows (lodge list, market list or both), optionally limit it to a state or campus, and optionally set start and end dates. Ads appear as cards after the 2nd result and then after every 4 more, on the first page of the lodge and market lists. A short or empty list still shows every ad (at the end), so a new site is not left looking like ads are broken. They are not shown while someone searches for words. Views and clicks are counted. Switching an ad off or deleting it takes effect at once.

The Help page has a **Chat on WhatsApp** button. The number comes from Site settings, or `SUPPORT_WHATSAPP` in `.env`, or the first administrator's phone number.

## What is where

- `data/oikres.db` the database (one file). `data/uploads` public photos and videos. `data/private` ID documents (never public). `data/backups` backups. Delete `data/` to start again from nothing. It is git-ignored.
- `.env` your settings. `.env.example` lists every setting with comments.


### Welcome popup

**Admin > Popup** edits the introduction shown to each visitor the first time they open the site (a bottom sheet on a phone, a card on larger screens). Set the title, a short introduction, the button text, and up to 10 features, each with an icon, a title and a description (reorder with Move up and Move down). Write `{site}` where the site name should appear. Typo fixes do not show it again; tick **Show it again to everyone** when you add something new. **Preview** shows the saved popup even when it is switched off. It is never shown on sign-in pages, forms or the admin area, and the same features appear as plain text on the Help page. Anyone can reopen it from **Take the tour** in the footer.

### Videos, galleries and auto-scroll

- Lodge pages and item pages open with the **video first**, then the photos. Market items accept one video (MP4 or MOV), like lodges.
- Videos **start by themselves, muted** (phones only allow this). When a video ends the gallery moves to the next slide; photos stay about 4 seconds, then it slides on, and it starts over after the last. Touching or swiping pauses the movement for 12 seconds, pausing a video stops it until played again, and nothing moves while the gallery is off screen or the tab is in the background.
- There are dots, a counter and (on computers) arrows. **Tapping a photo opens it full screen**, where it can be swiped and pinched; Escape closes it.
- People who turned on "reduce motion" or Data Saver get no autoplay and no automatic sliding.
- **Ads can carry a video** (Admin > Ads, up to 25 MB, MP4 or MOV). It plays muted and repeats while visible, pauses when scrolled away, and the ad's image is shown until it loads.

### More for sellers and buyers

- **Saved items**: the heart on items (account required). **Saved** has Lodges and Items tabs; people who saved an item are told when it sells.
- **Expiry**: an item is shown for 60 days. Sellers get a reminder 5 days before, then it leaves the market until they tap **Renew**. Expired items stay visible by direct link with a note, and are left out of search and the sitemap.
- **Seller stats** on Your items: views, chats and saves (one view or chat per visitor per day, so refreshing does not inflate them) and days left.
- **Featured items**: Admin > Market > an item > Feature shows it first with a tag.
- **Draft saving**: the sell form keeps what was typed and the uploaded photos on the device, so a reload while taking a photo loses nothing.
- Ads show their click-through rate in Admin > Ads.

### Tests

`npm test` runs the data tests and three end-to-end walks over HTTP (`scripts/flow.js` lodges, `flow-market.js` market, profiles, bans, ads, popup, expiry, `flow-hardening.js` access control, CSRF, other people's data, hostile input, security headers, and a crawler that fails on any error page). The pages were also checked in a real phone-sized browser at 320, 375 and 412 pixels wide plus tablet and desktop, in light and dark mode: no sideways scrolling, touch targets of at least 40 pixels, readable text, labelled form fields, working autoplay and auto-scroll.

## Commands

| Command | What it does |
| --- | --- |
| `npm start` | Checks settings, opens and updates the database, starts the site. |
| `npm run dev` | Same, restarting when files change. |
| `npm run admin:create` | Create an administrator (asks in the terminal). |
| `npm run admin:reset` | New password for an existing administrator. Needs access to the server, so visitors cannot use it. |
| `npm run seed` / `npm run seed:remove` | Add or remove sample lodges. Development only. |
| `npm run backup` | Copy the database to `data/backups` (copy `data/uploads` too). |
| `npm test` | Tests. They use a temporary database and need no network. |
| `npm run smoke` | Starts the site with a temporary database and walks through register, list, approve and browse. |

## Going live

1. Use a host with a **persistent disk** (a VPS, or Render with a disk) and Node 24. Point `DATA_DIR` at the disk and back it up.
2. In `.env` set `NODE_ENV=production`, `BASE_URL=https://oikres.com`, a 32+ character `SESSION_SECRET`, and your SMTP details. Startup refuses to run if any of these are missing or weak, and it refuses the example admin password. Create your admin with your own values in `ADMIN_*`, or clear them and run `npm run admin:create`.
3. Put HTTPS in front (Caddy, Nginx, or the host's own). `TRUST_PROXY` defaults to 1 in production.
4. Optional: fill the three `CLOUDINARY_*` values to store photos and videos on Cloudinary instead of the disk. ID documents always stay on your server.
5. Add SPF and DKIM records for your email domain, or verification emails will land in spam.
6. Run one instance. `GET /healthz` reports whether the database is reachable. A backup is made automatically each day (last 7 kept) and before any database upgrade.

## How the rules work

- Lodge flow: draft, pending review, live. Admin approves or rejects with a reason. Editing a live lodge sends it back for review; updating free spaces and reconfirming do not.
- Reconfirm: after 14 days a lodge asks its lister to confirm; after 30 days without a reply it is hidden (restored with one tap). Three distinct reports also hide a lodge for review.
- Charges: percent fees are worked out from each room's own rent. The agent fee is paid by the tenant on top of rent (10% by default; the lister can change the percent or use a fixed amount). Every charge shows who is paid. A lodge cannot be submitted until the lister confirms all charges are listed. Listers cannot add Oikres charges.
- Rooms: one property can hold several rooms or bed spaces, each with its own rent, period, spaces left and gender preference.
- Verification is manual and separate: Phone verified and ID checked (lister), Property visited (each lodge). Nothing is automatic. ID documents are visible only to admins and deleted 30 days after the decision.

## Troubleshooting

- **`npm install` says the engine is not supported**: your Node is older than 24. Run `nvm install 24`.
- **"Port 3000 is already in use"**: stop the other program, or set `PORT=3001` in `.env`.
- **"Could not open the database"**: `DATA_DIR` must be a folder this user can write to.
- **Startup lists settings to fix**: each line says what to change in `.env`.
- **Signed out after a restart in development**: delete nothing; the secret is kept in `data/.session-secret`. If you deleted `data/`, sessions reset.
- **Forgot the admin password**: `npm run admin:reset`.
- **No emails arrive**: with `SMTP_HOST` empty they are only printed in the terminal. With SMTP set, check host, port (587 or 465), user and password.
- **A database upgrade failed**: the message names the migration and the backup saved just before it in `data/backups`.

## Project layout

- `server.js` entry. `src/start.js` startup and shutdown. `src/app.js` web wiring.
- `src/config/` settings and checks. `src/db/` SQLite adapter, migrations (`src/db/migrations`), backups.
- `src/repositories/` all SQL. `src/services/` rules (auth, listings, market, reviews, ads, bans, media, jobs, mail). `src/routes/` pages and API. `src/middleware/` sessions, CSRF, security.
- `views/` EJS pages. `public/` CSS, JavaScript, icons, service worker, manifest.
- `src/cli/` command-line tools. `scripts/` smoke test and the two end-to-end walks (`flow.js` lodges, `flow-market.js` market, profiles, bans, ads). `test/` tests.

## Not included yet

Google sign-in, web push notifications, offline caching of lodge listings (offline shows a friendly page), SMS verification, online payments.
