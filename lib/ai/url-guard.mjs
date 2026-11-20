import { lookup } from 'node:dns/promises';

function isBlockedIpv4(address) {
  const parts = address.split('.');
  if (parts.length !== 4 || parts.some((part) => !/^\d+$/.test(part))) return true;
  const octets = parts.map(Number);
  if (octets.some((part) => part < 0 || part > 255)) return true;
  const [a, b, c] = octets;

  return a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && (b === 0 || b === 168)) ||
    (a === 192 && b === 88 && c === 99) ||
    (a === 192 && b === 0 && c === 2) ||
    (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
    (a === 203 && b === 0 && c === 113) ||
    (a === 255 && b === 255 && c === 255);
}

function ipv6Words(address) {
  let value = address.toLowerCase().replace(/^\[|\]$/g, '');
  if (value.includes('%')) return null;

  const mapped = value.match(/^(.*:)(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) {
    const v4 = mapped[2].split('.').map(Number);
    if (v4.length !== 4 || v4.some((octet) => octet < 0 || octet > 255)) return null;
    value = `${mapped[1]}${((v4[0] << 8) | v4[1]).toString(16)}:${((v4[2] << 8) | v4[3]).toString(16)}`;
  }

  if ((value.match(/::/g) ?? []).length > 1) return null;
  const [leftText, rightText = ''] = value.split('::');
  const left = leftText ? leftText.split(':') : [];
  const right = rightText ? rightText.split(':') : [];
  const missing = 8 - left.length - right.length;
  if (missing < 0 || (value.includes('::') && missing < 1)) return null;
  const words = [...left, ...Array(missing).fill('0'), ...right];
  if (words.length !== 8 || words.some((part) => !/^[0-9a-f]{1,4}$/.test(part))) return null;
  return words.map((part) => Number.parseInt(part, 16));
}

function isBlockedIpv6(address) {
  const words = ipv6Words(address);
  if (!words) return true;
  const [first, second, third, fourth, fifth, sixth, seventh, eighth] = words;

  const unspecified = words.every((word) => word === 0);
  const loopback = words.slice(0, 7).every((word) => word === 0) && eighth === 1;
  const uniqueLocal = (first & 0xfe00) === 0xfc00;
  const linkLocal = (first & 0xffc0) === 0xfe80;
  const multicast = (first & 0xff00) === 0xff00;
  const mapped = words.slice(0, 5).every((word) => word === 0) &&
    sixth === 0xffff;
  const documentation = first === 0x2001 && second === 0x0db8;

  if (unspecified || loopback || uniqueLocal || linkLocal || multicast || documentation) return true;
  if (mapped) {
    const a = seventh >> 8;
    const b = seventh & 0xff;
    const c = eighth >> 8;
    const d = eighth & 0xff;
    return isBlockedIpv4(`${a}.${b}.${c}.${d}`);
  }
  return false;
}

function hostnameIsBlocked(hostname) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (!host || host === 'localhost' || host.endsWith('.localhost') ||
      host.endsWith('.local') || host.endsWith('.internal')) return true;

  // WHATWG URL parsing canonicalizes shorthand, octal, and hexadecimal IPv4.
  // Reject other numeric/hex-looking hostnames rather than let DNS reinterpret them.
  if (/^[0-9a-fx:.]+$/i.test(host)) {
    if (host.includes(':')) return isBlockedIpv6(host);
    if (/^\d+(?:\.\d+){3}$/.test(host)) return isBlockedIpv4(host);
    return true;
  }
  return false;
}

function parseAddress(address) {
  if (typeof address !== 'string' || address.length === 0) return 'invalid';
  const value = address.toLowerCase().replace(/^\[|\]$/g, '');
  if (value.includes(':')) return isBlockedIpv6(value) ? 'blocked' : 'allowed';
  if (/^\d+(?:\.\d+){3}$/.test(value)) return isBlockedIpv4(value) ? 'blocked' : 'allowed';
  return 'invalid';
}

export function validateCustomBaseUrl(url, { allowLocal = false } = {}) {
  if (typeof url !== 'string' || url.length === 0 || url.length > 200 ||
      url.includes('?') || url.includes('#')) {
    return { ok: false, reason: 'invalid_url' };
  }

  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, reason: 'invalid_url' };
  }

  const authority = parsed.href.match(/^[a-z][a-z\d+.-]*:\/\/([^/?#]*)/i)?.[1] ?? '';
  const rawAuthority = url.match(/^\s*[a-z][a-z\d+.-]*:\/\/([^/?#]*)/i)?.[1] ?? '';
  if (parsed.username || parsed.password || authority.includes('@') || rawAuthority.includes('@') || parsed.search || parsed.hash ||
      (parsed.port && parsed.port !== '443' && parsed.port !== '80')) {
    return { ok: false, reason: 'invalid_url' };
  }

  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  const localHost = host === 'localhost' || host === '127.0.0.1';
  if (parsed.protocol === 'http:' && allowLocal && localHost &&
      (!parsed.port || parsed.port === '80')) {
    return { ok: true, url: `${parsed.origin}${parsed.pathname}`.replace(/\/+$/, '') };
  }
  if (parsed.protocol !== 'https:' || (parsed.port && parsed.port !== '443')) {
    return { ok: false, reason: 'invalid_url' };
  }
  if (hostnameIsBlocked(host)) return { ok: false, reason: 'blocked_host' };

  return {
    ok: true,
    url: `${parsed.origin}${parsed.pathname}`.replace(/\/+$/, ''),
  };
}

export async function resolvePublicAddresses(hostname, resolver = defaultResolver) {
  if (hostnameIsBlocked(hostname)) throw new Error('blocked_url');
  const literalResult = parseAddress(hostname);
  if (literalResult === 'blocked' || literalResult === 'invalid' && hostname.includes(':')) {
    throw new Error('blocked_url');
  }

  let addresses;
  try {
    addresses = await resolver(hostname);
  } catch {
    throw new Error('upstream');
  }
  if (!Array.isArray(addresses) || addresses.length === 0) throw new Error('blocked_url');
  const publicAddresses = [];
  for (const entry of addresses) {
    const address = typeof entry === 'string' ? entry : entry?.address;
    if (parseAddress(address) !== 'allowed') throw new Error('blocked_url');
    publicAddresses.push({ address, family: address.includes(':') ? 6 : 4 });
  }
  return publicAddresses;
}

export async function assertPublicHostname(hostname, resolver = defaultResolver) {
  await resolvePublicAddresses(hostname, resolver);
}

async function defaultResolver(hostname) {
  const results = await lookup(hostname, { all: true, verbatim: true });
  return results.map(({ address }) => address);
}
