"""The AI writing tools.

Gemini is scripted throughout — see the `fake_gemini` fixture in conftest. No
test here may reach the real API: it costs free-tier quota, needs a key that
does not exist in CI, and cannot be made to fail on demand, which is exactly
what most of these tests need it to do.

The heart of the file is the grounding section. Everything else checks that a
failure becomes the right status code; that part checks the promise the feature
is actually built on, which is that the AI cannot put words in the user's mouth.
"""

import json

import pytest

from app.models.resume import (
    Basics,
    ExperienceItem,
    ExperienceSection,
    ResumeData,
    SkillGroupItem,
    SkillsSection,
    SummarySection,
)
from app.schemas.ai import GenerateRequest, RewriteRequest
from app.services import ai_service, gemini, grounding
from tests.conftest import api_error


# --------------------------------------------------------------------------- #
# Grounding — the anti-fabrication guard
#
# These are pure functions over strings, so the policy can be pinned exactly
# rather than inferred from what a model happened to say that day.
# --------------------------------------------------------------------------- #


def test_the_canonical_fabrication_is_caught():
    """The example from the brief, and the one that matters most: a number that
    reads as evidence and came from nowhere."""
    result = grounding.check("Resolved 150+ production defects", "Fixed bugs")
    assert not result.ok
    assert "150+" in result.numbers


def test_an_honest_rewrite_of_the_same_bullet_passes():
    assert grounding.is_grounded(
        "Diagnosed and resolved software defects across the production codebase",
        "Fixed bugs",
    )


def test_a_number_the_user_supplied_may_be_reused():
    assert grounding.is_grounded("Led a team of 5 engineers.", "Led a team of 5 engineers")


def test_a_number_the_user_supplied_may_be_repunctuated():
    """"1,500" and "1500" are the same claim; only the magnitude has to be theirs."""
    assert grounding.is_grounded("Handled 1500 requests", "Handled 1,500 requests")
    assert grounding.is_grounded("Cut latency by 40%+", "Cut latency by 40%")


@pytest.mark.parametrize(
    "invented",
    [
        "Improved page load time by 40%.",
        "Shipped to 10,000 users.",
        "Reduced costs by $50,000.",
        "Maintained 99.9% uptime.",
    ],
)
def test_any_unsupported_figure_is_rejected(invented):
    assert not grounding.is_grounded(invented, "Improved the checkout page")


def test_a_technology_the_user_never_mentioned_is_rejected():
    result = grounding.check(
        "Developed reusable UI components using React and GraphQL.",
        "Job title: Frontend Developer\nTechnologies: Angular, TypeScript\n"
        "Bullet: Responsible for developing UI components.",
    )
    assert not result.ok
    assert result.terms == ["React", "GraphQL"]


def test_technologies_the_user_did_mention_are_allowed():
    """The brief's own example. It must survive the filter or the feature is useless."""
    assert grounding.is_grounded(
        "Developed reusable UI components using Angular and TypeScript.",
        "Job title: Frontend Developer\nTechnologies: Angular, TypeScript\n"
        "Bullet: Responsible for developing UI components.",
    )


def test_the_cruise_booking_example_from_the_brief_survives():
    assert grounding.is_grounded(
        "Developed scalable cruise booking workflows using Angular and NgRx, "
        "improving maintainability and delivering a seamless booking experience.",
        "Technologies: Angular, NgRx\nBullet: Worked on cruise booking application.",
    )


def test_an_invented_employer_is_rejected():
    result = grounding.check("Built internal tooling at Spotify.", "Built internal tooling")
    assert result.terms == ["Spotify"]


def test_a_sentence_opening_verb_is_not_mistaken_for_a_name():
    """Capitalisation at a sentence start is grammar, not a proper noun. Without
    this, every well-formed suggestion would be rejected."""
    assert grounding.is_grounded(
        "Developed internal tooling. Improved the release process.", "built internal tooling"
    )


def test_an_acronym_is_caught_even_at_a_sentence_start():
    """AWS carries no case information to say grammar put it there."""
    assert not grounding.is_grounded("AWS Lambda handled the jobs.", "Handled background jobs")


def test_filter_grounded_splits_rather_than_discards():
    kept, rejected = grounding.filter_grounded(
        ["Resolved software defects", "Resolved 150+ defects"], "Fixed bugs"
    )
    assert kept == ["Resolved software defects"]
    assert rejected == ["Resolved 150+ defects"]


