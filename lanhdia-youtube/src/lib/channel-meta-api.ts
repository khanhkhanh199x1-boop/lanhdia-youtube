import type { Express, RequestHandler } from 'express';
import { adminDb } from './firebase-admin';
import { savedTarget, type ChannelForm, type ChannelMetadata } from './channel-record';
import { CHANNEL_ID, parseChannelTarget, type ChannelTarget } from './channel-target';
import { ApiFault, ok, wrap } from './server-http';
import { syncChromeChannel, unlinkChromeChannel } from './channel-entries';
import { PROFILE_DIRECTORY, PROFILE_KEY } from './chrome-hub';

const CACHE_MS = 8 * 60_000;
const API_URL = 'https://www.googleapis.com/youtube/v3/channels';
const unavailable = () => new ApiFault(503, 'META_UNAVAILABLE', 'Chưa cấu hình YouTube Data API. Bạn vẫn có thể lưu kênh và nhập số liệu thủ công.');
const upstreamError = () => new ApiFault(502, 'META_FAILED', 'Không lấy được dữ liệu từ YouTube. Vui lòng thử lại sau.');
const keyOf = (t: ChannelTarget) => t.kind === 'id' ? t.value : t.value.toLowerCase();

function metadata(value: any): ChannelMetadata | null {
  if (typeof value?.id !== 'string' || !CHANNEL_ID.test(value.id)) return null;
  const snippet = value.snippet;
  const stats = value.statistics;
  if (typeof snippet?.title !== 'string' || !snippet.title.trim()) return null;
  const count = (v: unknown) => typeof v === 'string' && /^\d+$/.test(v) && Number.isSafeInteger(Number(v)) ? Number(v) : undefined;
  const handle = typeof snippet.customUrl === 'string' && snippet.customUrl.startsWith('@') ? parseChannelTarget(snippet.customUrl) : null;
  const hidden = stats?.hiddenSubscriberCount === true;
  return { channelId: value.id, channelName: snippet.title.trim().slice(0, 160),
    handle: handle?.kind === 'handle' ? handle.value : undefined,
    country: typeof snippet.country === 'string' && /^[A-Z]{2}$/.test(snippet.country) ? snippet.country : undefined,
    subscribers: hidden ? undefined : count(stats?.subscriberCount), videoCount: count(stats?.videoCount), viewCount: count(stats?.viewCount),
    hiddenSubscribers: hidden, fetchedAt: Date.now() };
}

export interface MetadataProvider {
  enabled(): boolean;
  read(targets: ChannelTarget[]): Promise<Map<string, ChannelMetadata>>;
}

export function officialYouTubeMetadata(fetcher = globalThis.fetch, getKey = () => process.env.YOUTUBE_DATA_API_KEY?.trim()): MetadataProvider {
  const cache = new Map<string, { at: number; data?: ChannelMetadata }>();
  const query = async (params: Record<string, string>) => {
    const key = getKey();
    if (!key) throw unavailable();
    const url = new URL(API_URL);
    url.search = new URLSearchParams({ part: 'snippet,statistics', fields: 'items(id,snippet(title,customUrl,country),statistics(subscriberCount,hiddenSubscriberCount,videoCount,viewCount))', ...params }).toString();
    try {
      const response = await fetcher(url, { headers: { 'X-Goog-Api-Key': key }, signal: AbortSignal.timeout(6500), redirect: 'error' });
      if (response.status === 429) throw new ApiFault(429, 'META_QUOTA', 'YouTube đang giới hạn số lượt tra cứu. Vui lòng thử lại sau.');
      if (response.status === 400 || response.status === 403) {
        const json = await response.json().catch(() => null) as { error?: { errors?: { reason?: string }[] } } | null;
        const reason = json?.error?.errors?.[0]?.reason;
        if (reason === 'quotaExceeded' || reason === 'dailyLimitExceeded' || reason === 'rateLimitExceeded') {
          throw new ApiFault(429, 'META_QUOTA', 'Đã hết hạn mức YouTube Data API. Vui lòng thử lại sau.');
        }
        throw new ApiFault(503, 'META_KEY_REJECTED', 'YouTube từ chối cấu hình API. Quản trị viên cần kiểm tra lại khóa và quyền API.');
      }
      if (!response.ok) throw upstreamError();
      const body = await response.json() as { items?: unknown };
      if (body.items !== undefined && !Array.isArray(body.items)) throw upstreamError();
      return (body.items as unknown[] || []).map(metadata).filter((item): item is ChannelMetadata => Boolean(item));
    } catch (error) { throw error instanceof ApiFault ? error : upstreamError(); }
  };
  return {
    enabled: () => Boolean(getKey()),
    async read(targets) {
      if (!getKey()) throw unavailable();
      const now = Date.now();
      for (const [key, entry] of cache) if (now - entry.at >= CACHE_MS) cache.delete(key);
      const unique = [...new Map(targets.map((target) => [keyOf(target), target])).values()];
      const result = new Map<string, ChannelMetadata>();
      const missing = unique.filter((target) => !cache.has(keyOf(target)));
      const ids = missing.filter((t) => t.kind === 'id').map((t) => t.value);
      const remember = (key: string, data?: ChannelMetadata) => {
        if (cache.size >= 1600) cache.delete(cache.keys().next().value!);
        cache.set(key, { at: now, data });
        if (data) result.set(key, data);
      };
      for (const target of unique) {
        const item = cache.get(keyOf(target))?.data;
        if (item) result.set(keyOf(target), item);
      }
      if (ids.length) {
        const found = new Map((await query({ id: ids.join(',') })).map((item) => [item.channelId, item]));
        for (const id of ids) remember(id, found.get(id));
      }
      const handles = missing.filter((t) => t.kind === 'handle');
      // Single handle lookups resolve to a canonical ID. Batch refresh uses saved IDs only.
      for (const target of handles) {
        const item = (await query({ forHandle: target.value }))[0];
        if (item) remember(item.channelId, item);
        remember(keyOf(target), item);
      }
      return result;
    },
  };
}

