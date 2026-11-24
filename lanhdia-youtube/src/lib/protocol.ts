// ============================================================================
// Giao thức máy trạm Windows ymaxtool:// (Mục 5).
// ============================================================================

/** Nút "Upload / Đăng video" -> mở helper cục bộ để đăng video lên kênh. */
export function buildUploadUrl(row: number, channelId: string, path: string): string {
  const params = new URLSearchParams({
    row: String(row),
    channelId: channelId || '',
    path: path || '',
  });
  return `y-m-a-x-t-o-o-l://upload?${params.toString()}`;
}

/** Nút "Mở thư mục" -> mở thư mục video trên máy trạm. */
export function buildOpenFolderUrl(path: string): string {
  const params = new URLSearchParams({ path: path || '' });
  return `y-m-a-x-t-o-o-l://open-folder?${params.toString()}`;
}

/** URL kiểm tra helper cục bộ. */
export const HELPER_HEALTH_URL = 'http://127.0.0.1:47890/health';

/** Kiểm tra helper cục bộ có đang chạy không. */
export async function checkHelperHealth(timeoutMs = 2500): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(HELPER_HEALTH_URL, { signal: controller.signal });
    clearTimeout(timer);
    return res.ok;
  } catch {
    return false;
  }
}

/** Mở giao thức ymaxtool:// trên trình duyệt (kích hoạt helper cục bộ). */
export function openProtocol(url: string): void {
  const iframe = document.createElement('iframe');
  iframe.style.display = 'none';
  document.body.appendChild(iframe);
  iframe.src = url;
  setTimeout(() => iframe.remove(), 3000);
}
