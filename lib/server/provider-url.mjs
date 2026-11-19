import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { Readable } from 'node:stream';
import { isIP } from 'node:net';
import { resolvePublicAddresses, validateCustomBaseUrl } from '../ai/url-guard.mjs';

/**
 * Sends an OpenAI-compatible request only to a DNS address that was checked in this call.
 * HTTPS keeps the configured hostname for SNI and certificate validation while the custom
 * lookup callback pins the TCP connection to the checked IP. Node's HTTP client does not
 * automatically follow redirects; callers reject every 3xx response.
 */
export async function requestPinnedProvider({
  baseUrl,
  url,
  init,
  timeoutMs = 15000,
  allowLocal = false,
  resolver,
  transport = sendPinnedRequest,
}) {
  const safeBase = validateCustomBaseUrl(baseUrl, { allowLocal });
  if (!safeBase.ok) throw new Error('blocked_url');
  const endpoint = new URL(url);
  const configured = new URL(safeBase.url);
  if (endpoint.origin !== configured.origin || !endpoint.pathname.startsWith(configured.pathname.replace(/\/$/, '') + '/')) {
    throw new Error('blocked_url');
  }
  if (endpoint.search || endpoint.hash || endpoint.username || endpoint.password) {
    throw new Error('blocked_url');
  }

  let pinnedAddress = null;
  if (endpoint.protocol === 'https:') {
    const hostname = endpoint.hostname.replace(/^\[|\]$/g, '');
    const addresses = await resolvePublicAddresses(hostname, resolver);
    pinnedAddress = addresses[0];
  } else if (!(allowLocal && endpoint.protocol === 'http:' &&
      ['localhost', '127.0.0.1'].includes(endpoint.hostname.replace(/^\[|\]$/g, '')))) {
    throw new Error('blocked_url');
  }

  const family = pinnedAddress?.family;
  const address = pinnedAddress?.address;
  const lookup = pinnedAddress
    ? (_hostname, options, callback) => {
      if (options?.all) callback(null, [{ address, family }]);
      else callback(null, address, family);
    }
    : undefined;

  return transport({
    protocol: endpoint.protocol,
    hostname: endpoint.hostname.replace(/^\[|\]$/g, ''),
    servername: isIP(endpoint.hostname.replace(/^\[|\]$/g, '')) ? undefined : endpoint.hostname.replace(/^\[|\]$/g, ''),
    port: endpoint.port ? Number(endpoint.port) : endpoint.protocol === 'https:' ? 443 : 80,
    path: `${endpoint.pathname}${endpoint.search}`,
    method: init.method,
    headers: init.headers,
    redirect: 'error',
    lookup,
    pinnedAddress: address,
    signal: init.signal,
    timeoutMs,
    body: init.body,
  });
}

function sendPinnedRequest(options) {
  const { protocol, signal, timeoutMs, body, pinnedAddress, redirect, ...requestOptions } = options;
  const clientRequest = protocol === 'https:' ? httpsRequest : httpRequest;

  return new Promise((resolve, reject) => {
    const cleanup = () => signal?.removeEventListener('abort', abort);
    const request = clientRequest(requestOptions, (incoming) => {
      const status = incoming.statusCode ?? 502;
      if (status < 200 || status > 599) {
        incoming.destroy();
        reject(new Error('bad_response'));
        return;
      }
      const headers = new Headers();
      for (const [name, value] of Object.entries(incoming.headers)) {
        if (value === undefined) continue;
        for (const item of Array.isArray(value) ? value : [value]) headers.append(name, String(item));
      }
      incoming.once('end', cleanup);
      incoming.once('close', cleanup);
      incoming.once('error', cleanup);
      const bodyStream = [204, 205, 304].includes(status) ? null : Readable.toWeb(incoming);
      resolve(new Response(bodyStream, { status, headers }));
    });

    const abort = () => request.destroy(signal?.reason ?? Object.assign(new Error('timeout'), { name: 'TimeoutError' }));
    request.once('error', (error) => {
      cleanup();
      reject(error);
    });
    if (signal?.aborted) {
      abort();
      return;
    }
    signal?.addEventListener('abort', abort, { once: true });
    request.setTimeout(timeoutMs, () => {
      request.destroy(Object.assign(new Error('timeout'), { name: 'TimeoutError' }));
    });
    request.end(body);
  });
}
