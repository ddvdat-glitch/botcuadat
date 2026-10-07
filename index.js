require('dotenv').config();
const fs = require('fs'), path = require('path'), express = require('express');
const { Client, GatewayIntentBits, Events, ButtonBuilder, ButtonStyle, ActionRowBuilder, MessageFlags } = require('discord.js');
const { runScript, detectRuntimes, runtimeInfo, RUNTIMES } = require('./scriptRunner');
const tutien = require('./tutien');   // hệ thống Tu Tiên (trang cấu hình ở cổng TUTIEN_PORT)

const DB = path.join(__dirname, 'data.json');

// ====================== TIỆN ÍCH ======================
const newId = () => 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const clone = o => JSON.parse(JSON.stringify(o ?? {}));
const clampNum = (v, a, b) => Math.min(Math.max(+v || 0, a), b);
const isObj = o => o && typeof o === 'object' && !Array.isArray(o);
const idFrom = s => { const m = String(s ?? '').match(/\d{15,25}/); return m ? m[0] : null; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const fmtDur = s => {
  s = Math.floor(+s || 0); if (!s) return '0 giây';
  const d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60), x = s % 60;
  return [d && d + ' ngày', h && h + ' giờ', m && m + ' phút', x && x + ' giây'].filter(Boolean).join(' ');
};

// ====================== LOG (lưu trong RAM, xem ở tab Log của web) ======================
const LOGS = []; let logSeq = 0; const MAX_LOGS = 1500;
function log(type, text, meta = {}) {
  const e = { id: ++logSeq, t: Date.now(), type, text: String(text ?? '').slice(0, 1500), ...meta };
  LOGS.push(e); if (LOGS.length > MAX_LOGS) LOGS.splice(0, LOGS.length - MAX_LOGS);
  if (type !== 'chat') (type === 'error' ? console.error : console.log)(`[${type}] ${meta.user ? meta.user + ': ' : ''}${e.text}`);
}
process.on('unhandledRejection', e => log('error', 'unhandledRejection: ' + ((e && e.stack) || e)));
process.on('uncaughtException', e => log('error', 'uncaughtException: ' + ((e && e.stack) || e)));

