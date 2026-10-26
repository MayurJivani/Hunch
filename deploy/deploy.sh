#!/bin/sh
# Build here, ship what runs to Jinx, restart. Re-runnable, no arguments.
# Same shape as FRC/Dabber/deploy/deploy.sh: no Docker, passwordless sudo on the box.
#
# The first run also installs the unit and the site block. No env file: nothing
# here is secret, the unit carries PORT. The public hostname is a
# Cloudflare dashboard step: Zero Trust > Tunnels > Public Hostname,
# hunch.futile.studio -> http://localhost:80.
set -eu
cd "$(dirname "$0")/.."
HOST=${HOST:-ssh.futile.studio}
NAME=hunch
SITE=hunch.futile.studio

# Ship committed code only, so uncommitted work never goes live by accident.
BUILD=$(mktemp -d)
trap 'rm -rf "$BUILD"' EXIT
git archive HEAD | tar x -C "$BUILD"
cd "$BUILD"
npm ci --no-audit --no-fund --loglevel=error
npm run build
tar czf $NAME.tgz package.json package-lock.json dist server shared

scp -q deploy/$NAME.caddy deploy/$NAME.service $NAME.tgz "$HOST":/tmp/
ssh "$HOST" "NAME=$NAME SITE=$SITE sh -s" <<'BOX'
set -eu
if ! cmp -s "/tmp/$NAME.service" "/etc/systemd/system/$NAME.service"; then
  sudo -n install -m 644 "/tmp/$NAME.service" "/etc/systemd/system/$NAME.service"
  sudo -n systemctl daemon-reload
  sudo -n systemctl enable -q "$NAME"
fi
rm -f "/tmp/$NAME.service"

LIVE=/etc/caddy/conf.d/$NAME.caddy
IN=/tmp/$NAME.caddy
if cmp -s "$IN" "$LIVE"; then
  rm -f "$IN"
else
  # Imported into the config serving every site: validate, and restore on failure.
  sudo -n cp "$LIVE" "$IN.prev" 2>/dev/null || true
  sudo -n install -m 644 "$IN" "$LIVE" && rm -f "$IN"
  if ! caddy validate --adapter caddyfile --config /etc/caddy/Caddyfile >/dev/null 2>&1; then
    if [ -f "$IN.prev" ]; then sudo -n mv "$IN.prev" "$LIVE"; else sudo -n rm -f "$LIVE"; fi
    echo "$NAME: site block rejected by caddy validate, config unchanged" >&2
    exit 1
  fi
  sudo -n rm -f "$IN.prev"
  sudo -n systemctl reload caddy
fi

mkdir -p /opt/apps/Hunch && cd /opt/apps/Hunch
# data/ holds the public hunt state; it outlives deploys.
find . -mindepth 1 -maxdepth 1 ! -name node_modules ! -name data -exec rm -rf {} +
tar xzf "/tmp/$NAME.tgz" && rm -f "/tmp/$NAME.tgz"
npm ci --omit=dev --no-audit --no-fund --loglevel=error
sudo -n systemctl restart "$NAME"
for _ in $(seq 1 30); do
  curl -sf -o /dev/null -H "Host: $SITE" http://127.0.0.1/ && break
  sleep 1
done
curl -sf -o /dev/null -H "Host: $SITE" http://127.0.0.1/
BOX
echo "$NAME: deployed; live at https://$SITE"
