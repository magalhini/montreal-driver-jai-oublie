#!/usr/bin/env bash
# Build the game for https://<host>/neon-driver/ and upload it to the droplet: `npm run deploy`.
# Settings come from .env.deploy (git-ignored, like every .env.*):
#   DEPLOY_HOST=root@203.0.113.10        ssh destination
#   DEPLOY_PATH=/var/www/neon-driver     where nginx serves /neon-driver/ from
#   DEPLOY_SSH_KEY=~/.ssh/id_ed25519     optional: the one key to offer (avoids "too many authentication failures")
# Uploads in three passes so players mid-load never get an index.html pointing at missing files: the new
# hashed assets first, then index.html, then the old files are removed.
set -euo pipefail
cd "$(dirname "$0")/.."

[ -f .env.deploy ] && . ./.env.deploy
: "${DEPLOY_HOST:?set DEPLOY_HOST in .env.deploy}"
: "${DEPLOY_PATH:=/var/www/neon-driver}"
BASE=/neon-driver/
OUT=dist-deploy

SSH=(ssh -o ConnectTimeout=15)
if [ -n "${DEPLOY_SSH_KEY:-}" ]; then SSH+=(-o IdentitiesOnly=yes -i "${DEPLOY_SSH_KEY/#\~/$HOME}"); fi

echo "Building for $BASE ..."
npx tsc --noEmit
# Every build gets the next patch version (package.json); the major and minor numbers are bumped by hand
npm run bump --silent
npx vite build --base="$BASE" --outDir "$OUT" --emptyOutDir

echo "Uploading to $DEPLOY_HOST:$DEPLOY_PATH ..."
"${SSH[@]}" "$DEPLOY_HOST" "mkdir -p '$DEPLOY_PATH'"
# (no --chmod: macOS ships openrsync, which lacks it; permissions are set after the upload)
RSYNC=(rsync -rlz --checksum -e "${SSH[*]}")
"${RSYNC[@]}" --exclude index.html "$OUT/" "$DEPLOY_HOST:$DEPLOY_PATH/"
"${RSYNC[@]}" "$OUT/index.html" "$DEPLOY_HOST:$DEPLOY_PATH/index.html"
"${RSYNC[@]}" --delete "$OUT/" "$DEPLOY_HOST:$DEPLOY_PATH/"
"${SSH[@]}" "$DEPLOY_HOST" "chmod -R u=rwX,go=rX '$DEPLOY_PATH'"

echo "Deployed: http://${DEPLOY_HOST#*@}$BASE"
