import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

/**
 * SSRF guard for admin-configured feed URLs: the host must resolve only to public internet
 * addresses. Loopback, private, link-local (cloud metadata 169.254.169.254), CGNAT, multicast,
 * reserved, documentation and IPv6 unique-local/link-local ranges are refused, for IPv4, IPv6 and
 * IPv4-mapped IPv6. Every redirect hop is checked again by the fetcher.
 *
 * Residual risk: the check resolves the name, then fetch resolves it again (DNS rebinding between
 * the two lookups). Pinning the address would need a custom HTTP agent.
 */

/** Resolves a host name to every address it has (the default uses the system resolver). */
export type ResolveHost = (hostname: string) => Promise<string[]>;

export const resolveHost: ResolveHost = async (hostname) =>
  (await lookup(hostname, { all: true, verbatim: true })).map((a) => a.address);

const V4_BLOCKED: [number, number][] = [
  // [network as 32-bit int, prefix length]
  [ipv4ToInt("0.0.0.0"), 8], // "this" network
  [ipv4ToInt("10.0.0.0"), 8], // private
  [ipv4ToInt("100.64.0.0"), 10], // carrier-grade NAT
  [ipv4ToInt("127.0.0.0"), 8], // loopback
  [ipv4ToInt("169.254.0.0"), 16], // link-local, cloud metadata
  [ipv4ToInt("172.16.0.0"), 12], // private
  [ipv4ToInt("192.0.0.0"), 24], // IETF protocol assignments
  [ipv4ToInt("192.0.2.0"), 24], // documentation
  [ipv4ToInt("192.88.99.0"), 24], // 6to4 relay
  [ipv4ToInt("192.168.0.0"), 16], // private
  [ipv4ToInt("198.18.0.0"), 15], // benchmarking
  [ipv4ToInt("198.51.100.0"), 24], // documentation
  [ipv4ToInt("203.0.113.0"), 24], // documentation
  [ipv4ToInt("224.0.0.0"), 4], // multicast
  [ipv4ToInt("240.0.0.0"), 4], // reserved and broadcast
];

function ipv4ToInt(ip: string): number {
  return ip.split(".").reduce((acc, part) => acc * 256 + Number(part), 0);
}

function isPublicIpv4(ip: string): boolean {
  const value = ipv4ToInt(ip);
  return !V4_BLOCKED.some(([network, prefix]) => {
    const size = 2 ** (32 - prefix);
    return value >= network && value < network + size;
  });
}

/** The 8 groups of an IPv6 address as numbers (handles "::" and a trailing dotted IPv4). */
function ipv6Groups(ip: string): number[] | null {
  let address = ip.split("%")[0].toLowerCase();
  const dotted = /(\d+\.\d+\.\d+\.\d+)$/.exec(address);
  if (dotted) {
    const v = ipv4ToInt(dotted[1]);
    address = `${address.slice(0, -dotted[1].length)}${Math.floor(v / 65536).toString(16)}:${(v % 65536).toString(16)}`;
  }
  const [head, tail] = address.split("::");
  const parse = (part: string | undefined) => (part ? part.split(":").map((g) => parseInt(g, 16)) : []);
  const left = parse(head);
  const right = parse(tail);
  const groups = tail === undefined ? left : [...left, ...Array(8 - left.length - right.length).fill(0), ...right];
  return groups.length === 8 && groups.every((g) => Number.isInteger(g) && g >= 0 && g <= 0xffff) ? groups : null;
}

function isPublicIpv6(ip: string): boolean {
  const g = ipv6Groups(ip);
  if (!g) return false;
  if (g.every((x) => x === 0)) return false; // ::
  if (g.slice(0, 7).every((x) => x === 0) && g[7] === 1) return false; // ::1
  // IPv4-mapped (::ffff:a.b.c.d) and IPv4-compatible (::a.b.c.d): judge the IPv4 address.
  if (g.slice(0, 5).every((x) => x === 0) && (g[5] === 0xffff || g[5] === 0)) {
    return isPublicIpv4(`${g[6] >> 8}.${g[6] & 255}.${g[7] >> 8}.${g[7] & 255}`);
  }
  if (g[0] === 0x64 && g[1] === 0xff9b) return false; // NAT64: could reach internal IPv4
  if ((g[0] & 0xfe00) === 0xfc00) return false; // fc00::/7 unique local
  if ((g[0] & 0xffc0) === 0xfe80) return false; // fe80::/10 link-local
  if ((g[0] & 0xffc0) === 0xfec0) return false; // fec0::/10 site-local (deprecated)
  if ((g[0] & 0xff00) === 0xff00) return false; // multicast
  if (g[0] === 0x2001 && g[1] === 0x0db8) return false; // documentation
  if (g[0] === 0x2002) return false; // 6to4: embeds an arbitrary IPv4
  return true;
}

export function isPublicAddress(ip: string): boolean {
  const version = isIP(ip.split("%")[0]);
  if (version === 4) return isPublicIpv4(ip);
  if (version === 6) return isPublicIpv6(ip);
  return false;
}

export class BlockedHostError extends Error {}

/** Throws unless every address of `hostname` is public. IP literals are checked as they are. */
export async function assertPublicHost(hostname: string, resolve: ResolveHost = resolveHost): Promise<void> {
  const host = hostname.replace(/^\[|\]$/g, "");
  if (host === "" || host.toLowerCase() === "localhost" || host.toLowerCase().endsWith(".localhost")) {
    throw new BlockedHostError("Feed host is not allowed");
  }
  let addresses: string[];
  if (isIP(host)) addresses = [host];
  else {
    try {
      addresses = await resolve(host);
    } catch {
      throw new BlockedHostError("Feed host does not resolve");
    }
  }
  if (addresses.length === 0 || !addresses.every(isPublicAddress)) {
    throw new BlockedHostError("Feed host resolves to a non-public address");
  }
}
