// ============================================================================
//  HỆ THỐNG TU TIÊN — chạy chung process với bot, dữ liệu nằm trong data.json (mục "tutien")
//  • Cảnh giới / chỉ số / khả năng / lệnh / menu đều chỉnh ở trang Tu Tiên (cổng TUTIEN_PORT, mặc định 3001)
//  • Chỉ số dùng InfNum = [tầng ∞, log10] nên từ Luyện Khí Hóa Thần trở đi có thể tiến sát vô hạn
// ============================================================================
const path = require('path');
const I = require('./infnum');

let C = null;                               // ngữ cảnh do index.js truyền vào (init)
const T = () => C.db().tutien;
const isObj = o => o && typeof o === 'object' && !Array.isArray(o);
const clamp = (v, a, b) => Math.min(Math.max(+v || 0, a), b);
const rnd = (a, b) => a + Math.random() * (b - a);
const slug = (s, d = 'x') => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 24) || d;
const fmtNum = n => Number(n).toLocaleString('en-US');

// ====================== MẶC ĐỊNH ======================
// R(id, tên, emoji, cấp, màu, tầng∞, b0, bStep, growth, tên các tầng, expB0, expStep, số lần tu luyện/tầng, tỉ lệ đột phá, mô tả, khoá?)
const T4 = ['Sơ kỳ', 'Trung kỳ', 'Hậu kỳ', 'Đại viên mãn'];
const T9 = Array.from({ length: 9 }, (_, i) => 'Tầng ' + (i + 1));
const R = (id, name, emoji, cap, color, layer, b0, bStep, growth, tierNames, expB0, expStep, trains, chance, desc, locked = false) =>
  ({ id, name, emoji, cap, color, layer, b0, bStep, growth, tierNames, expB0, expStep, trains, chance, desc, locked });
