import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { apiGet, apiPatch, ApiError } from '../lib/api-client';
import type { AssignedChannel } from '../lib/team';

export default function AssignedChannelsPage() {
  const [items, setItems] = useState<AssignedChannel[] | null>(null);
  const [editing, setEditing] = useState<AssignedChannel | null>(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try { setItems((await apiGet<{ items: AssignedChannel[] }>('/api/channels')).items); }
    catch (err) { setItems(null); setError(err instanceof ApiError ? err.message : 'Không tải được các kênh.'); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!editing) return;
    setBusy(true); setError(''); setMessage('');
    try {
      await apiPatch(`/api/channels/${encodeURIComponent(editing.id)}`, { niche: editing.niche, schedule: editing.schedule });
      setEditing(null);
      setMessage('Đã cập nhật thông tin kênh.');
      await load();
    } catch (err) { setError(err instanceof ApiError ? err.message : 'Không lưu được thay đổi.'); }
    finally { setBusy(false); }
  };

  return <div className="space-y-4">
    <header><h1 className="text-2xl font-extrabold tracking-tight">Kênh được phân công</h1><p className="mt-1 text-sm text-slate-600">Chỉ những kênh được chủ team giao mới hiển thị tại đây.</p></header>
    {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}</p>}
    {message && <p role="status" className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-900">{message}</p>}
    {!items && !error && <p role="status" className="card p-8 text-center text-sm text-slate-500">Đang tải kênh…</p>}
    {items?.length === 0 && <p className="card p-8 text-center text-sm text-slate-600">Bạn chưa được gán kênh. Liên hệ chủ team để được phân công.</p>}
    {items && items.length > 0 && <div className="card table-wrap"><table className="data"><thead><tr><th>Kênh</th><th>Chủ đề</th><th>Lịch đăng</th><th>Quyền</th></tr></thead><tbody>
      {items.map((channel) => <tr key={channel.id}>
        <td><b>{channel.channelName || 'Kênh chưa đặt tên'}</b><span className="block font-mono text-xs text-slate-500">{channel.channelId}</span></td>
        <td>{channel.niche || '—'}</td><td>{channel.schedule || '—'}</td>
        <td>{channel.capabilities?.editChannel ? <button type="button" className="btn btn-outline !px-2 !py-1 !text-xs" onClick={() => { setEditing(channel); setError(''); setMessage(''); }}>Sửa thông tin</button> : <span className="badge badge-gray whitespace-nowrap">{channel.capabilities?.writeDraft ? 'Soạn bản nháp' : 'Chỉ xem'}</span>}</td>
      </tr>)}
    </tbody></table></div>}
    {editing && <form onSubmit={save} className="card space-y-3 p-4" aria-label="Sửa thông tin kênh">
      <h2 className="font-bold">Sửa thông tin · {editing.channelName}</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm font-semibold">Chủ đề<input className="input mt-1" maxLength={300} value={editing.niche} onChange={(e) => setEditing({ ...editing, niche: e.target.value })} /></label>
        <label className="text-sm font-semibold">Lịch đăng<input className="input mt-1" maxLength={300} value={editing.schedule} onChange={(e) => setEditing({ ...editing, schedule: e.target.value })} /></label>
      </div>
      <div className="flex flex-wrap gap-2"><button className="btn btn-primary" disabled={busy}>Lưu thông tin</button><button type="button" disabled={busy} className="btn btn-outline" onClick={() => setEditing(null)}>Hủy</button></div>
    </form>}
  </div>;
}
