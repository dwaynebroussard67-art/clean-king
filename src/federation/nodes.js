/**
 * nodes.js — the node registry. Who is allowed to say "I observed this"?
 *
 * THE GAP THIS CLOSES
 *
 * In the browser-era Federation, `nodeId` was a free string. The store
 * checked only that it was non-empty:
 *
 *   if (!nodeId) return { rejected: true, reason: 'nodeId' };
 *
 * That was survivable when a node was a cockpit you built. It is fatal the
 * moment a node is a repository, because the entire witness arithmetic rests
 * on DISTINCT nodes:
 *
 *   - five witnesses from one node are ONE witness
 *   - an `outcome` fact travels only when replicated by distinct nodes
 *   - a world claim is `established` at five distinct witnesses
 *
 * Every one of those rules is enforced by comparing node strings. A
 * free-form string is therefore not a name — it is a vote you can mint. One
 * repository calling itself `twld`, `TWLD`, `twld-2` and `twld-prod` is four
 * witnesses and a promotion, and nothing in the store can tell.
 *
 * So identity becomes a REGISTERED FACT, in a chained log, keyed on the one
 * thing a repository cannot lie about: its remote.
 *
 * THE REMOTE IS THE IDENTITY; THE SLUG IS THE NAME
 *
 * A slug is what a person types and what GitHub shows. A remote is what `git
 * clone` needs and what cannot collide. Two entries normalising to the same
 * remote are the same node, whatever they are called.
 *
 * A RENAME IS AN APPENDED ALIAS, NEVER A RE-KEY
 *
 * Rename `TWLD` to `twld-app` on GitHub and the remote moves with it. If the
 * realm key followed the slug, every fact that repo ever landed would
 * silently re-key into a different realm and the repository would come back
 * from the rename looking brand new, with its whole history sitting one key
 * over and invisible — exactly the failure D26 wrote the profile adoption to
 * prevent. So `rename()` appends an alias, the old slug keeps resolving, and
 * the on-disk realm never moves.
 *
 * NOTHING IS EVER DELETED. A repository that stops being worked on is
 * `retired`, which is a status, not an erasure. Its facts stay findable.
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const {
  SHARED_REALM,
  REPO_PREFIX,
  sha256,
  normalizeRemote,
  ownerRepo,
  slugFromRemote,
  sanitizeSlug,
  isRepoRealm,
} = require('./realm.js');

const SCHEMA = 'forgeflight.nodes.v1';
const GENESIS = '0'.repeat(64);

const nowIso = (d) => (d ? new Date(d) : new Date()).toISOString();
const chainHash = (prev, rec) => sha256(`${prev}|${JSON.stringify(rec)}`);

/** The default git runner. Replaced in tests — the registry must be testable
 *  with no repository on disk. */
function gitRemoteOf(cwd) {
  const r = spawnSync('git', ['-C', cwd, 'remote', 'get-url', 'origin'], { encoding: 'utf8' });
  if (r.error || r.status !== 0) return null;
  const out = (r.stdout || '').trim();
  return out || null;
}

class NodeRegistry {
  constructor(dir, opts = {}) {
    this.dir = dir;
    this.logPath = path.join(dir, 'nodes.jsonl');
    this.gitRemote = opts.gitRemote || gitRemoteOf;
    this.nodes = new Map(); // id -> node
    this.bySlug = new Map(); // slug or alias -> id
    this.byRemote = new Map(); // normalized remote -> id
    this.head = GENESIS;
    this.corrupt = 0;
    this.chain = { head: GENESIS, chained: 0, breaks: [] };
  }

  load() {
    fs.mkdirSync(this.dir, { recursive: true });
    if (!fs.existsSync(this.logPath)) return this;
    for (const line of fs.readFileSync(this.logPath, 'utf8').split('\n')) {
      const s = line.trim();
      if (!s) continue;
      try {
        const rec = JSON.parse(s);
        this.apply(rec);
      } catch {
        this.corrupt++;
      }
    }
    this.chain = this.verify();
    this.head = this.chain.head;
    return this;
  }

  // -------------------------------------------------------------- write path

  append(op, data) {
    const rec = { op, data };
    const prev = this.head;
    const hash = chainHash(prev, rec);
    const line = { ...rec, prev, hash, schema: SCHEMA };
    fs.mkdirSync(this.dir, { recursive: true });
    fs.appendFileSync(this.logPath, `${JSON.stringify(line)}\n`, 'utf8');
    this.head = hash;
    this.apply(rec);
    return data;
  }

