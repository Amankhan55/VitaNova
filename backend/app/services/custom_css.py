"""Compiles a `CustomTemplateSpec` into the stylesheet for one user design.

This is the counterpart to the fifteen hand-written `style.css` files: where a
built-in design's CSS is authored, a custom design's is generated. The output is
appended after `_shared/base.css` and before `_theme_css`, so it inherits every
page-break and print rule the built-ins rely on and still loses to the accent,
font scale and page size the user picks in the editor.

Two properties hold everywhere in this module, and both are load-bearing:

  * **Nothing user-written is interpolated.** Every value below comes from a
    `Literal` (looked up in a dict here), a field pydantic already clamped to a
    range, or a hex colour that is re-validated on the way in. A spec cannot
    smuggle `}` into the stylesheet because there is no field whose text reaches
    it. The template's free-text fields -- name, description, tags -- are
    metadata and never appear in a rendered document at all.

  * **Only the CSS subset base.css permits.** No grid, no exotic flexbox: the
    same document is laid out by a browser for the preview and by WeasyPrint for
    the PDF, and a rule the two disagree about is a preview that lies.
"""

from app.models.custom_template import CustomTemplateSpec

# Deliberately the same stacks the built-in designs use. A face that only
# resolves on the author's laptop would render differently in the PDF, which is
# produced on the server -- so the menu is limited to what both ends have.
FONT_STACKS: dict[str, str] = {
    "sans": '"Helvetica Neue", Helvetica, Arial, sans-serif',
    "grotesk": '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, '
    '"Helvetica Neue", Arial, sans-serif',
    "serif": 'Georgia, "Times New Roman", Times, serif',
    "book": '"Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif',
    "mono": '"SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace',
}

_HEX_CHARS = set("0123456789abcdefABCDEF")


def _num(value: float) -> str:
    """A CSS number with no trailing zeros: 14.0 -> '14', 12.5 -> '12.5'."""
    return f"{value:g}"


def _hex(value: str, fallback: str) -> str:
    """Re-validate a colour on its way into a `<style>` block.

    Pydantic already applies the same pattern at the model boundary. This is the
    second lock: specs also arrive from Mongo, where a document written by an
    older build -- or by anything other than this API -- was never checked.
    """
    text = (value or "").strip()
    if len(text) in (4, 7) and text.startswith("#") and set(text[1:]) <= _HEX_CHARS:
        return text
    return fallback


def _rgba(hex_colour: str, alpha: float) -> str:
    """A translucent version of a colour, resolved here rather than in CSS.

    `color-mix()` would be the modern way and WeasyPrint's support for it is not
    something the PDF path can afford to bet on; the arithmetic is trivial and
    the output is a plain `rgba()` both engines have understood for a decade.
    """
    text = hex_colour.lstrip("#")
    if len(text) == 3:
        text = "".join(char * 2 for char in text)
    red, green, blue = (int(text[i : i + 2], 16) for i in (0, 2, 4))
    return f"rgba({red},{green},{blue},{_num(alpha)})"


# --------------------------------------------------------------------------- #
# Section heading treatments
# --------------------------------------------------------------------------- #


def _heading_rules(spec: CustomTemplateSpec, rule: str) -> str:
    """The one decision that changes a design's character more than any other.

    Each branch is a different way of separating a heading from the text above
    it, and they are mutually exclusive by construction -- the caller emits
    exactly one.
    """
    if spec.heading_style == "underline":
        return f"padding-bottom:3px;border-bottom:{rule} solid var(--vc-line);"
    if spec.heading_style == "rule":
        return f"padding-top:6px;border-top:{rule} solid var(--vc-line);"
    if spec.heading_style == "band":
        # A solid bar, so the heading colour is overridden to sit on it. Printers
        # that strip backgrounds would otherwise take the white text with them.
        return (
            "padding:4px 8px;background:var(--vn-accent);color:#fff;"
            "-webkit-print-color-adjust:exact;print-color-adjust:exact;"
        )
    if spec.heading_style == "bar":
        weight = _num(max(spec.rule_weight_pt * 2.6, 2.0))
        return f"padding-left:9px;border-left:{weight}pt solid var(--vn-accent);"
    if spec.heading_style == "boxed":
        return f"padding:3px 8px;border:{rule} solid var(--vc-line);"
    return ""  # "plain": weight and tracking carry it alone


