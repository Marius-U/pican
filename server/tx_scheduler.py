# SPDX-License-Identifier: AGPL-3.0-or-later
"""TX scheduler — one-shot, periodic, and burst CAN message transmission."""
import asyncio
import logging
import time
import uuid
from dataclasses import dataclass, field
from typing import Optional

logger = logging.getLogger(__name__)


@dataclass
class TXMessage:
    id: str = field(default_factory=lambda: str(uuid.uuid4())[:8])
    name: str = "Unnamed"
    can_id: int = 0x000
    ide: bool = False  # True = extended 29-bit
    fd: bool = False
    brs: bool = False
    dlc: int = 8
    data: list[int] = field(default_factory=lambda: [0] * 8)
    mode: str = "one-shot"  # one-shot | periodic | burst
    period_ms: int = 100
    burst_count: int = 10
    burst_interval_ms: int = 10
    repeat: int = -1  # -1 = infinite; >0 = fixed number of iterations (periodic/one-shot)
    enabled: bool = True

    # Runtime state (not serialized)
    status: str = "idle"
    send_count: int = 0
    _task: Optional[asyncio.Task] = field(default=None, repr=False, compare=False)

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "name": self.name,
            "can_id": self.can_id,
            "can_id_hex": hex(self.can_id),
            "ide": self.ide,
            "fd": self.fd,
            "brs": self.brs,
            "dlc": self.dlc,
            "data": self.data,
            "mode": self.mode,
            "period_ms": self.period_ms,
            "burst_count": self.burst_count,
            "burst_interval_ms": self.burst_interval_ms,
            "repeat": self.repeat,
            "enabled": self.enabled,
            "status": self.status,
            "send_count": self.send_count,
        }

    @classmethod
    def from_dict(cls, d: dict) -> "TXMessage":
        msg = cls()
        for key in ("name", "can_id", "ide", "fd", "brs", "dlc", "data",
                    "mode", "period_ms", "burst_count", "burst_interval_ms",
                    "repeat", "enabled"):
            if key in d:
                setattr(msg, key, d[key])
        if "id" in d:
            msg.id = d["id"]
        return msg


class TXScheduler:
    def __init__(self):
        self._messages: dict[str, TXMessage] = {}
        self._send_fn = None  # async callable(can_id, data, ide, fd, brs)
        self._ws_manager = None

    def set_send_fn(self, fn):
        self._send_fn = fn

    def set_ws_manager(self, ws_manager):
        self._ws_manager = ws_manager

    def add(self, msg: TXMessage) -> str:
        self._messages[msg.id] = msg
        return msg.id

    def update(self, msg_id: str, updates: dict) -> bool:
        if msg_id not in self._messages:
            return False
        msg = self._messages[msg_id]
        for key, val in updates.items():
            if hasattr(msg, key) and not key.startswith("_"):
                setattr(msg, key, val)
        return True

    def delete(self, msg_id: str) -> bool:
        if msg_id not in self._messages:
            return False
        msg = self._messages[msg_id]
        if msg._task:
            msg._task.cancel()
        del self._messages[msg_id]
        return True

    def get_all(self) -> list[dict]:
        return [m.to_dict() for m in self._messages.values()]

    def get(self, msg_id: str) -> Optional[TXMessage]:
        return self._messages.get(msg_id)

    async def send_once(self, msg_id: str) -> tuple[bool, str]:
        msg = self._messages.get(msg_id)
        if not msg:
            return False, "Message not found"
        return await self._do_send(msg)

    async def _do_send(self, msg: TXMessage) -> tuple[bool, str]:
        if not self._send_fn:
            return False, "Send function not configured"
        data = bytes(msg.data[:msg.dlc])
        ok, err = await self._send_fn(msg.can_id, data, msg.ide, msg.fd, msg.brs)
        if ok:
            msg.send_count += 1
            if self._ws_manager:
                await self._ws_manager.send_tx_status(msg.id, "sent", msg.send_count)
        return ok, err

    async def start(self, msg_id: str) -> tuple[bool, str]:
        msg = self._messages.get(msg_id)
        if not msg:
            return False, "Message not found"
        if msg._task and not msg._task.done():
            return False, "Already running"

        if msg.mode == "periodic":
            msg._task = asyncio.create_task(self._periodic_loop(msg))
        elif msg.mode == "burst":
            msg._task = asyncio.create_task(self._burst_loop(msg))
        elif msg.mode == "one-shot":
            await self._do_send(msg)
            return True, "sent"
        else:
            return False, f"Unknown mode: {msg.mode}"

        msg.status = "sending"
        return True, "started"

    async def stop(self, msg_id: str) -> bool:
        msg = self._messages.get(msg_id)
        if not msg:
            return False
        if msg._task:
            msg._task.cancel()
            msg._task = None
        msg.status = "idle"
        return True

    async def start_all(self):
        for msg in self._messages.values():
            if msg.enabled:
                await self.start(msg.id)

    async def stop_all(self):
        for msg_id in list(self._messages.keys()):
            await self.stop(msg_id)

    async def _periodic_loop(self, msg: TXMessage):
        iterations = 0
        try:
            while True:
                await self._do_send(msg)
                iterations += 1
                if msg.repeat > 0 and iterations >= msg.repeat:
                    break
                await asyncio.sleep(msg.period_ms / 1000.0)
        except asyncio.CancelledError:
            pass
        finally:
            msg.status = "idle"

    async def _burst_loop(self, msg: TXMessage):
        try:
            for i in range(msg.burst_count):
                await self._do_send(msg)
                if i < msg.burst_count - 1:
                    await asyncio.sleep(msg.burst_interval_ms / 1000.0)
        except asyncio.CancelledError:
            pass
        finally:
            msg.status = "idle"

    def import_messages(self, data: list[dict]):
        for item in data:
            msg = TXMessage.from_dict(item)
            msg.id = str(uuid.uuid4())[:8]  # assign new ID on import
            self._messages[msg.id] = msg

    def export_messages(self) -> list[dict]:
        return [m.to_dict() for m in self._messages.values()]
