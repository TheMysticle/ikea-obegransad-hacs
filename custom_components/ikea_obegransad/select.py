from __future__ import annotations

from homeassistant.components.select import SelectEntity
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from .const import DOMAIN
from .coordinator import IkeaObegransadCoordinator


async def async_setup_entry(
    hass: HomeAssistant, entry: ConfigEntry, async_add_entities: AddEntitiesCallback
) -> None:
    coordinator: IkeaObegransadCoordinator = hass.data[DOMAIN][entry.entry_id]
    async_add_entities([IkeaObegransadPluginSelect(coordinator, entry)])


class IkeaObegransadPluginSelect(SelectEntity):
    _attr_has_entity_name = True
    _attr_name = "Active Display"
    _attr_icon = "mdi:led-strip-variant"

    def __init__(self, coordinator: IkeaObegransadCoordinator, entry: ConfigEntry) -> None:
        self._coordinator = coordinator
        self._attr_unique_id = f"{entry.entry_id}_plugin_select"
        self._attr_device_info = {
            "identifiers": {(DOMAIN, entry.entry_id)},
        }

    async def async_added_to_hass(self) -> None:
        self.async_on_remove(
            self._coordinator.async_add_listener(self.async_write_ha_state)
        )

    @property
    def available(self) -> bool:
        return self._coordinator.available

    @property
    def options(self) -> list[str]:
        return [p["name"] for p in self._coordinator.plugins]

    @property
    def current_option(self) -> str | None:
        active_id = self._coordinator.data.get("plugin")
        for p in self._coordinator.plugins:
            if p["id"] == active_id:
                return p["name"]
        return None

    async def async_select_option(self, option: str) -> None:
        # Don't re-set if already active — prevents reload on WS state push
        if option == self.current_option:
            return
        for p in self._coordinator.plugins:
            if p["name"] == option:
                await self._coordinator.async_set_plugin(p["id"])
                return