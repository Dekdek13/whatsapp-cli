#!/usr/bin/env bash
# wa-start.sh - demarrage macOS / Linux.
#
# Sur macOS, l'application WhatsApp Desktop est une app Catalyst native : elle n'a PAS de moteur
# Chromium, donc pas de port de debogage. Le chemin portable est donc WhatsApp Web dans un
# Chrome lance avec le port de debogage, et un profil dedie pour ne pas toucher au Chrome
# habituel. Le CLI, lui, ne change pas : il cherche simplement l'onglet web.whatsapp.com.
#
# Premiere utilisation : scanner le QR code une fois. La session reste ensuite dans le profil.

set -euo pipefail
PORT="${WA_PORT:-9222}"
PROFIL="${WA_PROFIL:-$HOME/.whatsapp-cli-chrome}"

case "$(uname -s)" in
  Darwin) CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" ;;
  *)      CHROME="$(command -v google-chrome || command -v chromium || command -v chromium-browser)" ;;
esac

if [ ! -x "$CHROME" ]; then
  echo "Chrome introuvable. Installer Google Chrome, ou definir CHROME=<chemin>." >&2
  exit 1
fi

if curl -s --max-time 2 "http://127.0.0.1:$PORT/json/version" >/dev/null 2>&1; then
  echo "port $PORT deja ouvert"
else
  mkdir -p "$PROFIL"
  "$CHROME" \
    --remote-debugging-port="$PORT" \
    --user-data-dir="$PROFIL" \
    --no-first-run --no-default-browser-check \
    "https://web.whatsapp.com" >/dev/null 2>&1 &
  echo "Chrome lance (profil dedie : $PROFIL)"
  for _ in $(seq 1 40); do
    sleep 1
    curl -s --max-time 2 "http://127.0.0.1:$PORT/json/version" >/dev/null 2>&1 && break
  done
fi

if curl -s --max-time 2 "http://127.0.0.1:$PORT/json/list" | grep -q "web.whatsapp.com"; then
  echo "OK : onglet WhatsApp Web detecte, wa.js est utilisable"
else
  echo "Chrome est la mais pas d'onglet WhatsApp Web : ouvrir https://web.whatsapp.com et scanner le QR" >&2
  exit 1
fi
