import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { apiGet, apiPost, apiDelete, apiFetch, ApiError } from '../lib/api-client';
import { CHANNEL_CATEGORIES, CHANNEL_STATES, matchesChannel, savedTarget, type ChannelMetadata, type ChannelRecord } from '../lib/channel-record';
import { CHANNEL_ID, readChromeImport, targetUrl, type ChromeChannelImport } from '../lib/channel-target';
import { buildOpenFolderUrl, checkHelperHealth, openProtocol } from '../lib/protocol';
import { getAuthInstance } from '../lib/firebase';
import { useAuth } from '../context/AuthContext';
import AssignedChannelsPage from './AssignedChannelsPage';
import ChannelEditor from '../components/ChannelEditor';
import ChromeHubPanel from '../components/ChromeHubPanel';
import ChromeOpen from '../components/ChromeOpen';
import { chromeHub } from '../lib/chrome-browser';
import { PROFILE_KEY, readCaptureHash, type Capture } from '../lib/chrome-hub';
import { hubMessage } from '../lib/chrome-hub-messages';

const PAGE_SIZE = 30, REFRESH_MS = 15 * 60_000;
const format = new Intl.NumberFormat('vi-VN');
const message = (error: unknown, fallback: string) => error instanceof ApiError ? error.message : fallback;
const statsText = (n: number | null | undefined) => typeof n === 'number' ? format.format(n) : '—';
const strikes = (row: ChannelRecord) => (row.copyrightStrikes || 0) + (row.communityStrikes || 0);
const studio = (id: string) => `https://studio.youtube.com/channel/${id}`;

type Editing = { channel?: ChannelRecord; imported?: ChromeChannelImport };

export default function ChannelsPage() {
  return useAuth().profile?.role === 'staff' ? <AssignedChannelsPage /> : <OwnerChannelsPage />;
}

