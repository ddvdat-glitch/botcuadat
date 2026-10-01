# Bot Discord có web quản trị
1. Discord Developer Portal > Bot: bật **MESSAGE CONTENT INTENT**, copy token.
2. Sửa `.env` (DISCORD_TOKEN, ADMIN_PASSWORD).
3. `npm install` rồi `npm start`, mở http://localhost:3000
4. Mời bot vào server (OAuth2 > URL Generator: scope `bot`; quyền Read/Send Messages, và Moderate Members / Kick / Ban / Manage Roles nếu dùng các lệnh đó).

## Dữ liệu
Mọi thứ nằm trong `data.json`: lệnh, thẻ, **script (code + dữ liệu)**, cài đặt phân cấp, danh sách role/kênh/thành viên. Không cần file script riêng. Lưu trên web là bot áp dụng ngay (không cần restart).

## Phân quyền mute / kick / ban / role
Khi lệnh hoặc script tác động lên **người khác**, bot kiểm tra lần lượt:
1. Người gõ có **quyền** tương ứng (Timeout / Kick / Ban / Quản lý role) hoặc là Admin / chủ server — tab *Role & phân cấp*.
2. So sánh **cấp role** người gõ với đối tượng và làm theo chính sách đã đặt.
3. Bot có đủ cấp/quyền để làm không.

## Danh sách chọn sẵn
Các ô ID người dùng / role / kênh / server đều có nút "📋 chọn…". Danh sách role + kênh do bot quét; thành viên là người đã nhắn tin khi bot online (hoặc toàn bộ nếu bật `MEMBERS_INTENT=true`).

## Nhắn bằng bot
Tab **Log** có ô "Nhắn bằng bot": chọn kênh, gõ nội dung, Enter để gửi. Bấm ↩ cạnh một tin chat trong log để trả lời đúng tin đó.
