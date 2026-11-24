#!/usr/bin/env node
/**
 * fed — the Federation command line.
 *
 * The carrier is a library. This is the smallest possible handle on it, and
 * it exists mainly to prove the movement story: run `fed realm` inside any
 * checkout and the Federation tells you which repository you are standing in
 * without being told.
 *
 *   fed sync                     discover repositories from `gh` and register them
 *   fed register [path]          register THIS checkout from its origin remote
 *   fed now [path]               register, ingest, write PASSPORT.md — use it today
 *   node bin/desk.js             talk; every turn reads the passport; `remember …` writes it
 *   node bin/door.js             the front door: link ANY AI in a browser tab (docs/DOOR.md)
 *   fed realms                   list the realms this Federation can hold facts in
 *   fed realm [path]             which repository is this? (default: cwd)
 *   fed land --realm --shelf --subject --predicate --object --witness --node --ref
 *                                [--carrier repair|browser]   default: repair
 *   fed brief [--realm R] [--carrier C]
 *                                what a reader standing in R would be handed
 *   fed bridge --from browser --to repair --node N [--sig S ...] [--actor NAME]
 *                                move facts across carriers, with provenance
 *   fed lessons <cycle-dir> --slug S --node N [--json]
 *                                read a repair cycle, verify its ledger from
 *                                scratch, and land the lesson
 *   fed bar --slug S [--issue <path>]
 *                                the repair bar as an executable precondition;
 *                                --issue freezes it into a hashed receipt
 *   fed guard <cycle-dir> --slug S [--bar <receipt>]
 *                                is this cycle COMPARABLE to what this repo
 *                                already knows? Writes nothing.
 *   fed probe --slug S [--dir D] [--all]
 *                                look for the risk classes other repositories
 *                                filed, in THIS tree, by file and line
 *   fed stats
 *
 * THE BAR IS CHECKABLE, NOT JUST READABLE. `fed brief` prints a repository's
 * repair bar as a sentence; `fed bar --issue` freezes that sentence into a
 * hashed receipt and `fed guard` holds a finished cycle to it. See
 * docs/REPAIR-BAR.md.
 *
 * TWO CARRIERS. This store's population is `repair`: nodes are repositories and
 * readers are agents about to patch a file. The browser carrier is Forge
 * Flight's. They are separated in the fact's SIGNATURE, so they cannot pool
 * witnesses by accident, and `fed brief` shows one at a time. Facts cross only
 * through `fed bridge`, and repair -> browser needs --actor, because that
 * direction exports onto a surface that types into third-party chat.
 * See docs/CARRIERS.md.
 */

'use strict';

const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');

const { Federation, NodeRegistry, CARRIERS, DEFAULT_CARRIER, transfer } = require('../src/federation/index.js');
const { readCycle, landLesson } = require('../src/forge/lessons.js');
const { issueBar, readBar, writeBarReceipt, guardCycle } = require('../src/forge/bar.js');
const { probe, RISK_CLASSES } = require('../src/forge/risks.js');

const DIR = process.env.FORGE_FEDERATION_DIR || path.join(os.homedir(), '.forge-federation');

function arg(name, def = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? def : process.argv[i + 1];
}
const flag = (name) => process.argv.includes(`--${name}`);

function open() {
  const nodes = new NodeRegistry(DIR).load();
  return { nodes, federation: new Federation(DIR, { nodes }).load() };
}

const out = (v) => console.log(typeof v === 'string' ? v : JSON.stringify(v, null, 2));

