from __future__ import annotations

from homeassistant.components.light import LightEntity, ColorMode, ATTR_BRIGHTNESS
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from .const import DOMAIN
from .coordinator import IkeaObegransadCoordinator


async def async_setup_entry(
    hass: HomeAssistant, entry: ConfigEntry, async_add_entities: AddEntitiesCallback
) -> None:
    coordinator: IkeaObegransadCoordinator = hass.data[DOMAIN][entry.entry_id]
    async_add_entities([IkeaObegransadLight(coordinator, entry)])


class IkeaObegransadLight(LightEntity):
    _attr_color_mode = ColorMode.BRIGHTNESS
    _attr_supported_color_modes = {ColorMode.BRIGHTNESS}
    _attr_has_entity_name = True
    _attr_name = None  # Uses device name

    def __init__(self, coordinator: IkeaObegransadCoordinator, entry: ConfigEntry) -> None:
        self._coordinator = coordinator
        self._attr_unique_id = f"{entry.entry_id}_light"
        self._attr_device_info = {
            "identifiers": {(DOMAIN, entry.entry_id)},
            "name": "IKEA OBEGRÄNSAD",
            "manufacturer": "IKEA",
            "model": "OBEGRÄNSAD",
        }

    async def async_added_to_hass(self) -> None:
        self.async_on_remove(
            self._coordinator.async_add_listener(self.async_write_ha_state)
        )

    @property
    def available(self) -> bool:
        return self._coordinator.available

    @property
    def is_on(self) -> bool:
        return self._coordinator.data.get("power", False)

    @property
    def brightness(self) -> int:
        return self._coordinator.data.get("brightness", 0)

    async def async_turn_on(self, **kwargs) -> None:
        if ATTR_BRIGHTNESS in kwargs:
            brightness = kwargs[ATTR_BRIGHTNESS]
            await self._coordinator.async_set_brightness(brightness)
        else:
            await self._coordinator.async_set_power(True)

    async def async_turn_off(self, **kwargs) -> None:
        await self._coordinator.async_set_power(False)