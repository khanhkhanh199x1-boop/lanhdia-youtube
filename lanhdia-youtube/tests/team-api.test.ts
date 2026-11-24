import assert from 'node:assert/strict';
import { generateKeyPairSync, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import test from 'node:test';
import { createApiApp } from '../server.ts';
import { adminDb } from '../src/lib/firebase-admin.ts';
import { INVITE_DURATION_MS, parseChannelGrants, staffCapabilities } from '../src/lib/team.ts';
import { MASTER_ADMIN_UID, MASTER_ADMIN_EMAIL } from '../src/lib/rbac.ts';

const emulator = /^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST || '');

test('grants fail closed; per-channel View caps all staff roles', () => {
  assert.equal(parseChannelGrants([{ channelId: 'a/b', level: 'role' }]), null);
  assert.equal(parseChannelGrants([{ channelId: 'a', level: 'role' }, { channelId: 'a', level: 'view' }]), null);
  assert.deepEqual(staffCapabilities('leader', 'view', false), { editChannel: false, writeDraft: false, manageDrafts: false });
  assert.deepEqual(staffCapabilities('manager', 'role', false), { editChannel: true, writeDraft: true, manageDrafts: false });
  assert.deepEqual(staffCapabilities('editor', 'role', false), { editChannel: false, writeDraft: true, manageDrafts: false });
  assert.deepEqual(staffCapabilities('viewer', 'role', false), { editChannel: false, writeDraft: false, manageDrafts: false });
});

