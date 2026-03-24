# SPDX-License-Identifier: AGPL-3.0-or-later
"""PiCAN Studio — aiohttp application entry point."""
import asyncio
import logging
import time
from pathlib import Path

from aiohttp import web

from server.config_manager import ConfigManager
from server.interface_manager import get_status
from server.can_interface import CANInterface
from server.statistics import Statistics
from server.ws_manager import WSManager
from server.tx_scheduler import TXScheduler
from server.dbc_handler import DBCHandler
from server.signal_tracker import SignalTracker
from server.log_writer import LogWriter
from server.api_routes import setup_routes

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)

BASE_DIR = Path(__file__).parent.parent
STATIC_DIR = BASE_DIR / "static"


async def on_startup(app: web.Application):
    """Initialize all subsystems on startup."""
    logger.info("PiCAN Studio starting up...")

    # Config
    cfg_mgr: ConfigManager = app["config"]
    cfg_mgr.load()
    cfg_mgr.start_auto_save()
    cfg = cfg_mgr.get()

    # Log writer
    app["log_writer"].configure(cfg["log_dir"], cfg["log_max_size_mb"])

    # Statistics
    stats: Statistics = app["stats"]
    stats.set_bitrate(cfg["bitrate"])

    # WebSocket manager
    ws: WSManager = app["ws"]
    ws.set_interval(cfg["ws_interval_ms"])
    ws.set_stats_callback(lambda: stats.get_snapshot(app["can_iface"].uptime()))
    ws.start()

    # Register WS command handlers
    async def handle_clear_trace(data):
        stats.reset()
        app["signal_tracker"].reset()

    async def handle_set_filter(data):
        pass  # filtering is client-side

    ws.register_cmd_handler("clear_trace", handle_clear_trace)
    ws.register_cmd_handler("set_filter", handle_set_filter)

    # TX scheduler
    tx: TXScheduler = app["tx"]
    tx.set_send_fn(app["can_iface"].send)
    tx.set_ws_manager(ws)

    # CAN RX callback
    async def on_rx(msg):
        ts = getattr(msg, "timestamp", time.time())
        is_tx = getattr(msg, "is_tx", False)

        if is_tx:
            stats.record_tx(len(msg.data), getattr(msg, "is_fd", False))
        else:
            stats.record_rx(msg)

        # DBC decode
        signals = app["dbc"].decode(msg.arbitration_id, bytes(msg.data))
        msg_name = app["dbc"].get_message_name(msg.arbitration_id) or ""

        if signals and not is_tx:
            app["signal_tracker"].record(signals, ts, msg_name)

        # Log
        if app["log_writer"]._active:
            app["log_writer"].write(msg)

        # Build compact WS message — ts relative to capture start (epoch-based)
        capture_epoch = app["can_iface"].capture_epoch or ts
        ws_msg = {
            "n": stats._rx_count,
            "ts": round(ts - capture_epoch, 6),
            "id": format(msg.arbitration_id, "X"),
            "dir": "tx" if is_tx else "rx",
            "ide": 1 if getattr(msg, "is_extended_id", False) else 0,
            "fdf": 1 if getattr(msg, "is_fd", False) else 0,
            "brs": 1 if getattr(msg, "bitrate_switch", False) else 0,
            "esi": 1 if getattr(msg, "error_state_indicator", False) else 0,
            "dlc": msg.dlc,
            "data": "".join(f"{b:02X}" for b in msg.data),
            "s": "error" if getattr(msg, "is_error_frame", False) else "ok",
        }
        if msg_name:
            ws_msg["name"] = msg_name
        if signals:
            ws_msg["signals"] = signals

        ws.push_message(ws_msg)

    app["can_iface"].set_rx_callback(on_rx)

    # Poll CAN interface status periodically for TEC/REC
    _busoff_notified = False

    async def poll_hw_status():
        nonlocal _busoff_notified
        while True:
            await asyncio.sleep(1)
            try:
                cfg = app["config"].get()
                hw = await get_status(cfg["interface"])
                stats.update_error_counters(
                    hw.get("tec", 0),
                    hw.get("rec", 0),
                    hw.get("bus_state", "unknown"),
                )
                # Detect and recover from BUS-OFF
                if hw.get("bus_state") == "BUS-OFF":
                    if not _busoff_notified:
                        await ws.send_error("CAN interface entered Bus-Off state — attempting recovery")
                        _busoff_notified = True
                        logger.warning("BUS-OFF detected on %s — restarting interface", cfg["interface"])
                    # Trigger kernel BUS-OFF recovery (down → up)
                    from server import interface_manager
                    iface = cfg["interface"]
                    if not iface.startswith("vcan"):
                        await interface_manager._run("ip", "link", "set", iface, "down")
                        await asyncio.sleep(0.5)
                        await interface_manager._run("ip", "link", "set", iface, "up")
                else:
                    _busoff_notified = False
            except Exception:
                pass

    asyncio.create_task(poll_hw_status())
    logger.info("PiCAN Studio ready — listening on http://0.0.0.0:8080")


async def on_shutdown(app: web.Application):
    """Cleanup on shutdown."""
    logger.info("Shutting down...")
    await app["can_iface"].stop()
    app["stats"].stop()
    app["ws"].stop()
    app["config"].stop_auto_save()
    if app["config"]._dirty:
        app["config"].save()
    if app["log_writer"]._active:
        await app["log_writer"].stop()
    logger.info("Shutdown complete")


def create_app() -> web.Application:
    app = web.Application()

    # Instantiate all subsystems
    app["config"] = ConfigManager()
    app["can_iface"] = CANInterface()
    app["stats"] = Statistics()
    app["ws"] = WSManager()
    app["tx"] = TXScheduler()
    app["dbc"] = DBCHandler()
    app["signal_tracker"] = SignalTracker()
    app["log_writer"] = LogWriter()

    # Lifecycle hooks
    app.on_startup.append(on_startup)
    app.on_shutdown.append(on_shutdown)

    # REST routes
    setup_routes(app)

    # WebSocket endpoint
    app.router.add_get("/ws", websocket_handler)

    # Serve index.html at root
    app.router.add_get("/", index_handler)

    # Static files (SPA)
    if STATIC_DIR.exists():
        app.router.add_static("/", STATIC_DIR, name="static", show_index=False)

    return app


async def index_handler(request: web.Request) -> web.FileResponse:
    return web.FileResponse(STATIC_DIR / "index.html")


async def websocket_handler(request: web.Request) -> web.WebSocketResponse:
    return await request.app["ws"].handle_connection(request)


def main():
    app = create_app()
    web.run_app(app, host="0.0.0.0", port=8080, access_log=None)


if __name__ == "__main__":
    main()
