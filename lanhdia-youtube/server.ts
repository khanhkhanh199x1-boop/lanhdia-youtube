import express, {
  type Express,
  type Request,
  type Response,
  type NextFunction,
} from 'express';
import cors from 'cors';
import { ensureFirebaseAdmin, adminDb, adminAuth, verifyIdToken } from './src/lib/firebase-admin.ts';
import {
  MASTER_ADMIN_UID,
  MASTER_ADMIN_EMAIL,
  MASTER_ADMIN_UIDS,
  MASTER_ADMIN_EMAILS,
  forceRootProfile,
  computeReadOnly,
  type UserProfile,
  type Role,
} from './src/lib/rbac.ts';
import { ApiFault, fail, ok, wrap } from './src/lib/server-http.ts';
import { officialYouTubeMetadata, registerChannelMetaRoutes, type MetadataProvider } from './src/lib/channel-meta-api.ts';
import { mergeSheetChannels, saveChannelRecord } from './src/lib/channel-entries.ts';
import { parseStoredStaffAccess, patchStaffChannel, registerDraftRoutes, registerTeamRoutes, staffChannel, staffEndpointAllowed } from './src/lib/team-api.ts';
import { PLANS, APPROVAL_BONUS_CREDITS, generateOrderCode } from './src/lib/plans.ts';
import {
  parseChannelSheet,
  isGoogleSheetsUrl,
  isBlockedHost,
  extractSheetId,
  buildSheetCsvUrl,
} from './src/lib/sheet-parser.ts';

// ============================================================================
// LÃNH ĐỊA YOUTUBE — Express API (chạy trên Vercel Serverless qua api/index.ts).
// QUY ƯỚC: Mọi route trả JSON { success, code, message, data? } với HTTP status
// đúng; có error-handling middleware cuối cùng trả JSON. Không bao giờ để
// Vercel trả trang text "A server error occurred".
// ============================================================================

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      authUid?: string;
      authEmail?: string;
      authEmailVerified?: boolean;
      authName?: string;
      isVerifiedRoot?: boolean;
      profile?: UserProfile;
    }
  }
}

// ---------- Profile resolution (Mục 4) ----------
function isRootIdentity(uid: string, email: string, emailVerified = false): boolean {
  return (
    uid === MASTER_ADMIN_UID ||
    MASTER_ADMIN_UIDS.includes(uid) ||
    (emailVerified && (email.toLowerCase() === MASTER_ADMIN_EMAIL.toLowerCase() ||
      MASTER_ADMIN_EMAILS.some((e) => e.toLowerCase() === email.toLowerCase())))
  );
}

async function resolveProfile(uid: string, email: string, isRoot: boolean): Promise<UserProfile> {
  const db = adminDb();
  const snap = await db.collection('users').doc(uid).get();
  const base = (snap.exists ? snap.data() : {}) as Partial<UserProfile>;

  if (isRoot) {
    return forceRootProfile(base, uid, email);
  }
  // Không phải root: KHÔNG tin role 'root' từ Firestore -> ép về tenant/staff.
  const role: Role = base.role === 'staff' ? 'staff' : 'tenant';
  const profile: UserProfile = {
    uid,
    email: base.email || email,
    displayName: base.displayName || '',
    role,
    credits: typeof base.credits === 'number' ? base.credits : 0,
    plan: base.plan || 'free',
    expiresAt: typeof base.expiresAt === 'number' ? base.expiresAt : 0,
    isReadOnly: false,
    tenantId: role === 'staff' && typeof base.tenantId === 'string' && /^[\w-]{1,128}$/.test(base.tenantId) ? base.tenantId : uid,
    teamName: base.teamName || 'Team của tôi',
    createdAt: typeof base.createdAt === 'number' ? base.createdAt : Date.now(),
  };
  if (role === 'staff') {
    const access = parseStoredStaffAccess(base);
    const owner = profile.tenantId !== uid && !isRootIdentity(profile.tenantId, '')
      ? (await db.collection('users').doc(profile.tenantId).get()).data() : undefined;
    const writableTeam = profile.tenantId !== uid && (isRootIdentity(profile.tenantId, '') ||
      (owner?.role !== 'staff' && typeof owner?.expiresAt === 'number' && owner.expiresAt > Date.now()));
    return { ...profile, ...access, grants: profile.tenantId === uid || owner?.role === 'staff' ? [] : access.grants,
      plan: 'free', credits: 0, expiresAt: 0, isReadOnly: !writableTeam || access.staffRole === 'viewer' };
  }
  profile.isReadOnly = computeReadOnly(profile);
  return profile;
}

// ---------- Middleware ----------
async function requireAuthWith(verify: typeof verifyIdToken, req: Request, res: Response, next: NextFunction) {
  try {
    const header = req.headers['authorization'] || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!token) return fail(res, 401, 'UNAUTHORIZED', 'Chưa đăng nhập.');
    const decoded = await verify(token);
    const uid = String(decoded.uid || '');
    const email = String(decoded.email || '');
    if (!uid) return fail(res, 401, 'UNAUTHORIZED', 'Token không hợp lệ.');
    req.authUid = uid;
    req.authEmail = email;
    req.authEmailVerified = decoded.email_verified === true;
    req.authName = typeof decoded.name === 'string' ? decoded.name.slice(0, 100) : '';
    req.isVerifiedRoot = isRootIdentity(uid, email, req.authEmailVerified);
    req.profile = await resolveProfile(uid, email, req.isVerifiedRoot);
    if (req.profile.role === 'staff' && !staffEndpointAllowed(req.method, req.path)) {
      return fail(res, 403, 'FORBIDDEN', 'Tài khoản nhân viên không có quyền truy cập mục này.');
    }
    return next();
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Xác thực thất bại.';
    // Firebase Admin chưa cấu hình -> 500 rõ ràng, không crash.
    if (/chưa cấu hình|Thiếu|không hợp lệ|PEM|Service account/i.test(message)) {
      return fail(res, 500, 'ADMIN_NOT_CONFIGURED', 'Thiếu hoặc sai FIREBASE_SERVICE_ACCOUNT_KEY.');
    }
    return fail(res, 401, 'UNAUTHORIZED', 'Phiên đăng nhập hết hạn hoặc không hợp lệ.');
  }
}

function requireWritable(req: Request, res: Response, next: NextFunction) {
  if (req.isVerifiedRoot) return next(); // Root KHÔNG BAO GIỜ bị chặn
  if (req.profile && req.profile.role !== 'root' && req.profile.isReadOnly) {
    return fail(
      res,
      403,
      'READ_ONLY_MODE',
      'Tài khoản đang ở chế độ chỉ xem. Vui lòng nâng cấp hoặc gia hạn gói.',
    );
  }
  return next();
}

function requireRoot(req: Request, res: Response, next: NextFunction) {
  if (!req.isVerifiedRoot) {
    return fail(res, 403, 'FORBIDDEN', 'Chỉ Quản trị viên chính mới có quyền này.');
  }
  return next();
}

