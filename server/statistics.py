# SPDX-License-Identifier: AGPL-3.0-or-later
"""Bus statistics: message rates, bus load, error counters."""
import asyncio
import collections
import logging
import time
from typing import Optional

logger = logging.getLogger(__name__)

# Nominal bit overhead per CAN frame (approximate, for bus load calculation)
CAN20_OVERHEAD_BITS = 47  # worst-case stuffed frame overhead
CANFD_OVERHEAD_BITS = 64


class Statistics:
    def __init__(self):
        self._rx_count: int = 0
        self._tx_count: int = 0
        self._rx_rate: float = 0.0
        self._tx_rate: float = 0.0
        self._bus_load: float = 0.0
        self._tec: int = 0
        self._rec: int = 0
        self._bus_state: str = "unknown"

        # For rate calculation
        self._rx_window: collections.deque = collections.deque(maxlen=10)
        self._tx_window: collections.deque = collections.deque(maxlen=10)
        self._bits_window: collections.deque = collections.deque(maxlen=10)

        # Per-second counters reset each tick
        self._rx_this_second: int = 0
        self._tx_this_second: int = 0
        self._bits_this_second: int = 0

        # Unique IDs seen
        self._unique_ids: set = set()
        self._id_counts: collections.Counter = collections.Counter()

        # Sparkline data (last 60 seconds)
        self._rate_history: collections.deque = collections.deque(maxlen=60)

        self._bitrate: int = 500_000
        self._ticker_task: Optional[asyncio.Task] = None

    def set_bitrate(self, bitrate: int):
        self._bitrate = bitrate

    def record_rx(self, msg):
        self._rx_count += 1
        self._rx_this_second += 1
        self._unique_ids.add(msg.arbitration_id)
        self._id_counts[msg.arbitration_id] += 1

        # Estimate bits: overhead + data
        data_bits = (msg.dlc if not getattr(msg, "is_fd", False) else msg.dlc) * 8
        overhead = CANFD_OVERHEAD_BITS if getattr(msg, "is_fd", False) else CAN20_OVERHEAD_BITS
        self._bits_this_second += data_bits + overhead

    def record_tx(self, msg_data_len: int, is_fd: bool = False):
        self._tx_count += 1
        self._tx_this_second += 1
        data_bits = msg_data_len * 8
        overhead = CANFD_OVERHEAD_BITS if is_fd else CAN20_OVERHEAD_BITS
        self._bits_this_second += data_bits + overhead

    def update_error_counters(self, tec: int, rec: int, state: str):
        self._tec = tec
        self._rec = rec
        self._bus_state = state

    def reset(self):
        self._rx_count = 0
        self._tx_count = 0
        self._rx_rate = 0.0
        self._tx_rate = 0.0
        self._bus_load = 0.0
        self._rx_this_second = 0
        self._tx_this_second = 0
        self._bits_this_second = 0
        self._unique_ids.clear()
        self._id_counts.clear()
        self._rate_history.clear()
        self._rx_window.clear()
        self._tx_window.clear()
        self._bits_window.clear()

    def _tick(self):
        """Called every second to update rates."""
        self._rx_window.append(self._rx_this_second)
        self._tx_window.append(self._tx_this_second)
        self._bits_window.append(self._bits_this_second)

        self._rx_rate = sum(self._rx_window) / len(self._rx_window)
        self._tx_rate = sum(self._tx_window) / len(self._tx_window)

        bits_per_sec = sum(self._bits_window) / len(self._bits_window)
        self._bus_load = min(100.0, (bits_per_sec / self._bitrate) * 100)

        self._rate_history.append(round(self._rx_rate, 1))

        self._rx_this_second = 0
        self._tx_this_second = 0
        self._bits_this_second = 0

    def get_snapshot(self, uptime: float = 0.0) -> dict:
        top5 = self._id_counts.most_common(5)
        return {
            "rx_total": self._rx_count,
            "tx_total": self._tx_count,
            "rx_rate": round(self._rx_rate, 1),
            "tx_rate": round(self._tx_rate, 1),
            "load": round(self._bus_load, 1),
            "tec": self._tec,
            "rec": self._rec,
            "state": self._bus_state,
            "uptime": round(uptime, 1),
            "unique_ids": len(self._unique_ids),
            "top_ids": [{"id": hex(cid), "count": cnt} for cid, cnt in top5],
            "rate_history": list(self._rate_history),
        }

    async def ticker_loop(self):
        while True:
            await asyncio.sleep(1)
            self._tick()

    def start(self):
        self._ticker_task = asyncio.create_task(self.ticker_loop())

    def stop(self):
        if self._ticker_task:
            self._ticker_task.cancel()
            self._ticker_task = None
