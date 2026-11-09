// node --test tests/ (Node 24 runs the TypeScript as is)
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { ClientResolver, ConcurrencyGate, RateLimiter, ipv6Groups } from '../lib/limits.mts';

const ranges = { openai: ['104.210.139.192/28', '2603:1030::/32'], anthropic: ['160.79.104.0/21'] };

test('ipv6Groups expands compressed, full and IPv4-tailed forms', () => {
  assert.deepEqual(ipv6Groups('2001:db8::1'), [0x2001, 0xdb8, 0, 0, 0, 0, 0, 1]);
  assert.deepEqual(ipv6Groups('::'), [0, 0, 0, 0, 0, 0, 0, 0]);
  assert.deepEqual(ipv6Groups('::ffff:1.2.3.4'), [0, 0, 0, 0, 0, 0xffff, 0x102, 0x304]);
  assert.deepEqual(ipv6Groups('fe80::1%eth0'), [0xfe80, 0, 0, 0, 0, 0, 0, 1]);
  assert.equal(ipv6Groups('1.2.3.4'), null);
  assert.equal(ipv6Groups('not-an-ip'), null);
});

test('IPv4 clients are keyed by address; platform ranges are named', () => {
  const r = new ClientResolver(ranges);
  assert.deepEqual(r.resolve('203.0.114.5'), { key: '203.0.114.5', platform: null });
  assert.deepEqual(r.resolve(' 160.79.105.9 '), { key: '160.79.105.9', platform: 'anthropic' });
  assert.deepEqual(r.resolve('104.210.139.200'), { key: '104.210.139.200', platform: 'openai' });
  assert.deepEqual(r.resolve('104.210.139.208'), { key: '104.210.139.208', platform: null });
  // A mapped address is the IPv4 client.
  assert.deepEqual(r.resolve('::ffff:160.79.105.9'), { key: '160.79.105.9', platform: 'anthropic' });
  assert.deepEqual(r.resolve(''), { key: 'unknown', platform: null });
  assert.deepEqual(r.resolve('garbage'), { key: 'unknown', platform: null });
});

test('IPv6 clients share one key per /64 (or the configured prefix)', () => {
  const r = new ClientResolver(ranges);
  const a = r.resolve('2a01:4f8:c0c:1234:aaaa:bbbb:cccc:dddd');
  const b = r.resolve('2a01:4f8:c0c:1234::1');
  const c = r.resolve('2a01:4f8:c0c:1235::1');
  assert.equal(a.key, '2a01:4f8:c0c:1234:0:0:0:0/64');
  assert.equal(a.key, b.key);
  assert.notEqual(a.key, c.key);
  assert.equal(r.resolve('2603:1030:20e::5').platform, 'openai');
  const r56 = new ClientResolver(ranges, 56);
  assert.equal(r56.resolve('2a01:4f8:c0c:12ff::1').key, '2a01:4f8:c0c:1200:0:0:0:0/56');
  assert.throws(() => new ClientResolver(ranges, 0), /prefix length/);
});

test('the shipped range file parses and holds both platforms', () => {
  const data = JSON.parse(readFileSync(new URL('../lib/platform-ranges.json', import.meta.url), 'utf8'));
  const r = new ClientResolver({ openai: data.openai, anthropic: data.anthropic });
  assert.ok(data.openai.length > 10, 'openai ranges');
  assert.ok(data.anthropic.includes('160.79.104.0/21'), 'anthropic outbound range');
  assert.equal(r.resolve('160.79.104.1').platform, 'anthropic');
});

test('per-IP limit: the 31st request in a window is refused, the next window is fresh', () => {
  const limiter = new RateLimiter({ perIp: 30, perPlatformIp: 120, global: 300 });
  const client = { key: '203.0.114.5', platform: null };
  const t0 = 1_000_000;
  for (let i = 1; i <= 30; i++) assert.equal(limiter.take(client, t0 + i), true, `request ${i}`);
  assert.equal(limiter.take(client, t0 + 31), false);
  assert.equal(limiter.take({ key: '203.0.114.6', platform: null }, t0 + 32), true, 'another client is unaffected');
  assert.equal(limiter.take(client, t0 + 60_002), true, 'next window');
});

test('a platform address gets the larger bucket', () => {
  const limiter = new RateLimiter({ perIp: 30, perPlatformIp: 120, global: 1000 });
  const platform = { key: '160.79.105.9', platform: 'anthropic' };
  for (let i = 1; i <= 120; i++) assert.equal(limiter.take(platform, 5 + i), true, `request ${i}`);
  assert.equal(limiter.take(platform, 200), false);
});

test('the global cap holds across clients', () => {
  const limiter = new RateLimiter({ perIp: 30, perPlatformIp: 120, global: 50 });
  let allowed = 0;
  for (let i = 0; i < 80; i++) if (limiter.take({ key: `198.51.99.${i}`, platform: null }, 10)) allowed++;
  assert.equal(allowed, 50);
});

test('conversions: a global cap, a per-client cap, platforms may use every slot, release is idempotent', () => {
  const gate = new ConcurrencyGate(4, 2);
  const a = { key: 'a', platform: null };
  const b = { key: 'b', platform: null };
  const p = { key: 'p', platform: 'openai' };
  const a1 = gate.acquire(a);
  const a2 = gate.acquire(a);
  assert.ok(a1 && a2);
  assert.equal(gate.acquire(a), null, 'third slot for one client');
  const p1 = gate.acquire(p);
  const p2 = gate.acquire(p);
  assert.ok(p1 && p2);
  assert.equal(gate.active, 4);
  assert.equal(gate.acquire(b), null, 'endpoint full');
  a1!();
  a1!();
  assert.equal(gate.active, 3, 'double release counts once');
  assert.ok(gate.acquire(b));
  a2!(); p1!(); p2!();
  assert.equal(gate.active, 1);
});
