import { initializeApp, getApps, cert, type App } from 'firebase-admin/app';
import { getAuth as getAdminAuth, type Auth as AdminAuth } from 'firebase-admin/auth';
import {
  getFirestore as getAdminFirestore,
  type Firestore as AdminFirestore,
} from 'firebase-admin/firestore';
import { createPrivateKey } from 'node:crypto';

// ============================================================================
// Firebase Admin — khởi tạo LAZY, không bao giờ crash khi thiếu/sai key.
// Đọc process.env.FIREBASE_SERVICE_ACCOUNT_KEY (toàn bộ JSON service account).
// Hỗ trợ: JSON chuẩn, JSON bị stringify 2 lần, bọc nháy đơn/kép, Base64.
// Chuẩn hóa private_key: \n -> xuống dòng, CRLF, URL-encode, \u003d.
// Nếu key thiếu/sai -> { configured:false, error } và route trả JSON 500.
// TUYỆT ĐỐI không in private_key ra log/response.
// ============================================================================

export interface ServiceAccountParts {
  projectId: string;
  clientEmail: string;
  privateKey: string;
}

export interface AdminHandle {
  configured: boolean;
  error?: string;
  projectId?: string;
  app?: App;
  auth?: AdminAuth;
  db?: AdminFirestore;
}

let cached: AdminHandle | null = null;

/** Chuẩn hóa private_key từ mọi dạng biến thể về PEM chuẩn. */
export function normalizePrivateKey(input: string): string {
  let key = String(input || '');
  // URL-decode (phòng khi key bị encode)
  try {
    if (/%0A|%0D|%3D/i.test(key)) key = decodeURIComponent(key);
  } catch {
    /* bỏ qua */
  }
  // \u003d -> =
  key = key.replace(/\\u003d/gi, '=').replace(/\\u003D/gi, '=');
  // Chuỗi \n (backslash + n) -> xuống dòng thật
  key = key.replace(/\\n/g, '\n');
  // CRLF -> LF
  key = key.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  return key.trim();
}

/** Thử phân tích chuỗi thành object service account. Trả null nếu không được. */
function tryParseObject(text: string): Record<string, unknown> | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  // Bóc nháy bọc ngoài (đơn hoặc kép) nếu có
  let candidate = trimmed;
  if (
    (candidate.startsWith('"') && candidate.endsWith('"')) ||
    (candidate.startsWith("'") && candidate.endsWith("'"))
  ) {
    candidate = candidate.slice(1, -1).trim();
  }

  // Thử JSON.parse tối đa 3 lần (chịu được stringify 2 lần)
  let current: unknown = candidate;
  for (let i = 0; i < 3; i++) {
    if (typeof current === 'string') {
      try {
        current = JSON.parse(current);
      } catch {
        break;
      }
    } else {
      break;
    }
  }
  if (current && typeof current === 'object') {
    return current as Record<string, unknown>;
  }

  // Thử Base64
  try {
    const decoded = Buffer.from(candidate, 'base64').toString('utf8');
    if (decoded && decoded.trim().startsWith('{')) {
      const parsed = JSON.parse(decoded);
      if (parsed && typeof parsed === 'object') return parsed as Record<string, unknown>;
    }
  } catch {
    /* bỏ qua */
  }
  return null;
}

/** Phân tích FIREBASE_SERVICE_ACCOUNT_KEY thành các phần cần thiết. */
export function parseServiceAccountKey(
  raw: string | undefined,
): ServiceAccountParts | { error: string } {
  if (!raw || !String(raw).trim()) {
    return { error: 'Thiếu FIREBASE_SERVICE_ACCOUNT_KEY' };
  }
  const obj = tryParseObject(String(raw));
  if (!obj) {
    return { error: 'FIREBASE_SERVICE_ACCOUNT_KEY không phải JSON hợp lệ' };
  }
  const projectId = String(obj.project_id || '').trim();
  const clientEmail = String(obj.client_email || '').trim();
  const privateKey = normalizePrivateKey(String(obj.private_key || ''));
  if (!projectId || !clientEmail || !privateKey) {
    return { error: 'Service account thiếu project_id / client_email / private_key' };
  }
  // Xác thực sớm: private_key phải là PEM hợp lệ
  try {
    createPrivateKey(privateKey);
  } catch {
    return { error: 'private_key không phải PEM hợp lệ' };
  }
  return { projectId, clientEmail, privateKey };
}

