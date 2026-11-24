import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react';

export const YOUTUBE_TOOLS_PATH = '/utilities/youtube';
export const YOUTUBE_TOOLS_TITLE = 'Check toàn bộ dữ liệu kênh đối thủ';

const TOOLS = {
  bulk: {
    name: 'Phân tích kênh', label: 'Video công khai · Hàng loạt', icon: '▥',
    url: 'https://mattw.io/youtube-metadata/bulk',
    description: 'Xem lượt xem, lượt thích, ngày đăng, từ khóa và tần suất đăng của các video công khai trong một kênh hoặc playlist.',
  },
  detail: {
    name: 'Chi tiết metadata', label: 'Video · Playlist · Kênh', icon: '▤',
    url: 'https://mattw.io/youtube-metadata/',
    description: 'Xem thông tin kênh, tiêu đề, mô tả, tags, ảnh thu nhỏ và thống kê công khai của một video hoặc playlist.',
  },
  search: {
    name: 'Tìm theo từ khóa', label: 'Chủ đề · Ngách nội dung', icon: '⌕',
    url: 'https://mattw.io/youtube-metadata/search',
    description: 'Khám phá video theo chủ đề. Dùng bộ lọc gốc để chọn thời gian, ngôn ngữ, độ dài hoặc sắp xếp theo lượt xem.',
  },
  geo: {
    name: 'Tìm theo khu vực', label: 'Bản đồ · Video gắn vị trí', icon: '◎',
    url: 'https://mattw.io/youtube-geofind/location',
    description: 'Tìm video công khai có gắn vị trí bằng bản đồ. Bạn có thể nhập địa danh thủ công, không cần chia sẻ vị trí của mình.',
  },
} as const;
export type Tool = keyof typeof TOOLS;

const VIDEO_ID = /^[\w-]{11}$/;
const CHANNEL_ID = /^UC[\w-]{22}$/;
const LIST_ID = /^(?:PL|UU|FL|LL|WL|RD|OLAK|SP)[\w-]{2,148}$/;
const NAME = /^[\p{L}\p{N}\p{M}._-]{1,90}$/u;
const HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtu.be']);

