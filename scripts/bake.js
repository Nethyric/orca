'use strict';
// Pre-build step: writes src/build-info.json (git-ignored) so the packaged app knows its build token / commit.
// ORCA_VAULT_KEY (GitHub secret) is the app's private key for opening remote/vault.json (see src/core/vault.js).
const fs = require('fs'); const path = require('path'); const cp = require('child_process');
let commit = ''; try { commit = cp.execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch (_) {}
const info = { vaultKey: process.env.ORCA_VAULT_KEY || '', builtAt: new Date().toISOString(), commit, ci: !!process.env.GITHUB_ACTIONS };
if (!info.vaultKey) console.warn('⚠ ORCA_VAULT_KEY not set — this build has NO built-in models (users must bring their own key).');
fs.writeFileSync(path.join(__dirname, '..', 'src', 'build-info.json'), JSON.stringify(info, null, 2) + '\n');
console.log('build-info:', { ...info, vaultKey: info.vaultKey ? '(set)' : '(none)' });
