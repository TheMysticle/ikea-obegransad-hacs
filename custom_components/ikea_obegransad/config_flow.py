from __future__ import annotations

import aiohttp
import async_timeout
import voluptuous as vol

from homeassistant import config_entries
from homeassistant.helpers.aiohttp_client import async_get_clientsession

from .const import DOMAIN, CONF_HOST


class IkeaObegransadConfigFlow(config_entries.ConfigFlow, domain=DOMAIN):
    VERSION = 1

    async def async_step_user(self, user_input=None):
        errors = {}

        if user_input is not None:
            host = user_input[CONF_HOST].strip().rstrip("/")
            try:
                session = async_get_clientsession(self.hass)
                async with async_timeout.timeout(5):
                    resp = await session.get(f"http://{host}/api/info")
                    if resp.status == 200:
                        await self.async_set_unique_id(host)
                        self._abort_if_unique_id_configured()
                        return self.async_create_entry(
                            title=f"IKEA OBEGRÄNSAD ({host})",
                            data={CONF_HOST: host},
                        )
                    else:
                        errors["base"] = "cannot_connect"
            except aiohttp.ClientError:
                errors["base"] = "cannot_connect"
            except Exception:
                errors["base"] = "unknown"

        return self.async_show_form(
            step_id="user",
            data_schema=vol.Schema({
                vol.Required(CONF_HOST, default="192.168.1.200"): str,
            }),
            errors=errors,
        )