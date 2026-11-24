import ChromeOpen from './ChromeOpen';
import type { ChannelRecord } from '../lib/channel-record';
import type { ChannelRow } from '../lib/sheet-parser';
import { buildUploadUrl, buildOpenFolderUrl, openProtocol } from '../lib/protocol';

// Bảng kênh dùng chung cho các trang Quản lý Gmail / Kênh / BKT / Video / Proxy.
// Các cột hiển thị tùy theo trang (props.columns).

export type ChannelColumn = keyof ChannelRow | 'monetized' | 'actions';

interface Props {
  channels: ChannelRecord[];
  columns: ChannelColumn[];
  onEdit?: (channel: { id: string } & ChannelRow) => void;
  onDelete?: (id: string) => void;
  showWorkstation?: boolean;
}

const COLUMN_LABELS: Record<string, string> = {
  rowIndex: 'Dòng',
  stt: 'STT',
  channelName: 'Tên kênh',
  channelId: 'ID Kênh',
  gmail: 'Gmail quản lý',
  proxy: 'Proxy/IP',
  bktStatus: 'Trạng thái BKT',
  monetized: 'Kiếm tiền (ghi nhận)',
  niche: 'Chủ đề/Niche',
  videoFolder: 'Thư mục video',
  schedule: 'Lịch đăng',
  note: 'Ghi chú',
  actions: 'Thao tác',
};

export default function ChannelTable({ channels, columns, onEdit, onDelete, showWorkstation }: Props) {
  if (channels.length === 0) {
    return (
      <div className="card p-10 text-center text-sm text-slate-400">
        Chưa có dữ liệu kênh. Hãy đồng bộ từ Google Sheet ở trang Quản lý Kênh.
      </div>
    );
  }
  return (
    <div className="card">
      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              {columns.map((c) => (
                <th key={c}>{COLUMN_LABELS[c] || c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {channels.map((ch) => (
              <tr key={ch.id}>
                {columns.map((c) => {
                  if (c === 'actions') {
                    return (
                      <td key={c}>
                        <div className="flex flex-wrap gap-1.5">
                          {showWorkstation && (
                            <>
                              {ch.chromeLink ? <ChromeOpen channel={ch} /> : <button
                                type="button"
                                className="btn btn-primary !px-2 !py-1 text-xs"
                                onClick={() => openProtocol(buildUploadUrl(ch.rowIndex, ch.channelId, ch.videoFolder))}
                                title="Mở YouTube Studio trên máy trạm"
                              >
                                Mở Studio (helper cũ)
                              </button>}
                              <button
                                type="button"
                                className="btn btn-outline !px-2 !py-1 text-xs"
                                onClick={() => openProtocol(buildOpenFolderUrl(ch.videoFolder))}
                                title="Mở thư mục video trên máy trạm"
                              >
                                Mở thư mục
                              </button>
                            </>
                          )}
                          {onEdit && (
                            <button type="button" className="btn btn-ghost !px-2 !py-1 text-xs" onClick={() => onEdit(ch)}>
                              Sửa
                            </button>
                          )}
                          {onDelete && (
                            <button type="button" className="btn btn-ghost !px-2 !py-1 text-xs text-red-600" onClick={() => onDelete(ch.id)}>
                              Xóa
                            </button>
                          )}
                        </div>
                      </td>
                    );
                  }
                  const val = c === 'monetized' ? (ch.monetized === true ? 'Đã bật' : ch.monetized === false ? 'Chưa bật' : '—') : ch[c];
                  return (
                    <td key={c} className={c === 'channelId' || c === 'gmail' ? 'font-mono text-xs' : ''}>
                      {String(val ?? '')}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
