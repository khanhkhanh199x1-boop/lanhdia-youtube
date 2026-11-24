import { useState, type ReactNode } from 'react';
import { Routes, Route, Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import LoginPage from './pages/LoginPage';
import JoinPage from './pages/JoinPage';
import AdminPage from './pages/AdminPage';
import OverviewPage from './pages/OverviewPage';
import ChannelsPage from './pages/ChannelsPage';
import TeamPage from './pages/TeamPage';
import { STAFF_ROUTES } from './lib/team';
import { readChromeImport } from './lib/channel-target';
import { readCaptureHash } from './lib/chrome-hub';
import ChromeVerifyPage from './pages/ChromeVerifyPage';
import { GmailPage, BktPage, VideosPage, ProxyPage } from './pages/ChannelViews';
import { AdsPage, SeoPage, CommentsPage, CreditsPage, SettingsPage } from './pages/SimplePages';
import PricingView from './components/pricing/PricingView';
import Sidebar from './components/Sidebar';
import Header from './components/Header';
import UtilitiesPanel from './components/utilities/UtilitiesPanel';
import YouTubeToolsPage, { YOUTUBE_TOOLS_PATH } from './pages/YouTubeToolsPage';

// Route bảo vệ: chưa đăng nhập -> về /login.
function ProtectedRoute({ children }: { children: ReactNode }) {
  const { user, loading, profileError, refreshProfile, signOut } = useAuth();
  const { pathname, hash } = useLocation();
  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-slate-500">
        Đang tải...
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace state={pathname === "/channels" && (readChromeImport(hash) || readCaptureHash(hash)) ? { channelImport: hash } : undefined} />;
  if (profileError) return <main className="grid min-h-screen place-items-center p-4">
    <div className="card max-w-md space-y-3 p-5 text-sm">
      <p role="alert">{profileError}</p>
      <button type="button" className="btn btn-primary mr-2" onClick={refreshProfile}>Thử lại</button>
      <button type="button" className="btn btn-outline" onClick={signOut}>Đăng xuất</button>
    </div>
  </main>;
  return <>{children}</>;
}

// Route chỉ root (Master Admin).
function RootRoute({ children }: { children: ReactNode }) {
  const { isRoot, loading } = useAuth();
  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-slate-500">
        Đang tải...
      </div>
    );
  }
  if (!isRoot) return <Navigate to="/" replace />;
  return <>{children}</>;
}

// Trang Tiện ích toàn màn hình (route /utilities).
function UtilitiesPage() {
  const navigate = useNavigate();
  return (
    <div className="h-[calc(100vh-140px)]">
      <UtilitiesPanel onClose={() => navigate('/')} />
    </div>
  );
}

// Layout dashboard: Sidebar trái + Header + nội dung + Cột Tiện ích (phải).
function DashboardLayout() {
  const [utilitiesOpen, setUtilitiesOpen] = useState(false);
  const { isReadOnly, isRoot, profile } = useAuth();
  const path = useLocation().pathname.toLowerCase().replace(/\/+$/, '') || '/';
  const staff = profile?.role === 'staff';
  if (staff && !STAFF_ROUTES.some((route) => route === path)) return <Navigate to="/channels" replace />;
  const scope = JSON.stringify([profile?.uid, profile?.tenantId, profile?.role, profile?.staffRole, profile?.grants, isReadOnly]);
  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Header
          onToggleUtilities={() => setUtilitiesOpen((o) => !o)}
          utilitiesOpen={utilitiesOpen}
        />
        {/* Banner Read-Only vàng — chỉ tenant/staff không có quyền ghi; root không bao giờ thấy. */}
        {isReadOnly && !isRoot && (
          <div className="banner-readonly flex flex-wrap items-center justify-between gap-2 px-4 py-2 text-sm">
            <span>{staff ? 'Bạn có quyền chỉ xem các kênh được phân công.' : '⚠ Tài khoản đang ở chế độ chỉ xem. Bạn không thể thêm, sửa hoặc xóa dữ liệu.'}</span>
            {!staff && <a href="/pricing" className="font-bold underline">Nâng cấp / Gia hạn ngay</a>}
          </div>
        )}
        <main className="flex-1 overflow-y-auto p-4 md:p-6">
          <Outlet key={scope} />
        </main>
      </div>
      {utilitiesOpen && <UtilitiesPanel key={scope} onClose={() => setUtilitiesOpen(false)} onOpenResearch={() => setUtilitiesOpen(false)} />}
    </div>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/chrome-verify" element={<ChromeVerifyPage />} />
      <Route path="/join" element={<JoinPage />} />
      <Route
        path="/"
        element={
          <ProtectedRoute>
            <DashboardLayout />
          </ProtectedRoute>
        }
      >
        <Route index element={<OverviewPage />} />
        <Route path="gmail" element={<GmailPage />} />
        <Route path="channels" element={<ChannelsPage />} />
        <Route path="team" element={<TeamPage />} />
        <Route path="bkt" element={<BktPage />} />
        <Route path="videos" element={<VideosPage />} />
        <Route path="ads" element={<AdsPage />} />
        <Route path="seo" element={<SeoPage />} />
        <Route path="comments" element={<CommentsPage />} />
        <Route path="proxy" element={<ProxyPage />} />
        <Route path="utilities" element={<UtilitiesPage />} />
        <Route path={YOUTUBE_TOOLS_PATH} element={<YouTubeToolsPage />} />
        <Route path="credits" element={<CreditsPage />} />
        <Route path="pricing" element={<PricingView />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route
          path="admin"
          element={
            <RootRoute>
              <AdminPage />
            </RootRoute>
          }
        />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
