import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { apiGet, apiPost, apiPatch, apiDelete, ApiError } from '../lib/api-client';
import { useAuth } from '../context/AuthContext';
import {
  MAX_CHANNEL_GRANTS, STAFF_ROLES,
  type ChannelGrant, type InviteStatus, type StaffRole, type TeamChannel, type TeamInvite, type TeamMember,
} from '../lib/team';

const ICONS = {
  mail: 'M20 12V5H4v14h9M4 6l8 6 8-6m-2 10v6m-3-3h6',
  people: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2m20 0v-2a4 4 0 0 0-3-4M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0zm4-4a4 4 0 0 1 0 8',
  shield: 'M12 22c5-2 8-5 8-11V5l-8-3-8 3v6c0 6 3 9 8 11zm-3-10 2 2 4-4',
  video: 'M4 5h11a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2zm13 5 5-3v10l-5-3',
  eye: 'M2 12s3-6 10-6 10 6 10 6-3 6-10 6-10-6-10-6zm13 0a3 3 0 1 1-6 0 3 3 0 0 1 6 0z',
  sliders: 'M4 6h4m4 0h8M4 12h9m4 0h3M4 18h2m4 0h10M8 3v6m9 0v6m-7 0v6',
  search: 'M15 15l5 5m-3-9a6 6 0 1 1-12 0 6 6 0 0 1 12 0z',
} as const;
function Icon({ name, className = 'h-4 w-4' }: { name: keyof typeof ICONS; className?: string }) {
  return <svg aria-hidden="true" className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d={ICONS[name]} /></svg>;
}

const ROLES = Object.keys(STAFF_ROLES) as StaffRole[];
const statusLabels: Record<InviteStatus, [string, string]> = {
  pending: ['Chờ chấp nhận', 'badge-yellow'], used: ['Đã tham gia', 'badge-green'],
  expired: ['Hết hạn', 'badge-gray'], revoked: ['Đã thu hồi', 'badge-gray'], legacy: ['Link cũ', 'badge-gray'],
};
type InviteForm = { email: string; staffRole: StaffRole; grants: ChannelGrant[] };
type Editor = { kind: 'create' } | { kind: 'member'; value: TeamMember } | { kind: 'invite'; value: TeamInvite };
type CreatedLink = { id: string; email: string; link: string; expiresAt: number };
const errorText = (error: unknown, fallback: string) => error instanceof ApiError ? error.message : fallback;
const normalize = (text: string) => text.toLocaleLowerCase('vi').normalize('NFD').replace(/\p{Diacritic}/gu, '').replace(/đ/g, 'd');

function RoleOptions({ filter = false }: { filter?: boolean }) {
  return <>{filter && <option value="">Tất cả vai trò</option>}{ROLES.map((role) => <option key={role} value={role}>{STAFF_ROLES[role].label} ({STAFF_ROLES[role].hint})</option>)}</>;
}
function RoleBadge({ role }: { role: StaffRole }) {
  const tones = { leader: 'bg-purple-50 text-purple-800', manager: 'bg-blue-50 text-blue-800', editor: 'bg-amber-50 text-amber-800', viewer: 'badge-gray' };
  return <span className={`badge whitespace-nowrap ${tones[role]}`}>{STAFF_ROLES[role].label}</span>;
}

