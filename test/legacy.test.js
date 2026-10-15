'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { LegacyClient, obfuscateApiKey, parseBase } = require('../src/legacy');
const credfile = require('../src/credfile');
const { catalog } = require('../src/zscaler');

test('ZIA API key obfuscation follows the documented algorithm', () => {
  // timestamp ...123456 → n = 123456, r = 123456 >> 1 = 061728
  const { key, timestamp } = obfuscateApiKey('abcdefghijkl', 1700000123456);
  assert.equal(timestamp, 1700000123456);
  assert.equal(key, 'bcdefg' + 'cidjek');
});

test('base URLs: host, URL or URL with path; http only for localhost', () => {
  assert.equal(parseBase('zsapi.zscalerten.net', 'ZIA').origin, 'https://zsapi.zscalerten.net');
  assert.equal(parseBase('https://zsapi.zscalerten.net/api/v1', 'ZIA').hostname, 'zsapi.zscalerten.net');
  assert.equal(parseBase('http://127.0.0.1:9001', 'ZIA').port, 9001);
  assert.throws(() => parseBase('http://zsapi.zscalerten.net', 'ZIA'), /use https/);
});

test('credentials: partial product sections are rejected, empty ones are skipped', () => {
  assert.throws(() => new LegacyClient({}), /at least one product/);
  assert.throws(() => new LegacyClient({ zia: { baseUrl: 'zsapi.zscalerten.net', username: 'a@b.gov' } }), /ZIA: also enter password, API key/);
  assert.throws(() => new LegacyClient({ zpa: { baseUrl: 'config.zpagov.us', clientId: 'x', clientSecret: 'y', customerId: 'abc' } }), /customer ID is a number/);
  const c = new LegacyClient({ zcc: { baseUrl: 'mobile6.zscalerten.net', apiKey: 'k', secretKey: 's' } });
  assert.deepEqual(c.products(), ['zcc']);
  assert.ok(catalog(c).every((e) => e.group === 'zcc'), 'only Client Connector endpoints load');
});

function fakeTenant() {
  const calls = [];
  let ziaSessions = 0;
  const send = async (method, base, path, payload, headers) => {
    calls.push({ method, host: base.hostname, path, headers });
    if (base.hostname === 'zsapi.zscalerten.net') {
      if (path === '/api/v1/authenticatedSession') {
        const b = JSON.parse(payload);
        if (b.username !== 'admin@agency.gov' || b.password !== 'pw' || b.apiKey !== obfuscateApiKey('abcdefghijkl', b.timestamp).key) return { status: 401, headers: {}, body: { code: 'AUTHENTICATION_FAILED' } };
        ziaSessions++;
        return { status: 200, headers: { 'set-cookie': [`JSESSIONID=S${ziaSessions}; Path=/; Secure`] }, body: { authType: 'ADMIN_LOGIN' } };
      }
      if (headers.Cookie !== `JSESSIONID=S${ziaSessions}`) return { status: 401, headers: {}, body: { code: 'NOT_AUTHENTICATED' } };
      if (path === '/api/v1/status') return { status: 200, headers: {}, body: { status: 'ACTIVE' } };
      if (path === '/api/v1/expire-me') { ziaSessions++; return { status: 401, headers: {}, body: {} }; } // session rotated server-side
      return { status: 200, headers: {}, body: [] };
    }
    if (base.hostname === 'config.zpagov.us') {
      if (path === '/signin') return /client_id=cid&client_secret=csec/.test(payload) ? { status: 200, headers: {}, body: { token_type: 'Bearer', access_token: 'ZPATOKEN', expires_in: '3600' } } : { status: 401, headers: {}, body: {} };
      if (headers.Authorization !== 'Bearer ZPATOKEN') return { status: 401, headers: {}, body: {} };
      return { status: 200, headers: {}, body: { list: [{ id: '1' }], totalPages: '1' } };
    }
    if (base.hostname === 'mobile6.zscalerten.net') {
      if (path === '/papi/auth/v1/login') return JSON.parse(payload).secretKey === 'sk' ? { status: 200, headers: {}, body: { jwtToken: 'JWT' } } : { status: 401, headers: {}, body: {} };
      if (headers['auth-token'] !== 'JWT') return { status: 401, headers: {}, body: {} };
      return { status: 200, headers: {}, body: [{ id: 7 }] };
    }
    throw new Error('unexpected host ' + base.hostname);
  };
  return { send, calls };
}
const CREDS = {
  zia: { baseUrl: 'https://zsapi.zscalerten.net', username: 'admin@agency.gov', password: 'pw', apiKey: 'abcdefghijkl' },
  zpa: { baseUrl: 'config.zpagov.us', clientId: 'cid', clientSecret: 'csec', customerId: '216196257331281920' },
  zcc: { baseUrl: 'https://mobile6.zscalerten.net', apiKey: 'ak', secretKey: 'sk' },
};