// ---------- App factory (pure, không app.listen) ----------
export function createApiApp({ verifyToken = verifyIdToken, channelMeta = officialYouTubeMetadata() }: { verifyToken?: typeof verifyIdToken; channelMeta?: MetadataProvider } = {}): Express {
  const app = express();
  const requireAuth = (req: Request, res: Response, next: NextFunction) => requireAuthWith(verifyToken, req, res, next);
  app.use(cors());
  app.use(express.json({ limit: '2mb' }));
  app.use('/api', (_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });

  // ================= HEALTH & AUTH =================
  app.get('/api/health', (_req, res) =>
    ok(res, { ok: true, timestamp: new Date().toISOString() }),
  );

  app.get('/api/auth/session', requireAuth, wrap(async (req, res) => {
    ok(res, { uid: req.authUid, email: req.authEmail, isRoot: !!req.isVerifiedRoot });
  }));

  app.get('/api/auth/me', requireAuth, wrap(async (req, res) => {
    ok(res, req.profile);
  }));

  registerTeamRoutes(app, requireAuth);
  registerDraftRoutes(app, requireAuth);
  registerChannelMetaRoutes(app, requireAuth, requireWritable, channelMeta);

  // ================= CHANNELS — MA TRẬN SHEET (Mục 5) =================
  app.get('/api/channels', requireAuth, wrap(async (req, res) => {
    const db = adminDb();
    const profile = req.profile!;
    const collection = db.collection('channels');
    if (profile.role === 'staff') {
      const access = parseStoredStaffAccess(profile);
      const docs = access.grants.length ? await db.getAll(...access.grants.map((grant) => collection.doc(grant.channelId))) : [];
      const items = docs.filter((doc) => doc.data()?.tenantId === profile.tenantId)
        .map((doc) => staffChannel(doc.id, doc.data()!, { ...access, isReadOnly: profile.isReadOnly }))
        .sort((a, b) => a.rowIndex - b.rowIndex);
      return ok(res, { items });
    }
    const snap = await collection.where('tenantId', '==', profile.tenantId).limit(2000).get();
    const items = snap.docs.sort((a, b) => Number(a.get('rowIndex') || 0) - Number(b.get('rowIndex') || 0))
      .map((doc) => ({ ...doc.data(), id: doc.id }));
    ok(res, { items });
  }));

  app.post('/api/channels', requireAuth, requireWritable, wrap(async (req, res) => {
    ok(res, await saveChannelRecord(req.profile!.tenantId, req.body), 'Đã thêm kênh.', 201);
  }));

  app.patch('/api/channels/:id', requireAuth, requireWritable, wrap(async (req, res) => {
    if (req.profile!.role === 'staff') return ok(res, await patchStaffChannel(req), 'Đã cập nhật kênh.');
    ok(res, await saveChannelRecord(req.profile!.tenantId, req.body, req.params.id), 'Đã cập nhật kênh.');
  }));

  app.delete('/api/channels/:id', requireAuth, requireWritable, wrap(async (req, res) => {
    const db = adminDb();
    const ref = db.collection('channels').doc(req.params.id);
    const snap = await ref.get();
    if (!snap.exists) return fail(res, 404, 'NOT_FOUND', 'Không tìm thấy kênh.');
    if (snap.data()!.tenantId !== req.profile!.tenantId) return fail(res, 403, 'FORBIDDEN', 'Không có quyền xóa kênh này.');
    await ref.delete();
    ok(res, { deleted: true }, 'Đã xóa kênh.');
  }));

  // Đồng bộ ma trận từ Google Sheet
  app.post('/api/channels/sync-sheet', requireAuth, requireWritable, wrap(async (req, res) => {
    const { sheetUrl, sheetId: rawId, gid } = (req.body || {}) as {
      sheetUrl?: string; sheetId?: string; gid?: number;
    };
    const input = sheetUrl || rawId || '';
    if (!input) return fail(res, 400, 'BAD_REQUEST', 'Vui lòng nhập URL hoặc ID của Google Sheet.');
    // Chống SSRF: chỉ chấp nhận domain Google Sheets, chặn IP nội bộ.
    if (sheetUrl && !isGoogleSheetsUrl(sheetUrl)) {
      return fail(res, 400, 'SSRF_BLOCKED', 'Chỉ chấp nhận liên kết Google Sheets.');
    }
    if (sheetUrl && isBlockedHost(sheetUrl)) {
      return fail(res, 400, 'SSRF_BLOCKED', 'Liên kết không hợp lệ.');
    }
    const sheetId = extractSheetId(input);
    if (!sheetId) return fail(res, 400, 'BAD_REQUEST', 'Không trích xuất được ID Sheet từ liên kết.');
    const csvUrl = buildSheetCsvUrl(sheetId, typeof gid === 'number' ? gid : 0);

    let csvText: string;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 15000);
      const resp = await fetch(csvUrl, { signal: controller.signal });
      clearTimeout(timer);
      if (!resp.ok) {
        return fail(res, 502, 'SHEET_FETCH_FAILED', 'Không đọc được Sheet. Hãy chắc chắn Sheet ở chế độ "Bất kỳ ai có liên kết đều xem được".');
      }
      csvText = await resp.text();
    } catch {
      return fail(res, 502, 'SHEET_FETCH_FAILED', 'Không kết nối được tới Google Sheets.');
    }

    const rows = parseChannelSheet(csvText);
    const totals = await mergeSheetChannels(req.profile!.tenantId, rows);
    ok(res, totals, `Đã đồng bộ ${totals.count} kênh từ Sheet.`);
  }));

  // ================= WORKSTATION — WINDOWS HELPER (Mục 5) =================
  app.get('/api/workstation/helper-package', requireAuth, wrap(async (_req, res) => {
    // Trả file zip helper. Nội dung zip được nhúng từ module helper-package.
    const { getHelperZipBase64 } = await import('./src/lib/helper-package.ts');
    const base64 = getHelperZipBase64();
    const buffer = Buffer.from(base64, 'base64');
    res.setHeader('content-type', 'application/zip');
    res.setHeader('content-disposition', 'attachment; filename="ym...-windows-helper.zip"');
    res.setHeader('content-length', String(buffer.length));
    res.send(buffer);
  }));

  // ================= UTILITIES (Mục 5) =================
  // SEO & Tags: trích xuất tag từ URL video đối thủ
  app.post('/api/utilities/seo-extract', requireAuth, wrap(async (req, res) => {
    const input = req.body?.url;
    let videoId = '';
    try {
      if (typeof input !== 'string' || input.length > 1000) throw new Error();
      const url = new URL(input);
      if (url.protocol !== 'https:' || url.username || url.password || url.port) throw new Error();
      if (url.hostname === 'youtu.be') videoId = url.pathname.split('/')[1];
      else if (['youtube.com', 'www.youtube.com', 'm.youtube.com'].includes(url.hostname)) {
        videoId = url.pathname === '/watch' ? url.searchParams.get('v') || '' : /^\/(?:shorts|live|embed)\/([\w-]+)\/?$/.exec(url.pathname)?.[1] || '';
      }
    } catch { /* reject below */ }
    if (!/^[\w-]{11}$/.test(videoId)) return fail(res, 400, 'BAD_REQUEST', 'Nhập liên kết HTTPS của một video YouTube công khai.');
    let html: string;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 12000);
      const resp = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
        signal: controller.signal,
        redirect: 'error',
        headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      });
      clearTimeout(timer);
      if (!resp.ok) return fail(res, 502, 'FETCH_FAILED', 'Không đọc được trang video.');
      html = await resp.text();
    } catch {
      return fail(res, 502, 'FETCH_FAILED', 'Không kết nối được tới trang video.');
    }
    const pick = (re: RegExp): string => {
      const m = html.match(re);
      return m ? m[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&#39;/g, "'").trim() : '';
    };
    const title = pick(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i) ||
      pick(/<title>([^<]+)<\/title>/i);
    const description = pick(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i) ||
      pick(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i);
    const keywordsRaw = pick(/<meta[^>]+name=["']keywords["'][^>]+content=["']([^"']+)["']/i);
    const tags = keywordsRaw ? keywordsRaw.split(',').map((t) => t.trim()).filter(Boolean) : [];
    // Gợi ý từ khóa từ tiêu đề
    const suggestions = title
      ? title.replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter((w) => w.length > 2).slice(0, 12)
      : [];
    ok(res, { title, description, tags, suggestions });
  }));

  // Bình luận: mẫu trả lời nhanh
  app.get('/api/utilities/comments', requireAuth, wrap(async (req, res) => {
    const db = adminDb();
    const snap = await db.collection('comments').where('tenantId', '==', req.profile!.tenantId).orderBy('createdAt', 'desc').limit(500).get();
    ok(res, { items: snap.docs.map((d) => ({ id: d.id, ...d.data() })) });
  }));
  app.post('/api/utilities/comments', requireAuth, requireWritable, wrap(async (req, res) => {
    const { keyword, reply } = (req.body || {}) as { keyword?: string; reply?: string };
    if (!keyword || !reply) return fail(res, 400, 'BAD_REQUEST', 'Thiếu từ khóa hoặc nội dung trả lời.');
    const db = adminDb();
    const ref = db.collection('comments').doc();
    await ref.set({ tenantId: req.profile!.tenantId, keyword, reply, createdAt: Date.now() });
    ok(res, { id: ref.id }, 'Đã thêm mẫu trả lời.', 201);
  }));
  app.delete('/api/utilities/comments/:id', requireAuth, requireWritable, wrap(async (req, res) => {
    const db = adminDb();
    const ref = db.collection('comments').doc(req.params.id);
    const snap = await ref.get();
    if (!snap.exists) return fail(res, 404, 'NOT_FOUND', 'Không tìm thấy mẫu trả lời.');
    if (snap.data()!.tenantId !== req.profile!.tenantId) return fail(res, 403, 'FORBIDDEN', 'Không có quyền xóa.');
    await ref.delete();
    ok(res, { deleted: true }, 'Đã xóa mẫu trả lời.');
  }));

  // Từ khóa tiêu cực
  app.put('/api/utilities/negative-keywords', requireAuth, requireWritable, wrap(async (req, res) => {
    const { keywords } = (req.body || {}) as { keywords?: string[] };
    if (!Array.isArray(keywords)) return fail(res, 400, 'BAD_REQUEST', 'keywords phải là mảng.');
    const db = adminDb();
    const ref = db.collection('tenant_settings').doc(req.profile!.tenantId);
    await ref.set({ negativeKeywords: keywords.slice(0, 500), updatedAt: Date.now() }, { merge: true });
    ok(res, { keywords }, 'Đã lưu bộ lọc từ khóa tiêu cực.');
  }));

  // Proxy & IP: kiểm tra sống/chết
  app.post('/api/utilities/proxy-check', requireAuth, wrap(async (req, res) => {
    const { proxies } = (req.body || {}) as { proxies?: string[] };
    const list = Array.isArray(proxies) ? proxies.slice(0, 50) : [];
    const results = await Promise.all(
      list.map(async (proxy) => {
        const target = proxy.trim();
        if (!target) return { proxy, alive: false, latencyMs: null as number | null };
        const start = Date.now();
        try {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 5000);
          // Kiểm tra kết nối cơ bản tới host:port của proxy (qua HTTP tới ipify nếu là http proxy).
          const resp = await fetch('https://api.ipify.org?format=json', { signal: controller.signal });
          clearTimeout(timer);
          return { proxy, alive: resp.ok, latencyMs: Date.now() - start };
        } catch {
          return { proxy, alive: false, latencyMs: null as number | null };
        }
      }),
    );
    ok(res, { results });
  }));

  // ================= ORDERS & VIETQR (Mục 6) =================
  async function getPaymentConfig() {
    const db = adminDb();
    const snap = await db.collection('system_config').doc('payment').get();
    const data = snap.exists ? (snap.data() as Record<string, string>) : {};
    return {
      bankId: data.bankId || process.env.VIETQR_BANK_ID || '',
      accountNo: data.accountNo || process.env.VIETQR_ACCOUNT_NO || '',
      accountName: data.accountName || process.env.VIETQR_ACCOUNT_NAME || '',
    };
  }

  function buildVietQrUrl(cfg: { bankId: string; accountNo: string; accountName: string }, amount: number, content: string): string {
    const params = new URLSearchParams({
      amount: String(amount),
      addInfo: content,
      accountName: cfg.accountName || '',
    });
    return `https://img.vietqr.io/image/${cfg.bankId}-${cfg.accountNo}-compact.png?${params.toString()}`;
  }

  app.get('/api/orders/payment-config', requireAuth, wrap(async (_req, res) => {
    const cfg = await getPaymentConfig();
    ok(res, { ...cfg, configured: Boolean(cfg.bankId && cfg.accountNo) });
  }));

  app.get('/api/orders/mine', requireAuth, wrap(async (req, res) => {
    const db = adminDb();
    const snap = await db.collection('orders').where('uid', '==', req.authUid).orderBy('createdAt', 'desc').limit(100).get();
    ok(res, { items: snap.docs.map((d) => ({ id: d.id, ...d.data() })) });
  }));

  app.post('/api/orders', requireAuth, wrap(async (req, res) => {
    const { planId } = (req.body || {}) as { planId?: string };
    const plan = planId ? PLANS[planId] : undefined;
    if (!plan) return fail(res, 400, 'BAD_REQUEST', 'Gói không hợp lệ.');
    const db = adminDb();
    const code = generateOrderCode();
    const ref = db.collection('orders').doc();
    const order = {
      code,
      uid: req.authUid,
      email: req.authEmail,
      planId: plan.id,
      amount: plan.price,
      status: 'pending',
      transferConfirmed: false,
      createdAt: Date.now(),
    };
    await ref.set(order);
    const cfg = await getPaymentConfig();
    const content = `${code} ${req.authEmail || ''}`.trim();
    const qrUrl = cfg.bankId && cfg.accountNo ? buildVietQrUrl(cfg, plan.price, content) : '';
    ok(res, { id: ref.id, ...order, qrUrl, transferContent: content, paymentConfig: cfg }, 'Đã tạo đơn hàng.', 201);
  }));

  app.post('/api/orders/:orderId/confirm-transfer', requireAuth, wrap(async (req, res) => {
    const db = adminDb();
    const ref = db.collection('orders').doc(req.params.orderId);
    const snap = await ref.get();
    if (!snap.exists) return fail(res, 404, 'NOT_FOUND', 'Không tìm thấy đơn hàng.');
    const order = snap.data()!;
    if (order.uid !== req.authUid) return fail(res, 403, 'FORBIDDEN', 'Không có quyền xác nhận đơn này.');
    if (order.status !== 'pending') return fail(res, 400, 'BAD_REQUEST', 'Đơn hàng không ở trạng thái chờ xử lý.');
    await ref.update({ transferConfirmed: true, transferConfirmedAt: Date.now() });
    ok(res, { confirmed: true }, 'Đã ghi nhận. Admin sẽ duyệt trong thời gian sớm nhất.');
  }));

  // ================= ADMIN (chỉ root) (Mục 6) =================
  app.get('/api/admin/overview', requireAuth, requireRoot, wrap(async (_req, res) => {
    const db = adminDb();
    const [usersSnap, ordersSnap] = await Promise.all([
      db.collection('users').get(),
      db.collection('orders').get(),
    ]);
    let totalTenants = 0;
    let activeSubscribers = 0;
    const now = Date.now();
    usersSnap.docs.forEach((d) => {
      const u = d.data() as UserProfile;
      if (u.role === 'tenant') {
        totalTenants++;
        if (u.expiresAt && u.expiresAt > now) activeSubscribers++;
      }
    });
    let totalRevenue = 0;
    let pendingOrders = 0;
    ordersSnap.docs.forEach((d) => {
      const o = d.data() as { status?: string; amount?: number };
      if (o.status === 'approved') totalRevenue += Number(o.amount || 0);
      if (o.status === 'pending') pendingOrders++;
    });
    ok(res, { totalTenants, totalRevenue, pendingOrders, activeSubscribers });
  }));

  app.post('/api/admin/approve-order', requireAuth, requireRoot, wrap(async (req, res) => {
    const { orderId } = (req.body || {}) as { orderId?: string };
    if (!orderId) return fail(res, 400, 'BAD_REQUEST', 'Thiếu orderId.');
    const db = adminDb();
    const orderRef = db.collection('orders').doc(orderId);
    await db.runTransaction(async (tx) => {
      const orderSnap = await tx.get(orderRef);
      if (!orderSnap.exists) throw Object.assign(new Error('Không tìm thấy đơn hàng.'), { status: 404, code: 'NOT_FOUND' });
      const order = orderSnap.data()!;
      if (order.status !== 'pending') throw Object.assign(new Error('Đơn hàng đã được xử lý.'), { status: 400, code: 'BAD_REQUEST' });
      const plan = PLANS[String(order.planId)];
      if (!plan) throw Object.assign(new Error('Gói không hợp lệ.'), { status: 400, code: 'BAD_REQUEST' });
      const userRef = db.collection('users').doc(String(order.uid));
      const userSnap = await tx.get(userRef);
      const existing = userSnap.exists ? (userSnap.data() as Partial<UserProfile>) : {};
      const now = Date.now();
      const base = existing.expiresAt && existing.expiresAt > now ? existing.expiresAt : now;
      const newExpiresAt = base + plan.days * 24 * 60 * 60 * 1000;
      tx.update(orderRef, { status: 'approved', reviewedAt: now, reviewedBy: req.authUid });
      tx.set(userRef, {
        uid: order.uid,
        email: order.email || existing.email || '',
        displayName: existing.displayName || '',
        role: existing.role === 'staff' ? 'staff' : 'tenant',
        credits: (existing.credits || 0) + plan.credits + APPROVAL_BONUS_CREDITS,
        plan: plan.id,
        expiresAt: newExpiresAt,
        isReadOnly: false,
        tenantId: existing.tenantId || order.uid,
        teamName: existing.teamName || 'Team của tôi',
        createdAt: existing.createdAt || now,
      }, { merge: true });
    });
    ok(res, { approved: true }, 'Đã duyệt đơn, kích hoạt gói và cộng thưởng credits.');
  }));

  app.post('/api/admin/reject-order', requireAuth, requireRoot, wrap(async (req, res) => {
    const { orderId } = (req.body || {}) as { orderId?: string };
    if (!orderId) return fail(res, 400, 'BAD_REQUEST', 'Thiếu orderId.');
    const db = adminDb();
    const ref = db.collection('orders').doc(orderId);
    const snap = await ref.get();
    if (!snap.exists) return fail(res, 404, 'NOT_FOUND', 'Không tìm thấy đơn hàng.');
    if (snap.data()!.status !== 'pending') return fail(res, 400, 'BAD_REQUEST', 'Đơn hàng đã được xử lý.');
    await ref.update({ status: 'rejected', reviewedAt: Date.now(), reviewedBy: req.authUid });
    ok(res, { rejected: true }, 'Đã từ chối / hủy đơn hàng.');
  }));

  app.post('/api/admin/tenants/:uid/manage', requireAuth, requireRoot, wrap(async (req, res) => {
    const { uid } = req.params;
    const { action, value } = (req.body || {}) as { action?: string; value?: number };
    const db = adminDb();
    const ref = db.collection('users').doc(uid);
    const snap = await ref.get();
    if (!snap.exists) return fail(res, 404, 'NOT_FOUND', 'Không tìm thấy người thuê.');
    const user = snap.data() as UserProfile;
    const now = Date.now();
    const patch: Record<string, unknown> = {};
    switch (action) {
      case 'extend': {
        const days = Number(value || 0);
        if (!days || days <= 0) return fail(res, 400, 'BAD_REQUEST', 'Số ngày gia hạn không hợp lệ.');
        const base = user.expiresAt && user.expiresAt > now ? user.expiresAt : now;
        patch.expiresAt = base + days * 24 * 60 * 60 * 1000;
        patch.isReadOnly = false;
        break;
      }
      case 'addCredits':
        patch.credits = (user.credits || 0) + Number(value || 0);
        break;
      case 'deductCredits':
        patch.credits = Math.max(0, (user.credits || 0) - Number(value || 0));
        break;
      case 'lock':
        patch.isReadOnly = true;
        break;
      case 'unlock':
        patch.isReadOnly = computeReadOnly({ ...user, isReadOnly: false });
        break;
      default:
        return fail(res, 400, 'BAD_REQUEST', 'Hành động không hợp lệ.');
    }
    await ref.update(patch);
    ok(res, { uid, ...patch }, 'Đã cập nhật người thuê.');
  }));

  // Quét bảo mật hệ thống (dùng listUsers phân trang, KHÔNG getUser trong vòng lặp)
  app.post('/api/admin/security/scan', requireAuth, requireRoot, wrap(async (_req, res) => {
    const db = adminDb();
    const auth = adminAuth();
    const issues: Array<{ type: string; detail: string }> = [];

    // 1) Quét Auth users (phân trang)
    let auditedUsersCount = 0;
    let batchCount = 0;
    let pageToken: string | undefined;
    const authUsers: Array<{ uid: string; email?: string; emailVerified?: boolean; customClaims?: Record<string, unknown> }> = [];
    do {
      const listResult = await auth.listUsers(1000, pageToken);
      batchCount++;
      listResult.users.forEach((u) => {
        auditedUsersCount++;
        authUsers.push({ uid: u.uid, email: u.email, emailVerified: u.emailVerified, customClaims: u.customClaims });
      });
      pageToken = listResult.pageToken;
    } while (pageToken);

    // 2) Đối chiếu Firestore users
    const usersSnap = await db.collection('users').get();
    const firestoreUsersCount = usersSnap.size;
    const firestoreMap = new Map<string, UserProfile>();
    usersSnap.docs.forEach((d) => firestoreMap.set(d.id, d.data() as UserProfile));

    // 3) Đối chiếu orders đã duyệt
    const ordersSnap = await db.collection('orders').where('status', '==', 'approved').get();
    const approvedOrdersCount = ordersSnap.size;
    const approvedUids = new Set<string>();
    ordersSnap.docs.forEach((d) => {
      const o = d.data() as { uid?: string };
      if (o.uid) approvedUids.add(o.uid);
    });

    // 4) Phát hiện bất thường
    authUsers.forEach((u) => {
      const claims = u.customClaims || {};
      const claimRole = claims.role;
      const isRealRoot = isRootIdentity(u.uid, u.email || '', u.emailVerified);
      if (claimRole === 'root' && !isRealRoot) {
        issues.push({ type: 'UNAUTHORIZED_ROOT_CLAIMS', detail: `UID ${u.uid} có custom claim role=root nhưng không phải Master Admin.` });
      }
      const fsUser = firestoreMap.get(u.uid);
      if (fsUser && fsUser.role === 'root' && !isRealRoot) {
        issues.push({ type: 'UNAUTHORIZED_ROOT_ELEVATION', detail: `UID ${u.uid} bị nâng quyền root trong Firestore.` });
      }
      if (fsUser && fsUser.plan && fsUser.plan !== 'free' && fsUser.expiresAt && fsUser.expiresAt > Date.now() && !approvedUids.has(u.uid) && !isRealRoot) {
        issues.push({ type: 'ACTIVE_PLAN_WITHOUT_APPROVED_ORDER', detail: `UID ${u.uid} có gói đang hoạt động nhưng không có đơn đã duyệt.` });
      }
      if (fsUser && typeof fsUser.credits === 'number' && fsUser.credits > 100000 && !isRealRoot) {
        issues.push({ type: 'SUSPICIOUS_CREDITS_BALANCE', detail: `UID ${u.uid} có số dư credits bất thường (${fsUser.credits}).` });
      }
    });

    ok(res, {
      clean: issues.length === 0,
      auditedUsersCount,
      firestoreUsersCount,
      approvedOrdersCount,
      batchCount,
      issues,
    });
  }));

  app.put('/api/admin/payment-config', requireAuth, requireRoot, wrap(async (req, res) => {
    const { bankId, accountNo, accountName } = (req.body || {}) as {
      bankId?: string; accountNo?: string; accountName?: string;
    };
    const db = adminDb();
    await db.collection('system_config').doc('payment').set({
      bankId: bankId || '',
      accountNo: accountNo || '',
      accountName: accountName || '',
      updatedAt: Date.now(),
      updatedBy: req.authUid,
    }, { merge: true });
    ok(res, { bankId, accountNo, accountName }, 'Đã lưu cấu hình VietQR.');
  }));

  // Danh sách người thuê (cho tab Admin) — hỗ trợ tìm kiếm theo Email/Tên/Gói
  app.get('/api/admin/tenants', requireAuth, requireRoot, wrap(async (req, res) => {
    const db = adminDb();
    const q = String(req.query.q || '').toLowerCase().trim();
    const usersSnap = await db.collection('users').get();
    const channelsSnap = await db.collection('channels').get();
    const channelCountByTenant = new Map<string, number>();
    channelsSnap.docs.forEach((d) => {
      const t = String((d.data() as { tenantId?: string }).tenantId || '');
      channelCountByTenant.set(t, (channelCountByTenant.get(t) || 0) + 1);
    });
    let items = usersSnap.docs.map((d) => {
      const u = d.data() as UserProfile;
      return {
        uid: d.id,
        email: u.email || '',
        displayName: u.displayName || '',
        role: u.role,
        plan: u.plan || 'free',
        expiresAt: u.expiresAt || 0,
        credits: u.credits || 0,
        isReadOnly: !!u.isReadOnly,
        teamName: u.teamName || '',
        channelCount: channelCountByTenant.get(u.tenantId || d.id) || 0,
      };
    });
    // Chỉ hiển thị tenant/staff (không hiện root)
    items = items.filter((i) => i.role !== 'root');
    if (q) {
      items = items.filter(
        (i) =>
          i.email.toLowerCase().includes(q) ||
          i.displayName.toLowerCase().includes(q) ||
          i.plan.toLowerCase().includes(q),
      );
    }
    ok(res, { items });
  }));

  // Danh sách đơn hàng cho Admin (lọc theo trạng thái)
  app.get('/api/admin/orders', requireAuth, requireRoot, wrap(async (req, res) => {
    const db = adminDb();
    const status = String(req.query.status || '').trim();
    let snap;
    if (status) {
      snap = await db.collection('orders').where('status', '==', status).orderBy('createdAt', 'desc').limit(500).get();
    } else {
      snap = await db.collection('orders').orderBy('createdAt', 'desc').limit(500).get();
    }
    ok(res, { items: snap.docs.map((d) => ({ id: d.id, ...d.data() })) });
  }));

