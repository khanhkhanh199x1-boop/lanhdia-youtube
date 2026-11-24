import { useCallback, useEffect, useState } from 'react';
import { apiGet, apiPost, apiPut, ApiError } from '../lib/api-client';
import { formatVND } from '../lib/plans';

// ============================================================================
// Bảng điều khiển quản trị (Mục 6 + Mục 7). Chỉ root.
// - 4 thẻ thống kê thật từ GET /api/admin/overview.
// - Tab Đơn hàng chờ duyệt: Duyệt 1-Click / Từ chối.
// - Tab Người thuê: tìm kiếm, gia hạn, cộng/trừ Credits, khóa/mở khóa.
// - Tab Quét bảo mật: quét thật, kết quả thật.
// - Tab Cấu hình VietQR.
// - Banner cảnh báo API màu vàng CHỈ khi API thật sự lỗi.
// ============================================================================

type Tab = 'orders' | 'tenants' | 'security' | 'payment';

interface Overview {
  totalTenants: number; totalRevenue: number; pendingOrders: number; activeSubscribers: number;
}
interface Order {
  id: string; code: string; email: string; planId: string; amount: number; status: string; createdAt: number;
}
interface Tenant {
  uid: string; email: string; displayName: string; role: string; plan: string;
  expiresAt: number; credits: number; isReadOnly: boolean; teamName: string; channelCount: number;
}
interface ScanResult {
  clean: boolean; auditedUsersCount: number; firestoreUsersCount: number;
  approvedOrdersCount: number; batchCount: number;
  issues: Array<{ type: string; detail: string }>;
}

