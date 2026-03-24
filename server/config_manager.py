# SPDX-License-Identifier: AGPL-3.0-or-later
"""Configuration manager — loads defaults, merges runtime config, auto-saves."""
import asyncio
import json
import logging
import os
import time
from pathlib import Path

logger = logging.getLogger(__name__)

BASE_DIR = Path(__file__).parent.parent
DEFAULT_CONFIG_PATH = BASE_DIR / "config" / "default.json"
RUNTIME_CONFIG_PATH = BASE_DIR / "config" / "runtime.json"

VALID_MODES = {"normal", "listen-only", "loopback", "loopback-external"}
VALID_TIMESTAMP_FORMATS = {"relative", "absolute", "delta"}
VALID_THEMES = {"dark", "light"}

FIELD_VALIDATORS = {
    "interface": lambda v: isinstance(v, str) and len(v) > 0,
    "mode": lambda v: v in VALID_MODES,
    "fd_enabled": lambda v: isinstance(v, bool),
    "bitrate": lambda v: isinstance(v, int) and 1000 <= v <= 8000000,
    "dbitrate": lambda v: isinstance(v, int) and 1000 <= v <= 8000000,
    "buffer_size": lambda v: isinstance(v, int) and 100 <= v <= 100000,
    "auto_scroll": lambda v: isinstance(v, bool),
    "timestamp_format": lambda v: v in VALID_TIMESTAMP_FORMATS,
    "hex_uppercase": lambda v: isinstance(v, bool),
    "theme": lambda v: v in VALID_THEMES,
    "ws_interval_ms": lambda v: isinstance(v, int) and 10 <= v <= 1000,
    "graph_hz": lambda v: isinstance(v, int) and 1 <= v <= 60,
    "log_dir": lambda v: isinstance(v, str) and len(v) > 0,
    "log_max_size_mb": lambda v: isinstance(v, (int, float)) and 1 <= v <= 10000,
}


class ConfigManager:
    def __init__(self):
        self._config: dict = {}
        self._dirty: bool = False
        self._last_save: float = 0.0
        self._save_task: asyncio.Task | None = None

    def load(self):
        """Load default config then overlay runtime config."""
        with open(DEFAULT_CONFIG_PATH) as f:
            self._config = json.load(f)

        if RUNTIME_CONFIG_PATH.exists():
            try:
                with open(RUNTIME_CONFIG_PATH) as f:
                    runtime = json.load(f)
                for key, value in runtime.items():
                    if key in self._config:
                        self._config[key] = value
                logger.info("Loaded runtime config from %s", RUNTIME_CONFIG_PATH)
            except Exception as e:
                logger.warning("Failed to load runtime config: %s", e)

        logger.info("Config loaded: interface=%s bitrate=%s", self._config.get("interface"), self._config.get("bitrate"))

    def get(self) -> dict:
        return dict(self._config)

    def get_value(self, key: str, default=None):
        return self._config.get(key, default)

    def update(self, updates: dict) -> tuple[bool, list[str]]:
        """Validate and apply updates. Returns (success, errors)."""
        errors = []
        validated = {}

        for key, value in updates.items():
            if key not in self._config:
                errors.append(f"Unknown config key: {key}")
                continue
            validator = FIELD_VALIDATORS.get(key)
            if validator and not validator(value):
                errors.append(f"Invalid value for '{key}': {value!r}")
                continue
            validated[key] = value

        if errors:
            return False, errors

        self._config.update(validated)
        self._dirty = True
        return True, []

    def reset(self):
        """Reset to factory defaults."""
        with open(DEFAULT_CONFIG_PATH) as f:
            self._config = json.load(f)
        self._dirty = True
        if RUNTIME_CONFIG_PATH.exists():
            RUNTIME_CONFIG_PATH.unlink()

    def save(self):
        """Save current config to runtime file."""
        RUNTIME_CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
        tmp = RUNTIME_CONFIG_PATH.with_suffix(".tmp")
        with open(tmp, "w") as f:
            json.dump(self._config, f, indent=2)
        tmp.replace(RUNTIME_CONFIG_PATH)
        self._dirty = False
        self._last_save = time.monotonic()
        logger.debug("Config saved to %s", RUNTIME_CONFIG_PATH)

    async def auto_save_loop(self):
        """Periodically save config if it has changed."""
        while True:
            await asyncio.sleep(60)
            if self._dirty:
                try:
                    self.save()
                except Exception as e:
                    logger.error("Auto-save failed: %s", e)

    def start_auto_save(self):
        self._save_task = asyncio.create_task(self.auto_save_loop())

    def stop_auto_save(self):
        if self._save_task:
            self._save_task.cancel()
