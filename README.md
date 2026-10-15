# Zscaler Policy Simulator — Legacy API

**Downloads (v1.0.1):** [Windows x64](https://github.com/ZeroTrustPanda/Zscaler-Policy-Simulator-Legacy-API/raw/main/downloads/v1.0.1/Zscaler-Policy-Simulator-Legacy-API-1.0.1-windows-x64.zip) · [macOS Apple Silicon](https://github.com/ZeroTrustPanda/Zscaler-Policy-Simulator-Legacy-API/raw/main/downloads/v1.0.1/Zscaler-Policy-Simulator-Legacy-API-1.0.1-macos-arm64.zip) · [macOS Intel](https://github.com/ZeroTrustPanda/Zscaler-Policy-Simulator-Legacy-API/raw/main/downloads/v1.0.1/Zscaler-Policy-Simulator-Legacy-API-1.0.1-macos-x64.zip) · [SHA256SUMS](https://github.com/ZeroTrustPanda/Zscaler-Policy-Simulator-Legacy-API/raw/main/downloads/v1.0.1/SHA256SUMS.txt) — Release notes: [RELEASE_NOTES.md](RELEASE_NOTES.md) · history: [CHANGELOG.md](CHANGELOG.md)

*Coded by Steven Hajny, Distinguished Engineer*

Standalone tool that answers "would this be allowed, blocked or bypassed — and by what?" against your live Zscaler policy, over the **legacy APIs**. Built for **GovCloud** (for example `zscalerten` and `zscalergov`), where OneAPI isn't available, and works on any cloud that still serves the legacy ZIA, ZPA and Mobile Admin APIs.

It's the legacy-API edition of the [ZeroTrustPanda ZS Policy Simulator](https://github.com/ZeroTrustPanda/ZTP-Policy-Simulator) (OneAPI) and shares its evaluation engine. It is **read-only**: it reads policy and never changes it.

## Flow
1. **Connect.** Switch on the products this tenant has (ZIA, ZPA, Client Connector / Mobile Admin). Only those show a credentials form and are signed in to, so a ZPA-only customer needs only ZPA keys. Each product has its own API base URL. Your choice is remembered in this browser.
   | Product | API base URL (examples) | Credentials |
   |---|---|---|
   | 🌐 ZIA | `https://zsapi.zscalerten.net`, `https://zsapi.zscalergov.net` | admin username, password, API key |
   | 🔒 ZPA | `https://config.zpagov.us`, `https://config.zpagov.net` | client ID, client secret, customer ID |
   | 💻 Client Connector (Mobile Admin) | `https://mobile6.zscalerten.net`, `https://api-mobile.zscalergov.net` | API key, secret key |

   Each product signs in separately. One failing doesn't stop the others; its chip in Load policies is greyed out.
2. **Load policies.** Tick the connected products and pull the rule sets, with a live status table per policy set.
3. **Simulate.** Run one transaction, compare up to two users or groups side by side, or bulk-test a CSV of IPs and hosts.

## Credentials file (optional)
Put `LegacyAPI.txt` next to the app, or in the folder you start it from, and the Connect form fills itself. See [LegacyAPI-example.txt](LegacyAPI-example.txt).
- Base URLs, usernames, client IDs and the customer ID are shown in the form.
- Secret fields only say *from LegacyAPI.txt*. Secrets are never sent to the browser.
- Anything you type in the form takes priority.
- The app reads the file and never writes it.
- `LegacyAPI.txt` is ignored by git; never commit real credentials.

```
[ZIA]
baseurl=https://zsapi.zscalerten.net
username=admin@agency.gov
password=...
apikey=...
[ZPA]
baseurl=https://config.zpagov.us
clientid=...
clientsecret=...
customerid=...
[Mobile Admin]
baseurl=https://mobile6.zscalerten.net
apikey=...
secretkey=...
```

## Result
- **Policy rule action:**
  - the action: Block, Allow, Bypass, Isolate or Caution;
  - the deciding rule and its order;
  - the destination and port, with the URL category when ZIA decides;
  - one *Matched on* line, such as `SCIM group "radiologists"` or `user jane@agency.gov`;
  - a ⚠️ **device posture** caution when ZPA access depends on posture. It names each posture profile and what it requires (file path, registry key, OS version, ownership…) and shows the result if posture fails.
- **Policy action also based on:** every user, location, Client Connector or other condition that would change the action.
- **How it gets there:** each Client Connector app profile per network type. **Every module** shows all evaluated rules.
- **Compare as:** pick one user or group to simulate as it, or two to see the results side by side with a module-by-module diff. Users and groups come from ZIA, and groups also from ZPA SCIM.

## Evaluation order
1. **ZPA first.** The most specific matching application segment, then its Bypass setting, then Client Forwarding Policy, then Access Policy. SCIM groups are read from ZPA itself, and SCIM attribute rules (email) and posture rules are evaluated both ways (posture passing and failing).
2. **Client Connector bypasses, per app profile and network type:** VPN gateway, PAC on 80/443, IP-based app bypass, Z-Tunnel 2.0 exclusions, then inclusions.
3. **ZIA:** ATP → Firewall → DNS Control → URL Filtering → Cloud App Control → Sandbox → File Type Control → DLP. SSL Inspection acts as a modifier.

## Bulk test (CSV)
Same as the OneAPI edition:
- CIDRs and ranges are expanded;
- categories come from ZIA `urlLookup`, 100 per call, with rate-limit and quota handling;
- the *expected result* recommendations are included;
- results download as CSV.

## Differences from the OneAPI edition
- **Sign-in:**
  - ZIA: obfuscated API key at `POST /api/v1/authenticatedSession`, then a `JSESSIONID` session cookie, renewed automatically when it expires.
  - ZPA: `POST /signin` with client ID and secret, then a Bearer token.
  - Mobile Admin: `POST /papi/auth/v1/login`, then an `auth-token` header.
- **Paths:**
  - ZIA calls go to `{ZIA base}/api/v1/…`.
  - ZPA calls go to `{ZPA base}/mgmtconfig/…` and `/userconfig/…`, with the customer ID in the path.
  - Mobile Admin calls go to `{base}/papi/public/v1/…`.
- **No ZIdentity:** user lookups use ZIA's `/users` and ZPA SCIM.
- **No customer ID discovery:** the ZPA customer ID is entered on Connect.
- **Read-only:** the Block it / Allow it workflow and ZPA private-app changes are not included yet.
- **Port:** it runs on port **8788**, so it can sit next to the OneAPI edition, which uses 8787.

## Run
- **Windows:** run `Zscaler-Policy-Simulator-Legacy-API.exe`. It serves http://127.0.0.1:8788 and opens your browser. `PORT` and `NO_OPEN=1` are supported.
- **macOS:** builds are unsigned. Run `codesign --sign - ./Zscaler-Policy-Simulator-Legacy-API-macos-arm64 && xattr -d com.apple.quarantine ./Zscaler-Policy-Simulator-Legacy-API-macos-arm64`, then run it.
- **From source:** `npm install && npm start`. Tests: `npm test`. Build: `npm run build`.
- **Sample policies:** *Try with sample policies* works with no tenant.
- **Snapshots:** *Save policy snapshot* (rules only, no credentials) writes to `~/Zscaler-Policy-Simulator-Legacy-API/snapshots/`. *Open saved snapshot* simulates offline.
- **TLS:** if your network inspects TLS, set `NODE_EXTRA_CA_CERTS` to your root CA.

## Known limits
- Evaluation is re-implemented from rule data; Zscaler has no "evaluate this transaction" API.
- **Not evaluated** (flagged as unknown): time windows, user agent, device trust, risk score, source-port bypasses and process-based bypasses.
- **Device posture can't be checked** without an agent on the device. Results report which posture profile is required and what happens if it fails.
- **Not yet run against a live GovCloud tenant.** The legacy sign-in flows and endpoints follow Zscaler's API references and SDKs, and are tested against local fakes of each API.

## Project layout
- `server.js`: local Express server (loopback only) and API routes
- `src/legacy.js`: legacy ZIA / ZPA / Mobile Admin client (sign-in, routing, retries)
- `src/credfile.js`: optional `LegacyAPI.txt` reader
- `src/zscaler.js`: policy loader and lookups (shared with the OneAPI edition)
- `src/engine.js`, `src/zcc.js`, `src/matchers.js`: evaluation
- `src/bulk.js`, `src/recommend.js`: bulk CSV and recommendations
- `public/index.html`: single-file UI
- `test/`: `node --test` suite, including legacy sign-in and routing tests