test('signs in to each product and routes OneAPI-style paths to the legacy hosts', async () => {
  const t = fakeTenant();
  const c = new LegacyClient(Object.assign({ transport: t.send }, CREDS));
  const res = await c.auth();
  assert.deepEqual(Object.keys(res).filter((k) => res[k].ok), ['zia', 'zpa', 'zcc']);
  assert.deepEqual(await c.get('/zia/api/v1/status'), { status: 'ACTIVE' });
  await c.get('/zpa/mgmtconfig/v1/admin/customers/216196257331281920/segmentGroup', { pagesize: '1' });
  await c.get('/zcc/papi/public/v1/webForwardingProfile/listByCompany');
  const paths = t.calls.filter((x) => x.method === 'GET').map((x) => `${x.host}${x.path}`);
  assert.deepEqual(paths, [
    'zsapi.zscalerten.net/api/v1/status',
    'config.zpagov.us/mgmtconfig/v1/admin/customers/216196257331281920/segmentGroup?pagesize=1',
    'mobile6.zscalerten.net/papi/public/v1/webForwardingProfile/listByCompany',
  ]);
  await assert.rejects(c.get('/ziam/admin/api/v1/users'), /Not available on legacy APIs/);
});

test('an expired ZIA session signs in again once', async () => {
  const t = fakeTenant();
  const c = new LegacyClient({ transport: t.send, zia: CREDS.zia });
  await c.auth();
  await c.get('/zia/api/v1/expire-me').catch(() => {}); // server rotates the session → 401 → re-sign-in → retry
  assert.equal(t.calls.filter((x) => x.path === '/api/v1/authenticatedSession').length, 2);
  assert.deepEqual(await c.get('/zia/api/v1/status'), { status: 'ACTIVE' });
});

test('a failed product sign-in does not stop the others', async () => {
  const t = fakeTenant();
  const c = new LegacyClient(Object.assign({ transport: t.send }, CREDS, { zcc: Object.assign({}, CREDS.zcc, { secretKey: 'wrong' }) }));
  const res = await c.auth();
  assert.equal(res.zia.ok, true); assert.equal(res.zpa.ok, true); assert.equal(res.zcc.ok, false);
  assert.match(res.zcc.error, /Mobile Admin sign-in failed \(401\)/);
});

test('credentials file: sections and prefixed keys; secrets never in the public view', () => {
  const parsed = credfile.parse([
    '# legacy', '[ZIA]', 'baseurl=https://zsapi.zscalerten.net', 'username=admin@agency.gov', 'password=pw', 'api key = abcdefghijkl',
    '[ZPA]', 'baseurl=config.zpagov.us', 'client id=cid', 'client secret=csec', 'customer id=216196257331281920',
    'mobile_baseurl=https://mobile6.zscalerten.net', 'zcc_apikey=ak', 'zcc_secretkey=sk',
  ].join('\n'));
  assert.deepEqual(parsed.zia, CREDS.zia);
  assert.deepEqual(parsed.zpa, CREDS.zpa);
  assert.deepEqual(parsed.zcc, CREDS.zcc);
  const view = credfile.publicView(parsed);
  assert.equal(view.zia.password, true); assert.equal(view.zpa.clientSecret, true); assert.equal(view.zcc.secretKey, true);
  assert.equal(view.zia.username, 'admin@agency.gov');
  const merged = credfile.merge({ zia: { username: 'other@agency.gov', password: '' } }, parsed);
  assert.equal(merged.zia.username, 'other@agency.gov'); assert.equal(merged.zia.password, 'pw');
});

test('credentials file search ignores the shipped example file', () => {
  const fs = require('fs'), os = require('os'), path = require('path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zpsl-'));
  fs.copyFileSync(path.join(__dirname, '..', 'LegacyAPI-example.txt'), path.join(dir, 'LegacyAPI-example.txt'));
  const prev = process.env.ZPSL_APP_DIR, cwd = process.cwd();
  process.env.ZPSL_APP_DIR = dir; process.chdir(dir);
  try {
    assert.equal(credfile.findFile(), null);
    fs.writeFileSync(path.join(dir, 'LegacyAPI.txt'), '[ZPA]\nbaseurl=config.zpagov.us\n');
    assert.equal(path.basename(credfile.findFile()), 'LegacyAPI.txt');
  } finally { process.chdir(cwd); if (prev === undefined) delete process.env.ZPSL_APP_DIR; else process.env.ZPSL_APP_DIR = prev; fs.rmSync(dir, { recursive: true, force: true }); }
});