  apply(rec) {
    const d = rec && rec.data;
    if (!d || !d.id) {
      this.corrupt++;
      return;
    }
    if (rec.op === 'register') {
      this.nodes.set(d.id, { ...d, aliases: [...(d.aliases || [])] });
    } else if (rec.op === 'rename') {
      const n = this.nodes.get(d.id);
      if (!n) {
        this.corrupt++;
        return;
      }
      // The slug is a NAME. The realm is a KEY, and it is set once, at
      // registration, and never moves again. Renaming re-keys nothing: every
      // fact this repository ever landed stays under the realm it was filed
      // in, and the old slug keeps resolving as an alias.
      n.slug = d.slug;
      if (!n.aliases.includes(d.from)) n.aliases.push(d.from);
      n.renamedAt = d.at;
    } else if (rec.op === 'locate') {
      const n = this.nodes.get(d.id);
      if (!n) {
        this.corrupt++;
        return;
      }
      n.localPath = d.localPath;
      n.locatedAt = d.at;
    } else if (rec.op === 'retire') {
      const n = this.nodes.get(d.id);
      if (!n) {
        this.corrupt++;
        return;
      }
      n.status = 'retired';
      n.retiredAt = d.at;
    } else {
      this.corrupt++;
      return;
    }
    this.index(this.nodes.get(d.id));
  }

  index(n) {
    this.byRemote.set(n.remote, n.id);
    this.bySlug.set(String(n.slug).toLowerCase(), n.id);
    for (const a of n.aliases || []) this.bySlug.set(String(a).toLowerCase(), n.id);
  }

  verify() {
    const out = { head: GENESIS, chained: 0, breaks: [] };
    if (!fs.existsSync(this.logPath)) return out;
    let expected = GENESIS;
    let idx = 0;
    for (const raw of fs.readFileSync(this.logPath, 'utf8').split('\n')) {
      const s = raw.trim();
      if (!s) continue;
      idx++;
      let line;
      try {
        line = JSON.parse(s);
      } catch {
        out.breaks.push({ line: idx, kind: 'unparseable' });
        continue;
      }
      const body = { op: line.op, data: line.data };
      if (line.prev !== expected) out.breaks.push({ line: idx, kind: 'prev-mismatch' });
      if (line.hash !== chainHash(line.prev, body)) out.breaks.push({ line: idx, kind: 'hash-mismatch' });
      expected = line.hash;
      out.chained++;
    }
    out.head = expected;
    return out;
  }

  // ------------------------------------------------------------------ writes

  /**
   * Register a repository as a node. Idempotent by remote: registering the
   * same remote twice returns the existing node rather than minting a second
   * identity, which is the whole point of keying on the remote.
   */
  register({ remote, slug, localPath, defaultBranch, at } = {}) {
    const norm = normalizeRemote(remote);
    if (!norm) return { rejected: true, reason: 'not-a-remote', detail: `Cannot read a repository identity from ${remote || '(none)'}.` };

    const existing = this.byRemote.get(norm);
    if (existing) {
      const node = this.nodes.get(existing);
      if (localPath && node.localPath !== localPath) return this.locate(node, localPath, at);
      return { ok: true, node, action: 'already-registered' };
    }

    const wantSlug = sanitizeSlug(slug) || slugFromRemote(norm);
    if (!wantSlug) return { rejected: true, reason: 'no-slug', detail: 'A node needs a name and none could be derived from that remote.' };
    if (this.bySlug.has(wantSlug) && this.nodes.get(this.bySlug.get(wantSlug)).remote !== norm) {
      return { rejected: true, reason: 'slug-taken', detail: `The slug '${wantSlug}' already belongs to a different repository. Names are unique; pick another.` };
    }

    const node = {
      id: `n_${sha256(norm).slice(0, 12)}`,
      schema: SCHEMA,
      remote: norm,
      ownerRepo: ownerRepo(norm),
      slug: wantSlug,
      realm: `${REPO_PREFIX}${wantSlug}`,
      aliases: [],
      localPath: localPath || null,
      defaultBranch: defaultBranch || null,
      status: 'active',
      registeredAt: nowIso(at),
    };
    this.append('register', node);
    return { ok: true, node, action: 'registered' };
  }

