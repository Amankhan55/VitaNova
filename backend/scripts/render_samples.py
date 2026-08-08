#!/usr/bin/env python
"""Render every registered template with the demo resume, to HTML and PDF.

Used to eyeball designs against the reference PDFs without booting the API:

    .venv/bin/python scripts/render_samples.py --out /tmp/vitanova-samples

Add --template to work on one design at a time.
"""

import argparse
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.models.resume import Theme  # noqa: E402
from app.services import render_service, template_registry  # noqa: E402
from app.services.seed import demo_resume_data  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", default="./sample-output", type=Path)
    parser.add_argument("--template", help="Render only this template id")
    parser.add_argument("--html-only", action="store_true")
    args = parser.parse_args()

    args.out.mkdir(parents=True, exist_ok=True)
    template_registry.load_registry(force=True)
    metas = template_registry.list_templates()
    if args.template:
        metas = [m for m in metas if m.id == args.template]
        if not metas:
            print(f"No such template: {args.template}", file=sys.stderr)
            return 1

    data = demo_resume_data()
    failed = 0
    for meta in metas:
        theme = Theme(accent=meta.accent)
        started = time.perf_counter()
        try:
            html = render_service.render_html(data, meta.id, theme)
            (args.out / f"{meta.id}.html").write_text(html, "utf-8")
            if not args.html_only:
                from weasyprint import HTML

                pdf = HTML(string=html, base_url=str(render_service.TEMPLATES_DIR))
                pdf.write_pdf(args.out / f"{meta.id}.pdf")
        except Exception as exc:  # keep going so one broken design isn't fatal
            failed += 1
            print(f"  {meta.id:<24} FAILED  {type(exc).__name__}: {exc}")
            continue
        elapsed = (time.perf_counter() - started) * 1000
        print(f"  {meta.id:<24} ok      {elapsed:6.0f} ms")

    print(f"\n{len(metas) - failed}/{len(metas)} templates rendered into {args.out}")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
