#!/bin/bash
# Bring up CAN interface with saved or default configuration
# Called by systemd ExecStartPre and by the app when restarting the interface

set -e

CONFIG_FILE="/opt/pican-studio/config/runtime.json"
# Fall back to interface.json for backward compat
[ -f "$CONFIG_FILE" ] || CONFIG_FILE="/opt/pican-studio/config/interface.json"

# Parse JSON config if it exists, otherwise use defaults
if [ -f "$CONFIG_FILE" ] && command -v python3 &>/dev/null; then
    BITRATE=$(python3 -c "import json; c=json.load(open('$CONFIG_FILE')); print(c.get('bitrate', 500000))" 2>/dev/null || echo 500000)
    MODE=$(python3 -c "import json; c=json.load(open('$CONFIG_FILE')); print(c.get('mode', 'normal'))" 2>/dev/null || echo normal)
    FD_ENABLED=$(python3 -c "import json; c=json.load(open('$CONFIG_FILE')); print(str(c.get('fd_enabled', False)).lower())" 2>/dev/null || echo false)
    DBITRATE=$(python3 -c "import json; c=json.load(open('$CONFIG_FILE')); print(c.get('dbitrate', 2000000))" 2>/dev/null || echo 2000000)
    INTERFACE=$(python3 -c "import json; c=json.load(open('$CONFIG_FILE')); print(c.get('interface', 'can0'))" 2>/dev/null || echo can0)
else
    BITRATE=${BITRATE:-500000}
    MODE=${MODE:-normal}
    FD_ENABLED=${FD_ENABLED:-false}
    DBITRATE=${DBITRATE:-2000000}
    INTERFACE=${INTERFACE:-can0}
fi

# Skip for virtual interfaces
if [[ "$INTERFACE" == vcan* ]]; then
    echo "Virtual interface $INTERFACE — loading vcan module and bringing up"
    modprobe vcan 2>/dev/null || true
    ip link add dev "$INTERFACE" type vcan 2>/dev/null || true
    ip link set "$INTERFACE" up
    echo "$INTERFACE is up (virtual)"
    exit 0
fi

echo "Configuring $INTERFACE: bitrate=$BITRATE mode=$MODE fd=$FD_ENABLED"

# Wait for interface to appear — needed for USB adapters (gs_usb/CandleLight)
if ! ip link show "$INTERFACE" &>/dev/null; then
    echo "Waiting for $INTERFACE..."
    for i in $(seq 1 10); do
        sleep 1
        ip link show "$INTERFACE" &>/dev/null && break
        if [ "$i" -eq 10 ]; then
            echo "WARNING: $INTERFACE not found after 10s — skipping setup"
            exit 0   # non-fatal: app starts in simulation mode, user can configure from UI
        fi
    done
fi

# Bring down if already up
ip link set "$INTERFACE" down 2>/dev/null || true

# Configure
if [ "$FD_ENABLED" = "true" ]; then
    ip link set "$INTERFACE" type can bitrate "$BITRATE" dbitrate "$DBITRATE" fd on restart-ms 100
else
    ip link set "$INTERFACE" type can bitrate "$BITRATE" restart-ms 100
fi

# Apply operating mode — always explicitly set to avoid stale flags from previous runs
case "$MODE" in
    listen-only)
        ip link set "$INTERFACE" type can listen-only on
        ;;
    loopback)
        ip link set "$INTERFACE" type can loopback on
        ;;
    *)
        # Normal mode: explicitly clear any previously set flags
        ip link set "$INTERFACE" type can listen-only off 2>/dev/null || true
        ip link set "$INTERFACE" type can loopback off 2>/dev/null || true
        ;;
esac

ip link set "$INTERFACE" up
echo "$INTERFACE is up"