const COMMANDS = {
  sync() {
    const { nodes } = open();
    const r = spawnSync('gh', ['repo', 'list', '--limit', '200', '--json', 'name,nameWithOwner,url,defaultBranchRef'], {
      encoding: 'utf8',
    });
    if (r.error || r.status !== 0) {
      out({ rejected: true, reason: 'gh-unavailable', detail: 'Discovery needs the `gh` CLI, authenticated. Registering by hand still works.' });
      process.exitCode = 1;
      return;
    }
    let repos;
    try {
      repos = JSON.parse(r.stdout || '[]');
    } catch {
      out({ rejected: true, reason: 'gh-unparseable', detail: '`gh repo list` returned something that is not JSON.' });
      process.exitCode = 1;
      return;
    }
    out(nodes.syncFromGitHub(repos));
  },

  register() {
    const { nodes } = open();
    const here = process.argv[3] || process.cwd();
    const res = nodes.registerHere(here);
    out(res);
    if (res.rejected) process.exitCode = 1;
  },

  now() {
    const { nodes } = open();
    const here = path.resolve(process.argv[3] || process.cwd());
    const registered = nodes.registerHere(here);
    if (registered.rejected) {
      out(registered);
      process.exitCode = 1;
      return;
    }
    const ingest = spawnSync(process.execPath, [path.join(__dirname, 'ingest.js'), '--dir', DIR, '--only', here], {
      encoding: 'utf8',
    });
    let ingested = null;
    try { ingested = JSON.parse(ingest.stdout || 'null'); } catch { ingested = { raw: ingest.stdout, err: ingest.stderr }; }
    const realm = nodes.resolveRealm(here);
    out({
      registered: { action: registered.action, slug: registered.node && registered.node.slug, realm: registered.node && registered.node.realm },
      ingestStatus: ingest.status,
      passport: ingested && ingested.passports && ingested.passports[0] ? ingested.passports[0].doc : null,
      realm,
      how: 'node bin/fed.js now   # register this checkout, write forge-passport/PASSPORT.md, brief from the hub',
    });
    if (ingest.status !== 0) process.exitCode = 1;
  },

  realms() {
    const { nodes, federation } = open();
    out(nodes.all().map((n) => ({ realm: n.realm, slug: n.slug, remote: n.remote, localPath: n.localPath, status: n.status })));
    void federation;
  },

  realm() {
    const { nodes } = open();
    out(nodes.resolveRealm(process.argv[3] || process.cwd()));
  },

  land() {
    const { federation } = open();
    const res = federation.land({
      carrier: arg('carrier', DEFAULT_CARRIER),
      realm: arg('realm', 'shared'),
      shelf: arg('shelf', 'operational'),
      equation: { subject: arg('subject'), predicate: arg('predicate'), object: arg('object') },
      witness: arg('witness', 'structural'),
      nodeId: arg('node'),
      reference: arg('ref'),
      target: arg('target'),
      actor: arg('actor'),
    });
    out(res);
    if (res.rejected) process.exitCode = 1;
  },

  brief() {
    const { nodes, federation } = open();
    const where = arg('realm', process.cwd());
    const resolved = nodes.resolveRealm(where);
    const realm = resolved.ok ? resolved.realm : 'shared';
    if (!resolved.ok) console.error(`note: ${resolved.reason} — ${resolved.detail}`);
    const carrier = arg('carrier', DEFAULT_CARRIER);
    const b = federation.briefing({ realm, carrier, viewer: arg('viewer', resolved.node ? resolved.node.slug : null) });
    if (b.rejected) {
      out(b);
      process.exitCode = 1;
      return;
    }
    for (const f of b.facts) {
      const arrived = (f.witnesses || []).filter((w) => w.origin).length;
      const mark = arrived ? ` · ${arrived} arrived (informs, does not vote)` : '';
      console.log(`  [${f.carrier}/${f.realm}/${f.shelf}] ${f.rendered}  (${f.status}, ${f.observed}/${f.distinct} observed${mark})`);
    }
    const other = Object.entries(b.otherCarriers || {});
    console.log(`\n${b.facts.length} '${carrier}' facts for ${realm}; ${b.withheld} withheld as not-yet-portable.`);

    // THE POINTER FROM THE SENTENCE TO THE CHECK.
    //
    // A briefing prints a bar as a line of text, and text an agent can ignore is
    // a suggestion. So the read ends by saying what to do with it: issue the bar
    // BEFORE repairing, guard the cycle AFTER. Without this the executable path
    // exists but nothing tells anybody it does.
    const mySlug = resolved.node ? resolved.node.slug : arg('slug');
    const myBar = mySlug && b.facts.find((f) => f.equation.predicate === 'risk_repair_bar' && f.equation.subject === `repo:${mySlug}`);
    if (myBar) {
      console.log(`\nrepo:${mySlug} has a bar. It is checkable, not just readable:`);
      console.log(`  fed bar --slug ${mySlug} --carrier ${carrier} --issue .forge/bar.json   # BEFORE you repair`);
      console.log(`  fed guard <cycle-dir> --slug ${mySlug} --carrier ${carrier} --bar .forge/bar.json   # AFTER`);
      console.log(`  the verdict is COMPARABLE, not ALLOWED: it says whether this cycle can be filed beside what this repo already knows.`);
    }
    if (other.length) {
      console.log(`not shown, held by another carrier: ${other.map(([c, n]) => `${c} (${n})`).join(', ')}`);
      console.log(`  a briefing shows one population at a time. Use --carrier to read the other, or \`fed bridge\` to move a fact.`);
    }
  },

  /**
   * Move facts from one carrier to another, with provenance.
   *
   * Two directories, because the real topology is two files: the browser's own
   * Federation lives in Forge Flight's userData. Both default to this store's
   * directory, which is legitimate too — a carrier is a field on the fact, not
   * a file, so one store MAY hold both populations and still keep them apart on
   * every read. Naming the directories separately is how you bridge the real
   * two-file topology.
   *
   * Nothing is ever written to the source except the `transfer-out` event, and
   * a source opened from an export that cannot be written to still works: the
   * destination logs its side and says so.
   */
  bridge() {
    const from = arg('from');
    const to = arg('to', DEFAULT_CARRIER);
    if (!CARRIERS.includes(from)) {
      out({ rejected: true, reason: 'carrier', detail: `--from is required and must be one of ${CARRIERS.join(', ')}.` });
      process.exitCode = 1;
      return;
    }
    if (!CARRIERS.includes(to)) {
      out({ rejected: true, reason: 'carrier', detail: `--to must be one of ${CARRIERS.join(', ')}.` });
      process.exitCode = 1;
      return;
    }
    if (from === to) {
      out({ rejected: true, reason: 'same-carrier', detail: `--from and --to must differ (both '${from}'). A fact cannot arrive from where it already is.` });
      process.exitCode = 1;
      return;
    }

    const sourceDir = arg('source', DIR);
    const destDir = arg('dest', DIR);
    const source = new Federation(sourceDir).load();
    const dest = destDir === sourceDir ? source : new Federation(destDir).load();

    const sigs = [];
    process.argv.forEach((a, i) => { if (a === '--sig' && process.argv[i + 1]) sigs.push(process.argv[i + 1]); });
    if (!sigs.length && !flag('all')) {
      out({
        rejected: true,
        reason: 'selection',
        detail: 'Name the facts with one or more --sig <signature>, or pass --all. Moving everything is a decision to make out loud.',
        sourceFacts: source.live().length,
      });
      process.exitCode = 1;
      return;
    }

    const res = transfer(source, dest, {
      from,
      to,
      nodeId: arg('node'),
      actor: arg('actor'),
      reason: arg('reason'),
      signatures: sigs.length ? sigs : undefined,
      where: flag('all') ? () => true : undefined,
    });
    out(res);
    if (res.rejected) process.exitCode = 1;
  },

  /**
   * Turn a completed repair cycle into memory.
   *
   * The ledger is re-derived here from the published format rather than read
   * through the repair engine's own verifier, because a `structural` witness
   * means "anybody can check this on demand" — and "the engine said it passed"
   * is an `outcome`, which does not travel on its own.
   *
   * What lands is deliberately split: the METHOD and its bar go to the commons,
   * where another repository's briefing will pick them up, and the defect
   * specifics stay in `repo:<slug>`, because repo A's probe failures are defined
   * by repo A's probe contract. The scope line travels with the claim every time.
   */
  lessons() {
    const dir = process.argv[3];
    if (!dir || dir.startsWith('--')) {
      out({ rejected: true, reason: 'no-directory', detail: 'usage: fed lessons <cycle-dir> --slug <slug> --node <nodeId>' });
      process.exitCode = 1;
      return;
    }
    const read = readCycle(dir);
    if (read.rejected) {
      out(read);
      process.exitCode = 1;
      return;
    }
    const slug = arg('slug', read.cycle.project);
    if (!slug) {
      out({ rejected: true, reason: 'slug', detail: 'Name the repository with --slug; the cycle records no project.' });
      process.exitCode = 1;
      return;
    }
    const { federation } = open();
    const res = landLesson(federation, read.cycle, { slug, nodeId: arg('node', slug), carrier: arg('carrier', DEFAULT_CARRIER) });
    if (flag('cycle')) {
      out({ ...res, cycle: { runId: read.cycle.runId, head: read.cycle.head, events: read.cycle.eventCount, gates: read.cycle.gatesPassed, project: read.cycle.project } });
    } else {
      out(res);
    }
    if (res.rejected || res.refused.length) process.exitCode = 1;
  },

  /**
   * The repair bar, as an executable precondition rather than a sentence.
   *
   * Reads the commons for `risk_repair_bar(repo:<slug>)` and splits what it
   * finds into what BINDS this repository and what merely INFORMS it. Another
   * repository's bar is advisory and there is no path from it to a refusal,
   * because a bounded historical observation from somewhere else is not a rule
   * for here.
   *
   *   fed bar --slug S [--carrier C]        read it
   *   fed bar --slug S --issue <path>       freeze it into a hashed receipt
   *
   * --issue is the interesting one. A bar read at the moment of checking is a
   * bar nobody was ever shown, so the receipt records the obligations, the
   * signature of every fact they came from, the store head, and the pattern
   * vocabulary the checks will use -- and hashes the lot. `fed guard` recomputes
   * that hash on the way in, which is what stops a bar being loosened between
   * being shown to an agent and being used to hold one.
   */
  bar() {
    const slug = arg('slug');
    if (!slug) {
      out({ rejected: true, reason: 'slug', detail: 'usage: fed bar --slug <slug> [--carrier repair|browser] [--issue <path>]' });
      process.exitCode = 1;
      return;
    }
    const { federation } = open();
    const carrier = arg('carrier', DEFAULT_CARRIER);
    const issueTo = arg('issue');

    if (!issueTo) {
      const read = readBar(federation, { slug, carrier });
      if (read.rejected) {
        out(read);
        process.exitCode = 1;
        return;
      }
      if (!flag('json')) {
        const b = read.binding;
        console.log(`repo:${slug}  [${carrier}]`);
        if (!b) console.log('  no bar recorded. Ingest a completed cycle with `fed lessons` first.');
        else {
          console.log(`  BINDS: ${b.object}`);
          console.log(`    ${b.status}, ${b.observed}/${b.distinct} observed · ${b.signature.slice(0, 16)} · ${b.reference || 'no reference'}`);
          if (b.scope) console.log(`    scope: ${b.scope}`);
          if (b.unverifiable) {
            console.log(`    UNVERIFIABLE — no cycle is comparable to this bar until that is resolved:`);
            for (const p of b.problems) console.log(`      · ${p}`);
          } else {
            for (const o of b.obligations) console.log(`    · ${o.token}${o.min != null ? ` (>= ${o.min})` : ''}`);
          }
        }
        if (read.prior.length) {
          console.log(`\n  EARLIER BARS for this repository (${read.prior.length}), superseded by recency, kept so the choice is visible:`);
          for (const pr of read.prior.slice(0, 5)) console.log(`    · ${pr.object}  (${pr.at || 'no time recorded'})`);
        }
        for (const n of read.notes || []) console.log(`\n  NOTE: ${n}`);
        if (read.advisory.length) {
          console.log(`\n  ADVISORY — ${read.advisory.length} other repository(ies), reported and binding nothing here:`);
          for (const a of read.advisory.slice(0, 8)) {
            console.log(`    · ${a.subject} → ${a.object}`);
            if (a.scope) console.log(`        scope: ${a.scope}`);
          }
        }
        if (read.withheld) console.log(`\n  ${read.withheld} fact(s) withheld as not yet portable.`);
        return;
      }
      out(read);
      return;
    }

    const issued = issueBar(federation, { slug, carrier });
    if (issued.rejected) {
      out(issued);
      process.exitCode = 1;
      return;
    }
    const written = writeBarReceipt(issueTo, issued.bar);
    if (written.rejected) {
      out(written);
      process.exitCode = 1;
      return;
    }
    out({
      ok: true,
      path: written.path,
      id: written.id,
      slug,
      carrier,
      binding: issued.bar.binding ? issued.bar.binding.object : null,
      unverifiable: issued.bar.binding ? issued.bar.binding.unverifiable : null,
      advisory: issued.bar.advisory.length,
      head: issued.bar.provenance.head,
      note: 'Hand this receipt to the agent BEFORE it repairs. `fed guard <cycle-dir> --slug ' + slug + ' --bar ' + written.path + '` holds the cycle to it.',
    });
  },

  /**
   * Hold a completed cycle against the bar of the repository it repaired.
   *
   *   fed guard <cycle-dir> --slug S [--bar <receipt>] [--carrier C]
   *
   * The verdict is `comparable`, not `allowed`. A cycle that does not clear the
   * bar is not forbidden work — it is work that cannot be filed beside what this
   * repository already knows as though the two were the same kind of thing. It
   * refuses to WITNESS, not to ACT.
   *
   * Writes nothing. The result says `wrote: false` and `headUnchanged`, so a
   * caller cannot assume a check mutated memory.
   */
  guard() {
    const dir = process.argv[3];
    if (!dir || dir.startsWith('--')) {
      out({ rejected: true, reason: 'no-directory', detail: 'usage: fed guard <cycle-dir> --slug <slug> [--bar <receipt>] [--carrier repair|browser]' });
      process.exitCode = 1;
      return;
    }
    const slug = arg('slug');
    if (!slug) {
      out({ rejected: true, reason: 'slug', detail: 'Name the repository with --slug. A bar binds the repository it is about, so the guard has to know which one that is.' });
      process.exitCode = 1;
      return;
    }
    const { federation } = open();
    const res = guardCycle(federation, {
      cycleDir: dir,
      slug,
      barPath: arg('bar'),
      carrier: arg('carrier', DEFAULT_CARRIER),
    });

    if (flag('json')) {
      out(res);
    } else if (res.rejected && !res.obligations) {
      console.log(`REFUSED  ${res.reason}`);
      console.log(`  ${res.detail}`);
    } else if (res.reason === 'no-bar-recorded') {
      // Exit 0 here, and say why out loud. A repository with no ingested cycle
      // has nothing to be compared against; that is not a clearance and it is
      // not a failure either, and a hook that aborts on it would block every
      // repository the first time anybody tried to repair it.
      console.log(`NO BAR RECORDED  repo:${slug}  [${res.carrier}]`);
      console.log(`  ${res.detail}`);
      if (res.advisory && res.advisory.length) {
        console.log(`  advisory (binding nothing here): ${res.advisory.slice(0, 6).map((a) => `${a.subject} → ${a.object}`).join('\n' + ' '.repeat(31))}`);
      }
      console.log(`  wrote: ${res.wrote} · head unchanged: ${res.headUnchanged}`);
    } else {
      console.log(`${res.comparable ? 'COMPARABLE' : 'NOT COMPARABLE'}  repo:${slug}  [${res.carrier}]  — ${res.reason}`);
      console.log(`  bar: ${res.bar.object}`);
      console.log(`  issued: ${res.bar.issuedAt} · ${res.bar.id.slice(0, 16)}${res.bar.issuedNow ? ' (read now; no receipt was shown to the agent beforehand)' : ''}`);
      if (res.bar.scope) console.log(`  scope: ${res.bar.scope}`);
      for (const o of res.obligations) {
        const mark = o.verdict === 'met' ? 'met' : o.verdict === 'unmet' ? 'UNMET' : 'INDETERMINATE';
        console.log(`  [${mark.padEnd(13)}] ${o.token}`);
        console.log(`                   ${o.detail}`);
      }
      if (res.problems && res.problems.length) for (const p of res.problems) console.log(`  · ${p}`);
      if (res.drift && res.drift.moved) {
        console.log(`  DRIFT: ${res.drift.harder ? 'the commons TIGHTENED since this receipt was issued' : 'the commons moved since issue, and did not tighten'}`);
        if (res.drift.added.length) console.log(`    gained:   ${res.drift.added.join(', ')}`);
        if (res.drift.raised.length) console.log(`    raised:   ${res.drift.raised.join(', ')}`);
        if (res.drift.removed.length) console.log(`    dropped:  ${res.drift.removed.join(', ')}`);
        if (res.drift.lowered.length) console.log(`    lowered:  ${res.drift.lowered.join(', ')}`);
        for (const n of res.drift.notes) console.log(`    · ${n}`);
        console.log(`    the cycle is held to the bar it was SHOWN, not to the current one.`);
      }
      if (res.selfCheck) console.log('  note: this is the cycle that SET the bar — a self-check, not corroboration.');
      if (res.prior && res.prior.length) {
        console.log(`  earlier bar(s) for this repository, superseded by recency: ${res.prior.slice(0, 4).map((a) => a.object).join(' | ')}`);
      }
      for (const n of res.notes || []) console.log(`  NOTE: ${n}`);
      if (res.advisory && res.advisory.length) {
        console.log(`  advisory (binding nothing here): ${res.advisory.slice(0, 6).map((a) => a.subject).join(', ')}`);
      }
      console.log(`  wrote: ${res.wrote} · head unchanged: ${res.headUnchanged}`);
    }
    // Exit non-zero on a REFUSAL (misuse, tampering, wrong subject) and on a
    // BLOCKING verdict against the cycle. Not on an absent bar.
    if (res.rejected || res.blocking) process.exitCode = 1;
  },

  /**
   * Look for what was found somewhere else, HERE.
   *
   *   fed probe --slug S [--dir D] [--all] [--carrier C] [--json]
   *
   * The hub can see every repository; no repository can see another. So the one
   * list that only the hub can produce is "classes of defect found elsewhere and
   * not filed here" — and until now that list arrived in a passport as a line of
   * markdown. This runs it.
   *
   * `--all` scans the whole vocabulary instead, which is a lint of this tree
   * rather than a cross-repository read, and the output says which of the two it
   * did. Writes nothing.
   */
  probe() {
    const slug = arg('slug');
    if (!slug) {
      out({ rejected: true, reason: 'slug', detail: 'usage: fed probe --slug <slug> [--dir <path>] [--all] [--carrier repair|browser] [--json]' });
      process.exitCode = 1;
      return;
    }
    const { federation } = open();
    const res = probe(federation, {
      slug,
      dir: arg('dir'),
      carrier: arg('carrier', DEFAULT_CARRIER),
      all: flag('all'),
    });
    if (res.rejected) {
      out(res);
      process.exitCode = 1;
      return;
    }
    if (flag('json')) {
      out(res);
      return;
    }
    console.log(`probe repo:${slug}  [${res.carrier}]  ${res.scanned} source file(s) under ${res.dir}`);
    console.log(`  selection: ${res.selection}`);
    if (res.alreadyFiled.length) console.log(`  already filed here, not re-scanned: ${res.alreadyFiled.join(', ')}`);
    if (!res.classes.length && !res.unknownClass.length) {
      console.log('\n  nothing to look for. No repository has filed a risk class that this one has not.');
    }
    for (const c of res.found) {
      console.log(`\n  FOUND HERE  ${c.id} — ${c.here} site(s)`);
      console.log(`    why: ${c.why}`);
      console.log(`    found in ${c.seenIn.length} other(s): ${c.seenIn.slice(0, 4).join(', ')}${c.seenIn.length > 4 ? `, +${c.seenIn.length - 4} more` : ''}`);
      for (const site of c.sites) console.log(`    · ${site.file}:${site.line}  ${site.text}`);
      if (c.more) console.log(`    · +${c.more} more`);
    }
    for (const c of res.clean) {
      console.log(`\n  clean here  ${c.id} — found in ${c.seenIn.length} other(s), not in this tree`);
      console.log(`    why: ${c.why}`);
    }
    for (const c of res.indeterminate || []) {
      // Not `clean`, and not folded into it. A tree with no source files in it
      // has not been cleared, and saying so is the whole difference between a
      // probe and a rubber stamp.
      console.log(`\n  NOT SCANNED  ${c.id} — no source file under this tree, so nothing was looked at`);
      console.log(`    why: ${c.why}`);
    }
    for (const u of res.unknownClass) {
      // NOT folded into `clean`. A class this reader has no pattern for is a
      // defect somebody else actually found, and reporting an all-clear over it
      // would be the one wrong answer this command must not give.
      console.log(`\n  UNKNOWN CLASS  ${u.predicate} — no pattern here, so it was NOT looked for`);
      console.log(`    arrived as: ${u.object}`);
      console.log(`    filed by: ${u.seenIn.join(', ')}`);
    }
    console.log(`\n  ${res.detail}`);
    console.log(`  vocabulary: ${RISK_CLASSES.length} classes · wrote: ${res.wrote}`);
    // Non-zero when the probe could not answer: a class it has no pattern for,
    // or a tree with nothing in it to scan. Found sites are information, not a
    // failure — the whole point is that they were found.
    if (res.unknownClass.length || res.reason === 'nothing-scanned') process.exitCode = 1;
  },

  stats() {
    const { federation } = open();
    out(federation.stats());
  },
};

const cmd = process.argv[2];
if (!cmd || !COMMANDS[cmd]) {
  console.error(`usage: fed <${Object.keys(COMMANDS).join('|')}> [--flags]`);
  process.exitCode = 1;
} else {
  COMMANDS[cmd]();
}