// ====================== DỮ LIỆU (data.json) ======================
const outcome = (allow, reply) => ({ allow, reply, punish: { type: 'none', seconds: 30 }, deleteAfter: 10 });
const defaultHierarchy = () => {
  const mk = () => ({
    higher: outcome(true, ''),
    equal: outcome(false, '{user} bạn cùng cấp với {target} nên không thể {action}.'),
    lower: outcome(false, '{user} bạn thấp cấp hơn {target} nên không thể {action}.')
  });
  return {
    enabled: true, mute: mk(), kick: mk(), ban: mk(),
    requirePerm: { enabled: true, reply: '{user} bạn không có quyền {action} (cần quyền: {perm}).', deleteAfter: 10 },
    botCannot: { reply: 'Bot không thể {action} {target} (role của bot thấp hơn/bằng, người đó là Admin/chủ server, hoặc bot thiếu quyền).', deleteAfter: 10 }
  };
};
// ====================== MẪU SCRIPT (nhúng sẵn, khi chèn vào web sẽ được LƯU TRONG data.json) ======================
const TEMPLATES = [
  { id: 'hello', name: 'Chào hỏi (ví dụ đơn giản)', language: 'javascript', trigger: '!hi', matchType: 'startsWith', cooldown: 2,
    code: String.raw`reply('Xin chào ' + ctx.user.mention + '! Bạn vừa gõ: ' + (ctx.rest || '(không có gì)'));` },
  { id: 'taixiu', name: 'Tài xỉu (xu dùng chung)', language: 'javascript', trigger: '!tx', matchType: 'startsWith', cooldown: 3,
    code: String.raw`// !tx tai 100  |  !tx xiu 100  |  !tx (xem số xu)
const bal = shared.coins = shared.coins || {};
const uid = ctx.user.id;
if (bal[uid] === undefined) bal[uid] = 1000;
const side = (ctx.args[0] || '').toLowerCase();
const bet = parseInt(ctx.args[1], 10);
if (!['tai', 'xiu', 'tài', 'xỉu'].includes(side) || !(bet > 0)) {
  reply(ctx.user.mention + ' bạn có **' + bal[uid] + '** xu.\nCách chơi: !tx tai 100 hoặc !tx xiu 100');
  return;
}
if (bet > bal[uid]) { reply(ctx.user.mention + ' không đủ xu (còn ' + bal[uid] + ').'); return; }
const d = [1, 2, 3].map(() => 1 + Math.floor(Math.random() * 6));
const sum = d[0] + d[1] + d[2];
const triple = d[0] === d[1] && d[1] === d[2];
const result = sum >= 11 ? 'tài' : 'xỉu';
const pick = side.startsWith('t') ? 'tài' : 'xỉu';
const win = !triple && pick === result;
bal[uid] += win ? bet : -bet;
reply('🎲 ' + d.join(' + ') + ' = **' + sum + '** → **' + (triple ? 'bão (nhà cái ăn)' : result) + '**\n' +
  ctx.user.mention + (win ? ' thắng +' : ' thua -') + bet + ' xu. Số dư: **' + bal[uid] + '**');` },
  { id: 'noitu', name: 'Nối từ (tiếng Việt, 2 tiếng)', language: 'javascript', trigger: '!nt', matchType: 'startsWith', cooldown: 2,
    code: String.raw`// !nt con mèo  ->  người sau gõ !nt mèo ăn ...
const word = ctx.rest.trim().toLowerCase().replace(/\s+/g, ' ');
const syl = w => w.split(' ');
store.used = store.used || [];
if (!word) {
  reply(store.last ? 'Từ hiện tại: **' + store.last + '** → hãy nối bằng từ bắt đầu bằng **' + syl(store.last).at(-1) + '**' : 'Gõ !nt <từ gồm 2 tiếng> để bắt đầu.');
  return;
}
if (syl(word).length !== 2) { reply('Từ phải gồm đúng 2 tiếng, vd: con mèo'); return; }
if (store.used.includes(word)) { reply('Từ **' + word + '** đã dùng rồi!'); return; }
if (store.last && syl(word)[0] !== syl(store.last).at(-1)) {
  reply('Sai rồi! Từ phải bắt đầu bằng **' + syl(store.last).at(-1) + '**'); return;
}
store.last = word; store.used.push(word);
if (store.used.length > 500) store.used.shift();
reply('✅ **' + word + '** → tiếp theo: từ bắt đầu bằng **' + syl(word)[1] + '**');` },
  { id: 'nap_tu_dien', name: 'Nạp từ điển Viet*.txt (gửi link git)', language: 'javascript', trigger: String.raw`https?://(www\.)?(github\.com|raw\.githubusercontent\.com)/\S+`, matchType: 'regex', cooldown: 5, timeoutMs: 15000,
    code: String.raw`// SCRIPT 1 - NẠP TỪ ĐIỂN: gửi link GitHub chứa các file Viet*.txt (Viet11K.txt, Viet22K.txt...) cho bot.
// Bot tải về, gộp, nén và lưu vào data.json (shared.vtv_dict). Script 2 dùng dữ liệu này để đoán từ.
// Link hỗ trợ: github.com/user/repo | .../tree/nhánh/thư-mục | .../blob/nhánh/file.txt | raw.githubusercontent.com/...
const zlib = require('zlib');
const ALLOWED_IDS = [];   // ID được phép nạp. Để trống = chỉ Admin / chủ server.
if (!(ctx.user.isAdmin || ctx.user.isOwner || ALLOWED_IDS.includes(ctx.user.id))) return;

const NAME_RE = /(^|\/)viet[^\/]*\.txt$/i;
const KNOWN = ['Viet11K.txt', 'Viet22K.txt', 'Viet39K.txt', 'Viet74K.txt'];
const UA = { 'User-Agent': 'discord-bot-nap-tu-dien' };
const enc = p => p.split('/').map(encodeURIComponent).join('/');
const rawUrl = (o, r, ref, p) => 'https://raw.githubusercontent.com/' + o + '/' + r + '/' + encodeURIComponent(ref) + '/' + enc(p);
async function getJson(u) {
  const r = await fetch(u, { headers: { ...UA, Accept: 'application/vnd.github+json' } });
  if (!r.ok) throw new Error('GitHub trả về ' + r.status + ' cho ' + u);
  return r.json();
}
async function exists(u) { try { return (await fetch(u, { method: 'HEAD', headers: UA })).ok; } catch { return false; } }
async function getText(u) {
  const r = await fetch(u, { headers: UA });
  if (!r.ok) throw new Error('Tải lỗi ' + r.status + ': ' + u);
  const t = await r.text();
  if (t.length > 6000000) throw new Error('File quá lớn: ' + u);
  return t.replace(/^\ufeff/, '');
}

try {
  const urls = (ctx.content.match(/https?:\/\/[^\s<>)\]]+/g) || []).map(u => u.replace(/[.,;]+$/, ''));
  const files = [];
  for (const url of urls) {
    let U; try { U = new URL(url); } catch { continue; }
    const host = U.hostname.toLowerCase().replace(/^www\./, '');
    const parts = U.pathname.split('/').filter(Boolean).map(decodeURIComponent);
    if (host === 'raw.githubusercontent.com') {
      if (/\.txt$/i.test(U.pathname)) files.push({ name: parts[parts.length - 1], url });
    } else if (host === 'github.com') {
      const [o, r0, kind, ref, ...rest] = parts;
      if (!o || !r0) continue;
      const repo = r0.replace(/\.git$/i, '');
      if ((kind === 'blob' || kind === 'raw') && ref && rest.length) {
        files.push({ name: rest[rest.length - 1], url: rawUrl(o, repo, ref, rest.join('/')) });
        continue;
      }
      const prefix = kind === 'tree' ? rest.join('/') : '';
      try {
        const branch = kind === 'tree' && ref ? ref : (await getJson('https://api.github.com/repos/' + o + '/' + repo)).default_branch;
        const tree = await getJson('https://api.github.com/repos/' + o + '/' + repo + '/git/trees/' + encodeURIComponent(branch) + '?recursive=1');
        for (const t of tree.tree || []) {
          if (t.type === 'blob' && NAME_RE.test(t.path) && (!prefix || t.path.startsWith(prefix + '/')))
            files.push({ name: t.path.split('/').pop(), url: rawUrl(o, repo, branch, t.path) });
        }
      } catch (e) {
        // API GitHub bị giới hạn lượt gọi / lỗi -> thử tải thẳng các tên file quen thuộc ở nhánh main, master
        print('GitHub API lỗi (' + e.message + ') -> thử tải thẳng ' + KNOWN.join(', '));
        for (const br of [kind === 'tree' && ref ? ref : null, 'main', 'master'].filter(Boolean)) {
          const hits = [];
          for (const nm of KNOWN) {
            const u = rawUrl(o, repo, br, (prefix ? prefix + '/' : '') + nm);
            if (await exists(u)) hits.push({ name: nm, url: u });
          }
          if (hits.length) { files.push(...hits); break; }
        }
      }
    }
  }
  const uniq = [...new Map(files.map(f => [f.url, f])).values()].slice(0, 8);
  if (!uniq.length) { reply('❌ Không thấy file Viet*.txt nào trong link này.'); return; }

  // Cách đọc từ giống doan_tu.py: NFC, thường, bỏ dòng trống / có số, gộp dấu cách + gạch nối
  const parse = text => {
    const set = new Set();
    for (const line of text.split(/\r?\n/)) {
      const w = line.normalize('NFC').trim().toLowerCase();
      if (!w || /\d/.test(w)) continue;
      set.add(w.replace(/[\s\-]+/g, ' '));
    }
    return [...set];
  };
  const loaded = await Promise.all(uniq.map(async f => ({ name: f.name, words: parse(await getText(f.url)) })));
  loaded.sort((a, b) => a.words.length - b.words.length);   // file nhỏ = từ thông dụng hơn -> ưu tiên khi đoán

  const seen = new Set(), all = [], bounds = [], info = [];
  for (const f of loaded) {
    let added = 0;
    for (const w of f.words) if (!seen.has(w)) { seen.add(w); all.push(w); added++; }
    bounds.push(all.length);
    info.push({ name: f.name, words: f.words.length, added });
  }
  const C = zlib.constants;
  const br = zlib.brotliCompressSync(Buffer.from(all.join('\n'), 'utf8'), { params: { [C.BROTLI_PARAM_QUALITY]: 11 } }).toString('base64');
  if (br.length > 450000) { reply('❌ Dữ liệu sau nén quá lớn (' + Math.round(br.length / 1024) + ' KB), vượt giới hạn output của bot (512 KB).'); return; }

  shared.vtv_dict = { v: 1, src: urls.join(' '), at: ctx.now, total: all.length, bounds, files: info, br };
  print('Đã nạp ' + all.length + ' từ, nén ' + Math.round(br.length / 1024) + ' KB');
  reply('✅ Đã nạp **' + all.length.toLocaleString('en-US') + '** từ vào data.json (~' + Math.round(br.length / 1024) + ' KB nén).\n' +
    info.map(f => '• ' + f.name + ': ' + f.words + ' từ (mới ' + f.added + ')').join('\n'));
} catch (e) {
  reply('❌ Nạp từ điển lỗi: ' + (e && e.message ? e.message : e));
}` },
  { id: 'vua_tv', name: 'Vua Tiếng Việt - tự đoán từ', language: 'javascript', trigger: String.raw`Từ\s*cần\s*đoán`, matchType: 'regex', cooldown: 0, replyMode: 'send', timeoutMs: 8000, fromIds: '1248205177589334026',
    code: String.raw`// SCRIPT 2 - VUA TIẾNG VIỆT (tự đoán): đọc tin của bot game, giải từ xáo chữ theo logic doan_tu.py rồi gửi đáp án vào kênh.
// Chỉ nhận tin từ ID đã khai ở ô "Chỉ nhận tin từ ID" (cho phép cả bot). Cần nạp từ điển bằng Script 1 trước.
// Mẫu tin: "Từ cần đoán: c/ò/n/l/n/h/h/ạ/g (gồm 9 ký tự)."
const zlib = require('zlib');
const MAX_SEND = 1;   // số đáp án gửi (xếp theo độ thông dụng). Nếu có nhiều từ cùng khớp, tăng lên 2-3 để thử thêm.

const lines = String(ctx.content || '').normalize('NFC').split('\n');
const li = lines.findIndex(l => /từ\s*cần\s*đoán/i.test(l));
if (li < 0) return;
const isL = c => /\p{L}/u.test(c);
const take = l => l.replace(/^.*?từ\s*cần\s*đoán\s*[*_\x60~]*\s*[:：]?/i, '').split(/\(\s*gồm/i)[0];
let chars = [...take(lines[li]).toLowerCase()].filter(isL);
if (!chars.length && lines[li + 1]) chars = [...lines[li + 1].split(/\(\s*gồm/i)[0].toLowerCase()].filter(isL);
const declared = +((lines[li].match(/gồm\s*(\d+)/i) || [])[1] || 0);
if (!chars.length) { print('Không đọc được ký tự từ tin nhắn.'); return; }
if (declared && declared !== chars.length) print('Cảnh báo: đề ghi ' + declared + ' ký tự nhưng đọc được ' + chars.length);

const D = shared.vtv_dict;
if (!D || !D.br) { print('Chưa có từ điển. Admin hãy gửi link git chứa Viet*.txt cho bot (Script 1).'); return; }
const words = zlib.brotliDecompressSync(Buffer.from(D.br, 'base64')).toString('utf8').split('\n');
const tierOf = i => { let t = 0; while (t < D.bounds.length - 1 && i >= D.bounds[t]) t++; return t; };

const lettersOf = w => [...w].filter(isL);
const strip = s => s.replace(/đ/g, 'd').replace(/Đ/g, 'D').normalize('NFD').replace(/\p{Mn}/gu, '').normalize('NFC');
const n = chars.length;
const key = chars.slice().sort().join('');
const lkey = [...strip(chars.join(''))].sort().join('');

// 1) khớp đúng dấu  2) khớp bỏ dấu  3) gợi ý thiếu 1 ký tự (chỉ ghi log, không gửi)
const exact = [], loose = [], near = [];
const have = {}; for (const c of chars) have[c] = (have[c] || 0) + 1;
words.forEach((w, i) => {
  const ls = lettersOf(w);
  if (ls.length === n) {
    if (ls.slice().sort().join('') === key) exact.push([tierOf(i), w]);
    else if ([...strip(ls.join(''))].sort().join('') === lkey) loose.push([tierOf(i), w]);
  } else if (ls.length === n - 1) {
    const cnt = {}; for (const c of ls) cnt[c] = (cnt[c] || 0) + 1;
    if (Object.keys(cnt).every(c => (have[c] || 0) >= cnt[c])) near.push([tierOf(i), w]);
  }
});
const rank = a => a.sort((x, y) => x[0] - y[0] || (x[1] < y[1] ? -1 : x[1] > y[1] ? 1 : 0)).map(x => x[1]);

let mode = 'khớp đúng dấu', res = rank(exact);
if (!res.length) { mode = 'khớp khi bỏ dấu'; res = rank(loose); }
if (!res.length) {
  print('Ký tự (' + n + '): ' + chars.join('/') + ' -> không có từ khớp đủ. Gợi ý thiếu 1 ký tự: ' + rank(near).slice(0, 10).join(' | '));
  return;
}
print('Ký tự (' + n + '): ' + chars.join('/') + ' -> ' + mode + ' ' + res.length + ' từ: ' + res.slice(0, 10).join(' | '));
res.slice(0, MAX_SEND).forEach(w => reply(w));` }
];