def test_the_reason_names_what_was_wrong():
    reason = grounding.check("Shipped 12 features using Kafka.", "Shipped features").reason()
    assert "12" in reason and "Kafka" in reason


# --------------------------------------------------------------------------- #
# Fixtures
# --------------------------------------------------------------------------- #


@pytest.fixture
def resume() -> ResumeData:
    return ResumeData(
        basics=Basics(full_name="Ada Lovelace", headline="Frontend Engineer"),
        sections=[
            SummarySection(content="Frontend engineer working on booking systems."),
            ExperienceSection(
                items=[
                    ExperienceItem(
                        role="Lead UI Developer",
                        organization="Nexus Cloud",
                        start="2021",
                        current=True,
                        bullets=["Worked on cruise booking application."],
                        tech=["Angular", "NgRx"],
                    )
                ]
            ),
            SkillsSection(items=[SkillGroupItem(label="Frontend", keywords=["Angular", "RxJS"])]),
        ],
    )


def _ats_payload(**overrides) -> str:
    body = {
        "overall_score": 84,
        "categories": {
            "keyword_match": 88, "experience": 85, "skills": 82,
            "formatting": 95, "content_quality": 80,
        },
        "strengths": ["Clear structure"],
        "weaknesses": ["Some bullets are generic"],
        "recommendations": [
            {"title": "Strengthen the summary", "detail": "Name your focus.",
             "action": "summary", "target": ""}
        ],
    }
    body.update(overrides)
    return json.dumps(body)


def _match_payload(**overrides) -> str:
    body = {
        "match_score": 82,
        "matched_skills": [{"skill": "Angular", "strength": "strong", "evidence": "Lead UI Developer"}],
        "partial_skills": [{"skill": "GraphQL", "reason": "REST experience is present."}],
        "missing_skills": [{"skill": "AWS", "importance": "high"}],
        "matching_keywords": ["Angular"],
        "missing_keywords": ["AWS"],
        "experience_alignment": {"score": 85, "summary": "Well aligned."},
        "recommendations": ["If you have worked with AWS, consider adding it."],
    }
    body.update(overrides)
    return json.dumps(body)


# --------------------------------------------------------------------------- #
# 1. Resume writer
# --------------------------------------------------------------------------- #


@pytest.mark.asyncio
async def test_the_writer_returns_grounded_bullets(fake_gemini):
    fake_gemini(json.dumps({
        "bullets": [
            "Developed cruise booking workflows using Angular and NgRx.",
            "- Improved maintainability of the booking experience.",
        ],
        "variants": [],
    }))
    result = await ai_service.generate_resume_content(
        GenerateRequest(
            kind="experience",
            current="Worked on cruise booking application.",
            role="Lead UI Developer",
            tech=["Angular", "NgRx"],
        )
    )
    assert len(result.bullets) == 2
    # The leading dash the model added despite being asked not to.
    assert result.bullets[1].startswith("Improved")
    assert result.notes == []


@pytest.mark.asyncio
async def test_the_writer_withholds_a_fabricated_bullet_and_says_so(fake_gemini):
    fake_gemini(json.dumps({
        "bullets": [
            "Developed cruise booking workflows using Angular.",
            "Cut booking abandonment by 32%.",
        ],
        "variants": [],
    }))
    result = await ai_service.generate_resume_content(
        GenerateRequest(
            kind="experience",
            current="Worked on cruise booking application.",
            tech=["Angular"],
        )
    )
    assert result.bullets == ["Developed cruise booking workflows using Angular."]
    assert "withheld" in result.notes[0]


@pytest.mark.asyncio
async def test_the_writer_returns_prose_variants_for_a_summary(fake_gemini):
    fake_gemini(json.dumps({
        "variants": [
            {"text": "Frontend engineer focused on booking systems.", "style": "professional"},
            {"text": "Frontend engineer building booking experiences.", "style": "impactful"},
        ],
        "bullets": [],
    }))
    result = await ai_service.generate_resume_content(
        GenerateRequest(kind="summary", current="Frontend engineer on booking systems.")
    )
    assert len(result.variants) == 2
    assert result.bullets == []


@pytest.mark.asyncio
async def test_a_bullet_kind_answered_as_prose_is_moved_not_dropped(fake_gemini):
    """Models occasionally fill the wrong field. Losing good text to that would
    look like an outage to the user."""
    fake_gemini(json.dumps({
        "variants": [{"text": "Developed booking workflows using Angular.", "style": ""}],
        "bullets": [],
    }))
    result = await ai_service.generate_resume_content(
        GenerateRequest(kind="experience", current="Worked on booking.", tech=["Angular"])
    )
    assert result.bullets == ["Developed booking workflows using Angular."]
    assert result.variants == []


