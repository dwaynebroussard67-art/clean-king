'use strict';

/**
 * fed register / fed now — the door that lets this checkout start remembering
 * without listing every GitHub repo first.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const FED = path.join(ROOT, 'bin', 'fed.js');

function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ff-fednow-'));
}

function gitRepo() {
  const dir = tmp();
  const g = (args) => spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
  g(['init']);
  g(['remote', 'add', 'origin', 'https://github.com/dwaynebroussard67-art/Forge-Federation.git']);
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'x', scripts: { test: 'node --test' } }));
  fs.writeFileSync(path.join(dir, 'index.js'), 'module.exports = 1;\n');
  return dir;
}

function fed(args, envDir, cwd) {
  return spawnSync(process.execPath, [FED, ...args], {
    cwd: cwd || ROOT,
    encoding: 'utf8',
    env: { ...process.env, FORGE_FEDERATION_DIR: envDir },
  });
}

test('fed register refuses a directory with no origin', () => {
  const empty = tmp();
  const r = fed(['register', empty], tmp());
  assert.equal(r.status, 1);
  const body = JSON.parse(r.stdout);
  assert.equal(body.reason, 'not-a-repository');
});

test('fed register records this checkout from its origin remote', () => {
  const store = tmp();
  const repo = gitRepo();
  const r = fed(['register', repo], store);
  assert.equal(r.status, 0, r.stderr);
  const body = JSON.parse(r.stdout);
  assert.equal(body.action, 'registered');
  assert.equal(body.node.slug, 'forge-federation');
  const realm = fed(['realm', repo], store);
  const who = JSON.parse(realm.stdout);
  assert.equal(who.ok, true);
  assert.equal(who.via, 'path');
});

test('fed now writes a passport into the checkout', () => {
  const store = tmp();
  const repo = gitRepo();
  const r = fed(['now', repo], store);
  assert.equal(r.status, 0, r.stderr + r.stdout);
  const body = JSON.parse(r.stdout);
  assert.equal(body.registered.action, 'registered');
  assert.ok(body.passport, JSON.stringify(body));
  const doc = path.join(repo, 'forge-passport', 'PASSPORT.md');
  assert.equal(fs.existsSync(doc), true);
  const md = fs.readFileSync(doc, 'utf8');
  assert.match(md, /forge-federation|Forge-Federation/i);
});
