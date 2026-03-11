from __future__ import annotations

from homeassistant.components.text import TextEntity
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from .const import DOMAIN
from .coordinator import IkeaObegransadCoordinator


async def async_setup_entry(
    hass: HomeAssistant, entry: ConfigEntry, async_add_entities: AddEntitiesCallback
) -> None:
    coordinator: IkeaObegransadCoordinator = hass.data[DOMAIN][entry.entry_id]
    async_add_entities([IkeaObegransadScrollText(coordinator, entry)])


class IkeaObegransadScrollText(TextEntity):
    _attr_has_entity_name = True
    _attr_name = "Scroll Text"
    _attr_icon = "mdi:message-text"
    _attr_native_min_length = 0
    _attr_native_max_length = 255
    _attr_native_value = ""

    def __init__(self, coordinator: IkeaObegransadCoordinator, entry: ConfigEntry) -> None:
        self._coordinator = coordinator
        self._attr_unique_id = f"{entry.entry_id}_scroll_text"
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

    async def async_set_value(self, value: str) -> None:
        self._attr_native_value = value
        self.async_write_ha_state()
        if value.strip():
            await self._coordinator.async_send_message(value, repeat=-1, delay=50)
        else:
            await self._coordinator.async_clear_message(0)