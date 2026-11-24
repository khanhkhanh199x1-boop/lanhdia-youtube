# Nghiên cứu YouTube

Trang: `/utilities/youtube` → **Check toàn bộ dữ liệu kênh đối thủ**.
Có lối vào từ thanh bên và Cột Tiện ích. Trang nằm sau kiểm tra đăng nhập hiện có.

- **Phân tích kênh**: MW Metadata Bulk, tối đa 10 liên kết/ID mỗi lượt nhập trong app.
- **Chi tiết metadata**: MW Metadata Normal cho một kênh, video hoặc playlist.
- **Tìm theo từ khóa**: MW Metadata Search. Tra cứu nhanh lấy một trang kết quả; **Mở bộ lọc** cho phép lọc thêm.
- **Tìm theo khu vực**: MW Geofind Location.

Mặc định **Tra cứu**, **Mở bộ lọc** và **Mở bản đồ** hiển thị kết quả ngay bên dưới biểu mẫu. Có thể chọn **Toàn màn hình** trước khi mở hoặc mở rộng từ thanh kết quả. **Thu nhỏ** (hoặc Esc khi đang toàn màn hình) trả kết quả về dưới biểu mẫu; đổi kiểu hiển thị không tải lại iframe hay gửi lại truy vấn. Không chuyển trang, không mở tab mới, không có nút dẫn đến nhà cung cấp hoặc thẻ liên kết dự án desktop. Các công cụ bình luận khác của ứng dụng không đổi.

Khung chỉ tải khi người dùng chủ động mở. Chỉ gửi liên kết/ID YouTube đã chuẩn hóa hoặc từ khóa cho dịch vụ mattw.io, không gửi token đăng nhập hay dữ liệu Firebase. Hạn mức, nội dung công khai, ngôn ngữ và độ sẵn sàng của kết quả phụ thuộc nhà cung cấp. Không thêm dependency, chỉ mục Firestore hay biến môi trường.

## Kiểm tra

```bash
npx tsx --test tests/youtube-tools.test.ts
npm run build
```

Mã giao diện và chuẩn hóa thông tin nhập: `src/pages/YouTubeToolsPage.tsx`. Việc tích hợp không đụng đến API Express đang triển khai. Khi phát hành bằng Vercel, giữ nguyên cấu hình rewrite `/api` và bundle ESM đã xác minh của đợt triển khai trước.

## Bản phát hành đã kiểm tra

- Production: `dpl_Cs9JwYPxGzP1f2MnQxepdSMDZnLi` (`READY`, `PROMOTED`), alias `https://lanhdiayoutube2027-beryl.vercel.app`.
- Preview: `dpl_2mvkSf4udSqHubt1EwVYuHkcziBg`. Bản production dùng lại đúng các tệp đã build ở preview, với cấu hình môi trường production của dự án.
- Kiểm tra công khai: `/utilities/youtube` và JS bundle trả 200, route chuyển về đăng nhập nếu chưa có phiên; `/api/health` 200; `/api/auth/me` 401 khi chưa đăng nhập.
- Playwright kiểm tra giao diện và dữ liệu thật của một video và một kênh công khai, bộ lọc gốc, bản đồ, và điều hướng mobile 390 px. Kiểm tra trong phiên ứng dụng giả lập chỉ chạy local; không dùng phiên của người dùng.

## Nhãn thương hiệu bên ngoài khung nhúng

Theo lựa chọn của người dùng, giao diện do LÃNH ĐỊA YOUTUBE quản lý chỉ dùng nhãn LÃNH ĐỊA YOUTUBE, mô tả trung lập về công cụ nhúng và liên kết “Xem nhà cung cấp”. Nội dung, thương hiệu, URL và hạn mức bên trong khung gốc không đổi. Không cần thêm API key hoặc sửa quyền truy cập.

Bản thay đổi nhãn dùng lại bundle API `680cdca18448a866d3cb74a07f602f8b8f151a78`, `vercel.json` `3d6a1b35767779ecf60c65a80fba9f34a200401c` và `release.mjs` `7ff66e7f851c445f12cbaabad79fb68fc41fd056` đã tải lên. Cập nhật riêng `package.json` và `brand.mjs`; kết quả build đã đối chiếu với source trong workspace.