def _bullet_rules(spec: CustomTemplateSpec) -> str:
    if spec.bullet_style in ("disc", "square"):
        return (
            f".vn-custom .vn-bullets{{list-style:{spec.bullet_style};padding-left:1.1em;}}"
        )
    if spec.bullet_style == "dash":
        # The dash is generated content, never a text node: extracted text stays
        # clean, which is the rule _shared/ats.html sets for every ATS-safe design.
        return (
            ".vn-custom .vn-bullets{list-style:none;padding-left:0.95em;}"
            ".vn-custom .vn-bullets li{position:relative;}"
            ".vn-custom .vn-bullets li::before{content:'—';position:absolute;"
            "left:-0.95em;color:var(--vc-muted);}"
        )
    return ".vn-custom .vn-bullets{list-style:none;padding-left:0;}"


def _tag_rules(spec: CustomTemplateSpec) -> str:
    """Tech stacks and skill keywords. `.vn-tag` is one element per keyword --
    see the note in `_custom/sections.html` for why this renderer emits its own
    markup rather than the joined string the shared macros produce."""
    if spec.tag_style == "pill":
        return (
            ".vn-custom .vn-tag{display:inline-block;margin:2px 4px 0 0;"
            "padding:1px 7px;font-size:0.88em;line-height:1.5;"
            "border:0.6pt solid var(--vn-accent);border-radius:9px;"
            "color:var(--vn-accent);}"
        )
    if spec.tag_style == "bracket":
        return (
            ".vn-custom .vn-tag{display:inline-block;margin-right:6px;"
            "font-family:var(--vc-mono);font-size:0.86em;color:var(--vc-muted);}"
            ".vn-custom .vn-tag::before{content:'[';}"
            ".vn-custom .vn-tag::after{content:']';}"
        )
    return (
        ".vn-custom .vn-tag{color:var(--vc-muted);font-size:0.92em;}"
        ".vn-custom .vn-tag:not(:last-child)::after{content:' • ';color:var(--vc-hairline);}"
    )


def _divider_rules(spec: CustomTemplateSpec) -> str:
    if spec.entry_divider == "none":
        return ""
    style = "solid" if spec.entry_divider == "hairline" else "dotted"
    return (
        f".vn-custom .vn-entry + .vn-entry{{padding-top:var(--vc-entry-gap);"
        f"border-top:0.5pt {style} var(--vc-hairline);}}"
    )


# --------------------------------------------------------------------------- #
# Layout
# --------------------------------------------------------------------------- #


def _sidebar_colours(spec: CustomTemplateSpec) -> tuple[str, str]:
    """(background, text) for the sidebar, as CSS values.

    `plain` returns an empty background: the column is set apart by a rule
    instead, which is emitted separately because a background of "" is not a
    thing CSS can be told.
    """
    if spec.sidebar_tone == "accent":
        return "var(--vn-accent)", "#FFFFFF"
    if spec.sidebar_tone == "fill":
        return "var(--vc-side-bg)", "var(--vc-side-text)"
    return "", "var(--vc-body)"


