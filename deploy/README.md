# Deploying fyers_algo to a single DigitalOcean droplet

This directory bundles the artifacts you `scp` to the server. The full
narrative is in [`~/.claude/plans/if-i-run-this-hazy-biscuit.md`](../../../.claude/plans/if-i-run-this-hazy-biscuit.md);
this README is the operational checklist.

## What's in here

| File | Purpose |
|------|---------|
| `systemd/fyers-node.service` | systemd unit for the Node backend (Fastify + Fyers WS + aggregator). |
| `systemd/fyers-engine.service` | systemd unit for the Python strategy engine. |
| `systemd/fyers-frontend.service` | systemd unit for the Next.js production server. |
| `Caddyfile.example` | Reverse proxy + TLS + HTTP basic auth for `dashboard.<domain>` and `api.<domain>`. |
| `Caddyfile.local` | Same but for `dashboard.localhost` / `api.localhost` with Caddy's internal CA — used for local staging. |
| [`LOCAL_STAGING.md`](LOCAL_STAGING.md) | Walkthrough for validating the deploy artifacts on your laptop before provisioning the droplet. |

Plus, in [scripts/deploy.sh](../scripts/deploy.sh): a one-shot redeploy helper
to run on the droplet after a `git pull`.

## Topology

Everything runs on **one** Ubuntu 24.04 droplet (2 GB / 2 vCPU is enough):

```
dashboard.<domain>  ──┐
                      ├─► Caddy :443 (TLS + basicauth)
api.<domain>        ──┘        │
                               ├─► Next :3000  (fyers-frontend)
                               └─► Node :4000  (fyers-node)
                                       │
                                       ├─► Python engine (fyers-engine)
                                       │   via Redis pub/sub
                                       │
                                       ├─► Postgres :5432   (local)
                                       └─► Redis    :6379   (local)
```

Only **22, 80, 443** are exposed; 3000/4000/5432/6379 stay on `127.0.0.1`.

## Setup checklist (~30 min, one-time)

### Prerequisites
- DigitalOcean droplet: Basic, 2 GB RAM, Ubuntu 24.04 LTS, SGP1 region.
- A domain with **two A records** pointed at the droplet IP:
  - `dashboard.<yourdomain>` → droplet IP
  - `api.<yourdomain>` → droplet IP
- SSH key uploaded to the droplet at create time.

### Step 1 — harden + create `algo` user
```bash
ssh root@<droplet-ip>
adduser algo && usermod -aG sudo algo
mkdir -p /home/algo/.ssh && cp ~/.ssh/authorized_keys /home/algo/.ssh/
chown -R algo:algo /home/algo/.ssh && chmod 700 /home/algo/.ssh && chmod 600 /home/algo/.ssh/authorized_keys
sed -i 's/^#\?PermitRootLogin.*/PermitRootLogin no/' /etc/ssh/sshd_config
sed -i 's/^#\?PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
systemctl restart ssh
ufw allow OpenSSH && ufw allow 80/tcp && ufw allow 443/tcp && ufw --force enable
apt update && apt -y install unattended-upgrades && dpkg-reconfigure -plow unattended-upgrades
exit
```
Re-login as `algo` for the rest.

### Step 2 — install runtimes
```bash
sudo apt update
sudo apt -y install build-essential git curl ca-certificates gnupg \
    python3.12 python3.12-venv python3-pip \
    postgresql postgresql-contrib redis-server

# Node 20 LTS
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt -y install nodejs

# Caddy 2
sudo apt -y install debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
  | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
  | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update && sudo apt -y install caddy
```

### Step 3 — clone + configure
```bash
cd ~ && git clone <your-repo-url> fyers_algo && cd fyers_algo

cp .env.example .env
nano .env
# Set:
#   POSTGRES_HOST=127.0.0.1   REDIS_HOST=127.0.0.1
#   NODE_BACKEND_HOST=127.0.0.1
#   DASHBOARD_ORIGIN=https://dashboard.<yourdomain>
#   POSTGRES_PASSWORD=<pick>  REDIS_PASSWORD=<pick>
#   FYERS_CLIENT_ID, FYERS_SECRET_KEY, FYERS_REDIRECT_URL, WATCHLIST

# Frontend points at api.<domain>
echo "NEXT_PUBLIC_API_BASE=https://api.<yourdomain>" > next_frontend/.env.local

# Python venv at the project root (matches the path in fyers-engine.service)
python3.12 -m venv .venv
source .venv/bin/activate && pip install -r requirements.txt && deactivate

# Node deps
( cd node_backend && npm ci )
( cd next_frontend && npm ci )
```

