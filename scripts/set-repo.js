'use strict';
// Usage: npm run set-repo -- Owner/repo   → rewrites orca.config.json, package.json links and README references
const fs = require('fs'); const path = require('path');
const [repo] = process.argv.slice(2);
if (!repo || !/^[\w.-]+\/[\w.-]+$/.test(repo)) { console.error('usage: npm run set-repo -- Owner/repo'); process.exit(1); }
const root = path.join(__dirname, '..');
const cfgP = path.join(root, 'orca.config.json'); const cfg = JSON.parse(fs.readFileSync(cfgP, 'utf8'));
const old = cfg.repo;
cfg.repo = repo; cfg.homepage = 'https://github.com/' + repo;
fs.writeFileSync(cfgP, JSON.stringify(cfg, null, 2) + '\n');
const pp = path.join(root, 'package.json'); const pkg = JSON.parse(fs.readFileSync(pp, 'utf8')); pkg.homepage = cfg.homepage; pkg.repository = { type: 'git', url: cfg.homepage + '.git' }; fs.writeFileSync(pp, JSON.stringify(pkg, null, 2) + '\n');
for (const f of ['README.md', 'SECURITY.md', 'docs']) {
  const p = path.join(root, f); if (!fs.existsSync(p)) continue;
  const files = fs.statSync(p).isDirectory() ? fs.readdirSync(p).filter((x) => x.endsWith('.md')).map((x) => path.join(p, x)) : [p];
  for (const file of files) if (old) fs.writeFileSync(file, fs.readFileSync(file, 'utf8').split(old).join(repo));
}
console.log('✔ repo =', repo, old && old !== repo ? `(was ${old})` : '');
console.log('  next: npm run vault:keygen -- --write   (new key pair for your fork), then seal your own vault.');
