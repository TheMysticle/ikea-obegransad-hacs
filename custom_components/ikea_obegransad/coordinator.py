from __future__ import annotations

import asyncio
import json
import logging
from typing import Any, Callable

import aiohttp
import async_timeout

from homeassistant.core import HomeAssistant
from homeassistant.helpers.aiohttp_client import async_get_clientsession

from .const import DOMAIN

_LOGGER = logging.getLogger(__name__)

RECONNECT_INTERVAL = 5  # seconds between reconnect attempts


class IkeaObegransadCoordinator:
    """Manages the WebSocket connection and state for the lamp."""

    def __init__(self, hass: HomeAssistant, host: str) -> None:
        self.hass = hass
        self.host = host
        self.data: dict[str, Any] = {}
        self.plugins: list[dict] = []
        self._listeners: list[Callable] = []
        self._ws_task: asyncio.Task | None = None
        self._running = False

    @property
    def available(self) -> bool:
        return bool(self.data)

    def async_add_listener(self, callback: Callable) -> Callable:
        """Register a listener to be called on state update."""
        self._listeners.append(callback)

        def remove():
            self._listeners.remove(callback)

        return remove

    def _notify_listeners(self) -> None:
        for callback in self._listeners:
            callback()

    async def async_start(self) -> None:
        """Fetch initial info then start the WebSocket listener."""
        await self._fetch_initial_info()
        self._running = True
        self._ws_task = self.hass.loop.create_task(self._ws_loop())

    async def async_stop(self) -> None:
        """Stop the WebSocket listener."""
        self._running = False
        if self._ws_task:
            self._ws_task.cancel()

    async def _fetch_initial_info(self) -> None:
        """Fetch /api/info to get plugin list (names + IDs)."""
        session = async_get_clientsession(self.hass)
        try:
            async with async_timeout.timeout(10):
                resp = await session.get(f"http://{self.host}/api/info")
                info = await resp.json(content_type=None)
                self.plugins = info.get("plugins", [])
                # Seed initial state from REST before WS connects
                self.data = {
                    "brightness": info.get("brightness", 0),
                    "plugin": info.get("plugin", 0),
                    "status": info.get("status", "unknown"),
                    "scheduleActive": info.get("scheduleActive", False),
                }
                _LOGGER.debug("Initial info fetched: %s", self.data)
        except Exception as err:
            _LOGGER.error("Failed to fetch initial info from %s: %s", self.host, err)

    async def _ws_loop(self) -> None:
        """Maintain a persistent WebSocket connection, reconnecting on failure."""
        import websockets

        uri = f"ws://{self.host}/ws"

        while self._running:
            try:
                _LOGGER.debug("Connecting to WebSocket at %s", uri)
                async with websockets.connect(uri, ping_interval=20, ping_timeout=10) as ws:
                    _LOGGER.info("WebSocket connected to IKEA OBEGRÄNSAD at %s", self.host)
                    async for raw in ws:
                        try:
                            msg = json.loads(raw)
                            event = msg.get("event", "")

                            # Both "info" and "minimal-info" carry the state we care about
                            if event in ("info", "minimal-info"):
                                self.data = {
                                    "brightness": msg.get("brightness", self.data.get("brightness", 0)),
                                    "plugin": msg.get("plugin", self.data.get("plugin", 0)),
                                    "status": msg.get("status", self.data.get("status", "unknown")),
                                    "scheduleActive": msg.get("scheduleActive", self.data.get("scheduleActive", False)),
                                }
                                # If full info, also refresh plugin list
                                if event == "info" and "plugins" in msg:
                                    self.plugins = msg["plugins"]

                                _LOGGER.debug("State updated via WS: %s", self.data)
                                self._notify_listeners()

                        except json.JSONDecodeError:
                            _LOGGER.warning("Received non-JSON WebSocket message")

            except Exception as err:
                if self._running:
                    _LOGGER.warning(
                        "WebSocket disconnected from %s (%s), reconnecting in %ds",
                        self.host, err, RECONNECT_INTERVAL,
                    )
                    await asyncio.sleep(RECONNECT_INTERVAL)

    # --- REST command helpers ---

    async def async_set_brightness(self, brightness: int) -> None:
        await self._patch(f"/api/brightness?value={brightness}")

    async def async_set_plugin(self, plugin_id: int) -> None:
        await self._patch(f"/api/plugin?id={plugin_id}")

    async def async_send_message(self, text: str, repeat: int = -1, delay: int = 50) -> None:
        from urllib.parse import quote
        encoded = quote(text)
        await self._get(f"/api/message?text={encoded}&repeat={repeat}&delay={delay}")

    async def async_clear_message(self, msg_id: int = 0) -> None:
        await self._get(f"/api/removemessage?id={msg_id}")

    async def _patch(self, path: str) -> None:
        session = async_get_clientsession(self.hass)
        try:
            async with async_timeout.timeout(5):
                await session.patch(f"http://{self.host}{path}")
        except Exception as err:
            _LOGGER.error("PATCH %s failed: %s", path, err)

    async def _get(self, path: str) -> None:
        session = async_get_clientsession(self.hass)
        try:
            async with async_timeout.timeout(5):
                await session.get(f"http://{self.host}{path}")
        except Exception as err:
            _LOGGER.error("GET %s failed: %s", path, err)