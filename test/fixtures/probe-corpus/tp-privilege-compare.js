'use strict';
// TRUE POSITIVE — the branch is taken on a literal name, so every caller that
// can write the string is privileged.
function resolve(actor) {
  if (actor === 'human') return { granted: true, reason: 'a person said so' };
  return { granted: false, reason: 'not a person' };
}
module.exports = { resolve };
