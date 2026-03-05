# NRK TV for Home Assistant

[![hacs_badge](https://img.shields.io/badge/HACS-Custom-41BDF5.svg)](https://github.com/hacs/integration)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

Stream live NRK TV and radio channels and browse on-demand content from [tv.nrk.no](https://tv.nrk.no) directly in Home Assistant.

![NRK TV Card](images/screenshot.png)

## Features

- **Live TV channels** — NRK1, NRK2, NRK3, NRK Super
- **Live radio** — NRK P3 Musikk
- **Media browser integration** — browse and play content from Home Assistant's built-in media browser
- **On-demand children's content** — browse NRK Super shows, seasons, and episodes
- **WebSocket API** — powers custom Lovelace cards with real-time content browsing
- **Services for automations** — `play_channel` and `resolve_stream` services for use in scripts and automations
- **Bundled custom Lovelace card** — includes `nrk-tv-card` with profile switching support (also available separately at [github.com/filipferris/ha-nrk-tv-card](https://github.com/filipferris/ha-nrk-tv-card))

> **Note:** NRK streams are geo-blocked to Norway.

## Installation

### HACS (recommended)

1. Open HACS in Home Assistant
2. Go to **Integrations** → **⋮** (top-right menu) → **Custom repositories**
3. Add `https://github.com/filipferris/ha-nrk-tv` as an **Integration**
4. Search for "NRK TV" and install
5. Restart Home Assistant

### Manual

1. Copy the `custom_components/nrk_tv` folder to your Home Assistant `config/custom_components/` directory
2. Restart Home Assistant

## Configuration

### Basic setup (no account required)

1. Go to **Settings** → **Devices & Services** → **Add Integration**
2. Search for **NRK TV**
3. Select **Without account** — all streaming and browsing works immediately

### With NRK account (personalized profiles)

Optionally sign in with your NRK account to auto-discover family profiles (adults/children). This enables profile switching in the NRK TV card.

1. Install and run [**nrk-token-helper**](https://github.com/filipferris/nrk-token-helper):
   ```bash
   git clone https://github.com/filipferris/nrk-token-helper.git
   cd nrk-token-helper
   npm install
   npm start
   ```
2. A browser window opens to [tv.nrk.no](https://tv.nrk.no) — log in with your NRK account
3. After login, the tool outputs a JSON blob with your profiles:
   ```
   📋 Profiles found:
      👤 Parent (Adult)
      👶 Child 1 (Child)
      👶 Child 2 (Child)

   📋 Copy this JSON into your Home Assistant NRK TV config:
   { "user_id": "...", "session_cookie": "...", "profiles": [...] }
   ```
4. In Home Assistant, go to **Settings** → **Devices & Services** → **Add Integration** → **NRK TV**
5. Select **With NRK account**
6. Paste the JSON from the helper tool and submit

## Supported Channels

| Channel ID | Name           | Type  |
|------------|----------------|-------|
| `nrk1`     | NRK1           | Video |
| `nrk2`     | NRK2           | Video |
| `nrk3`     | NRK3           | Video |
| `nrksuper` | NRK Super      | Video |
| `p3musikk` | NRK P3 Musikk  | Audio |

## Services

### `nrk_tv.play_channel`

Resolves the live HLS stream URL for an NRK channel and plays it on a media player.

| Field        | Required | Description                                      |
|--------------|----------|--------------------------------------------------|
| `channel_id` | Yes      | Channel ID (`nrk1`, `nrk2`, `nrk3`, `nrksuper`) |
| `target`     | Yes      | Media player entity ID                           |

### `nrk_tv.resolve_stream`

Resolves the HLS stream URL for a live channel or on-demand program ID. Optionally plays it on a media player.

| Field        | Required | Description                                                         |
|--------------|----------|---------------------------------------------------------------------|
| `channel_id` | Yes      | Channel ID or on-demand program ID (e.g. `NNFA51000623`)           |
| `entity_id`  | No       | Media player entity to start playback on after resolving            |

## Media Source

The integration registers as a Home Assistant media source. You can use these identifiers:

- **Live channel:** `media-source://nrk_tv/channel/{id}` (e.g. `media-source://nrk_tv/channel/nrk1`)
- **On-demand episode:** `media-source://nrk_tv/episode/{prfId}` (e.g. `media-source://nrk_tv/episode/MSUB19001020`)

## Automation Examples

### Play NRK1 on the living room TV at 6 PM

```yaml
automation:
  - alias: "NRK1 evening news"
    trigger:
      - platform: time
        at: "18:00:00"
    action:
      - service: nrk_tv.play_channel
        data:
          channel_id: nrk1
          target: media_player.living_room_tv
```

### Play NRK Super in the kids' room

```yaml
automation:
  - alias: "NRK Super for the kids"
    trigger:
      - platform: state
        entity_id: binary_sensor.kids_room_motion
        to: "on"
    action:
      - service: nrk_tv.play_channel
        data:
          channel_id: nrksuper
          target: media_player.kids_room_tv
```

### Play a specific on-demand program

```yaml
script:
  play_nrk_program:
    sequence:
      - service: nrk_tv.resolve_stream
        data:
          channel_id: "MSUB19001020"
          entity_id: media_player.living_room_tv
```

## License

[MIT](LICENSE) — Copyright 2026 Filip Ferris