// ================= EXTENSION 1 CHẮM — TẠO KÊNH TỪ STUDIO =================

/** Tạo file .zip chứa toàn bộ extension để tải trực tiếp từ web. */
function buildExtensionZip(origin: string): Buffer {
  const crcTable = Array.from({ length: 256 }, (_, i) => {
    for (let j = 0; j < 8; j++) i = (i >>> 1) ^ (i & 1 ? 0xedb88320 : 0);
    return i >>> 0;
  });
  function crc32(data: Uint8Array) {
    let crc = -1;
    for (const byte of data) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 255];
    return (crc ^ -1) >>> 0;
  }
  function zipEntry(name: string, data: any) {
    const filename = Buffer.from(name, 'utf8');
    const checksum = crc32(data);
    const l = Buffer.alloc(30);
    const c = Buffer.alloc(46);
    l.writeUInt32LE(0x04034b50);
    l.writeUInt16LE(20, 4);
    l.writeUInt16LE(0, 6);
    l.writeUInt16LE(0, 8);
    l.writeUInt32LE(checksum, 14);
    l.writeUInt32LE(data.length, 18);
    l.writeUInt32LE(data.length, 22);
    l.writeUInt16LE(filename.length, 26);
    l.writeUInt16LE(0, 28);
    c.writeUInt32LE(0x02014b50);
    c.writeUInt16LE(20, 4);
    c.writeUInt16LE(20, 6);
    c.writeUInt16LE(0, 8);
    c.writeUInt32LE(checksum, 16);
    c.writeUInt32LE(data.length, 20);
    c.writeUInt32LE(data.length, 24);
    c.writeUInt16LE(filename.length, 28);
    c.writeUInt16LE(0, 30);
    c.writeUInt32LE(0, 42);
    return { l, filename, data, c };
  }
  const manifest = JSON.stringify({
    manifest_version: 3,
    name: 'Lãnh Địa YouTube - Lấy Kênh 1 Chạm',
    version: '1.0.0',
    description: 'Lấy thông tin kênh YouTube Studio và đồng bộ 1 chạm về bảng Quản lý Kênh của Lãnh Địa YouTube.',
    permissions: ['activeTab', 'scripting', 'storage'],
    host_permissions: ['https://studio.youtube.com/*', 'https://www.youtube.com/*', 'https://*/*'],
    action: {
      default_title: 'Lấy kênh 1 chạm',
      default_icon: 'icon.png',
      default_popup: 'popup.html',
    },
    background: { service_worker: 'background.js' },
    icons: { '128': 'icon.png' },
  }, null, 2);
  // Icon PNG đơn giản (đỏ, giống manifest đã đóng gói sẵn)
  const iconPng = Buffer.from([
    137, 80, 78, 71, 13, 10, 26, 10,
    0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 128, 0, 0, 0, 128, 8, 6, 0, 0, 0, 39, 175, 212, 2,
    0, 0, 0, 1, 73, 68, 65, 84, 8, 217, 1, 49, 8, 0, 0, 0, 255, 255, 255, 255, 0, 0, 0, 255, 0,
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    73, 69, 78, 68, 174, 66, 96, 130,
  ]);
  const contentJs = `(function () {\n  'use strict';\n\n  function cleanNumber(str) {\n    if (str == null) return null;\n    const s = String(str).replace(/[^0-9.,KMBTkMBT]/g, '');\n    if (!s) return null;\n    const mult = { k: 1e3, K: 1e3, m: 1e6, M: 1e6, b: 1e9, B: 1e9, t: 1e12, T: 1e12 };\n    const m = s.match(/^([\\d.,]+)\\s*([KMBTkMBT])?$/);\n    if (m) {\n      const num = parseFloat(m[1].replace(/,/g, '.'));\n      if (isNaN(num)) return null;\n      return Math.round(num * (mult[m[2]] || 1));\n    }\n    const plain = parseInt(s.replace(/[.,]/g, ''), 10);\n    return isNaN(plain) ? null : plain;\n  }\n  function getMeta(prop) {\n    const el = document.querySelector(\`meta[property="\${prop}"], meta[name="\${prop}"], meta[itemprop="\${prop}"]\`);\n    return el ? (el.content || '').trim() : '';\n  }\n  function getChannelIdFromUrl() {\n    try {\n      const url = new URL(window.location.href);\n      const m = url.pathname.match(/\/channel\\/([UC][\\w-]{22,})/);\n      if (m) return m[1];\n      const m2 = url.pathname.match(/\\/(@[\\w.-]+)/) || url.pathname.match(/^\\/(@[\\w.-]+)/);\n      if (m2) return { handle: m2[1] };\n      if (url.searchParams.get('channel')) return url.searchParams.get('channel');\n    } catch { /* ignore */ }\n    return null;\n  }\n  function readGlobalData() {\n    const info = {};\n    try {\n      const ytcfg = window.ytcfg || window.ytConfig || {};\n      const get = (key) => {\n        try { return typeof ytcfg.get === 'function' ? ytcfg.get(key) : ytcfg[key]; } catch { return undefined; }\n      };\n      const channelId = get('CHANNEL_ID') || get('channelId') || get('pageChannelId');\n      if (channelId) info.channelId = channelId;\n      const channelName = get('CHANNEL_NAME') || get('channelName') || get('pageTitle');\n      if (channelName) info.channelName = String(channelName).trim();\n    } catch { /* ignore */ }\n    try {\n      const yid = window.ytInitialData || window.ytInitialPlayerResponse || {};\n      const walk = (obj, depth = 0) => {\n        if (depth > 6 || !obj || typeof obj !== 'object') return null;\n        if (Array.isArray(obj)) {\n          for (const item of obj) { const r = walk(item, depth + 1); if (r) return r; }\n          return null;\n        }\n        for (const [k, v] of Object.entries(obj)) {\n          if (k === 'channelId' && typeof v === 'string' && /^UC[\\w-]{22,}$/.test(v)) return v;\n          if (k === 'channelName' && typeof v === 'string' && !info.channelName) info.channelName = v.trim();\n          if (k === 'owner' || k === 'channelRenderer') {\n            const r = walk(v, depth + 1);\n            if (r) return r;\n          }\n        }\n        return null;\n      };\n      if (!info.channelId) {\n        const found = walk(yid);\n        if (found) info.channelId = found;\n      }\n    } catch { /* ignore */ }\n    return info;\n  }\n  function readDOM() {\n    const info = {};\n    const urlId = getChannelIdFromUrl();\n    if (typeof urlId === 'string') info.channelId = urlId;\n    else if (urlId && urlId.handle) info.handle = urlId.handle;\n    const nameSelectors = [\n      'yt-channel-id[channel-id]', 'channel-name', '[channel-id]',\n      'yt-formatted-string[id="channel-title"]', 'yt-formatted-string[id="text"]',\n      'div.channel-name', 'span.channel-name', 'h1.channel-title', 'yt-channel-name',\n    ];\n    for (const sel of nameSelectors) {\n      const el = document.querySelector(sel);\n      if (el) {\n        const val = el.getAttribute ? el.getAttribute('channel-id') || el.textContent || '' : el.textContent || '';\n        if (val && !info.channelId && /^UC[\\w-]{22,}$/.test(val.trim())) info.channelId = val.trim();\n        if (val && !info.channelName && val.trim().length > 0) info.channelName = val.trim();\n        if (info.channelId && info.channelName) break;\n      }\n    }\n    const handleEl = document.querySelector('yt-formatted-string[id="handle"], [id="handle"], a[href^="/@"], [aria-label*="@"]');\n    if (handleEl) {\n      const h = handleEl.getAttribute ? handleEl.getAttribute('aria-label') || handleEl.textContent || '' : handleEl.textContent || '';\n      const m = h.match(/@[\\w.-]+/);\n      if (m) info.handle = m[0];\n    }\n    const subSelectors = [\n      'yt-formatted-string[id="subscriber-count"]', '[id="subscriber-count"]', 'span.subscriber-count', 'div.subscriber-count',\n    ];\n    for (const sel of subSelectors) {\n      const el = document.querySelector(sel);\n      if (el) {\n        const m = el.textContent.match(/([\\d.,]+\\s*[KMBTkMBT]?|\\d[\\d.,]*)/);\n        if (m) { info.subscribers = cleanNumber(m[1]); break; }\n      }\n    }\n    const viewSelectors = [\n      'yt-formatted-string[id="view-count"]', '[id="view-count"]', 'span.view-count',\n    ];\n    for (const sel of viewSelectors) {\n      const el = document.querySelector(sel);\n      if (el) {\n        const m = el.textContent.match(/([\\d.,]+\\s*[KMBTkMBT]?|\\d[\\d.,]*)/);\n        if (m) { info.views = cleanNumber(m[1]); break; }\n      }\n    }\n    const videoSelectors = [\n      'yt-formatted-string[id="video-count"]', '[id="video-count"]', 'span.video-count',\n    ];\n    for (const sel of videoSelectors) {\n      const el = document.querySelector(sel);\n      if (el) {\n        const m = el.textContent.match(/(\\d[\\d.,]*)/);\n        if (m) { info.videoCount = parseInt(m[1].replace(/[.,]/g, ''), 10) || null; break; }\n      }\n    }\n    const descEl = document.querySelector('yt-formatted-string[id="description"], [id="description"], div.channel-description');\n    if (descEl && !info.niche) {\n      const txt = descEl.textContent || '';\n      info.niche = txt.slice(0, 120);\n    }\n    info.channelUrl = window.location.href;\n    return info;\n  }\n  function collectChannelInfo() {\n    const info = {};\n    Object.assign(info, readGlobalData());\n    const dom = readDOM();\n    if (!info.channelId && dom.channelId) info.channelId = dom.channelId;\n    if (!info.channelName && dom.channelName) info.channelName = dom.channelName;\n    if (!info.handle && dom.handle) info.handle = dom.handle;\n    if (info.subscribers == null && dom.subscribers != null) info.subscribers = dom.subscribers;\n    if (info.views == null && dom.views != null) info.views = dom.views;\n    if (info.videoCount == null && dom.videoCount != null) info.videoCount = dom.videoCount;\n    if (!info.niche && dom.niche) info.niche = dom.niche;\n    if (!info.channelUrl && dom.channelUrl) info.channelUrl = dom.channelUrl;\n    if (info.channelId && !/^UC[\\w-]{22,}$/.test(info.channelId)) {\n      info.channelIdRaw = info.channelId;\n      info.channelId = '';\n    }\n    info.channelUrl = info.channelUrl || window.location.href;\n    if (info.channelId && !info.channelUrl.includes('/channel/')) {\n      info.channelUrl = \`https://studio.youtube.com/channel/\${info.channelId}\`;\n    }\n    return info;\n  }\n  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {\n    if (request.action === 'GET_CHANNEL_INFO') {\n      try {\n        sendResponse({ ok: true, data: collectChannelInfo(), url: window.location.href, title: document.title });\n      } catch (err) {\n        sendResponse({ ok: false, code: 'EXTRACT_ERROR', message: err instanceof Error ? err.message : 'Không trích xuất được.' });\n      }\n      return true;\n    }\n    if (request.action === 'INJECT_BTN') {\n      injectFloatingButton();\n      sendResponse({ ok: true });\n      return true;\n    }\n    return false;\n  });\n  function injectFloatingButton() {\n    if (document.getElementById('ymax-scan-btn')) return;\n    const btn = document.createElement('button');\n    btn.id = 'ymax-scan-btn';\n    btn.textContent = 'Quét kênh YMax';\n    Object.assign(btn.style, {\n      position: 'fixed', bottom: '24px', right: '24px', zIndex: '2147483647',\n      padding: '10px 16px', background: '#ff0000', color: '#fff', border: 'none',\n      borderRadius: '8px', fontSize: '14px', fontWeight: '700',\n      fontFamily: '-apple-system, BlinkMacSystemFont, \"Segoe UI\", Roboto, sans-serif',\n      boxShadow: '0 4px 12px rgba(0,0,0,0.35)', cursor: 'pointer',\n      display: 'flex', alignItems: 'center', gap: '8px',\n    });\n    btn.addEventListener('click', () => {\n      chrome.runtime.sendMessage({ action: 'GET_CHANNEL_INFO' }, (resp) => {\n        if (resp && resp.ok) {\n          const d = resp.data;\n          const lines = [\n            'Kênh YouTube',\n            'Tên: ' + (d.channelName || '—'),\n            'ID: ' + (d.channelId || '—'),\n            'Handle: ' + (d.handle || '—'),\n            'Người đăng ký: ' + (d.subscribers != null ? d.subscribers.toLocaleString() : '—'),\n            'Lượt xem: ' + (d.views != null ? d.views.toLocaleString() : '—'),\n            'Video: ' + (d.videoCount != null ? d.videoCount.toLocaleString() : '—'),\n            'Chủ đề: ' + (d.niche || '—'),\n            'URL: ' + (d.channelUrl || '—'),\n          ].join('\\n');\n          if (navigator.clipboard) {\n            navigator.clipboard.writeText(lines).then(() => {\n              const old = btn.textContent;\n              btn.textContent = 'Đã sao chép!';\n              setTimeout(() => { btn.textContent = old; }, 1500);\n            });\n          } else {\n            alert(lines);\n          }\n        } else {\n          alert('Không lấy được thông tin kênh. ' + (resp && resp.message ? resp.message : ''));\n        }\n      });\n    });\n    document.body.appendChild(btn);\n  }\n  if (/studio\\.youtube\\.com|youtube\\.com/i.test(window.location.hostname)) {\n    if (document.readyState === 'loading') {\n      document.addEventListener('DOMContentLoaded', injectFloatingButton);\n    } else {\n      injectFloatingButton();\n    }\n    let lastUrl = location.href;\n    new MutationObserver(() => {\n      if (location.href !== lastUrl) {\n        lastUrl = location.href;\n        setTimeout(injectFloatingButton, 500);\n      }\n    }).observe(document, { subtree: true, childList: true });\n  }\n})();`;
  const popupHtml = `<!DOCTYPE html>\n<html lang="vi">\n<head>\n<meta charset="UTF-8">\n<meta name="viewport" content="width=device-width, initial-scale=1.0">\n<title>Lấy kênh 1 chạm — Lãnh Địa YouTube</title>\n<style>\n  * { box-sizing: border-box; margin: 0; padding: 0; }\n  :root {\n    --bg: #ffffff;\n    --panel: #fafafa;\n    --text: #1a1a1a;\n    --muted: #666666;\n    --border: #e5e5e5;\n    --accent: #ff0000;\n    --accent-hover: #cc0000;\n    --ok: #22c55e;\n    --err: #ef4444;\n  }\n  body {\n    font-family: -apple-system, BlinkMacSystemFont, \"Segoe UI\", Roboto, \"Helvetica Neue\", Arial, sans-serif;\n    background: var(--bg);\n    color: var(--text);\n    width: 380px;\n    padding: 16px;\n  }\n  header {\n    display: flex;\n    align-items: center;\n    gap: 10px;\n    margin-bottom: 14px;\n  }\n  .logo {\n    width: 32px; height: 32px;\n    background: #ff0000; border-radius: 6px;\n    display: flex; align-items: center; justify-content: center;\n    font-weight: 900; color: #fff; font-size: 16px; line-height: 1;\n  }\n  h1 { font-size: 16px; font-weight: 700; letter-spacing: -0.2px; }\n  h2 { font-size: 13px; font-weight: 700; margin: 14px 0 8px; color: var(--text); }\n  h3 { font-size: 12px; font-weight: 600; margin: 10px 0 6px; color: var(--text); }\n  .card {\n    background: var(--panel);\n    border: 1px solid var(--border);\n    border-radius: 10px;\n    padding: 12px;\n    margin-bottom: 12px;\n  }\n  .row { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; margin-bottom: 6px; }\n  .row .label { font-size: 12px; color: var(--muted); font-weight: 500; }\n  .row .value { font-size: 13px; font-weight: 600; word-break: break-all; }\n  .row .value.mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }\n  input, select {\n    width: 100%;\n    padding: 8px 10px;\n    border: 1px solid var(--border);\n    border-radius: 8px;\n    background: #fff;\n    font-size: 13px;\n    color: var(--text);\n    font-family: inherit;\n  }\n  input:focus { outline: 2px solid var(--accent); border-color: transparent; }\n  .btn {\n    width: 100%;\n    padding: 10px 14px;\n    border: none;\n    border-radius: 8px;\n    font-size: 13px;\n    font-weight: 700;\n    cursor: pointer;\n    font-family: inherit;\n  }\n  .btn-primary { background: var(--accent); color: #fff; }\n  .btn-primary:hover { background: var(--accent-hover); }\n  .btn-primary:disabled { opacity: 0.6; cursor: not-allowed; }\n  .btn-ghost { background: transparent; border: 1px solid var(--border); color: var(--text); }\n  .btn-ghost:hover { background: #f2f2f2; }\n  .btn-sm { padding: 6px 10px; font-size: 12px; width: auto; }\n  .flex-row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }\n  .flex-1 { flex: 1; }\n  .status { font-size: 12px; padding: 6px 10px; border-radius: 6px; margin-top: 8px; display: none; }\n  .status.ok { display: block; background: #f0fdf4; color: #166534; border: 1px solid #bbf7d0; }\n  .status.err { display: block; background: #fef2f2; color: #991b1b; border: 1px solid #fecaca; }\n  .status.hidden { display: none; }\n  .hint { font-size: 11px; color: var(--muted); margin-top: 4px; line-height: 1.4; }\n  .divider { height: 1px; background: var(--border); margin: 12px 0; }\n  .empty { color: var(--muted); font-size: 12px; font-style: italic; text-align: center; padding: 8px; }\n</style>\n</head>\n<body>\n<header>\n  <div class=\"logo\">Y</div>\n  <h1>Lấy kênh 1 chạm</h1>\n</header>\n<div id=\"loading\" class=\"card empty\">Đang quét kênh…</div>\n<div id=\"channel-card\" class=\"card\" style=\"display:none\">\n  <h2>Thông tin kênh</h2>\n  <div class=\"row\"><span class=\"label\">Tên kênh</span><span class=\"value\" id=\"f-channelName\"></span></div>\n  <div class=\"row\"><span class=\"label\">ID Kênh</span><span class=\"value mono\" id=\"f-channelId\"></span></div>\n  <div class=\"row\"><span class=\"label\">Handle</span><span class=\"value mono\" id=\"f-handle\"></span></div>\n  <div class=\"row\"><span class=\"label\">Người đăng ký</span><span class=\"value\" id=\"f-subscribers\"></span></div>\n  <div class=\"row\"><span class=\"label\">Lượt xem</span><span class=\"value\" id=\"f-views\"></span></div>\n  <div class=\"row\"><span class=\"label\">Số video</span><span class=\"value\" id=\"f-videoCount\"></span></div>\n  <div class=\"row\"><span class=\"label\">Trạng thái BKT</span><span class=\"value\" id=\"f-monetization\"></span></div>\n  <div class=\"row\"><span class=\"label\">Chủ đề</span><span class=\"value\" id=\"f-niche\"></span></div>\n  <div class=\"row\"><span class=\"label\">URL</span><span class=\"value mono\" id=\"f-channelUrl\"></span></div>\n</div>\n<div id=\"edit-card\" class=\"card\" style=\"display:none\">\n  <h2>Thêm / Sửa trước khi gửi</h2>\n  <div class=\"row\"><span class=\"label\">Gmail quản lý</span><input type=\"email\" id=\"f-gmail\" placeholder=\"gmail@example.com\"></div>\n  <div class=\"row\"><span class=\"label\">Proxy</span><input type=\"text\" id=\"f-proxy\" placeholder=\"proxy:port (trống nếu không dùng)\"></div>\n  <div class=\"row\"><span class=\"label\">Thư mục video máy trạm</span><input type=\"text\" id=\"f-videoFolder\" placeholder=\"D:\\\\Video\\\\Kênh A\"></div>\n  <div class=\"row\"><span class=\"label\">Ghi chú</span><input type=\"text\" id=\"f-note\" placeholder=\"Ghi chú về kênh…\"></div>\n</div>\n<div class=\"divider\"></div>\n<h3>Kết nối với Lãnh Địa YouTube</h3>\n<div class=\"row\"><span class=\"label\">Website URL</span><input type=\"url\" id=\"f-websiteUrl\" placeholder=\"https://lanhdiayoutube2027-beryl.vercel.app\"></div>\n<div class=\"row\"><span class=\"label\">Extension Token</span><input type=\"text\" id=\"f-token\" placeholder=\"Tạo token trên web trước…\"></div>\n<button id=\"btnSync\" class=\"btn btn-primary\" disabled>Đẩy về Lãnh Địa YouTube (1 Chạm)</button>\n<div id=\"status\" class=\"status hidden\"></div>\n<p class=\"hint\" style=\"margin-top:10px\">Lưu ý: Tạo Extension Token tại mục Quản lý Kênh trên web trước khi bấm gửi.</p>\n<script src=\"popup.js\"></script>\n</body>\n</html>`;
  const popupJs = `(function () {\n  'use strict';\n  const \$\ = (id) => document.getElementById(id);\n  const format = (n) => (n == null ? '—' : String(n).replace(/\\\\B(?=(\\d{3})+(?!\\d))/g, '.'));\n  const els = {\n    loading: \$('loading'),\n    channelCard: \$('channel-card'),\n    editCard: \$('edit-card'),\n    fChannelName: \$('f-channelName'),\n    fChannelId: \$('f-channelId'),\n    fHandle: \$('f-handle'),\n    fSubscribers: \$('f-subscribers'),\n    fViews: \$('f-views'),\n    fVideoCount: \$('f-videoCount'),\n    fMonetization: \$('f-monetization'),\n    fNiche: \$('f-niche'),\n    fChannelUrl: \$('f-channelUrl'),\n    fGmail: \$('f-gmail'),\n    fProxy: \$('f-proxy'),\n    fVideoFolder: \$('f-videoFolder'),\n    fNote: \$('f-note'),\n    fWebsiteUrl: \$('f-websiteUrl'),\n    fToken: \$('f-token'),\n    btnSync: \$('btnSync'),\n    status: \$('status'),\n  };\n  let channelInfo = null;\n  let websiteUrl = '';\n  let extensionToken = '';\n  async function loadConfig() {\n    try {\n      const res = await chrome.storage.local.get(['websiteUrl', 'extensionToken']);\n      if (res.websiteUrl) { els.fWebsiteUrl.value = res.websiteUrl; websiteUrl = res.websiteUrl; }\n      if (res.extensionToken) { els.fToken.value = res.extensionToken; extensionToken = res.extensionToken; }\n    } catch { /* ignore */ }\n    updateSyncButton();\n  }\n  function saveConfig() {\n    websiteUrl = els.fWebsiteUrl.value.trim();\n    extensionToken = els.fToken.value.trim();\n    chrome.storage.local.set({ websiteUrl, extensionToken });\n    updateSyncButton();\n  }\n  els.fWebsiteUrl.addEventListener('input', saveConfig);\n  els.fToken.addEventListener('input', saveConfig);\n  async function scanChannel() {\n    els.loading.style.display = 'block';\n    els.channelCard.style.display = 'none';\n    els.editCard.style.display = 'none';\n    els.btnSync.disabled = true;\n    try {\n      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });\n      if (!tab || !/studio\\\\.youtube\\\\.com|youtube\\\\.com/i.test(tab.url || '')) {\n        throw new Error('Hãy mở tab YouTube Studio (studio.youtube.com/channel/…).');\n      }\n      const resp = await chrome.tabs.sendMessage(tab.id, { action: 'GET_CHANNEL_INFO' });\n      if (!resp || !resp.ok) {\n        throw new Error(resp && resp.message ? resp.message : 'Không trích xuất được thông tin kênh.');\n      }\n      channelInfo = resp.data;\n      renderChannel(channelInfo);\n      els.loading.style.display = 'none';\n      els.channelCard.style.display = 'block';\n      els.editCard.style.display = 'block';\n      updateSyncButton();\n    } catch (err) {\n      els.loading.style.display = 'none';\n      els.channelCard.style.display = 'none';\n      els.editCard.style.display = 'none';\n      showStatus(err instanceof Error ? err.message : 'Không quét được kênh.', 'err');\n    }\n  }\n  function renderChannel(d) {\n    els.fChannelName.textContent = d.channelName || '—';\n    els.fChannelId.textContent = d.channelId || '—';\n    els.fHandle.textContent = d.handle || '—';\n    els.fSubscribers.textContent = format(d.subscribers);\n    els.fViews.textContent = format(d.views);\n    els.fVideoCount.textContent = format(d.videoCount);\n    els.fMonetization.textContent = d.monetizationStatus || 'Chưa rõ';\n    els.fNiche.textContent = d.niche || '—';\n    els.fChannelUrl.textContent = d.channelUrl || '—';\n    if (d.gmail && !els.fGmail.value) els.fGmail.value = d.gmail;\n  }\n  function updateSyncButton() {\n    const ready = Boolean(channelInfo && channelInfo.channelId && extensionToken && websiteUrl);\n    els.btnSync.disabled = !ready;\n  }\n  function showStatus(msg, kind) {\n    const s = els.status;\n    s.textContent = msg;\n    s.className = 'status ' + (kind === 'ok' ? 'ok' : kind === 'err' ? 'err' : 'hidden');\n  }\n  els.btnSync.addEventListener('click', async () => {\n    if (!channelInfo || !channelInfo.channelId) return;\n    if (!extensionToken) { showStatus('Vui lòng nhập Extension Token.', 'err'); return; }\n    if (!websiteUrl) { showStatus('Vui lòng nhập Website URL.', 'err'); return; }\n    els.btnSync.disabled = true;\n    els.btnSync.textContent = 'Đang gửi…';\n    showStatus('');\n    const body = {\n      channelId: channelInfo.channelId,\n      channelName: channelInfo.channelName || '',\n      handle: channelInfo.handle || '',\n      subscribers: channelInfo.subscribers ?? null,\n      views: channelInfo.views ?? null,\n      videoCount: channelInfo.videoCount ?? null,\n      monetizationStatus: channelInfo.monetizationStatus || 'Chưa rõ',\n      niche: channelInfo.niche || '',\n      channelUrl: channelInfo.channelUrl || '',\n      gmail: els.fGmail.value.trim() || '',\n      proxy: els.fProxy.value.trim() || '',\n      videoFolder: els.fVideoFolder.value.trim() || '',\n      note: els.fNote.value.trim() || '',\n      source: 'extension-1cham',\n      scannedAt: Date.now(),\n    };\n    try {\n      const resp = await fetch(\${JSON.stringify(websiteUrl.replace(/\\/+$/, ''))}/api/extension/sync-channel, {\n        method: 'POST',\n        headers: { 'Content-Type': 'application/json', 'x-extension-token': extensionToken },\n        body: JSON.stringify(body),\n      });\n      const data = await resp.json().catch(() => ({}));\n      if (resp.ok && data.success) {\n        showStatus('✅ Đã đồng bộ kênh về Lãnh Địa YouTube thành công.', 'ok');\n        els.btnSync.textContent = 'Đã gửi thành công';\n        setTimeout(() => { els.btnSync.textContent = 'Đẩy về Lãnh Địa YouTube (1 Chạm)'; els.btnSync.disabled = false; }, 1500);\n      } else if (resp.status === 401 || resp.status === 403) {\n        showStatus(data.message || 'Token không hợp lệ hoặc không có quyền. Hãy tạo lại token trên web.', 'err');\n        els.btnSync.disabled = false;\n        els.btnSync.textContent = 'Đẩy về Lãnh Địa YouTube (1 Chạm)';\n      } else {\n        showStatus(data.message || 'Gửi không thành công (HTTP ' + resp.status + ').', 'err');\n        els.btnSync.disabled = false;\n        els.btnSync.textContent = 'Đẩy về Lãnh Địa YouTube (1 Chạm)';\n      }\n    } catch (err) {\n      showStatus('Không kết nối được đến web. Hãy kiểm tra Website URL.', 'err');\n      els.btnSync.disabled = false;\n      els.btnSync.textContent = 'Đẩy về Lãnh Địa YouTube (1 Chạm)';\n    }\n  });\n  document.addEventListener('DOMContentLoaded', async () => {\n    await loadConfig();\n    await scanChannel();\n  });\n})();`;
  const backgroundJs = `// ============================================================================\n// Background service worker (Manifest V3)\n// ============================================================================\nchrome.runtime.onInstalled.addListener(() => {\n  // Không làm gì đặc biệt khi cài đặt\n});\nchrome.runtime.onMessage.addListener((request, sender, sendResponse) => {\n  sendResponse({ ok: true });\n  return true;\n});\n`;

  const files: [string, any][] = [
    ['manifest.json', Buffer.from(manifest, 'utf8')],
    ['icon.png', iconPng],
    ['content.js', Buffer.from(contentJs, 'utf8')],
    ['popup.html', Buffer.from(popupHtml, 'utf8')],
    ['popup.js', Buffer.from(popupJs, 'utf8')],
    ['background.js', Buffer.from(backgroundJs, 'utf8')],
  ];

  const entries = files.map(([name, data]) => zipEntry(name, data));
  let offset = 0;
  const localParts: any[] = [], centralParts: any[] = [];
  for (const e of entries) {
    localParts.push(e.l, e.filename, e.data);
    centralParts.push(e.c, e.filename);
    offset += e.l.length + e.filename.length + e.data.length;
  }
  const toc = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(toc.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...localParts, toc, end]);
}

