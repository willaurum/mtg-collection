#!/usr/bin/env bash
# First-time setup on a Raspberry Pi. Run from the repository root:
#   bash deploy/setup-pi.sh
set -euo pipefail

DATA_DIR="${MTG_DATA_DIR:-$HOME/mtg-data}"
APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "Application : $APP_DIR"
echo "Data        : $DATA_DIR"

sudo apt-get update
sudo apt-get install -y python3-venv python3-pip

python3 -m venv "$APP_DIR/.venv"
"$APP_DIR/.venv/bin/pip" install --upgrade pip
"$APP_DIR/.venv/bin/pip" install flask gunicorn

mkdir -p "$DATA_DIR"
chmod 700 "$DATA_DIR"

cd "$APP_DIR"
MTG_DATA_DIR="$DATA_DIR" "$APP_DIR/.venv/bin/python" manage.py initdb

cat <<NOTE

Next:
  1. Create your account:
       MTG_DATA_DIR=$DATA_DIR $APP_DIR/.venv/bin/python manage.py adduser <name>
  2. Install the service (edit User/paths in the unit first if they differ):
       sudo cp deploy/mtgviewer.service /etc/systemd/system/
       sudo systemctl daemon-reload && sudo systemctl enable --now mtgviewer
  3. Open http://$(hostname).local:8000 from any machine on the network.

NOTE
