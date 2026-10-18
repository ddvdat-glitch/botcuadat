// ============================================================================
// BOT QUẢN LÝ MÁY ẢO RDP & STARDESK (KIẾN TRÚC 2 REPO: GỐC LƯU TRỮ - RUNNER TREO MÁY)
// Trigger  : ^!may\b
// Kiểu     : regex | Kiểu trả: send
// ============================================================================
// 1. Repo Gốc (ddvdat-glitch/rdp): Lưu toàn bộ Release 7z & Nhánh State của máy gốc và máy con.
// 2. Repo Runner (ohohhoho82-alt/app): Chỉ treo máy (chạy GitHub Actions runner).
// 3. Kết nối từ xa: StarDesk 1.5.3 (lấy từ X:\Apps\StarDesk-1.5.3.exe cài ra C:\).
// ============================================================================

const https = require('https');
const path = require('path');
const fs = require('fs');

// ----------------- CẤU HÌNH HỆ THỐNG -----------------
const R = shared.rdp = shared.rdp || {};
R.machines = R.machines || {};
R.config = R.config || {};

const STORAGE_REPO = R.config.storageRepo || process.env.STORAGE_REPO || 'ddvdat-glitch/rdp';
const RUNNER_REPO = R.config.runnerRepo || process.env.RUNNER_REPO || 'ohohhoho82-alt/app';
const GH_TOKEN = R.config.token || process.env.PAT_TOKEN || process.env.RDP_GH_TOKEN || process.env.STORAGE_GH_TOKEN || process.env.GH_TOKEN || '';

const ev = ctx.event || 'message';
const isStaff = !!(ctx.user && (ctx.user.isAdmin || ctx.user.isOwner));

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
  if (opts && opts.buttons) ui.send({ content: text, buttons: opts.buttons });
  else reply(text);
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
  const localCandidates = [
    'c:/Users/acc/Downloads/badao/taomay.yml',
    'c:/Users/acc/Downloads/badao/taomay.yaml',
    path.resolve(process.cwd(), 'taomay.yml'),
    path.resolve(process.cwd(), 'taomay.yaml'),
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

  // Tải từ Repo Gốc
  try {
    const f = await gh('GET', STORAGE_REPO, '/contents/taomay.yml');
    if (f && f.content) return Buffer.from(f.content.replace(/\s+/g, ''), 'base64').toString('utf8');
  } catch {}
  try {
    const f = await gh('GET', STORAGE_REPO, '/contents/taomay.yaml');
    if (f && f.content) return Buffer.from(f.content.replace(/\s+/g, ''), 'base64').toString('utf8');
  } catch {}

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
  await gh('POST', RUNNER_REPO, `/actions/workflows/${name}.yml/dispatches`, {
    ref: 'main',
    inputs: {
      machine_id: name,
      display_name: `Máy ${name}`,
      storage_repo: STORAGE_REPO,
      duration: duration || '5h00m'
    }
  });
}

