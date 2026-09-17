'use strict';
// Sealed Vault — built-in model access without any server of our own.
//
//   Maintainer side (GitHub Action "Seal vault"):  UPSTREAMS JSON  ──seal(appPublicKey)──▶  remote/vault.json (ciphertext only)
//   App side (this file):                          vault.json ──open(appPrivateKey)──▶ live upstream list  ──▶ direct calls to providers
//
//   • The repository only ever contains ciphertext. GitHub Secrets hold UPSTREAMS + the app's private key.
//   • Rotation: edit the UPSTREAMS secret → run the Action → every app picks the new keys up within 15 min. No release, nothing visible.
//   • Scheme: X25519 ECDH (ephemeral) + HKDF-SHA256 + AES-256-GCM  (same construction as libsodium sealed boxes), all from node:crypto.
//   • Threat model: a determined person can extract the private key from a build (it must be there to work — the same is true
//     for any client that talks to a provider directly). What this design stops is the far larger problem of keys sitting in
//     plain text on GitHub / in the zip where scrapers and casual users find them. Per-key quotas + rotation are the real limits.
//   • Failover/rotation logic (dead-key cooldown, minute rotation between keys, 429 → next key) lives here too, so the agent only
//     sees one logical model ("orca/minimax") and the vault decides which upstream serves it right now.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const config = require('./config');

const APP = (() => { try { return require('../../orca.config.json'); } catch (_) { return {}; } })();
const BUILD = (() => { try { return require('../build-info.json'); } catch (_) { return {}; } })();
const REPO = APP.repo || 'Nethyric/orca';
const PKG = (() => { try { return require('../../package.json'); } catch (_) { return { version: '0.0.0' }; } })();
const UA = `ORCA/${PKG.version} (${process.platform}; ${process.arch})`;

// ---------- crypto primitives ----------
function keypair() {
  const kp = crypto.generateKeyPairSync('x25519');
  return { publicKey: kp.publicKey.export({ type: 'spki', format: 'der' }).toString('base64'), privateKey: kp.privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64') };
}
function derive(shared, epkDer, rpkDer) { return Buffer.from(crypto.hkdfSync('sha256', shared, Buffer.alloc(0), Buffer.concat([epkDer, rpkDer]), 32)); }
function seal(plaintext, publicKeyB64) {
  const rpkDer = Buffer.from(publicKeyB64, 'base64');
  const rpk = crypto.createPublicKey({ key: rpkDer, type: 'spki', format: 'der' });
  const eph = crypto.generateKeyPairSync('x25519');
  const epkDer = eph.publicKey.export({ type: 'spki', format: 'der' });
  const key = derive(crypto.diffieHellman({ privateKey: eph.privateKey, publicKey: rpk }), epkDer, rpkDer);
  const iv = crypto.randomBytes(12); const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([c.update(Buffer.from(plaintext, 'utf8')), c.final()]);
  return { v: 1, alg: 'x25519-hkdf-sha256-aes256gcm', epk: epkDer.toString('base64'), iv: iv.toString('base64'), ct: ct.toString('base64'), tag: c.getAuthTag().toString('base64') };
}
function open(box, privateKeyB64) {
  if (!box || box.v !== 1) throw new Error('unsupported vault format');
  const priv = crypto.createPrivateKey({ key: Buffer.from(privateKeyB64, 'base64'), type: 'pkcs8', format: 'der' });
  const epkDer = Buffer.from(box.epk, 'base64');
  const epk = crypto.createPublicKey({ key: epkDer, type: 'spki', format: 'der' });
  const rpkDer = crypto.createPublicKey(priv).export({ type: 'spki', format: 'der' });
  const key = derive(crypto.diffieHellman({ privateKey: priv, publicKey: epk }), epkDer, rpkDer);
  const d = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(box.iv, 'base64')); d.setAuthTag(Buffer.from(box.tag, 'base64'));
  return Buffer.concat([d.update(Buffer.from(box.ct, 'base64')), d.final()]).toString('utf8');
}

// ---------- the app's private key ----------
// Order: env (dev/CI) → build-info.json (baked by scripts/bake.js from the ORCA_VAULT_KEY secret) → none (vault disabled, own keys only).
function privateKey() { return process.env.ORCA_VAULT_KEY || BUILD.vaultKey || ''; }
function publicKey() { const pk = privateKey(); if (!pk) return ''; try { return crypto.createPublicKey(crypto.createPrivateKey({ key: Buffer.from(pk, 'base64'), type: 'pkcs8', format: 'der' })).export({ type: 'spki', format: 'der' }).toString('base64'); } catch (_) { return ''; } }
function enabled() { return !!privateKey(); }

