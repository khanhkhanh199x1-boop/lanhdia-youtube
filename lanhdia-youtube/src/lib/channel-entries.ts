import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from './firebase-admin';
import { CHANNELS_MAX, cleanChannelForm, matchesChannel, type ChannelMetadata, type ChannelForm } from './channel-record';
import { parseChannelTarget, targetUrl } from './channel-target';
import { ApiFault } from './server-http';
import type { ChannelRow } from './sheet-parser';

const defaults: ChannelRow = { rowIndex: 0, stt: '', channelName: '', channelId: '', gmail: '', proxy: '', bktStatus: '', niche: '', videoFolder: '', schedule: '', note: '' };
const full = () => new ApiFault(409, 'CHANNEL_LIMIT', `Workspace đã đạt giới hạn ${CHANNELS_MAX} kênh.`);

export async function saveChannelRecord(tenantId: string, body: unknown, docId?: string) {
  const db = adminDb();
  const collection = db.collection('channels');
  if (docId && !/^[\w-]{1,128}$/.test(docId)) throw new ApiFault(404, 'NOT_FOUND', 'Không tìm thấy kênh.');
  const ref = docId ? collection.doc(docId) : collection.doc();
  return db.runTransaction(async (tx) => {
    const prior = docId ? (await tx.get(ref)).data() : undefined;
    if (docId && (!prior || prior.tenantId !== tenantId)) throw new ApiFault(404, 'NOT_FOUND', 'Không tìm thấy kênh trong workspace này.');
    const patch = cleanChannelForm(body, prior as ChannelForm | undefined);
    const identityChanged = !docId || (['channelId', 'handle', 'channelUrl'] as const).some((key) => patch[key] !== undefined && patch[key] !== (prior?.[key] || ''));
    if (identityChanged) {
      const target = parseChannelTarget(patch.channelId) ?? parseChannelTarget(patch.channelUrl) ?? parseChannelTarget(patch.handle);
      if (target?.kind === 'id' && !prior?.channelId) patch.channelId = target.value;
      if (target && !patch.channelUrl) patch.channelUrl = targetUrl(target);
      const rows = await tx.get(collection.where('tenantId', '==', tenantId).select('channelId', 'handle', 'channelUrl').limit(CHANNELS_MAX + 1));
      if (!docId && rows.size >= CHANNELS_MAX) throw full();
      if (rows.docs.some((doc) => doc.id !== ref.id && matchesChannel(doc.data() as ChannelForm, { ...prior, ...patch }))) {
        throw new ApiFault(409, 'DUPLICATE_CHANNEL', 'Kênh này đã có trong workspace. Hãy mở kênh đó để cập nhật.');
      }
    }
    const data = { ...(!docId && defaults), ...patch, tenantId, updatedAt: Date.now() };
    if (docId) tx.update(ref, data); else tx.create(ref, data);
    return { ...prior, ...data, id: ref.id };
  });
}

function sheetChannelKey(value: unknown) {
  if (typeof value !== 'string') return '';
  const target = parseChannelTarget(value);
  return target?.kind === 'id' ? target.value : value.trim();
}

// Imports never delete saved channels. Match unique IDs, not row position; retain owner fields and grants.
export async function mergeSheetChannels(tenantId: string, rows: ChannelRow[]) {
  if (rows.length > 450) throw new ApiFault(400, 'SHEET_TOO_LARGE', 'Mỗi lần đồng bộ tối đa 450 dòng. Hãy chia Sheet thành các tab nhỏ hơn.');
  const db = adminDb(), collection = db.collection('channels');
  return db.runTransaction(async (tx) => {
    const before = await tx.get(collection.where('tenantId', '==', tenantId).limit(CHANNELS_MAX + 1));
    const byId = new Map<string, (typeof before.docs)[number] | null>();
    for (const doc of before.docs) {
      const key = sheetChannelKey(doc.get('channelId'));
      if (key) byId.set(key, byId.has(key) ? null : doc);
    }
    const count = new Map<string, number>();
    for (const row of rows) {
      const key = sheetChannelKey(row.channelId);
      count.set(key, (count.get(key) || 0) + 1);
    }
    let created = 0, updated = 0, skipped = 0;
    for (const raw of rows) {
      const key = sheetChannelKey(raw.channelId);
      if (key && (count.get(key)! > 1 || byId.get(key) === null)) { skipped++; continue; }
      const row = { ...raw, channelId: key };
      // A row with no identity may be retained, but never matched to a different row by index alone.
      const match = key ? byId.get(key) : before.docs.find((doc) => Object.entries(row).every(([k, v]) => (doc.get(k) ?? '') === v));
      if (match) {
        const nonEmpty = Object.fromEntries(Object.entries(row).filter(([, value]) => value !== ''));
        tx.set(match.ref, { ...nonEmpty, updatedAt: Date.now() }, { merge: true });
        updated++;
      } else {
        if (before.size + created >= CHANNELS_MAX) throw full();
        tx.create(collection.doc(), { ...row, tenantId, updatedAt: Date.now() });
        created++;
      }
    }
    return { count: created + updated, created, updated, skipped };
  });
}

