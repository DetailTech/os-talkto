# Local Quick Start (Workstation + ADB)

Run TalkTo on your local machine with Oracle Autonomous Database.

## 1) Prerequisites

- Node.js 20+
- npm
- Network access to your ADB endpoint

Check:

```bash
node -v
npm -v
```

## 2) Set Up Oracle Autonomous Database

1. Create/identify an ADB instance in OCI.
2. Confirm network ACL/security rules allow your workstation egress to ADB.
3. Choose service name (`_low` recommended for initial setup).

Recommended walletless connect string format:

```text
adb.us-ashburn-1.oraclecloud.com:1522/<SERVICE_NAME>?protocol=tcps&ssl_server_dn_match=yes&connect_timeout=15&transport_connect_timeout=3&retry_count=2&retry_delay=2
```

Example `<SERVICE_NAME>`:

```text
mrj6p3vkk4ramuu_adbtalkto_low.adb.oraclecloud.com
```

## 3) Configure Local Environment

Copy env template:

```bash
cp .env.local.example .env.local
```

Edit `.env.local`:

```env
ENCRYPTION_KEY=<64-char-hex>
AUTH_SECRET=<64-char-hex>

# Optional bootstrap admin (used only if local user store is empty)
LOCAL_ADMIN_EMAIL=admin@example.com
LOCAL_ADMIN_PASSWORD=<strong-password>

# Optional auth/provider behavior
ALLOW_SIGNUP=true
COOKIE_SECURE=false

ORACLE_USER=ADMIN
ORACLE_PASSWORD=<adb-password>
ORACLE_CONNECT_STRING=adb.us-ashburn-1.oraclecloud.com:1522/<SERVICE_NAME>?protocol=tcps&ssl_server_dn_match=yes&connect_timeout=15&transport_connect_timeout=3&retry_count=2&retry_delay=2
```

Generate secrets:

```bash
openssl rand -hex 32
openssl rand -hex 32
```

Important:
- Do not wrap `ORACLE_CONNECT_STRING` in extra quotes in `.env.local`.

## 4) Install and Run

```bash
npm ci
npm run dev
```

Open:
- `http://localhost:3000/login`

## 5) First Login Behavior

- If `ALLOW_SIGNUP=true`, create first account via `/signup`.
- If bootstrap admin vars are set and user store is empty, first admin is auto-created.

## 6) Common Errors

- `NJS-516 no configuration directory...`:
  - Connect string is alias-like or malformed; use full walletless connect string.
- `NJS-040 queueTimeout`:
  - DB connectivity/session issue (ACL, password, service name, routing).
- Login appears successful but session not sticking:
  - For local HTTP dev, set `COOKIE_SECURE=false`.

## 7) Optional: Local Production-like Run

```bash
npm run build -- --webpack
npm run start
```

Then open `http://localhost:3000`.

## 8) Security Tips

- Rotate secrets if accidentally exposed in logs/history.
- Set `ALLOW_SIGNUP=false` when not needed.
- Use HTTPS in production environments.
