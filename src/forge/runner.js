/**
 * runner.js — which test command a repo speaks.
 *
 * The referee needs a command to run, and the command is a property of the
 * repo, not of the forge. This is the detector: conservative, ordered, and it
 * returns NULL rather than guessing — a repo with no recognisable test command
 * is `no_test_command`, and the forge refuses to fly it, because progress it
 * cannot verify is not progress.
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const CANDIDATES = [
  ['package.json', (d) => ({ command: 'npm', args: ['test'], note: 'npm test' })],
  ['test.sh', (d) => ({ command: 'sh', args: ['test.sh'], note: 'sh test.sh' })],
  ['Makefile', (d) => ({ command: 'make', args: ['test'], note: 'make test' })],
  ['Cargo.toml', (d) => ({ command: 'cargo', args: ['test'], note: 'cargo test' })],
  ['go.mod', (d) => ({ command: 'go', args: ['test', './...'], note: 'go test ./...' })],
  ['pyproject.toml', (d) => ({ command: 'pytest', args: [], note: 'pytest' })],
  ['setup.py', (d) => ({ command: 'pytest', args: [], note: 'pytest' })],
];

/** The first recognisable test command, or null. A null is a named refusal,
 *  never a guess. */
function detectTestCommand(dir) {
  for (const [file, make] of CANDIDATES) {
    if (fs.existsSync(path.join(dir, file))) return make(dir);
  }
  return null;
}

module.exports = { detectTestCommand, CANDIDATES };