test('team API with Firestore emulator: email-bound invites, role and channel isolation, draft writes, and revocation', { skip: !emulator }, async (t) => {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  process.env.FIREBASE_SERVICE_ACCOUNT_KEY = JSON.stringify({ project_id: 'demo-lanhdia-team', client_email: 'test@demo-lanhdia-team.iam.gserviceaccount.com', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }) });
  const db = adminDb();
  const key = randomUUID().slice(0, 8);
  const ids = { a: `tenanta-${key}`, b: `tenantb-${key}`, editor: `editor-${key}`, viewer: `viewer-${key}`, unverified: `unverified-${key}` };
  const emails = { a: `a-${key}@example.test`, b: `b-${key}@example.test`, editor: `editor-${key}@example.test`, viewer: `viewer-${key}@example.test` };
  const identities = new Map(Object.entries(ids).map(([name, uid]) => [name, { uid, email: emails[name as keyof typeof emails] || emails.editor, email_verified: name !== 'unverified', name }]));
  identities.set('root', { uid: MASTER_ADMIN_UID, email: MASTER_ADMIN_EMAIL, email_verified: true, name: 'root fixture' });
  identities.set('fake-root', { uid: `fake-${key}`, email: MASTER_ADMIN_EMAIL, email_verified: false, name: '' });
  const activeUntil = Date.now() + 86_400_000;
  const profiles = db.collection('users');
  const channel = `a1-${key}`;
  const viewChannel = `a2-${key}`;
  const unassigned = `a3-${key}`;
  const outsideChannel = `b1-${key}`;
  const seed = db.batch();
  for (const id of [ids.a, ids.b]) seed.set(profiles.doc(id), { role: 'tenant', tenantId: id, expiresAt: activeUntil });
  seed.set(profiles.doc(ids.editor), { role: 'tenant', tenantId: ids.editor, displayName: 'Existing Editor', teamName: 'Workspace riêng', credits: 42, plan: 'p30', expiresAt: activeUntil });
  for (const id of [channel, viewChannel, unassigned, outsideChannel]) seed.set(db.collection('channels').doc(id), { tenantId: id === outsideChannel ? ids.b : ids.a, channelName: id, channelId: 'UC1234567890123456789012', rowIndex: 4, niche: '', schedule: '', gmail: 'private@example.test', proxy: 'private-proxy', bktStatus: 'private-bkt', videoFolder: 'private-folder', note: 'private-note' });
  await seed.commit();
  const server = createApiApp({ verifyToken: async (token) => {
    const identity = identities.get(token);
    if (!identity) throw new Error('fixture auth denied');
    return identity;
  } }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const call = async (method: string, path: string, status: number, who?: string, body?: unknown) => {
    const response = await fetch(`http://127.0.0.1:${address.port}/api${path}`, {
      method, headers: { 'Content-Type': 'application/json', ...(who ? { Authorization: `Bearer ${who}` } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const json = await response.json() as { data?: any; code: string; message: string };
    assert.equal(response.status, status, `${method} ${path} (${who || 'guest'}): ${JSON.stringify(json)}`);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    return json;
  };

  const invite = '/team/invites';
  const grants = [{ channelId: channel, level: 'role' }, { channelId: viewChannel, level: 'view' }];
  const payload = { email: emails.editor, staffRole: 'editor', grants };
  await call('GET', '/auth/me', 401);
  await call('GET', '/admin/orders', 403, 'fake-root');
  const root = (await call('GET', '/auth/me', 200, 'root')).data;
  assert.equal(root.role, 'root');
  await call('POST', invite, 400, 'a', { ...payload, staffRole: 'root' });
  await call('POST', invite, 400, 'a', { ...payload, grants: [{ channelId: outsideChannel, level: 'role' }] });
  const first = (await call('POST', invite, 201, 'a', payload)).data;
  assert.match(first.token, /^[A-Za-z0-9_-]{32}$/);
  assert.ok(Math.abs(first.expiresAt - Date.now() - INVITE_DURATION_MS) < 5000);
  const inviteDoc = (await db.collection('invites').doc(first.id).get()).data()!;
  assert.equal(JSON.stringify(inviteDoc).includes(first.token), false);
  await call('POST', invite, 409, 'a', payload);
  await call('DELETE', `${invite}/${first.id}`, 404, 'b');
  const second = (await call('POST', invite, 201, 'a', { ...payload, replace: first.id })).data;
  await call('POST', `${invite}/preview`, 410, undefined, { token: first.token });
  const preview = (await call('POST', `${invite}/preview`, 200, undefined, { token: second.token })).data;
  assert.equal(preview.email, undefined);
  assert.equal(preview.staffRole, 'editor');
  await call('POST', `${invite}/accept`, 403, 'unverified', { token: second.token });
  await call('POST', `${invite}/accept`, 403, 'b', { token: second.token });
  await call('POST', `${invite}/accept`, 403, 'root', { token: second.token });
  await call('POST', `${invite}/accept`, 200, 'editor', { token: second.token });
  await call('POST', `${invite}/accept`, 410, 'editor', { token: second.token });
  await call('DELETE', `${invite}/${second.id}`, 409, 'a');
  const team = (await call('GET', '/team/members', 200, 'a')).data.items;
  assert.deepEqual(team.map((m: { uid: string }) => m.uid), [ids.editor]);
  assert.equal(team[0].staffRole, 'editor');
  assert.equal((await call('GET', '/team/members', 200, 'b')).data.items.length, 0);

  for (const path of ['/team/members', '/team/invites', '/orders/mine', '/orders/payment-config', '/workstation/helper-package', '/utilities/comments', '/admin/overview']) await call('GET', path, 403, 'editor');
  for (const path of ['/team/invites', '/channels', '/channels/sync-sheet', '/orders', '/orders/any/confirm-transfer']) await call('POST', path, 403, 'editor', {});
  await call('DELETE', `/channels/${channel}`, 403, 'editor');
  const profile = (await call('GET', '/auth/me', 200, 'editor')).data;
  assert.equal(profile.role, 'staff');
  assert.equal(profile.credits, 0);
  assert.equal(profile.isReadOnly, false);
  const visible = (await call('GET', '/channels', 200, 'editor')).data.items;
  assert.deepEqual(new Set(visible.map((c: { id: string }) => c.id)), new Set([channel, viewChannel]));
  for (const row of visible) for (const key of ['gmail', 'proxy', 'bktStatus', 'videoFolder', 'note', 'tenantId']) assert.equal(Object.hasOwn(row, key), false);
  await call('PATCH', `/channels/${channel}`, 403, 'editor', { niche: 'edited' });
  await call('GET', `/channels/${unassigned}/drafts`, 404, 'editor');
  await call('GET', `/channels/${outsideChannel}/drafts`, 404, 'editor');
  await call('POST', `/channels/${viewChannel}/drafts`, 403, 'editor', { title: 'View only' });
  const ownerDraft = (await call('POST', `/channels/${channel}/drafts`, 201, 'a', { title: 'Owner draft' })).data.id;
  const editDraft = (await call('POST', `/channels/${channel}/drafts`, 201, 'editor', { title: 'Editor draft' })).data.id;
  await call('PATCH', `/channels/${channel}/drafts/${editDraft}`, 200, 'editor', { title: 'Editor updated' });
  await call('PATCH', `/channels/${channel}/drafts/${ownerDraft}`, 403, 'editor', { title: 'Not mine' });
  await call('PATCH', `/team/members/${ids.editor}`, 404, 'b', { staffRole: 'viewer', grants: [] });
  await call('PATCH', `/team/members/${ids.editor}`, 200, 'a', { staffRole: 'manager', grants });
  await call('PATCH', `/channels/${channel}`, 200, 'editor', { niche: 'Đã cập nhật', schedule: 'T2' });
  await call('PATCH', `/channels/${channel}`, 403, 'editor', { bktStatus: 'forbidden' });
  await call('PATCH', `/channels/${viewChannel}`, 403, 'editor', { niche: 'not assigned to edit' });
  await call('PATCH', `/channels/${unassigned}`, 404, 'editor', { niche: 'not assigned' });
  await call('PATCH', `/team/members/${ids.editor}`, 200, 'a', { staffRole: 'leader', grants });
  await call('PATCH', `/channels/${channel}/drafts/${ownerDraft}`, 200, 'editor', { title: 'Leader review' });
  await call('PATCH', `/team/members/${ids.editor}`, 200, 'a', { staffRole: 'viewer', grants });
  assert.equal((await call('GET', `/channels/${channel}/drafts`, 200, 'editor')).data.canCreate, false);
  await call('DELETE', `/channels/${channel}/drafts/${editDraft}`, 403, 'editor');

  await call('DELETE', `/team/members/${ids.editor}`, 404, 'b');
  await profiles.doc(ids.a).update({ expiresAt: 0 });
  await call('DELETE', `/team/members/${ids.editor}`, 200, 'a');
  const restored = (await call('GET', '/auth/me', 200, 'editor')).data;
  assert.equal(restored.tenantId, ids.editor);
  assert.equal(restored.credits, 42);
  assert.equal(restored.teamName, 'Workspace riêng');
  assert.deepEqual((await call('GET', '/channels', 200, 'editor')).data.items, []);
  await call('GET', `/channels/${channel}/drafts`, 404, 'editor');
  await call('POST', invite, 403, 'a', payload);

  const quick = (await call('POST', invite, 201, 'b', { email: emails.viewer, staffRole: 'viewer' })).data;
  await call('POST', `${invite}/accept`, 200, 'viewer', { token: quick.token });
  assert.deepEqual((await call('GET', '/channels', 200, 'viewer')).data.items, []);
  const inactive = (await call('POST', invite, 201, 'b', { email: emails.editor, staffRole: 'viewer' })).data;
  await db.collection('invites').doc(inactive.id).update({ expiresAt: Date.now() - 1000 });
  await call('POST', `${invite}/accept`, 410, 'editor', { token: inactive.token });
  const revoked = (await call('POST', invite, 201, 'b', { email: emails.editor, staffRole: 'viewer' })).data;
  await call('DELETE', `${invite}/${revoked.id}`, 200, 'b');
  await call('POST', `${invite}/preview`, 410, undefined, { token: revoked.token });
  const bInvites = (await call('GET', invite, 200, 'b')).data.items;
  assert.deepEqual(new Set(bInvites.map((i: { status: string }) => i.status)), new Set(['used', 'expired', 'revoked']));
});
