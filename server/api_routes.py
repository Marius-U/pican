# SPDX-License-Identifier: AGPL-3.0-or-later
"""All REST API endpoint handlers."""
import json
import logging
import os
import tempfile
from pathlib import Path

from aiohttp import web

logger = logging.getLogger(__name__)


def setup_routes(app: web.Application):
    r = app.router
    # Config
    r.add_get("/api/config", config_get)
    r.add_put("/api/config", config_put)
    r.add_post("/api/config/reset", config_reset)
    r.add_get("/api/config/timing", config_timing)
    # CAN interface
    r.add_post("/api/can/start", can_start)
    r.add_post("/api/can/stop", can_stop)
    r.add_get("/api/can/status", can_status)
    r.add_post("/api/can/restart", can_restart)
    r.add_get("/api/can/interfaces", can_interfaces)
    # TX
    r.add_get("/api/tx/messages", tx_list)
    r.add_post("/api/tx/messages", tx_add)
    r.add_put("/api/tx/messages/{id}", tx_update)
    r.add_delete("/api/tx/messages/{id}", tx_delete)
    r.add_post("/api/tx/messages/{id}/send", tx_send)
    r.add_post("/api/tx/messages/{id}/start", tx_start)
    r.add_post("/api/tx/messages/{id}/stop", tx_stop)
    r.add_post("/api/tx/start-all", tx_start_all)
    r.add_post("/api/tx/stop-all", tx_stop_all)
    r.add_get("/api/tx/templates", tx_templates)
    r.add_post("/api/tx/import", tx_import)
    r.add_get("/api/tx/export", tx_export)
    # Logging
    r.add_post("/api/log/start", log_start)
    r.add_post("/api/log/stop", log_stop)
    r.add_get("/api/log/status", log_status)
    r.add_get("/api/log/files", log_files)
    r.add_get("/api/log/files/{filename}", log_download)
    r.add_delete("/api/log/files/{filename}", log_delete)
    r.add_get("/api/log/storage", log_storage)
    # DBC
    r.add_post("/api/dbc/upload", dbc_upload)
    r.add_get("/api/dbc/files", dbc_files)
    r.add_delete("/api/dbc/files/{id}", dbc_delete)
    r.add_get("/api/dbc/messages", dbc_messages)
    r.add_get("/api/dbc/messages/{id}/signals", dbc_signals)
    r.add_get("/api/dbc/search", dbc_search)
    r.add_post("/api/dbc/encode", dbc_encode)
    # Signal tracker
    r.add_get("/api/signals/latest", signals_latest)
    r.add_get("/api/signals/history", signals_history)
    r.add_get("/api/signals/stats", signals_stats)


def _json(data, status=200):
    return web.Response(
        text=json.dumps(data),
        content_type="application/json",
        status=status,
    )


def _error(msg, status=400):
    return _json({"error": msg}, status)


# --- Config ---

async def config_get(request: web.Request):
    cfg = request.app["config"].get()
    return _json(cfg)


async def config_put(request: web.Request):
    try:
        updates = await request.json()
    except Exception:
        return _error("Invalid JSON")
    ok, errors = request.app["config"].update(updates)
    if not ok:
        return _error("; ".join(errors))
    request.app["config"].save()
    return _json(request.app["config"].get())


async def config_reset(request: web.Request):
    request.app["config"].reset()
    return _json(request.app["config"].get())


async def config_timing(request: web.Request):
    from server.interface_manager import calculate_timing
    try:
        bitrate = int(request.rel_url.query.get("bitrate", 500000))
        clock = int(request.rel_url.query.get("clock", 40_000_000))
    except ValueError:
        return _error("Invalid parameters")
    result = calculate_timing(bitrate, clock)
    if not result:
        return _error("Could not calculate timing for given parameters")
    return _json(result)


# --- CAN Interface ---

async def can_start(request: web.Request):
    cfg = request.app["config"].get()
    interface = cfg["interface"]
    can_iface = request.app["can_iface"]
    ok, msg = await can_iface.start(interface)
    if ok:
        request.app["stats"].reset()
        request.app["stats"].set_bitrate(cfg["bitrate"])
        request.app["stats"].start()
    return _json({"ok": ok, "message": msg})


