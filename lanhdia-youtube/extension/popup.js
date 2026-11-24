// ============================================================================
// Popup — giao diện trắng tối giản, 100% tiếng Việt.
// ============================================================================

(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const format = (n) => (n == null ? '—' : String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.'));

  const els = {
    loading: $('loading'),
    channelCard: $('channel-card'),
    editCard: $('edit-card'),
    fChannelName: $('f-channelName'),
    fChannelId: $('f-channelId'),
    fHandle: $('f-handle'),
    fSubscribers: $('f-subscribers'),
    fViews: $('f-views'),
    fVideoCount: $('f-videoCount'),
    fMonetization: $('f-monetization'),
    fNiche: $('f-niche'),
    fChannelUrl: $('f-channelUrl'),
    fGmail: $('f-gmail'),
    fProxy: $('f-proxy'),
    fVideoFolder: $('f-videoFolder'),
    fNote: $('f-note'),
    fWebsiteUrl: $('f-websiteUrl'),
    fToken: $('f-token'),
    btnSync: $('btnSync'),
    status: $('status'),
  };

  let channelInfo = null;
  let websiteUrl = '';
  let extensionToken = '';

  // ---------- Tải cấu hình đã lưu ----------

  async function loadConfig() {
    try {
      const res = await chrome.storage.local.get(['websiteUrl', 'extensionToken']);
      if (res.websiteUrl) { els.fWebsiteUrl.value = res.websiteUrl; websiteUrl = res.websiteUrl; }
      if (res.extensionToken) { els.fToken.value = res.extensionToken; extensionToken = res.extensionToken; }
    } catch { /* ignore */ }
    updateSyncButton();
  }

  function saveConfig() {
    websiteUrl = els.fWebsiteUrl.value.trim();
    extensionToken = els.fToken.value.trim();
    chrome.storage.local.set({ websiteUrl, extensionToken });
    updateSyncButton();
  }

  els.fWebsiteUrl.addEventListener('input', saveConfig);
  els.fToken.addEventListener('input', saveConfig);

  // ---------- Lấy thông tin kênh từ content script ----------

  async function scanChannel() {
    els.loading.style.display = 'block';
    els.channelCard.style.display = 'none';
    els.editCard.style.display = 'none';
    els.btnSync.disabled = true;

    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab || !/studio\.youtube\.com|youtube\.com/i.test(tab.url || '')) {
        throw new Error('Hãy mở tab YouTube Studio (studio.youtube.com/channel/…).');
      }

      const resp = await chrome.tabs.sendMessage(tab.id, { action: 'GET_CHANNEL_INFO' });
      if (!resp || !resp.ok) {
        throw new Error(resp && resp.message ? resp.message : 'Không trích xuất được thông tin kênh.');
      }

      channelInfo = resp.data;
      renderChannel(channelInfo);
      els.loading.style.display = 'none';
      els.channelCard.style.display = 'block';
      els.editCard.style.display = 'block';
      updateSyncButton();
    } catch (err) {
      els.loading.style.display = 'none';
      els.channelCard.style.display = 'none';
      els.editCard.style.display = 'none';
      showStatus(err instanceof Error ? err.message : 'Không quét được kênh.', 'err');
    }
  }

  function renderChannel(d) {
    els.fChannelName.textContent = d.channelName || '—';
    els.fChannelId.textContent = d.channelId || '—';
    els.fHandle.textContent = d.handle || '—';
    els.fSubscribers.textContent = format(d.subscribers);
    els.fViews.textContent = format(d.views);
    els.fVideoCount.textContent = format(d.videoCount);
    els.fMonetization.textContent = d.monetizationStatus || 'Chưa rõ';
    els.fNiche.textContent = d.niche || '—';
    els.fChannelUrl.textContent = d.channelUrl || '—';

    // Điền trước Gmail nếu có trong thông tin
    if (d.gmail && !els.fGmail.value) els.fGmail.value = d.gmail;
  }

  function updateSyncButton() {
    const ready = Boolean(channelInfo && channelInfo.channelId && extensionToken && websiteUrl);
    els.btnSync.disabled = !ready;
  }

  function showStatus(msg, kind) {
    const s = els.status;
    s.textContent = msg;
    s.className = 'status ' + (kind === 'ok' ? 'ok' : kind === 'err' ? 'err' : 'hidden');
  }

  // ---------- Gửi đồng bộ 1 chạm ----------

  els.btnSync.addEventListener('click', async () => {
    if (!channelInfo || !channelInfo.channelId) return;
    if (!extensionToken) { showStatus('Vui lòng nhập Extension Token.', 'err'); return; }
    if (!websiteUrl) { showStatus('Vui lòng nhập Website URL.', 'err'); return; }

    els.btnSync.disabled = true;
    els.btnSync.textContent = 'Đang gửi…';
    showStatus('');

    const body = {
      channelId: channelInfo.channelId,
      channelName: channelInfo.channelName || '',
      handle: channelInfo.handle || '',
      subscribers: channelInfo.subscribers ?? null,
      views: channelInfo.views ?? null,
      videoCount: channelInfo.videoCount ?? null,
      monetizationStatus: channelInfo.monetizationStatus || 'Chưa rõ',
      niche: channelInfo.niche || '',
      channelUrl: channelInfo.channelUrl || '',
      gmail: els.fGmail.value.trim() || '',
      proxy: els.fProxy.value.trim() || '',
      videoFolder: els.fVideoFolder.value.trim() || '',
      note: els.fNote.value.trim() || '',
      source: 'extension-1cham',
      scannedAt: Date.now(),
    };

    try {
      const resp = await fetch(`${websiteUrl.replace(/\/+$/, '')}/api/extension/sync-channel`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-extension-token': extensionToken,
        },
        body: JSON.stringify(body),
      });

      const data = await resp.json().catch(() => ({}));

      if (resp.ok && data.success) {
        showStatus('✅ Đã đồng bộ kênh về Lãnh Địa YouTube thành công.', 'ok');
        els.btnSync.textContent = 'Đã gửi thành công';
        setTimeout(() => { els.btnSync.textContent = 'Đẩy về Lãnh Địa YouTube (1 Chạm)'; els.btnSync.disabled = false; }, 1500);
      } else if (resp.status === 401 || resp.status === 403) {
        showStatus(data.message || 'Token không hợp lệ hoặc không có quyền. Hãy tạo lại token trên web.', 'err');
        els.btnSync.disabled = false;
        els.btnSync.textContent = 'Đẩy về Lãnh Địa YouTube (1 Chạm)';
      } else {
        showStatus(data.message || 'Gửi không thành công (HTTP ' + resp.status + ').', 'err');
        els.btnSync.disabled = false;
        els.btnSync.textContent = 'Đẩy về Lãnh Địa YouTube (1 Chạm)';
      }
    } catch (err) {
      showStatus('Không kết nối được đến web. Hãy kiểm tra Website URL.', 'err');
      els.btnSync.disabled = false;
      els.btnSync.textContent = 'Đẩy về Lãnh Địa YouTube (1 Chạm)';
    }
  });

  // ---------- Khởi động ----------

  document.addEventListener('DOMContentLoaded', async () => {
    await loadConfig();
    await scanChannel();
  });

})();