// Only the dedicated sync endpoint can set launch metadata. Match by a canonical UC ID;
// a handle-only record is upgraded only when the official API proves that relationship.
// Public API fields are previews, not a stored second copy of the YouTube stats/profile.
export async function syncChromeChannel(tenantId: string, input: { channelId: string; profileKey: string; directory: string }, meta?: ChannelMetadata) {
  const db = adminDb(), collection = db.collection('channels');
  return db.runTransaction(async (tx) => {
    const rows = await tx.get(collection.where('tenantId', '==', tenantId).select('channelId', 'handle', 'channelUrl').limit(CHANNELS_MAX + 1));
    const handle = parseChannelTarget(meta?.handle);
    const matches = rows.docs.filter((doc) => {
      const data = doc.data() as ChannelForm;
      const ids = [parseChannelTarget(data.channelId), parseChannelTarget(data.channelUrl)].filter((t) => t?.kind === 'id');
      if (ids.length) return ids.some((t) => t?.value === input.channelId);
      const known = parseChannelTarget(data.handle) ?? parseChannelTarget(data.channelUrl);
      return handle?.kind === 'handle' && known?.kind === 'handle' && handle.value.toLowerCase() === known.value.toLowerCase();
    });
    if (matches.length > 1) throw new ApiFault(409, 'DUPLICATE_CHANNEL', 'Có nhiều bản ghi khớp ID này. Xử lý kênh trùng trước khi ghép Chrome.');
    const ref = matches[0]?.ref ?? collection.doc();
    const prior = matches.length ? (await tx.get(ref)).data() : undefined;
    if (!prior && rows.size >= CHANNELS_MAX) throw full();
    if (prior?.chromeLink && prior.chromeLink.profileKey !== input.profileKey) {
      throw new ApiFault(409, 'CHROME_PROFILE_CONFLICT', 'Kênh đã ghép với hồ sơ khác. Nếu muốn chuyển, chọn Gỡ ghép Chrome ở kênh cũ rồi nhận lại kênh đang chờ.');
    }
    const fallback = `Kênh ${input.channelId}`;
    const channelName = prior?.channelName || fallback;
    if (prior && [parseChannelTarget(prior.channelId), parseChannelTarget(prior.channelUrl)].some((t) => t?.kind === 'id' && t.value !== input.channelId)) {
      throw new ApiFault(409, 'CHANNEL_ID_FIXED', 'ID và URL lưu trên kênh này không khớp. Hãy kiểm tra trước khi đồng bộ.');
    }
    const now = Date.now();
    const data = {
      ...(!prior && { ...defaults, state: 'active' }),
      channelName, channelId: input.channelId, channelUrl: prior?.channelUrl || targetUrl({ kind: 'id', value: input.channelId }),
      autoMetadata: prior?.autoMetadata ?? true,
      chromeLink: { profileKey: input.profileKey, directory: input.directory, syncedAt: now },
      tenantId, updatedAt: now,
    };
    if (prior) tx.update(ref, data); else tx.create(ref, data);
    return { channel: { ...prior, ...data, id: ref.id }, action: prior ? 'updated' : 'created' };
  });
}

export async function unlinkChromeChannel(tenantId: string, docId: string, profileKey: string) {
  if (!/^[\w-]{1,128}$/.test(docId)) throw new ApiFault(404, 'NOT_FOUND', 'Không tìm thấy kênh.');
  const db = adminDb(), ref = db.collection('channels').doc(docId);
  return db.runTransaction(async (tx) => {
    const prior = (await tx.get(ref)).data();
    if (!prior || prior.tenantId !== tenantId) throw new ApiFault(404, 'NOT_FOUND', 'Không tìm thấy kênh trong workspace này.');
    if (prior.chromeLink?.profileKey !== profileKey) throw new ApiFault(409, 'LINK_CHANGED', 'Liên kết vừa thay đổi. Hãy tải lại danh sách.');
    tx.update(ref, { chromeLink: FieldValue.delete(), updatedAt: Date.now() });
    return { removed: true };
  });
}
