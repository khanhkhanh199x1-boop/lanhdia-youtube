import { createHash, randomBytes } from 'node:crypto';
import type { Express, Request, RequestHandler } from 'express';
import type { DocumentData, Firestore, Transaction } from 'firebase-admin/firestore';
import { adminDb } from './firebase-admin.ts';
import { isMasterAdmin } from './rbac.ts';
import { ApiFault, fail, ok, wrap } from './server-http.ts';
import {
  FIRESTORE_ID, INVITE_DURATION_MS, INVITE_TOKEN, displayStaffRole, inviteStatus, isStaffRole,
  normalizeInviteEmail, parseChannelGrants, staffCapabilities,
  type ChannelGrant, type StaffAccess, type TeamInvite, type TeamMember, type VideoDraft,
} from './team.ts';

const hash = (text: string) => createHash('sha256').update(text).digest('hex');
const HASH = /^[a-f0-9]{64}$/;
const blocked = () => new ApiFault(403, 'FORBIDDEN', 'Bạn không có quyền thực hiện thao tác này.');
const missing = (thing: string) => new ApiFault(404, 'NOT_FOUND', `Không tìm thấy ${thing}.`);
const invalid = (message: string) => new ApiFault(400, 'BAD_REQUEST', message);
const conflict = (message: string) => new ApiFault(409, 'TEAM_CONFLICT', message);
const readOnly = () => new ApiFault(403, 'READ_ONLY_MODE', 'Team đang ở chế độ chỉ xem.');
const text = (value: unknown) => typeof value === 'string' ? value : '';
const number = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : 0;
const pendingTarget = (db: Firestore, tenantId: string, email: string) => db.collection('team_invite_targets').doc(hash(`${tenantId}\0${email}`));

export function parseStoredStaffAccess(data: DocumentData): StaffAccess {
  return { staffRole: displayStaffRole(data.staffRole), grants: parseChannelGrants(data.grants) ?? [] };
}

export function staffEndpointAllowed(method: string, path: string) {
  if (method === 'GET' && ['/api/auth/me', '/api/auth/session', '/api/channels'].includes(path)) return true;
  if (method === 'POST' && ['/api/team/invites/accept', '/api/utilities/seo-extract'].includes(path)) return true;
  if (method === 'PATCH' && /^\/api\/channels\/[\w-]+$/.test(path)) return true;
  if ((method === 'GET' || method === 'POST') && /^\/api\/channels\/[\w-]+\/drafts$/.test(path)) return true;
  return (method === 'PATCH' || method === 'DELETE') && /^\/api\/channels\/[\w-]+\/drafts\/[\w-]+$/.test(path);
}

function requestedAccess(body: Record<string, unknown>): StaffAccess {
  const grants = parseChannelGrants(body.grants ?? []);
  if (!isStaffRole(body.staffRole) || !grants) throw invalid('Vai trò hoặc danh sách phân quyền kênh không hợp lệ.');
  return { staffRole: body.staffRole, grants };
}

async function validateGrants(db: Firestore, tx: Transaction, tenantId: string, grants: ChannelGrant[]) {
  if (!grants.length) return;
  const snapshots = await tx.getAll(...grants.map(({ channelId }) => db.collection('channels').doc(channelId)));
  if (snapshots.some((doc) => !doc.exists || doc.data()?.tenantId !== tenantId)) throw invalid('Có kênh không còn tồn tại hoặc không thuộc team của bạn.');
}

function requireTeamOwner(req: Request, _res: unknown, next: () => void) {
  if (req.profile?.role === 'staff' || req.profile?.tenantId !== req.authUid) throw blocked();
  next();
}

async function assertOwnerNow(db: Firestore, tx: Transaction, req: Request, writable: boolean) {
  if (req.isVerifiedRoot) return;
  const data = (await tx.get(db.collection('users').doc(req.authUid!))).data();
  if (data?.role === 'staff') throw blocked();
  if (writable && number(data?.expiresAt) <= Date.now()) throw readOnly();
}

