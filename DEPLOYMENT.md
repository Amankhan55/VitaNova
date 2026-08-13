# Deploying VitaNova

Three pieces, three providers:

```
  Vercel                        Render                    MongoDB Atlas
  ────────                      ──────                    ─────────────
  Angular static build          FastAPI in Docker         M0 free cluster
  /api/* ──rewrite──────────▶   /api/*  ─────────────────▶
```

The frontend never calls Render directly. Vercel rewrites `/api/*` to the Render
service, so from the browser's point of view every request is same-origin — which
is why the app keeps its relative `API_BASE = '/api/v1'` unchanged, and why there
is no CORS configuration to get wrong.

Do it in this order: Atlas → Render → Vercel. Render needs the database URL, and
Vercel needs the Render URL.

---

## 1. MongoDB Atlas

Render has no managed MongoDB, so the database lives at Atlas.

1. Create a free **M0** cluster at <https://cloud.mongodb.com>.
2. **Database Access** → add a user with *Read and write to any database*. Use a
   generated password and copy it.
3. **Network Access** → **Allow access from anywhere** (`0.0.0.0/0`). Render's
   free tier has no static outbound IP, so there is nothing narrower to allow.
4. **Connect** → **Drivers** → copy the string. It looks like:

   ```
   mongodb+srv://USER:PASSWORD@cluster0.xxxxx.mongodb.net/?retryWrites=true&w=majority
   ```

   URL-encode the password if it contains `@ : / ? # [ ] %`.

No driver change is needed for the `+srv` scheme: PyMongo 4.9 made dnspython a
hard dependency, so `mongodb+srv://` resolves out of the box.

---

## 2. Render — the API

The repo already contains [`render.yaml`](render.yaml) and
[`backend/Dockerfile`](backend/Dockerfile).

**Why Docker and not Render's Python runtime:** WeasyPrint needs Pango installed
at the OS level. The native runtime gives you no way to `apt-get` it, so the PDF
endpoint would fail at import. The Dockerfile installs Pango plus the Liberation
fonts, which are metric-compatible with the Helvetica/Arial the templates ask for.

### Try the image locally first

Worth doing once — a Render build takes minutes to tell you what a local one tells
you in seconds.

```bash
cd backend
docker build -t vitanova-api:local .

# Does WeasyPrint work in the image? Renders every design, needs no database.
docker run --rm vitanova-api:local python scripts/render_samples.py --out /tmp/samples

# Full stack, including the $PORT binding Render relies on.
docker network create vn-test
docker run -d --name vn-mongo --network vn-test mongo:7
docker run -d --name vn-api --network vn-test -p 8080:9999 \
  -e PORT=9999 \
  -e VITANOVA_MONGO_URI=mongodb://vn-mongo:27017 \
  -e VITANOVA_DEBUG=false \
  -e VITANOVA_JWT_SECRET="$(openssl rand -hex 32)" \
  vitanova-api:local

curl localhost:8080/health          # {"status":"ok","app":"VitaNova","templates":9}

docker rm -f vn-api vn-mongo && docker network rm vn-test
```

Note this builds for your Mac's architecture. Render runs x86_64, so to reproduce
its exact image add `--platform linux/amd64` to the build (slower, emulated).

### Deploy

1. Push this repository to GitHub.
2. Render → **New** → **Blueprint** → select the repo. It reads `render.yaml`.
3. When prompted, paste your Atlas string into **`VITANOVA_MONGO_URI`**.
   `VITANOVA_JWT_SECRET` is generated for you; leave it alone.
