'use strict';
const nowIso = (d) => (d ? new Date(d) : new Date()).toISOString();
module.exports = { nowIso };
