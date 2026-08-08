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

Open http://localhost:4200, create an account, pick a design.

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
    core/          models, API clients, auth (service · guard · interceptor)
    shared/ui/     vn-icon, vn-logo — hand-drawn SVG, no icon library
    features/      auth · dashboard · templates · editor
  src/assets/brand/
```

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

### Auth

Email + password (bcrypt), JWT access tokens (30 min) and rotating refresh tokens (7 days). Refresh
tokens are stored hashed with a TTL index so they can be revoked and expire on their own; presenting
a consumed one fails, which limits the damage from a stolen token. The HTTP interceptor refreshes and
replays a request once on a 401, then gives up and clears the session.

`passlib` is deliberately **not** used — it is unmaintained and breaks against bcrypt 4.x. `bcrypt`
is called directly, and passwords over 72 bytes are rejected rather than silently truncated.

---

## Notes and limits

- **Fonts** are system stacks (Helvetica / Georgia / ui-monospace) so both renderers resolve them with
  no font-loading step. Bundling woff2 files would make output identical across machines; today a
  Linux box without Helvetica will substitute.
- **No password reset or email verification** — there is no mail transport wired up.
- `POST /api/v1/render` is intentionally unauthenticated. It stores nothing and only echoes back the
  payload it was given, which keeps the live preview instant and decoupled from autosave.
- The accent colour is interpolated into a `<style>` block, so it is validated as a hex colour and
  anything else falls back to the default. There is a test for that.
