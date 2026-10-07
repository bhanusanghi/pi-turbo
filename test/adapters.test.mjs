import test from 'node:test';
import assert from 'node:assert/strict';
import { readPortfolio, readNews, ports, DeliveryRejected } from '../dist-examples/hyperliquid-news/adapters.js';
const signal = () => new AbortController().signal;
const config = { wallets: ['0x1111111111111111111111111111111111111111'], feeds: ['https://example.com/rss'], perpDexs: 'all', includeSpot: true, excerptChars: 8, telegramChatId: 'fixture' };
const reply = body => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
test('HTTP portfolio adapter covers native/HIP-3 perps and spot, preserves direction and decimal values', async t => {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    assert.equal(url, 'https://api.hyperliquid.xyz/info'); assert.equal(init.method, 'POST');
    const req = JSON.parse(init.body); calls.push(req);
    if (req.type === 'perpDexs') return reply([null, { name: 'xyz' }]);
    if (req.type === 'spotClearinghouseState') return reply({ balances: [{ coin: 'USDC', total: '123.12345678' }, { coin: 'PURR', total: '0' }] });
    return reply({ assetPositions: [{ position: { coin: req.dex ? 'xyz:TSLA' : 'HYPE', szi: req.dex ? '-2.5' : '10', entryPx: '23.4500', positionValue: '240', unrealizedPnl: '-1.5' } }] });
  });
  const result = await readPortfolio(config, signal());
  assert.deepEqual(calls.map(c => [c.type, c.dex]), [['perpDexs', undefined], ['clearinghouseState', ''], ['clearinghouseState', 'xyz'], ['spotClearinghouseState', undefined]]);
  assert.deepEqual(result.positions.map(p => [p.coin, p.side]), [['HYPE', 'long'], ['xyz:TSLA', 'short'], ['USDC', 'long']]);
  assert.equal(result.positions[0].entryPrice, '23.4500'); assert.equal(result.positions[2].size, '123.12345678');
  assert.equal(result.coverage.length, 3); assert.ok(result.fetchedAt <= Date.now());
});
test('a partial Hyperliquid failure is an error, never an empty or complete portfolio', async t => {
  t.mock.method(globalThis, 'fetch', async () => new Response('rate limited', { status: 429 }));
  await assert.rejects(readPortfolio(config, signal()), /HTTP 429/);
  t.mock.method(globalThis, 'fetch', async () => reply({ error: 'invalid account' }));
  await assert.rejects(readPortfolio({ ...config, perpDexs: [''] }, signal()), /Invalid perpetual positions/);
});
test('real RSS and Atom parsing retains corrections and labels the authored excerpt limit', async t => {
  let body = 'abcdefghijk';
  t.mock.method(globalThis, 'fetch', async url => new Response(url.endsWith('atom')
    ? '<feed xmlns="http://www.w3.org/2005/Atom"><title>Atom</title><id>feed</id><updated>2026-10-07T00:00:00Z</updated><entry><title>Atom source</title><id>B</id><link href="https://example.com/B"/><updated>2026-10-07T00:00:00Z</updated><summary>Some evidence</summary></entry></feed>'
    : `<rss version="2.0"><channel><title>News</title><link>https://example.com</link><description>Feed</description><item><guid>A</guid><title>Source &amp; evidence</title><link>https://example.com/A</link><description>${body}</description></item></channel></rss>`));
  const first = await readNews(config, signal()); body = 'abcdefghijk corrected';
  const corrected = await readNews(config, signal());
  assert.equal(first[0].excerpt, 'abcdefgh'); assert.equal(first[0].excerptTruncated, true);
  assert.equal(first[0].publishedAt, null); assert.equal(first[0].title, 'Source & evidence');
  assert.equal(first[0].sourceId, corrected[0].sourceId); assert.notEqual(first[0].id, corrected[0].id);
  const atom = await readNews({ ...config, feeds: ['https://example.com/atom'] }, signal());
  assert.equal(atom[0].url, 'https://example.com/B'); assert.equal(atom[0].publishedAt, Date.parse('2026-10-07T00:00:00Z'));
});
test('Telegram adapter requires a real message receipt and redacts credential-bearing transport errors', async t => {
  const before = process.env.TELEGRAM_BOT_TOKEN; process.env.TELEGRAM_BOT_TOKEN = 'synthetic-test-token';
  t.after(() => { if (before === undefined) delete process.env.TELEGRAM_BOT_TOKEN; else process.env.TELEGRAM_BOT_TOKEN = before; });
  t.mock.method(globalThis, 'fetch', async (_url, init) => { assert.equal(JSON.parse(init.body).text, 'source alert'); return reply({ ok: true, result: { message_id: 73 } }); });
  assert.equal(await ports.telegram('source alert', config, signal()), '73');
  t.mock.method(globalThis, 'fetch', async () => reply({ ok: false, description: 'rejected' }));
  await assert.rejects(ports.telegram('source alert', config, signal()), DeliveryRejected);
  t.mock.method(globalThis, 'fetch', async url => { throw new Error(`connect failed ${url}`); });
  await assert.rejects(ports.telegram('source alert', config, signal()), e => /unknown/.test(e.message) && !e.message.includes('synthetic-test-token'));
  t.mock.method(globalThis, 'fetch', async () => reply({ ok: true, result: {} }));
  await assert.rejects(ports.telegram('source alert', config, signal()), /No valid Telegram receipt/);
});
