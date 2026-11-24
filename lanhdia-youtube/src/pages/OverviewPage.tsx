import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiGet } from '../lib/api-client';
import type { ChannelRow } from '../lib/sheet-parser';
import { useAuth } from '../context/AuthContext';

// Trang Tổng quan — thống kê thật từ dữ liệu ma trận kênh.
export default function OverviewPage() {
  const { profile } = useAuth();
  const [channels, setChannels] = useState<Array<{ id: string } & ChannelRow>>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const data = await apiGet<{ items: Array<{ id: string } & ChannelRow> }>('/api/channels');
      setChannels(data.items);
    } catch { /* bỏ qua */ } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const totalChannels = channels.length;
  const totalGmail = new Set(channels.map((c) => c.gmail).filter(Boolean)).size;
  const totalNiche = new Set(channels.map((c) => c.niche).filter(Boolean)).size;
  const totalProxy = new Set(channels.map((c) => c.proxy).filter(Boolean)).size;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight text-slate-900">
          Xin chào, {profile?.displayName || profile?.email}
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          {profile?.role === 'root'
            ? 'Bạn đang đăng nhập với quyền Quản trị viên chính.'
            : `Team: ${profile?.teamName || '—'} · Gói: ${profile?.plan || 'free'}`}
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Tổng số kênh" value={loading ? '...' : String(totalChannels)} />
        <Stat label="Gmail quản lý" value={loading ? '...' : String(totalGmail)} />
        <Stat label="Chủ đề / Niche" value={loading ? '...' : String(totalNiche)} />
        <Stat label="Proxy / IP" value={loading ? '...' : String(totalProxy)} />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="card p-5">
          <div className="mb-2 font-bold text-slate-900">Bắt đầu nhanh</div>
          <ul className="space-y-2 text-sm text-slate-600">
            <li>1. Vào <Link className="font-semibold text-brand" to="/channels">Quản lý Kênh</Link> → nhập URL Google Sheet → <b>Đồng bộ ma trận</b>.</li>
            <li>2. Tải <b>Windows Helper</b> ở mục Máy trạm để điều khiển đăng video.</li>
            <li>3. Mở <b>Cột Tiện ích</b> (góc phải header) để dùng SEO, kiểm tra trùng lặp, proxy.</li>
          </ul>
        </div>
        <div className="card p-5">
          <div className="mb-2 font-bold text-slate-900">Tài khoản của bạn</div>
          <ul className="space-y-1.5 text-sm text-slate-600">
            <li>Vai trò: <b>{profile?.role === 'root' ? 'Quản trị viên chính' : profile?.role === 'staff' ? 'Nhân viên' : 'Chủ team'}</b></li>
            <li>Tín chỉ: <b>{(profile?.credits ?? 0).toLocaleString('vi-VN')}</b></li>
            <li>Gói: <b>{profile?.plan || 'free'}</b>{profile?.expiresAt ? ` · Hết hạn ${new Date(profile.expiresAt).toLocaleDateString('vi-VN')}` : ''}</li>
            <li>Trạng thái: {profile?.isReadOnly ? <span className="badge badge-yellow">Chỉ xem (Read-Only)</span> : <span className="badge badge-green">Hoạt động</span>}</li>
          </ul>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="card p-4">
      <div className="text-xs font-semibold text-slate-500">{label}</div>
      <div className="mt-1 text-2xl font-extrabold tracking-tight text-slate-900">{value}</div>
    </div>
  );
}