const merge = (def, cur) => {
  if (!isObj(def) || !isObj(cur)) return cur === undefined ? def : cur;
  const o = { ...cur };
  for (const k of Object.keys(def)) o[k] = merge(def[k], cur[k]);
  return o;
};

function seedScripts() {
  return TEMPLATES.filter(t => ['nap_tu_dien', 'vua_tv', 'taixiu', 'noitu'].includes(t.id)).sort((a, b) => ['nap_tu_dien', 'vua_tv', 'taixiu', 'noitu'].indexOf(a.id) - ['nap_tu_dien', 'vua_tv', 'taixiu', 'noitu'].indexOf(b.id)).map(t => cleanScript({ ...t, enabled: true }));
}

function cleanScript(s = {}) {
  return {
    id: String(s.id || '').replace(/[^\w-]/g, '').slice(0, 40) || newId(),
    name: String(s.name || 'Script mới').slice(0, 80),
    enabled: s.enabled !== false,
    language: RUNTIMES[s.language] ? s.language : 'javascript',
    trigger: String(s.trigger || ''),
    matchType: ['contains', 'exact', 'startsWith', 'regex'].includes(s.matchType) ? s.matchType : 'startsWith',
    replyMode: s.replyMode === 'send' ? 'send' : 'reply',
    cooldown: clampNum(s.cooldown, 0, 3600),
    deleteAfter: clampNum(s.deleteAfter, 0, 86400),
    channels: String(s.channels || ''),
    fromIds: String(s.fromIds || ''),
    timeoutMs: clampNum(s.timeoutMs || 5000, 500, 15000),
    code: String(s.code || '').slice(0, 100000)
  };
}

function normalize(raw) {
  const d = { ...raw };
  d.commands = Array.isArray(d.commands) ? d.commands : [];
  d.tags = Array.isArray(d.tags) ? d.tags : [];
  d.settings = isObj(d.settings) ? d.settings : {};
  d.settings.hierarchy = merge(defaultHierarchy(), d.settings.hierarchy || {});
  d.scriptData = isObj(d.scriptData) ? d.scriptData : {};
  if (!isObj(d.scriptData.shared)) d.scriptData.shared = {};
  if (!isObj(d.scriptData.byScript)) d.scriptData.byScript = {};
  if (!isObj(d.roles)) d.roles = {};
  if (!isObj(d.channels)) d.channels = {};
  if (!isObj(d.members)) d.members = {};
  if (!Array.isArray(d.timers)) d.timers = [];
  // Chuyển dữ liệu cũ: "minutes" (phút) -> "seconds" (giây)
  const fix = a => {
    if (!isObj(a)) return;
    if (a.seconds == null && a.minutes != null) a.seconds = Math.round((+a.minutes || 0) * 60);
    delete a.minutes;
    if (a.seconds == null) a.seconds = 60;
    if (a.delay == null) a.delay = 0;
  };
  d.commands.forEach(c => { fix(c.defaultAction); (c.rules || []).forEach(r => fix(r.action)); });
  d.scripts = Array.isArray(d.scripts) ? d.scripts.map(cleanScript) : seedScripts();
  d.tutien = tutien.normalize(d.tutien);   // cảnh giới / chỉ số / khả năng / lệnh / menu / người chơi tu tiên
  return d;
}

const load = () => { try { return normalize(JSON.parse(fs.readFileSync(DB, 'utf8'))); } catch { return normalize({}); } };
let db = load();

// Ghi nguyên tử (ghi file tạm rồi đổi tên) để file không bao giờ bị ghi dở -> an toàn cho bước đồng bộ lên git
function saveNow() {
  clearTimeout(saveNow.t); saveNow.t = null;
  const tmp = DB + '.tmp', txt = JSON.stringify(db, null, 2);
  try { fs.writeFileSync(tmp, txt); fs.renameSync(tmp, DB); }
  catch { try { fs.writeFileSync(DB, txt); } catch (e) { log('error', 'Không ghi được data.json: ' + e.message); } }
}
const saveSoon = () => { if (!saveNow.t) saveNow.t = setTimeout(saveNow, 400); };
saveNow(); // ghi lại ngay sau khi chuyển đổi dữ liệu cũ

// ====================== BOT ======================
// MEMBERS_INTENT=true (trong .env) + bật SERVER MEMBERS INTENT ở Developer Portal -> bot lấy được TOÀN BỘ thành viên cho danh sách chọn.
// Nếu không bật, danh sách thành viên gồm những người đã từng nhắn tin khi bot online.
const WANT_MEMBERS = /^(1|true|yes)$/i.test(process.env.MEMBERS_INTENT || '');
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, ...(WANT_MEMBERS ? [GatewayIntentBits.GuildMembers] : [])] });
client.on('error', e => log('error', 'Discord client: ' + e.message));
client.on('warn', w => log('system', 'Cảnh báo: ' + w));

const chName = msg => msg.channel?.name || (msg.guild ? String(msg.channelId) : 'DM');

const matchText = (c, text) => {
  const t = text.trim().toLowerCase(), k = (c.trigger || '').trim().toLowerCase();
  if (!k) return false;
  if (c.matchType === 'exact') return t === k;
  if (c.matchType === 'startsWith') return t.startsWith(k);
  if (c.matchType === 'regex') { try { return new RegExp(c.trigger, 'i').test(text); } catch { return false; } }
  return t.includes(k);
};

