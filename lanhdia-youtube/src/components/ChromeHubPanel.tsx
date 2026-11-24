import { useCallback, useEffect, useState } from 'react';
import { chromeHub } from '../lib/chrome-browser';
import type { HubStatus } from '../lib/chrome-hub';
import { hubMessage } from '../lib/chrome-hub-messages';

export default function ChromeHubPanel({ workspace, configured, isRoot, readOnly, receiving, revision, checkConfig, receive }: {
  workspace: string; configured: boolean | null; isRoot: boolean; readOnly: boolean; receiving: boolean;
  revision: number; checkConfig: () => void; receive: () => void;
}) {
  const [status, setStatus] = useState<HubStatus>();
  const [feedback, setFeedback] = useState('');
  const [busy, setBusy] = useState(false);
  const check = useCallback(async (explain = false) => {
    const res = await chromeHub<HubStatus>('state', { workspace });
    setStatus(res.ok ? res.data : undefined);
    if (res.ok) setFeedback('');
    else if (explain) setFeedback(hubMessage(res.code));
  }, [workspace]);
  useEffect(() => {
    void check();
    const focused = () => { void check(); };
    window.addEventListener('focus', focused);
    return () => window.removeEventListener('focus', focused);
  }, [check, revision]);
  async function act(action: 'setup' | 'dashboard') {
    if (action === 'dashboard' && (status?.dashboard === 'other' || status?.dashboard === 'different-workspace') &&
        !window.confirm('Chuyển trung tâm điều khiển sang hồ sơ Chrome này? Nếu đổi workspace, yêu cầu đang chờ của workspace cũ sẽ bị bỏ qua.')) return;
    setBusy(true); setFeedback('');
    try {
      const res = await chromeHub<HubStatus>(action, { workspace });
      if (!res.ok) setFeedback(hubMessage(res.code));
      else if (action === 'dashboard') { setStatus(res.data); setFeedback('Đã chọn hồ sơ này làm trung tâm.'); }
    } finally { setBusy(false); }
  }
  const central = status?.dashboard === 'this';
  return <section className="card overflow-hidden" aria-labelledby="chrome-sync-title">
    <div className="border-b border-red-100 bg-gradient-to-br from-red-50 to-white p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-red-700 text-white shadow-sm" aria-hidden="true">
            <svg width="23" height="23" viewBox="0 0 24 24" stroke="currentColor" fill="none" strokeWidth="1.7"><rect x="3" y="4.5" width="18" height="15" rx="2.5"/><path d="M3 8.5h18m-13 5h8m-4-2v4"/></svg>
          </div>
          <div>
            <p className="text-[10px] font-extrabold uppercase tracking-[.16em] text-red-700">Đồng bộ qua tiện ích Chrome · v2</p>
            <h2 className="mt-0.5 text-base font-extrabold text-slate-900" id="chrome-sync-title">Trung tâm điều khiển Chrome</h2>
            <p className="mt-1 text-sm text-slate-600">Bấm một lần ở Studio để tự lưu kênh. Mở lại đúng hồ sơ từ danh sách.</p>
          </div>
        </div>
        <span className={`badge ${central ? 'badge-green' : 'badge-gray'}`}>{central ? 'Trung tâm đã sẵn sàng' : status?.dashboard === 'other' ? 'Trung tâm ở hồ sơ khác' : 'Chưa kết nối trung tâm'}</span>
      </div>
    </div>
    <div className="space-y-3 px-4 py-4 sm:px-5">
      <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
        <span className={`badge ${status ? 'badge-green' : 'badge-gray'}`}>{status ? 'Windows Helper đã kết nối' : 'Windows Helper chưa xác nhận'}</span>
        <span className={`badge ${status?.profile ? 'badge-green' : 'badge-gray'}`}>{status?.profile ? `Hồ sơ này: ${status.profile}` : 'Hồ sơ này chưa ghép'}</span>
        <span className={`badge ${configured ? 'badge-green' : 'badge-gray'}`}>{configured ? 'Đã cấu hình API' : 'Chưa có API số liệu'}</span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {!status?.profile && <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void act('setup')}>Thiết lập hồ sơ trên máy này</button>}
        {!central && status?.profile && !readOnly && <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void act('dashboard')}>Chọn làm trung tâm</button>}
        {central && !readOnly && <button type="button" className="btn btn-outline" disabled={receiving} onClick={receive}>{receiving ? 'Đang nhận kênh…' : `Nhận kênh đang chờ${status.pending ? ` (${status.pending})` : ''}`}</button>}
        <button type="button" className="btn btn-ghost" onClick={() => void check(true)} disabled={busy}>Kiểm tra kết nối</button>
      </div>
      {feedback && <p role="status" className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-700">{feedback}</p>}
        <div className="flex flex-wrap gap-2">
          <a href="/downloads/lanhdia-chrome.zip" className="btn btn-outline" download>↓ Tiện ích Chrome v2</a>
          <a href="/downloads/lanhdia-windows-helper.zip" className="btn btn-outline" download>↓ Windows Helper v2</a>
        </div>
      <details className="border-t border-slate-100 pt-3 text-sm text-slate-600">
        <summary className="cursor-pointer font-semibold text-slate-800">Cài đặt lần đầu và dữ liệu có thể đồng bộ</summary>
        <ol className="mt-3 list-decimal space-y-1.5 pl-5 text-xs leading-relaxed">
          <li>Giải nén Helper và chạy <b>cai-dat-helper.bat</b> một lần trên Windows 10/11. Không chạy bằng quyền quản trị. Bản này không thay Helper thư mục/video cũ.</li>
          <li>Trong Chrome trung tâm và từng hồ sơ có kênh: vào <code>chrome://extensions</code>, bật chế độ nhà phát triển, tải thư mục tiện ích đã giải nén. Nếu đã có tiện ích v1, gỡ bản cũ để không bấm nhầm.</li>
          <li>Đăng nhập web trong hồ sơ trung tâm. Bấm <b>Thiết lập hồ sơ trên máy này</b>, chọn thư mục ở cuối <b>Profile Path</b> trên <code>chrome://version</code>, xác minh rồi bấm <b>Chọn làm trung tâm</b>.</li>
          <li>Ở hồ sơ YouTube, mở <b>Studio của đúng kênh</b>, bấm tiện ích. Ghép hồ sơ lần đầu; từ lần sau kênh tự cập nhật theo ID UC, không phải mở form hay đăng nhập web ở hồ sơ nguồn.</li>
        </ol>
        <p className="mt-2 text-xs leading-relaxed">Số liệu YouTube công khai cập nhật qua API khi đồng bộ và làm mới mỗi 15 phút trên trang đang xem đối với kênh đã bật. Gmail, giờ xem 12 tháng, gậy và kiếm tiền không lấy từ cookie hoặc phiên Studio.</p>
        {configured !== true && <p className="mt-2 text-xs text-amber-800">{isRoot ? 'Để tự điền tên và số liệu công khai: đặt YOUTUBE_DATA_API_KEY phía máy chủ Vercel, triển khai lại. Không dùng khóa Firebase.' : 'Liên hệ quản trị viên để bật YouTube Data API. Ghép hồ sơ và lưu ID kênh vẫn hoạt động.'} <button type="button" className="font-bold underline" onClick={checkConfig}>Kiểm tra API</button></p>}
      </details>
    </div>
  </section>;
}