export function registerChannelMetaRoutes(app: Express, auth: RequestHandler, writable: RequestHandler, provider: MetadataProvider) {
  const hits = new Map<string, { at: number; count: number }>();
  const limit = (uid: string) => {
    const now = Date.now();
    if (hits.size > 1000) for (const [id, hit] of hits) if (now - hit.at > 60_000) hits.delete(id);
    let hit = hits.get(uid);
    if (!hit || now - hit.at >= 60_000) { hit = { at: now, count: 0 }; hits.set(uid, hit); }
    if (++hit.count > 24) throw new ApiFault(429, 'META_RATE_LIMIT', 'Quá nhiều lượt làm mới. Vui lòng chờ một phút.');
  };
  app.post('/api/channels/chrome-sync', auth, writable, wrap(async (req, res) => {
    const { workspace, channelId, profileKey, directory } = req.body || {};
    if (workspace !== req.profile!.tenantId) throw new ApiFault(403, 'WORKSPACE_MISMATCH', 'Yêu cầu không dành cho workspace đang đăng nhập.');
    if (typeof channelId !== 'string' || !CHANNEL_ID.test(channelId) || typeof profileKey !== 'string' || !PROFILE_KEY.test(profileKey) ||
        typeof directory !== 'string' || !PROFILE_DIRECTORY.test(directory)) {
      throw new ApiFault(400, 'INVALID_CAPTURE', 'Dữ liệu đồng bộ Chrome không hợp lệ. Bấm lại tiện ích tại Studio.');
    }
    limit(workspace);
    let meta: ChannelMetadata | undefined;
    let metaStatus = 'unconfigured';
    if (provider.enabled()) {
      try {
        meta = (await provider.read([{ kind: 'id', value: channelId }])).get(channelId);
        if (meta?.channelId !== channelId) meta = undefined;
        metaStatus = meta ? 'ok' : 'not-found';
      } catch { metaStatus = 'unavailable'; }
    }
    const saved = await syncChromeChannel(workspace, { channelId, profileKey, directory }, meta);
    ok(res, { ...saved, meta: meta ?? null, metaStatus }, saved.action === 'created' ? 'Đã thêm kênh từ Chrome.' : 'Đã đồng bộ kênh từ Chrome.');
  }));
  app.delete('/api/channels/:id/chrome-link', auth, writable, wrap(async (req, res) => {
    const profileKey = req.body?.profileKey;
    if (typeof profileKey !== 'string' || !PROFILE_KEY.test(profileKey)) throw new ApiFault(400, 'INVALID_CAPTURE', 'Liên kết Chrome không hợp lệ.');
    ok(res, await unlinkChromeChannel(req.profile!.tenantId, req.params.id, profileKey), 'Đã gỡ ghép Chrome.');
  }));
  app.get('/api/channels/meta/status', auth, wrap(async (_req, res) => ok(res, { configured: provider.enabled() })));
  app.post('/api/channels/meta/lookup', auth, writable, wrap(async (req, res) => {
    const target = parseChannelTarget(req.body?.target);
    if (!target) throw new ApiFault(400, 'INVALID_TARGET', 'Nhập ID UC…, @handle hoặc URL kênh YouTube/Studio hợp lệ.');
    limit(req.profile!.tenantId);
    const item = (await provider.read([target])).get(keyOf(target));
    if (!item) throw new ApiFault(404, 'META_NOT_FOUND', 'Không tìm thấy kênh công khai này trên YouTube.');
    ok(res, item);
  }));
  app.post('/api/channels/meta/refresh', auth, wrap(async (req, res) => {
    const ids = req.body?.ids as unknown;
    if (!Array.isArray(ids) || !ids.length || ids.length > 50 || ids.some((id) => typeof id !== 'string' || !/^[\w-]{1,128}$/.test(id))) {
      throw new ApiFault(400, 'INVALID_CHANNELS', 'Chỉ làm mới tối đa 50 kênh đã lưu mỗi lượt.');
    }
    if (!provider.enabled()) throw unavailable();
    limit(req.profile!.tenantId);
    const db = adminDb();
    const docs = await db.getAll(...[...new Set(ids)].map((id) => db.collection('channels').doc(id)));
    const owned = docs.map((doc) => {
      if (!doc.exists || doc.get('tenantId') !== req.profile!.tenantId) throw new ApiFault(404, 'CHANNEL_NOT_FOUND', 'Có kênh không tồn tại trong workspace này.');
      return { id: doc.id, target: savedTarget(doc.data() as ChannelForm) };
    });
    const targets = owned.flatMap(({ target }) => target?.kind === 'id' ? [target] : []);
    const found = targets.length ? await provider.read(targets) : new Map<string, ChannelMetadata>();
    ok(res, { items: owned.map(({ id, target }) => ({ id, meta: target?.kind === 'id' ? found.get(target.value) ?? null : null })) });
  }));
}
