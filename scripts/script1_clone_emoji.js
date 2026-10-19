// ============================================================================
// SCRIPT 1 - TỰ CLONE EMOJI / STICKER
// Ai đó gửi emoji server khác hoặc sticker -> bot kiểm tra server mình đã có chưa
// -> nếu CHƯA có thì tải về và thêm vào server (kèm báo kết quả).
//
// Cài trên web (tab Script):
//   Ngôn ngữ : JavaScript
//   Trigger  : <a?:\w{2,32}:\d{15,25}>|\[\[STICKER:\d+\]\]|^!clone\b
//   Kiểu khớp: regex
//   Cooldown : 2     Thời gian tối đa: 8000
//   (để trống ô "Chỉ nhận tin từ ID" và ô kênh = áp dụng mọi kênh)
//
// Lệnh bật/tắt (chỉ Admin / chủ server):  !clone on   |   !clone off   |   !clone (xem trạng thái)
// Bot cần quyền "Manage Guild Expressions" (Quản lý emoji & sticker).
// ============================================================================

// ------------------------------ CẤU HÌNH ------------------------------------
const MAX_EMOJI = 5;      // tối đa số emoji clone từ 1 tin nhắn
const CLONE_STICKER = true; // true = clone cả sticker
const VERBOSE = false;    // true = báo cả khi server đã có sẵn (mặc định im lặng cho đỡ spam)
// ----------------------------------------------------------------------------

const text = String(ctx.content || '');
const isStaff = ctx.user.isAdmin || ctx.user.isOwner;

// ---- Lệnh bật / tắt ----
const cmd = text.trim().match(/^!clone(?:\s+(\S+))?/i);
if (cmd) {
  const arg = (cmd[1] || '').toLowerCase();
  if (['on', 'bat', 'bật'].includes(arg) || ['off', 'tat', 'tắt'].includes(arg)) {
    if (!isStaff) return 'Chỉ Admin / chủ server mới bật tắt được.';
    store.enabled = ['on', 'bat', 'bật'].includes(arg);
    return store.enabled ? '✅ Đã **BẬT** tự clone emoji/sticker.' : '⛔ Đã **TẮT** tự clone emoji/sticker.';
  }
  return 'Clone emoji/sticker đang **' + (store.enabled === false ? 'TẮT' : 'BẬT') + '**. Dùng `!clone on` / `!clone off`.';
}
if (store.enabled === false) return;
if (!ctx.guildId) return;

const L = ctx.limits || {};
const haveEmojiId = new Set((ctx.guildEmojis || []).map(e => e.id));
const haveEmojiName = new Set((ctx.guildEmojis || []).map(e => e.name.toLowerCase()));
const haveStickerId = new Set((ctx.guildStickers || []).map(s => s.id));
const haveStickerName = new Set((ctx.guildStickers || []).map(s => s.name.toLowerCase()));
const uniqueName = (name, taken) => {
  let n = name, i = 2;
  while (taken.has(n.toLowerCase())) n = name.slice(0, 29) + '_' + i++;
  taken.add(n.toLowerCase());
  return n;
};

let usedStatic = L.emojiStatic || 0, usedAnim = L.emojiAnimated || 0, usedSticker = L.stickerUsed || 0;
let queued = 0;
const skipped = [];

// ---- 1) EMOJI ----
const seen = new Set();
for (const m of text.matchAll(/<(a?):(\w{2,32}):(\d{15,25})>/g)) {
  const [, anim, name, id] = m;
  if (seen.has(id)) continue; seen.add(id);
  if (haveEmojiId.has(id)) { skipped.push('emoji `' + name + '` đã có'); continue; }
  if (queued >= MAX_EMOJI) { skipped.push('emoji `' + name + '` (vượt giới hạn ' + MAX_EMOJI + ' emoji/tin)'); continue; }
  const animated = !!anim;
  if (L.emojiMax && (animated ? usedAnim : usedStatic) >= L.emojiMax) {
    skipped.push('emoji `' + name + '` (server hết slot emoji ' + (animated ? 'động' : 'tĩnh') + ' ' + L.emojiMax + '/' + L.emojiMax + ')');
    continue;
  }
  const url = 'https://cdn.discordapp.com/emojis/' + id + '.' + (animated ? 'gif' : 'png') + '?size=128';
  addEmoji(url, uniqueName(name, haveEmojiName), { animated, srcId: id });
  animated ? usedAnim++ : usedStatic++;
  queued++;
}

// ---- 2) STICKER ----
if (CLONE_STICKER) {
  for (const s of (ctx.stickers || []).slice(0, 1)) {
    if (haveStickerId.has(s.id)) { skipped.push('sticker `' + s.name + '` đã có'); continue; }
    if (s.format === 3) { skipped.push('sticker `' + s.name + '` (dạng Lottie, bot không thể upload)'); continue; }
    if (L.stickerMax && usedSticker >= L.stickerMax) { skipped.push('sticker `' + s.name + '` (server hết slot sticker ' + L.stickerMax + '/' + L.stickerMax + ')'); continue; }
    const url = s.format === 4
      ? 'https://media.discordapp.net/stickers/' + s.id + '.gif'
      : 'https://cdn.discordapp.com/stickers/' + s.id + '.png';
    addSticker(url, uniqueName(s.name, haveStickerName), { stickerId: s.id });
    usedSticker++; queued++;
  }
}

// Chỉ báo những lý do đáng chú ý (hết slot, Lottie, vượt giới hạn). "Đã có" chỉ báo khi VERBOSE.
const notable = skipped.filter(x => !x.endsWith('đã có'));
const toShow = VERBOSE ? skipped : notable;
if (toShow.length) return '⚠️ Không clone được: ' + toShow.join('; ');
if (queued) print('Đang clone ' + queued + ' mục');
