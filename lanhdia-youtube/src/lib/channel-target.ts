// Shared by the website, server and the Chrome extension. No network or page access here.
export const CHANNEL_ID = /^UC[A-Za-z0-9_-]{22}$/;
const HANDLE = /^[\p{L}\p{N}](?:[\p{L}\p{M}\p{N}._\-·]{0,28}[\p{L}\p{M}\p{N}])?$/u;
export type ChannelTarget = { kind: 'id' | 'handle'; value: string };
export type ChromeChannelImport = { target: ChannelTarget; title: string; profileLabel: string; chromeProfile: string };

export function parseChannelTarget(value: unknown): ChannelTarget | null {
  if (typeof value !== 'string' || value.length > 600) return null;
  const text = value.trim();
  if (CHANNEL_ID.test(text)) return { kind: 'id', value: text };
  if (text.startsWith('@') && HANDLE.test(text.slice(1))) return { kind: 'handle', value: text.normalize('NFC') };
  try {
    const url = new URL(/^(?:(?:www\.|m\.|studio\.)?youtube\.com)\//i.test(text) ? `https://${text}` : text);
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
    if (!['youtube.com', 'www.youtube.com', 'm.youtube.com', 'studio.youtube.com'].includes(url.hostname)) return null;
    const segments = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
    if (segments[0] === 'channel' && CHANNEL_ID.test(segments[1] || '')) return { kind: 'id', value: segments[1] };
    if (url.hostname !== 'studio.youtube.com' && segments[0]?.startsWith('@') && HANDLE.test(segments[0].slice(1))) {
      return { kind: 'handle', value: segments[0].normalize('NFC') };
    }
  } catch { /* not a channel link */ }
  return null;
}

export function targetUrl(target: ChannelTarget) {
  return `https://www.youtube.com/${target.kind === 'id' ? `channel/${target.value}` : `@${encodeURIComponent(target.value.slice(1))}`}`;
}

export function normalizeChromeProfile(value: string) {
  const text = value.trim();
  if (/^default$/i.test(text)) return 'Default';
  const match = text.match(/^profile\s+([1-9][0-9]{0,3})$/i);
  return match ? `Profile ${match[1]}` : '';
}

export function chromeImportHash(input: ChromeChannelImport) {
  return `#${new URLSearchParams({ chrome: '1', yt: input.target.value, title: input.title, label: input.profileLabel, profile: input.chromeProfile })}`;
}

export function readChromeImport(hash: string): ChromeChannelImport | null {
  if (!hash.startsWith('#chrome=1&') || hash.length > 3600) return null;
  const p = new URLSearchParams(hash.slice(1));
  const raw = p.get('yt');
  const target = parseChannelTarget(raw);
  if (!target || (target.kind === 'id' && target.value !== raw) || (target.kind === 'handle' && !raw?.startsWith('@'))) return null;
  const clean = (v: string | null, limit: number) => (v || '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, limit);
  return { target, title: clean(p.get('title'), 160), profileLabel: clean(p.get('label'), 100), chromeProfile: normalizeChromeProfile(clean(p.get('profile'), 40)) };
}
