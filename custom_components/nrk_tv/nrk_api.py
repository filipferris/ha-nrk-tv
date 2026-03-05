"""NRK PSAPI client for resolving stream URLs and browsing content."""

from __future__ import annotations

import logging
from dataclasses import dataclass, field

import aiohttp

from .const import MANIFEST_URL, PROGRAM_MANIFEST_URL, PSAPI_BASE

_LOGGER = logging.getLogger(__name__)

HEADERS = {
    "Accept": "application/json",
    "User-Agent": "HomeAssistant-NRK-TV/1.0",
}


@dataclass
class StreamInfo:
    """Resolved stream information."""

    url: str
    format: str
    mime_type: str


@dataclass
class NrkShow:
    """A show/series from NRK."""

    series_id: str
    title: str
    image_url: str = ""


@dataclass
class NrkSeason:
    """A season of a series."""

    series_id: str
    season_number: int
    title: str
    image_url: str = ""


@dataclass
class NrkEpisode:
    """An episode of a series."""

    prf_id: str
    title: str
    episode_title: str = ""
    image_url: str = ""
    duration: str = ""


async def get_live_stream_url(
    session: aiohttp.ClientSession, channel_id: str
) -> StreamInfo | None:
    """Resolve HLS stream URL for a live NRK channel."""
    url = MANIFEST_URL.format(channel_id=channel_id)
    return await _fetch_manifest(session, url)


async def get_program_stream_url(
    session: aiohttp.ClientSession, program_id: str
) -> StreamInfo | None:
    """Resolve HLS stream URL for an NRK on-demand program."""
    url = PROGRAM_MANIFEST_URL.format(program_id=program_id)
    return await _fetch_manifest(session, url)


async def get_children_shows(
    session: aiohttp.ClientSession,
) -> list[NrkShow]:
    """Fetch popular children's shows from NRK Super."""
    url = f"{PSAPI_BASE}/tv/pages/barn"
    try:
        async with session.get(url, headers=HEADERS) as resp:
            if resp.status != 200:
                _LOGGER.error("NRK pages/barn returned %s", resp.status)
                return []
            data = await resp.json()
    except (aiohttp.ClientError, TimeoutError) as err:
        _LOGGER.error("Error fetching NRK barn page: %s", err)
        return []

    shows: dict[str, NrkShow] = {}
    for section in data.get("sections", []):
        included = section.get("included", {})
        for plug in included.get("plugs", []):
            content = plug.get("displayContractContent", {})
            title = content.get("contentTitle", "")
            if not title:
                continue

            # Extract series ID from link
            series_link = plug.get("_links", {}).get("series", {}).get("name", "")
            series_href = plug.get("_links", {}).get("series", {}).get("href", "")
            # href is like /tv/catalog/series/klassen
            series_id = series_href.rstrip("/").split("/")[-1] if series_href else ""
            if not series_id:
                continue

            # Only keep the series title (not episode subtitle)
            series_title = title.split(":")[0].strip() if ":" in title else title

            if series_id not in shows:
                # Get image
                images = content.get("displayContractImage", {})
                img_url = ""
                if isinstance(images, dict):
                    web_images = images.get("webImages", [])
                    for img in web_images:
                        if img.get("width", 0) >= 300:
                            img_url = img.get("uri", "")
                            break
                    if not img_url and web_images:
                        img_url = web_images[0].get("uri", "")
                elif isinstance(images, list):
                    for img in images:
                        if img.get("width", 0) >= 300:
                            img_url = img.get("uri", img.get("url", ""))
                            break
                    if not img_url and images:
                        img_url = images[0].get("uri", images[0].get("url", ""))

                shows[series_id] = NrkShow(
                    series_id=series_id,
                    title=series_title,
                    image_url=img_url,
                )

    return list(shows.values())


