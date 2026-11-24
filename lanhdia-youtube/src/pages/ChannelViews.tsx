import { useCallback, useEffect, useState } from 'react';
import { apiGet, ApiError } from '../lib/api-client';
import { useAuth } from '../context/AuthContext';
import VideoDrafts from '../components/VideoDrafts';
import type { ChannelRecord as Channel } from '../lib/channel-record';
import ChannelTable, { type ChannelColumn } from '../components/ChannelTable';

// Các trang Quản lý Gmail / BKT & AdSense / Video & Phim ngắn / Máy chủ proxy
// đều đọc từ dữ liệu ma trận kênh thực tế (Mục 5), hiển thị theo góc độ khác nhau.

function useChannels() {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    try {
      const data = await apiGet<{ items: Channel[] }>('/api/channels');
      setChannels(data.items);
    } catch (err) { setError(err instanceof ApiError ? err.message : 'Không tải được các kênh.'); } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);
  return { channels, loading, error };
}

function ViewShell({
  title, desc, columns, filter, showWorkstation, showDrafts, staff = false,
}: {
  title: string; desc: string; columns: ChannelColumn[];
  filter?: (c: Channel) => boolean; showWorkstation?: boolean; showDrafts?: boolean; staff?: boolean;
}) {
  const { channels, loading, error } = useChannels();
  const shown = filter ? channels.filter(filter) : channels;
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight text-slate-900">{title}</h1>
        <p className="mt-1 text-sm text-slate-500">{desc}</p>
      </div>
      {loading ? (
        <div className="card p-10 text-center text-sm text-slate-400">Đang tải...</div>
      ) : error ? <p role="alert" className="card p-4 text-sm text-red-700">{error}</p>
      : staff && !shown.length ? <p className="card p-8 text-center text-sm text-slate-600">Bạn chưa được gán kênh.</p>
      : (
        <ChannelTable channels={shown} columns={columns} showWorkstation={showWorkstation} />
      )}
      {showDrafts && !error && <VideoDrafts channels={shown} staff={staff} />}
    </div>
  );
}

export function GmailPage() {
  return (
    <ViewShell
      title="Quản lý Gmail"
      desc="Các Gmail quản lý kênh, trích từ ma trận kênh."
      columns={['gmail', 'channelName', 'channelId', 'niche', 'bktStatus']}
      filter={(c) => Boolean(c.gmail)}
    />
  );
}

export function BktPage() {
  return (
    <ViewShell
      title="BKT & AdSense"
      desc="Trạng thái kiếm tiền do bạn ghi nhận theo từng kênh; không tự đọc AdSense hoặc YouTube Studio."
      columns={['channelName', 'channelId', 'gmail', 'monetized', 'bktStatus', 'note']}
      filter={(c) => typeof c.monetized === 'boolean' || Boolean(c.bktStatus)}
    />
  );
}

export function VideosPage() {
  const staff = useAuth().profile?.role === 'staff';
  return (
    <ViewShell
      title="Video & Phim ngắn"
      desc={staff ? "Lịch đăng và bản nháp của các kênh được phân công." : "Thư mục video máy trạm, lịch đăng và bản nháp theo từng kênh."}
      columns={staff ? ['channelName', 'channelId', 'schedule'] : ['channelName', 'channelId', 'videoFolder', 'schedule', 'actions']}
      showWorkstation={!staff}
      showDrafts staff={staff}
    />
  );
}

export function ProxyPage() {
  return (
    <ViewShell
      title="Máy chủ proxy"
      desc="Proxy/IP đang gán cho từng kênh."
      columns={['channelName', 'channelId', 'proxy', 'gmail']}
      filter={(c) => Boolean(c.proxy)}
    />
  );
}
