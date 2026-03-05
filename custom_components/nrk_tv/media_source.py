"""NRK TV media source for Home Assistant media browser."""

from __future__ import annotations

import logging

from homeassistant.components.media_player import MediaClass, MediaType
from homeassistant.components.media_source import (
    BrowseMediaSource,
    MediaSource,
    MediaSourceItem,
    PlayMedia,
    Unresolvable,
)
from homeassistant.core import HomeAssistant
from homeassistant.helpers.aiohttp_client import async_get_clientsession

from .const import DOMAIN, NRK_CHANNELS
from .nrk_api import (
    get_children_shows,
    get_live_stream_url,
    get_program_stream_url,
    get_season_episodes,
    get_series_seasons,
)

_LOGGER = logging.getLogger(__name__)

CHANNEL_ICONS = {
    "nrk1": "https://gfx.nrk.no/EwME_RsHRBSKRe2sIYephwF-yoM3MeMa6VIG67aHQI5A",
    "nrk2": "https://gfx.nrk.no/EwME_RsHRBSKRe2sIYephwJjxTnCMhNW26SHn-cCJYZQ",
    "nrk3": "https://gfx.nrk.no/EwME_RsHRBSKRe2sIYephwKFBvVp_k7OaGIjSJCuoLcA",
    "nrksuper": "https://gfx.nrk.no/EwME_RsHRBSKRe2sIYephwLYLwK60-7_sMGXMFwcPt3A",
}

# Identifier format:
#   channel/{channel_id}         - live channel
#   shows                        - children's shows listing
#   series/{series_id}           - seasons of a series
#   season/{series_id}/{number}  - episodes of a season
#   episode/{prf_id}             - playable episode


async def async_get_media_source(hass: HomeAssistant) -> NrkTvMediaSource:
    """Set up NRK TV media source."""
    return NrkTvMediaSource(hass)


