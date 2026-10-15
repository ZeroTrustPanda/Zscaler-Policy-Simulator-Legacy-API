# Changelog

## 1.0.0 — 2026-10-15
- First release: the legacy-API edition of the ZeroTrustPanda ZS Policy Simulator (based on v1.6.4).
- Legacy client for ZIA (obfuscated API key, `JSESSIONID`), ZPA (`/signin`, Bearer) and Mobile Admin (`/papi/auth/v1/login`, `auth-token`). Each product has its own base URL, is signed in to separately and re-signs in on 401.
- Connect form with three optional product sections; optional `LegacyAPI.txt` credentials file (secrets never reach the browser).
- Load policies only for connected products; user and group lookups from ZIA and ZPA SCIM (no ZIdentity).
- Read-only: policy-change workflow removed.
- GovCloud wizard branding; default port 8788.
