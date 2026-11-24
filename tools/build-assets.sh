#!/bin/sh
set -eu
root=$(CDPATH='' cd -- "$(dirname "$0")/.." && pwd)
bin=${ESBUILD:-esbuild}
[ "$("$bin" --version)" = "0.24.2" ] || { echo "Use esbuild 0.24.2" >&2; exit 1; }
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
cat "$root/android-sources/mobile.js" "$root/android-sources/workstation.js" > "$tmp/station.js"
cat "$root/android-sources/store.js" "$root/android-sources/routes.js" > "$tmp/engine.js"
"$bin" "$tmp/station.js" --target=chrome66 --outfile="$root/app/src/main/assets/web/app.js"
"$bin" "$tmp/engine.js" --target=es2019 --outfile="$root/app/src/main/assets/engine/cafe.js"
