'use strict';

/**
 * helpers/fed.js — an open Federation with named repositories registered.
 *
 * Each slug becomes a REAL remote so the registry derives the same slug back.
 * A setup helper that quietly registers a node under a name the test did not ask
 * for turns every later assertion into a confusing failure — which is exactly
 * the mistake the first version of this helper made, and why it now throws
 * instead of returning something plausible.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { Federation } = require('../../src/federation/store.js');
const { NodeRegistry } = require('../../src/federation/nodes.js');

const tmp = (prefix = 'ff-test-') => fs.mkdtempSync(path.join(os.tmpdir(), prefix));

/**
 * @param {...string} slugs  repositories to register; defaults to `twin-labs`
 * @returns {Federation} a loaded Federation whose registry knows those slugs
 */
function fedWith(...slugs) {
  const dir = tmp('ff-fed-');
  const nodes = new NodeRegistry(dir, { gitRemote: () => null }).load();
  for (const slug of slugs.length ? slugs : ['twin-labs']) {
    const res = nodes.register({ remote: `https://github.com/me/${slug}`, localPath: `/tmp/${slug}` });
    if (!res || res.rejected || !res.node) throw new Error(`test setup could not register '${slug}': ${JSON.stringify(res)}`);
    if (res.node.slug !== slug) throw new Error(`test setup registered '${slug}' as '${res.node.slug}'`);
  }
  return new Federation(dir, { nodes }).load();
}

module.exports = { fedWith, tmp };
