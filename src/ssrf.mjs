// Block requests to private/internal addresses. The verifier fetches
// URLs chosen by strangers, so this is the most important guard.
import dns from 'node:dns/promises';
import net from 'node:net';

export function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return (
      a === 0 || a === 10 || a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127) ||
      a >= 224
    );
  }
  if (net.isIPv6(ip)) {
    const l = ip.toLowerCase();
    if (l.startsWith('::ffff:')) return isPrivateIp(l.slice(7));
    return l === '::1' || l === '::' || l.startsWith('fc') || l.startsWith('fd') || l.startsWith('fe8') || l.startsWith('fe9') || l.startsWith('fea') || l.startsWith('feb');
  }
  return true;
}

/** Resolve host and reject private targets. Returns the pinned IP. */
export async function assertPublicHost(hostname, { allowPrivate = false } = {}) {
  if (net.isIP(hostname)) {
    if (!allowPrivate && isPrivateIp(hostname)) throw new Error('target address is not public');
    return hostname;
  }
  const addrs = await dns.lookup(hostname, { all: true });
  if (!addrs.length) throw new Error('host did not resolve');
  if (!allowPrivate && addrs.some((a) => isPrivateIp(a.address))) throw new Error('target address is not public');
  return addrs[0].address;
}