const checkCond = (cd, msg) => {
  const vals = String(cd.value || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  const roles = msg.member ? [...msg.member.roles.cache.values()] : [];
  let list = [];
  switch (cd.type) {
    case 'userId': list = [msg.author.id]; break;
    case 'username': list = [msg.author.username.toLowerCase()]; break;
    case 'roleId': list = roles.map(r => r.id); break;
    case 'roleName': list = roles.map(r => r.name.toLowerCase()); break;
    case 'mentionId': list = [...msg.mentions.users.keys()]; break;
    case 'channelId': list = [msg.channel.id]; break;
    case 'guildId': list = [msg.guild?.id || '']; break;
    case 'tienRealmMin': list = tutien.reachedList(msg.author.id); break;   // cảnh giới Tu Tiên đã đạt (số thứ tự hoặc id) — đạt >= giá trị

  }
  const hit = vals.some(v => list.includes(v));
  return cd.op === 'not' ? !hit : hit;
};

const render = (text, msg, extra = {}) => {
  const roles = msg.member ? [...msg.member.roles.cache.values()].filter(r => r.name !== '@everyone').map(r => r.name).join(', ') : '';
  const base = {
    user: `<@${msg.author.id}>`, userId: msg.author.id, username: msg.author.username,
    server: msg.guild?.name || '', channel: `<#${msg.channel.id}>`, roles, ...extra
  };
  return String(text).replace(/\{([^{}]+)\}/g, (m, k) => {
    if (k in base) return base[k];
    const tag = db.tags.find(t => t.name === k);
    return tag ? tagText(tag) : m;
  });
};
function tagText(tag) {
  if (tag.type === 'link') return `[${tag.label || tag.value}](${tag.hide ? '<' + tag.value + '>' : tag.value})`;
  return tag.type === 'mention' ? `<@${tag.value}>` : tag.value;
}
const renderTags = text => String(text).replace(/\{([^{}]+)\}/g, (m, k) => { const tag = db.tags.find(t => t.name === k); return tag ? tagText(tag) : m; });

// Gửi tin (có ghi log, có tự xóa sau X giây)
async function say(msg, text, { mode = 'reply', deleteAfter = 0 } = {}) {
  const content = String(text ?? '').slice(0, 2000);
  if (!content.trim()) return;
  const opts = { content, allowedMentions: { parse: ['users'], repliedUser: true } };
  try {
    const sent = mode === 'send' ? await msg.channel.send(opts) : await msg.reply(opts);
    log('bot', content, { channel: chName(msg), channelId: msg.channelId, guild: msg.guild?.name });
    if (deleteAfter > 0) setTimeout(() => sent.delete().catch(() => {}), deleteAfter * 1000);
    return sent;
  } catch (e) { log('error', 'Gửi tin lỗi: ' + e.message, { channel: chName(msg) }); }
}

// ====================== QUÉT ROLE + PHÂN CẤP ======================
async function scanGuild(guild) {
  try {
    const roles = await guild.roles.fetch();
    const me = guild.members.me || await guild.members.fetchMe();
    const list = [...roles.values()].sort((a, b) => b.position - a.position).map(r => ({
      id: r.id, name: r.name, position: r.position, color: r.hexColor, managed: r.managed,
      perms: {
        administrator: r.permissions.has('Administrator'), moderate: r.permissions.has('ModerateMembers'),
        kick: r.permissions.has('KickMembers'), ban: r.permissions.has('BanMembers'), manageRoles: r.permissions.has('ManageRoles')
      }
    }));
    db.roles[guild.id] = {
      name: guild.name, ownerId: guild.ownerId, botRoleId: me.roles.highest.id, botRoleName: me.roles.highest.name,
      botPosition: me.roles.highest.position, scannedAt: Date.now(), roles: list
    };
    // kênh chat (để chọn trong web và để nhắn bằng bot)
    const chs = await guild.channels.fetch();
    db.channels[guild.id] = {
      name: guild.name,
      channels: [...chs.values()].filter(c => c && [0, 5].includes(c.type) && c.viewable)
        .sort((a, b) => (a.rawPosition ?? 0) - (b.rawPosition ?? 0))
        .map(c => ({ id: c.id, name: c.name, parent: c.parent?.name || '' }))
    };
    // thành viên: lấy toàn bộ nếu có MEMBERS_INTENT, không thì giữ danh sách "đã từng nhắn"
    if (WANT_MEMBERS) {
      try {
        const all = await guild.members.fetch();
        const g = db.members[guild.id] = db.members[guild.id] || {};
        for (const m of all.values()) g[m.id] = { username: m.user.username, display: m.displayName, role: m.roles.highest.name, bot: m.user.bot, t: g[m.id]?.t || 0 };
      } catch (e) { log('error', `Không lấy được danh sách thành viên (đã bật SERVER MEMBERS INTENT ở Developer Portal chưa?): ${e.message}`); }
    }
    saveSoon();
    log('system', `Quét role "${guild.name}": ${list.length} role. Role cao nhất của bot: ${me.roles.highest.name} (vị trí ${me.roles.highest.position}). ` +
      `Thứ tự cao→thấp: ${list.slice(0, 12).map(r => `${r.name}#${r.position}`).join(' > ')}${list.length > 12 ? ' ...' : ''}`);
  } catch (e) { log('error', `Quét role "${guild.name}" lỗi: ${e.message}`); }
}
const scanAll = () => Promise.all([...client.guilds.cache.values()].map(scanGuild));
const scanLater = guild => { clearTimeout(scanLater[guild.id]); scanLater[guild.id] = setTimeout(() => scanGuild(guild), 3000); };
client.on('guildCreate', scanGuild);

// Ghi nhớ người đã nhắn tin -> hiện trong danh sách chọn ở web
function rememberMember(msg) {
  if (!msg.guild) return;
  const g = db.members[msg.guild.id] = db.members[msg.guild.id] || {};
  const m = msg.member, now = Date.now();
  const rec = { username: msg.author.username, display: m?.displayName || msg.author.globalName || msg.author.username, role: m ? m.roles.highest.name : '', bot: !!msg.author.bot, t: now };
  const o = g[msg.author.id];
  if (o && o.username === rec.username && o.display === rec.display && o.role === rec.role && now - (o.t || 0) < 600000) return;
  g[msg.author.id] = rec;
  const ids = Object.keys(g);
  if (ids.length > 3000) ids.sort((a, b) => (g[a].t || 0) - (g[b].t || 0)).slice(0, ids.length - 3000).forEach(k => delete g[k]);
  saveSoon();
}
['roleCreate', 'roleUpdate', 'roleDelete'].forEach(ev => client.on(ev, (a, b) => scanLater((b || a).guild)));

const rankOf = (guild, m) => guild.ownerId === m.id ? Infinity : m.roles.highest.position;
const compareRank = (guild, actor, target) => {
  const a = rankOf(guild, actor), t = rankOf(guild, target);
  return a > t ? 'higher' : a === t ? 'equal' : 'lower';
};
const roleNameOf = (guild, m) => guild.ownerId === m.id ? 'Chủ server' : m.roles.highest.name;
const OUT_VN = { higher: 'cao cấp hơn', equal: 'bằng cấp với', lower: 'thấp cấp hơn' };
const LABEL = { mute: 'mute', unmute: 'bỏ mute', kick: 'kick', ban: 'ban', unban: 'unban', addRole: 'thêm role cho', removeRole: 'gỡ role của' };
const POLICY_OF = { mute: 'mute', unmute: 'mute', kick: 'kick', ban: 'ban' };
// Quyền Discord mà NGƯỜI GÕ phải có khi tác động lên người khác
const PERM_OF = {
  mute: ['ModerateMembers', 'Timeout thành viên'], unmute: ['ModerateMembers', 'Timeout thành viên'],
  kick: ['KickMembers', 'Kick thành viên'], ban: ['BanMembers', 'Ban thành viên'], unban: ['BanMembers', 'Ban thành viên'],
  addRole: ['ManageRoles', 'Quản lý vai trò'], removeRole: ['ManageRoles', 'Quản lý vai trò']
};

// ====================== HÀNH ĐỘNG: mute / kick / ban tính theo GIÂY ======================
async function runAction(a, msg) {
  if (!a || !a.type || a.type === 'none') return;
  const delay = clampNum(a.delay, 0, 3600);
  if (delay > 0) {
    log('action', `Hẹn ${LABEL[a.type] || a.type} sau ${fmtDur(delay)}`, { user: msg.author.username });
    setTimeout(() => execAction(a, msg).catch(e => log('error', 'Hành động hẹn giờ lỗi: ' + e.message)), delay * 1000);
    return;
  }
  return execAction(a, msg);
}

async function execAction(a, msg) {
  if (a.type === 'deleteMsg') {
    return msg.delete().then(() => log('action', 'Xóa tin nhắn', { user: msg.author.username })).catch(e => log('error', 'Xóa tin lỗi: ' + e.message));
  }
  const guild = msg.guild; if (!guild) return;
  const uid = a.target === 'mention' ? msg.mentions.users.first()?.id : a.target === 'id' ? idFrom(a.targetId) : msg.author.id;
  if (!uid) return log('error', `Hành động ${a.type}: không xác định được đối tượng`, { user: msg.author.username });

  const label = LABEL[a.type] || a.type;
  const seconds = Math.max(Math.floor(+a.seconds || 0), 0);
  const reason = render(a.reason || 'Bot tự động', msg);
  const selfTarget = uid === msg.author.id;
  const H = db.settings.hierarchy;
  const needMember = ['mute', 'unmute', 'kick', 'ban', 'addRole', 'removeRole'].includes(a.type);
  const member = needMember ? await guild.members.fetch(uid).catch(() => null) : null;

  if (needMember && !member && a.type !== 'ban') return log('error', `Không tìm thấy thành viên ${uid} trong server để ${label}`, { user: msg.author.username });

  // 0) Người gõ có QUYỀN (role) để làm việc này lên người khác không? (Admin / chủ server luôn được)
  const RP = H.requirePerm, need = PERM_OF[a.type];
  if (need && !selfTarget && !a.trusted && RP && RP.enabled) {
    const actor0 = msg.member || await guild.members.fetch(msg.author.id).catch(() => null);
    const has = guild.ownerId === msg.author.id || (actor0 && (actor0.permissions.has('Administrator') || actor0.permissions.has(need[0])));
    if (!has) {
      log('action', `CHẶN ${label}: người gõ không có quyền ${need[1]}`, { user: msg.author.username });
      if (RP.reply) await say(msg, render(RP.reply, msg, { target: `<@${uid}>`, action: label, perm: need[1] }), { mode: 'send', deleteAfter: RP.deleteAfter });
      return;
    }
  }

  // 1) So sánh cấp bậc: người gõ lệnh vs đối tượng (bỏ qua khi đối tượng chính là người gõ)
  const pol = POLICY_OF[a.type];
  if (member && pol && !selfTarget && !a.trusted && H.enabled) {
    const actor = msg.member || await guild.members.fetch(msg.author.id).catch(() => null);
    if (actor) {
      const res = compareRank(guild, actor, member), o = H[pol][res];
      const vars = {
        target: `<@${uid}>`, targetName: member.displayName, action: label, seconds, duration: fmtDur(seconds),
        actorRole: roleNameOf(guild, actor), targetRole: roleNameOf(guild, member)
      };
      log('action', `Phân cấp: ${actor.displayName} [${vars.actorRole}] ${OUT_VN[res]} ${member.displayName} [${vars.targetRole}] → ${o.allow ? 'CHO PHÉP' : 'CHẶN'} ${label}`, { user: msg.author.username });
      if (o.reply) await say(msg, render(o.reply, msg, vars), { mode: 'send', deleteAfter: o.deleteAfter });
      if (o.punish && o.punish.type && o.punish.type !== 'none') {
        await execAction({ type: o.punish.type, target: 'sender', seconds: o.punish.seconds, reason: 'Vi phạm phân cấp role' }, msg);
      }
      if (!o.allow) return;
    }
  }

  // 2) Bot có đủ quyền / đủ cấp để làm không?
  if (member && pol) {
    const ok = a.type === 'kick' ? member.kickable : a.type === 'ban' ? member.bannable : member.moderatable;
    if (!ok) {
      const vars = { target: `<@${uid}>`, targetName: member.displayName, action: label };
      log('error', `Bot không thể ${label} ${member.displayName} (role bot thấp hơn/bằng, Admin/chủ server, hoặc thiếu quyền)`, { user: msg.author.username });
      if (H.botCannot?.reply) await say(msg, render(H.botCannot.reply, msg, vars), { mode: 'send', deleteAfter: H.botCannot.deleteAfter });
      return;
    }
  }

  // 3) Thực hiện
  try {
    if (a.type === 'mute') {
      const s = clampNum(seconds || 60, 1, 2419200); // Discord tối đa 28 ngày
      await member.timeout(s * 1000, reason);
      log('action', `MUTE ${member.displayName} trong ${fmtDur(s)}`, { user: msg.author.username });
    } else if (a.type === 'unmute') {
      await member.timeout(null, reason); log('action', `BỎ MUTE ${member.displayName}`, { user: msg.author.username });
    } else if (a.type === 'kick') {
      await member.kick(reason); log('action', `KICK ${member.displayName}`, { user: msg.author.username });
    } else if (a.type === 'ban') {
      await guild.members.ban(uid, { reason });
      if (seconds > 0) { db.timers.push({ id: newId(), type: 'unban', guildId: guild.id, userId: uid, at: Date.now() + seconds * 1000 }); saveSoon(); }
      log('action', `BAN ${member ? member.displayName : uid} ${seconds > 0 ? 'trong ' + fmtDur(seconds) : 'vĩnh viễn'}`, { user: msg.author.username });
    } else if (a.type === 'unban') {
      await guild.members.unban(uid, reason); log('action', `UNBAN ${uid}`, { user: msg.author.username });
    } else if (a.type === 'addRole') {
      await member.roles.add(String(a.roleId).trim(), reason); log('action', `Thêm role ${a.roleId} cho ${member.displayName}`, { user: msg.author.username });
    } else if (a.type === 'removeRole') {
      await member.roles.remove(String(a.roleId).trim(), reason); log('action', `Gỡ role ${a.roleId} của ${member.displayName}`, { user: msg.author.username });
    }
  } catch (e) { log('error', `Lỗi hành động ${a.type}: ${e.message}`, { user: msg.author.username }); }
}

// Ban có thời hạn: lưu hẹn giờ trong data.json nên vẫn đúng giờ dù bot khởi động lại giữa chừng
async function processTimers() {
  if (!client.isReady()) return;
  const due = db.timers.filter(t => t.at <= Date.now());
  for (const t of due) {
    try {
      const g = client.guilds.cache.get(t.guildId) || await client.guilds.fetch(t.guildId);
      await g.members.unban(t.userId, 'Hết thời hạn ban');
      log('action', `Tự động UNBAN ${t.userId} (hết hạn)`);
      db.timers = db.timers.filter(x => x.id !== t.id);
    } catch (e) {
      t.tries = (t.tries || 0) + 1;
      if (e.code === 10026 || t.tries >= 5) { db.timers = db.timers.filter(x => x.id !== t.id); log('error', `Bỏ hẹn unban ${t.userId}: ${e.message}`); }
    }
  }
  if (due.length) saveSoon();
}

// ====================== SCRIPT (Python / JavaScript) ======================
let chain = Promise.resolve();
const enqueue = fn => { const p = chain.then(fn); chain = p.catch(() => {}); return p; }; // chạy lần lượt -> dữ liệu dùng chung không bị ghi đè lẫn nhau
const cdMap = new Map();

function parseArgs(s, text) {
  const t = text.trim(), k = (s.trigger || '').trim();
  let rest = '', match = [];
  if (s.matchType === 'regex') { try { const m = new RegExp(s.trigger, 'i').exec(text); if (m) match = [...m].map(x => x ?? ''); } catch {} rest = t; }
  else if (s.matchType === 'startsWith') rest = t.slice(k.length).trim();
  else if (s.matchType === 'contains') { const i = t.toLowerCase().indexOf(k.toLowerCase()); rest = i < 0 ? t : (t.slice(0, i) + ' ' + t.slice(i + k.length)).trim(); }
  return { rest, args: rest ? rest.split(/\s+/) : [], match };
}

// Nội dung để khớp lệnh: tin của người = content; tin của bot = content + chữ trong embed (bot game thường gửi embed)
const textOf = msg => !msg.author.bot ? (msg.content || '') : [msg.content, ...(msg.embeds || []).flatMap(e => [e.title, e.description, ...(e.fields || []).flatMap(f => [f.name, f.value]), e.footer?.text])]
  .filter(Boolean).join('\n').normalize('NFC');

function buildCtx(msg, pa, text = msg.content) {
  const m = msg.member;
  const roles = m ? [...m.roles.cache.values()].filter(r => r.name !== '@everyone') : [];
  return {
    content: text, rest: pa.rest, args: pa.args, match: pa.match, event: 'message',
    user: {
      id: msg.author.id, username: msg.author.username, display: m?.displayName || msg.author.username, mention: `<@${msg.author.id}>`,
      roles: roles.map(r => r.name), roleIds: roles.map(r => r.id),
      isAdmin: !!m?.permissions.has('Administrator'), isOwner: msg.guild?.ownerId === msg.author.id
    },
    mentions: [...msg.mentions.users.values()].map(u => ({ id: u.id, username: u.username, mention: `<@${u.id}>`, bot: !!u.bot })),
    tutien: tutien.brief(msg.author.id),     // dữ liệu Tu Tiên của người gõ (null nếu chưa chơi)
    channelId: msg.channel.id, guildId: msg.guild?.id || '', guildName: msg.guild?.name || '', messageId: msg.id, now: Date.now()
  };
}

async function handleScripts(msg) {
  const text = textOf(msg);
  for (const s of db.scripts) {
    const from = String(s.fromIds || '').split(',').map(x => idFrom(x)).filter(Boolean);
    if (from.length ? !from.includes(msg.author.id) : msg.author.bot) continue;   // có fromIds: chỉ nhận tin từ các ID đó (kể cả bot); không có: bỏ qua bot
    if (s.enabled === false || !s.code || !s.trigger || !matchText(s, text)) continue;
    const allow = String(s.channels || '').split(',').map(x => x.trim()).filter(Boolean);
    if (allow.length && !allow.includes(msg.channel.id)) continue;
    const key = s.id + ':' + msg.author.id, last = cdMap.get(key) || 0;
    if (s.cooldown > 0 && Date.now() - last < s.cooldown * 1000) { msg.react('⏳').catch(() => {}); return true; }
    cdMap.set(key, Date.now());
    log('cmd', `Script "${s.name}" (${s.language}) khớp "${text.slice(0, 80)}"`, { user: msg.author.username, channel: chName(msg) });
    enqueue(() => execScript(s, msg, text)).catch(e => log('error', `Script "${s.name}": ${e.message}`));
    return true;
  }
  return false;
}

async function execScript(s, msg, text = msg.content) {
  const pa = parseArgs(s, text);
  const ctx = buildCtx(msg, pa, text);
  const r = await runScript(s.language, s.code, { ctx, store: clone(db.scriptData.byScript[s.id]), shared: clone(db.scriptData.shared) }, s.timeoutMs);
  if (!r.ok) {
    log('error', `Script "${s.name}" lỗi (${r.ms}ms):\n${r.error}`, { user: msg.author.username, channel: chName(msg) });
    msg.react('⚠️').catch(() => {});
    return;
  }
  db.scriptData.byScript[s.id] = r.store || {};
  db.scriptData.shared = r.shared || {};
  saveSoon();
  log('script', `"${s.name}" chạy xong ${r.ms}ms` + (r.stdout && r.stdout.trim() ? '\nprint: ' + r.stdout.trim().slice(0, 600) : ''), { user: msg.author.username, channel: chName(msg) });
  await applyScriptOutput(s, msg, r.out || {});
  if ((r.out?.ui || []).length) await applyUi(s, r.out.ui, { channel: msg.channel, channelId: msg.channel.id, guildId: msg.guild?.id || '', msgId: msg.id });
}

async function applyScriptOutput(s, msg, out) {
  const mode = s.replyMode === 'send' ? 'send' : 'reply';
  const texts = (out.replies || []).slice(0, 5);
  for (let i = 0; i < texts.length; i++) await say(msg, render(texts[i], msg), { mode: i === 0 ? mode : 'send', deleteAfter: s.deleteAfter });
  for (const e of (out.reactions || []).slice(0, 5)) await msg.react(e).catch(() => {});
  if (out.delete) await execAction({ type: 'deleteMsg' }, msg);
  for (const a of (out.actions || []).slice(0, 5)) {
    const t = String(a.target || 'sender');
    const act = { type: a.type, seconds: a.seconds, delay: a.delay, reason: a.reason, roleId: a.roleId, target: 'sender' };
    if (t === 'mention') act.target = 'mention';
    else if (t !== 'sender') { act.target = 'id'; act.targetId = t; }
    await runAction(act, msg);
  }
}


// ====================== NÚT BẤM / SỬA TIN / HẸN GIỜ CHO SCRIPT (ui.*) ======================
// customId nút = sx:<idScript>:<e|u>:<dữ liệu>   e = mở tin trả lời ẨN (ephemeral), u = cập nhật tin chứa nút
const uiMsgs = new Map(), uiEphem = new Map();      // tag -> tin đã gửi / tin ẩn (RAM)
const remember = (m, k, v, max = 800) => { m.delete(k); m.set(k, v); if (m.size > max) m.delete(m.keys().next().value); };
const BTN_STYLE = { primary: ButtonStyle.Primary, secondary: ButtonStyle.Secondary, success: ButtonStyle.Success, danger: ButtonStyle.Danger };
let pendingTimers = 0;

function uiPayload(s, p) {
  if (typeof p === 'string') p = { content: p };
  p = isObj(p) ? p : {};
  const o = { allowedMentions: { parse: [], users: (Array.isArray(p.mentions) ? p.mentions : []).map(idFrom).filter(Boolean).slice(0, 10) } };
  if (p.content != null) o.content = String(p.content).slice(0, 2000);
  if (Array.isArray(p.buttons)) {
    o.components = p.buttons.slice(0, 5).map(row => new ActionRowBuilder().addComponents((Array.isArray(row) ? row : [row]).slice(0, 5).map(b => {
      const bb = new ButtonBuilder().setLabel(String(b.label || '·').slice(0, 80)).setStyle(BTN_STYLE[b.style] || ButtonStyle.Secondary)
        .setCustomId(`sx:${s.id}:${b.ephemeral ? 'e' : 'u'}:${String(b.id || 'x')}`.slice(0, 100));
      if (b.disabled) bb.setDisabled(true);
      return bb;
    }))).filter(r => r.components.length);
  }
  return o;
}

async function applyUi(s, ops, t) {
  let used = false;   // đã dùng lượt phản hồi đầu của interaction chưa
  for (const op of (ops || []).slice(0, 20)) {
    try {
      const p = op.payload;
      if (op.type === 'send') {
        if (!t.channel) continue;
        const m = await t.channel.send(uiPayload(s, p));
        if (op.tag) remember(uiMsgs, String(op.tag), { channelId: t.channel.id, id: m.id });
      } else if ((op.type === 'update' || op.type === 'reply') && t.inter) {
        if (!used && (op.type === 'update' || t.kind === 'e')) {
          await t.inter.editReply(uiPayload(s, p)); used = true;
          if (op.tag) remember(uiEphem, String(op.tag), { inter: t.inter, id: '@original' });
        } else if (op.type === 'reply') {
          const o = uiPayload(s, p);
          if (!(isObj(p) && p.ephemeral === false)) o.flags = MessageFlags.Ephemeral;
          const m = await t.inter.followUp(o);
          if (op.tag) remember(uiEphem, String(op.tag), { inter: t.inter, id: m.id });
        }
      } else if (op.type === 'edit') {
        const e = uiEphem.get(String(op.tag));
        if (e) await e.inter.webhook.editMessage(e.id, uiPayload(s, p));
        else {
          const r = uiMsgs.get(String(op.tag));
          if (r) { const ch = await client.channels.fetch(r.channelId); const m = await ch.messages.fetch(r.id); await m.edit(uiPayload(s, p)); }
        }
      } else if (op.type === 'after') {
        if (pendingTimers >= 300) continue;
        pendingTimers++;
        const sec = clampNum(op.seconds, 1, 600), data = String(op.data ?? ''), channelId = t.channelId, guildId = t.guildId, msgId = t.msgId;
        setTimeout(() => {
          pendingTimers--;
          enqueue(() => runUi(s.id, { event: 'timer', data, channelId, guildId, msgId })).catch(e => log('error', `Hẹn giờ script "${s.name}": ${e.message}`));
        }, sec * 1000);
      }
    } catch (e) { log('error', `ui.${op.type} của "${s.name}": ${e.message}`); }
  }
  if (t.inter && t.kind === 'e' && !used) t.inter.deleteReply().catch(() => {});   // tin ẩn chờ mà script không trả gì -> xóa
}

function uiCtx(ev) {
  const i = ev.inter, m = i?.member, u = i?.user;
  const roles = m?.roles?.cache ? [...m.roles.cache.values()].filter(r => r.name !== '@everyone') : [];
  return {
    content: '', rest: '', args: [], match: [], event: ev.event,
    user: {
      id: u?.id || '', username: u?.username || '', display: m?.displayName || u?.username || '', mention: u ? `<@${u.id}>` : '',
      roles: roles.map(r => r.name), roleIds: roles.map(r => r.id),
      isAdmin: !!m?.permissions?.has?.('Administrator'), isOwner: !!u && i?.guild?.ownerId === u.id
    },
    mentions: [], tutien: u ? tutien.brief(u.id) : null, channelId: ev.channelId || '', guildId: ev.guildId || '', guildName: i?.guild?.name || '', messageId: i?.message?.id || '', now: Date.now(),
    interaction: i ? { customId: ev.data, kind: ev.kind, messageId: i.message?.id || '', userId: u.id } : null,
    timer: ev.event === 'timer' ? { data: ev.data } : null
  };
}

// Chạy script cho sự kiện nút bấm / hẹn giờ (cùng hàng đợi với tin nhắn nên dữ liệu không bị ghi đè)
async function runUi(sid, ev) {
  const s = db.scripts.find(x => x.id === sid);
  if (!s || s.enabled === false || !s.code) return;
  const r = await runScript(s.language, s.code, { ctx: uiCtx(ev), store: clone(db.scriptData.byScript[s.id]), shared: clone(db.scriptData.shared) }, s.timeoutMs);
  const who = ev.inter?.user?.username || 'hẹn giờ';
  if (!r.ok) {
    log('error', `Script "${s.name}" lỗi ở ${ev.event} (${r.ms}ms):\n${r.error}`, { user: who });
    if (ev.inter) { const o = { content: '⚠️ Script bị lỗi, xem tab Log.' }; if (ev.kind === 'e') await ev.inter.editReply(o).catch(() => {}); else await ev.inter.followUp({ ...o, flags: MessageFlags.Ephemeral }).catch(() => {}); }
    return;
  }
  db.scriptData.byScript[s.id] = r.store || {};
  db.scriptData.shared = r.shared || {};
  saveSoon();
  log('script', `"${s.name}" (${ev.event}) xong ${r.ms}ms` + (r.stdout && r.stdout.trim() ? '\nprint: ' + r.stdout.trim().slice(0, 600) : ''), { user: who });
  const out = r.out || {};
  const ops = [...(out.replies || []).slice(0, 5).map(text => ({ type: ev.inter ? 'reply' : 'send', payload: { content: text } })), ...(out.ui || [])];
  let channel = ev.channel;
  if (!channel && ev.channelId) channel = await client.channels.fetch(ev.channelId).catch(() => null);
  await applyUi(s, ops, { channel, inter: ev.inter, kind: ev.kind, channelId: ev.channelId, guildId: ev.guildId });
  // Hẹn giờ: chạy hành động script yêu cầu (vd AI mute người dùng). Chỉ mute/unmute, tối đa 2, đối tượng phải là ID cụ thể.
  if (ev.event === 'timer' && ev.msgId && channel && (out.actions || []).length) {
    const origin = await channel.messages.fetch(ev.msgId).catch(() => null);
    if (origin) for (const a of out.actions.slice(0, 2)) {
      if (!['mute', 'unmute'].includes(a.type) || !/^\d{15,25}$/.test(String(a.target))) continue;
      await execAction({ type: a.type, seconds: clampNum(a.seconds, 1, 60), reason: a.reason || 'AI tự động', target: 'id', targetId: String(a.target), trusted: true }, origin)
        .catch(e => log('error', 'Hành động AI lỗi: ' + e.message));
    }
  }
}

client.on(Events.InteractionCreate, async i => {
  try {
    if (i.isButton() && String(i.customId).startsWith('tt:')) return await tutien.onButton(i);   // nút của menu Tu Tiên
    if (!i.isButton() || !String(i.customId).startsWith('sx:')) return;
    const [, sid, kind, ...rest] = i.customId.split(':'), data = rest.join(':');
    const s = db.scripts.find(x => x.id === sid);
    if (!s || s.enabled === false) { await i.reply({ content: '⚠️ Script này đã bị tắt hoặc bị xóa.', flags: MessageFlags.Ephemeral }); return; }
    if (kind === 'e') await i.deferReply({ flags: MessageFlags.Ephemeral }); else await i.deferUpdate();   // báo nhận ngay (Discord chỉ cho 3 giây)
    const channel = i.channel || await client.channels.fetch(i.channelId).catch(() => null);
    log('cmd', `Nút "${data}" của script "${s.name}"`, { user: i.user.username });
    await enqueue(() => runUi(sid, { event: 'button', inter: i, kind: kind === 'e' ? 'e' : 'u', data, channel, channelId: i.channelId, guildId: i.guildId }));
  } catch (e) { log('error', 'interaction: ' + (e.stack || e.message)); }
});

// ====================== TU TIÊN: nối vào bot ======================
tutien.init({ db: () => db, saveSoon, saveNow, log, client, runScript, runtimeInfo, matchText, enqueue, scan: scanAll });
client.on('guildMemberUpdate', (o, n) => tutien.onMemberUpdate(n));   // role đổi -> cập nhật quyền/tự động treo của người chơi tu tiên

// ====================== SỰ KIỆN ======================
function logChat(msg) {
  let t = msg.content || '';
  if (msg.attachments?.size) t += ` [+${msg.attachments.size} tệp]`;
  if (!t.trim()) { if (!msg.embeds?.length) return; t = '[embed]'; }
  log('chat', t, { user: msg.author.username + (msg.author.bot ? ' [bot]' : ''), channel: chName(msg), channelId: msg.channelId, msgId: msg.id, guild: msg.guild?.name });
}

async function handleCommands(msg) {
  for (const c of db.commands) {
    if (c.enabled === false || !matchText(c, msg.content)) continue;
    const rule = (c.rules || []).find(r => (r.conditions || []).every(cd => checkCond(cd, msg)));
    const pool = (rule ? rule.replies : c.defaultReplies || []).filter(Boolean);
    const act = rule ? rule.action : c.defaultAction;
    const hasAct = act && act.type && act.type !== 'none';
    if (!pool.length && !hasAct) continue;
    log('cmd', `Khớp lệnh "${c.trigger}" → ${rule ? 'quy tắc' : 'mặc định'}${hasAct ? ' + ' + act.type : ''}`, { user: msg.author.username, channel: chName(msg) });
    if (c.replyMode !== 'none' && pool.length) {
      const pick = (c.pick === 'first') ? pool[0] : pool[Math.floor(Math.random() * pool.length)];
      const extra = hasAct ? { seconds: +act.seconds || 0, duration: fmtDur(act.seconds) } : {};
      await say(msg, render(pick, msg, extra), { mode: c.replyMode === 'send' ? 'send' : 'reply', deleteAfter: Number((rule && rule.deleteAfter) || c.deleteAfter || 0) });
    }
    await runAction(act, msg); // mute/kick/ban... chạy sau khi đã gửi tin
    break;
  }
}

client.on('messageCreate', async msg => {
  try {
    if (msg.author.id === client.user?.id) return;
    logChat(msg);
    rememberMember(msg);
    if (msg.author.bot) { await handleScripts(msg); return; }
    if (await tutien.onMessage(msg)) return;      // lệnh Tu Tiên (lưu trong data.json > tutien.commands)
    if (await handleScripts(msg)) return;
    await handleCommands(msg);
  } catch (e) { log('error', 'messageCreate: ' + (e.stack || e.message)); }
});

client.once(Events.ClientReady, async () => {
  log('system', 'Bot online: ' + client.user.tag + ` | ${client.guilds.cache.size} server`);
  await scanAll();            // quét role ngay khi khởi động
  processTimers(); setInterval(processTimers, 10000);
});

// ====================== WEB ======================
const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));
const PW = process.env.ADMIN_PASSWORD || '';
if (!PW) log('error', 'ADMIN_PASSWORD đang trống -> không ai đăng nhập được web quản trị. Hãy đặt mật khẩu mạnh!');
app.use('/api', (req, res, next) => PW && req.headers['x-password'] === PW ? next() : res.status(401).json({ error: 'Sai mật khẩu' }));

