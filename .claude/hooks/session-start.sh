#!/bin/bash
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

if [ ! -d "$CLAUDE_PROJECT_DIR/node_modules" ]; then
  echo "Installing npm dependencies..."
  npm --prefix "$CLAUDE_PROJECT_DIR" install
fi
