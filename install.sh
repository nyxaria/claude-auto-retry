#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

npm install -g .

echo ""
claude-auto-retry version
echo "installed. Run 'claude-auto-retry install' to set up the shell wrapper."
