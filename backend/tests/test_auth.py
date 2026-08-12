import uuid

import pytest

from tests.conftest import last_link, register, token_from_link


def new_email() -> str:
    return f"user-{uuid.uuid4().hex[:10]}@example.com"


def test_register_login_and_me(client):
    account = register(client)

    login = client.post(
        "/api/v1/auth/login",
        json={"email": account["email"], "password": account["password"]},
    )
    assert login.status_code == 200
    token = login.json()["tokens"]["access_token"]

    me = client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert me.status_code == 200
    assert me.json()["email"] == account["email"]
    assert me.json()["email_verified"] is True


def test_duplicate_email_is_rejected(client):
    account = register(client)
    again = client.post(
        "/api/v1/auth/register",
        json={"email": account["email"], "password": "another password"},
    )
    assert again.status_code == 409


def test_wrong_password_is_rejected(client):
    account = register(client)
    response = client.post(
        "/api/v1/auth/login",
        json={"email": account["email"], "password": "not the password"},
    )
    assert response.status_code == 401


def test_login_does_not_reveal_whether_an_email_exists(client):
    account = register(client)

    wrong_password = client.post(
        "/api/v1/auth/login", json={"email": account["email"], "password": "nope"}
    )
    unknown_email = client.post(
        "/api/v1/auth/login", json={"email": "nobody@example.com", "password": "nope"}
    )

    assert wrong_password.status_code == unknown_email.status_code == 401
    assert wrong_password.json()["detail"] == unknown_email.json()["detail"]


def test_protected_route_requires_a_token(client):
    assert client.get("/api/v1/resumes").status_code in (401, 403)
    assert client.get("/api/v1/auth/me", headers={"Authorization": "Bearer nonsense"}).status_code == 401


def test_refresh_rotates_and_burns_the_old_token(client):
    account = register(client)
    original = account["tokens"]["refresh_token"]

    first = client.post("/api/v1/auth/refresh", json={"refresh_token": original})
    assert first.status_code == 200
    assert first.json()["refresh_token"] != original

    # Replaying the consumed token must fail — that is the point of rotation.
    replay = client.post("/api/v1/auth/refresh", json={"refresh_token": original})
    assert replay.status_code == 401


def test_logout_revokes_the_refresh_token(client):
    account = register(client)
    refresh = account["tokens"]["refresh_token"]

    assert client.post("/api/v1/auth/logout", json={"refresh_token": refresh}).status_code == 204
    assert client.post("/api/v1/auth/refresh", json={"refresh_token": refresh}).status_code == 401


def test_access_token_is_not_accepted_as_a_refresh_token(client):
    account = register(client)
    response = client.post(
        "/api/v1/auth/refresh", json={"refresh_token": account["tokens"]["access_token"]}
    )
    assert response.status_code == 401


# ----------------------------------------------------------- email verification


def test_register_issues_no_tokens_and_blocks_login_until_verified(client):
    email, password = new_email(), "correct horse 42"
    created = client.post(
        "/api/v1/auth/register",
        json={"email": email, "password": password, "full_name": "Unverified"},
    )
    assert created.status_code == 201
    assert "tokens" not in created.json()

    blocked = client.post("/api/v1/auth/login", json={"email": email, "password": password})
    assert blocked.status_code == 403

    client.post("/api/v1/auth/verify-email", json={"token": token_from_link(last_link(email))})
    allowed = client.post("/api/v1/auth/login", json={"email": email, "password": password})
    assert allowed.status_code == 200


def test_verification_link_works_only_once(client):
    email = new_email()
    client.post(
        "/api/v1/auth/register", json={"email": email, "password": "correct horse 42"}
    )
    token = token_from_link(last_link(email))

    assert client.post("/api/v1/auth/verify-email", json={"token": token}).status_code == 200
    assert client.post("/api/v1/auth/verify-email", json={"token": token}).status_code == 400


