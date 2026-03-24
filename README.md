# PiCAN Studio

A web-based CAN bus analyzer and transmitter for Raspberry Pi 3 B+ — a CANoe-like tool accessible from any browser on the same network.

![PiCAN Studio](https://img.shields.io/badge/platform-Raspberry%20Pi%203B%2B-red) ![Python](https://img.shields.io/badge/python-3.11%2B-blue) ![License](https://img.shields.io/badge/license-AGPL--3.0--or--later-blue)

## Features

- **Real-time bus monitor** — virtual-scrolling trace table handles 10,000+ messages at 60fps
- **Message transmission** — one-shot, periodic, and burst modes; 19 built-in templates (OBD-II, UDS, CANopen, J1939)
- **DBC signal decoding** — upload DBC files, see decoded signal names and values inline in the trace
- **Signal graphing** — real-time Chart.js time-series for up to 6 signals simultaneously
- **Multi-format logging** — record to ASC (Vector-compatible), CSV, or BLF; auto-rotate at configurable size
- **CAN-FD support** — receives and transmits both classic CAN 2.0 and CAN-FD frames
- **Bus statistics** — bus load %, msg/s, TEC/REC error counters, bus state (ERROR-ACTIVE / BUS-OFF)
- **Dark / light theme** — switchable from Settings tab
- **No build step** — frontend is plain ES modules loaded from CDN (Preact + HTM + Chart.js)

## Hardware

| Component | Details |
|---|---|
| Raspberry Pi | 3 Model B+ (1 GB RAM, Cortex-A53 @ 1.4 GHz) |
| CAN controller | MCP2518FD (CAN-FD, via SPI0) |
| CAN transceiver | ATA6563 (on the same module) |
| Recommended module | Soldered Electronics MCP2518FD breakout |

### Wiring (MCP2518FD → Raspberry Pi GPIO)

| Module pin | Pi GPIO | Pi header pin |
|---|---|---|
| SCK | GPIO11 (SPI0 CLK) | 23 |
| SDI / MOSI | GPIO10 (SPI0 MOSI) | 19 |
| SDO / MISO | GPIO9 (SPI0 MISO) | 21 |
| NCS / CS | GPIO8 (SPI0 CE0) | 24 |
| INT | GPIO25 | 22 |
| GND | GND | 6 |
| **VCC** | **5V** | **2 or 4** |

> **Important:** Connect VCC to the Pi's **5V pin** (pin 2 or 4), not 3.3V. The ATA6563 transceiver requires 4.5–5.5V. Connecting to 3.3V will power the SPI controller (so `can0` appears) but the transceiver will be non-functional — no frames will be sent or received.

### CAN Bus Wiring

- Connect **CANH** and **CANL** from the ATA6563 to the CAN bus
- Place **120Ω termination resistors** at both physical ends of the bus
- Ensure a **common GND** between all nodes on the bus
- Maximum bitrate supported: 8 Mbit/s (CAN-FD data phase)

## Installation

### Fresh Raspberry Pi

```bash
# 1. Clone or copy the project onto the Pi
git clone <repo-url> pican
cd pican

# 2. Run the setup script as root
sudo bash setup.sh

# 3. Reboot to activate the SPI overlay
sudo reboot
```

`setup.sh` performs the following automatically:
- Installs system packages: `can-utils python3-venv python3-dev python3-pip`
- Creates Python venv at `/opt/pican-studio/venv/` and installs Python dependencies
- Copies all files to `/opt/pican-studio/`
- Adds to `/boot/firmware/config.txt`:
  ```
  dtparam=spi=on
  dtoverlay=mcp251xfd,spi0-0,oscillator=40000000,interrupt=25
  dtparam=spidev.bufsiz=65536
  gpu_mem=16
  ```
- Installs and enables the `pican-studio` systemd service

After reboot the service starts automatically. Open `http://<pi-ip>:8080` in a browser.

### Deploy updates from dev machine

```bash
# MCP2518FD Pi (Pi 3B+, SPI adapter)
./deploy.sh -mcp -target pi@192.168.1.100

# CandleLight USB adapter (Pi 4, gs_usb)
./deploy.sh -candlelight -target pi@192.168.1.101

# Sync only, do not restart service
./deploy.sh -mcp -target pi@192.168.1.100 --no-restart
```

`deploy.sh` rsyncs source files to the Pi (excluding logs, runtime config, and compiled files) and restarts the service. The `-target` argument is required; `-mcp` or `-candlelight` selects the hardware profile (currently informational — both deploy the same files).

### First-time setup: CandleLight USB adapter

On the Pi, run setup with the `--adapter=candlelight` flag to skip the MCP2518FD SPI overlay:

```bash
sudo bash setup.sh --adapter=candlelight
sudo systemctl start pican-studio
```

No reboot is required. Plug in the CandleLight adapter, then configure the interface from the Settings tab. If the adapter is not plugged in when the service starts, `setup-can.sh` waits up to 10 seconds; if still absent it exits gracefully and the app starts in simulation mode.

## Service Management

```bash
sudo systemctl start pican-studio      # Start
sudo systemctl stop pican-studio       # Stop
sudo systemctl restart pican-studio    # Restart
sudo systemctl status pican-studio     # Status
journalctl -u pican-studio -f          # Live logs
```

## Development (without hardware)

Test with a virtual CAN interface on any Linux machine or on the Pi itself:

```bash
sudo modprobe vcan
sudo ip link add dev vcan0 type vcan
sudo ip link set up vcan0

# Generate test traffic
cangen vcan0 -g 10 -I 100:200 -D i -L 8
```

Point the app at `vcan0` from the Settings tab. If `python-can` is not installed, the app automatically starts in simulation mode with synthetic frames.

## Configuration

Settings are stored in `/opt/pican-studio/config/runtime.json` (auto-saved every 60s). All options are editable from the Settings tab in the UI.

| Key | Default | Description |
|---|---|---|
| `interface` | `can0` | SocketCAN interface name |
| `mode` | `normal` | Operating mode: `normal`, `listen-only`, `loopback` |
| `fd_enabled` | `false` | Enable CAN-FD |
| `bitrate` | `500000` | Arbitration bitrate (bits/s) |
| `dbitrate` | `2000000` | CAN-FD data bitrate (bits/s) |
| `buffer_size` | `10000` | Max messages kept in trace table |
| `auto_scroll` | `true` | Auto-scroll trace on new messages |
| `timestamp_format` | `relative` | `relative` or `absolute` |
| `hex_uppercase` | `true` | Uppercase hex in trace |
| `theme` | `dark` | UI theme: `dark` or `light` |
| `ws_interval_ms` | `50` | WebSocket batch flush interval |
| `graph_hz` | `10` | Signal graph update rate |
| `log_dir` | `/opt/pican-studio/logs` | Log output directory |
| `log_max_size_mb` | `50` | Max log file size before rotation |

## TX Message Templates

The Transmit tab includes 19 built-in presets:

**OBD-II** (ID `0x7DF`): RPM Request, Vehicle Speed, Coolant Temp, Supported PIDs

**UDS Diagnostics** (ID `0x7DF`): Default Session, Extended Session, Tester Present, ECU Reset Hard, Read DTCs, Clear DTCs

**CANopen NMT**: Start, Stop, Pre-Operational, Reset Node, SYNC

**J1939**: Request Engine Speed (extended ID `0x18E0023E`)

**General**: Custom Empty, All-Ones Test, Incrementing Data (periodic)

## REST API

All endpoints return JSON. Base URL: `http://<pi-ip>:8080`

### Config
| Method | Path | Description |
|---|---|---|
| `GET` | `/api/config` | Get all settings |
| `PUT` | `/api/config` | Update settings |
| `POST` | `/api/config/reset` | Reset to defaults |
| `GET` | `/api/config/timing` | Calculate CAN timing parameters |

### CAN Interface
| Method | Path | Description |
|---|---|---|
| `POST` | `/api/can/start` | Start capture |
| `POST` | `/api/can/stop` | Stop capture |
| `POST` | `/api/can/restart` | Restart with current config |
| `GET` | `/api/can/status` | Interface status |
| `GET` | `/api/can/interfaces` | List available CAN interfaces |

### TX Messages
| Method | Path | Description |
|---|---|---|
| `GET` | `/api/tx/messages` | List all TX messages |
| `POST` | `/api/tx/messages` | Create message |
| `PUT` | `/api/tx/messages/{id}` | Update message |
| `DELETE` | `/api/tx/messages/{id}` | Delete message |
| `POST` | `/api/tx/messages/{id}/send` | Send once |
| `POST` | `/api/tx/messages/{id}/start` | Start periodic/burst |
| `POST` | `/api/tx/messages/{id}/stop` | Stop |
| `POST` | `/api/tx/start-all` | Start all enabled messages |
| `POST` | `/api/tx/stop-all` | Stop all |
| `GET` | `/api/tx/templates` | List built-in templates |
| `POST` | `/api/tx/import` | Import JSON |
| `GET` | `/api/tx/export` | Export JSON |

### Logging
| Method | Path | Description |
|---|---|---|
| `POST` | `/api/log/start` | Start recording (`format`: asc/csv/blf) |
| `POST` | `/api/log/stop` | Stop recording |
| `GET` | `/api/log/status` | Recording status |
| `GET` | `/api/log/files` | List log files |
| `GET` | `/api/log/files/{filename}` | Download log file |
| `DELETE` | `/api/log/files/{filename}` | Delete log file |
| `GET` | `/api/log/storage` | Storage usage |

### DBC
| Method | Path | Description |
|---|---|---|
| `POST` | `/api/dbc/upload` | Upload DBC file |
| `GET` | `/api/dbc/files` | List loaded DBCs |
| `DELETE` | `/api/dbc/files/{id}` | Unload DBC |
| `GET` | `/api/dbc/messages` | All messages from loaded DBCs |
| `GET` | `/api/dbc/messages/{id}/signals` | Signals for a message |
| `GET` | `/api/dbc/search?q=` | Search messages/signals |
| `POST` | `/api/dbc/encode` | Encode signal values to bytes |

### Signals
| Method | Path | Description |
|---|---|---|
| `GET` | `/api/signals/latest` | Latest decoded signal values |
| `GET` | `/api/signals/history` | Signal history (`?signal=&window=`) |
| `GET` | `/api/signals/stats` | Signal statistics (`?signal=`) |

### WebSocket

Connect to `ws://<pi-ip>:8080/ws`. Messages use compact JSON with short keys to minimise bandwidth.

**Server → client:**
```json
{ "t": "msg", "d": [{ "n": 42, "ts": 1.234, "id": "1A3", "dir": "rx", "ide": 0, "fdf": 0, "brs": 0, "dlc": 8, "data": "0102030405060708", "s": "ok" }] }
{ "t": "stat", "d": { "rx_rate": 120, "tx_rate": 5, "load": 12.3, "tec": 0, "rec": 0, "state": "ERROR-ACTIVE" } }
{ "t": "err",  "m": "Error message string" }
{ "t": "tx_status", "id": "abc123", "s": "sent", "count": 7 }
```

**Client → server:**
```json
{ "t": "cmd", "a": "clear_trace" }
{ "t": "cmd", "a": "set_filter", "d": {} }
```

## Architecture

```
Browser → HTTP GET /       → static SPA (index.html + ES modules)
        → WS  /ws          → CAN message batches (50ms), stats, signals
        → REST /api/*      → config, TX, logging, DBC commands

aiohttp (port 8080)
  ├── can_interface.py     python-can SocketCAN, fd=True, executor-based RX
  ├── tx_scheduler.py      one-shot / periodic / burst TX queue
  ├── ws_manager.py        50ms batch broadcaster → all WS clients
  ├── statistics.py        bus load %, msg/s rates, TEC/REC counters
  ├── signal_tracker.py    timestamped signal value history
  ├── log_writer.py        ASC / CSV / BLF async writing, auto-rotation
  ├── dbc_handler.py       cantools DBC parse, decode, encode, search
  ├── config_manager.py    JSON config, validation, 60s auto-save
  ├── interface_manager.py ip link subprocess wrapper
  ├── api_routes.py        all REST endpoints
  └── app.py               aiohttp wiring, startup/shutdown lifecycle

static/
  ├── index.html           SPA shell (CDN: Preact, HTM, Chart.js, JetBrains Mono)
  ├── js/app.js            root component, tab router, WS setup, global state
  ├── js/ws.js             WebSocket client, auto-reconnect with backoff
  ├── js/components/       one file per tab + trace-table, tx-editor
  └── js/utils/            formatters, CAN constants, 16-color palette
```

## Performance

Measured on Raspberry Pi 3 B+:

| Metric | Target |
|---|---|
| Sustained throughput | 5,000+ msg/s |
| Frontend render | 60fps (virtual scrolling, ~60 DOM rows) |
| Signal decode latency | < 5ms per 50ms batch at full bus load |
| Memory (RSS) | < 200MB |
| Cold start | < 15s |

## Project Structure

```
pican/
├── server/               Python backend
│   ├── app.py
│   ├── api_routes.py
│   ├── can_interface.py
│   ├── ws_manager.py
│   ├── tx_scheduler.py
│   ├── statistics.py
│   ├── dbc_handler.py
│   ├── signal_tracker.py
│   ├── log_writer.py
│   ├── config_manager.py
│   └── interface_manager.py
├── static/               Frontend (no build step)
│   ├── index.html
│   ├── css/
│   └── js/
├── scripts/
│   └── setup-can.sh      CAN interface init (called by systemd ExecStartPre)
├── config/
│   └── default.json      Default configuration
├── sample-data/
│   ├── example.dbc       Test DBC with EngineData/TransmissionData/BrakeData
│   └── tx-presets.json   Built-in TX message templates
├── pican-studio.service  systemd unit file
├── setup.sh              One-shot Pi installation script
├── deploy.sh             Dev-machine → Pi rsync deploy script
└── requirements.txt      Python dependencies
```

## Troubleshooting

**`can0` does not appear after boot**
- Verify the MCP2518FD wiring (SCK/MOSI/MISO/CS/INT)
- Check that `setup.sh` was run and the Pi was rebooted
- Inspect: `dmesg | grep -i mcp` or `dmesg | grep -i can`

**No frames received (interface stays silent)**
- Confirm VCC is connected to **5V**, not 3.3V
- Check that CANH/CANL are correctly wired (not swapped)
- Verify 120Ω termination at both ends of the bus
- Confirm all nodes share a common GND
- Check bitrates match across all nodes: `ip -d link show can0`

**Interface enters BUS-OFF**
- `restart-ms 100` is set by default — the interface recovers automatically
- If persistent, check for bus wiring faults or bitrate mismatch

**TX frames not appearing in Monitor tab**
- Start capture (▶ Start) before transmitting — the CAN bus must be open

**Browser shows stale UI after update**
- Hard refresh: `Ctrl+Shift+R` (Windows/Linux) or `Cmd+Shift+R` (Mac)
