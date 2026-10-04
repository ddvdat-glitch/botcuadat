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

## Vua Tiếng Việt (tự đoán từ) — 2 script, code + từ điển đều nằm trong data.json
Tab **Script**, theo thứ tự:
1. **Nạp từ điển Viet\*.txt** — Admin / chủ server gửi link GitHub (repo, thư mục, file blob hoặc raw) chứa `Viet11K.txt`, `Viet22K.txt`, `Viet39K.txt`, `Viet74K.txt` cho bot. Bot tải về, gộp, nén và lưu vào `shared.vtv_dict` trong data.json. Mỗi lần nạp thay toàn bộ từ điển cũ.
2. **Vua Tiếng Việt - tự đoán từ** — chỉ nhận tin từ ID ở ô *"Chỉ nhận tin từ ID"* (đã điền `1248205177589334026`). Gặp tin có dạng `Từ cần đoán: c/ò/n/l/n/h/h/ạ/g (gồm 9 ký tự)` thì giải theo logic `doan_tu.py` (khớp đúng dấu → khớp bỏ dấu → gợi ý thiếu 1 ký tự) và gửi đáp án vào kênh đó. Sửa `MAX_SEND` ở đầu code để gửi nhiều đáp án hơn; trường hợp chỉ có gợi ý thì không gửi, chỉ ghi ở tab Log.

Ô **"Chỉ nhận tin từ ID"** là mục mới: script có điền ô này sẽ chỉ nhận tin từ đúng các ID đó (kể cả bot); script để trống vẫn bỏ qua mọi tin của bot như trước. Với tin của bot, chữ trong embed cũng được đọc.

## Vua Tiếng Việt (tự đoán từ) — 2 script, code + từ điển đều nằm trong data.json
Tab **Script**, theo thứ tự:
1. **Nạp từ điển Viet\*.txt** — Admin / chủ server gửi link GitHub (repo, thư mục, file blob hoặc raw) chứa `Viet11K.txt`, `Viet22K.txt`, `Viet39K.txt`, `Viet74K.txt` cho bot. Bot tải về, gộp, nén và lưu vào `shared.vtv_dict` trong data.json. Mỗi lần nạp thay toàn bộ từ điển cũ.
2. **Vua Tiếng Việt - tự đoán từ** — chỉ nhận tin từ ID ở ô *"Chỉ nhận tin từ ID"* (đã điền `1248205177589334026`). Gặp tin có dạng `Từ cần đoán: c/ò/n/l/n/h/h/ạ/g (gồm 9 ký tự)` thì giải theo logic `doan_tu.py` (khớp đúng dấu → khớp bỏ dấu → gợi ý thiếu 1 ký tự) và gửi đáp án vào kênh đó. Sửa `MAX_SEND` ở đầu code để gửi nhiều đáp án hơn; trường hợp chỉ có gợi ý thì không gửi, chỉ ghi ở tab Log.

Ô **"Chỉ nhận tin từ ID"** là mục mới: script có điền ô này sẽ chỉ nhận tin từ đúng các ID đó (kể cả bot); script để trống vẫn bỏ qua mọi tin của bot như trước. Với tin của bot, chữ trong embed cũng được đọc.

## ☯ Hệ thống Tu Tiên (cổng riêng, dùng chung data.json)
Trang cấu hình mở ở **http://localhost:3001** (đổi bằng `TUTIEN_PORT` trong `.env`, cùng mật khẩu `ADMIN_PASSWORD`). Trang chạy trong cùng tiến trình với bot nên **Lưu là bot áp dụng ngay**, mọi thứ nằm ở `data.json › tutien`:

| Tab | Chỉnh được gì |
|---|---|
| 🌌 Cảnh giới | 19 cảnh giới theo `he_thong_canh_gioi` (cấp 0 → cấp 3), tầng vô hạn ∞ⁿ, công thức chỉ số, tu vi cần, tỉ lệ đột phá, tên các tầng |
| 📊 Chỉ số | Sinh mệnh / công / thủ / tốc / linh lực / thần thức + tự thêm chỉ số mới (dùng được trong menu bằng `{id}`) |
| 🌀 Khả năng | 16 khả năng mở theo cảnh giới (damage, pierce, drain, heal, shield, buff, revive, dodge), `layerBoost` để nhảy tầng ∞ |
| ⌨️ Lệnh | Từ khóa, kiểu khớp, hành động, menu hiển thị, hồi chiêu; kiểu `script` có editor code (JS/Python) |
| 🎨 Thiết kế Menu | Trình thiết kế kiểu Canva: xem trước y như Discord, bấm để chọn, **kéo-thả** trường/nút, màu, ảnh, nút bấm chạy lệnh / chuyển menu / mở link, nút “Lưu & gửi thử” vào kênh |
| 👥 Người chơi | Sửa cảnh giới, tầng, đạo ngấn, reset |
| ⚔️ Mô phỏng | Cho 2 cảnh giới đánh nhau để cân bằng |

**Lệnh mặc định:** `!tt` (menu) · `!ttc [@người]` (trạng thái) · `!ttl` (tu luyện) · `!ttdp` (đột phá) · `!ttkn [dùng <id> | bỏ]` (khả năng) · `!ttpk [@người]` (luận bàn, không tag = đánh tâm ma) · `!tttop` (xếp hạng). Đổi tất cả ở tab Lệnh.

**Số tiến sát vô hạn:** chỉ số là cặp `[a, b] = ∞^a × 10^b` (file `infnum.js`, dùng chung bot và trình duyệt). `b` lên tới 10³⁰⁰ nên từ **Luyện Khí Hóa Thần** chỉ số thực tế dạng `10^(1,000,001)`; từ **Luyện Thần Hoàn Hư** mỗi cảnh giới nhảy 1 tầng ∞ — tầng cao thắng tuyệt đối, đòn từ tầng thấp không chạm được. Cấp 3 (Chân Tiên → Đại La) bị khóa: tỉ lệ lên = 0, mỗi lần thử ở Đại Thừa chỉ tăng đạo ngấn.

**Script cho lệnh tu tiên:** ngoài `ctx`, `store`, `reply(...)`, script có `ctx.player` (biến đã định dạng), `shared.player` (bản thô, sửa được `realm`, `tier`, `exp`, `dao`, `equipped`, `flags`) và `const I = require(ctx.libPath)` để tính số vô hạn (`I.fmt`, `I.add`, `I.mul`, `I.cmp`…).
