// Abuse controls of the Node server (server.mts): who a request comes from, how many requests a client
// may make per minute, and how many conversions may run at once. Pure: no I/O, so tests drive it with
// their own clock. The Vercel function (api/mcp.ts) keeps its own per-instance limiter.
//
// One process holds the only window here, so the global cap is a cap on the whole endpoint. ChatGPT and
// Claude call MCP servers from their companies' servers, so many users share a few of their addresses:
// addresses in the platforms' published egress ranges (lib/platform-ranges.json) get a larger per-IP
// bucket and may use every conversion slot. IPv6 clients are counted per prefix (/64 by default): one
// subscriber usually holds a whole /64 and could otherwise rotate addresses inside it.
import { BlockList, isIP } from 'node:net';

export interface PlatformRanges {
  [platform: string]: readonly string[];
}

export interface Client {
  /** Rate-limit key: the IPv4 address, the IPv6 prefix, or "unknown". */
  key: string;
  /** "openai" / "anthropic" when the address is in that platform's published egress ranges. */
  platform: string | null;
}

const toBlockList = (cidrs: readonly string[]): BlockList => {
  const list = new BlockList();
  for (const cidr of cidrs) {
    const [address, bits] = cidr.split('/');
    const family = isIP(address);
    if (family === 0) throw new TypeError(`not an IP range: ${cidr}`);
    const type = family === 4 ? 'ipv4' : 'ipv6';
    if (bits === undefined) list.addAddress(address, type);
    else list.addSubnet(address, Number(bits), type);
  }
  return list;
};

// Eight 16-bit groups of an IPv6 address (an embedded dotted IPv4 tail included), or null.
export const ipv6Groups = (address: string): number[] | null => {
  if (isIP(address) !== 6) return null;
  let text = address.toLowerCase().split('%')[0];
  const v4 = /(\d+\.\d+\.\d+\.\d+)$/.exec(text);
  if (v4) {
    const [a, b, c, d] = v4[1].split('.').map(Number);
    text = text.slice(0, -v4[1].length) + `${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const [head, tail] = text.split('::');
  const left = head ? head.split(':') : [];
  const right = tail === undefined ? [] : tail ? tail.split(':') : [];
  const fill = tail === undefined ? 0 : 8 - left.length - right.length;
  const groups = [...left, ...Array(fill).fill('0'), ...right].map((g) => parseInt(g, 16));
  return groups.length === 8 && groups.every((g) => Number.isInteger(g) && g >= 0 && g <= 0xffff) ? groups : null;
};

export class ClientResolver {
  private readonly lists: [string, BlockList][];
  private readonly ipv6Prefix: number;

  // Plain fields, no parameter properties: Node runs this file by stripping types only.
  constructor(ranges: PlatformRanges, ipv6Prefix = 64) {
    if (!Number.isInteger(ipv6Prefix) || ipv6Prefix < 1 || ipv6Prefix > 128) {
      throw new TypeError(`IPv6 prefix length out of range: ${ipv6Prefix}`);
    }
    this.ipv6Prefix = ipv6Prefix;
    this.lists = Object.entries(ranges).map(([name, cidrs]) => [name, toBlockList(cidrs)]);
  }

  resolve(rawIp: string | null | undefined): Client {
    let ip = (rawIp ?? '').trim();
    const groups = ipv6Groups(ip);
    // An IPv4-mapped IPv6 address (::ffff:a.b.c.d) is that IPv4 client.
    if (groups && groups.slice(0, 5).every((g) => g === 0) && groups[5] === 0xffff) {
      ip = [groups[6] >> 8, groups[6] & 255, groups[7] >> 8, groups[7] & 255].join('.');
    }
    const family = isIP(ip);
    if (family === 0) return { key: 'unknown', platform: null };
    const type = family === 4 ? 'ipv4' : 'ipv6';
    const platform = this.lists.find(([, list]) => list.check(ip, type))?.[0] ?? null;
    if (family === 4) return { key: ip, platform };
    const g = ipv6Groups(ip)!;
    const bits = this.ipv6Prefix;
    const masked = g.map((value, i) => {
      const keep = Math.max(0, Math.min(16, bits - i * 16));
      return keep === 0 ? 0 : value & (0xffff << (16 - keep)) & 0xffff;
    });
    return { key: `${masked.map((v) => v.toString(16)).join(':')}/${bits}`, platform };
  }
}

export interface RateLimits {
  perIp: number;
  perPlatformIp: number;
  global: number;
  windowMs?: number;
}

// Fixed one-minute windows, as on Vercel: every request counts against the global window first, then
// against its client's.
export class RateLimiter {
  private readonly hits = new Map<string, { count: number; resetAt: number }>();
  private globalWindow = { count: 0, resetAt: 0 };
  private readonly windowMs: number;
  private readonly limits: RateLimits;

  constructor(limits: RateLimits) {
    this.limits = limits;
    this.windowMs = limits.windowMs ?? 60_000;
  }

  /** true when the request may go ahead. */
  take(client: Client, now = Date.now()): boolean {
    if (now > this.globalWindow.resetAt) this.globalWindow = { count: 0, resetAt: now + this.windowMs };
    this.globalWindow.count += 1;
    if (this.globalWindow.count > this.limits.global) return false;

    const limit = client.platform ? this.limits.perPlatformIp : this.limits.perIp;
    const entry = this.hits.get(client.key);
    if (!entry || now > entry.resetAt) {
      // Bounded memory under address rotation: drop expired windows only, never live ones.
      if (this.hits.size > 10_000) {
        for (const [key, value] of this.hits) if (now > value.resetAt) this.hits.delete(key);
      }
      this.hits.set(client.key, { count: 1, resetAt: now + this.windowMs });
      return limit >= 1;
    }
    entry.count += 1;
    return entry.count <= limit;
  }
}

// Conversions running at once: a few 10 MB pages must not exhaust the container's memory. A client may
// hold perClient slots; a platform address (many users behind it) may hold all of them.
export class ConcurrencyGate {
  private total = 0;
  private readonly perKey = new Map<string, number>();
  private readonly max: number;
  private readonly perClient: number;

  constructor(max: number, perClient: number) {
    this.max = max;
    this.perClient = perClient;
  }

  get active(): number {
    return this.total;
  }

  /** A release function, or null when the endpoint or this client is at its limit. */
  acquire(client: Client): (() => void) | null {
    if (this.total >= this.max) return null;
    const used = this.perKey.get(client.key) ?? 0;
    if (used >= (client.platform ? this.max : this.perClient)) return null;
    this.total += 1;
    this.perKey.set(client.key, used + 1);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.total -= 1;
      const left = (this.perKey.get(client.key) ?? 1) - 1;
      if (left <= 0) this.perKey.delete(client.key);
      else this.perKey.set(client.key, left);
    };
  }
}