export default function AdminPage() {
  const [tab, setTab] = useState<Tab>('orders');
  const [overview, setOverview] = useState<Overview | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [search, setSearch] = useState('');
  const [scan, setScan] = useState<ScanResult | null>(null);
  const [scanning, setScanning] = useState(false);
  const [apiError, setApiError] = useState('');
  const [loading, setLoading] = useState(true);
  const [payCfg, setPayCfg] = useState({ bankId: '', accountNo: '', accountName: '' });
  const [msg, setMsg] = useState('');

  const loadAll = useCallback(async () => {
    setLoading(true);
    setApiError('');
    try {
      const [ov, ord, ten] = await Promise.all([
        apiGet<Overview>('/api/admin/overview'),
        apiGet<{ items: Order[] }>('/api/admin/orders?status=pending'),
        apiGet<{ items: Tenant[] }>('/api/admin/tenants'),
      ]);
      setOverview(ov);
      setOrders(ord.items);
      setTenants(ten.items);
    } catch (e) {
      // Banner vàng CHỈ khi API thật sự lỗi.
      setApiError(e instanceof ApiError ? e.message : 'Không tải được dữ liệu quản trị.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  const approve = async (orderId: string) => {
    setMsg('');
    try {
      await apiPost('/api/admin/approve-order', { orderId });
      setMsg('Đã duyệt đơn, kích hoạt gói và cộng thưởng credits.');
      loadAll();
    } catch (e) { setMsg(e instanceof ApiError ? e.message : 'Duyệt đơn thất bại.'); }
  };

  const reject = async (orderId: string) => {
    setMsg('');
    try {
      await apiPost('/api/admin/reject-order', { orderId });
      setMsg('Đã từ chối / hủy đơn hàng.');
      loadAll();
    } catch (e) { setMsg(e instanceof ApiError ? e.message : 'Từ chối thất bại.'); }
  };

  const manageTenant = async (uid: string, action: string, value?: number) => {
    setMsg('');
    try {
      await apiPost(`/api/admin/tenants/${uid}/manage`, { action, value });
      setMsg('Đã cập nhật người thuê.');
      loadAll();
    } catch (e) { setMsg(e instanceof ApiError ? e.message : 'Cập nhật thất bại.'); }
  };

  const runScan = async () => {
    setScanning(true);
    setScan(null);
    try {
      const data = await apiPost<ScanResult>('/api/admin/security/scan');
      setScan(data);
    } catch (e) {
      setApiError(e instanceof ApiError ? e.message : 'Quét bảo mật thất bại.');
    } finally {
      setScanning(false);
    }
  };

  const savePayment = async () => {
    setMsg('');
    try {
      await apiPut('/api/admin/payment-config', payCfg);
      setMsg('Đã lưu cấu hình VietQR.');
    } catch (e) { setMsg(e instanceof ApiError ? e.message : 'Lưu thất bại.'); }
  };

  const filteredTenants = tenants.filter((t) => {
    const q = search.toLowerCase().trim();
    if (!q) return true;
    return t.email.toLowerCase().includes(q) || t.displayName.toLowerCase().includes(q) || t.plan.toLowerCase().includes(q);
  });

  const tabs: Array<{ id: Tab; label: string }> = [
    { id: 'orders', label: `Đơn hàng đang chờ xử lý (${orders.length})` },
    { id: 'tenants', label: `Người thuê nhà (${tenants.length})` },
    { id: 'security', label: 'Quét bảo mật' },
    { id: 'payment', label: 'Cấu hình VietQR' },
  ];

  return (
    <div className="space-y-5">
      {/* Tiêu đề + nút làm mới */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-slate-900">Bảng điều khiển quản trị</h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-500">
            Quản lý việc phê duyệt thanh toán, đăng ký của người thuê nhà, tín dụng và bảo mật hệ thống.
          </p>
        </div>
        <button type="button" className="btn btn-outline" onClick={loadAll} disabled={loading}>
          {loading ? 'Đang tải...' : '⟳ Làm mới dữ liệu'}
        </button>
      </div>

      {/* Banner cảnh báo API — CHỈ khi API thật sự lỗi */}
      {apiError && (
        <div className="banner-readonly rounded-lg p-3 text-sm">⚠ {apiError}</div>
      )}
      {msg && <div className="rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-800">{msg}</div>}

      {/* 4 thẻ thống kê */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Tổng số người thuê" value={overview ? String(overview.totalTenants) : '—'} />
        <StatCard label="Tổng doanh thu (đã duyệt)" value={overview ? formatVND(overview.totalRevenue) : '—'} />
        <StatCard label="Đơn hàng đang chờ xử lý" value={overview ? String(overview.pendingOrders) : '—'} />
        <StatCard label="Người đăng ký đang hoạt động" value={overview ? String(overview.activeSubscribers) : '—'} />
      </div>

      {/* Tabs */}
      <div className="flex flex-wrap gap-1.5">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`rounded-lg px-3.5 py-2 text-sm font-semibold transition ${
              tab === t.id ? 'bg-brand text-white' : 'bg-white text-slate-600 ring-1 ring-line hover:bg-slate-50'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Nội dung tab */}
      {tab === 'orders' && (
        <div className="card">
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr><th>Mã đơn</th><th>Email</th><th>Gói</th><th>Số tiền</th><th>Ngày tạo</th><th>Thao tác</th></tr>
              </thead>
              <tbody>
                {orders.map((o) => (
                  <tr key={o.id}>
                    <td className="font-mono">{o.code}</td>
                    <td>{o.email}</td>
                    <td>{o.planId}</td>
                    <td>{formatVND(o.amount)}</td>
                    <td>{new Date(o.createdAt).toLocaleString('vi-VN')}</td>
                    <td>
                      <div className="flex gap-1.5">
                        <button type="button" className="btn btn-primary !px-2.5 !py-1 text-xs" onClick={() => approve(o.id)}>
                          Duyệt đơn 1-Click
                        </button>
                        <button type="button" className="btn btn-outline !px-2.5 !py-1 text-xs" onClick={() => reject(o.id)}>
                          Từ chối / Hủy đơn
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {orders.length === 0 && (
                  <tr><td colSpan={6} className="text-center text-slate-400">Không có đơn hàng nào đang chờ xử lý.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'tenants' && (
        <div className="space-y-3">
          <input
            className="input max-w-md"
            placeholder="Tìm theo Email / Tên / Gói..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <div className="card">
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr><th>Email</th><th>Tên</th><th>Gói</th><th>Hết hạn</th><th>Credits</th><th>Số kênh</th><th>Trạng thái</th><th>Thao tác</th></tr>
                </thead>
                <tbody>
                  {filteredTenants.map((t) => (
                    <tr key={t.uid}>
                      <td className="font-mono text-xs">{t.email}</td>
                      <td>{t.displayName || '—'}</td>
                      <td>{t.plan}</td>
                      <td>{t.expiresAt ? new Date(t.expiresAt).toLocaleDateString('vi-VN') : '—'}</td>
                      <td>{t.credits.toLocaleString('vi-VN')}</td>
                      <td>{t.channelCount}</td>
                      <td>
                        <span className={`badge ${t.isReadOnly ? 'badge-yellow' : 'badge-green'}`}>
                          {t.isReadOnly ? 'Khóa (Read-Only)' : 'Hoạt động'}
                        </span>
                      </td>
                      <td>
                        <div className="flex flex-wrap gap-1.5">
                          <button type="button" className="btn btn-outline !px-2 !py-1 text-xs" onClick={() => manageTenant(t.uid, 'extend', 30)}>+30 ngày</button>
                          <button type="button" className="btn btn-outline !px-2 !py-1 text-xs" onClick={() => manageTenant(t.uid, 'addCredits', 100)}>+100 Credits</button>
                          <button type="button" className="btn btn-outline !px-2 !py-1 text-xs" onClick={() => manageTenant(t.uid, 'deductCredits', 100)}>-100 Credits</button>
                          {t.isReadOnly ? (
                            <button type="button" className="btn btn-outline !px-2 !py-1 text-xs" onClick={() => manageTenant(t.uid, 'unlock')}>Mở khóa</button>
                          ) : (
                            <button type="button" className="btn btn-outline !px-2 !py-1 text-xs" onClick={() => manageTenant(t.uid, 'lock')}>Khóa</button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                  {filteredTenants.length === 0 && (
                    <tr><td colSpan={8} className="text-center text-slate-400">Không có người thuê nào.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {tab === 'security' && (
        <div className="card p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <span className="text-3xl">🛡</span>
              <div>
                <div className="font-bold text-slate-900">Quét Bảo Mật Hệ Thống</div>
                <div className="text-xs text-slate-500">Đối chiếu Auth &amp; Firestore, phát hiện nâng quyền trái phép, gói không có đơn duyệt, credits bất thường.</div>
              </div>
            </div>
            <button type="button" className="btn btn-primary" onClick={runScan} disabled={scanning}>
              {scanning ? 'Đang quét...' : 'Chạy lại quá trình quét'}
            </button>
          </div>
          {scan && (
            <div className="mt-4 space-y-3">
              <div className={`rounded-lg p-3 text-sm ${scan.clean ? 'border border-green-200 bg-green-50 text-green-800' : 'banner-readonly'}`}>
                {scan.clean ? '✅ Hệ thống sạch. Không phát hiện bất thường.' : `⚠ Phát hiện ${scan.issues.length} vấn đề.`}
              </div>
              <div className="grid gap-3 text-sm sm:grid-cols-4">
                <div className="card p-3"><div className="text-xs text-slate-500">Người dùng đã quét</div><div className="text-lg font-bold">{scan.auditedUsersCount}</div></div>
                <div className="card p-3"><div className="text-xs text-slate-500">Firestore users</div><div className="text-lg font-bold">{scan.firestoreUsersCount}</div></div>
                <div className="card p-3"><div className="text-xs text-slate-500">Đơn đã duyệt</div><div className="text-lg font-bold">{scan.approvedOrdersCount}</div></div>
                <div className="card p-3"><div className="text-xs text-slate-500">Số batch</div><div className="text-lg font-bold">{scan.batchCount}</div></div>
              </div>
              {scan.issues.length > 0 && (
                <ul className="space-y-1.5 text-xs">
                  {scan.issues.map((iss, i) => (
                    <li key={i} className="card p-2.5">
                      <span className="badge badge-yellow mr-2">{iss.type}</span>
                      <span className="text-slate-600">{iss.detail}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}

      {tab === 'payment' && (
        <div className="card max-w-lg p-5">
          <div className="mb-3 font-bold text-slate-900">Cấu hình VietQR</div>
          <div className="space-y-3">
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-500">Mã ngân hàng (Bank ID)</label>
              <input className="input" value={payCfg.bankId} onChange={(e) => setPayCfg({ ...payCfg, bankId: e.target.value })} placeholder="vd: 970422 (MBBank)" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-500">Số tài khoản</label>
              <input className="input" value={payCfg.accountNo} onChange={(e) => setPayCfg({ ...payCfg, accountNo: e.target.value })} placeholder="Số tài khoản nhận tiền" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-500">Tên tài khoản</label>
              <input className="input" value={payCfg.accountName} onChange={(e) => setPayCfg({ ...payCfg, accountName: e.target.value })} placeholder="Tên chủ tài khoản" />
            </div>
            <button type="button" className="btn btn-primary w-full" onClick={savePayment}>Lưu cấu hình</button>
          </div>
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="card p-4">
      <div className="text-xs font-semibold text-slate-500">{label}</div>
      <div className="mt-1 text-2xl font-extrabold tracking-tight text-slate-900">{value}</div>
    </div>
  );
}