/** POST /api/extension/token — tạo token kết nối cho extension */
app.post('/api/extension/token', requireAuth, requireWritable, wrap(async (req, res) => {
  const db = adminDb();
  const crypto = await import('node:crypto');
  const rawToken = crypto.randomBytes(24).toString('hex');
  const hash = crypto.createHash('sha256').update(rawToken).digest('hex');
  await db.collection('extension_tokens').doc().set({
    tokenHash: hash,
    uid: req.authUid,
    tenantId: req.profile!.tenantId,
    createdAt: Date.now(),
    revoked: false,
  });
  ok(res, { token: rawToken, message: 'Sao chép token này ngay — chỉ hiển thị 1 lần.' }, 'Đã cấp token kết nối.');
}));

/** POST /api/extension/sync-channel — nhận dữ liệu từ extension và upsert kênh */
app.post('/api/extension/sync-channel', wrap(async (req, res) => {
  const token = req.headers['x-extension-token'] as string | undefined;
  if (!token) return fail(res, 401, 'UNAUTHORIZED', 'Thiếu x-extension-token.');
  const db = adminDb();
  const crypto = await import('node:crypto');
  const hash = crypto.createHash('sha256').update(token).digest('hex');
  const snap = await db.collection('extension_tokens').where('tokenHash', '==', hash).where('revoked', '==', false).limit(1).get();
  if (snap.empty) return fail(res, 401, 'UNAUTHORIZED', 'Token không hợp lệ hoặc đã bị thu hồi.');

  const tokenDoc = snap.docs[0];
  const tokenData = tokenDoc.data() as { uid?: string; tenantId?: string };
  const uid = tokenData.uid || '';
  const tenantId = tokenData.tenantId || '';

  // Xác thực profile và quyền ghi (trừ root)
  const header = req.headers['authorization'] || '';
  const bearer = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!bearer) return fail(res, 401, 'UNAUTHORIZED', 'Chưa đăng nhập.');
  let decoded;
  try { decoded = await verifyIdToken(bearer); } catch { return fail(res, 401, 'UNAUTHORIZED', 'Phiên đăng nhập hết hạn.'); }
  const profileUid = String(decoded.uid || '');
  const profileEmail = String(decoded.email || '');
  const emailVerified = decoded.email_verified === true;
  const isRoot = profileUid === 'ZLf8yirSASXNMFzTK8VH255dYeD3'
    || ['ZLf8yirSASXNMFzTK8VH255dYeD3', '69pO96VpwdgiAbumCtpavCAPKaG2'].includes(profileUid)
    || (emailVerified && ['canh291006@gmail.com', 'khanhkhanh199x1@gmail.com'].includes(profileEmail.toLowerCase()));
  let profile: any = { uid: profileUid, email: profileEmail, role: 'tenant', isReadOnly: true, tenantId: profileUid };
  if (isRoot) {
    profile = { ...profile, role: 'root', isReadOnly: false, tenantId: profileUid };
  } else {
    const userSnap = await db.collection('users').doc(profileUid).get();
    const base = userSnap.exists ? (userSnap.data() as any) : {};
    profile.role = base.role === 'staff' ? 'staff' : 'tenant';
    profile.tenantId = base.tenantId || profileUid;
    profile.isReadOnly = computeReadOnly(base);
  }

  // Nếu token thuộc tenant khác -> chặn
  if (tenantId && profile.role !== 'root' && tenantId !== profile.tenantId) {
    return fail(res, 403, 'FORBIDDEN', 'Token không thuộc workspace này.');
  }
  const targetTenantId = tenantId || profile.tenantId;

  if (profile.role !== 'root' && profile.isReadOnly) {
    return fail(res, 403, 'READ_ONLY_MODE', 'Tài khoản đang ở chế độ chỉ xem. Vui lòng nâng cấp hoặc gia hạn gói.');
  }

  const body = req.body || {};
  const channelId = String(body.channelId || '').trim();
  if (!channelId) return fail(res, 400, 'BAD_REQUEST', 'Thiếu channelId.');
  const channelName = String(body.channelName || `Kênh ${channelId}`).trim();
  const handle = String(body.handle || '').trim() || undefined;
  const subscribers = typeof body.subscribers === 'number' ? body.subscribers : null;
  const views = typeof body.views === 'number' ? body.views : null;
  const videoCount = typeof body.videoCount === 'number' ? body.videoCount : null;
  const monetizationStatus = String(body.monetizationStatus || 'Chưa rõ').trim();
  const niche = String(body.niche || '').trim() || undefined;
  const channelUrl = String(body.channelUrl || `https://studio.youtube.com/channel/${channelId}`).trim();
  const gmail = String(body.gmail || '').trim() || undefined;
  const proxy = String(body.proxy || '').trim() || undefined;
  const videoFolder = String(body.videoFolder || '').trim() || undefined;
  const note = String(body.note || '').trim() || undefined;

  const collection = db.collection('channels');
  const existing = await collection.where('tenantId', '==', targetTenantId).where('channelId', '==', channelId).limit(1).get();
  const now = Date.now();
  const data: any = {
    channelName,
    channelId,
    channelUrl,
    handle,
    subscribers,
    views,
    videoCount,
    monetizationStatus,
    niche,
    gmail,
    proxy,
    videoFolder,
    note,
    tenantId: targetTenantId,
    updatedAt: now,
    source: 'extension-1cham',
  };
  if (!existing.empty) {
    const doc = existing.docs[0];
    await collection.doc(doc.id).update(data);
    ok(res, { id: doc.id, action: 'updated' }, 'Đã cập nhật kênh.');
  } else {
    const ref = collection.doc();
    await ref.set({ ...data, state: 'active', createdAt: now });
    ok(res, { id: ref.id, action: 'created' }, 'Đã thêm kênh mới.', 201);
  }
}));

