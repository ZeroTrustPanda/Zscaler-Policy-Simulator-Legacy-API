'use strict';
// Legacy Zscaler API client: ZIA, ZPA and Client Connector (Mobile Admin) each with their own base URL and keys.
// For clouds without OneAPI (GovCloud such as zscalergov / zscalerten, and any other legacy cloud).
//
// The rest of the simulator calls the OneAPI-style paths (/zia/api/v1/..., /zpa/mgmtconfig/..., /zcc/papi/...).
// This client keeps that interface and routes each call to the product's legacy host with the product prefix removed:
//   /zia/api/v1/x        → {ZIA base}/api/v1/x            Cookie: JSESSIONID   (POST /api/v1/authenticatedSession)
//   /zpa/mgmtconfig/...   → {ZPA base}/mgmtconfig/...      Authorization: Bearer (POST /signin)
//   /zpa/userconfig/...   → {ZPA base}/userconfig/...
//   /zcc/papi/public/...  → {Mobile Admin base}/papi/public/...  auth-token: <jwt>  (POST /papi/auth/v1/login)
// ZIdentity (/ziam) does not exist on legacy clouds.
// Read-only: the simulator only sends GETs plus POST /urlLookup (a read).

const https = require('https');
const http = require('http');

function transport(method, base, path, payload, headers, timeoutMs = 45000) {
  return new Promise((resolve, reject) => {
    const mod = base.protocol === 'http:' ? http : https;
    const opts = { hostname: base.hostname, port: base.port || (base.protocol === 'http:' ? 80 : 443), path, method, headers: Object.assign({}, headers) };
    if (payload) opts.headers['Content-Length'] = Buffer.byteLength(payload);
    const req = mod.request(opts, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        let body = data;
        try { body = data ? JSON.parse(data) : null; } catch { /* keep text */ }
        resolve({ status: res.statusCode, headers: res.headers, body, text: data });
      });
    });
    req.on('error', (e) => {
      const err = new Error(`${e.code || 'NETWORK'}: ${e.message} (${base.hostname})` +
        (/CERT|SELF_SIGNED|UNABLE_TO_VERIFY/.test(e.code || e.message) ? ' — TLS interception? Set NODE_EXTRA_CA_CERTS to your root CA' : ''));
      err.code = e.code || 'NETWORK';
      reject(err);
    });
    req.setTimeout(timeoutMs, () => req.destroy(Object.assign(new Error('Request timeout'), { code: 'ETIMEDOUT' })));
    if (payload) req.write(payload);
    req.end();
  });
}

const snippet = (b) => (typeof b === 'string' ? b : JSON.stringify(b) || '').replace(/\s+/g, ' ').slice(0, 300);
function retryAfterSeconds(r) {
  const h = r.headers || {};
  let v = h['retry-after'] || h['x-ratelimit-reset'];
  if (!v && r.body && typeof r.body === 'object') v = r.body['Retry-After'] || r.body.retryAfter;
  const n = parseInt(String(v || '').replace(/[^0-9]/g, ''), 10);
  return isNaN(n) ? null : n;
}

// The documented ZIA API-key obfuscation (timestamp-derived), as in Zscaler's samples and the GovCloud wizard.
function obfuscateApiKey(apiKey, now = Date.now()) {
  const n = String(now).slice(-6);
  const r = String(parseInt(n, 10) >> 1).padStart(6, '0');
  let key = '';
  for (let i = 0; i < n.length; i++) key += apiKey[parseInt(n[i], 10)];
  for (let j = 0; j < r.length; j++) key += apiKey[parseInt(r[j], 10) + 2];
  return { timestamp: now, key };
}

