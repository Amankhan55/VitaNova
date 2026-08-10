from tests.conftest import register


def create(client, account, **overrides) -> dict:
    payload = {"title": "My Resume", "template_id": "modern-professional", **overrides}
    response = client.post("/api/v1/resumes", json=payload, headers=account["headers"])
    assert response.status_code == 201, response.text
    return response.json()


def test_create_seeds_the_starter_sections(client, account):
    resume = create(client, account)
    types = [section["type"] for section in resume["sections"]]
    assert "summary" in types
    assert "experience" in types
    assert resume["template_id"] == "modern-professional"


def test_list_returns_only_your_own_resumes(client):
    alice = register(client)
    bob = register(client)
    create(client, alice, title="Alice CV")

    bobs = client.get("/api/v1/resumes", headers=bob["headers"]).json()
    assert all(item["title"] != "Alice CV" for item in bobs)


def test_another_user_cannot_read_update_or_delete_your_resume(client):
    alice = register(client)
    bob = register(client)
    resume = create(client, alice)
    resume_id = resume["id"]

    assert client.get(f"/api/v1/resumes/{resume_id}", headers=bob["headers"]).status_code == 404
    assert (
        client.patch(
            f"/api/v1/resumes/{resume_id}", json={"title": "Stolen"}, headers=bob["headers"]
        ).status_code
        == 404
    )
    assert client.delete(f"/api/v1/resumes/{resume_id}", headers=bob["headers"]).status_code == 404
    assert (
        client.get(f"/api/v1/resumes/{resume_id}/export/pdf", headers=bob["headers"]).status_code
        == 404
    )

    # And the document is untouched.
    still_there = client.get(f"/api/v1/resumes/{resume_id}", headers=alice["headers"])
    assert still_there.status_code == 200
    assert still_there.json()["title"] == "My Resume"


def test_patch_updates_only_the_fields_sent(client, account):
    resume = create(client, account)
    original_sections = resume["sections"]

    updated = client.patch(
        f"/api/v1/resumes/{resume['id']}",
        json={"title": "Renamed"},
        headers=account["headers"],
    )
    assert updated.status_code == 200
    body = updated.json()
    assert body["title"] == "Renamed"
    assert body["sections"] == original_sections


def test_switching_template_preserves_all_content(client, account):
    resume = create(client, account)
    filled = client.patch(
        f"/api/v1/resumes/{resume['id']}",
        json={"basics": {**resume["basics"], "full_name": "Alex Morgan"}},
        headers=account["headers"],
    ).json()

    switched = client.patch(
        f"/api/v1/resumes/{resume['id']}",
        json={"template_id": "timeless-elegant"},
        headers=account["headers"],
    ).json()

    assert switched["template_id"] == "timeless-elegant"
    assert switched["basics"]["full_name"] == "Alex Morgan"
    assert switched["sections"] == filled["sections"]


def test_unknown_template_falls_back_to_the_default(client, account):
    resume = create(client, account, template_id="does-not-exist")
    assert resume["template_id"] == "modern-professional"


def test_duplicate_creates_an_independent_copy(client, account):
    resume = create(client, account)
    copy = client.post(
        f"/api/v1/resumes/{resume['id']}/duplicate", headers=account["headers"]
    ).json()

    assert copy["id"] != resume["id"]
    assert copy["title"].endswith("(copy)")

    client.patch(
        f"/api/v1/resumes/{copy['id']}", json={"title": "Changed"}, headers=account["headers"]
    )
    original = client.get(f"/api/v1/resumes/{resume['id']}", headers=account["headers"]).json()
    assert original["title"] == "My Resume"


def test_delete_removes_the_resume(client, account):
    resume = create(client, account)
    assert (
        client.delete(f"/api/v1/resumes/{resume['id']}", headers=account["headers"]).status_code
        == 204
    )
    assert (
        client.get(f"/api/v1/resumes/{resume['id']}", headers=account["headers"]).status_code == 404
    )


def test_import_rejects_non_pdf_file(client, account):
    response = client.post(
        "/api/v1/resumes/import",
        files={"file": ("test.txt", b"hello world", "text/plain")},
        headers=account["headers"],
    )
    assert response.status_code == 422
    assert "Only PDF files" in response.json()["detail"]

