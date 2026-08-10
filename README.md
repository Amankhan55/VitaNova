# VitaNova

A resume builder — write your experience once, see it typeset in any of nine designs, and export a
print-ready PDF.

**Angular 20** front end · **FastAPI + MongoDB** back end · **WeasyPrint** for PDF.

---

## The one idea worth knowing

Most resume builders draw the on-screen preview with one renderer and the PDF with another. The two
slowly diverge, and what you approve on screen is not quite what you send to an employer.

VitaNova makes that impossible by construction:

```
              Jinja2 template + CSS  (backend, single source of truth)
                          │
                render_service.render_html()
                          │
              one self-contained HTML document
                    ╱            ╲
       iframe[srcdoc]              WeasyPrint
       (live preview)              (PDF export)
```

The editor's preview and the exported PDF are **the same document**, byte for byte. Screen-vs-print
framing is handled entirely by `@media` rules inside it — browsers apply the `screen` block, WeasyPrint
applies `print`. A test asserts the two endpoints return identical bytes
(`tests/test_render.py::test_preview_and_export_render_the_same_document`).

The trade-off this buys: templates must be written in a CSS subset both engines agree on — no CSS
grid, no exotic flexbox. Columns use `display: table`, right-aligned dates use floats. This is
documented at the top of `backend/app/templates/_shared/base.css`.

---

## Running it

Prerequisites: Python 3.12+, Node 20+, MongoDB, and `pango`/`cairo` (`brew install pango`, which
WeasyPrint needs).

```bash
# 1. MongoDB
brew services start mongodb-community
#    …or, without a service:
mongod --dbpath ./.data/db

# 2. API  → http://localhost:8000  (docs at /docs)
cd backend
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
cp .env.example .env          # then set VITANOVA_JWT_SECRET for anything but local dev
.venv/bin/python -m uvicorn app.main:app --reload --port 8000

# 3. Web  → http://localhost:4200
cd frontend
npm install
npm start                     # proxies /api → localhost:8000, so no CORS in dev
```

Open http://localhost:4200. The landing page is public — register or log in from there, then pick a
design.

To put it online — Vercel for the frontend, Render for the API, MongoDB Atlas for the database — see
**[DEPLOYMENT.md](DEPLOYMENT.md)**.

### Tests

```bash
cd backend  && .venv/bin/python -m pytest        # 29 tests
cd frontend && npm test -- --watch=false --browsers=ChromeHeadless
```

The backend tests run against a real MongoDB in a throwaway database — mocking the driver would test
the mock rather than the ownership scoping and unique indexes that actually protect user data.

### Previewing designs without the app

```bash
cd backend
.venv/bin/python scripts/render_samples.py --out ./sample-output
```

Renders every registered template to HTML **and** PDF using demo content. This is how each design is
checked visually before it ships.

---

## The designs

| Design | Character | ATS safe |
| --- | --- | :--: |
| **Modern Professional** | Dark full-bleed sidebar, accent headings, monogram | — |
| **Classic ATS** | One column, no colour or graphics, parser-friendly ordering | ✅ |
| **Timeless Elegant** | Cream page, letterspaced serif nameplate, gold rules | — |
| **Centered Mono** | Monospaced titles between hairlines, two-column skills | ✅ |
| **Minimalist Swiss** | Swiss grid, crisp sans headings, rule-under-heading | ✅ |
| **Creative Split** | Bold colour masthead over a balanced two-column body | — |
| **Tech Compact** | Dense skill matrices and monospaced accents, for engineers | ✅ |
| **Executive Bar** | Serif nameplate with a vertical accent bar beside each heading | ✅ |
| **Nordic Clean** | Soft slate palette, pill-shaped skill tags, generous air | — |

Each lives in `backend/app/templates/<id>/` as `meta.json` + `template.html` + `style.css`. **Adding a
design means adding a folder** — the registry discovers it and it appears in the gallery, with no code
change anywhere. The first four were built to match a set of reference resume designs; the rest
extend the same shared macros and CSS conventions.

`list_templates()` and `get_template()` rescan the folder on every call, so a new design shows up
without restarting the API. That costs ~0.2 ms per call (nine `meta.json` reads) and `get_template()`
runs on every render, which is ~30% of a 0.6 ms render. Harmless at this size; if the template count
grows a lot, gate the rescan behind `settings.debug`.

Two details worth calling out:

- The sidebar design paints its dark band via the `@page` background, not on an element. An element's
  background only covers the height its content occupies, so on page two the band stopped halfway
  down. `@page` always covers the whole sheet.
- The Timeless design's paired Education/Certifications footer uses fixed 50/50 columns. The
  reference PDF has a real bug here — its date column overruns into the neighbouring text. Ours does
  not.

---

## Layout