function toInvite(id: string, data: DocumentData): TeamInvite {
  return { id, email: text(data.email), teamName: text(data.teamName), status: inviteStatus(data), createdAt: number(data.createdAt), expiresAt: number(data.expiresAt), ...parseStoredStaffAccess(data) };
}

function assertPending(data: DocumentData) {
  const status = inviteStatus(data);
  if (status !== 'pending') throw new ApiFault(410, 'INVITE_INACTIVE', status === 'expired' ? 'Lời mời đã hết hạn.' : status === 'legacy' ? 'Link mời cũ không còn hỗ trợ. Hãy nhờ chủ team tạo lời mời theo Gmail.' : 'Lời mời đã được dùng hoặc thu hồi.');
}

export function registerTeamRoutes(app: Express, auth: RequestHandler) {
  app.get('/api/team/members', auth, requireTeamOwner, wrap(async (req, res) => {
    const snapshot = await adminDb().collection('users').where('tenantId', '==', req.authUid).limit(500).get();
    const items: TeamMember[] = snapshot.docs.flatMap((doc) => {
      const data = doc.data();
      if (data.role !== 'staff' || doc.id === req.authUid || isMasterAdmin(doc.id)) return [];
      return [{ uid: doc.id, email: text(data.email), displayName: text(data.displayName), teamName: text(data.teamName), joinedAt: number(data.joinedAt || data.createdAt), ...parseStoredStaffAccess(data) }];
    });
    ok(res, { items: items.sort((a, b) => b.joinedAt - a.joinedAt) });
  }));

  app.get('/api/team/invites', auth, requireTeamOwner, wrap(async (req, res) => {
    // Equality-only queries work with Firestore's automatic indexes.
    const snapshot = await adminDb().collection('invites').where('tenantId', '==', req.authUid).limit(500).get();
    ok(res, { items: snapshot.docs.map((doc) => toInvite(doc.id, doc.data())).sort((a, b) => b.createdAt - a.createdAt) });
  }));

  app.post('/api/team/invites', auth, requireTeamOwner, wrap(async (req, res) => {
    const db = adminDb();
    const body = req.body ?? {};
    const email = normalizeInviteEmail(body.email);
    if (!email) throw invalid('Nhập Gmail hoặc email Google Workspace hợp lệ.');
    if (email === normalizeInviteEmail(req.authEmail) || isMasterAdmin(null, email, true)) throw invalid('Không thể mời chính bạn hoặc tài khoản Quản trị viên chính.');
    const access = requestedAccess(body);
    const replacement = body.replace;
    if (replacement !== undefined && (typeof replacement !== 'string' || !HASH.test(replacement))) throw invalid('Lời mời cần cấp lại không hợp lệ.');
    const tenantId = req.authUid!;
    const token = randomBytes(24).toString('base64url');
    const id = hash(token);
    const ref = db.collection('invites').doc(id);
    const target = pendingTarget(db, tenantId, email);
    const expiresAt = await db.runTransaction(async (tx) => {
      await assertOwnerNow(db, tx, req, true);
      await validateGrants(db, tx, tenantId, access.grants);
      const targetSnap = await tx.get(target);
      const oldId = text(targetSnap.data()?.inviteId);
      const old = HASH.test(oldId) ? await tx.get(db.collection('invites').doc(oldId)) : null;
      const oldData = old?.data();
      const active = !!oldData && oldData.tenantId === tenantId && oldData.email === email && inviteStatus(oldData) === 'pending';
      if (replacement !== undefined && (!active || replacement !== oldId)) throw conflict('Lời mời đã thay đổi. Hãy tải lại danh sách.');
      if (active && replacement === undefined) throw conflict('Email này đã có lời mời đang chờ. Dùng “Cấp lại link” trong danh sách.');
      const existing = await tx.get(db.collection('users').where('tenantId', '==', tenantId).where('email', '==', email));
      if (existing.docs.some((doc) => doc.data().role === 'staff')) throw conflict('Email này đã là thành viên của team. Hãy sửa quyền trong danh sách.');
      const now = Date.now();
      const expiresAt = now + INVITE_DURATION_MS;
      if (active && old) tx.update(old.ref, { status: 'revoked', revokedAt: now });
      tx.create(ref, {
        tenantId, teamName: req.profile!.teamName, email, ...access,
        status: 'active', maxUses: 1, usedCount: 0, createdBy: tenantId, createdAt: now, expiresAt,
      });
      tx.set(target, { inviteId: id });
      return expiresAt;
    });
    ok(res, { id, token, expiresAt }, 'Đã tạo lời mời.', 201);
  }));

  app.delete('/api/team/invites/:id', auth, requireTeamOwner, wrap(async (req, res) => {
    const { id } = req.params;
    if (!HASH.test(id)) throw missing('lời mời');
    const db = adminDb();
    await db.runTransaction(async (tx) => {
      await assertOwnerNow(db, tx, req, false);
      const ref = db.collection('invites').doc(id);
      const data = (await tx.get(ref)).data();
      if (!data || data.tenantId !== req.authUid) throw missing('lời mời');
      if (data.status !== 'active') throw conflict('Lời mời không còn ở trạng thái chờ.');
      tx.update(ref, { status: 'revoked', revokedAt: Date.now() });
    });
    ok(res, { revoked: true }, 'Đã thu hồi lời mời.');
  }));

  app.post('/api/team/invites/preview', wrap(async (req, res) => {
    const token = req.body?.token;
    if (typeof token !== 'string' || !INVITE_TOKEN.test(token)) return fail(res, 410, 'INVITE_INACTIVE', 'Link không hợp lệ hoặc là link cũ. Hãy nhờ chủ team gửi lại.');
    const data = (await adminDb().collection('invites').doc(hash(token)).get()).data();
    if (!data) throw missing('lời mời');
    assertPending(data);
    ok(res, { teamName: data.teamName, expiresAt: data.expiresAt, staffRole: data.staffRole });
  }));

  app.post('/api/team/invites/accept', auth, wrap(async (req, res) => {
    const token = req.body?.token;
    if (typeof token !== 'string' || !INVITE_TOKEN.test(token)) throw invalid('Link mời không hợp lệ.');
    if (req.isVerifiedRoot) return fail(res, 403, 'FORBIDDEN', 'Tài khoản Quản trị viên chính không thể tham gia team với vai trò nhân viên.');
    if (!req.authEmailVerified) return fail(res, 403, 'EMAIL_NOT_VERIFIED', 'Hãy đăng nhập Google bằng email đã được mời.');
    const db = adminDb();
    const ref = db.collection('invites').doc(hash(token));
    const user = db.collection('users').doc(req.authUid!);
    const result = await db.runTransaction(async (tx) => {
      const data = (await tx.get(ref)).data();
      if (!data) throw missing('lời mời');
      assertPending(data);
      if (normalizeInviteEmail(req.authEmail) !== data.email) throw new ApiFault(403, 'EMAIL_MISMATCH', 'Tài khoản đang đăng nhập không khớp email được mời.');
      if (data.tenantId === req.authUid || !FIRESTORE_ID.test(text(data.tenantId))) throw blocked();
      const target = (await tx.get(pendingTarget(db, data.tenantId, data.email))).data();
      if (target?.inviteId !== ref.id) throw conflict('Link này đã được thay thế. Hãy dùng link mới nhất.');
      const access = requestedAccess(data);
      const existing = (await tx.get(user)).data();
      if (existing?.role === 'staff') throw conflict(existing.tenantId === data.tenantId ? 'Bạn đã là thành viên của team này.' : 'Bạn đang thuộc một team khác.');
      const now = Date.now();
      tx.update(ref, { status: 'used', usedCount: 1, usedBy: req.authUid, usedAt: now });
      tx.set(user, {
        uid: req.authUid, email: data.email, displayName: text(existing?.displayName) || req.authName || '',
        role: 'staff', tenantId: data.tenantId, teamName: data.teamName, personalTeamName: text(existing?.teamName) || 'Team của tôi',
        ...access, joinedAt: now, createdAt: number(existing?.createdAt) || now,
      }, { merge: true });
      return { teamName: data.teamName };
    });
    ok(res, result, 'Đã tham gia team.');
  }));

  app.patch('/api/team/members/:uid', auth, requireTeamOwner, wrap(async (req, res) => {
    const { uid } = req.params;
    if (!FIRESTORE_ID.test(uid) || uid === req.authUid || isMasterAdmin(uid)) throw missing('thành viên');
    const access = requestedAccess(req.body ?? {});
    const db = adminDb();
    await db.runTransaction(async (tx) => {
      await assertOwnerNow(db, tx, req, true);
      const ref = db.collection('users').doc(uid);
      const data = (await tx.get(ref)).data();
      if (data?.role !== 'staff' || data.tenantId !== req.authUid) throw missing('thành viên');
      await validateGrants(db, tx, req.authUid!, access.grants);
      tx.update(ref, access);
    });
    ok(res, access, 'Đã cập nhật quyền.');
  }));

  app.delete('/api/team/members/:uid', auth, requireTeamOwner, wrap(async (req, res) => {
    const { uid } = req.params;
    if (!FIRESTORE_ID.test(uid) || uid === req.authUid || isMasterAdmin(uid)) throw missing('thành viên');
    const db = adminDb();
    await db.runTransaction(async (tx) => {
      await assertOwnerNow(db, tx, req, false);
      const ref = db.collection('users').doc(uid);
      const data = (await tx.get(ref)).data();
      if (data?.role !== 'staff' || data.tenantId !== req.authUid) throw missing('thành viên');
      const email = normalizeInviteEmail(data.email);
      if (email) {
        const target = (await tx.get(pendingTarget(db, data.tenantId, email))).data();
        if (HASH.test(text(target?.inviteId))) {
          const invite = await tx.get(db.collection('invites').doc(target!.inviteId));
          const v = invite.data();
          if (v?.status === 'active' && v.tenantId === data.tenantId && v.email === email) tx.update(invite.ref, { status: 'revoked', revokedAt: Date.now() });
        }
      }
      tx.update(ref, { role: 'tenant', tenantId: uid, teamName: text(data.personalTeamName) || 'Team của tôi', staffRole: null, grants: [], joinedAt: 0 });
    });
    ok(res, { revoked: true }, 'Đã thu hồi quyền của thành viên.');
  }));
}

