#!/bin/sh
cd "$(dirname "$0")" || exit 1
if command -v node >/dev/null 2>&1; then
  exec node serve.mjs "$@"
elif command -v python3 >/dev/null 2>&1; then
  exec python3 serve.py "$@"
elif command -v python >/dev/null 2>&1; then
  exec python serve.py "$@"
fi
echo
echo "Could not find Node.js or Python on this computer."
echo "Install one of them (nodejs.org or python.org), or upload this folder to a web host."
echo "See HOW-TO-PLAY.txt for the hosting option."
exit 1