# --------------------------------------------------------------------------- #
# 2. Bullet rewriter
# --------------------------------------------------------------------------- #


@pytest.mark.asyncio
async def test_the_rewriter_returns_one_suggestion_per_style(fake_gemini):
    fake_gemini(json.dumps({"suggestions": [
        {"text": "Developed reusable UI components using Angular and TypeScript.",
         "style": "professional"},
        {"text": "Built reusable Angular UI components in TypeScript.", "style": "concise"},
    ]}))
    result = await ai_service.rewrite_bullet(
        RewriteRequest(
            bullet="Responsible for developing UI components.",
            styles=["professional", "concise"],
            tech=["Angular", "TypeScript"],
        )
    )
    assert result.original == "Responsible for developing UI components."
    assert [s.style for s in result.suggestions] == ["professional", "concise"]


@pytest.mark.asyncio
async def test_the_rewriter_drops_a_suggestion_that_invents_a_technology(fake_gemini):
    fake_gemini(json.dumps({"suggestions": [
        {"text": "Integrated REST APIs with Angular applications.", "style": "professional"},
        {"text": "Integrated GraphQL APIs across microservices.", "style": "technical"},
    ]}))
    result = await ai_service.rewrite_bullet(
        RewriteRequest(bullet="Worked on APIs.", tech=["Angular", "REST"])
    )
    assert len(result.suggestions) == 1
    assert "GraphQL" not in result.suggestions[0].text
    assert "withheld" in result.notes[0]


@pytest.mark.asyncio
async def test_the_rewriter_leaves_the_bullet_alone_when_nothing_survives(fake_gemini):
    """The important negative case: never a fabrication, and never silence."""
    fake_gemini(json.dumps({"suggestions": [
        {"text": "Resolved 150+ production defects.", "style": "impactful"},
    ]}))
    result = await ai_service.rewrite_bullet(RewriteRequest(bullet="Fixed bugs."))
    assert result.suggestions == []
    assert result.original == "Fixed bugs."
    assert any("unchanged" in note for note in result.notes)


@pytest.mark.asyncio
async def test_the_rewriter_deduplicates_identical_suggestions(fake_gemini):
    fake_gemini(json.dumps({"suggestions": [
        {"text": "Built UI components.", "style": "concise"},
        {"text": "built ui components.", "style": "professional"},
    ]}))
    result = await ai_service.rewrite_bullet(RewriteRequest(bullet="Made UI components."))
    assert len(result.suggestions) == 1


# --------------------------------------------------------------------------- #
# 3. ATS readiness
# --------------------------------------------------------------------------- #


@pytest.mark.asyncio
async def test_ats_scoring_validates_and_returns_the_report(fake_gemini, resume):
    fake_gemini(_ats_payload())
    result = await ai_service.calculate_ats_score(resume)
    assert result.overall_score == 84
    assert result.categories.formatting == 95
    assert result.recommendations[0].action == "summary"


@pytest.mark.asyncio
async def test_an_out_of_range_score_is_a_bad_response_not_a_broken_dashboard(fake_gemini, resume):
    """120 would render as a progress bar past its own end."""
    fake_gemini(_ats_payload(overall_score=120))
    with pytest.raises(gemini.AiBadResponse):
        await ai_service.calculate_ats_score(resume)


@pytest.mark.asyncio
async def test_ats_scoring_rejects_a_missing_category(fake_gemini, resume):
    fake_gemini(_ats_payload(categories={"keyword_match": 80}))
    with pytest.raises(gemini.AiBadResponse):
        await ai_service.calculate_ats_score(resume)


@pytest.mark.asyncio
async def test_an_almost_empty_resume_is_answered_without_calling_gemini(fake_gemini):
    """A free-tier call to be told the page is blank is a call wasted."""
    client = fake_gemini()  # no scripted outcomes: any call would raise IndexError
    result = await ai_service.calculate_ats_score(ResumeData())
    assert client.calls == 0
    assert result.overall_score == 0
    assert result.recommendations[0].title == "Add your experience"


# --------------------------------------------------------------------------- #
# 4. Job description matcher
# --------------------------------------------------------------------------- #


@pytest.mark.asyncio
async def test_job_matching_validates_and_returns_the_report(fake_gemini, resume):
    fake_gemini(_match_payload())
    result = await ai_service.match_job_description(resume, "We need an Angular engineer on AWS.")
    assert result.match_score == 82
    assert result.matched_skills[0].skill == "Angular"
    assert result.missing_skills[0].importance == "high"
    assert result.experience_alignment.score == 85


