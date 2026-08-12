"""Catches the model inventing facts about someone's career.

The prompts forbid fabrication in some detail, and mostly that works. "Mostly"
is not a safety property: the failure mode here is a user sending an employer a
resume claiming a metric they never achieved, and finding out in the interview.
So the rule is also enforced after the fact, in code, where it can be tested.

Two checks, both deliberately narrow:

  *Numbers* — every digit-bearing token in a suggestion must already appear in
  what the user supplied. This is the one that stops "Fixed bugs" becoming
  "Resolved 150+ production defects", which is the canonical failure and the
  most damaging, because a number reads as evidence.

  *Proper nouns* — a capitalised word mid-sentence is, in resume prose, almost
  always a company, product or technology. If it is not in the user's context,
  the model brought it from somewhere else.

Both are one-directional. Dropping a good suggestion costs a click on
"Regenerate"; keeping a fabricated one costs the user their credibility. When
in doubt these reject.

Nothing here calls an API, which is what lets the whole policy be tested
exhaustively and for free.
"""

import re
from dataclasses import dataclass, field

# A digit-bearing run: 150, 1,200, 99.9%, 40+, 3x, 24/7, 2022.
_NUMBER = re.compile(r"\d[\d,./]*\s*%?\+?")

# Word-ish tokens, keeping the internals of Node.js, C++, CI/CD, .NET together.
_WORD = re.compile(r"[A-Za-z][A-Za-z0-9+#./_-]*")

# Sentence boundary, for finding which words are sentence-initial (and so
# capitalised by grammar rather than because they name something).
_SENTENCE_SPLIT = re.compile(r"(?<=[.!?;:])\s+|\n+")

# Capitalised words that are ordinary English rather than names. Kept short on
# purpose: every entry here is a hole in the check, so it holds only words that
# genuinely recur mid-sentence in resume prose.
_COMMON_CAPITALISED = frozenset(
    {
        "a", "agile", "an", "and", "api", "apis", "b2b", "b2c", "ci", "cd", "crud",
        "eu", "english", "friday", "i", "ii", "iii", "iv", "january", "february",
        "march", "april", "may", "june", "july", "august", "september", "october",
        "november", "december", "monday", "tuesday", "wednesday", "thursday",
        "saturday", "sunday", "kpi", "kpis", "led", "mvp", "os", "poc", "qa", "r&d",
        "roi", "saas", "sdk", "seo", "sla", "sme", "ui", "ux", "the", "us", "usa",
        "uk", "v1", "v2",
    }
)


@dataclass
class Grounding:
    """What a suggestion claims that its source material does not support."""

    numbers: list[str] = field(default_factory=list)
    terms: list[str] = field(default_factory=list)

    @property
    def ok(self) -> bool:
        return not self.numbers and not self.terms

    def reason(self) -> str:
        """A short, user-facing account of why a suggestion was withheld."""
        parts = []
        if self.numbers:
            parts.append("figures you did not provide (" + ", ".join(self.numbers) + ")")
        if self.terms:
            parts.append("terms you did not provide (" + ", ".join(self.terms) + ")")
        return "Withheld: it introduced " + " and ".join(parts) + "."


def _normalise_number(token: str) -> str:
    """Fold the ways the same quantity gets written down.

    "150", "150+", "1,500" and "1500" are the same claim as far as this check is
    concerned; the point is whether the *magnitude* came from the user, not how
    it was punctuated. Leaving them distinct would flag "150+" as invented when
    the user wrote "150", which is a rephrasing, not a fabrication.
    """
    return token.replace(",", "").replace("+", "").replace("%", "").strip().rstrip(".").strip()


def _numbers_in(text: str) -> set[str]:
    return {n for n in (_normalise_number(m.group()) for m in _NUMBER.finditer(text)) if n}


def _words_in(text: str) -> set[str]:
    return {m.group().lower().rstrip(".") for m in _WORD.finditer(text)}


def _proper_nouns_in(text: str) -> list[str]:
    """Capitalised words that are not merely starting a sentence.

    An all-caps token counts wherever it appears -- AWS, GraphQL and SQL are
    exactly the inventions worth catching, and they carry no case information to
    tell us whether grammar put them there.
    """
    found: list[str] = []
    for sentence in _SENTENCE_SPLIT.split(text):
        for index, match in enumerate(_WORD.finditer(sentence)):
            token = match.group()
            if token.lower().rstrip(".") in _COMMON_CAPITALISED:
                continue
            if not token[0].isupper():
                continue
            # The first word of a sentence is capitalised by grammar. An
            # internal capital (GraphQL, NgRx) or a digit (S3, EC2) means it is
            # a name regardless of position.
            has_internal_signal = any(c.isupper() or c.isdigit() for c in token[1:])
            if index == 0 and not has_internal_signal:
                continue
            # Trailing sentence punctuation is not part of the name. rstrip is
            # safe for Node.js and CI/CD, whose separators are internal.
            found.append(token.rstrip("./-"))
    return found


def check(candidate: str, context: str) -> Grounding:
    """Report what ``candidate`` asserts that ``context`` does not support.

    ``context`` should be everything the user gave us for this operation --
    the original text, the job title, the technology list. Passing too much is
    harmless; passing too little rejects honest suggestions.
    """
    result = Grounding()
    if not candidate.strip():
        return result

    known_numbers = _numbers_in(context)
    for match in _NUMBER.finditer(candidate):
        token = _normalise_number(match.group())
        if token and token not in known_numbers:
            result.numbers.append(match.group().strip())

    known_words = _words_in(context)
    for token in _proper_nouns_in(candidate):
        if token.lower().rstrip(".") not in known_words:
            result.terms.append(token)

    # Deduplicate while keeping the order they were written in.
    result.numbers = list(dict.fromkeys(result.numbers))
    result.terms = list(dict.fromkeys(result.terms))
    return result


def is_grounded(candidate: str, context: str) -> bool:
    return check(candidate, context).ok


def filter_grounded(candidates: list[str], context: str) -> tuple[list[str], list[str]]:
    """Split suggestions into those the context supports and those it does not.

    Returns ``(kept, rejected)``. Callers show the kept ones and fall back to
    the user's original text when nothing survives -- never a fabrication, and
    never silence.
    """
    kept: list[str] = []
    rejected: list[str] = []
    for candidate in candidates:
        (kept if is_grounded(candidate, context) else rejected).append(candidate)
    return kept, rejected