async def can_stop(request: web.Request):
    await request.app["can_iface"].stop()
    request.app["stats"].stop()
    return _json({"ok": True})


async def can_status(request: web.Request):
    from server import interface_manager
    cfg = request.app["config"].get()
    hw_status = await interface_manager.get_status(cfg["interface"])
    can_iface = request.app["can_iface"]
    hw_status["capturing"] = can_iface.is_running
    hw_status["uptime"] = can_iface.uptime()
    hw_status["channel"] = can_iface.channel
    return _json(hw_status)


async def can_restart(request: web.Request):
    cfg = request.app["config"].get()
    from server import interface_manager
    can_iface = request.app["can_iface"]
    was_running = can_iface.is_running
    if was_running:
        await can_iface.stop()
        request.app["stats"].stop()

    ok, msg = await interface_manager.configure(
        cfg["interface"], cfg["bitrate"], cfg["mode"],
        cfg["fd_enabled"], cfg["dbitrate"]
    )
    if not ok:
        return _error(msg)

    if was_running:
        ok2, msg2 = await can_iface.start(cfg["interface"])
        if ok2:
            request.app["stats"].reset()
            request.app["stats"].set_bitrate(cfg["bitrate"])
            request.app["stats"].start()

    return _json({"ok": ok, "message": msg})


async def can_interfaces(request: web.Request):
    from server import interface_manager
    ifaces = await interface_manager.list_interfaces()
    return _json({"interfaces": ifaces})


# --- TX ---

async def tx_list(request: web.Request):
    return _json({"messages": request.app["tx"].get_all()})


async def tx_add(request: web.Request):
    from server.tx_scheduler import TXMessage
    try:
        data = await request.json()
    except Exception:
        data = {}
    msg = TXMessage.from_dict(data)
    msg_id = request.app["tx"].add(msg)
    return _json({"id": msg_id, "message": request.app["tx"].get(msg_id).to_dict()}, status=201)


async def tx_update(request: web.Request):
    msg_id = request.match_info["id"]
    try:
        updates = await request.json()
    except Exception:
        return _error("Invalid JSON")
    ok = request.app["tx"].update(msg_id, updates)
    if not ok:
        return _error("Message not found", 404)
    return _json(request.app["tx"].get(msg_id).to_dict())


async def tx_delete(request: web.Request):
    msg_id = request.match_info["id"]
    ok = request.app["tx"].delete(msg_id)
    if not ok:
        return _error("Message not found", 404)
    return _json({"ok": True})


async def tx_send(request: web.Request):
    msg_id = request.match_info["id"]
    ok, msg = await request.app["tx"].send_once(msg_id)
    return _json({"ok": ok, "message": msg})


async def tx_start(request: web.Request):
    msg_id = request.match_info["id"]
    ok, msg = await request.app["tx"].start(msg_id)
    return _json({"ok": ok, "message": msg})


async def tx_stop(request: web.Request):
    msg_id = request.match_info["id"]
    ok = await request.app["tx"].stop(msg_id)
    return _json({"ok": ok})


async def tx_start_all(request: web.Request):
    await request.app["tx"].start_all()
    return _json({"ok": True})


async def tx_stop_all(request: web.Request):
    await request.app["tx"].stop_all()
    return _json({"ok": True})


async def tx_templates(request: web.Request):
    templates_path = Path(__file__).parent.parent / "sample-data" / "tx-presets.json"
    if templates_path.exists():
        with open(templates_path) as f:
            return _json(json.load(f))
    return _json({"templates": []})


async def tx_import(request: web.Request):
    try:
        data = await request.json()
        messages = data if isinstance(data, list) else data.get("messages", [])
    except Exception:
        return _error("Invalid JSON")
    request.app["tx"].import_messages(messages)
    return _json({"ok": True, "count": len(messages)})


async def tx_export(request: web.Request):
    data = request.app["tx"].export_messages()
    return web.Response(
        text=json.dumps(data, indent=2),
        content_type="application/json",
        headers={"Content-Disposition": "attachment; filename=tx-messages.json"},
    )


# --- Logging ---

