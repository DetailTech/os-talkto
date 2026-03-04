# os-talkto

Open source AI RAG application for persona-based chat grounded in public-source content.

## What This Is

TalkTo lets users:
- Discover and ingest persona source material (books, podcasts, YouTube transcripts, interviews, blogs, social)
- Build RAG context in Oracle Autonomous Database
- Chat with one or more personas with selectable response tones
- Manage provider/model settings and admin workflows

## Screenshots

### AI Setup
![AI provider setup](screens/ai%20setup.png)

### Add Personas
![Add personas workflow](screens/add%20personas.png)

### RAG Ingestion
![RAG ingest progress](screens/rag%20ingest.png)

### Group Chat
![Group chat experience](screens/group%20chat.png)

## Current Container Images

Published in GHCR (public):
- `ghcr.io/detailtech/os-talkto:x86-amd64-selftls`
- `ghcr.io/detailtech/os-talkto:arm64-selftls`

These images support optional self-signed TLS at runtime via `ENABLE_SELF_SIGNED_TLS=true`.

## Quick Links

- OCI Free Tier deployment walkthrough: `docs/OCI_FREE_TIER_QUICKSTART.md`
- Local workstation setup walkthrough: `docs/LOCAL_QUICKSTART.md`
- Security policy: `SECURITY.md`

## Local Development

### Prerequisites
- Node.js 20+
- npm
- Oracle Autonomous Database (walletless TCPS)

### Environment
Create `.env.local` from `.env.local.example` and set required values:
- `AUTH_SECRET`
- `ENCRYPTION_KEY`
- `ORACLE_USER`
- `ORACLE_PASSWORD`
- `ORACLE_CONNECT_STRING`

Generate secrets:
```bash
openssl rand -hex 32  # AUTH_SECRET
openssl rand -hex 32  # ENCRYPTION_KEY
```

### Run
```bash
npm ci
npm run dev
```

## Production Environment Variables

Required:
- `AUTH_SECRET` (64-char hex recommended)
- `ENCRYPTION_KEY` (64-char hex)
- `ORACLE_USER`
- `ORACLE_PASSWORD`
- `ORACLE_CONNECT_STRING`

Important behavior toggles:
- `NODE_ENV=production`
- `COOKIE_SECURE=true` (for HTTPS)
- `ALLOW_SIGNUP=false` (recommended for non-public-admin environments)
- `ENABLE_SELF_SIGNED_TLS=true|false`
- `PERSONA_INGEST_MAX_ACTIVE_JOBS=3` (default safety)
- `OUTBOUND_FETCH_TIMEOUT_MS=15000`

## Podman Run (Manual)

```bash
podman run -d \
  --name talkto \
  --restart=always \
  -p 3000:3000 \
  --env-file ./talkto.env \
  ghcr.io/detailtech/os-talkto:x86-amd64-selftls
```

For arm hosts, swap image tag to `arm64-selftls`.

## TLS Notes

When `ENABLE_SELF_SIGNED_TLS=true`:
- Container serves HTTPS on `:3000`
- Browser will show a certificate warning until replaced by trusted cert
- Use `https://<host>:3000`

## Legal / Safety Disclaimer

This project provides AI-generated simulation based on public content. Outputs may be inaccurate and are not legal, medical, financial, political, or professional advice. Personas are synthetic approximations, not endorsements or representations of real individuals. Operators are responsible for lawful use, data sourcing, and deployment compliance.

## Troubleshooting Highlights

- Login succeeds but user is not authenticated:
  - Ensure HTTPS is used with `COOKIE_SECURE=true`
- Oracle `NJS-516`:
  - Usually malformed/quoted `ORACLE_CONNECT_STRING` or alias requiring `tnsnames.ora`
- Oracle `NJS-040`:
  - Connectivity/session establishment issue (DB ACL/security list/egress/service)
- `Forbidden (CSRF check failed)`:
  - Ensure requests come from same host/origin as deployment URL

## Security Posture (Implemented)

- Admin enforcement on sensitive persona mutation endpoints
- Basic auth rate limiting
- CSRF same-origin checks on state-changing API routes
- Security headers at proxy middleware
- SSRF protections for outbound crawler fetches
- Sanitized upstream/provider error responses

See `SECURITY.md` for reporting and operational guidance.