  /**
   * Register the checkout you are standing in. Identity still comes from the
   * origin remote — a path is not a vote. Without this, `fed sync` is the only
   * door and a single repo cannot start remembering until GitHub lists every
   * other repo too.
   */
  registerHere(cwd, at) {
    const here = path.resolve(cwd || process.cwd());
    const remote = this.gitRemote(here);
    if (!remote) {
      return { rejected: true, reason: 'not-a-repository', detail: `${here} is not a git repository with an origin remote.` };
    }
    return this.register({ remote, localPath: here, at });
  }

  /**
   * A rename is an appended alias. The old slug keeps resolving forever, and
   * the REALM DOES NOT CHANGE — see the note in `apply`.
   *
   * Moving a repository's facts to a new realm key is a different operation
   * with a different blast radius: it rewrites every fact the repository ever
   * landed. When that is wanted it should be an explicit, human-signed
   * migration that reports what it moved, never a side effect of renaming.
   */
  rename(fromSlug, toSlug, at) {
    const id = this.bySlug.get(String(fromSlug || '').toLowerCase());
    if (!id) return { rejected: true, reason: 'unknown-node', detail: `No repository is registered under '${fromSlug}'.` };
    const next = sanitizeSlug(toSlug);
    if (!next) return { rejected: true, reason: 'bad-slug', detail: `'${toSlug}' is not a usable repository name.` };

    const node = this.nodes.get(id);
    const taken = this.bySlug.get(next);
    if (taken && taken !== id) {
      return { rejected: true, reason: 'slug-taken', detail: `The slug '${next}' already belongs to a different repository.` };
    }
    this.append('rename', { id, slug: next, from: node.slug, at: nowIso(at) });
    return { ok: true, node: this.nodes.get(id), action: 'renamed' };
  }

  /** Record where this repository lives on this machine. Never invents one. */
  locate(nodeOrSlug, localPath, at) {
    const node = typeof nodeOrSlug === 'string' ? this.bySlugLookup(nodeOrSlug) : nodeOrSlug;
    if (!node) return { rejected: true, reason: 'unknown-node', detail: `No repository is registered under '${nodeOrSlug}'.` };
    this.append('locate', { id: node.id, localPath: localPath || null, at: nowIso(at) });
    return { ok: true, node: this.nodes.get(node.id), action: 'located' };
  }

  /** Retired, never deleted. The facts a retired repo landed stay findable. */
  retire(slug, at) {
    const node = this.bySlugLookup(slug);
    if (!node) return { rejected: true, reason: 'unknown-node', detail: `No repository is registered under '${slug}'.` };
    this.append('retire', { id: node.id, at: nowIso(at) });
    return { ok: true, node: this.nodes.get(node.id), action: 'retired' };
  }

  bySlugLookup(slug) {
    const id = this.bySlug.get(String(slug || '').toLowerCase());
    return id ? this.nodes.get(id) : null;
  }

  /**
   * Is this a node I know? Accepts a node id, a slug, an old alias, or a
   * remote in any of the forms git will print.
   *
   * This is the gate the store leans on. It is deliberately the only check:
   * the registry answers "is this one of ours", never "is this one good". A
   * reputation system is not needed, because a registered node still cannot
   * produce a witness that must be BELIEVED — the worst it can do is file
   * unverifiable outcome noise, which does not travel.
   */
  has(input) {
    const raw = String(input ?? '').trim();
    if (!raw) return false;
    if (this.nodes.has(raw)) return true;
    const norm = normalizeRemote(raw);
    if (norm && this.byRemote.has(norm)) return true;
    return this.bySlug.has(raw.toLowerCase());
  }

  // ------------------------------------------------------------------- reads

  get(slugOrRemote) {
    const norm = normalizeRemote(slugOrRemote);
    if (norm && this.byRemote.has(norm)) return this.nodes.get(this.byRemote.get(norm));
    return this.bySlugLookup(slugOrRemote);
  }

  all() {
    return [...this.nodes.values()];
  }

  active() {
    return this.all().filter((n) => n.status !== 'retired');
  }

  /** Every realm this Federation can hold facts in, commons first. */
  realms() {
    return [SHARED_REALM, ...this.all().map((n) => n.realm)];
  }

