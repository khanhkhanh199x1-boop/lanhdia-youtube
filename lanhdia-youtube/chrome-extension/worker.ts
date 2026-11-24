import { HOST_NAME, HUB_ORIGIN, HUB_VERSION } from '../src/lib/chrome-hub-config';
import { PROFILE_DIRECTORY, PROFILE_KEY, WORKSPACE_ID, isChromeView, studioCapture, type HubReply } from '../src/lib/chrome-hub';
import { CHANNEL_ID } from '../src/lib/channel-target';

type Msg = Record<string, unknown>;
const bad = (code: string) => ({ ok: false as const, code });
const yes = (data: unknown) => ({ ok: true as const, data });
const obj = (input: unknown): Msg => input !== null && typeof input === 'object' && !Array.isArray(input) ? input as Msg : {};
const field = (data: Msg, key: string) => typeof data[key] === 'string' ? data[key] as string : '';
const random = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');

let profile: Promise<string> | undefined;
function profileKey() {
  if (!profile) profile = (async () => {
    const { profileKey } = await chrome.storage.local.get(['profileKey']);
    if (typeof profileKey === 'string' && PROFILE_KEY.test(profileKey)) return profileKey;
    const key = random(); await chrome.storage.local.set({ profileKey: key }); return key;
  })().catch((error) => { profile = undefined; throw error; });
  return profile;
}
async function native(op: string, fields: Msg = {}): Promise<HubReply> {
  const source = await profileKey();
  return new Promise((resolve) => {
    chrome.runtime.sendNativeMessage(HOST_NAME, { ...fields, source, op }, (result) => {
      const failed = chrome.runtime.lastError;
      const response = obj(result);
      resolve(failed ? bad('HELPER_MISSING') : response.ok === true ? yes(response.data) : bad(field(response, 'code') || 'HELPER_ERROR'));
    });
  });
}
async function setup(capture?: {channelId: string}, code?: string) {
  const ticket = random();
  await chrome.storage.session.set({ ['setup-' + ticket]: { capture, code, until: Date.now() + 10 * 60_000 } });
  // Keep only a small number of explicit local setup requests.
  const { setupTickets } = await chrome.storage.session.get(['setupTickets']);
  const ids = [...(Array.isArray(setupTickets) ? setupTickets.filter((t) => typeof t === 'string') : []), ticket];
  await chrome.storage.session.remove(ids.slice(0, -6).map((t) => 'setup-' + t));
  await chrome.storage.session.set({ setupTickets: ids.slice(-6) });
  await chrome.tabs.create({ url: chrome.runtime.getURL('setup.html') + '#' + ticket });
  return yes({ opened: true });
}
async function badge(tab: Tab, text: string, color: string) {
  if (tab.id === undefined) return;
  const tabId = tab.id;
  await Promise.all([chrome.action.setBadgeText({ tabId, text }), chrome.action.setBadgeBackgroundColor({ tabId, color })]).catch(() => {});
}
chrome.action.onClicked.addListener((tab) => {
  void (async () => {
    if (tab.incognito) return;
    const channel = studioCapture(tab.url);
    if (!channel) { await setup(); return; }
    await badge(tab, '…', '#334155');
    const result = await native('capture', channel);
    if (result.ok) { await badge(tab, '✓', '#047857'); return; }
    await badge(tab, '!', '#b45309');
    await setup(channel, result.code);
  })().catch(() => void badge(tab, '!', '#b91c1c'));
});

async function fromSetup(message: Msg) {
  const ticket = field(message, 'ticket');
  if (!PROFILE_KEY.test(ticket)) return bad('SETUP_EXPIRED');
  const storageKey = 'setup-' + ticket;
  const stored = obj((await chrome.storage.session.get([storageKey]))[storageKey]);
  if (typeof stored.until !== 'number' || stored.until <= Date.now()) return bad('SETUP_EXPIRED');
  switch (message.action) {
    case 'setup-state': {
      const result = await native('local');
      return result.ok ? yes({ ...obj(result.data), capture: stored.capture, reason: stored.code }) : result;
    }
    case 'pair-start': {
      const directory = field(message, 'directory');
      return PROFILE_DIRECTORY.test(directory) ? native('pair-start', { directory }) : bad('PROFILE_NOT_FOUND');
    }
    case 'capture-now': {
      const capture = obj(stored.capture), channelId = field(capture, 'channelId');
      if (!CHANNEL_ID.test(channelId)) return bad('INVALID_REQUEST');
      const result = await native('capture', { channelId });
      if (result.ok) await chrome.storage.session.remove(storageKey);
      return result;
    }
    default: return bad('INVALID_REQUEST');
  }
}
chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (sender.id !== chrome.runtime.id || sender.url?.split('#')[0] !== chrome.runtime.getURL('setup.html') || sender.tab?.incognito) return;
  void fromSetup(obj(msg)).then(reply, () => reply(bad('HELPER_ERROR')));
  return true;
});

async function fromSite(message: Msg, url: URL) {
  if (message.v !== HUB_VERSION) return bad('EXTENSION_VERSION');
  const ticket = field(message, 'ticket');
  if (url.pathname === '/chrome-verify') {
    if (message.action !== 'verify' || !PROFILE_KEY.test(ticket) || url.hash !== '#pair=' + ticket) return bad('INVALID_REQUEST');
    return native('pair-finish', { ticket });
  }
  const workspace = field(message, 'workspace');
  if (!WORKSPACE_ID.test(workspace)) return bad('INVALID_REQUEST');
  const isChannels = url.pathname === '/channels';
  if (isChannels) {
    switch (message.action) {
      case 'setup': return setup();
      case 'state': return native('state', { workspace });
      case 'dashboard': return native('dashboard', { workspace });
      case 'jobs': return native('jobs', { workspace });
      case 'read': case 'ack':
        return PROFILE_KEY.test(ticket) ? native(message.action, { ticket, workspace }) : bad('INVALID_REQUEST');
    }
  }
  const channelId = field(message, 'channelId'), key = field(message, 'profileKey');
  if (!CHANNEL_ID.test(channelId) || !PROFILE_KEY.test(key)) return bad('INVALID_REQUEST');
  if (message.action === 'open' && isChromeView(message.view)) return native('open', { workspace, channelId, profileKey: key, view: message.view });
  if (isChannels && message.action === 'unlink') return native('unlink', { workspace, channelId, profileKey: key });
  return bad('INVALID_REQUEST');
}
chrome.runtime.onMessageExternal.addListener((msg, sender, reply) => {
  if (sender.id || sender.tab?.incognito || !sender.url || sender.frameId !== 0 || sender.origin !== HUB_ORIGIN) return;
  let url: URL;
  try { url = new URL(sender.url); } catch { return; }
  if (url.origin !== HUB_ORIGIN || !['/channels', '/videos', '/chrome-verify'].includes(url.pathname)) return;
  void fromSite(obj(msg), url).then(reply, () => reply(bad('HELPER_ERROR')));
  return true;
});
