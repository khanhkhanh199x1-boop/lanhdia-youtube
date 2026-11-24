import type { User } from 'firebase/auth';
import type { StaffAccess } from './team';

// ============================================================================
// Phân quyền 3 cấp + Master Admin (Mục 4).
// Roles: root (Master Admin) / tenant (Chủ team) / staff (Nhân viên).
// Master Admin KHÔNG BAO GIỜ bị Read-Only, KHÔNG BAO GIỜ thấy banner hết hạn.
// ============================================================================

export const MASTER_ADMIN_UID = 'ZLf8yirSASXNMFzTK8VH255dYeD3';
export const MASTER_ADMIN_EMAIL = 'canh291006@gmail.com';
export const MASTER_ADMIN_UIDS = [
  'ZLf8yirSASXNMFzTK8VH255dYeD3',
  '69pO96VpwdgiAbumCtpavCAPKaG2',
];
export const MASTER_ADMIN_EMAILS = [
  'canh291006@gmail.com',
  'khanhkhanh199x1@gmail.com',
];

export type Role = 'root' | 'tenant' | 'staff';

export interface UserProfile extends Partial<StaffAccess> {
  uid: string;
  email: string;
  displayName: string;
  role: Role;
  credits: number;
  plan: string;
  expiresAt: number; // epoch ms
  isReadOnly: boolean;
  tenantId: string;
  teamName: string;
  createdAt: number;
}

export const ROOT_CREDITS = 9999999;
export const ROOT_PLAN = 'p365';
export const ROOT_EXPIRES_AT = 253402300799000; // 9999-12-31

/** Kiểm tra có phải Master Admin không (theo UID hoặc Email). */
export function isMasterAdmin(uid?: string | null, email?: string | null, emailVerified = false): boolean {
  if (uid && MASTER_ADMIN_UIDS.includes(uid)) return true;
  if (emailVerified && email && MASTER_ADMIN_EMAILS.some((e) => e.toLowerCase() === email.toLowerCase())) return true;
  return false;
}

/** Dựng profile Master Admin (ép cứng, không tin Firestore/client). */
export function buildMasterAdminProfile(user: User): UserProfile {
  return {
    uid: user.uid,
    email: user.email || MASTER_ADMIN_EMAIL,
    displayName: user.displayName || 'Quản trị viên chính',
    role: 'root',
    credits: ROOT_CREDITS,
    plan: ROOT_PLAN,
    expiresAt: ROOT_EXPIRES_AT,
    isReadOnly: false,
    tenantId: user.uid,
    teamName: 'LÃNH ĐỊA YOUTUBE',
    createdAt: Date.now(),
  };
}

/** Ép profile bất kỳ về đúng chuẩn Master Admin (dùng phía server). */
export function forceRootProfile(base: Partial<UserProfile>, uid: string, email: string): UserProfile {
  return {
    uid,
    email,
    displayName: base.displayName || 'Quản trị viên chính',
    role: 'root',
    credits: ROOT_CREDITS,
    plan: ROOT_PLAN,
    expiresAt: ROOT_EXPIRES_AT,
    isReadOnly: false,
    tenantId: uid,
    teamName: base.teamName || 'LÃNH ĐỊA YOUTUBE',
    createdAt: base.createdAt || Date.now(),
  };
}

/** Profile mặc định cho tài khoản mới (chưa có gói -> Read-Only). */
export function buildDefaultProfile(user: User): UserProfile {
  return {
    uid: user.uid,
    email: user.email || '',
    displayName: user.displayName || '',
    role: 'tenant',
    credits: 0,
    plan: 'free',
    expiresAt: 0,
    isReadOnly: true,
    tenantId: user.uid,
    teamName: 'Team của tôi',
    createdAt: Date.now(),
  };
}

/** Tính isReadOnly từ hạn gói: hết hạn (hoặc chưa có gói) -> true, trừ root. */
export function computeReadOnly(profile: UserProfile): boolean {
  if (profile.role === 'root') return false;
  if (profile.role === 'staff') return profile.isReadOnly;
  if (!profile.expiresAt || profile.expiresAt <= Date.now()) return true;
  return false;
}