// ----------------- ĐỒNG BỘ TRẠNG THÁI MÁY & STARDESK ID -----------------
async function syncMachine(name) {
  const m = R.machines[name] = R.machines[name] || { name, created: Date.now() };
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
              const uM = rawLog.match(/User RDP\s*:\s*([^\s(│]+)/i);
              if (uM) m.user = uM[1].trim();
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
      { id: `in:${name}`, label: '🔐 Xem Thông Tin', style: 'primary' },
      { id: `st:${name}`, label: '🛑 Tắt Máy', style: 'danger' },
      { id: `rs:${name}`, label: '🔁 Khởi Động Lại', style: 'secondary' }
    ],
    [
      { id: `delstorage:${name}`, label: '💽 Xóa Ổ Đĩa (Repo Gốc)', style: 'danger' },
      { id: `delfile:${name}`, label: '🗑️ Xóa Workflow (Runner)', style: 'danger' }
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

  if (act === 'in') {
    const m = await syncMachine(name);
    const sdText = m.stardeskId ? `\`${m.stardeskId}\`` : '*(Đang cài đặt / Chờ mở máy...)*';
    const remText = m.remainSec != null ? hms(m.remainSec) : 'N/A';
    const msg = [
      `🔐 **THÔNG TIN KẾT NỐI MÁY: ${name.toUpperCase()}**`,
      `• 🚀 **StarDesk ID:** ${sdText}`,
      `> 💡 *Mở app StarDesk trên máy tính -> Nhập mã ID ở trên để điều khiển máy!*`,
      `• 👤 **User RDP:** \`${m.user || 'runneradmin'}\` · 🔐 **MK:** \`${m.pass || 'Aistv@2026'}\``,
      `• ⏰ **Thời gian còn lại:** **${remText}**`,
      `• 📦 **Repo Gốc (Lưu trữ):** \`${m.storageRepo || STORAGE_REPO}\` (\`aistv-storage-${name}\`)`,
      `• 🏃 **Runner Repo (Treo máy):** \`${m.runnerRepo || RUNNER_REPO}\``,
      m.runUrl ? `• 🔗 **Link Action:** <${m.runUrl}>` : ''
    ].filter(Boolean).join('\n');
    return ui.reply({ content: msg, ephemeral: true });
  }

  if (act === 'st') {
    const m = await syncMachine(name);
    if (!m.runId || m.status === 'completed') {
      return ui.reply({ content: `⚠️ Máy **${name}** hiện không có tiến trình nào đang chạy.`, ephemeral: true });
    }
    try {
      await gh('POST', RUNNER_REPO, `/actions/runs/${m.runId}/cancel`);
      m.status = 'completed';
      return ui.reply({ content: `🛑 Đã gửi lệnh tắt máy **${name}** trên \`${RUNNER_REPO}\`.`, ephemeral: true });
    } catch (e) {
      return ui.reply({ content: `❌ Không tắt được máy: ${e.message}`, ephemeral: true });
    }
  }

  if (act === 'rs') {
    try {
      await triggerRun(name, '5h00m');
      return ui.reply({ content: `🔁 Đang kích hoạt lại phiên mới cho máy **${name}** trên \`${RUNNER_REPO}\`!`, ephemeral: true });
    } catch (e) {
      return ui.reply({ content: `❌ Lỗi khởi động lại: ${e.message}`, ephemeral: true });
    }
  }

  if (act === 'delstorage') {
    const relTag = `aistv-storage-${name}`;
    const stBranch = `aistv-state-${name}`;
    const parts = [];
    try {
      const rel = await gh('GET', STORAGE_REPO, `/releases/tags/${encodeURIComponent(relTag)}`);
      if (rel && rel.id) {
        await gh('DELETE', STORAGE_REPO, `/releases/${rel.id}`);
        parts.push(`Release \`${relTag}\``);
      }
    } catch {}
    try {
      await gh('DELETE', STORAGE_REPO, `/git/refs/tags/${encodeURIComponent(relTag)}`);
      parts.push(`Tag \`${relTag}\``);
    } catch {}
    try {
      await gh('DELETE', STORAGE_REPO, `/git/refs/heads/${encodeURIComponent(stBranch)}`);
      parts.push(`Nhánh \`${stBranch}\``);
    } catch {}
    const resMsg = parts.length
      ? `💽 Đã xóa bộ nhớ máy **${name}** trên Repo Gốc (\`${STORAGE_REPO}\`): ${parts.join(', ')}.`
      : `ℹ️ Máy **${name}** không có bộ nhớ nào trên Repo Gốc (\`${STORAGE_REPO}\`).`;
    return ui.reply({ content: resMsg, ephemeral: true });
  }

  if (act === 'delfile') {
    const filePath = `.github/workflows/${name}.yml`;
    try {
      const cur = await gh('GET', RUNNER_REPO, `/contents/${filePath}`);
      if (cur && cur.sha) {
        await gh('DELETE', RUNNER_REPO, `/contents/${filePath}`, {
          message: `Xóa workflow máy ${name}`,
          sha: cur.sha
        });
        delete R.machines[name];
        return ui.reply({ content: `🗑️ Đã xóa file workflow \`${name}.yml\` trên Runner Repo (\`${RUNNER_REPO}\`).`, ephemeral: true });
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
const raw = (ctx.message && ctx.message.content) || '';
const a = ctx.args && ctx.args.length ? ctx.args : raw.trim().split(/\s+/).slice(1);
const sub = (a[0] || '').toLowerCase();
const arg = a[1] || '';

// 1. TRỢ GIÚP (!may hoặc !may help)
if (!sub || sub === 'help') {
  return say(
    `**🚀 QUẢN LÝ MÁY ẢO RDP & STARDESK (2 REPO GỐC - RUNNER)**\n` +
    `• **Repo Gốc (Lưu trữ tất cả):** \`${STORAGE_REPO}\`\n` +
    `• **Repo Runner (Chỉ treo máy):** \`${RUNNER_REPO}\`\n\n` +
    `**📋 Danh sách lệnh:**\n` +
    `• \`!may tao <tên> [1h|3h|5h]\` : Tạo workflow từ taomay.yml -> Ném sang Runner Repo -> Kích hoạt chạy\n` +
    `• \`!may chay <tên> [1h|3h|5h]\` : Chạy lại máy đã có trên Runner Repo\n` +
    `• \`!may ds\` : Xem danh sách máy, thời gian chạy & StarDesk ID\n` +
    `• \`!may info <tên>\` : Xem StarDesk ID, User, Password, Uptime & link Actions\n` +
    `• \`!may tat <tên>\` : Lưu ổ đĩa & tắt máy ngay lập tức\n` +
    `• \`!may khoi-dong-lai <tên>\` : Hủy phiên cũ và khởi chạy phiên mới\n` +
    `• \`!may bonho <tên>\` : Xem dung lượng Release & State trên Repo Gốc\n` +
    `• \`!may xoabonho <tên>\` : Xóa sạch Release & State của máy trên Repo Gốc\n` +
    `• \`!may xoafile <tên>\` : Xóa file workflow của máy trên Runner Repo\n` +
    `• \`!may acc\` : Xem/cài đặt thông tin 2 Repo và GitHub Token\n` +
    `• \`!may log <tên>\` : Lấy link xem trực tiếp tiến trình trên GitHub`
  );
}

// 2. TẠO MÁY MỚI (!may tao <tên> [thời_gian])
if (sub === 'tao' || sub === 'taolai') {
  const name = nameOk(arg);
  if (!name) return say('Thiếu tên máy. VD: `!may tao chill 5h`');
  if (['bot', 'taomay', 'may-goc'].includes(name)) return say(`Tên \`${name}\` bị giữ chỗ, hãy chọn tên khác.`);

  const d = parseDur(a[2] || '5h00m');
  say(`⏳ Đang sao chép \`taomay.yml\` từ Repo Gốc (\`${STORAGE_REPO}\`) và ném sang Runner Repo (\`${RUNNER_REPO}\`)...`);

  try {
    const tplText = await loadTemplate();
    const wfContent = prepareWorkflow(tplText, name, d.input);
    const filePath = await pushWorkflow(name, wfContent);

    // Kích hoạt workflow_dispatch
    await triggerRun(name, d.input);

    const m = R.machines[name] = {
      name,
      filePath,
      runnerRepo: RUNNER_REPO,
      storageRepo: STORAGE_REPO,
      duration: d.input,
      durationMin: d.min,
      createdAt: Date.now(),
      owner: (ctx.user && ctx.user.display) || 'Admin',
      ownerId: (ctx.user && ctx.user.id) || '',
      status: 'starting'
    };

    const confirmMsg = [
      `🚀 **ĐÃ TẠO MÁY [${name.toUpperCase()}] THÀNH CÔNG!**`,
      `• 📄 **File Workflow:** \`${filePath}\``,
      `• 🏃 **Nơi treo máy (Runner Repo):** \`${RUNNER_REPO}\``,
      `• 📦 **Nơi lưu trữ ổ đĩa (Repo Gốc):** \`${STORAGE_REPO}\``,
      `• ♻️ **Ổ đĩa khởi tạo:** Kế thừa từ \`aistv-storage-may-goc\` trên Repo Gốc`,
      `• ⏰ **Thời lượng:** **${d.input}**`,
      `\n⏳ *Máy đang khởi động & tự động cài StarDesk 1.5.3... Gõ \`!may info ${name}\` sau 2-3 phút để lấy mã StarDesk ID!*`
    ].join('\n');

    return say(confirmMsg, { buttons: getButtons(name) });
  } catch (err) {
    return say(`❌ Lỗi tạo máy **${name}**: ${err.message}`);
  }
}

// 3. CHẠY LẠI MÁY ĐÃ CÓ (!may chay <tên> [thời_gian])
if (sub === 'chay' || sub === 'start') {
  const name = nameOk(arg);
  if (!name) return say('Dùng: `!may chay <tên_máy> [1h|3h|5h]`');
  const d = parseDur(a[2] || '5h00m');
  try {
    await triggerRun(name, d.input);
    const m = R.machines[name] = R.machines[name] || { name };
    m.duration = d.input;
    m.durationMin = d.min;
    m.status = 'starting';
    return say(`▶️ Đã gửi lệnh chạy máy **${name}** (${d.input}) trên \`${RUNNER_REPO}\`!\n📦 Dữ liệu sẽ tiếp tục nạp và lưu vào \`${STORAGE_REPO}\`.`, {
      buttons: getButtons(name)
    });
  } catch (err) {
    return say(`❌ Không chạy được máy **${name}**: ${err.message}`);
  }
}

// 4. DANH SÁCH MÁY (!may ds)
if (sub === 'ds' || sub === 'list') {
  const names = Object.keys(R.machines);
  if (!names.length) {
    return say(`😴 Chưa có máy nào trong danh sách. Dùng \`!may tao <tên>\` để tạo máy mới!`);
  }

  say('🔄 Đang đồng bộ thông tin máy ảo từ GitHub Actions...');
  const lines = [`🖥️ **DANH SÁCH MÁY ẢO TREO TẠI \`${RUNNER_REPO}\`:**`];
  const btnRows = [];

  for (const name of names) {
    const m = await syncMachine(name);
    let badge = '⚪ Đã tắt';
    if (m.status === 'in_progress') badge = m.ready ? '🟢 Online' : '⏳ Đang khởi tạo...';
    else if (m.status === 'queued') badge = '🟡 Xếp hàng';

    let item = `${badge} **${name}**`;
    if (m.stardeskId) item += ` · 🆔 StarDesk: \`${m.stardeskId}\``;
    if (m.remainSec != null && m.status === 'in_progress') item += ` · ⏰ Còn: **${hms(m.remainSec)}**`;
    lines.push(item);

    btnRows.push({ id: `in:${name}`, label: `🔐 ${name}`, style: m.status === 'in_progress' ? 'primary' : 'secondary' });
  }

  const rows = [];
  for (let i = 0; i < btnRows.length; i += 5) rows.push(btnRows.slice(i, i + 5));
  return say(lines.join('\n'), { buttons: rows });
}

// 5. THÔNG TIN CHI TIẾT MÁY (!may info <tên>)
if (sub === 'info' || sub === 'check') {
  const name = nameOk(arg);
  if (!name) return say('Dùng: `!may info <tên_máy>`');

  const m = await syncMachine(name);
  const isOnline = m.status === 'in_progress' && m.ready;
  const statusBadge = isOnline ? '🟢 Đang chạy (Sẵn sàng kết nối)' : (m.status === 'in_progress' ? '⏳ Đang khởi động & cài StarDesk...' : (m.status === 'queued' ? '🟡 Đang xếp hàng' : '🔴 Đã tắt'));

  const sdText = m.stardeskId ? `\`${m.stardeskId}\`` : '*(Chờ mở máy hoặc kiểm tra trên giao diện)*';
  const remText = m.remainSec != null ? hms(m.remainSec) : 'N/A';
  const elapText = m.elapsedSec != null ? hms(m.elapsedSec) : '0s';

  const card = [
    `🖥️ **THÔNG TIN MÁY: ${name.toUpperCase()}**`,
    `• 📡 **Trạng thái:** ${statusBadge}`,
    `• 🚀 **StarDesk ID:** ${sdText}`,
    m.stardeskId ? `> 💡 *Mở app StarDesk trên máy tính của bạn -> Nhập mã ID ở trên để điều khiển máy!*` : '',
    `• 👤 **User RDP:** \`${m.user || 'runneradmin'}\` · 🔐 **Mật khẩu:** \`${m.pass || 'Aistv@2026'}\``,
    `• ⏰ **Thời gian:** Đã chạy **${elapText}** · Còn lại **${remText}**`,
    `• 📦 **Kho lưu trữ (Repo Gốc):** \`${m.storageRepo || STORAGE_REPO}\` (\`aistv-storage-${name}\`)`,
    `• 🏃 **Nơi treo máy (Runner Repo):** \`${m.runnerRepo || RUNNER_REPO}\``,
    m.runUrl ? `• 🔗 **Link Action:** <${m.runUrl}>` : ''
  ].filter(Boolean).join('\n');

  return say(card, { buttons: getButtons(name) });
}

// 6. TẮT MÁY (!may tat <tên>)
if (sub === 'tat' || sub === 'stop' || sub === 'dung') {
  const name = nameOk(arg);
  if (!name) return say('Dùng: `!may tat <tên_máy>`');
  const m = await syncMachine(name);
  if (!m.runId || m.status === 'completed') {
    return say(`Máy **${name}** hiện không có tiến trình nào đang chạy.`);
  }
  try {
    await gh('POST', RUNNER_REPO, `/actions/runs/${m.runId}/cancel`);
    m.status = 'completed';
    return say(`🛑 Đã gửi lệnh tắt máy **${name}** trên \`${RUNNER_REPO}\`.`);
  } catch (err) {
    return say(`❌ Không tắt được máy **${name}**: ${err.message}`);
  }
}

// 7. KHỞI ĐỘNG LẠI MÁY (!may khoi-dong-lai <tên>)
if (sub === 'khoi-dong-lai' || sub === 'khoidonglai' || sub === 'restart') {
  const name = nameOk(arg);
  if (!name) return say('Dùng: `!may khoi-dong-lai <tên_máy>`');
  const d = parseDur(a[2] || '5h00m');
  const m = await syncMachine(name);
  if (m.runId && m.status === 'in_progress') {
    try { await gh('POST', RUNNER_REPO, `/actions/runs/${m.runId}/cancel`); } catch {}
  }
  try {
    await triggerRun(name, d.input);
    m.duration = d.input;
    m.durationMin = d.min;
    m.status = 'starting';
    return say(`🔁 Đang khởi động lại phiên làm việc mới cho máy **${name}** (${d.input}) trên \`${RUNNER_REPO}\`!`, {
      buttons: getButtons(name)
    });
  } catch (err) {
    return say(`❌ Lỗi khởi động lại máy **${name}**: ${err.message}`);
  }
}

// 8. KIỂM TRA BỘ NHỚ LƯU TRỮ TRÊN REPO GỐC (!may bonho <tên>)
if (sub === 'bonho' || sub === 'storage') {
  const name = nameOk(arg);
  if (!name) return say('Dùng: `!may bonho <tên_máy>`');
  const relTag = `aistv-storage-${name}`;
  const stBranch = `aistv-state-${name}`;
  const lines = [`💽 **BỘ NHỚ LƯU TRỮ CỦA MÁY [${name.toUpperCase()}] TRÊN REPO GỐC (\`${STORAGE_REPO}\`):**`];

  try {
    const rel = await gh('GET', STORAGE_REPO, `/releases/tags/${encodeURIComponent(relTag)}`);
    const assets = (rel && rel.assets) || [];
    const totalBytes = assets.reduce((s, x) => s + (x.size || 0), 0);
    const mb = (totalBytes / (1024 * 1024)).toFixed(1);
    lines.push(`• 📦 **Release Ổ Đĩa (${relTag}):** ${mb} MB (${assets.length} file mảnh)`);
  } catch {
    lines.push(`• 📦 **Release Ổ Đĩa (${relTag}):** *(Chưa có hoặc đã xóa)*`);
  }

  try {
    await gh('GET', STORAGE_REPO, `/branches/${encodeURIComponent(stBranch)}`);
    lines.push(`• 🌿 **Nhánh Git State (${stBranch}):** ✅ Đang tồn tại`);
  } catch {
    lines.push(`• 🌿 **Nhánh Git State (${stBranch}):** *(Chưa có hoặc đã xóa)*`);
  }

  return say(lines.join('\n'));
}

// 9. XÓA BỘ NHỚ TRÊN REPO GỐC (!may xoabonho <tên>)
if (sub === 'xoabonho' || sub === 'resetbonho') {
  const name = nameOk(arg);
  if (!name) return say('Dùng: `!may xoabonho <tên_máy>`');
  const relTag = `aistv-storage-${name}`;
  const stBranch = `aistv-state-${name}`;
  const parts = [];

  try {
    const rel = await gh('GET', STORAGE_REPO, `/releases/tags/${encodeURIComponent(relTag)}`);
    if (rel && rel.id) {
      await gh('DELETE', STORAGE_REPO, `/releases/${rel.id}`);
      parts.push(`Release \`${relTag}\``);
    }
  } catch {}
  try {
    await gh('DELETE', STORAGE_REPO, `/git/refs/tags/${encodeURIComponent(relTag)}`);
    parts.push(`Tag \`${relTag}\``);
  } catch {}
  try {
    await gh('DELETE', STORAGE_REPO, `/git/refs/heads/${encodeURIComponent(stBranch)}`);
    parts.push(`Nhánh \`${stBranch}\``);
  } catch {}

  if (!parts.length) {
    return say(`ℹ️ Máy **${name}** không có bộ nhớ nào trên Repo Gốc (\`${STORAGE_REPO}\`).`);
  }
  return say(`🧹 **[${name}]** Đã xóa sạch bộ nhớ trên Repo Gốc (\`${STORAGE_REPO}\`): ${parts.join(', ')}.`);
}

// 10. XÓA WORKFLOW TRÊN RUNNER REPO (!may xoafile <tên>)
if (sub === 'xoafile') {
  const name = nameOk(arg);
  if (!name) return say('Dùng: `!may xoafile <tên_máy>`');
  const filePath = `.github/workflows/${name}.yml`;
  try {
    const cur = await gh('GET', RUNNER_REPO, `/contents/${filePath}`);
    if (cur && cur.sha) {
      await gh('DELETE', RUNNER_REPO, `/contents/${filePath}`, {
        message: `Xóa workflow máy ${name}`,
        sha: cur.sha
      });
      delete R.machines[name];
      return say(`🗑️ Đã xóa file workflow \`${filePath}\` trên Runner Repo (\`${RUNNER_REPO}\`).`);
    }
  } catch (err) {
    return say(`❌ Không xóa được file workflow: ${err.message}`);
  }
}

// 11. XÓA MÁY KHỎI BỘ NHỚ (!may xoa <tên>)
if (sub === 'xoa' || sub === 'del') {
  const name = nameOk(arg);
  if (!name) return say('Dùng: `!may xoa <tên_máy>`');
  delete R.machines[name];
  return say(`🗑️ Đã xóa máy **${name}** khỏi danh sách theo dõi của bot.`);
}

// 12. CẤU HÌNH TÀI KHOẢN & 2 REPO (!may acc)
if (sub === 'acc') {
  const opt = (arg || '').toLowerCase();
  if (opt === 'cai' || opt === 'set') {
    const runRepo = (a[2] || '').trim();
    const stRepo = (a[3] || '').trim();
    const tk = (a[4] || '').trim();
    if (!runRepo || !stRepo || !tk) {
      return say('Dùng: `!may acc cai <runner_repo> <storage_repo> <token_pat>`\nVD: `!may acc cai ohohhoho82-alt/app ddvdat-glitch/rdp ghp_xxxx`');
    }
    R.config.runnerRepo = runRepo;
    R.config.storageRepo = stRepo;
    R.config.token = tk;
    return say(`✅ Đã lưu cấu hình:\n• Runner Repo: \`${runRepo}\`\n• Storage Repo: \`${stRepo}\`\n• Token PAT: \`${tk.slice(0, 6)}***\``);
  }

  return say(
    `⚙️ **CẤU HÌNH HỆ THỐNG 2 REPO HIỆN TẠI:**\n` +
    `• 🏢 **Repo Gốc (Lưu trữ):** \`${STORAGE_REPO}\`\n` +
    `• 🏃 **Runner Repo (Treo máy):** \`${RUNNER_REPO}\`\n` +
    `• 🔑 **GitHub PAT Token:** ${GH_TOKEN ? `\`${GH_TOKEN.slice(0, 7)}***\`` : '❌ *Chưa có (cần gán PAT_TOKEN)*'}\n\n` +
    `👉 Cài đặt/đổi cấu hình bằng:\n\`!may acc cai <runner_repo> <storage_repo> <token_pat>\``
  );
}

// 13. XEM LOG (!may log <tên>)
if (sub === 'log') {
  const name = nameOk(arg);
  if (!name) return say('Dùng: `!may log <tên_máy>`');
  const m = await syncMachine(name);
  if (m.runUrl) return say(`🔗 Link theo dõi log trực tiếp trên GitHub: <${m.runUrl}>`);
  return say(`Không tìm thấy link run của máy **${name}** trên \`${RUNNER_REPO}\`.`);
}
