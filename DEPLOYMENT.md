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

### Deploy

1. Push this repository to GitHub.
2. Render → **New** → **Blueprint** → select the repo. It reads `render.yaml`.
3. When prompted, paste your Atlas string into **`VITANOVA_MONGO_URI`**.
   `VITANOVA_JWT_SECRET` is generated for you; leave it alone.
4. Apply. The first Docker build takes roughly 3–5 minutes.
5. Check it: `https://<your-service>.onrender.com/health` should return

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
3. Register an account (proves Atlas is connected and writable).
4. Pick a design, type a line, **Download PDF** (proves Pango is present in the
   image).

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
