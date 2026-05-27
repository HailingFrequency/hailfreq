"""Two-user E2E encryption smoke test using matrix-nio."""
import asyncio
import os
import secrets

import pytest
from nio import AsyncClient


pytestmark = pytest.mark.asyncio


HOMESERVER_URL = os.environ.get("HAILFREQ_TEST_HOMESERVER", "http://localhost:8008")


async def _login(user_id: str, password: str) -> AsyncClient:
    client = AsyncClient(HOMESERVER_URL, user_id)
    resp = await client.login(password, device_name=f"test-{secrets.token_hex(4)}")
    if hasattr(resp, "transport_response"):
        # Login error
        assert resp.transport_response.status == 200, f"Login failed: {resp}"
    return client


def _register_user(homeserver_url: str) -> dict:
    """Helper that registers a fresh local-account user via the admin API.
    Lives outside fixtures so tests can request multiple users in one run.
    """
    import hashlib
    import hmac

    import requests

    shared_secret = os.environ["SYNAPSE_REGISTRATION_SHARED_SECRET"]
    username = f"test_{secrets.token_hex(6)}"
    password = secrets.token_urlsafe(16)

    nonce = requests.get(f"{homeserver_url}/_synapse/admin/v1/register").json()["nonce"]
    mac = hmac.new(shared_secret.encode(), digestmod=hashlib.sha1)
    for part in (nonce, "\x00", username, "\x00", password, "\x00", "notadmin"):
        mac.update(part.encode())

    reg = requests.post(
        f"{homeserver_url}/_synapse/admin/v1/register",
        json={
            "nonce": nonce,
            "username": username,
            "password": password,
            "admin": False,
            "mac": mac.hexdigest(),
        },
    )
    reg.raise_for_status()
    body = reg.json()
    return {
        "user_id": body["user_id"],
        "password": password,
        "access_token": body["access_token"],
    }


async def test_two_users_can_create_and_join_encrypted_room():
    """Provision two users via the admin API. User A creates an encrypted
    room and invites user B, who joins. Verifies the Synapse path for
    encrypted-room creation and join end-to-end at the protocol level.

    Note: this does NOT verify Megolm message decryption — that requires
    Olm session setup and verified devices, which is out of scope for a
    server-deployment smoke test. Client-side Megolm tests live in Plan 2.
    """
    user_a = _register_user(HOMESERVER_URL)
    user_b = _register_user(HOMESERVER_URL)

    client_a = await _login(user_a["user_id"], user_a["password"])
    client_b = await _login(user_b["user_id"], user_b["password"])

    try:
        create_resp = await client_a.room_create(
            invite=[user_b["user_id"]],
            is_direct=True,
            initial_state=[
                {
                    "type": "m.room.encryption",
                    "state_key": "",
                    "content": {"algorithm": "m.megolm.v1.aes-sha2"},
                }
            ],
        )
        room_id = create_resp.room_id
        assert room_id, f"room_create failed: {create_resp}"

        join_resp = await client_b.join(room_id)
        assert hasattr(join_resp, "room_id"), f"join failed: {join_resp}"
        assert join_resp.room_id == room_id

        await asyncio.sleep(2)  # let Synapse settle the membership event

        # Verify the room state on both clients confirms encryption is on
        await client_a.sync(timeout=2000)
        await client_b.sync(timeout=2000)
        room_a = client_a.rooms.get(room_id)
        assert room_a is not None
        assert room_a.encrypted, "room should report as encrypted on user A's client"
    finally:
        await client_a.close()
        await client_b.close()