const defaultRealms = () => [
  R('pham_nhan', 'Phàm Nhân', '🧍', 0, '#9ca3af', 0, 1, 0, 1, ['Phàm thể'], 1.3, 0, 8, 0.9, 'Sinh linh thường. Không thể dẫn dắt hậu thiên khí.'),
  R('vo_gia', 'Võ Giả', '🥋', 0, '#a3a3a3', 0, 3, 0.2, 1.15, T9, 2.5, 0.4, 10, 0.75, 'Mạnh gấp trăm lần phàm nhân vẫn chỉ là cấp 0, không điều khiển được hậu thiên khí.'),
  R('luyen_tinh_hoa_khi', 'Luyện Tinh Hóa Khí', '🌬️', 1, '#60a5fa', 0, 9, 0.8, 1.3, T9, 6, 1.2, 12, 0.6, 'Dẫn hậu thiên chi khí vào thân, mài giũa hòa với tinh. Mạnh nhất có thể diệt quốc.'),
  R('luyen_khi_hoa_than', 'Luyện Khí Hóa Thần', '✨', 1, '#a78bfa', 0, 1e6, 2e5, 1.8, T9, 1.2e6, 3e5, 14, 0.45, 'Gộp tam hoa ngũ khí thành một, sinh ra Thần. Hủy nhục thân dễ dàng tái tạo. Diệt thế giả — chỉ số đã tiến sát vô hạn.'),
  R('luyen_than_hoan_hu', 'Luyện Thần Hoàn Hư', '🌌', 1, '#818cf8', 1, 0, 40, 1.5, T4, 0, 25, 16, 0.3, 'Thần quy về Hư, hòa thiên địa, cảm nhận pháp tắc. Từ đây mỗi tiểu cảnh giới cách nhau VÔ HẠN.'),
  R('luyen_hu_hop_dao', 'Luyện Hư Hợp Đạo', '☯️', 1, '#c084fc', 2, 0, 60, 1.5, T4, 0, 40, 18, 0.25, 'Chưởng khống, sáng tạo, hủy diệt toàn bộ tiểu thiên. Toàn năng trong giới nhưng chưa toàn tri.'),
  R('truc_co', 'Trúc Cơ', '🏯', 2, '#f472b6', 3, 0, 90, 1.5, T4, 0, 60, 20, 0.2, 'Tự thân là tiểu thiên, kẻ chưởng khống trung thiên.'),
  R('kim_dan', 'Kim Đan', '🟡', 2, '#fbbf24', 4, 0, 120, 1.5, T4, 0, 80, 20, 0.2, 'Ép trung thiên vô hạn thành kim đan, thai nghén thần mới. Diệt thế trung thiên.'),
  R('nguyen_anh', 'Nguyên Anh', '👶', 2, '#fb923c', 5, 0, 160, 1.5, T4, 0, 100, 22, 0.18, 'Vô hạn kim đan nở rộ, sinh hài nhi thần.'),
  R('hoa_than', 'Hóa Thần', '🔱', 2, '#f87171', 6, 0, 200, 1.5, T4, 0, 130, 22, 0.16, 'Thần trong cơ thể lớn lên, bắt đầu tiếp xúc đại thiên.'),
  R('phan_hu', 'Phản Hư', '🌀', 2, '#34d399', 7, 0, 260, 1.5, T4, 0, 170, 24, 0.14, 'Thần hòa nhập vào vô hạn đại thiên giới trong đa nguyên.'),
  R('do_kiep', 'Độ Kiếp', '⚡', 2, '#2dd4bf', 8, 0, 340, 1.5, T4, 0, 220, 24, 0.12, 'Vươn tới vô hạn đa nguyên, chưởng khống đa nguyên chư thiên.'),
  R('dai_thua', 'Đại Thừa', '🕊️', 2, '#e5e7eb', 9, 0, 450, 1.5, T4, 0, 300, 26, 0, 'Chí cao đa nguyên chư thiên, tìm cách siêu thoát thành chân tiên. Tỷ lệ lên cấp 3 luôn là 0… nhưng sẽ luôn là 100 trong 0.'),
  ...[['chan_tien', 'Chân Tiên', '🪽'], ['huyen_tien', 'Huyền Tiên', '🌠'], ['dia_tien', 'Địa Tiên', '🏔️'], ['kim_tien', 'Kim Tiên', '🪙'], ['thai_at_kim_tien', 'Thái Ất Kim Tiên', '🌟'], ['dai_la', 'Đại La', '♾️']]
    .map(([id, n, e], k) => R(id, n, e, 3, '#ffffff', 1000 + k * 1000, 0, 0, 1, ['Thái Sơ'], 0, 0, 1, 0, 'Cấp 3 — thoát khỏi hỗn độn, về Thái Sơ. Không thể diễn tả, không thể tưởng. Khái niệm không thể vượt trên khái niệm.', true))
];
const defaultStats = () => [
  { id: 'hp', name: 'Sinh Mệnh', emoji: '❤️', off: 1, desc: 'Máu' },
  { id: 'atk', name: 'Công Kích', emoji: '⚔️', off: 0, desc: 'Sức tấn công' },
  { id: 'def', name: 'Phòng Ngự', emoji: '🛡️', off: -0.2, desc: 'Giảm sát thương nhận' },
  { id: 'spd', name: 'Tốc Độ', emoji: '💨', off: -0.5, desc: 'Ai ra đòn trước' },
  { id: 'mp', name: 'Linh Lực', emoji: '🔷', off: 0.7, desc: 'Tiêu hao khi dùng khả năng' },
  { id: 'soul', name: 'Thần Thức', emoji: '👁️', off: 0.2, desc: 'Cảm nhận pháp tắc' }
];
// type: damage | pierce(bỏ qua phòng ngự) | drain(hút máu) | heal | shield | buff | revive(bị động) | dodge(bị động)
// mult = log10 hệ số nhân công kích; cost = % linh lực tối đa; extra: drain/heal/revive = tỉ lệ 0..1, shield = log10 hệ số×phòng ngự, buff = log10 hệ số×công kích, dodge = xác suất
const A = (id, name, emoji, minRealm, type, mult, cost, cd, extra, turns, layerBoost, desc) => ({ id, name, emoji, minRealm, type, mult, cost, cd, extra, turns, layerBoost, desc });
const defaultAbilities = () => [
  A('quyen_phap', 'Phàm Quyền', '👊', 0, 'damage', 0.3, 0, 0, 0, 0, 0, 'Đòn cơ bản, không tốn linh lực.'),
  A('cuong_phong_chuong', 'Cuồng Phong Chưởng', '🌪️', 1, 'damage', 0.7, 0.05, 1, 0, 0, 0, 'Chưởng phong của võ giả.'),
  A('tinh_khi_hop_nhat', 'Tinh Khí Hợp Nhất', '🔥', 2, 'damage', 1.2, 0.1, 1, 0, 0, 0, 'Dồn tinh và hậu thiên khí vào một đòn.'),
  A('hau_thien_ho_the', 'Hậu Thiên Hộ Thể', '🛡️', 2, 'shield', 0, 0.08, 3, 1.5, 0, 0, 'Khí hóa giáp hấp thụ sát thương.'),
  A('tam_hoa_tu_dinh', 'Tam Hoa Tụ Đỉnh', '🌸', 3, 'buff', 0, 0.1, 4, 2, 3, 0, 'Công kích tăng mạnh trong 3 lượt.'),
  A('than_chi_hoa', 'Thần Chi Hóa', '💠', 3, 'revive', 0, 0, 0, 0.5, 0, 0, 'Bị động: nhục thân hủy diệt vẫn tái tạo, hồi 50% sinh mệnh (1 lần/trận).'),
  A('diet_the_nhat_kich', 'Diệt Thế Nhất Kích', '💥', 3, 'damage', 4, 0.2, 2, 0, 0, 0, 'Đòn của kẻ diệt thế.'),
  A('quy_hu', 'Quy Hư', '🌫️', 4, 'dodge', 0, 0, 0, 0.25, 0, 0, 'Bị động: 25% quy về hư, đòn đánh xuyên qua như không.'),
  A('phap_tac_tran_lai', 'Pháp Tắc Trải Dài', '📜', 4, 'pierce', 2.5, 0.15, 2, 0, 0, 0, 'Pháp tắc xuyên giáp, bỏ qua phòng ngự.'),
  A('tieu_thien_chuong_khong', 'Tiểu Thiên Chưởng Khống', '🌐', 5, 'drain', 6, 0.25, 3, 0.3, 0, 0, 'Chưởng khống quy tắc, hút 30% sát thương thành sinh mệnh.'),
  A('truc_co_chan_the', 'Trúc Cơ Chân Thể', '🏯', 6, 'shield', 0, 0.2, 4, 6, 0, 0, 'Thân là tiểu thiên, khiên vô cùng dày.'),
  A('kim_dan_thon_the', 'Kim Đan Nuốt Thế', '🟡', 7, 'drain', 9, 0.3, 3, 0.4, 0, 0, 'Kim đan nuốt trung thiên, hút 40% sát thương.'),
  A('nguyen_anh_hoa_than', 'Nguyên Anh Hóa Thân', '👶', 8, 'buff', 0, 0.2, 5, 12, 4, 0, 'Hài nhi thần xuất thế, công kích tăng 4 lượt.'),
  A('phan_hu_quy_nhat', 'Phản Hư Quy Nhất', '🌀', 10, 'pierce', 12, 0.3, 3, 0, 0, 1, 'Quy nhất đại thiên: xuyên giáp và nhảy lên 1 tầng vô hạn.'),
  A('do_kiep_loi_hai', 'Độ Kiếp Lôi Hải', '⚡', 11, 'damage', 18, 0.35, 3, 0, 0, 1, 'Lôi kiếp của đa nguyên giáng xuống, nhảy 1 tầng vô hạn.'),
  A('dai_thua_sieu_thoat', 'Đại Thừa Siêu Thoát', '🕊️', 12, 'heal', 0, 0.3, 5, 1, 0, 0, 'Siêu thoát vòng sinh tử: hồi đầy sinh mệnh.')
];
const mb = (label, emoji, style, type, value) => ({ label, emoji, style, action: { type, value } });
const defaultMenus = () => [
  { id: 'main', name: 'Menu chính', ownerOnly: true, content: '', rows: [
      [mb('Trạng thái', '📜', 'primary', 'cmd', 'status'), mb('Tu luyện', '🧘', 'success', 'cmd', 'train'), mb('Đột phá', '⚡', 'danger', 'cmd', 'breakthrough')],
      [mb('Khả năng', '🌀', 'secondary', 'cmd', 'abilities'), mb('Tâm ma', '👹', 'secondary', 'cmd', 'duel'), mb('Bảng xếp hạng', '🏆', 'secondary', 'cmd', 'top')]],
    embed: { enabled: true, color: '#8b5cf6', title: '☯️ Tu Tiên — Menu của {name}', description: 'Cảnh giới hiện tại: {realmEmoji} **{realm}** · {tierName}\nTu vi: `{bar}`\n\n*Đại La ngự trị tại Thái Sơ… còn ngươi, đang ở đâu giữa hỗn độn?*',
      fields: [{ name: '❤️ Sinh Mệnh', value: '{hp}', inline: true }, { name: '⚔️ Công Kích', value: '{atk}', inline: true }, { name: '🛡️ Phòng Ngự', value: '{def}', inline: true }],
      footer: { text: 'Cấp {cap} · {tangVoHan}' }, thumbnail: '', image: '', author: { name: '', icon: '' }, url: '' } },
  { id: 'status', name: 'Trạng thái', ownerOnly: true, content: '', rows: [[mb('Tu luyện', '🧘', 'success', 'cmd', 'train'), mb('Đột phá', '⚡', 'danger', 'cmd', 'breakthrough'), mb('Menu', '🏠', 'secondary', 'menu', 'main')]],
    embed: { enabled: true, color: '#60a5fa', title: '{realmEmoji} {name} — {realm}', description: '**{tierName}** · cấp {cap}\nTu vi `{bar}` ({expPct}%)\n{exp} / {need}\n\n{statLines}',
      fields: [{ name: '🏆 Chiến tích', value: 'Thắng {wins} · Thua {losses}', inline: true }, { name: '☯️ Đạo ngấn', value: '{dao}', inline: true }], footer: { text: '{tangVoHan}' }, thumbnail: '', image: '', author: { name: '', icon: '' }, url: '' } },
  { id: 'result', name: 'Kết quả lệnh', ownerOnly: true, content: '', rows: [[mb('Tu luyện', '🧘', 'success', 'cmd', 'train'), mb('Trạng thái', '📜', 'primary', 'cmd', 'status'), mb('Menu', '🏠', 'secondary', 'menu', 'main')]],
    embed: { enabled: true, color: '#34d399', title: '{title}', description: '{result}', fields: [], footer: { text: '{realm} · {tierName} · `{bar}`' }, thumbnail: '', image: '', author: { name: '', icon: '' }, url: '' } },
  { id: 'abilities', name: 'Khả năng', ownerOnly: true, content: '', rows: [[mb('Trạng thái', '📜', 'primary', 'cmd', 'status'), mb('Menu', '🏠', 'secondary', 'menu', 'main')]],
    embed: { enabled: true, color: '#f472b6', title: '🌀 Khả năng của {name}', description: '{result}', fields: [], footer: { text: 'Dùng !ttkn dùng <id> để chọn khả năng, !ttkn bỏ để dùng tất cả' }, thumbnail: '', image: '', author: { name: '', icon: '' }, url: '' } }
];
const C_ = (id, name, trigger, matchType, type, menu, cooldown, extra = {}) => ({ id, name, trigger, matchType, type, menu, cooldown, enabled: true, replyMode: 'reply', reply: '', language: 'javascript', code: '', timeoutMs: 5000, ...extra });
const SAMPLE_CODE = String.raw`// Lệnh script Tu Tiên. ctx.player = dữ liệu người chơi (đã định dạng), shared.player = bản thô để sửa.
// Thư viện số vô hạn: const I = require(ctx.libPath);  I.fmt([tầng, log10])
const I = require(ctx.libPath);
const p = shared.player;               // { realm, tier, exp:[a,b], dao, flags, ... }
p.dao = (p.dao || 0) + 1;              // ngộ đạo: +1 đạo ngấn
reply('☯️ ' + ctx.user.mention + ' ngộ đạo, đạo ngấn: **' + p.dao + '** (cảnh giới ' + ctx.player.realm + ')');`;
const defaultCommands = () => [
  C_('menu', 'Menu Tu Tiên', '!tt', 'exact', 'menu', 'main', 3),
  C_('status', 'Xem trạng thái', '!ttc', 'startsWith', 'status', 'status', 3),
  C_('train', 'Tu luyện', '!ttl', 'exact', 'train', 'result', 10),
  C_('breakthrough', 'Đột phá', '!ttdp', 'exact', 'breakthrough', 'result', 10),
  C_('abilities', 'Khả năng', '!ttkn', 'startsWith', 'abilities', 'abilities', 3),
  C_('duel', 'Luận bàn (@người hoặc tâm ma)', '!ttpk', 'startsWith', 'duel', 'result', 20),
  C_('top', 'Bảng xếp hạng', '!tttop', 'exact', 'top', 'result', 5),
  C_('ngodao', 'Ngộ đạo (ví dụ script)', '!ttdao', 'exact', 'script', '', 30, { enabled: false, code: SAMPLE_CODE })
];
const defaultSettings = () => ({ slots: 4, maxRounds: 12, mpRegen: 0.12, trainRandom: 0.25, failLoss: 0.5, dummyScale: 1, duelRewardX: 3, autoCreate: true });
const defaults = () => ({ v: 1, settings: defaultSettings(), realms: defaultRealms(), stats: defaultStats(), abilities: defaultAbilities(), menus: defaultMenus(), commands: defaultCommands(), players: {}, scriptStore: {} });

