import { useAuth } from '../context/AuthContext';

// Các trang công cụ đơn giản: Quảng cáo Google, SEO & Nội dung, Bình luận,
// Tìm hiểu về tín dụng, Cài đặt. SEO & Bình luận dùng Cột Tiện ích.

export function AdsPage() {
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight text-slate-900">Quảng cáo Google</h1>
        <p className="mt-1 text-sm text-slate-500">Theo dõi hiệu quả quảng cáo theo kênh từ dữ liệu ma trận.</p>
      </div>
      <div className="card p-5 text-sm text-slate-600">
        <p>Trang này tổng hợp dữ liệu quảng cáo theo từng kênh trong ma trận. Hãy đồng bộ Google Sheet ở
        <b> Quản lý Kênh</b> để có dữ liệu mới nhất, sau đó mở <b>Cột Tiện ích</b> (góc phải header) để dùng
        công cụ SEO &amp; kiểm tra trùng lặp hỗ trợ tối ưu quảng cáo.</p>
      </div>
    </div>
  );
}

export function SeoPage() {
  const staff = useAuth().profile?.role === 'staff';
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight text-slate-900">SEO &amp; Nội dung</h1>
        <p className="mt-1 text-sm text-slate-500">Trích xuất tag và gợi ý từ khóa từ video đối thủ.</p>
      </div>
      <div className="card p-5 text-sm text-slate-600">
        <p>{staff ? <>Bấm <b>SEO &amp; Tags</b> ở thanh trên</> : <>Mở <b>Cột Tiện ích</b> → tab <b>SEO &amp; Tags</b></>} → dán URL video công khai để
        trích xuất tiêu đề, mô tả, thẻ tag và gợi ý từ khóa cho nội dung của bạn.</p>
      </div>
    </div>
  );
}

export function CommentsPage() {
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight text-slate-900">Bình luận</h1>
        <p className="mt-1 text-sm text-slate-500">Mẫu trả lời nhanh và bộ lọc từ khóa tiêu cực.</p>
      </div>
      <div className="card p-5 text-sm text-slate-600">
        <p>Mở <b>Cột Tiện ích</b> (nút 🧰 ở header) → tab <b>Bình luận</b> để quản lý mẫu trả lời nhanh
        và bộ lọc từ khóa tiêu cực cho các kênh của bạn.</p>
      </div>
    </div>
  );
}

export function CreditsPage() {
  const { profile } = useAuth();
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight text-slate-900">Tìm hiểu về tín dụng</h1>
        <p className="mt-1 text-sm text-slate-500">Tín chỉ dùng để thực hiện các thao tác trong hệ thống.</p>
      </div>
      <div className="card max-w-lg p-5">
        <div className="text-sm text-slate-600">Số dư hiện tại</div>
        <div className="mt-1 text-3xl font-extrabold text-slate-900">
          {(profile?.credits ?? 0).toLocaleString('vi-VN')} <span className="text-base font-semibold text-slate-400">tín chỉ</span>
        </div>
        <ul className="mt-4 space-y-1.5 text-sm text-slate-600">
          <li>• Mỗi gói dịch vụ đi kèm một lượng tín chỉ tương ứng.</li>
          <li>• Khi Admin duyệt đơn hàng, bạn được <b>cộng thưởng +50 tín chỉ</b>.</li>
          <li>• Nâng cấp hoặc gia hạn gói tại <b>Bảng giá</b> để nhận thêm tín chỉ.</li>
        </ul>
      </div>
    </div>
  );
}

export function SettingsPage() {
  const { profile, signOut } = useAuth();
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight text-slate-900">Cài đặt</h1>
        <p className="mt-1 text-sm text-slate-500">Thông tin tài khoản và tùy chọn hệ thống.</p>
      </div>
      <div className="card max-w-lg p-5">
        <div className="space-y-2 text-sm text-slate-600">
          <div className="flex justify-between"><span>Email</span><b>{profile?.email}</b></div>
          <div className="flex justify-between"><span>Vai trò</span><b>{profile?.role === 'root' ? 'Quản trị viên chính' : profile?.role === 'staff' ? 'Nhân viên' : 'Chủ team'}</b></div>
          <div className="flex justify-between"><span>Team</span><b>{profile?.teamName || '—'}</b></div>
          <div className="flex justify-between"><span>Gói</span><b>{profile?.plan || 'free'}</b></div>
        </div>
        <button type="button" className="btn btn-outline mt-5 w-full" onClick={signOut}>Đăng xuất</button>
      </div>
    </div>
  );
}
