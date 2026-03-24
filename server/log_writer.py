# SPDX-License-Identifier: AGPL-3.0-or-later
"""Async log writer supporting ASC, CSV, and BLF formats."""
import asyncio
import logging
import os
import time
from datetime import datetime
from pathlib import Path
from typing import Optional

import aiofiles

logger = logging.getLogger(__name__)

try:
    import can
    CAN_AVAILABLE = True
except ImportError:
    CAN_AVAILABLE = False


class LogWriter:
    def __init__(self):
        self._active: bool = False
        self._format: str = "asc"
        self._file_path: Optional[Path] = None
        self._file = None  # aiofiles handle
        self._blf_writer = None  # python-can BLFWriter
        self._start_time: float = 0.0
        self._message_count: int = 0
        self._max_size_bytes: int = 50 * 1024 * 1024
        self._log_dir: Path = Path("/opt/pican-studio/logs")
        self._write_queue: asyncio.Queue = asyncio.Queue(maxsize=10000)
        self._writer_task: Optional[asyncio.Task] = None
        self._asc_start_dt: Optional[datetime] = None

    def configure(self, log_dir: str, max_size_mb: int = 50):
        self._log_dir = Path(log_dir)
        self._max_size_bytes = max_size_mb * 1024 * 1024

    async def start(self, fmt: str = "asc", prefix: str = "pican") -> tuple[bool, str]:
        if self._active:
            await self.stop()

        self._format = fmt.lower()
        self._log_dir.mkdir(parents=True, exist_ok=True)

        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        ext = {"asc": "asc", "csv": "csv", "blf": "blf"}.get(self._format, "asc")
        filename = f"{prefix}_{timestamp}.{ext}"
        self._file_path = self._log_dir / filename

        try:
            if self._format == "blf":
                await self._open_blf()
            else:
                self._file = await aiofiles.open(self._file_path, "w", encoding="utf-8")
                if self._format == "asc":
                    await self._write_asc_header()
                elif self._format == "csv":
                    await self._write_csv_header()

            self._start_time = time.time()
            self._asc_start_dt = datetime.now()
            self._message_count = 0
            self._active = True
            self._writer_task = asyncio.create_task(self._writer_loop())
            logger.info("Logging started: %s", self._file_path)
            return True, str(self._file_path)
        except Exception as e:
            logger.error("Failed to open log file: %s", e)
            return False, str(e)

    async def stop(self):
        if not self._active:
            return
        self._active = False

        if self._writer_task:
            # Drain the queue first
            await self._write_queue.join()
            self._writer_task.cancel()
            try:
                await self._writer_task
            except asyncio.CancelledError:
                pass
            self._writer_task = None

        if self._file:
            await self._file.close()
            self._file = None

        if self._blf_writer:
            self._blf_writer.stop()
            self._blf_writer = None

        logger.info("Logging stopped: %d messages written", self._message_count)

    def write(self, msg):
        """Non-blocking write — queue the message for async processing."""
        if not self._active:
            return
        try:
            self._write_queue.put_nowait(msg)
        except asyncio.QueueFull:
            pass  # Drop messages if queue is full

    async def _writer_loop(self):
        """Drain write queue and write to file."""
        while self._active or not self._write_queue.empty():
            try:
                msg = await asyncio.wait_for(self._write_queue.get(), timeout=0.5)
                await self._write_message(msg)
                self._write_queue.task_done()
                self._message_count += 1

                # Check file size rotation
                if self._message_count % 1000 == 0:
                    await self._check_rotation()
            except asyncio.TimeoutError:
                continue
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error("Write error: %s", e)

    async def _write_message(self, msg):
        if self._format == "asc":
            await self._write_asc_message(msg)
        elif self._format == "csv":
            await self._write_csv_message(msg)
        elif self._format == "blf":
            self._write_blf_message(msg)

    async def _write_asc_header(self):
        dt = datetime.now()
        header = (
            f"date {dt.strftime('%a %b %d %H:%M:%S.%f')[:-3]} {dt.year}\n"
            f"base hex  timestamps absolute\n"
            f"no internal events logged\n"
        )
        await self._file.write(header)

    async def _write_asc_message(self, msg):
        elapsed = msg.timestamp - self._start_time
        can_id = msg.arbitration_id

        if getattr(msg, "is_extended_id", False):
            id_str = f"{can_id:08X}x"
        else:
            id_str = f"{can_id:X}"

        direction = "Rx"
        data_bytes = " ".join(f"{b:02X}" for b in msg.data)
        dlc = msg.dlc

        if getattr(msg, "is_fd", False):
            brs = "1" if getattr(msg, "bitrate_switch", False) else "0"
            esi = "1" if getattr(msg, "error_state_indicator", False) else "0"
            line = (
                f"{elapsed:>12.6f} 1  {id_str:<20} {direction}   {dlc:>2} "
                f"{data_bytes}   [FD] BRS={brs} ESI={esi}\n"
            )
        else:
            line = (
                f"{elapsed:>12.6f} 1  {id_str:<12} {direction}   d {dlc} {data_bytes}"
                f"  Length = 0 BitCount = 0\n"
            )

        await self._file.write(line)

    async def _write_csv_header(self):
        await self._file.write(
            "timestamp,elapsed_s,channel,can_id,ide,type,fdf,brs,esi,dlc,data\n"
        )

    async def _write_csv_message(self, msg):
        elapsed = msg.timestamp - self._start_time
        can_id = hex(msg.arbitration_id)
        ide = "EXT" if getattr(msg, "is_extended_id", False) else "STD"
        is_fd = getattr(msg, "is_fd", False)
        frame_type = "CAN-FD" if is_fd else "CAN 2.0"
        brs = "1" if getattr(msg, "bitrate_switch", False) else "0"
        esi = "1" if getattr(msg, "error_state_indicator", False) else "0"
        data_hex = "".join(f"{b:02X}" for b in msg.data)

        dt = datetime.fromtimestamp(msg.timestamp).strftime("%H:%M:%S.%f")
        line = (
            f"{dt},{elapsed:.6f},can0,{can_id},{ide},{frame_type},"
            f"{'1' if is_fd else '0'},{brs},{esi},{msg.dlc},{data_hex}\n"
        )
        await self._file.write(line)

    async def _open_blf(self):
        if CAN_AVAILABLE:
            try:
                self._blf_writer = can.BLFWriter(str(self._file_path))
                return
            except Exception:
                pass
        # Fallback to ASC if BLF not available
        self._format = "asc"
        asc_path = self._file_path.with_suffix(".asc")
        self._file_path = asc_path
        self._file = await aiofiles.open(self._file_path, "w", encoding="utf-8")
        await self._write_asc_header()

    def _write_blf_message(self, msg):
        if self._blf_writer:
            try:
                self._blf_writer(msg)
            except Exception as e:
                logger.debug("BLF write error: %s", e)

    async def _check_rotation(self):
        """Rotate log file if it exceeds max size."""
        if not self._file_path or not self._file_path.exists():
            return
        size = self._file_path.stat().st_size
        if size >= self._max_size_bytes:
            logger.info("Log file size limit reached, rotating")
            fmt = self._format
            prefix = self._file_path.stem.rsplit("_", 2)[0]
            await self.stop()
            await self.start(fmt, prefix)

    def get_status(self) -> dict:
        size = 0
        if self._file_path and self._file_path.exists():
            size = self._file_path.stat().st_size

        return {
            "active": self._active,
            "format": self._format,
            "file": str(self._file_path) if self._file_path else None,
            "filename": self._file_path.name if self._file_path else None,
            "message_count": self._message_count,
            "size_bytes": size,
            "duration": round(time.time() - self._start_time, 1) if self._active else 0,
        }

    def list_files(self) -> list[dict]:
        """List all log files in the log directory."""
        files = []
        if not self._log_dir.exists():
            return files
        for path in sorted(self._log_dir.glob("*.*"), key=lambda p: p.stat().st_mtime, reverse=True):
            if path.suffix in (".asc", ".csv", ".blf"):
                stat = path.stat()
                files.append({
                    "filename": path.name,
                    "size_bytes": stat.st_size,
                    "modified": datetime.fromtimestamp(stat.st_mtime).isoformat(),
                    "path": str(path),
                })
        return files

    def get_storage_info(self) -> dict:
        """Return disk usage for the log directory."""
        try:
            stat = os.statvfs(str(self._log_dir))
            total = stat.f_frsize * stat.f_blocks
            free = stat.f_frsize * stat.f_bavail
            used = total - free

            log_size = sum(
                p.stat().st_size for p in self._log_dir.glob("*.*")
                if p.suffix in (".asc", ".csv", ".blf")
            )
            return {
                "total_bytes": total,
                "free_bytes": free,
                "used_bytes": used,
                "log_size_bytes": log_size,
            }
        except Exception:
            return {}