// Base URL as typed: "https://zsapi.zscalerten.net", "zsapi.zscalerten.net", ".../api/v1", "config.zpagov.net",
// "https://mobile6.zscalerten.net/papi". Plain http is allowed only for localhost (testing).
function parseBase(input, product) {
  let v = String(input || '').trim().replace(/^["']|["']$/g, '');
  if (!v) return null;
  if (!/^https?:\/\//i.test(v)) v = 'https://' + v;
  let u;
  try { u = new URL(v); } catch { throw new Error(`${product}: "${input}" is not a valid base URL`); }
  if (u.protocol === 'http:' && !/^(localhost|127\.0\.0\.1|\[::1\])$/.test(u.hostname)) throw new Error(`${product}: use https for ${u.hostname}`);
  return { protocol: u.protocol, hostname: u.hostname, port: u.port ? +u.port : null, origin: u.origin };
}

const LABEL = { zia: 'ZIA', zpa: 'ZPA', zcc: 'Mobile Admin' };

class LegacyClient {
  // cfg: { zia: {baseUrl, username, password, apiKey}, zpa: {baseUrl, clientId, clientSecret, customerId},
  //        zcc: {baseUrl, apiKey, secretKey}, transport? }
  constructor(cfg = {}) {
    this.legacy = true;
    this.creds = {};
    this.base = {};
    const need = { zia: ['baseUrl', 'username', 'password', 'apiKey'], zpa: ['baseUrl', 'clientId', 'clientSecret', 'customerId'], zcc: ['baseUrl', 'apiKey', 'secretKey'] };
    for (const p of ['zia', 'zpa', 'zcc']) {
      const c = cfg[p] || {};
      const given = need[p].filter((k) => String(c[k] || '').trim());
      if (!given.length) continue;
      const missing = need[p].filter((k) => !String(c[k] || '').trim());
      if (missing.length) throw new Error(`${LABEL[p]}: also enter ${missing.map((k) => FIELD[k] || k).join(', ')} (or leave all ${LABEL[p]} fields empty to skip it)`);
      this.creds[p] = Object.fromEntries(need[p].map((k) => [k, String(c[k]).trim()]));
      this.base[p] = parseBase(c.baseUrl, LABEL[p]);
    }
    if (!Object.keys(this.creds).length) throw new Error('Enter the credentials for at least one product: ZIA, ZPA or Mobile Admin.');
    if (this.creds.zpa && !/^\d+$/.test(this.creds.zpa.customerId)) throw new Error('ZPA: the customer ID is a number (ZPA Admin Portal → Administration → API Keys)');
    // Shapes the rest of the app reads
    this.cfg = { legacy: true, zpaCustomerId: this.creds.zpa ? this.creds.zpa.customerId : undefined, zpaIdSource: this.creds.zpa ? 'entered' : null };
    this.tokenHost = Object.entries(this.base).map(([p, b]) => `${LABEL[p]} ${b.hostname}`).join(' · ');
    this.apiHost = this.tokenHost;
    this.send = cfg.transport || transport;
    this.session = {};
    this.lastCall = {};
    this.log = [];
  }

  has(product) { return !!this.creds[product]; }
  products() { return Object.keys(this.creds); }

  pushLog(method, url, status, err) {
    this.log.push({ t: Date.now(), method, url, status, err });
    if (this.log.length > 500) this.log.shift();
  }

  // Sign in to one product (cached). Secrets go only to the product's own sign-in endpoint.
  async signIn(p, force = false) {
    const s = this.session[p];
    if (!force && s && (!s.exp || Date.now() < s.exp - 60000)) return s;
    const b = this.base[p], c = this.creds[p];
    if (!b) throw Object.assign(new Error(`${LABEL[p]} credentials were not entered`), { status: 400, notConfigured: true });
    let r, sess;
    if (p === 'zia') {
      const { timestamp, key } = obfuscateApiKey(c.apiKey);
      r = await this.send('POST', b, '/api/v1/authenticatedSession', JSON.stringify({ apiKey: key, username: c.username, password: c.password, timestamp }), { 'Content-Type': 'application/json', Accept: 'application/json', 'Cache-Control': 'no-cache' });
      const cookie = [].concat(r.headers && r.headers['set-cookie'] || []).map((x) => (String(x).match(/JSESSIONID=([^;]+)/) || [])[1]).find(Boolean);
      if (r.status >= 200 && r.status < 300 && cookie) sess = { header: { Cookie: `JSESSIONID=${cookie}` }, exp: Date.now() + 25 * 60000 };
    } else if (p === 'zpa') {
      r = await this.send('POST', b, '/signin', new URLSearchParams({ client_id: c.clientId, client_secret: c.clientSecret }).toString(), { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' });
      const tok = r.body && (r.body.access_token || r.body.token);
      if (r.status >= 200 && r.status < 300 && tok) sess = { header: { Authorization: `Bearer ${tok}` }, exp: Date.now() + (+(r.body.expires_in) || 3600) * 1000 };
    } else {
      r = await this.send('POST', b, '/papi/auth/v1/login', JSON.stringify({ apiKey: c.apiKey, secretKey: c.secretKey }), { 'Content-Type': 'application/json', Accept: 'application/json' });
      const tok = r.body && (r.body.jwtToken || r.body.jwt_token);
      if (r.status >= 200 && r.status < 300 && tok) sess = { header: { 'auth-token': tok }, exp: Date.now() + 25 * 60000 };
    }
    const path = { zia: '/api/v1/authenticatedSession', zpa: '/signin', zcc: '/papi/auth/v1/login' }[p];
    this.pushLog('POST', `${b.origin}${path}`, r.status, sess ? '' : snippet(r.body));
    if (!sess) {
      const hint = { zia: ' — check the ZIA base URL, admin username, password and API key, and that the admin has API access', zpa: ' — check the ZPA base URL, client ID and secret', zcc: ' — check the Mobile Admin base URL, API key and secret key' }[p];
      throw Object.assign(new Error(`${LABEL[p]} sign-in failed (${r.status}): ${snippet(r.body) || '(empty)'}${hint}`), { status: r.status === 200 ? 401 : r.status });
    }
    this.session[p] = sess;
    return sess;
  }

  // Sign in to every configured product; returns {ZIA: {ok}, ZPA: {...}, ZCC: {...}}.
  async auth() {
    const out = {};
    for (const p of this.products()) {
      try { await this.signIn(p, true); out[p] = { ok: true }; }
      catch (e) { out[p] = { ok: false, error: e.message, status: e.status }; }
    }
    if (!Object.values(out).some((x) => x.ok)) throw Object.assign(new Error(Object.values(out).map((x) => x.error).join(' · ')), { status: 401 });
    return out;
  }

  route(path) {
    if (path.startsWith('/zia/')) return { p: 'zia', path: path.slice(4) };
    if (path.startsWith('/zpa/')) return { p: 'zpa', path: path.slice(4) };
    if (path.startsWith('/zcc/')) return { p: 'zcc', path: path.slice(4) };
    if (path.startsWith('/ziam/') || path.startsWith('/zins')) throw Object.assign(new Error('Not available on legacy APIs (ZIdentity / Z-Insights are OneAPI only)'), { status: 404, legacyNA: true });
    if (path.startsWith('/api/') || path.startsWith('/papi/') || path.startsWith('/mgmtconfig/') || path.startsWith('/userconfig/')) {
      return { p: path.startsWith('/api/') ? 'zia' : path.startsWith('/papi/') ? 'zcc' : 'zpa', path };
    }
    throw Object.assign(new Error(`Unknown API path ${path}`), { status: 400 });
  }

  async request(method, path, { query, body, headers: extra, rateRetries = 5 } = {}, attempt = 0) {
    const rt = this.route(path);
    if (!this.has(rt.p)) throw Object.assign(new Error(`${LABEL[rt.p]} credentials were not entered`), { status: 400, notConfigured: true });
    // Legacy APIs are rate limited per product (ZIA ~1/s for most calls); space calls out.
    const gap = Date.now() - (this.lastCall[rt.p] || 0);
    if (gap < 500) await new Promise((r) => setTimeout(r, 500 - gap));
    this.lastCall[rt.p] = Date.now();
    const sess = await this.signIn(rt.p);
    let p = rt.path;
    if (query) p += (p.includes('?') ? '&' : '?') + new URLSearchParams(query).toString();
    const h = Object.assign({ Accept: 'application/json', 'Cache-Control': 'no-cache' }, sess.header, extra || {});
    if (body) h['Content-Type'] = 'application/json';
    const b = this.base[rt.p];
    const r = await this.send(method, b, p, body ? JSON.stringify(body) : null, h);
    this.pushLog(method, `${b.origin}${p}`, r.status, r.status >= 400 ? snippet(r.body) : '');
    if (r.status === 429 && attempt < rateRetries) {
      const ra = retryAfterSeconds(r) || 2;
      await new Promise((res) => setTimeout(res, Math.min(ra, 30) * 1000));
      return this.request(method, path, { query, body, headers: extra, rateRetries }, attempt + 1);
    }
    if (r.status === 401 && attempt === 0) { // session or token expired: sign in again once
      await this.signIn(rt.p, true);
      return this.request(method, path, { query, body, headers: extra, rateRetries }, 1);
    }
    if (r.status < 200 || r.status >= 300) {
      const hint = r.status === 403 ? ` — this ${LABEL[rt.p]} account lacks permission for it` : r.status === 404 ? ' — not available on this tenant / API version' : '';
      throw Object.assign(new Error(`HTTP ${r.status} ${method} ${p}: ${snippet(r.body) || '(empty body)'}${hint}`), { status: r.status, retryAfter: r.status === 429 ? retryAfterSeconds(r) : null });
    }
    return r.body;
  }

  get(path, query) { return this.request('GET', path, { query }); }
  post(path, body, query) { return this.request('POST', path, { body, query }); }
}

const FIELD = { baseUrl: 'base URL', username: 'admin username', password: 'password', apiKey: 'API key', clientId: 'client ID', clientSecret: 'client secret', customerId: 'customer ID', secretKey: 'secret key' };

// Connect probe: one cheap read per configured product.
async function legacyProbe(client, signins = {}) {
  const out = {};
  const checks = { zia: ['ZIA', '/zia/api/v1/status'], zcc: ['ZCC', '/zcc/papi/public/v1/webForwardingProfile/listByCompany'], zpa: ['ZPA', `/zpa/mgmtconfig/v1/admin/customers/${client.cfg.zpaCustomerId}/segmentGroup`] };
  for (const p of ['zia', 'zcc', 'zpa']) {
    const [name, path] = checks[p];
    if (!client.has(p)) { out[name] = { ok: false, skipped: true, error: 'Not configured' }; continue; }
    if (signins[p] && !signins[p].ok) { out[name] = signins[p]; continue; }
    try { await client.get(path, p === 'zpa' ? { pagesize: '1' } : undefined); out[name] = { ok: true }; }
    catch (e) { out[name] = { ok: false, error: e.message, status: e.status }; }
  }
  return out;
}

module.exports = { LegacyClient, legacyProbe, obfuscateApiKey, parseBase, transport };
