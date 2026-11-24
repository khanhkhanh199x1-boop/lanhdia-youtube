// ============================================================================
// 4 gói dịch vụ (Mục 6). Giá/thời hạn tính trên SERVER, không tin client.
// Credits = số ngày * 10 (quy ước nội bộ, có thể chỉnh tại đây).
// ============================================================================

export interface Plan {
  id: string;
  name: string;
  price: number; // VNĐ
  days: number;
  credits: number;
  popular?: boolean;
}

export const PLANS: Record<string, Plan> = {
  p30: { id: 'p30', name: '30 ngày', price: 99000, days: 30, credits: 300 },
  p90: { id: 'p90', name: '90 ngày', price: 199000, days: 90, credits: 900 },
  p180: { id: 'p180', name: '180 ngày', price: 489000, days: 180, credits: 1800, popular: true },
  p365: { id: 'p365', name: '365 ngày', price: 999000, days: 365, credits: 3650 },
};

export const PLAN_LIST: Plan[] = Object.values(PLANS);

/** Cộng thưởng khi Admin duyệt đơn (Mục 6). */
export const APPROVAL_BONUS_CREDITS = 50;

/** Định dạng tiền VNĐ. */
export function formatVND(amount: number): string {
  return amount.toLocaleString('vi-VN') + 'đ';
}

/** Sinh mã đơn hàng dạng YMAX-XXXXXX. */
export function generateOrderCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let suffix = '';
  for (let i = 0; i < 6; i++) {
    suffix += chars[Math.floor(Math.random() * chars.length)];
  }
  return `YMAX-${suffix}`;
}
