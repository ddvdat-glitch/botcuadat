# Bot Discord có web quản trị
1. Discord Developer Portal > Bot: bật **MESSAGE CONTENT INTENT**, copy token.
2. Sửa `.env` (DISCORD_TOKEN, ADMIN_PASSWORD).
3. `npm install` rồi `npm start`, mở http://localhost:3000
4. Mời bot vào server (OAuth2 > URL Generator: scope `bot`, quyền Read/Send Messages).
Lệnh và thẻ lưu trong `data.json`, lưu trên web là bot áp dụng ngay (không cần restart).
