/**
 * Employee one-time link flow for tier-2 self-entry.
 * Wraps onboarding-vault-handler.mjs functions.
 * All deps injected for unit testing.
 */

import {
  issueEmployeeRequest as issueLink,
  describeRequest as describeLink,
  submitViaLink as submitLink,
} from '../server/onboarding-vault-handler.mjs';

/** Owner issues a one-time link for an employee to enter their own tier-2 data. */
export async function issueEmployeeLink({ rpc, orgId, actorId, employeeKey, fieldKeys, ttlHours }) {
  return issueLink({ orgId, actorId, employeeKey, fieldKeys, ttlHours }, { rpc });
}

/** Describe what fields an employee link requests (metadata only, no secrets). */
export async function describeEmployeeLink({ rpc, token }) {
  return describeLink(token, { rpc });
}

/** Employee submits their tier-2 values via the one-time link. */
export async function submitEmployeeLink({ rpc, keyring, token, values }) {
  return submitLink({ token, values }, { rpc, keyring });
}