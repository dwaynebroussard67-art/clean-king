'use strict';
// FALSE POSITIVE — a UI label. `source === 'human'` picks a pronoun.
function caption(cap) {
  return cap.source === 'human' ? `Captain (${cap.actor || 'you'})` : 'Captain';
}
module.exports = { caption };