def test_garbage_verification_token_is_rejected(client):
    assert (
        client.post("/api/v1/auth/verify-email", json={"token": "not-a-real-token"}).status_code
        == 400
    )


def test_resending_verification_invalidates_the_previous_link(client):
    email = new_email()
    client.post(
        "/api/v1/auth/register", json={"email": email, "password": "correct horse 42"}
    )
    first = token_from_link(last_link(email))

    resent = client.post("/api/v1/auth/resend-verification", json={"email": email})
    assert resent.status_code == 202
    second = token_from_link(last_link(email))
    assert second != first

    assert client.post("/api/v1/auth/verify-email", json={"token": first}).status_code == 400
    assert client.post("/api/v1/auth/verify-email", json={"token": second}).status_code == 200


def test_resend_does_not_reveal_whether_an_email_exists(client):
    known = register(client)["email"]
    for email in (known, "nobody@example.com"):
        response = client.post("/api/v1/auth/resend-verification", json={"email": email})
        assert response.status_code == 202
        assert response.json()["message"]


def test_resend_cooldown_suppresses_a_second_mail(client, monkeypatch):
    from app.core.config import settings
    from app.services import email_service

    email = new_email()
    client.post(
        "/api/v1/auth/register", json={"email": email, "password": "correct horse 42"}
    )
    monkeypatch.setattr(settings, "email_resend_cooldown_seconds", 60)

    before = len(email_service.outbox)
    assert client.post("/api/v1/auth/resend-verification", json={"email": email}).status_code == 202
    assert len(email_service.outbox) == before


# -------------------------------------------------------------- password reset


def test_forgot_password_lets_the_user_set_a_new_one(client):
    account = register(client)

    assert (
        client.post("/api/v1/auth/forgot-password", json={"email": account["email"]}).status_code
        == 202
    )
    token = token_from_link(last_link(account["email"]))

    reset = client.post(
        "/api/v1/auth/reset-password", json={"token": token, "password": "a brand new one"}
    )
    assert reset.status_code == 204

    stale = client.post(
        "/api/v1/auth/login",
        json={"email": account["email"], "password": account["password"]},
    )
    assert stale.status_code == 401
    fresh = client.post(
        "/api/v1/auth/login",
        json={"email": account["email"], "password": "a brand new one"},
    )
    assert fresh.status_code == 200


def test_reset_link_works_only_once(client):
    account = register(client)
    client.post("/api/v1/auth/forgot-password", json={"email": account["email"]})
    token = token_from_link(last_link(account["email"]))

    first = client.post(
        "/api/v1/auth/reset-password", json={"token": token, "password": "first attempt pw"}
    )
    second = client.post(
        "/api/v1/auth/reset-password", json={"token": token, "password": "second attempt"}
    )
    assert first.status_code == 204
    assert second.status_code == 400


def test_reset_revokes_existing_sessions(client):
    account = register(client)
    client.post("/api/v1/auth/forgot-password", json={"email": account["email"]})
    token = token_from_link(last_link(account["email"]))

    client.post("/api/v1/auth/reset-password", json={"token": token, "password": "displaced you"})

    # The session that was open when the password changed must not survive.
    replay = client.post(
        "/api/v1/auth/refresh", json={"refresh_token": account["tokens"]["refresh_token"]}
    )
    assert replay.status_code == 401


def test_reset_also_confirms_an_unverified_address(client):
    email = new_email()
    client.post(
        "/api/v1/auth/register", json={"email": email, "password": "correct horse 42"}
    )
    client.post("/api/v1/auth/forgot-password", json={"email": email})
    token = token_from_link(last_link(email))

    client.post("/api/v1/auth/reset-password", json={"token": token, "password": "recovered pw"})
    # Reading the mail proved the address, so login is no longer blocked.
    assert (
        client.post("/api/v1/auth/login", json={"email": email, "password": "recovered pw"}).status_code
        == 200
    )


