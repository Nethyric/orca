'use strict';
// Pre-build step: writes src/build-info.json (git-ignored) so the packaged app knows its build token / commit.
// BUILD_TOKEN is provided by CI as ORCA_BUILD_TOKEN (GitHub secret) and must match the gateway's BUILD_TOKEN secret.
const fs = require('fs'); const path = require('path'); const cp = require('child_process');
let commit = ''; try { commit = cp.execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch (_) {}
const info = { buildToken: process.env.ORCA_BUILD_TOKEN || '', builtAt: new Date().toISOString(), commit, ci: !!process.env.GITHUB_ACTIONS };
fs.writeFileSync(path.join(__dirname, '..', 'src', 'build-info.json'), JSON.stringify(info, null, 2) + '\n');
console.log('build-info:', { ...info, buildToken: info.buildToken ? '(set)' : '(default)' });
