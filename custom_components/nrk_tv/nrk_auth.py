"""NRK authentication helpers for user info and profile fetching."""

from __future__ import annotations

import logging

import aiohttp

from .const import NRK_PROFILE_SETTINGS_URL, NRK_USERINFO_URL

_LOGGER = logging.getLogger(__name__)


async def async_get_user_info(
    session: aiohttp.ClientSession, access_token: str
) -> dict:
    """Fetch OIDC user info claims from NRK."""
    headers = {"Authorization": f"Bearer {access_token}"}
    try:
        async with session.get(NRK_USERINFO_URL, headers=headers) as resp:
            if resp.status != 200:
                _LOGGER.error("NRK userinfo returned %s", resp.status)
                return {}
            return await resp.json()
    except (aiohttp.ClientError, TimeoutError) as err:
        _LOGGER.error("Error fetching NRK user info: %s", err)
        return {}


async def async_get_user_profiles(
    session: aiohttp.ClientSession, access_token: str, user_id: str
) -> list[dict]:
    """Fetch user profiles from NRK profile settings API."""
    url = f"{NRK_PROFILE_SETTINGS_URL}/{user_id}"
    headers = {"Authorization": f"Bearer {access_token}"}
    try:
        async with session.get(url, headers=headers) as resp:
            if resp.status != 200:
                _LOGGER.error("NRK profile settings returned %s", resp.status)
                return []
            data = await resp.json()
    except (aiohttp.ClientError, TimeoutError) as err:
        _LOGGER.error("Error fetching NRK profiles: %s", err)
        return []

    profiles = []
    for profile in data if isinstance(data, list) else data.get("profiles", []):
        profiles.append(
            {
                "id": profile.get("id", ""),
                "name": profile.get("name", ""),
                "avatar": profile.get("avatar", profile.get("nrk/avatar", "")),
                "color": profile.get("color", profile.get("nrk/color", "")),
                "content_group": profile.get("contentGroup", ""),
                "age": profile.get("age", profile.get("nrk/age", "")),
            }
        )
    return profiles
