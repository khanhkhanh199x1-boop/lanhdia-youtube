import { useCallback, useEffect, useState } from 'react';
import { PLAN_LIST, formatVND, type Plan } from '../../lib/plans';
import { apiGet, apiPost, ApiError } from '../../lib/api-client';
import { useAuth } from '../../context/AuthContext';

// ============================================================================
// Trang Bảng giá + modal VietQR (Mục 6).
// - Làm nổi bật gói phổ biến (p180).
// - "Chọn gói" mở modal VietQR: mã đơn YMAX-XXXXXX, QR động, số tiền, STK,
//   nội dung CK, nút sao chép, nút "Tôi đã chuyển khoản"; lịch sử đơn cá nhân.
// ============================================================================

interface PaymentConfig {
  bankId: string; accountNo: string; accountName: string; configured: boolean;
}
interface Order {
  id: string; code: string; planId: string; amount: number; status: string;
  transferConfirmed?: boolean; createdAt: number;
}

export default function PricingView() {
  const { profile } = useAuth();
  const [cfg, setCfg] = useState<PaymentConfig | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [selected, setSelected] = useState<Plan | null>(null);
  const [currentOrder, setCurrentOrder] = useState<(Order & { qrUrl: string; transferContent: string }) | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const [c, o] = await Promise.all([
        apiGet<PaymentConfig>('/api/orders/payment-config'),
        apiGet<{ items: Order[] }>('/api/orders/mine'),
      ]);
      setCfg(c);
      setOrders(o.items);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Không tải được dữ liệu.');
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const choosePlan = async (plan: Plan) => {
    setBusy(true);
    setError('');
    try {
      const data = await apiPost<Order & { qrUrl: string; transferContent: string }>('/api/orders', { planId: plan.id });
      setCurrentOrder(data);
      setSelected(plan);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Tạo đơn hàng thất bại.');
    } finally {
      setBusy(false);
    }
  };

  const confirmTransfer = async () => {
    if (!currentOrder) return;
    setBusy(true);
    try {
      await apiPost(`/api/orders/${currentOrder.id}/confirm-transfer`);
      setCurrentOrder(null);
      setSelected(null);
      load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Xác nhận thất bại.');
    } finally {
      setBusy(false);
    }
  };

  const copy = (text: string) => {
    navigator.clipboard?.writeText(text).catch(() => {});
  };

  const statusLabel = (s: string) =>
    s === 'approved' ? 'Đã duyệt' : s === 'rejected' ? 'Đã từ chối' : 'Chờ xử lý';

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight text-slate-900">Bảng giá</h1>
        <p className="mt-1 text-sm text-slate-500">
          Chọn gói phù hợp. Thanh toán qua VietQR, Admin duyệt trong thời gian sớm nhất.
          {profile && <span className="ml-2">Gói hiện tại: <b>{profile.plan}</b></span>}
        </p>
      </div>

      {error && <div className="banner-readonly rounded-lg p-3 text-sm">{error}</div>}
      {cfg && !cfg.configured && (
        <div className="banner-readonly rounded-lg p-3 text-sm">
          Chưa cấu hình VietQR. Vui lòng liên hệ Admin để được hỗ trợ thanh toán.
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {PLAN_LIST.map((plan) => (
          <div
            key={plan.id}
            className={`card relative flex flex-col p-5 ${plan.popular ? 'border-brand shadow-soft ring-1 ring-brand' : ''}`}
          >
            {plan.popular && (
              <span className="badge badge-red absolute -top-2.5 left-4">PHỔ BIẾN</span>
            )}
            <div className="text-sm font-bold text-slate-500">{plan.name}</div>
            <div className="mt-2 text-2xl font-extrabold text-slate-900">{formatVND(plan.price)}</div>
            <ul className="mt-3 flex-1 space-y-1.5 text-sm text-slate-600">
              <li>✓ {plan.days} ngày sử dụng</li>
              <li>✓ {plan.credits.toLocaleString('vi-VN')} tín chỉ</li>
              <li>✓ Quản lý đa kênh không giới hạn</li>
              <li>✓ Đồng bộ Google Sheet</li>
            </ul>
            <button
              type="button"
              className={`btn mt-4 w-full ${plan.popular ? 'btn-primary' : 'btn-outline'}`}
              onClick={() => choosePlan(plan)}
              disabled={busy}
            >
              Chọn gói
            </button>
          </div>
        ))}
      </div>

      {/* Lịch sử đơn cá nhân */}
      <div className="card">
        <div className="border-b border-line px-4 py-3 font-bold text-slate-900">Lịch sử đơn hàng của tôi</div>
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr><th>Mã đơn</th><th>Gói</th><th>Số tiền</th><th>Trạng thái</th><th>Ngày tạo</th></tr>
            </thead>
            <tbody>
              {orders.map((o) => (
                <tr key={o.id}>
                  <td className="font-mono">{o.code}</td>
                  <td>{o.planId}</td>
                  <td>{formatVND(o.amount)}</td>
                  <td>
                    <span className={`badge ${o.status === 'approved' ? 'badge-green' : o.status === 'rejected' ? 'badge-gray' : 'badge-yellow'}`}>
                      {statusLabel(o.status)}
                    </span>
                  </td>
                  <td>{new Date(o.createdAt).toLocaleString('vi-VN')}</td>
                </tr>
              ))}
              {orders.length === 0 && (
                <tr><td colSpan={5} className="text-center text-slate-400">Chưa có đơn hàng nào.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal VietQR */}
      {selected && currentOrder && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="card w-full max-w-md p-6">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-lg font-extrabold text-slate-900">Thanh toán VietQR</h2>
              <button type="button" className="btn btn-ghost !px-2 !py-1" onClick={() => { setSelected(null); setCurrentOrder(null); }}>✕</button>
            </div>
            <div className="space-y-3 text-sm">
              <div className="flex justify-between"><span className="text-slate-500">Mã đơn</span><b className="font-mono">{currentOrder.code}</b></div>
              <div className="flex justify-between"><span className="text-slate-500">Gói</span><b>{selected.name}</b></div>
              <div className="flex justify-between"><span className="text-slate-500">Số tiền</span><b className="text-brand">{formatVND(currentOrder.amount)}</b></div>
              {currentOrder.qrUrl ? (
                <div className="flex justify-center py-2">
                  <img src={currentOrder.qrUrl} alt="QR VietQR" className="h-52 w-52 rounded-lg border border-line" />
                </div>
              ) : (
                <div className="banner-readonly rounded-lg p-3 text-xs">Chưa có QR (chưa cấu hình VietQR). Vui lòng liên hệ Admin.</div>
              )}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-slate-500">STK</span>
                  <span className="flex items-center gap-2"><b className="font-mono">{cfg?.accountNo}</b>
                    <button type="button" className="btn btn-outline !px-2 !py-0.5 text-xs" onClick={() => copy(cfg?.accountNo || '')}>Sao chép</button></span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-slate-500">Nội dung CK</span>
                  <span className="flex items-center gap-2"><b className="font-mono">{currentOrder.transferContent}</b>
                    <button type="button" className="btn btn-outline !px-2 !py-0.5 text-xs" onClick={() => copy(currentOrder.transferContent)}>Sao chép</button></span>
                </div>
              </div>
              <button type="button" className="btn btn-primary w-full" onClick={confirmTransfer} disabled={busy}>
                {busy ? 'Đang gửi...' : 'Tôi đã chuyển khoản'}
              </button>
              <p className="text-center text-xs text-slate-400">Sau khi chuyển khoản, bấm nút trên. Admin sẽ duyệt và kích hoạt gói cho bạn.</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
