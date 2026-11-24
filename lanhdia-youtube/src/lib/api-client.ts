import { getAuthInstance } from './firebase';

// ============================================================================
// Frontend fetch helper (Mục 1).
// - Kiểm tra response.ok và content-type application/json TRƯỚC khi parse.
// - Nếu không phải JSON -> báo "Máy chủ đang bảo trì" thay vì crash
//   (tránh lỗi "Unexpected token 'A'" khi server trả trang text).
// API luôn trả JSON dạng { success, code, message, data? }.
// ============================================================================

export interface ApiResponse<T = unknown> {
  success: boolean;
  code: string;
  message: string;
  data?: T;
}

export class ApiError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function getIdToken(): Promise<string | null> {
  try {
    const user = getAuthInstance().currentUser;
    if (!user) return null;
    return await user.getIdToken();
  } catch {
    return null;
  }
}

export async function apiFetch<T = unknown>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const token = await getIdToken();
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    ...(options.headers as Record<string, string> | undefined),
  };
  if (token) headers['authorization'] = `Bearer ${token}`;

  let res: Response;
  try {
    res = await fetch(path, { ...options, headers });
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR', 'Không kết nối được máy chủ. Kiểm tra mạng rồi thử lại.');
  }

  const contentType = res.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    // Server trả text (vd "A server error occurred") -> không parse, báo bảo trì.
    throw new ApiError(res.status, 'SERVER_MAINTENANCE', 'Máy chủ đang bảo trì. Vui lòng thử lại sau.');
  }

  let json: ApiResponse<T>;
  try {
    json = (await res.json()) as ApiResponse<T>;
  } catch {
    throw new ApiError(res.status, 'BAD_RESPONSE', 'Máy chủ trả dữ liệu không hợp lệ.');
  }

  if (!res.ok || json.success === false) {
    throw new ApiError(
      res.status,
      json.code || 'ERROR',
      json.message || 'Có lỗi xảy ra. Vui lòng thử lại.',
    );
  }
  return json.data as T;
}

export const apiGet = <T>(path: string) => apiFetch<T>(path, { method: 'GET' });
export const apiPost = <T>(path: string, body?: unknown) =>
  apiFetch<T>(path, { method: 'POST', body: body ? JSON.stringify(body) : undefined });
export const apiPut = <T>(path: string, body?: unknown) =>
  apiFetch<T>(path, { method: 'PUT', body: body ? JSON.stringify(body) : undefined });
export const apiPatch = <T>(path: string, body?: unknown) =>
  apiFetch<T>(path, { method: 'PATCH', body: body ? JSON.stringify(body) : undefined });
export const apiDelete = <T>(path: string) => apiFetch<T>(path, { method: 'DELETE' });
