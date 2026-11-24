import { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { chromeHub } from '../lib/chrome-browser';
import { CHROME_VIEWS, type ChromeView } from '../lib/chrome-hub';
import { hubMessage } from '../lib/chrome-hub-messages';
import type { ChannelRecord } from '../lib/channel-record';

export default function ChromeOpen({ channel, more = false }: { channel: ChannelRecord; more?: boolean }) {
  const { profile } = useAuth();
  const [state, setState] = useState<{ ok: boolean; text: string }>();
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState<ChromeView>('channel');
  if (!profile || profile.role === 'staff' || !channel.chromeLink) return null;
  const { profileKey, directory } = channel.chromeLink;
  const open = async (target: ChromeView) => {
    if (busy) return;
    setBusy(true); setState(undefined);
    try {
      const res = await chromeHub<{ profile: string }>('open', { workspace: profile.tenantId, channelId: channel.channelId, profileKey, view: target });
      setState(res.ok ? { ok: true, text: `Đã gửi lệnh mở ${CHROME_VIEWS[target]} trong ${res.data.profile}.` } : { ok: false, text: hubMessage(res.code) });
    } finally { setBusy(false); }
  };
  return <div className="min-w-[9rem] space-y-1" key={profileKey}>
    <button type="button" disabled={busy} className="btn btn-primary !px-2.5 !py-1.5 !text-xs" title={`Mở Studio trong ${directory}`} onClick={() => void open('studio')}>{busy ? 'Đang mở…' : 'Mở Studio'}</button>
    {more && <div className="flex flex-wrap gap-1">
      <select aria-label={`Trang muốn mở của ${channel.channelName}`} className="input !w-auto !px-1.5 !py-1 !text-xs" value={view} onChange={(e) => setView(e.target.value as ChromeView)}>
        {(['channel', 'content', 'analytics'] as const).map((item) => <option key={item} value={item}>{CHROME_VIEWS[item]}</option>)}
      </select>
      <button type="button" className="btn btn-outline !px-2 !py-1 !text-xs" disabled={busy} onClick={() => void open(view)}>{view === 'channel' ? 'Mở kênh' : 'Mở'}</button>
    </div>}
    {state && <p role={state.ok ? 'status' : 'alert'} className={`max-w-[14rem] text-xs leading-relaxed ${state.ok ? 'text-emerald-800' : 'text-amber-900'}`}>{state.text}</p>}
  </div>;
}
