# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**PiCAN Studio** is a web-based CAN bus analyzer and transmitter — a CANoe-like tool for Raspberry Pi 3 B+ with an MCP2518FD CAN-FD controller via SPI. Accessible over LAN via HTTP. This project is currently in the **specification phase** — the full spec is in `PiCAN_Studio_Pi3B_Plus_Prompt.md`.

**Target hardware:** Raspberry Pi 3 B+, MCP2518FD + ATA6563 via SPI0 (INT on GPIO25), SocketCAN interface `can0`.

## Tech Stack

**Backend:** Python 3 + asyncio, aiohttp 3.9+, python-can 4.3+, cantools 39.0+, aiofiles 23.0+

**Frontend:** No build step — Preact + HTM loaded from CDN, Chart.js from CDN, plain JS modules.

**Deploy:** systemd service, Python venv at `/opt/pican-studio/venv/`, installed to `/opt/pican-studio/`.

## Commands

Once source code exists, these are the intended commands:

```bash
# Install dependencies (after cloning to Pi)
bash setup.sh

# Run in development (after activating venv)
source /opt/pican-studio/venv/bin/python
python -m server.app

# Manage systemd service
sudo systemctl start pican-studio
sudo systemctl stop pican-studio
sudo journalctl -u pican-studio -f

# Test without hardware (virtual CAN)
sudo modprobe vcan
sudo ip link add dev vcan0 type vcan
sudo ip link set up vcan0
cangen vcan0 -g 10 -I 100:200 -D i -L 8   # generate test traffic
candump vcan0
```

## Architecture

Single async Python process with an aiohttp HTTP/WebSocket server:

```
Browser → HTTP GET /          → static SPA (index.html + JS modules)
        → WS  /ws             → real-time message batches (every 50ms), stats, decoded signals
        → REST /api/*         → config, TX, logging, DBC commands

aiohttp server
  ├── can_interface.py        → python-can SocketCAN wrapper (always fd=True)
  ├── tx_scheduler.py         → one-shot / periodic / burst TX queue
  ├── ws_manager.py           → batches frames every 50ms, fans out to all WS clients
  ├── statistics.py           → bus load %, msg rates, TEC/REC counters
  ├── signal_tracker.py       → latest decoded signal values for graphing
  ├── log_writer.py           → ASC / CSV / BLF async file writing
  ├── dbc_handler.py          → cantools DBC parse & decode
  ├── config_manager.py       → JSON config persistence
  ├── interface_manager.py    → ip link subprocess calls
  ├── api_routes.py           → all REST endpoints
  └── app.py                  → aiohttp setup & route registration

static/
  ├── index.html              → SPA shell with CDN imports
  ├── js/app.js               → root Preact component & tab router
  ├── js/ws.js                → WebSocket client
  ├── js/components/          → one file per tab (monitor, transmit, signal-monitor, settings, logging, dbc-manager)
  └── js/utils/               → formatters, can-constants, color-palette
```

**Six UI tabs:** Bus Monitor (trace table), Transmit, Signal Monitor & Graphing, Settings, Logging, DBC Manager.

## Key Implementation Constraints

- **CAN interface reconfiguration** requires: `ip link set can0 down` → configure → `ip link set can0 up`.
- **python-can bus** must be created with `fd=True` to receive both classic and FD frames.
- **WebSocket protocol** uses compact JSON with short keys (`t`, `d`, `ts`, `id`, etc.) to minimize bandwidth.
- **Virtual scrolling** in the trace table: maintain 10,000-message JS array; only render ~60 visible rows in DOM (24px row height).
- **DBC decoding:** use `cantools.database.load_file()` and `db.decode_message()`. Use `ProcessPoolExecutor` only if profiling shows bottleneck above ~3000 msg/s.
- **ASC log format** must be Vector-compatible with microsecond precision.
- **CAN ID colors:** hash-based (ID modulo 16-color palette), defined in `js/utils/color-palette.js`.
- App must support `vcan0` as an interface for development without hardware.

## Performance Targets (Pi 3 B+)

- Sustain 5,000+ msg/s without drops.
- Frontend trace table at 60fps via virtual scrolling.
- DBC signal decoding < 5ms latency per 50ms batch at full bus load.
- Memory < 200MB RSS; cold start < 15 seconds.

## Configuration

- Default config: `config/default.json`
- Persisted interface settings: `config/interface.json`
- Logs directory: `/opt/pican-studio/logs/`
- Boot config additions (applied by `setup.sh`):
  ```
  dtparam=spi=on
  dtoverlay=mcp251xfd,spi0-0,oscillator=40000000,interrupt=25
  dtparam=spidev.bufsiz=65536
  ```

## Implementation Order

1. Backend core: CAN RX/TX, WebSocket streaming (`app.py`, `can_interface.py`, `ws_manager.py`)
2. Frontend: Bus Monitor tab (virtual scrolling trace table)
3. Frontend: Transmit tab
4. Frontend: Settings tab
5. Logging (backend + frontend)
6. DBC / Signal Monitor (backend + frontend)
7. Setup & deployment scripts
