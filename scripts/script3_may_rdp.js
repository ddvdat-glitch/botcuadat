// ============================================================================
// BOT QUẢN LÝ MÁY ẢO STARDESK (BẢO MẬT PHÂN QUYỀN & KIẾN TRÚC 2 REPO)
// Trigger  : ^!may\b
// Kiểu     : regex | Kiểu trả: send
// ============================================================================
// 1. Repo Gốc (ddvdat-glitch/rdp): Lưu toàn bộ Release 7z & Nhánh State của máy gốc và máy con.
// 2. Repo Runner (ohohhoho82-alt/app): Chỉ treo máy (chạy GitHub Actions runner).
// 3. Kết nối từ xa: StarDesk 1.5.3 (lấy từ X:\Apps\StarDesk-1.5.3.exe cài ra C:\).
// 4. Phân quyền: Cấp quyền bởi Root Admin ID: 946662197168341053.
// ============================================================================

const https = require('https');
const path = require('path');
const fs = require('fs');

// ----------------- CẤU HÌNH & BẢO MẬT PHÂN QUYỀN -----------------
const ROOT_ADMIN = '946662197168341053';

// Lưu trữ trạng thái bền vững trong store (tự động đồng bộ vào data.json)
store.allowedUsers = store.allowedUsers || {};
store.allowedUsers[ROOT_ADMIN] = { id: ROOT_ADMIN, name: 'Root Admin', at: 0 };
store.machines = store.machines || {};

const R = shared.rdp = shared.rdp || {};
R.machines = store.machines;
R.config = R.config || store.config || {};

const STORAGE_REPO = R.config.storageRepo || process.env.STORAGE_REPO || 'ddvdat-glitch/rdp';
const RUNNER_REPO = R.config.runnerRepo || process.env.RUNNER_REPO || 'ohohhoho82-alt/app';
const GH_TOKEN = R.config.token || process.env.PAT_TOKEN || process.env.RDP_GH_TOKEN || process.env.STORAGE_GH_TOKEN || process.env.GH_TOKEN || '';

const ev = ctx.event || 'message';
const userId = String((ctx.user && ctx.user.id) || '');
const userDisplay = (ctx.user && (ctx.user.display || ctx.user.username)) || 'Người dùng';

// ----------------- HÀM KIỂM TRA QUYỀN -----------------
function isRootUser(uid) {
  return uid === ROOT_ADMIN;
}

function isAllowedUser(uid) {
  if (!uid) return false;
  if (uid === ROOT_ADMIN) return true;
  return !!(store.allowedUsers && store.allowedUsers[uid]);
}

function canManageMachine(m, uid) {
  if (!m) return false;
  if (isRootUser(uid)) return true;
  return m.ownerId === uid;
}

// ----------------- TIỆN ÍCH -----------------
const pad = n => String(n).padStart(2, '0');
const nameOk = s => String(s || '').trim().toLowerCase().replace(/[^a-z0-9\-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
const hms = sec => {
  sec = Math.max(0, Math.round(sec));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return h > 0 ? `${h}h ${pad(m)}m` : `${m}m ${pad(s)}s`;
};
const parseDur = s => {
  s = String(s || '').toLowerCase();
  if (/^1h?$/.test(s)) return { input: '1h', min: 60 };
  if (/^3h?$/.test(s)) return { input: '3h', min: 180 };
  return { input: '5h00m', min: 300 };
};
const say = (text, opts) => {
  if (typeof ui !== 'undefined' && ui.send && opts && opts.buttons) {
    ui.send({ content: text, buttons: opts.buttons });
  } else {
    reply(text);
  }
};

// ----------------- GỌI GITHUB REST API -----------------
function gh(method, repo, endpoint, body, customToken) {
  return new Promise((resolve, reject) => {
    const token = customToken || GH_TOKEN;
    const pathUrl = endpoint.startsWith('http')
      ? endpoint.replace('https://api.github.com', '')
      : (endpoint.startsWith('/repos/') ? endpoint : `/repos/${repo}${endpoint.startsWith('/') ? '' : '/'}${endpoint}`);

    const dataStr = body ? JSON.stringify(body) : null;
    const headers = {
      'User-Agent': 'AISTV-StarDesk-Bot',
      'Accept': 'application/vnd.github+json'
    };
    if (token) headers['Authorization'] = `token ${token}`;
    if (dataStr) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = Buffer.byteLength(dataStr);
    }

    const req = https.request({
      hostname: 'api.github.com',
      port: 443,
      path: pathUrl,
      method: method.toUpperCase(),
      headers
    }, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode === 204) return resolve(true);
        let json = null;
        try { json = JSON.parse(data); } catch { json = null; }
        if (res.statusCode >= 200 && res.statusCode < 300) {
          return resolve(json != null ? json : data);
        }
        const errMsg = (json && json.message) || data || `HTTP ${res.statusCode}`;
        const err = new Error(errMsg);
        err.status = res.statusCode;
        err.data = json;
        reject(err);
      });
    });

    req.on('error', reject);
    req.setTimeout(20000, () => {
      req.destroy();
      reject(new Error('GitHub API request timeout (20s)'));
    });
    if (dataStr) req.write(dataStr);
    req.end();
  });
}

