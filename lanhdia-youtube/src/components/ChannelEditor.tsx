import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { ApiError, apiPatch, apiPost } from '../lib/api-client';
import { CHANNEL_CATEGORIES, CHANNEL_STATES, matchesChannel, type ChannelForm, type ChannelMetadata, type ChannelRecord } from '../lib/channel-record';
import { CHANNEL_ID, parseChannelTarget, targetUrl, type ChromeChannelImport } from '../lib/channel-target';

const COUNTRIES: Record<string, string> = { VN: 'Việt Nam', US: 'Hoa Kỳ', GB: 'Anh', CA: 'Canada', AU: 'Úc', JP: 'Nhật Bản', KR: 'Hàn Quốc', TH: 'Thái Lan', ID: 'Indonesia', PH: 'Philippines', SG: 'Singapore', IN: 'Ấn Độ', DE: 'Đức', FR: 'Pháp', ES: 'Tây Ban Nha', BR: 'Brazil', MX: 'Mexico', TW: 'Đài Loan', MY: 'Malaysia' };
const fieldKeys = ['stt', 'channelName', 'channelId', 'gmail', 'proxy', 'bktStatus', 'niche', 'videoFolder', 'schedule', 'note', 'chromeProfile',
  'profileLabel', 'handle', 'country', 'category', 'channelUrl', 'subscribers', 'videoCount', 'viewCount', 'watchHours12m', 'communityStrikes',
  'copyrightStrikes', 'monetized', 'state', 'autoMetadata'] as const;

function startForm(row?: ChannelRecord, imported?: ChromeChannelImport) {
  const form: ChannelForm = { state: 'active', autoMetadata: Boolean(imported) };
  for (const k of fieldKeys) if (row?.[k] !== undefined) Object.assign(form, { [k]: row[k] });
  if (imported) {
    form.channelName ||= imported.title;
    form.channelUrl ||= targetUrl(imported.target);
    if (imported.target.kind === 'handle') form.handle ||= imported.target.value;
    form.profileLabel = imported.profileLabel || form.profileLabel || '';
    form.chromeProfile = imported.chromeProfile || form.chromeProfile || '';
  }
  return form;
}

