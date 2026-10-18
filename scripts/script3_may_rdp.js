// ============================================================================
// CÀI SCRIPT NÀY TRÊN WEB (tab Script > Thêm script), dán toàn bộ file này vào ô code:
//   Tên       : Quản lý máy RDP
//   Ngôn ngữ  : JavaScript
//   Trigger   : ^!may\b        Kiểu khớp: regex      Kiểu trả: send
//   Cooldown  : 3              Thời gian tối đa: 30000
//   (ô "Chỉ nhận tin từ ID" và "Kênh" để TRỐNG)
// ============================================================================
// Lệnh (trigger regex ^!may\b):
//   --- CÁC LỆNH GỐC (GIỮ NGUYÊN) ---
//   !may                               trợ giúp
//   !may tao <tên> [1h|3h|5h] [acc]    tạo file workflow (từ taomay.yaml) -> ném sang repo runner -> chạy action (hỗ trợ chọn acc git)
//   !may chay <tên> [1h|3h|5h] [acc]   chạy lại action của máy đã có
//   !may ds                            danh sách action đang chạy ở mọi acc + nút xem thông tin ẩn
//   !may log <tên|runId>               danh sách bước + link trang log trực tiếp
//   !may log <tên|runId> <n|cuoi|all>  đọc log bước n | cuoi = bước mới nhất | all = gửi file đầy đủ
//   !may dung <tên>                    hủy action đang chạy của máy (tắt action ngay)
//   !may ts <authkey>                  (Admin) lưu Tailscale auth key cố định vào data.json
//   !may pass <mật_khẩu>               (Admin) lưu mật khẩu RDP cố định để hiện trong bảng ẩn
//   !may xoa <tên>                     (Admin) xóa máy khỏi danh sách ghi nhận
//   !may xem owner|all                 (Admin) ai được xem bảng đăng nhập ẩn
//   !may cfg                           (Admin) xem cấu hình đang dùng
//
//   --- CÁC LỆNH NÂNG CẤP MỚI ---
//   !may info <tên>                    kiểm tra thời gian & lấy danh sách thông tin trực tiếp từ IP máy ảo
//   !may lenh <tên> <save|restart|stop|ping|pass|msg> [nội_dung]
//                                      gửi lệnh trực tiếp về IP máy ảo (Lưu ngay, Khởi động phiên mới, Tắt máy, Đổi MK...)
//   !may khoi-dong-lai <tên> [1h|3h|5h] tắt action cũ (hoặc gửi lệnh lưu+restart) & khởi động tiến trình mới
//   !may tat <tên>                     gửi lệnh lưu ổ đĩa & tắt máy an toàn qua IP (hoặc hủy action nếu kẹt)
//   !may taolai <tên> [1h|3h|5h] [acc] xóa file workflow cũ trên repo runner, tạo lại từ taomay.yaml mới nhất & chạy lại
//   !may xoafile <tên>                 (Admin) xóa hẳn file workflow <tên>.yml trên repo
//   !may xoaaction <tên>               (Admin) hủy và xóa toàn bộ lịch sử workflow runs của máy trên repo
//   !may bonho <tên>                   kiểm tra dung lượng ổ đĩa lưu trữ trên Repo Gốc (GitHub Release & nhánh State)
//   !may xoabonho <tên>                (Admin/Chủ máy) xóa sạch bộ nhớ máy (Release aistv-storage-<tên> & nhánh aistv-state-<tên>) trên Repo Gốc
//   !may giao <tên> <@user|userId> [tên_hiển_thị]
//                                      (Admin/Chủ máy) trao quyền / đánh dấu ID máy cho người dùng cụ thể
//   !may thuhoi <tên>                  (Admin) thu hồi quyền sở hữu máy về Admin
//   !may quyen <@user|userId> <số_máy> (Admin) cấp giới hạn số máy tối đa cho 1 người dùng (mặc định 1)
//   !may acc                           (Admin) danh sách các tài khoản GitHub (Token + Repo) đang quản lý
//   !may acc them <alias> <owner/repo> <token> [nhánh] [file_mẫu]
//                                      (Admin) thêm/cập nhật tài khoản Git & repo chạy máy ảo
//   !may acc xoa <alias>               (Admin) xóa tài khoản Git
//   !may acc chon <alias>              (Admin) đặt tài khoản Git mặc định khi tạo máy mới
//   !may duck <token> [domain]         (Admin) cập nhật DuckDNS token & trỏ IP về datdemo.duckdns.org
// ============================================================================

const fs = require('fs');
const path = require('path');

const R = shared.rdp = shared.rdp || {};
R.machines = R.machines || {};
R.accounts = R.accounts || {};
R.quotas = R.quotas || {};
R.sessions = R.sessions || {};
R.duckdns = R.duckdns || { domain: process.env.DUCKDNS_DOMAIN || 'datdemo.duckdns.org', token: process.env.DUCKDNS_TOKEN || '' };

const ev = ctx.event || 'message';
const isStaff = !!(ctx.user.isAdmin || ctx.user.isOwner);
const ENV = process.env;
const API = 'https://api.github.com';
const TEMPLATE_FROM = 'may-phu-2';
const BOT_FILES = ['bot.yml', 'bot.yaml'];
const POLL_SEC = 30, POLL_MAX = 90;              // dò log tối đa 90 x 30s = 45 phút
const REFRESH_SEC = 600;                         // cập nhật tin trạng thái mỗi 10 phút
const MAX_MACHINE = 24;

// Đồng bộ dữ liệu từ rdp-bridge-state.json (do các máy ảo ở các Actions khác gửi về qua datdemo.duckdns.org)
const CANDIDATE_BRIDGE_FILES = [
  path.join(process.cwd(), 'rdp-bridge-state.json'),
  path.join(require('os').tmpdir(), 'rdp-bridge-state.json'),
  path.join(process.cwd(), '..', 'rdp-bridge-state.json'),
  path.join(process.cwd(), 'app', 'rdp-bridge-state.json')
];

function syncFromBridgeFile() {
  try {
    let br = null;
    for (const bf of CANDIDATE_BRIDGE_FILES) {
      try {
        if (fs.existsSync(bf)) {
          br = JSON.parse(fs.readFileSync(bf, 'utf8'));
          if (br && (br.machines || br.sessions || br.accounts)) break;
        }
      } catch {}
    }
    // Nếu có state được chuyển trực tiếp qua biến shared.rdp
    if (typeof shared !== 'undefined' && shared && shared.rdp) {
      br = Object.assign({}, shared.rdp, br || {});
    }
    if (!br) return;

    if (br.accounts) {
      for (const [k, v] of Object.entries(br.accounts)) {
        R.accounts[k] = Object.assign(R.accounts[k] || {}, v);
      }
    }
    if (br.defaultAccount && !R.defaultAccount) R.defaultAccount = br.defaultAccount;
    if (br.duckdns && br.duckdns.token) R.duckdns = Object.assign(R.duckdns || {}, br.duckdns);
    if (br.machines) {
      for (const [k, vm] of Object.entries(br.machines)) {
        const cur = R.machines[k] = R.machines[k] || { name: k, file: k + '.yml', created: Date.now() };
        if (vm.lastReportAt && (!cur.lastReportAt || vm.lastReportAt >= cur.lastReportAt)) {
          cur.lastReportAt = vm.lastReportAt;
          if (vm.repo) cur.repo = vm.repo;
          if (vm.accName) cur.accName = vm.accName;
          if (vm.runId) cur.runId = vm.runId;
          if (vm.status) cur.status = vm.status;
          if (vm.startMs) cur.startMs = vm.startMs;
          if (vm.minutes) cur.minutes = vm.minutes;
          if (vm.ownerId && !cur.ownerId) { cur.ownerId = vm.ownerId; cur.owner = vm.owner; }
          if (vm.autoPrompt) cur.autoPrompt = vm.autoPrompt;
          if (vm.currentSessionId) cur.currentSessionId = vm.currentSessionId;
          if (vm.lastFileReceived) cur.lastFileReceived = vm.lastFileReceived;
          if (vm.lastFileAt) cur.lastFileAt = vm.lastFileAt;
          if (vm.fileData) cur.fileData = vm.fileData;
          if (vm.info) {
            cur.info = Object.assign(cur.info || {}, vm.info);
            if (cur.info.ip) cur.infoAt = cur.infoAt || Date.now();
          }
        } else if (vm.fileData && !cur.fileData) {
          cur.fileData = vm.fileData;
        }
      }
    }
    if (br.sessions) {
      R.sessions = R.sessions || {};
      for (const [k, v] of Object.entries(br.sessions)) {
        R.sessions[k] = v;
      }
    }
  } catch {}
}

function saveToBridgeFile() {
  try {
    const dataObj = {
      accounts: R.accounts,
      defaultAccount: R.defaultAccount,
      machines: R.machines,
      duckdns: R.duckdns,
      sessions: R.sessions
    };
    const jsonStr = JSON.stringify(dataObj, null, 2);
    try { fs.writeFileSync(path.join(process.cwd(), 'rdp-bridge-state.json'), jsonStr, 'utf8'); } catch {}
    try { fs.writeFileSync(path.join(require('os').tmpdir(), 'rdp-bridge-state.json'), jsonStr, 'utf8'); } catch {}
    if (typeof shared !== 'undefined' && shared) {
      shared.rdp = Object.assign(shared.rdp || {}, dataObj);
    }
  } catch {}
}

// Đọc file JSON từ ổ D:\ đã gửi về máy chủ hoặc tái hiện đầy đủ cấu trúc 28 trường
function getMachineFullJson(m, name) {
  name = String(name || (m && m.name) || '').toLowerCase();
  m = m || R.machines[name] || {};
  const osTmp = (typeof require === 'function' && require('os')) ? require('os').tmpdir() : '';
  const searchDirs = [
    process.cwd(),
    osTmp,
    path.join(process.cwd(), 'received-files'),
    path.join(osTmp, 'received-files'),
    path.join(process.cwd(), 'rdp-sessions', name),
    path.join(osTmp, 'rdp-sessions', name),
    path.join(process.cwd(), 'app'),
    path.join(process.cwd(), 'app', 'received-files')
  ].filter(Boolean);

  const fileNames = [
    `machine-info-${name}.json`,
    m.lastFileReceived,
    m.currentSessionId ? `${name}-${m.currentSessionId}.json` : null,
    'info.json'
  ].filter(Boolean);

  let diskObj = null;
  for (const dir of searchDirs) {
    for (const fn of fileNames) {
      try {
        const fp = path.join(dir, fn);
        if (fs.existsSync(fp)) {
          const raw = fs.readFileSync(fp, 'utf8');
          const parsed = JSON.parse(raw);
          if (parsed && (parsed.machineId || parsed.sessionId || parsed.ip || parsed.tailscaleIp || parsed.stardeskId)) {
            diskObj = parsed;
            break;
          }
        }
      } catch {}
    }
    if (diskObj) break;
  }

  const memData = (m && m.fileData) ||
    (R.sessions && R.sessions[name] && R.sessions[name].length && R.sessions[name][R.sessions[name].length - 1].fileData) || null;

  const src = diskObj || memData || {};
  const inf = m.info || {};
  const sid = String(src.sessionId || m.currentSessionId || (name + '-' + (m.runId || Date.now()))).trim();
  const tailIp = String(src.tailscaleIp || src.ip || inf.tailscaleIp || inf.ip || '').trim();
  const rUser = String(src.user || inf.user || 'runneradmin').trim();
  const rPass = String(src.password || src.pass || inf.password || inf.pass || '').trim();
  const wPort = String(src.webPort || inf.webPort || '8080').trim();
  const sPort = String(src.sunshinePort || inf.sunshinePort || '47990').trim();
  const sUrl = String(src.sunshineUrl || (tailIp ? `https://${tailIp}:${sPort}/` : '')).trim();
  const pUrl = String(src.panelUrl || (tailIp ? `http://${tailIp}:${wPort}/` : '')).trim();
  const osB = String(src.osBuild || inf.osBuild || '20348').trim();
  const winImg = String(src.windowsImage || inf.windowsImage || 'windows-2022').trim();
  const dLetter = String(src.driveLetter || (inf.disk ? inf.disk.charAt(0) : 'X')).trim();
  const sRoot = String(src.sharedRoot || `${dLetter}:\\AISTV-SYSTEM`).trim();
  const pPath = String(src.profilePath || inf.profile || `C:\\Users\\${rUser}`).trim();
  const aDev = String(src.audioDevice || src.audio || inf.audio || 'Speakers (VB-Audio Virtual Cable), CABLE Output (VB-Audio Virtual Cable), VB-Audio Virtual Cable').trim();
  const res = String(src.resolution || src.screen || inf.screen || '1920x1080@60').trim();
  const sEpoch = Number(src.startEpoch || (m.startMs ? Math.floor(m.startMs / 1000) : 0));
  const durM = Number(src.durationMinutes || m.minutes || 300);
  const remSec = Number(src.remainSeconds != null ? src.remainSeconds : (m.startMs ? Math.max(0, Math.floor((m.startMs + durM * 60000 - Date.now()) / 1000)) : 0));
  const repo = String(src.repo || m.repo || (getAcc(m) && getAcc(m).repo) || '').trim();
  const relTag = String(src.releaseTag || inf.repoTag || `aistv-storage-${name}`).trim();
  const stBranch = String(src.stateBranch || inf.stateBranch || `aistv-state-${name}`).trim();
  const runId = String(src.runId || m.runId || '').trim();
  const sdStat = String(src.stardeskStatus || inf.stardesk || 'Chờ khởi tạo').trim();
  const dUsed = Number(src.diskUsedGb != null ? src.diskUsedGb : (inf.diskUsedGb != null ? inf.diskUsedGb : 0));
  const dFree = Number(src.diskFreeGb != null ? src.diskFreeGb : (inf.diskFreeGb != null ? inf.diskFreeGb : 0));
  const stat = String(src.status || m.status || 'ready').trim();
  const reason = String(src.reason || inf.eventReason || 'heartbeat').trim();
  const tUtc = String(src.timestampUtc || inf.updatedUtc || new Date().toISOString()).trim();

  return {
    sessionId: sid,
    machineId: name,
    stardeskId: String(src.stardeskId || inf.stardeskId || '').trim(),
    storageRepo: String(src.storageRepo || inf.storageRepo || R.storageRepo || defaultStorageRepo).trim(),
    runnerRepo: String(src.runnerRepo || src.repo || inf.runnerRepo || repo || defaultRunnerRepo).trim(),
    tailscaleIp: tailIp,
    ip: tailIp,
    user: rUser,
    password: rPass,
    sunshineUrl: sUrl,
    panelUrl: pUrl,
    webPort: wPort,
    sunshinePort: sPort,
    osBuild: osB,
    windowsImage: winImg,
    driveLetter: dLetter,
    sharedRoot: sRoot,
    profilePath: pPath,
    audioDevice: aDev,
    resolution: res,
    startEpoch: sEpoch,
    durationMinutes: durM,
    remainSeconds: remSec,
    repo: repo,
    releaseTag: relTag,
    stateBranch: stBranch,
    runId: runId,
    stardeskStatus: sdStat,
    diskUsedGb: dUsed,
    diskFreeGb: dFree,
    status: stat,
    reason: reason,
    timestampUtc: tUtc
  };
}
syncFromBridgeFile();

const defaultStorageRepo = R.storageRepo || ENV.STORAGE_REPO || 'ddvdat-glitch/rdp';
const defaultRunnerRepo = R.runnerRepo || ENV.RUNNER_REPO || (ENV.GITHUB_REPOSITORY !== 'ddvdat-glitch/rdp' && ENV.GITHUB_REPOSITORY ? ENV.GITHUB_REPOSITORY : 'ohohhoho82-alt/app');
const defaultRepo = R.repo || defaultRunnerRepo;
const defaultToken = ENV.PAT_TOKEN || ENV.RDP_GH_TOKEN || ENV.GH_TOKEN || R.ghToken || '';
const defaultStorageToken = ENV.STORAGE_GH_TOKEN || ENV.GH_PAT_CROSS_REPO || ENV.PAT_TOKEN || defaultToken;
const defaultTemplate = 'taomay.yaml';
const wfRef = String(ENV.GITHUB_WORKFLOW_REF || '');
const defaultWfDir = R.dir || ((wfRef.match(/^[^/]+\/[^/]+\/(.+)\/[^/@]+@/) || [])[1]) || '.github/workflows';

// Khởi tạo tài khoản mặc định (hướng về Runner Repo, template taomay.yaml)
if (!R.accounts.default) {
  R.accounts.default = {
    alias: 'default',
    repo: defaultRepo,
    token: defaultToken,
    branch: R.ref || ENV.GITHUB_REF_NAME || 'main',
    wfDir: defaultWfDir,
    template: R.template || defaultTemplate
  };
  if (!R.defaultAccount) R.defaultAccount = 'default';
}

function getStorageAcc(m) {
  const stRepo = (m && m.info && m.info.storageRepo) || R.storageRepo || defaultStorageRepo;
  const stToken = ENV.STORAGE_GH_TOKEN || ENV.GH_PAT_CROSS_REPO || ENV.PAT_TOKEN || defaultStorageToken;
  return {
    alias: 'storage',
    repo: stRepo,
    token: stToken,
    branch: 'main'
  };
}

