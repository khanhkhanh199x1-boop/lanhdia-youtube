import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { apiDelete, apiGet, apiPatch, apiPost, ApiError } from '../lib/api-client';
import type { AssignedChannel, VideoDraft } from '../lib/team';

type DraftForm = { id?: string; title: string; description: string };
const EMPTY: DraftForm = { title: '', description: '' };

function Workspace({ channel, staff }: { channel: AssignedChannel; staff: boolean }) {
  const path = `/api/channels/${encodeURIComponent(channel.id)}/drafts`;
  const [result, setResult] = useState<{ items: VideoDraft[]; canCreate: boolean } | null>(null);
  const [form, setForm] = useState<DraftForm | null>(null);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState('');
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try { setResult(await apiGet(path)); }
    catch (err) { setResult(null); setError(err instanceof ApiError ? err.message : 'Không tải được bản nháp video.'); }
  }, [path]);
  useEffect(() => { void load(); }, [load]);

  const run = async (fn: () => Promise<void>, message: string) => {
    setBusy(true); setError(''); setSaved('');
    try { await fn(); setForm(null); setSaved(message); await load(); }
    catch (err) { setError(err instanceof ApiError ? err.message : 'Không lưu được thay đổi.'); }
    finally { setBusy(false); }
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!form || !form.title.trim()) return;
    const body = { title: form.title, description: form.description };
    void run(async () => {
      if (form.id) await apiPatch(`${path}/${encodeURIComponent(form.id)}`, body);
      else await apiPost(path, body);
    }, 'Đã lưu bản nháp.');
  };
  const studio = staff && result?.canCreate && /^UC[\w-]{22}$/.test(channel.channelId) ? `https://studio.youtube.com/channel/${channel.channelId}/videos` : '';

  return <div className="space-y-3">
    {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}</p>}
    {saved && <p role="status" className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-900">{saved}</p>}
    {!result && !error && <p role="status" className="text-sm text-slate-500">Đang tải bản nháp…</p>}
    {result && <>
      <div className="flex flex-wrap gap-2">
        {result.canCreate && <button type="button" className="btn btn-primary" disabled={busy} onClick={() => { setForm(EMPTY); setSaved(''); }}>Tạo bản nháp</button>}
        {studio && <a className="btn btn-outline" href={studio} target="_blank" rel="noopener noreferrer">Mở YouTube Studio ↗</a>}
      </div>
      {form && <form onSubmit={submit} className="space-y-2 rounded-lg border border-line bg-slate-50 p-3" aria-label="Nội dung bản nháp">
        <label className="block text-sm font-semibold">Tiêu đề video<input className="input mt-1" value={form.title} maxLength={100} required onChange={(e) => setForm({ ...form, title: e.target.value })} /></label>
        <label className="block text-sm font-semibold">Mô tả<textarea className="input mt-1 min-h-24" value={form.description} maxLength={5000} onChange={(e) => setForm({ ...form, description: e.target.value })} /></label>
        <div className="flex flex-wrap gap-2"><button className="btn btn-primary" disabled={busy || !form.title.trim()}>Lưu bản nháp</button><button className="btn btn-outline" type="button" disabled={busy} onClick={() => setForm(null)}>Hủy</button></div>
      </form>}
      {result.items.length ? <ul className="divide-y divide-line rounded-lg border border-line">
        {result.items.map((draft) => <li key={draft.id} className="flex flex-wrap items-start justify-between gap-3 p-3 text-sm">
          <div className="min-w-0 flex-1"><p className="break-words font-bold">{draft.title}</p><p className="whitespace-pre-wrap break-words text-slate-600">{draft.description}</p><p className="mt-1 text-xs text-slate-500">{new Date(draft.updatedAt).toLocaleString('vi-VN')}</p></div>
          {draft.canEdit && <div className="flex gap-1.5">
            <button type="button" className="btn btn-outline !px-2 !py-1 !text-xs" disabled={busy} onClick={() => { setForm({ id: draft.id, title: draft.title, description: draft.description }); setSaved(''); }}>Sửa</button>
            <button type="button" className="btn btn-ghost !px-2 !py-1 !text-xs !text-red-700" disabled={busy} onClick={() => { if (window.confirm('Xóa bản nháp này?')) void run(async () => { await apiDelete(`${path}/${encodeURIComponent(draft.id)}`); }, 'Đã xóa bản nháp.'); }}>Xóa</button>
          </div>}
        </li>)}
      </ul> : <p className="text-sm text-slate-500">Kênh này chưa có bản nháp.</p>}
    </>}
  </div>;
}

export default function VideoDrafts({ channels, staff }: { channels: AssignedChannel[]; staff: boolean }) {
  const [id, setId] = useState('');
  const channel = channels.find((item) => item.id === id) || channels[0];
  if (!channel) return null;
  return <section className="card space-y-3 p-4 sm:p-5" aria-label="Bản nháp video">
    <header><h2 className="font-bold">Bản nháp video theo kênh</h2><p className="mt-1 text-sm text-slate-600">Lưu tiêu đề và mô tả trong team. Bản nháp không tự đăng lên YouTube; đăng video cần quyền trên YouTube Studio.</p></header>
    <label className="block max-w-sm text-sm font-semibold">Chọn kênh<select className="input mt-1" value={channel.id} onChange={(e) => setId(e.target.value)}>{channels.map((item) => <option key={item.id} value={item.id}>{item.channelName || item.channelId || 'Kênh chưa đặt tên'}</option>)}</select></label>
    <Workspace key={channel.id} channel={channel} staff={staff} />
  </section>;
}
