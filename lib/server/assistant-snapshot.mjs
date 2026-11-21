export async function loadSnapshot(client, capabilities = {}) {
  if (!client || typeof client.from !== 'function') throw new Error('snapshot_unavailable');
  const queries = [];
  const keys = [];

  if (capabilities.counts === true) {
    queries.push(
      client.from('applicants').select('id', { count: 'exact', head: true }).eq('status', 'new'),
      client.from('leads').select('id', { count: 'exact', head: true }).eq('status', 'new'),
    );
    keys.push('newApplications', 'newQuotes');
  }
  if (capabilities.emailHealth === true) {
    queries.push(
      client.from('application_notifications').select('id', { count: 'exact', head: true })
        .in('status', ['pending', 'processing']),
      client.from('application_notifications').select('id', { count: 'exact', head: true })
        .eq('status', 'failed'),
    );
    keys.push('queuedEmails', 'failedEmails');
  }

  const results = await Promise.all(queries);
  const snapshot = {};
  results.forEach((result, index) => {
    if (result?.error || !Number.isSafeInteger(result?.count) || result.count < 0) {
      throw new Error('snapshot_unavailable');
    }
    snapshot[keys[index]] = result.count;
  });
  return snapshot;
}
