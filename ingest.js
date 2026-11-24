#!/usr/bin/env node
/**
 * ingest.js — go and look at every repository, categorise the evidence, and
 * wire the passport to the hub.
 *
 *   node bin/ingest.js [--dir <federation-dir>] [--repos <dir>]
 *
 * For every registered repository with a local checkout:
 *   1. open (or create) its in-repo passport
 *   2. profile it — what it IS (state, not memory)
 *   3. categorise its evidence — structure / contract / test / history /
 *      dependency / risk, every row pointing at something re-derivable
 *   4. link it to the hub and promote UP what has earned the right to travel
 *   5. write PASSPORT.md with the hub's DOWN briefing, so the next agent to
 *      open the repository reads shared context as ordinary context
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const { Federation, NodeRegistry } = require('../src/federation/index.js');
const { RepoPassport } = require('../src/passport/passport.js');
const { up, down, link, upEvidence } = require('../src/federation/hub.js');
const { LinkServer } = require('../src/federation/serve.js');
const { Gate } = require('../src/federation/gate.js');
const { detectTestCommand } = require('../src/forge/runner.js');
// The risk vocabulary lives in src/forge/risks.js so the DOWN side can scan for
// the same classes the UP side filed. Two copies of a detector is two detectors
// that disagree, and a class found in one repository must be lookable-for in
// another by the same pattern or the comparison means nothing.
const { scanRisks } = require('../src/forge/risks.js');

const arg = (n, d = null) => {
  const i = process.argv.indexOf(`--${n}`);
  return i === -1 ? d : process.argv[i + 1];
};

const FED_DIR = arg('dir', path.join(process.env.HOME || '.', '.forge-federation'));
const ONLY = arg('only');

const sha256 = (s) => crypto.createHash('sha256').update(String(s), 'utf8').digest('hex');
const sha256File = (p) => {
  try { return sha256(fs.readFileSync(p)); } catch { return null; }
};

const SKIP = /(^|[\\/])(node_modules|\.git|dist|build|out|coverage|\.next|\.turbo|vendor|\.venv|__pycache__)([\\/]|$)/;

function walk(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (SKIP.test(p) || e.name.startsWith('.')) continue;
    if (e.isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

const EXT_LANG = {
  '.js': 'JavaScript', '.mjs': 'JavaScript', '.cjs': 'JavaScript', '.jsx': 'JavaScript',
  '.ts': 'TypeScript', '.tsx': 'TypeScript',
  '.py': 'Python', '.rb': 'Ruby', '.go': 'Go', '.rs': 'Rust',
  '.java': 'Java', '.kt': 'Kotlin', '.swift': 'Swift',
  '.php': 'PHP', '.cs': 'C#', '.cpp': 'C++', '.c': 'C', '.h': 'C',
  '.html': 'HTML', '.css': 'CSS', '.scss': 'SCSS', '.svelte': 'Svelte', '.vue': 'Vue',
  '.json': 'JSON', '.md': 'Markdown', '.yml': 'YAML', '.yaml': 'YAML', '.sh': 'Shell',
  '.sql': 'SQL', '.toml': 'TOML', '.gradle': 'Gradle',
};

function profileRepo(dir) {
  const files = walk(dir).filter((f) => fs.statSync(f).size < 4_000_000);
  const byLang = {};
  let loc = 0;
  for (const f of files) {
    const ext = path.extname(f).toLowerCase();
    const lang = EXT_LANG[ext];
    if (!lang) continue;
    byLang[lang] = (byLang[lang] || 0) + 1;
    if (['JavaScript', 'TypeScript', 'Python', 'Ruby', 'Go', 'Rust', 'Java', 'PHP', 'C#', 'C++', 'C'].includes(lang)) {
      try { loc += fs.readFileSync(f, 'utf8').split('\n').length; } catch { /* binary */ }
    }
  }
  const languages = Object.entries(byLang).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, v]) => `${k} (${v})`);

  // Frameworks: read from the manifest, never guessed from a filename.
  const frameworks = [];
  let packageManager = null;
  let manifest = null;
  const pkgPath = path.join(dir, 'package.json');
  const pyPath = path.join(dir, 'pyproject.toml');
  const cargoPath = path.join(dir, 'Cargo.toml');
  const goPath = path.join(dir, 'go.mod');
  if (fs.existsSync(pkgPath)) {
    manifest = pkgPath;
    packageManager = fs.existsSync(path.join(dir, 'pnpm-lock.yaml')) ? 'pnpm'
      : fs.existsSync(path.join(dir, 'yarn.lock')) ? 'yarn' : 'npm';
    try {
      const p = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      const deps = { ...(p.dependencies || {}), ...(p.devDependencies || {}) };
      for (const f of ['next', 'react', 'vue', 'svelte', 'express', 'fastify', 'electron', 'drizzle-orm', 'prisma', 'tailwindcss', 'playwright', 'jest', 'vitest']) {
        if (deps[f]) frameworks.push(f);
      }
    } catch { /* an unparseable manifest is evidence, handled below */ }
  } else if (fs.existsSync(pyPath)) { manifest = pyPath; packageManager = 'pip'; frameworks.push('python'); }
  else if (fs.existsSync(cargoPath)) { manifest = cargoPath; packageManager = 'cargo'; frameworks.push('rust'); }
  else if (fs.existsSync(goPath)) { manifest = goPath; packageManager = 'go'; frameworks.push('go'); }

  const tc = detectTestCommand(dir);
  const entryPoints = [];
  for (const c of ['src/main/index.js', 'src/index.js', 'index.js', 'main.py', 'app.py', 'src/main.py', 'main.go', 'src/main.rs', 'manage.py']) {
    if (fs.existsSync(path.join(dir, c))) entryPoints.push(c);
  }

  return { languages, frameworks, packageManager, testCommand: tc ? tc.note : null, entryPoints, loc, fileCount: files.length, manifest };
}


