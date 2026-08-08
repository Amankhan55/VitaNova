from tests.conftest import register


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
