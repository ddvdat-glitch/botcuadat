require('dotenv').config();
const fs = require('fs'), path = require('path'), express = require('express');
const { Client, GatewayIntentBits, Events } = require('discord.js');
const { runScript, detectRuntimes, runtimeInfo, RUNTIMES } = require('./scriptRunner');

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
reply('✅ **' + word + '** → tiếp theo: từ bắt đầu bằng **' + syl(word)[1] + '**');` }
];

const merge = (def, cur) => {
  if (!isObj(def) || !isObj(cur)) return cur === undefined ? def : cur;
  const o = { ...cur };
  for (const k of Object.keys(def)) o[k] = merge(def[k], cur[k]);
  return o;
};

function seedScripts() {
  return TEMPLATES.filter(t => ['taixiu', 'noitu'].includes(t.id)).map(t => cleanScript({ ...t, enabled: true }));
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
  if (need && !selfTarget && RP && RP.enabled) {
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
  if (member && pol && !selfTarget && H.enabled) {
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

function buildCtx(msg, pa) {
  const m = msg.member;
  const roles = m ? [...m.roles.cache.values()].filter(r => r.name !== '@everyone') : [];
  return {
    content: msg.content, rest: pa.rest, args: pa.args, match: pa.match,
    user: {
      id: msg.author.id, username: msg.author.username, display: m?.displayName || msg.author.username, mention: `<@${msg.author.id}>`,
      roles: roles.map(r => r.name), roleIds: roles.map(r => r.id),
      isAdmin: !!m?.permissions.has('Administrator'), isOwner: msg.guild?.ownerId === msg.author.id
    },
    mentions: [...msg.mentions.users.values()].map(u => ({ id: u.id, username: u.username, mention: `<@${u.id}>` })),
    channelId: msg.channel.id, guildId: msg.guild?.id || '', guildName: msg.guild?.name || '', messageId: msg.id, now: Date.now()
  };
}

async function handleScripts(msg) {
  for (const s of db.scripts) {
    if (s.enabled === false || !s.code || !s.trigger || !matchText(s, msg.content)) continue;
    const allow = String(s.channels || '').split(',').map(x => x.trim()).filter(Boolean);
    if (allow.length && !allow.includes(msg.channel.id)) continue;
    const key = s.id + ':' + msg.author.id, last = cdMap.get(key) || 0;
    if (s.cooldown > 0 && Date.now() - last < s.cooldown * 1000) { msg.react('⏳').catch(() => {}); return true; }
    cdMap.set(key, Date.now());
    log('cmd', `Script "${s.name}" (${s.language}) khớp "${msg.content.slice(0, 80)}"`, { user: msg.author.username, channel: chName(msg) });
    enqueue(() => execScript(s, msg)).catch(e => log('error', `Script "${s.name}": ${e.message}`));
    return true;
  }
  return false;
}

async function execScript(s, msg) {
  const pa = parseArgs(s, msg.content);
  const ctx = buildCtx(msg, pa);
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
    if (msg.author.bot) return;
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
  const bye = () => { try { saveNow(); } catch {} process.exit(0); };
  process.on('SIGINT', bye); process.on('SIGTERM', bye);
}
module.exports = { app, runAction, execAction, compareRank, render, normalize, parseArgs, db: () => db, setDb: d => { db = d; }, log, LOGS };
