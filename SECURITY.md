# Security Policy

## Reporting a Vulnerability

Please report vulnerabilities privately and do not open a public issue with exploit details.

- Preferred: security contact for this repo owner
- Include: impact, affected endpoints/files, reproduction steps, and suggested fix

## Hardening Defaults

- Public signup is disabled by default (`ALLOW_SIGNUP=false`).
- Session cookie security can be controlled via `COOKIE_SECURE`.
- API state-changing requests require same-origin checks (CSRF protection).
- Auth endpoints include basic rate limits.
- Outbound URL crawling uses SSRF protections and private-network blocking.

## Operational Notes

- Always rotate secrets if they are exposed in logs/history.
- Run behind HTTPS in production.
- Keep dependencies patched and use automated security scanning.
