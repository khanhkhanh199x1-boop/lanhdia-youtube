// ============================================================================
// Background service worker (Manifest V3)
// ============================================================================

chrome.runtime.onInstalled.addListener(() => {
  // Không làm gì đặc biệt khi cài đặt
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  // Forward các yêu cầu nếu cần xử lý ở background
  sendResponse({ ok: true });
  return true;
});
