# SPDX-License-Identifier: AGPL-3.0-or-later
"""DBC file management and CAN signal decoding using cantools."""
import logging
import os
import uuid
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)

try:
    import cantools
    CANTOOLS_AVAILABLE = True
except ImportError:
    CANTOOLS_AVAILABLE = False
    cantools = None  # type: ignore


class LoadedDBC:
    def __init__(self, file_id: str, filename: str, path: str):
        self.id = file_id
        self.filename = filename
        self.path = path
        self.db = None
        self.enabled = True
        self.warnings: list[str] = []
        self.error: Optional[str] = None

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "filename": self.filename,
            "enabled": self.enabled,
            "error": self.error,
            "warnings": self.warnings,
            "message_count": len(self.db.messages) if self.db else 0,
        }


class DBCHandler:
    def __init__(self):
        self._files: dict[str, LoadedDBC] = {}
        # Cache: arbitration_id -> (db, message) for fast decode
        self._decode_cache: dict[int, tuple] = {}

    def load(self, path: str, filename: str) -> LoadedDBC:
        """Parse a DBC file and add it to the loaded set."""
        file_id = str(uuid.uuid4())[:8]
        entry = LoadedDBC(file_id, filename, path)

        if not CANTOOLS_AVAILABLE:
            entry.error = "cantools not installed"
            self._files[file_id] = entry
            return entry

        try:
            db = cantools.database.load_file(path, strict=False)
            entry.db = db
            self._files[file_id] = entry
            self._rebuild_cache()
            logger.info("Loaded DBC %s: %d messages", filename, len(db.messages))
        except Exception as e:
            entry.error = str(e)
            logger.error("Failed to load DBC %s: %s", filename, e)

        return entry

    def unload(self, file_id: str) -> bool:
        if file_id not in self._files:
            return False
        # Delete temp file if it's in uploads dir
        entry = self._files[file_id]
        try:
            if "/tmp/" in entry.path or "uploads" in entry.path:
                os.unlink(entry.path)
        except Exception:
            pass
        del self._files[file_id]
        self._rebuild_cache()
        return True

    def _rebuild_cache(self):
        """Rebuild decode cache from all enabled DBCs."""
        self._decode_cache.clear()
        for entry in self._files.values():
            if entry.enabled and entry.db:
                for msg in entry.db.messages:
                    if msg.frame_id not in self._decode_cache:
                        self._decode_cache[msg.frame_id] = (entry.db, msg)

    def decode(self, arbitration_id: int, data: bytes) -> Optional[dict]:
        """Decode signals for a CAN frame. Returns dict or None."""
        if not self._decode_cache:
            return None

        if arbitration_id not in self._decode_cache:
            return None

        db, msg = self._decode_cache[arbitration_id]
        try:
            decoded = db.decode_message(arbitration_id, data, decode_choices=False)
            result = {}
            for sig_name, phys_value in decoded.items():
                signal = msg.get_signal_by_name(sig_name)
                result[sig_name] = {
                    "phys": float(phys_value) if phys_value is not None else None,
                    "unit": signal.unit or "",
                    "min": float(signal.minimum) if signal.minimum is not None else None,
                    "max": float(signal.maximum) if signal.maximum is not None else None,
                }
            return result
        except Exception as e:
            logger.debug("Decode error for id=0x%X: %s", arbitration_id, e)
            return None

    def encode(self, message_name: str, signals: dict) -> Optional[bytes]:
        """Encode signal values to CAN data bytes."""
        for entry in self._files.values():
            if entry.enabled and entry.db:
                try:
                    data = entry.db.encode_message(message_name, signals)
                    return data
                except Exception:
                    continue
        return None

    def search(self, query: str) -> list[dict]:
        """Search messages and signals by name."""
        query_lower = query.lower()
        results = []
        seen = set()

        for entry in self._files.values():
            if not entry.enabled or not entry.db:
                continue
            for msg in entry.db.messages:
                if query_lower in msg.name.lower():
                    key = f"msg:{msg.frame_id}"
                    if key not in seen:
                        seen.add(key)
                        results.append({
                            "type": "message",
                            "name": msg.name,
                            "id": hex(msg.frame_id),
                            "dlc": msg.length,
                        })
                for sig in msg.signals:
                    if query_lower in sig.name.lower():
                        key = f"sig:{msg.frame_id}:{sig.name}"
                        if key not in seen:
                            seen.add(key)
                            results.append({
                                "type": "signal",
                                "name": sig.name,
                                "message": msg.name,
                                "message_id": hex(msg.frame_id),
                                "unit": sig.unit or "",
                            })

        return results[:50]  # cap at 50 results

    def get_files(self) -> list[dict]:
        return [f.to_dict() for f in self._files.values()]

    def get_messages(self) -> list[dict]:
        """Return flat list of all messages from enabled DBCs."""
        messages = []
        seen = set()
        for entry in self._files.values():
            if not entry.enabled or not entry.db:
                continue
            for msg in entry.db.messages:
                if msg.frame_id not in seen:
                    seen.add(msg.frame_id)
                    messages.append({
                        "id": hex(msg.frame_id),
                        "frame_id": msg.frame_id,
                        "name": msg.name,
                        "length": msg.length,
                        "cycle_time": msg.cycle_time,
                        "senders": msg.senders,
                        "signal_count": len(msg.signals),
                        "dbc_file": entry.filename,
                    })
        return messages

    def get_signals(self, frame_id: int) -> list[dict]:
        """Return signals for a specific message frame ID."""
        if frame_id not in self._decode_cache:
            return []
        _, msg = self._decode_cache[frame_id]
        signals = []
        for sig in msg.signals:
            signals.append({
                "name": sig.name,
                "start_bit": sig.start,
                "length": sig.length,
                "byte_order": "big_endian" if sig.byte_order == "big_endian" else "little_endian",
                "is_signed": sig.is_signed,
                "factor": float(sig.scale) if sig.scale else 1.0,
                "offset": float(sig.offset) if sig.offset else 0.0,
                "unit": sig.unit or "",
                "minimum": float(sig.minimum) if sig.minimum is not None else None,
                "maximum": float(sig.maximum) if sig.maximum is not None else None,
                "choices": sig.choices or {},
            })
        return signals

    def get_message_name(self, arbitration_id: int) -> Optional[str]:
        """Get message name for a given CAN ID."""
        if arbitration_id in self._decode_cache:
            _, msg = self._decode_cache[arbitration_id]
            return msg.name
        return None

    def has_dbc(self) -> bool:
        return any(e.enabled and e.db for e in self._files.values())
