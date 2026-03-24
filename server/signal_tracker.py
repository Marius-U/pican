# SPDX-License-Identifier: AGPL-3.0-or-later
"""Signal value tracker for graphing — maintains timestamped history per signal."""
import collections
import logging
import math
import time
from typing import Optional

logger = logging.getLogger(__name__)

HISTORY_SIZE = 6000  # ~600s at 10Hz


class SignalTracker:
    def __init__(self):
        # signal_name -> deque of (timestamp, phys_value)
        self._history: dict[str, collections.deque] = {}
        # signal_name -> latest value dict
        self._latest: dict[str, dict] = {}
        # signal_name -> stats accumulator
        self._stats: dict[str, dict] = {}

    def record(self, signals: dict, ts: float, message_name: str = ""):
        """Record decoded signal values from a CAN frame."""
        for sig_name, sig_data in signals.items():
            phys = sig_data.get("phys")
            if phys is None:
                continue

            full_name = f"{message_name}.{sig_name}" if message_name else sig_name

            if full_name not in self._history:
                self._history[full_name] = collections.deque(maxlen=HISTORY_SIZE)
                self._stats[full_name] = {
                    "count": 0,
                    "sum": 0.0,
                    "sum_sq": 0.0,
                    "min": phys,
                    "max": phys,
                    "min_ts": ts,
                    "max_ts": ts,
                }

            self._history[full_name].append((ts, phys))

            st = self._stats[full_name]
            st["count"] += 1
            st["sum"] += phys
            st["sum_sq"] += phys * phys
            if phys < st["min"]:
                st["min"] = phys
                st["min_ts"] = ts
            if phys > st["max"]:
                st["max"] = phys
                st["max_ts"] = ts

            self._latest[full_name] = {
                "phys": phys,
                "unit": sig_data.get("unit", ""),
                "ts": ts,
                "message": message_name,
                "signal": sig_name,
                "range_min": sig_data.get("min"),
                "range_max": sig_data.get("max"),
            }

    def get_history(self, signal_name: str, window_s: float = 60.0) -> list[tuple]:
        """Return (ts, value) pairs within the last window_s seconds."""
        if signal_name not in self._history:
            return []
        now = time.time()
        cutoff = now - window_s
        return [(ts, v) for ts, v in self._history[signal_name] if ts >= cutoff]

    def get_stats(self, signal_name: str) -> Optional[dict]:
        if signal_name not in self._stats:
            return None
        st = self._stats[signal_name]
        if st["count"] == 0:
            return None
        mean = st["sum"] / st["count"]
        variance = (st["sum_sq"] / st["count"]) - (mean ** 2)
        std = math.sqrt(max(0, variance))
        return {
            "count": st["count"],
            "mean": round(mean, 4),
            "std": round(std, 4),
            "min": st["min"],
            "max": st["max"],
            "min_ts": st["min_ts"],
            "max_ts": st["max_ts"],
        }

    def get_latest(self, signal_name: str) -> Optional[dict]:
        return self._latest.get(signal_name)

    def get_all_latest(self) -> dict:
        return dict(self._latest)

    def get_watched_signals(self) -> list[str]:
        return list(self._latest.keys())

    def reset(self):
        self._history.clear()
        self._latest.clear()
        self._stats.clear()