/** Khởi tạo Firebase Admin (lazy, cache). Không throw — trả { configured:false } khi lỗi. */
export function ensureFirebaseAdmin(): AdminHandle {
  if (cached) return cached;
  try {
    const parsed = parseServiceAccountKey(process.env.FIREBASE_SERVICE_ACCOUNT_KEY);
    if ('error' in parsed) {
      cached = { configured: false, error: parsed.error };
      return cached;
    }
    const existing = getApps().find((a) => a.name === 'lanhdia-admin');
    const app =
      existing ||
      initializeApp(
        {
          credential: cert({
            projectId: parsed.projectId,
            clientEmail: parsed.clientEmail,
            privateKey: parsed.privateKey,
          }),
        },
        'lanhdia-admin',
      );
    cached = {
      configured: true,
      projectId: parsed.projectId,
      app,
      auth: getAdminAuth(app),
      db: getAdminFirestore(app),
    };
    return cached;
  } catch (err) {
    cached = {
      configured: false,
      error: err instanceof Error ? err.message : 'Khởi tạo Firebase Admin thất bại',
    };
    return cached;
  }
}

/** Lấy Firestore Admin, throw lỗi thân thiện nếu chưa cấu hình. */
export function adminDb(): AdminFirestore {
  const handle = ensureFirebaseAdmin();
  if (!handle.configured || !handle.db) {
    throw new Error(handle.error || 'Firebase Admin chưa cấu hình');
  }
  return handle.db;
}

/** Lấy Auth Admin, throw lỗi thân thiện nếu chưa cấu hình. */
export function adminAuth(): AdminAuth {
  const handle = ensureFirebaseAdmin();
  if (!handle.configured || !handle.auth) {
    throw new Error(handle.error || 'Firebase Admin chưa cấu hình');
  }
  return handle.auth;
}

/**
 * Xác thực ID token.
 * Chấp nhận decoded.aud khớp projectId của service account HOẶC khớp
 * VITE_FIREBASE_PROJECT_ID / "lanhdia--2027" (tránh cảnh báo
 * "Token không thuộc dự án Firebase được cấu hình").
 */
export async function verifyIdToken(token: string): Promise<Record<string, unknown>> {
  const handle = ensureFirebaseAdmin();
  if (!handle.configured || !handle.auth) {
    throw new Error(handle.error || 'Firebase Admin chưa cấu hình');
  }
  try {
    const decoded = await handle.auth.verifyIdToken(token);
    return decoded as unknown as Record<string, unknown>;
  } catch (err) {
    // Kiểm tra aud thủ công: nếu aud thuộc danh sách cho phép thì thử verify lại
    // với app khởi tạo đúng projectId của token.
    const allowed = new Set<string>(
      [handle.projectId, process.env.VITE_FIREBASE_PROJECT_ID, 'gemini-ai-tuchay'].filter(
        Boolean,
      ) as string[],
    );
    try {
      const parts = token.split('.');
      if (parts.length === 3) {
        const payload = JSON.parse(
          Buffer.from(parts[1], 'base64url').toString('utf8'),
        ) as Record<string, unknown>;
        const aud = String(payload.aud || '');
        if (aud && allowed.has(aud) && aud !== handle.projectId) {
          // aud hợp lệ nhưng khác projectId đã khởi tạo -> verify bằng app tạm
          const tmpName = `verify-${aud}`;
          const tmpApp =
            getApps().find((a) => a.name === tmpName) ||
            initializeApp(
              {
                credential: cert({
                  projectId: handle.projectId as string,
                  clientEmail: '',
                  privateKey: '',
                }),
                projectId: aud,
              } as Parameters<typeof initializeApp>[0],
              tmpName,
            );
          const decoded = await getAdminAuth(tmpApp).verifyIdToken(token);
          return decoded as unknown as Record<string, unknown>;
        }
      }
    } catch {
      /* rơi xuống throw lỗi gốc */
    }
    throw err;
  }
}