// ----------------- ĐỌC FILE MẪU TAOMAY.YML -----------------
async function loadTemplate() {
  // 1. Thử đọc từ local candidates
  const localCandidates = [
    'c:/Users/acc/Downloads/badao/taomay.yml',
    'c:/Users/acc/Downloads/badao/taomay.yaml',
    path.resolve(process.cwd(), '.github/workflows/taomay.yml'),
    path.resolve(process.cwd(), '.github/workflows/taomay.yaml'),
    path.resolve(process.cwd(), 'taomay.yml'),
    path.resolve(process.cwd(), 'taomay.yaml'),
    path.resolve(__dirname, '.github/workflows/taomay.yml'),
    path.resolve(__dirname, 'taomay.yml'),
    path.resolve(__dirname, 'taomay.yaml'),
    path.resolve(__dirname, '../../taomay.yml'),
    path.resolve(__dirname, '../../taomay.yaml')
  ];
  for (const lp of localCandidates) {
    try {
      if (fs.existsSync(lp)) return fs.readFileSync(lp, 'utf8');
    } catch {}
  }

  // 2. Thử tải từ Repo Gốc (.github/workflows/taomay.yml, taomay.yml...)
  const remoteCandidates = [
    '.github/workflows/taomay.yml',
    '.github/workflows/taomay.yaml',
    'taomay.yml',
    'taomay.yaml'
  ];
  for (const rc of remoteCandidates) {
    try {
      const f = await gh('GET', STORAGE_REPO, `/contents/${rc}`);
      if (f && f.content) return Buffer.from(f.content.replace(/\s+/g, ''), 'base64').toString('utf8');
    } catch {}
  }

  throw new Error(`Không thấy file mẫu taomay.yml trên máy hoặc Repo Gốc (${STORAGE_REPO})`);
}

