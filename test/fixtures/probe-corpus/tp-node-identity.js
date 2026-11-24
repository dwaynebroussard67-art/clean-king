'use strict';
// FALSE POSITIVE for THIS class — a node naming itself in config. It is the
// fleet-scale identity smell, but it is not authorization, and reporting it here
// would bury a real finding.
const cfg = { nodeId: 'local-cockpit', harnessId: 'default' };
module.exports = cfg;
