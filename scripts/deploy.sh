#!/usr/bin/env bash
# Redeploy fyers_algo on the droplet after a `git pull`.
#
# Pulls latest, reinstalls deps, rebuilds the dashboard, and restarts the
# three systemd services. Assumes the layout described in deploy/README.md:
#   user        : algo
#   project root: /home/algo/fyers_algo
#   venv        : /home/algo/fyers_algo/.venv
#
# Usage:
#   ./scripts/deploy.sh              # full redeploy (default)
#   ./scripts/deploy.sh --skip-pull  # skip `git pull` (e.g. when rsyncing instead)

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_ROOT"

SKIP_PULL=0
case "${1:-}" in
  --skip-pull) SKIP_PULL=1 ;;
  ""|--full)   ;;
  *) echo "unknown arg: $1 (use --skip-pull or no args)" >&2; exit 2 ;;
esac

if [[ "$SKIP_PULL" -eq 0 ]]; then
  echo ">> git pull"
  git pull --ff-only
fi

echo ">> node deps (node_backend)"
( cd node_backend && npm ci )

echo ">> python deps"
# shellcheck disable=SC1091
source .venv/bin/activate
pip install -r requirements.txt
deactivate

echo ">> frontend deps + production build"
( cd next_frontend && npm ci && npm run build )

echo ">> restarting services"
sudo systemctl restart fyers-node fyers-engine fyers-frontend

echo ">> service status (last 3 lines each)"
for svc in fyers-node fyers-engine fyers-frontend; do
  echo "--- $svc ---"
  systemctl is-active "$svc" && true
  journalctl -u "$svc" -n 3 --no-pager || true
done

echo ">> done. Tail logs with: journalctl -u fyers-node -f"