// ----------------- TẠO & ĐẨY WORKFLOW SANG RUNNER REPO -----------------
function prepareWorkflow(tpl, name, duration) {
  let out = tpl;
  out = out.replace(/^name:\s*.*$/m, `name: máy ${name}`);
  out = out.replace(/(machine_id:[\s\S]*?default:\s*)['"][^'"]*['"]/i, `$1'${name}'`);
  out = out.replace(/(display_name:[\s\S]*?default:\s*)['"][^'"]*['"]/i, `$1'Máy ${name}'`);
  out = out.replace(/(storage_repo:[\s\S]*?default:\s*)['"][^'"]*['"]/i, `$1'${STORAGE_REPO}'`);
  out = out.replace(/(duration:[\s\S]*?default:\s*)['"][^'"]*['"]/i, `$1'${duration}'`);

  // Bật cancel-in-progress để khi kích hoạt phiên mới sẽ tự động hủy phiên cũ và lưu ổ đĩa
  out = out.replace(/cancel-in-progress:\s*false/gi, 'cancel-in-progress: true');

  // BỎ HOÀN TOÀN MỞ RDP ĐỂ TRÁNH GITHUB BAN
  out = out.replace(/fDenyTSConnections['"]\s*-Value\s*0/g, `fDenyTSConnections' -Value 1`);
  out = out.replace(/Start-Service\s*-Name\s*TermService[^\r\n]*/g, `Stop-Service -Name TermService -Force -ErrorAction SilentlyContinue; Set-Service -Name TermService -StartupType Disabled -ErrorAction SilentlyContinue`);
  out = out.replace(/LocalPort\s*3389[^\r\n]*/g, `LocalPort 8080 -Profile Any | Out-Null`);

  // SỬA TREO VB-AUDIO: Thay thế Start-Process -Wait bằng Start-Job có Timeout 15s
  if (out.includes('VBCABLE_Setup_x64.exe') && !out.includes('Wait-Job -Job ($vbJob)')) {
    out = out.replace(
      /Start-Process\s*-FilePath\s*["']\$vbCacheDir\\VBCABLE_Setup_x64\.exe["'][^;\r\n]*-Wait;?/g,
      `$vbJob = Start-Job -ScriptBlock { param($dir) Start-Process -FilePath "$dir\\VBCABLE_Setup_x64.exe" -ArgumentList '-i', '-h' -WorkingDirectory "$dir" -Wait; } -ArgumentList "$vbCacheDir"; $null = Wait-Job -Job $vbJob -Timeout 15; Stop-Job -Job $vbJob -ErrorAction SilentlyContinue; Remove-Job -Job $vbJob -Force -ErrorAction SilentlyContinue;`
    );
  }

  return out;
}

async function pushWorkflow(name, content) {
  const filePath = `.github/workflows/${name}.yml`;
  let sha = null;
  try {
    const cur = await gh('GET', RUNNER_REPO, `/contents/${filePath}`);
    if (cur && cur.sha) sha = cur.sha;
  } catch (e) {
    if (e.status !== 404) throw e;
  }

  const payload = {
    message: `Tạo workflow máy ${name} từ taomay.yml`,
    content: Buffer.from(content, 'utf8').toString('base64')
  };
  if (sha) payload.sha = sha;

  await gh('PUT', RUNNER_REPO, `/contents/${filePath}`, payload);
  return filePath;
}

async function triggerRun(name, duration) {
  let lastErr = null;
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      await gh('POST', RUNNER_REPO, `/actions/workflows/${name}.yml/dispatches`, {
        ref: 'main',
        inputs: {
          machine_id: name,
          display_name: `Máy ${name}`,
          storage_repo: STORAGE_REPO,
          duration: duration || '5h00m'
        }
      });
      return;
    } catch (e) {
      lastErr = e;
      if (attempt < 4) await new Promise(r => setTimeout(r, 2000));
    }
  }
  throw lastErr;
}

// ----------------- ĐỒNG BỘ TRẠNG THÁI MÁY & STARDESK ID -----------------
async function syncMachine(name) {
  const m = store.machines[name] = store.machines[name] || R.machines[name] || { name, created: Date.now() };
  try {
    const listRes = await gh('GET', RUNNER_REPO, `/actions/workflows/${name}.yml/runs?per_page=1`);
    const run = (listRes.workflow_runs && listRes.workflow_runs[0]) || null;
    if (!run) {
      m.status = 'no_run';
      return m;
    }

    m.runId = run.id;
    m.runUrl = run.html_url;
    m.status = run.status;         // 'queued', 'in_progress', 'completed'
    m.conclusion = run.conclusion; // 'success', 'cancelled', 'failure'
    m.startedAt = run.run_started_at ? new Date(run.run_started_at).getTime() : new Date(run.created_at).getTime();

    const durMin = m.durationMin || 300;
    const elapsedSec = Math.max(0, Math.floor((Date.now() - m.startedAt) / 1000));
    m.elapsedSec = elapsedSec;
    m.remainSec = Math.max(0, (durMin * 60) - elapsedSec);

    // Bóc tách StarDesk ID từ Annotations hoặc Job Logs
    if (run.status === 'in_progress' || run.status === 'completed') {
      const jobsRes = await gh('GET', RUNNER_REPO, `/actions/runs/${run.id}/jobs?per_page=1`);
      const job = (jobsRes.jobs && jobsRes.jobs[0]) || null;
      if (job) {
        m.jobId = job.id;
        try {
          const anns = await gh('GET', RUNNER_REPO, `/check-runs/${job.id}/annotations?per_page=15`);
          if (Array.isArray(anns)) {
            const sdAnn = anns.find(a => a.title && a.title.includes('STARDESK'));
            if (sdAnn && sdAnn.message) {
              const msg = sdAnn.message;
              const idM = msg.match(/ID=([^\s|]+)/);
              const userM = msg.match(/USER=([^\s|]+)/);
              const passM = msg.match(/PASS=([^\s|]+)/);
              if (idM && idM[1] && !idM[1].includes('Xem')) m.stardeskId = idM[1];
              if (userM) m.user = userM[1];
              if (passM) m.pass = passM[1];
              m.ready = true;
            }
          }
        } catch {}

        if (!m.stardeskId) {
          try {
            const rawLog = await gh('GET', RUNNER_REPO, `/actions/jobs/${job.id}/logs`);
            if (rawLog) {
              const idM = rawLog.match(/StarDesk ID\s*:\s*([^\r\n│]+)/i) || rawLog.match(/STARDESK::ID=([^\s|]+)/i);
              if (idM && idM[1] && !idM[1].includes('Xem')) {
                m.stardeskId = idM[1].trim();
                m.ready = true;
              }
              const pM = rawLog.match(/Mật khẩu\s*:\s*([^\s(│]+)/i);
              if (pM) m.pass = pM[1].trim();
            }
          } catch {}
        }
      }
    }
  } catch (err) {
    m.error = err.message;
  }
  return m;
}

// ----------------- NÚT BẤM ĐIỀU KHIỂN -----------------
function getButtons(name) {
  return [
    [
      { id: `in:${name}`, label: '🔐 Xem Thông Tin', style: 'primary', ephemeral: true },
      { id: `st:${name}`, label: '🛑 Tắt Máy', style: 'danger', ephemeral: true },
      { id: `rs:${name}`, label: '🔁 Khởi Động Lại', style: 'secondary', ephemeral: true }
    ],
    [
      { id: `delstorage:${name}`, label: '💽 Xóa Ổ Đĩa (Repo Gốc)', style: 'danger', ephemeral: true },
      { id: `delfile:${name}`, label: '🗑️ Xóa Workflow (Runner)', style: 'danger', ephemeral: true }
    ]
  ];
}

// ============================================================================
// XỬ LÝ SỰ KIỆN: NÚT BẤM (BUTTON)
// ============================================================================
if (ev === 'button') {
  const customId = String((ctx.interaction && ctx.interaction.customId) || '');
  const [act, name] = customId.split(':');
  if (!name) return;

  const m = store.machines[name] || R.machines[name];
  const clickerId = userId;

  // 1. Kiểm tra quyền dùng bot
  if (!isAllowedUser(clickerId)) {
    return ui.reply({ content: `⛔ Bạn chưa được cấp quyền sử dụng hệ thống máy ảo! Hãy liên hệ Admin (<@${ROOT_ADMIN}>).`, ephemeral: true });
  }

  // 2. Kiểm tra quyền sở hữu máy
  if (m && m.ownerId && !canManageMachine(m, clickerId)) {
    return ui.reply({ content: `⛔ Bạn không có quyền điều khiển máy **${name}**! Máy này thuộc quyền sở hữu của <@${m.ownerId}>.`, ephemeral: true });
  }

  // NÚT: XEM THÔNG TIN
  if (act === 'in') {
    const curM = await syncMachine(name);
    const isOnline = curM.status === 'in_progress' && curM.ready;
    const statusBadge = isOnline ? '🟢 Online (Sẵn sàng)' : (curM.status === 'in_progress' ? '⏳ Đang khởi động...' : '🔴 Đã tắt');
    const sdText = curM.stardeskId ? `\`${curM.stardeskId}\`` : '*(Chờ mở máy / Đang cài đặt...)*';
    const remText = curM.remainSec != null ? hms(curM.remainSec) : 'N/A';
    const elapText = curM.elapsedSec != null ? hms(curM.elapsedSec) : '0s';

    const card = [
      `🔐 **THÔNG TIN MÁY: ${name.toUpperCase()}**`,
      `• 👤 **Chủ sở hữu:** <@${curM.ownerId || (m && m.ownerId) || userId}>`,
      `• 📡 **Trạng thái:** ${statusBadge}`,
      `• 🚀 **StarDesk ID:** ${sdText}`,
      curM.stardeskId ? `> 💡 *Mở app StarDesk trên máy tính -> Nhập mã ID ở trên để điều khiển máy!*` : '',
      `• 🔐 **Mật khẩu máy:** \`${curM.pass || 'Aistv@2026'}\``,
      `• ⏰ **Thời gian:** Đã chạy **${elapText}** · Còn lại **${remText}**`
    ].filter(Boolean).join('\n');
    return ui.reply({ content: card, ephemeral: true });
  }

  // NÚT: TẮT MÁY (LƯU Ổ ĐĨA RỒI TẮT)
  if (act === 'st') {
    const curM = await syncMachine(name);
    if (!curM.runId || curM.status === 'completed') {
      return ui.reply({ content: `⚠️ Máy **${name}** hiện không có phiên nào đang chạy.`, ephemeral: true });
    }
    try {
      await gh('POST', RUNNER_REPO, `/actions/runs/${curM.runId}/cancel`);
      curM.status = 'completed';
      return ui.reply({ content: `🛑 Đã gửi lệnh lưu ổ đĩa và tắt máy **${name}**!`, ephemeral: true });
    } catch (e) {
      return ui.reply({ content: `❌ Không tắt được máy: ${e.message}`, ephemeral: true });
    }
  }

  // NÚT: KHỞI ĐỘNG LẠI (TẮT LƯU RỒI MỚI CHẠY LẠI)
  if (act === 'rs') {
    const curM = await syncMachine(name);
    if (curM.runId && curM.status === 'in_progress') {
      try { await gh('POST', RUNNER_REPO, `/actions/runs/${curM.runId}/cancel`); } catch {}
      await new Promise(r => setTimeout(r, 2500));
    }
    try {
      await triggerRun(name, curM.duration || '5h00m');
      curM.status = 'starting';
      curM.startedAt = Date.now();
      return ui.reply({ content: `🔁 Đã gửi lệnh lưu ổ đĩa, tắt phiên cũ và kích hoạt lại phiên mới cho máy **${name}**!`, ephemeral: true });
    } catch (e) {
      return ui.reply({ content: `❌ Lỗi khởi động lại: ${e.message}`, ephemeral: true });
    }
  }

  // NÚT: XÓA Ổ ĐĨA (REPO GỐC)
  if (act === 'delstorage') {
    const relTag = `aistv-storage-${name}`;
    const stBranch = `aistv-state-${name}`;
    try {
      const rel = await gh('GET', STORAGE_REPO, `/releases/tags/${encodeURIComponent(relTag)}`);
      if (rel && rel.id) await gh('DELETE', STORAGE_REPO, `/releases/${rel.id}`);
    } catch {}
    try { await gh('DELETE', STORAGE_REPO, `/git/refs/tags/${encodeURIComponent(relTag)}`); } catch {}
    try { await gh('DELETE', STORAGE_REPO, `/git/refs/heads/${encodeURIComponent(stBranch)}`); } catch {}
    return ui.reply({ content: `💽 Đã xóa sạch dữ liệu ổ đĩa của máy **${name}**!`, ephemeral: true });
  }

  // NÚT: XÓA WORKFLOW (RUNNER)
  if (act === 'delfile') {
    const filePath = `.github/workflows/${name}.yml`;
    try {
      const cur = await gh('GET', RUNNER_REPO, `/contents/${filePath}`);
      if (cur && cur.sha) {
        await gh('DELETE', RUNNER_REPO, `/contents/${filePath}`, { message: `Xóa workflow ${name}`, sha: cur.sha });
        delete store.machines[name];
        delete R.machines[name];
        return ui.reply({ content: `🗑️ Đã xóa máy **${name}** thành công!`, ephemeral: true });
      }
    } catch (e) {
      return ui.reply({ content: `❌ Lỗi xóa file: ${e.message}`, ephemeral: true });
    }
  }
  return;
}

// ============================================================================
// XỬ LÝ SỰ KIỆN: LỆNH CHAT (!may ...)
// ============================================================================
const raw = String(ctx.content || (ctx.message && ctx.message.content) || ctx.rest || '').trim();
let words = (ctx.args && Array.isArray(ctx.args) && ctx.args.length)
  ? [...ctx.args]
  : raw.split(/\s+/).filter(Boolean);

if (words[0] && /^!may\b/i.test(words[0])) {
  words.shift();
}

const a = words;
const sub = (a[0] || '').toLowerCase();
const arg = a[1] || '';

// ============================================================================
// LỆNH PHÂN QUYỀN (CHỈ ROOT ADMIN 946662197168341053)
// ============================================================================
if (sub === 'capquyen' || sub === 'grant') {
  if (!isRootUser(userId)) return say(`⛔ Chỉ Root Admin (<@${ROOT_ADMIN}>) mới có quyền cấp phép sử dụng bot!`);
  const targetId = (arg || '').replace(/[<@!>]/g, '').trim();
  if (!targetId || !/^\d{16,21}$/.test(targetId)) return say('Dùng: `!may capquyen <@user hoặc ID>`');
  store.allowedUsers[targetId] = { id: targetId, by: userDisplay, at: Date.now() };
  return say(`✅ Đã cấp quyền sử dụng bot máy ảo cho <@${targetId}> (\`${targetId}\`)!`);
}

if (sub === 'thuquyen' || sub === 'revoke') {
  if (!isRootUser(userId)) return say(`⛔ Chỉ Root Admin (<@${ROOT_ADMIN}>) mới có quyền thu hồi!`);
  const targetId = (arg || '').replace(/[<@!>]/g, '').trim();
  if (targetId === ROOT_ADMIN) return say('❌ Không thể thu hồi quyền của Root Admin!');
  if (!store.allowedUsers[targetId]) return say(`Người dùng <@${targetId}> chưa được cấp quyền.`);
  delete store.allowedUsers[targetId];
  return say(`🗑️ Đã thu hồi quyền sử dụng bot của <@${targetId}>!`);
}

if (sub === 'dsquyen' || sub === 'listquyen') {
  if (!isRootUser(userId)) return say(`⛔ Chỉ Root Admin (<@${ROOT_ADMIN}>) mới có quyền xem danh sách!`);
  const list = Object.keys(store.allowedUsers);
  const lines = [
    `👑 **DANH SÁCH NGƯỜI ĐƯỢC PHÉP DÙNG BOT:**`,
    `• 👑 **Root Admin:** <@${ROOT_ADMIN}> (\`${ROOT_ADMIN}\`)`
  ];
  list.filter(id => id !== ROOT_ADMIN).forEach(id => {
    const u = store.allowedUsers[id];
    lines.push(`• 👤 <@${id}> (\`${id}\`) - Cấp bởi: ${u.by || 'Admin'}`);
  });
  return say(lines.join('\n'));
}

// ============================================================================
// BẢO VỆ TẤT CẢ CÁC LỆNH KHÁC: CHỈ CHO PHÉP NGƯỜI ĐÃ ĐƯỢC CẤP QUYỀN
// ============================================================================
if (!isAllowedUser(userId)) {
  return say(`⛔ Bạn chưa được cấp quyền sử dụng hệ thống máy ảo! Hãy liên hệ Admin (<@${ROOT_ADMIN}>) để được cấp phép.`);
}

// 1. TRỢ GIÚP (!may hoặc !may help)
if (!sub || sub === 'help') {
  let helpMsg = `**🚀 QUẢN LÝ MÁY ẢO STARDESK**\n\n` +
    `**📋 Danh sách lệnh:**\n` +
    `• \`!may tao <tên> [1h|3h|5h]\` : Tạo máy ảo cá nhân mới & cài StarDesk\n` +
    `• \`!may chay <tên> [1h|3h|5h]\` : Mở lại máy đã tạo\n` +
    `• \`!may ds\` : Xem danh sách máy của bạn & StarDesk ID\n` +
    `• \`!may info <tên>\` : Xem StarDesk ID, Mật khẩu, Thời gian chạy\n` +
    `• \`!may tat <tên>\` : Lưu ổ đĩa & tắt máy an toàn\n` +
    `• \`!may khoi-dong-lai <tên>\` : Lưu ổ đĩa, tắt phiên cũ và bật phiên mới\n` +
    `• \`!may xoa <tên>\` : Xóa máy và toàn bộ dữ liệu ổ đĩa`;

  if (isRootUser(userId)) {
    helpMsg += `\n\n**👑 Lệnh Admin:**\n` +
      `• \`!may capquyen <@user|id>\` : Cấp quyền dùng bot cho thành viên\n` +
      `• \`!may thuquyen <@user|id>\` : Thu hồi quyền dùng bot\n` +
      `• \`!may dsquyen\` : Xem danh sách thành viên có quyền\n` +
      `• \`!may acc\` : Xem/Cài đặt cấu hình 2 Repo & GitHub Token`;
  }
  return say(helpMsg);
}

// 2. TẠO MÁY MỚI (!may tao <tên> [thời_gian])
if (sub === 'tao' || sub === 'taolai') {
  const name = nameOk(arg);
  if (!name) return say('Thiếu tên máy. VD: `!may tao chill 5h`');
  if (['bot', 'taomay', 'may-goc'].includes(name)) return say(`Tên \`${name}\` bị giữ chỗ, hãy chọn tên khác.`);

  const existing = store.machines[name] || R.machines[name];
  if (existing && existing.ownerId && existing.ownerId !== userId && !isRootUser(userId)) {
    return say(`⛔ Tên máy **${name}** đã được đăng ký bởi <@${existing.ownerId}>. Vui lòng chọn tên khác!`);
  }

  const d = parseDur(a[2] || '5h00m');
  try {
    const tplText = await loadTemplate();
    const wfContent = prepareWorkflow(tplText, name, d.input);
    const filePath = await pushWorkflow(name, wfContent);

    // Kích hoạt workflow_dispatch
    await triggerRun(name, d.input);

    const m = store.machines[name] = R.machines[name] = {
      name,
      filePath,
      ownerId: userId,
      ownerName: userDisplay,
      duration: d.input,
      durationMin: d.min,
      createdAt: Date.now(),
      status: 'starting'
    };

    const confirmMsg = [
      `🚀 **ĐÃ TẠO MÁY [${name.toUpperCase()}] THÀNH CÔNG!**`,
      `• 👤 **Chủ sở hữu:** <@${userId}>`,
      `• 📡 **Trạng thái:** ⏳ Đang khởi động & cài StarDesk...`,
      `• ⏰ **Thời lượng:** **${d.input}**`,
      `\n💡 *Vui lòng đợi 2-3 phút để máy mở StarDesk, sau đó gõ \`!may info ${name}\` hoặc bấm nút bên dưới để lấy mã StarDesk ID!*`
    ].join('\n');

    return say(confirmMsg, { buttons: getButtons(name) });
  } catch (err) {
    return say(`❌ Lỗi tạo máy **${name}**: ${err.message}`);
  }
}

// 3. CHẠY LẠI MÁY ĐÃ CÓ (!may chay <tên> [thời_gian])
if (sub === 'chay' || sub === 'start') {
  const name = nameOk(arg);
  if (!name) return say('Dùng: `!may chay <tên_máy>`');
  const m = store.machines[name] || R.machines[name];
  if (m && m.ownerId && !canManageMachine(m, userId)) {
    return say(`⛔ Bạn không có quyền điều khiển máy **${name}**! Máy này thuộc về <@${m.ownerId}>.`);
  }

  const d = parseDur(a[2] || (m && m.duration) || '5h00m');
  try {
    await triggerRun(name, d.input);
    const curM = store.machines[name] = R.machines[name] = R.machines[name] || { name };
    curM.duration = d.input;
    curM.durationMin = d.min;
    curM.status = 'starting';
    return say(`▶️ Đã gửi lệnh khởi chạy máy **${name}** (${d.input})!`, {
      buttons: getButtons(name)
    });
  } catch (err) {
    return say(`❌ Không chạy được máy **${name}**: ${err.message}`);
  }
}

// 4. DANH SÁCH MÁY (!may ds)
if (sub === 'ds' || sub === 'list') {
  const allNames = Object.keys(store.machines);
  // Root Admin xem toàn bộ, người thường chỉ xem máy của mình
  const myNames = isRootUser(userId)
    ? allNames
    : allNames.filter(n => store.machines[n] && store.machines[n].ownerId === userId);

  if (!myNames.length) {
    return say(`😴 Bạn chưa có máy nào. Dùng \`!may tao <tên>\` để tạo máy mới!`);
  }

  say('🔄 Đang đồng bộ thông tin máy ảo...');
  const lines = [`🖥️ **DANH SÁCH MÁY ẢO CỦA BẠN:**`];
  const btnRows = [];

  for (const name of myNames) {
    const m = await syncMachine(name);
    let badge = '⚪ Đã tắt';
    if (m.status === 'in_progress') badge = m.ready ? '🟢 Online' : '⏳ Đang khởi tạo...';
    else if (m.status === 'queued') badge = '🟡 Xếp hàng';

    let item = `${badge} **${name}**`;
    if (m.stardeskId) item += ` · 🆔 StarDesk: \`${m.stardeskId}\``;
    if (m.remainSec != null && m.status === 'in_progress') item += ` · ⏰ Còn: **${hms(m.remainSec)}**`;
    if (isRootUser(userId) && m.ownerId) item += ` · 👤 <@${m.ownerId}>`;
    lines.push(item);

    btnRows.push({ id: `in:${name}`, label: `🔐 ${name}`, style: m.status === 'in_progress' ? 'primary' : 'secondary', ephemeral: true });
  }

  const rows = [];
  for (let i = 0; i < btnRows.length; i += 5) rows.push(btnRows.slice(i, i + 5));
  return say(lines.join('\n'), { buttons: rows });
}

// 5. THÔNG TIN CHI TIẾT MÁY (!may info <tên>)
if (sub === 'info' || sub === 'check') {
  const name = nameOk(arg);
  if (!name) return say('Dùng: `!may info <tên_máy>`');

  const m = store.machines[name] || R.machines[name];
  if (m && m.ownerId && !canManageMachine(m, userId)) {
    return say(`⛔ Bạn không có quyền xem máy **${name}**! Máy này thuộc quyền sở hữu của <@${m.ownerId}>.`);
  }

  const curM = await syncMachine(name);
  const isOnline = curM.status === 'in_progress' && curM.ready;
  const statusBadge = isOnline ? '🟢 Đang chạy (Sẵn sàng kết nối)' : (curM.status === 'in_progress' ? '⏳ Đang khởi động & cài StarDesk...' : (curM.status === 'queued' ? '🟡 Đang xếp hàng' : '🔴 Đã tắt'));

  const sdText = curM.stardeskId ? `\`${curM.stardeskId}\`` : '*(Chờ mở máy / Đang cài đặt...)*';
  const remText = curM.remainSec != null ? hms(curM.remainSec) : 'N/A';
  const elapText = curM.elapsedSec != null ? hms(curM.elapsedSec) : '0s';

  const card = [
    `🖥️ **THÔNG TIN MÁY: ${name.toUpperCase()}**`,
    `• 👤 **Chủ sở hữu:** <@${curM.ownerId || (m && m.ownerId) || userId}>`,
    `• 📡 **Trạng thái:** ${statusBadge}`,
    `• 🚀 **StarDesk ID:** ${sdText}`,
    curM.stardeskId ? `> 💡 *Mở app StarDesk trên máy tính -> Nhập mã ID ở trên để điều khiển máy!*` : '',
    `• 🔐 **Mật khẩu máy:** \`${curM.pass || 'Aistv@2026'}\``,
    `• ⏰ **Thời gian:** Đã chạy **${elapText}** · Còn lại **${remText}**`
  ].filter(Boolean).join('\n');

  return say(card, { buttons: getButtons(name) });
}

// 6. TẮT MÁY (!may tat <tên>)
if (sub === 'tat' || sub === 'stop' || sub === 'dung') {
  const name = nameOk(arg);
  if (!name) return say('Dùng: `!may tat <tên_máy>`');
  const m = store.machines[name] || R.machines[name];
  if (m && m.ownerId && !canManageMachine(m, userId)) {
    return say(`⛔ Bạn không có quyền tắt máy **${name}**! Máy này thuộc về <@${m.ownerId}>.`);
  }

  const curM = await syncMachine(name);
  if (!curM.runId || curM.status === 'completed') {
    return say(`Máy **${name}** hiện không có tiến trình nào đang chạy.`);
  }
  try {
    await gh('POST', RUNNER_REPO, `/actions/runs/${curM.runId}/cancel`);
    curM.status = 'completed';
    return say(`🛑 Đã gửi lệnh lưu ổ đĩa và tắt máy **${name}**.`);
  } catch (err) {
    return say(`❌ Không tắt được máy **${name}**: ${err.message}`);
  }
}

// 7. KHỞI ĐỘNG LẠI MÁY (!may khoi-dong-lai <tên>)
if (sub === 'khoi-dong-lai' || sub === 'khoidonglai' || sub === 'restart') {
  const name = nameOk(arg);
  if (!name) return say('Dùng: `!may khoi-dong-lai <tên_máy>`');
  const m = store.machines[name] || R.machines[name];
  if (m && m.ownerId && !canManageMachine(m, userId)) {
    return say(`⛔ Bạn không có quyền điều khiển máy **${name}**! Máy này thuộc về <@${m.ownerId}>.`);
  }

  const d = parseDur(a[2] || (m && m.duration) || '5h00m');
  const curM = await syncMachine(name);
  if (curM.runId && curM.status === 'in_progress') {
    say(`🛑 Đang lưu ổ đĩa và tắt phiên cũ của máy **${name}**...`);
    try { await gh('POST', RUNNER_REPO, `/actions/runs/${curM.runId}/cancel`); } catch {}
    await new Promise(r => setTimeout(r, 3000));
  }
  try {
    await triggerRun(name, d.input);
    curM.duration = d.input;
    curM.durationMin = d.min;
    curM.status = 'starting';
    curM.startedAt = Date.now();
    return say(`🔁 Đã lưu ổ đĩa và kích hoạt phiên mới cho máy **${name}** (${d.input})!`, {
      buttons: getButtons(name)
    });
  } catch (err) {
    return say(`❌ Lỗi khởi động lại máy **${name}**: ${err.message}`);
  }
}

// 8. XÓA MÁY VÀ DỮ LIỆU (!may xoa <tên>)
if (sub === 'xoa' || sub === 'del') {
  const name = nameOk(arg);
  if (!name) return say('Dùng: `!may xoa <tên_máy>`');
  const m = store.machines[name] || R.machines[name];
  if (m && m.ownerId && !canManageMachine(m, userId)) {
    return say(`⛔ Bạn không có quyền xóa máy **${name}**! Máy này thuộc về <@${m.ownerId}>.`);
  }

  // 1. Tắt tiến trình nếu đang chạy
  const curM = await syncMachine(name);
  if (curM.runId && curM.status === 'in_progress') {
    try { await gh('POST', RUNNER_REPO, `/actions/runs/${curM.runId}/cancel`); } catch {}
  }

  // 2. Xóa workflow file trên runner repo
  const filePath = `.github/workflows/${name}.yml`;
  try {
    const cur = await gh('GET', RUNNER_REPO, `/contents/${filePath}`);
    if (cur && cur.sha) {
      await gh('DELETE', RUNNER_REPO, `/contents/${filePath}`, { message: `Xóa workflow ${name}`, sha: cur.sha });
    }
  } catch {}

  // 3. Xóa storage trên repo gốc
  const relTag = `aistv-storage-${name}`;
  const stBranch = `aistv-state-${name}`;
  try {
    const rel = await gh('GET', STORAGE_REPO, `/releases/tags/${encodeURIComponent(relTag)}`);
    if (rel && rel.id) await gh('DELETE', STORAGE_REPO, `/releases/${rel.id}`);
  } catch {}
  try { await gh('DELETE', STORAGE_REPO, `/git/refs/tags/${encodeURIComponent(relTag)}`); } catch {}
  try { await gh('DELETE', STORAGE_REPO, `/git/refs/heads/${encodeURIComponent(stBranch)}`); } catch {}

  delete store.machines[name];
  delete R.machines[name];
  return say(`🗑️ Đã xóa máy **${name}** và toàn bộ dữ liệu ổ đĩa thành công!`);
}

// 9. CẤU HÌNH TÀI KHOẢN & 2 REPO (!may acc - CHỈ ROOT ADMIN)
if (sub === 'acc') {
  if (!isRootUser(userId)) return say(`⛔ Chỉ Root Admin mới có quyền truy cập cấu hình hệ thống!`);
  const opt = (arg || '').toLowerCase();
  if (opt === 'cai' || opt === 'set') {
    const runRepo = (a[2] || '').trim();
    const stRepo = (a[3] || '').trim();
    const tk = (a[4] || '').trim();
    if (!runRepo || !stRepo || !tk) {
      return say('Dùng: `!may acc cai <runner_repo> <storage_repo> <token_pat>`');
    }
    R.config.runnerRepo = store.config.runnerRepo = runRepo;
    R.config.storageRepo = store.config.storageRepo = stRepo;
    R.config.token = store.config.token = tk;
    return say(`✅ Đã lưu cấu hình:\n• Runner Repo: \`${runRepo}\`\n• Storage Repo: \`${stRepo}\`\n• Token PAT: \`${tk.slice(0, 6)}***\``);
  }

  return say(
    `⚙️ **CẤU HÌNH HỆ THỐNG 2 REPO:**\n` +
    `• 🏢 **Repo Gốc (Lưu trữ):** \`${STORAGE_REPO}\`\n` +
    `• 🏃 **Runner Repo (Treo máy):** \`${RUNNER_REPO}\`\n` +
    `• 🔑 **GitHub PAT Token:** ${GH_TOKEN ? `\`${GH_TOKEN.slice(0, 7)}***\`` : '❌ *Chưa có*'}`
  );
}

// 10. LỆNH KHÔNG XÁC ĐỊNH
return say(`❓ Không rõ lệnh: \`${sub}\`. Gõ \`!may\` hoặc \`!may help\` để xem hướng dẫn.`);