/** GET /api/extension/package — tải file .zip của extension (nhúng sẵn origin) */
app.get('/api/extension/package', (_req, res) => {
  try {
    const origin = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : '';
    const zip = buildExtensionZip(origin);
    res.setHeader('content-type', 'application/zip');
    res.setHeader('content-disposition', 'attachment; filename="ymaxtool-chrome-extension.zip"');
    res.setHeader('content-length', String(zip.length));
    res.send(zip);
  } catch (err) {
    fail(res, 500, 'SERVER_ERROR', err instanceof Error ? err.message : 'Không đóng gói được extension.');
  }
});

// ================= ERROR HANDLING CUỐI CÙNG (luôn trả JSON) =================
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    const message = err instanceof Error ? err.message : 'Lỗi máy chủ.';
    if (!res.headersSent) {
      if (err instanceof ApiFault) return fail(res, err.status, err.code, err.message);
      fail(res, 500, 'SERVER_ERROR', message);
    }
  });

  return app;
}

/** Chỉ chạy server khi KHÔNG phải môi trường Vercel (dev local). */
export function startServer(port = Number(process.env.PORT || 3000)) {
  const app = createApiApp();
  app.listen(port, () => {
    // eslint-disable-next-line no-console
    console.log(`LÃNH ĐỊA YOUTUBE API đang chạy tại http://localhost:${port}`);
  });
}

// Chạy khi thực thi trực tiếp (tsx server.ts), không chạy khi import trên Vercel.
const isDirectRun =
  typeof process !== 'undefined' &&
  !process.env.VERCEL &&
  process.argv[1] &&
  /server\.(ts|js|mjs|cjs)$/.test(process.argv[1]);
if (isDirectRun) {
  startServer();
}
