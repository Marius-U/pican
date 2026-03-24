# SPDX-License-Identifier: AGPL-3.0-or-later
"""WebSocket connection manager with 50ms batching broadcaster."""
import asyncio
import json
import logging
import time
from typing import Optional

from aiohttp import web

logger = logging.getLogger(__name__)


class WSManager:
    def __init__(self):
        self._connections: set[web.WebSocketResponse] = set()
        self._batch: list[dict] = []
        self._flush_task: Optional[asyncio.Task] = None
        self._interval_ms: int = 50
        self._stats_callback = None
        self._cmd_handlers: dict = {}

    def set_interval(self, ms: int):
        self._interval_ms = max(10, min(1000, ms))

    def set_stats_callback(self, cb):
        self._stats_callback = cb

    def register_cmd_handler(self, action: str, handler):
        self._cmd_handlers[action] = handler

    def add(self, ws: web.WebSocketResponse):
        self._connections.add(ws)
        logger.debug("WS client connected (%d total)", len(self._connections))

    def remove(self, ws: web.WebSocketResponse):
        self._connections.discard(ws)
        logger.debug("WS client disconnected (%d total)", len(self._connections))

    def push_message(self, msg_dict: dict):
        """Add a CAN message to the batch buffer."""
        self._batch.append(msg_dict)

    async def broadcast(self, data: str):
        """Send data string to all connected clients, removing dead connections."""
        dead = set()
        for ws in list(self._connections):
            try:
                if not ws.closed:
                    await ws.send_str(data)
            except Exception:
                dead.add(ws)
        for ws in dead:
            self._connections.discard(ws)

    async def _flush_loop(self):
        """50ms periodic task: flush batch and send stats."""
        while True:
            await asyncio.sleep(self._interval_ms / 1000.0)
            if not self._connections:
                self._batch.clear()
                continue
            try:
                # Send batched messages
                if self._batch:
                    payload = json.dumps({"t": "msg", "d": self._batch})
                    self._batch = []
                    await self.broadcast(payload)

                # Send stats snapshot
                if self._stats_callback:
                    stats = self._stats_callback()
                    await self.broadcast(json.dumps({"t": "stat", "d": stats}))
            except Exception as e:
                logger.error("WS flush error: %s", e)

    def start(self):
        self._flush_task = asyncio.create_task(self._flush_loop())

    def stop(self):
        if self._flush_task:
            self._flush_task.cancel()
            self._flush_task = None

    async def handle_connection(self, request: web.Request) -> web.WebSocketResponse:
        """Handle a new WebSocket connection."""
        ws = web.WebSocketResponse(heartbeat=30)
        await ws.prepare(request)
        self.add(ws)

        try:
            async for msg in ws:
                from aiohttp import WSMsgType
                if msg.type == WSMsgType.TEXT:
                    try:
                        data = json.loads(msg.data)
                        await self._handle_client_message(ws, data)
                    except json.JSONDecodeError:
                        pass
                elif msg.type in (WSMsgType.ERROR, WSMsgType.CLOSE):
                    break
        except Exception as e:
            logger.debug("WS connection error: %s", e)
        finally:
            self.remove(ws)

        return ws

    async def _handle_client_message(self, ws: web.WebSocketResponse, data: dict):
        """Dispatch client commands."""
        if data.get("t") != "cmd":
            return
        action = data.get("a")
        if action in self._cmd_handlers:
            try:
                await self._cmd_handlers[action](data.get("d", {}))
            except Exception as e:
                logger.error("Command handler error for '%s': %s", action, e)

    async def send_error(self, message: str):
        await self.broadcast(json.dumps({"t": "err", "m": message}))

    async def send_tx_status(self, msg_id: str, status: str, count: int = 0):
        await self.broadcast(json.dumps({"t": "tx_status", "id": msg_id, "s": status, "count": count}))
