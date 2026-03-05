"""Config flow for NRK TV integration."""

from __future__ import annotations

import json
import logging
from typing import Any

import voluptuous as vol

from homeassistant.config_entries import ConfigFlow, ConfigFlowResult

from .const import DOMAIN

_LOGGER = logging.getLogger(__name__)

SETUP_METHOD_BASIC = "basic"
SETUP_METHOD_ACCOUNT = "account"

STEP_CHOOSE_SCHEMA = vol.Schema(
    {
        vol.Required("setup_method", default=SETUP_METHOD_BASIC): vol.In(
            {
                SETUP_METHOD_BASIC: "Without account (basic)",
                SETUP_METHOD_ACCOUNT: "With NRK account (personalized)",
            }
        ),
    }
)

STEP_TOKEN_SCHEMA = vol.Schema(
    {
        vol.Required("token_json"): str,
    }
)


class NrkTvConfigFlow(ConfigFlow, domain=DOMAIN):
    """Config flow for NRK TV."""

    VERSION = 1

    async def async_step_user(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        """Step 1: choose setup method."""
        if user_input is not None:
            if user_input["setup_method"] == SETUP_METHOD_ACCOUNT:
                return await self.async_step_token()

            # Basic setup — no auth
            return self.async_create_entry(
                title="NRK TV",
                data={},
            )

        return self.async_show_form(
            step_id="user",
            data_schema=STEP_CHOOSE_SCHEMA,
        )

    async def async_step_token(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        """Step 2: paste JSON token from nrk-token-helper."""
        errors: dict[str, str] = {}

        if user_input is not None:
            try:
                data = json.loads(user_input["token_json"])
            except (json.JSONDecodeError, TypeError):
                errors["base"] = "invalid_json"
            else:
                user_id = data.get("user_id")
                session_cookie = data.get("session_cookie")
                profiles = data.get("profiles", [])

                if not user_id or not session_cookie:
                    errors["base"] = "missing_fields"
                else:
                    await self.async_set_unique_id(user_id)
                    self._abort_if_unique_id_configured()

                    # Pick the first profile name for the title
                    user_name = profiles[0]["name"] if profiles else "User"

                    return self.async_create_entry(
                        title=f"NRK TV ({user_name})",
                        data={
                            "user_id": user_id,
                            "session_cookie": session_cookie,
                            "profiles": profiles,
                        },
                    )

        return self.async_show_form(
            step_id="token",
            data_schema=STEP_TOKEN_SCHEMA,
            errors=errors,
        )
