from __future__ import annotations

import os

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, CoreState, EVENT_HOMEASSISTANT_STARTED
from homeassistant.components.http import StaticPathConfig
from homeassistant.helpers.event import async_call_later
import logging

from .const import DOMAIN, CONF_HOST
from .coordinator import IkeaObegransadCoordinator

_LOGGER = logging.getLogger(__name__)

PLATFORMS = ["light", "select", "text", "button"]

_URL_BASE = "/ikea_obegransad/www"
_JS_MODULES = ["ikea-obegransad-card.js"]


async def async_setup(hass: HomeAssistant, config: dict) -> bool:
    """Register the bundled Lovelace card as a static resource."""
    www_dir = os.path.dirname(__file__) + "/www"

    # 1. Serve the JS file over HTTP (non-blocking, safe on event loop)
    try:
        await hass.http.async_register_static_paths([
            StaticPathConfig(f"{_URL_BASE}/{f}", f"{www_dir}/{f}", False)
            for f in _JS_MODULES
            if os.path.isfile(f"{www_dir}/{f}")
        ])
    except RuntimeError:
        pass  # Already registered on a previous reload

    # 2. Register as a Lovelace module resource after HA has fully started,
    #    so hass.data["lovelace"] is guaranteed to be populated.
    async def _register_lovelace_resources(_event=None):
        lovelace = hass.data.get("lovelace")
        if lovelace is None:
            _LOGGER.warning(
                "ikea_obegransad: hass.data['lovelace'] not found — "
                "add %s manually in Settings → Dashboards → Resources",
                _JS_MODULES,
            )
            return

        if getattr(lovelace, "mode", "storage") == "yaml":
            _LOGGER.debug("ikea_obegransad: lovelace yaml mode, skipping auto resource registration")
            return

        async def _wait_and_register(_now=None):
            resources = lovelace.resources
            if not resources.loaded:
                _LOGGER.debug("ikea_obegransad: lovelace resources not ready, retrying in 5s")
                async_call_later(hass, 5, _wait_and_register)
                return

            existing_urls = {r["url"].split("?")[0] for r in resources.async_items()}
            for f in _JS_MODULES:
                url = f"{_URL_BASE}/{f}"
                if url not in existing_urls:
                    _LOGGER.info("ikea_obegransad: registering Lovelace resource %s", url)
                    await resources.async_create_item({"res_type": "module", "url": f"{url}?v=1"})
                else:
                    _LOGGER.debug("ikea_obegransad: Lovelace resource already registered: %s", url)

        await _wait_and_register()

    hass.bus.async_listen_once(EVENT_HOMEASSISTANT_STARTED, _register_lovelace_resources)
    return True


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    host = entry.data[CONF_HOST]
    coordinator = IkeaObegransadCoordinator(hass, host)
    await coordinator.async_start()

    hass.data.setdefault(DOMAIN, {})[entry.entry_id] = coordinator

    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    coordinator: IkeaObegransadCoordinator = hass.data[DOMAIN][entry.entry_id]
    await coordinator.async_stop()

    unload_ok = await hass.config_entries.async_unload_platforms(entry, PLATFORMS)
    if unload_ok:
        hass.data[DOMAIN].pop(entry.entry_id)
    return unload_ok
