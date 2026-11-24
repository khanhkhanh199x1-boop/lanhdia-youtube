export const STAFF_ROLES = {
  leader: { label: 'Leader', hint: 'Trưởng nhóm', summary: 'Sửa thông tin vận hành, quản lý mọi bản nháp trên kênh được giao.' },
  manager: { label: 'Channel Manager', hint: 'Quản lý kênh', summary: 'Sửa thông tin vận hành và quản lý bản nháp của mình.' },
  editor: { label: 'Editor', hint: 'Dựng phim/Biên tập', summary: 'Xem kênh, soạn bản nháp của mình và mở YouTube Studio nếu đã có quyền trên YouTube.' },
  viewer: { label: 'Viewer', hint: 'Chỉ xem', summary: 'Xem kênh và bản nháp được phân công; không thể sửa.' },
} as const;

export type StaffRole = keyof typeof STAFF_ROLES;
export type ChannelGrant = { channelId: string; level: 'view' | 'role' };
export type StaffAccess = { staffRole: StaffRole; grants: ChannelGrant[] };
export type TeamMember = StaffAccess & {
  uid: string; email: string; displayName: string; teamName: string; joinedAt: number;
};
export type InviteStatus = 'pending' | 'used' | 'revoked' | 'expired' | 'legacy';
export type TeamInvite = StaffAccess & {
  id: string; email: string; status: InviteStatus; createdAt: number; expiresAt: number; teamName: string;
};
export type TeamChannel = { id: string; channelName: string; channelId: string };
export type ChannelCapabilities = { editChannel: boolean; writeDraft: boolean; manageDrafts: boolean };
export type AssignedChannel = TeamChannel & { rowIndex: number; niche: string; schedule: string; capabilities?: ChannelCapabilities };
export type VideoDraft = {
  id: string; title: string; description: string; updatedAt: number; canEdit: boolean;
};

export const MAX_CHANNEL_GRANTS = 100;
export const INVITE_DURATION_MS = 7 * 24 * 60 * 60 * 1000;
export const INVITE_TOKEN = /^[A-Za-z0-9_-]{32}$/;
export const FIRESTORE_ID = /^[A-Za-z0-9_-]{1,128}$/;
export const STAFF_ROUTES = ['/channels', '/videos', '/seo'] as const;

export function isStaffRole(value: unknown): value is StaffRole {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(STAFF_ROLES, value);
}

export function displayStaffRole(value: unknown): StaffRole {
  return isStaffRole(value) ? value : 'viewer';
}

export function normalizeInviteEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const email = value.trim().toLowerCase();
  return email.length <= 254 && /^[a-z0-9.!#$%&'*+\/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/.test(email) && email.split('@')[0].length <= 64 ? email : null;
}

export function parseChannelGrants(value: unknown): ChannelGrant[] | null {
  if (!Array.isArray(value) || value.length > MAX_CHANNEL_GRANTS) return null;
  const seen = new Set<string>();
  const result: ChannelGrant[] = [];
  for (const grant of value) {
    if (!grant || typeof grant.channelId !== 'string' || !FIRESTORE_ID.test(grant.channelId) || seen.has(grant.channelId) || (grant.level !== 'view' && grant.level !== 'role')) return null;
    seen.add(grant.channelId);
    result.push({ channelId: grant.channelId, level: grant.level });
  }
  return result;
}

export function staffCapabilities(role: StaffRole, level: ChannelGrant['level'] | undefined, readOnly: boolean): ChannelCapabilities {
  const writable = level === 'role' && !readOnly && role !== 'viewer';
  return { editChannel: writable && (role === 'leader' || role === 'manager'), writeDraft: writable, manageDrafts: writable && role === 'leader' };
}

export function inviteStatus(invite: { status?: unknown; expiresAt?: unknown; email?: unknown; staffRole?: unknown }, now = Date.now()): InviteStatus {
  if (invite.status === 'used') return 'used';
  if (invite.status !== 'active') return 'revoked';
  if (typeof invite.expiresAt !== 'number' || !Number.isFinite(invite.expiresAt) || invite.expiresAt <= now) return 'expired';
  if (!normalizeInviteEmail(invite.email) || !isStaffRole(invite.staffRole)) return 'legacy';
  return 'pending';
}