// ====================== CHUẨN HÓA / KIỂM TRA DỮ LIỆU ======================
const num = (v, d = 0) => Number.isFinite(+v) && v !== '' && v !== null ? +v : d;
const str = (v, n = 200) => String(v ?? '').slice(0, n);
function cleanRealm(r, i) {
  const names = (Array.isArray(r.tierNames) ? r.tierNames : String(r.tierNames || '').split('\n')).map(s => str(s, 40).trim()).filter(Boolean);
  return { id: slug(r.id || r.name, 'realm' + i), name: str(r.name || 'Cảnh giới ' + i, 60), emoji: str(r.emoji, 12), cap: clamp(r.cap, 0, 3) | 0, color: /^#[0-9a-f]{6}$/i.test(r.color) ? r.color : '#8b5cf6',
    layer: Math.trunc(num(r.layer)), b0: clamp(num(r.b0), -1e300, 1e300), bStep: clamp(num(r.bStep), -1e300, 1e300), growth: clamp(num(r.growth, 1), 0.01, 1e6), tierNames: names.length ? names.slice(0, 60) : ['Tầng 1'],
    expB0: clamp(num(r.expB0), -1e300, 1e300), expStep: clamp(num(r.expStep), -1e300, 1e300), trains: clamp(num(r.trains, 12), 1, 100000), chance: clamp(num(r.chance), 0, 1), desc: str(r.desc, 600), locked: !!r.locked };
}
const cleanStat = (s, i) => ({ id: slug(s.id || s.name, 'stat' + i), name: str(s.name || 'Chỉ số', 40), emoji: str(s.emoji, 12), off: clamp(num(s.off), -1e6, 1e6), desc: str(s.desc, 120) });
const ABTYPES = ['damage', 'pierce', 'drain', 'heal', 'shield', 'buff', 'revive', 'dodge'];
const cleanAbility = (a, i) => ({ id: slug(a.id || a.name, 'kn' + i), name: str(a.name || 'Khả năng', 60), emoji: str(a.emoji, 12), minRealm: clamp(a.minRealm, 0, 999) | 0, type: ABTYPES.includes(a.type) ? a.type : 'damage',
  mult: clamp(num(a.mult), -1e6, 1e12), cost: clamp(num(a.cost), 0, 1), cd: clamp(a.cd, 0, 50) | 0, extra: clamp(num(a.extra), -1e12, 1e12), turns: clamp(a.turns, 0, 50) | 0, layerBoost: clamp(a.layerBoost, -1000, 1000) | 0, desc: str(a.desc, 300) });