export function staffChannel(id: string, data: DocumentData, profile: StaffAccess & { isReadOnly: boolean }) {
  const level = profile.grants.find((grant) => grant.channelId === id)?.level;
  return {
    id, rowIndex: number(data.rowIndex), channelName: text(data.channelName), channelId: text(data.channelId), niche: text(data.niche), schedule: text(data.schedule),
    capabilities: staffCapabilities(profile.staffRole, level, profile.isReadOnly),
  };
}

/** Resolve a channel and, on writes, re-read membership within the write transaction. */
async function channelAccess(db: Firestore, req: Request, channelId: string, tx?: Transaction) {
  if (!FIRESTORE_ID.test(channelId)) throw missing('kênh');
  const profile = req.profile!;
  const ref = db.collection('channels').doc(channelId);
  const data = (await (tx ? tx.get(ref) : ref.get())).data();
  if (!data || data.tenantId !== profile.tenantId) throw missing('kênh');
  if (profile.role !== 'staff') {
    if (tx) await assertOwnerNow(db, tx, req, true);
    return { ref, capabilities: { editChannel: !profile.isReadOnly, writeDraft: !profile.isReadOnly, manageDrafts: !profile.isReadOnly } };
  }
  let access = parseStoredStaffAccess(profile);
  let isReadOnly = profile.isReadOnly;
  if (tx) {
    const current = (await tx.get(db.collection('users').doc(req.authUid!))).data();
    if (current?.role !== 'staff' || current.tenantId !== profile.tenantId) throw missing('kênh');
    access = parseStoredStaffAccess(current);
    if (!isMasterAdmin(profile.tenantId)) {
      const owner = (await tx.get(db.collection('users').doc(profile.tenantId))).data();
      isReadOnly = owner?.role === 'staff' || number(owner?.expiresAt) <= Date.now();
    }
  }
  const level = access.grants.find((grant) => grant.channelId === channelId)?.level;
  if (!level) throw missing('kênh');
  return { ref, capabilities: staffCapabilities(access.staffRole, level, isReadOnly) };
}

