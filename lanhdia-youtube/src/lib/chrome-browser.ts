import { CHROME_ID, HUB_ORIGIN, HUB_VERSION } from './chrome-hub-config';
import type { HubReply } from './chrome-hub';

// This is Chrome's webpage->extension channel, not a network or localhost request.
export function chromeHub<T>(action: string, args: Record<string, unknown> = {}): Promise<HubReply<T>> {
  type Runtime = { sendMessage(id: string, message: unknown, reply: (value: HubReply<T> | undefined) => void): void; lastError?: unknown };
  const runtime = (window as Window & { chrome?: { runtime?: Runtime } }).chrome?.runtime;
  const missing = { ok: false as const, code: 'EXTENSION_MISSING' };
  if (window.top !== window || location.origin !== HUB_ORIGIN || !runtime?.sendMessage) return Promise.resolve(missing);
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve({ ok: false, code: 'HELPER_ERROR' }), 8500);
    try {
      runtime.sendMessage(CHROME_ID, { ...args, action, v: HUB_VERSION }, (resp) => {
        const failed = runtime.lastError;
        clearTimeout(timer);
        resolve(!failed && resp && typeof resp.ok === 'boolean' ? resp : missing);
      });
    } catch { clearTimeout(timer); resolve(missing); }
  });
}
