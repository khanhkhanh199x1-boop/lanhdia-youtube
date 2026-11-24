# Nhân sự & Phân quyền Enterprise

Trang quản lý: `/team`. Chủ team và Quản trị viên chính chỉ quản lý nhân sự trong team của mình. Không cấp quyền quản trị ứng dụng cho bốn vai trò nhân viên.

## Sử dụng

1. **Mời nhân viên nhanh vào Team**: nhập Gmail hoặc email Google Workspace → chọn vai trò → **Tạo lời mời**. Mời nhanh không tự gán kênh.
2. Để cấp kênh ngay, dùng **Mời kèm phân quyền**. Mỗi kênh chọn **Không cấp quyền**, **Chỉ xem**, hoặc **Theo vai trò**. Tối đa 100 kênh cho một nhân viên.
3. **Sao chép link** hoặc **Soạn email** rồi gửi cho nhân viên. Ứng dụng không tự gửi email. Link dùng một lần, hết hạn sau 7 ngày. Người nhận đăng nhập tài khoản Google đúng email đã được mời rồi bấm **Chấp nhận lời mời**.
4. Tìm và lọc ở danh sách thành viên/lời mời. **Sửa quyền** đổi vai trò hoặc phạm vi. **Thu hồi quyền** kết thúc quyền vào team ở các yêu cầu API tiếp theo; người đó trở về workspace riêng. Chủ team hết hạn gói vẫn có thể thu hồi.
5. Link rõ chỉ được trả lúc tạo, không lưu rõ trong Firestore. Sau khi rời trang, **Cấp lại link** tạo link 7 ngày mới và vô hiệu link trước.

| Vai trò | Trên kênh được gán “Theo vai trò” |
|---|---|
| Leader | Xem kênh, sửa chủ đề/lịch đăng, quản lý bản nháp của kênh |
| Channel Manager | Xem kênh, sửa chủ đề/lịch đăng, quản lý bản nháp của mình |
| Editor | Xem kênh, quản lý bản nháp của mình |
| Viewer | Chỉ xem kênh và bản nháp |

**Chỉ xem** theo kênh giới hạn mọi vai trò. Nhân viên chỉ vào Kênh, Video và SEO công khai. Bảng giá/đơn hàng, AdSense, dữ liệu đăng nhập kênh, proxy, thư mục máy trạm và các mục quản trị không cấp cho nhân viên. Editor và các vai trò có quyền ghi có thể mở YouTube Studio trên kênh có ID hợp lệ; quyền upload do YouTube quản lý. Bản nháp nội bộ lưu tiêu đề/mô tả, không tự upload/đăng video.

## Lưu trữ và tương thích

- `users`: giữ nguyên gói và tín chỉ riêng khi tham gia team; bổ sung `staffRole`, `grants`, thời điểm tham gia, tên workspace cá nhân. Server đọc hồ sơ hiện tại, không tin role/grant từ client.
- `invites`: SHA-256 của token ngẫu nhiên 32 ký tự là khóa. Email đã xác minh phải khớp; giao dịch Firestore bảo vệ nhận link/cấp lại/thu hồi. URL mới dùng fragment `/join#token=…`. Đường link cũ không gắn email không còn được chấp nhận.
- `team_invite_targets`: chỉ trỏ tới lời mời gần nhất theo cặp team–email. Không thêm composite index. Nhân viên cũ không có phân quyền mặc định về Viewer chưa gán kênh.
- Bản nháp nằm tại `channels/{id}/videoDrafts`. Xóa quyền kênh chặn truy cập bản nháp. Khi đồng bộ lại Sheet, bản ghi giữ ID nếu ID YouTube không rỗng và khớp duy nhất ở cả hai phía; không kế thừa quyền chỉ vì trùng dòng.
- `firestore.rules` của workspace chặn client đọc/ghi trực tiếp, ngoài đọc profile của chính mình. Kiểm tra trên emulator; không thay đổi rules hoặc cấu hình Firebase production. Danh sách Master Admin không đổi; khớp email chỉ được tin khi Firebase đã xác minh email.

## Kiểm tra và phát hành

```bash
npm run build
FIRESTORE_EMULATOR_HOST=127.0.0.1:8883 node_modules/.bin/tsx --test tests/team-api.test.ts tests/youtube-tools.test.ts
node scripts/pack-vercel-output.mjs
```

Test API dùng Firestore Emulator (project `demo-lanhdia-team`) và danh tính giả lập. Chromium đã kiểm tra mời nhanh, sao chép/cấp lại, ma trận quyền desktop/mobile, sai email, tham gia, lọc và sửa vai trò, lưu bản nháp, chặn đường dẫn ngoài phạm vi, thu hồi. Không có dữ liệu thử hoặc danh tính giả lập trong bản triển khai.

`pack-vercel-output.mjs` tạo Vercel Build Output API v3 từ `dist` và bundle Express ESM cùng nguồn. Khi phát hành qua connector, dùng các blob trong `deploy/team-release/` đã đối chiếu nguồn; build không cần Firebase service account trong mã và không thay biến môi trường của dự án. Giữ Deployment Protection cho các URL build trước để chúng không trở thành lối truy cập qua API cũ.

**Đã phát hành:** preview `dpl_5Mg7zhAwqQPYPJk5BDoiU5w2pjfN` READY/STAGED, production `dpl_CEub5Fbm8eSKcJkDwAjoqrPsEeUU` READY/PROMOTED trên `https://lanhdiayoutube2027-beryl.vercel.app`. Bản trước đó để rollback: `dpl_7CKqLmPpV7mPVb2MuXP5Ms8QS65y`.

- Production: `/`, `/team`, `/join`, `/utilities/youtube`, `/assets/index-Bg0TRStv.js`, `/api/health` trả 200; API hồ sơ, thành viên, nhận lời mời và bản nháp từ chối khách chưa đăng nhập (401); xem trước khi thiếu token trả 410. Token xác thực sai cũng trả 401. Không thử ghi dữ liệu production.
- Chromium production tải màn hình tham gia và chuyển `/team` đến đăng nhập khi không có phiên; nút Google mở đến `accounts.google.com`. Chưa đăng nhập bằng tài khoản thật hoặc gửi lời mời thật. Kiểm thử luồng nhận lời mời, giới hạn và thu hồi quyền dùng emulator và danh tính giả lập.