app.get('/api/data', (req, res) => res.json({ ...db, runtimes: runtimeInfo() }));
app.put('/api/data', (req, res) => {
  const { commands, tags, scripts, settings } = req.body || {};
  if (!Array.isArray(commands) || !Array.isArray(tags)) return res.status(400).json({ error: 'Dữ liệu sai' });
  const next = { ...db, commands, tags };
  if (Array.isArray(scripts)) next.scripts = scripts;
  if (isObj(settings)) next.settings = settings;
  db = normalize(next); saveNow(); res.json({ ok: true });
});

app.get('/api/templates', (req, res) => res.json(TEMPLATES));

app.get('/api/logs', (req, res) => {
  const after = +req.query.after || 0;
  res.json({ logs: LOGS.filter(e => e.id > after), last: logSeq });
});
app.post('/api/logs/clear', (req, res) => { LOGS.length = 0; res.json({ ok: true }); });

app.post('/api/scan', async (req, res) => { await scanAll(); res.json({ roles: db.roles, channels: db.channels, members: db.members }); });

// Nhắn bằng bot từ tab Log (hỗ trợ {tên_thẻ}, <@ID> để tag, trả lời 1 tin nhắn cụ thể)
app.post('/api/send', async (req, res) => {
  try {
    const { channelId, content, replyTo } = req.body || {};
    const text = renderTags(String(content ?? '')).slice(0, 2000);
    const id = idFrom(channelId);
    if (!text.trim()) return res.status(400).json({ error: 'Chưa nhập nội dung' });
    if (!id) return res.status(400).json({ error: 'Chưa chọn kênh' });
    if (!client.isReady()) return res.status(503).json({ error: 'Bot chưa online' });
    const ch = await client.channels.fetch(id).catch(() => null);
    if (!ch || !ch.isTextBased() || typeof ch.send !== 'function') return res.status(404).json({ error: 'Không tìm thấy kênh hoặc bot không gửi được vào kênh này' });
    const opts = { content: text, allowedMentions: { parse: ['users'] } };
    const rid = idFrom(replyTo);
    if (rid) opts.reply = { messageReference: rid, failIfNotExists: false };
    await ch.send(opts);
    log('bot', text, { user: client.user.username + ' (gửi từ web)', channel: ch.name || id, channelId: ch.id, guild: ch.guild?.name });
    res.json({ ok: true });
  } catch (e) { log('error', 'Gửi tin từ web lỗi: ' + e.message); res.status(500).json({ error: e.message }); }
});