export default function ChannelEditor({ channel, imported, configured, cached, channels, close, saved, openExisting, disconnect }: {
  channel?: ChannelRecord; imported?: ChromeChannelImport; configured: boolean | null; cached?: ChannelMetadata; channels: ChannelRecord[];
  disconnect?: () => void; close: () => void; saved: (row: ChannelRecord) => void; openExisting: (row: ChannelRecord) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const request = useRef(0);
  const autoStarted = useRef(false);
  const [form, setForm] = useState<ChannelForm>(() => {
    const initial = startForm(channel, imported);
    if (cached && channel?.chromeLink) {
      if (initial.channelName === `Kênh ${cached.channelId}`) initial.channelName = cached.channelName;
      if (!initial.country && cached.country) initial.country = cached.country;
      if (!initial.handle && cached.handle) initial.handle = cached.handle;
    }
    return initial;
  });
  const locked = CHANNEL_ID.test(channel?.channelId || '');
  const [input, setInput] = useState(channel?.channelId || imported?.target.value || channel?.handle || '');
  const [meta, setMeta] = useState<ChannelMetadata | undefined>(cached);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [lookupError, setLookupError] = useState('');
  const [saveError, setSaveError] = useState('');
  const set = <K extends keyof ChannelForm>(key: K, value: ChannelForm[K]) => setForm((current) => ({ ...current, [key]: value }));

  useEffect(() => { const el = dialog.current; el?.showModal(); return () => { el?.close(); request.current++; }; }, []);
  const lookup = useCallback(async (raw: string) => {
    const target = parseChannelTarget(raw);
    if (!target) { setLookupError('Nhập ID UC…, @handle hoặc URL kênh hợp lệ để lấy Meta.'); return; }
    const id = ++request.current;
    setBusy(true); setLookupError('');
    try {
      const found = await apiPost<ChannelMetadata>('/api/channels/meta/lookup', { target: target.value });
      if (id !== request.current) return;
      setMeta(found);
      setInput(found.channelId);
      setForm((current) => ({ ...current, channelId: found.channelId,
        channelName: current.channelName || found.channelName,
        handle: found.handle || current.handle || (target.kind === 'handle' ? target.value : ''),
        country: current.country || found.country || '', channelUrl: targetUrl({ kind: 'id', value: found.channelId }) }));
    } catch (e) {
      if (id === request.current) setLookupError(e instanceof ApiError ? e.message : 'Không lấy được thông tin kênh.');
    } finally { if (id === request.current) setBusy(false); }
  }, []);
  useEffect(() => {
    if (!imported || !configured || autoStarted.current) return;
    const tick = window.setTimeout(() => { autoStarted.current = true; void lookup(locked ? channel!.channelId : imported.target.value); }, 0);
    return () => window.clearTimeout(tick);
  }, [channel, configured, imported, locked, lookup]);

  const target = parseChannelTarget(input || form.channelUrl || form.handle);
  const candidate = { ...form, channelId: target?.kind === 'id' ? target.value : '', handle: target?.kind === 'handle' ? target.value : form.handle };
  const duplicate = !channel ? channels.find((row) => matchesChannel(row, candidate)) : undefined;
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaveError('');
    if (saving || busy || duplicate) return;
    if (input.trim() && !target && input !== channel?.channelId) { setSaveError('ID kênh không hợp lệ. Nhập ID UC…, @handle hoặc URL kênh.'); return; }
    if (!form.channelName?.trim()) { setSaveError('Vui lòng nhập tên kênh.'); return; }
    const payload: ChannelForm = { ...form, channelId: target?.kind === 'id' ? target.value : channel?.channelId || '',
      handle: candidate.handle || '', channelUrl: form.channelUrl || (target ? targetUrl(target) : '') };
    // Live public counts are never duplicated into the stored manual fields.
    setSaving(true);
    try {
      const row = channel ? await apiPatch<ChannelRecord>(`/api/channels/${channel.id}`, payload) : await apiPost<ChannelRecord>('/api/channels', payload);
      saved(row);
    } catch (e) { setSaveError(e instanceof ApiError ? e.message : 'Không lưu được kênh.'); }
    finally { setSaving(false); }
  };

  const label = (title: ReactNode, node: ReactNode, className = '') => <label className={`block min-w-0 space-y-1.5 text-xs font-semibold text-slate-700 [&_input]:font-normal [&_select]:font-normal [&_textarea]:font-normal ${className}`}><span>{title}</span>{node}</label>;
  const text = (key: keyof ChannelForm, title: string, placeholder: string, span = '', options: { type?: string; max?: number; required?: boolean } = {}) => label(title,
    <input className="input py-1.5" type={options.type || 'text'} maxLength={options.max || 160} required={options.required}
      value={String(form[key] ?? '')} placeholder={placeholder} onChange={(e) => set(key, e.target.value)} />, span);
  const metric = (key: 'subscribers' | 'videoCount' | 'viewCount' | 'watchHours12m' | 'copyrightStrikes' | 'communityStrikes', title: string) => {
    const live = !!meta && (key === 'subscribers' || key === 'videoCount' || key === 'viewCount');
    return label(title, <input className={`input py-1.5 ${live ? 'bg-slate-50 text-slate-600' : ''}`} type="number" min={0} step={key === 'watchHours12m' ? 'any' : 1}
      placeholder={live && key === 'subscribers' && meta.hiddenSubscribers ? 'Đã ẩn' : '—'} readOnly={live}
      value={(live ? meta[key] : form[key]) ?? ''} onChange={(e) => set(key, e.target.value === '' ? null : Number(e.target.value))} />);
  };
  return (
    <dialog ref={dialog} onCancel={(e) => { e.preventDefault(); if (!saving) close(); }} aria-labelledby="channel-dialog-title"
      className="card w-[calc(100%-1.25rem)] max-w-[43rem] max-h-[min(94dvh,52rem)] overflow-y-auto p-0 text-slate-900 backdrop:bg-slate-950/55">
      <form onSubmit={submit}>
        <header className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-3.5 sm:px-6">
          <h2 id="channel-dialog-title" className="text-base font-extrabold">{channel ? 'Cập nhật kênh' : 'Thêm Kênh mới'}</h2>
          <button className="btn btn-ghost !px-2 !py-1" type="button" aria-label="Đóng" disabled={saving} onClick={close}>✕</button>
        </header>
        <div className="space-y-4 px-4 py-4 sm:px-6">
          {imported && <div className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-900">
            <strong>Đã nhận từ Chrome.</strong> Kiểm tra kênh và bấm lưu. Tiện ích không tự tạo bản ghi khi mở tab.
          </div>}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex min-w-0 items-end gap-1.5">
              {label('YouTube Channel ID (UC…) / @handle', <input className="input py-1.5 font-mono" value={input} readOnly={locked} maxLength={600}
                placeholder="UC…, @kenh hoặc URL kênh" onChange={(e) => { request.current++; setInput(e.target.value); setMeta(undefined); setBusy(false); setLookupError(''); }} />, 'flex-1')}
              <button type="button" className="btn btn-outline !px-2 !py-1.5" onClick={() => void lookup(input || form.channelUrl || form.handle || '')} disabled={!configured || busy || saving}>{busy ? 'Đang lấy…' : '↻ Lấy Meta'}</button>
            </div>
            {text('channelName', 'Tên Kênh chuẩn', 'VD: Khám Phá Thế Giới', '', { required: true })}
          </div>
          {lookupError && <p className="text-xs text-red-700" role="alert">{lookupError}</p>}
          {configured === false && <p className="text-xs text-amber-800">Chưa kết nối YouTube Data API. Bạn vẫn có thể nhập và lưu thủ công.</p>}
          {meta && <div role="status" className="rounded-lg border border-slate-200 bg-slate-50 p-2.5 text-xs text-slate-600">
            <strong className="text-slate-800">YouTube</strong> · Số liệu công khai tại {new Date(meta.fetchedAt).toLocaleString('vi-VN')}. Số người đăng ký có thể được làm tròn.
            {meta.channelName !== form.channelName && <button className="ml-1 font-semibold text-slate-800 underline" type="button" onClick={() => set('channelName', meta.channelName)}>Dùng tên “{meta.channelName}”</button>}
          </div>}
          {duplicate && <div className="rounded-lg bg-amber-50 p-3 text-xs text-amber-900" role="alert">Kênh này đã có trong danh sách. <button type="button" className="font-bold underline" onClick={() => openExisting(duplicate)}>Mở kênh đã lưu</button></div>}
          <div className="grid gap-3 sm:grid-cols-2">
            {text('profileLabel', 'Tên Profile / Tên Shortcut Desktop', 'VD: Profile 48 – US News', '', { max: 100 })}
            {text('chromeProfile', 'Thư mục Profile Chrome', 'Default, Profile 1, Profile 48…', '', { max: 40 })}
          </div>
          {channel?.chromeLink && <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-900">
            <span><b>Hồ sơ mở đã xác minh:</b> {channel.chromeLink.directory}. Tên profile nhập tay không đổi liên kết này.</span>
            {disconnect && <button className="font-semibold underline" type="button" onClick={disconnect} disabled={saving}>Gỡ ghép Chrome</button>}
          </div>}
          <div className="grid gap-3 sm:grid-cols-3">
            {text('handle', 'Handle (@…)', '@khamphathegioi', '', { max: 100 })}
            {label('Quốc gia', <select className="input py-1.5" value={form.country || ''} onChange={(e) => set('country', e.target.value)}>
              <option value="">Chưa đặt</option>{[...new Set([...Object.keys(COUNTRIES), ...(form.country && /^[A-Z]{2}$/.test(form.country) ? [form.country] : [])])].map((code) => <option value={code} key={code}>{COUNTRIES[code] ? `${COUNTRIES[code]} (${code})` : code}</option>)}
            </select>)}
            {label('Danh mục YouTube', <select className="input py-1.5" value={form.category || ''} onChange={(e) => set('category', e.target.value as ChannelForm['category'])}>
              <option value="">Chưa phân loại</option>{Object.entries(CHANNEL_CATEGORIES).map(([key, name]) => <option value={key} key={key}>{name}</option>)}
            </select>)}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {text('gmail', 'Gmail quản lý kênh', 'quanlykenh@gmail.com', '', { max: 254 })}
            {text('channelUrl', 'URL Kênh YouTube', 'https://www.youtube.com/channel/UC…', '', { max: 600 })}
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {metric('subscribers', 'Subscribers')}{metric('videoCount', 'Tổng video')}{metric('viewCount', 'Tổng views')}{metric('watchHours12m', 'Giờ xem (12T)')}
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            {metric('copyrightStrikes', 'Gậy bản quyền')}{metric('communityStrikes', 'Gậy cộng đồng')}
            {label('Trạng thái', <select className="input py-1.5" value={form.state || 'active'} onChange={(e) => set('state', e.target.value as ChannelForm['state'])}>{Object.entries(CHANNEL_STATES).map(([key, name]) => <option value={key} key={key}>{name}</option>)}</select>)}
          </div>
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-xs font-semibold"><input type="checkbox" className="accent-red-600" checked={form.monetized === true} onChange={(e) => set('monetized', e.target.checked)} /> Kênh đã bật kiếm tiền (BKT)</label>
            <label className="flex items-center gap-2 text-xs font-semibold"><input type="checkbox" className="accent-red-600" checked={form.autoMetadata === true} onChange={(e) => set('autoMetadata', e.target.checked)} /> Tự làm mới dữ liệu công khai khi mở Quản lý Kênh</label>
            <p className="text-xs text-slate-500">Gmail, giờ xem, gậy và kiếm tiền do bạn ghi nhận. Chrome Helper chỉ xác minh hồ sơ, không đọc phiên Studio.</p>
          </div>
          {label('Ghi chú', <textarea aria-label="Ghi chú" className="input min-h-12 py-1.5" rows={2} maxLength={2000} value={form.note || ''} placeholder="Kế hoạch upload, ghi chú Studio…" onChange={(e) => set('note', e.target.value)} />)}
          <details className="rounded-lg border border-slate-200 p-3 text-xs text-slate-600">
            <summary className="cursor-pointer font-semibold">Tùy chọn Sheet &amp; máy trạm Windows</summary>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {text('niche', 'Chủ đề/Niche', 'VD: Khoa học', '', { max: 120 })}{text('schedule', 'Lịch đăng', 'VD: Thứ 2, 18:00')}
              {text('videoFolder', 'Thư mục video', 'VD: D:\\Videos', '', { max: 1000 })}{text('proxy', 'Proxy/IP', 'Để trống nếu không dùng', '', { max: 300 })}
              {text('bktStatus', 'Trạng thái BKT cũ (Sheet)', 'Giá trị nhập từ Sheet', '', { max: 80 })}
            </div>
          </details>
          {saveError && <p className="rounded-lg bg-red-50 p-2.5 text-xs text-red-700" role="alert">{saveError}</p>}
        </div>
        <footer className="sticky bottom-0 flex justify-end gap-2 border-t border-slate-200 bg-white px-4 py-3 sm:px-6">
          <button type="button" className="btn btn-outline" onClick={close} disabled={saving}>Hủy</button>
          <button className="btn btn-primary" disabled={busy || saving || Boolean(duplicate)}>{saving ? 'Đang lưu…' : channel ? 'Lưu thay đổi' : 'Thêm Kênh'}</button>
        </footer>
      </form>
    </dialog>
  );
}
