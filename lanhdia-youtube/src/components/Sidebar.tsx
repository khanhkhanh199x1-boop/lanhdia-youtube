import { NavLink } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { STAFF_ROUTES } from '../lib/team';

// Sidebar trái cố định ~240px, nền trắng, border-right mảnh (Mục 7).
const MANAGE_ITEMS = [
  { to: '/', label: 'Tổng quan', icon: '▦' },
  { to: '/gmail', label: 'Quản lý Gmail', icon: '✉' },
  { to: '/channels', label: 'Quản lý Kênh', icon: '▶' },
  { to: '/team', label: 'Nhân sự', icon: '👥' },
  { to: '/bkt', label: 'BKT & AdSense', icon: '💳' },
  { to: '/videos', label: 'Video & Phim ngắn', icon: '🎬' },
];

const TOOL_ITEMS = [
  { to: '/ads', label: 'Quảng cáo Google', icon: '◎' },
  { to: '/seo', label: 'SEO & Nội dung', icon: '🔍' },
  { to: '/comments', label: 'Bình luận', icon: '💬' },
  { to: '/proxy', label: 'Máy chủ proxy', icon: '🖥' },
  { to: '/utilities', label: 'Tiện ích', icon: '🧰' },
  { to: '/utilities/youtube', label: 'Check kênh đối thủ', icon: '▥' },
];

const BOTTOM_ITEMS = [
  { to: '/credits', label: 'Tìm hiểu về tín dụng', icon: '◈' },
  { to: '/pricing', label: 'Bảng giá', icon: '🏷' },
  { to: '/settings', label: 'Cài đặt', icon: '⚙' },
];

function Item({ to, label, icon }: { to: string; label: string; icon: string }) {
  return (
    <NavLink
      to={to}
      end={to === '/' || to === '/utilities'}
      aria-label={label}
      title={label}
      className={({ isActive }) =>
        `flex items-center justify-center gap-2.5 rounded-lg px-1 py-2 text-sm transition-colors md:justify-start md:px-3 ${
          isActive
            ? 'bg-slate-100 font-semibold text-slate-900'
            : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
        }`
      }
    >
      <span className="w-5 text-center text-base leading-none">{icon}</span>
      <span className="hidden md:inline">{label}</span>
    </NavLink>
  );
}

export default function Sidebar() {
  const { isRoot, profile } = useAuth();
  const staff = profile?.role === 'staff';
  const allowed = (item: { to: string }) => !staff || STAFF_ROUTES.some((route) => route === item.to);
  return (
    <aside className="flex h-full w-14 shrink-0 flex-col border-r border-line bg-white md:w-60">
      {/* Logo */}
      <div className="flex items-center gap-2.5 border-b border-line px-2.5 py-4 md:px-4">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand text-white">
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor" aria-hidden>
            <path d="M23 7.2s-.2-1.6-.9-2.3c-.9-.9-1.9-.9-2.4-1C16.6 3.6 12 3.6 12 3.6s-4.6 0-7.7.3c-.5.1-1.5.1-2.4 1-.7.7-.9 2.3-.9 2.3S.8 9.1.8 11v1.8c0 1.9.2 3.8.2 3.8s.2 1.6.9 2.3c.9.9 2 .9 2.5 1 1.8.2 7.6.3 7.6.3s4.6 0 7.7-.4c.5-.1 1.5-.1 2.4-1 .7-.7.9-2.3.9-2.3s.2-1.9.2-3.8V11c0-1.9-.2-3.8-.2-3.8zM9.8 15.1V8.4l6.2 3.4-6.2 3.3z" />
          </svg>
        </div>
        <div className="hidden leading-tight md:block">
          <div className="text-sm font-extrabold tracking-tight text-slate-900">LÃNH ĐỊA</div>
          <div className="text-sm font-extrabold tracking-tight text-slate-900">YOUTUBE</div>
        </div>
      </div>

      {/* Menu */}
      <nav className="flex-1 space-y-3 overflow-y-auto px-1 py-4 md:space-y-5 md:px-3">
        <div>
          <div className="hidden px-3 pb-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-400 md:block">
            Quản lý
          </div>
          <div className="space-y-0.5">
            {MANAGE_ITEMS.filter(allowed).map((i) => (
              <Item key={i.to} {...i} />
            ))}
          </div>
        </div>
        <div>
          <div className="hidden px-3 pb-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-400 md:block">
            Công cụ
          </div>
          <div className="space-y-0.5">
            {TOOL_ITEMS.filter(allowed).map((i) => (
              <Item key={i.to} {...i} />
            ))}
          </div>
        </div>
        {!staff && <div className="space-y-0.5 border-t border-line pt-3">
          {BOTTOM_ITEMS.map((i) => (
            <Item key={i.to} {...i} />
          ))}
        </div>}
      </nav>

      {/* Khối Admin (chỉ root) */}
      {isRoot && (
        <div className="p-1.5 md:p-3">
          <NavLink
            to="/admin" aria-label="Bảng điều khiển quản trị" title="Bảng điều khiển quản trị"
            className={({ isActive }) =>
              `block rounded-xl bg-brand p-2.5 text-white md:p-3 shadow-soft transition ${
                isActive ? 'ring-2 ring-red-300' : 'hover:bg-red-700'
              }`
            }
          >
            <div className="flex items-center justify-center gap-2 font-bold md:justify-start">
              <span aria-hidden>🛡</span>
              <span className="hidden md:inline">Bảng điều khiển quản trị</span>
            </div>
            <div className="mt-0.5 hidden text-xs text-red-100 md:block">Quản lý khách thuê &amp; Duyệt đơn</div>
          </NavLink>
        </div>
      )}
    </aside>
  );
}