  /**
   * THE MOVEMENT PRIMITIVE. Given almost anything — a realm, a slug, a remote,
   * a local path, or nothing at all — say which realm we are standing in.
   *
   * THIS IS THE SWITCH. It is how the collective moves between repositories:
   * the realm is not chosen from a menu, it is DERIVED from where you are
   * standing. `cd` into a checkout and the cockpit is that repository.
   *
   * Resolution order, and it never guesses:
   *   1. an explicit realm string (registered, or the commons)
   *   2. a slug or alias in the registry
   *   3. a local path the registry already knows
   *   4. a remote, normalised and looked up
   *   5. any other path -> `git remote get-url origin` -> (4)
   *   6. nothing -> the current working directory -> (5)
   *
   * Every failure is NAMED. "I do not know which repository this is" has to
   * be sayable, because the alternative is quietly filing a fact about
   * `striper` into `TWLD`, and a collective that files facts into the wrong
   * repository is worse than one that holds nothing.
   */
  resolveRealm(input, { cwd } = {}) {
    const raw = input == null ? '' : String(input).trim();

    if (!raw) {
      if (!cwd) return { ok: true, realm: SHARED_REALM, node: null, via: 'default' };
      return this.resolveRealm(cwd, {});
    }

    if (raw === SHARED_REALM) return { ok: true, realm: SHARED_REALM, node: null, via: 'commons' };
    if (isRepoRealm(raw)) return this.resolveRealm(raw.slice(REPO_PREFIX.length), { cwd });

    if (this.bySlug.has(raw.toLowerCase())) {
      const node = this.nodes.get(this.bySlug.get(raw.toLowerCase()));
      return { ok: true, realm: node.realm, node, via: 'slug' };
    }

    // A place on disk we have already been told about. Checked before the
    // remote branch, because a path is never a remote and this saves a
    // subprocess on the common case.
    const byPath = this.all().find((n) => n.localPath && samePath(n.localPath, raw));
    if (byPath) return { ok: true, realm: byPath.realm, node: byPath, via: 'path' };

    const norm = normalizeRemote(raw);
    if (norm) {
      if (this.byRemote.has(norm)) {
        const node = this.nodes.get(this.byRemote.get(norm));
        return { ok: true, realm: node.realm, node, via: 'remote' };
      }
      return { ok: false, reason: 'unregistered-repo', detail: `${ownerRepo(norm) || norm} is not registered. Register it before it can land facts.`, remote: norm };
    }

    // Not a realm, not a slug, not a known path, not a remote — ask git.
    const remote = this.gitRemote(raw);
    if (!remote) return { ok: false, reason: 'not-a-repository', detail: `${raw} is not a git repository with an origin remote.` };
    const node = this.byRemote.get(normalizeRemote(remote));
    if (!node) {
      return { ok: false, reason: 'unregistered-repo', detail: `${raw} is a repository (${ownerRepo(remote) || remote}) but it is not registered.`, remote };
    }
    return { ok: true, realm: this.nodes.get(node).realm, node: this.nodes.get(node), via: 'path' };
  }

  /**
   * Discovery. `gh repo list --json nameWithOwner,url` piped in.
   *
   * Upsert only: a repository that has disappeared from GitHub is NOT
   * retired, because a person may have made it private or renamed it, and
   * deleting a node on a bad sync would strand its facts.
   */
  syncFromGitHub(repos, { at } = {}) {
    const out = { registered: 0, already: 0, skipped: 0, nodes: [] };
    for (const r of repos || []) {
      const remote = normalizeRemote(r.url || (r.nameWithOwner ? `https://github.com/${r.nameWithOwner}` : r.sshUrl));
      if (!remote) {
        out.skipped++;
        continue;
      }
      const res = this.register({ remote, slug: r.name || slugFromRemote(remote), defaultBranch: r.defaultBranchRef ? r.defaultBranchRef.name : null, at });
      if (res.rejected) {
        out.skipped++;
        continue;
      }
      if (res.action === 'registered') out.registered++;
      else out.already++;
      out.nodes.push(res.node);
    }
    return out;
  }
}

function samePath(a, b) {
  const norm = (p) => path.resolve(String(p)).replace(/[\\/]+$/, '').toLowerCase();
  try {
    return norm(a) === norm(b);
  } catch {
    return false;
  }
}

module.exports = { NodeRegistry, SCHEMA, GENESIS, chainHash, gitRemoteOf };