class NrkTvMediaSource(MediaSource):
    """Provide NRK TV channels and on-demand content as a media source."""

    name = "NRK TV"

    def __init__(self, hass: HomeAssistant) -> None:
        super().__init__(DOMAIN)
        self.hass = hass

    async def async_resolve_media(self, item: MediaSourceItem) -> PlayMedia:
        """Resolve a media item to a playable URL."""
        identifier = item.identifier or ""
        session = async_get_clientsession(self.hass)

        if identifier.startswith("channel/"):
            channel_id = identifier.split("/", 1)[1]
            stream = await get_live_stream_url(session, channel_id)
        elif identifier.startswith("episode/"):
            prf_id = identifier.split("/", 1)[1]
            stream = await get_program_stream_url(session, prf_id)
        else:
            # Try as a raw channel ID for backwards compat
            stream = await get_live_stream_url(session, identifier)

        if not stream:
            raise Unresolvable(
                f"Could not resolve stream for {identifier}. "
                "May be geo-blocked (Norway only)."
            )

        return PlayMedia(stream.url, stream.mime_type)

    async def async_browse_media(
        self, item: MediaSourceItem
    ) -> BrowseMediaSource:
        """Browse NRK TV content."""
        identifier = item.identifier or ""
        session = async_get_clientsession(self.hass)

        if not identifier:
            return await self._browse_root()
        if identifier == "shows":
            return await self._browse_shows(session)
        if identifier.startswith("series/"):
            series_id = identifier.split("/", 1)[1]
            return await self._browse_series(session, series_id)
        if identifier.startswith("season/"):
            parts = identifier.split("/")
            series_id = parts[1]
            season_num = int(parts[2])
            return await self._browse_season(session, series_id, season_num)
        if identifier.startswith("channel/"):
            channel_id = identifier.split("/", 1)[1]
            ch = NRK_CHANNELS.get(channel_id, {})
            return BrowseMediaSource(
                domain=DOMAIN,
                identifier=identifier,
                media_class=MediaClass.CHANNEL,
                media_content_type=MediaType.VIDEO,
                title=ch.get("name", channel_id),
                can_play=True,
                can_expand=False,
                thumbnail=CHANNEL_ICONS.get(channel_id),
            )

        raise Unresolvable(f"Unknown identifier: {identifier}")

    async def _browse_root(self) -> BrowseMediaSource:
        """Root: show live channels + children's shows entry."""
        children = []

        # Live channels
        for ch_id, ch in NRK_CHANNELS.items():
            children.append(
                BrowseMediaSource(
                    domain=DOMAIN,
                    identifier=f"channel/{ch_id}",
                    media_class=MediaClass.CHANNEL,
                    media_content_type=MediaType.VIDEO,
                    title=ch["name"],
                    can_play=True,
                    can_expand=False,
                    thumbnail=CHANNEL_ICONS.get(ch_id),
                )
            )

        # Children's shows folder
        children.append(
            BrowseMediaSource(
                domain=DOMAIN,
                identifier="shows",
                media_class=MediaClass.DIRECTORY,
                media_content_type=MediaType.VIDEO,
                title="📺 Barneprogram",
                can_play=False,
                can_expand=True,
            )
        )

        return BrowseMediaSource(
            domain=DOMAIN,
            identifier=None,
            media_class=MediaClass.DIRECTORY,
            media_content_type=MediaType.VIDEO,
            title="NRK TV",
            can_play=False,
            can_expand=True,
            children=children,
        )

    async def _browse_shows(
        self, session: aiohttp.ClientSession
    ) -> BrowseMediaSource:
        """Browse children's shows from NRK Super."""
        shows = await get_children_shows(session)

        children = [
            BrowseMediaSource(
                domain=DOMAIN,
                identifier=f"series/{show.series_id}",
                media_class=MediaClass.TV_SHOW,
                media_content_type=MediaType.TVSHOW,
                title=show.title,
                can_play=False,
                can_expand=True,
                thumbnail=show.image_url or None,
            )
            for show in shows
        ]

        return BrowseMediaSource(
            domain=DOMAIN,
            identifier="shows",
            media_class=MediaClass.DIRECTORY,
            media_content_type=MediaType.VIDEO,
            title="Barneprogram",
            can_play=False,
            can_expand=True,
            children=children,
        )

    async def _browse_series(
        self, session: aiohttp.ClientSession, series_id: str
    ) -> BrowseMediaSource:
        """Browse seasons of a series."""
        series_title, seasons = await get_series_seasons(session, series_id)

        if len(seasons) == 1:
            # Skip season level if only one season
            return await self._browse_season(
                session, series_id, seasons[0].season_number
            )

        children = [
            BrowseMediaSource(
                domain=DOMAIN,
                identifier=f"season/{series_id}/{s.season_number}",
                media_class=MediaClass.SEASON,
                media_content_type=MediaType.TVSHOW,
                title=s.title,
                can_play=False,
                can_expand=True,
                thumbnail=s.image_url or None,
            )
            for s in seasons
        ]

        return BrowseMediaSource(
            domain=DOMAIN,
            identifier=f"series/{series_id}",
            media_class=MediaClass.TV_SHOW,
            media_content_type=MediaType.TVSHOW,
            title=series_title,
            can_play=False,
            can_expand=True,
            children=children,
        )

    async def _browse_season(
        self, session: aiohttp.ClientSession, series_id: str, season_number: int
    ) -> BrowseMediaSource:
        """Browse episodes of a season."""
        episodes = await get_season_episodes(session, series_id, season_number)

        children = [
            BrowseMediaSource(
                domain=DOMAIN,
                identifier=f"episode/{ep.prf_id}",
                media_class=MediaClass.EPISODE,
                media_content_type=MediaType.EPISODE,
                title=ep.title,
                can_play=True,
                can_expand=False,
                thumbnail=ep.image_url or None,
            )
            for ep in episodes
        ]

        return BrowseMediaSource(
            domain=DOMAIN,
            identifier=f"season/{series_id}/{season_number}",
            media_class=MediaClass.SEASON,
            media_content_type=MediaType.TVSHOW,
            title=f"Sesong {season_number}",
            can_play=False,
            can_expand=True,
            children=children,
        )
