import { CHANNEL_ID } from './channel-target';

export const PROFILE_KEY = /^[a-f0-9]{32}$/;
export const WORKSPACE_ID = /^[\w-]{1,128}$/;
export const PROFILE_DIRECTORY = /^(?:Default|Profile [1-9][0-9]{0,3})$/;
export const CHROME_VIEWS = { studio: 'Studio', channel: 'Trang kênh', content: 'Nội dung', analytics: 'Số liệu phân tích' } as const;
export type ChromeView = keyof typeof CHROME_VIEWS;
export type ChromeLink = { profileKey: string; directory: string; syncedAt: number };
export type Capture = { ticket: string; workspace: string; channelId: string; profileKey: string; directory: string };
export type HubStatus = { profile: string; dashboard: 'this' | 'other' | 'different-workspace' | 'unset'; pending: number };
export type HubReply<T = unknown> = { ok: true; data: T } | { ok: false; code: string };

export function readCaptureHash(hash: string) {
  return /^#chrome-sync=([a-f0-9]{32})$/.exec(hash)?.[1] || null;
}
export function studioCapture(url?: string) {
  if (!url || url.length > 2000) return null;
  try {
    const u = new URL(url);
    const [, section, channelId] = u.pathname.split('/');
    if (u.origin !== 'https://studio.youtube.com' || u.username || u.password || section !== 'channel' || !CHANNEL_ID.test(channelId || '')) return null;
    return { channelId };
  } catch { return null; }
}
export function isChromeView(value: unknown): value is ChromeView {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(CHROME_VIEWS, value);
}
