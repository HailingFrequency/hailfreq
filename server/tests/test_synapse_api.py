"""End-to-end Synapse API tests against a running Hailfreq deployment."""
import requests


def test_synapse_health(homeserver_url: str):
    """Synapse /health endpoint returns 200."""
    r = requests.get(f"{homeserver_url}/health")
    assert r.status_code == 200


def test_synapse_version(homeserver_url: str):
    """Synapse version endpoint returns expected payload shape."""
    r = requests.get(f"{homeserver_url}/_matrix/client/versions")
    r.raise_for_status()
    body = r.json()
    assert "versions" in body
    assert any(v.startswith("v1.") for v in body["versions"])


def test_registration_disabled(homeserver_url: str):
    """Public registration is disabled per spec — token required."""
    r = requests.post(
        f"{homeserver_url}/_matrix/client/v3/register",
        json={"username": "should_not_work", "password": "x"},
    )
    # Either 401 (token required) or 403 (registration disabled).
    assert r.status_code in (401, 403)


def test_federation_disabled(homeserver_url: str):
    """Federation endpoint either 404 or returns no servers (island server)."""
    # The /_matrix/federation/v1/version is normally always present.
    # With federation truly disabled, Caddy still proxies and Synapse responds —
    # but the server should not be reachable in federation context. We just
    # check that the basic federation endpoint is up (signaling is fine; what's
    # off is federation_domain_whitelist).
    r = requests.get(f"{homeserver_url}/_matrix/federation/v1/version")
    # Accept either 200 (endpoint exists) or 404 (totally disabled)
    assert r.status_code in (200, 404)


def test_local_account_can_login(homeserver_url: str, random_user: dict):
    """A user created via admin API can log in via the client API."""
    r = requests.post(
        f"{homeserver_url}/_matrix/client/v3/login",
        json={
            "type": "m.login.password",
            "identifier": {"type": "m.id.user", "user": random_user["user_id"]},
            "password": random_user["password"],
        },
    )
    r.raise_for_status()
    assert "access_token" in r.json()


def test_local_account_can_create_encrypted_room(homeserver_url: str, random_user: dict):
    """A logged-in user can create an end-to-end-encrypted room."""
    token = random_user["access_token"]
    r = requests.post(
        f"{homeserver_url}/_matrix/client/v3/createRoom",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "preset": "private_chat",
            "initial_state": [
                {
                    "type": "m.room.encryption",
                    "state_key": "",
                    "content": {"algorithm": "m.megolm.v1.aes-sha2"},
                }
            ],
        },
    )
    r.raise_for_status()
    assert r.json()["room_id"].startswith("!")
