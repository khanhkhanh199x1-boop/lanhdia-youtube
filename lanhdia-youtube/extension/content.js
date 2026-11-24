// ============================================================================
// Content script — chạy trên studio.youtube.com và youtube.com
// Trích xuất thông tin kênh từ DOM / biến toàn cục của YouTube.
// ============================================================================

(function () {
  'use strict';

  // ---------- Helpers ----------

  function cleanNumber(str) {
    if (str == null) return null;
    const s = String(str).replace(/[^0-9.,KMBTkMBT]/g, '');
    if (!s) return null;
    const mult = { k: 1e3, K: 1e3, m: 1e6, M: 1e6, b: 1e9, B: 1e9, t: 1e12, T: 1e12 };
    const m = s.match(/^([\d.,]+)\s*([KMBTkMBT])?$/);
    if (m) {
      const num = parseFloat(m[1].replace(/,/g, '.'));
      if (isNaN(num)) return null;
      return Math.round(num * (mult[m[2]] || 1));
    }
    const plain = parseInt(s.replace(/[.,]/g, ''), 10);
    return isNaN(plain) ? null : plain;
  }

  function getMeta(prop) {
    const el = document.querySelector(`meta[property="${prop}"], meta[name="${prop}"], meta[itemprop="${prop}"]`);
    return el ? (el.content || '').trim() : '';
  }

  function getChannelIdFromUrl() {
    try {
      const url = new URL(window.location.href);
      // studio.youtube.com/channel/UC... or youtube.com/channel/UC...
      const m = url.pathname.match(/\/channel\/([UC][\w-]{22,})/);
      if (m) return m[1];
      // studio.youtube.com/handle/@... or youtube.com/@...
      const m2 = url.pathname.match(/\/(@[\w.-]+)/) || url.pathname.match(/^\/(@[\w.-]+)/);
      if (m2) return { handle: m2[1] };
      // search params ?channel=UC...
      if (url.searchParams.get('channel')) return url.searchParams.get('channel');
    } catch { /* ignore */ }
    return null;
  }

  // Trích xuất từ biến toàn cục ytcfg / ytInitialData nếu có
  function readGlobalData() {
    const info = {};
    try {
      const ytcfg = window.ytcfg || window.ytConfig || {};
      const get = (key) => {
        try {
          if (typeof ytcfg.get === 'function') return ytcfg.get(key);
          return ytcfg[key];
        } catch { return undefined; }
      };
      const channelId = get('CHANNEL_ID') || get('channelId') || get('pageChannelId');
      if (channelId) info.channelId = channelId;
      const channelName = get('CHANNEL_NAME') || get('channelName') || get('pageTitle');
      if (channelName) info.channelName = String(channelName).trim();
    } catch { /* ignore */ }

    try {
      const yid = window.ytInitialData || window.ytInitialPlayerResponse || {};
      const extractFromInitialData = (data) => {
        if (!data || typeof data !== 'object') return null;
        // Tìm channelId trong các đường đi phổ biến
        const walk = (obj, depth = 0) => {
          if (depth > 6 || !obj || typeof obj !== 'object') return null;
          if (Array.isArray(obj)) {
            for (const item of obj) { const r = walk(item, depth + 1); if (r) return r; }
            return null;
          }
          for (const [k, v] of Object.entries(obj)) {
            if (k === 'channelId' && typeof v === 'string' && /^UC[\w-]{22,}$/.test(v)) return v;
            if (k === 'channelName' && typeof v === 'string' && !info.channelName) info.channelName = v.trim();
            if (k === 'owner' || k === 'channelRenderer' || k === 'channelId') {
              const r = walk(v, depth + 1);
              if (r) return r;
            }
          }
          return null;
        };
        return walk(data);
      };
      if (!info.channelId) {
        const found = extractFromInitialData(yid);
        if (found) info.channelId = found;
      }
    } catch { /* ignore */ }
    return info;
  }

  // Trích xuất từ DOM (YouTube Studio / channel page)
  function readDOM() {
    const info = {};

    // channelId từ URL
    const urlId = getChannelIdFromUrl();
    if (typeof urlId === 'string') info.channelId = urlId;
    else if (urlId && urlId.handle) info.handle = urlId.handle;

    // Tên kênh từ các selector phổ biến
    const nameSelectors = [
      'yt-channel-id[channel-id]',
      'channel-name',
      '[channel-id]',
      'yt-formatted-string[id="channel-title"]',
      'yt-formatted-string[id="text"]',
      'div.channel-name',
      'span.channel-name',
      'h1.channel-title',
      'yt-channel-name',
    ];
    for (const sel of nameSelectors) {
      const el = document.querySelector(sel);
      if (el) {
        const val = el.getAttribute ? el.getAttribute('channel-id') || el.textContent || '' : el.textContent || '';
        if (val && !info.channelId && /^UC[\w-]{22,}$/.test(val.trim())) info.channelId = val.trim();
        if (val && !info.channelName && val.trim().length > 0) info.channelName = val.trim();
        if (info.channelId && info.channelName) break;
      }
    }

    // Handle @...
    const handleEl = document.querySelector('yt-formatted-string[id="handle"], [id="handle"], a[href^="/@"], [aria-label*="@"]');
    if (handleEl) {
      const h = handleEl.getAttribute ? handleEl.getAttribute('aria-label') || handleEl.textContent || '' : handleEl.textContent || '';
      const m = h.match(/@[\w.-]+/);
      if (m) info.handle = m[0];
    }

    // Subscribers
    const subSelectors = [
      'yt-formatted-string[id="subscriber-count"]',
      '[id="subscriber-count"]',
      'span.subscriber-count',
      'div.subscriber-count',
    ];
    for (const sel of subSelectors) {
      const el = document.querySelector(sel);
      if (el) {
        const m = el.textContent.match(/([\d.,]+\s*[KMBTkMBT]?|\d[\d.,]*)/);
        if (m) { info.subscribers = cleanNumber(m[1]); break; }
      }
    }

    // Views
    const viewSelectors = [
      'yt-formatted-string[id="view-count"]',
      '[id="view-count"]',
      'span.view-count',
    ];
    for (const sel of viewSelectors) {
      const el = document.querySelector(sel);
      if (el) {
        const m = el.textContent.match(/([\d.,]+\s*[KMBTkMBT]?|\d[\d.,]*)/);
        if (m) { info.views = cleanNumber(m[1]); break; }
      }
    }

    // Video count
    const videoSelectors = [
      'yt-formatted-string[id="video-count"]',
      '[id="video-count"]',
      'span.video-count',
    ];
    for (const sel of videoSelectors) {
      const el = document.querySelector(sel);
      if (el) {
        const m = el.textContent.match(/(\d[\d.,]*)/);
        if (m) { info.videoCount = parseInt(m[1].replace(/[.,]/g, ''), 10) || null; break; }
      }
    }

    // Niche / category (từ mô tả hoặc tab)
    const descEl = document.querySelector('yt-formatted-string[id="description"], [id="description"], div.channel-description');
    if (descEl && !info.niche) {
      const txt = descEl.textContent || '';
      info.niche = txt.slice(0, 120);
    }

    info.channelUrl = window.location.href;
    return info;
  }

  // ---------- Thu thập thông tin ----------

  function collectChannelInfo() {
    const info = {};
    Object.assign(info, readGlobalData());
    const dom = readDOM();
    // Ưu tiên URL/DOM cho channelId nếu global thiếu
    if (!info.channelId && dom.channelId) info.channelId = dom.channelId;
    if (!info.channelName && dom.channelName) info.channelName = dom.channelName;
    if (!info.handle && dom.handle) info.handle = dom.handle;
    if (info.subscribers == null && dom.subscribers != null) info.subscribers = dom.subscribers;
    if (info.views == null && dom.views != null) info.views = dom.views;
    if (info.videoCount == null && dom.videoCount != null) info.videoCount = dom.videoCount;
    if (!info.niche && dom.niche) info.niche = dom.niche;
    if (!info.channelUrl && dom.channelUrl) info.channelUrl = dom.channelUrl;

    // Chuẩn hóa channelId
    if (info.channelId && !/^UC[\w-]{22,}$/.test(info.channelId)) {
      // Có thể là handle -> để trống, sẽ xử lý ở popup/backend
      info.channelIdRaw = info.channelId;
      info.channelId = '';
    }

    info.channelUrl = info.channelUrl || window.location.href;
    if (info.channelId && !info.channelUrl.includes('/channel/')) {
      info.channelUrl = `https://studio.youtube.com/channel/${info.channelId}`;
    }

    return info;
  }

  // ---------- Message passing với popup / background ----------

  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'GET_CHANNEL_INFO') {
      try {
        const info = collectChannelInfo();
        sendResponse({ ok: true, data: info, url: window.location.href, title: document.title });
      } catch (err) {
        sendResponse({ ok: false, code: 'EXTRACT_ERROR', message: err instanceof Error ? err.message : 'Không trích xuất được.' });
      }
      return true;
    }
    if (request.action === 'INJECT_BTN') {
      injectFloatingButton();
      sendResponse({ ok: true });
      return true;
    }
    return false;
  });

  // ---------- Nút nổi "Quét kênh YMax" ----------

  function injectFloatingButton() {
    if (document.getElementById('ymax-scan-btn')) return;
    const btn = document.createElement('button');
    btn.id = 'ymax-scan-btn';
    btn.textContent = 'Quét kênh YMax';
    Object.assign(btn.style, {
      position: 'fixed',
      bottom: '24px',
      right: '24px',
      zIndex: '2147483647',
      padding: '10px 16px',
      background: '#ff0000',
      color: '#fff',
      border: 'none',
      borderRadius: '8px',
      fontSize: '14px',
      fontWeight: '700',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      boxShadow: '0 4px 12px rgba(0,0,0,0.35)',
      cursor: 'pointer',
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
    });
    btn.addEventListener('click', () => {
      chrome.runtime.sendMessage({ action: 'GET_CHANNEL_INFO' }, (resp) => {
        if (resp && resp.ok) {
          const d = resp.data;
          const lines = [
            'Kênh YouTube',
            'Tên: ' + (d.channelName || '—'),
            'ID: ' + (d.channelId || '—'),
            'Handle: ' + (d.handle || '—'),
            'Người đăng ký: ' + (d.subscribers != null ? d.subscribers.toLocaleString() : '—'),
            'Lượt xem: ' + (d.views != null ? d.views.toLocaleString() : '—'),
            'Video: ' + (d.videoCount != null ? d.videoCount.toLocaleString() : '—'),
            'Chủ đề: ' + (d.niche || '—'),
            'URL: ' + (d.channelUrl || '—'),
          ].join('\n');
          if (navigator.clipboard) {
            navigator.clipboard.writeText(lines).then(() => {
              const old = btn.textContent;
              btn.textContent = 'Đã sao chép!';
              setTimeout(() => { btn.textContent = old; }, 1500);
            });
          } else {
            alert(lines);
          }
        } else {
          alert('Không lấy được thông tin kênh. ' + (resp && resp.message ? resp.message : ''));
        }
      });
    });
    document.body.appendChild(btn);
  }

  // Tự động inject nút khi trên YouTube Studio
  if (/studio\.youtube\.com|youtube\.com/i.test(window.location.hostname)) {
    // Đợi DOM sẵn sàng
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', injectFloatingButton);
    } else {
      injectFloatingButton();
    }
    // Quan sát thay đổi URL (SPA)
    let lastUrl = location.href;
    new MutationObserver(() => {
      if (location.href !== lastUrl) {
        lastUrl = location.href;
        setTimeout(injectFloatingButton, 500);
      }
    }).observe(document, { subtree: true, childList: true });
  }

})();
