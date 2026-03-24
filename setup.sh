#!/bin/bash
# PiCAN Studio — One-shot setup script for Raspberry Pi
# Usage: sudo bash setup.sh [--adapter=mcp|candlelight]
set -e

INSTALL_DIR="/opt/pican-studio"
SERVICE_FILE="pican-studio.service"

# Adapter type: mcp (MCP2518FD via SPI, default) or candlelight (USB gs_usb)
ADAPTER="mcp"
for arg in "$@"; do
  case "$arg" in
    --adapter=*) ADAPTER="${arg#--adapter=}" ;;
  esac
done

if [ "$ADAPTER" != "mcp" ] && [ "$ADAPTER" != "candlelight" ]; then
  echo "Unknown adapter: $ADAPTER. Use --adapter=mcp or --adapter=candlelight"
  exit 1
fi

# Colors
GREEN='\033[0;32m'
AMBER='\033[0;33m'
RED='\033[0;31m'
NC='\033[0m'

info()  { echo -e "${GREEN}[INFO]${NC}  $*"; }
warn()  { echo -e "${AMBER}[WARN]${NC}  $*"; }
error() { echo -e "${RED}[ERROR]${NC} $*"; exit 1; }

if [ "$EUID" -ne 0 ]; then
  error "Please run as root: sudo bash setup.sh"
fi

info "PiCAN Studio Setup (adapter: ${ADAPTER})"
echo "========================================"

# 1. Check for Pi (optional — allow on non-Pi for development)
if grep -q "Raspberry Pi" /proc/cpuinfo 2>/dev/null; then
  info "Detected Raspberry Pi"
else
  warn "Not running on a Raspberry Pi — hardware features may not be available"
fi

# 2. Install system dependencies
info "Installing system packages..."
apt-get update -qq
apt-get install -y -qq can-utils python3-venv python3-dev python3-pip

# 3. Create install directory and copy files
info "Installing to ${INSTALL_DIR}..."
mkdir -p "${INSTALL_DIR}"
rsync -a --exclude='.git' --exclude='__pycache__' --exclude='*.pyc' \
  "$(dirname "$0")/" "${INSTALL_DIR}/"
chmod +x "${INSTALL_DIR}/scripts/setup-can.sh"

# 4. Create Python venv and install dependencies
info "Creating Python virtual environment..."
python3 -m venv "${INSTALL_DIR}/venv"
"${INSTALL_DIR}/venv/bin/pip" install --quiet --upgrade pip
"${INSTALL_DIR}/venv/bin/pip" install --quiet -r "${INSTALL_DIR}/requirements.txt"
info "Python dependencies installed"

# 5. Create log directory
mkdir -p "${INSTALL_DIR}/logs"
mkdir -p "${INSTALL_DIR}/config"

# Copy default config if not present
if [ ! -f "${INSTALL_DIR}/config/runtime.json" ]; then
  cp "${INSTALL_DIR}/config/default.json" "${INSTALL_DIR}/config/interface.json" 2>/dev/null || true
fi

# 6. Configure boot/config.txt (only on Pi with hardware)
if [ -f /boot/firmware/config.txt ]; then
  CONFIG_TXT="/boot/firmware/config.txt"
elif [ -f /boot/config.txt ]; then
  CONFIG_TXT="/boot/config.txt"
else
  CONFIG_TXT=""
  warn "Could not find config.txt — skipping hardware configuration"
fi

if [ -n "$CONFIG_TXT" ] && [ "$ADAPTER" = "mcp" ]; then
  info "Configuring ${CONFIG_TXT} for MCP2518FD..."

  # Enable SPI if not already on
  if ! grep -q "^dtparam=spi=on" "$CONFIG_TXT"; then
    echo "dtparam=spi=on" >> "$CONFIG_TXT"
    info "Enabled SPI in ${CONFIG_TXT}"
  fi

  # Add MCP251xFD overlay if not already present
  if ! grep -q "mcp251xfd" "$CONFIG_TXT"; then
    echo "" >> "$CONFIG_TXT"
    echo "# PiCAN Studio — MCP251xFD CAN-FD controller" >> "$CONFIG_TXT"
    echo "dtoverlay=mcp251xfd,spi0-0,oscillator=40000000,interrupt=25" >> "$CONFIG_TXT"
    echo "dtparam=spidev.bufsiz=65536" >> "$CONFIG_TXT"
    info "Added MCP251xFD overlay to ${CONFIG_TXT}"
  else
    info "MCP251xFD overlay already present in ${CONFIG_TXT}"
  fi
fi

if [ -n "$CONFIG_TXT" ]; then
  # GPU memory split (headless Pi) — useful for all adapter types
  if ! grep -q "gpu_mem=16" "$CONFIG_TXT"; then
    echo "gpu_mem=16" >> "$CONFIG_TXT"
    info "Set GPU memory to 16MB"
  fi
fi

# 7. Disable Bluetooth if not needed
if systemctl is-active --quiet bluetooth 2>/dev/null; then
  systemctl disable bluetooth 2>/dev/null || true
  info "Disabled Bluetooth service"
fi

# 8. Install systemd service
info "Installing systemd service..."
cp "${INSTALL_DIR}/pican-studio.service" /etc/systemd/system/
systemctl daemon-reload
systemctl enable pican-studio
info "Service enabled (pican-studio)"

# Get IP and hostname
HOSTNAME=$(hostname)
IP=$(hostname -I 2>/dev/null | awk '{print $1}' || echo "unknown")

echo ""
echo "╔══════════════════════════════════════════════╗"
echo "║  PiCAN Studio is ready!                      ║"
echo "║  Access from your browser:                   ║"
echo "║  → http://${HOSTNAME}.local:8080             "
echo "║  → http://${IP}:8080                         "
echo "╠══════════════════════════════════════════════╣"
echo "║  Default: CAN 2.0, 500 kbit/s, Normal mode  ║"
echo "║  Configure everything from the Settings tab  ║"
echo "╚══════════════════════════════════════════════╝"
echo ""
info "To start now:  sudo systemctl start pican-studio"
info "To view logs:  journalctl -u pican-studio -f"

if [ "$ADAPTER" = "mcp" ] && grep -q "Raspberry Pi" /proc/cpuinfo 2>/dev/null; then
  echo ""
  warn "A reboot is required to activate the SPI overlay and CAN interface."
  echo "  → sudo reboot"
elif [ "$ADAPTER" = "candlelight" ]; then
  echo ""
  info "No reboot needed. Plug in the CandleLight adapter and start the service:"
  echo "  → sudo systemctl start pican-studio"
fi
