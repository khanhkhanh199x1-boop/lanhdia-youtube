// ============================================================================
// Parser ma trận Google Sheet (Mục 5).
// QUY ƯỚC BẮT BUỘC: dữ liệu bắt đầu từ DÒNG 4 (bỏ qua dòng 1-3 tiêu đề),
// bản ghi đầu tiên rowIndex = 4. Parser CSV chuẩn RFC-4180.
// 10 trường: STT, Tên kênh, ID Kênh, Gmail quản lý, Proxy/IP,
//            Trạng thái BKT, Chủ đề/Niche, Thư mục video máy trạm,
//            Lịch đăng, Ghi chú.
// ============================================================================

export interface ChannelRow {
  rowIndex: number; // dòng trong Sheet (bắt đầu từ 4)
  stt: string;
  channelName: string;
  channelId: string;
  gmail: string;
  proxy: string;
  bktStatus: string;
  niche: string;
  videoFolder: string;
  schedule: string;
  note: string;
}

/** Phân tích CSV chuẩn RFC-4180 (hỗ trợ dấu phẩy trong ngoặc kép, xuống dòng trong ô). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  const src = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += ch;
    }
  }
  // Dòng cuối không kết thúc bằng \n
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/**
 * Trích xuất danh sách kênh từ nội dung CSV của Sheet.
 * Bỏ qua 3 dòng đầu, dữ liệu từ dòng 4. Bỏ dòng trống hoàn toàn.
 */
export function parseChannelSheet(csvText: string): ChannelRow[] {
  const rows = parseCsv(csvText);
  const result: ChannelRow[] = [];
  // rows[0..2] là dòng 1-3 (tiêu đề). Dữ liệu từ rows[3] = dòng 4.
  for (let i = 3; i < rows.length; i++) {
    const cols = rows[i].map((c) => (c || '').trim());
    // Bỏ dòng trống (tất cả ô rỗng)
    if (cols.every((c) => c === '')) continue;
    const get = (idx: number) => cols[idx] || '';
    result.push({
      rowIndex: i + 1, // dòng thực trong Sheet (1-based)
      stt: get(0),
      channelName: get(1),
      channelId: get(2),
      gmail: get(3),
      proxy: get(4),
      bktStatus: get(5),
      niche: get(6),
      videoFolder: get(7),
      schedule: get(8),
      note: get(9),
    });
  }
  return result;
}

/** Kiểm tra URL có phải Google Sheets hợp lệ không (chống SSRF). */
export function isGoogleSheetsUrl(url: string): boolean {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    return (
      host === 'docs.google.com' ||
      host === 'sheets.google.com' ||
      host.endsWith('.google.com')
    );
  } catch {
    return false;
  }
}

/** Chặn IP nội bộ/loopback/link-local (chống SSRF). */
export function isBlockedHost(url: string): boolean {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    if (host === 'localhost' || host === '127.0.0.1' || host === '::1') return true;
    if (/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.)/.test(host)) return true;
    if (host.endsWith('.local') || host.endsWith('.internal')) return true;
    return false;
  } catch {
    return true;
  }
}

/** Trích xuất ID của Sheet từ URL hoặc nhận trực tiếp ID. */
export function extractSheetId(input: string): string | null {
  const trimmed = (input || '').trim();
  if (!trimmed) return null;
  // Nếu là URL
  const match = trimmed.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (match) return match[1];
  // Nếu là ID thuần
  if (/^[a-zA-Z0-9-_]{20,}$/.test(trimmed)) return trimmed;
  return null;
}

/** Dựng URL xuất CSV của Sheet (chế độ anyone-with-link hoặc public). */
export function buildSheetCsvUrl(sheetId: string, gid = 0): string {
  return `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=${gid}`;
}