- Production cập nhật nhãn: `dpl_2osP82nJqcGa15ug2t1vPg9TKqZk`. Đã xác minh alias trả bundle mới, trang 200, health 200, auth 401 khi chưa đăng nhập; tra cứu video thật qua khung gốc kiểm tra thành công trong phiên test giao diện.

## Màn hình kết quả toàn màn hình

Yêu cầu mới thay cho mục trên: bỏ “Xem nhà cung cấp”, “Mở tab mới” và thẻ liên kết dự án desktop khỏi màn hình tra cứu. Tra cứu, bộ lọc và bản đồ mở một hộp thoại tràn khung trình duyệt ngay tại `/utilities/youtube`; “Đóng” trở về biểu mẫu, “Xem toàn màn hình” mở lại kết quả vừa tra cứu mà không tải lại. Không đổi API hoặc cấu hình Firebase.

Khung kết quả không có quyền mở popup hay chuyển trang cấp trên. Chính sách `frame-src` chỉ áp dụng trong khung trung gian và giới hạn trang được nhúng vào các đường dẫn công cụ, không áp dụng cho dashboard hoặc Firebase. Không làm ẩn tuyệt đối đích iframe: thương hiệu trong nội dung bên thứ ba và URL khi xem yêu cầu mạng vẫn có thể nhận ra.

Kiểm tra Chromium: thành công với dữ liệu video thật và trang chi tiết `HgYJs2T6azA`, mở bộ lọc từ khóa, bản đồ, giao diện 1400 × 900 và 390 × 844, quay lại không gửi lại truy vấn, không mở được tab mới từ iframe và trang chủ của bên cung cấp bị chặn trong khung.

- Production toàn màn hình: `dpl_CiwMi7CutXQ5CWM38bMUVQPn3RFY` (`READY`, `PROMOTED`). Alias đã trả bundle mới: không còn các nút/link bên ngoài nêu trên, có CSP của khung; route 200, health 200, auth 401 khi chưa đăng nhập.

## Bản hiện tại: kết quả dưới biểu mẫu, tùy chọn toàn màn hình

Khung kết quả dùng cùng một phần tử `dialog` và `iframe`: `show()` hiển thị bên dưới biểu mẫu, `showModal()` hiển thị toàn màn hình. Đổi chế độ không thay URL hay dựng lại iframe. Giữ sandbox và chính sách `frame-src` của bản trước.

Build và bốn bài kiểm tra URL đều đạt. Chromium (phiên đăng nhập giả lập local) xác nhận dữ liệu video thật, bộ lọc và bản đồ mở bên dưới biểu mẫu; chọn trước toàn màn hình, thu nhỏ và Esc; giữ iframe, không gửi lại truy vấn khi đổi chế độ; thanh điều khiển có thể thấy và nhận focus ở mobile 390 × 844. Kiểm tra thêm rằng trang chủ bên thứ ba và popup vẫn bị chặn. Không sử dụng phiên đăng nhập của khách hàng.

- Production: `dpl_7CKqLmPpV7mPVb2MuXP5Ms8QS65y` (`READY`, `PROMOTED`) tại `https://lanhdiayoutube2027-beryl.vercel.app/utilities/youtube`. Alias trả 200 cho `/`, `/utilities/youtube`, `/assets/index-fcqN9b4B.js` và `/api/health`; `/api/auth/me` trả 401 khi chưa đăng nhập. Bundle có cả hai chế độ và chính sách khung, không có nút dẫn ra ngoài đã bỏ.
- `brand.mjs` mới (`b17c829e821a81cd55a93d745951c0c97ef5b7d6`) áp dụng lên baseline của `release.mjs`; so sánh toàn bộ `src/` cho kết quả trùng workspace. Tái sử dụng bốn tệp triển khai còn lại, bao gồm bundle API và rewrite; không đổi quyền quản trị hoặc Firebase.