def _layout_rules(spec: CustomTemplateSpec) -> str:
    """Column geometry, plus the trick that keeps a sidebar coloured on page two.

    A background painted on the sidebar *element* only covers the height that
    column's own content occupies -- so a two-page resume whose skills list ends
    on page one gets a band that stops mid-page. The fill is therefore painted
    across the page box itself as a hard-stopped gradient: `.vn-sheet` supplies
    it on screen (it has a full-page min-height) and `@page` supplies it in
    print, where it always covers the sheet edge to edge. Lifted from
    modern-professional, which solves the same problem the same way.
    """
    if not spec.has_sidebar:
        return ""

    width = spec.sidebar_width
    background, _ = _sidebar_colours(spec)
    left = spec.layout == "sidebar-left"
    blocks: list[str] = [
        f".vn-custom .vn-sidebar{{width:{width}%;}}",
    ]

    outer, gutter = "var(--vc-inset)", "var(--vc-gutter)"
    if left:
        blocks.append(
            f".vn-custom .vn-sidebar{{padding-left:{outer};padding-right:{gutter};}}"
            f".vn-custom .vn-main{{padding-left:{gutter};padding-right:{outer};}}"
        )
    else:
        blocks.append(
            f".vn-custom .vn-sidebar{{padding-right:{outer};padding-left:{gutter};}}"
            f".vn-custom .vn-main{{padding-right:{gutter};padding-left:{outer};}}"
        )

    if background:
        stop = width if left else 100 - width
        first, second = (background, "var(--vc-paper)") if left else (
            "var(--vc-paper)",
            background,
        )
        band = (
            f"linear-gradient(to right,{first} 0,{first} {stop}%,"
            f"{second} {stop}%,{second} 100%)"
        )
        blocks.append(
            f"@media screen{{.vn-custom .vn-sheet{{background-image:{band};}}}}"
            f"@media print{{@page{{background-image:{band};"
            "-webkit-print-color-adjust:exact;print-color-adjust:exact;}"
            # The sheet's own white would repaint over the band for exactly the
            # height its content occupies, notching the column. @page already
            # supplies both the band and the paper, so the sheet stays clear.
            ".vn-custom .vn-sheet{background:none;}}"
        )
    else:
        edge = "border-right" if left else "border-left"
        blocks.append(
            f".vn-custom .vn-sidebar{{{edge}:0.6pt solid var(--vc-hairline);}}"
        )

    return "".join(blocks)


def _header_rules(spec: CustomTemplateSpec, rule: str) -> str:
    blocks: list[str] = []

    if spec.header_style == "banner":
        blocks.append(
            ".vn-custom .vn-header{background:var(--vn-accent);color:#fff;"
            "padding-top:calc(var(--vc-inset) * 0.78);"
            "padding-bottom:calc(var(--vc-inset) * 0.66);"
            "margin-bottom:var(--vc-section-gap);"
            "-webkit-print-color-adjust:exact;print-color-adjust:exact;}"
            ".vn-custom .vn-header .vn-name{color:#fff;}"
            ".vn-custom .vn-header .vn-headline{color:rgba(255,255,255,0.92);}"
            ".vn-custom .vn-header .vn-contact-line{color:rgba(255,255,255,0.92);"
            "padding-top:8px;margin-top:9px;"
            "border-top:0.6pt solid rgba(255,255,255,0.34);}"
            ".vn-custom .vn-header .vn-inline-sep::after{color:rgba(255,255,255,0.55);}"
        )
        # The band has to reach the top edge of page ONE while every later page
        # keeps its inset -- so the margin is dropped on the first page only,
        # rather than for the whole document.
        blocks.append(
            "@media screen{.vn-custom .vn-sheet{padding-top:0;}}"
            "@media print{@page:first{margin-top:0;}}"
        )
    else:
        closing = (
            f"padding-bottom:9px;border-bottom:{rule} solid var(--vc-line);"
            if spec.header_rule
            else ""
        )
        blocks.append(
            f".vn-custom .vn-header{{margin-bottom:var(--vc-section-gap);{closing}}}"
        )

    if spec.header_style == "centered":
        blocks.append(".vn-custom .vn-header{text-align:center;}")
    if spec.header_style == "split":
        # Name on the left, contact details set against it on the right. The two
        # cells are table cells, not floats: a float would not keep the contact
        # block from riding up over a two-line name.
        blocks.append(
            ".vn-custom .vn-header-main{width:62%;}"
            ".vn-custom .vn-header-aside{text-align:right;vertical-align:bottom;"
            "padding-bottom:2px;}"
            ".vn-custom .vn-header-aside .vn-contact-line{margin-top:0;}"
            ".vn-custom .vn-header-aside .vn-inline-sep::after{content:'';}"
            ".vn-custom .vn-header-aside .vn-inline-sep{display:block;}"
        )

    return "".join(blocks)


# --------------------------------------------------------------------------- #
# Entry point
# --------------------------------------------------------------------------- #