function AccessEditor({ editor, initial, onClose, save }: { editor: Editor; initial: InviteForm; onClose: () => void; save: (values: InviteForm) => Promise<void> }) {
  const [form, setForm] = useState(initial);
  const [channels, setChannels] = useState<TeamChannel[] | null>(null);
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDialogElement>(null);
  const grants = new Map(form.grants.map((grant) => [grant.channelId, grant.level]));
  const currentIds = new Set(channels?.map((channel) => channel.id));
  const validGrants = form.grants.filter((grant) => currentIds.has(grant.channelId));

  useEffect(() => { ref.current?.showModal(); }, []);
  useEffect(() => {
    let active = true;
    apiGet<{ items: TeamChannel[] }>('/api/channels').then((data) => { if (active) setChannels(data.items); })
      .catch((err) => { if (active) setError(errorText(err, 'Không tải được các kênh của team.')); });
    return () => { active = false; };
  }, []);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!channels) return;
    setBusy(true);
    setError('');
    try { await save({ ...form, grants: validGrants }); onClose(); }
    catch (err) { setError(errorText(err, 'Không lưu được thay đổi.')); }
    finally { setBusy(false); }
  };
  const visible = channels?.filter((channel) => normalize(`${channel.channelName} ${channel.channelId}`).includes(normalize(query.trim()))) || [];

  return (
    <dialog ref={ref} className="m-auto w-[calc(100%-1.5rem)] max-w-2xl rounded-2xl border border-line bg-white p-0 text-ink shadow-soft backdrop:bg-slate-900/50" aria-labelledby="team-editor-title" onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }}>
      <form onSubmit={submit} className="flex max-h-[90dvh] flex-col">
        <header className="flex shrink-0 items-center justify-between gap-2 border-b border-line p-4 sm:px-6">
          <h2 className="text-lg font-extrabold" id="team-editor-title">{editor.kind === 'member' ? 'Sửa phân quyền' : editor.kind === 'invite' ? 'Cấp lại link mời' : 'Mời kèm phân quyền'}</h2>
          <button type="button" className="btn btn-ghost !px-2" aria-label="Đóng" onClick={onClose} disabled={busy}>✕</button>
        </header>
        <div className="space-y-4 overflow-y-auto p-4 sm:px-6">
          {editor.kind === 'invite' && <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">Khi cấp lại, link trước đó sẽ mất hiệu lực. Link mới dùng được một lần trong 7 ngày.</p>}
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="min-w-0 text-sm font-semibold">Email nhân viên<input className="input mt-1" type="email" name="email" value={form.email} maxLength={254} required readOnly={editor.kind !== 'create'} onChange={(e) => setForm({ ...form, email: e.target.value })} /></label>
            <label className="min-w-0 text-sm font-semibold">Vai trò phân công<select className="input mt-1" value={form.staffRole} onChange={(e) => setForm({ ...form, staffRole: e.target.value as StaffRole })}><RoleOptions /></select></label>
          </div>
          <p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-600">{STAFF_ROLES[form.staffRole].summary}</p>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div><h3 className="font-bold">Ma trận quyền theo kênh</h3><p className="text-xs text-slate-500">Đã gán {validGrants.length}/{MAX_CHANNEL_GRANTS} kênh</p></div>
            <input className="input sm:!w-auto" type="search" aria-label="Tìm kênh" placeholder="Tìm kênh…" value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
          {!channels && !error && <p role="status" className="text-sm text-slate-500">Đang tải kênh…</p>}
          {channels && <div className="divide-y divide-line rounded-lg border border-line">
            {visible.map((channel) => <label key={channel.id} className="grid items-center gap-2 p-3 sm:grid-cols-[1fr_11rem]">
              <span className="min-w-0"><span className="block break-words text-sm font-semibold">{channel.channelName || 'Kênh chưa đặt tên'}</span>{channel.channelId && <span className="block break-all font-mono text-[11px] text-slate-500">{channel.channelId}</span>}</span>
              <select className="input" aria-label={`Quyền kênh ${channel.channelName || channel.id}`} value={grants.get(channel.id) || ''} onChange={(event) => {
                const level = event.target.value as ChannelGrant['level'] | '';
                const next = validGrants.filter((item) => item.channelId !== channel.id);
                if (level) {
                  if (next.length >= MAX_CHANNEL_GRANTS) { setError(`Chỉ gán tối đa ${MAX_CHANNEL_GRANTS} kênh mỗi người.`); return; }
                  next.push({ channelId: channel.id, level });
                }
                setError('');
                setForm({ ...form, grants: next });
              }}><option value="">Không cấp quyền</option><option value="view">Chỉ xem</option><option value="role">Theo vai trò</option></select>
            </label>)}
            {!visible.length && <p className="p-4 text-sm text-slate-500">{channels.length ? 'Không tìm thấy kênh khớp.' : 'Team chưa có kênh. Bạn vẫn có thể mời trước và gán kênh sau.'}</p>}
          </div>}
          {channels && validGrants.length < form.grants.length && <p className="text-xs text-amber-800">Kênh đã xóa khỏi team sẽ không được giữ lại khi lưu.</p>}
          {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}</p>}
        </div>
        <footer className="flex shrink-0 flex-wrap justify-end gap-2 border-t border-line p-4 sm:px-6">
          <button type="button" className="btn btn-outline" onClick={onClose} disabled={busy}>Hủy</button>
          <button type="submit" className="btn btn-primary" disabled={busy || !channels}>{busy ? 'Đang lưu…' : editor.kind === 'member' ? 'Lưu phân quyền' : editor.kind === 'invite' ? 'Cấp link mới' : 'Tạo lời mời'}</button>
        </footer>
      </form>
    </dialog>
  );
}