const STY = ['primary', 'secondary', 'success', 'danger', 'link'], BACT = ['cmd', 'menu', 'link'];
const cleanBtn = b => ({ label: str(b.label, 80), emoji: str(b.emoji, 60), style: STY.includes(b.style) ? b.style : 'secondary', action: { type: BACT.includes(b.action?.type) ? b.action.type : 'cmd', value: str(b.action?.value, 300) } });
function cleanMenu(m, i) {
  const e = isObj(m.embed) ? m.embed : {};
  return { id: slug(m.id || m.name, 'menu' + i), name: str(m.name || 'Menu', 60), ownerOnly: m.ownerOnly !== false, content: str(m.content, 2000),
    rows: (Array.isArray(m.rows) ? m.rows : []).slice(0, 5).map(r => (Array.isArray(r) ? r : []).slice(0, 5).map(cleanBtn)).filter(r => r.length),
    embed: { enabled: e.enabled !== false, color: (/^#[0-9a-f]{6}$/i.test(e.color) || e.color === '__realm') ? e.color : '#8b5cf6', title: str(e.title, 256), description: str(e.description, 4000), url: str(e.url, 500), thumbnail: str(e.thumbnail, 500), image: str(e.image, 500),
      author: { name: str(e.author?.name, 256), icon: str(e.author?.icon, 500) }, footer: { text: str(e.footer?.text, 2048), icon: str(e.footer?.icon, 500) }, timestamp: !!e.timestamp,
      fields: (Array.isArray(e.fields) ? e.fields : []).slice(0, 25).map(f => ({ name: str(f.name, 256), value: str(f.value, 1024), inline: !!f.inline })) } };
}
const CTYPES = ['menu', 'status', 'train', 'breakthrough', 'abilities', 'duel', 'top', 'reply', 'script'];
const cleanCmd = (c, i) => ({ id: slug(c.id || c.name, 'cmd' + i), name: str(c.name || 'Lệnh', 80), trigger: str(c.trigger, 200), matchType: ['exact', 'startsWith', 'contains', 'regex'].includes(c.matchType) ? c.matchType : 'exact',
  type: CTYPES.includes(c.type) ? c.type : 'reply', menu: str(c.menu, 40), cooldown: clamp(c.cooldown, 0, 86400), enabled: c.enabled !== false, replyMode: c.replyMode === 'send' ? 'send' : 'reply',
  reply: str(c.reply, 2000), language: c.language === 'python' ? 'python' : 'javascript', code: str(c.code, 100000), timeoutMs: clamp(c.timeoutMs || 5000, 500, 15000) });
const uniq = (arr, key = 'id') => { const seen = new Set(); return arr.filter(x => !seen.has(x[key]) && seen.add(x[key])); };
function cleanConfig(raw, base) {
  const d = defaults(), r = isObj(raw) ? raw : {};
  const out = { v: 1, players: isObj(base?.players) ? base.players : {}, scriptStore: isObj(base?.scriptStore) ? base.scriptStore : {} };
  const st = isObj(r.settings) ? r.settings : {};
  out.settings = {}; for (const k of Object.keys(d.settings)) out.settings[k] = typeof d.settings[k] === 'boolean' ? (st[k] ?? d.settings[k]) !== false : num(st[k], d.settings[k]);
  out.settings.slots = clamp(out.settings.slots, 1, 25) | 0; out.settings.maxRounds = clamp(out.settings.maxRounds, 1, 60) | 0; out.settings.mpRegen = clamp(out.settings.mpRegen, 0, 1);
  out.settings.dummyScale = clamp(out.settings.dummyScale, 0.001, 1000); out.settings.failLoss = clamp(out.settings.failLoss, 0, 1);
  out.realms = Array.isArray(r.realms) && r.realms.length ? uniq(r.realms.map(cleanRealm)) : d.realms;
  let stats = Array.isArray(r.stats) && r.stats.length ? uniq(r.stats.map(cleanStat)) : d.stats;
  for (const must of d.stats.slice(0, 5)) if (!stats.some(s => s.id === must.id)) stats.push(must);   // hp/atk/def/spd/mp bắt buộc để chiến đấu
  out.stats = stats;
  out.abilities = Array.isArray(r.abilities) ? uniq(r.abilities.map(cleanAbility)) : d.abilities;
  out.menus = Array.isArray(r.menus) && r.menus.length ? uniq(r.menus.map(cleanMenu)) : d.menus;
  out.commands = Array.isArray(r.commands) ? uniq(r.commands.map(cleanCmd)) : d.commands;
  return out;
}
function normalize(raw) {
  if (!isObj(raw) || !Array.isArray(raw.realms)) return cleanConfig(isObj(raw) ? { ...raw, realms: null } : {}, raw);
  return cleanConfig(raw, raw);
}

// ====================== TÍNH CHỈ SỐ ======================
const tierCount = r => Math.max(1, r.tierNames.length);
const realmAt = i => { const rs = T().realms; return rs[clamp(i, 0, rs.length - 1) | 0]; };
const bAt = (r, t) => { const g = r.growth, k = t - 1; return r.b0 + (Math.abs(g - 1) < 1e-9 ? r.bStep * k : r.bStep * (Math.pow(g, k) - 1) / (g - 1)); };
const statOf = (r, t, s) => I.norm([r.layer, bAt(r, t) + s.off]);
const needOf = (r, t) => I.norm([r.layer, r.expB0 + r.expStep * (t - 1)]);
const statsOf = (r, t, scaleLog = 0) => { const o = {}; for (const s of T().stats) o[s.id] = I.addLog(statOf(r, t, s), scaleLog); return o; };
const tangText = r => r.layer <= 0 ? 'chưa vượt tầng vô hạn' : r.layer >= 1000 ? 'ngoài hỗn độn' : 'tầng vô hạn ∞' + (r.layer === 1 ? '' : I.fmt([r.layer, 0]).slice(1));

function getPlayer(uid, name) {
  const P = T().players;
  let p = P[uid];
  if (!p) p = P[uid] = { id: uid, name: name || uid, realm: 0, tier: 1, exp: I.ZERO(), wins: 0, losses: 0, dao: 0, equipped: [], flags: {}, created: Date.now() };
  if (name) p.name = name;
  p.realm = clamp(p.realm, 0, T().realms.length - 1) | 0;
  p.tier = clamp(p.tier, 1, tierCount(realmAt(p.realm))) | 0;
  p.exp = I.norm(p.exp);
  if (!Array.isArray(p.equipped)) p.equipped = [];
  if (!isObj(p.flags)) p.flags = {};
  return p;
}
function playerVars(p, extra = {}) {
  const r = realmAt(p.realm), need = needOf(r, p.tier), st = statsOf(r, p.tier), pct = Math.min(1, I.ratio(p.exp, need));
  const v = { name: p.name, mention: `<@${p.id}>`, userId: p.id, realm: r.name, realmEmoji: r.emoji, realmId: r.id, cap: r.cap, tier: p.tier, tierName: r.tierNames[p.tier - 1], tangVoHan: tangText(r),
    exp: I.fmt(p.exp), need: I.fmt(need), expPct: (pct * 100).toFixed(1), bar: I.bar(pct, 12), wins: p.wins, losses: p.losses, dao: p.dao, color: r.color, desc: r.desc };
  const lines = [];
  for (const s of T().stats) { v[s.id] = I.fmt(st[s.id]); lines.push(`${s.emoji} **${s.name}:** ${v[s.id]}`); }
  v.statLines = lines.join('\n');
  return { ...v, ...extra };
}
const fill = (s, v) => String(s ?? '').replace(/\{([\w.]+)\}/g, (m, k) => k in v ? String(v[k]) : m);

// ====================== LUYỆN TẬP / ĐỘT PHÁ ======================
function gainOf(p, mult = 1) {
  const r = realmAt(p.realm), S = T().settings;
  return I.scale(needOf(r, p.tier), mult * rnd(1 - S.trainRandom, 1 + S.trainRandom) / r.trains);
}
function addExp(p, gain) {                         // cộng exp, tự lên tầng; trả về các dòng thông báo
  const msgs = []; let r = realmAt(p.realm);
  p.exp = I.add(p.exp, gain);
  for (let guard = 0; guard < 200 && p.tier < tierCount(r) && I.cmp(p.exp, needOf(r, p.tier)) >= 0; guard++) {
    p.exp = I.sub(p.exp, needOf(r, p.tier)); p.tier++;
    msgs.push(`🔺 Tiến lên **${r.tierNames[p.tier - 1]}** của ${r.emoji} ${r.name}!`);
  }
  const need = needOf(r, p.tier);
  if (p.tier >= tierCount(r) && I.cmp(p.exp, need) >= 0) { p.exp = need; msgs.push('🌟 Đã đủ tu vi để **đột phá** cảnh giới tiếp theo (`đột phá`).'); }
  return msgs;
}
function doTrain(p) {
  const g = gainOf(p), msgs = addExp(p, g);
  return { text: `🧘 ${p.name} tĩnh tọa hấp thụ thiên địa, nhận **+${I.fmt(g)}** tu vi.\n` + msgs.join('\n'), title: '🧘 Tu luyện' };
}
function doBreak(p) {
  const r = realmAt(p.realm), nx = T().realms[p.realm + 1], need = needOf(r, p.tier);
  if (!nx) return { text: 'Ngươi đã đứng ở đỉnh của mọi cảnh giới có thể đặt tên.', title: '⚡ Đột phá' };
  if (p.tier < tierCount(r) || I.cmp(p.exp, need) < 0) return { text: `Chưa đủ điều kiện. Cần đạt **${r.tierNames[tierCount(r) - 1]}** và tu vi đầy (${I.fmt(p.exp)} / ${I.fmt(need)}).`, title: '⚡ Đột phá', fail: true };
  if (nx.locked) {
    p.dao++; p.exp = I.scale(p.exp, 1 - T().settings.failLoss * 0.5);
    return { title: '♾️ Siêu thoát', fail: true, text: `${nx.emoji} **${nx.name}** — tỷ lệ từ cấp 0–2 lên cấp 3 luôn là **0**.\nVì mọi khái niệm đều nằm trong hỗn độn, mà khái niệm thì không thể vượt trên khái niệm.\nNhưng trong cái **0** ấy… luôn có **100**.\n\n☯️ Ngươi lĩnh ngộ thêm một đạo ngấn (**${p.dao}**).` };
  }
  if (Math.random() < r.chance) { p.realm++; p.tier = 1; p.exp = I.ZERO(); return { title: '⚡ Đột phá thành công', text: `🎆 Thiên địa chấn động! Ngươi đột phá lên ${nx.emoji} **${nx.name}**!\n${nx.desc}` }; }
  p.exp = I.scale(p.exp, 1 - T().settings.failLoss);
  return { title: '💢 Đột phá thất bại', fail: true, text: `Tâm ma quấy nhiễu, đột phá thất bại (tỉ lệ ${(r.chance * 100).toFixed(0)}%). Mất ${(T().settings.failLoss * 100).toFixed(0)}% tu vi.` };
}

// ====================== KHẢ NĂNG ======================
const unlocked = p => T().abilities.filter(a => a.minRealm <= p.realm);
function abilitiesText(p) {
  const un = unlocked(p), eq = p.equipped.filter(id => un.some(a => a.id === id));
  const line = a => `${eq.includes(a.id) ? '⭐' : '▫️'} ${a.emoji} **${a.name}** \`${a.id}\` — ${a.desc}${a.cost ? ` _(tốn ${(a.cost * 100).toFixed(0)}% linh lực)_` : ''}`;
  const lock = T().abilities.filter(a => a.minRealm > p.realm).sort((x, y) => x.minRealm - y.minRealm).slice(0, 3).map(a => `🔒 ${a.emoji} ${a.name} — mở ở ${realmAt(a.minRealm).name}`);
  return (un.length ? un.map(line).join('\n') : 'Chưa có khả năng nào.') + `\n\n⭐ đang chọn: ${eq.length ? eq.join(', ') : 'tất cả (tự động)'} · tối đa ${T().settings.slots}` + (lock.length ? '\n' + lock.join('\n') : '');
}
function doEquip(p, args) {
  const un = unlocked(p), a0 = (args[0] || '').toLowerCase();
  if (['dùng', 'dung', 'use', 'chon', 'chọn'].includes(a0)) {
    const key = args.slice(1).join(' ').toLowerCase(), a = un.find(x => x.id === key || x.name.toLowerCase() === key);
    if (!a) return '❌ Không có khả năng đó (hoặc chưa mở khóa). Gõ `!ttkn` để xem id.\n\n' + abilitiesText(p);
    const i = p.equipped.indexOf(a.id);
    if (i >= 0) p.equipped.splice(i, 1); else { if (p.equipped.length >= T().settings.slots) p.equipped.shift(); p.equipped.push(a.id); }
  } else if (['bỏ', 'bo', 'clear', 'xoa', 'xóa'].includes(a0)) p.equipped = [];
  return abilitiesText(p);
}

// ====================== CHIẾN ĐẤU (luận bàn) ======================
function makeFighter(name, r, t, scaleLog, abil, equipped) {
  const st = statsOf(r, t, scaleLog), un = abil.filter(a => a.minRealm <= T().realms.indexOf(r));
  const pick = equipped.length ? un.filter(a => equipped.includes(a.id)) : un;
  return { name, st, hp: st.hp.slice(), mp: st.mp.slice(), shield: I.ZERO(), cds: {}, buff: { turns: 0, log: 0 }, revived: false, abil: pick.length ? pick : un, passives: un };
}
const hpPct = f => { const x = I.ratio(f.hp, f.st.hp) * 100; return x <= 0 ? '0%' : x < 0.01 ? '<0.01%' : x.toFixed(x < 10 ? 2 : 1) + '%'; };
function chooseAbility(f) {
  const ok = a => !['revive', 'dodge'].includes(a.type) && !(f.cds[a.id] > 0) && I.cmp(f.mp, I.scale(f.st.mp, a.cost)) >= 0;
  const c = f.abil.filter(ok);
  const low = I.ratio(f.hp, f.st.hp) < 0.4;
  let a = low && c.find(x => x.type === 'heal');
  if (!a && f.buff.turns <= 0) a = c.find(x => x.type === 'buff');
  if (!a && I.isZ(f.shield) && Math.random() < 0.35) a = c.find(x => x.type === 'shield');
  if (!a) { const d = c.filter(x => ['damage', 'pierce', 'drain'].includes(x.type)).sort((x, y) => (y.layerBoost - x.layerBoost) || (y.mult - x.mult)); a = d[0]; }
  return a || { id: '_basic', name: 'Phổ công', emoji: '👊', type: 'damage', mult: 0, cost: 0, cd: 0, extra: 0, turns: 0, layerBoost: 0 };
}
function fight(A_, B_, S = T().settings) {
  const lines = [], F = [A_, B_]; let winner = null;
  const hit = (att, def, ab) => {
    let atk = I.addLog(att.st.atk, ab.mult || 0); if (ab.layerBoost) atk = I.layer(atk, ab.layerBoost);
    if (att.buff.turns > 0) atk = I.addLog(atk, att.buff.log);
    const dfn = ab.type === 'pierce' ? I.ZERO() : def.st.def;
    return I.div(I.mul(atk, atk), I.add(atk, dfn));                    // atk² / (atk + def)
  };
  const dodge = def => def.passives.find(a => a.type === 'dodge');
  for (let rd = 1; rd <= S.maxRounds && !winner; rd++) {
    const order = I.cmp(A_.st.spd, B_.st.spd) >= 0 ? [0, 1] : [1, 0];
    for (const i of order) {
      const att = F[i], def = F[1 - i]; if (I.isZ(att.hp) || I.isZ(def.hp)) continue;
      const ab = chooseAbility(att);
      if (ab.cost) att.mp = I.sub(att.mp, I.scale(att.st.mp, ab.cost));
      if (ab.cd) att.cds[ab.id] = ab.cd + 1;
      let msg = `\`R${rd}\` ${ab.emoji} **${att.name}** dùng **${ab.name}**`;
      if (ab.type === 'heal') { att.hp = I.min(att.st.hp, I.add(att.hp, I.scale(att.st.hp, Math.max(0.0001, ab.extra || 1)))); msg += ` → hồi sinh mệnh (${hpPct(att)})`; }
      else if (ab.type === 'shield') { att.shield = I.mul(att.st.def, [0, ab.extra]); msg += ` → khiên ${I.fmt(att.shield)}`; }
      else if (ab.type === 'buff') { att.buff = { turns: ab.turns || 3, log: ab.extra }; msg += ` → công kích ×10^${+ab.extra.toFixed(2)} trong ${ab.turns || 3} lượt`; }
      else {
        const dg = dodge(def);
        if (dg && Math.random() < dg.extra) msg += ` → **${def.name}** quy hư, đòn đánh xuyên qua!`;
        else {
          let dmg = hit(att, def, ab);
          if (!I.isZ(def.shield)) { if (I.cmp(def.shield, dmg) >= 0) { def.shield = I.sub(def.shield, dmg); dmg = I.ZERO(); } else { dmg = I.sub(dmg, def.shield); def.shield = I.ZERO(); } }
          def.hp = I.sub(def.hp, dmg);
          if (ab.type === 'drain' && !I.isZ(dmg)) att.hp = I.min(att.st.hp, I.add(att.hp, I.scale(dmg, clamp(ab.extra, 0, 1))));
          msg += ` → **${I.fmt(dmg)}** sát thương`;
          if (I.isZ(def.hp)) {
            const rv = def.passives.find(a => a.type === 'revive');
            if (rv && !def.revived) { def.revived = true; def.hp = I.scale(def.st.hp, clamp(rv.extra, 0.01, 1)); msg += ` — 💠 **${def.name}** tái tạo nhục thân (${hpPct(def)})`; }
            else { msg += ` — 💀 **${def.name}** gục ngã!`; winner = i; }
          } else msg += ` (${def.name} còn ${hpPct(def)})`;
        }
      }
      lines.push(msg); if (winner !== null) break;
    }
    for (const f of F) {
      for (const k of Object.keys(f.cds)) if (f.cds[k] > 0) f.cds[k]--;
      if (f.buff.turns > 0) f.buff.turns--;
      f.mp = I.min(f.st.mp, I.add(f.mp, I.scale(f.st.mp, S.mpRegen)));
    }
  }
  if (winner === null) {
    const ra = I.ratio(A_.hp, A_.st.hp), rb = I.ratio(B_.hp, B_.st.hp);
    winner = Math.abs(ra - rb) < 1e-9 ? -1 : ra > rb ? 0 : 1;
    lines.push(`⌛ Hết ${S.maxRounds} hiệp — ${winner < 0 ? 'hòa' : '**' + F[winner].name + '** hơn về sinh mệnh (' + hpPct(F[winner]) + ')'}.`);
  }
  return { lines, winner };
}
function duelText(res, a, b) {
  const L = res.lines, shown = L.length > 16 ? [...L.slice(0, 8), `… (${L.length - 14} dòng lược bớt) …`, ...L.slice(-6)] : L;
  return shown.join('\n') + `\n\n🏁 ${res.winner < 0 ? '**Hòa**' : '**' + (res.winner === 0 ? a : b) + '** thắng!'}`;
}
function simulate(a, b) {
  const ra = realmAt(a.realm), rb = realmAt(b.realm), ta = clamp(a.tier, 1, tierCount(ra)) | 0, tb = clamp(b.tier, 1, tierCount(rb)) | 0;
  const A_ = makeFighter(`${ra.name} ${ra.tierNames[ta - 1]}`, ra, ta, 0, T().abilities, []), B_ = makeFighter(`${rb.name} ${rb.tierNames[tb - 1]}`, rb, tb, 0, T().abilities, []);
  const res = fight(A_, B_);
  return { text: duelText(res, A_.name, B_.name), winner: res.winner, stats: { a: Object.fromEntries(Object.entries(A_.st).map(([k, v]) => [k, I.fmt(v)])), b: Object.fromEntries(Object.entries(B_.st).map(([k, v]) => [k, I.fmt(v)])) } };
}
function doDuel(p, cx) {
  const r = realmAt(p.realm), S = T().settings, target = cx.mentions.find(m => m.id !== p.id && !m.bot);
  const mine = makeFighter(p.name, r, p.tier, 0, T().abilities, p.equipped);
  let foe, q = null;
  if (target) { q = getPlayer(target.id, target.username); const rq = realmAt(q.realm); foe = makeFighter(q.name, rq, q.tier, 0, T().abilities, q.equipped); }
  else foe = makeFighter('Tâm ma của ' + p.name, r, p.tier, Math.log10(S.dummyScale), T().abilities, []);
  const res = fight(mine, foe), won = res.winner === 0;
  let extra = '';
  if (res.winner >= 0) {
    if (won) { p.wins++; if (q) q.losses++; } else { p.losses++; if (q) q.wins++; }
    const w = won ? p : q;
    if (w) { const g = gainOf(w, S.duelRewardX * (q ? 1 : 0.5)); const m = addExp(w, g); extra = `\n🎁 ${w.name} nhận **+${I.fmt(g)}** tu vi.` + (m.length ? '\n' + m.join('\n') : ''); }
  }
  return { title: '⚔️ Luận bàn', text: duelText(res, mine.name, foe.name) + extra };
}
function doTop() {
  const arr = Object.values(T().players).sort((a, b) => b.realm - a.realm || b.tier - a.tier || I.cmp(I.norm(b.exp), I.norm(a.exp))).slice(0, 10);
  if (!arr.length) return { title: '🏆 Bảng xếp hạng', text: 'Chưa có ai tu tiên.' };
  const med = ['🥇', '🥈', '🥉'];
  return { title: '🏆 Bảng xếp hạng', text: arr.map((p, i) => { const r = realmAt(p.realm); return `${med[i] || `**${i + 1}.**`} **${p.name}** — ${r.emoji} ${r.name} · ${r.tierNames[p.tier - 1]}`; }).join('\n') };
}

// ====================== LỆNH & MENU ======================
const cdMap = new Map();
async function execCommand(cmd, cx) {
  const p = getPlayer(cx.uid, cx.username);
  let res;
  switch (cmd.type) {
    case 'menu': res = { text: '' }; break;
    case 'status': { const tg = cx.mentions.find(m => !m.bot); res = { who: tg ? getPlayer(tg.id, tg.username) : p, text: '' }; break; }
    case 'train': res = doTrain(p); break;
    case 'breakthrough': res = doBreak(p); break;
    case 'abilities': res = { text: doEquip(p, cx.args), title: '🌀 Khả năng' }; break;
    case 'duel': res = doDuel(p, cx); break;
    case 'top': res = doTop(); break;
    case 'reply': res = { text: cmd.reply }; break;
    case 'script': res = await runCmdScript(cmd, cx, p); break;
    default: res = { text: '' };
  }
  C.saveSoon();
  const who = res.who || p, v = playerVars(who, { result: res.text || '', title: res.title || cmd.name });
  return { vars: v, menuId: cmd.menu, res };
}
async function runCmdScript(cmd, cx, p) {
  const v = playerVars(p), key = cmd.id, store = (T().scriptStore[key] = isObj(T().scriptStore[key]) ? T().scriptStore[key] : {});
  const ctx = { content: cx.content || '', rest: cx.rest || '', args: cx.args || [], match: [], event: 'message', libPath: path.join(__dirname, 'infnum.js'), player: v,
    user: { id: cx.uid, username: cx.username, display: cx.display || cx.username, mention: `<@${cx.uid}>`, roles: [], roleIds: [], isAdmin: !!cx.isAdmin, isOwner: !!cx.isOwner },
    mentions: cx.mentions, channelId: cx.channelId || '', guildId: cx.guildId || '', guildName: '', messageId: '', now: Date.now() };
  const r = await C.enqueue(() => C.runScript(cmd.language, cmd.code, { ctx, store, shared: { player: JSON.parse(JSON.stringify(p)) } }, cmd.timeoutMs));
  if (!r.ok) { C.log('error', `Lệnh tu tiên "${cmd.name}" lỗi:\n${r.error}`, { user: cx.username }); return { text: '⚠️ Script bị lỗi, xem tab Log của bot.', title: cmd.name }; }
  T().scriptStore[key] = r.store || {};
  const sp = r.shared && r.shared.player;
  if (isObj(sp)) {                                                  // chỉ nhận lại các trường hợp lệ
    p.realm = clamp(sp.realm, 0, T().realms.length - 1) | 0; p.tier = clamp(sp.tier, 1, tierCount(realmAt(p.realm))) | 0; p.exp = I.norm(sp.exp);
    p.dao = clamp(sp.dao, 0, 1e15); p.wins = clamp(sp.wins, 0, 1e15) | 0; p.losses = clamp(sp.losses, 0, 1e15) | 0;
    if (Array.isArray(sp.equipped)) p.equipped = sp.equipped.map(String).slice(0, 25); if (isObj(sp.flags)) p.flags = JSON.parse(JSON.stringify(sp.flags).slice(0, 20000) || '{}');
  }
  return { text: (r.out?.replies || []).join('\n'), title: cmd.name };
}
const HEX = c => parseInt(String(c).replace('#', ''), 16) || 0x8b5cf6;
const okUrl = u => /^https?:\/\/\S+$/i.test(u);
function buildPayload(menu, v, uid) {
  const D = require('discord.js'), o = { allowedMentions: { parse: [] } };
  if (menu.content) o.content = fill(menu.content, v).slice(0, 2000);
  const e = menu.embed;
  if (e && e.enabled !== false) {
    const eb = new D.EmbedBuilder().setColor(HEX(e.color === '__realm' ? v.color : e.color));
    const t = fill(e.title, v).slice(0, 256), d = fill(e.description, v).slice(0, 4000);
    if (t) eb.setTitle(t); if (d) eb.setDescription(d); if (okUrl(e.url) && t) eb.setURL(e.url);
    if (okUrl(fill(e.thumbnail, v))) eb.setThumbnail(fill(e.thumbnail, v)); if (okUrl(fill(e.image, v))) eb.setImage(fill(e.image, v));
    const an = fill(e.author?.name, v).slice(0, 256); if (an) eb.setAuthor({ name: an, iconURL: okUrl(e.author.icon) ? e.author.icon : undefined });
    const ft = fill(e.footer?.text, v).slice(0, 2048); if (ft) eb.setFooter({ text: ft, iconURL: okUrl(e.footer.icon) ? e.footer.icon : undefined });
    if (e.timestamp) eb.setTimestamp();
    const fs = (e.fields || []).map(f => ({ name: fill(f.name, v).slice(0, 256) || '\u200b', value: fill(f.value, v).slice(0, 1024) || '\u200b', inline: !!f.inline })).slice(0, 25);
    if (fs.length) eb.addFields(fs);
    if (t || d || fs.length || ft || an) o.embeds = [eb];
  }
  const SM = { primary: D.ButtonStyle.Primary, secondary: D.ButtonStyle.Secondary, success: D.ButtonStyle.Success, danger: D.ButtonStyle.Danger, link: D.ButtonStyle.Link };
  const rows = [];
  (menu.rows || []).forEach((row, ri) => {
    const comps = [];
    row.forEach((b, ci) => {
      try {
        const bb = new D.ButtonBuilder(), label = fill(b.label, v).slice(0, 80);
        if (label) bb.setLabel(label); if (b.emoji) bb.setEmoji(b.emoji.trim());
        if (!label && !b.emoji) return;
        if (b.action.type === 'link' || b.style === 'link') { const u = fill(b.action.value, v); if (!okUrl(u)) return; bb.setStyle(D.ButtonStyle.Link).setURL(u); }
        else bb.setStyle(SM[b.style] || D.ButtonStyle.Secondary).setCustomId(`tt:${menu.id}:${ri}:${ci}:${uid}`.slice(0, 100));
        comps.push(bb);
      } catch { /* emoji sai → bỏ nút */ }
    });
    if (comps.length) rows.push(new D.ActionRowBuilder().addComponents(comps));
  });
  if (rows.length) o.components = rows;
  if (!o.content && !o.embeds) o.content = '\u200b';
  return o;
}
function defaultMenu(title) { return { id: '_', ownerOnly: true, content: '', rows: [], embed: { enabled: true, color: '#8b5cf6', title: '{title}', description: '{result}', fields: [], footer: { text: '' }, author: {}, url: '', thumbnail: '', image: '' } }; }
const menuById = id => T().menus.find(m => m.id === id);
const cmdById = id => T().commands.find(c => c.id === id);
function cmdPayload(out, uid) {
  const m = menuById(out.menuId) || defaultMenu();
  const body = m.id === '_' ? { ...m, embed: { ...m.embed, title: out.vars.title } } : m;
  return buildPayload(body, out.vars, uid);
}

async function onMessage(msg) {
  if (!T() || msg.author.bot) return false;
  const text = (msg.content || '').trim(); if (!text) return false;
  for (const cmd of T().commands) {
    if (cmd.enabled === false || !cmd.trigger || !C.matchText(cmd, text)) continue;
    const key = cmd.id + ':' + msg.author.id, last = cdMap.get(key) || 0;
    if (cmd.cooldown > 0 && Date.now() - last < cmd.cooldown * 1000) { msg.react('⏳').catch(() => {}); return true; }
    cdMap.set(key, Date.now());
    const rest = cmd.matchType === 'startsWith' ? text.slice(cmd.trigger.trim().length).trim() : '';
    const cx = { uid: msg.author.id, username: msg.author.username, display: msg.member?.displayName, content: text, rest, args: rest ? rest.split(/\s+/) : [], mentions: [...msg.mentions.users.values()].map(u => ({ id: u.id, username: u.username, bot: !!u.bot })),
      channelId: msg.channelId, guildId: msg.guild?.id || '', isAdmin: !!msg.member?.permissions.has('Administrator'), isOwner: msg.guild?.ownerId === msg.author.id };
    C.log('cmd', `Tu tiên: lệnh "${cmd.name}" (${cmd.type})`, { user: msg.author.username });
    try {
      const out = await execCommand(cmd, cx), payload = cmdPayload(out, msg.author.id);
      const sent = cmd.replyMode === 'send' ? await msg.channel.send(payload) : await msg.reply(payload);
      C.log('bot', `[tu tiên] ${out.vars.title}: ${String(out.vars.result).slice(0, 300)}`, { channel: msg.channel?.name, channelId: msg.channelId });
      return !!sent || true;
    } catch (e) { C.log('error', `Tu tiên "${cmd.name}": ${e.stack || e.message}`); msg.react('⚠️').catch(() => {}); }
    return true;
  }
  return false;
}

async function onButton(i) {
  const D = require('discord.js'), [, mid, ri, ci, owner] = i.customId.split(':');
  const menu = menuById(mid), btn = menu?.rows?.[+ri]?.[+ci];
  if (!menu || !btn) return i.reply({ content: '⚠️ Menu/nút này đã bị xóa hoặc sửa.', flags: D.MessageFlags.Ephemeral });
  const anyone = owner === 'any';
  if (!anyone && menu.ownerOnly !== false && owner !== i.user.id) return i.reply({ content: '🚫 Đây không phải menu của ngươi. Gõ `!tt` để mở menu riêng.', flags: D.MessageFlags.Ephemeral });
  if (anyone) await i.deferReply({ flags: D.MessageFlags.Ephemeral }); else await i.deferUpdate();
  const uid = i.user.id, send = p => anyone ? i.editReply(p) : i.editReply(p);
  try {
    if (btn.action.type === 'menu') {
      const m2 = menuById(btn.action.value); if (!m2) return send({ content: '⚠️ Menu đích không tồn tại.', components: [], embeds: [] });
      const p = getPlayer(uid, i.user.username); return send(buildPayload(m2, playerVars(p, { result: '', title: m2.name }), uid));
    }
    const cmd = cmdById(btn.action.value); if (!cmd || cmd.enabled === false) return send({ content: '⚠️ Lệnh của nút này đã bị tắt/xóa.', components: [], embeds: [] });
    const key = cmd.id + ':' + uid, last = cdMap.get(key) || 0;
    if (cmd.cooldown > 0 && Date.now() - last < cmd.cooldown * 1000) return i.followUp({ content: `⏳ Chờ ${Math.ceil((cmd.cooldown * 1000 - (Date.now() - last)) / 1000)}s nữa.`, flags: D.MessageFlags.Ephemeral });
    cdMap.set(key, Date.now());
    const out = await execCommand(cmd, { uid, username: i.user.username, display: i.member?.displayName, content: '', rest: '', args: [], mentions: [], channelId: i.channelId, guildId: i.guildId || '', isAdmin: !!i.member?.permissions?.has?.('Administrator'), isOwner: i.guild?.ownerId === uid });
    await send(cmdPayload(out, anyone ? 'any' : uid));
  } catch (e) { C.log('error', 'Tu tiên nút: ' + (e.stack || e.message)); send({ content: '⚠️ Lỗi, xem tab Log của bot.', components: [], embeds: [] }).catch(() => {}); }
}

// ====================== TRANG TU TIÊN (cổng riêng) ======================
function createApp(password) {
  const express = require('express'), app = express();
  app.use(express.json({ limit: '4mb' }));
  app.get('/lib/infnum.js', (req, res) => res.type('js').sendFile(path.join(__dirname, 'infnum.js')));
  app.use(express.static(path.join(__dirname, 'public-tutien')));
  app.use('/api', (req, res, next) => password && req.headers['x-password'] === password ? next() : res.status(401).json({ error: 'Sai mật khẩu' }));
  const pub = () => { const t = T(); const { scriptStore, ...rest } = t; return { ...rest, players: undefined }; };

  app.get('/api/tt', (req, res) => { const db = C.db(); res.json({ tutien: pub(), channels: db.channels, runtimes: C.runtimeInfo(), ctypes: CTYPES, abtypes: ABTYPES, botReady: C.client.isReady() }); });
  app.put('/api/tt', (req, res) => {
    const db = C.db(); db.tutien = cleanConfig(req.body || {}, db.tutien); C.saveNow(); res.json({ ok: true, tutien: pub() });
  });
  app.get('/api/tt/players', (req, res) => res.json(Object.values(T().players).map(p => ({ ...p, expText: I.fmt(p.exp) }))));
  app.put('/api/tt/player/:id', (req, res) => {
    const p = getPlayer(String(req.params.id).slice(0, 30)), b = req.body || {};
    if (b.name != null) p.name = str(b.name, 40);
    if (b.realm != null) p.realm = clamp(b.realm, 0, T().realms.length - 1) | 0;
    p.tier = clamp(b.tier ?? p.tier, 1, tierCount(realmAt(p.realm))) | 0;
    if (b.exp) p.exp = I.norm(b.exp); if (b.dao != null) p.dao = clamp(b.dao, 0, 1e15);
    if (b.reset) { p.realm = 0; p.tier = 1; p.exp = I.ZERO(); p.equipped = []; p.wins = p.losses = 0; }
    C.saveNow(); res.json({ ok: true });
  });
  app.delete('/api/tt/player/:id', (req, res) => { delete T().players[req.params.id]; C.saveNow(); res.json({ ok: true }); });
  app.post('/api/tt/vars', (req, res) => {                          // biến mẫu để xem trước menu
    const b = req.body || {}, p = { id: '100000000000000001', name: str(b.name || 'Đạo hữu', 40), realm: clamp(b.realm, 0, T().realms.length - 1) | 0, tier: 1, exp: I.ZERO(), wins: 7, losses: 2, dao: 3 };
    p.tier = clamp(b.tier, 1, tierCount(realmAt(p.realm))) | 0; p.exp = I.scale(needOf(realmAt(p.realm), p.tier), 0.42);
    res.json(playerVars(p, { result: 'Đây là *nội dung kết quả* của lệnh.\n**Dòng** thứ hai.', title: 'Tiêu đề lệnh' }));
  });
  app.post('/api/tt/simulate', (req, res) => { const b = req.body || {}; res.json(simulate(b.a || {}, b.b || {})); });
  app.post('/api/tt/send-menu', async (req, res) => {
    try {
      const { menuId, channelId } = req.body || {}, menu = menuById(menuId), id = String(channelId || '').match(/\d{15,25}/)?.[0];
      if (!menu) return res.status(404).json({ error: 'Không có menu này (nhớ bấm Lưu trước)' }); if (!id) return res.status(400).json({ error: 'Chưa chọn kênh' });
      if (!C.client.isReady()) return res.status(503).json({ error: 'Bot chưa online' });
      const ch = await C.client.channels.fetch(id).catch(() => null); if (!ch || typeof ch.send !== 'function') return res.status(404).json({ error: 'Không gửi được vào kênh này' });
      const sample = { id: 'any', name: 'Đạo hữu', realm: 0, tier: 1, exp: I.ZERO(), wins: 0, losses: 0, dao: 0 };
      await ch.send(buildPayload(menu, playerVars(sample, { result: '(nội dung kết quả)', title: menu.name }), 'any')); res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
  return app;
}

function init(ctx) { C = ctx; }
module.exports = { init, normalize, cleanConfig, defaults, onMessage, onButton, createApp, simulate, fight, makeFighter, playerVars, getPlayer, execCommand, buildPayload, doTrain, doBreak, addExp, statsOf, needOf, realmAt, fill };
