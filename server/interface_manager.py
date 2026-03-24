# SPDX-License-Identifier: AGPL-3.0-or-later
"""Interface manager — wraps ip link subprocess calls for CAN interface management."""
import asyncio
import logging
import re
from pathlib import Path

logger = logging.getLogger(__name__)


async def _run(*args) -> tuple[int, str, str]:
    """Run a subprocess command, return (returncode, stdout, stderr)."""
    proc = await asyncio.create_subprocess_exec(
        *args,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    stdout, stderr = await proc.communicate()
    return proc.returncode, stdout.decode(), stderr.decode()


async def list_interfaces() -> list[str]:
    """Return list of CAN/VCAN interface names from /proc/net/dev."""
    interfaces = []
    try:
        proc_net_dev = Path("/proc/net/dev")
        if proc_net_dev.exists():
            text = proc_net_dev.read_text()
            for line in text.splitlines():
                iface = line.split(":")[0].strip()
                if iface.startswith("can") or iface.startswith("vcan"):
                    interfaces.append(iface)
    except Exception as e:
        logger.warning("Failed to read /proc/net/dev: %s", e)

    # Also check via ip link
    if not interfaces:
        rc, out, _ = await _run("ip", "-br", "link", "show")
        if rc == 0:
            for line in out.splitlines():
                parts = line.split()
                if parts:
                    iface = parts[0]
                    if iface.startswith("can") or iface.startswith("vcan"):
                        interfaces.append(iface)

    return sorted(set(interfaces))


async def configure(
    interface: str,
    bitrate: int,
    mode: str = "normal",
    fd_enabled: bool = False,
    dbitrate: int = 2000000,
) -> tuple[bool, str]:
    """Configure and bring up a CAN interface. Returns (success, message)."""

    # Virtual interfaces don't support ip link type can commands
    if interface.startswith("vcan"):
        rc, _, err = await _run("ip", "link", "set", interface, "up")
        if rc == 0:
            return True, f"{interface} is up (virtual)"
        return False, f"Failed to bring up {interface}: {err}"

    # Bring down
    await _run("ip", "link", "set", interface, "down")

    # Build configuration command — restart-ms 100 enables automatic BUS-OFF recovery
    if fd_enabled:
        cmd = [
            "ip", "link", "set", interface, "type", "can",
            "bitrate", str(bitrate),
            "dbitrate", str(dbitrate),
            "fd", "on",
            "restart-ms", "100",
        ]
    else:
        cmd = ["ip", "link", "set", interface, "type", "can", "bitrate", str(bitrate), "restart-ms", "100"]

    rc, _, err = await _run(*cmd)
    if rc != 0:
        return False, f"Failed to configure {interface}: {err}"

    # Apply operating mode — always explicitly set to avoid stale flags
    if mode == "listen-only":
        rc, _, err = await _run("ip", "link", "set", interface, "type", "can", "listen-only", "on")
        if rc != 0:
            logger.warning("Failed to set listen-only: %s", err)
    elif mode == "loopback":
        rc, _, err = await _run("ip", "link", "set", interface, "type", "can", "loopback", "on")
        if rc != 0:
            logger.warning("Failed to set loopback: %s", err)
    else:
        # Normal mode: explicitly clear any previously set flags
        await _run("ip", "link", "set", interface, "type", "can", "listen-only", "off")
        await _run("ip", "link", "set", interface, "type", "can", "loopback", "off")

    # Bring up
    rc, _, err = await _run("ip", "link", "set", interface, "up")
    if rc != 0:
        return False, f"Failed to bring up {interface}: {err}"

    return True, f"{interface} configured and up (bitrate={bitrate})"


async def get_status(interface: str) -> dict:
    """Parse ip -details -statistics link show output for interface status."""
    rc, out, _ = await _run("ip", "-details", "-statistics", "link", "show", interface)
    if rc != 0:
        return {"up": False, "state": "down", "error": "interface not found"}

    status = {
        "up": False,
        "state": "unknown",
        "bitrate": None,
        "dbitrate": None,
        "tec": 0,
        "rec": 0,
        "bus_state": "unknown",
        "mode": "normal",
        "fd": False,
    }

    if "UP" in out:
        status["up"] = True

    # Parse bus state
    m = re.search(r"state\s+(\S+)", out)
    if m:
        status["bus_state"] = m.group(1)
        status["state"] = m.group(1)

    # Parse bitrate
    m = re.search(r"bitrate\s+(\d+)", out)
    if m:
        status["bitrate"] = int(m.group(1))

    # Parse data bitrate (FD)
    m = re.search(r"dbitrate\s+(\d+)", out)
    if m:
        status["dbitrate"] = int(m.group(1))
        status["fd"] = True

    # Parse TEC/REC
    m = re.search(r"txerr\s+(\d+)", out)
    if m:
        status["tec"] = int(m.group(1))
    m = re.search(r"rxerr\s+(\d+)", out)
    if m:
        status["rec"] = int(m.group(1))

    # Parse mode flags
    if "listen-only" in out:
        status["mode"] = "listen-only"
    elif "loopback" in out:
        status["mode"] = "loopback"
    else:
        status["mode"] = "normal"

    return status


def calculate_timing(bitrate: int, clock: int = 40_000_000) -> dict:
    """Calculate CAN timing parameters for given bitrate and oscillator clock."""
    # Target sample point: 87.5% for most CAN controllers
    TARGET_SAMPLE_POINT = 0.875

    best = None
    best_error = float("inf")

    for brp in range(1, 513):
        tq_freq = clock / brp
        total_tqs = round(tq_freq / bitrate)
        if total_tqs < 3 or total_tqs > 385:
            continue
        actual_bitrate = tq_freq / total_tqs
        error = abs(actual_bitrate - bitrate) / bitrate

        # Compute TSEG1+TSEG2 (sync_seg = 1 TQ)
        available = total_tqs - 1  # subtract sync seg
        tseg1 = round(available * TARGET_SAMPLE_POINT)
        tseg2 = available - tseg1
        if tseg1 < 1 or tseg2 < 1:
            continue

        sample_point = (1 + tseg1) / total_tqs
        sp_error = abs(sample_point - TARGET_SAMPLE_POINT)

        score = error + sp_error * 0.1
        if score < best_error:
            best_error = score
            sjw = min(4, tseg2)
            best = {
                "brp": brp,
                "tseg1": tseg1,
                "tseg2": tseg2,
                "sjw": sjw,
                "sample_point": round(sample_point * 100, 2),
                "actual_bitrate": round(actual_bitrate),
                "error_pct": round(error * 100, 4),
            }
        if error < 1e-9:
            break

    return best or {}
