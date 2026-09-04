# Deploying to leads.bluebot.blue (SiteGround)

This app is a plain Node/Express server (`server/index.js`) that serves both
the API and the static frontend from one process. SiteGround's Node.js App
Manager (Site Tools > Devs > Node.js) runs exactly this kind of app - no
rewrite needed - but a few things below are specific to that environment, and
one thing (the Google Places API) needs a decision before you start.

## 0. Read this first: Google Places API

Google froze the **legacy** Places API in March 2025. If you're creating a
**new** Google Cloud project (per your last answer, you are), you will not
be able to enable the old "Places API" at all - only **Places API (New)**.
This app already targets Places API (New) (`server/placesClient.js`) as of
this change, so you don't need to do anything differently here - just make
sure that when you're in the Cloud Console API Library, you enable **"Places
API (New)"**, not the classic "Places API" (which won't even offer an
enable button on a fresh project).

Steps:
1. https://console.cloud.google.com -> create a project (or pick an existing one).
2. APIs & Services -> Library -> search "Places API (New)" -> Enable.
3. Billing -> link a billing account to the project (required even for the free tier/credits).
4. APIs & Services -> Credentials -> Create Credentials -> API key.
5. **Restrict the key** (Credentials -> click the key -> "API restrictions"):
   restrict it to "Places API (New)" only. Do this before you put the key
   anywhere near a public subdomain.

You will NOT ship this key to the browser - it's read server-side only
(`GOOGLE_PLACES_API_KEY` env var, read in `server/routes/search.js`).

## 1. Get the code onto SiteGround

Pick whichever of these your plan supports (Site Tools > Devs shows what's
available on yours):

- **Git (preferred)**: Site Tools > Devs > Git > create a repository pointed
  at this GitHub repo/branch, or add SiteGround's deploy key to the GitHub
  repo and pull. This is the only option that makes future updates a
  `git pull` instead of a re-upload.
- **SSH**: if your plan includes shell access, `git clone` the repo directly
  under your account's home directory.
- **Manual upload**: download the repo as a zip and upload/extract via File
  Manager or SFTP. Works, but every future change means re-uploading.

Wherever it lands, note the absolute path - the Node.js App Manager asks for
it as "Application root."

## 2. Create the subdomain

Site Tools > Domain > Subdomains -> create `leads` under `bluebot.blue`. If
bluebot.blue's DNS is managed in this same SiteGround account (which your
last answer says it is), this also creates the DNS record automatically -
nothing to do manually in the DNS Zone Editor.

## 3. Create the Node.js application

Site Tools > Devs > Node.js > Create Application:

- **Node.js version**: pick the newest available (this app targets Node
  \>= 18; anything 18 LTS or newer works).
- **Application mode**: Production.
- **Application root**: the path from step 1.
- **Application URL**: `leads.bluebot.blue`.
- **Application startup file**: `server/index.js`.

SiteGround's Node manager (like the cPanel Node Selector it's built on)
assigns the app a port itself and expects the app to read it from the
environment - this app already does that (`process.env.PORT` in
`server/index.js`), so no change needed there.

After creating the app, use its **"Run NPM Install"** button to install
dependencies from the committed `package.json`/`package-lock.json`.

## 4. Set environment variables

In the same Node.js app's configuration screen, add:

| Variable | Value |
|---|---|
| `GOOGLE_PLACES_API_KEY` | the restricted key from step 0 |
| `LEADS_BASIC_AUTH_USER` | a shared username for your team |
| `LEADS_BASIC_AUTH_PASSWORD` | a real password - not the placeholder in `.env.example` |
| `NODE_ENV` | `production` |

**Do not skip `LEADS_BASIC_AUTH_USER`/`LEADS_BASIC_AUTH_PASSWORD`.** If
either is missing, the app logs a warning and runs with no access gate at
all - anyone who finds the URL can run searches on your Google billing.

Restart the application from the manager after saving env vars so they take
effect.

## 5. Enable HTTPS

Site Tools > Security > SSL Manager -> select `leads.bluebot.blue` -> install
a free Let's Encrypt certificate -> enable "HTTPS Enforce" if offered, so
`http://` requests redirect to `https://`. Basic Auth credentials travel as
base64 (not encrypted) - they must never go over plain HTTP.

## 6. Verify

Visit `https://leads.bluebot.blue`. Your browser should prompt for the
Basic Auth username/password before showing anything. After logging in, run
a real search (e.g. City=Kingfisher, State=OK, Industry=Plumbing) and
confirm results come back - this is also your first real-world check that
Places API (New) is wired up correctly, since nothing in this repo has been
tested against a live key.

## Updating later

- Git-deployed: pull the latest commit, re-run "NPM Install" if
  `package.json` changed, restart the app from the Node.js manager.
- Manual upload: re-upload changed files, same restart step.

## What's already handled in code (nothing to configure)

- `helmet()` sets standard security headers.
- `express-rate-limit` caps `/api/search` at 20 requests per 15 minutes per
  client (`server/routes/search.js`), so even a leaked password or a stuck
  retry loop can't produce an open-ended Google bill.
- `app.set('trust proxy', 1)` so rate limiting sees the real client IP
  through SiteGround's reverse proxy, not the proxy's own IP.