app.put('/api/store', (req, res) => {
  const { scope, value } = req.body || {};
  if (!isObj(value)) return res.status(400).json({ error: 'Dữ liệu phải là một object JSON {...}' });
  if (scope === 'shared') db.scriptData.shared = value; else db.scriptData.byScript[String(scope)] = value;
  saveNow(); res.json({ ok: true });
});

// Chạy thử script ngay trên web (không cần gõ trong Discord)
app.post('/api/script/test', async (req, res) => {
  const { script, text, persist, userId } = req.body || {};
  const s = cleanScript(script || {});
  const content = String(text || s.trigger);
  const pa = parseArgs(s, content);
  const uid = idFrom(userId) || '100000000000000001';
  const ctx = {
    content, rest: pa.rest, args: pa.args, match: pa.match,
    user: { id: uid, username: 'tester', display: 'Tester', mention: `<@${uid}>`, roles: [], roleIds: [], isAdmin: true, isOwner: false },
    mentions: [...content.matchAll(/<@!?(\d{15,25})>/g)].map(m => ({ id: m[1], username: '', mention: m[0] })),
    channelId: '100000000000000002', guildId: '100000000000000003', guildName: 'Test', messageId: '0', now: Date.now()
  };
  const r = await enqueue(() => runScript(s.language, s.code, { ctx, store: clone(db.scriptData.byScript[s.id]), shared: clone(db.scriptData.shared) }, s.timeoutMs));
  if (r.ok && persist) { db.scriptData.byScript[s.id] = r.store; db.scriptData.shared = r.shared; saveNow(); }
  res.json({ ok: r.ok, error: r.error, out: r.out, stdout: r.stdout, ms: r.ms, store: r.store, shared: r.shared, matched: matchText(s, content), persisted: !!(r.ok && persist) });
});

