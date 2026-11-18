const groups = {
  counts: {
    newApplications: client => client.from('applicants').select('id', { count: 'exact', head: true }).eq('status', 'new'),
    newQuotes: client => client.from('leads').select('id', { count: 'exact', head: true }).eq('status', 'new'),
  },
  emailHealth: {
    queuedEmails: client => client.from('application_notifications')
      .select('id', { count: 'exact', head: true }).in('status', ['pending', 'processing']),
    failedEmails: client => client.from('application_notifications')
      .select('id', { count: 'exact', head: true }).eq('status', 'failed'),
  },
};

function enabledQueries(capabilities) {
  return Object.entries(groups).flatMap(([group, queries]) =>
    capabilities?.[group] === true ? Object.entries(queries) : []);
}

function safeCount(value) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('snapshot_unavailable');
  return value;
}

export function approvedSnapshot(snapshot, capabilities) {
  return Object.fromEntries(enabledQueries(capabilities).map(([key]) => [key, safeCount(snapshot?.[key])]));
}

export async function loadSnapshot(client, capabilities) {
  const entries = await Promise.all(enabledQueries(capabilities).map(async ([key, query]) => {
    const { count, error } = await query(client);
    if (error) throw new Error('snapshot_unavailable');
    return [key, safeCount(count)];
  }));
  return Object.fromEntries(entries);
}