export async function patchStaffChannel(req: Request) {
  const db = adminDb();
  const body = req.body ?? {};
  if (!body || Array.isArray(body) || typeof body !== 'object' || Object.keys(body).some((key) => key !== 'niche' && key !== 'schedule')) throw blocked();
  const patch: Record<string, string | number> = { updatedAt: Date.now() };
  for (const key of ['niche', 'schedule']) {
    if (!(key in body)) continue;
    if (typeof body[key] !== 'string' || body[key].length > 300) throw invalid('Chủ đề hoặc lịch đăng dài quá 300 ký tự.');
    patch[key] = body[key].trim();
  }
  if (Object.keys(patch).length === 1) throw invalid('Chưa có nội dung cần lưu.');
  await db.runTransaction(async (tx) => {
    const { ref, capabilities } = await channelAccess(db, req, req.params.id, tx);
    if (!capabilities.editChannel) throw blocked();
    tx.update(ref, patch);
  });
  return { id: req.params.id, ...patch };
}

function draftContent(body: DocumentData) {
  const title = text(body.title).trim();
  const description = text(body.description).trim();
  if (!title || title.length > 100 || description.length > 5000) throw invalid('Nhập tiêu đề từ 1–100 ký tự và mô tả không quá 5.000 ký tự.');
  return { title, description, updatedAt: Date.now() };
}