def test_forgot_password_does_not_reveal_whether_an_email_exists(client):
    known = register(client)["email"]
    for email in (known, "nobody@example.com"):
        assert (
            client.post("/api/v1/auth/forgot-password", json={"email": email}).status_code == 202
        )


def test_a_verification_token_cannot_be_spent_as_a_reset(client):
    email = new_email()
    client.post(
        "/api/v1/auth/register", json={"email": email, "password": "correct horse 42"}
    )
    token = token_from_link(last_link(email))

    crossed = client.post(
        "/api/v1/auth/reset-password", json={"token": token, "password": "hijacked pw"}
    )
    assert crossed.status_code == 400


def test_short_reset_passwords_are_rejected(client):
    account = register(client)
    client.post("/api/v1/auth/forgot-password", json={"email": account["email"]})
    token = token_from_link(last_link(account["email"]))

    response = client.post(
        "/api/v1/auth/reset-password", json={"token": token, "password": "short"}
    )
    assert response.status_code == 422


# ---------------------------------------------------------------------- Google


def test_providers_reports_whether_google_is_configured(client):
    response = client.get("/api/v1/auth/providers")
    assert response.status_code == 200
    assert "google_client_id" in response.json()


def test_google_login_is_refused_when_unconfigured(client):
    # No client ID in the test environment, so nothing can be verified against it.
    response = client.post("/api/v1/auth/google", json={"credential": "anything"})
    assert response.status_code == 401


@pytest.mark.asyncio
async def test_google_sign_in_links_to_an_existing_account(client, monkeypatch):
    """A Google identity whose address already has a password account attaches
    to it rather than creating a second one."""
    from app.services import google_oauth

    account = register(client)
    identity = google_oauth.GoogleIdentity(
        sub=f"google-{uuid.uuid4().hex[:8]}", email=account["email"], full_name="Test Person"
    )

    async def fake_verify(credential: str):
        assert credential == "pretend-id-token"
        return identity

    monkeypatch.setattr(google_oauth, "verify", fake_verify)

    response = client.post("/api/v1/auth/google", json={"credential": "pretend-id-token"})
    assert response.status_code == 200
    assert response.json()["user"]["id"] == account["user"]["id"]

    # And the password sign-in still works alongside it.
    assert (
        client.post(
            "/api/v1/auth/login",
            json={"email": account["email"], "password": account["password"]},
        ).status_code
        == 200
    )


@pytest.mark.asyncio
async def test_google_sign_in_creates_a_verified_account(client, monkeypatch):
    from app.services import google_oauth

    email = new_email()
    identity = google_oauth.GoogleIdentity(
        sub=f"google-{uuid.uuid4().hex[:8]}", email=email, full_name="New Googler"
    )

    async def fake_verify(credential: str):
        return identity

    monkeypatch.setattr(google_oauth, "verify", fake_verify)

    response = client.post("/api/v1/auth/google", json={"credential": "pretend-id-token"})
    assert response.status_code == 200
    body = response.json()
    # Google vouched for the address, so there is nothing left to confirm.
    assert body["user"]["email_verified"] is True
    assert body["user"]["email"] == email

    # Signing in again finds the same account by its Google subject.
    again = client.post("/api/v1/auth/google", json={"credential": "pretend-id-token"})
    assert again.json()["user"]["id"] == body["user"]["id"]


@pytest.mark.asyncio
async def test_password_login_is_refused_for_a_google_only_account(client, monkeypatch):
    from app.services import google_oauth

    email = new_email()
    identity = google_oauth.GoogleIdentity(
        sub=f"google-{uuid.uuid4().hex[:8]}", email=email, full_name="No Password"
    )

    async def fake_verify(credential: str):
        return identity

    monkeypatch.setattr(google_oauth, "verify", fake_verify)
    client.post("/api/v1/auth/google", json={"credential": "pretend-id-token"})

    response = client.post("/api/v1/auth/login", json={"email": email, "password": "guessing"})
    assert response.status_code == 401
