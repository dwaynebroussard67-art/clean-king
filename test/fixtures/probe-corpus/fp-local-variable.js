'use strict';
// FALSE POSITIVE — a local variable holding a display label. The identifier is
// spelled `actor`, but this is not an object property and it authorizes nothing.
// The old pattern matched on `=` as well as `:`, which is what made default
// parameters and labels look like backdoors.
function describe(actor) {
  const label = actor || 'human';
  return `changed by ${label}`;
}
module.exports = { describe };
