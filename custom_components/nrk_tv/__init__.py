"""NRK TV integration for Home Assistant."""

from __future__ import annotations

import logging

import voluptuous as vol

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, ServiceCall
from homeassistant.helpers.aiohttp_client import async_get_clientsession

from .const import DOMAIN, NRK_CHANNELS
from .nrk_api import get_live_stream_url, get_program_stream_url
from .websocket_api import async_register_websocket_api

_LOGGER = logging.getLogger(__name__)


SERVICE_PLAY_CHANNEL = "play_channel"
SERVICE_RESOLVE_STREAM = "resolve_stream"

PLAY_CHANNEL_SCHEMA = vol.Schema(
    {
        vol.Required("channel_id"): vol.In(list(NRK_CHANNELS.keys())),
        vol.Required("target"): str,
    }
)

RESOLVE_SCHEMA = vol.Schema(
    {
        vol.Required("channel_id"): str,
        vol.Optional("entity_id"): str,
    }
)


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Set up NRK TV from a config entry."""
    hass.data.setdefault(DOMAIN, {})
    entry_data: dict = {}

    # Store session cookie if present (from nrk-token-helper auth)
    session_cookie = entry.data.get("session_cookie")
    if session_cookie:
        entry_data["session_cookie"] = session_cookie

    # Placeholder for future OAuth access_token support
    entry_data.setdefault("access_token", None)

    hass.data[DOMAIN][entry.entry_id] = entry_data

    # Register the custom card JS as a frontend resource
    from homeassistant.components.http import StaticPathConfig

    await hass.http.async_register_static_paths(
        [
            StaticPathConfig(
                "/nrk_tv/nrk-tv-card.js",
                hass.config.path("custom_components/nrk_tv/www/nrk-tv-card.js"),
                cache_headers=False,
            )
        ]
    )

    async_register_websocket_api(hass)

    async def handle_play_channel(call: ServiceCall) -> None:
        """Resolve and play an NRK live channel on a media player."""
        channel_id = call.data["channel_id"]
        target = call.data["target"]
        session = async_get_clientsession(hass)

        stream = await get_live_stream_url(session, channel_id)
        if not stream:
            _LOGGER.error("Could not resolve live stream for: %s", channel_id)
            return

        _LOGGER.info("Playing NRK %s on %s: %s", channel_id, target, stream.url)
        await hass.services.async_call(
            "media_player",
            "play_media",
            {
                "entity_id": target,
                "media_content_id": stream.url,
                "media_content_type": "video",
            },
        )

    async def handle_resolve_stream(call: ServiceCall) -> None:
        """Resolve an NRK stream URL and optionally play it."""
        channel_id = call.data["channel_id"]
        session = async_get_clientsession(hass)

        if channel_id in NRK_CHANNELS:
            stream = await get_live_stream_url(session, channel_id)
        else:
            stream = await get_program_stream_url(session, channel_id)

        if not stream:
            _LOGGER.error("Could not resolve stream for: %s", channel_id)
            return

        _LOGGER.info("Resolved NRK stream: %s", stream.url)

        entity_id = call.data.get("entity_id")
        if entity_id:
            await hass.services.async_call(
                "media_player",
                "play_media",
                {
                    "entity_id": entity_id,
                    "media_content_id": stream.url,
                    "media_content_type": "video",
                },
            )

    hass.services.async_register(
        DOMAIN, SERVICE_PLAY_CHANNEL, handle_play_channel, schema=PLAY_CHANNEL_SCHEMA
    )
    hass.services.async_register(
        DOMAIN, SERVICE_RESOLVE_STREAM, handle_resolve_stream, schema=RESOLVE_SCHEMA
    )

    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Unload NRK TV config entry."""
    hass.services.async_remove(DOMAIN, SERVICE_PLAY_CHANNEL)
    hass.services.async_remove(DOMAIN, SERVICE_RESOLVE_STREAM)
    hass.data[DOMAIN].pop(entry.entry_id, None)
    return True
