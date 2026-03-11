# IKEA OBEGRÄNSAD — Home Assistant Integration

[![hacs_badge](https://img.shields.io/badge/HACS-Custom-orange.svg)](https://github.com/hacs/integration)
[![HA Version](https://img.shields.io/badge/HA-2023.12%2B-blue)](https://www.home-assistant.io/)

A Home Assistant custom integration for the **IKEA OBEGRÄNSAD** LED matrix lamp, with a bundled Lovelace card that gives you brightness, plugin switching, pixel drawing, and scrolling text all in one.

---

## Features

- **Light entity** — turn on/off and set brightness (0–255)
- **Select entity** — switch between lamp plugins (Clock, Game of Life, Draw, etc.)
- **Text entity** — send scrolling messages directly from HA
- **Button entity** — clear the current scrolling message
- **Bundled Lovelace card** — mushroom-style compact chip; hold to open a full detail sheet with brightness slider, plugin picker, pixel draw canvas, and scroll text sender. Includes a visual editor.
- **WebSocket push** — state updates are real-time, no polling

---

## Requirements

- Home Assistant 2023.12 or newer
- Your IKEA OBEGRÄNSAD lamp must be running firmware with the REST + WebSocket API (the open-source firmware from [TheMysticle/ikea-led-obegraensad](https://github.com/TheMysticle/ikea-led-obegraensad))
- The lamp must be reachable on your local network

---

## Installation

### Via HACS (recommended)

1. Open HACS → **Integrations** → ⋮ → **Custom repositories**
2. Add `https://github.com/TheMysticle/ikea-obegransad-hacs` with category **Integration**
3. Find **IKEA OBEGRÄNSAD** in the list and click **Download**
4. Restart Home Assistant

### Manual

1. Copy the `custom_components/ikea_obegransad` folder into your `config/custom_components/` directory
2. Restart Home Assistant

---

## Setup

1. Go to **Settings → Devices & Services → Add Integration**
2. Search for **IKEA OBEGRÄNSAD**
3. Enter the **IP address** of your lamp (e.g. `192.168.1.200`)
4. Click **Submit** — the integration will connect and create all entities

The bundled Lovelace card is registered automatically. After restart it will appear in the card picker as **IKEA OBEGRÄNSAD**.

---

## Lovelace Card

The card is bundled and auto-registered. Add it from the card picker or paste this YAML:

```yaml
type: custom:ikea-obegransad-card
host: 192.168.1.200
entity_light: light.ikea_obegransad
entity_select: select.ikea_obegransad_active_display
entity_text: text.ikea_obegransad_scroll_text
entity_button: button.ikea_obegransad_clear_scroll_text
```

**Tap** the card to toggle the lamp on/off. **Hold** to open the detail sheet.

---

## Lamp API

This integration talks to your lamp via:

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/info` | Fetch current state + plugin list |
| PATCH | `/api/brightness?value=N` | Set brightness |
| PATCH | `/api/plugin?id=N` | Switch plugin |
| GET | `/api/message?text=…&repeat=N&delay=N` | Send scroll text |
| GET | `/api/removemessage?id=0` | Clear scroll text |
| WS | `ws://IP/ws` | Real-time state push |

---

## Contributing

Pull requests welcome. Please open an issue first for large changes.

---

## License

MIT
