'use strict';
// FALSE POSITIVE — the pattern is quoted in a comment, explaining why it was
// removed. Documentation that quotes a defect is not the defect.
//   adjudicate() used to default to `actor: 'human'`, which wrote a machine's
//   decision into the ledger as a person's.
//   The old check was: if (actor === 'human') return grant();
module.exports = {};
