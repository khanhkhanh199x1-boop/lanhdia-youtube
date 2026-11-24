import type { ChromeLink } from './chrome-hub';
import type { ChannelRow } from './sheet-parser';
import { CHANNEL_ID, normalizeChromeProfile, parseChannelTarget, targetUrl, type ChannelTarget } from './channel-target';
import { ApiFault } from './server-http';

export const CHANNEL_STATES = { active: 'Đang hoạt động', paused: 'Tạm dừng', archived: 'Lưu trữ' } as const;
export const CHANNEL_CATEGORIES = {
  entertainment: 'Giải trí', music: 'Âm nhạc', film: 'Phim & hoạt hình', gaming: 'Trò chơi', education: 'Giáo dục',
  tech: 'Khoa học & công nghệ', lifestyle: 'Phong cách sống', travel: 'Du lịch', news: 'Tin tức', sports: 'Thể thao', other: 'Khác',
} as const;
export type ChannelRecord = ChannelRow & {
  id: string;
  chromeLink?: ChromeLink;
  profileLabel?: string; chromeProfile?: string; handle?: string; country?: string;
  category?: keyof typeof CHANNEL_CATEGORIES; channelUrl?: string;
  subscribers?: number | null; videoCount?: number | null; viewCount?: number | null; watchHours12m?: number | null;
  copyrightStrikes?: number | null; communityStrikes?: number | null;
  state?: keyof typeof CHANNEL_STATES; monetized?: boolean | null; autoMetadata?: boolean;
};
export type ChannelMetadata = {
  channelId: string; channelName: string; handle?: string; country?: string;
  subscribers?: number; videoCount?: number; viewCount?: number; hiddenSubscribers: boolean; fetchedAt: number;
};
export type ChannelForm = Partial<Omit<ChannelRecord, 'id' | 'chromeLink'>>;

const STRINGS = { stt: 30, channelName: 160, channelId: 100, gmail: 254, proxy: 300, bktStatus: 80, niche: 120,
  videoFolder: 1000, schedule: 160, note: 2000, profileLabel: 100, chromeProfile: 40, handle: 100, country: 2, category: 40,
  channelUrl: 600, state: 24 } as const;
const NUMBERS = ['subscribers', 'videoCount', 'viewCount', 'watchHours12m', 'copyrightStrikes', 'communityStrikes'] as const;
const invalid = (message: string) => new ApiFault(400, 'INVALID_CHANNEL', message);

export function cleanChannelForm(input: unknown, existing?: ChannelForm): ChannelForm {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw invalid('Dữ liệu kênh không hợp lệ.');
  const body = input as Record<string, unknown>;
  const patch: ChannelForm = {};
  for (const [key, limit] of Object.entries(STRINGS)) {
    if (!Object.prototype.hasOwnProperty.call(body, key)) continue;
    const value = body[key];
    if (typeof value !== 'string' || value.length > limit) throw invalid('Một trường văn bản không hợp lệ hoặc quá dài.');
    Object.assign(patch, { [key]: value.trim() });
  }
  for (const key of NUMBERS) {
    const value = body[key];
    if (value === undefined) continue;
    if (value !== null && (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > Number.MAX_SAFE_INTEGER ||
      (key !== 'watchHours12m' && !Number.isSafeInteger(value)))) throw invalid('Số liệu phải là số không âm hợp lệ.');
    patch[key] = value as number | null;
  }
  for (const key of ['monetized', 'autoMetadata'] as const) {
    const value = body[key];
    if (value === undefined) continue;
    if (key === 'monetized' && value === null) patch.monetized = null;
    else if (typeof value === 'boolean') patch[key] = value;
    else throw invalid('Trạng thái kênh không hợp lệ.');
  }
  if (patch.channelId && !CHANNEL_ID.test(patch.channelId) && patch.channelId !== existing?.channelId) throw invalid('ID kênh phải có dạng UC… gồm 24 ký tự.');
  // Replacing a real ID would move grants and drafts to a different channel.
  if (patch.channelId !== undefined && existing?.channelId && CHANNEL_ID.test(existing.channelId) && patch.channelId !== existing.channelId) {
    throw new ApiFault(409, 'CHANNEL_ID_FIXED', 'Không thể đổi ID của kênh đã lưu. Hãy thêm kênh khác để giữ nguyên phân quyền và bản nháp.');
  }
  if (patch.handle) {
    const target = parseChannelTarget(patch.handle);
    if (!patch.handle.startsWith('@') || target?.kind !== 'handle') throw invalid('Handle phải bắt đầu bằng @, ví dụ @kenhcuatoi.');
    patch.handle = target.value;
  }
  if (patch.channelUrl) {
    const target = parseChannelTarget(patch.channelUrl);
    if (!target) throw invalid('URL kênh phải là đường dẫn YouTube hợp lệ.');
    const currentId = patch.channelId ?? existing?.channelId;
    if (target.kind === 'id' && currentId && CHANNEL_ID.test(currentId) && target.value !== currentId) throw invalid('URL và ID không cùng một kênh.');
    patch.channelUrl = targetUrl(target);
  }
  if (patch.chromeProfile) {
    patch.chromeProfile = normalizeChromeProfile(patch.chromeProfile);
    if (!patch.chromeProfile) throw invalid('Tên thư mục Chrome phải là Default hoặc Profile kèm số (ví dụ Profile 48).');
  }
  if (patch.country) {
    patch.country = patch.country.toUpperCase();
    if (!/^[A-Z]{2}$/.test(patch.country)) throw invalid('Mã quốc gia không hợp lệ.');
  }
  if (patch.category && !Object.prototype.hasOwnProperty.call(CHANNEL_CATEGORIES, patch.category)) throw invalid('Danh mục không hợp lệ.');
  if (patch.state && !Object.prototype.hasOwnProperty.call(CHANNEL_STATES, patch.state)) throw invalid('Trạng thái không hợp lệ.');
  if (!existing && !patch.channelName) throw invalid('Vui lòng nhập tên kênh.');
  if (patch.channelName === '' && existing?.channelName) throw invalid('Không để trống tên kênh.');
  return patch;
}

export function savedTarget(row: ChannelForm): ChannelTarget | null {
  return parseChannelTarget(row.channelId) ?? parseChannelTarget(row.handle) ?? parseChannelTarget(row.channelUrl);
}

export function sameTarget(a: ChannelTarget, b: ChannelTarget) {
  return a.kind === b.kind && (a.kind === 'id' ? a.value === b.value : a.value.toLowerCase() === b.value.toLowerCase());
}

export function matchesChannel(a: ChannelForm, b: ChannelForm) {
  const aa = savedTarget(a), bb = savedTarget(b);
  if (!aa || !bb) return false;
  return aa.kind === bb.kind ? sameTarget(aa, bb) : Boolean(a.handle && b.handle && a.handle.toLowerCase() === b.handle.toLowerCase());
}

export const CHANNELS_MAX = 2000;
