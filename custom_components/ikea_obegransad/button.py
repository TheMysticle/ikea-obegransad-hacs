from __future__ import annotations

from homeassistant.components.button import ButtonEntity
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from .const import DOMAIN
from .coordinator import IkeaObegransadCoordinator


async def async_setup_entry(
    hass: HomeAssistant, entry: ConfigEntry, async_add_entities: AddEntitiesCallback
) -> None:
    coordinator: IkeaObegransadCoordinator = hass.data[DOMAIN][entry.entry_id]
    async_add_entities([IkeaObegransadClearMessageButton(coordinator, entry)])


class IkeaObegransadClearMessageButton(ButtonEntity):
    _attr_has_entity_name = True
    _attr_name = "Clear Scroll Text"
    _attr_icon = "mdi:message-off"

    def __init__(self, coordinator: IkeaObegransadCoordinator, entry: ConfigEntry) -> None:
        self._coordinator = coordinator
        self._attr_unique_id = f"{entry.entry_id}_clear_message"
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

    async def async_press(self) -> None:
        await self._coordinator.async_clear_message(0)