// ---------- fetching the sealed vault ----------
// Sources (first that works wins): GitHub raw → jsDelivr mirror (works where raw.githubusercontent.com is blocked) → local cache.
let vault = null; // { upstreams: {alias: [ {id,url,key,model,maxTokens,headers?} ]}, models?: [...], notice?, minVersion?, fetchedAt, source }
let vaultAt = 0, inflight = null;
function cacheFile() { return path.join(config.getDataDir(), 'vault.cache'); }
function sources() {
  const ref = APP.vaultRef || 'main';
  const list = [];
  if (process.env.ORCA_VAULT_URL) list.push(process.env.ORCA_VAULT_URL);
  list.push(`https://raw.githubusercontent.com/${REPO}/${ref}/remote/vault.json`, `https://cdn.jsdelivr.net/gh/${REPO}@${ref}/remote/vault.json`, `https://github.com/${REPO}/releases/latest/download/vault.json`);
  return list;
}
async function fetchText(url, timeoutMs = 8000) {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), timeoutMs);
  try { const r = await fetch(url, { headers: { 'User-Agent': UA, 'cache-control': 'no-cache' }, signal: ctl.signal }); if (!r.ok) throw new Error('HTTP ' + r.status); return await r.text(); }
  finally { clearTimeout(t); }
}
function parseVault(text, source) {
  const box = JSON.parse(text);
  const plain = JSON.parse(open(box, privateKey()));
  const upstreams = plain.upstreams || plain; // allow bare {alias:[...]} too
  return { upstreams, models: plain.models || null, notice: plain.notice || null, minVersion: plain.minVersion || null, issued: box.issued || plain.issued || null, fetchedAt: Date.now(), source };
}
async function refresh(force = false) {
  if (!enabled()) return null;
  const now = Date.now();
  if (!force && vault && now - vaultAt < 15 * 60 * 1000) return vault;
  if (inflight) return inflight;
  inflight = (async () => {
    let lastErr = '';
    for (const url of sources()) {
      try {
        const text = await fetchText(url);
        const v = parseVault(text, url);
        vault = v; vaultAt = now; lastError = '';
        try { fs.writeFileSync(cacheFile(), text); } catch (_) {}
        applyModels(v);
        return v;
      } catch (e) { lastErr = `${url.replace(/^https?:\/\//, '').split('/')[0]}: ${e.message}`; }
    }
    lastError = lastErr;
    vaultAt = now; // don't hammer while offline
    if (!vault) { try { vault = parseVault(fs.readFileSync(cacheFile(), 'utf8'), 'cache'); applyModels(vault); } catch (_) {} }
    return vault;
  })();
  try { return await inflight; } finally { inflight = null; }
}
let lastError = '';
function applyModels(v) { if (v && Array.isArray(v.models) && v.models.length) config.setRemoteModels(v.models); }
function current() { if (!vault && enabled()) { try { vault = parseVault(fs.readFileSync(cacheFile(), 'utf8'), 'cache'); applyModels(vault); } catch (_) {} } return vault; }
function status() {
  const v = current();
  const aliases = v ? Object.keys(v.upstreams || {}) : [];
  return { enabled: enabled(), ok: !!v, source: v ? v.source : null, fetchedAt: v ? v.fetchedAt : 0, issued: v ? v.issued : null, aliases, keys: aliases.reduce((a, k) => a + ((v.upstreams[k] || []).length), 0), error: lastError, disabled: [...disabled.entries()].filter(([, until]) => until > Date.now()).map(([id]) => id) };
}

// ---------- upstream selection with rotation + failover ----------
const disabled = new Map(); // upstream id → until (ms)
function candidates(alias) {
  const v = current(); if (!v) return [];
  const list = (v.upstreams || {})[alias] || [];
  const live = list.filter((u) => u && u.url && u.key && u.model && !(disabled.get(u.id || u.key) > Date.now()));
  if (!live.length) return list.slice(); // everything cooled down → try them all anyway
  // Load-balance only between keys that serve the SAME model as the alias's primary entry (rotating start
  // point every minute); entries with a different model are pure fallbacks and keep their order.
  const primaryModel = live[0].model;
  const primary = live.filter((u) => u.model === primaryModel), rest = live.filter((u) => u.model !== primaryModel);
  const start = Math.floor(Date.now() / 60000) % primary.length;
  return [...primary.slice(start), ...primary.slice(0, start), ...rest];
}
function liveCount(alias) { const v = current(); if (!v) return 0; return ((v.upstreams || {})[alias] || []).filter((u) => u && u.url && u.key && u.model && !(disabled.get(u.id || u.key) > Date.now())).length; }
function markBad(u, status) {
  const id = u.id || u.key;
  // 401/402/403 = dead or out of credit → rest 6 h; 429 = busy → 90 s; 5xx → 30 s
  const ms = [401, 402, 403].includes(status) ? 6 * 3600e3 : status === 429 ? 90e3 : 30e3;
  disabled.set(id, Date.now() + ms);
}
function isVaultModel(cfg) { return cfg && typeof cfg.model === 'string' && cfg.model.startsWith('orca/'); }
function aliasOf(cfg) { return cfg.model.slice('orca/'.length); }

module.exports = { keypair, seal, open, enabled, publicKey, refresh, current, status, candidates, liveCount, markBad, isVaultModel, aliasOf, REPO };