@pytest.mark.asyncio
async def test_job_matching_rejects_an_unknown_importance(fake_gemini, resume):
    fake_gemini(_match_payload(missing_skills=[{"skill": "AWS", "importance": "critical"}]))
    with pytest.raises(gemini.AiBadResponse):
        await ai_service.match_job_description(resume, "We need an Angular engineer.")


# --------------------------------------------------------------------------- #
# The digest sent to Gemini
# --------------------------------------------------------------------------- #


def test_the_digest_is_far_smaller_than_the_json_it_replaces(resume):
    digest = ai_service.resume_digest(resume)
    assert len(digest) < len(resume.model_dump_json()) / 2
    assert "Lead UI Developer" in digest
    assert "Angular" in digest


def test_a_hidden_section_is_not_scored(resume):
    """It is not on the page, so it should not count for or against the resume."""
    resume.sections[1].visible = False
    assert "Lead UI Developer" not in ai_service.resume_digest(resume)


def test_the_digest_is_capped(resume):
    resume.sections[0].content = "x" * 50_000
    assert len(ai_service.resume_digest(resume)) <= ai_service.MAX_DIGEST_CHARS


# --------------------------------------------------------------------------- #
# Failure handling — every branch a free-tier key actually hits
# --------------------------------------------------------------------------- #


@pytest.mark.asyncio
async def test_a_transient_failure_is_retried_once(fake_gemini):
    client = fake_gemini(api_error(503), json.dumps({"suggestions": []}))
    await ai_service.rewrite_bullet(RewriteRequest(bullet="Fixed bugs."))
    assert client.calls == 2


@pytest.mark.asyncio
async def test_a_persistent_outage_is_reported_as_unavailable(fake_gemini):
    fake_gemini(api_error(503), api_error(503))
    with pytest.raises(gemini.AiUnavailable, match="busy"):
        await ai_service.rewrite_bullet(RewriteRequest(bullet="Fixed bugs."))


@pytest.mark.asyncio
async def test_a_rate_limit_is_named_precisely(fake_gemini):
    """429 has to be distinguishable from a generic outage: the advice differs."""
    fake_gemini(api_error(429), api_error(429))
    with pytest.raises(gemini.AiRateLimited, match="usage limit"):
        await ai_service.rewrite_bullet(RewriteRequest(bullet="Fixed bugs."))


@pytest.mark.asyncio
async def test_malformed_json_is_a_bad_response(fake_gemini):
    fake_gemini("I'd be happy to help you rewrite that bullet!")
    with pytest.raises(gemini.AiBadResponse):
        await ai_service.rewrite_bullet(RewriteRequest(bullet="Fixed bugs."))


@pytest.mark.asyncio
async def test_a_fenced_reply_is_still_read(fake_gemini):
    """The prompt forbids fences; models add them anyway."""
    fake_gemini('```json\n{"suggestions": [{"text": "Resolved defects.", "style": "concise"}]}\n```')
    result = await ai_service.rewrite_bullet(RewriteRequest(bullet="Fixed bugs."))
    assert result.suggestions[0].text == "Resolved defects."


@pytest.mark.asyncio
async def test_an_empty_reply_is_retried_then_reported(fake_gemini):
    client = fake_gemini("", "")
    with pytest.raises(gemini.AiUnavailable):
        await ai_service.rewrite_bullet(RewriteRequest(bullet="Fixed bugs."))
    assert client.calls == 2


@pytest.mark.asyncio
async def test_an_unconfigured_server_never_reaches_the_network(monkeypatch):
    from app.core.config import settings

    monkeypatch.setattr(settings, "gemini_api_key", "")
    with pytest.raises(gemini.AiNotConfigured, match="not configured"):
        await ai_service.rewrite_bullet(RewriteRequest(bullet="Fixed bugs."))


# --------------------------------------------------------------------------- #
# The endpoints
# --------------------------------------------------------------------------- #


def test_every_ai_endpoint_requires_authentication(client):
    """These cost quota. An open one is a stranger spending the owner's key."""
    for path, body in [
        ("generate", {"kind": "summary"}),
        ("rewrite-bullet", {"bullet": "Fixed bugs."}),
        ("ats-score", {}),
        ("job-match", {"job_description": "x" * 50}),
    ]:
        response = client.post(f"/api/v1/ai/resume/{path}", json=body)
        assert response.status_code == 401, path