def compile_spec(spec: CustomTemplateSpec) -> str:
    ink = _hex(spec.ink, "#16202E")
    body_colour = _hex(spec.body_colour, "#33404F")
    muted = _hex(spec.muted_colour, "#6B7787")
    paper = _hex(spec.paper, "#FFFFFF")
    side_bg = _hex(spec.sidebar_bg, "#F1F5F9")
    side_text = _hex(spec.sidebar_text, "#33404F")

    rule = f"{_num(spec.rule_weight_pt)}pt"
    heading_colour = "var(--vn-accent)" if spec.heading_accent else "var(--vc-ink)"
    # A "line" is whatever draws the design's rules: the accent when the design
    # is accented, otherwise a hairline derived from the muted colour so rules
    # never fight the text they sit under.
    line = "var(--vn-accent)" if spec.heading_accent else "var(--vc-hairline)"
    upper = "text-transform:uppercase;"

    _, sidebar_text = _sidebar_colours(spec)

    variables = (
        ":root{"
        f"--vc-ink:{ink};"
        f"--vc-body:{body_colour};"
        f"--vc-muted:{muted};"
        f"--vc-paper:{paper};"
        f"--vc-side-bg:{side_bg};"
        f"--vc-side-text:{side_text};"
        f"--vc-hairline:{_rgba(muted, 0.34)};"
        f"--vc-line:{line};"
        f"--vc-inset:{_num(spec.page_margin_mm)}mm;"
        # The inner gutter between the two columns. Proportional to the page
        # inset so a tight page does not get a luxurious channel down its middle,
        # floored so a very tight one still has a channel at all.
        f"--vc-gutter:{_num(max(spec.page_margin_mm * 0.62, 6.0))}mm;"
        f"--vc-section-gap:calc({_num(spec.section_gap_px)}px * var(--vn-density,1));"
        f"--vc-entry-gap:calc({_num(spec.entry_gap_px)}px * var(--vn-density,1));"
        f"--vc-mono:{FONT_STACKS['mono']};"
        "}"
    )

    typography = (
        # `body.vn-custom` rather than `.vn-custom`: base.css styles the bare
        # `body` element, and a single class alone does not outrank it.
        f"body.vn-custom{{"
        f"font-family:{FONT_STACKS[spec.body_font]};"
        f"font-size:calc({_num(spec.body_size_pt)}pt * var(--vn-font-scale,1));"
        f"line-height:{_num(spec.line_height)};"
        "color:var(--vc-body);}"
        ".vn-custom .vn-sheet{background:var(--vc-paper);}"
        # Restores the horizontal page inset for blocks that need it. The sheet
        # gives that inset up (page_margin becomes "Nmm 0") whenever something
        # has to bleed -- a banner, or a coloured sidebar -- and the template
        # then marks the blocks that should still be inset with this class.
        ".vn-custom .vn-inset{padding-left:var(--vc-inset);"
        "padding-right:var(--vc-inset);}"
        f".vn-custom .vn-name{{font-family:{FONT_STACKS[spec.heading_font]};"
        f"font-size:calc({_num(spec.name_size_pt)}pt * var(--vn-font-scale,1));"
        "font-weight:700;line-height:1.12;color:var(--vc-ink);"
        + (f"{upper}letter-spacing:0.03em;" if spec.name_case == "upper" else "")
        + "}"
        ".vn-custom .vn-headline{margin-top:4px;font-size:1.12em;font-weight:600;"
        f"color:{heading_colour};}}"
        ".vn-custom .vn-contact-line{margin-top:8px;font-size:0.94em;"
        "line-height:1.55;color:var(--vc-muted);}"
        ".vn-custom .vn-monogram{width:19mm;height:19mm;margin:0 0 7mm;"
        "border:1.5pt solid var(--vn-accent);border-radius:50%;text-align:center;}"
        ".vn-custom .vn-monogram span{display:block;line-height:17.5mm;"
        "font-size:calc(15pt * var(--vn-font-scale,1));font-weight:700;"
        "letter-spacing:0.04em;color:var(--vn-accent);}"
    )

    if spec.header_style == "centered":
        typography += ".vn-custom .vn-monogram{margin-left:auto;margin-right:auto;}"

    headings = (
        ".vn-custom .vn-section{margin-bottom:var(--vc-section-gap);}"
        ".vn-custom .vn-entry + .vn-entry{margin-top:var(--vc-entry-gap);}"
        f".vn-custom .vn-section-title{{font-family:{FONT_STACKS[spec.heading_font]};"
        f"font-size:calc({_num(spec.heading_size_pt)}pt * var(--vn-font-scale,1));"
        "font-weight:700;margin-bottom:6px;"
        f"letter-spacing:{_num(spec.heading_tracking)}em;"
        f"text-align:{spec.heading_align};"
        f"color:{heading_colour};"
        + (upper if spec.heading_case == "upper" else "")
        + _heading_rules(spec, rule)
        + "}"
    )

    entries = (
        ".vn-custom .vn-entry-title{font-size:1.06em;font-weight:700;color:var(--vc-ink);}"
        ".vn-custom .vn-entry-org{font-weight:600;color:var(--vc-body);}"
        ".vn-custom .vn-entry-dates{font-size:0.93em;color:var(--vc-muted);"
        "font-weight:600;}"
        ".vn-custom .vn-entry-location{font-style:italic;color:var(--vc-muted);"
        "font-size:0.93em;}"
        ".vn-custom .vn-entry-detail{color:var(--vc-muted);}"
        ".vn-custom .vn-entry-summary{margin-top:2px;}"
        # Never justified: with no hyphenation engine in play, justification
        # opens rivers of whitespace in a narrow measure.
        ".vn-custom .vn-summary{text-align:left;}"
        ".vn-custom .vn-bullets{margin-top:3px;}"
        ".vn-custom .vn-tags{margin-top:2px;}"
        # Skills as label/value rows: display:table, so both engines agree and a
        # long keyword list wraps inside its own cell instead of under the label.
        ".vn-custom .vn-skill-table{display:table;width:100%;}"
        ".vn-custom .vn-skill-row{display:table-row;}"
        ".vn-custom .vn-skill-label{display:table-cell;width:27%;padding:0 8px 3px 0;"
        "font-weight:700;color:var(--vc-ink);vertical-align:top;}"
        ".vn-custom .vn-skill-values{display:table-cell;padding-bottom:3px;"
        "vertical-align:top;}"
    )

    sidebar = ""
    if spec.has_sidebar:
        sidebar = (
            f".vn-custom .vn-sidebar{{color:{sidebar_text};}}"
            f".vn-custom .vn-sidebar .vn-entry-title{{color:{sidebar_text};font-size:1em;}}"
            f".vn-custom .vn-sidebar .vn-entry-org,"
            f".vn-custom .vn-sidebar .vn-tag{{color:{sidebar_text};font-size:0.92em;}}"
            # Dates stacked rather than floated: a 32% column is too narrow to
            # carry a title and a date range on the same line.
            ".vn-custom .vn-sidebar .vn-entry-aside{float:none;display:block;"
            f"padding-left:0;color:{sidebar_text};font-size:0.9em;opacity:0.78;}}"
            ".vn-custom .vn-sidebar .vn-skill-label{display:block;width:auto;"
            f"color:{sidebar_text};}}"
            ".vn-custom .vn-sidebar .vn-skill-values,"
            ".vn-custom .vn-sidebar .vn-skill-row,"
            ".vn-custom .vn-sidebar .vn-skill-table{display:block;width:auto;}"
            ".vn-custom .vn-contact-block{margin-bottom:6px;font-size:0.94em;}"
            ".vn-custom .vn-contact-label{display:block;font-size:0.78em;"
            "letter-spacing:0.09em;text-transform:uppercase;opacity:0.7;"
            "margin-bottom:1px;}"
        )
        if spec.sidebar_tone != "plain":
            # On a filled column the accent may be unreadable, so headings there
            # borrow the column's own text colour instead.
            sidebar += (
                f".vn-custom .vn-sidebar .vn-section-title{{color:{sidebar_text};"
                f"border-color:{_rgba('#FFFFFF', 0.28) if spec.sidebar_tone == 'accent' else 'currentColor'};}}"
            )
            if spec.heading_style == "band":
                sidebar += (
                    ".vn-custom .vn-sidebar .vn-section-title{background:none;"
                    "padding-left:0;padding-right:0;}"
                )

    return "\n".join(
        block
        for block in (
            "/* generated from a CustomTemplateSpec — see app/services/custom_css.py */",
            variables,
            typography,
            headings,
            entries,
            _bullet_rules(spec),
            _tag_rules(spec),
            _divider_rules(spec),
            _layout_rules(spec),
            _header_rules(spec, rule),
            sidebar,
        )
        if block
    )
