'use strict';
// Optional credentials file for the legacy APIs: LegacyAPI.txt next to the app (or in the folder it was started from).
// Read only, never written. Secrets stay on this computer: the browser is only told which fields the file filled in.
//
//   [ZIA]
//   baseurl=https://zsapi.zscalerten.net
//   username=admin@agency.gov
//   password=...
//   apikey=...
//   [ZPA]
//   baseurl=https://config.zpagov.us
//   clientid=...
//   clientsecret=...
//   customerid=...
//   [Mobile Admin]
//   baseurl=https://mobile6.zscalerten.net
//   apikey=...
//   secretkey=...
//
// Keys may also be prefixed instead of using sections (zia_username=, zpa_clientid=, zcc_secretkey=, mobile_apikey=).
const fs = require('fs');
const path = require('path');
const os = require('os');

const NAMES = ['legacyapi.txt', 'legacy-api.txt', 'legacy_api.txt'];

function candidateDirs() {
  const dirs = [];
  if (process.env.ZPSL_APP_DIR) dirs.push(process.env.ZPSL_APP_DIR);
  dirs.push(path.dirname(process.execPath), process.cwd(), path.join(os.homedir(), 'Zscaler-Policy-Simulator-Legacy-API'));
  return [...new Set(dirs)];
}

function findFile() {
  if (process.env.ZPSL_CRED_FILE && fs.existsSync(process.env.ZPSL_CRED_FILE)) return process.env.ZPSL_CRED_FILE;
  for (const d of candidateDirs()) {
    let names = [];
    try { names = fs.readdirSync(d); } catch { continue; }
    // Never the shipped example (LegacyAPI-example.txt) or other samples/templates.
    const real = names.filter((n) => !/example|sample|template/i.test(n));
    const hit = real.find((n) => NAMES.includes(n.toLowerCase())) || real.find((n) => /legacy/i.test(n) && /api/i.test(n) && /\.txt$/i.test(n));
    if (hit) return path.join(d, hit);
  }
  return null;
}

const SECTION = [['zia', /^\s*\[?\s*zia\s*\]?\s*$/i], ['zpa', /^\s*\[?\s*zpa\s*\]?\s*$/i], ['zcc', /^\s*\[?\s*(zcc|mobile( admin)?|client connector)\s*\]?\s*$/i]];
const KEY = {
  baseUrl: /^(base ?url|url|host|api ?url|cloud)$/i, username: /^(user(name)?|admin|login|e-?mail)$/i, password: /^(pass(word)?|pwd)$/i,
  apiKey: /^(api ?key|key)$/i, clientId: /^(client ?id)$/i, clientSecret: /^(client ?secret)$/i, customerId: /^(customer ?id|tenant ?id)$/i, secretKey: /^(secret ?key|secret)$/i,
};
const PREFIX = /^(zia|zpa|zcc|mobile|mobileadmin)[ _.-]+(.+)$/i;

function parse(text) {
  const out = { zia: {}, zpa: {}, zcc: {} };
  let section = null;
  for (const raw of String(text).replace(/^﻿/, '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || line.startsWith(';')) continue;
    const sec = SECTION.find(([, re]) => re.test(line) && !/[=:]/.test(line));
    if (sec) { section = sec[0]; continue; }
    const m = line.match(/^([A-Za-z][A-Za-z0-9 _.\-]{0,40}?)\s*[:=]\s*(.*)$/);
    if (!m) continue;
    let k = m[1].trim(), prod = section;
    const pm = k.match(PREFIX);
    if (pm) { prod = /^(zcc|mobile)/i.test(pm[1]) ? 'zcc' : pm[1].toLowerCase(); k = pm[2]; }
    if (!prod) continue;
    const field = Object.keys(KEY).find((f) => KEY[f].test(k.replace(/[_.-]/g, ' ').trim()));
    if (field) out[prod][field] = m[2].trim().replace(/^["']|["']$/g, '');
  }
  return out;
}

function load() {
  const file = findFile();
  if (!file) return null;
  try { return { file, creds: parse(fs.readFileSync(file, 'utf8')) }; } catch (e) { return { file, error: e.message, creds: { zia: {}, zpa: {}, zcc: {} } }; }
}

// What the browser may see: non-secret values to prefill, and which secret fields are set.
const SECRET = new Set(['password', 'apiKey', 'clientSecret', 'secretKey']);
function publicView(creds) {
  const v = {};
  for (const [p, c] of Object.entries(creds)) {
    v[p] = {};
    for (const [k, val] of Object.entries(c)) if (val) v[p][k] = SECRET.has(k) ? true : val;
  }
  return v;
}

// Form values win; blank form fields are filled from the file.
function merge(form = {}, file = {}) {
  const out = {};
  for (const p of ['zia', 'zpa', 'zcc']) {
    out[p] = Object.assign({}, file[p] || {});
    for (const [k, v] of Object.entries(form[p] || {})) if (String(v || '').trim()) out[p][k] = v;
  }
  return out;
}

module.exports = { load, parse, publicView, merge, findFile };