async def get_series_seasons(
    session: aiohttp.ClientSession, series_id: str
) -> tuple[str, list[NrkSeason]]:
    """Fetch seasons for a series. Returns (series_title, seasons)."""
    url = f"{PSAPI_BASE}/tv/catalog/series/{series_id}"
    try:
        async with session.get(url, headers=HEADERS) as resp:
            if resp.status != 200:
                _LOGGER.error("NRK series %s returned %s", series_id, resp.status)
                return series_id, []
            data = await resp.json()
    except (aiohttp.ClientError, TimeoutError) as err:
        _LOGGER.error("Error fetching NRK series: %s", err)
        return series_id, []

    series_title = data.get("sequential", {}).get("titles", {}).get("title", series_id)
    embedded = data.get("_embedded", {})
    raw_seasons = embedded.get("seasons", [])

    seasons = []
    for s in raw_seasons:
        seq = s.get("sequenceNumber", 0)
        title = s.get("titles", {}).get("title", f"Sesong {seq}")
        images = s.get("image", {})
        img_url = ""
        if isinstance(images, dict):
            web_images = images.get("webImages", [])
            for img in web_images:
                if img.get("width", 0) >= 300:
                    img_url = img.get("uri", "")
                    break
            if not img_url and web_images:
                img_url = web_images[0].get("uri", "")
        elif isinstance(images, list):
            for img in images:
                if img.get("width", 0) >= 300:
                    img_url = img.get("uri", img.get("url", ""))
                    break

        seasons.append(NrkSeason(
            series_id=series_id,
            season_number=seq,
            title=title,
            image_url=img_url,
        ))

    return series_title, seasons


async def get_season_episodes(
    session: aiohttp.ClientSession, series_id: str, season_number: int
) -> list[NrkEpisode]:
    """Fetch episodes for a season."""
    url = f"{PSAPI_BASE}/tv/catalog/series/{series_id}/seasons/{season_number}"
    try:
        async with session.get(url, headers=HEADERS) as resp:
            if resp.status != 200:
                _LOGGER.error(
                    "NRK season %s/%s returned %s", series_id, season_number, resp.status
                )
                return []
            data = await resp.json()
    except (aiohttp.ClientError, TimeoutError) as err:
        _LOGGER.error("Error fetching NRK season: %s", err)
        return []

    embedded = data.get("_embedded", {})
    raw_episodes = embedded.get("episodes", [])

    episodes = []
    for ep in raw_episodes:
        prf_id = ep.get("prfId", "")
        if not prf_id:
            continue
        titles = ep.get("titles", {})
        title = titles.get("title", "")
        images = ep.get("image", {})
        img_url = ""
        if isinstance(images, dict):
            web_images = images.get("webImages", [])
            for img in web_images:
                if img.get("width", 0) >= 300:
                    img_url = img.get("uri", "")
                    break
            if not img_url and web_images:
                img_url = web_images[0].get("uri", "")
        elif isinstance(images, list):
            for img in images:
                if img.get("width", 0) >= 300:
                    img_url = img.get("uri", img.get("url", ""))
                    break

        episodes.append(NrkEpisode(
            prf_id=prf_id,
            title=title,
            image_url=img_url,
            duration=ep.get("durationDisplayValue", ""),
        ))

    return episodes


async def _fetch_manifest(
    session: aiohttp.ClientSession, url: str
) -> StreamInfo | None:
    """Fetch a playback manifest and extract the HLS stream URL."""
    try:
        async with session.get(url, headers=HEADERS) as resp:
            if resp.status != 200:
                _LOGGER.error(
                    "NRK PSAPI returned %s for %s", resp.status, url
                )
                return None
            data = await resp.json()
    except (aiohttp.ClientError, TimeoutError) as err:
        _LOGGER.error("Error fetching NRK manifest: %s", err)
        return None

    playable = data.get("playable") or data
    assets = playable.get("assets", [])

    for asset in assets:
        if asset.get("format", "").upper() == "HLS":
            return StreamInfo(
                url=asset["url"],
                format="HLS",
                mime_type=asset.get(
                    "mimeType", "application/vnd.apple.mpegurl"
                ),
            )

    _LOGGER.warning("No HLS asset found in NRK manifest for %s", url)
    return None