### Step 4 — local Postgres + Redis
```bash
# Postgres
sudo -u postgres psql -c "ALTER USER postgres WITH PASSWORD '<value from .env>';"
./scripts/init_db.sh                 # creates fyers_algo + applies migrations

# Redis password
sudo sed -i "s|^# requirepass .*|requirepass <value from .env>|" /etc/redis/redis.conf
sudo systemctl restart redis-server

# Sanity
psql -h 127.0.0.1 -U postgres -d fyers_algo -c "\dt"
redis-cli -a <pwd> ping
```

### Step 5 — build the dashboard for production
```bash
( cd next_frontend && npm run build )
```

### Step 6 — install systemd units
```bash
sudo cp deploy/systemd/*.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now fyers-frontend fyers-engine fyers-node
```
`fyers-node` will crash-loop until the first Fyers token exists in Redis — that's expected; continue.

### Step 7 — Caddy + TLS + basic auth
```bash
caddy hash-password                  # paste your password twice → bcrypt hash
sudo cp deploy/Caddyfile.example /etc/caddy/Caddyfile
sudoedit /etc/caddy/Caddyfile        # replace <yourdomain> + <bcrypt-hash>
sudo systemctl reload caddy
```
Certificates issue automatically on first HTTPS hit.

### Step 8 — first Fyers token
```bash
source .venv/bin/activate
python -m app_token.generate_token
# Script prints an auth URL. Open it in your laptop browser, log in.
# Fyers redirects to FYERS_REDIRECT_URL with ?auth_code=...
# Copy the auth_code value, paste it into the SSH terminal.

sudo systemctl restart fyers-node    # picks up the new token
```

### Step 9 — verify
```bash
curl -u algo:<password> https://api.<yourdomain>/health
# → {"status":"ok"}

# In a browser:
open https://dashboard.<yourdomain>
# Prompts for basic auth, then the dashboard loads.

# Synthetic signal (no market data needed):
redis-cli -a <pwd> PUBLISH signal.NSE:RELIANCE-EQ \
  '{"symbol":"NSE:RELIANCE-EQ","side":"BUY","price":2904.5,"candle_ts":"2026-05-11T10:23:00+05:30","strategy":"ema_crossover","reason":{}}'
# Appears in the Live Signals card within ~1s.
```

## Daily ritual (trading days, before 09:15 IST)

```bash
ssh algo@<droplet>
cd ~/fyers_algo && source .venv/bin/activate
python -m app_token.generate_token   # ~30s interactive
sudo systemctl restart fyers-node
```
The engine + frontend keep running across days; only the Node backend needs to re-read the new token.

## Redeploying after code changes

```bash
ssh algo@<droplet>
cd ~/fyers_algo
./scripts/deploy.sh                  # git pull + npm ci + build + systemctl restart
```

## Operational cheatsheet

```bash
# Logs (live tail)
journalctl -u fyers-node -f
journalctl -u fyers-engine -f
journalctl -u fyers-frontend -f
journalctl -u caddy -f

# Restart one service
sudo systemctl restart fyers-node

# Status snapshot
systemctl status fyers-node fyers-engine fyers-frontend caddy

# Backup-only: DigitalOcean weekly snapshots (enable in the droplet's control panel)
# Manual pg backup:
pg_dump -h 127.0.0.1 -U postgres fyers_algo | gzip > ~/backups/fyers_algo_$(date +%F).sql.gz
```

## Cost
| Item | Cost |
|------|------|
| Droplet (Basic 2 GB) | $12/mo |
| Weekly backups | $2.40/mo |
| Domain | varies (~$10/yr) |
| TLS (Let's Encrypt via Caddy) | $0 |
| **Total** | **~$15/mo** |
