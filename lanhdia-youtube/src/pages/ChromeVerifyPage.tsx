import { useEffect, useRef, useState } from 'react';
import { chromeHub } from '../lib/chrome-browser';
import { hubMessage } from '../lib/chrome-hub-messages';

export default function ChromeVerifyPage() {
  const fired = useRef(false);
  const [state, setState] = useState({ title: 'Đang xác minh đúng hồ sơ…', note: 'Helper kiểm tra hồ sơ mở tab này có phải hồ sơ đã bắt đầu ghép không.', ok: false });
  useEffect(() => {
    if (fired.current) return;
    fired.current = true;
    const ticket = /^#pair=([a-f0-9]{32})$/.exec(location.hash)?.[1];
    if (!ticket) { setState({ title: 'Chưa có yêu cầu ghép hồ sơ', note: 'Hãy bắt đầu từ tiện ích Chrome trên máy này.', ok: false }); return; }
    void chromeHub<{ profile: string }>('verify', { ticket }).then((result) => {
      history.replaceState(history.state, '', '/chrome-verify');
      setState(result.ok ? { title: `${result.data.profile} đã xác minh`, note: 'Bạn có thể đóng tab này và quay lại tab thiết lập ban đầu.', ok: true }
        : { title: 'Chưa xác minh được hồ sơ', note: hubMessage(result.code), ok: false });
    });
  }, []);
  return <main className="grid min-h-screen place-items-center bg-paper px-4"><section className="card w-full max-w-lg p-6 sm:p-8" aria-live="polite">
    <p className="text-xs font-extrabold tracking-widest text-brand">LÃNH ĐỊA YOUTUBE · CHROME HUB</p>
    <h1 className="mt-3 text-xl font-extrabold">{state.title}</h1><p className={`mt-2 text-sm ${state.ok ? 'text-emerald-800' : 'text-slate-600'}`}>{state.note}</p>
  </section></main>;
}
