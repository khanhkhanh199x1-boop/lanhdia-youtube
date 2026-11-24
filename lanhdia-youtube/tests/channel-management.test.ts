import assert from 'node:assert/strict';
import { generateKeyPairSync, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import test from 'node:test';
import { createApiApp } from '../server.ts';
import { adminDb } from '../src/lib/firebase-admin.ts';
import { officialYouTubeMetadata } from '../src/lib/channel-meta-api.ts';
import { mergeSheetChannels } from '../src/lib/channel-entries.ts';
import { chromeImportHash, normalizeChromeProfile, parseChannelTarget, readChromeImport, targetUrl } from '../src/lib/channel-target.ts';
import { parseChannelSheet } from '../src/lib/sheet-parser.ts';
import { isChromeView, readCaptureHash, studioCapture } from "../src/lib/chrome-hub.ts";

const channelId = 'UC1111111111111111111111';
const otherId = 'UC2222222222222222222222';
const demo = (id: string, hidden = false) => ({ id, snippet: { title: 'Kênh thử', customUrl: '@kenhthu', country: 'VN' },
  statistics: { hiddenSubscriberCount: hidden, subscriberCount: '1230', videoCount: '36', viewCount: '415000' } });

function fakeGoogle(onCall: (url: URL) => void = () => undefined) {
  return (async (raw: URL, init: RequestInit) => {
    assert.equal(raw.origin, 'https://www.googleapis.com');
    assert.equal(raw.pathname, '/youtube/v3/channels');
    assert.equal(raw.searchParams.has('key'), false);
    assert.equal(new Headers(init.headers).get('X-Goog-Api-Key'), 'test-not-a-real-key');
    onCall(raw);
    const ids = raw.searchParams.get('id')?.split(',') || (raw.searchParams.get('forHandle') === '@kenhthu' ? [channelId] : []);
    return Response.json({ items: ids.map((id) => demo(id, id === otherId)) });
  }) as typeof fetch;
}

test('parses canonical channel targets, constrains deep links, and never accepts unrelated or spoofed host URLs', () => {
  for (const input of [channelId, `https://www.youtube.com/channel/${channelId}/videos`, `https://studio.youtube.com/channel/${channelId}/analytics/tab-overview/period-default`]) {
    assert.deepEqual(parseChannelTarget(input), { kind: 'id', value: channelId });
  }
  assert.deepEqual(parseChannelTarget('https://m.youtube.com/@k%C3%AAnhth%E1%BB%AD/featured?foo=bar'), { kind: 'handle', value: '@kênhthử' });
  for (const input of ['https://youtube.com.evil.test/@anything', 'javascript:alert(1)', 'https://youtube.com@evil.test/@anything', 'http://www.youtube.com/@kenh', 'https://www.youtube.com:8443/@kenh', 'https://www.youtube.com/watch?v=abc', 'https://studio.youtube.com/video/abc', 'https://other.test/channel/' + channelId, '@abc?x=3']) assert.equal(parseChannelTarget(input), null, input);
  const target = parseChannelTarget('@kênhthử')!;
  assert.equal(targetUrl(target), 'https://www.youtube.com/@k%C3%AAnhth%E1%BB%AD');
  const imported = { target, title: '<Tên kênh>', profileLabel: 'Kênh 1 – Máy A', chromeProfile: 'Profile 48' };
  assert.deepEqual(readChromeImport(chromeImportHash(imported)), imported);
  assert.equal(readChromeImport('#chrome=1&yt=https://example.test'), null);
  assert.equal(normalizeChromeProfile('../../Default'), '');
  assert.equal(normalizeChromeProfile(' profile 48 '), 'Profile 48');
});

test('YouTube source validates output, hides hidden counts, batches IDs, and reuses a bounded cache', async () => {
  const queries: URL[] = [];
  const provider = officialYouTubeMetadata(fakeGoogle((u) => queries.push(u)), () => 'test-not-a-real-key');
  assert.equal(provider.enabled(), true);
  const result = await provider.read([parseChannelTarget(channelId)!, parseChannelTarget(otherId)!]);
  assert.equal(queries[0].searchParams.get('id'), `${channelId},${otherId}`);
  assert.equal(result.get(channelId)?.subscribers, 1230);
  assert.equal(result.get(otherId)?.subscribers, undefined);
  assert.equal(result.get(otherId)?.hiddenSubscribers, true);
  await provider.read([parseChannelTarget(channelId)!]);
  assert.equal(queries.length, 1);
  const handle = (await provider.read([parseChannelTarget('@KenhThu')!])).get('@kenhthu');
  // Separate assertion of exact-case query; handles' cache keys are case-insensitive.
  assert.equal(queries[1].searchParams.get('forHandle'), '@KenhThu');
  assert.equal(handle, undefined);
  const unavailable = officialYouTubeMetadata(fakeGoogle(), () => undefined);
  await assert.rejects(() => unavailable.read([parseChannelTarget(channelId)!]), { code: 'META_UNAVAILABLE' });
  const quota = officialYouTubeMetadata(async () => Response.json({ error: { errors: [{ reason: 'quotaExceeded' }] } }, { status: 403 }), () => 'fixture');
  await assert.rejects(() => quota.read([parseChannelTarget(channelId)!]), { code: 'META_QUOTA' });
});

const emulator = /^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST || '');
test('channel management API: manual fields, metadata preview, duplicate protection, workspace isolation and safe Sheet merge', { skip: !emulator }, async (t) => {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  process.env.FIREBASE_SERVICE_ACCOUNT_KEY = JSON.stringify({ project_id: 'demo-lanhdia-team', client_email: 'test@demo-lanhdia-team.iam.gserviceaccount.com', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }) });
  const db = adminDb();
  const nonce = randomUUID().slice(0, 8);
  const a = `channel-owner-a-${nonce}`, b = `channel-owner-b-${nonce}`, member = `channel-staff-${nonce}`;
  await Promise.all([a, b].map((uid) => db.collection('users').doc(uid).set({ role: 'tenant', tenantId: uid, expiresAt: Date.now() + 60_000 }))); 
  const server = createApiApp({ channelMeta: officialYouTubeMetadata(fakeGoogle(), () => 'test-not-a-real-key'), verifyToken: async (token) => {
    if (![a, b, member].includes(token)) throw new Error('fixture denied');
    return { uid: token, email: token + '@example.test' };
  } }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const request = async (method: string, path: string, who: string, body?: unknown) => {
    const res = await fetch(`http://127.0.0.1:${address.port}/api/channels${path}`, { method,
      headers: { 'Content-Type': 'application/json', ...(who ? { Authorization: `Bearer ${who}` } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    assert.equal(res.headers.get('cache-control'), 'no-store');
    return { status: res.status, json: await res.json() } as { status: number; json: { code: string; message: string; data: any } };
  };
  const call = async (method: string, path: string, status: number, who: string, body?: unknown) => {
    const got = await request(method, path, who, body);
    assert.equal(got.status, status, `${method} ${path}: ${got.json.code} ${got.json.message}`);
    return got.json.data;
  };
  await call('GET', '/meta/status', 401, '');
  assert.equal((await call('GET', '/meta/status', 200, a)).configured, true);
  await call('POST', '/meta/lookup', 400, a, { target: 'https://not-youtube.test/@kenh' });
  const found = await call('POST', '/meta/lookup', 200, a, { target: 'https://youtube.com/@kenhthu' });
  assert.equal(found.channelId, channelId);
  assert.equal(found.country, 'VN');
  assert.equal(found.viewCount, 415000);
  assert.equal((await call('GET', '', 200, a)).items.length, 0); // preview is not a write
  await call('POST', '', 400, a, { channelName: 'Bad', channelId, chromeProfile: '../Default' });
  await call('POST', '', 400, a, { channelName: 'Bad', channelId, subscribers: -1 });
  const payload = { channelName: 'Kênh của tôi', channelId, profileLabel: 'Máy A', chromeProfile: 'profile 48', handle: '@kenhthu',
    country: 'vn', category: 'education', subscribers: 0, watchHours12m: 312.5, monetized: true, autoMetadata: true,
    communityStrikes: 0, copyrightStrikes: 1, gmail: 'manual@gmail.com', note: 'Ghi chú gốc', state: 'paused' };
  const tries = await Promise.all([request('POST', '', a, { ...payload, tenantId: b }), request('POST', '', a, payload)]);
  assert.deepEqual(tries.map((r) => r.status).sort(), [201, 409]);
  const made = tries.find((r) => r.status === 201)!.json.data;
  assert.equal(made.tenantId, a);
  assert.equal(made.watchHours12m, 312.5);
  assert.equal(made.subscribers, 0);
  assert.equal(made.chromeProfile, 'Profile 48');
  assert.equal(made.country, 'VN');
  assert.equal(made.channelUrl, targetUrl({ kind: 'id', value: channelId }));
  await call('POST', '', 409, a, { channelName: 'Trùng handle', handle: '@KENHTHU' });
  await call('POST', '', 201, b, { channelName: 'Cùng ID, workspace riêng', channelId });
  await call('PATCH', `/${made.id}`, 404, b, { note: 'not my channel' });
  await call('PATCH', `/${made.id}`, 409, a, { channelId: otherId });
  await call('POST', '/meta/refresh', 404, b, { ids: [made.id] });
  const fresh = await call('POST', '/meta/refresh', 200, a, { ids: [made.id] });
  assert.equal(fresh.items[0].meta.subscribers, 1230);
  assert.equal((await db.collection('channels').doc(made.id).get()).get('subscribers'), 0); // fresh numbers do not overwrite manual data
  const draftRef = db.collection('channels').doc(made.id).collection('videoDrafts').doc('fixture');
  await draftRef.set({ title: 'Original draft' });
  await db.collection('users').doc(member).set({ role: 'staff', tenantId: a, staffRole: 'manager', grants: [{ channelId: made.id, level: 'role' }] });
  await call('POST', '/meta/lookup', 403, member, { target: channelId });
  await call('POST', '/meta/refresh', 403, member, { ids: [made.id] });
  await call('GET', '/meta/status', 403, member);
  const detail = (await call('GET', '', 200, member)).items[0];
  assert.equal(detail.id, made.id);
  for (const key of ['gmail', 'profileLabel', 'chromeProfile', 'monetized', 'note']) assert.equal(Object.hasOwn(detail, key), false);
  const sheet = (key: string) => parseChannelSheet(`head\nhead\nhead\n1,Sheet Name,${key},,,,Chủ đề,,,\n`);
  await mergeSheetChannels(a, sheet(otherId));
  const merged = await mergeSheetChannels(a, sheet(channelId));
  assert.deepEqual(merged, { count: 1, created: 0, updated: 1, skipped: 0 });
  const after = (await call('GET', '', 200, a)).items;
  assert.equal(after.length, 2, 'previous manually/otherwise imported entries are not deleted');
  const sameRow = after.find((c: any) => c.id === made.id);
  assert.equal(sameRow.niche, 'Chủ đề');
  assert.equal(sameRow.chromeProfile, 'Profile 48');
  assert.equal(sameRow.note, 'Ghi chú gốc');
  assert.equal(sameRow.autoMetadata, true);
  assert.equal((await draftRef.get()).data()?.title, 'Original draft');
  assert.equal((await call('GET', '', 200, member)).items[0].id, made.id);
  const duplicate = sheet(channelId);
  assert.equal((await mergeSheetChannels(a, [...duplicate, duplicate[0]])).skipped, 2);
});

test('Chrome Studio capture accepts only intended Studio channel URLs and fixed launch views', () => {
  const target = `https://studio.youtube.com/channel/${channelId}`;
  assert.deepEqual(studioCapture(target + '/videos/upload#something'), { channelId });
  for (const raw of [target.replace('https:', 'http:'), target.replace('.com', '.com.fake.test'), target.replace('youtube.com', 'youtube.com:444'), target.replace('studio.', 'www.'), target.replace('https://', 'https://user@'), target.replace('/channel/', '/video/'), target + 'x']) assert.equal(studioCapture(raw), null, raw);
  assert.equal(readCaptureHash('#chrome-sync=' + 'a'.repeat(32)), 'a'.repeat(32));
  assert.equal(readCaptureHash('#chrome-sync=' + 'a'.repeat(32) + '&yt=' + channelId), null);
  assert.equal(isChromeView('analytics'), true); assert.equal(isChromeView('__proto__'), false);
});

test('Chrome sync API auto-saves once, preserves record identity/custom fields, rejects relinking, and enforces workspace and staff restrictions', { skip: !emulator }, async (t) => {
  const s = randomUUID().slice(0,8);
  const owner = `hub-owner-${s}`, other = `hub-other-${s}`, staff = `hub-staff-${s}`, readonly = `hub-free-${s}`;
  const db = adminDb(); let configured = true, outage = false;
  await db.collection('users').doc(owner).set({ role: 'tenant', expiresAt: Date.now() + 120_000 });
  await db.collection('users').doc(other).set({ role: 'tenant', expiresAt: Date.now() + 120_000 });
  const server = createApiApp({ channelMeta: officialYouTubeMetadata(((url: URL, opts: RequestInit) => outage ? Promise.resolve(new Response(null, {status:502})) : fakeGoogle()(url, opts)) as typeof fetch, () => configured ? 'test-not-a-real-key' : undefined), verifyToken: async (uid) => {
    if (![owner, other, staff, readonly].includes(uid)) throw new Error('Unauthorized'); return { uid, email: uid + '@example.test' };
  } }).listen(0, '127.0.0.1');
  await once(server,'listening'); t.after(() => { server.closeAllConnections(); server.close(); });
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const send = async (method: string, path: string, uid: string, expected: number, payload?: unknown) => {
    const res = await fetch(`http://127.0.0.1:${address.port}/api/channels${path}`, { method,
      headers:{'Content-Type':'application/json', ...(uid ? { Authorization: 'Bearer ' + uid } : {})}, body: payload === undefined ? undefined : JSON.stringify(payload) });
    const json = await res.json(); assert.equal(res.status, expected, `${method} ${path}: ${json.code} ${json.message}`); return json;
  };
  const base = { workspace: owner, channelId, profileKey: 'a'.repeat(32), directory: 'Profile 48' };
  await send('POST','/chrome-sync','',401,base);
  await send('POST','/chrome-sync',other,403,base);
  await send('POST','/chrome-sync',readonly,403,{ ...base, workspace:readonly });
  await send('POST','/chrome-sync',owner,400,{ ...base, directory:'Profile 48 --incognito' });
  const existing = (await send('POST','',owner,201,{ channelName: 'Tên tự đặt', handle: '@KENHTHU', gmail: 'manual@example.test', subscribers: 19, bktStatus: 'old', monetized: true, watchHours12m: 20.5, autoMetadata: false, note: 'giữ nguyên' })).data;
  const linked = (await send('POST','/chrome-sync',owner,200,base)).data;
  assert.equal(linked.channel.id, existing.id); assert.equal(linked.action,'updated'); assert.equal(linked.channel.channelId, channelId);
  assert.equal(linked.channel.channelName,'Tên tự đặt'); assert.equal(linked.meta.subscribers,1230); assert.equal(linked.channel.subscribers,19);
  assert.equal(linked.channel.watchHours12m,20.5); assert.equal(linked.channel.monetized,true); assert.equal(linked.channel.bktStatus,'old');
  assert.equal(linked.channel.chromeLink.directory,'Profile 48'); assert.equal(linked.channel.autoMetadata,false);
  assert.equal((await send('POST','/chrome-sync',owner,200,base)).data.channel.id, existing.id);
  assert.equal((await send('GET','',owner,200)).data.items.length,1);
  assert.equal((await send('POST','/chrome-sync',owner,409,{...base,profileKey:'b'.repeat(32)})).code,'CHROME_PROFILE_CONFLICT');
  await db.collection('users').doc(staff).set({ role:'staff', tenantId:owner, staffRole:'manager', grants:[{channelId:existing.id,level:'role'}] });
  await send('POST','/chrome-sync',staff,403,base);
  await send('DELETE',`/${existing.id}/chrome-link`,staff,403,{profileKey:base.profileKey});
  assert.equal((await send('GET','',staff,200)).data.items[0].chromeLink,undefined);
  await send('DELETE',`/${existing.id}/chrome-link`,other,404,{profileKey:base.profileKey});
  await send('DELETE',`/${existing.id}/chrome-link`,owner,409,{profileKey:'b'.repeat(32)});
  await send('DELETE',`/${existing.id}/chrome-link`,owner,200,{profileKey:base.profileKey});
  assert.equal((await db.collection('channels').doc(existing.id).get()).get('chromeLink'),undefined);
  configured=false;
  const newChannel = (await send('POST','/chrome-sync',owner,200,{ ...base, channelId:otherId, profileKey:'b'.repeat(32), directory:'Default' })).data;
  assert.equal(newChannel.action,'created'); assert.equal(newChannel.metaStatus,'unconfigured'); assert.equal(newChannel.channel.channelName,`Kênh ${otherId}`);
  assert.equal(newChannel.channel.autoMetadata,true); assert.equal(newChannel.channel.monetized,undefined);
  configured=true; outage=true;
  const fallback = (await send('POST','/chrome-sync',owner,200,{ ...base, channelId:otherId, profileKey:'b'.repeat(32), directory:'Default' })).data;
  assert.equal(fallback.metaStatus,'unavailable'); assert.equal(fallback.channel.id,newChannel.channel.id);
});
