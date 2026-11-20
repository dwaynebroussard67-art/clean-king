export function postLoginDestination({ isOwner, activeEmployee }) {
  if (isOwner === true) return '/owner';
  if (activeEmployee === true) return '/crew/referrals';
  return '/not-approved';
}

export async function signedInDestination(client, userId) {
  if (!client || typeof userId !== 'string' || userId.length === 0) return '/not-approved';
  try {
    const { data: owner, error: ownerError } = await client
      .from('owner_memberships')
      .select('user_id')
      .eq('user_id', userId)
      .maybeSingle();
    if (ownerError) return '/not-approved';
    if (owner) return postLoginDestination({ isOwner: true, activeEmployee: false });

    const { data: employee, error: employeeError } = await client
      .from('employee_memberships')
      .select('active')
      .eq('user_id', userId)
      .maybeSingle();
    if (employeeError) return '/not-approved';
    return postLoginDestination({ isOwner: false, activeEmployee: employee?.active === true });
  } catch {
    return '/not-approved';
  }
}