def test_generate_rejects_an_unknown_kind(client, account):
    response = client.post(
        "/api/v1/ai/resume/generate",
        json={"kind": "cover_letter", "current": "hello"},
        headers=account["headers"],
    )
    assert response.status_code == 422


def test_rewrite_rejects_a_blank_bullet(client, account):
    response = client.post(
        "/api/v1/ai/resume/rewrite-bullet",
        json={"bullet": "   "},
        headers=account["headers"],
    )
    assert response.status_code == 422
    assert "nothing to rewrite" in response.json()["detail"].lower()


def test_job_match_rejects_a_job_description_too_short_to_analyse(client, account):
    response = client.post(
        "/api/v1/ai/resume/job-match",
        json={"job_description": "Angular dev"},
        headers=account["headers"],
    )
    assert response.status_code == 422


def test_rewrite_returns_suggestions_through_the_endpoint(client, account, fake_gemini):
    fake_gemini(json.dumps({"suggestions": [
        {"text": "Diagnosed and resolved software defects.", "style": "professional"},
    ]}))
    response = client.post(
        "/api/v1/ai/resume/rewrite-bullet",
        json={"bullet": "Fixed bugs."},
        headers=account["headers"],
    )
    assert response.status_code == 200
    body = response.json()
    assert body["original"] == "Fixed bugs."
    assert body["suggestions"][0]["style"] == "professional"


def test_an_outage_becomes_503(client, account, fake_gemini):
    fake_gemini(api_error(503), api_error(503))
    response = client.post(
        "/api/v1/ai/resume/rewrite-bullet",
        json={"bullet": "Fixed bugs."},
        headers=account["headers"],
    )
    assert response.status_code == 503


def test_a_rate_limit_becomes_429(client, account, fake_gemini):
    fake_gemini(api_error(429), api_error(429))
    response = client.post(
        "/api/v1/ai/resume/rewrite-bullet",
        json={"bullet": "Fixed bugs."},
        headers=account["headers"],
    )
    assert response.status_code == 429
    assert "usage limit" in response.json()["detail"]


def test_a_malformed_reply_becomes_502_not_a_500(client, account, fake_gemini):
    """The request was fine and our upstream answered badly. Blaming the user
    with a 4xx would send them off editing input that is not the problem."""
    fake_gemini("sorry, I can't do that")
    response = client.post(
        "/api/v1/ai/resume/rewrite-bullet",
        json={"bullet": "Fixed bugs."},
        headers=account["headers"],
    )
    assert response.status_code == 502
    assert response.json()["detail"] == "AI is temporarily unavailable. Please try again."


def test_no_endpoint_leaks_the_api_key_or_a_stack_trace(client, account, fake_gemini):
    from app.core.config import settings

    fake_gemini(api_error(400))
    response = client.post(
        "/api/v1/ai/resume/rewrite-bullet",
        json={"bullet": "Fixed bugs."},
        headers=account["headers"],
    )
    body = response.text
    assert settings.gemini_api_key not in body
    assert "Traceback" not in body
    assert "google.genai" not in body


def test_ats_scoring_runs_on_the_posted_draft(client, account, fake_gemini):
    fake_gemini(_ats_payload())
    response = client.post(
        "/api/v1/ai/resume/ats-score",
        json={
            "basics": {"full_name": "Ada Lovelace"},
            "sections": [
                {"type": "summary", "content": "Frontend engineer with booking systems "
                                               "experience across several products."},
                {"type": "experience", "items": [
                    {"role": "Lead UI Developer", "organization": "Nexus Cloud",
                     "bullets": ["Worked on cruise booking application."]}
                ]},
            ],
        },
        headers=account["headers"],
    )
    assert response.status_code == 200
    assert response.json()["overall_score"] == 84


def test_job_match_returns_the_full_report(client, account, fake_gemini):
    fake_gemini(_match_payload())
    response = client.post(
        "/api/v1/ai/resume/job-match",
        json={
            "basics": {"full_name": "Ada Lovelace"},
            "sections": [{"type": "summary", "content": "Angular engineer."}],
            "job_description": "We are hiring an Angular engineer with AWS and GraphQL exposure.",
        },
        headers=account["headers"],
    )
    assert response.status_code == 200
    body = response.json()
    assert body["match_score"] == 82
    assert body["missing_skills"][0]["skill"] == "AWS"
    # The rule that keeps the feature honest: never "add AWS", always "if you have".
    assert body["recommendations"][0].lower().startswith("if you have")
