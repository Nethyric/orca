#!/usr/bin/env node
'use strict';
// Sealed Vault CLI (maintainers only)
//   node scripts/vault.js keygen                  → prints ORCA_VAULT_KEY (private, GitHub secret) and ORCA_VAULT_PUB (public, safe to commit)
//   node scripts/vault.js seal  < upstreams.json  → writes remote/vault.json  (env: ORCA_VAULT_PUB or orca.config.json → vaultPublicKey)
//   node scripts/vault.js open  remote/vault.json → prints the decrypted JSON (env: ORCA_VAULT_KEY)
//   node scripts/vault.js check < upstreams.json  → validates the JSON shape and pings every upstream once
const fs = require('fs'); const path = require('path');
const vault = require('../src/core/vault');
const cfgPath = path.join(__dirname, '..', 'orca.config.json');
const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
const [cmd, arg] = process.argv.slice(2);
const readStdin = () => fs.readFileSync(0, 'utf8');

if (cmd === 'keygen') {
  const kp = vault.keypair();
  console.log('# Add as GitHub → Settings → Secrets → Actions:');
  console.log('ORCA_VAULT_KEY=' + kp.privateKey);
  console.log('# Public key (committed in orca.config.json → vaultPublicKey):');
  console.log('ORCA_VAULT_PUB=' + kp.publicKey);
  if (arg === '--write') { cfg.vaultPublicKey = kp.publicKey; fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + '\n'); console.log('✔ orca.config.json updated'); }
} else if (cmd === 'seal') {
  const pub = process.env.ORCA_VAULT_PUB || cfg.vaultPublicKey;
  if (!pub) { console.error('no public key: set ORCA_VAULT_PUB or orca.config.json → vaultPublicKey'); process.exit(1); }
  const raw = readStdin().trim(); let plain; try { plain = JSON.parse(raw); } catch (e) { console.error('UPSTREAMS is not valid JSON: ' + e.message); process.exit(1); }
  const ups = plain.upstreams || plain;
  const n = Object.values(ups).reduce((a, l) => a + (Array.isArray(l) ? l.length : 0), 0);
  if (!n) { console.error('no upstreams found'); process.exit(1); }
  const box = vault.seal(JSON.stringify(plain), pub); box.issued = new Date().toISOString(); box.aliases = Object.keys(ups);
  const out = arg || path.join(__dirname, '..', 'remote', 'vault.json');
  fs.mkdirSync(path.dirname(out), { recursive: true }); fs.writeFileSync(out, JSON.stringify(box, null, 2) + '\n');
  console.log(`✔ sealed ${n} upstream(s) for ${box.aliases.join(', ')} → ${path.relative(process.cwd(), out)}`);
} else if (cmd === 'open') {
  const key = process.env.ORCA_VAULT_KEY; if (!key) { console.error('ORCA_VAULT_KEY missing'); process.exit(1); }
  console.log(vault.open(JSON.parse(fs.readFileSync(arg || 'remote/vault.json', 'utf8')), key));
} else if (cmd === 'check') {
  const plain = JSON.parse(readStdin()); const ups = plain.upstreams || plain;
  (async () => {
    let bad = 0;
    for (const [alias, list] of Object.entries(ups)) for (const u of list) {
      const t0 = Date.now();
      try {
        const r = await fetch(String(u.url).replace(/\/+$/, '') + '/chat/completions', { method: 'POST', headers: { authorization: 'Bearer ' + u.key, 'content-type': 'application/json' }, body: JSON.stringify({ model: u.model, messages: [{ role: 'user', content: 'Say OK' }], max_tokens: 5 }) });
        console.log(`${r.ok ? '✔' : '✖'} ${alias} ${u.id || ''} ${u.model} → HTTP ${r.status} (${Date.now() - t0} ms)`); if (!r.ok) bad++;
      } catch (e) { console.log(`✖ ${alias} ${u.id || ''} → ${e.message}`); bad++; }
    }
    process.exit(bad ? 2 : 0);
  })();
} else { console.log('usage: vault.js keygen [--write] | seal [out] < upstreams.json | open [file] | check < upstreams.json'); process.exit(1); }
