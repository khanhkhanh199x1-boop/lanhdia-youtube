import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { apiPost, ApiError } from '../lib/api-client';
import { INVITE_TOKEN, STAFF_ROLES, type StaffRole } from '../lib/team';

type Preview = { teamName: string; staffRole: StaffRole; expiresAt: number };

export default function JoinPage() {
  const { hash, search } = useLocation();
  const token = new URLSearchParams(hash.slice(1)).get('token') || new URLSearchParams(search).get('token') || '';
  const navigate = useNavigate();
  const { user, loading, signInWithGoogle, signOut, refreshProfile } = useAuth();
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewError, setPreviewError] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [consumed, setConsumed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setPreview(null);
    setPreviewError('');
    setConsumed(false);
    if (!INVITE_TOKEN.test(token)) {
      setPreviewError('Link mời không hợp lệ hoặc là link cũ. Hãy đề nghị chủ team gửi link mới.');
      return;
    }
    apiPost<Preview>('/api/team/invites/preview', { token }).then((data) => {
      if (!cancelled) setPreview(data);
    }).catch((err) => {
      if (!cancelled) setPreviewError(err instanceof ApiError ? err.message : 'Không thể kiểm tra lời mời.');
    });
    return () => { cancelled = true; };
  }, [token]);

  const action = async (run: () => Promise<void>) => {
    setBusy(true);
    setError('');
    try { await run(); }
    catch (err) { setError(err instanceof Error ? err.message : 'Không thể thực hiện. Vui lòng thử lại.'); }
    finally { setBusy(false); }
  };

  const accept = () => void action(async () => {
    if (!consumed) {
      await apiPost('/api/team/invites/accept', { token });
      setConsumed(true);
    }
    await refreshProfile();
    navigate('/channels', { replace: true });
  });

  return (
    <main className="grid min-h-screen place-items-center bg-paper p-4">
      <div className="card w-full max-w-md space-y-5 p-6 sm:p-8">
        <div>
          <p className="text-xs font-extrabold tracking-widest text-red-700">LÃNH ĐỊA YOUTUBE</p>
          <h1 className="mt-2 text-2xl font-extrabold tracking-tight">Tham gia team</h1>
        </div>
        {previewError ? <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{previewError}</p>
          : !preview ? <p role="status" className="text-sm text-slate-500">Đang kiểm tra lời mời…</p>
          : <>
            <div className="space-y-1.5 rounded-xl border border-line bg-slate-50 p-4 text-sm">
              <p>Team: <b>{preview.teamName}</b></p>
              <p>Vai trò: <b>{STAFF_ROLES[preview.staffRole].label}</b></p>
              <p className="text-slate-600">Hết hạn: {new Date(preview.expiresAt).toLocaleString('vi-VN')}</p>
            </div>
            <p className="text-sm text-slate-600">Đăng nhập bằng đúng Gmail hoặc tài khoản Google Workspace đã nhận lời mời. Link chỉ dùng được một lần.</p>
            {loading ? <p role="status" className="text-sm text-slate-500">Đang xác thực…</p> : user ? (
              <div className="space-y-2">
                <p className="break-all text-sm">Đang đăng nhập: <b>{user.email}</b></p>
                {!user.emailVerified && <p className="text-sm text-red-700">Email chưa được xác minh. Hãy đăng nhập bằng Google.</p>}
                <button type="button" onClick={accept} disabled={busy || !user.emailVerified} className="btn btn-primary w-full">{busy ? 'Đang xử lý…' : consumed ? 'Vào trang kênh' : 'Chấp nhận lời mời'}</button>
                <button type="button" onClick={() => void action(signOut)} disabled={busy} className="btn btn-outline w-full">Đăng xuất để đổi tài khoản</button>
              </div>
            ) : (
              <button type="button" onClick={() => void action(signInWithGoogle)} disabled={busy} className="btn btn-primary w-full">{busy ? 'Đang xử lý…' : 'Đăng nhập bằng Google'}</button>
            )}
            {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
          </>}
        <Link to="/" replace className="inline-block text-sm font-semibold text-slate-600 hover:underline">Về trang chính</Link>
      </div>
    </main>
  );
}
