// ============================================================================
// CÀI SCRIPT NÀY TRÊN WEB (tab Script > Thêm script), dán toàn bộ file này vào ô code:
//   Tên       : Quản lý máy RDP
//   Ngôn ngữ  : JavaScript
//   Trigger   : ^!may\b        Kiểu khớp: regex      Kiểu trả: send
//   Cooldown  : 3              Thời gian tối đa: 30000
//   (ô "Chỉ nhận tin từ ID" và "Kênh" để TRỐNG)
// Lý do cài tay: data.json thật được khôi phục từ nhánh bot-data của repo chứa bot.yml,
// nên data.json trong repo code không tự có script này.
// ============================================================================
// ============================================================================
// QUẢN LÝ MÁY RDP (GitHub Actions) - tạo workflow từ may3, khởi động, danh sách, đọc log
// Lệnh (trigger regex ^!may\b):
//   !may                       trợ giúp
//   !may tao <tên> [1h|3h|5h]  tạo file <tên>.yml (copy từ may3, đổi may-phu-2 -> <tên>) + chạy action
//   !may chay <tên> [1h|3h|5h] chạy lại action của máy đã có
//   !may ds                    danh sách action đang chạy + nút xem thông tin đăng nhập (ẩn)
//   !may log <tên|runId>       danh sách bước dạng "0s / Run $tz = ..."
//   !may log <tên|runId> <n>   đọc log bước n   |   ... cuoi = bước mới nhất   |   ... all = gửi file đầy đủ
//   !may dung <tên>            hủy action đang chạy của máy (dừng luôn chuỗi tự khởi động lại)
//   !may ts <authkey>          (Admin) lưu Tailscale auth key cố định vào data.json
//   !may xem owner|all         (Admin) ai được xem bảng đăng nhập ẩn: chủ máy (+admin) hoặc mọi người
//   !may cfg                   (Admin) xem cấu hình đang dùng
// Cần: PAT có quyền repo + workflow (secret PAT_TOKEN -> env RDP_GH_TOKEN). Chỉ liệt kê/chạy/đọc log thì GH_TOKEN của Actions là đủ.
// ============================================================================
const R = shared.rdp = shared.rdp || {};
R.machines = R.machines || {};
const ev = ctx.event || 'message';
const isStaff = !!(ctx.user.isAdmin || ctx.user.isOwner);
const ENV = process.env;
const API = 'https://api.github.com';
const TEMPLATE_FROM = 'may-phu-2';
const BOT_FILES = ['bot.yml', 'bot.yaml'];
const POLL_SEC = 30, POLL_MAX = 90;             // dò log tối đa 90 x 30s = 45 phút
const REFRESH_SEC = 600;                         // cập nhật tin trạng thái mỗi 10 phút
const MAX_MACHINE = 12;

const repo = R.repo || ENV.GITHUB_REPOSITORY || '';
const token = ENV.RDP_GH_TOKEN || ENV.GH_TOKEN || R.ghToken || '';
const wfRef = String(ENV.GITHUB_WORKFLOW_REF || '');
const wfDir = R.dir || ((wfRef.match(/^[^/]+\/[^/]+\/(.+)\/[^/@]+@/) || [])[1]) || '.github/workflows';

