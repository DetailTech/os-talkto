# OCI Free Tier Quick Start (ADB + Compute + Podman)

This guide walks through deploying TalkTo on OCI Free Tier using:
- Autonomous Database (ADB)
- One Compute VM with Podman
- OCIR image pull

## 1) Create Autonomous Database (ADB)

1. In OCI Console, create an Autonomous Database.
2. Note values:
   - Database password
   - Service name (for example: `..._low.adb.oraclecloud.com`)
3. Ensure network access policy allows your compute VM to connect.

### Recommended connect string (walletless TCPS)

Use one line, no wrapping quotes:

```text
adb.us-ashburn-1.oraclecloud.com:1522/<SERVICE_NAME>?protocol=tcps&ssl_server_dn_match=yes&connect_timeout=15&transport_connect_timeout=3&retry_count=2&retry_delay=2
```

Example service names:
- `<db>_low.adb.oraclecloud.com`
- `<db>_high.adb.oraclecloud.com`

If you use a TNS alias only (like `_high`) without descriptor, you need wallet + `tnsnames.ora` + `TNS_ADMIN`.

## 2) Create Compute Instance

- Oracle Linux 9 VM
- Public IP assigned
- NSG/Security List ingress for TCP `3000`

SSH in:

```bash
ssh -i <key.pem> opc@<public-ip>
```

## 3) Install Podman and Open Host Firewall

```bash
sudo dnf -y install podman firewalld
sudo systemctl enable --now firewalld

# Replace 'public' with your active zone if different
sudo firewall-cmd --zone=public --add-port=3000/tcp
sudo firewall-cmd --zone=public --add-port=3000/tcp --permanent
sudo firewall-cmd --reload
```

Check active zone:

```bash
sudo firewall-cmd --get-active-zones
```

## 4) Login to OCIR and Pull Image

```bash
podman login ghcr.io
# Username: <tenancy-namespace>/<oci-username>
# Password: <OCI auth token>
```

Choose one image tag:
- x86: `ghcr.io/detailtech/os-talkto:x86-amd64-selftls`
- arm: `ghcr.io/detailtech/os-talkto:arm64-selftls`

```bash
podman pull ghcr.io/detailtech/os-talkto:x86-amd64-selftls
```

## 5) Create Environment File

Create `talkto.env`:

```env
NODE_ENV=production
ENABLE_SELF_SIGNED_TLS=true
COOKIE_SECURE=true
ALLOW_SIGNUP=false
PORT=3000
HOSTNAME=0.0.0.0

AUTH_SECRET=<64-char-hex>
ENCRYPTION_KEY=<64-char-hex>

LOCAL_ADMIN_EMAIL=admin@example.com
LOCAL_ADMIN_PASSWORD=<strong-password>

ORACLE_USER=ADMIN
ORACLE_PASSWORD=<adb-admin-or-app-user-password>
ORACLE_CONNECT_STRING=adb.us-ashburn-1.oraclecloud.com:1522/<SERVICE_NAME>?protocol=tcps&ssl_server_dn_match=yes&connect_timeout=15&transport_connect_timeout=3&retry_count=2&retry_delay=2
```

Important:
- Do not wrap `ORACLE_CONNECT_STRING` in quotes in `talkto.env`.

## 6) Run Container

```bash
podman run -d \
  --name talkto \
  --restart=always \
  -p 3000:3000 \
  --env-file ./talkto.env \
  ghcr.io/detailtech/os-talkto:x86-amd64-selftls
```

## 7) Validate

Local VM checks:

```bash
podman ps
podman logs --tail 100 talkto
curl -k https://127.0.0.1:3000/api/auth/me
```

Browser:
- `https://<public-ip>:3000/login`
- Accept self-signed cert warning

## 8) OCI Networking Checklist

If external access fails:
- VM host firewall open on TCP 3000
- Subnet Security List or NSG allows inbound TCP 3000
- Route table allows internet path as expected

## 9) Update / Redeploy

```bash
podman pull ghcr.io/detailtech/os-talkto:x86-amd64-selftls
podman stop talkto && podman rm talkto
podman run -d --name talkto --restart=always -p 3000:3000 --env-file ./talkto.env ghcr.io/detailtech/os-talkto:x86-amd64-selftls
```

## 10) Post-Deploy Security Actions

- Rotate any secrets accidentally exposed in shell history/logs
- Set `ALLOW_SIGNUP=false` unless public signup is intended
- Prefer trusted TLS cert via OCI Load Balancer for production user traffic