4. Fill in the **SMTP** prompts — `VITANOVA_SMTP_HOST`, `_USER`, `_PASSWORD`,
   `_FROM`. These are not optional: signing in requires a confirmed email
   address, so with no way to send the confirmation the app refuses to start.
   See [Mail](#mail) below for what to put there.
5. Set **`VITANOVA_FRONTEND_BASE_URL`** to your Vercel URL (no trailing slash),
   e.g. `https://vitanova.vercel.app`. Confirmation and reset links are built
   from it, so a wrong value mails people a link that goes nowhere. You will not
   know it until step 3, so come back and fix it then.
6. Optionally set **`VITANOVA_GEMINI_API_KEY`** — a free key from
   <https://aistudio.google.com>, which powers "Import PDF" on the dashboard.
   Leave it empty and everything else works normally; only that one button
   fails, with a 503 saying import is not configured.
7. Optionally set **`VITANOVA_GOOGLE_CLIENT_ID`** to offer Google Sign-In — see
   [Google Sign-In](#google-sign-in). Unset simply means no Google button.
8. Apply. The first Docker build takes roughly 3–5 minutes.
9. Check it: `https://<your-service>.onrender.com/health` should return

   ```json
   { "status": "ok", "app": "VitaNova", "templates": 9 }
   ```

   `templates: 9` means the registry found the design folders. `/docs` gives you
   the full API.

If you would rather click through the dashboard than use the blueprint: **New →
Web Service**, Root Directory `backend`, Runtime **Docker**, Health Check Path
`/health`, and set `VITANOVA_MONGO_URI`, `VITANOVA_MONGO_DB=vitanova`,
`VITANOVA_DEBUG=false`, and a `VITANOVA_JWT_SECRET` you generate with:

```bash
python -c "import secrets; print(secrets.token_urlsafe(48))"
```

The app now refuses to start with `VITANOVA_DEBUG=false` and the default secret
still in place — every token it issued would be forgeable from a reading of this
repo. If startup fails with that message, the secret is the thing to fix.

---

## 3. Vercel — the frontend

[`frontend/vercel.json`](frontend/vercel.json) carries the build settings and the
rewrite.

1. **Edit `frontend/vercel.json` first** and replace the Render host:

   ```json
   { "source": "/api/:path*", "destination": "https://YOUR-SERVICE.onrender.com/api/:path*" }
   ```

   Commit it. Vercel cannot read environment variables inside a rewrite, so this
   has to be a literal URL.
2. Vercel → **Add New** → **Project** → import the repo.
3. Set **Root Directory** to `frontend`. Everything else comes from `vercel.json`
   (build `npm run build`, output `dist/frontend/browser`, framework *Other*).
4. Deploy.

The second rewrite is the SPA fallback. Vercel checks the filesystem before
applying rewrites, so hashed assets still serve normally and only unmatched paths
— `/dashboard`, `/editor/abc123` — fall through to `index.html`. Without it, those
URLs 404 on a hard refresh.

---

## 4. Check it end to end

1. Open the Vercel URL. The landing page renders without the API, so seeing it
   proves nothing yet.
2. Scroll to **Designs**. Live resume sheets there mean the rewrite and the API
   both work. Blank white cards mean the rewrite is wrong — check the Network tab
   for `/api/v1/templates`.
3. Register an account (proves Atlas is connected and writable). You will be
   told to check your inbox — the confirmation mail proves SMTP works, and
   clicking its link proves `VITANOVA_FRONTEND_BASE_URL` is right. No mail
   after a minute? Render's logs will have the reason; see [Mail](#mail).
4. Pick a design, type a line, **Download PDF** (proves Pango is present in the
   image).

---

## Mail

Sign-in requires a confirmed address, so mail is load-bearing here — not a
nice-to-have. Any SMTP provider works. Two that need no DNS setup:

**Gmail**, fine for a personal deployment and capped around 500 messages a day.
Turn on 2-Step Verification, then Google Account → Security → **App passwords**
and generate one. The 16-character result is `VITANOVA_SMTP_PASSWORD`; your
normal password will be rejected.

```ini
VITANOVA_SMTP_HOST=smtp.gmail.com
VITANOVA_SMTP_PORT=587
VITANOVA_SMTP_USER=you@gmail.com
VITANOVA_SMTP_PASSWORD=abcd efgh ijkl mnop
VITANOVA_SMTP_FROM=VitaNova <you@gmail.com>
```

`SMTP_FROM` has to be the mailbox you authenticated as, or Gmail rewrites or
rejects the message.

**Brevo, Mailgun, SendGrid, Postmark** all have free tiers and give you a host,
a username and an API-key-as-password that drop into the same four variables.
Worth it over Gmail if mail is going to strangers: their deliverability is the
product.

Port **465** instead of 587 means implicit TLS — set
`VITANOVA_SMTP_STARTTLS=false` as well. Render's free plan blocks outbound port
**25** entirely, so do not use it.

If mail never arrives, the log is the only place that says why: sending happens
in a background task and failures are deliberately invisible to the caller, so
that the API cannot be used to test which addresses have accounts. Look for
`Failed to send` in the Render logs. A line reading `[mail:not-sent]` means
`VITANOVA_SMTP_HOST` is empty and you are running in debug mode.

---
//test
## Google Sign-In

Optional. Without it, the button does not appear.

1. <https://console.cloud.google.com/apis/credentials> → **Create credentials**
   → **OAuth client ID** → application type **Web application**.
2. Under **Authorised JavaScript origins**, add every origin the app is served
   from — `https://vitanova.vercel.app`, and `http://localhost:4200` if you want
   it working in development. Vercel preview deployments get a fresh hostname
   each time and cannot be listed, so the button will not work there.
3. Leave **Authorised redirect URIs** empty. The button uses Google Identity
   Services, which hands the ID token to the page rather than redirecting.
4. Put the client ID in `VITANOVA_GOOGLE_CLIENT_ID` on Render.

The frontend reads it from `GET /api/v1/auth/providers` at runtime, so there is
nothing to rebuild or redeploy on Vercel — set it on the API and the button
appears. The client *secret* is not needed and should not be set anywhere: the
browser never exchanges a code, and the server verifies the ID token's signature
against Google's public keys.

Signing in with Google using an address that already has a password account
links the two; that account then works either way.

---

## Things that will bite you

**Free Render services sleep after 15 idle minutes.** The next request wakes the
container, which takes 30–60 seconds. Vercel's proxy will give up before that, so
the *first* visit after an idle period can fail outright rather than just feel
slow. Three ways out, in order of how much they cost:

- Ping `https://<service>.onrender.com/health` every 10 minutes from any free
  uptime monitor. Keeps it awake, costs nothing, slightly against the spirit of
  the free tier.
- Accept it, and tell users to reload once.
- Render **Starter** ($7/month) does not sleep. This is the real fix.

**512 MB of RAM on free.** WeasyPrint is the memory-hungry part. One-to-two-page
resumes are fine; the Dockerfile runs a single uvicorn worker deliberately, since
a second one would double the baseline for no throughput you need at this size.

**Fonts substitute on Linux.** The templates ask for Helvetica, Arial and Georgia.
The image installs Liberation (metric-compatible with the first two, so line
breaks land identically) and DejaVu as a catch-all. Georgia has no metric-
compatible free equivalent, so the serif designs will look slightly different from
a local macOS render. Fix properly by bundling woff2 files with the templates.

**Rotating `VITANOVA_JWT_SECRET` signs everyone out.** Existing access tokens stop
verifying immediately. Only do it deliberately.

**Preview deployments share one database.** Every Vercel preview points at the
same `vercel.json` rewrite, so it writes to your production Atlas cluster. If that
matters, make a second Render service and Atlas database for staging.

---

## Pointing the browser straight at Render instead

If you would rather skip the Vercel proxy — one less hop, one more thing to
configure — you need two changes:

1. `API_BASE` in `frontend/src/app/core/auth/auth.service.ts` becomes the absolute
   Render URL. Angular has no runtime env vars in the browser, so this means an
   `environment.ts` + `fileReplacements` setup in `angular.json`.
2. Render needs CORS. Set `VITANOVA_CORS_ORIGINS` to a JSON array of your exact
   origins, and `VITANOVA_CORS_ORIGIN_REGEX` for preview URLs, which get a new
   hostname on every deploy:

   ```
   VITANOVA_CORS_ORIGINS=["https://vitanova.vercel.app"]
   VITANOVA_CORS_ORIGIN_REGEX=https://.*\.vercel\.app
   ```

The rewrite is the less fragile of the two. This is here for completeness.