function OwnerChannelsPage() {
  const { assertWritable, isReadOnly, isRoot, profile } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const workspace = profile?.tenantId || '';
  const [channels, setChannels] = useState<ChannelRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [editor, setEditor] = useState<Editing>();
  const [sheetUrl, setSheetUrl] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [helper, setHelper] = useState<boolean | null>(null);
  const [helperBusy, setHelperBusy] = useState(false);
  const [extToken, setExtToken] = useState<string>('');
  const [extTokenBusy, setExtTokenBusy] = useState(false);
  const [extCopied, setExtCopied] = useState(false);
  const [extZipBusy, setExtZipBusy] = useState(false);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('');
  const [page, setPage] = useState(1);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [metadata, setMetadata] = useState<Record<string, ChannelMetadata | null>>({});
  const [refreshing, setRefreshing] = useState(0);
  const [metaError, setMetaError] = useState('');
  const [receiving, setReceiving] = useState(false);
  const [revision, setRevision] = useState(0);
  const [highlight, setHighlight] = useState('');
  const receivingRef = useRef(false);
  const handled = useRef('');

  const load = useCallback(async () => {
    setLoading(true);
    try { setChannels((await apiGet<{ items: ChannelRecord[] }>('/api/channels')).items); }
    catch (err) { setError(message(err, 'Không tải được danh sách kênh.')); }
    finally { setLoading(false); }
  }, []);
  const checkConfig = useCallback(async () => {
    try { setConfigured((await apiGet<{ configured: boolean }>('/api/channels/meta/status')).configured); }
    catch { setConfigured(null); }
  }, []);
  useEffect(() => { void load(); void checkConfig(); }, [load, checkConfig]);

  useEffect(() => {
    if (loading || !location.hash.startsWith('#chrome=')) return;
    const imported = readChromeImport(location.hash);
    navigate('/channels', { replace: true });
    if (!imported || !assertWritable()) { setError('Không thể nhập từ Chrome. Hãy mở đúng kênh và dùng tài khoản có quyền thêm kênh.'); return; }
    const channel = channels.find((c) => matchesChannel(c, imported.target.kind === 'id' ? { channelId: imported.target.value } : { handle: imported.target.value }));
    setEditor({ channel, imported });
  }, [assertWritable, channels, loading, location.hash, navigate]);

  const receive = useCallback(async (ticket?: string) => {
    if (receivingRef.current || !workspace || !assertWritable()) return;
    receivingRef.current = true;
    setReceiving(true); setError(''); setNotice('');
    let accepted = 0, last = '';
    const warnings: string[] = [];
    try {
      let tickets = ticket ? [ticket] : [];
      if (!ticket) {
        const queued = await chromeHub<string[]>('jobs', { workspace });
        if (!queued.ok) { setError(hubMessage(queued.code)); return; }
        tickets = queued.data.filter((id) => PROFILE_KEY.test(id)).slice(0, 12);
        if (!tickets.length) { setNotice('Không có kênh đang chờ trên máy này.'); return; }
      }
      for (const job of tickets) {
        try {
          const capture = await chromeHub<Capture>('read', { workspace, ticket: job });
          if (!capture.ok) { warnings.push(hubMessage(capture.code)); continue; }
          if (capture.data.workspace !== workspace || capture.data.ticket !== job) { warnings.push('Yêu cầu không dành cho trang trung tâm này.'); continue; }
          const saved = await apiPost<{ channel: ChannelRecord; action: 'created' | 'updated'; meta: ChannelMetadata | null; metaStatus: string }>('/api/channels/chrome-sync', capture.data);
          const ack = await chromeHub('ack', { workspace, ticket: job });
          const row = saved.channel;
          setChannels((old) => [row, ...old.filter((item) => item.id !== row.id)]);
          if (saved.meta) setMetadata((old) => ({ ...old, [row.id]: saved.meta }));
          setHighlight(row.id);
          if (!ack.ok && ack.code !== 'CAPTURE_EXPIRED') warnings.push('Kênh đã lưu nhưng máy chưa xác nhận liên kết. Hãy nhận lại kênh đang chờ.');
          if (saved.metaStatus !== 'ok') warnings.push(saved.metaStatus === 'unconfigured' ? 'ID và hồ sơ đã lưu. Bật YouTube Data API để tự điền số liệu công khai.' : 'Kênh đã lưu, nhưng chưa lấy được dữ liệu công khai. Có thể làm mới sau.');
          const label = row.channelName === `Kênh ${row.channelId}` ? saved.meta?.channelName || row.channelName : row.channelName;
          last = `${saved.action === 'created' ? 'Đã thêm' : 'Đã cập nhật'} “${label}” từ ${capture.data.directory}.`;
          accepted++;
        } catch (err) { warnings.push(message(err, 'Chưa nhận được kênh. Yêu cầu vẫn đang chờ trên máy.')); }
      }
      if (accepted) {
        setNotice(accepted === 1 ? last : `Đã nhận ${accepted} kênh từ Chrome. ${last}`);
        setQuery(''); setFilter(''); setPage(1);
      }
      if (warnings.length) setError([...new Set(warnings)].join(' '));
    } catch { setError('Không nhận được yêu cầu trên máy. Bấm Kiểm tra kết nối hoặc thử lại.'); }
    finally { receivingRef.current = false; setReceiving(false); setRevision((n) => n + 1); }
  }, [assertWritable, workspace]);
  useEffect(() => {
    const ticket = readCaptureHash(location.hash);
    if (loading || !ticket || handled.current === ticket || !workspace) return;
    handled.current = ticket;
    void receive(ticket);
    navigate('/channels', { replace: true });
  }, [loading, location.hash, navigate, receive, workspace]);

  const disconnect = async (row: ChannelRecord) => {
    if (!row.chromeLink || !assertWritable() || !window.confirm(`Gỡ ghép Chrome của “${row.channelName}”? Kênh, số liệu nhập và quyền nhân sự vẫn giữ nguyên.`)) return;
    try {
      const { profileKey } = row.chromeLink;
      await apiFetch(`/api/channels/${row.id}/chrome-link`, { method: 'DELETE', body: JSON.stringify({ profileKey }) });
      await chromeHub('unlink', { workspace, profileKey, channelId: row.channelId });
      setChannels((old) => old.map((item) => item.id === row.id ? { ...item, chromeLink: undefined } : item));
      setNotice('Đã gỡ ghép Chrome. Bấm tiện ích trong Studio ở hồ sơ muốn ghép mới.');
      setError(''); setEditor(undefined);
    } catch (err) { setError(message(err, 'Không gỡ được liên kết Chrome.')); }
  };

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return channels.filter((c) => (!q || [c.channelName, metadata[c.id]?.channelName, c.channelId, c.handle, metadata[c.id]?.handle, c.profileLabel, c.chromeProfile, c.chromeLink?.directory, c.gmail].some((v) => typeof v === 'string' && v.toLowerCase().includes(q))) &&
      (!filter || (filter === 'alert' ? strikes(c) > 0 : filter === 'sync' ? c.autoMetadata : filter === 'linked' ? Boolean(c.chromeLink) : filter === 'unlinked' ? !c.chromeLink : (c.state || 'active') === filter)));
  }, [channels, filter, metadata, query]);
  const pageCount = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const rows = visible.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  const autoIds = rows.filter((c) => c.autoMetadata && CHANNEL_ID.test(c.channelId)).map((c) => c.id).join(',');
  const refresh = useCallback(async (ids: string[], manual = false) => {
    if (!ids.length) return;
    setRefreshing((n) => n + 1);
    try {
      const { items } = await apiPost<{ items: { id: string; meta: ChannelMetadata | null }[] }>('/api/channels/meta/refresh', { ids });
      setMetadata((old) => ({ ...old, ...Object.fromEntries(items.map(({ id, meta }) => [id, meta])) }));
      setMetaError('');
      if (manual) setNotice(`Đã lấy số liệu YouTube cho ${items.filter((c) => c.meta).length}/${ids.length} kênh.`);
    } catch (err) { setMetaError(message(err, 'Không thể làm mới số liệu YouTube.')); }
    finally { setRefreshing((n) => n - 1); }
  }, []);
  useEffect(() => {
    if (!configured || !autoIds || loading) return;
    let last = 0;
    const tick = () => {
      if (document.hidden || Date.now() - last < REFRESH_MS) return;
      last = Date.now(); void refresh(autoIds.split(','));
    };
    const startup = window.setTimeout(tick, 350);
    const timer = window.setInterval(tick, REFRESH_MS);
    document.addEventListener('visibilitychange', tick);
    return () => { window.clearTimeout(startup); window.clearInterval(timer); document.removeEventListener('visibilitychange', tick); };
  }, [autoIds, configured, loading, refresh]);

  const syncSheet = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!assertWritable() || !sheetUrl.trim() || syncing) return;
    setSyncing(true); setError(''); setNotice('');
    try {
      const data = await apiPost<{ created: number; updated: number; skipped: number }>('/api/channels/sync-sheet', { sheetUrl: sheetUrl.trim() });
      setNotice(`Đã nhập ${data.created} kênh mới, cập nhật ${data.updated} kênh.${data.skipped ? ` Bỏ qua ${data.skipped} dòng có ID trùng.` : ''} Không xóa kênh ngoài Sheet.`);
      await load();
    } catch (err) { setError(message(err, 'Không đồng bộ được Sheet.')); }
    finally { setSyncing(false); }
  };
  const remove = async (channel: ChannelRecord) => {
    if (!assertWritable() || !window.confirm(`Xóa kênh “${channel.channelName}” khỏi workspace? Quyền truy cập vào kênh này sẽ mất.`)) return;
    try {
      await apiDelete(`/api/channels/${channel.id}`);
      setChannels((old) => old.filter((row) => row.id !== channel.id)); setNotice('Đã xóa kênh.');
    } catch (err) { setError(message(err, 'Không xóa được kênh.')); }
  };
  const saveInList = (row: ChannelRecord) => {
    setChannels((old) => old.some((c) => c.id === row.id) ? old.map((c) => c.id === row.id ? row : c) : [row, ...old]);
    setNotice(editor?.channel ? 'Đã cập nhật kênh.' : 'Đã thêm kênh.');
    setEditor(undefined);
    setQuery(''); setFilter(''); setPage(1);
  };
  const downloadHelper = async () => {
    setHelperBusy(true);
    try {
      const token = await getAuthInstance().currentUser?.getIdToken();
      const response = await fetch('/api/workstation/helper-package', { headers: token ? { authorization: `Bearer ${token}` } : {} });
      if (!response.ok) throw new Error();
      const href = URL.createObjectURL(await response.blob());
      const link = document.createElement('a'); link.href = href; link.download = 'lanhdia-helper-thu-muc-cu.zip'; link.click();
      window.setTimeout(() => URL.revokeObjectURL(href), 1000);
    } catch { setError('Không tải được Windows Helper.'); }
    finally { setHelperBusy(false); }
  };

  // ---------- Extension 1 chạm ----------

  const createExtensionToken = async () => {
    if (extTokenBusy || !assertWritable()) return;
    setExtTokenBusy(true); setError(''); setNotice('');
    try {
      const data = await apiPost<{ token: string; message: string }>('/api/extension/token', {});
      setExtToken(data.token);
      setNotice(data.message || 'Đã cấp token. Sao chép ngay và lưu vào tiện ích Chrome.');
    } catch (err) { setError(message(err, 'Không tạo được Extension Token.')); }
    finally { setExtTokenBusy(false); }
  };

  const copyExtToken = async () => {
    if (!extToken) return;
    try {
      await navigator.clipboard.writeText(extToken);
      setExtCopied(true);
      setNotice('Đã sao chép Extension Token.');
      window.setTimeout(() => setExtCopied(false), 1800);
    } catch { setError('Không sao chép được token.'); }
  };

  const downloadExtZip = async () => {
    setExtZipBusy(true); setError(''); setNotice('');
    try {
      const token = await getAuthInstance().currentUser?.getIdToken();
      const response = await fetch('/api/extension/package', { headers: token ? { authorization: `Bearer ${token}` } : {} });
      if (!response.ok) throw new Error();
      const href = URL.createObjectURL(await response.blob());
      const link = document.createElement('a'); link.href = href; link.download = 'ymaxtool-chrome-extension.zip'; link.click();
      window.setTimeout(() => URL.revokeObjectURL(href), 1000);
      setNotice('Đã tải gói tiện ích Chrome. Giải nén rồi cài qua chrome://extensions/ → Tải tiện ích chưa đóng gói.');
    } catch { setError('Không tải được gói tiện ích Chrome.'); }
    finally { setExtZipBusy(false); }
  };

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="mb-1 text-[10px] font-extrabold uppercase tracking-[.18em] text-red-600">Workspace YouTube</p>
          <h1 className="text-2xl font-extrabold tracking-tight text-slate-900">Quản lý Kênh</h1>
          <p className="mt-1 text-sm text-slate-500">Đồng bộ kênh, theo dõi số liệu công khai và mở YouTube Studio trong đúng hồ sơ.</p>
        </div>
        <button className="btn btn-primary" type="button" onClick={() => assertWritable() && setEditor({})} disabled={isReadOnly}>＋ Thêm kênh</button>
      </header>
      {error && <p role="alert" className="banner-readonly rounded-lg p-3 text-sm">{error}</p>}
      {notice && <p role="status" className="rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-800">{notice}</p>}

      <section className="card" aria-labelledby="ext-title">
        <h2 className="text-sm font-extrabold mb-3" id="ext-title">Extension lấy kênh 1 chạm (Chrome)</h2>
        <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center">
          <button type="button" className="btn btn-outline flex-1 sm:flex-auto" disabled={isReadOnly || extZipBusy} onClick={() => assertWritable() && downloadExtZip()}
            title="Tải file .zip để cài vào Chrome">{extZipBusy ? 'Đang tải…' : '↓ Tải Extension 1 chạm (.zip)'}</button>
          <button type="button" className="btn btn-outline flex-1 sm:flex-auto" disabled={isReadOnly || extTokenBusy} onClick={() => assertWritable() && createExtensionToken()}
            title="Tạo token kết nối">{extTokenBusy ? 'Đang tạo…' : '🔑 Tạo / Cấp lại Token'}</button>
          <button type="button" className="btn btn-ghost flex-1 sm:flex-auto" disabled={!extToken} onClick={() => void copyExtToken()}
            title="Sao chép token">{extCopied ? '✓ Đã sao chép' : 'Sao chép Token'}</button>
        </div>
        <p className="mt-3 text-xs text-slate-500">
          Tải file .zip về → Giải nén → Vào <code className="font-mono text-xs">chrome://extensions/</code> → Bật Chế độ nhà phát triển →
          <span className="font-medium">Tải tiện ích chưa đóng gói</span> → Chọn thư mục vừa giải nén.
          Mở YouTube Studio, bấm biểu tượng tiện ích, sau đó bấm <b>Đẩy về Lãnh Địa YouTube (1 Chạm)</b>.
        </p>
      </section>

      <ChromeHubPanel workspace={workspace} configured={configured} isRoot={isRoot} readOnly={isReadOnly}
        receiving={receiving} revision={revision} checkConfig={() => void checkConfig()} receive={() => void receive()} />
      {receiving && <p role="status" className="text-sm text-slate-600">Đang đồng bộ kênh từ Chrome…</p>}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {[
          ['Kênh trong workspace', channels.length], ['Đã ghép hồ sơ Chrome', channels.filter((c) => c.chromeLink).length], ['Kênh có gậy đã ghi nhận', channels.filter((c) => strikes(c) > 0).length],
        ].map(([title, value]) => <div className="card px-4 py-3" key={title}><p className="text-xs font-semibold text-slate-500">{title}</p><p className="mt-1 text-2xl font-extrabold tabular-nums">{value}</p></div>)}
      </div>

      <section className="card" aria-labelledby="channel-list-title">
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 pt-4">
          <h2 className="text-sm font-extrabold" id="channel-list-title">Danh sách kênh <span className="font-semibold text-slate-400">· {visible.length}</span></h2>
          <button type="button" className="btn btn-outline !px-2.5 !py-1.5" disabled={!configured || refreshing > 0 || !rows.some((c) => CHANNEL_ID.test(c.channelId))}
            onClick={() => void refresh(rows.filter((c) => CHANNEL_ID.test(c.channelId)).map((c) => c.id), true)}>{refreshing ? 'Đang làm mới…' : '↻ Làm mới trang này'}</button>
        </div>
        <div className="grid gap-2 px-4 py-3 sm:grid-cols-[1fr_11rem]">
          <input aria-label="Tìm kênh" className="input" value={query} onChange={(e) => { setQuery(e.target.value); setPage(1); }} placeholder="Tìm tên kênh, ID, handle, profile, Gmail…" />
          <select aria-label="Lọc kênh" className="input" value={filter} onChange={(e) => { setFilter(e.target.value); setPage(1); }}>
            <option value="">Tất cả kênh</option>{Object.entries(CHANNEL_STATES).map(([key, name]) => <option key={key} value={key}>{name}</option>)}<option value="linked">Đã ghép Chrome</option><option value="unlinked">Chưa ghép Chrome</option><option value="sync">Bật tự làm mới</option><option value="alert">Có gậy đã ghi nhận</option>
          </select>
        </div>
        {metaError && <p className="px-4 pb-3 text-xs text-amber-800" role="alert">{metaError}</p>}
        {loading ? <p className="px-4 py-10 text-center text-sm text-slate-500">Đang tải kênh…</p>
          : !rows.length ? <div className="px-4 py-10 text-center text-sm text-slate-500">
            <p>{channels.length ? 'Không có kênh phù hợp bộ lọc.' : 'Chưa có kênh nào. Thêm kênh mới hoặc gửi từ tiện ích Chrome.'}</p>
            {!channels.length && !isReadOnly && <button type="button" className="btn btn-outline mt-3" onClick={() => assertWritable() && setEditor({})}>Thêm kênh đầu tiên</button>}
          </div> : <div className="table-wrap"><table className="data"><thead><tr>
            <th>Kênh YouTube</th><th>Chrome Profile</th><th>Subscribers</th><th>Video</th><th>Views</th><th>Trạng thái</th><th>Nguồn số liệu</th><th>Thao tác</th>
          </tr></thead><tbody>{rows.map((row) => {
            const meta = metadata[row.id];
            const target = savedTarget(row);
            const label = meta?.channelName && row.channelName === `Kênh ${row.channelId}` ? meta.channelName : row.channelName;
            return <tr key={row.id} className={highlight === row.id ? 'bg-emerald-50/70' : undefined}>
              <td className="min-w-[12rem]"><p className="font-bold text-slate-900">{target && !row.chromeLink ? <a href={targetUrl(target)} target="_blank" rel="noreferrer" className="hover:underline">{label || target.value}</a> : label || target?.value || 'Chưa đặt tên'}</p>
                <p className="text-xs text-slate-500">{meta?.handle || row.handle || row.channelId || 'Chưa có ID'}</p>
                {(meta?.country || row.country || row.category) && <p className="mt-0.5 text-xs text-slate-500">{[meta?.country || row.country, row.category && CHANNEL_CATEGORIES[row.category]].filter(Boolean).join(' · ')}</p>}
                {row.chromeLink && <div className="mt-2"><ChromeOpen key={row.chromeLink.profileKey} channel={row} more /></div>}</td>
              <td className="min-w-[8rem] text-xs text-slate-600">
                {row.chromeLink ? <><b className="text-slate-800">{row.profileLabel || row.chromeLink.directory}</b><p className="mt-0.5 text-emerald-800">✓ Đã ghép{row.profileLabel ? ` · ${row.chromeLink.directory}` : ''}</p>
                  <p className="mt-0.5 text-slate-500">{new Date(row.chromeLink.syncedAt).toLocaleString('vi-VN')}</p></>
                : <>{row.profileLabel || row.chromeProfile || '—'}<p className="mt-0.5 text-slate-500">Chưa ghép</p></>}
              </td>
              <td className="tabular-nums">{meta?.hiddenSubscribers ? 'Đã ẩn' : statsText(meta ? meta.subscribers : row.subscribers)}</td>
              <td className="tabular-nums">{statsText(meta ? meta.videoCount : row.videoCount)}</td>
              <td className="tabular-nums">{statsText(meta ? meta.viewCount : row.viewCount)}</td>
              <td className="whitespace-nowrap"><span className={`badge ${!row.state || row.state === 'active' ? 'badge-green' : 'badge-gray'}`}>{CHANNEL_STATES[row.state || 'active']}</span>
                {strikes(row) > 0 && <p className="mt-1 text-xs text-amber-800">{strikes(row)} gậy đã ghi nhận</p>}</td>
              <td className="min-w-[8rem] text-xs text-slate-500">{meta ? <><b className="text-slate-700">YouTube</b><p>{new Date(meta.fetchedAt).toLocaleString('vi-VN')}</p></>
                : <>{metadata[row.id] === null ? 'Không có dữ liệu API' : [row.subscribers, row.videoCount, row.viewCount].some((n) => typeof n === 'number') ? 'Nhập thủ công' : 'Chưa có số liệu'}{row.autoMetadata && <p className="text-xs text-slate-500">{CHANNEL_ID.test(row.channelId) ? 'Tự làm mới' : 'Cần ID UC…'}</p>}</>}</td>
              <td><div className="flex min-w-[7rem] flex-wrap gap-1">
                {!row.chromeLink && CHANNEL_ID.test(row.channelId) && <a href={studio(row.channelId)} target="_blank" rel="noreferrer" title="Kênh chưa ghép nên mở trong Chrome hiện tại" className="btn btn-outline !px-2 !py-1 !text-xs">Studio · hồ sơ hiện tại ↗</a>}
                {row.videoFolder && <button type="button" className="btn btn-outline !px-2 !py-1 !text-xs" onClick={() => openProtocol(buildOpenFolderUrl(row.videoFolder))}>Thư mục</button>}
                {!isReadOnly && <><button className="btn btn-ghost !px-2 !py-1 !text-xs" type="button" onClick={() => setEditor({ channel: row })}>Sửa</button><button className="btn btn-ghost !px-2 !py-1 !text-xs text-red-600" type="button" onClick={() => void remove(row)}>Xóa</button></>}
              </div></td>
            </tr>;
          })}</tbody></table></div>}
        {pageCount > 1 && <div className="flex items-center justify-end gap-2 px-4 py-3 text-xs"><span>Trang {currentPage}/{pageCount}</span><button className="btn btn-outline !px-2 !py-1" type="button" disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)}>Trước</button><button className="btn btn-outline !px-2 !py-1" type="button" disabled={currentPage >= pageCount} onClick={() => setPage(currentPage + 1)}>Tiếp</button></div>}
      </section>

      <details className="card p-4">
        <summary className="cursor-pointer text-sm font-bold">Google Sheet và máy trạm Windows</summary>
        <form onSubmit={syncSheet} className="mt-3 flex flex-col gap-2 sm:flex-row">
          <input aria-label="URL hoặc ID Google Sheet" className="input flex-1" placeholder="Dán URL hoặc ID Google Sheet…" value={sheetUrl} onChange={(e) => setSheetUrl(e.target.value)} />
          <button className="btn btn-outline" disabled={syncing || isReadOnly || !sheetUrl.trim()}>{syncing ? 'Đang đồng bộ…' : 'Đồng bộ ma trận'}</button>
        </form>
        <p className="mt-2 text-xs text-slate-500">Đọc Sheet chia sẻ công khai từ dòng 4. Ghép theo ID; không xóa kênh hoặc quyền đã lưu. Không đưa mật khẩu vào Sheet công khai.</p>
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
          <b className="text-xs">Máy trạm Windows</b><span className={`badge ${helper ? 'badge-green' : 'badge-gray'}`}>{helper === null ? 'Chưa kiểm tra' : helper ? 'Sẵn sàng' : 'Chưa mở helper'}</span>
          <button className="btn btn-ghost !px-2 !py-1 !text-xs" type="button" onClick={() => void checkHelperHealth().then(setHelper)}>Kiểm tra</button>
          <button className="btn btn-outline !px-2 !py-1 !text-xs" type="button" onClick={() => void downloadHelper()} disabled={helperBusy}>{helperBusy ? 'Đang tải…' : '↓ Helper thư mục/video cũ'}</button>
        </div>
      </details>

      {editor && <ChannelEditor key={editor.channel?.id || 'new'} {...editor} channels={channels} configured={configured}
        cached={editor.channel ? metadata[editor.channel.id] ?? undefined : undefined} close={() => setEditor(undefined)}
        saved={saveInList} disconnect={editor.channel?.chromeLink ? () => void disconnect(editor.channel!) : undefined} openExisting={(channel) => setEditor({ channel, imported: editor.imported })} />}
    </div>
  );
}
