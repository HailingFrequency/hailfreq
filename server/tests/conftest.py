"""Shared pytest fixtures for Hailfreq integration tests."""
import os
import secrets
import time

import pytest
import requests


HOMESERVER_URL = os.environ.get("HAILFREQ_TEST_HOMESERVER", "http://localhost:8008")
SHARED_SECRET = os.environ["SYNAPSE_REGISTRATION_SHARED_SECRET"]


@pytest.fixture(scope="session")
def homeserver_url() -> str:
    """The Synapse base URL to test against."""
    deadline = time.time() + 60
    while time.time() < deadline:
        try:
            r = requests.get(f"{HOMESERVER_URL}/health", timeout=2)
            if r.status_code == 200:
                return HOMESERVER_URL
        except requests.RequestException:
            pass
        time.sleep(1)
    raise RuntimeError(f"Synapse at {HOMESERVER_URL} did not become healthy in 60s")


@pytest.fixture
def random_user(homeserver_url: str) -> dict:
    """Provision a local-account user via the Synapse admin registration API.

    Returns dict with user_id, password, access_token.
    """
    username = f"test_{secrets.token_hex(6)}"
    password = secrets.token_urlsafe(16)

    # Step 1: GET to obtain a nonce
    nonce_resp = requests.get(f"{homeserver_url}/_synapse/admin/v1/register")
    nonce_resp.raise_for_status()
    nonce = nonce_resp.json()["nonce"]

    # Step 2: compute HMAC-SHA1 over nonce, user, password, admin flag
    import hashlib
    import hmac

    mac = hmac.new(
        key=SHARED_SECRET.encode(),
        digestmod=hashlib.sha1,
    )
    mac.update(nonce.encode())
    mac.update(b"\x00")
    mac.update(username.encode())
    mac.update(b"\x00")
    mac.update(password.encode())
    mac.update(b"\x00")
    mac.update(b"notadmin")
    mac_digest = mac.hexdigest()

    # Step 3: POST registration
    reg = requests.post(
        f"{homeserver_url}/_synapse/admin/v1/register",
        json={
            "nonce": nonce,
            "username": username,
            "password": password,
            "admin": False,
            "mac": mac_digest,
        },
    )
    reg.raise_for_status()
    body = reg.json()

    return {
        "user_id": body["user_id"],
        "password": password,
        "access_token": body["access_token"],
        "device_id": body["device_id"],
    }
