import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { YOUTUBE_TOOLS_PATH, YOUTUBE_TOOLS_TITLE } from '../../pages/YouTubeToolsPage';
import { apiGet, apiPost, apiPut, apiDelete, ApiError } from '../../lib/api-client';
import type { ChannelRow } from '../../lib/sheet-parser';
import { useAuth } from '../../context/AuthContext';

// ============================================================================
// Cột Tiện ích Workspace (Mục 5).
// - Nằm bên phải, nền trắng sáng, viền mảnh, bóng rất nhẹ.
// - Kéo mép trái để resize 360px–850px, lưu localStorage; nút Fullscreen, Đóng.
// - Mobile chuyển thành drawer. 4 tab: SEO & Tags / Khiên Trùng Lặp /
//   Bình luận / Proxy & IP.
// ============================================================================

type Tab = 'seo' | 'duplicate' | 'comments' | 'proxy';

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'seo', label: 'SEO & Tags' },
  { id: 'duplicate', label: 'Khiên Trùng Lặp' },
  { id: 'comments', label: 'Bình luận' },
  { id: 'proxy', label: 'Proxy & IP' },
];

interface Props {
  onClose: () => void;
  onOpenResearch?: () => void;
}

export default function UtilitiesPanel({ onClose, onOpenResearch }: Props) {
  const { assertWritable, profile } = useAuth();
  const staff = profile?.role === 'staff';
  const [tab, setTab] = useState<Tab>('seo');
  const [width, setWidth] = useState<number>(() => {
    const saved = Number(localStorage.getItem('utilities-width') || 420);
    return Math.min(850, Math.max(360, saved || 420));
  });
  const [fullscreen, setFullscreen] = useState(false);
  const dragging = useRef(false);
  const panelRef = useRef<HTMLDivElement>(null);

  // Kéo mép trái để resize
  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragging.current = true;
    const startX = e.clientX;
    const startW = width;
    const move = (ev: MouseEvent) => {
      if (!dragging.current) return;
      const next = Math.min(850, Math.max(360, startW + (startX - ev.clientX)));
      setWidth(next);
    };
    const up = () => {
      dragging.current = false;
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  }, [width]);

  useEffect(() => {
    localStorage.setItem('utilities-width', String(width));
  }, [width]);

  const widthStyle = fullscreen ? '100vw' : `${width}px`;

  return (
    <div
      ref={panelRef}
      className={`relative flex h-full shrink-0 flex-col border-l border-line bg-white shadow-soft ${
        fullscreen ? 'fixed inset-0 z-50' : onOpenResearch ? 'max-md:fixed max-md:inset-y-0 max-md:right-0 max-md:z-40' : ''
      }`}
      style={{ width: widthStyle, maxWidth: '100vw' }}
    >
      {/* Tay nắm resize (mép trái) */}
      {!fullscreen && (
        <div
          onMouseDown={onMouseDown}
          className="absolute left-0 top-0 h-full w-1.5 cursor-ew-resize hover:bg-slate-200"
          title="Kéo để đổi chiều rộng"
        />
      )}

      {/* Header */}
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <div className="font-bold text-slate-900">{staff ? 'Công cụ SEO' : 'Cột Tiện ích'}</div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setFullscreen((f) => !f)}
            className="btn btn-ghost !px-2 !py-1 text-xs"
            title={fullscreen ? 'Thu nhỏ' : 'Toàn màn hình'}
          >
            {fullscreen ? '⤡' : '⛶'}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="btn btn-ghost !px-2 !py-1 text-xs"
            title="Đóng" aria-label="Đóng"
          >
            ✕
          </button>
        </div>
      </div>

      {!staff && <Link to={YOUTUBE_TOOLS_PATH} onClick={onOpenResearch} className="mx-3 mt-3 flex items-center justify-between gap-2 rounded-lg border border-red-100 bg-red-50 px-3 py-2.5 text-sm font-bold text-red-800 transition hover:bg-red-100">
        <span>{YOUTUBE_TOOLS_TITLE}</span><span aria-hidden="true">→</span>
      </Link>}

      {/* Tabs */}
      {!staff && <div className="flex gap-1 border-b border-line px-3 pt-2">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`rounded-t-lg px-3 py-2 text-xs font-semibold transition ${
              tab === t.id
                ? 'bg-brand text-white'
                : 'text-slate-500 hover:bg-slate-100'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>}

      {/* Nội dung tab */}
      <div className="flex-1 overflow-y-auto p-4">
        {(staff || tab === 'seo') && <SeoTab />}
        {!staff && tab === 'duplicate' && <DuplicateTab />}
        {!staff && tab === 'comments' && <CommentsTab assertWritable={assertWritable} />}
        {!staff && tab === 'proxy' && <ProxyTab />}
      </div>
    </div>
  );
}

// ---------------- Tab: SEO & Tags ----------------
function SeoTab() {
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{
    title: string; description: string; tags: string[]; suggestions: string[];
  } | null>(null);
  const [error, setError] = useState('');

  const run = async () => {
    if (!url.trim()) return;
    setLoading(true);
    setError('');
    try {
      const data = await apiPost<{ title: string; description: string; tags: string[]; suggestions: string[] }>(
        '/api/utilities/seo-extract',
        { url: url.trim() },
      );
      setResult(data);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Trích xuất thất bại.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-500">
        Dán URL video đối thủ để trích xuất tiêu đề, mô tả, thẻ tag và gợi ý từ khóa.
      </p>
      <input
        className="input"
        placeholder="https://www.youtube.com/watch?v=..."
        value={url}
        onChange={(e) => setUrl(e.target.value)}
      />
      <button type="button" className="btn btn-primary w-full" onClick={run} disabled={loading}>
        {loading ? 'Đang trích xuất...' : 'Trích xuất SEO'}
      </button>
      {error && <div className="banner-readonly rounded-lg p-2.5 text-xs">{error}</div>}
      {result && (
        <div className="space-y-3 text-sm">
          <div>
            <div className="mb-1 text-xs font-bold text-slate-500">Tiêu đề gợi ý</div>
            <div className="card p-2.5">{result.title || '(không lấy được)'}</div>
          </div>
          <div>
            <div className="mb-1 text-xs font-bold text-slate-500">Mô tả</div>
            <div className="card p-2.5 text-slate-600">{result.description || '(không lấy được)'}</div>
          </div>
          <div>
            <div className="mb-1 text-xs font-bold text-slate-500">Thẻ tag</div>
            <div className="flex flex-wrap gap-1.5">
              {result.tags.length ? result.tags.map((t, i) => (
                <span key={i} className="badge badge-gray">{t}</span>
              )) : <span className="text-xs text-slate-400">Không có tag</span>}
            </div>
          </div>
          <div>
            <div className="mb-1 text-xs font-bold text-slate-500">Từ khóa gợi ý</div>
            <div className="flex flex-wrap gap-1.5">
              {result.suggestions.map((t, i) => (
                <span key={i} className="badge badge-green">{t}</span>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------- Tab: Khiên Trùng Lặp ----------------
function DuplicateTab() {
  const [groups, setGroups] = useState<Array<{ label: string; rows: ChannelRow[] }>>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const run = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await apiGet<{ items: Array<{ id: string } & ChannelRow> }>('/api/channels');
      const items = data.items;
      const map = new Map<string, { label: string; rows: ChannelRow[] }>();
      const fields: Array<{ key: keyof ChannelRow; label: string }> = [
        { key: 'channelName', label: 'Tên kênh' },
        { key: 'gmail', label: 'Gmail quản lý' },
        { key: 'niche', label: 'Chủ đề/Niche' },
        { key: 'schedule', label: 'Lịch đăng' },
      ];
      fields.forEach(({ key, label }) => {
        const byVal = new Map<string, ChannelRow[]>();
        items.forEach((c) => {
          const v = String(c[key] || '').trim().toLowerCase();
          if (!v) return;
          const arr = byVal.get(v) || [];
          arr.push(c);
          byVal.set(v, arr);
        });
        byVal.forEach((rows, val) => {
          if (rows.length > 1) {
            map.set(`${key}:${val}`, { label: `${label}: "${val}"`, rows });
          }
        });
      });
      setGroups(Array.from(map.values()));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Kiểm tra thất bại.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { run(); }, [run]);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-slate-500">Phát hiện trùng tên kênh, Gmail, niche, lịch đăng giữa các kênh.</p>
        <button type="button" className="btn btn-outline !px-2.5 !py-1 text-xs" onClick={run} disabled={loading}>
          {loading ? '...' : 'Quét lại'}
        </button>
      </div>
      {error && <div className="banner-readonly rounded-lg p-2.5 text-xs">{error}</div>}
      {!error && groups.length === 0 && !loading && (
        <div className="card p-4 text-center text-sm text-slate-500">✅ Không phát hiện trùng lặp.</div>
      )}
      {groups.map((g, i) => (
        <div key={i} className="card p-3">
          <div className="mb-1.5 text-xs font-bold text-amber-700">⚠ {g.label} ({g.rows.length} kênh)</div>
          <ul className="space-y-1 text-xs text-slate-600">
            {g.rows.map((r) => (
              <li key={r.rowIndex}>• Dòng {r.rowIndex}: {r.channelName} ({r.channelId})</li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

// ---------------- Tab: Bình luận ----------------
function CommentsTab({ assertWritable }: { assertWritable: () => boolean }) {
  const [items, setItems] = useState<Array<{ id: string; keyword: string; reply: string }>>([]);
  const [keyword, setKeyword] = useState('');
  const [reply, setReply] = useState('');
  const [negKeywords, setNegKeywords] = useState('');
  const [msg, setMsg] = useState('');

  const load = useCallback(async () => {
    try {
      const data = await apiGet<{ items: Array<{ id: string; keyword: string; reply: string }> }>('/api/utilities/comments');
      setItems(data.items);
    } catch { /* bỏ qua */ }
  }, []);
  useEffect(() => { load(); }, [load]);

  const add = async () => {
    if (!assertWritable()) return;
    if (!keyword.trim() || !reply.trim()) return;
    try {
      await apiPost('/api/utilities/comments', { keyword: keyword.trim(), reply: reply.trim() });
      setKeyword(''); setReply(''); setMsg('Đã thêm mẫu trả lời.');
      load();
    } catch (e) { setMsg(e instanceof ApiError ? e.message : 'Thêm thất bại.'); }
  };

  const remove = async (id: string) => {
    if (!assertWritable()) return;
    try { await apiDelete(`/api/utilities/comments/${id}`); load(); } catch { /* bỏ qua */ }
  };

  const saveNeg = async () => {
    if (!assertWritable()) return;
    try {
      const arr = negKeywords.split(',').map((s) => s.trim()).filter(Boolean);
      await apiPut('/api/utilities/negative-keywords', { keywords: arr });
      setMsg('Đã lưu bộ lọc từ khóa tiêu cực.');
    } catch (e) { setMsg(e instanceof ApiError ? e.message : 'Lưu thất bại.'); }
  };

  return (
    <div className="space-y-4">
      <div>
        <div className="mb-2 text-xs font-bold text-slate-500">Mẫu trả lời nhanh</div>
        <div className="space-y-2">
          {items.map((it) => (
            <div key={it.id} className="card flex items-start justify-between gap-2 p-2.5">
              <div className="text-xs">
                <span className="badge badge-gray mr-1.5">{it.keyword}</span>
                <span className="text-slate-700">{it.reply}</span>
              </div>
              <button type="button" className="btn btn-ghost !px-1.5 !py-0.5 text-xs" onClick={() => remove(it.id)}>✕</button>
            </div>
          ))}
          {items.length === 0 && <div className="text-xs text-slate-400">Chưa có mẫu trả lời nào.</div>}
        </div>
        <div className="mt-2 space-y-2">
          <input className="input" placeholder="Từ khóa (vd: giá, mua)" value={keyword} onChange={(e) => setKeyword(e.target.value)} />
          <textarea className="input" rows={2} placeholder="Nội dung trả lời..." value={reply} onChange={(e) => setReply(e.target.value)} />
          <button type="button" className="btn btn-primary w-full" onClick={add}>Thêm mẫu trả lời</button>
        </div>
      </div>
      <div className="border-t border-line pt-3">
        <div className="mb-2 text-xs font-bold text-slate-500">Bộ lọc từ khóa tiêu cực (cách nhau bằng dấu phẩy)</div>
        <textarea className="input" rows={3} placeholder="spam, lừa đảo, ..." value={negKeywords} onChange={(e) => setNegKeywords(e.target.value)} />
        <button type="button" className="btn btn-outline mt-2 w-full" onClick={saveNeg}>Lưu bộ lọc</button>
      </div>
      {msg && <div className="text-xs text-slate-500">{msg}</div>}
    </div>
  );
}

// ---------------- Tab: Proxy & IP ----------------
function ProxyTab() {
  const [proxies, setProxies] = useState<string[]>([]);
  const [results, setResults] = useState<Array<{ proxy: string; alive: boolean; latencyMs: number | null }>>([]);
  const [loading, setLoading] = useState(false);

  const loadProxies = useCallback(async () => {
    try {
      const data = await apiGet<{ items: Array<{ proxy?: string }> }>('/api/channels');
      const uniq = Array.from(new Set(data.items.map((c) => (c.proxy || '').trim()).filter(Boolean)));
      setProxies(uniq);
    } catch { /* bỏ qua */ }
  }, []);
  useEffect(() => { loadProxies(); }, [loadProxies]);

  const check = async () => {
    setLoading(true);
    try {
      const data = await apiPost<{ results: Array<{ proxy: string; alive: boolean; latencyMs: number | null }> }>(
        '/api/utilities/proxy-check',
        { proxies },
      );
      setResults(data.results);
    } catch { /* bỏ qua */ } finally { setLoading(false); }
  };

  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-500">Danh sách proxy theo kênh (lấy từ ma trận). Bấm kiểm tra để xem proxy sống/chết.</p>
      <button type="button" className="btn btn-primary w-full" onClick={check} disabled={loading || proxies.length === 0}>
        {loading ? 'Đang kiểm tra...' : `Kiểm tra ${proxies.length} proxy`}
      </button>
      <div className="space-y-1.5">
        {results.map((r, i) => (
          <div key={i} className="card flex items-center justify-between p-2.5 text-xs">
            <span className="font-mono">{r.proxy}</span>
            <span className={`badge ${r.alive ? 'badge-green' : 'badge-gray'}`}>
              {r.alive ? `Sống${r.latencyMs != null ? ` · ${r.latencyMs}ms` : ''}` : 'Chết'}
            </span>
          </div>
        ))}
        {results.length === 0 && proxies.length > 0 && (
          <div className="text-xs text-slate-400">{proxies.length} proxy sẵn sàng. Bấm "Kiểm tra" để quét.</div>
        )}
        {proxies.length === 0 && <div className="text-xs text-slate-400">Chưa có proxy nào trong ma trận kênh.</div>}
      </div>
    </div>
  );
}
