'use strict';
// FALSE POSITIVE, and the case that motivated narrowing this class: an ordinary
// default parameter. Nothing here grants anything; `actor` is a label on a
// record, and `'human'` is only what it defaults to when nobody says otherwise.
function record(actor = 'human', at = new Date().toISOString()) {
  return { actor, at };
}
module.exports = { record };
