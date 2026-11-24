'use strict';
// TRUE POSITIVE — escalation decided by a literal role.
function escalate(role, ticket) {
  if (role === 'root') return { ...ticket, level: 'root' };
  return ticket;
}
module.exports = { escalate };