function getAcc(aliasOrMachine) {
  if (aliasOrMachine && typeof aliasOrMachine === 'object') {
    const m = aliasOrMachine;
    if (m.accName && R.accounts[m.accName]) return R.accounts[m.accName];
    if (m.repo) {
      const hit = Object.values(R.accounts).find(a => a.repo && a.repo.toLowerCase() === String(m.repo).toLowerCase());
      if (hit) return hit;
    }
  } else if (typeof aliasOrMachine === 'string' && R.accounts[aliasOrMachine]) {
    return R.accounts[aliasOrMachine];
  }
  const defKey = R.defaultAccount && R.accounts[R.defaultAccount] ? R.defaultAccount : Object.keys(R.accounts)[0];
  if (defKey && R.accounts[defKey]) return R.accounts[defKey];
  return {
    alias: 'default',
    repo: defaultRepo,
    token: defaultToken,
    branch: R.ref || ENV.GITHUB_REF_NAME || '',
    wfDir: defaultWfDir,
    template: R.template || defaultTemplate
  };
}

function getAllAccounts() {
  const list = Object.values(R.accounts).filter(a => a && a.repo && a.token);
  if (!list.length && defaultRepo && defaultToken) {
    return [getAcc()];
  }
  return list;
}

// ---------- tiện ích ----------
const nameOk = s => String(s || '').trim().toLowerCase().replace(/[^a-z0-9\-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
const pad = n => String(n).padStart(2, '0');
const hms = sec => { sec = Math.max(0, Math.round(sec)); const h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60); return h ? h + 'h' + pad(m) + 'p' : m + 'p' + pad(sec % 60) + 's'; };
const dur = sec => { sec = Math.max(0, Math.round(sec)); return sec < 60 ? sec + 's' : Math.floor(sec / 60) + 'm ' + (sec % 60) + 's'; };
const vn = t => { const d = new Date(t + 7 * 3600e3); return pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes()) + ':' + pad(d.getUTCSeconds()); };
const strip = s => String(s || '').replace(/\x1b\[[0-9;]*[A-Za-z]/g, '').replace(/^\d{4}-\d\d-\d\dT[\d:.]+Z ?/gm, '');
const parseDur = s => { s = String(s || '').toLowerCase(); if (/^1h?$/.test(s)) return { input: '1h', min: 60 }; if (/^3h?$/.test(s)) return { input: '3h', min: 180 }; return { input: '5h00m', min: 300 }; };
const fence = t => '```\n' + String(t).replace(/```/g, "'''") + '\n```';
const cut = (t, n) => t.length > n ? t.slice(0, n - 1) + '…' : t;
const cutTail = (t, n) => t.length > n ? '…' + t.slice(t.length - n + 1) : t;
const fileOf = name => name + '.yml';
const b64 = s => Buffer.from(s, 'utf8').toString('base64');
const unb64 = s => Buffer.from(String(s || ''), 'base64').toString('utf8');
const cleanUid = s => String(s || '').replace(/[<@!>]/g, '').trim();
const fmtSize = bytes => {
  const b = Number(bytes) || 0;
  if (b >= 1073741824) return (b / 1073741824).toFixed(2) + ' GB';
  if (b >= 1048576) return (b / 1048576).toFixed(2) + ' MB';
  if (b >= 1024) return (b / 1024).toFixed(1) + ' KB';
  return b + ' B';
};

async function gh(method, apiPath, body, raw, accObj) {
  const ac = accObj || getAcc();
  const rp = ac.repo || defaultRepo;
  const tk = ac.token || defaultToken;
  if (!rp) throw new Error('Chưa biết repo. Dùng `!may acc them <alias> <owner/repo> <token>` hoặc đặt GITHUB_REPOSITORY.');
  if (!tk) throw new Error('Chưa có token GitHub cho repo `' + rp + '`.');
  const fullPath = apiPath.startsWith('/repos/') ? apiPath : `/repos/${rp}${apiPath.startsWith('/') ? '' : '/'}${apiPath}`;
  const res = await fetch(API + fullPath, {
    method,
    headers: {
      Authorization: 'Bearer ' + tk,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'botcuadat-may',
      ...(body ? { 'Content-Type': 'application/json' } : {})
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(25000)
  });
  const txt = await res.text();
  if (!res.ok) {
    const e = new Error(method + ' ' + fullPath.split('?')[0] + ' → HTTP ' + res.status + ': ' + cut((() => { try { return JSON.parse(txt).message || txt; } catch { return txt; } })(), 200));
    e.status = res.status;
    throw e;
  }
  if (raw) {
    try {
      const j = JSON.parse(txt);
      if (j && typeof j.content === 'string' && j.encoding === 'base64') return Buffer.from(j.content.replace(/\s+/g, ''), 'base64').toString('utf8');
    } catch {}
    return txt;
  }
  try { return txt ? JSON.parse(txt) : {}; } catch { return txt; }
}

async function getRef(accObj) {
  const ac = accObj || getAcc();
  if (ac.branch) return ac.branch;
  if (R.ref) return R.ref;
  if (ENV.GITHUB_REF_NAME && ac.repo === defaultRepo) return ENV.GITHUB_REF_NAME;
  const info = await gh('GET', `/repos/${ac.repo}`, null, false, ac);
  ac.branch = info.default_branch || 'main';
  return ac.branch;
}

// ---------- tìm / sao chép & vá template may3 để xuất RDP_BOX + gửi Webhook về datdemo.duckdns.org ----------
function getWebhookUrl() {
  const dom = (R.duckdns && R.duckdns.domain) ? R.duckdns.domain : (ENV.DUCKDNS_DOMAIN || 'datdemo.duckdns.org');
  const prt = ENV.PORT || ENV.APP_PORT || '3000';
  return `http://${dom}:${prt}/api/rdp/report`;
}

function patchWorkflowBox(text) {
  let out = text;
  if (!out.includes('title=RDP_BOX::')) {
    const m = out.match(/^([ \t]*)\$tz\s*=\s*\[System\.TimeZoneInfo\].*$/m);
    if (m) {
      const ind = m[1];
      out = out.replace(
        m[0],
        `${ind}try { Start-Transcript -Path "$env:TEMP\\rdp_box.txt" -Force | Out-Null } catch {}\n${m[0]}`
      );
      const nextStepRe = new RegExp(`(\\r?\\n)([ \\t]*- name:.*DUY TRÌ PHIÊN)`, 'i');
      const webhookUrl = getWebhookUrl();
      const stopCmd = `${ind}try { Stop-Transcript | Out-Null; $b64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes((Get-Content "$env:TEMP\\rdp_box.txt" -Raw))); [Console]::WriteLine("::notice title=RDP_BOX::$b64") } catch {}\n` +
        `${ind}try {$pl = @{ machineId="$env:MACHINE_ID"; displayName="$env:DISPLAY_NAME"; repo="$env:RUNNER_REPO"; storageRepo="$env:STORAGE_REPO"; runnerRepo="$env:RUNNER_REPO"; releaseTag="$env:RELEASE_TAG"; stateBranch="$env:STATE_BRANCH"; runId="$env:GITHUB_RUN_ID"; status="ready"; reason="startup"; user="$env:RDP_USER"; password="$env:RDP_PASS"; stardeskId="$env:STARDESK_ID"; stardeskStatus="$sdStatus"; tailscaleIp="$env:TAILSCALE_IP"; webPort="$env:WEB_PORT"; sunshinePort="$env:SUNSHINE_WEB_PORT"; audio="$env:AUDIO_DEVICE_NAME"; driveLetter="$env:MOUNT_LETTER"; sharedRoot="$env:SHARED_ROOT"; profilePath="$env:PROFILE_PATH"; osBuild="$env:OS_BUILD"; startEpoch=[long]"$env:JOB_START_EPOCH"; durationMinutes=[int]"$env:TOTAL_MINUTES" } | ConvertTo-Json -Compress; Invoke-RestMethod -Uri "${webhookUrl}" -Method Post -Body $pl -ContentType "application/json; charset=utf-8" -TimeoutSec 8 | Out-Null } catch {}`;
      if (nextStepRe.test(out)) {
        out = out.replace(nextStepRe, `\n${stopCmd}$1$2`);
      }
    }
  }
  return out;
}

async function loadTemplate(ref, accObj) {
  const ac = accObj || getAcc();
  const localCandidates = [
    path.join(__dirname, '..', '..', '..', 'taomay.yaml'),
    path.join(__dirname, '..', '..', '..', 'taomay.yml'),
    path.join(__dirname, '..', '..', 'taomay.yaml'),
    path.join(__dirname, '..', '..', 'taomay.yml'),
    path.join(__dirname, '..', 'taomay.yaml'),
    path.join(__dirname, '..', 'taomay.yml'),
    path.join(process.cwd(), 'taomay.yaml'),
    path.join(process.cwd(), 'taomay.yml'),
    path.join(process.cwd(), '..', 'taomay.yaml'),
    path.join(process.cwd(), '..', 'taomay.yml')
  ];
  for (const lp of localCandidates) {
    try {
      if (fs.existsSync(lp)) {
        return { name: path.basename(lp), text: fs.readFileSync(lp, 'utf8') };
      }
    } catch {}
  }

  const stAcc = getStorageAcc();
  try {
    const list = await gh('GET', `/repos/${stAcc.repo}/contents/.github/workflows?ref=main`, null, false, stAcc);
    const f = (Array.isArray(list) ? list : []).find(x => /^(taomay|taomay\.yaml|taomay\.yml)$/i.test(x.name))
           || (Array.isArray(list) ? list : []).find(x => /^(may3|taomay)\.ya?ml$/i.test(x.name));
    if (f) {
      const text = await gh('GET', `/repos/${stAcc.repo}/contents/${f.path}?ref=main`, null, true, stAcc);
      return { name: f.name, text };
    }
  } catch {}

  const dir = ac.wfDir || defaultWfDir;
  const list = await gh('GET', `/repos/${ac.repo}/contents/${dir}?ref=${encodeURIComponent(ref)}`, null, false, ac);
  const want = ac.template ? [ac.template] : (R.template ? [R.template] : null);
  const f = (Array.isArray(list) ? list : []).find(x => want ? x.name.toLowerCase() === want[0].toLowerCase() : /^(taomay|may3)\.ya?ml$/i.test(x.name))
         || (Array.isArray(list) ? list : []).find(x => /^(taomay|may3)\.ya?ml$/i.test(x.name));
  if (!f) throw new Error('Không thấy file mẫu taomay.yaml trong ' + dir + ' (repo ' + ac.repo + '). Có: ' + (Array.isArray(list) ? list.map(x => x.name).join(', ') : '?'));
  const text = await gh('GET', `/repos/${ac.repo}/contents/${f.path}?ref=${encodeURIComponent(ref)}`, null, true, ac);
  return { name: f.name, text };
}

function makeWorkflow(text, name, opts) {
  let out = text;
  opts = opts || {};
  const storageRepo = opts.storageRepo || R.storageRepo || defaultStorageRepo;
  if (out.includes(TEMPLATE_FROM)) {
    out = out.split(TEMPLATE_FROM).join(name);
  }
  out = out.replace(/default:\s*['"]may-phu-2['"]/g, `default: '${name}'`);
  out = out.replace(/default:\s*['"]Máy Phụ 2['"]/g, `default: 'Máy ${name}'`);
  out = out.replace(/default:\s*['"]ddvdat-glitch\/rdp['"]/g, `default: '${storageRepo}'`);
  out = out.replace(/^name:.*$/m, 'name: máy ' + name);
  return patchWorkflowBox(out);
}

// ---------- bóc "THÔNG TIN KẾT NỐI" ----------
function parseBox(rawText) {
  const text = strip(rawText);
  const g = re => { const m = text.match(re); return m ? m[1].trim() : ''; };
  const machineId = (g(/Định danh máy\s*:\s*(.+)/).match(/^([^\s(]+)/) || [])[1] || g(/Định danh máy\s*:\s*(\S+)/);
  const stardeskId = g(/StarDesk ID\s*:\s*(.+)/);
  const stardeskStatus = g(/StarDesk\s*:\s*(.+)/);
  const user = g(/User RDP\s*:\s*(\S+)/) || g(/User gốc\s*:\s*(\S+)/);
  const ip = g(/IP Tailscale\s*:\s*(\d+\.\d+\.\d+\.\d+)/);
  if (!machineId && !stardeskId && !user && !ip) return null;
  const repoTag = (g(/Định danh máy\s*:\s*(.+)/).match(/Kho lưu:\s*([^)]+)/) || [])[1] || g(/Kho lưu gốc\s*:\s*([^)]+)/);
  const storageRepo = (g(/Kho lưu gốc\s*:\s*([^\s(]+)/) || '').trim();
  const runnerRepo = (g(/Treo tại\s*:\s*([^\s(]+)/) || '').trim();
  return {
    machineId: machineId ? machineId.trim() : '',
    repoTag: repoTag ? repoTag.trim() : '',
    storageRepo,
    runnerRepo,
    stardeskId,
    stardesk: stardeskStatus || (stardeskId ? `Sẵn sàng (${stardeskId})` : 'Đang chạy'),
    stardeskStatus: stardeskStatus || 'Đang chạy',
    ip,
    sunshine: g(/Sunshine Web\s*:\s*(\S+)/),
    panel: g(/Web Quản Lý\s*:\s*(\S+)/),
    user: user || 'runneradmin',
    userNote: g(/User gốc\s*:\s*(.+)/) || user,
    pass: g(/Mật khẩu\s*:\s*(.+?)\s*\(Cố định\)/) || g(/Mật khẩu\s*:\s*(.+)/),
    screen: g(/Màn hình ảo\s*:\s*(.+)/),
    audio: g(/Âm thanh ảo\s*:\s*(.+)/),
    disk: g(/Ổ đĩa riêng\s*:\s*(.+)/),
    profile: g(/Profile gốc\s*:\s*(.+)/),
    length: g(/Thời lượng\s*:\s*(.+)/)
  };
}

// ---------- giao tiếp trực tiếp với IP máy ảo (Port 8080) ----------
async function fetchVmLiveInfo(m) {
  const ip = m && m.info && m.info.ip;
  const port = (m && m.info && m.info.webPort) || '8080';
  if (!ip) return null;
  try {
    const res = await fetch(`http://${ip}:${port}/api/info`, { signal: AbortSignal.timeout(6000) });
    if (!res.ok) return null;
    const j = await res.json();
    if (j && j.ok) {
      m.info = Object.assign(m.info || {}, {
        ip: j.tailscaleIp || ip,
        user: j.user || m.info.user || 'runneradmin',
        pass: j.password || m.info.pass || '',
        osBuild: j.osBuild || m.info.osBuild || '',
        remainSeconds: j.remainSeconds,
        remainText: j.remainText,
        diskUsedGb: j.diskUsedGb,
        diskFreeGb: j.diskFreeGb,
        activeApps: j.activeApps || []
      });
      m.lastReportAt = Date.now();
      m.status = 'ready';
      saveToBridgeFile();
      return j;
    }
  } catch {}
  return null;
}

async function sendVmCommand(m, cmd, text) {
  const ip = m && m.info && m.info.ip;
  const port = (m && m.info && m.info.webPort) || '8080';
  if (!ip) throw new Error('Máy chưa có IP Tailscale hoặc chưa sẵn sàng để nhận lệnh trực tiếp.');
  const res = await fetch(`http://${ip}:${port}/api/cmd`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cmd, text: text || '' }),
    signal: AbortSignal.timeout(10000)
  });
  if (!res.ok) throw new Error('HTTP ' + res.status + ' khi gọi tới máy ảo ' + ip);
  return await res.json();
}

// ---------- đọc log & trạng thái các bước ----------
function splitSteps(log) {
  const lines = String(log || '').replace(/\x1b\[[0-9;]*[A-Za-z]/g, '').split(/\r?\n/);
  const steps = [];
  let cur = null;
  const tsOf = l => { const m = l.match(/^(\d{4}-\d\d-\d\dT[\d:.]+)Z /); return m ? Date.parse(m[1] + 'Z') : 0; };
  for (const raw of lines) {
    const t = tsOf(raw), l = raw.replace(/^\d{4}-\d\d-\d\dT[\d:.]+Z ?/, '');
    if (l.startsWith('##[group]Run ')) {
      cur = { title: l.slice(9).replace(/^Run /, '').trim(), t0: t, t1: t, body: [] };
      steps.push(cur);
      cur.inGroup = true;
      continue;
    }
    if (!cur) continue;
    if (t) cur.t1 = t;
    if (l.startsWith('##[endgroup]')) { cur.inGroup = false; continue; }
    if (cur.inGroup) continue;
    if (l.startsWith('##[group]')) { cur.body.push('▸ ' + l.slice(9)); continue; }
    if (l.startsWith('##[error]')) { cur.body.push('❌ ' + l.slice(9)); continue; }
    if (l.startsWith('##[warning]')) { cur.body.push('⚠️ ' + l.slice(11)); continue; }
    if (/^##\[(debug|command|add-mask|notice)/.test(l)) continue;
    cur.body.push(l);
  }
  steps.forEach((s, i) => {
    s.n = i + 1;
    s.sec = s.t0 && s.t1 ? (s.t1 - s.t0) / 1000 : 0;
    s.head = s.title.split(/\r?\n/)[0];
    s.text = s.body.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  });
  return steps;
}

const fmtStep = s => {
  const icon = s.icon ? s.icon + ' ' : '';
  return dur(s.sec) + ' · ' + icon + (s.stepName ? s.stepName + '\n' : '') + 'Run ' + s.head + (s.text ? '\n\n' + s.text : '');
};

async function latestRun(file, accObj) {
  const ac = accObj || getAcc();
  const r = await gh('GET', `/repos/${ac.repo}/actions/workflows/${encodeURIComponent(file)}/runs?per_page=5`, null, false, ac);
  return (r.workflow_runs || [])[0] || null;
}

async function findRun(arg, accObj) {
  const name = nameOk(arg), m = R.machines[name];
  const ac = accObj || getAcc(m);
  if (/^\d{8,}$/.test(arg)) return await gh('GET', `/repos/${ac.repo}/actions/runs/${arg}`, null, false, ac);
  return await latestRun((m && m.file) || fileOf(name), ac);
}

async function jobOf(runId, accObj) {
  const ac = accObj || getAcc();
  const r = await gh('GET', `/repos/${ac.repo}/actions/runs/${runId}/jobs?per_page=5`, null, false, ac);
  return (r.jobs || [])[0] || null;
}

async function getBoxFromAnnotations(jobId, accObj) {
  const ac = accObj || getAcc();
  try {
    const anns = await gh('GET', `/repos/${ac.repo}/check-runs/${jobId}/annotations?per_page=50`, null, false, ac);
    if (!Array.isArray(anns)) return null;
    const found = anns.find(a => a && a.title === 'RDP_BOX' && a.message);
    if (!found) return null;
    const raw = unb64(found.message.trim());
    return { raw, box: parseBox(raw) };
  } catch {
    return null;
  }
}

function stepIcon(st) {
  if (st.status === 'completed') return st.conclusion === 'success' ? '✅' : (st.conclusion === 'skipped' ? '⏭️' : '❌');
  if (st.status === 'in_progress') return '⏳';
  return '⏹️';
}

function isInfoStepDone(job) {
  if (!job || !Array.isArray(job.steps)) return false;
  const infoSt = job.steps.find(s => /THÔNG TIN KẾT NỐI/i.test(s.name));
  if (infoSt && infoSt.status === 'completed' && infoSt.conclusion === 'success') return true;
  const keepSt = job.steps.find(s => /DUY TRÌ PHIÊN/i.test(s.name));
  if (keepSt && (keepSt.status === 'in_progress' || keepSt.status === 'completed')) return true;
  return false;
}

async function runLog(runId, accObj) {
  const ac = accObj || getAcc();
  const job = await jobOf(runId, ac);
  if (!job) throw new Error('Run chưa có job (đang xếp hàng).');
  const jobUrl = job.html_url || `[https://github.com/$](https://github.com/$){ac.repo}/actions/runs/${runId}/job/${job.id}`;
  const ann = await getBoxFromAnnotations(job.id, ac);

  try {
    const text = await gh('GET', `/repos/${ac.repo}/actions/jobs/${job.id}/logs`, null, true, ac);
    const steps = splitSteps(text);
    if (steps.length) {
      return { job, jobUrl, steps, text, annBox: ann && ann.box, annRaw: ann && ann.raw, fromApiSteps: false };
    }
  } catch {}

  const apiSteps = (job.steps || []).filter(s => s.name !== 'Set up job' && s.name !== 'Complete job');
  const steps = apiSteps.map((s, idx) => {
    const t0 = s.started_at ? Date.parse(s.started_at) : 0;
    const t1 = s.completed_at ? Date.parse(s.completed_at) : (s.status === 'in_progress' && t0 ? Date.now() : t0);
    const isBoxStep = /THÔNG TIN KẾT NỐI/i.test(s.name);
    let bodyText = `Trạng thái: ${stepIcon(s)} ${s.status}${s.conclusion ? ' (' + s.conclusion + ')' : ''}`;
    if (isBoxStep && ann && ann.raw) {
      const cleanBox = strip(ann.raw).replace(/^[\s\S]*?(?=┌──)/, '').replace(/::notice title=RDP_BOX::.*$/m, '').trim();
      bodyText += '\n\n' + (cleanBox || strip(ann.raw));
    } else if (s.status === 'in_progress') {
      bodyText += `\nĐang chạy trực tiếp tại: ${jobUrl}`;
    }
    return {
      n: idx + 1,
      sec: t0 && t1 ? Math.max(0, (t1 - t0) / 1000) : 0,
      icon: stepIcon(s),
      stepName: s.name,
      head: s.name,
      text: bodyText
    };
  });

  return { job, jobUrl, steps, text: ann ? ann.raw : '', annBox: ann && ann.box, annRaw: ann && ann.raw, fromApiSteps: true };
}

const machineKey = run => {
  const f = String(run.path || '').split('/').pop();
  const k = Object.keys(R.machines).find(n => R.machines[n].file === f);
  return k || f.replace(/\.ya?ml$/i, '');
};

const remain = (m, run) => {
  const start = (m && m.startMs) || (run ? Date.parse(run.run_started_at || run.created_at) : Date.now());
  const total = ((m && m.minutes) || 300) * 60;
  const calcLeft = total - (Date.now() - start) / 1000;
  const left = (m && m.info && m.info.remainSeconds != null && m.lastReportAt && (Date.now() - m.lastReportAt < 180000))
    ? m.info.remainSeconds - (Date.now() - m.lastReportAt) / 1000
    : calcLeft;
  return { start, end: start + total * 1000, left };
};

const canSee = m => isStaff || R.view === 'all' || (m && m.ownerId === ctx.user.id) || (m && Array.isArray(m.sharedUsers) && m.sharedUsers.includes(ctx.user.id));

// ---------- bảng đăng nhập (ẩn) ----------
// ---------- bảng điều khiển & đăng nhập chi tiết (ẩn / ephemeral) ----------
function loginText(m, run, jobId) {
  const t = remain(m, run), L = [];
  const isOnline = (m.status !== 'stopped' && m.status !== 'done' && m.lastReportAt && (Date.now() - m.lastReportAt < 600000));
  const isStarting = (m.status === 'dispatched' || m.status === 'creating' || (m.status === 'running' && !isOnline && !m.info));
  const healthBadge = isOnline ? '🟢 Hoạt động (Online)' : (isStarting ? '🟡 Đang khởi động...' : (m.status === 'ready' ? '🔴 Mất tín hiệu (Offline)' : '⚪ Đã tắt'));

  L.push('**🖥️ Máy: ' + m.name + '**' + (m.owner ? ' — Chủ: ' + m.owner : ''));
  L.push('📡 Trạng thái: **' + healthBadge + '**' + (m.currentSessionId ? ' · Phiên: `' + m.currentSessionId + '`' : ''));
  if (m.info) {
    const i = m.info;
    const realPass = (i.pass && !i.pass.includes('secret')) ? i.pass : (R.rdpPass || ENV.RDP_PASSWORD || i.pass || 'Aistv@2026');
    if (i.machineId) L.push('🏷️ Định danh: `' + (i.machineId || m.name) + '`');
    if (i.stardeskId) {
      L.push('🚀 **StarDesk ID:** `' + i.stardeskId + '` (' + (i.stardeskStatus || i.stardesk || 'Sẵn sàng') + ')');
      L.push('> 💡 *Mở StarDesk trên máy của bạn → Nhập StarDesk ID ở trên để điều khiển máy từ xa.*');
    } else {
      L.push('🚀 StarDesk: ' + (i.stardesk || 'Đang chạy (Đã cài & mở sẵn)'));
    }
    L.push('👤 User RDP: `' + (i.user || 'runneradmin') + '` · 🔐 Mật khẩu: `' + realPass + '`');
    L.push('📦 Kho lưu gốc: `' + (i.storageRepo || defaultStorageRepo) + '` (`' + (i.repoTag || ('aistv-storage-' + m.name)) + '`)');
    L.push('🏃 Runner: `' + (i.runnerRepo || m.repo || defaultRunnerRepo) + '`');
    if (i.ip) L.push('🌐 IP mạng: `' + i.ip + '`');
    if (i.panel) L.push('🎛️ Web Quản Lý: ' + i.panel);
    if (i.screen) L.push('🖥️ Màn hình ảo: ' + i.screen);
    if (i.audio) L.push('🔊 Âm thanh ảo: ' + i.audio);
    if (i.disk) L.push('💽 Ổ đĩa riêng: `' + i.disk + '`' + (i.diskUsedGb != null ? ` (Đã dùng: ${i.diskUsedGb}GB / Trống: ${i.diskFreeGb}GB)` : ''));
    if (i.profile) L.push('📂 Profile: `' + i.profile + '`');
  } else if (m.status === 'ready') {
    const realPass = R.rdpPass || ENV.RDP_PASSWORD || 'Aistv@2026';
    L.push(
      '🟢 **Máy đã sẵn sàng!**',
      '👤 User gốc: `runneradmin` · 🔐 Mật khẩu: `' + realPass + '`'
    );
  } else {
    L.push('⏳ Máy đang khởi động hoặc đã tắt, chưa có thông tin đăng nhập.');
  }
  L.push('⏰ Phiên: ' + vn(t.start) + ' → ' + vn(t.end) + ' (VN) · ' + (t.left > 0 ? 'còn **' + hms(t.left) + '**' : '**đã hết giờ**'));
  return L.join('\n');
}

// Bảng nút điều khiển động theo trạng thái của máy
function getMachineControlButtons(m, name) {
  const isOnline = (m.status !== 'stopped' && m.status !== 'done' && m.lastReportAt && (Date.now() - m.lastReportAt < 600000));
  const isStarting = (m.status === 'dispatched' || m.status === 'creating' || (m.status === 'running' && !isOnline && !m.info));

  if (isOnline) {
    // Máy đang bật: KHÔNG CÓ nút Bật máy!
    return [
      [
        { id: 'st:' + name, label: '🛑 Tắt máy', style: 'danger', ephemeral: true },
        { id: 'rs:' + name, label: '🔁 Khởi động lại', style: 'secondary', ephemeral: true },
        { id: 'sv:' + name, label: '💾 Lưu ổ đĩa', style: 'success', ephemeral: true }
      ],
      [
        { id: 'del:' + name, label: '🗑️ Xóa máy', style: 'danger', ephemeral: true },
        { id: 'delstorage:' + name, label: '💽 Xóa ổ đĩa', style: 'danger', ephemeral: true },
        { id: 'fi:' + name, label: '📄 File JSON', style: 'secondary', ephemeral: true }
      ]
    ];
  } else if (isStarting) {
    // Máy đang khởi động: ẨN nút Bật và nút Khởi động lại!
    return [
      [
        { id: 'in:' + name, label: '🔄 Làm mới', style: 'primary', ephemeral: true },
        { id: 'st:' + name, label: '🛑 Hủy khởi động', style: 'danger', ephemeral: true }
      ],
      [
        { id: 'del:' + name, label: '🗑️ Xóa máy', style: 'danger', ephemeral: true }
      ]
    ];
  } else {
    // Máy đang tắt: CÓ nút Bật máy! ẨN nút Tắt và Khởi động lại!
    return [
      [
        { id: 'start:' + name, label: '▶️ Bật máy', style: 'success', ephemeral: true }
      ],
      [
        { id: 'del:' + name, label: '🗑️ Xóa máy', style: 'danger', ephemeral: true },
        { id: 'delstorage:' + name, label: '💽 Xóa ổ đĩa', style: 'danger', ephemeral: true },
        { id: 'fi:' + name, label: '📄 File JSON', style: 'secondary', ephemeral: true }
      ]
    ];
  }
}

function tokenText() {
  return R.tsToken
    ? '🔑 **Token Tailscale**: `' + R.tsToken + '`' + (R.tsAt ? ' (lưu ' + new Date(R.tsAt + 7 * 3600e3).toISOString().slice(0, 10) + ')' : '') + '\n> Cài Tailscale trên máy bạn rồi: `tailscale up --authkey=<token>` để vào được IP 100.x của máy.'
    : '🔑 Chưa có Token Tailscale (Admin dùng `!may ts <authkey>`).';
}

// ---------- tin trạng thái công khai (không lộ mật khẩu, không lộ IP / Log) ----------
const publicCard = (m, run) => {
  const t = remain(m, run);
  const isReady = !!(m.info || m.status === 'ready');
  const isOnline = (m.status !== 'stopped' && m.status !== 'done' && m.lastReportAt && (Date.now() - m.lastReportAt < 600000));
  const isStarting = (m.status === 'dispatched' || m.status === 'creating' || (run && (run.status === 'queued' || (run.status === 'in_progress' && !isReady))));
  const st = isOnline ? '🟢 Online (Sẵn sàng)' : (isStarting ? '🟡 Đang khởi động...' : (isReady ? '🔴 Offline (Mất tín hiệu)' : '⚪ Đã tắt'));
  return {
    content: '**🖥️ ' + m.name + '** ' + st + (m.owner ? ' · chủ: ' + m.owner : '') +
      (m.currentSessionId ? '\n🏷️ Phiên: `' + m.currentSessionId + '`' : '') +
      '\n⏰ ' + vn(t.start) + ' → ' + vn(t.end) + ' (VN) · ' + (t.left > 0 ? 'còn ' + hms(t.left) : 'hết giờ'),
    buttons: [
      [
        { id: 'in:' + m.name, label: '🔐 Xem Thông Tin & Điều Khiển', style: 'primary', ephemeral: true }
      ]
    ]
  };
};

// ---------- ghi nhận máy ----------
function rec(name, patch) {
  const m = R.machines[name] = R.machines[name] || { name, file: fileOf(name), created: Date.now() };
  Object.assign(m, patch);
  saveToBridgeFile();
  return m;
}

// Liệt kê tất cả workflow runs đang chạy trên mọi tài khoản Git đã cấu hình
async function listRuns(onlyAcc) {
  const accList = onlyAcc ? [onlyAcc] : getAllAccounts();
  const own = String(ENV.GITHUB_RUN_ID || '');
  const all = [];
  for (const ac of accList) {
    try {
      const [a1, a2] = await Promise.all(['in_progress', 'queued'].map(s => gh('GET', `/repos/${ac.repo}/actions/runs?status=${s}&per_page=50`, null, false, ac)));
      const runs = [...(a1.workflow_runs || []), ...(a2.workflow_runs || [])]
        .filter(r => String(r.id) !== own && !BOT_FILES.includes(String(r.path).split('/').pop()));
      for (const r of runs) {
        r._acc = ac;
        all.push(r);
      }
    } catch {}
  }
  return all.sort((x, y) => Date.parse(x.created_at) - Date.parse(y.created_at));
}

// Đồng bộ thông tin máy từ Bridge / VM API / Job / Annotation / Log
async function syncMachineInfo(m, runId) {
  syncFromBridgeFile();
  if (m && m.info && m.info.ip) {
    await fetchVmLiveInfo(m);
  }
  const ac = getAcc(m);
  const rId = runId || m.runId;
  if (!rId) return null;
  const L = await runLog(rId, ac);
  if (L.job) m.jobId = L.job.id;
  if (L.annBox) {
    m.info = Object.assign(m.info || {}, L.annBox);
    m.infoAt = m.infoAt || Date.now();
    m.status = 'ready';
    saveToBridgeFile();
    return L;
  }
  const st = L.steps.find(s => /THÔNG TIN KẾT NỐI|StarDesk ID|StarDesk\s*:|RDP & STARDESK/i.test(s.text) || /IP Tailscale\s*:\s*\d/.test(s.text));
  if (st) {
    const box = parseBox(st.text);
    if (box) {
      m.info = Object.assign(m.info || {}, box);
      m.infoAt = m.infoAt || Date.now();
      m.status = 'ready';
      saveToBridgeFile();
      return L;
    }
  }
  if (isInfoStepDone(L.job)) {
    m.status = 'ready';
  }
  saveToBridgeFile();
  return L;
}

// ============================== XỬ LÝ SỰ KIỆN ==============================
try {
  // ---------------- HẸN GIỜ: khởi động -> tìm run -> dò log -> cập nhật tin ----------------
  if (ev === 'timer') {
    const [kind, name, nStr] = String(ctx.timer.data).split('|'), n = +nStr || 0, m = R.machines[name];
    if (!m) return;
    const ac = getAcc(m);
    const tag = 'may:' + name;
    if (kind === 'disp') {
      try {
        const ref = await getRef(ac);
        m.dispatchAt = Date.now() - 3000;
        const inputs = { machine_id: name, duration: m.input || '5h00m' };
        if (m.hasWebhookInput) inputs.bot_webhook_url = getWebhookUrl();
        try {
          await gh('POST', `/repos/${ac.repo}/actions/workflows/${encodeURIComponent(m.file)}/dispatches`, { ref, inputs }, false, ac);
        } catch (errInp) {
          if (errInp.status === 422 && inputs.bot_webhook_url) {
            delete inputs.bot_webhook_url;
            await gh('POST', `/repos/${ac.repo}/actions/workflows/${encodeURIComponent(m.file)}/dispatches`, { ref, inputs }, false, ac);
          } else {
            throw errInp;
          }
        }
        m.status = 'dispatched';
        saveToBridgeFile();
        ui.after(6, 'find|' + name + '|0');
        return;
      } catch (e) {
        if (n < 8 && /404|422/.test(String(e.status))) { ui.after(6, 'disp|' + name + '|' + (n + 1)); return; }
        m.status = 'error';
        saveToBridgeFile();
        ui.edit(tag, '❌ **' + name + '**: không chạy được action trên `' + ac.repo + '`: ' + e.message + '\n(Cần token có quyền workflow; file: `' + m.file + '`)');
        return;
      }
    }
    if (kind === 'find') {
      const rs = (await gh('GET', `/repos/${ac.repo}/actions/workflows/${encodeURIComponent(m.file)}/runs?event=workflow_dispatch&per_page=5`, null, false, ac)).workflow_runs || [];
      const run = rs.find(r => Date.parse(r.created_at) >= (m.dispatchAt || 0)) || (n >= 6 ? rs[0] : null);
      if (!run) {
        if (n < 12) ui.after(5, 'find|' + name + '|' + (n + 1));
        else { m.status = 'error'; saveToBridgeFile(); ui.edit(tag, '❌ **' + name + '**: dispatch xong nhưng không thấy run nào.'); }
        return;
      }
      m.runId = run.id;
      m.url = run.html_url;
      m.startMs = Date.parse(run.run_started_at || run.created_at);
      m.status = 'running';
      try { const job = await jobOf(run.id, ac); if (job) m.jobId = job.id; } catch {}
      saveToBridgeFile();
      ui.edit(tag, publicCard(m, run));
      ui.after(POLL_SEC, 'poll|' + name + '|0');
      return;
    }
    if (kind === 'poll') {
      syncFromBridgeFile();
      const run = await gh('GET', `/repos/${ac.repo}/actions/runs/${m.runId}`, null, false, ac);
      if (run.status === 'completed') {
        m.status = 'done';
        saveToBridgeFile();
        ui.edit(tag, { content: '🔴 **' + name + '** đã kết thúc (' + (run.conclusion || '?') + ').', buttons: [] });
        return;
      }
      const wasReady = !!(m.info || m.status === 'ready');
      try { await syncMachineInfo(m, m.runId); } catch {}
      const nowReady = !!(m.info || m.status === 'ready');
      if (!wasReady && nowReady) {
        ui.edit(tag, publicCard(m, run));
        ui.send({
          content: '✅ Máy **' + name + '** đã sẵn sàng' + (m.ownerId ? ' <@' + m.ownerId + '>' : '') + '! Bấm **🔐 Thông tin đăng nhập** ở tin trên (chỉ bạn thấy).',
          mentions: m.ownerId ? [m.ownerId] : []
        });
        ui.after(REFRESH_SEC, 'poll|' + name + '|0');
        return;
      }
      if (!nowReady) {
        ui.edit(tag, publicCard(m, run));
        if (n < POLL_MAX) { ui.after(POLL_SEC, 'poll|' + name + '|' + (n + 1)); return; }
        ui.edit(tag, '⚠️ **' + name + '**: chờ 45 phút vẫn chưa thấy thông tin kết nối. Xem `!may log ' + name + '`.');
        return;
      }
      ui.edit(tag, publicCard(m, run));
      ui.after(REFRESH_SEC, 'poll|' + name + '|0');
      return;
    }
    return;
  }

  // ---------------- NÚT BẤM ----------------
  if (ev === 'button') {
    syncFromBridgeFile();
    const [kind, name, opt] = String(ctx.interaction.customId).split(':').concat(['', '', '']).slice(0, 3);

    // Xử lý nút bấm bảng quản trị Admin
    if (kind === 'adm') {
      if (!isStaff) { ui.reply('🚫 Chỉ Admin / chủ server mới có quyền truy cập bảng quản trị.'); return; }
      if (name === 'scanaction') {
        const rs = await listRuns();
        if (!rs.length) { ui.reply('😴 Không có workflow run nào đang chạy trên các tài khoản Git.'); return; }
        const L = [`🔍 **DANH SÁCH ACTIONS ĐANG CHẠY TRÊN HỆ THỐNG (${rs.length} runs):**`];
        const btns = [];
        for (const run of rs.slice(0, 10)) {
          const k = machineKey(run);
          const m = R.machines[k];
          const t = remain(m, run);
          L.push(`• **${k}** (Run #${run.id} · ${run.status}) — Chủ: ${m && m.owner ? m.owner : 'Chưa gán'} · Còn: ${t.left > 0 ? hms(t.left) : 'hết giờ'}`);
          btns.push({ id: 'in:' + k, label: '🔐 ' + k, style: 'primary', ephemeral: true });
        }
        const rows = [];
        for (let i = 0; i < btns.length; i += 5) rows.push(btns.slice(i, i + 5));
        ui.reply({ content: cut(L.join('\n'), 1950), buttons: rows });
        return;
      }
      if (name === 'scanold') {
        const ac = getAcc();
        const ref = await getRef(ac);
        const dir = ac.wfDir || defaultWfDir;
        let files = [];
        try {
          const list = await gh('GET', `/repos/${ac.repo}/contents/${dir}?ref=${encodeURIComponent(ref)}`, null, false, ac);
          files = (Array.isArray(list) ? list : []).filter(x => /\.ya?ml$/i.test(x.name) && !BOT_FILES.includes(x.name.toLowerCase()) && !/^(may3|taomay)\.ya?ml$/i.test(x.name));
        } catch (e) {
          ui.reply(`❌ Lỗi quét thư mục ${dir}: ${e.message}`);
          return;
        }
        if (!files.length) { ui.reply('ℹ️ Không tìm thấy file workflow máy nào cần nâng cấp.'); return; }
        const oldFiles = [];
        for (const f of files) {
          try {
            const raw = await gh('GET', `/repos/${ac.repo}/contents/${f.path}?ref=${encodeURIComponent(ref)}`, null, true, ac);
            if (!raw.includes('report-file') && !raw.includes('MACHINE_INFO_FILE')) {
              oldFiles.push(f);
            }
          } catch {}
        }
        if (!oldFiles.length) {
          ui.reply(`✅ Tất cả **${files.length}** file workflow trên repo đều đã là phiên bản mới nhất!`);
          return;
        }
        const L = [
          `🔄 **PHÁT HIỆN ${oldFiles.length}/${files.length} FILE WORKFLOW BẢN CŨ CẦN NÂNG CẤP:**`,
          `*(Nâng cấp sẽ tạo file D:\\ JSON, gửi 28 trường về bot, giữ nguyên 100% dữ liệu ổ đĩa cũ)*`
        ];
        const btns = [];
        for (const f of oldFiles.slice(0, 10)) {
          const mName = f.name.replace(/\.ya?ml$/i, '');
          L.push(`• File \`${f.name}\` ➔ Máy **${mName}**`);
          btns.push({ id: 'adm:upg:' + mName, label: '🔄 Nâng cấp ' + mName, style: 'success', ephemeral: true });
        }
        const rows = [];
        for (let i = 0; i < btns.length; i += 5) rows.push(btns.slice(i, i + 5));
        ui.reply({ content: cut(L.join('\n'), 1950), buttons: rows });
        return;
      }
      if (name === 'upg') {
        const targetName = opt || '';
        if (!targetName) { ui.reply('Thiếu tên máy cần nâng cấp.'); return; }
        const ac = getAcc();
        const ref = await getRef(ac);
        const wfPath = (ac.wfDir || defaultWfDir) + '/' + fileOf(targetName);
        try {
          const existingFile = await gh('GET', `/repos/${ac.repo}/contents/${wfPath}?ref=${encodeURIComponent(ref)}`, null, false, ac);
          const tpl = await loadTemplate(ref, ac);
          const newYaml = makeWorkflow(tpl.text, targetName);
          await gh('PUT', `/repos/${ac.repo}/contents/${wfPath}`, {
            message: `Nâng cấp workflow máy ${targetName} lên bản mới nhất (bảo toàn ổ đĩa)`,
            content: b64(newYaml),
            sha: existingFile.sha,
            branch: ref
          }, false, ac);
          const m = R.machines[targetName] = R.machines[targetName] || { name: targetName, file: fileOf(targetName), created: Date.now() };
          m.hasWebhookInput = /bot_webhook_url\s*:/i.test(newYaml);
          saveToBridgeFile();
          ui.reply(`✅ **Đã nâng cấp thành công máy \`${targetName}\`!**\n• File: \`${wfPath}\`\n• Đã bổ sung bước tạo file D:\\, webhook 28 trường & heartbeat.\n• 💽 **Dữ liệu ổ đĩa:** Được giữ nguyên 100% (Release: \`aistv-storage-${targetName}\`, State: \`aistv-state-${targetName}\`).`);
        } catch (e) {
          ui.reply(`❌ Lỗi khi nâng cấp máy **${targetName}**: ${e.message}`);
        }
        return;
      }
      if (name === 'allmachines') {
        const ms = Object.values(R.machines);
        if (!ms.length) { ui.reply('Chưa có máy nào được lưu trong hệ thống.'); return; }
        const L = [`🖥️ **TỔNG CỘNG ${ms.length} MÁY TRÊN HỆ THỐNG:**`];
        const btns = [];
        for (const m of ms.slice(0, 15)) {
          const isOnline = (m.status !== 'stopped' && m.status !== 'done' && m.lastReportAt && (Date.now() - m.lastReportAt < 600000));
          const st = isOnline ? '🟢 Online' : (m.status === 'ready' ? '🔴 Offline' : '⚪ ' + (m.status || 'Tắt'));
          L.push(`• **${m.name}** [${st}] — Chủ: ${m.owner || 'Chưa có'}`);
          btns.push({ id: 'in:' + m.name, label: '🔐 ' + m.name, style: 'secondary', ephemeral: true });
        }
        const rows = [];
        for (let i = 0; i < btns.length; i += 5) rows.push(btns.slice(i, i + 5));
        ui.reply({ content: cut(L.join('\n'), 1950), buttons: rows });
        return;
      }
    }

    if (kind === 'ds' || kind === 'allin') {
      const rs = await listRuns();
      const parts = [];
      for (const run of rs) {
        const k = machineKey(run);
        const m = R.machines[k] = R.machines[k] || { name: k, file: String(run.path).split('/').pop(), runId: run.id, repo: run._acc && run._acc.repo, accName: run._acc && run._acc.alias };
        if (canSee(m)) {
          if (!m.info) { try { await syncMachineInfo(m, run.id); } catch {} }
          parts.push(loginText(m, run, m.jobId));
        }
      }
      ui.reply(cut((parts.length ? parts.join('\n\n') : 'Không có máy nào bạn được xem.') + '\n\n' + (parts.length ? tokenText() : ''), 1990));
      return;
    }

    const m = R.machines[name];
    if (!m || !canSee(m)) { ui.reply('🚫 Bạn không phải chủ máy này hoặc chưa được cấp quyền.'); return; }
    const ac = getAcc(m);

    // Xem thông tin & bảng điều khiển
    if (kind === 'in') {
      const run = m.runId ? await gh('GET', `/repos/${ac.repo}/actions/runs/${m.runId}`, null, false, ac).catch(() => null) : await findRun(name, ac).catch(() => null);
      if (run && !m.info) { try { await syncMachineInfo(m, run.id); } catch {} }
      else if (m.info && m.info.ip) { try { await fetchVmLiveInfo(m); } catch {} }
      const btns = getMachineControlButtons(m, name);
      ui.reply({ content: cut(loginText(m, run, m.jobId) + '\n\n' + tokenText(), 1990), buttons: btns });
      return;
    }

    // Bật máy khi đang tắt
    if (kind === 'start') {
      const isOnline = (m.status !== 'stopped' && m.status !== 'done' && m.lastReportAt && (Date.now() - m.lastReportAt < 600000));
      if (isOnline) {
        ui.reply({ content: `⚠️ Máy **${name}** đang hoạt động rồi!`, buttons: getMachineControlButtons(m, name) });
        return;
      }
      try {
        const ref = await getRef(ac);
        const inputs = { machine_id: name, duration: m.input || '5h00m' };
        if (m.hasWebhookInput) inputs.bot_webhook_url = getWebhookUrl();
        try {
          await gh('POST', `/repos/${ac.repo}/actions/workflows/${encodeURIComponent(m.file || fileOf(name))}/dispatches`, { ref, inputs }, false, ac);
        } catch (errInp) {
          if (errInp.status === 422 && inputs.bot_webhook_url) {
            delete inputs.bot_webhook_url;
            await gh('POST', `/repos/${ac.repo}/actions/workflows/${encodeURIComponent(m.file || fileOf(name))}/dispatches`, { ref, inputs }, false, ac);
          } else {
            throw errInp;
          }
        }
        m.status = 'dispatched';
        m.dispatchAt = Date.now() - 3000;
        saveToBridgeFile();
        ui.reply({ content: `🚀 Đang bật máy ảo **${name}**... Bấm "Làm mới" sau ít giây để cập nhật trạng thái kết nối.`, buttons: getMachineControlButtons(m, name) });
        ui.after(6, 'find|' + name + '|0');
      } catch (e) {
        ui.reply(`❌ Lỗi khi bật máy **${name}**: ${e.message}`);
      }
      return;
    }

    // Tắt máy
    if (kind === 'st') {
      let vmOk = false;
      if (m.info && m.info.ip) {
        try {
          await sendVmCommand(m, 'stop');
          vmOk = true;
        } catch {}
      }
      if (m.runId) {
        try { await gh('POST', `/repos/${ac.repo}/actions/runs/${m.runId}/cancel`, null, false, ac); } catch {}
      }
      m.status = 'stopped';
      saveToBridgeFile();
      ui.reply({ content: `🛑 Đã gửi lệnh tắt máy **${name}**${vmOk ? ' qua VM HTTP' : ''} và hủy Action run.`, buttons: getMachineControlButtons(m, name) });
      return;
    }

    // Khởi động lại
    if (kind === 'rs') {
      let vmOk = false;
      if (m.info && m.info.ip) {
        try {
          await sendVmCommand(m, 'restart');
          vmOk = true;
        } catch {}
      }
      if (!vmOk) {
        try {
          const ref = await getRef(ac);
          const inputs = { machine_id: name, duration: m.input || '5h00m' };
          if (m.hasWebhookInput) inputs.bot_webhook_url = getWebhookUrl();
          await gh('POST', `/repos/${ac.repo}/actions/workflows/${encodeURIComponent(m.file || fileOf(name))}/dispatches`, { ref, inputs }, false, ac);
          m.status = 'dispatched';
          m.dispatchAt = Date.now() - 3000;
          saveToBridgeFile();
          ui.after(6, 'find|' + name + '|0');
        } catch (e) {
          ui.reply(`❌ Lỗi khởi động lại **${name}**: ${e.message}`);
          return;
        }
      }
      ui.reply({ content: `🔁 Đã gửi lệnh khởi động lại máy **${name}**!`, buttons: getMachineControlButtons(m, name) });
      return;
    }

    // Lưu ổ đĩa ngay
    if (kind === 'sv') {
      try {
        const r = await sendVmCommand(m, 'save');
        ui.reply(`💾 **[${name}]** ${r.message || 'Đã gửi lệnh lưu ổ đĩa thành công!'}`);
      } catch (e) {
        ui.reply(`❌ Không gửi được lệnh lưu ổ đĩa qua IP máy **${name}**: ${e.message}`);
      }
      return;
    }

    // Xóa máy
    if (kind === 'del') {
      if (m.runId) {
        try { await gh('POST', `/repos/${ac.repo}/actions/runs/${m.runId}/cancel`, null, false, ac); } catch {}
      }
      delete R.machines[name];
      saveToBridgeFile();
      ui.reply(`🗑️ Đã xóa máy **${name}** khỏi danh sách máy hoạt động.`);
      return;
    }

    // Xóa ổ đĩa lưu trữ (Release Tag & State Branch trên Repo Gốc)
    if (kind === 'delstorage') {
      const stAcc = getStorageAcc(m);
      const relTag = (m.info && m.info.repoTag) || ('aistv-storage-' + name);
      const stBranch = (m.info && m.info.stateBranch) || ('aistv-state-' + name);
      const msgParts = [];
      try {
        const rel = await gh('GET', `/repos/${stAcc.repo}/releases/tags/${encodeURIComponent(relTag)}`, null, false, stAcc);
        if (rel && rel.id) {
          await gh('DELETE', `/repos/${stAcc.repo}/releases/${rel.id}`, null, false, stAcc);
          msgParts.push(`Release \`${relTag}\``);
        }
      } catch {}
      try {
        await gh('DELETE', `/repos/${stAcc.repo}/git/refs/tags/${encodeURIComponent(relTag)}`, null, false, stAcc);
        msgParts.push(`Tag \`${relTag}\``);
      } catch {}
      try {
        await gh('DELETE', `/repos/${stAcc.repo}/git/refs/heads/${encodeURIComponent(stBranch)}`, null, false, stAcc);
        msgParts.push(`State \`${stBranch}\``);
      } catch {}
      ui.reply(`💽 Đã xóa bộ nhớ ổ đĩa của máy **${name}** trên Repo Gốc (` + stAcc.repo + `):` + (msgParts.length ? ' ' + msgParts.join(', ') : ' đã sạch từ trước.'));
      return;
    }

    // Xem log (giữ lại cho Admin / chủ máy khi cần)
    if (kind === 'lg') {
      const run = m.runId ? { id: m.runId } : await findRun(name, ac);
      if (!run) { ui.reply('Không thấy run nào của máy này.'); return; }
      const L = await runLog(run.id, ac);
      const infoStep = L.steps.find(s => /THÔNG TIN KẾT NỐI/i.test(s.head || s.stepName || ''));
      const target = (infoStep && L.annRaw) ? infoStep : L.steps[L.steps.length - 1];
      ui.reply(cut(fence(cutTail(target ? fmtStep(target) : '(chưa có log)', 1750)), 1990));
      return;
    }

    // File JSON đầy đủ 28 trường
    if (kind === 'fi') {
      const fullObj = getMachineFullJson(m, name);
      const isOnline = !!(m.status !== 'stopped' && m.status !== 'done' && m.lastReportAt && (Date.now() - m.lastReportAt < 600000));
      const curPass = canSee(m) ? (fullObj.password || '***') : '***';
      const fJson = JSON.stringify(fullObj, null, 2);
      const dom = (R.duckdns && R.duckdns.domain) || 'datdemo.duckdns.org';
      const prt = ENV.PORT || ENV.APP_PORT || '3000';
      ui.reply({
        content: `📄 **File thông tin phiên máy \`${name}\` (đầy đủ 28 trường)** (${isOnline ? '🟢 Online' : '🔴 Offline'})\n• Phiên: \`${fullObj.sessionId}\` · IP: \`${fullObj.tailscaleIp || '?'}\` · User: \`${fullObj.user}\` · MK: \`${curPass}\`\n📥 Xem hoặc tải thêm file trên Web: http://${dom}:${prt}/rdp-files`,
        files: [{ name: `machine-info-${name}.json`, text: fJson }]
      });
      return;
    }

    // Prompt tự cải thiện
    if (kind === 'pr') {
      const p = m.autoPrompt || `[MÁY: ${m.name}]\n- Trạng thái: ${m.isOnline ? '🟢 Online' : '🔴 Offline'}\n- IP: ${(m.info && m.info.ip) || '?'}\n- User: ${(m.info && m.info.user) || 'runneradmin'}\n- MK: ${(m.info && m.info.pass) || '?'}`;
      ui.reply(cut('📝 **Prompt tự cải thiện của máy `' + name + '`:**\n' + fence(p), 1990));
      return;
    }

    // Check IP & Giờ
    if (kind === 'pi') {
      let live = null;
      try { live = await fetchVmLiveInfo(m); } catch {}
      const fullObj = getMachineFullJson(m, name);
      const isOnline = (m.status !== 'stopped' && m.status !== 'done' && m.lastReportAt && (Date.now() - m.lastReportAt < 600000));
      const health = isOnline ? '🟢 ĐANG HOẠT ĐỘNG (Online)' : '🔴 KHÔNG HOẠT ĐỘNG (Offline)';
      const jsonFormatted = JSON.stringify(fullObj, null, 2);
      const curPass = canSee(m) ? (fullObj.password || '***') : '***';
      const liveText = live
        ? `• Trực tiếp HTTP 8080: Còn **${live.remainText}**\n`
        : `• Cập nhật qua server: ${m.lastReportAt ? vn(m.lastReportAt) : 'Chưa có'}\n`;

      ui.reply({
        content: `📡 **Thông tin máy \`${name}\`** (${health}) — Phiên: \`${fullObj.sessionId}\`\n` +
          `• IP Tailscale: \`${fullObj.tailscaleIp || '?'}\` · User: \`${fullObj.user}\` · MK: \`${curPass}\`\n` +
          `• Còn lại: **${Math.floor(fullObj.remainSeconds / 60)} phút** · Ổ \`${fullObj.driveLetter}:\\\`: ${fullObj.diskUsedGb}GB / ${fullObj.diskFreeGb}GB trống\n` +
          liveText +
          `\`\`\`json\n${jsonFormatted.slice(0, 1000)}${jsonFormatted.length > 1000 ? '\n// ... tải file để xem toàn bộ 28 trường' : ''}\n\`\`\``,
        files: [{ name: `machine-info-${name}.json`, text: jsonFormatted }]
      });
      return;
    }
    return;
  }

  // ---------------- LỆNH CHỮ ----------------
  try { if (typeof deleteMsg === 'function') deleteMsg(); } catch {}
  syncFromBridgeFile();
  const firstWord = (ctx.args[0] || '').toLowerCase();
  let a = ctx.args.slice(1);
  let sub = (a[0] || '').toLowerCase();
  let arg = a[1] || '';

  // Hỗ trợ alias lệnh !thongtin <tên>
  if (firstWord === '!thongtin') {
    sub = 'info';
    arg = a[0] || '';
  }
  const say = (c, extra) => ui.send({ content: c, ...(extra || {}) });

  // --- BẮT VÀ NẠP FILE TỔNG HỢP GỬI ĐÍNH KÈM TỪ DISCORD (Ổ D:\) ---
  const jsonAttach = (ctx.attachments || []).find(att => (att.name || '').toLowerCase().endsWith('.json') || (att.contentType || '').includes('json'));
  if (jsonAttach && (sub === 'nhanfile' || sub === 'napfile' || sub === 'file' || sub === 'upload' || !sub)) {
    try {
      const fRes = await fetch(jsonAttach.url, { signal: AbortSignal.timeout(10000) });
      if (!fRes.ok) return say(`❌ Không tải được file từ Discord: HTTP ${fRes.status}`);
      const fText = await fRes.text();
      let fData;
      try { fData = JSON.parse(fText); } catch { return say(`❌ Nội dung file **${jsonAttach.name}** không phải định dạng JSON hợp lệ.`); }

      const mId = String(fData.machineId || fData.name || arg || jsonAttach.name.replace(/^machine-info-|\.json$/gi, '')).trim().toLowerCase();
      if (!mId) return say('❌ Không tìm thấy `machineId` trong file JSON. Hãy gõ `!may nhanfile <tên_máy>` kèm file đính kèm.');

      const m = R.machines[mId] = R.machines[mId] || { name: mId, file: fileOf(mId), created: Date.now() };
      m.lastReportAt = Date.now();
      m.lastFileReceived = jsonAttach.name;
      m.lastFileAt = Date.now();

      const sid = String(fData.sessionId || (mId + '-' + Date.now())).trim();
      m.currentSessionId = sid;
      m.info = Object.assign(m.info || {}, {
        machineId: mId,
        ip: fData.tailscaleIp || fData.ip || (m.info && m.info.ip) || '',
        user: fData.user || (m.info && m.info.user) || 'runneradmin',
        pass: fData.password || fData.pass || (m.info && m.info.pass) || '',
        webPort: fData.webPort || '8080',
        sunshinePort: fData.sunshinePort || '47990',
        sunshine: fData.sunshineUrl || (fData.tailscaleIp ? `https://${fData.tailscaleIp}:${fData.sunshinePort || 47990}/` : ''),
        panel: fData.panelUrl || (fData.tailscaleIp ? `http://${fData.tailscaleIp}:${fData.webPort || 8080}/` : ''),
        stardesk: fData.stardeskStatus || 'Đang chạy',
        resolution: fData.resolution || '',
        audio: fData.audioDevice || '',
        disk: fData.driveLetter ? `${fData.driveLetter}:\\` : (m.info && m.info.disk) || '',
        remainSeconds: fData.remainSeconds != null ? Number(fData.remainSeconds) : null,
        diskUsedGb: fData.diskUsedGb != null ? fData.diskUsedGb : null,
        diskFreeGb: fData.diskFreeGb != null ? fData.diskFreeGb : null,
        updatedUtc: new Date().toISOString()
      });
      if (m.info.ip || m.info.stardeskId || m.info.machineId || m.info.user) {
        m.status = 'ready';
        m.infoAt = Date.now();
      }

      // Ghi nhận phiên vào R.sessions
      R.sessions = R.sessions || {};
      R.sessions[mId] = R.sessions[mId] || [];
      let sess = R.sessions[mId].find(s => s.sessionId === sid);
      if (!sess) {
        sess = { sessionId: sid, startedAt: Date.now(), status: 'active', ip: m.info.ip, user: m.info.user, pass: m.info.pass, info: {} };
        R.sessions[mId].push(sess);
        if (R.sessions[mId].length > 30) R.sessions[mId] = R.sessions[mId].slice(-30);
      }
      sess.lastHeartbeat = Date.now();
      sess.status = 'active';
      sess.ip = m.info.ip;
      sess.user = m.info.user;
      sess.pass = m.info.pass;
      sess.info = Object.assign(sess.info || {}, m.info);
      m.latestSession = sess;

      const remText = m.info.remainSeconds != null ? (Math.floor(m.info.remainSeconds / 3600) + 'h ' + Math.floor((m.info.remainSeconds % 3600) / 60) + 'm') : 'N/A';
      m.autoPrompt = [
        `[THÔNG TIN MÁY RDP: ${mId.toUpperCase()}]`,
        `- Trạng thái: 🟢 ĐANG HOẠT ĐỘNG (Online)`,
        `- IP Tailscale: ${m.info.ip || 'Chưa có'}`,
        `- Tài khoản RDP: ${m.info.user || 'runneradmin'}`,
        `- Mật khẩu: ${m.info.pass || 'Chưa có'}`,
        `- Mã phiên: ${sid}`,
        `- Thời gian còn lại: ${remText}`,
        `- Web Quản Lý: ${m.info.panel || 'N/A'}`,
        `- Sunshine Web: ${m.info.sunshine || 'N/A'}`,
        `- Cập nhật gần nhất: ${new Date().toISOString()}`
      ].join('\n');

      try {
        const fileDir = path.join(process.cwd(), 'rdp-sessions', mId);
        if (!fs.existsSync(fileDir)) fs.mkdirSync(fileDir, { recursive: true });
        fs.writeFileSync(path.join(fileDir, jsonAttach.name), fText, 'utf8');
      } catch {}

      saveToBridgeFile();

      const dom = (R.duckdns && R.duckdns.domain) || 'datdemo.duckdns.org';
      const prt = ENV.PORT || ENV.APP_PORT || '3000';
      return say(
        `✅ **Đã bắt và nạp thành công file \`${jsonAttach.name}\`!**\n` +
        `• Máy: \`${mId}\` · Mã phiên: \`${sid}\`\n` +
        `• IP Tailscale: \`${m.info.ip || '?'}\` · User: \`${m.info.user}\` · MK: \`${canSee(m) ? (m.info.pass || '***') : '***'}\`\n` +
        `• Trạng thái: 🟢 **Đang hoạt động (Online)**\n` +
        `📥 **Trang Nhận File Web:** http://${dom}:${prt}/rdp-files\n` +
        `📝 **Prompt tự cải thiện:**\n` + fence(m.autoPrompt)
      );
    } catch (err) {
      return say(`❌ Lỗi xử lý file đính kèm: ${err.message}`);
    }
  }

  if (!sub || sub === 'help') {
    const dom = (R.duckdns && R.duckdns.domain) || 'datdemo.duckdns.org';
    const prt = ENV.PORT || ENV.APP_PORT || '3000';
    say(
      '**🖥️ Quản lý máy RDP & Đa Acc GitHub**\n' +
      '**1. Lệnh cơ bản (Giữ nguyên):**\n' +
      '`!may tao <tên> [1h|3h|5h] [acc]` — tạo file từ may3 + chạy máy\n' +
      '`!may chay <tên> [1h|3h|5h] [acc]` — chạy lại máy đã có\n' +
      '`!may ds` — danh sách máy đang chạy + bảng đăng nhập ẩn\n' +
      '`!may log <tên|runId> [số|cuoi|all]` — đọc log & lấy link\n' +
      '`!may dung <tên>` — hủy ngay action đang chạy\n\n' +
      '**2. Điều khiển máy trực tiếp & Vòng đời máy:**\n' +
      '`!may info <tên>` — kiểm tra thời gian & lấy danh sách thông tin từ IP máy\n' +
      '`!may phien <tên>` — xem các phiên, kiểm tra máy online/offline & prompt\n' +
      '`!may prompt <tên>` — lấy prompt tóm tắt mới nhất để tự cải thiện bot/AI\n' +
      '`!may lenh <tên> <save|restart|stop|ping|pass|msg> [nội_dung]` — gửi lệnh về IP máy\n' +
      '`!may tat <tên>` — lưu ổ đĩa & tắt máy an toàn (hoặc hủy action)\n' +
      '`!may khoi-dong-lai <tên> [1h|3h|5h]` — lưu & khởi động lại tiến trình mới\n' +
      '`!may taolai <tên> [1h|3h|5h] [acc]` — xóa workflow cũ, tạo lại từ mẫu & chạy\n\n' +
      '**3. Nhận & Tải File Phiên Tổng Hợp (Ổ D:\\):**\n' +
      '`!may file <tên>` — tải file JSON của máy về Discord (hoặc đính kèm file JSON để nạp vào bot)\n' +
      '`!may trang` — lấy link Trang Nhận File & Trang Quản Lý trên Web\n\n' +
      '**4. Quản lý Bộ nhớ, Trao quyền & Đa Tài Khoản Git:**\n' +
      '`!may bonho <tên>` — xem dung lượng lưu trên Release & nhánh State\n' +
      '`!may xoabonho <tên>` — xóa sạch bộ nhớ máy từ thẳng repo\n' +
      '`!may giao <tên> <@user|userId> [tên]` — trao quyền / đánh dấu ID máy cho người dùng\n' +
      '`!may thuhoi <tên>` · `!may quyen <@user> <số_máy>`\n' +
      '`!may xoafile <tên>` · `!may xoaaction <tên>` · `!may xoa <tên>`\n' +
      '`!may acc` · `!may acc them <alias> <owner/repo> <token> [nhánh] [mẫu]`\n' +
      '`!may acc chon <alias>` · `!may acc xoa <alias>` · `!may duck <token> [domain]`\n' +
      `📥 **Trang Nhận File:** \`http://${dom}:${prt}/rdp-files\`\n` +
      `🌐 **Web Quản Lý:** \`http://${dom}:${prt}/rdp-manager\``
    );
    return;
  }

  // ---------------- CẤU HÌNH TAILSCALE / PASS / DUCKDNS / ACC GIT ----------------
  if (sub === 'ts') {
    deleteMsg();
    if (!isStaff) return say('Chỉ Admin / chủ server.');
    if (!/^tskey-[\w-]{10,}$/.test(arg)) return say('Token không đúng dạng `tskey-auth-...`.');
    R.tsToken = arg; R.tsAt = Date.now();
    saveToBridgeFile();
    return say('✅ Đã lưu Token Tailscale vào data.json (đã xóa tin chứa token).');
  }

  if (sub === 'pass') {
    deleteMsg();
    if (!isStaff) return say('Chỉ Admin / chủ server.');
    if (!arg) return say('Dùng: `!may pass <mật_khẩu_RDP>`');
    R.rdpPass = arg;
    saveToBridgeFile();
    return say('✅ Đã lưu mật khẩu RDP cố định vào data.json (đã xóa tin nhắn).');
  }

  if (sub === 'duck') {
    deleteMsg();
    if (!isStaff) return say('Chỉ Admin / chủ server.');
    if (!arg) return say('Dùng: `!may duck <duckdns_token> [domain]` (VD: `!may duck a1b2c3d4-... datdemo.duckdns.org`)');
    const dom = (a[2] || (R.duckdns && R.duckdns.domain) || 'datdemo.duckdns.org').trim().toLowerCase();
    const subDom = dom.replace(/\.duckdns\.org$/i, '');
    const ip = ENV.TAILSCALE_IP && ENV.TAILSCALE_IP !== 'localhost' ? ENV.TAILSCALE_IP : '';
    R.duckdns = { domain: subDom + '.duckdns.org', token: arg.trim(), updatedAt: Date.now() };
    saveToBridgeFile();
    try {
      const u = `[https://www.duckdns.org/update?domains=$](https://www.duckdns.org/update?domains=$){encodeURIComponent(subDom)}&token=${encodeURIComponent(arg.trim())}&ip=${encodeURIComponent(ip)}&verbose=true`;
      const res = await fetch(u, { signal: AbortSignal.timeout(10000) });
      const txt = (await res.text()).trim();
      return say(`🦆 Đã lưu DuckDNS token và trỏ \`${subDom}.duckdns.org\` → \`${ip || 'Auto IP'}\` (Kết quả: \`${txt.split(/\r?\n/)[0]}\`).`);
    } catch (e) {
      return say(`🦆 Đã lưu DuckDNS token cho \`${subDom}.duckdns.org\`, nhưng cập nhật tức thời lỗi: ${e.message}`);
    }
  }

  if (sub === 'acc' || sub === 'git') {
    if (!isStaff) return say('Chỉ Admin / chủ server.');
    const act = (arg || '').toLowerCase();
    if (!act || act === 'ds' || act === 'list') {
      const list = Object.values(R.accounts);
      if (!list.length) return say('Chưa có tài khoản Git nào. Thêm bằng: `!may acc them <alias> <owner/repo> <token> [nhánh] [file_mẫu]`');
      const rows = list.map(x => `• **${x.alias}**${x.alias === R.defaultAccount ? '⭐ *(Mặc định)*' : ''} — repo: \`${x.repo}\` · nhánh: \`${x.branch || 'main'}\` · mẫu: \`${x.template || 'may3.yml'}\` · token: \`${x.token ? x.token.slice(0, 7) + '***' : '❌'}\``);
      return say('**📚 Danh sách Tài Khoản GitHub & Repo:**\n' + rows.join('\n'));
    }
    if (act === 'them' || act === 'add') {
      deleteMsg();
      const alias = nameOk(a[2]);
      const rp = (a[3] || '').trim();
      const tk = (a[4] || '').trim();
      const br = (a[5] || 'main').trim();
      const tpl = (a[6] || 'may3.yml').trim();
      if (!alias || !/^[^/]+\/[^/]+$/.test(rp) || !tk) {
        return say('Dùng: `!may acc them <alias> <owner/repo> <token> [nhánh] [file_mẫu]`\nVD: `!may acc them acc2 ddvdat/rdp-server2 ghp_xxx main may3.yml`');
      }
      R.accounts[alias] = { alias, repo: rp, token: tk, branch: br, wfDir: '.github/workflows', template: tpl, updatedAt: Date.now() };
      if (!R.defaultAccount) R.defaultAccount = alias;
      saveToBridgeFile();
      return say(`✅ Đã lưu tài khoản Git **${alias}** (Repo: \`${rp}\`, Nhánh: \`${br}\`, Mẫu: \`${tpl}\`). Đã xóa tin chứa token.`);
    }
    if (act === 'xoa' || act === 'del') {
      const alias = nameOk(a[2]);
      if (!alias || !R.accounts[alias]) return say('Không tìm thấy tài khoản Git `' + (a[2] || '') + '`.');
      delete R.accounts[alias];
      if (R.defaultAccount === alias) R.defaultAccount = Object.keys(R.accounts)[0] || '';
      saveToBridgeFile();
      return say(`🗑️ Đã xóa tài khoản Git **${alias}**.`);
    }
    if (act === 'chon' || act === 'default') {
      const alias = nameOk(a[2]);
      if (!alias || !R.accounts[alias]) return say('Không tìm thấy tài khoản Git `' + (a[2] || '') + '`.');
      R.defaultAccount = alias;
      saveToBridgeFile();
      return say(`⭐ Đã đặt **${alias}** (\`${R.accounts[alias].repo}\`) làm tài khoản Git mặc định khi tạo máy mới.`);
    }
    return say('Dùng: `!may acc` | `!may acc them <alias> <owner/repo> <token> [nhánh] [mẫu]` | `!may acc chon <alias>` | `!may acc xoa <alias>`');
  }

  // ---------------- QUẢN LÝ TRAO QUYỀN & ĐÁNH DẤU ID MÁY CHO NGƯỜI DÙNG ----------------
  if (sub === 'giao' || sub === 'gan' || sub === 'assign') {
    const name = nameOk(arg);
    const targetUid = cleanUid(a[2]);
    const targetName = a.slice(3).join(' ').trim() || targetUid;
    if (!name || !targetUid) return say('Dùng: `!may giao <tên_máy> <@user|userId> [tên_hiển_thị]`');
    const m = R.machines[name];
    if (m && m.ownerId && m.ownerId !== ctx.user.id && !isStaff) {
      return say('🚫 Chỉ Admin hoặc chủ máy hiện tại mới được chuyển nhượng quyền máy `' + name + '`.');
    }
    rec(name, {
      ownerId: targetUid,
      owner: targetName
    });
    return say(`🏷️ Đã đánh dấu & trao quyền sở hữu máy **${name}** cho <@${targetUid}> (\`${targetUid}\`).`);
  }

  if (sub === 'thuhoi' || sub === 'unassign') {
    if (!isStaff) return say('Chỉ Admin / chủ server.');
    const name = nameOk(arg);
    if (!name || !R.machines[name]) return say('Không thấy máy `' + (name || arg) + '`.');
    R.machines[name].ownerId = ctx.user.id;
    R.machines[name].owner = ctx.user.display;
    R.machines[name].sharedUsers = [];
    saveToBridgeFile();
    return say(`🔒 Đã thu hồi quyền sở hữu máy **${name}** về Admin (${ctx.user.display}).`);
  }

  if (sub === 'quyen' || sub === 'quota') {
    if (!isStaff) return say('Chỉ Admin / chủ server.');
    const targetUid = cleanUid(arg);
    const limit = Math.max(0, parseInt(a[2], 10));
    if (!targetUid || isNaN(limit)) return say('Dùng: `!may quyen <@user|userId> <số_máy_tối_đa>` (VD: `!may quyen @user 3`)');
    R.quotas[targetUid] = limit;
    saveToBridgeFile();
    return say(`✅ Đã đặt giới hạn số máy tối đa cho <@${targetUid}> là **${limit} máy**.`);
  }

  // ---------------- XÓA GHI NHẬN / XÓA FILE WORKFLOW / XÓA ACTIONS / XÓA BỘ NHỚ ----------------
  if (sub === 'xoa') {
    if (!isStaff) return say('Chỉ Admin / chủ server.');
    const name = nameOk(arg);
    if (!name || !R.machines[name]) return say('Không thấy máy `' + (name || arg) + '` trong danh sách.');
    delete R.machines[name];
    saveToBridgeFile();
    return say('🗑️ Đã xóa ghi nhận máy `' + name + '` khỏi data.json.');
  }

  if (sub === 'xoafile') {
    if (!isStaff) return say('Chỉ Admin / chủ server.');
    const name = nameOk(arg);
    if (!name || ['bot', 'may3', 'taomay'].includes(name)) return say('Tên máy không hợp lệ hoặc bị bảo vệ.');
    const m = R.machines[name];
    const ac = getAcc(a[2] || m);
    const ref = await getRef(ac);
    const wfPath = (ac.wfDir || defaultWfDir) + '/' + ((m && m.file) || fileOf(name));
    try {
      const f = await gh('GET', `/repos/${ac.repo}/contents/${wfPath}?ref=${encodeURIComponent(ref)}`, null, false, ac);
      await gh('DELETE', `/repos/${ac.repo}/contents/${wfPath}`, {
        message: 'Xóa file workflow máy ' + name,
        sha: f.sha,
        branch: ref
      }, false, ac);
      return say(`🗑️ Đã xóa file workflow \`${wfPath}\` khỏi repo \`${ac.repo}\`.`);
    } catch (e) {
      return say(`❌ Không xóa được file \`${wfPath}\` trên \`${ac.repo}\`: ${e.message}`);
    }
  }

  if (sub === 'xoaaction' || sub === 'xoarun') {
    if (!isStaff) return say('Chỉ Admin / chủ server.');
    const name = nameOk(arg);
    if (!name) return say('Dùng: `!may xoaaction <tên_máy>`');
    const m = R.machines[name];
    const ac = getAcc(a[2] || m);
    const wfFile = (m && m.file) || fileOf(name);
    const r = await gh('GET', `/repos/${ac.repo}/actions/workflows/${encodeURIComponent(wfFile)}/runs?per_page=30`, null, false, ac);
    const runs = r.workflow_runs || [];
    if (!runs.length) return say(`ℹ️ Không có lịch sử workflow run nào của máy **${name}** trên \`${ac.repo}\`.`);
    let canceled = 0, deleted = 0;
    for (const run of runs) {
      if (run.status !== 'completed') {
        try { await gh('POST', `/repos/${ac.repo}/actions/runs/${run.id}/cancel`, null, false, ac); canceled++; } catch {}
      }
      try { await gh('DELETE', `/repos/${ac.repo}/actions/runs/${run.id}`, null, false, ac); deleted++; } catch {}
    }
    if (m) { m.status = 'stopped'; m.runId = null; m.info = null; saveToBridgeFile(); }
    return say(`🧹 Đã hủy **${canceled}** run đang chạy và xóa **${deleted}/${runs.length}** lịch sử Actions của máy **${name}** trên \`${ac.repo}\`.`);
  }

  if (sub === 'bonho' || sub === 'storage') {
    const name = nameOk(arg);
    if (!name) return say('Dùng: `!may bonho <tên_máy>`');
    const m = R.machines[name];
    if (m && !canSee(m)) return say('🚫 Bạn không phải chủ máy này.');
    const stAcc = getStorageAcc(m);
    const relTag = (m && m.info && m.info.repoTag) || ('aistv-storage-' + name);
    const stBranch = (m && m.info && m.info.stateBranch) || ('aistv-state-' + name);
    const L = [`**💽 Bộ nhớ lưu trữ của máy \`${name}\` trên Repo Gốc \`${stAcc.repo}\`:**`];
    try {
      const rel = await gh('GET', `/repos/${stAcc.repo}/releases/tags/${encodeURIComponent(relTag)}`, null, false, stAcc);
      const assets = rel.assets || [];
      const totalBytes = assets.reduce((sum, x) => sum + (x.size || 0), 0);
      L.push(`• **Release Tag:** \`${relTag}\` — Tổng dung lượng: **${fmtSize(totalBytes)}** (${assets.length} file)`);
      if (assets.length) {
        L.push('  Các mảnh: ' + assets.map(x => `\`${x.name}\` (${fmtSize(x.size)})`).join(', '));
      }
    } catch (e) {
      L.push(`• **Release Tag:** \`${relTag}\` — *(Chưa có dữ liệu hoặc đã xóa)*`);
    }
    try {
      await gh('GET', `/repos/${stAcc.repo}/branches/${encodeURIComponent(stBranch)}`, null, false, stAcc);
      L.push(`• **Nhánh State & Registry:** \`${stBranch}\` — ✅ Đang tồn tại`);
    } catch {
      L.push(`• **Nhánh State & Registry:** \`${stBranch}\` — *(Chưa có hoặc đã xóa)*`);
    }
    if (m && m.info && m.info.diskUsedGb != null) {
      L.push(`• **Ổ đĩa ảo trực tiếp trên VM:** Đã dùng **${m.info.diskUsedGb} GB** / Trống **${m.info.diskFreeGb} GB**`);
    }
    return say(L.join('\n'));
  }

  if (sub === 'xoabonho' || sub === 'resetbonho') {
    const name = nameOk(arg);
    if (!name) return say('Dùng: `!may xoabonho <tên_máy>`');
    const m = R.machines[name];
    if (m && m.ownerId && m.ownerId !== ctx.user.id && !isStaff) {
      return say('🚫 Chỉ Admin hoặc chủ máy mới được xóa bộ nhớ của máy `' + name + '`.');
    }
    if (!m && !isStaff) return say('🚫 Chỉ Admin hoặc chủ máy mới được xóa bộ nhớ.');
    const stAcc = getStorageAcc(m);
    const relTag = (m && m.info && m.info.repoTag) || ('aistv-storage-' + name);
    const stBranch = (m && m.info && m.info.stateBranch) || ('aistv-state-' + name);
    const msgParts = [];
    try {
      const rel = await gh('GET', `/repos/${stAcc.repo}/releases/tags/${encodeURIComponent(relTag)}`, null, false, stAcc);
      if (rel && rel.id) {
        await gh('DELETE', `/repos/${stAcc.repo}/releases/${rel.id}`, null, false, stAcc);
        msgParts.push(`Đã xóa Release \`${relTag}\``);
      }
    } catch {}
    try {
      await gh('DELETE', `/repos/${stAcc.repo}/git/refs/tags/${encodeURIComponent(relTag)}`, null, false, stAcc);
      msgParts.push(`Đã xóa Git Tag \`${relTag}\``);
    } catch {}
    try {
      await gh('DELETE', `/repos/${stAcc.repo}/git/refs/heads/${encodeURIComponent(stBranch)}`, null, false, stAcc);
      msgParts.push(`Đã xóa nhánh State \`${stBranch}\``);
    } catch {}
    if (!msgParts.length) return say(`ℹ️ Máy **${name}** không có bộ nhớ lưu trữ nào trên Repo Gốc \`${stAcc.repo}\` (hoặc đã sạch từ trước).`);
    return say(`🧹 **[${name}]** Hoàn tất xóa sạch bộ nhớ từ Repo Gốc \`${stAcc.repo}\`: ${msgParts.join(' · ')}.`);
  }

  if (sub === 'xem') {
    if (!isStaff) return say('Chỉ Admin / chủ server.');
    if (!['owner', 'all'].includes(arg)) return say('Dùng `!may xem owner` hoặc `!may xem all`. Hiện tại: **' + (R.view === 'all' ? 'all' : 'owner') + '**');
    R.view = arg;
    saveToBridgeFile();
    return say('✅ Bảng đăng nhập ẩn: ' + (arg === 'all' ? 'mọi người xem được mọi máy' : 'chỉ chủ máy và Admin xem được'));
  }

  if (sub === 'cfg') {
    if (!isStaff) return say('Chỉ Admin / chủ server.');
    const ac = getAcc();
    const dom = (R.duckdns && R.duckdns.domain) || ENV.DUCKDNS_DOMAIN || 'datdemo.duckdns.org';
    return say(
      `⚙️ **Cấu hình Bot & RDP:**\n` +
      `• Acc Git mặc định: \`${ac.alias}\` (\`${ac.repo || '?'}\`) · Tổng số Acc Git: **${Object.keys(R.accounts).length}**\n` +
      `• DuckDNS: \`${dom}\` (IP Bot: \`${ENV.TAILSCALE_IP || '?'}\`) · Webhook: \`${getWebhookUrl()}\`\n` +
      `• Token GitHub: ${ac.token ? '✅' : '❌'} · Tailscale token: ${R.tsToken ? '✅' : '❌'} · Mật khẩu RDP: ${R.rdpPass || ENV.RDP_PASSWORD ? '✅' : '❌'} · Chế độ xem: **${R.view === 'all' ? 'all' : 'owner'}**\n` +
      `• Máy đã ghi nhận (${Object.keys(R.machines).length}): ` + (Object.keys(R.machines).map(k => `\`${k}\` (${R.machines[k].owner || '?'})`).join(', ') || '(chưa có)')
    );
  }

  // ---------------- KIỂM TRA THÔNG TIN TRỰC TIẾP & GỬI LỆNH VỀ IP MÁY ----------------
  if (sub === 'info' || sub === 'check' || sub === 'time') {
    const name = nameOk(arg);
    if (!name) return say('Dùng: `!may info <tên_máy> [json]` để xem thông tin máy ảo & xuất file JSON đầy đủ.');
    syncFromBridgeFile();
    let m = R.machines[name];
    if (!m) {
      const diskObj = getMachineFullJson(null, name);
      if (diskObj && (diskObj.stardeskId || diskObj.machineId || diskObj.tailscaleIp || diskObj.user)) {
        m = R.machines[name] = {
          name,
          file: name + '.yml',
          created: Date.now(),
          status: diskObj.status || 'ready',
          lastReportAt: Date.now(),
          currentSessionId: diskObj.sessionId,
          fileData: diskObj,
          info: {
            stardeskId: diskObj.stardeskId,
            storageRepo: diskObj.storageRepo || defaultStorageRepo,
            runnerRepo: diskObj.runnerRepo || defaultRunnerRepo,
            ip: diskObj.tailscaleIp,
            user: diskObj.user,
            pass: diskObj.password,
            password: diskObj.password,
            webPort: diskObj.webPort,
            sunshinePort: diskObj.sunshinePort
          }
        };
        saveToBridgeFile();
      }
    }
    if (!m) return say('Không tìm thấy máy `' + name + '`.');
    if (!canSee(m)) return say('🚫 Bạn không phải chủ máy này.');

    const fullObj = getMachineFullJson(m, name);
    const jsonFormatted = JSON.stringify(fullObj, null, 2);
    const isOnline = (m.status !== 'stopped' && m.status !== 'done' && m.lastReportAt && (Date.now() - m.lastReportAt < 600000));
    const health = isOnline ? '🟢 ĐANG HOẠT ĐỘNG (Online)' : '🔴 KHÔNG HOẠT ĐỘNG (Offline / Mất kết nối)';
    const hbAgo = m.lastReportAt ? Math.floor((Date.now() - m.lastReportAt) / 1000) : null;
    const hbText = hbAgo != null ? (hbAgo < 60 ? hbAgo + 's trước' : Math.floor(hbAgo / 60) + 'm trước') : 'chưa có';

    // Thử lấy thêm thông tin trực tiếp từ port 8080 nếu máy đang bật (không bắt buộc)
    let live = null;
    try { live = await fetchVmLiveInfo(m); } catch {}

    const isJsonOnly = (a[2] || '').toLowerCase() === 'json' || (arg && arg.toLowerCase().endsWith('.json'));
    if (isJsonOnly) {
      return say(
        `📄 **File JSON thông tin máy \`${name}\` (đầy đủ 28 trường từ ổ D:\\):**\n\`\`\`json\n${jsonFormatted}\n\`\`\``,
        { files: [{ name: `machine-info-${name}.json`, text: jsonFormatted }] }
      );
    }

    const curPass = canSee(m) ? (fullObj.password || '***') : '***';
    const remM = Math.floor(fullObj.remainSeconds / 60);
    const remH = Math.floor(remM / 60);
    const remStr = `${remH}h ${remM % 60}m (${fullObj.remainSeconds}s)`;

    const msg = [
      `📋 **THÔNG TIN MÁY \`${name}\`** — Trạng thái: ${health} (Heartbeat: ${hbText})`,
      `• **Mã phiên (Session):** \`${fullObj.sessionId}\``,
      `• **StarDesk ID:** \`${fullObj.stardeskId || 'Chưa có'}\` (${fullObj.stardeskStatus || 'Đang chạy'})`,
      `• **User RDP:** \`${fullObj.user}\` · **MK:** \`${curPass}\``,
      `• **Thời gian còn lại:** **${remStr}**`,
      `• **Kho lưu trữ (Repo Gốc):** \`${fullObj.storageRepo || defaultStorageRepo}\` (\`${fullObj.releaseTag}\`)`,
      `• **Runner:** \`${fullObj.runnerRepo || (m && m.repo) || defaultRunnerRepo}\``,
      `• **Ổ đĩa riêng \`${fullObj.driveLetter}:\\\`:** Đã dùng **${fullObj.diskUsedGb} GB** / Trống **${fullObj.diskFreeGb} GB**`,
      m.autoPrompt ? `• 📝 **Auto-prompt:** ${m.autoPrompt.split('\n')[0]}` : null,
      `\n📄 **Nội dung file JSON từ ổ D:\\ đã gửi về server (đầy đủ 28 trường):**`,
      `\`\`\`json\n${jsonFormatted.slice(0, 800)}${jsonFormatted.length > 800 ? '\n// ... xem thêm trong file đính kèm' : ''}\n\`\`\``
    ].filter(Boolean).join('\n');

    return say(
      cut(msg, 1990),
      {
        files: [{ name: `machine-info-${name}.json`, text: jsonFormatted }],
        buttons: getMachineControlButtons(m, name)
      }
    );
  }

  // ---------------- LỆNH !may phien: XEM LỊCH SỬ PHIÊN, CHECK MÁY HOẠT ĐỘNG & PROMPT ----------------
  if (sub === 'phien' || sub === 'session' || sub === 'sessions') {
    const name = nameOk(arg);
    if (!name) return say('Dùng: `!may phien <tên_máy>` để xem lịch sử phiên kết nối & kiểm tra máy có hoạt động.');
    const m = R.machines[name];
    if (!m) return say('Không tìm thấy máy `' + name + '`.');
    if (!canSee(m)) return say('🚫 Bạn không phải chủ máy này.');
    syncFromBridgeFile();
    const sessions = (R.sessions && R.sessions[name]) || [];
    const isOnline = (m.status !== 'stopped' && m.status !== 'done' && m.lastReportAt && (Date.now() - m.lastReportAt < 600000));
    const health = isOnline ? '🟢 ĐANG HOẠT ĐỘNG (Online)' : '🔴 KHÔNG HOẠT ĐỘNG (Offline / Mất kết nối)';
    const hbAgo = m.lastReportAt ? Math.floor((Date.now() - m.lastReportAt) / 1000) : null;
    const hbText = hbAgo != null ? (hbAgo < 60 ? hbAgo + 's trước' : Math.floor(hbAgo / 60) + 'm trước') : 'chưa có';
    const latestFile = m.lastFileReceived ? `\n📄 **File nhận từ D:\\:** \`${m.lastFileReceived}\`` : '';

    if (!sessions.length) {
      const i = m.info || {};
      const curPass = canSee(m) ? (i.pass || (m.info && m.info.pass) || '***') : '***';
      return say(
        `📋 **Máy \`${name}\`** — Trạng thái: ${health} (Heartbeat: ${hbText})${latestFile}\n` +
        (i.ip ? `• IP Tailscale: \`${i.ip}\` · User: \`${i.user || 'runneradmin'}\` · MK: \`${curPass}\`\n` : '') +
        (m.autoPrompt ? `📝 **Prompt tự cải thiện:**\n${fence(m.autoPrompt)}\n` : '') +
        `• Chưa có nhiều phiên lịch sử được ghi nhận.`
      );
    }

    const L = [`📋 **Lịch sử phiên máy \`${name}\`** (${sessions.length} phiên) — Trạng thái: ${health} (Heartbeat: ${hbText})${latestFile}`];
    if (m.currentSessionId) L.push(`⭐ **Phiên mới nhất đang dùng:** \`${m.currentSessionId}\``);

    // Chỉ hiện các phiên gần nhất (tối đa 5 phiên)
    const recent = sessions.slice(-5).reverse();
    for (const s of recent) {
      const isLatest = s.sessionId === m.currentSessionId;
      const startStr = s.startedAt ? vn(s.startedAt) : '?';
      const hb = s.lastHeartbeat ? vn(s.lastHeartbeat) : '?';
      const sOnline = (s.status === 'active' && s.lastHeartbeat && (Date.now() - s.lastHeartbeat < 600000));
      const sBadge = sOnline ? '🟢' : (s.status === 'stopped' ? '🔴' : '🟡');
      const inf = s.info || {};
      const sPass = canSee(m) ? (s.pass || inf.password || inf.pass || '***') : '***';
      L.push(
        `${sBadge} **Phiên: \`${s.sessionId || '?'}\`** ${isLatest ? '*(Mới nhất)*' : ''}` +
        `\n   • IP Tailscale: \`${s.ip || inf.tailscaleIp || inf.ip || '?'}\`` +
        `\n   • Tài khoản: \`${s.user || inf.user || 'runneradmin'}\` · Mật khẩu: \`${sPass}\`` +
        `\n   • Bắt đầu: ${startStr} · Heartbeat: ${hb} · Trạng thái: ${s.status || 'active'}`
      );
    }

    if (m.autoPrompt) {
      L.push(`\n📝 **Thông tin tự cải thiện Prompt:**\n${fence(m.autoPrompt)}`);
    }

    return say(cut(L.join('\n'), 1990));
  }

  // ---------------- LỆNH !may prompt: LẤY PROMPT ĐÃ TỰ CẢI THIỆN ĐỂ GỬI CHO BOT / AI ----------------
  if (sub === 'prompt' || sub === 'prom') {
    const name = nameOk(arg);
    if (!name) return say('Dùng: `!may prompt <tên_máy>` để lấy prompt tóm tắt tự cải thiện cho bot/AI.');
    const m = R.machines[name];
    if (!m) return say('Không tìm thấy máy `' + name + '`.');
    if (!canSee(m)) return say('🚫 Bạn không phải chủ máy này.');
    syncFromBridgeFile();
    const isOnline = (m.status !== 'stopped' && m.status !== 'done' && m.lastReportAt && (Date.now() - m.lastReportAt < 600000));
    const p = m.autoPrompt || `[MÁY: ${m.name}]\n- Trạng thái: ${isOnline ? '🟢 Online' : '🔴 Offline'}\n- IP: ${(m.info && m.info.ip) || '?'}\n- User: ${(m.info && m.info.user) || 'runneradmin'}\n- MK: ${(m.info && m.info.pass) || '?'}`;
    return say(`📝 **Prompt tóm tắt tự cải thiện cho máy \`${name}\`:**\n` + fence(p));
  }

  // ---------------- LỆNH !may file: TẢI FILE THÔNG TIN PHIÊN CỦA MÁY VỀ DISCORD ----------------
  if (sub === 'file' || sub === 'layfile' || sub === 'taifile' || sub === 'download') {
    const name = nameOk(arg);
    if (!name) return say('Dùng: `!may file <tên_máy>` để tải file JSON về Discord, hoặc đính kèm file JSON vào tin nhắn khi gõ `!may nhanfile` để nạp file vào bot.');
    syncFromBridgeFile();
    let m = R.machines[name];
    if (!m) {
      const diskObj = getMachineFullJson(null, name);
      if (diskObj && diskObj.tailscaleIp) {
        m = R.machines[name] = {
          name,
          file: name + '.yml',
          created: Date.now(),
          status: diskObj.status || 'ready',
          lastReportAt: Date.now(),
          currentSessionId: diskObj.sessionId,
          fileData: diskObj,
          info: {
            ip: diskObj.tailscaleIp,
            user: diskObj.user,
            pass: diskObj.password,
            password: diskObj.password,
            webPort: diskObj.webPort,
            sunshinePort: diskObj.sunshinePort
          }
        };
        saveToBridgeFile();
      }
    }
    if (!m) return say('Không tìm thấy máy `' + name + '`.');
    if (!canSee(m)) return say('🚫 Bạn không phải chủ máy này.');
    const fullObj = getMachineFullJson(m, name);
    const fJson = JSON.stringify(fullObj, null, 2);
    const isOnline = !!(m.status !== 'stopped' && m.status !== 'done' && m.lastReportAt && (Date.now() - m.lastReportAt < 600000));
    const dom = (R.duckdns && R.duckdns.domain) || 'datdemo.duckdns.org';
    const prt = ENV.PORT || ENV.APP_PORT || '3000';
    const curPass = canSee(m) ? (fullObj.password || '***') : '***';
    return say(
      `📄 **File thông tin phiên máy \`${name}\` (đầy đủ 28 trường từ ổ D:\\)** (${isOnline ? '🟢 Online' : '🔴 Offline'})\n` +
      `• IP Tailscale: \`${fullObj.tailscaleIp || '?'}\` · User: \`${fullObj.user}\` · MK: \`${curPass}\`\n` +
      `• Mã phiên: \`${fullObj.sessionId}\`\n` +
      `📥 **Trang Nhận & Quản Lý File:** http://${dom}:${prt}/rdp-files`,
      { files: [{ name: `machine-info-${name}.json`, text: fJson }] }
    );
  }

  // ---------------- LỆNH !may trang / !may web: LẤY LINK TRANG WEB NHẬN FILE & QUẢN LÝ ----------------
  if (sub === 'trang' || sub === 'web' || sub === 'files' || sub === 'receiver') {
    const dom = (R.duckdns && R.duckdns.domain) || 'datdemo.duckdns.org';
    const prt = ENV.PORT || ENV.APP_PORT || '3000';
    return say(
      '🌐 **HỆ THỐNG TRANG WEB QUẢN TRỊ & NHẬN FILE MÁY ẢO**\n\n' +
      `📥 **Trang Nhận & Quản Lý File Máy Ảo:**\n` +
      `👉 \`http://${dom}:${prt}/rdp-files\`\n` +
      `*(Kéo & thả file machine-info-*.json vào đây để nạp vào Bot, xem trực tiếp file JSON, tải file về máy, copy Prompt)*\n\n` +
      `🎛️ **Trung Tâm Quản Lý RDP & Đa Acc GitHub:**\n` +
      `👉 \`http://${dom}:${prt}/rdp-manager\`\n\n` +
      `🤖 **Bảng Điều Khiển Bot Discord:**\n` +
      `👉 \`http://${dom}:${prt}/\``
    );
  }

  if (sub === 'lenh' || sub === 'cmd') {
    const name = nameOk(arg);
    const cmdName = (a[2] || '').toLowerCase();
    const cmdText = a.slice(3).join(' ').trim();
    if (!name || !['save', 'restart', 'stop', 'ping', 'pass', 'msg'].includes(cmdName)) {
      return say('Dùng: `!may lenh <tên_máy> <save|restart|stop|ping|pass|msg> [nội_dung]`\nVD:\n• `!may lenh chill save` (Lưu ổ đĩa ngay)\n• `!may lenh chill msg Alo 123` (Gửi thông báo lên màn hình máy)\n• `!may lenh chill pass MatKhauMoi@2026` (Đổi mật khẩu RDP & Sunshine ngay)');
    }
    if (cmdName === 'pass') deleteMsg();
    const m = R.machines[name];
    if (!m) return say('Không tìm thấy máy `' + name + '`.');
    if (m.ownerId && m.ownerId !== ctx.user.id && !isStaff) return say('🚫 Bạn không phải chủ máy này.');
    const res = await sendVmCommand(m, cmdName, cmdText);
    if (cmdName === 'pass' && cmdText && m.info) {
      m.info.pass = cmdText;
      saveToBridgeFile();
    }
    return say(`✅ **Kết quả từ máy \`${name}\` (\`${res.ip || (m.info && m.info.ip)}\`):** ${res.message}\n⏳ Thời gian còn lại: **${res.remainText || '?'}**`);
  }

  // ---------------- TẠO MÁY / CHẠY LẠI / TẠO LẠI WORKFLOW ----------------
  if (sub === 'tao' || sub === 'chay' || sub === 'taolai') {
    const name = nameOk(arg);
    if (!name) return say('Thiếu tên máy. VD: `!may ' + sub + ' chill 5h`');
    if (['bot', 'may3', 'taomay'].includes(name)) return say('Tên `' + name + '` bị giữ chỗ, chọn tên khác.');
    const isDurArg = /^(1h|3h|5h|5h00m)$/i.test(a[2] || '');
    const d = parseDur(isDurArg ? a[2] : '5h00m');
    const accAliasArg = isDurArg ? a[3] : a[2];
    const existing = R.machines[name];
    const ac = getAcc(accAliasArg || existing);

    if (existing && existing.ownerId && existing.ownerId !== ctx.user.id && !isStaff) {
      return say('🚫 Máy `' + name + '` là của **' + existing.owner + '**, bạn không thể mở máy của người khác.');
    }

    const activeRuns = await listRuns();
    const sameMachineRun = activeRuns.find(r => machineKey(r) === name);
    if (sameMachineRun) {
      if (sub === 'taolai') {
        try { await gh('POST', `/repos/${ac.repo}/actions/runs/${sameMachineRun.id}/cancel`, null, false, ac); } catch {}
      } else {
        return say('⚠️ Máy **' + name + '** đang chạy rồi (run `' + sameMachineRun.id + '`). Dùng `!may info ' + name + '`, `!may khoi-dong-lai ' + name + '` hoặc `!may dung ' + name + '`.');
      }
    }

    // Kiểm tra giới hạn số máy của người dùng (mặc định 1 máy, hoặc theo !may quyen)
    if (!isStaff) {
      const maxAllowed = R.quotas[ctx.user.id] != null ? R.quotas[ctx.user.id] : 1;
      const ownedList = Object.values(R.machines).filter(x => x && x.ownerId === ctx.user.id && x.name !== name);
      if (ownedList.length >= maxAllowed) {
        return say(`🚫 Tài khoản của bạn được phép sở hữu tối đa **${maxAllowed} máy** (Hiện có: **${ownedList.map(x => x.name).join(', ')}**).\n👉 Dùng \`!may chay ${ownedList[0].name}\` hoặc liên hệ Admin cấp thêm quyền (\`!may quyen\`).`);
      }
      const userActiveRuns = activeRuns.filter(r => {
        const mk = machineKey(r), rm = R.machines[mk];
        return rm && rm.ownerId === ctx.user.id && mk !== name;
      });
      if (userActiveRuns.length >= maxAllowed) {
        return say(`🚫 Bạn đang có **${userActiveRuns.length}/${maxAllowed}** máy chạy cùng lúc!`);
      }
    }

    if (sub === 'tao' && !existing && Object.keys(R.machines).length >= MAX_MACHINE) {
      return say('Đã đủ ' + MAX_MACHINE + ' máy, Admin có thể dùng `!may xoa <tên>` để xóa bớt máy cũ.');
    }

    const ref = await getRef(ac);
    const file = fileOf(name), wfPath = (ac.wfDir || defaultWfDir) + '/' + file;
    let created = false;
    let existingFile = null;
    try {
      existingFile = await gh('GET', `/repos/${ac.repo}/contents/${wfPath}?ref=${encodeURIComponent(ref)}`, null, false, ac);
    } catch (e) {
      if (e.status !== 404) throw e;
    }

    if (sub === 'taolai' && existingFile && existingFile.sha) {
      await gh('DELETE', `/repos/${ac.repo}/contents/${wfPath}`, {
        message: 'Xóa workflow cũ để tạo lại máy ' + name,
        sha: existingFile.sha,
        branch: ref
      }, false, ac);
      existingFile = null;
    }

    let hasWebhookInput = false;
    if (!existingFile) {
      if (sub === 'chay') return say('Chưa có file `' + file + '` trên `' + ac.repo + '`. Dùng `!may tao ' + name + '` trước.');
      const tpl = await loadTemplate(ref, ac);
      const newYaml = makeWorkflow(tpl.text, name);
      hasWebhookInput = /bot_webhook_url\s*:/i.test(newYaml);
      await gh('PUT', `/repos/${ac.repo}/contents/${wfPath}`, {
        message: (sub === 'taolai' ? 'tạo lại máy ' : 'tạo máy ') + name + ' (từ ' + tpl.name + ')',
        content: b64(newYaml),
        branch: ref
      }, false, ac);
      created = true;
    } else if (existingFile.content) {
      const curYaml = Buffer.from(existingFile.content.replace(/\s+/g, ''), 'base64').toString('utf8');
      hasWebhookInput = /bot_webhook_url\s*:/i.test(curYaml);
      const patched = patchWorkflowBox(curYaml);
      if (patched !== curYaml) {
        try {
          await gh('PUT', `/repos/${ac.repo}/contents/${wfPath}`, {
            message: 'cập nhật xuất thông tin kết nối cho máy ' + name,
            content: b64(patched),
            sha: existingFile.sha,
            branch: ref
          }, false, ac);
        } catch {}
      }
    }

    const m = rec(name, {
      file,
      repo: ac.repo,
      accName: ac.alias,
      hasWebhookInput,
      input: d.input,
      minutes: d.min,
      owner: existing && existing.owner ? existing.owner : ctx.user.display,
      ownerId: existing && existing.ownerId ? existing.ownerId : ctx.user.id,
      ownerTag: existing && existing.ownerTag ? existing.ownerTag : ctx.user.username,
      channelId: ctx.channelId,
      info: null,
      runId: null,
      jobId: null,
      status: 'creating',
      startMs: Date.now()
    });
    ui.send({
      content: (created ? `📝 Đã tạo \`${wfPath}\` trên repo \`${ac.repo}\` (tài khoản Git: \`${ac.alias}\`).\n` : `♻️ File \`${file}\` trên \`${ac.repo}\` đã có, chạy lại.\n`) +
        '🚀 Đang khởi động action cho máy **' + name + '** (' + d.input + ')…'
    }, 'may:' + name);
    ui.after(created ? 8 : 1, 'disp|' + name + '|0');
    return;
  }

  // ---------------- DANH SÁCH MÁY (THEO QUYỀN SỞ HỮU, ẨN IP/LOG, NÚT BẤM TƯƠNG TÁC) ----------------
  if (sub === 'ds' || sub === 'list') {
    const rs = await listRuns();
    // Đồng bộ runs vào R.machines
    for (const run of rs) {
      const ac = run._acc || getAcc();
      const k = machineKey(run);
      const m = R.machines[k] = R.machines[k] || { name: k, file: String(run.path).split('/').pop(), runId: run.id, repo: ac.repo, accName: ac.alias };
      m.runId = run.id;
      if (!m.info && m.status !== 'ready') { try { await syncMachineInfo(m, run.id); } catch {} }
    }
    saveToBridgeFile();

    // Lọc theo người dùng (người thường chỉ thấy máy của mình, admin thấy tất cả)
    const viewList = Object.values(R.machines).filter(m => canSee(m));
    if (!viewList.length) {
      return say('😴 Bạn chưa có máy ảo nào trong danh sách. Dùng `!may tao <tên_máy>` để tạo máy mới.');
    }

    const L = [isStaff ? '🖥️ **DANH SÁCH MÁY TOÀN BỘ SERVER (Admin):**' : '🖥️ **DANH SÁCH MÁY CỦA BẠN:**'];
    const btns = [];
    for (const m of viewList.slice(0, 15)) {
      const activeRun = rs.find(r => machineKey(r) === m.name);
      const t = remain(m, activeRun);
      const isOnline = (m.status !== 'stopped' && m.status !== 'done' && m.lastReportAt && (Date.now() - m.lastReportAt < 600000));
      const isStarting = (m.status === 'dispatched' || m.status === 'creating' || (activeRun && (activeRun.status === 'queued' || (activeRun.status === 'in_progress' && !isOnline && !m.info))));
      const stBadge = isOnline ? '🟢 Online' : (isStarting ? '🟡 Đang khởi động...' : (m.status === 'ready' ? '🔴 Offline' : '⚪ Đã tắt'));

      let line = `${stBadge} **${m.name}**`; if (m.info && m.info.stardeskId) line += ` · StarDesk: \`${m.info.stardeskId}\``;
      if (isStaff && m.owner) line += ` · Chủ: **${m.owner}**`;
      if (m.currentSessionId) line += ` · Phiên: \`${m.currentSessionId}\``;
      if (t.left > 0) line += ` · Còn: **${hms(t.left)}**`;
      L.push(line);

      btns.push({ id: 'in:' + m.name, label: '🔐 ' + m.name, style: isOnline ? 'primary' : 'secondary', ephemeral: true });
    }

    const rows = [];
    for (let i = 0; i < btns.length; i += 5) rows.push(btns.slice(i, i + 5));

    if (isStaff) {
      rows.push([
        { id: 'adm:scanaction', label: '🔍 Quét Actions', style: 'secondary', ephemeral: true },
        { id: 'adm:scanold', label: '🔄 Quét Nâng Cấp', style: 'secondary', ephemeral: true }
      ]);
    }

    say(cut(L.join('\n'), 1900), { buttons: rows });
    return;
  }

  // ---------------- MENU QUẢN TRỊ ADMIN (!may admin) ----------------
  if (sub === 'admin' || sub === 'quanly') {
    if (!isStaff) return say('🚫 Chỉ Admin / chủ server mới có quyền truy cập menu này.');
    const totalM = Object.keys(R.machines).length;
    const totalAcc = Object.keys(R.accounts).length;
    const msg = [
      '👑 **TRUNG TÂM ĐIỀU KHIỂN RDP BOT (ADMIN):**',
      `• Tổng số máy đã ghi nhận: **${totalM} máy**`,
      `• Tài khoản Git đã nạp: **${totalAcc} tài khoản**`,
      `• Tài khoản mặc định: \`${R.defaultAccount || 'Chưa đặt'}\``,
      '\n👉 **Bấm các nút bên dưới để thực hiện nhanh chức năng quản trị:**'
    ].join('\n');
    return say(msg, {
      buttons: [
        [
          { id: 'adm:scanaction', label: '🔍 Quét Actions Đang Chạy', style: 'primary', ephemeral: true },
          { id: 'adm:scanold', label: '🔄 Quét & Nâng Cấp Bản Cũ', style: 'success', ephemeral: true }
        ],
        [
          { id: 'adm:allmachines', label: '🖥️ Quản Lý Tất Cả Máy', style: 'secondary', ephemeral: true },
          { id: 'ds:', label: '📋 Xem Danh Sách & Bảng ĐN', style: 'secondary', ephemeral: true }
        ]
      ]
    });
  }

  // ---------------- QUÉT ACTIONS ĐANG CHẠY (!may quetaction) ----------------
  if (sub === 'quetaction' || sub === 'scan') {
    if (!isStaff) return say('🚫 Chỉ Admin / chủ server.');
    const rs = await listRuns();
    if (!rs.length) return say('😴 Không có action máy ảo nào đang chạy trên các tài khoản Git.');
    const L = [`🔍 **PHÁT HIỆN ${rs.length} WORKFLOW RUNS ĐANG HOẠT ĐỘNG:**`];
    const btns = [];
    for (const run of rs.slice(0, 10)) {
      const ac = run._acc || getAcc();
      const k = machineKey(run);
      const m = R.machines[k] = R.machines[k] || { name: k, file: String(run.path).split('/').pop(), runId: run.id, repo: ac.repo, accName: ac.alias };
      m.runId = run.id;
      const t = remain(m, run);
      L.push(`• **${k}** (Run #${run.id} · ${run.status}) — Chủ: ${m.owner || 'Chưa gán'} · Còn: ${t.left > 0 ? hms(t.left) : 'hết giờ'}`);
      btns.push({ id: 'in:' + k, label: '🔐 ' + k, style: 'primary', ephemeral: true });
    }
    saveToBridgeFile();
    const rows = [];
    for (let i = 0; i < btns.length; i += 5) rows.push(btns.slice(i, i + 5));
    return say(cut(L.join('\n'), 1900), { buttons: rows });
  }

  // ---------------- QUÉT & NÂNG CẤP WORKFLOW BẢN CŨ LÊN BẢN MỚI (BẢO TOÀN Ổ ĐĨA) ----------------
  if (sub === 'nangcap' || sub === 'upgrade' || sub === 'quetcubanchu') {
    if (!isStaff) return say('🚫 Chỉ Admin / chủ server.');
    const ac = getAcc(arg ? R.machines[nameOk(arg)] : null);
    const ref = await getRef(ac);
    const dir = ac.wfDir || defaultWfDir;

    // Nâng cấp trực tiếp 1 máy nếu có truyền tên
    if (arg && nameOk(arg)) {
      const targetName = nameOk(arg);
      const wfPath = dir + '/' + fileOf(targetName);
      try {
        const existingFile = await gh('GET', `/repos/${ac.repo}/contents/${wfPath}?ref=${encodeURIComponent(ref)}`, null, false, ac);
        const tpl = await loadTemplate(ref, ac);
        const newYaml = makeWorkflow(tpl.text, targetName);
        await gh('PUT', `/repos/${ac.repo}/contents/${wfPath}`, {
          message: `Nâng cấp workflow máy ${targetName} lên bản mới nhất (bảo toàn ổ đĩa)`,
          content: b64(newYaml),
          sha: existingFile.sha,
          branch: ref
        }, false, ac);
        const m = R.machines[targetName] = R.machines[targetName] || { name: targetName, file: fileOf(targetName), created: Date.now() };
        m.hasWebhookInput = /bot_webhook_url\s*:/i.test(newYaml);
        saveToBridgeFile();
        return say(
          `✅ **Đã nâng cấp thành công máy \`${targetName}\`!**\n` +
          `• File: \`${wfPath}\` trên \`${ac.repo}\`\n` +
          `• Đã bổ sung tính năng tạo file \`D:\\machine-info-${targetName}.json\`, gửi webhook 28 trường & heartbeat 5 phút.\n` +
          `• 💽 **Dữ liệu ổ đĩa cũ được giữ nguyên 100%:** Release tag \`aistv-storage-${targetName}\` và nhánh \`aistv-state-${targetName}\` không thay đổi.`,
          { buttons: [[{ id: 'in:' + targetName, label: '🔐 Xem Thông Tin & Bật Máy', style: 'primary', ephemeral: true }]] }
        );
      } catch (e) {
        return say(`❌ Không nâng cấp được máy **${targetName}**: ${e.message}`);
      }
    }

    // Không truyền tên -> Quét toàn bộ thư mục .github/workflows
    let files = [];
    try {
      const list = await gh('GET', `/repos/${ac.repo}/contents/${dir}?ref=${encodeURIComponent(ref)}`, null, false, ac);
      files = (Array.isArray(list) ? list : []).filter(x => /\.ya?ml$/i.test(x.name) && !BOT_FILES.includes(x.name.toLowerCase()) && !/^(may3|taomay)\.ya?ml$/i.test(x.name));
    } catch (e) {
      return say(`❌ Lỗi quét thư mục ${dir} trên repo \`${ac.repo}\`: ${e.message}`);
    }

    if (!files.length) return say(`ℹ️ Không có file workflow máy nào trong \`${dir}\` trên repo \`${ac.repo}\`.`);

    const oldFiles = [];
    for (const f of files) {
      try {
        const raw = await gh('GET', `/repos/${ac.repo}/contents/${f.path}?ref=${encodeURIComponent(ref)}`, null, true, ac);
        if (!raw.includes('report-file') && !raw.includes('MACHINE_INFO_FILE')) {
          oldFiles.push(f);
        }
      } catch {}
    }

    if (!oldFiles.length) {
      return say(`✅ Tất cả **${files.length}** file workflow trên repo \`${ac.repo}\` đều đã là phiên bản mới nhất!`);
    }

    const L = [
      `🔄 **TÌM THẤY ${oldFiles.length}/${files.length} FILE WORKFLOW BẢN CŨ CẦN NÂNG CẤP TRÊN \`${ac.repo}\`:**`,
      `*(Hệ thống sẽ giữ nguyên 100% dữ liệu ổ đĩa cũ \`aistv-storage-<tên>\` & state branch)*`
    ];
    const btns = [];
    for (const f of oldFiles.slice(0, 10)) {
      const mName = f.name.replace(/\.ya?ml$/i, '');
      L.push(`• \`${f.name}\` ➔ Máy **${mName}** (bấm nút để nâng cấp)`);
      btns.push({ id: 'adm:upg:' + mName, label: '🔄 ' + mName, style: 'success', ephemeral: true });
    }
    const rows = [];
    for (let i = 0; i < btns.length; i += 5) rows.push(btns.slice(i, i + 5));
    return say(cut(L.join('\n'), 1900), { buttons: rows });
  }

  // ---------------- TẮT MÁY AN TOÀN / TẮT ACTION / KHỞI ĐỘNG LẠI ----------------
  if (sub === 'tat' || sub === 'stop') {
    const name = nameOk(arg), m = R.machines[name];
    if (!name) return say('Thiếu tên máy. Dùng: `!may tat <tên_máy>`');
    if (m && m.ownerId && m.ownerId !== ctx.user.id && !isStaff) return say('🚫 Máy `' + name + '` là của ' + m.owner + '.');
    if (m && m.info && m.info.ip) {
      try {
        const r = await sendVmCommand(m, 'stop');
        m.status = 'stopping';
        saveToBridgeFile();
        return say(`🛑 **[${name}]** ${r.message} (Máy sẽ tự động đóng gói lưu ổ đĩa lên Release trước khi tắt hẳn).`);
      } catch {}
    }
    const ac = getAcc(m);
    const run = await findRun(name, ac);
    if (!run || run.status === 'completed') return say('Máy `' + name + '` hiện không chạy.');
    await gh('POST', `/repos/${ac.repo}/actions/runs/${run.id}/cancel`, null, false, ac);
    if (m) { m.status = 'stopped'; m.info = null; saveToBridgeFile(); }
    return say('🛑 Máy chưa phản hồi qua IP nên đã gửi lệnh hủy trực tiếp run `' + run.id + '` của **' + name + '**.');
  }

  if (sub === 'dung' || sub === 'cancel') {
    const name = nameOk(arg), m = R.machines[name];
    if (!name) return say('Thiếu tên máy.');
    if (m && m.ownerId && m.ownerId !== ctx.user.id && !isStaff) return say('🚫 Máy `' + name + '` là của ' + m.owner + '.');
    const ac = getAcc(m);
    const run = await findRun(name, ac);
    if (!run || run.status === 'completed') return say('Máy `' + name + '` không chạy.');
    await gh('POST', `/repos/${ac.repo}/actions/runs/${run.id}/cancel`, null, false, ac);
    if (m) { m.status = 'stopped'; m.info = null; saveToBridgeFile(); }
    return say('🛑 Đã gửi lệnh hủy ngay run `' + run.id + '` của **' + name + '** trên `' + ac.repo + '` (hủy thì không tự khởi động phiên mới).');
  }

  if (sub === 'khoi-dong-lai' || sub === 'khoidonglai' || sub === 'restart') {
    const name = nameOk(arg), m = R.machines[name];
    if (!name) return say('Dùng: `!may khoi-dong-lai <tên_máy> [1h|3h|5h]`');
    if (m && m.ownerId && m.ownerId !== ctx.user.id && !isStaff) return say('🚫 Máy `' + name + '` là của ' + m.owner + '.');
    if (m && m.info && m.info.ip && !a[2]) {
      try {
        const r = await sendVmCommand(m, 'restart');
        m.status = 'restarting';
        saveToBridgeFile();
        return say(`🔁 **[${name}]** ${r.message} (Máy đang lưu ổ đĩa và tự kích hoạt phiên mới!).`);
      } catch {}
    }
    const ac = getAcc(m);
    const d = parseDur(a[2] || (m && m.input) || '5h00m');
    const run = await findRun(name, ac).catch(() => null);
    if (run && run.status !== 'completed') {
      try { await gh('POST', `/repos/${ac.repo}/actions/runs/${run.id}/cancel`, null, false, ac); } catch {}
    }
    const cur = rec(name, {
      file: (m && m.file) || fileOf(name),
      repo: ac.repo,
      accName: ac.alias,
      input: d.input,
      minutes: d.min,
      owner: (m && m.owner) || ctx.user.display,
      ownerId: (m && m.ownerId) || ctx.user.id,
      info: null,
      runId: null,
      jobId: null,
      status: 'creating',
      startMs: Date.now()
    });
    ui.send({ content: `🔁 Đang khởi động lại tiến trình mới cho máy **${name}** (${d.input}) trên \`${ac.repo}\`…` }, 'may:' + name);
    ui.after(6, 'disp|' + name + '|0');
    return;
  }

  // ---------------- ĐỌC LOG ----------------
  if (sub === 'log') {
    if (!arg) return say('Dùng: `!may log <tên|runId> [số bước | cuoi | all]`');
    const name = nameOk(arg), m = R.machines[name];
    const ac = getAcc(m);
    const run = await findRun(arg, ac);
    if (!run) return say('Không thấy run nào cho `' + arg + '`.');
    const mk = machineKey(run), rm = R.machines[mk] || m;
    if (rm && !canSee(rm)) return say('🚫 Bạn không phải chủ máy này.');
    const L = await runLog(run.id, ac), pick = (a[2] || '').toLowerCase();
    if (rm) {
      rm.jobId = L.job.id;
      if (L.annBox && !rm.info) { rm.info = L.annBox; rm.status = 'ready'; saveToBridgeFile(); }
    }
    if (pick === 'all') {
      const full = 'Trang Log: ' + L.jobUrl + '\n\n' + L.steps.map(fmtStep).join('\n\n────────\n\n');
      return ui.send({
        content: '📜 Log đầy đủ **' + mk + '** run `' + run.id + '` (' + L.steps.length + ' bước)\n🔗 <' + L.jobUrl + '>',
        files: [{ name: 'log-' + mk + '-' + run.id + '.txt', text: full }]
      });
    }
    if (pick) {
      const s = pick === 'cuoi' ? L.steps[L.steps.length - 1] : L.steps[(+pick || 0) - 1];
      if (!s) return say('Không có bước ' + pick + '. Có ' + L.steps.length + ' bước.');
      const t = fmtStep(s), ob = { content: '🔗 <' + L.jobUrl + '>\n' + fence(cutTail(t, 1800)) };
      if (t.length > 1800) ob.files = [{ name: 'log-' + mk + '-b' + s.n + '.txt', text: t }];
      return ui.send(ob);
    }
    const rows = L.steps.map(s => String(s.n).padStart(2) + ') ' + (s.icon ? s.icon + ' ' : '') + dur(s.sec).padEnd(6) + ' ' + cut(s.head, 58));
    return ui.send({
      content: '📜 **' + mk + '** · run `' + run.id + '` · ' + run.status +
        '\n🔗 Trang Log: <' + L.jobUrl + '>\n' +
        fence(cutTail(rows.join('\n') || '(chưa có bước nào)', 1650)) +
        'Xem 1 bước: `!may log ' + arg + ' <số>` · bước mới nhất: `cuoi` · cả file: `all`'
    });
  }

  say('Không hiểu lệnh. Gõ `!may` để xem đầy đủ bảng trợ giúp.');
} catch (e) {
  const msg = '❌ ' + String(e.message || e).slice(0, 600);
  if (ev === 'button') ui.reply(msg); else ui.send(msg);
}