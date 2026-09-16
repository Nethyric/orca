'use strict';
// Usage: npm run set-repo -- Owner/repo [https://gateway-url]   → rewrites orca.config.json, gateway/wrangler.toml, package.json links
const fs = require('fs'); const path = require('path');
const [repo, gateway] = process.argv.slice(2);
if (!repo || !/^[\w.-]+\/[\w.-]+$/.test(repo)) { console.error('usage: npm run set-repo -- Owner/repo [gatewayUrl]'); process.exit(1); }
const root = path.join(__dirname, '..');
const cfgP = path.join(root, 'orca.config.json'); const cfg = JSON.parse(fs.readFileSync(cfgP, 'utf8'));
cfg.repo = repo; cfg.homepage = 'https://github.com/' + repo; if (gateway) cfg.gateway = gateway.replace(/\/+$/, '');
fs.writeFileSync(cfgP, JSON.stringify(cfg, null, 2) + '\n');
const wp = path.join(root, 'gateway', 'wrangler.toml'); fs.writeFileSync(wp, fs.readFileSync(wp, 'utf8').replace(/REPO = ".*"/, `REPO = "${repo}"`));
const pp = path.join(root, 'package.json'); const pkg = JSON.parse(fs.readFileSync(pp, 'utf8')); pkg.homepage = cfg.homepage; pkg.repository = { type: 'git', url: cfg.homepage + '.git' }; fs.writeFileSync(pp, JSON.stringify(pkg, null, 2) + '\n');
const rm = path.join(root, 'README.md'); if (fs.existsSync(rm)) fs.writeFileSync(rm, fs.readFileSync(rm, 'utf8').replace(/Nethyric\/orca/g, repo));
console.log('✔ repo =', repo, gateway ? '· gateway = ' + cfg.gateway : '');
