"""WebSocket API for NRK TV custom card."""

from __future__ import annotations

import logging

import voluptuous as vol

from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.aiohttp_client import async_get_clientsession

from .const import DOMAIN
from .nrk_api import (
    get_children_shows,
    get_season_episodes,
    get_series_seasons,
)

_LOGGER = logging.getLogger(__name__)


def _extract_image(image_data) -> str:
    """Extract a usable image URL from NRK image data."""
    if isinstance(image_data, dict):
        web_images = image_data.get("webImages", [])
        for img in web_images:
            if img.get("width", 0) >= 300:
                return img.get("uri", "")
        if web_images:
            return web_images[0].get("uri", "")
    elif isinstance(image_data, list):
        for img in image_data:
            if img.get("width", 0) >= 300:
                return img.get("uri", img.get("url", ""))
        if image_data:
            return image_data[0].get("uri", image_data[0].get("url", ""))
    return ""


def async_register_websocket_api(hass: HomeAssistant) -> None:
    """Register WebSocket API handlers."""
    websocket_api.async_register_command(hass, ws_browse)
    websocket_api.async_register_command(hass, ws_series)
    websocket_api.async_register_command(hass, ws_episodes)


@websocket_api.websocket_command(
    {
        vol.Required("type"): "nrk_tv/browse",
        vol.Optional("content_group", default="children"): str,
        vol.Optional("page", default="barn"): str,
    }
)
@websocket_api.async_response
async def ws_browse(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict
) -> None:
    """Browse NRK TV content sections."""
    import aiohttp

    session = async_get_clientsession(hass)
    page = msg.get("page", "barn")
    url = f"https://psapi.nrk.no/tv/pages/{page}"

    headers = {
        "Accept": "application/json",
        "User-Agent": "HomeAssistant-NRK-TV/1.0",
    }

    try:
        async with session.get(url, headers=headers) as resp:
            if resp.status != 200:
                connection.send_error(
                    msg["id"], "nrk_error", f"NRK API returned {resp.status}"
                )
                return
            data = await resp.json()
    except (aiohttp.ClientError, TimeoutError) as err:
        connection.send_error(msg["id"], "nrk_error", str(err))
        return

    sections = []
    for section in data.get("sections", []):
        included = section.get("included", {})
        title = included.get("title", "")
        if not title:
            continue

        plugs = []
        seen_series = set()
        for plug in included.get("plugs", []):
            target_type = plug.get("targetType", "")
            content = plug.get("displayContractContent", {})
            content_title = content.get("contentTitle", "")
            if not content_title:
                continue

            # Extract series ID based on plug type
            series_id = ""
            prf_id = ""
            if target_type == "series":
                ser = plug.get("series", {})
                series_id = ser.get("seriesId", "")
            elif target_type == "episode":
                ep = plug.get("episode", {})
                series_id = ep.get("seriesId", "")
                prf_id = ep.get("programId", "")
                if not series_id:
                    series_href = ep.get("_links", {}).get("series", {}).get("href", "")
                    series_id = series_href.rstrip("/").split("/")[-1] if series_href else ""
            elif target_type == "channel":
                continue  # skip live channel plugs

            # Deduplicate by series
            if series_id and series_id in seen_series:
                continue
            if series_id:
                seen_series.add(series_id)

            # Use series title (strip episode subtitle)
            show_title = content_title.split(":")[0].strip() if ":" in content_title and series_id else content_title

            # Extract image
            img_url = _extract_image(content.get("displayContractImage", {}))

            plugs.append(
                {
                    "title": show_title,
                    "series_id": series_id,
                    "image": img_url,
                    "prf_id": prf_id,
                }
            )

        if plugs:
            sections.append({"title": title, "shows": plugs})

    connection.send_result(msg["id"], {"sections": sections})


@websocket_api.websocket_command(
    {
        vol.Required("type"): "nrk_tv/series",
        vol.Required("series_id"): str,
    }
)
@websocket_api.async_response
async def ws_series(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict
) -> None:
    """Get seasons for a series."""
    session = async_get_clientsession(hass)
    series_id = msg["series_id"]

    series_title, seasons = await get_series_seasons(session, series_id)

    result = {
        "title": series_title,
        "seasons": [
            {
                "number": s.season_number,
                "title": s.title,
                "image": s.image_url,
            }
            for s in seasons
        ],
    }

    connection.send_result(msg["id"], result)


@websocket_api.websocket_command(
    {
        vol.Required("type"): "nrk_tv/episodes",
        vol.Required("series_id"): str,
        vol.Required("season"): int,
    }
)
@websocket_api.async_response
async def ws_episodes(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict
) -> None:
    """Get episodes for a season."""
    session = async_get_clientsession(hass)
    series_id = msg["series_id"]
    season = msg["season"]

    episodes = await get_season_episodes(session, series_id, season)

    result = {
        "episodes": [
            {
                "prf_id": ep.prf_id,
                "title": ep.title,
                "image": ep.image_url,
                "duration": ep.duration,
            }
            for ep in episodes
        ],
    }

    connection.send_result(msg["id"], result)