export function registerDraftRoutes(app: Express, auth: RequestHandler) {
  const path = '/api/channels/:id/drafts';
  app.get(path, auth, wrap(async (req, res) => {
    const { ref, capabilities } = await channelAccess(adminDb(), req, req.params.id);
    const snapshot = await ref.collection('videoDrafts').orderBy('updatedAt', 'desc').limit(100).get();
    const items = snapshot.docs.map((doc): VideoDraft => {
      const data = doc.data();
      return { id: doc.id, title: text(data.title), description: text(data.description), updatedAt: number(data.updatedAt), canEdit: capabilities.manageDrafts || (capabilities.writeDraft && data.createdBy === req.authUid) };
    });
    ok(res, { items, canCreate: capabilities.writeDraft });
  }));
  app.post(path, auth, wrap(async (req, res) => {
    const db = adminDb();
    const content = draftContent(req.body ?? {});
    const id = await db.runTransaction(async (tx) => {
      const { ref, capabilities } = await channelAccess(db, req, req.params.id, tx);
      if (!capabilities.writeDraft) throw blocked();
      const draft = ref.collection('videoDrafts').doc();
      tx.create(draft, { ...content, createdBy: req.authUid, createdAt: content.updatedAt });
      return draft.id;
    });
    ok(res, { id }, 'Đã lưu bản nháp.', 201);
  }));
  const changeDraft = wrap(async (req, res) => {
    const { draftId } = req.params;
    if (!FIRESTORE_ID.test(draftId)) throw missing('bản nháp');
    const db = adminDb();
    const content = req.method === 'PATCH' ? draftContent(req.body ?? {}) : null;
    await db.runTransaction(async (tx) => {
      const { ref, capabilities } = await channelAccess(db, req, req.params.id, tx);
      if (!capabilities.writeDraft) throw blocked();
      const draft = ref.collection('videoDrafts').doc(draftId);
      const data = (await tx.get(draft)).data();
      if (!data) throw missing('bản nháp');
      if (!capabilities.manageDrafts && data.createdBy !== req.authUid) throw blocked();
      if (content) tx.update(draft, content);
      else tx.delete(draft);
    });
    ok(res, { id: draftId });
  });
  app.patch(`${path}/:draftId`, auth, changeDraft);
  app.delete(`${path}/:draftId`, auth, changeDraft);
}
