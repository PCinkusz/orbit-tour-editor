#!/usr/bin/env bash
# Publish an exported tour (the html5-export folder) to GitHub Pages.
#   scripts/deploy-pages.sh <export-folder> <repo-name>
# Creates the public repository if it does not exist, force-pushes ONE commit to the gh-pages branch
# (so the repository never grows by 400 MB per redeploy) and enables Pages. Requires: git, gh (logged in).
set -euo pipefail

SRC="${1:?usage: deploy-pages.sh <export-folder> <repo-name>}"
REPO="${2:?usage: deploy-pages.sh <export-folder> <repo-name>}"
[ -f "$SRC/index.html" ] && [ -f "$SRC/tour.json" ] || { echo "not an exported tour: $SRC (needs index.html and tour.json)"; exit 2; }

OWNER="$(gh api user --jq .login)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

cp -r "$SRC"/. "$WORK"/
# the local launchers are not needed on a web host
rm -f "$WORK"/serve.mjs "$WORK"/serve.py "$WORK"/start-windows.bat "$WORK"/start-mac-linux.sh "$WORK"/HOW-TO-PLAY.txt
touch "$WORK/.nojekyll"

cd "$WORK"
git init -q -b gh-pages
git config user.name "$(git config --global user.name 2>/dev/null || echo "$OWNER")"
git config user.email "$(git config --global user.email 2>/dev/null || echo "$OWNER@users.noreply.github.com")"
git add -A
git commit -q -m "Publish 360 tour"

if ! gh repo view "$OWNER/$REPO" >/dev/null 2>&1; then
  gh repo create "$OWNER/$REPO" --public --description "Interactive 360° video tour (WebXR). Built with Orbit." >/dev/null
  echo "created https://github.com/$OWNER/$REPO"
fi

git remote add origin "https://github.com/$OWNER/$REPO.git"
git -c http.postBuffer=524288000 -c credential.helper= -c "credential.helper=!gh auth git-credential" push --force origin gh-pages

# turn Pages on (409 = already enabled)
gh api -X POST "repos/$OWNER/$REPO/pages" -f "source[branch]=gh-pages" -f "source[path]=/" >/dev/null 2>&1 || true

echo "Published: https://$OWNER.github.io/$REPO/"
