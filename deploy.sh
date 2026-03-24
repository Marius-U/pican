#!/bin/bash
# Deploy PiCAN Studio from dev machine to Raspberry Pi
# Usage: ./deploy.sh -mcp|-candlelight -target user@IP [--no-restart]

PI_PATH="/opt/pican-studio"
LOCAL_PATH="$(dirname "$0")/"

PROFILE=""
PI_HOST=""
NO_RESTART=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    -mcp)         PROFILE="mcp" ;;
    -candlelight) PROFILE="candlelight" ;;
    -target)      PI_HOST="$2"; shift ;;
    --no-restart) NO_RESTART=true ;;
    *)
      echo "Unknown argument: $1"
      ;;
  esac
  shift
done

if [ -z "$PROFILE" ] || [ -z "$PI_HOST" ]; then
  echo "Usage: $0 -mcp|-candlelight -target user@IP [--no-restart]"
  echo ""
  echo "  -mcp          MCP2518FD via SPI (Pi 3B+)"
  echo "  -candlelight  CandleLight USB CAN adapter (Pi 4, gs_usb)"
  echo "  -target       SSH destination, e.g. umari@192.168.100.31"
  echo "  --no-restart  Sync files only, do not restart the service"
  exit 1
fi

echo "Profile: ${PROFILE} | Target: ${PI_HOST}"
echo "Syncing to ${PI_HOST}:${PI_PATH} ..."

rsync -avz --progress \
  --exclude='*.pyc' \
  --exclude='__pycache__' \
  --exclude='.git' \
  --exclude='logs/' \
  --exclude='config/runtime.json' \
  "${LOCAL_PATH}" \
  "${PI_HOST}:${PI_PATH}/"

if [ $? -ne 0 ]; then
  echo "rsync failed!"
  exit 1
fi

echo "Sync complete."

if [ "$NO_RESTART" = false ]; then
  echo "Restarting pican-studio service..."
  ssh "${PI_HOST}" "sudo systemctl restart pican-studio && sudo systemctl status pican-studio --no-pager -l"
fi

echo "Done! → http://$(ssh ${PI_HOST} hostname -I 2>/dev/null | awk '{print $1}' || echo "${PI_HOST}"):8080"
