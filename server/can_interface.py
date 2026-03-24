# SPDX-License-Identifier: AGPL-3.0-or-later
"""CAN interface wrapper using python-can SocketCAN."""
import asyncio
import logging
import time
from typing import Callable, Optional

try:
    import can
    CAN_AVAILABLE = True
except ImportError:
    CAN_AVAILABLE = False
    can = None  # type: ignore

logger = logging.getLogger(__name__)


class CANInterface:
    def __init__(self):
        self._bus: Optional[object] = None
        self._channel: str = "can0"
        self._running: bool = False
        self._rx_task: Optional[asyncio.Task] = None
        self._rx_callback: Optional[Callable] = None
        self._executor = None
        self.start_time: Optional[float] = None   # monotonic, for uptime
        self.capture_epoch: Optional[float] = None  # Unix epoch, for timestamp math

    def set_rx_callback(self, callback: Callable):
        self._rx_callback = callback

    async def start(self, channel: str) -> tuple[bool, str]:
        """Open the CAN bus and start the RX loop."""
        if self._running:
            await self.stop()

        self._channel = channel
        if not CAN_AVAILABLE:
            logger.warning("python-can not available — using simulation mode")
            self._running = True
            self.start_time = time.monotonic()
            self.capture_epoch = time.time()
            self._rx_task = asyncio.create_task(self._simulated_rx_loop())
            return True, "Started in simulation mode (python-can not installed)"

        try:
            self._bus = can.interface.Bus(
                channel=channel,
                interface="socketcan",
                fd=True,
            )
            self._running = True
            self.start_time = time.monotonic()
            self.capture_epoch = time.time()
            self._rx_task = asyncio.create_task(self._rx_loop())
            logger.info("CAN interface started on %s", channel)
            return True, f"Started on {channel}"
        except Exception as e:
            logger.error("Failed to open CAN interface %s: %s", channel, e)
            return False, str(e)

    async def stop(self):
        """Stop RX loop and close the bus."""
        self._running = False
        if self._rx_task:
            self._rx_task.cancel()
            try:
                await self._rx_task
            except asyncio.CancelledError:
                pass
            self._rx_task = None

        if self._bus:
            try:
                self._bus.shutdown()
            except Exception as e:
                logger.warning("Error shutting down bus: %s", e)
            self._bus = None

        self.start_time = None
        self.capture_epoch = None
        logger.info("CAN interface stopped")

    async def _rx_loop(self):
        """Read CAN messages in executor to avoid blocking the event loop."""
        loop = asyncio.get_event_loop()
        while self._running:
            try:
                msg = await loop.run_in_executor(None, self._recv_one)
                if msg is not None and self._rx_callback:
                    await self._rx_callback(msg)
            except asyncio.CancelledError:
                break
            except can.CanError as e:
                logger.error("CAN error: %s", e)
                await asyncio.sleep(0.1)
            except Exception as e:
                logger.error("Unexpected RX error: %s", e)
                await asyncio.sleep(0.1)

    def _recv_one(self):
        """Blocking receive call (runs in executor)."""
        try:
            return self._bus.recv(timeout=0.1)
        except Exception:
            return None

    async def _simulated_rx_loop(self):
        """Generate synthetic CAN frames when hardware is unavailable."""
        import random
        counter = 0
        while self._running:
            await asyncio.sleep(0.01)
            counter += 1

            # Create a mock message object
            class MockMsg:
                def __init__(self):
                    self.arbitration_id = random.choice([0x100, 0x1A3, 0x200, 0x7DF, 0x18FF00FE])
                    self.is_extended_id = self.arbitration_id > 0x7FF
                    self.is_fd = random.random() < 0.1
                    self.bitrate_switch = self.is_fd
                    self.error_state_indicator = False
                    self.dlc = 8
                    self.data = bytearray([random.randint(0, 255) for _ in range(8)])
                    self.is_error_frame = False
                    self.is_remote_frame = False
                    self.timestamp = time.time()

            if self._rx_callback:
                await self._rx_callback(MockMsg())

    async def send(self, arbitration_id: int, data: bytes, is_extended_id: bool = False,
                   is_fd: bool = False, bitrate_switch: bool = False) -> tuple[bool, str]:
        """Send a CAN message."""
        if not CAN_AVAILABLE:
            logger.debug("Simulated TX: id=0x%X data=%s", arbitration_id, data.hex())
            if self._rx_callback:
                class _TxMsg:
                    pass
                m = _TxMsg()
                m.arbitration_id = arbitration_id
                m.data = bytearray(data)
                m.dlc = len(data)
                m.is_extended_id = is_extended_id
                m.is_fd = is_fd
                m.bitrate_switch = bitrate_switch
                m.error_state_indicator = False
                m.is_error_frame = False
                m.timestamp = time.time()
                m.is_tx = True
                await self._rx_callback(m)
            return True, "sent (simulated)"

        if not self._bus:
            return False, "CAN interface not started"

        try:
            msg = can.Message(
                arbitration_id=arbitration_id,
                data=data,
                is_extended_id=is_extended_id,
                is_fd=is_fd,
                bitrate_switch=bitrate_switch,
                check=True,
            )
            loop = asyncio.get_event_loop()
            await loop.run_in_executor(None, self._bus.send, msg)
        except Exception as e:
            logger.error("TX error: %s", e)
            return False, str(e)

        if self._rx_callback:
            import types
            echo = types.SimpleNamespace(
                arbitration_id=arbitration_id,
                data=bytearray(data),
                dlc=len(data),
                is_extended_id=is_extended_id,
                is_fd=is_fd,
                bitrate_switch=bitrate_switch,
                error_state_indicator=False,
                is_error_frame=False,
                timestamp=time.time(),
                is_tx=True,
            )
            try:
                await self._rx_callback(echo)
            except Exception as e:
                logger.warning("TX echo callback error: %s", e)
        return True, "sent"

    @property
    def is_running(self) -> bool:
        return self._running

    @property
    def channel(self) -> str:
        return self._channel

    def uptime(self) -> float:
        if self.start_time is None:
            return 0.0
        return time.monotonic() - self.start_time
