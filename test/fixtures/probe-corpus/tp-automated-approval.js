'use strict';
// FALSE POSITIVE — an authority field, but the value is not a privilege.
const delegate = { approvedBy: 'scheduler', scope: 'read' };
module.exports = { delegate };