async def log_start(request: web.Request):
    try:
        body = await request.json()
    except Exception:
        body = {}
    fmt = body.get("format", "asc")
    prefix = body.get("prefix", "pican")
    cfg = request.app["config"].get()
    request.app["log_writer"].configure(cfg["log_dir"], cfg["log_max_size_mb"])
    ok, path = await request.app["log_writer"].start(fmt, prefix)
    return _json({"ok": ok, "file": path})


async def log_stop(request: web.Request):
    await request.app["log_writer"].stop()
    return _json({"ok": True})


async def log_status(request: web.Request):
    return _json(request.app["log_writer"].get_status())


async def log_files(request: web.Request):
    return _json({"files": request.app["log_writer"].list_files()})


async def log_download(request: web.Request):
    filename = request.match_info["filename"]
    cfg = request.app["config"].get()
    file_path = Path(cfg["log_dir"]) / filename
    if not file_path.exists() or not file_path.is_file():
        return _error("File not found", 404)
    return web.FileResponse(file_path, headers={
        "Content-Disposition": f'attachment; filename="{filename}"'
    })


async def log_delete(request: web.Request):
    filename = request.match_info["filename"]
    cfg = request.app["config"].get()
    file_path = Path(cfg["log_dir"]) / filename
    if not file_path.exists():
        return _error("File not found", 404)
    file_path.unlink()
    return _json({"ok": True})


async def log_storage(request: web.Request):
    return _json(request.app["log_writer"].get_storage_info())


# --- DBC ---

async def dbc_upload(request: web.Request):
    reader = await request.multipart()
    field = await reader.next()
    if not field:
        return _error("No file provided")

    filename = field.filename or "upload.dbc"
    tmp_dir = Path(tempfile.gettempdir()) / "pican_dbc"
    tmp_dir.mkdir(exist_ok=True)
    tmp_path = tmp_dir / filename

    with open(tmp_path, "wb") as f:
        while True:
            chunk = await field.read_chunk(65536)
            if not chunk:
                break
            f.write(chunk)

    entry = request.app["dbc"].load(str(tmp_path), filename)
    return _json(entry.to_dict(), status=201 if not entry.error else 400)


async def dbc_files(request: web.Request):
    return _json({"files": request.app["dbc"].get_files()})


async def dbc_delete(request: web.Request):
    file_id = request.match_info["id"]
    ok = request.app["dbc"].unload(file_id)
    if not ok:
        return _error("DBC file not found", 404)
    return _json({"ok": True})


async def dbc_messages(request: web.Request):
    return _json({"messages": request.app["dbc"].get_messages()})


async def dbc_signals(request: web.Request):
    try:
        frame_id = int(request.match_info["id"], 0)
    except ValueError:
        return _error("Invalid frame ID")
    return _json({"signals": request.app["dbc"].get_signals(frame_id)})


async def dbc_search(request: web.Request):
    query = request.rel_url.query.get("q", "")
    if not query:
        return _json({"results": []})
    results = request.app["dbc"].search(query)
    return _json({"results": results})


async def dbc_encode(request: web.Request):
    try:
        body = await request.json()
    except Exception:
        return _error("Invalid JSON")
    message_name = body.get("message")
    signals = body.get("signals", {})
    if not message_name:
        return _error("'message' field required")
    data = request.app["dbc"].encode(message_name, signals)
    if data is None:
        return _error("Failed to encode — message not found or encoding error")
    return _json({"data": list(data), "hex": data.hex().upper()})


# --- Signals ---

async def signals_latest(request: web.Request):
    return _json(request.app["signal_tracker"].get_all_latest())


async def signals_history(request: web.Request):
    signal_name = request.rel_url.query.get("signal", "")
    window = float(request.rel_url.query.get("window", 60))
    if not signal_name:
        return _error("'signal' parameter required")
    history = request.app["signal_tracker"].get_history(signal_name, window)
    return _json({"signal": signal_name, "data": [[ts, v] for ts, v in history]})


async def signals_stats(request: web.Request):
    signal_name = request.rel_url.query.get("signal", "")
    if not signal_name:
        return _error("'signal' parameter required")
    stats = request.app["signal_tracker"].get_stats(signal_name)
    if stats is None:
        return _error("Signal not found", 404)
    return _json(stats)
