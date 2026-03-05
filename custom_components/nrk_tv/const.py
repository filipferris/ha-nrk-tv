"""Constants for NRK TV integration."""

DOMAIN = "nrk_tv"

PSAPI_BASE = "https://psapi.nrk.no"
MANIFEST_URL = f"{PSAPI_BASE}/playback/manifest/channel/{{channel_id}}"
PROGRAM_MANIFEST_URL = f"{PSAPI_BASE}/playback/manifest/program/{{program_id}}"

NRK_CHANNELS = {
    "nrk1": {"name": "NRK1", "icon": "mdi:television"},
    "nrk2": {"name": "NRK2", "icon": "mdi:television"},
    "nrk3": {"name": "NRK3", "icon": "mdi:television"},
    "nrksuper": {"name": "NRK Super", "icon": "mdi:television"},
    "p3musikk": {"name": "NRK P3 Musikk", "icon": "mdi:radio", "type": "audio"},
}

CONF_CHANNELS = "channels"

# OAuth2 constants
NRK_CLIENT_ID = "tv.nrk.no.web2"
NRK_AUTHORIZE_URL = "https://innlogging.nrk.no/connect/authorize"
NRK_TOKEN_URL = "https://innlogging.nrk.no/connect/token"
NRK_USERINFO_URL = "https://innlogging.nrk.no/connect/userinfo"
NRK_PROFILE_SETTINGS_URL = "https://profilesettings.nrk.no/tv"
NRK_SCOPES = "openid profile psapi-userdata offline_access"
