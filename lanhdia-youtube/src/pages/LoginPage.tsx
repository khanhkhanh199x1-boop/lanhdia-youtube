import { useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { readCaptureHash } from '../lib/chrome-hub';
import { readChromeImport } from '../lib/channel-target';
import { useAuth } from '../context/AuthContext';

// Trang đăng nhập — Google + Email/Password (Mục 3: bật cả hai).
export default function LoginPage() {
  const { user, loading, signInWithGoogle, signInWithEmail, signUpWithEmail } = useAuth();
  const location = useLocation();
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const hash = location.state?.channelImport;
  const resumeImport = typeof hash === 'string' && (readChromeImport(hash) || readCaptureHash(hash));
  if (!loading && user) return <Navigate to={resumeImport ? `/channels${hash}` : '/'} replace />;

  const handleGoogle = async () => {
    setBusy(true);
    setError('');
    try {
      await signInWithGoogle();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Đăng nhập Google thất bại.');
    } finally {
      setBusy(false);
    }
  };

  const handleEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      if (mode === 'signin') await signInWithEmail(email, password);
      else await signUpWithEmail(email, password);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Đăng nhập thất bại.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-paper p-4">
      <div className="card w-full max-w-md p-8">
        <div className="mb-6 flex flex-col items-center text-center">
          <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-brand text-white">
            <svg viewBox="0 0 24 24" className="h-8 w-8" fill="currentColor" aria-hidden>
              <path d="M23 7.2s-.2-1.6-.9-2.3c-.9-.9-1.9-.9-2.4-1C16.6 3.6 12 3.6 12 3.6s-4.6 0-7.7.3c-.5.1-1.5.1-2.4 1-.7.7-.9 2.3-.9 2.3S.8 9.1.8 11v1.8c0 1.9.2 3.8.2 3.8s.2 1.6.9 2.3c.9.9 2 .9 2.5 1 1.8.2 7.6.3 7.6.3s4.6 0 7.7-.4c.5-.1 1.5-.1 2.4-1 .7-.7.9-2.3.9-2.3s.2-1.9.2-3.8V11c0-1.9-.2-3.8-.2-3.8zM9.8 15.1V8.4l6.2 3.4-6.2 3.3z" />
            </svg>
          </div>
          <h1 className="text-xl font-extrabold tracking-tight text-slate-900">LÃNH ĐỊA YOUTUBE</h1>
          <p className="mt-1 text-sm text-slate-500">Quản trị đa kênh YouTube, đồng bộ Google Sheet</p>
        </div>

        {resumeImport && <p className="mb-4 rounded-lg bg-sky-50 p-2.5 text-center text-xs text-sky-900">Đăng nhập để tiếp tục nhập kênh từ Chrome.</p>}
        <button type="button" className="btn btn-outline w-full !py-2.5" onClick={handleGoogle} disabled={busy}>
          <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden>
            <path fill="#4285F4" d="M23.5 12.3c0-.9-.1-1.5-.3-2.2H12v4.3h6.5c-.1 1.1-.8 2.7-2.4 3.8l3.7 2.9c2.3-2.1 3.7-5.2 3.7-8.8z" />
            <path fill="#34A853" d="M12 24c3.2 0 5.9-1.1 7.9-2.9l-3.7-2.9c-1 .7-2.4 1.2-4.2 1.2-3.2 0-5.9-2.1-6.8-5l-3.9 3C3.3 21.3 7.3 24 12 24z" />
            <path fill="#FBBC05" d="M5.2 14.4c-.2-.7-.4-1.5-.4-2.4s.1-1.7.4-2.4l-3.9-3C.5 8.2 0 10 0 12s.5 3.8 1.3 5.4l3.9-3z" />
            <path fill="#EA4335" d="M12 4.7c1.8 0 3 .8 3.7 1.4l3.3-3.2C17.9 1.1 15.2 0 12 0 7.3 0 3.3 2.7 1.3 6.6l3.9 3c.9-2.8 3.6-4.9 6.8-4.9z" />
          </svg>
          Đăng nhập bằng Google
        </button>

        <div className="my-5 flex items-center gap-3 text-xs text-slate-400">
          <span className="h-px flex-1 bg-line" /> hoặc <span className="h-px flex-1 bg-line" />
        </div>

        <form onSubmit={handleEmail} className="space-y-3">
          <input
            className="input"
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <input
            className="input"
            type="password"
            placeholder="Mật khẩu"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
          {error && <div className="banner-readonly rounded-lg p-2.5 text-xs">{error}</div>}
          <button type="submit" className="btn btn-primary w-full !py-2.5" disabled={busy}>
            {busy ? 'Đang xử lý...' : mode === 'signin' ? 'Đăng nhập' : 'Đăng ký tài khoản'}
          </button>
        </form>

        <div className="mt-4 text-center text-sm text-slate-500">
          {mode === 'signin' ? (
            <>
              Chưa có tài khoản?{' '}
              <button type="button" className="font-semibold text-brand" onClick={() => setMode('signup')}>
                Đăng ký
              </button>
            </>
          ) : (
            <>
              Đã có tài khoản?{' '}
              <button type="button" className="font-semibold text-brand" onClick={() => setMode('signin')}>
                Đăng nhập
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
