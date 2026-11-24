import { useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { STAFF_ROLES, displayStaffRole } from '../lib/team';

// Header cao ~60px, nền trắng, border-bottom mảnh (Mục 7).
const PAGE_TITLES: Record<string, string> = {
  '/': 'Tổng quan',
  '/gmail': 'Quản lý Gmail',
  '/channels': 'Quản lý Kênh',
  '/team': 'Nhân sự',
  '/bkt': 'BKT & AdSense',
  '/videos': 'Video & Phim ngắn',
  '/ads': 'Quảng cáo Google',
  '/seo': 'SEO & Nội dung',
  '/comments': 'Bình luận',
  '/proxy': 'Máy chủ proxy',
  '/utilities': 'Tiện ích',
  '/utilities/youtube': 'Check kênh đối thủ',
  '/credits': 'Tìm hiểu về tín dụng',
  '/pricing': 'Bảng giá',
  '/settings': 'Cài đặt',
  '/admin': 'Bảng điều khiển quản trị',
};

interface Props {
  onToggleUtilities: () => void;
  utilitiesOpen: boolean;
}

export default function Header({ onToggleUtilities, utilitiesOpen }: Props) {
  const { profile, signOut, isRoot } = useAuth();
  const location = useLocation();
  const title = PAGE_TITLES[location.pathname] || 'LÃNH ĐỊA YOUTUBE';

  const staff = profile?.role === 'staff';
  const roleBadge = isRoot
    ? { text: 'QUẢN TRỊ VIÊN CHÍNH', cls: 'badge-red' }
    : staff
      ? { text: STAFF_ROLES[displayStaffRole(profile.staffRole)].label, cls: 'badge-gray' }
      : { text: 'CHỦ TEAM', cls: 'badge-gray' };

  const initial = (profile?.displayName || profile?.email || '?').charAt(0).toUpperCase();

  return (
    <header className="flex h-[60px] shrink-0 items-center justify-between gap-2 border-b border-line bg-white px-2 sm:px-4">
      <div className="flex min-w-0 items-center gap-2 text-sm">
        <span className="hidden shrink-0 font-bold tracking-tight text-slate-900 xl:inline">LÃNH ĐỊA YOUTUBE</span>
        <span className="hidden text-slate-300 xl:inline">/</span>
        <span className="truncate text-slate-500" title={title}>{title}</span>
      </div>

      <div className="flex shrink-0 items-center gap-1.5 sm:gap-2.5">
        <button
          type="button"
          onClick={onToggleUtilities}
          className={`btn btn-outline !px-2.5 !py-1.5 text-xs ${utilitiesOpen ? '!border-slate-400 bg-slate-100' : ''}`}
          title={staff ? 'Bật/tắt công cụ SEO' : 'Bật/tắt Cột Tiện ích'}
        >
          {staff ? 'SEO & Tags' : '🧰 Tiện ích'}
        </button>
        <span className={`badge !hidden sm:!inline-flex ${roleBadge.cls}`}>{roleBadge.text}</span>
        {!staff && <span className="badge badge-gray !hidden lg:!inline-flex" title="Số tín chỉ">
          {(profile?.credits ?? 0).toLocaleString('vi-VN')} Tín chỉ
        </span>}
        <div className="hidden items-center gap-2 pl-1 lg:flex">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-800 text-sm font-bold text-white">
            {initial}
          </div>
          <div className="hidden leading-tight md:block">
            <div className="text-xs font-semibold text-slate-800">
              {profile?.displayName || 'Người dùng'}
            </div>
            <div className="text-[11px] text-slate-400">{profile?.email}</div>
          </div>
        </div>
        <button type="button" onClick={signOut} className="btn btn-ghost !px-2.5 !py-1.5 text-xs">
          Đăng xuất
        </button>
      </div>
    </header>
  );
}