```
backend/
  app/
    core/          config, Mongo connection, password hashing + JWT
    models/        the canonical Resume document
    schemas/       request/response shapes
    api/v1/        auth · resumes · templates · render
    services/      template registry · rendering · persistence · demo content
    templates/     the four designs + shared macros and base CSS
  scripts/         render_samples.py
  tests/
frontend/
  src/app/
    core/          models, API clients, auth (service · guard · interceptor), theme
    shared/ui/     vn-icon, vn-logo, vn-theme-toggle — hand-drawn SVG, no icon library
    features/      landing · auth · dashboard · templates · editor
  src/assets/brand/
```

### Look and feel

Two themes, switched by `data-theme` on `<html>`; every colour in the app comes from a token defined
twice in `src/styles.scss`. `ThemeService` owns the attribute, remembers an explicit choice in
localStorage and keeps `system` following the OS. A small script in `index.html` applies the same
attribute *before first paint* — Angular boots too late, and a dark-theme user would otherwise get a
white flash on every load.

One rule the themes do not get a vote on: **the rendered resume is white in both of them.** Paper and
its grey gutter live in `--vn-paper-*`, declared once outside the theme blocks and never overridden;
the gutter value matches `@media screen` in `_shared/base.css` so the iframe blends into the pane
around it. Preview surfaces carry `.vn-paper-sheet` / `.vn-paper-gutter` (which also pin
`color-scheme: light`, so scrollbars inside a preview belong to the paper). A themed token on a
preview surface is a bug: it would mean the thing you are approving is not the thing that prints.

The landing page at `/` is public and brings its own chrome — the app header is suppressed there, as
it is on the auth screens. Its "Contact us" form composes a `mailto:` rather than posting: there is no
contact endpoint, and a form that reported success while dropping the message would be worse than no
form. The address lives in the `CONTACT` constant at the top of `features/landing/landing.ts`; leave
a handle blank there and its card is simply not rendered.

### Data model

One template-agnostic document. Templates differ in styling and in which sections they show — never
in data shape — so switching design never asks the user to retype anything.

```
Resume {
  title, template_id, theme { accent, font_scale, page_size, density },
  basics   { full_name, headline, email, phone, location, links[], initials },
  sections [ { id, type, title, visible, … } ]     # ordered, user-reorderable
}
```

Sections being an ordered **list** rather than fixed fields is what makes reordering, renaming and
hiding them possible. The four references each label and order their sections differently — one says
"Professional Summary", another "Professional Profile", a third just "Summary".

### Editor behaviour

The preview and the autosave run on **independent clocks**: the preview re-renders 250 ms after you
stop typing, the save fires at 800 ms. The preview never waits on a save, so a slow or failed write
cannot freeze the page you are looking at. Downloading exports the draft currently on screen rather
than the last saved copy, so hitting Download immediately after typing still gives you your latest
edit.

### Importing an existing resume

`POST /resumes/import` takes a PDF, pulls its text out with pdfplumber, and asks Gemini to shape that
text into the same section list the editor already speaks. Two stages, split so each can be tested
alone — the extraction is a pure function, and the parsing is the only part that needs a network.

Failures are deliberately sorted into two kinds, because they mean opposite things to whoever is
holding the file:

| | Cause | Status | What the user should do |
| --- | --- | :--: | --- |
| `BadDocument` | Scanned image, corrupt file, model returned something that isn't a resume | 422 | Try a different PDF |
| `UpstreamUnavailable` | Gemini busy, rate-limited, down, or no API key configured | 503 | Wait and retry — the file was fine |

Collapsing those into one status is the tempting shortcut and the wrong one: a 503 from Gemini
reported as a 4xx tells people their perfectly good resume was rejected. Transient upstream failures
are retried once before giving up, which absorbs most of the free tier's "high demand" responses.

Set `VITANOVA_GEMINI_API_KEY` to enable it. Without a key the rest of the app is unaffected and the
endpoint returns a 503 that says so.

### Auth

Email + password (bcrypt), JWT access tokens (30 min) and rotating refresh tokens (7 days). Refresh
tokens are stored hashed with a TTL index so they can be revoked and expire on their own; presenting
a consumed one fails, which limits the damage from a stolen token. The HTTP interceptor refreshes and
replays a request once on a 401, then gives up and clears the session.

`passlib` is deliberately **not** used — it is unmaintained and breaks against bcrypt 4.x. `bcrypt`
is called directly, and passwords over 72 bytes are rejected rather than silently truncated.

---

## Notes and limits

- **Fonts inside a resume** are system stacks (Helvetica / Georgia / ui-monospace) so both renderers
  resolve them with no font-loading step. Bundling woff2 files would make output identical across
  machines; today a Linux box without Helvetica will substitute. The *app chrome* is a separate
  question and does load Inter + Instrument Serif from Google Fonts, behind `display=swap` and a
  system fallback — offline, the UI simply renders in the system stack.
- **No password reset or email verification** — there is no mail transport wired up.
- `POST /api/v1/render` is intentionally unauthenticated. It stores nothing and only echoes back the
  payload it was given, which keeps the live preview instant and decoupled from autosave.
- The accent colour is interpolated into a `<style>` block, so it is validated as a hex colour and
  anything else falls back to the default. There is a test for that.