// ---------- tiện ích ----------
const nameOk = s => String(s || '').trim().toLowerCase().replace(/[^a-z0-9\-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
const pad = n => String(n).padStart(2, '0');
const hms = sec => { sec = Math.max(0, Math.round(sec)); const h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60); return h ? h + 'h' + pad(m) + 'p' : m + 'p' + pad(sec % 60) + 's'; };
const dur = sec => { sec = Math.max(0, Math.round(sec)); return sec < 60 ? sec + 's' : Math.floor(sec / 60) + 'm ' + (sec % 60) + 's'; };
const vn = t => { const d = new Date(t + 7 * 3600e3); return pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes()) + ':' + pad(d.getUTCSeconds()); };
const strip = s => String(s).replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');
const parseDur = s => { s = String(s || '').toLowerCase(); if (/^1h?$/.test(s)) return { input: '1h', min: 60 }; if (/^3h?$/.test(s)) return { input: '3h', min: 180 }; return { input: '5h00m', min: 300 }; };
const fence = t => '```\n' + String(t).replace(/```/g, "'''") + '\n```';
const cut = (t, n) => t.length > n ? t.slice(0, n - 1) + '…' : t;
const cutTail = (t, n) => t.length > n ? '…' + t.slice(t.length - n + 1) : t;
const fileOf = name => name + '.yml';
const b64 = s => Buffer.from(s, 'utf8').toString('base64');

async function gh(method, path, body, raw) {
  if (!repo) throw new Error('Chưa biết repo (GITHUB_REPOSITORY trống). Chạy bot qua Actions hoặc đặt biến RDP_REPO.');
  if (!token) throw new Error('Chưa có token GitHub (đặt secret PAT_TOKEN -> RDP_GH_TOKEN trong bot.yml).');
  const res = await fetch(API + path, {
    method,
    headers: { Authorization: 'Bearer ' + token, Accept: raw ? 'application/vnd.github.raw+json' : 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'botcuadat-may', ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(25000)
  });
  const txt = await res.text();
  if (!res.ok) { const e = new Error(method + ' ' + path.split('?')[0] + ' → HTTP ' + res.status + ': ' + cut((() => { try { return JSON.parse(txt).message || txt; } catch { return txt; } })(), 200)); e.status = res.status; throw e; }
  if (raw) return txt;
  try { return txt ? JSON.parse(txt) : {}; } catch { return txt; }
}
async function getRef() {
  if (R.ref) return R.ref;
  if (ENV.GITHUB_REF_NAME) return ENV.GITHUB_REF_NAME;
  return (await gh('GET', '/repos/' + repo)).default_branch;
}

// ---------- tìm / sao chép template may3 ----------
async function loadTemplate(ref) {
  const list = await gh('GET', `/repos/${repo}/contents/${wfDir}?ref=${encodeURIComponent(ref)}`);
  const want = R.template ? [R.template] : null;
  const f = (Array.isArray(list) ? list : []).find(x => want ? x.name === want[0] : /^may3\.ya?ml$/i.test(x.name));
  if (!f) throw new Error('Không thấy file mẫu may3.yml / may3.yaml trong ' + wfDir + ' (nhánh ' + ref + '). Có: ' + (Array.isArray(list) ? list.map(x => x.name).join(', ') : '?'));
  const text = await gh('GET', `/repos/${repo}/contents/${f.path}?ref=${encodeURIComponent(ref)}`, null, true);
  return { name: f.name, text };
}
function makeWorkflow(text, name) {
  if (!text.includes(TEMPLATE_FROM)) throw new Error('File mẫu không còn chữ "' + TEMPLATE_FROM + '" nên không đổi tên được.');
  let out = text.split(TEMPLATE_FROM).join(name);
  out = out.replace(/^name:.*$/m, 'name: máy ' + name);
  return out;
}

// ---------- đọc log kiểu "0s / Run ..." ----------
function splitSteps(log) {
  const lines = strip(log).split(/\r?\n/);
  const steps = []; let cur = null;
  const tsOf = l => { const m = l.match(/^(\d{4}-\d\d-\d\dT[\d:.]+)Z /); return m ? Date.parse(m[1] + 'Z') : 0; };
  for (const raw of lines) {
    const t = tsOf(raw), l = raw.replace(/^\d{4}-\d\d-\d\dT[\d:.]+Z ?/, '');
    if (l.startsWith('##[group]Run ')) { cur = { title: l.slice(9).replace(/^Run /, '').trim(), t0: t, t1: t, body: [] }; steps.push(cur); cur.inGroup = true; continue; }
    if (!cur) continue;
    if (t) cur.t1 = t;
    if (l.startsWith('##[endgroup]')) { cur.inGroup = false; continue; }
    if (cur.inGroup) continue;                       // bỏ phần mã script trong nhóm Run (đúng như giao diện GitHub: thu gọn)
    if (l.startsWith('##[group]')) { cur.body.push('▸ ' + l.slice(9)); continue; }
    if (l.startsWith('##[error]')) { cur.body.push('❌ ' + l.slice(9)); continue; }
    if (l.startsWith('##[warning]')) { cur.body.push('⚠️ ' + l.slice(11)); continue; }
    if (/^##\[(debug|command|add-mask)/.test(l)) continue;
    cur.body.push(l);
  }
  steps.forEach((s, i) => { s.n = i + 1; s.sec = s.t0 && s.t1 ? (s.t1 - s.t0) / 1000 : 0; s.head = s.title.split(/\r?\n/)[0]; s.text = s.body.join('\n').replace(/\n{3,}/g, '\n\n').trim(); });
  return steps;
}
const fmtStep = s => dur(s.sec) + '\nRun ' + s.head + (s.text ? '\n\n' + s.text : '');

// ---------- bóc "THÔNG TIN KẾT NỐI" ----------
function parseBox(text) {
  const g = re => { const m = text.match(re); return m ? m[1].trim() : ''; };
  const ip = g(/IP Tailscale\s*:\s*(\d+\.\d+\.\d+\.\d+)/);
  if (!ip) return null;
  return {
    ip, sunshine: g(/Sunshine Web\s*:\s*(\S+)/), panel: g(/Web Quản Lý\s*:\s*(\S+)/), stardesk: g(/StarDesk\s*:\s*(.+)/),
    user: g(/User gốc\s*:\s*(\S+)/), pass: g(/Mật khẩu\s*:\s*(.+?)\s*\(Cố định\)/) || g(/Mật khẩu\s*:\s*(.+)/),
    screen: g(/Màn hình ảo\s*:\s*(\S+)/), audio: g(/Âm thanh ảo\s*:\s*(.+)/), disk: g(/Ổ đĩa riêng\s*:\s*(.+)/), profile: g(/Profile gốc\s*:\s*(.+?)\s*\(<->/),
    length: g(/Thời lượng\s*:\s*(.+)/), repoTag: g(/Kho lưu:\s*([^)]+)\)/)
  };
}

// ---------- trạng thái máy ----------
async function latestRun(file) {
  const r = await gh('GET', `/repos/${repo}/actions/workflows/${encodeURIComponent(file)}/runs?per_page=5`);
  return (r.workflow_runs || [])[0] || null;
}
async function findRun(arg) {
  if (/^\d{8,}$/.test(arg)) return await gh('GET', `/repos/${repo}/actions/runs/${arg}`);
  const name = nameOk(arg), m = R.machines[name];
  return await latestRun((m && m.file) || fileOf(name));
}
async function jobOf(runId) {
  const r = await gh('GET', `/repos/${repo}/actions/runs/${runId}/jobs?per_page=5`);
  return (r.jobs || [])[0] || null;
}
async function runLog(runId) {
  const job = await jobOf(runId);
  if (!job) throw new Error('Run chưa có job (đang xếp hàng).');
  const text = await gh('GET', `/repos/${repo}/actions/jobs/${job.id}/logs`, null, true);
  return { job, steps: splitSteps(text), text };
}
const machineKey = run => { const f = String(run.path || '').split('/').pop(); const k = Object.keys(R.machines).find(n => R.machines[n].file === f); return k || f.replace(/\.ya?ml$/i, ''); };
const remain = (m, run) => {
  const start = (m && m.startMs) || Date.parse(run.run_started_at || run.created_at);
  const total = ((m && m.minutes) || 300) * 60;
  return { start, end: start + total * 1000, left: total - (Date.now() - start) / 1000 };
};
const canSee = m => isStaff || R.view === 'all' || (m && m.ownerId === ctx.user.id);

// ---------- bảng đăng nhập (ẩn) ----------
function loginText(m, run) {
  const t = remain(m, run), L = [];
  L.push('**🖥️ ' + m.name + '**' + (m.owner ? ' — chủ: ' + m.owner : '') + (run ? '  ·  run #' + run.id : ''));
  if (m.info) {
    const i = m.info;
    L.push('🌐 IP Tailscale: `' + i.ip + '` (RDP: `' + i.ip + ':3389` | Moonlight)', '☀️ Sunshine: ' + i.sunshine, '🎛️ Web quản lý: ' + i.panel,
      '👤 User: `' + i.user + '`', '🔐 Mật khẩu: `' + i.pass + '`', '🖥️ Màn hình: ' + i.screen + (i.stardesk ? '  ·  🚀 StarDesk: ' + i.stardesk : ''));
  } else L.push('⏳ Máy đang khởi động, chưa có thông tin đăng nhập.');
  L.push('⏰ Phiên: ' + vn(t.start) + ' → ' + vn(t.end) + ' (VN) · ' + (t.left > 0 ? 'còn **' + hms(t.left) + '**' : '**đã hết giờ**'));
  return L.join('\n');
}
function tokenText() {
  return R.tsToken ? '🔑 **Token Tailscale**: `' + R.tsToken + '`' + (R.tsAt ? ' (lưu ' + new Date(R.tsAt + 7 * 3600e3).toISOString().slice(0, 10) + ')' : '') + '\n> Cài Tailscale trên máy bạn rồi: `tailscale up --authkey=<token>` để vào được IP 100.x của máy.'
    : '🔑 Chưa có Token Tailscale (Admin dùng `!may ts <authkey>`).';
}

// ---------- tin trạng thái công khai (không lộ mật khẩu) ----------
const publicCard = (m, run) => {
  const t = remain(m, run);
  const st = m.info ? '🟢 Sẵn sàng' : (run && run.status === 'queued' ? '⏳ Xếp hàng' : '🟡 Đang khởi động');
  return {
    content: '**🖥️ ' + m.name + '** ' + st + (m.owner ? ' · chủ: ' + m.owner : '') + '\n⏰ ' + vn(t.start) + ' → ' + vn(t.end) + ' (VN) · ' + (t.left > 0 ? 'còn ' + hms(t.left) : 'hết giờ') + (m.info ? '\n🌐 `' + m.info.ip + '`' : '') + '\nBấm nút để xem thông tin đăng nhập (chỉ bạn thấy).',
    buttons: [[{ id: 'in:' + m.name, label: '🔐 Thông tin đăng nhập', style: 'primary', ephemeral: true }, { id: 'lg:' + m.name, label: '📜 Log', style: 'secondary', ephemeral: true }]]
  };
};

// ---------- ghi nhận máy ----------
function rec(name, patch) { const m = R.machines[name] = R.machines[name] || { name, file: fileOf(name), created: Date.now() }; Object.assign(m, patch); return m; }

async function listRuns() {
  const [a1, a2] = await Promise.all(['in_progress', 'queued'].map(s => gh('GET', `/repos/${repo}/actions/runs?status=${s}&per_page=50`)));
  const own = String(ENV.GITHUB_RUN_ID || '');
  return [...(a1.workflow_runs || []), ...(a2.workflow_runs || [])]
    .filter(r => String(r.id) !== own && !BOT_FILES.includes(String(r.path).split('/').pop()))
    .sort((x, y) => Date.parse(x.created_at) - Date.parse(y.created_at));
}


// ============================== XỬ LÝ SỰ KIỆN ==============================
try {
  // ---------------- HẸN GIỜ: khởi động -> tìm run -> dò log -> cập nhật tin ----------------
  if (ev === 'timer') {
    const [kind, name, nStr] = String(ctx.timer.data).split('|'), n = +nStr || 0, m = R.machines[name];
    if (!m) return;
    const tag = 'may:' + name;
    if (kind === 'disp') {                                   // gửi lệnh chạy workflow (file vừa tạo có thể cần vài giây mới nhận)
      try {
        const ref = await getRef();
        m.dispatchAt = Date.now() - 3000;
        await gh('POST', `/repos/${repo}/actions/workflows/${encodeURIComponent(m.file)}/dispatches`, { ref, inputs: { machine_id: name, duration: m.input || '5h00m' } });
        m.status = 'dispatched'; ui.after(6, 'find|' + name + '|0'); return;
      } catch (e) {
        if (n < 8 && /404|422/.test(String(e.status))) { ui.after(6, 'disp|' + name + '|' + (n + 1)); return; }
        m.status = 'error'; ui.edit(tag, '❌ **' + name + '**: không chạy được action: ' + e.message + '\n(Cần token có quyền workflow; file đã tạo: `' + m.file + '`)'); return;
      }
    }
    if (kind === 'find') {                                   // tìm run vừa tạo
      const rs = (await gh('GET', `/repos/${repo}/actions/workflows/${encodeURIComponent(m.file)}/runs?event=workflow_dispatch&per_page=5`)).workflow_runs || [];
      const run = rs.find(r => Date.parse(r.created_at) >= (m.dispatchAt || 0)) || (n >= 6 ? rs[0] : null);
      if (!run) { if (n < 12) ui.after(5, 'find|' + name + '|' + (n + 1)); else ui.edit(tag, '❌ **' + name + '**: dispatch xong nhưng không thấy run nào.'); return; }
      m.runId = run.id; m.url = run.html_url; m.startMs = Date.parse(run.run_started_at || run.created_at); m.status = 'running';
      ui.edit(tag, publicCard(m, run)); ui.after(POLL_SEC, 'poll|' + name + '|0'); return;
    }
    if (kind === 'poll') {                                   // dò khối "THÔNG TIN KẾT NỐI"
      const run = await gh('GET', `/repos/${repo}/actions/runs/${m.runId}`);
      if (run.status === 'completed') { m.status = 'done'; ui.edit(tag, { content: '🔴 **' + name + '** đã kết thúc (' + (run.conclusion || '?') + ').', buttons: [] }); return; }
      if (!m.info) {
        let box = null;
        try { const L = await runLog(m.runId); const st = L.steps.find(s => /IP Tailscale\s*:\s*\d/.test(s.text)); if (st) box = parseBox(st.text); } catch { /* log chưa sẵn sàng */ }
        if (box) { m.info = box; m.infoAt = Date.now(); m.status = 'ready'; ui.edit(tag, publicCard(m, run)); ui.send({ content: '✅ Máy **' + name + '** đã sẵn sàng' + (m.ownerId ? ' <@' + m.ownerId + '>' : '') + '! Bấm **🔐 Thông tin đăng nhập** ở tin trên (chỉ bạn thấy).', mentions: m.ownerId ? [m.ownerId] : [] }); ui.after(REFRESH_SEC, 'poll|' + name + '|0'); return; }
        if (n < POLL_MAX) { ui.after(POLL_SEC, 'poll|' + name + '|' + (n + 1)); return; }
        ui.edit(tag, '⚠️ **' + name + '**: chờ 45 phút vẫn chưa thấy thông tin kết nối. Xem `!may log ' + name + '`.'); return;
      }
      ui.edit(tag, publicCard(m, run)); ui.after(REFRESH_SEC, 'poll|' + name + '|0'); return;   // định kỳ cập nhật giờ còn lại
    }
    return;
  }

  // ---------------- NÚT BẤM ----------------
  if (ev === 'button') {
    const [kind, name, extra] = String(ctx.interaction.customId).split(':').concat(['', '']).slice(0, 3);
    if (kind === 'ds' || kind === 'allin') {                 // bảng đăng nhập tất cả máy đang chạy (ẩn)
      const rs = await listRuns();
      const parts = [];
      for (const run of rs) { const k = machineKey(run), m = R.machines[k] || { name: k, file: String(run.path).split('/').pop() }; if (canSee(m)) parts.push(loginText(m, run)); }
      ui.reply(cut((parts.length ? parts.join('\n\n') : 'Không có máy nào bạn được xem.') + '\n\n' + (parts.length ? tokenText() : ''), 1990));
      return;
    }
    const m = R.machines[name];
    if (kind === 'in') {
      if (!m || !canSee(m)) { ui.reply('🚫 Bạn không phải chủ máy này.'); return; }
      const run = m.runId ? await gh('GET', `/repos/${repo}/actions/runs/${m.runId}`) : null;
      ui.reply(cut(loginText(m, run) + '\n\n' + tokenText(), 1990)); return;
    }
    if (kind === 'lg') {
      if (!m || !canSee(m)) { ui.reply('🚫 Bạn không phải chủ máy này.'); return; }
      const L = await runLog(m.runId), last = L.steps[L.steps.length - 1];
      ui.reply(cut(fence(cutTail(last ? fmtStep(last) : '(chưa có log)', 1800)), 1990)); return;
    }
    return;
  }

  // ---------------- LỆNH CHỮ ----------------
  const a = ctx.args.slice(1), sub = (a[0] || '').toLowerCase(), arg = a[1] || '';
  const say = (c, extra) => ui.send({ content: c, ...(extra || {}) });

  if (!sub || sub === 'help') {
    say('**🖥️ Quản lý máy RDP**\n`!may tao <tên> [1h|3h|5h]` tạo file từ may3 + chạy\n`!may chay <tên> [1h|3h|5h]` chạy lại máy đã có\n`!may ds` danh sách action đang chạy\n`!may log <tên|runId> [số bước|cuoi|all]` đọc log\n`!may dung <tên>` dừng máy\nAdmin: `!may ts <authkey>` · `!may xem owner|all` · `!may cfg`');
    return;
  }

  if (sub === 'ts') {
    deleteMsg();
    if (!isStaff) return say('Chỉ Admin / chủ server.');
    if (!/^tskey-[\w-]{10,}$/.test(arg)) return say('Token không đúng dạng `tskey-auth-...`.');
    R.tsToken = arg; R.tsAt = Date.now();
    return say('✅ Đã lưu Token Tailscale vào data.json (đã xóa tin chứa token). Nó sẽ hiện trong bảng đăng nhập ẩn của từng máy.');
  }
  if (sub === 'xem') {
    if (!isStaff) return say('Chỉ Admin / chủ server.');
    if (!['owner', 'all'].includes(arg)) return say('Dùng `!may xem owner` hoặc `!may xem all`. Hiện tại: **' + (R.view === 'all' ? 'all' : 'owner') + '**');
    R.view = arg; return say('✅ Bảng đăng nhập ẩn: ' + (arg === 'all' ? 'mọi người xem được mọi máy' : 'chỉ chủ máy và Admin xem được'));
  }
  if (sub === 'cfg') {
    if (!isStaff) return say('Chỉ Admin / chủ server.');
    return say('Repo: `' + (repo || '?') + '` · thư mục: `' + wfDir + '` · nhánh: `' + (R.ref || ENV.GITHUB_REF_NAME || '(mặc định repo)') + '`\nToken GitHub: ' + (token ? '✅' : '❌ thiếu') + ' · Tailscale token: ' + (R.tsToken ? '✅' : '❌') + ' · Xem: ' + (R.view === 'all' ? 'all' : 'owner') + '\nMáy đã ghi nhận: ' + (Object.keys(R.machines).join(', ') || '(chưa có)'));
  }

  if (sub === 'tao' || sub === 'chay') {
    const name = nameOk(arg);
    if (!name) return say('Thiếu tên máy. VD: `!may ' + sub + ' chill 3h`');
    if (['bot', 'may3'].includes(name)) return say('Tên `' + name + '` bị giữ chỗ, chọn tên khác.');
    const d = parseDur(a[2]);
    const existing = R.machines[name];
    if (existing && existing.ownerId && existing.ownerId !== ctx.user.id && !isStaff) return say('Máy `' + name + '` là của ' + existing.owner + '.');
    if (sub === 'tao' && !existing && Object.keys(R.machines).length >= MAX_MACHINE) return say('Đã đủ ' + MAX_MACHINE + ' máy, xóa bớt trong data.json (`scriptData.shared.rdp.machines`).');
    const ref = await getRef();
    const file = fileOf(name), path = wfDir + '/' + file;
    let created = false;
    let exists = true;
    try { await gh('GET', `/repos/${repo}/contents/${path}?ref=${encodeURIComponent(ref)}`); } catch (e) { if (e.status === 404) exists = false; else throw e; }
    if (!exists) {
      if (sub === 'chay') return say('Chưa có file `' + file + '`. Dùng `!may tao ' + name + '` trước.');
      const tpl = await loadTemplate(ref);
      await gh('PUT', `/repos/${repo}/contents/${path}`, { message: 'tạo máy ' + name + ' (từ ' + tpl.name + ')', content: b64(makeWorkflow(tpl.text, name)), branch: ref });
      created = true;
    }
    const m = rec(name, { file, input: d.input, minutes: d.min, owner: ctx.user.display, ownerId: ctx.user.id, ownerTag: ctx.user.username, channelId: ctx.channelId, info: null, runId: null, status: 'creating', startMs: Date.now() });
    ui.send({ content: (created ? '📝 Đã tạo `' + path + '` (copy từ may3, `' + TEMPLATE_FROM + '` → `' + name + '`).\n' : '♻️ File `' + file + '` đã có, chạy lại.\n') + '🚀 Đang khởi động action cho máy **' + name + '** (' + d.input + ')…' }, 'may:' + name);
    ui.after(created ? 8 : 1, 'disp|' + name + '|0');
    return;
  }

  if (sub === 'ds' || sub === 'list') {
    const rs = await listRuns();
    if (!rs.length) return say('😴 Không có action nào đang chạy.');
    const L = [];
    for (const run of rs) {
      const k = machineKey(run), m = R.machines[k], t = remain(m, run);
      L.push((run.status === 'queued' ? '⏳' : (m && m.info ? '🟢' : '🟡')) + ' **' + k + '** · run `' + run.id + '` · ' + run.status + (m && m.owner ? ' · chủ: ' + m.owner : '') + '\n   ⏰ ' + vn(t.start) + ' → ' + vn(t.end) + ' · ' + (t.left > 0 ? 'còn ' + hms(t.left) : 'quá giờ'));
    }
    say(cut(L.join('\n'), 1900), { buttons: [[{ id: 'ds:', label: '🔐 Bảng đăng nhập (ẩn)', style: 'primary', ephemeral: true }]] });
    return;
  }

  if (sub === 'dung') {
    const name = nameOk(arg), m = R.machines[name];
    if (!name) return say('Thiếu tên máy.');
    if (m && m.ownerId && m.ownerId !== ctx.user.id && !isStaff) return say('Máy `' + name + '` là của ' + m.owner + '.');
    const run = await findRun(name);
    if (!run || run.status === 'completed') return say('Máy `' + name + '` không chạy.');
    await gh('POST', `/repos/${repo}/actions/runs/${run.id}/cancel`);
    if (m) { m.status = 'stopped'; m.info = null; }
    return say('🛑 Đã gửi lệnh hủy run `' + run.id + '` của **' + name + '** (hủy thì không tự khởi động phiên mới).');
  }

  if (sub === 'log') {
    if (!arg) return say('Dùng: `!may log <tên|runId> [số bước | cuoi | all]`');
    const run = await findRun(arg);
    if (!run) return say('Không thấy run nào cho `' + arg + '`.');
    const mk = machineKey(run), m = R.machines[mk];
    if (m && !canSee(m)) return say('🚫 Bạn không phải chủ máy này.');
    const L = await runLog(run.id), pick = (a[2] || '').toLowerCase();
    if (pick === 'all') {
      const full = L.steps.map(fmtStep).join('\n\n────────\n\n');
      return ui.send({ content: '📜 Log đầy đủ **' + mk + '** run `' + run.id + '` (' + L.steps.length + ' bước)', files: [{ name: 'log-' + mk + '-' + run.id + '.txt', text: full }] });
    }
    if (pick) {
      const s = pick === 'cuoi' ? L.steps[L.steps.length - 1] : L.steps[(+pick || 0) - 1];
      if (!s) return say('Không có bước ' + pick + '. Có ' + L.steps.length + ' bước.');
      const t = fmtStep(s), ob = { content: fence(cutTail(t, 1850)) };
      if (t.length > 1850) ob.files = [{ name: 'log-' + mk + '-b' + s.n + '.txt', text: t }];
      return ui.send(ob);
    }
    const rows = L.steps.map(s => String(s.n).padStart(2) + ') ' + dur(s.sec).padEnd(6) + ' Run ' + cut(s.head, 62));
    return ui.send({ content: '📜 **' + mk + '** · run `' + run.id + '` · ' + run.status + '\n' + fence(cutTail(rows.join('\n'), 1750)) + 'Xem 1 bước: `!may log ' + arg + ' <số>` · bước mới nhất: `cuoi` · cả file: `all`' });
  }

  say('Không hiểu lệnh. Gõ `!may` để xem trợ giúp.');
} catch (e) {
  const msg = '❌ ' + String(e.message || e).slice(0, 600);
  if (ev === 'button') ui.reply(msg); else if (ev === 'timer') ui.send(msg); else ui.send(msg);
}
