require('dotenv').config();
const fs = require('fs'), path = require('path'), express = require('express');
const { Client, GatewayIntentBits } = require('discord.js');

const DB = path.join(__dirname, 'data.json');
const load = () => { try { return JSON.parse(fs.readFileSync(DB, 'utf8')); } catch { return { commands: [], tags: [] }; } };
let db = load();
const save = () => fs.writeFileSync(DB, JSON.stringify(db, null, 2));

// ---------- BOT ----------
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] });

const matchText = (c, text) => {
  const t = text.trim().toLowerCase(), k = (c.trigger || '').trim().toLowerCase();
  if (!k) return false;
  if (c.matchType === 'exact') return t === k;
  if (c.matchType === 'startsWith') return t.startsWith(k);
  if (c.matchType === 'regex') { try { return new RegExp(c.trigger, 'i').test(text); } catch { return false; } }
  return t.includes(k); // contains
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

const render = (text, msg) => {
  const roles = msg.member ? [...msg.member.roles.cache.values()].filter(r => r.name !== '@everyone').map(r => r.name).join(', ') : '';
  const base = {
    user: `<@${msg.author.id}>`, userId: msg.author.id, username: msg.author.username,
    server: msg.guild?.name || '', channel: `<#${msg.channel.id}>`, roles
  };
  return text.replace(/\{([^{}]+)\}/g, (m, k) => {
    if (k in base) return base[k];
    const tag = db.tags.find(t => t.name === k);
    if (!tag) return m;
    if (tag.type === 'link') return `[${tag.label || tag.value}](${tag.hide ? '<' + tag.value + '>' : tag.value})`;
    return tag.type === 'mention' ? `<@${tag.value}>` : tag.value; // text / video / link
  });
};

const runAction = async (a, msg) => {
  if (!a || !a.type || a.type === 'none') return;
  if (a.type === 'deleteMsg') return msg.delete().catch(() => {});
  const uid = a.target === 'mention' ? msg.mentions.users.first()?.id
    : a.target === 'id' ? String(a.targetId || '').trim() : msg.author.id;
  if (!uid || !msg.guild) return;
  try {
    const reason = render(a.reason || 'Bot tự động', msg);
    if (a.type === 'ban') await msg.guild.members.ban(uid, { reason });
    else {
      const m = await msg.guild.members.fetch(uid);
      if (a.type === 'kick') await m.kick(reason);
      else if (a.type === 'mute') await m.timeout(Math.min(Math.max(+a.minutes || 1, 1), 40320) * 60000, reason);
      else if (a.type === 'unmute') await m.timeout(null, reason);
      else if (a.type === 'addRole') await m.roles.add(String(a.roleId).trim(), reason);
      else if (a.type === 'removeRole') await m.roles.remove(String(a.roleId).trim(), reason);
    }
  } catch (e) { console.error('Loi hanh dong (' + a.type + '):', e.message); }
};

client.on('messageCreate', async msg => {
  if (msg.author.bot) return;
  for (const c of db.commands) {
    if (c.enabled === false || !matchText(c, msg.content)) continue;
    const rule = (c.rules || []).find(r => (r.conditions || []).every(cd => checkCond(cd, msg)));
    const pool = (rule ? rule.replies : c.defaultReplies || []).filter(Boolean);
    const act = rule ? rule.action : c.defaultAction;
    const hasAct = act && act.type && act.type !== 'none';
    if (!pool.length && !hasAct) continue;
    if (c.replyMode !== 'none' && pool.length) {
      const pick = (c.pick === 'first') ? pool[0] : pool[Math.floor(Math.random() * pool.length)];
      const opts = { content: render(pick, msg), allowedMentions: { parse: ['users'], repliedUser: true } };
      const secs = Number((rule && rule.deleteAfter) || c.deleteAfter || 0);
      try {
        const sent = c.replyMode === 'send' ? await msg.channel.send(opts) : await msg.reply(opts);
        if (secs > 0) setTimeout(() => sent.delete().catch(() => {}), secs * 1000);
      } catch (e) { console.error('Gui loi:', e.message); }
    }
    await runAction(act, msg); // ban/kick/mute... chạy sau khi đã gửi tin
    break;
  }
});
client.once('clientReady', () => console.log('Bot online:', client.user.tag));
client.login(process.env.DISCORD_TOKEN);

// ---------- WEB ----------
const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/api', (req, res, next) =>
  req.headers['x-password'] === process.env.ADMIN_PASSWORD ? next() : res.status(401).json({ error: 'Sai mật khẩu' }));
app.get('/api/data', (req, res) => res.json(db));
app.put('/api/data', (req, res) => {
  const { commands, tags } = req.body || {};
  if (!Array.isArray(commands) || !Array.isArray(tags)) return res.status(400).json({ error: 'Dữ liệu sai' });
  db = { commands, tags }; save(); res.json({ ok: true });
});
app.listen(process.env.PORT || 3000, () => console.log('Web: http://localhost:' + (process.env.PORT || 3000)));