// ====================== KHỞI ĐỘNG ======================
if (!process.env.BOT_TEST) {
  detectRuntimes();
  log('system', 'Môi trường script: ' + Object.entries(runtimeInfo()).map(([k, v]) => `${k}=${v.ok ? v.version : 'KHÔNG CÓ'}`).join(', '));
  client.login(process.env.DISCORD_TOKEN).catch(e => log('error', 'Đăng nhập Discord thất bại: ' + e.message + (/disallowed intents/i.test(e.message) ? ' → bật MESSAGE CONTENT INTENT (và SERVER MEMBERS INTENT nếu MEMBERS_INTENT=true) ở Developer Portal > Bot.' : '')));
  app.listen(process.env.PORT || 3000, () => log('system', 'Web: http://localhost:' + (process.env.PORT || 3000)));
  // Cổng thứ 2: trang cấu hình Tu Tiên (cùng mật khẩu, cùng data.json)
  const TT_PORT = +process.env.TUTIEN_PORT || 3001;
  if (TT_PORT !== (+process.env.PORT || 3000)) tutien.createApp(PW).listen(TT_PORT, () => log('system', 'Web Tu Tiên: http://localhost:' + TT_PORT));
  else log('error', 'TUTIEN_PORT trùng PORT -> không mở được trang Tu Tiên, hãy đổi TUTIEN_PORT.');
  const bye = () => { try { saveNow(); } catch {} process.exit(0); };
  process.on('SIGINT', bye); process.on('SIGTERM', bye);
}
module.exports = { handleScripts, textOf, app, runAction, execAction, compareRank, render, normalize, parseArgs, db: () => db, setDb: d => { db = d; }, log, LOGS };
