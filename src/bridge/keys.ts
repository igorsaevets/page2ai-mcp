// Agent Bridge keys. The Page2AI extension makes one (32 random bytes, base64url,
// shown in its popup) and the user pastes it into this server's PAGE2AI_BRIDGE_KEY;
// several keys, one per browser profile, are separated by commas. Both ends then
// prove they know it (protocol.ts); the key itself never crosses the socket.

import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { BRIDGE_PROTOCOL } from './protocol.js';

export const BRIDGE_KEY_ENV = 'PAGE2AI_BRIDGE_KEY';

export interface BridgeKey {
  /** First 16 hex digits of SHA-256(key): names the key in hello and in logs. */
  id: string;
  bytes: Buffer;
}

// 32 bytes in base64url: 43 characters, padding optional.
const KEY_PATTERN = /^[A-Za-z0-9_-]{43}=?$/;
// The variable's own name pasted along: an env line, a shell export or a JSON pair.
const NAME_PREFIX = new RegExp(`^(?:export\\s+)?["']?${BRIDGE_KEY_ENV}["']?\\s*[:=]\\s*`);
const HEX64 = /^[0-9a-f]{64}$/;

export const keyIdOf = (bytes: Buffer): string =>
  createHash('sha256').update(bytes).digest('hex').slice(0, 16);

/** Reads PAGE2AI_BRIDGE_KEY. Tolerates what a copy-paste brings along (spaces,
 *  quotes, the variable's own name before `=` or `:`); an MCPB field left empty may
 *  arrive unexpanded and counts as no key. A bad entry is reported by its position,
 *  never by its value: the log goes to the MCP client's files. */
export const parseBridgeKeys = (raw: string | undefined): { keys: BridgeKey[]; problems: string[] } => {
  const keys: BridgeKey[] = [];
  const problems: string[] = [];
  const entries = (raw ?? '').split(',');
  entries.forEach((entry, i) => {
    // The name first, then the quotes: 0.6.0 did it the other way round and refused NAME="key".
    const s = entry.trim().replace(NAME_PREFIX, '').replace(/^["']+|["']+$/g, '').trim();
    if (s === '' || s.includes('${')) return;
    if (!KEY_PATTERN.test(s)) {
      problems.push(`entry ${i + 1} of ${entries.length} is not a Page2AI key ` +
        `(${s.length} characters; a key from the extension's popup has 43)`);
      return;
    }
    const bytes = Buffer.from(s.replace(/=$/, ''), 'base64url');
    const id = keyIdOf(bytes);
    if (!keys.some((k) => k.id === id)) keys.push({ id, bytes });
  });
  return { keys, problems };
};

export const isHex64 = (v: unknown): v is string => typeof v === 'string' && HEX64.test(v);

const proofOf = (key: Buffer, text: string): string =>
  createHmac('sha256', key).update(text).digest('hex');

/** What the server sends: it knows the key, on this port, for this hello. */
export const serverProof = (key: Buffer, port: number, nonceE: string, nonceS: string): string =>
  proofOf(key, `${BRIDGE_PROTOCOL}|server|${port}|${nonceE}|${nonceS}`);

/** What the extension sends back once the server's proof checked out. */
export const clientProof = (key: Buffer, port: number, nonceS: string, nonceE: string): string =>
  proofOf(key, `${BRIDGE_PROTOCOL}|client|${port}|${nonceS}|${nonceE}`);

export const proofMatches = (expected: string, got: unknown): boolean =>
  isHex64(got) && timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(got, 'hex'));
