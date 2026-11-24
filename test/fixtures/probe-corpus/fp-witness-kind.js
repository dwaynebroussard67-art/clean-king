'use strict';
// FALSE POSITIVE — `witness` is an enum kind (structural | outcome | human),
// not an identity. Six comparisons of exactly this shape in the live tree were
// being reported as a standing backdoor before the field became part of the
// pattern.
function requireActor(spec) {
  if (spec.witness === 'human' && !String(spec.actor || '').trim()) {
    throw new Error('a human witness must name the person');
  }
  return spec;
}
module.exports = { requireActor };