export default function TeamPage() {
  const { profile, isReadOnly } = useAuth();
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [invites, setInvites] = useState<TeamInvite[]>([]);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<StaffRole>('editor');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('');
  const [section, setSection] = useState<'members' | 'invites'>('members');
  const [editor, setEditor] = useState<Editor | null>(null);
  const [links, setLinks] = useState<Record<string, CreatedLink>>({});
  const [selectedLink, setSelectedLink] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const linkInput = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoadError('');
    try {
      const [m, i] = await Promise.all([apiGet<{ items: TeamMember[] }>('/api/team/members'), apiGet<{ items: TeamInvite[] }>('/api/team/invites')]);
      setMembers(m.items);
      setInvites(i.items);
    } catch (err) { setLoadError(errorText(err, 'Không tải được dữ liệu nhân sự.')); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const create = async (values: InviteForm, replace?: string) => {
    const data = await apiPost<{ id: string; token: string; expiresAt: number }>('/api/team/invites', { ...values, replace });
    const url = new URL('/join', window.location.origin);
    url.hash = new URLSearchParams({ token: data.token }).toString();
    const link = { id: data.id, email: values.email.trim(), link: url.href, expiresAt: data.expiresAt };
    setLinks((previous) => {
      const next = { ...previous, [data.id]: link };
      if (replace) delete next[replace];
      return next;
    });
    setSelectedLink(data.id);
    setSection('invites');
    setFilter('');
    setSearch('');
    setEmail('');
    setMessage('Đã tạo lời mời. Sao chép link hoặc soạn email để gửi cho nhân viên.');
    await load();
  };

  const run = async (fn: () => Promise<void>) => {
    setBusy(true); setError(''); setMessage('');
    try { await fn(); }
    catch (err) { setError(errorText(err, 'Không thể thực hiện thao tác.')); }
    finally { setBusy(false); }
  };

  const copy = async (invite: CreatedLink) => {
    setSelectedLink(invite.id);
    try { await navigator.clipboard.writeText(invite.link); setMessage('Đã sao chép link mời.'); }
    catch { requestAnimationFrame(() => { linkInput.current?.focus(); linkInput.current?.select(); }); setMessage('Hãy chọn và sao chép link trong ô bên dưới.'); }
  };

  const revoke = (kind: 'member' | 'invite', id: string, address: string) => {
    if (!window.confirm(kind === 'member' ? `Thu hồi quyền của ${address}? Người này sẽ không còn truy cập các kênh của team.` : 'Thu hồi lời mời này? Link sẽ không còn dùng được.')) return;
    void run(async () => {
      await apiDelete(`/api/team/${kind === 'member' ? 'members' : 'invites'}/${encodeURIComponent(id)}`);
      if (kind === 'invite') setLinks((previous) => { const next = { ...previous }; delete next[id]; return next; });
      setMessage(kind === 'member' ? 'Đã thu hồi quyền thành viên.' : 'Đã thu hồi lời mời.');
      await load();
    });
  };

  const match = (item: TeamMember | TeamInvite) => (!filter || item.staffRole === filter) && normalize(`${item.email} ${'displayName' in item ? item.displayName : ''} ${item.teamName}`).includes(normalize(search.trim()));
  const shownMembers = members.filter(match);
  const shownInvites = invites.filter(match);
  const pending = invites.filter((item) => item.status === 'pending').length;
  const counts = (r: StaffRole) => members.filter((member) => member.staffRole === r).length;
  const stats = [
    { title: 'Tổng nhân sự', value: members.length, caption: 'Thành viên đã gia nhập team', icon: 'people', color: 'text-rose-600 bg-rose-50' },
    { title: 'Leader & Manager', value: counts('leader') + counts('manager'), caption: `${counts('leader')} Leader · ${counts('manager')} Channel Manager`, icon: 'shield', color: 'text-violet-600 bg-violet-50' },
    { title: 'Editor', value: counts('editor'), caption: 'Soạn và lưu bản nháp video', icon: 'video', color: 'text-amber-700 bg-amber-50' },
    { title: 'Viewer (Chỉ xem)', value: counts('viewer'), caption: 'Theo dõi kênh được phân công', icon: 'eye', color: 'text-indigo-600 bg-indigo-50' },
  ] as const;
  const selected = links[selectedLink];
  const activeLink = selected && selected.expiresAt > Date.now() && !invites.some((item) => item.id === selected.id && item.status !== 'pending') ? selected : null;
  const initial: InviteForm = !editor || editor.kind === 'create' ? { email, staffRole: role, grants: [] } : editor.value;

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight">Quản lý Nhân sự &amp; Phân quyền Enterprise</h1>
          <p className="mt-1 text-sm text-slate-600">Mời nhân viên bằng email, quản lý link 7 ngày và phân quyền theo từng kênh.</p>
        </div>
        <button type="button" className="btn btn-outline" onClick={() => setEditor({ kind: 'create' })} disabled={busy || isReadOnly}><Icon name="sliders" /> Mời kèm phân quyền</button>
      </header>

      <section className="card !border-red-100 p-4 sm:p-5" aria-labelledby="quick-invite-title">
        <div className="flex items-start gap-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-red-50 text-red-700"><Icon name="mail" className="h-5 w-5" /></span>
          <div>
            <h2 id="quick-invite-title" className="font-bold">Mời nhân viên nhanh vào Team</h2>
            <p className="mt-0.5 text-sm leading-relaxed text-slate-600">Link dùng một lần, hiệu lực 7 ngày và chỉ nhận đúng email được mời. Nhân viên chỉ vào Kênh, Video và SEO; không có quyền vào Bảng giá, AdSense hay License Key.</p>
          </div>
        </div>
        <form className="mt-4 grid items-end gap-3 lg:grid-cols-[1.25fr_1fr_.72fr]" onSubmit={(event) => { event.preventDefault(); void run(() => create({ email, staffRole: role, grants: [] })); }}>
          <label className="min-w-0 text-sm font-semibold">Email nhân viên (Gmail)<input type="email" className="input mt-1 !py-2.5" autoComplete="off" placeholder="nhanvien@gmail.com" required maxLength={254} value={email} onChange={(e) => setEmail(e.target.value)} disabled={isReadOnly} /></label>
          <label className="min-w-0 text-sm font-semibold">Vai trò phân công<select className="input mt-1 !py-2.5" value={role} onChange={(e) => setRole(e.target.value as StaffRole)} disabled={isReadOnly}><RoleOptions /></select></label>
          <button type="submit" className="btn btn-primary !py-2.5" disabled={busy || isReadOnly}><Icon name="mail" />{busy ? 'Đang xử lý…' : 'Tạo lời mời'}</button>
        </form>
        <p className="mt-2 text-xs text-slate-500">{isReadOnly ? 'Team đang ở chế độ chỉ xem. Bạn vẫn có thể thu hồi lời mời hoặc quyền thành viên.' : 'Mời nhanh chưa cấp kênh. Muốn gán kênh ngay, dùng “Mời kèm phân quyền”.'}</p>
        {error && <p role="alert" className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}</p>}
        {message && <p role="status" className="mt-3 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-900">{message}</p>}
        {activeLink && <div className="mt-3 space-y-2 rounded-lg border border-red-100 bg-red-50/40 p-3">
          <label className="block text-sm font-semibold" htmlFor="team-invite-link">Link mời cho {activeLink.email}</label>
          <div className="flex flex-wrap gap-2">
            <input ref={linkInput} id="team-invite-link" readOnly className="input min-w-0 flex-[1_0_100%] font-mono text-xs sm:flex-[1_0_12rem]" value={activeLink.link} onFocus={(e) => e.target.select()} />
            <button type="button" className="btn btn-outline" onClick={() => void copy(activeLink)}>Sao chép link</button>
            <a className="btn btn-outline" href={`mailto:${encodeURIComponent(activeLink.email).replace('%40', '@')}?subject=${encodeURIComponent(`Lời mời tham gia ${profile?.teamName || 'team'}`)}&body=${encodeURIComponent(`Mở link bằng tài khoản Google đã được mời để tham gia team. Link còn hiệu lực 7 ngày kể từ khi tạo:\n\n${activeLink.link}`)}`}>Soạn email</a>
          </div>
          <p className="text-xs text-slate-500">Hệ thống không tự gửi email. Khi rời trang, bạn có thể cấp link mới nếu chưa sao chép.</p>
        </div>}
      </section>

      <dl className="grid grid-cols-1 gap-3 min-[460px]:grid-cols-2 xl:grid-cols-4">
        {stats.map((stat) => <div key={stat.title} className="card p-4 sm:p-5">
          <dt className="flex items-center justify-between gap-2 text-sm font-medium text-slate-600">{stat.title}<span className={`rounded-lg p-2 ${stat.color}`}><Icon name={stat.icon} /></span></dt>
          <dd className="-mt-0.5 text-2xl font-extrabold tabular-nums">{loading || loadError ? '—' : stat.value}</dd>
          <dd className="mt-0.5 text-xs leading-relaxed text-slate-500">{stat.caption}</dd>
        </div>)}
      </dl>

      <section className="card" aria-labelledby="team-list-title">
        <header className="flex flex-wrap justify-between gap-3 border-b border-line p-4 sm:p-5">
          <div>
            <h2 id="team-list-title" className="font-bold">Danh sách thành viên Team</h2>
            <p className="mt-0.5 text-sm text-slate-600">{profile?.teamName || 'Team của tôi'} · Quản lý lời mời, gán kênh và thu hồi quyền.</p>
          </div>
          <div className="flex w-full flex-wrap items-center gap-2 lg:w-auto">
            <label className="relative flex-1 lg:flex-none"><Icon name="search" className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" /><input type="search" className="input !pl-9 lg:w-56" aria-label="Tìm theo email, tên, nhóm" placeholder="Tìm email, tên, nhóm…" value={search} onChange={(e) => setSearch(e.target.value)} /></label>
            <select className="input lg:w-48" aria-label="Lọc theo vai trò" value={filter} onChange={(e) => setFilter(e.target.value)}><RoleOptions filter /></select>
          </div>
        </header>
        <div className="flex flex-wrap gap-2 border-b border-line px-4 py-2 sm:px-5" role="group" aria-label="Danh sách nhân sự">
          <button type="button" aria-pressed={section === 'members'} className={`btn ${section === 'members' ? 'btn-outline !bg-slate-100' : 'btn-ghost'}`} onClick={() => setSection('members')}>Thành viên</button>
          <button type="button" aria-pressed={section === 'invites'} className={`btn ${section === 'invites' ? 'btn-outline !bg-slate-100' : 'btn-ghost'}`} onClick={() => { setSection('invites'); void load(); }}>Lời mời {pending > 0 && <span className="badge badge-yellow">{pending}</span>}</button>
        </div>
        {loading ? <p role="status" className="p-12 text-center text-sm text-slate-500">Đang tải nhân sự…</p> : loadError ? <div className="p-6 text-center"><p role="alert" className="mb-3 text-sm text-red-700">{loadError}</p><button type="button" className="btn btn-outline" onClick={() => void load()}>Tải lại</button></div> : (section === 'members' ? shownMembers.length : shownInvites.length) === 0 ? (
          <div className="px-4 py-10 text-center sm:py-14">
            <span className="mx-auto grid h-11 w-11 place-items-center rounded-xl border border-line bg-slate-50 text-slate-500"><Icon name={section === 'members' ? 'people' : 'mail'} className="h-5 w-5" /></span>
            <p className="mt-4 font-bold">{search || filter ? 'Không có kết quả phù hợp' : section === 'members' ? 'Team chưa có nhân viên nào' : 'Chưa tạo lời mời nào'}</p>
            <p className="mx-auto mt-1 max-w-md text-sm text-slate-600">{search || filter ? 'Hãy đổi từ khóa hoặc vai trò đang lọc.' : 'Nhập email nhân viên và bấm “Tạo lời mời” để nhận link gia nhập team.'}</p>
          </div>
        ) : <div className="table-wrap"><table className="data">
          <thead><tr><th>{section === 'members' ? 'Nhân viên' : 'Email nhận lời mời'}</th><th>Vai trò</th><th>Kênh</th><th>Trạng thái</th><th>Thao tác</th></tr></thead>
          <tbody>{section === 'members' ? shownMembers.map((m) => <tr key={m.uid}>
            <td><b className="block break-all">{m.displayName || m.email}</b>{m.displayName && <span className="break-all text-xs text-slate-500">{m.email}</span>}</td>
            <td><RoleBadge role={m.staffRole} /></td><td className="whitespace-nowrap">{m.grants.length ? `${m.grants.length} kênh` : 'Chưa gán kênh'}</td><td><span className="badge badge-green whitespace-nowrap">Đã tham gia</span></td>
            <td><div className="flex gap-1.5"><button type="button" disabled={busy || isReadOnly} className="btn btn-outline !px-2 !py-1 !text-xs" onClick={() => setEditor({ kind: 'member', value: m })}>Sửa quyền</button><button type="button" disabled={busy} className="btn btn-ghost !px-2 !py-1 !text-xs !text-red-700" onClick={() => revoke('member', m.uid, m.email)}>Thu hồi quyền</button></div></td>
          </tr>) : shownInvites.map((item) => {
            const status = item.status === 'pending' && item.expiresAt <= Date.now() ? 'expired' : item.status;
            return <tr key={item.id}>
              <td><b className="break-all">{item.email || 'Lời mời cũ'}</b><span className="mt-0.5 block whitespace-nowrap text-xs text-slate-500">{item.expiresAt ? `Hết hạn ${new Date(item.expiresAt).toLocaleDateString('vi-VN')}` : '—'}</span></td>
              <td><RoleBadge role={item.staffRole} /></td><td className="whitespace-nowrap">{item.grants.length ? `${item.grants.length} kênh` : 'Chưa gán kênh'}</td><td><span className={`badge whitespace-nowrap ${statusLabels[status][1]}`}>{statusLabels[status][0]}</span></td>
              <td><div className="flex gap-1.5">
                {status === 'pending' && <><button type="button" disabled={busy || (!links[item.id] && isReadOnly)} className="btn btn-outline !px-2 !py-1 !text-xs" onClick={() => links[item.id] ? void copy(links[item.id]) : setEditor({ kind: 'invite', value: item })}>{links[item.id] ? 'Sao chép' : 'Cấp lại link'}</button>
                  <button type="button" disabled={busy} className="btn btn-ghost !px-2 !py-1 !text-xs !text-red-700" onClick={() => revoke('invite', item.id, item.email)}>Thu hồi</button></>}
                {status === 'legacy' && <button type="button" disabled={busy} className="btn btn-ghost !px-2 !py-1 !text-xs !text-red-700" onClick={() => revoke('invite', item.id, item.email)}>Thu hồi</button>}
                {status === 'expired' && item.email && <button type="button" disabled={busy || isReadOnly} className="btn btn-outline !px-2 !py-1 !text-xs" onClick={() => { setEmail(item.email); setRole(item.staffRole); setEditor({ kind: 'create' }); }}>Mời lại</button>}
              </div></td>
            </tr>;
          })}</tbody>
        </table></div>}
      </section>
      {editor && <AccessEditor editor={editor} initial={initial} onClose={() => setEditor(null)} save={async (values) => {
        setError(''); setMessage('');
        if (editor.kind === 'member') {
          await apiPatch(`/api/team/members/${encodeURIComponent(editor.value.uid)}`, { staffRole: values.staffRole, grants: values.grants });
          setMessage('Đã cập nhật quyền thành viên.');
          await load();
        } else await create(values, editor.kind === 'invite' ? editor.value.id : undefined);
      }} />}
    </div>
  );
}
