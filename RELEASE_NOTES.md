# Zscaler Policy Simulator — Legacy API v1.0.1

*Coded by Steven Hajny, Distinguished Engineer*

**Would this be allowed, blocked or bypassed — and by what?** A standalone, read-only simulator that pulls live Zscaler policy over the **legacy ZIA, ZPA and Mobile Admin APIs** and evaluates a transaction the way the cloud would. It's built for GovCloud (`zscalerten`, `zscalergov`) and any cloud without OneAPI.

## Downloads
| Platform | File |
|---|---|
| Windows x64 | [Zscaler-Policy-Simulator-Legacy-API-1.0.1-windows-x64.zip](https://github.com/ZeroTrustPanda/Zscaler-Policy-Simulator-Legacy-API/raw/main/downloads/v1.0.1/Zscaler-Policy-Simulator-Legacy-API-1.0.1-windows-x64.zip) → `Zscaler-Policy-Simulator-Legacy-API.exe` |
| macOS Apple Silicon | [Zscaler-Policy-Simulator-Legacy-API-1.0.1-macos-arm64.zip](https://github.com/ZeroTrustPanda/Zscaler-Policy-Simulator-Legacy-API/raw/main/downloads/v1.0.1/Zscaler-Policy-Simulator-Legacy-API-1.0.1-macos-arm64.zip) |
| macOS Intel | [Zscaler-Policy-Simulator-Legacy-API-1.0.1-macos-x64.zip](https://github.com/ZeroTrustPanda/Zscaler-Policy-Simulator-Legacy-API/raw/main/downloads/v1.0.1/Zscaler-Policy-Simulator-Legacy-API-1.0.1-macos-x64.zip) |

Checksums: [SHA256SUMS.txt](https://github.com/ZeroTrustPanda/Zscaler-Policy-Simulator-Legacy-API/raw/main/downloads/v1.0.1/SHA256SUMS.txt)

No install and no Node.js required. Run it and it opens `http://127.0.0.1:8788`; that port lets it run next to the OneAPI edition on 8787. macOS builds are unsigned, so run `codesign --sign -` and `xattr -d com.apple.quarantine` on the binary first.

## Changes in 1.0.1
- **Product toggles on Connect:** switch on ZIA, ZPA and/or Client Connector (Mobile Admin). Only the products switched on show their credential form, are signed in to and are loaded. A ZPA-only customer needs only ZPA keys. The choice is remembered in the browser.
- A product switched on with no keys gets a clear message instead of being skipped silently.
- **Fixed:** the shipped `LegacyAPI-example.txt` next to the app was read as a real credentials file. That filled the form with placeholder values and turned every product on. Example, sample and template files are now ignored.
- A `LegacyAPI.txt` can't sign in to products that are switched off.

## What's in 1.0.0
- **Three products, three sets of keys, each with its own base URL:**
  - **ZIA:** admin username, password and API key. Signs in with the obfuscated key and keeps a `JSESSIONID` session, renewed when it expires.
  - **ZPA:** client ID, secret and customer ID. Uses `/signin` and a Bearer token.
  - **Mobile Admin:** API key and secret key. Uses `/papi/auth/v1/login` and an `auth-token` header.

  Fill in only the products you use. Each signs in on its own, so one failing doesn't stop the rest.
- **Optional `LegacyAPI.txt`** next to the app fills the Connect form. Secrets stay on the computer and are never sent to the browser. See `LegacyAPI-example.txt`.
- **Load policies** for the connected products: ZIA rules (URL filtering, firewall, DNS, SSL, Cloud App Control, file type, sandbox, DLP, ATP), Client Connector app profiles and forwarding profiles, and ZPA segments, access and forwarding policy, IdPs, SCIM groups, posture profiles and trusted networks.
- **Simulation, carried over from the OneAPI edition (v1.6.4):**
  - ZPA-first evaluation, choosing the most specific segment;
  - Client Connector bypasses per app profile and network type;
  - ZIA in processing order;
  - clean result tiles with *Matched on*;
  - a device posture caution that lists each profile's requirement;
  - **Compare as**, for two users or groups side by side;
  - bulk CSV with category lookup and recommendations;
  - category lookup;
  - offline snapshots.
- **Identity:** users and groups come from ZIA `/users` and `/groups`. ZPA SCIM membership is read from ZPA itself. There is no ZIdentity on legacy clouds.
- **Read-only:** the Block it / Allow it workflow is not part of this edition yet.
- **Branding:** the GovCloud wizard look, *Coded by Steven Hajny, Distinguished Engineer*.

## Known limits
- **Not yet run against a live GovCloud tenant.** Sign-in and endpoints follow Zscaler's API references and SDK legacy clients, and the build is tested against local fakes of the ZIA, ZPA and Mobile Admin APIs. Try it on a test tenant first and send the Diagnostics output if anything fails.
- **Not evaluated** (flagged as unknown): time windows, user agent, device trust, risk score, source-port bypasses and process-based bypasses. Device posture can't be checked; results show which posture profile is required.
