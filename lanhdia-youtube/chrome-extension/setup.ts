import { HUB_ORIGIN } from '../src/lib/chrome-hub-config';
import { PROFILE_DIRECTORY, PROFILE_KEY, type HubReply } from '../src/lib/chrome-hub';
import { hubMessage } from '../src/lib/chrome-hub-messages';

const byId = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const ticket = location.hash.slice(1);
const status = byId('status'), profile = byId('profile'), capture = byId('capture'), form = byId('pair'), note = byId('note');
const input = byId<HTMLSelectElement>('directory'), pair = byId<HTMLButtonElement>('verify'), submit = byId<HTMLButtonElement>('sync');
const reply = <T,>(action: string, data = {}): Promise<HubReply<T>> => new Promise((resolve) => {
  if (!PROFILE_KEY.test(ticket)) return resolve({ ok: false, code: 'SETUP_EXPIRED' });
  chrome.runtime.sendMessage({ action, ticket, ...data }, (response) => {
    const disconnected = chrome.runtime.lastError;
    resolve(!disconnected && response ? response as HubReply<T> : { ok: false, code: 'SETUP_EXPIRED' });
  });
});
type Local = { profile: string; directories: string[]; dashboard: boolean; capture?: { channelId: string }; reason?: string };
let interval: ReturnType<typeof setInterval> | undefined, until = 0;
let checkBusy = false;

async function check() {
  if (checkBusy) return;
  checkBusy = true;
  try {
    const state = await reply<Local>('setup-state');
    if (!state.ok) { status.textContent = hubMessage(state.code); return; }
    const { data } = state;
    profile.textContent = data.profile ? `${data.profile} · Đã xác minh` : 'Chưa xác minh hồ sơ';
    profile.dataset.ready = data.profile ? 'yes' : 'no';
    form.hidden = Boolean(data.profile);
    capture.hidden = !data.capture;
    byId('channel-id').textContent = data.capture?.channelId || '';
    submit.disabled = !data.profile || !data.dashboard;
    if (!input.options.length && Array.isArray(data.directories)) {
      const options = data.directories.filter((dir) => PROFILE_DIRECTORY.test(dir));
      input.replaceChildren(new Option('Chọn thư mục trong Profile Path', ''));
      for (const dir of options) input.add(new Option(dir, dir));
      pair.disabled = !options.length;
      if (!options.length) note.textContent = 'Không tìm thấy thư mục Chrome Stable chuẩn trên máy.';
    }
    if (data.profile) {
      if (interval) { clearInterval(interval); interval = undefined; }
      status.textContent = !data.dashboard ? hubMessage('NO_DASHBOARD') : data.capture ? 'Hồ sơ đã sẵn sàng. Bấm Đồng bộ kênh này; lần sau chỉ cần bấm biểu tượng tiện ích trong Studio.' : 'Bạn có thể quay lại web và chọn hồ sơ này làm trung tâm, hoặc mở Studio của kênh để đồng bộ.';
    } else if (until > Date.now()) status.textContent = 'Đang chờ tab xác minh ở hồ sơ đã chọn. Hãy giữ tab này mở.';
    else {
      if (interval) { clearInterval(interval); interval = undefined; }
      status.textContent = until ? 'Chưa xác minh được. Kiểm tra tiện ích đã cài ở đúng hồ sơ và chọn lại thư mục.' : 'Chọn đúng hồ sơ Chrome một lần. Helper sẽ mở tab để kiểm tra, không dựa vào tên nhập tay.';
    }
  } finally { checkBusy = false; }
}
byId('chrome-version').onclick = () => { void chrome.tabs.create({ url: 'chrome://version/' }).catch(() => { status.textContent = 'Nhập chrome://version vào thanh địa chỉ để xem Profile Path.'; }); };
byId('check').onclick = () => { void check(); };
byId<HTMLAnchorElement>('site').href = HUB_ORIGIN + '/channels';
byId<HTMLAnchorElement>('download').href = HUB_ORIGIN + '/downloads/lanhdia-windows-helper.zip';
form.addEventListener('submit', (e) => {
  e.preventDefault();
  if (!PROFILE_DIRECTORY.test(input.value) || pair.disabled) return;
  pair.disabled = true;
  void reply('pair-start', { directory: input.value }).then((result) => {
    pair.disabled = false;
    if (!result.ok) { status.textContent = hubMessage(result.code); return; }
    until = Date.now() + 120_000;
    if (interval) clearInterval(interval);
    interval = setInterval(() => void check(), 1700);
    void check();
  });
});
submit.onclick = () => {
  submit.disabled = true;
  void reply('capture-now').then((result) => {
    status.textContent = result.ok ? 'Đã gửi yêu cầu sang Chrome trung tâm. Xem kết quả đồng bộ tại đó.' : hubMessage(result.code);
    if (!result.ok) submit.disabled = false;
    else { if (interval) clearInterval(interval); capture.hidden = true; }
  });
};
window.addEventListener('focus', () => void check());
void check();