/** Canonicalize only YouTube targets; discard share/tracking parameters. */
export function normalizeYouTubeTarget(raw: string): string | null {
  const input = raw.trim();
  if (VIDEO_ID.test(input) || CHANNEL_ID.test(input) || LIST_ID.test(input)) return input;
  if (input.startsWith('@') && NAME.test(input.slice(1))) return `https://www.youtube.com/${input}`;
  try {
    const url = new URL(/^https?:\/\//i.test(input) ? input : `https://${input}`);
    if (!HOSTS.has(url.hostname) || url.username || url.password || url.port) return null;
    const [first = '', second = ''] = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
    if (url.hostname === 'youtu.be') return VIDEO_ID.test(first) ? first : null;
    if (first === 'watch' || first === 'playlist') {
      const video = url.searchParams.get('v') || '';
      const list = url.searchParams.get('list') || '';
      if (first === 'watch' && VIDEO_ID.test(video)) return video;
      return LIST_ID.test(list) ? `https://www.youtube.com/playlist?list=${list}` : null;
    }
    if (['shorts', 'live', 'embed', 'v'].includes(first)) return VIDEO_ID.test(second) ? second : null;
    if (first === 'channel') return CHANNEL_ID.test(second) ? second : null;
    if (first === 'c' || first === 'user') return NAME.test(second) ? `https://www.youtube.com/${first}/${second}` : null;
    if (first.startsWith('@')) return NAME.test(first.slice(1)) ? `https://www.youtube.com/${first}` : null;
    if (!['', 'feed', 'results', 'redirect', 'premium', 'account'].includes(first) && NAME.test(first)) {
      return `https://www.youtube.com/c/${first}`;
    }
  } catch { /* invalid URL or escape */ }
  return null;
}

export function buildYouTubeToolUrl(tool: Tool, input: string): string {
  const base = TOOLS[tool].url;
  if (tool === 'geo') return base;
  const value = input.trim();
  if (tool === 'search') {
    if (!value || value.length > 160) throw new Error('Nhập từ khóa từ 1 đến 160 ký tự.');
    // MW uses decodeURIComponent; use %20, not form-encoded plus signs.
    return `${base}?keywords=${encodeURIComponent(value)}&pages=1&submit=true`;
  }
  const inputs = value.split(tool === 'bulk' ? /[,\s]+/ : /\r?\n/).filter(Boolean);
  if (!inputs.length || inputs.length > (tool === 'bulk' ? 10 : 1)) {
    throw new Error(tool === 'bulk' ? 'Nhập từ 1 đến 10 liên kết hoặc ID YouTube.' : 'Nhập một liên kết hoặc ID YouTube.');
  }
  const targets = inputs.map(normalizeYouTubeTarget);
  if (targets.some((target) => !target)) throw new Error('Liên kết hoặc ID không hợp lệ. Hãy dùng URL YouTube, @handle hoặc ID.');
  return `${base}?url=${encodeURIComponent([...new Set(targets)].join(','))}&submit=true`;
}

const VIEWER_SANDBOX = 'allow-scripts allow-same-origin allow-forms allow-downloads';

/** Isolate the viewer's frame-src policy from the dashboard and Firebase auth. */
function buildViewerDocument(url: string) {
  const src = url.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `<!doctype html><html lang="vi"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; frame-src https://mattw.io/youtube-metadata/ https://mattw.io/youtube-geofind/; style-src 'unsafe-inline'; base-uri 'none'">
<style>html,body{margin:0;width:100%;height:100%;overflow:hidden}iframe{display:block;border:0;width:100%;height:100%}</style></head>
<body><iframe src="${src}" title="Kết quả tra cứu" sandbox="${VIEWER_SANDBOX}" referrerpolicy="no-referrer"></iframe></body></html>`;
}

function ToolWorkspace({ mode }: { mode: Tool }) {
  const [input, setInput] = useState('');
  const [error, setError] = useState('');
  const [frame, setFrame] = useState<{ url: string; seq: number } | null>(null);
  const [waiting, setWaiting] = useState(false);
  const [slow, setSlow] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const hasFrame = frame !== null;
  const viewerRef = useRef<HTMLDialogElement>(null);
  const tool = TOOLS[mode];

  // Change how the same dialog is shown without moving or reloading its iframe.
  useLayoutEffect(() => {
    const viewer = viewerRef.current;
    if (!hasFrame || !viewer) return;
    if (viewer.open && viewer.matches(':modal') !== fullscreen) viewer.close();
    if (!viewer.open) {
      if (fullscreen) viewer.showModal();
      else viewer.show();
    }
  }, [hasFrame, fullscreen]);

  function open(url: string) {
    setError('');
    setSlow(false);
    setWaiting(true);
    setFrame((prev) => ({ url, seq: (prev?.seq ?? 0) + 1 }));
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    try { open(buildYouTubeToolUrl(mode, input)); }
    catch (err) { setError(err instanceof Error ? err.message : 'Không thể mở công cụ.'); }
  }

  useEffect(() => {
    if (!frame || !waiting) return;
    const timer = window.setTimeout(() => { setSlow(true); setWaiting(false); }, 12000);
    return () => window.clearTimeout(timer);
  }, [frame, waiting]);

  return (
    <section className="card overflow-hidden" aria-label={tool.name}>
      <div className="border-b border-line px-4 py-5 sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-bold">{tool.name}</h2>
          <span className="badge bg-red-50 text-red-800">LÃNH ĐỊA YOUTUBE</span>
        </div>
        <p className="mt-1 max-w-3xl text-sm text-slate-600">{tool.description}</p>
        <form onSubmit={submit} className="mt-4 space-y-2">
          {mode !== 'geo' && (
            <label htmlFor="youtube-tool-input" className="block text-sm font-semibold">
              {mode === 'search' ? 'Từ khóa YouTube' : 'Liên kết hoặc ID YouTube'}
            </label>
          )}
          <div className="flex flex-wrap items-start gap-2">
            {mode !== 'geo' && <input
              id="youtube-tool-input" className="input min-w-0 basis-full sm:w-auto sm:flex-1 sm:basis-0" type="text"
              spellCheck={false} autoComplete="off" maxLength={mode === 'search' ? 160 : 1600}
              placeholder={mode === 'search' ? 'Ví dụ: review máy quay' : 'Ví dụ: https://www.youtube.com/@TenKenh'}
              value={input} aria-invalid={Boolean(error)} aria-describedby="youtube-tool-hint"
              onChange={(event) => { setInput(event.target.value); setError(''); }}
            />}
            <button type="submit" className="btn btn-primary" aria-haspopup={fullscreen ? 'dialog' : undefined} disabled={waiting || (mode !== 'geo' && !input.trim())}>
              {mode === 'geo' ? 'Mở bản đồ' : 'Tra cứu'} <span aria-hidden="true">→</span>
            </button>
            {mode !== 'geo' && <button type="button" className="btn btn-outline" onClick={() => open(tool.url)} disabled={waiting} aria-haspopup={fullscreen ? 'dialog' : undefined}>Mở bộ lọc</button>}
          </div>
          <p id="youtube-tool-hint" className="text-xs text-slate-500">
            {mode === 'bulk' ? 'Dán tối đa 10 link hoặc ID, cách nhau bằng dấu phẩy hoặc khoảng trắng. ' : ''}
            {mode === 'geo' ? 'Bản đồ mở từ công cụ bên thứ ba.' : 'Khi bấm Tra cứu, nội dung nhập được gửi tới công cụ bên thứ ba.'}
          </p>
          {error && <p className="text-sm font-medium text-red-700" role="alert">{error}</p>}
        </form>
      </div>
      {!frame && (
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 bg-slate-50 px-4 py-3 sm:px-6">
          <p className="text-xs font-medium text-slate-600">Hiển thị kết quả</p>
          <div role="group" aria-label="Chế độ hiển thị kết quả" className="inline-flex gap-0.5 rounded-lg border border-line bg-slate-100 p-0.5">
            {[false, true].map((wide) => (
              <button key={String(wide)} type="button" aria-pressed={fullscreen === wide} onClick={() => setFullscreen(wide)}
                className={`rounded-md px-3 py-1.5 text-xs font-semibold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-red-600 ${fullscreen === wide ? 'bg-white text-red-800 shadow-sm' : 'text-slate-600 hover:text-ink'}`}>
                {wide ? 'Toàn màn hình' : 'Bên dưới'}
              </button>
            ))}
          </div>
        </div>
      )}
      {frame && (
        <dialog
          ref={viewerRef} aria-labelledby="youtube-viewer-title" role={fullscreen ? 'dialog' : 'region'}
          onCancel={(event) => { event.preventDefault(); setFullscreen(false); }}
          className={`${fullscreen ? 'fixed inset-0 h-[100dvh] max-h-none w-screen' : 'relative h-[72dvh] min-h-[380px] w-full'} m-0 max-w-none overflow-hidden border-0 bg-white p-0 text-ink open:flex open:flex-col`}
        >
          <div className="flex shrink-0 items-center justify-between gap-3 border-b border-line bg-slate-50 px-3 py-2.5 sm:px-5">
            <div className="min-w-0">
              <p className="text-[10px] font-extrabold tracking-wider text-red-700">LÃNH ĐỊA YOUTUBE</p>
              <h2 id="youtube-viewer-title" className="truncate text-sm font-bold sm:text-base">Kết quả · {tool.name}</h2>
            </div>
            <button type="button" className="btn btn-outline !px-3 !py-1.5" aria-haspopup={fullscreen ? undefined : 'dialog'} onClick={() => setFullscreen(!fullscreen)}>
              <span aria-hidden="true">{fullscreen ? '⤡' : '⤢'}</span> {fullscreen ? 'Thu nhỏ' : 'Toàn màn hình'}
            </button>
          </div>
          {(waiting || slow) && (
            <p role="status" className="shrink-0 bg-slate-50 px-3 py-2 text-xs text-slate-600 sm:px-5">
              {slow ? 'Công cụ phản hồi chậm. Nếu chưa có kết quả, bạn có thể thử tra cứu lại.' : 'Đang tải công cụ…'}
            </p>
          )}
          <iframe
            key={frame.seq} title={`Công cụ nhúng – ${tool.name}`} srcDoc={buildViewerDocument(frame.url)}
            referrerPolicy="no-referrer"
            sandbox={VIEWER_SANDBOX}
            className="block min-h-0 w-full flex-1 border-0 bg-white"
            onLoad={() => { setWaiting(false); setSlow(false); }}
          />
        </dialog>
      )}
    </section>
  );
}

export default function YouTubeToolsPage() {
  const [mode, setMode] = useState<Tool>('bulk');
  return (
    <div className="mx-auto max-w-[1380px] space-y-4">
      <div className="overflow-hidden rounded-2xl bg-slate-900 px-5 py-6 text-white shadow-soft sm:px-8 sm:py-8" style={{ backgroundImage: 'radial-gradient(ellipse at top right, #7f1d1d, transparent 74%)' }}>
        <p className="mb-3 text-xs font-bold uppercase tracking-widest text-red-200">LÃNH ĐỊA YOUTUBE · Nghiên cứu kênh</p>
        <h1 className="max-w-4xl text-2xl font-extrabold tracking-tight sm:text-3xl">{YOUTUBE_TOOLS_TITLE}</h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-300">Tìm ý tưởng nội dung từ video, playlist và kênh công khai. Phân tích lịch đăng, xem metadata và khám phá chủ đề trong cùng một nơi.</p>
      </div>
      <div role="group" aria-label="Chọn công cụ YouTube" className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">
        {(Object.keys(TOOLS) as Tool[]).map((id) => (
          <button type="button" key={id} aria-pressed={mode === id} onClick={() => setMode(id)}
            className={`card flex items-center gap-2.5 px-3 py-3 text-left transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-red-600 ${mode === id ? '!border-red-300 !bg-red-50 text-red-900' : 'text-slate-800 hover:!border-slate-300'}`}>
            <span aria-hidden="true" className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-white text-lg font-bold text-red-700">{TOOLS[id].icon}</span>
            <span><span className="block text-sm font-bold">{TOOLS[id].name}</span><span className="block text-xs text-slate-600">{TOOLS[id].label}</span></span>
          </button>
        ))}
      </div>
      <ToolWorkspace key={mode} mode={mode} />
      <p className="px-1 pb-2 text-xs leading-relaxed text-slate-600">
        Dữ liệu công khai từ YouTube được hiển thị qua công cụ nhúng bên thứ ba và phụ thuộc hạn mức tra cứu. Không truy cập video riêng tư, doanh thu, CTR hay số liệu YouTube Studio của kênh khác.
      </p>
    </div>
  );
}