function gitInfo(dir) {
  const g = (args) => {
    const r = spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8' });
    return r.status === 0 ? (r.stdout || '').trim() : null;
  };
  return {
    commits: (() => { const n = g(['rev-list', '--count', 'HEAD']); return n ? Number(n) : null; })(),
    lastCommit: g(['log', '-1', '--format=%cI']),
    contributors: (() => { const c = g(['shortlog', '-sne', '--all']); return c ? c.split('\n').filter(Boolean).length : null; })(),
    branches: (() => { const b = g(['branch', '-a', '--format=%(refname:short)']); return b ? b.split('\n').filter(Boolean).length : null; })(),
    remote: g(['remote', 'get-url', 'origin']),
  };
}

// ------------------------------------------------------------------ the run

const registry = new NodeRegistry(FED_DIR).load();
const federation = new Federation(FED_DIR, { nodes: registry }).load();

const mounted = new Map();
const report = [];
const samePath = (a, b) => path.resolve(a) === path.resolve(b);
let targets = registry.all().filter((n) => n.localPath && fs.existsSync(n.localPath));
if (ONLY) targets = targets.filter((n) => samePath(n.localPath, ONLY));
const missing = registry.all().filter((n) => !n.localPath || !fs.existsSync(n.localPath));

for (const node of targets) {
  const dir = node.localPath;
  const passport = new RepoPassport(dir, { realm: node.realm, slug: node.slug, remote: node.remote });

  let prof;
  try { prof = profileRepo(dir); } catch (e) { report.push({ slug: node.slug, error: String(e.message) }); continue; }

  passport.init({
    name: node.slug,
    remote: node.remote,
    languages: prof.languages,
    frameworks: prof.frameworks,
    packageManager: prof.packageManager,
    testCommand: prof.testCommand,
    entryPoints: prof.entryPoints,
    loc: prof.loc,
    fileCount: prof.fileCount,
    conventions: {
      test: prof.testCommand ? `verify with \`${prof.testCommand}\`` : 'no recognised test command — the forge will refuse to fly this',
      evidence: 'every claim in memories.jsonl points at something re-derivable in evidence.jsonl',
    },
  });
  passport.load();

  const files = walk(dir);
  const E = (o) => passport.recordEvidence(o);

  // structure
  E({ category: 'structure', subject: 'repository', detail: { loc: prof.loc, files: prof.fileCount, languages: prof.languages }, witness: { kind: 'structural', ref: `sha256:${sha256(dir + prof.fileCount)}` } });
  if (prof.entryPoints.length) E({ category: 'structure', subject: 'entry points', detail: prof.entryPoints.join(', '), witness: { kind: 'structural', ref: `path:${prof.entryPoints[0]}` } });

  // contract
  if (prof.manifest) {
    const rel = path.relative(dir, prof.manifest);
    const h = sha256File(prof.manifest);
    E({ category: 'contract', subject: rel, detail: `${prof.packageManager} manifest${prof.frameworks.length ? ` — ${prof.frameworks.join(', ')}` : ''}`, witness: { kind: 'structural', ref: h ? `sha256:${h}` : `path:${rel}` } });
  } else {
    E({ category: 'contract', subject: 'manifest', detail: 'none found — no published contract to check', witness: { kind: 'structural', ref: `path:${dir}` } });
  }

  // test
  const testFiles = files.filter((f) => /(\.test\.|\.spec\.|test_|_test\.|test\.py)/.test(path.basename(f))).length;
  E({
    category: 'test',
    subject: 'verification',
    detail: prof.testCommand ? `command: ${prof.testCommand}; ${testFiles} test file(s)` : `no recognised test command; ${testFiles} test file(s) present`,
    witness: { kind: 'structural', ref: `path:${prof.manifest ? path.relative(dir, prof.manifest) : dir}` },
  });

  // history
  const gi = gitInfo(dir);
  if (gi.commits !== null) {
    E({ category: 'history', subject: 'commits', detail: { commits: gi.commits, contributors: gi.contributors, branches: gi.branches, lastCommit: gi.lastCommit }, witness: { kind: 'structural', ref: `git:${gi.lastCommit || 'head'}` } });
  }

  // dependency
  if (prof.manifest && path.basename(prof.manifest) === 'package.json') {
    try {
      const p = JSON.parse(fs.readFileSync(prof.manifest, 'utf8'));
      const deps = Object.keys(p.dependencies || {}).length;
      const dev = Object.keys(p.devDependencies || {}).length;
      E({ category: 'dependency', subject: 'npm', detail: { dependencies: deps, devDependencies: dev }, witness: { kind: 'structural', ref: `sha256:${sha256File(prof.manifest)}` } });
    } catch {
      E({ category: 'dependency', subject: 'npm', detail: 'package.json did not parse', witness: { kind: 'structural', ref: `path:package.json` } });
    }
  }

  // risk
  const risks = scanRisks(dir, files);
  const grouped = {};
  for (const r of risks) (grouped[r.id] = grouped[r.id] || []).push(r);
  for (const [id, rows] of Object.entries(grouped)) {
    E({ category: 'risk', subject: id, detail: { summary: `${rows.length} site(s) — ${rows[0].why}`, count: rows.length, why: rows[0].why, example: `${rows[0].file}:${rows[0].line}` }, witness: { kind: 'structural', ref: `scan:${id}` } });
  }
  if (!risks.length) E({ category: 'risk', subject: 'scan', detail: 'no risk patterns matched', witness: { kind: 'structural', ref: `scan:clean` } });

  // link + UP only. DOWN waits until every member has contributed, or the
  // first repository processed would only ever see the empty hub.
  link(registry, passport, { localPath: dir });
  passport.writeLink({ hub: FED_DIR });
  const upRes = upEvidence(passport, federation);
  const memRes = up(passport, federation);
  mounted.set(node.realm, passport);

  report.push({
    slug: node.slug,
    realm: node.realm,
    loc: prof.loc,
    languages: prof.languages.slice(0, 3),
    testCommand: prof.testCommand,
    risks: Object.fromEntries(Object.entries(grouped).map(([k, v]) => [k, v.length])),
    evidence: passport.evidence.length,
    promoted: upRes.promoted.length,
    refused: upRes.refused.length,
    memPromoted: memRes.promoted.length,
    waiting: memRes.waiting.length,
    doc: path.relative(process.cwd(), passport.docPath),
  });
}

// ---------------------------------------------------------------- PASS TWO
// Every member has now contributed. Mount the link server and distribute.
const gate = new Gate(FED_DIR, { delegation: process.env.FORGE_DELEGATION || 'ask' });
const server = new LinkServer(FED_DIR, { federation, registry, passports: mounted, gate }).load();
for (const node of targets) {
  const passport = mounted.get(node.realm);
  if (!passport) continue;
  const downRes = down(federation, passport, { realm: node.realm, viewer: node.slug });
  const row = report.find((r) => r.slug === node.slug);
  if (row) { row.hubFacts = downRes.facts.length; row.crossRepo = (downRes.crossRepo || []).length; row.elsewhere = (downRes.elsewhere || []).length; }
}

console.log(JSON.stringify({
  federation: FED_DIR,
  hub: { facts: federation.stats().live, tools: server.tools.list().length, skills: server.skills.promoted().length, requests: server.requests.length },
  gate: gate.status(),
  repos: targets.length,
  withoutCheckout: missing.map((n) => n.slug),
  federationStats: federation.stats(),
  passports: report,
}, null, 2));
