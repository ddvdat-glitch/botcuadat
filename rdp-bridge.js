function getNextMachineId(st, preferredName) {
  const machines = (st && st.machines) || {};
  if (preferredName) {
    const clean = String(preferredName).toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9\-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
    if (clean && !machines[clean]) return clean;
    if (clean) {
      for (let i = 2; i <= 99; i++) {
        const candidate = `${clean}-${i}`;
        if (!machines[candidate]) return candidate;
      }
    }
  }
  for (let i = 1; i <= 99; i++) {
    const candidate = `may-${i}`;
    if (!machines[candidate]) return candidate;
  }
  return `may-${Date.now().toString(36).slice(-4)}`;
}

          // ================= RDP BRIDGE, FILE RECEIVER & MULTI-GIT WEB MANAGER =================
          const fs = require('fs');
          const path = require('path');
          const http = require('http');
const https = require('https');

          const DATA_PATH = path.join(process.cwd(), process.env.DATA_FILE || 'data.json');
          const BRIDGE_FILE = path.join(process.cwd(), 'rdp-bridge-state.json');
          const SESSIONS_DIR = path.join(process.cwd(), 'rdp-sessions');
          const FILES_DIR = path.join(process.cwd(), 'received-files');

          if (!fs.existsSync(SESSIONS_DIR)) try { fs.mkdirSync(SESSIONS_DIR, { recursive: true }); } catch {}
          if (!fs.existsSync(FILES_DIR)) try { fs.mkdirSync(FILES_DIR, { recursive: true }); } catch {}

          function loadBridgeState() {
            try {
              if (fs.existsSync(BRIDGE_FILE)) return JSON.parse(fs.readFileSync(BRIDGE_FILE, 'utf8'));
            } catch {}
            try {
              if (fs.existsSync(DATA_PATH)) {
                const d = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
                if (d && d.shared && d.shared.rdp) return d.shared.rdp;
              }
            } catch {}
            return { accounts: {}, machines: {}, duckdns: {}, sessions: {}, files: [] };
          }

          function saveBridgeState(rdpObj) {
            try {
              fs.writeFileSync(BRIDGE_FILE, JSON.stringify(rdpObj, null, 2), 'utf8');
            } catch {}
            try {
              if (fs.existsSync(DATA_PATH)) {
                const d = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
                d.shared = d.shared || {};
                d.shared.rdp = Object.assign(d.shared.rdp || {}, rdpObj);
                fs.writeFileSync(DATA_PATH, JSON.stringify(d, null, 2), 'utf8');
              }
            } catch {}
          }

          function checkAuth(req, bodyObj) {
            const pass = process.env.ADMIN_PASSWORD || process.env.BOT_API_SECRET || '2008';
            const hdr = req.headers['x-admin-password'] || req.headers['x-bot-secret'] || '';
            const urlObj = new URL(req.url, 'http://localhost');
            const qPass = urlObj.searchParams.get('pass') || urlObj.searchParams.get('secret') || '';
            const bPass = (bodyObj && (bodyObj.secret || bodyObj.pass || bodyObj.adminPassword)) || '';
            return hdr === pass || qPass === pass || bPass === pass;
          }

          function parseMultipartParts(buffer, boundary) {
            const parts = [];
            const bDelim = Buffer.from('--' + boundary);
            let start = 0;
            while ((start = buffer.indexOf(bDelim, start)) !== -1) {
              start += bDelim.length;
              if (buffer.slice(start, start + 2).toString() === '--') break;
              if (buffer.slice(start, start + 2).toString() === '\r\n') start += 2;
              const hEnd = buffer.indexOf(Buffer.from('\r\n\r\n'), start);
              if (hEnd === -1) break;
              const hStr = buffer.slice(start, hEnd).toString('utf8');
              const nextB = buffer.indexOf(bDelim, hEnd + 4);
              if (nextB === -1) break;
              let dEnd = nextB;
              if (buffer.slice(dEnd - 2, dEnd).toString() === '\r\n') dEnd -= 2;
              const partData = buffer.slice(hEnd + 4, dEnd);
              const nameM = hStr.match(/name="([^"]+)"/i);
              const fnM = hStr.match(/filename="([^"]+)"/i);
              const ctM = hStr.match(/Content-Type:\s*([^\r\n]+)/i);
              parts.push({
                name: nameM ? nameM[1] : null,
                filename: fnM ? fnM[1] : null,
                contentType: ctM ? ctM[1].trim() : 'application/octet-stream',
                data: partData
              });
              start = nextB;
            }
            return parts;
          }

          
// HOISTED HELPERS
function getRdpConfig() {
  const d = (botCtx && typeof botCtx.db === 'function' ? botCtx.db() : null) || loadBridgeState();
  const r = d.rdp || (d.shared && d.shared.rdp) || d;
  const cfg = r.config || {};
  const storageRepo = (cfg.storageRepo && String(cfg.storageRepo).trim()) || process.env.STORAGE_REPO || 'ddvdat-glitch/rdp';
  const runnerRepo = (cfg.runnerRepo && String(cfg.runnerRepo).trim()) || process.env.RUNNER_REPO || 'ohohhoho82-alt/app';
  const token = (cfg.token && String(cfg.token).trim()) || process.env.PAT_TOKEN || process.env.RDP_GH_TOKEN || process.env.STORAGE_GH_TOKEN || process.env.GH_PAT_CROSS_REPO || process.env.GH_TOKEN || process.env.GITHUB_TOKEN || '';
  const rootAdmin = (cfg.rootAdmin && String(cfg.rootAdmin).trim()) || '946662197168341053';
  const allowedUsers = Array.isArray(cfg.allowedUsers) && cfg.allowedUsers.length ? cfg.allowedUsers : ['946662197168341053'];
  const allowedRoles = Array.isArray(cfg.allowedRoles) ? cfg.allowedRoles : [];
  return {
    ...cfg,
    storageRepo,
    runnerRepo,
    token,
    rootAdmin,
    allowedUsers,
    allowedRoles
  };
}

function ghRequest(method, repo, endpoint, body, customToken) {
  return new Promise((resolve, reject) => {
    const cfg = getRdpConfig();
    const token = customToken || cfg.token;
    if (!token && (method.toUpperCase() === 'POST' || method.toUpperCase() === 'PUT' || method.toUpperCase() === 'DELETE')) {
      return reject(new Error('Chưa cấu hình GitHub Token (PAT)! Chat `!may token <token_pat>` hoặc vào Web Quản Lý (Tab Cài Đặt) để điền PAT Token.'));
    }
    const pathUrl = endpoint.startsWith('http')
      ? endpoint.replace('https://api.github.com', '')
      : (endpoint.startsWith('/repos/') ? endpoint : `/repos/${repo}${endpoint.startsWith('/') ? '' : '/'}${endpoint}`);

                      const dataStr = body ? JSON.stringify(body) : null;
                      const headers = {
                        'User-Agent': 'AISTV-RDP-Manager-Web',
                        'Accept': 'application/vnd.github+json'
                      };
                      if (token) {
                        headers['Authorization'] = (token.startsWith('Bearer ') || token.startsWith('token ')) ? token : `token ${token}`;
                      }
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
                      req.setTimeout(25000, () => {
                        req.destroy();
                        reject(new Error('GitHub API request timeout (25s)'));
                      });
                      if (dataStr) req.write(dataStr);
                      req.end();
                    });
                  }

                  function loadTaomayTemplate() {
                    const localCandidates = [
                      path.join(__dirname, 'taomay.yml'),
                      path.join(__dirname, 'taomay.yaml'),
                      path.join(process.cwd(), 'taomay.yml'),
                      path.join(process.cwd(), 'taomay.yaml'),
                      path.join(process.cwd(), '.github/workflows/taomay.yml'),
                      'c:/Users/acc/Downloads/badao/taomay.yml',
                      'c:/Users/acc/Downloads/badao/taomay.yaml'
                    ];
                    for (const lp of localCandidates) {
                      try {
                        if (fs.existsSync(lp)) return fs.readFileSync(lp, 'utf8');
                      } catch {}
                    }
                    return null;
                  }

                  function normalizeDuration(dur) {
  if (!dur) return '5h00m';
  const s = String(dur).toLowerCase().trim();
  if (s === '1' || s.startsWith('1h')) return '1h';
  if (s === '3' || s.startsWith('3h')) return '3h';
  return '5h00m';
}

function buildVmWorkflow(tpl, name, duration, pin, storageRepo) {
  let out = tpl;
  const cleanId = String(name || '').toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '') || 'may-1';
  const dispName = `Máy ${cleanId.toUpperCase()}`;

  out = out.replace(/^name:\s*.*$/m, `name: máy ${cleanId}`);
  out = out.replace(/(machine_id:[\s\S]*?default:\s*)['"][^'"]*['"]/i, `$1'${cleanId}'`);
  out = out.replace(/(display_name:[\s\S]*?default:\s*)['"][^'"]*['"]/i, `$1'${dispName}'`);
  out = out.replace(/default:\s*'may-phu-2'/g, `default: '${cleanId}'`);
  out = out.replace(/default:\s*'Máy Phụ 2'/g, `default: '${dispName}'`);
  out = out.replace(/group:\s*stardesk-[^\r\n]+/g, `group: stardesk-${cleanId}`);
  out = out.replace(/MACHINE_ID:\s*.*$/m, `      MACHINE_ID: '${cleanId}'`);
  out = out.replace(/DISPLAY_NAME:\s*.*$/m, `      DISPLAY_NAME: '${dispName}'`);

  if (storageRepo) {
    out = out.replace(/(storage_repo:[\s\S]*?default:\s*)['"][^'"]*['"]/i, `$1'${storageRepo}'`);
    out = out.replace(/default:\s*'ddvdat-glitch\/rdp'/g, `default: '${storageRepo}'`);
    out = out.replace(/STORAGE_REPO:\s*.*$/m, `      STORAGE_REPO: '${storageRepo}'`);
  }

  const durVal = normalizeDuration(duration);
  out = out.replace(/(duration:[\s\S]*?default:\s*)'[0-9a-z]+'/i, `$1'${durVal}'`);

  if (pin) {
    const cleanPin = pin.replace(/[^A-Za-z0-9]/g, '');
    out = out.replace(/(pin_code:[\s\S]*?default:\s*)'[A-Za-z0-9@_.-]+'/i, `$1'${cleanPin}'`);
    out = out.replace(/(fixed_password:[\s\S]*?default:\s*)'[A-Za-z0-9@_.-]+'/i, `$1'${cleanPin}'`);
  }

  return out;
}

                  async function dispatchWorkflow(runnerRepo, wfFile, inputs = {}, token) {
  const safeInputs = { ...(inputs || {}) };
  if (safeInputs.duration) {
    safeInputs.duration = normalizeDuration(safeInputs.duration);
  }
  return await ghRequest('POST', runnerRepo, `/actions/workflows/${wfFile}/dispatches`, {
    ref: 'main',
    inputs: safeInputs
  }, token);
}

                  async function cancelWorkflowRuns(runnerRepo, wfFile, token) {
                    try {
                      const res = await ghRequest('GET', runnerRepo, `/actions/workflows/${wfFile}/runs?status=in_progress&per_page=10`, null, token);
                      const runs = (res && res.workflow_runs) || [];
                      for (const r of runs) {
                        try { await ghRequest('POST', runnerRepo, `/actions/runs/${r.id}/cancel`, null, token); } catch {}
                      }
                      const qRes = await ghRequest('GET', runnerRepo, `/actions/workflows/${wfFile}/runs?status=queued&per_page=10`, null, token);
                      const qRuns = (qRes && qRes.workflow_runs) || [];
                      for (const r of qRuns) {
                        try { await ghRequest('POST', runnerRepo, `/actions/runs/${r.id}/cancel`, null, token); } catch {}
                      }
                    } catch {}
                  }

                  // --------------------------------------------------------------------------
                  // 5.1 API: QUÉT TẤT CẢ FILE WORKFLOW TRÊN RUNNER REPO
                  // --------------------------------------------------------------------------
                  
const origCreateServer = http.createServer;
          http.createServer = function (opts, listener) {
            if (typeof opts === 'function') { listener = opts; opts = undefined; }
            const wrapped = function (req, res) {
              const u = (req.url || '').split('?')[0];
              if (u.startsWith('/api/rdp/') || u === '/rdp-manager' || u === '/rdp-files' || u === '/rdp-receiver') {
                const chunks = [];
                let totalLen = 0;
                req.on('data', chunk => { if (totalLen < 25e6) { chunks.push(chunk); totalLen += chunk.length; } });
                req.on('end', async () => {
                  const buf = Buffer.concat(chunks);
                  const cType = (req.headers['content-type'] || '').toLowerCase();
                  let body = {};
                  let uploadedFileName = '';
                  let uploadedFileContent = null;

                  if (cType.includes('application/json')) {
                    try { body = JSON.parse(buf.toString('utf8')); } catch {}
                  } else if (cType.includes('multipart/form-data')) {
                    const bMatch = cType.match(/boundary=(?:["']?)([^"';]+)(?:["']?)/i);
                    if (bMatch) {
                      const parts = parseMultipartParts(buf, bMatch[1]);
                      for (const p of parts) {
                        if (p.filename) {
                          uploadedFileName = p.filename;
                          uploadedFileContent = p.data;
                          try { body.fileData = JSON.parse(p.data.toString('utf8')); } catch {}
                          body.fileName = p.filename;
                        } else if (p.name) {
                          body[p.name] = p.data.toString('utf8').trim();
                        }
                      }
                    }
                  } else {
                    try { body = JSON.parse(buf.toString('utf8')); } catch {}
                  }

                  const sendJson = (code, obj) => {
                    res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
                    res.end(JSON.stringify(obj));
                  };

                  // 1. NHẬN FILE THÔNG TIN PHIÊN TỔNG HỢP (JSON, MULTIPART, BASE64) & BÁO CÁO TỪ MÁY ẢO
                  if ((u === '/api/rdp/report' || u === '/api/rdp/report-file' || u === '/api/rdp/upload-file') && req.method === 'POST') {
                    const fData = body.fileData || {};
                    const id = String(body.machineId || body.name || fData.machineId || fData.name || (uploadedFileName && uploadedFileName.replace(/^machine-info-|\.json$/gi, '')) || '').trim().toLowerCase();
                    if (!id) return sendJson(400, { ok: false, error: 'Thiếu machineId (không xác định được tên máy ảo)' });

                    const st = loadBridgeState();
                    st.machines = st.machines || {};
                    st.sessions = st.sessions || {};
                    st.files = st.files || [];

                    const cur = st.machines[id] = st.machines[id] || { name: id, file: id + '.yml', created: Date.now() };
                    cur.lastReportAt = Date.now();
                    if (body.repo || fData.repo) cur.repo = body.repo || fData.repo;
                    if (body.accName) cur.accName = body.accName;
                    if (body.runId || fData.runId) cur.runId = String(body.runId || fData.runId);
                    if (body.status || fData.status) cur.status = body.status || fData.status;
                    if (body.startEpoch || fData.startEpoch) cur.startMs = Number(body.startEpoch || fData.startEpoch) * 1000;
                    if (body.durationMinutes || fData.durationMinutes) cur.minutes = Number(body.durationMinutes || fData.durationMinutes);

                    const sid = String(body.sessionId || fData.sessionId || (id + '-' + (cur.runId || Date.now()))).trim();
                    const fName = body.fileName || uploadedFileName || `machine-info-${id}.json`;

                    const tailIp = fData.tailscaleIp || body.tailscaleIp || fData.ip || body.ip || (cur.info && cur.info.ip) || '';
                    const stardeskId = String(fData.stardeskId || body.stardeskId || (cur.info && cur.info.stardeskId) || '').trim();
                    const storageRepo = String(fData.storageRepo || body.storageRepo || (cur.info && cur.info.storageRepo) || 'ddvdat-glitch/rdp').trim();
                    const runnerRepo = String(fData.runnerRepo || body.runnerRepo || fData.repo || body.repo || cur.repo || '').trim();
                    const displayName = String(fData.displayName || body.displayName || (cur.info && cur.info.displayName) || id).trim();
                    const rdpUser = fData.user || body.user || (cur.info && cur.info.user) || 'runneradmin';
                    const rdpPass = fData.password || body.password || (cur.info && (cur.info.password || cur.info.pass)) || '';
                    const wPort = String(fData.webPort || body.webPort || (cur.info && cur.info.webPort) || '8080');
                    const sPort = String(fData.sunshinePort || body.sunshinePort || (cur.info && cur.info.sunshinePort) || '47990');
                    const sUrl = fData.sunshineUrl || body.sunshineUrl || (cur.info && cur.info.sunshine) || (tailIp ? `https://${tailIp}:${sPort}/` : '');
                    const pUrl = fData.panelUrl || body.panelUrl || (cur.info && cur.info.panel) || (tailIp ? `http://${tailIp}:${wPort}/` : '');
                    const dLetter = String(fData.driveLetter || body.driveLetter || (cur.info && cur.info.driveLetter) || 'X');
                    const sRoot = String(fData.sharedRoot || body.sharedRoot || (cur.info && cur.info.sharedRoot) || 'X:\\AISTV-SYSTEM');
                    const pPath = String(fData.profilePath || body.profilePath || (cur.info && cur.info.profilePath) || ('C:\\Users\\' + rdpUser));
                    const aDev = String(fData.audioDevice || body.audioDevice || fData.audio || body.audio || (cur.info && cur.info.audio) || 'Speakers (VB-Audio Virtual Cable), CABLE Output (VB-Audio Virtual Cable), VB-Audio Virtual Cable');
                    const resScreen = String(fData.resolution || body.resolution || (cur.info && cur.info.screen) || '1920x1080@60');
                    const sEpoch = Number(fData.startEpoch || body.startEpoch || (cur.startMs ? Math.floor(cur.startMs / 1000) : Math.floor(Date.now() / 1000)));
                    const durM = Number(fData.durationMinutes || body.durationMinutes || cur.minutes || 300);
                    const remSec = Number(fData.remainSeconds != null ? fData.remainSeconds : (body.remainSeconds != null ? body.remainSeconds : Math.max(0, (sEpoch + durM * 60) - Math.floor(Date.now() / 1000))));
                    const ghRepo = String(fData.repo || body.repo || cur.repo || '');
                    const relTag = String(fData.releaseTag || body.releaseTag || ('aistv-storage-' + id));
                    const stBranch = String(fData.stateBranch || body.stateBranch || ('aistv-state-' + id));
                    const rId = String(fData.runId || body.runId || cur.runId || '');
                    const sdStat = String(fData.stardeskStatus || body.stardeskStatus || fData.stardesk || body.stardesk || 'Chờ khởi tạo');
                    const dUsed = Number(fData.diskUsedGb != null ? fData.diskUsedGb : (body.diskUsedGb != null ? body.diskUsedGb : 0));
                    const dFree = Number(fData.diskFreeGb != null ? fData.diskFreeGb : (body.diskFreeGb != null ? body.diskFreeGb : 0));
                    const stat = String(fData.status || body.status || cur.status || 'ready');
                    const reason = String(fData.reason || body.reason || 'heartbeat');
                    const tUtc = String(fData.timestampUtc || body.timestampUtc || new Date().toISOString());

                    const fullInfoObj = {
                      sessionId: sid,
                      machineId: id,
                      displayName: displayName,
                      stardeskId: stardeskId,
                      storageRepo: storageRepo,
                      runnerRepo: runnerRepo,
                      tailscaleIp: tailIp,
                      ip: tailIp,
                      user: rdpUser,
                      password: rdpPass,
                      sunshineUrl: sUrl,
                      panelUrl: pUrl,
                      webPort: wPort,
                      sunshinePort: sPort,
                      osBuild: String(fData.osBuild || body.osBuild || (cur.info && cur.info.osBuild) || '20348'),
                      windowsImage: String(fData.windowsImage || body.windowsImage || (cur.info && cur.info.windowsImage) || 'windows-2022'),
                      driveLetter: dLetter,
                      sharedRoot: sRoot,
                      profilePath: pPath,
                      audioDevice: aDev,
                      resolution: resScreen,
                      startEpoch: sEpoch,
                      durationMinutes: durM,
                      remainSeconds: remSec,
                      repo: ghRepo,
                      releaseTag: relTag,
                      stateBranch: stBranch,
                      runId: rId,
                      stardeskStatus: sdStat,
                      diskUsedGb: dUsed,
                      diskFreeGb: dFree,
                      status: stat,
                      reason: reason,
                      timestampUtc: tUtc
                    };

                    cur.fileData = fullInfoObj;

                    // Lưu file vào đĩa: rdp-sessions/<id>/ và received-files/ ở cả process.cwd() & os.tmpdir()
                    let fileBufferToSave = Buffer.from(JSON.stringify(fullInfoObj, null, 2), 'utf8');
                    if (uploadedFileContent) {
                      fileBufferToSave = uploadedFileContent;
                    } else if (body.fileContentB64) {
                      try { fileBufferToSave = Buffer.from(body.fileContentB64, 'base64'); } catch {}
                    }

                    const targetDirs = [process.cwd()];
                    try {
                      const tDir = require('os').tmpdir();
                      if (tDir && !targetDirs.includes(tDir)) targetDirs.push(tDir);
                    } catch {}

                    for (const baseDir of targetDirs) {
                      try {
                        const mDir = path.join(baseDir, 'rdp-sessions', id);
                        if (!fs.existsSync(mDir)) fs.mkdirSync(mDir, { recursive: true });
                        fs.writeFileSync(path.join(mDir, fName), fileBufferToSave);
                        fs.writeFileSync(path.join(mDir, `machine-info-${id}.json`), fileBufferToSave);
                        const rDir = path.join(baseDir, 'received-files');
                        if (!fs.existsSync(rDir)) fs.mkdirSync(rDir, { recursive: true });
                        fs.writeFileSync(path.join(rDir, fName), fileBufferToSave);
                        fs.writeFileSync(path.join(rDir, `machine-info-${id}.json`), fileBufferToSave);
                        fs.writeFileSync(path.join(rDir, `${id}-${sid}.json`), fileBufferToSave);
                        fs.writeFileSync(path.join(baseDir, `machine-info-${id}.json`), fileBufferToSave);
                      } catch {}
                    }
                    cur.lastFileReceived = fName;
                    cur.lastFileAt = Date.now();

                    cur.info = Object.assign(cur.info || {}, {
                      machineId: id,
                      displayName: displayName,
                      stardeskId: stardeskId,
                      storageRepo: storageRepo,
                      runnerRepo: runnerRepo,
                      repoTag: relTag,
                      stateBranch: stBranch,
                      ip: tailIp,
                      webPort: wPort,
                      sunshinePort: sPort,
                      sunshine: sUrl,
                      panel: pUrl,
                      stardesk: sdStat,
                      user: rdpUser,
                      pass: rdpPass,
                      password: rdpPass,
                      screen: resScreen,
                      audio: aDev,
                      disk: `${dLetter}:\\ (${sRoot})`,
                      driveLetter: dLetter,
                      sharedRoot: sRoot,
                      profile: pPath,
                      profilePath: pPath,
                      osBuild: fullInfoObj.osBuild,
                      windowsImage: fullInfoObj.windowsImage,
                      remainSeconds: remSec,
                      diskUsedGb: dUsed,
                      diskFreeGb: dFree,
                      eventReason: reason,
                      updatedUtc: tUtc
                    });
                    if (cur.info.ip && body.status !== 'stopped' && body.status !== 'done') {
                      cur.status = 'ready';
                      cur.infoAt = cur.infoAt || Date.now();
                    }

                    // Đánh dấu IP, MK, User cho từng phiên
                    st.sessions[id] = st.sessions[id] || [];
                    let curSession = st.sessions[id].find(s => s.sessionId === sid);
                    if (!curSession) {
                      curSession = {
                        sessionId: sid,
                        startedAt: Date.now(),
                        status: 'active',
                        ip: cur.info.ip || '',
                        user: cur.info.user || 'runneradmin',
                        pass: cur.info.pass || '',
                        password: cur.info.pass || '',
                        fileData: fullInfoObj,
                        info: {}
                      };
                      st.sessions[id].push(curSession);
                      if (st.sessions[id].length > 30) st.sessions[id] = st.sessions[id].slice(-30);
                    }
                    curSession.lastHeartbeat = Date.now();
                    curSession.status = (body.status === 'stopped' || body.status === 'done') ? 'stopped' : 'active';
                    curSession.ip = cur.info.ip || curSession.ip;
                    curSession.user = cur.info.user || curSession.user;
                    if (cur.info.pass) {
                      curSession.pass = cur.info.pass;
                      curSession.password = cur.info.pass;
                    }
                    curSession.fileData = fullInfoObj;
                    curSession.info = Object.assign(curSession.info || {}, cur.info);
                    cur.currentSessionId = sid;
                    cur.latestSession = curSession;

                    // Kiểm tra máy có đang hoạt động không (online < 10 phút)
                    const isOnline = (cur.status !== 'stopped' && cur.status !== 'done' && (Date.now() - (cur.lastReportAt || 0) < 600000));
                    cur.isOnline = isOnline;
                    cur.onlineStatus = isOnline ? 'online' : 'offline';

                    // Tự cải thiện prompt tóm tắt máy
                    const remText = cur.info.remainSeconds != null ? (Math.floor(cur.info.remainSeconds / 3600) + 'h ' + Math.floor((cur.info.remainSeconds % 3600) / 60) + 'm') : 'N/A';
                    const promptLines = [
                      `[THÔNG TIN MÁY RDP: ${id.toUpperCase()}]`,
                      `- Trạng thái: ${isOnline ? '🟢 ĐANG HOẠT ĐỘNG (Online)' : '🔴 KHÔNG HOẠT ĐỘNG (Offline)'}`,
                      `- StarDesk ID: ${cur.info.stardeskId || 'Chưa có'} (${cur.info.stardeskStatus || 'Đang chạy'})`,
                      `- Tài khoản RDP: ${cur.info.user || 'runneradmin'}`,
                      `- Mật khẩu: ${cur.info.pass || 'Chưa có'}`,
                      `- Kho lưu trữ (Repo Gốc): ${cur.info.storageRepo || 'ddvdat-glitch/rdp'} (${cur.info.repoTag || ('aistv-storage-' + id)})`,
                      `- Runner: ${cur.info.runnerRepo || cur.repo || 'ohohhoho82-alt/app'}`,
                      `- Mã phiên mới nhất: ${sid}`,
                      `- Thời gian còn lại: ${remText}`,
                      cur.info.ip ? `- IP mạng: ${cur.info.ip}` : null,
                      cur.info.panel ? `- Web Quản Lý: ${cur.info.panel}` : null,
                      `- Cập nhật gần nhất: ${new Date().toISOString()}`
                    ].filter(Boolean);
                    cur.autoPrompt = promptLines.join('\n');

                    // Ghi nhận vào danh sách file
                    const fileEntry = {
                      id: id + '-' + sid,
                      machineId: id,
                      sessionId: sid,
                      fileName: fName,
                      size: fileBufferToSave ? fileBufferToSave.length : 0,
                      receivedAt: Date.now(),
                      updatedUtc: new Date().toISOString(),
                      stardeskId: cur.info.stardeskId || '',
                      storageRepo: cur.info.storageRepo || 'ddvdat-glitch/rdp',
                      runnerRepo: cur.info.runnerRepo || cur.repo || '',
                      ip: cur.info.ip,
                      user: cur.info.user,
                      pass: cur.info.pass,
                      isOnline,
                      autoPrompt: cur.autoPrompt
                    };
                    st.files = (st.files || []).filter(f => !(f.machineId === id && f.sessionId === sid));
                    st.files.unshift(fileEntry);
                    if (st.files.length > 50) st.files = st.files.slice(0, 50);

                    saveBridgeState(st);
                    return sendJson(200, { ok: true, machine: cur, session: curSession, isOnline, autoPrompt: cur.autoPrompt, file: fileEntry });
                  }

                  // 1b. API LẤY DANH SÁCH FILE ĐÃ NHẬN & TRẠNG THÁI MÁY
                  if (u === '/api/rdp/files' && req.method === 'GET') {
                    const st = loadBridgeState();
                    const now = Date.now();
                    const machines = st.machines || {};
                    const files = (st.files || []).map(f => {
                      const m = machines[f.machineId];
                      const isOnline = m && (m.status !== 'stopped' && m.status !== 'done' && (now - (m.lastReportAt || 0) < 600000));
                      return Object.assign({}, f, {
                        stardeskId: (m && m.info && m.info.stardeskId) || f.stardeskId || '',
                        storageRepo: (m && m.info && m.info.storageRepo) || f.storageRepo || 'ddvdat-glitch/rdp',
                        runnerRepo: (m && m.info && m.info.runnerRepo) || f.runnerRepo || (m && m.repo) || '',
                        isOnline: !!isOnline,
                        lastHeartbeat: m ? m.lastReportAt : f.receivedAt,
                        secondsSinceHeartbeat: m && m.lastReportAt ? Math.floor((now - m.lastReportAt) / 1000) : null,
                        autoPrompt: (m && m.autoPrompt) || f.autoPrompt || ''
                      });
                    });
                    return sendJson(200, { ok: true, files, total: files.length, checkedAt: new Date().toISOString() });
                  }

                  // 1c. API XEM CHI TIẾT NỘI DUNG FILE JSON
                  if (u === '/api/rdp/view-file' && req.method === 'GET') {
                    const urlObj = new URL(req.url, 'http://localhost');
                    const mid = (urlObj.searchParams.get('machine') || '').trim().toLowerCase();
                    const fName = (urlObj.searchParams.get('file') || '').trim();
                    const fileId = (urlObj.searchParams.get('id') || '').trim();

                    const tryPaths = [
                      fName && mid ? path.join(process.cwd(), 'rdp-sessions', mid, fName) : null,
                      fName ? path.join(process.cwd(), 'received-files', fName) : null,
                      mid ? path.join(process.cwd(), 'rdp-sessions', mid, `machine-info-${mid}.json`) : null,
                      fileId ? path.join(process.cwd(), 'received-files', `${fileId}.json`) : null
                    ].filter(Boolean);

                    let foundContent = null;
                    let usedName = fName;
                    for (const p of tryPaths) {
                      if (fs.existsSync(p)) {
                        try {
                          foundContent = fs.readFileSync(p, 'utf8');
                          usedName = path.basename(p);
                          break;
                        } catch {}
                      }
                    }

                    if (!foundContent && mid) {
                      const st = loadBridgeState();
                      const m = (st.machines || {})[mid];
                      if (m && m.info) {
                        foundContent = JSON.stringify(Object.assign({ machineId: mid, sessionId: m.currentSessionId || '', status: m.status, isOnline: m.isOnline, autoPrompt: m.autoPrompt }, m.info), null, 2);
                        usedName = `machine-info-${mid}.json`;
                      }
                    }

                    if (!foundContent) return sendJson(404, { ok: false, error: 'Không tìm thấy file' });
                    let parsed = null;
                    try { parsed = JSON.parse(foundContent); } catch {}
                    return sendJson(200, { ok: true, fileName: usedName, content: parsed || foundContent });
                  }

                  // 1d. API TẢI FILE TRỰC TIẾP VỀ MÁY
                  if (u === '/api/rdp/download-file' && req.method === 'GET') {
                    const urlObj = new URL(req.url, 'http://localhost');
                    const mid = (urlObj.searchParams.get('machine') || '').trim().toLowerCase();
                    const fName = (urlObj.searchParams.get('file') || `machine-info-${mid || 'vm'}.json`).trim();

                    const tryPaths = [
                      mid && fName ? path.join(process.cwd(), 'rdp-sessions', mid, fName) : null,
                      fName ? path.join(process.cwd(), 'received-files', fName) : null,
                      mid ? path.join(process.cwd(), 'rdp-sessions', mid, `machine-info-${mid}.json`) : null
                    ].filter(Boolean);

                    let fileBuf = null;
                    for (const p of tryPaths) {
                      if (fs.existsSync(p)) {
                        try { fileBuf = fs.readFileSync(p); break; } catch {}
                      }
                    }

                    if (!fileBuf && mid) {
                      const st = loadBridgeState();
                      const m = (st.machines || {})[mid];
                      if (m && m.info) {
                        fileBuf = Buffer.from(JSON.stringify(Object.assign({ machineId: mid, sessionId: m.currentSessionId || '', status: m.status }, m.info), null, 2), 'utf8');
                      }
                    }

                    if (!fileBuf) return sendJson(404, { ok: false, error: 'Không tìm thấy file để tải về' });
                    res.writeHead(200, {
                      'Content-Type': 'application/json; charset=utf-8',
                      'Content-Disposition': `attachment; filename="${encodeURIComponent(fName)}"`,
                      'Content-Length': fileBuf.length,
                      'Access-Control-Allow-Origin': '*'
                    });
                    return res.end(fileBuf);
                  }

                  // 1e. API XÓA FILE
                  if (u === '/api/rdp/delete-file' && req.method === 'POST') {
                    if (!checkAuth(req, body)) return sendJson(401, { ok: false, error: 'Sai mật khẩu Admin' });
                    const mid = String(body.machineId || '').trim().toLowerCase();
                    const fName = String(body.fileName || '').trim();
                    const st = loadBridgeState();
                    st.files = (st.files || []).filter(f => !(f.machineId === mid && (!fName || f.fileName === fName)));
                    try {
                      if (mid && fName) {
                        const p1 = path.join(process.cwd(), 'rdp-sessions', mid, fName);
                        if (fs.existsSync(p1)) fs.unlinkSync(p1);
                        const p2 = path.join(process.cwd(), 'received-files', fName);
                        if (fs.existsSync(p2)) fs.unlinkSync(p2);
                      }
                    } catch {}
                    saveBridgeState(st);
                    return sendJson(200, { ok: true, message: 'Đã xóa file' });
                  }

                  // 1f. API KIỂM TRA SỨC KHỎE TẤT CẢ CÁC MÁY (heartbeat)
                  if (u === '/api/rdp/health' && req.method === 'GET') {
                    const st = loadBridgeState();
                    const machines = st.machines || {};
                    const healthList = {};
                    const now = Date.now();
                    for (const [mid, m] of Object.entries(machines)) {
                      const lastHb = m.lastReportAt || 0;
                      const isOnline = (m.status !== 'stopped' && m.status !== 'done' && (now - lastHb < 600000));
                      const sessList = (st.sessions && st.sessions[mid]) || [];
                      const latestSess = sessList.length ? sessList[sessList.length - 1] : null;
                      healthList[mid] = {
                        name: m.name,
                        online: isOnline,
                        status: isOnline ? 'online' : 'offline',
                        lastHeartbeat: lastHb,
                        secondsSinceHeartbeat: Math.floor((now - lastHb) / 1000),
                        ip: (m.info && m.info.ip) || '',
                        user: (m.info && m.info.user) || 'runneradmin',
                        currentSession: latestSess ? latestSess.sessionId : null,
                        totalSessions: sessList.length,
                        autoPrompt: m.autoPrompt || ''
                      };
                    }
                    return sendJson(200, { ok: true, machines: healthList, checkedAt: new Date().toISOString() });
                  }

                  // 1g. API LẤY AUTO-PROMPT CẢI THIỆN CHO MÁY HOẶC TẤT CẢ MÁY
                  if (u === '/api/rdp/prompt' && req.method === 'GET') {
                    const urlObj = new URL(req.url, 'http://localhost');
                    const targetMachine = (urlObj.searchParams.get('machine') || '').trim().toLowerCase();
                    const st = loadBridgeState();
                    const machines = st.machines || {};
                    if (targetMachine) {
                      const m = machines[targetMachine];
                      if (!m) return sendJson(404, { ok: false, error: 'Không tìm thấy máy ' + targetMachine });
                      return sendJson(200, { ok: true, machine: targetMachine, prompt: m.autoPrompt || '' });
                    }
                    const allPrompts = {};
                    for (const [mid, m] of Object.entries(machines)) {
                      allPrompts[mid] = m.autoPrompt || '';
                    }
                    return sendJson(200, { ok: true, prompts: allPrompts });
                  }

                  // 2. API LẤY TRẠNG THÁI CHO WEB QUẢN LÝ & SCRIPT
                  if (u === '/api/rdp/state' && req.method === 'GET') {
                    if (!checkAuth(req, body)) return sendJson(401, { ok: false, error: 'Sai mật khẩu Admin' });
                    return sendJson(200, { ok: true, data: loadBridgeState(), duckdnsDomain: process.env.DUCKDNS_DOMAIN || 'datdemo.duckdns.org', tailscaleIp: process.env.TAILSCALE_IP || '' });
                  }

                  // 2.1 API LẤY TOÀN BỘ CẤU HÌNH LỆNH, MENU VÀ MÁY ẢO CHO WEB TU TIÊN (/api/rdp/full)
                  if (u === '/api/rdp/full' && req.method === 'GET') {
                    if (!checkAuth(req, body)) return sendJson(401, { ok: false, error: 'Sai mật khẩu Admin' });
                    const liveDb = (botCtx && typeof botCtx.db === 'function') ? botCtx.db() : null;
                    let rdpData = (liveDb && liveDb.rdp) || null;
                    let roles = (liveDb && liveDb.roles) || {};
                    let channels = (liveDb && liveDb.channels) || {};
                    if (!rdpData) {
                      try {
                        if (fs.existsSync(DATA_PATH)) {
                          const d = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
                          rdpData = d.rdp;
                          roles = d.roles || roles;
                          channels = d.channels || channels;
                        }
                      } catch {}
                    }
                    if (!rdpData) rdpData = loadBridgeState();
                    return sendJson(200, { ok: true, rdp: rdpData, roles, channels, botReady: true });
                  }

                  // 2.2 API LƯU TOÀN BỘ CẤU HÌNH LỆNH, MENU VÀ MÁY ẢO VÀO data.json
                  if (u === '/api/rdp/full' && req.method === 'PUT') {
                    if (!checkAuth(req, body)) return sendJson(401, { ok: false, error: 'Sai mật khẩu Admin' });
                    const newRdp = body || {};
                    // Cập nhật trực tiếp vào RAM của bot ngay lập tức
                    if (botCtx && typeof botCtx.db === 'function') {
                      const liveDb = botCtx.db();
                      liveDb.rdp = Object.assign(liveDb.rdp || {}, newRdp);
                      if (typeof botCtx.saveNow === 'function') {
                        try { botCtx.saveNow(); } catch {}
                      }
                    }
                    try {
                      if (fs.existsSync(DATA_PATH)) {
                        const d = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
                        d.rdp = Object.assign(d.rdp || {}, newRdp);
                        fs.writeFileSync(DATA_PATH, JSON.stringify(d, null, 2), 'utf8');
                      }
                    } catch {}
                    saveBridgeState(newRdp);
                    return sendJson(200, { ok: true, rdp: newRdp });
                  }

                  // 2.3 API BIẾN MẪU XEM TRƯỚC CHO CANVAS STAGE
                  if (u === '/api/rdp/vars' && req.method === 'POST') {
                    const st = loadBridgeState();
                    const vms = Object.values(st.machines || {});
                    let on = 0, off = 0;
                    vms.forEach(m => { if (m.isOnline) on++; else off++; });
                    const cfg = getRdpConfig();
                    const sample = vms[0] || { name: 'test', displayName: 'Máy test', gvId: '1016022822', gvPin: 'Aistv2026', stardeskId: '928 314 551', owner: 'Admin' };
                    return sendJson(200, {
                      onlineCount: on,
                      offlineCount: off,
                      totalCount: vms.length,
                      runnerRepo: cfg.runnerRepo,
                      storageRepo: cfg.storageRepo,
                      machineList: vms.map(m => `• **${m.displayName || m.name}** [${m.name}] : ${m.isOnline ? '🟢 Online' : '🔴 Offline'}`).join('\n') || '• Chưa có máy ảo nào',
                      curMachineId: sample.name,
                      curDisplayName: sample.displayName || sample.name,
                      curStatusBadge: sample.isOnline ? '🟢 Online' : '🔴 Offline',
                      curGvId: sample.gvId || '1016022822',
                      curDisplayPin: sample.gvPin || 'Aistv2026',
                      curStardeskId: sample.stardeskId || '928 314 551',
                      curUser: 'runneradmin',
                      curPass: 'Aistv@2026',
                      curRemain: '4h 55m còn lại',
                      curOwner: sample.owner || 'Admin'
                    });
                  }

                                    // 2.4 API GỬI THỬ MENU VÀO KÊNH DISCORD
                  if (u === '/api/rdp/send-menu' && req.method === 'POST') {
                    if (!checkAuth(req, body)) return sendJson(401, { ok: false, error: 'Sai mật khẩu Admin' });
                    const { menuId, channelId } = body || {};
                    const id = String(channelId || '').match(/\d{15,25}/)?.[0];
                    if (!id) return sendJson(400, { ok: false, error: 'Chưa chọn kênh Discord hợp lệ' });
                    if (!botCtx?.client?.isReady?.()) return sendJson(503, { ok: false, error: 'Bot chưa online trên Discord' });
                    const ch = await botCtx.client.channels.fetch(id).catch(() => null);
                    if (!ch || typeof ch.send !== 'function') return sendJson(404, { ok: false, error: 'Không tìm thấy kênh hoặc Bot không có quyền gửi' });

                    const d = (botCtx && botCtx.db()) || loadBridgeState();
                    const rdp = d.rdp || loadBridgeState();
                    const menu = (rdp.menus || []).find(m => m.id === menuId);
                    if (!menu) return sendJson(404, { ok: false, error: 'Không tìm thấy menu (nhớ bấm Lưu trước)' });

                    const vars = getRdpVars('any', { title: menu.name });
                    const payload = buildRdpPayload(menu, vars, 'any');
                    await ch.send(payload);
                    return sendJson(200, { ok: true, message: 'Đã gửi menu vào kênh thành công!' });
                  }

                  // 3. API QUẢN LÝ NHIỀU TÀI KHOẢN GIT (TOKEN + REPO) & CÀI ĐẶT DUCKDNS
                  if (u === '/api/rdp/config' && req.method === 'POST') {
                    if (!checkAuth(req, body)) return sendJson(401, { ok: false, error: 'Sai mật khẩu Admin' });
                    const st = loadBridgeState();
                    st.accounts = st.accounts || {};
                    st.machines = st.machines || {};
                    if (body.action === 'add_account') {
                      const k = String(body.alias || '').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '');
                      if (!k || !body.repo || !body.token) return sendJson(400, { ok: false, error: 'Thiếu alias, repo hoặc token' });
                      st.accounts[k] = {
                        alias: k,
                        repo: String(body.repo).trim(),
                        token: String(body.token).trim(),
                        branch: String(body.branch || 'main').trim(),
                        wfDir: String(body.wfDir || '.github/workflows').trim(),
                        template: String(body.template || 'may3.yml').trim(),
                        updatedAt: Date.now()
                      };
                      if (body.setDefault || !st.defaultAccount) st.defaultAccount = k;
                    } else if (body.action === 'del_account') {
                      delete st.accounts[body.alias];
                      if (st.defaultAccount === body.alias) st.defaultAccount = Object.keys(st.accounts)[0] || '';
                    } else if (body.action === 'set_default_account') {
                      if (st.accounts[body.alias]) st.defaultAccount = body.alias;
                    } else if (body.action === 'assign_machine') {
                      const mName = String(body.machine || '').trim().toLowerCase();
                      if (mName) {
                        st.machines[mName] = st.machines[mName] || { name: mName, file: mName + '.yml', created: Date.now() };
                        st.machines[mName].ownerId = String(body.ownerId || '').trim();
                        st.machines[mName].owner = String(body.ownerName || body.ownerId || '').trim();
                        if (body.accName) st.machines[mName].accName = body.accName;
                      }
                    } else if (body.action === 'set_duckdns') {
                      st.duckdns = { domain: String(body.domain || 'datdemo.duckdns.org').trim(), token: String(body.token || '').trim(), updatedAt: Date.now() };
                    }
                    saveBridgeState(st);
                    return sendJson(200, { ok: true, data: st });
                  }

                  // 4. API GỬI LỆNH TRỰC TIẾP VỀ IP MÁY ẢO
                  if (u === '/api/rdp/vm-cmd' && req.method === 'POST') {
                    if (!checkAuth(req, body)) return sendJson(401, { ok: false, error: 'Sai mật khẩu Admin' });
                    const st = loadBridgeState();
                    const m = (st.machines || {})[body.machine];
                    const ip = body.ip || (m && m.info && m.info.ip);
                    const port = body.port || (m && m.info && m.info.webPort) || '8080';
                    if (!ip) return sendJson(400, { ok: false, error: 'Máy chưa có IP' });
                    try {
                      const vmRes = await fetch(`http://${ip}:${port}/api/cmd`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ cmd: body.cmd, text: body.text || '' }),
                        signal: AbortSignal.timeout(10000)
                      });
                      const vmJson = await vmRes.json();
                      return sendJson(200, { ok: true, vm: vmJson });
                    } catch (err) {
                      return sendJson(502, { ok: false, error: String(err.message || err) });
                    }
                  }

                                                      // ==========================================================================
                  // CÁC HÀM TIỆN ÍCH GITHUB API & TỰ ĐỘNG TÁI TẠO WORKFLOW
                  // ==========================================================================
                  function getRdpConfig() {
                    const d = (botCtx && typeof botCtx.db === 'function' ? botCtx.db() : null) || loadBridgeState();
                    const r = d.rdp || (d.shared && d.shared.rdp) || d;
                    const cfg = r.config || {};
                    const storageRepo = cfg.storageRepo || process.env.STORAGE_REPO || 'ddvdat-glitch/rdp';
                    const runnerRepo = cfg.runnerRepo || process.env.RUNNER_REPO || 'ohohhoho82-alt/app';
                    const token = cfg.token || process.env.GITHUB_TOKEN || process.env.PAT_TOKEN || process.env.RDP_GH_TOKEN || process.env.STORAGE_GH_TOKEN || process.env.GH_TOKEN || '';
                    const rootAdmin = cfg.rootAdmin || '946662197168341053';
                    return { storageRepo, runnerRepo, token, rootAdmin, ...cfg };
                  }

                  function ghRequest(method, repo, endpoint, body, customToken) {
                    return new Promise((resolve, reject) => {
                      const cfg = getRdpConfig();
                      const token = customToken || cfg.token;
                      const pathUrl = endpoint.startsWith('http')
                        ? endpoint.replace('https://api.github.com', '')
                        : (endpoint.startsWith('/repos/') ? endpoint : `/repos/${repo}${endpoint.startsWith('/') ? '' : '/'}${endpoint}`);

                      const dataStr = body ? JSON.stringify(body) : null;
                      const headers = {
                        'User-Agent': 'AISTV-RDP-Manager-Web',
                        'Accept': 'application/vnd.github+json'
                      };
                      if (token) {
                        headers['Authorization'] = (token.startsWith('Bearer ') || token.startsWith('token ')) ? token : `token ${token}`;
                      }
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
                      req.setTimeout(25000, () => {
                        req.destroy();
                        reject(new Error('GitHub API request timeout (25s)'));
                      });
                      if (dataStr) req.write(dataStr);
                      req.end();
                    });
                  }

                  function loadTaomayTemplate() {
                    const localCandidates = [
                      path.join(__dirname, 'taomay.yml'),
                      path.join(__dirname, 'taomay.yaml'),
                      path.join(process.cwd(), 'taomay.yml'),
                      path.join(process.cwd(), 'taomay.yaml'),
                      path.join(process.cwd(), '.github/workflows/taomay.yml'),
                      'c:/Users/acc/Downloads/badao/taomay.yml',
                      'c:/Users/acc/Downloads/badao/taomay.yaml'
                    ];
                    for (const lp of localCandidates) {
                      try {
                        if (fs.existsSync(lp)) return fs.readFileSync(lp, 'utf8');
                      } catch {}
                    }
                    return null;
                  }

                  function normalizeDuration(dur) {
  if (!dur) return '5h00m';
  const s = String(dur).toLowerCase().trim();
  if (s === '1' || s.startsWith('1h')) return '1h';
  if (s === '3' || s.startsWith('3h')) return '3h';
  return '5h00m';
}

function buildVmWorkflow(tpl, name, duration, pin, storageRepo) {
                    let out = tpl;
                    out = out.replace(/^name:\s*.*$/m, `name: máy ${name}`);
                    out = out.replace(/default:\s*'may-phu-2'/g, `default: '${name}'`);
                    out = out.replace(/default:\s*'Máy Phụ 2'/g, `default: 'Máy ${name}'`);
                    out = out.replace(/group:\s*stardesk-[^\r\n]+/g, `group: stardesk-${name}`);
                    out = out.replace(/MACHINE_ID:\s*\${{[^}]+}}/g, `MACHINE_ID: '${name}'`);
                    out = out.replace(/DISPLAY_NAME:\s*\${{[^}]+}}/g, `DISPLAY_NAME: 'Máy ${name}'`);

                    if (storageRepo) {
                      out = out.replace(/default:\s*'ddvdat-glitch\/rdp'/g, `default: '${storageRepo}'`);
                      out = out.replace(/STORAGE_REPO:\s*\${{[^}]+}}/g, `STORAGE_REPO: '${storageRepo}'`);
                    }

                    if (duration) {
                      const durVal = normalizeDuration(duration);
                      out = out.replace(/(duration:[\s\S]*?default:\s*)'[0-9a-z]+'/i, `$1'${durVal}'`);
                    }

                    if (pin) {
                      const cleanPin = pin.replace(/[^A-Za-z0-9]/g, '');
                      out = out.replace(/(pin_code:[\s\S]*?default:\s*)'[A-Za-z0-9@_.-]+'/i, `$1'${cleanPin}'`);
                      out = out.replace(/(fixed_password:[\s\S]*?default:\s*)'[A-Za-z0-9@_.-]+'/i, `$1'${cleanPin}'`);
                    }

                    return out;
                  }

                  async function dispatchWorkflow(runnerRepo, wfFile, inputs = {}, token) {
  const safeInputs = { ...(inputs || {}) };
  if (safeInputs.duration) {
    safeInputs.duration = normalizeDuration(safeInputs.duration);
  }
  return await ghRequest('POST', runnerRepo, `/actions/workflows/${wfFile}/dispatches`, {
    ref: 'main',
    inputs: safeInputs
  }, token);
}

                  async function cancelWorkflowRuns(runnerRepo, wfFile, token) {
                    try {
                      const res = await ghRequest('GET', runnerRepo, `/actions/workflows/${wfFile}/runs?status=in_progress&per_page=10`, null, token);
                      const runs = (res && res.workflow_runs) || [];
                      for (const r of runs) {
                        try { await ghRequest('POST', runnerRepo, `/actions/runs/${r.id}/cancel`, null, token); } catch {}
                      }
                      const qRes = await ghRequest('GET', runnerRepo, `/actions/workflows/${wfFile}/runs?status=queued&per_page=10`, null, token);
                      const qRuns = (qRes && qRes.workflow_runs) || [];
                      for (const r of qRuns) {
                        try { await ghRequest('POST', runnerRepo, `/actions/runs/${r.id}/cancel`, null, token); } catch {}
                      }
                    } catch {}
                  }

                  // --------------------------------------------------------------------------
                  // 5.1 API: QUÉT TẤT CẢ FILE WORKFLOW TRÊN RUNNER REPO
                  // --------------------------------------------------------------------------
                  if (u === '/api/rdp/scan-workflows' && req.method === 'GET') {
                    if (!checkAuth(req, body)) return sendJson(401, { ok: false, error: 'Sai mật khẩu Admin' });
                    const st = loadBridgeState();
                    const cfg = getRdpConfig();
                    try {
                      const contents = await ghRequest('GET', cfg.runnerRepo, '/contents/.github/workflows', null, cfg.token);
                      if (!Array.isArray(contents)) return sendJson(400, { ok: false, error: `Không đọc được thư mục .github/workflows trên ${cfg.runnerRepo}` });
                      const ymlFiles = contents.filter(f => f.type === 'file' && /\.(ya?ml)$/i.test(f.name));
                      const ignored = ['taomay.yml', 'taomay.yaml', 'taomaygoc.yml', 'bot.yml', 'botcuadat.yml'];
                      const machineFiles = ymlFiles.filter(f => !ignored.includes(f.name.toLowerCase()));

                      const list = [];
                      st.machines = st.machines || {};

                      for (const f of machineFiles) {
                        try {
                          const fDetail = await ghRequest('GET', cfg.runnerRepo, `/contents/${f.path}`, null, cfg.token);
                          if (!fDetail || !fDetail.content) continue;
                          const rawYml = Buffer.from(fDetail.content.replace(/\s+/g, ''), 'base64').toString('utf8');
                          const idM = rawYml.match(/machine_id:[\s\S]*?default:\s*['"]([^'"]+)['"]/i);
                          const nameM = rawYml.match(/display_name:[\s\S]*?default:\s*['"]([^'"]+)['"]/i);
                          const durM = rawYml.match(/duration:[\s\S]*?default:\s*['"]([^'"]+)['"]/i);
                          const pinM = rawYml.match(/(?:pin_code|fixed_password):[\s\S]*?default:\s*['"]([^'"]+)['"]/i);
                          const storageM = rawYml.match(/storage_repo:[\s\S]*?default:\s*['"]([^'"]+)['"]/i);

                          const fileBaseId = f.name.replace(/\.(ya?ml)$/i, '').toLowerCase();
      const mId = fileBaseId;
                          const dName = (nameM && nameM[1]) || `Máy ${mId}`;
                          const dur = (durM && durM[1]) || '5h00m';
                          const pin = (pinM && pinM[1]) || 'Aistv2026';
                          const stRepo = (storageM && storageM[1]) || cfg.storageRepo;

                          const isLatest = rawYml.includes('uuyc_4.43.1.exe') && rawYml.includes('ProtectedData::Protect') && rawYml.includes('StarDesk_1.5.3.exe');

                          const cur = st.machines[mId] = st.machines[mId] || { name: mId, created: Date.now() };
                          cur.name = mId;
                          cur.displayName = dName;
                          cur.duration = dur;
                          cur.gvPin = pin;
                          cur.storageRepo = stRepo;
                          cur.repo = cfg.runnerRepo;
                          cur.isLatestTemplate = isLatest;

                          let lastRun = null;
                          try {
                            const rRes = await ghRequest('GET', cfg.runnerRepo, `/actions/workflows/${f.name}/runs?per_page=1`, null, cfg.token);
                            if (rRes && rRes.workflow_runs && rRes.workflow_runs[0]) {
                              const r = rRes.workflow_runs[0];
                              lastRun = {
                                id: r.id,
                                status: r.status,
                                conclusion: r.conclusion,
                                runUrl: r.html_url,
                                startedAt: r.run_started_at || r.created_at
                              };
                              cur.runId = r.id;
                              cur.status = r.status;
                              cur.conclusion = r.conclusion;
                              if (r.status === 'in_progress') cur.isOnline = true;
                              else if (r.status === 'completed') cur.isOnline = false;
                            }
                          } catch {}

                          list.push({
                            file: f.name,
                            path: f.path,
                            machineId: mId,
                            displayName: dName,
                            duration: dur,
                            pin,
                            storageRepo: stRepo,
                            isLatestTemplate: isLatest,
                            lastRun
                          });
                        } catch {}
                      }
                      saveBridgeState(st);
                      return sendJson(200, { ok: true, runnerRepo: cfg.runnerRepo, storageRepo: cfg.storageRepo, workflows: list });
                    } catch (err) {
                      return sendJson(500, { ok: false, error: err.message });
                    }
                  }

                  // --------------------------------------------------------------------------
                  // 5.2 API: TÁI TẠO & NÂNG CẤP WORKFLOW LÊN BẢN MỚI NHẤT
                  // --------------------------------------------------------------------------
                  if (u === '/api/rdp/rebuild-workflows' && req.method === 'POST') {
                    if (!checkAuth(req, body)) return sendJson(401, { ok: false, error: 'Sai mật khẩu Admin' });
                    const st = loadBridgeState();
                    const cfg = getRdpConfig();
                    const targetMachine = body.machine || 'all';

                    let tpl = loadTaomayTemplate();
                    if (!tpl) {
                      try {
                        const f = await ghRequest('GET', cfg.storageRepo, '/contents/taomay.yml', null, cfg.token);
                        if (f && f.content) tpl = Buffer.from(f.content.replace(/\s+/g, ''), 'base64').toString('utf8');
                      } catch {}
                    }
                    if (!tpl) return sendJson(400, { ok: false, error: 'Không tìm thấy file mẫu taomay.yml' });

                    try {
                      const contents = await ghRequest('GET', cfg.runnerRepo, '/contents/.github/workflows', null, cfg.token);
                      const ymlFiles = contents.filter(f => f.type === 'file' && /\.(ya?ml)$/i.test(f.name));
                      const ignored = ['taomay.yml', 'taomay.yaml', 'taomaygoc.yml', 'bot.yml', 'botcuadat.yml'];
                      const machineFiles = ymlFiles.filter(f => !ignored.includes(f.name.toLowerCase()));

                      const targets = targetMachine === 'all'
                        ? machineFiles
                        : machineFiles.filter(f => f.name.toLowerCase().startsWith(targetMachine.toLowerCase() + '.'));

                      const updated = [];
                      for (const f of targets) {
                        try {
                          const fDetail = await ghRequest('GET', cfg.runnerRepo, `/contents/${f.path}`, null, cfg.token);
                          if (!fDetail || !fDetail.content) continue;
                          const rawYml = Buffer.from(fDetail.content.replace(/\s+/g, ''), 'base64').toString('utf8');
                          const idM = rawYml.match(/machine_id:[\s\S]*?default:\s*['"]([^'"]+)['"]/i);
                          const durM = rawYml.match(/duration:[\s\S]*?default:\s*['"]([^'"]+)['"]/i);
                          const pinM = rawYml.match(/(?:pin_code|fixed_password):[\s\S]*?default:\s*['"]([^'"]+)['"]/i);

                          const fileBaseId = f.name.replace(/\.(ya?ml)$/i, '').toLowerCase();
      const mId = fileBaseId;
                          const dur = (durM && durM[1]) || '5h00m';
                          const pin = (pinM && pinM[1]) || 'Aistv2026';

                          const newContent = buildVmWorkflow(tpl, mId, dur, pin, cfg.storageRepo);
                          const b64 = Buffer.from(newContent, 'utf8').toString('base64');
                          await ghRequest('PUT', cfg.runnerRepo, `/contents/${f.path}`, {
                            message: `[AISTV] Tự động nâng cấp workflow máy ${mId} (GameViewer 4.43.1 + StarDesk 1.5.3 + DPAPI)`,
                            content: b64,
                            sha: fDetail.sha
                          }, cfg.token);

                          if (st.machines && st.machines[mId]) {
                            st.machines[mId].isLatestTemplate = true;
                            st.machines[mId].upgradedAt = Date.now();
                          }
                          updated.push(mId);
                          await new Promise(r => setTimeout(r, 800));
                        } catch (e) {
                          console.error('Lỗi nâng cấp workflow:', e.message);
                        }
                      }
                      saveBridgeState(st);
                      return sendJson(200, { ok: true, updated, count: updated.length });
                    } catch (err) {
                      return sendJson(500, { ok: false, error: err.message });
                    }
                  }

                  // --------------------------------------------------------------------------
                  // 5.3 API: TẠO MÁY MỚI TRỰC TIẾP TỪ WEB
                  // --------------------------------------------------------------------------
                  if (u === '/api/rdp/create-vm' && req.method === 'POST') {
                    if (!checkAuth(req, body)) return sendJson(401, { ok: false, error: 'Sai mật khẩu Admin' });
                    const st = loadBridgeState();
                    const cfg = getRdpConfig();

                    const rawName = String(body.name || '').trim().toLowerCase();
                    const cleanName = (rawName.replace(/[^a-z0-9\-]/g, '-').replace(/\-+/g, '-').replace(/^\-|\-$/g, '')) || `may-${Date.now().toString(36).slice(-4)}`;
                    const displayName = String(body.displayName || `Máy ${cleanName}`).trim();
                    const duration = String(body.duration || '5h00m').trim();
                    const pin = String(body.pin || 'Aistv2026').trim().replace(/[^A-Za-z0-9]/g, '');
                    const runnerRepo = String(body.runnerRepo || cfg.runnerRepo).trim();
                    const storageRepo = String(body.storageRepo || cfg.storageRepo).trim();

                    let tpl = loadTaomayTemplate();
                    if (!tpl) {
                      try {
                        const f = await ghRequest('GET', storageRepo, '/contents/taomay.yml', null, cfg.token);
                        if (f && f.content) tpl = Buffer.from(f.content.replace(/\s+/g, ''), 'base64').toString('utf8');
                      } catch {}
                    }
                    if (!tpl) return sendJson(400, { ok: false, error: 'Không tìm thấy file mẫu taomay.yml' });

                    const wfContent = buildVmWorkflow(tpl, cleanName, duration, pin, storageRepo);
                    const b64 = Buffer.from(wfContent, 'utf8').toString('base64');
                    const wfPath = `.github/workflows/${cleanName}.yml`;

                    try {
                      let sha = undefined;
                      try {
                        const exist = await ghRequest('GET', runnerRepo, `/contents/${wfPath}`, null, cfg.token);
                        if (exist && exist.sha) sha = exist.sha;
                      } catch {}

                      await ghRequest('PUT', runnerRepo, `/contents/${wfPath}`, {
                        message: `[AISTV] Khởi tạo máy ảo ${cleanName} trên Runner Repo`,
                        content: b64,
                        sha
                      }, cfg.token);

                      await new Promise(r => setTimeout(r, 1500));
                      await dispatchWorkflow(runnerRepo, `${cleanName}.yml`, {
                        machine_id: cleanName,
                        display_name: displayName,
                        duration,
                        pin_code: pin
                      }, cfg.token);

                      st.machines = st.machines || {};
                      st.machines[cleanName] = {
                        name: cleanName,
                        displayName,
                        duration,
                        gvPin: pin,
                        storageRepo,
                        repo: runnerRepo,
                        ownerId: String(body.ownerId || '').trim(),
                        owner: String(body.ownerName || body.ownerId || '').trim(),
                        status: 'in_progress',
                        isOnline: false,
                        isLatestTemplate: true,
                        created: Date.now()
                      };
                      saveBridgeState(st);
                      return sendJson(200, { ok: true, machine: cleanName, message: `Đã tạo máy [${displayName}] thành công!` });
                    } catch (err) {
                      return sendJson(500, { ok: false, error: err.message });
                    }
                  }

                  // --------------------------------------------------------------------------
                  // 5.4 API: ĐIỀU KHIỂN TIẾN TRÌNH MÁY ẢO (START / RESTART / STOP / DELETE)
                  // --------------------------------------------------------------------------
                  if (u === '/api/rdp/control-vm' && req.method === 'POST') {
                    if (!checkAuth(req, body)) return sendJson(401, { ok: false, error: 'Sai mật khẩu Admin' });
                    const st = loadBridgeState();
                    const cfg = getRdpConfig();
                    const mId = String(body.machine || '').trim().toLowerCase();
                    const action = String(body.action || '').trim().toLowerCase();
                    const m = (st.machines || {})[mId];
                    const runnerRepo = (m && m.repo) || cfg.runnerRepo;

                    try {
                      if (action === 'start') {
                        await dispatchWorkflow(runnerRepo, `${mId}.yml`, {}, cfg.token);
                        if (m) { m.status = 'queued'; m.isOnline = true; }
                        saveBridgeState(st);
                        return sendJson(200, { ok: true, message: `Đã gửi lệnh chạy phiên mới cho máy [${mId}]` });
                      } else if (action === 'restart') {
                        await cancelWorkflowRuns(runnerRepo, `${mId}.yml`, cfg.token);
                        await new Promise(r => setTimeout(r, 2000));
                        await dispatchWorkflow(runnerRepo, `${mId}.yml`, {}, cfg.token);
                        if (m) { m.status = 'queued'; m.isOnline = true; }
                        saveBridgeState(st);
                        return sendJson(200, { ok: true, message: `Đã hủy phiên cũ và khởi chạy phiên mới cho [${mId}]` });
                      } else if (action === 'stop') {
                        await cancelWorkflowRuns(runnerRepo, `${mId}.yml`, cfg.token);
                        if (m) { m.status = 'Stopped'; m.isOnline = false; }
                        saveBridgeState(st);
                        return sendJson(200, { ok: true, message: `Đã dừng toàn bộ tiến trình cho máy [${mId}]` });
                      } else if (action === 'delete_disk') {
                        const res = await deleteMachineDisk(mId);
                        return sendJson(200, res);
                      } else if (action === 'delete') {
                        const res = await deleteMachineFull(mId);
                        return sendJson(200, res);
                      } else {
                        return sendJson(400, { ok: false, error: 'Hành động không hợp lệ' });
                      }
                    } catch (err) {
                      return sendJson(500, { ok: false, error: err.message });
                    }
                  }

                  // --------------------------------------------------------------------------
                  // 5.5 API: CHỈNH SỬA THÔNG TIN MÁY ẢO
                  // --------------------------------------------------------------------------
                  if (u === '/api/rdp/edit-vm' && req.method === 'POST') {
                    if (!checkAuth(req, body)) return sendJson(401, { ok: false, error: 'Sai mật khẩu Admin' });
                    const st = loadBridgeState();
                    const mId = String(body.machine || '').trim().toLowerCase();
                    if (!mId || !st.machines || !st.machines[mId]) return sendJson(404, { ok: false, error: 'Không tìm thấy máy' });

                    const cur = st.machines[mId];
                    if (body.displayName) cur.displayName = String(body.displayName).trim();
                    if (body.gvPin) cur.gvPin = String(body.gvPin).trim().replace(/[^A-Za-z0-9]/g, '');
                    if (body.ownerId !== undefined) cur.ownerId = String(body.ownerId).trim();
                    if (body.ownerName !== undefined) cur.owner = String(body.ownerName).trim();
                    if (body.duration) cur.duration = String(body.duration).trim();
                    if (body.storageRepo) cur.storageRepo = String(body.storageRepo).trim();

                    saveBridgeState(st);
                    return sendJson(200, { ok: true, data: cur });
                  }

                  // --------------------------------------------------------------------------
                  // 5.6 API: LƯU CẤU HÌNH HỆ THỐNG (2 REPO, TOKEN, ADMIN ID)
                  // --------------------------------------------------------------------------
                  if (u === '/api/rdp/save-system-config' && req.method === 'POST') {
                    if (!checkAuth(req, body)) return sendJson(401, { ok: false, error: 'Sai mật khẩu Admin' });
                    const st = loadBridgeState();
                    st.config = st.config || {};
                    if (body.storageRepo) st.config.storageRepo = String(body.storageRepo).trim();
                    if (body.runnerRepo) st.config.runnerRepo = String(body.runnerRepo).trim();
                    if (body.token) st.config.token = String(body.token).trim();
                    if (body.rootAdmin) st.config.rootAdmin = String(body.rootAdmin).trim();
                    saveBridgeState(st);
                    return sendJson(200, { ok: true, config: st.config });
                  }


                  if (u === '/rdp-manager') {
                    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
                    const candidates = [
                      path.join(__dirname, 'rdp-manager.html'),
                      path.resolve('botcuadat-main/botcuadat-main/rdp-manager.html'),
                      path.resolve('rdp-manager.html')
                    ];
                    for (const cp of candidates) {
                      if (fs.existsSync(cp)) return res.end(fs.readFileSync(cp, 'utf8'));
                    }
                    return res.end('<h1>404 Không tìm thấy rdp-manager.html</h1>');
                  }

                  // 6. GIAO DIỆN WEB TRANG NHẬN & QUẢN LÝ FILE MÁY ẢO (/rdp-files & /rdp-receiver)
                  if (u === '/rdp-files' || u === '/rdp-receiver') {
                    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
                    return res.end(`<!DOCTYPE html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
                    <title>📥 Trang Nhận & Quản Lý File Máy Ảo (Ổ D:\\)</title>
                    <style>
                      *{box-sizing:border-box;font-family:system-ui,-apple-system,Segoe UI,sans-serif}
                      body{background:#0b1120;color:#f8fafc;margin:0;padding:20px}
                      .wrap{max-width:1200px;margin:0 auto}
                      .card{background:#1e293b;border:1px solid #334155;border-radius:12px;padding:18px;margin-bottom:18px}
                      .nav{display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap}
                      .nav a{padding:8px 16px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px;background:#1e293b;color:#94a3b8;border:1px solid #334155}
                      .nav a.act{background:#0284c7;color:#fff;border-color:#0284c7}
                      h1,h2{margin:0 0 12px 0;color:#38bdf8}
                      .dropzone{border:2px dashed #0284c7;background:#0f172a;border-radius:12px;padding:30px 20px;text-align:center;cursor:pointer;transition:.2s}
                      .dropzone:hover,.dropzone.hover{background:#1e293b;border-color:#38bdf8}
                      .stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:14px;margin-bottom:18px}
                      .stat-card{background:#0f172a;border:1px solid #334155;border-radius:10px;padding:14px;text-align:center}
                      .stat-num{font-size:26px;font-weight:700;color:#38bdf8;margin-top:4px}
                      input,button{padding:8px 12px;border-radius:8px;border:1px solid #475569;background:#0f172a;color:#fff;font-size:14px}
                      button{background:#0284c7;border:none;cursor:pointer;font-weight:600}
                      button.green{background:#10b981} button.warn{background:#d97706} button.danger{background:#dc2626} button.purple{background:#8b5cf6}
                      table{width:100%;border-collapse:collapse;margin-top:10px;font-size:13px}
                      th,td{border-bottom:1px solid #334155;padding:10px 8px;text-align:left}
                      th{color:#94a3b8;font-weight:600}
                      .badge{padding:3px 8px;border-radius:6px;font-size:11px;font-weight:600;display:inline-block}
                      code{background:#0f172a;padding:2px 6px;border-radius:4px;font-family:Consolas,monospace;font-size:12px}
                      .modal{display:none;position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,.75);backdrop-filter:blur(3px);z-index:99;align-items:center;justify-content:center;padding:20px}
                      .modal.open{display:flex}
                      .modal-box{background:#1e293b;border:1px solid #475569;border-radius:12px;max-width:850px;width:100%;max-height:85vh;display:flex;flex-direction:column;padding:18px}
                      .modal-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:12px}
                      .modal-body{overflow:auto;background:#0f172a;border-radius:8px;padding:12px;font-family:Consolas,monospace;font-size:12px;line-height:1.5;white-space:pre-wrap;word-break:break-all}
                      .toast{position:fixed;bottom:24px;right:24px;background:#10b981;color:#fff;padding:10px 18px;border-radius:8px;font-weight:600;display:none;z-index:999;box-shadow:0 4px 12px rgba(0,0,0,.3)}
                    </style></head><body><div class="wrap">
                      <div class="nav">
                        <a href="/rdp-files" class="act">📥 Trang Nhận & Quản Lý File Máy Ảo</a>
                        <a href="/rdp-manager">🎛️ Quản Lý Đa Acc Git & RDP</a>
                        <a href="/">🤖 Dashboard Bot Discord</a>
                      </div>
                      <div class="card">
                        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px">
                          <h1>📥 Trung Tâm Nhận & Quản Lý File Máy Ảo (Ổ D:\\)</h1>
                          <div>
                            Mật khẩu Admin: <input type="password" id="pass" placeholder="Nhập ADMIN_PASSWORD" onchange="savePass()">
                            <button onclick="loadFiles()">🔄 Làm mới</button>
                            <label style="margin-left:8px;font-size:13px;color:#94a3b8"><input type="checkbox" id="autoRef" checked> Tự làm mới (5s)</label>
                          </div>
                        </div>
                        <p style="margin:6px 0 0 0;color:#94a3b8;font-size:13px">Tự động nhận file tổng hợp từ ổ D:\\ của máy ảo, theo dõi IP/MK/Phiên, kiểm tra trạng thái hoạt động theo thời gian thực và tự cải thiện Auto-Prompt.</p>
                      </div>
                      <div class="card">
                        <div id="dropzone" class="dropzone" ondragover="event.preventDefault();this.classList.add('hover')" ondragleave="this.classList.remove('hover')" ondrop="handleDrop(event)" onclick="document.getElementById('fileInp').click()">
                          <div style="font-size:36px;margin-bottom:8px">📥</div>
                          <div style="font-weight:700;font-size:16px;color:#38bdf8">KÉO & THẢ FILE machine-info-*.json VÀO ĐÂY HOẶC BẤM ĐỂ CHỌN FILE</div>
                          <div style="font-size:12px;color:#94a3b8;margin-top:6px">Hỗ trợ nhận file JSON tổng hợp từ ổ D:\\, tự động nạp cấu hình máy, kiểm tra online/offline & prompt</div>
                          <input type="file" id="fileInp" accept=".json,application/json" style="display:none" onchange="handleFileSelect(this.files)">
                        </div>
                      </div>
                      <div class="stats">
                        <div class="stat-card"><div>📁 Tổng File Đã Nhận</div><div class="stat-num" id="stat_files">0</div></div>
                        <div class="stat-card"><div>🟢 Máy Đang Hoạt Động (Online)</div><div class="stat-num" id="stat_online" style="color:#10b981">0</div></div>
                        <div class="stat-card"><div>🔴 Máy Ngừng / Hết Giờ (Offline)</div><div class="stat-num" id="stat_offline" style="color:#ef4444">0</div></div>
                        <div class="stat-card"><div>⏰ Cập Nhật Lần Cuối</div><div class="stat-num" id="stat_time" style="font-size:18px;margin-top:8px">--:--:--</div></div>
                      </div>
                      <div class="card">
                        <h2>📋 Danh Sách File Thông Tin Phiên Máy Ảo Đã Nhận</h2>
                        <table id="tbl_files">
                          <thead>
                            <tr>
                              <th>Tên File / Kích thước</th>
                              <th>Máy Ảo</th>
                              <th>Mã Phiên (Session ID)</th>
                              <th>StarDesk ID / IP</th>
                              <th>User / Mật Khẩu</th>
                              <th>Trạng Thái (Heartbeat)</th>
                              <th>Thời Gian Nhận</th>
                              <th>Thao Tác</th>
                            </tr>
                          </thead>
                          <tbody><tr><td colspan="8" style="text-align:center;padding:20px;color:#94a3b8">Đang tải dữ liệu...</td></tr></tbody>
                        </table>
                      </div>
                    </div>

                    <div id="modal_view" class="modal">
                      <div class="modal-box">
                        <div class="modal-head">
                          <h3 style="margin:0;color:#38bdf8" id="m_title">📄 Chi Tiết File</h3>
                          <div>
                            <button class="green" onclick="copyModalJson()">📋 Copy JSON</button>
                            <button onclick="downloadCurFile()">⬇️ Tải Về</button>
                            <button class="danger" onclick="closeModal()">Đóng</button>
                          </div>
                        </div>
                        <pre class="modal-body" id="m_body"></pre>
                      </div>
                    </div>
                    <div id="toast" class="toast"></div>

                    <script>
                      let curFileObj = null;
                      const P = () => document.getElementById('pass').value || sessionStorage.rdp_pass || '';
                      function savePass() { sessionStorage.rdp_pass = document.getElementById('pass').value; }
                      if (sessionStorage.rdp_pass) document.getElementById('pass').value = sessionStorage.rdp_pass;

                      function showToast(msg) {
                        const t = document.getElementById('toast');
                        t.innerText = msg;
                        t.style.display = 'block';
                        clearTimeout(window._toastTimer);
                        window._toastTimer = setTimeout(() => { t.style.display = 'none'; }, 2500);
                      }

                      async function api(path, method='GET', body=null) {
                        const p = P();
                        const sep = path.includes('?') ? '&' : '?';
                        const url = path + (p ? sep + 'pass=' + encodeURIComponent(p) : '');
                        const headers = {'x-admin-password': p, 'x-bot-secret': p};
                        if (body && !(body instanceof FormData)) headers['Content-Type'] = 'application/json';
                        const res = await fetch(url, {
                          method,
                          headers: (body instanceof FormData) ? {'x-admin-password': p, 'x-bot-secret': p} : headers,
                          body: (body instanceof FormData) ? body : (body ? JSON.stringify(body) : undefined)
                        });
                        return await res.json();
                      }

                      async function handleDrop(e) {
                        e.preventDefault();
                        document.getElementById('dropzone').classList.remove('hover');
                        if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) {
                          for (const f of e.dataTransfer.files) await uploadFileObject(f);
                        }
                      }

                      async function handleFileSelect(files) {
                        if (files && files.length) {
                          for (const f of files) await uploadFileObject(f);
                        }
                      }

                      async function uploadFileObject(file) {
                        if (!file) return;
                        showToast('⏳ Đang tải lên: ' + file.name + '...');
                        const formData = new FormData();
                        formData.append('file', file, file.name);
                        formData.append('secret', P());
                        try {
                          const r = await api('/api/rdp/upload-file', 'POST', formData);
                          if (r.ok) {
                            showToast('✅ Đã nhận file ' + file.name + ' thành công!');
                            loadFiles();
                          } else {
                            showToast('❌ Lỗi: ' + (r.error || 'Nạp file thất bại'));
                          }
                        } catch (err) {
                          showToast('❌ Lỗi kết nối: ' + err.message);
                        }
                      }

                      async function loadFiles() {
                        try {
                          const res = await api('/api/rdp/files');
                          if (!res.ok) {
                            document.querySelector('#tbl_files tbody').innerHTML = '<tr><td colspan="8" style="text-align:center;color:#ef4444;padding:16px">Lỗi tải dữ liệu: ' + (res.error || 'Sai mật khẩu') + '</td></tr>';
                            return;
                          }
                          const files = res.files || [];
                          document.getElementById('stat_files').innerText = files.length;
                          const onlineCount = files.filter(f => f.isOnline).length;
                          document.getElementById('stat_online').innerText = onlineCount;
                          document.getElementById('stat_offline').innerText = files.length - onlineCount;
                          document.getElementById('stat_time').innerText = new Date().toLocaleTimeString('vi-VN');

                          if (!files.length) {
                            document.querySelector('#tbl_files tbody').innerHTML = '<tr><td colspan="8" style="text-align:center;color:#94a3b8;padding:24px">Chưa nhận được file nào từ máy ảo. Hãy chạy máy ảo hoặc kéo thả file JSON vào khu vực bên trên!</td></tr>';
                            return;
                          }

                          document.querySelector('#tbl_files tbody').innerHTML = files.map(f => {
                            const sizeKb = f.size ? (f.size / 1024).toFixed(1) + ' KB' : '-';
                            const dateStr = f.receivedAt ? new Date(f.receivedAt).toLocaleString('vi-VN') : '-';
                            const onlineBadge = f.isOnline
                              ? '<span class="badge" style="background:#065f46;color:#a7f3d0">🟢 Online</span>'
                              : '<span class="badge" style="background:#7f1d1d;color:#fecaca">🔴 Offline</span>';
                            const hbAgo = f.secondsSinceHeartbeat != null ? (f.secondsSinceHeartbeat < 60 ? f.secondsSinceHeartbeat + 's trước' : Math.floor(f.secondsSinceHeartbeat / 60) + 'm trước') : '';
                            return \`<tr>
                              <td><b>\${f.fileName}</b><br><small style="color:#94a3b8">\${sizeKb}</small></td>
                              <td><span class="badge" style="background:#1e3a8a;color:#bfdbfe">\${f.machineId}</span></td>
                              <td><code>\${f.sessionId || '-'}</code></td>
                              <td><code>\${f.ip || '-'}</code><br><small><a href="http://\${f.ip}:8080" target="_blank" style="color:#38bdf8">Web 8080</a> | <a href="https://\${f.ip}:47990" target="_blank" style="color:#fbbf24">Sunshine</a></small></td>
                              <td><code>\${f.user || 'runneradmin'}</code><br><code>\${f.pass || '***'}</code></td>
                              <td>\${onlineBadge}<br><small style="color:#94a3b8">\${hbAgo}</small></td>
                              <td><small>\${dateStr}</small></td>
                              <td>
                                <button onclick="viewFile('\${f.machineId}','\${f.fileName}')" class="purple">👁️ Xem</button>
                                <button onclick="downloadFile('\${f.machineId}','\${f.fileName}')" class="green">⬇️ Tải</button>
                                <button onclick="copyPrompt('\${f.machineId}')">📋 Prompt</button>
                                <button onclick="deleteFile('\${f.machineId}','\${f.fileName}')" class="danger">🗑️</button>
                              </td>
                            </tr>\`;
                          }).join('');
                        } catch (err) {
                          document.querySelector('#tbl_files tbody').innerHTML = '<tr><td colspan="8" style="text-align:center;color:#ef4444;padding:16px">Lỗi kết nối máy chủ: ' + err.message + '</td></tr>';
                        }
                      }

                      async function viewFile(mId, fName) {
                        const r = await api('/api/rdp/view-file?machine=' + encodeURIComponent(mId) + '&file=' + encodeURIComponent(fName));
                        if (r.ok) {
                          curFileObj = { name: r.fileName || fName, machine: mId, content: r.content };
                          document.getElementById('m_title').innerText = '📄 ' + curFileObj.name;
                          document.getElementById('m_body').innerText = typeof r.content === 'object' ? JSON.stringify(r.content, null, 2) : r.content;
                          document.getElementById('modal_view').classList.add('open');
                        } else {
                          alert('Không đọc được file: ' + (r.error || 'Thất bại'));
                        }
                      }

                      function closeModal() { document.getElementById('modal_view').classList.remove('open'); }

                      function copyModalJson() {
                        const txt = document.getElementById('m_body').innerText;
                        navigator.clipboard.writeText(txt);
                        showToast('📋 Đã copy toàn bộ JSON vào Clipboard!');
                      }

                      function downloadCurFile() {
                        if (curFileObj) downloadFile(curFileObj.machine, curFileObj.name);
                      }

                      function downloadFile(mId, fName) {
                        window.open('/api/rdp/download-file?machine=' + encodeURIComponent(mId) + '&file=' + encodeURIComponent(fName) + '&pass=' + encodeURIComponent(P()), '_blank');
                      }

                      async function copyPrompt(mId) {
                        const r = await api('/api/rdp/prompt?machine=' + encodeURIComponent(mId));
                        if (r.ok && r.prompt) {
                          navigator.clipboard.writeText(r.prompt);
                          showToast('📋 Đã copy Prompt của máy ' + mId + '!');
                        } else {
                          alert('Chưa có Prompt cho máy ' + mId);
                        }
                      }

                      async function deleteFile(mId, fName) {
                        if (!confirm('Bạn có chắc chắn muốn xóa file ' + fName + '?')) return;
                        const r = await api('/api/rdp/delete-file', 'POST', { machineId: mId, fileName: fName });
                        if (r.ok) {
                          showToast('🗑️ Đã xóa file thành công!');
                          loadFiles();
                        } else {
                          alert('Lỗi xóa: ' + (r.error || 'Thất bại'));
                        }
                      }

                      loadFiles();
                      setInterval(() => {
                        if (document.getElementById('autoRef').checked && !document.getElementById('modal_view').classList.contains('open')) {
                          loadFiles();
                        }
                      }, 5000);
                    </script></body></html>`);
                  }
                });
                return;
              }
              if (listener) return listener.call(this, req, res);
            };
            return opts ? origCreateServer.call(this, opts, wrapped) : origCreateServer.call(this, wrapped);
          };

// ============================================================================
// HỆ THỐNG ĐIỀU KHIỂN BOT DISCORD RDP & TÍCH HỢP MENU TU TIÊN CANVAS
// ============================================================================
let botCtx = null;
const rdpCooldowns = new Map();

function init(ctx) {
  botCtx = ctx;
  if (ctx && typeof ctx.log === 'function') {
    ctx.log('system', 'RDP Bridge & Bot Controller initialized');
  }

  // Tự động quét và đồng bộ kho máy ảo khi khởi động
  setTimeout(() => {
    syncAllMachinesWithGithub().catch(() => {});
  }, 2000);

  // Chu kỳ tự động đồng bộ ngầm định kỳ mỗi 60 giây
  setInterval(() => {
    const cfg = getRdpConfig();
    if (cfg.autoSync !== false) {
      syncAllMachinesWithGithub().catch(() => {});
    }
  }, 60000);
}

// ----------------- TIỆN ÍCH ĐỊNH DẠNG & MÃ PIN -----------------
const pad = n => String(n).padStart(2, '0');
const hms = sec => {
  sec = Math.max(0, Math.round(sec));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return h > 0 ? `${h}h ${pad(m)}m` : `${m}m ${pad(s)}s`;
};

function validatePin(pin) {
  if (!pin) return { ok: false, error: 'Mã PIN không được để trống.' };
  const clean = String(pin).trim();
  if (clean.length < 8 || clean.length > 16) {
    return { ok: false, error: 'Mã PIN GameViewer phải từ 8 đến 16 ký tự.' };
  }
  if (!/^[A-Za-z0-9]+$/.test(clean)) {
    return { ok: false, error: 'Mã PIN chỉ gồm chữ cái và số (không dấu hoặc ký tự đặc biệt).' };
  }
  return { ok: true, pin: clean };
}

function generateRandomPin() {
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz';
  const numbers = '23456789';
  let res = 'Ai';
  for (let i = 0; i < 4; i++) res += letters.charAt(Math.floor(Math.random() * letters.length));
  for (let i = 0; i < 4; i++) res += numbers.charAt(Math.floor(Math.random() * numbers.length));
  return res;
}

function isRootAdmin(uid, rootAdmin) {
  const ra = rootAdmin || '946662197168341053';
  return uid === ra;
}

function isUserAllowed(uid, member, cfg) {
  const ra = cfg?.rootAdmin || '946662197168341053';
  if (uid === ra) return true;
  const allowed = Array.isArray(cfg?.allowedUsers) ? cfg.allowedUsers : ['946662197168341053'];
  if (allowed.includes(uid)) return true;
  if (cfg?.allowedRoles && cfg.allowedRoles.length && member?.roles?.cache) {
    if (cfg.allowedRoles.some(r => member.roles.cache.has(r))) return true;
  }
  return false;
}

function checkRdpAccess(cmd, msg, rootAdmin) {
  const uid = msg.author.id;
  const cfg = getRdpConfig();
  if (isRootAdmin(uid, rootAdmin || cfg.rootAdmin)) return true;
  if (!isUserAllowed(uid, msg.member, cfg)) return false;
  const access = cmd.access || {};
  if (access.mode === 'staff') {
    const isOwner = msg.guild && msg.guild.ownerId === uid;
    const isAdmin = msg.member && msg.member.permissions && msg.member.permissions.has('Administrator');
    return isOwner || isAdmin;
  }
  if (access.mode === 'roles') {
    const roleIds = access.roleIds || [];
    const memberRoles = msg.member ? [...msg.member.roles.cache.keys()] : [];
    const hasRole = roleIds.some(r => memberRoles.includes(r));
    return hasRole;
  }
  return true;
}

const fill = (str, vars) => String(str || '').replace(/\{([\w.]+)\}/g, (match, key) => (key in vars ? vars[key] : match));
const okUrl = u => typeof u === 'string' && /^https?:\/\//i.test(u);

// ----------------- TẬP HỢP BIẾN THỜI GIAN THỰC CHO CANVAS -----------------
function getRdpVars(uid, extraVars = {}) {
  const d = (botCtx && typeof botCtx.db === 'function' ? botCtx.db() : null) || loadBridgeState();
  const rdp = d.rdp || loadBridgeState();
  const cfg = getRdpConfig();
  const isRoot = isRootAdmin(uid, cfg.rootAdmin);

  const allMachines = rdp.machines || {};
  let myMachineKeys = Object.keys(allMachines).filter(k => {
    const m = allMachines[k];
    if (isRoot || uid === 'any') return true;
    return m.ownerId === uid;
  });

  // Đối với Root Admin nếu chưa có máy nào gán riêng thì hiển thị toàn bộ máy server
  if (isRoot && myMachineKeys.length === 0 && Object.keys(allMachines).length > 0) {
    myMachineKeys = Object.keys(allMachines);
  }

  let onlineCount = 0;
  let offlineCount = 0;
  const cards = [];

  for (const k of myMachineKeys) {
    const m = allMachines[k];
    const isOnline = m.isOnline || m.status === 'in_progress';
    if (isOnline) onlineCount++; else offlineCount++;
    const icon = isOnline ? '🟢' : (m.status === 'in_progress' ? '⏳' : '🔴');
    const idText = m.gvId ? `\`${m.gvId}\`` : '*(Chờ cấp ID)*';
    const pinText = rdp.pinMasked !== false ? '`••••••••`' : `\`${m.gvPin || 'Aistv2026'}\``;
    const durText = m.remainSec != null ? `Còn: **${hms(m.remainSec)}**` : `Thời lượng: **${m.duration || '5h'}**`;
    cards.push(`• ${icon} **${(m.displayName || m.name || k).toUpperCase()}** │ 🆔 ID: ${idText} │ 🔑 PIN: ${pinText} │ ⏰ ${durText}`);
  }

  const curKey = (rdp.selectedVm && rdp.selectedVm[uid]) || myMachineKeys[0] || (isRoot ? Object.keys(allMachines)[0] : '') || '';
  const curM = allMachines[curKey] || {};

  const vars = {
    onlineCount,
    offlineCount,
    totalCount: myMachineKeys.length,
    runnerRepo: cfg.runnerRepo,
    storageRepo: cfg.storageRepo,
    machineList: cards.length ? cards.join('\n') : '*(Bạn chưa sở hữu máy ảo nào. Hãy bấm ➕ Tạo Máy Mới để bắt đầu!)*',
    pinMode: rdp.pinMasked !== false ? '🙈 Đang ẩn (An toàn)' : '👁️ Đang hiện (Công khai)',
    user: uid && uid !== 'any' ? `<@${uid}>` : 'Người dùng',
    webUrl: `http://${process.env.DUCKDNS_DOMAIN || cfg.duckdnsDomain || 'datdemo.duckdns.org'}:${process.env.PORT || '3000'}/rdp-manager`,
    curMachineId: curM.name || curKey || 'none',
    curDisplayName: (curM.displayName || curM.name || curKey || 'Chưa chọn máy').toUpperCase(),
    curStatusBadge: curM.isOnline ? '🟢 Online' : (curM.status === 'in_progress' ? '⏳ Đang khởi động' : '🔴 Offline'),
    curGvId: curM.gvId || '(Chờ cấp ID)',
    curDisplayPin: rdp.pinMasked !== false ? '••••••••' : (curM.gvPin || 'Aistv2026'),
    curStardeskId: curM.stardeskId || '-',
    curUser: 'runneradmin',
    curPass: curM.pass || curM.gvPin || 'Aistv@2026',
    curRemain: curM.remainSec != null ? hms(curM.remainSec) : (curM.duration || '5h00m'),
    curOwner: curM.ownerId ? `<@${curM.ownerId}>` : (curM.owner || 'Chưa gán'),
    curAutoPrompt: curM.autoPrompt || `[MÁY: ${(curM.displayName || curM.name || curKey).toUpperCase()}] Trạng thái: ${curM.isOnline ? '🟢 Online' : '🔴 Offline'} | GameViewer ID: ${curM.gvId || 'Chưa có'} | PIN: ${curM.gvPin || 'Aistv2026'} | StarDesk: ${curM.stardeskId || '-'}`,
    ...extraVars
  };
  return vars;
}

// ----------------- KIỂM TRA ĐIỀU KIỆN HIỂN THỊ NÚT BẤM -----------------
function checkButtonCondition(b, vars, uid) {
  if (!b) return true;
  const rawCond = (b.condition === 'custom' && b.conditionExpr) ? b.conditionExpr : (b.condition || 'always');
  if (!rawCond || rawCond === 'always' || rawCond === '') return true;
  const cfg = getRdpConfig();
  const isRoot = isRootAdmin(uid, cfg.rootAdmin);
  const cond = String(rawCond).toLowerCase().trim();

  if (cond === 'online_only') {
    return vars.onlineCount > 0 || (vars.curStatusBadge && vars.curStatusBadge.includes('🟢'));
  }
  if (cond === 'offline_only') {
    return vars.offlineCount > 0 || (vars.curStatusBadge && (vars.curStatusBadge.includes('🔴') || vars.curStatusBadge.includes('Đã tắt')));
  }
  if (cond === 'admin_only') {
    return isRoot;
  }
  if (cond === 'owner_only') {
    return isRoot || (vars.curOwner && vars.curOwner.includes(uid));
  }
  if (cond === 'has_vm') {
    return (vars.totalCount || 0) > 0;
  }
  if (cond === 'no_vm') {
    return (vars.totalCount || 0) === 0;
  }
  if (cond === 'has_gvid') {
    return vars.curGvId && !vars.curGvId.includes('Chờ') && !vars.curGvId.includes('none');
  }

  if (rawCond.includes('{') || rawCond.includes('==') || rawCond.includes('!=') || rawCond.includes('>')) {
    try {
      const filled = fill(rawCond, vars);
      if (filled.includes('==')) {
        const [left, right] = filled.split('==').map(s => s.trim().replace(/^['"]|['"]$/g, ''));
        return left === right;
      }
      if (filled.includes('!=')) {
        const [left, right] = filled.split('!=').map(s => s.trim().replace(/^['"]|['"]$/g, ''));
        return left !== right;
      }
      if (filled.includes('>')) {
        const [left, right] = filled.split('>').map(s => parseFloat(s.trim()));
        return left > right;
      }
    } catch {}
  }

  return true;
}

// ----------------- TẠO PAYLOAD DISCORD EMBED & NÚT TỪ MENU -----------------
function buildRdpPayload(menu, vars, uid) {
  const D = require('discord.js');
  const o = {};
  if (menu.content) o.content = fill(menu.content, vars).slice(0, 2000);
  const e = menu.embed;
  if (e && e.enabled !== false) {
    const rawCol = (e.color || '#8b5cf6').replace('#', '');
    const colNum = parseInt(rawCol, 16) || 0x8b5cf6;
    const eb = new D.EmbedBuilder().setColor(colNum);
    const t = fill(e.title, vars).slice(0, 256);
    const d = fill(e.description, vars).slice(0, 4000);
    if (t) eb.setTitle(t);
    if (d) eb.setDescription(d);
    if (okUrl(e.url) && t) eb.setURL(e.url);
    if (okUrl(fill(e.thumbnail, vars))) eb.setThumbnail(fill(e.thumbnail, vars));
    if (okUrl(fill(e.image, vars))) eb.setImage(fill(e.image, vars));
    const an = fill(e.author?.name, vars).slice(0, 256);
    if (an) eb.setAuthor({ name: an, iconURL: okUrl(e.author?.icon) ? e.author.icon : undefined });
    const ft = fill(e.footer?.text, vars).slice(0, 2048);
    if (ft) eb.setFooter({ text: ft, iconURL: okUrl(e.footer?.icon) ? e.footer.icon : undefined });
    if (e.timestamp) eb.setTimestamp();
    const fsList = (e.fields || []).map(f => ({
      name: fill(f.name, vars).slice(0, 256) || '\u200b',
      value: fill(f.value, vars).slice(0, 1024) || '\u200b',
      inline: !!f.inline
    })).slice(0, 25);
    if (fsList.length) eb.addFields(fsList);
    if (t || d || fsList.length || ft || an) o.embeds = [eb];
  }

  const SM = {
    primary: D.ButtonStyle.Primary,
    secondary: D.ButtonStyle.Secondary,
    success: D.ButtonStyle.Success,
    danger: D.ButtonStyle.Danger,
    link: D.ButtonStyle.Link
  };

  const rows = [];

  // NẾU LÀ MENU CHÍNH 'main': TỰ ĐỘNG CHÈN NÚT VÀ SELECT MENU CHO CÁC MÁY SỞ HỮU CỦA USER
  if (menu.id === 'main') {
    const d = (botCtx && typeof botCtx.db === 'function' ? botCtx.db() : null) || loadBridgeState();
    const rdp = d.rdp || (d.shared && d.shared.rdp) || d;
    const cfg = getRdpConfig();
    const isRoot = isRootAdmin(uid, cfg.rootAdmin);
    const allMachines = rdp.machines || {};
    let myKeys = Object.keys(allMachines).filter(k => {
      if (isRoot || uid === 'any') return true;
      return allMachines[k].ownerId === uid;
    });
    if (isRoot && myKeys.length === 0 && Object.keys(allMachines).length > 0) {
      myKeys = Object.keys(allMachines);
    }

    if (myKeys.length > 0) {
      const btnRow = [];
      const topKeys = myKeys.slice(0, 5);
      for (const k of topKeys) {
        const m = allMachines[k] || {};
        const isOnline = m.isOnline || m.status === 'in_progress';
        const icon = isOnline ? '🟢' : (m.status === 'in_progress' ? '⏳' : '🔴');
        const dName = (m.displayName || m.name || k).toUpperCase().slice(0, 20);
        const bb = new D.ButtonBuilder()
          .setCustomId(`rdp:select_vm:${k}:${uid}`.slice(0, 100))
          .setLabel(dName)
          .setEmoji(icon)
          .setStyle(isOnline ? D.ButtonStyle.Success : D.ButtonStyle.Secondary);
        btnRow.push(bb);
      }
      if (btnRow.length) rows.push(new D.ActionRowBuilder().addComponents(btnRow));

      if (myKeys.length > 5) {
        const selectMenu = new D.StringSelectMenuBuilder()
          .setCustomId(`rdp:select_vm_menu:${uid}`.slice(0, 100))
          .setPlaceholder('🖥️ Chọn máy ảo để xem chi tiết & điều khiển...');
        const opts = myKeys.slice(0, 25).map(k => {
          const m = allMachines[k] || {};
          const isOnline = m.isOnline || m.status === 'in_progress';
          return {
            label: (m.displayName || m.name || k).toUpperCase().slice(0, 50),
            value: k,
            description: `GV: ${m.gvId || 'Chờ cấp ID'} | PIN: ${rdp.pinMasked !== false ? '••••••••' : (m.gvPin || 'Aistv2026')} | ${isOnline ? 'Online' : 'Offline'}`.slice(0, 100),
            emoji: isOnline ? '🟢' : '🔴'
          };
        });
        selectMenu.addOptions(opts);
        rows.push(new D.ActionRowBuilder().addComponents(selectMenu));
      }
    }
  }

  (menu.rows || []).forEach((row, ri) => {
    const comps = [];
    row.forEach((b, ci) => {
      try {
        if (!checkButtonCondition(b, vars, uid)) return;
        const bb = new D.ButtonBuilder();
        const label = fill(b.label, vars).slice(0, 80);
        if (label) bb.setLabel(label);
        if (b.emoji) bb.setEmoji(b.emoji.trim());
        if (!label && !b.emoji) return;
        if (b.disabled) bb.setDisabled(true);
        const isLink = b.style === 'link' || b.action?.type === 'link' || (Array.isArray(b.actions) && b.actions.some(a => a.type === 'link'));
        if (isLink) {
          const linkAct = (Array.isArray(b.actions) && b.actions.find(a => a.type === 'link')) || b.action;
          const u = fill(linkAct?.value, vars);
          if (!okUrl(u)) return;
          bb.setStyle(D.ButtonStyle.Link).setURL(u);
        } else {
          bb.setStyle(SM[b.style] || D.ButtonStyle.Secondary)
            .setCustomId(`rdp:${menu.id}:${ri}:${ci}:${uid}`.slice(0, 100));
        }
        comps.push(bb);
      } catch {}
    });
    if (comps.length) rows.push(new D.ActionRowBuilder().addComponents(comps));
  });
  if (rows.length) o.components = rows;
  if (!o.content && !o.embeds) o.content = '\u200b';
  return o;
}

// ----------------- TẠO MÁY WORKFLOW MỚI -----------------
async function createMachineWorkflow(name, duration, pin, uid, displayName, ownerName) {
  const st = loadBridgeState();
  const cfg = getRdpConfig();

  const cleanName = getNextMachineId(st, name);
  const cleanPin = (pin ? String(pin).trim() : 'Aistv2026').replace(/[^A-Za-z0-9]/g, '') || 'Aistv2026';
  const cleanDur = normalizeDuration(duration);
  const cleanDisplayName = displayName || `Máy ${cleanName.toUpperCase()}`;
  const realOwner = ownerName || (displayName && !displayName.startsWith('Máy ') ? displayName : 'Admin');

  let tpl = loadTaomayTemplate();
  if (!tpl) {
    try {
      const f = await ghRequest('GET', cfg.storageRepo, '/contents/taomay.yml', null, cfg.token);
      if (f && f.content) tpl = Buffer.from(f.content.replace(/\s+/g, ''), 'base64').toString('utf8');
    } catch {}
  }
  if (!tpl) throw new Error('Không tìm thấy file mẫu taomay.yml');

  const wfContent = buildVmWorkflow(tpl, cleanName, cleanDur, cleanPin, cfg.storageRepo);
  const filePath = `.github/workflows/${cleanName}.yml`;

  let sha = undefined;
  try {
    const cur = await ghRequest('GET', cfg.runnerRepo, `/contents/${filePath}`, null, cfg.token);
    if (cur && cur.sha) sha = cur.sha;
  } catch {}

  await ghRequest('PUT', cfg.runnerRepo, `/contents/${filePath}`, {
    message: `[AISTV] Tạo máy ảo ${cleanName} (${cleanDur}, PIN: ${cleanPin})`,
    content: Buffer.from(wfContent, 'utf8').toString('base64'),
    sha
  }, cfg.token);

  await new Promise(r => setTimeout(r, 1500));

  await dispatchWorkflow(cfg.runnerRepo, `${cleanName}.yml`, {
    machine_id: cleanName,
    display_name: cleanDisplayName,
    duration: cleanDur,
    pin_code: cleanPin,
    storage_repo: cfg.storageRepo
  }, cfg.token);

  st.machines = st.machines || {};
  st.machines[cleanName] = {
    name: cleanName,
    displayName: cleanDisplayName,
    duration: cleanDur,
    gvPin: cleanPin,
    ownerId: uid || '',
    owner: realOwner,
    storageRepo: cfg.storageRepo,
    repo: cfg.runnerRepo,
    status: 'in_progress',
    isOnline: true,
    isLatestTemplate: true,
    created: Date.now(),
    startedAt: Date.now()
  };
  saveBridgeState(st);
  return st.machines[cleanName];
}

// ----------------- KHỞI ĐỘNG LẠI MÁY -----------------
async function restartMachineWorkflow(name) {
  const st = loadBridgeState();
  const cfg = getRdpConfig();
  const m = (st.machines || {})[name];
  await cancelWorkflowRuns(cfg.runnerRepo, `${name}.yml`, cfg.token);
  await new Promise(r => setTimeout(r, 2000));
  await dispatchWorkflow(cfg.runnerRepo, `${name}.yml`, {
    machine_id: name,
    display_name: (m && m.displayName) || `Máy ${String(name).toUpperCase()}`,
    duration: normalizeDuration(m && m.duration),
    pin_code: (m && m.gvPin) || 'Aistv2026',
    storage_repo: cfg.storageRepo
  }, cfg.token);
  if (m) {
    m.status = 'in_progress';
    m.isOnline = true;
    m.startedAt = Date.now();
  }
  saveBridgeState(st);
}

// ----------------- TẮT MÁY -----------------
async function stopMachineWorkflow(name) {
  const st = loadBridgeState();
  const cfg = getRdpConfig();
  const m = (st.machines || {})[name];
  await cancelWorkflowRuns(cfg.runnerRepo, `${name}.yml`, cfg.token);
  if (m) {
    m.status = 'completed';
    m.isOnline = false;
  }
  saveBridgeState(st);
}

// ----------------- XÓA Ổ ĐĨA & DỮ LIỆU LƯU TRỮ TRÊN STORAGE REPO -----------------
async function deleteMachineDisk(name) {
  const cfg = getRdpConfig();
  const cleanId = String(name || '').toLowerCase().replace(/[^a-z0-9\-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  if (!cleanId) throw new Error('Tên định danh máy không hợp lệ');

  const relTag = `aistv-storage-${cleanId}`;
  const stateBranch = `aistv-state-${cleanId}`;
  const details = { releaseDeleted: false, tagDeleted: false, branchDeleted: false };

  // 1. Tìm và xóa Release trên storageRepo
  try {
    const rel = await ghRequest('GET', cfg.storageRepo, `/releases/tags/${relTag}`, null, cfg.token);
    if (rel && rel.id) {
      await ghRequest('DELETE', cfg.storageRepo, `/releases/${rel.id}`, null, cfg.token);
      details.releaseDeleted = true;
    }
  } catch (e) {}

  // 2. Xóa Git Tag trên storageRepo
  try {
    await ghRequest('DELETE', cfg.storageRepo, `/git/refs/tags/${relTag}`, null, cfg.token);
    details.tagDeleted = true;
  } catch (e) {}

  // 3. Xóa Git State Branch trên storageRepo
  try {
    await ghRequest('DELETE', cfg.storageRepo, `/git/refs/heads/${stateBranch}`, null, cfg.token);
    details.branchDeleted = true;
  } catch (e) {}

  // 4. Xóa session file cục bộ nếu có
  const localCandidates = [
    path.join(process.cwd(), 'sessions', cleanId),
    path.join(process.cwd(), 'sessions', `${cleanId}.json`),
    path.join(process.cwd(), 'temp', cleanId)
  ];
  for (const lp of localCandidates) {
    try {
      if (fs.existsSync(lp)) {
        const stat = fs.statSync(lp);
        if (stat.isDirectory()) fs.rmSync(lp, { recursive: true, force: true });
        else fs.unlinkSync(lp);
      }
    } catch {}
  }

  // 5. Cập nhật state máy trong RAM
  const d = (botCtx && typeof botCtx.db === 'function' ? botCtx.db() : null) || loadBridgeState();
  const rdp = d.rdp || (d.shared && d.shared.rdp) || d;
  if (rdp && rdp.machines && rdp.machines[cleanId]) {
    rdp.machines[cleanId].gvId = null;
    rdp.machines[cleanId].stardeskId = null;
    rdp.machines[cleanId].status = 'Stopped';
    rdp.machines[cleanId].isOnline = false;
    saveBridgeState(rdp);
    if (botCtx && typeof botCtx.saveSoon === 'function') botCtx.saveSoon();
  }

  return {
    ok: true,
    machineId: cleanId,
    storageRepo: cfg.storageRepo,
    relTag,
    stateBranch,
    details,
    message: `Đã xóa ổ đĩa (${relTag}) và dữ liệu trạng thái (${stateBranch}) trên kho lưu trữ ${cfg.storageRepo}!`
  };
}

// ----------------- XÓA TOÀN BỘ MÁY ẢO (WORKFLOW + Ổ ĐĨA) -----------------
async function deleteMachineFull(name) {
  const cfg = getRdpConfig();
  const cleanId = String(name || '').toLowerCase().replace(/[^a-z0-9\-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  if (!cleanId) throw new Error('Tên định danh máy không hợp lệ');

  // 1. Dừng workflow nếu đang chạy
  await cancelWorkflowRuns(cfg.runnerRepo, `${cleanId}.yml`, cfg.token).catch(() => {});

  // 2. Xóa file workflow .github/workflows/<machine>.yml trên runnerRepo
  try {
    const curF = await ghRequest('GET', cfg.runnerRepo, `/contents/.github/workflows/${cleanId}.yml`, null, cfg.token);
    if (curF && curF.sha) {
      await ghRequest('DELETE', cfg.runnerRepo, `/contents/.github/workflows/${cleanId}.yml`, {
        message: `[AISTV] Xóa hoàn toàn máy ảo ${cleanId}`,
        sha: curF.sha
      }, cfg.token);
    }
  } catch (e) {}

  // 3. Xóa ổ đĩa và state trên storageRepo
  const diskRes = await deleteMachineDisk(cleanId).catch(() => ({ ok: false }));

  // 4. Xóa khỏi RAM và database
  const d = (botCtx && typeof botCtx.db === 'function' ? botCtx.db() : null) || loadBridgeState();
  const rdp = d.rdp || (d.shared && d.shared.rdp) || d;
  if (rdp && rdp.machines) {
    delete rdp.machines[cleanId];
  }
  if (rdp && rdp.selectedVm) {
    for (const u of Object.keys(rdp.selectedVm)) {
      if (rdp.selectedVm[u] === cleanId) delete rdp.selectedVm[u];
    }
  }
  saveBridgeState(rdp);
  if (botCtx && typeof botCtx.saveSoon === 'function') botCtx.saveSoon();

  return {
    ok: true,
    machineId: cleanId,
    diskRes,
    message: `Đã xóa hoàn toàn máy ảo [${cleanId}] gồm workflow trên ${cfg.runnerRepo} và ổ đĩa trên ${cfg.storageRepo}!`
  };
}

// ----------------- QUÉT VÀ NÂNG CẤP WORKFLOW TRỰC TIẾP -----------------
async function scanAndRebuildWorkflowsDirect(upgradeToLatest = false) {
  const st = loadBridgeState();
  const cfg = getRdpConfig();
  st.machines = st.machines || {};

  const contents = await ghRequest('GET', cfg.runnerRepo, '/contents/.github/workflows', null, cfg.token);
  if (!Array.isArray(contents)) return { totalFiles: 0, scannedCount: 0, upgradedCount: 0, machines: [] };

  const ymlFiles = contents.filter(f => f.type === 'file' && /\.(ya?ml)$/i.test(f.name));
  const ignored = ['taomay.yml', 'taomay.yaml', 'taomaygoc.yml', 'bot.yml', 'botcuadat.yml'];
  const machineFiles = ymlFiles.filter(f => !ignored.includes(f.name.toLowerCase()));

  let upgradedCount = 0;
  let tpl = null;
  if (upgradeToLatest) tpl = loadTaomayTemplate();

  const list = [];
  for (const f of machineFiles) {
    try {
      const fDetail = await ghRequest('GET', cfg.runnerRepo, `/contents/${f.path}`, null, cfg.token);
      if (!fDetail || !fDetail.content) continue;
      const rawYml = Buffer.from(fDetail.content.replace(/\s+/g, ''), 'base64').toString('utf8');

      const idM = rawYml.match(/machine_id:[\s\S]*?default:\s*['"]([^'"]+)['"]/i);
      const nameM = rawYml.match(/display_name:[\s\S]*?default:\s*['"]([^'"]+)['"]/i);
      const durM = rawYml.match(/duration:[\s\S]*?default:\s*['"]([^'"]+)['"]/i);
      const pinM = rawYml.match(/(?:pin_code|fixed_password):[\s\S]*?default:\s*['"]([^'"]+)['"]/i);
      const storageM = rawYml.match(/storage_repo:[\s\S]*?default:\s*['"]([^'"]+)['"]/i);

      const fileBaseId = f.name.replace(/\.(ya?ml)$/i, '').toLowerCase();
      const mId = fileBaseId;
      const dName = (nameM && nameM[1]) || `Máy ${mId}`;
      const dur = (durM && durM[1]) || '5h00m';
      const pin = (pinM && pinM[1]) || 'Aistv2026';
      const stRepo = (storageM && storageM[1]) || cfg.storageRepo;

      const isLatest = rawYml.includes('uuyc_4.43.1.exe') && rawYml.includes('ProtectedData::Protect') && rawYml.includes('StarDesk_1.5.3.exe');

      const cur = st.machines[mId] = st.machines[mId] || { name: mId, created: Date.now() };
      cur.name = mId;
      cur.displayName = dName;
      cur.duration = dur;
      cur.gvPin = pin;
      cur.storageRepo = stRepo;
      cur.repo = cfg.runnerRepo;
      cur.isLatestTemplate = isLatest;

      if (upgradeToLatest && tpl && !isLatest) {
        const newContent = buildVmWorkflow(tpl, mId, dur, pin, stRepo);
        await ghRequest('PUT', cfg.runnerRepo, `/contents/${f.path}`, {
          message: `[AISTV] Tự động nâng cấp workflow máy ${mId} (GameViewer 4.43.1 + StarDesk 1.5.3 + DPAPI)`,
          content: Buffer.from(newContent, 'utf8').toString('base64'),
          sha: fDetail.sha
        }, cfg.token);
        cur.isLatestTemplate = true;
        upgradedCount++;
        await new Promise(r => setTimeout(r, 800));
      }

      list.push(cur);
    } catch {}
  }
  saveBridgeState(st);
  return { totalFiles: ymlFiles.length, scannedCount: list.length, upgradedCount, machines: list };
}

// ----------------- ĐỒNG BỘ TRẠNG THÁI MÁY TỪ RUNNER REPO & STORAGE REPO -----------------
async function syncAllMachinesWithGithub() {
  const d = (botCtx && typeof botCtx.db === 'function' ? botCtx.db() : null) || loadBridgeState();
  const st = d.rdp || (d.shared && d.shared.rdp) || d;
  const cfg = getRdpConfig();
  st.machines = st.machines || {};

  // 1. Quét toàn bộ tệp workflow trên Runner Repo để nhận diện các máy ảo
  try {
    const contents = await ghRequest('GET', cfg.runnerRepo, '/contents/.github/workflows', null, cfg.token);
    if (Array.isArray(contents)) {
      const ignored = ['taomay.yml', 'taomay.yaml', 'taomaygoc.yml', 'bot.yml', 'botcuadat.yml'];
      const ymlFiles = contents.filter(f => f.type === 'file' && /\.(ya?ml)$/i.test(f.name) && !ignored.includes(f.name.toLowerCase()));

      for (const f of ymlFiles) {
        const mId = f.name.replace(/\.(ya?ml)$/i, '').toLowerCase();
        if (!st.machines[mId]) {
          st.machines[mId] = {
            name: mId,
            displayName: `Máy ${mId.toUpperCase()}`,
            duration: '5h00m',
            gvPin: 'Aistv2026',
            created: Date.now(),
            repo: cfg.runnerRepo,
            storageRepo: cfg.storageRepo
          };
        }
      }
    }
  } catch (err) {
    if (botCtx && typeof botCtx.log === 'function') botCtx.log('warn', `syncAllMachines scan workflows: ${err.message}`);
  }

  // 2. Quét toàn bộ Actions runs đang chạy hoặc mới nhất trên Runner Repo
  try {
    const runsRes = await ghRequest('GET', cfg.runnerRepo, '/actions/runs?per_page=30', null, cfg.token);
    if (runsRes && Array.isArray(runsRes.workflow_runs)) {
      for (const r of runsRes.workflow_runs) {
        const wfName = (r.path || '').replace('.github/workflows/', '').replace(/\.(ya?ml)$/i, '').toLowerCase();
        if (st.machines[wfName]) {
          const m = st.machines[wfName];
          if (!m.runId || r.id >= m.runId) {
            m.runId = r.id;
            m.status = r.status;
            m.conclusion = r.conclusion;
            m.runUrl = r.html_url;
            m.isOnline = (r.status === 'in_progress');
            if (r.run_started_at) {
              const started = new Date(r.run_started_at).getTime();
              m.elapsedSec = Math.max(0, Math.floor((Date.now() - started) / 1000));
              const totalSec = (m.duration && m.duration.includes('1h')) ? 3600 : ((m.duration && m.duration.includes('3h')) ? 10800 : 18000);
              m.remainSec = Math.max(0, totalSec - m.elapsedSec);
            }
          }
        }
      }
    }
  } catch (err) {
    if (botCtx && typeof botCtx.log === 'function') botCtx.log('warn', `syncAllMachines runs: ${err.message}`);
  }

  // 3. Đồng bộ status.json & ip.txt từ nhánh aistv-state-* trên Storage Repo
  for (const name of Object.keys(st.machines)) {
    const m = st.machines[name];
    try {
      const statusRes = await ghRequest('GET', cfg.storageRepo, `/contents/status.json?ref=aistv-state-${name}`, null, cfg.token);
      if (statusRes && statusRes.content) {
        const rawJson = Buffer.from(statusRes.content.replace(/\s+/g, ''), 'base64').toString('utf8');
        const stateObj = JSON.parse(rawJson);
        if (stateObj.gameviewerId || stateObj.gvId) m.gvId = stateObj.gameviewerId || stateObj.gvId;
        if (stateObj.gameviewerPin || stateObj.gvPin) m.gvPin = stateObj.gameviewerPin || stateObj.gvPin;
        if (stateObj.stardeskId) m.stardeskId = stateObj.stardeskId;
        if (stateObj.duration) m.duration = stateObj.duration;
        if (stateObj.status) {
          if (stateObj.status.toLowerCase() === 'online') m.isOnline = true;
          else if (stateObj.status.toLowerCase() === 'stopped') m.isOnline = false;
        }
      }
    } catch {}
  }

  saveBridgeState(st);
  if (botCtx && typeof botCtx.saveNow === 'function') botCtx.saveNow();
  return st.machines;
}

// ----------------- XỬ LÝ SỰ KIỆN TIN NHẮN (LỆNH BOT !may) -----------------
async function onMessage(msg) {
  if (msg.author.bot) return false;
  const d = (botCtx && typeof botCtx.db === 'function' ? botCtx.db() : null) || loadBridgeState();
  const rdp = d.rdp || (d.shared && d.shared.rdp) || d;
  if (!rdp || !Array.isArray(rdp.commands)) return false;

  const text = (msg.content || '').trim();
  if (!text) return false;

  const trimmed = text.trim();
  const lower = trimmed.toLowerCase();
  const uid = msg.author.id;
  const cfg = getRdpConfig();

  // 1. CÁC LỆNH PHÂN QUYỀN HỆ THỐNG DO ADMIN TỐI CAO 946662197168341053 ĐIỀU HÀNH
  if (lower.startsWith('!may capquyen') || lower.startsWith('!may grant')) {
    if (!isRootAdmin(uid, cfg.rootAdmin)) {
      await msg.reply('🚫 Chỉ có Admin Tối Cao (`946662197168341053`) mới có quyền cấp quyền sử dụng hệ thống máy ảo!').catch(() => {});
      return true;
    }
    const match = text.match(/<@!?(\d+)>|(\d{17,20})/);
    const targetUid = match ? (match[1] || match[2]) : null;
    if (!targetUid) {
      await msg.reply('⚠️ Vui lòng tag người dùng hoặc nhập Discord ID, ví dụ: `!may capquyen @user` hoặc `!may capquyen 123456789012345678`').catch(() => {});
      return true;
    }
    rdp.config = rdp.config || {};
    rdp.config.allowedUsers = Array.isArray(rdp.config.allowedUsers) ? rdp.config.allowedUsers : ['946662197168341053'];
    if (!rdp.config.allowedUsers.includes(targetUid)) {
      rdp.config.allowedUsers.push(targetUid);
    }
    saveBridgeState(rdp);
    if (botCtx && typeof botCtx.saveNow === 'function') botCtx.saveNow();
    await msg.reply(`✅ **ĐÃ CẤP QUYỀN THÀNH CÔNG!**\n• Người dùng: <@${targetUid}> (\`${targetUid}\`)\n• Hiện tại đã có thể sử dụng các lệnh \`!may\` và điều khiển máy ảo.`).catch(() => {});
    return true;
  }

  if (lower.startsWith('!may thuhoi') || lower.startsWith('!may revoke')) {
    if (!isRootAdmin(uid, cfg.rootAdmin)) {
      await msg.reply('🚫 Chỉ có Admin Tối Cao (`946662197168341053`) mới có quyền thu hồi quyền sử dụng máy ảo!').catch(() => {});
      return true;
    }
    const match = text.match(/<@!?(\d+)>|(\d{17,20})/);
    const targetUid = match ? (match[1] || match[2]) : null;
    if (!targetUid) {
      await msg.reply('⚠️ Vui lòng tag người dùng hoặc nhập Discord ID, ví dụ: `!may thuhoi @user`').catch(() => {});
      return true;
    }
    if (targetUid === cfg.rootAdmin || targetUid === '946662197168341053') {
      await msg.reply('❌ Không thể thu hồi quyền của Admin Tối Cao!').catch(() => {});
      return true;
    }
    rdp.config = rdp.config || {};
    rdp.config.allowedUsers = (Array.isArray(rdp.config.allowedUsers) ? rdp.config.allowedUsers : ['946662197168341053']).filter(u => u !== targetUid);
    saveBridgeState(rdp);
    if (botCtx && typeof botCtx.saveNow === 'function') botCtx.saveNow();
    await msg.reply(`🗑️ **ĐÃ THU HỒI QUYỀN!**\n• Người dùng <@${targetUid}> (\`${targetUid}\`) đã bị ngắt quyền sử dụng hệ thống máy ảo.`).catch(() => {});
    return true;
  }

  if (lower.startsWith('!may dsquyen') || lower.startsWith('!may listquyen')) {
    if (!isUserAllowed(uid, msg.member, cfg)) {
      await msg.reply(`⛔ Bạn chưa được cấp quyền sử dụng hệ thống máy ảo! Hãy liên hệ Admin tối cao (<@${cfg.rootAdmin}>).`).catch(() => {});
      return true;
    }
    const allowed = Array.isArray(cfg.allowedUsers) ? cfg.allowedUsers : ['946662197168341053'];
    const roles = Array.isArray(cfg.allowedRoles) ? cfg.allowedRoles : [];
    const userLines = allowed.map((u, idx) => `  ${idx + 1}. <@${u}> (\`${u}\`)${u === cfg.rootAdmin ? ' 👑 *(Root Admin)*' : ''}`).join('\n');
    const roleLines = roles.length ? roles.map((r, idx) => `  ${idx + 1}. <@&${r}> (\`${r}\`)`).join('\n') : '  *(Không có role nào)*';

    const rep = [
      '🛡️ **DANH SÁCH QUYỀN SỬ DỤNG HỆ THỐNG MÁY ẢO**',
      '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
      '👑 **Admin Tối Cao:** <@' + cfg.rootAdmin + '>',
      '',
      '👤 **Danh Sách Người Dùng Được Phép:**',
      userLines || '  *(Chưa có user nào)*',
      '',
      '🏷️ **Vai Trò Được Phép:**',
      roleLines,
      '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
      '💡 *Dùng `!may capquyen @user` hoặc `!may thuhoi @user` để quản trị!*'
    ].join('\n');
    await msg.reply(rep).catch(() => {});
    return true;
  }

  // 1c. LỆNH XÓA Ổ ĐĨA & XÓA MÁY
  if (lower.startsWith('!may xoao') || lower.startsWith('!may reset') || lower.startsWith('!may xoao-dia')) {
    const args = text.replace(/^!may\s+(xoao|reset|xoao-dia)\s*/i, '').trim().split(/\s+/).filter(Boolean);
    const mName = args[0];
    if (!mName) {
      await msg.reply('⚠️ Cú pháp: `!may xoao <tên_máy>`\nVí dụ: `!may xoao dat`\n*Lệnh này sẽ xóa ổ đĩa lưu trữ VHDX trên GitHub Release để máy tạo ổ mới tinh khi chạy lại.*').catch(() => {});
      return true;
    }
    const d = (botCtx && typeof botCtx.db === 'function' ? botCtx.db() : null) || loadBridgeState();
    const rdp = d.rdp || (d.shared && d.shared.rdp) || d;
    const m = (rdp.machines || {})[mName.toLowerCase()];
    if (!isRootAdmin(uid, cfg.rootAdmin) && (!m || m.ownerId !== uid)) {
      await msg.reply('🚫 Bạn không có quyền xóa ổ đĩa máy này vì không phải chủ sở hữu hay Admin!').catch(() => {});
      return true;
    }
    const waitMsg = await msg.reply(`⏳ Đang xóa ổ đĩa và dữ liệu máy **${mName.toUpperCase()}** trên Repo Gốc \`${cfg.storageRepo}\`...`).catch(() => {});
    try {
      const res = await deleteMachineDisk(mName);
      if (waitMsg && waitMsg.edit) {
        await waitMsg.edit(`💽 **ĐÃ XÓA Ổ ĐĨA MÁY [${mName.toUpperCase()}] THÀNH CÔNG!**\n• Kho lưu: \`${res.storageRepo}\`\n• Release tag: \`${res.relTag}\`\n• State branch: \`${res.stateBranch}\`\n✨ Lần tiếp theo khi máy bật lại, hệ thống sẽ tự động tạo ổ đĩa mới tinh!`).catch(() => {});
      }
    } catch (e) {
      if (waitMsg && waitMsg.edit) await waitMsg.edit(`❌ Lỗi khi xóa ổ: ${e.message}`).catch(() => {});
    }
    return true;
  }

  if (lower.startsWith('!may xoamay') || lower.startsWith('!may xoa') || lower.startsWith('!may delete')) {
    const args = text.replace(/^!may\s+(xoamay|xoa|delete)\s*/i, '').trim().split(/\s+/).filter(Boolean);
    const mName = args[0];
    if (!mName) {
      await msg.reply('⚠️ Cú pháp: `!may xoa <tên_máy>`\nVí dụ: `!may xoa dat`\n*Lệnh này sẽ xóa hoàn toàn máy ảo (hủy runner, xóa workflow yml và dọn sạch ổ đĩa lưu trữ).*').catch(() => {});
      return true;
    }
    const d = (botCtx && typeof botCtx.db === 'function' ? botCtx.db() : null) || loadBridgeState();
    const rdp = d.rdp || (d.shared && d.shared.rdp) || d;
    const m = (rdp.machines || {})[mName.toLowerCase()];
    if (!isRootAdmin(uid, cfg.rootAdmin) && (!m || m.ownerId !== uid)) {
      await msg.reply('🚫 Bạn không có quyền xóa máy này vì không phải chủ sở hữu hay Admin!').catch(() => {});
      return true;
    }
    const waitMsg = await msg.reply(`⏳ Đang xóa hoàn toàn máy ảo **${mName.toUpperCase()}** (workflow trên \`${cfg.runnerRepo}\` & ổ đĩa trên \`${cfg.storageRepo}\`)...`).catch(() => {});
    try {
      const res = await deleteMachineFull(mName);
      if (waitMsg && waitMsg.edit) {
        await waitMsg.edit(`🗑️ **ĐÃ XÓA TOÀN BỘ MÁY ẢO [${mName.toUpperCase()}] THÀNH CÔNG!**\n• Đã hủy workflow đang chạy trên \`${cfg.runnerRepo}\`.\n• Đã xóa file \`.github/workflows/${mName.toLowerCase()}.yml\`.\n• Đã xóa ổ đĩa và dữ liệu lưu trữ trên \`${cfg.storageRepo}\`.\n• Đã dọn dẹp khỏi danh sách máy!`).catch(() => {});
      }
    } catch (e) {
      if (waitMsg && waitMsg.edit) await waitMsg.edit(`❌ Lỗi khi xóa máy: ${e.message}`).catch(() => {});
    }
    return true;
  }

  // 1b. CÀI ĐẶT GITHUB PAT TOKEN & ĐỔI RUNNER REPO TRỰC TIẾP
  if (lower.startsWith('!may token') || lower.startsWith('!may pat')) {
    if (!isRootAdmin(uid, cfg.rootAdmin)) {
      await msg.reply('🚫 Chỉ có Admin Tối Cao (`946662197168341053`) mới có quyền cài đặt GitHub Token!').catch(() => {});
      return true;
    }
    const tokenVal = text.replace(/^!may\s+(token|pat)\s*/i, '').trim();
    if (!tokenVal) {
      await msg.reply('⚠️ Cú pháp: `!may token <github_pat_token>`\nVí dụ: `!may token ghp_xxxx` hoặc `!may token github_pat_xxxx`').catch(() => {});
      return true;
    }
    msg.delete().catch(() => {});

    const d = (botCtx && typeof botCtx.db === 'function' ? botCtx.db() : null) || loadBridgeState();
    const rdp = d.rdp || (d.shared && d.shared.rdp) || d;
    rdp.config = rdp.config || {};
    rdp.config.token = tokenVal;
    saveBridgeState(rdp);
    if (botCtx && typeof botCtx.saveNow === 'function') botCtx.saveNow();

    await msg.channel.send(`✅ **ĐÃ LƯU GITHUB PAT TOKEN THÀNH CÔNG!**\n• Admin: <@${uid}>\n• Đã xóa tin nhắn chứa token khỏi kênh chat để bảo mật.\n• Bây giờ bạn có thể tạo và điều khiển máy ảo bình thường!`).catch(() => {});
    return true;
  }

  if (lower.startsWith('!may doirepo') || lower.startsWith('!may repo')) {
    if (!isRootAdmin(uid, cfg.rootAdmin)) {
      await msg.reply('🚫 Chỉ có Admin Tối Cao (`946662197168341053`) mới có quyền đổi Runner Repo!').catch(() => {});
      return true;
    }
    const args = text.replace(/^!may\s+(doirepo|repo)\s*/i, '').trim().split(/\s+/).filter(Boolean);
    const newRepo = args[0];
    const newToken = args[1];
    if (!newRepo || !newRepo.includes('/')) {
      await msg.reply('⚠️ Cú pháp: `!may doirepo <owner/repo_mới> [token_pat]`\nVí dụ: `!may doirepo ohohhoho82-alt/app ghp_xxxx`').catch(() => {});
      return true;
    }
    if (newToken) msg.delete().catch(() => {});

    const d = (botCtx && typeof botCtx.db === 'function' ? botCtx.db() : null) || loadBridgeState();
    const rdp = d.rdp || (d.shared && d.shared.rdp) || d;
    rdp.config = rdp.config || {};
    rdp.config.runnerRepo = newRepo;
    if (newToken) rdp.config.token = newToken;
    saveBridgeState(rdp);
    if (botCtx && typeof botCtx.saveNow === 'function') botCtx.saveNow();

    await msg.channel.send(`✅ **ĐÃ ĐỔI RUNNER REPO THÀNH CÔNG!**\n• Nơi treo máy: \`${newRepo}\`\n• Kho lưu ổ đĩa gốc: \`${cfg.storageRepo}\`${newToken ? '\n• Đã cập nhật Token mới và xóa tin nhắn bảo mật!' : ''}`).catch(() => {});
    return true;
  }

  // 2. KIỂM TRA PHÂN QUYỀN TRUY CẬP TỔNG THỂ CHO MỌI LỆNH !may / !ds / !rdp
  if (/^!(may|maymenu|ds|rdp)\b/i.test(text) || text.toLowerCase() === '!ds') {
    if (!isUserAllowed(uid, msg.member, cfg)) {
      await msg.reply(`⛔ **BẠN CHƯA ĐƯỢC CẤP QUYỀN SỬ DỤNG HỆ THỐNG MÁY ẢO!**\n• Vui lòng liên hệ Admin tối cao (<@${cfg.rootAdmin}>) để được cấp phép sử dụng.`).catch(() => {});
      return true;
    }
  }

  for (const cmd of rdp.commands) {
    if (cmd.enabled === false || !cmd.trigger) continue;
    let isMatch = false;
    if (botCtx && typeof botCtx.matchText === 'function') {
      isMatch = botCtx.matchText(cmd, text);
    } else {
      const t = text.toLowerCase(), k = (cmd.trigger || '').trim().toLowerCase();
      if (cmd.matchType === 'exact') isMatch = (t === k);
      else if (cmd.matchType === 'startsWith') isMatch = t.startsWith(k);
      else if (cmd.matchType === 'regex') { try { isMatch = new RegExp(cmd.trigger, 'i').test(text); } catch {} }
      else isMatch = t.includes(k);
    }
    if (!isMatch) continue;

    const uid = msg.author.id;
    const cfg = getRdpConfig();

    if (!checkRdpAccess(cmd, msg, cfg.rootAdmin)) {
      await msg.reply({ content: `⛔ Bạn chưa được cấp quyền sử dụng lệnh **${cmd.name}**! Hãy liên hệ Admin (<@${cfg.rootAdmin}>).` }).catch(() => {});
      return true;
    }

    const cdKey = `rdp:${cmd.id}:${uid}`;
    const lastCd = rdpCooldowns.get(cdKey) || 0;
    if (cmd.cooldown > 0 && Date.now() - lastCd < cmd.cooldown * 1000) {
      msg.react('⏳').catch(() => {});
      return true;
    }
    rdpCooldowns.set(cdKey, Date.now());

    if (botCtx && typeof botCtx.log === 'function') {
      botCtx.log('cmd', `RDP: lệnh "${cmd.name}" (${cmd.type})`, { user: msg.author.username });
    }

    const menu = (rdp.menus || []).find(m => m.id === (cmd.menu || 'main')) || (rdp.menus && rdp.menus[0]);

    if (cmd.type === 'menu') {
      const allM = (rdp && rdp.machines) || {};
      if (Object.keys(allM).length === 0) {
        try { await syncAllMachinesWithGithub(); } catch {}
      }
      const vars = getRdpVars(uid, { title: cmd.name });
      const payload = buildRdpPayload(menu, vars, uid);
      if (cmd.replyMode === 'send') await msg.channel.send(payload).catch(() => {});
      else await msg.reply(payload).catch(() => {});
      return true;
    }

    if (cmd.type === 'create') {
      const args = text.replace(/^[^\s]+\s*/, '').replace(/^(tao|create)\s*/i, '').trim().split(/\s+/).filter(Boolean);
      const nameArg = (args[0] || `may-${Date.now().toString(36).slice(-4)}`).toLowerCase().replace(/[^a-z0-9\-]/g, '');
      const durArg = args[1] || '5h';
      const pinArg = args[2] || 'Aistv2026';

      await msg.reply(`⏳ Đang khởi tạo máy **${nameArg}** (${durArg}) với mã PIN \`${pinArg}\`...`).catch(() => {});
      try {
        await createMachineWorkflow(nameArg, durArg, pinArg, uid, msg.member?.displayName || msg.author.username);
        const vars = getRdpVars(uid, { curMachineId: nameArg });
        const mgrMenu = (rdp.menus || []).find(m => m.id === 'manager') || menu;
        const payload = buildRdpPayload(mgrMenu, vars, uid);
        await msg.channel.send({ content: `✅ **ĐÃ TẠO MÁY [${nameArg.toUpperCase()}] THÀNH CÔNG!**\n• Nơi treo: \`${cfg.runnerRepo}\`\n• Kho lưu: \`${cfg.storageRepo}\``, ...payload }).catch(() => {});
      } catch (err) {
        await msg.channel.send(`❌ Lỗi tạo máy **${nameArg}**: ${err.message}`).catch(() => {});
      }
      return true;
    }

    if (cmd.type === 'restart') {
      const args = text.replace(/^[^\s]+\s*/, '').replace(/^(reset|restart)\s*/i, '').trim().split(/\s+/).filter(Boolean);
      const nameArg = (args[0] || Object.keys(rdp.machines || {})[0] || '').toLowerCase();
      if (!nameArg) {
        await msg.reply('⚠️ Hãy nhập tên máy cần khởi động lại, vd: `!may reset thu`').catch(() => {});
        return true;
      }
      await msg.reply(`🔁 Đang kích hoạt lại phiên mới cho máy **${nameArg}**...`).catch(() => {});
      try {
        await restartMachineWorkflow(nameArg);
        await msg.channel.send(`✅ Đã gửi lệnh khởi động lại máy **${nameArg}**!`).catch(() => {});
      } catch (err) {
        await msg.channel.send(`❌ Lỗi khởi động lại máy **${nameArg}**: ${err.message}`).catch(() => {});
      }
      return true;
    }

    if (cmd.type === 'stop') {
      const args = text.replace(/^[^\s]+\s*/, '').replace(/^(stop|tat)\s*/i, '').trim().split(/\s+/).filter(Boolean);
      const nameArg = (args[0] || Object.keys(rdp.machines || {})[0] || '').toLowerCase();
      if (!nameArg) {
        await msg.reply('⚠️ Hãy nhập tên máy cần tắt, vd: `!may stop thu`').catch(() => {});
        return true;
      }
      await msg.reply(`🛑 Đang dừng máy **${nameArg}**...`).catch(() => {});
      try {
        await stopMachineWorkflow(nameArg);
        await msg.channel.send(`✅ Đã gửi lệnh lưu ổ đĩa và tắt máy **${nameArg}**!`).catch(() => {});
      } catch (err) {
        await msg.channel.send(`❌ Lỗi tắt máy **${nameArg}**: ${err.message}`).catch(() => {});
      }
      return true;
    }

    if (cmd.type === 'scan') {
      await msg.reply(`⏳ Đang quét toàn bộ file workflow trên \`${cfg.runnerRepo}\` và tự động nâng cấp...`).catch(() => {});
      try {
        const res = await scanAndRebuildWorkflowsDirect(true);
        const rep = [
          `🎉 **HOÀN TẤT ĐỒNG BỘ & NÂNG CẤP TOÀN BỘ MÁY ẢO!**`,
          `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
          `• 📁 **Tổng số file trong workflows:** **${res.totalFiles}**`,
          `• 🖥️ **Số máy đã nhận diện:** **${res.scannedCount}** máy`,
          `• 🚀 **Số file đã cập nhật lên bản taomay.yml mới nhất:** **${res.upgradedCount}** file`,
          `• 🏃 **Runner Repo:** \`${cfg.runnerRepo}\``,
          `• 📦 **Storage Repo:** \`${cfg.storageRepo}\``,
          `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
          `💡 *Gõ \`!may\` để mở bảng điều khiển quản lý ngay!*`
        ].join('\n');
        await msg.channel.send(rep).catch(() => {});
      } catch (err) {
        await msg.channel.send(`❌ Lỗi quét runner repo: ${err.message}`).catch(() => {});
      }
      return true;
    }

    if (cmd.type === 'reply') {
      const vars = getRdpVars(uid, { title: cmd.name });
      const textRep = fill(cmd.reply || '', vars);
      if (cmd.replyMode === 'send') await msg.channel.send(textRep).catch(() => {});
      else await msg.reply(textRep).catch(() => {});
      return true;
    }

    return true;
  }

  // 2. NẾU LÀ CÁC LỆNH GỌI MENU / BẢNG ĐIỀU KHIỂN (kể cả !maymenu, !may menu, !may ds, !ds, !may, !rdp)
  // mà không khớp lệnh con nào cụ thể ở trên -> TỰ ĐỘNG HIỂN THỊ MENU CHÍNH ĐÃ THIẾT KẾ TỪ WEB!
  if (/^!(may|maymenu|ds|rdp)\b/i.test(text) || text.toLowerCase() === '!ds') {
    const uid = msg.author.id;
    const mainCmd = rdp.commands.find(c => c.type === 'menu') || { name: 'Bảng điều khiển máy ảo', menu: 'main' };
    const menu = (rdp.menus || []).find(m => m.id === (mainCmd.menu || 'main')) || (rdp.menus && rdp.menus[0]);
    if (menu) {
      const vars = getRdpVars(uid, { title: mainCmd.name });
      const payload = buildRdpPayload(menu, vars, uid);
      await msg.reply(payload).catch(() => msg.channel.send(payload).catch(() => {}));
      return true; // ĐÃ XỬ LÝ XONG, TUYỆT ĐỐI KHÔNG ĐỂ SCRIPT CŨ CHẠY ĐÈ!
    }
  }

  return false;
}

// ----------------- HIỂN THỊ MODAL TẠO MÁY ẢO -----------------
async function showCreateMachineModal(i, uid) {
  const D = require('discord.js');
  const d = (botCtx && typeof botCtx.db === 'function' ? botCtx.db() : null) || loadBridgeState();
  const rdp = d.rdp || (d.shared && d.shared.rdp) || d;

  const autoDefaultName = getNextMachineId(rdp);

  const modal = new D.ModalBuilder()
    .setCustomId(`rdp:modal_create_submit:${uid}`)
    .setTitle('➕ TẠO MÁY ẢO GAMEVIEWER & STARDESK');

  const nameInput = new D.TextInputBuilder()
    .setCustomId('vm_name')
    .setLabel('Tên Định Danh Máy (Để trống để tự động gán)')
    .setStyle(D.TextInputStyle.Short)
    .setPlaceholder(`Tự động gán: ${autoDefaultName}`)
    .setValue(autoDefaultName)
    .setRequired(false)
    .setMaxLength(32);

  const pinInput = new D.TextInputBuilder()
    .setCustomId('vm_pin')
    .setLabel('Mã PIN GameViewer (Mặc định: Aistv2026)')
    .setStyle(D.TextInputStyle.Short)
    .setPlaceholder('Mặc định: Aistv2026')
    .setValue('Aistv2026')
    .setRequired(false)
    .setMinLength(8)
    .setMaxLength(16);

  const durInput = new D.TextInputBuilder()
    .setCustomId('vm_dur')
    .setLabel('Thời Lượng Treo (5h00m, 3h, 1h)')
    .setStyle(D.TextInputStyle.Short)
    .setPlaceholder('5h00m')
    .setValue('5h00m')
    .setRequired(false)
    .setMaxLength(10);

  modal.addComponents(
    new D.ActionRowBuilder().addComponents(nameInput),
    new D.ActionRowBuilder().addComponents(pinInput),
    new D.ActionRowBuilder().addComponents(durInput)
  );

  await i.showModal(modal);
}

// ----------------- XỬ LÝ SUBMIT MODAL TẠO MÁY ẢO -----------------
async function handleModalCreateSubmit(i, uid) {
  const D = require('discord.js');
  if (!i.deferred && !i.replied) {
    await i.deferReply({ flags: D.MessageFlags.Ephemeral }).catch(() => {});
  }

  const rawName = i.fields.getTextInputValue('vm_name');
  const rawPin = i.fields.getTextInputValue('vm_pin');
  const rawDur = i.fields.getTextInputValue('vm_dur') || '5h00m';

  const d = (botCtx && typeof botCtx.db === 'function' ? botCtx.db() : null) || loadBridgeState();
  const rdp = d.rdp || (d.shared && d.shared.rdp) || d;

  const cleanName = getNextMachineId(rdp, rawName);
  const cleanPin = (rawPin ? String(rawPin).trim() : 'Aistv2026').replace(/[^A-Za-z0-9]/g, '') || 'Aistv2026';
  const cleanDur = normalizeDuration(rawDur);
  const cleanDisplayName = `Máy ${cleanName.toUpperCase()}`;
  const ownerName = i.member?.displayName || i.user.username;

  const cfg = getRdpConfig();

  if (!cfg.token) {
    return await i.editReply({
      content: `⚠️ **CHƯA CẤU HÌNH GITHUB PAT TOKEN!**\n  Để tạo file workflow và kích hoạt Actions, bot cần GitHub Personal Access Token (PAT) có quyền \`repo\` & \`workflow\`.\n  **Cách 1 (Nhanh nhất):** Admin chat lệnh sau trong Discord:\n  \`!may token <token_pat_của_bạn>\` *(bot sẽ xóa tin nhắn ngay lập tức để bảo mật)*.\n  **Cách 2:** Mở Web Quản Lý (Tab ⚙️ Cài Đặt) điền vào ô **PAT Token** rồi bấm Lưu.`
    });
  }

  try {
    await i.editReply({ content: `⏳ Đang khởi tạo máy **${cleanDisplayName}** (${cleanDur}) với PIN \`${cleanPin}\` trên GitHub Actions...` });
    await createMachineWorkflow(cleanName, cleanDur, cleanPin, uid, cleanDisplayName, ownerName);
rdp.selectedVm = rdp.selectedVm || {};
    rdp.selectedVm[uid] = cleanName;
    saveBridgeState(rdp);

    const detailMenu = (rdp.menus || []).find(m => m.id === 'vm_detail') || (rdp.menus || [])[0];
    const vars = getRdpVars(uid, { curMachineId: cleanName });
    const payload = buildRdpPayload(detailMenu, vars, uid);

    await i.editReply({
      content: `🎉 **ĐÃ TẠO MÁY ẢO THÀNH CÔNG!**\n• Máy: **${cleanName.toUpperCase()}**\n• PIN: \`${cleanPin}\`\n• Đang kích hoạt tiến trình trên GitHub Actions!`,
      ...payload
    });
  } catch (err) {
    await i.editReply({ content: `❌ Lỗi khởi tạo máy ảo **${cleanName}**: ${err.message}` });
  }
}

// ----------------- TỔNG HỢP XỬ LÝ TƯƠNG TÁC (BUTTON / MODAL / SELECT MENU) -----------------
async function onInteraction(i) {
  const D = require('discord.js');
  if (!i.customId || !String(i.customId).startsWith('rdp:')) return;
  if (i.deferred || i.replied) return;

  const uid = i.user.id;
  const cfg = getRdpConfig();

  // Kiểm tra phân quyền truy cập: Chỉ user được Admin 946662197168341053 cấp phép mới được tương tác
  if (!isUserAllowed(uid, i.member, cfg)) {
    if (i.isRepliable()) {
      return await i.reply({
        content: `⛔ **BẠN CHƯA ĐƯỢC CẤP QUYỀN SỬ DỤNG HỆ THỐNG MÁY ẢO!**\n• Vui lòng liên hệ Admin tối cao (<@${cfg.rootAdmin}>) để được cấp phép sử dụng.`,
        flags: D.MessageFlags.Ephemeral
      }).catch(() => {});
    }
    return;
  }

  // 1. Xử lý gửi Modal tạo máy
  if (i.isModalSubmit() && i.customId.startsWith('rdp:modal_create_submit:')) {
    return await handleModalCreateSubmit(i, uid);
  }

  // 2. Xử lý bấm trực tiếp vào nút máy: rdp:select_vm:<k>:<uid>
  if (i.isButton() && i.customId.startsWith('rdp:select_vm:')) {
    const [, , vmName] = i.customId.split(':');
    const d = (botCtx && typeof botCtx.db === 'function' ? botCtx.db() : null) || loadBridgeState();
    const rdp = d.rdp || (d.shared && d.shared.rdp) || d;
    rdp.selectedVm = rdp.selectedVm || {};
    rdp.selectedVm[uid] = vmName;
    saveBridgeState(rdp);

    await i.deferUpdate();
    const detailMenu = (rdp.menus || []).find(m => m.id === 'vm_detail') || (rdp.menus || [])[0];
    const vars = getRdpVars(uid, { curMachineId: vmName });
    const payload = buildRdpPayload(detailMenu, vars, uid);
    return await i.editReply(payload);
  }

  // 3. Xử lý chọn máy từ StringSelectMenu: rdp:select_vm_menu:<uid>
  if (i.isStringSelectMenu() && i.customId.startsWith('rdp:select_vm_menu:')) {
    const vmName = i.values[0];
    const d = (botCtx && typeof botCtx.db === 'function' ? botCtx.db() : null) || loadBridgeState();
    const rdp = d.rdp || (d.shared && d.shared.rdp) || d;
    rdp.selectedVm = rdp.selectedVm || {};
    rdp.selectedVm[uid] = vmName;
    saveBridgeState(rdp);

    await i.deferUpdate();
    const detailMenu = (rdp.menus || []).find(m => m.id === 'vm_detail') || (rdp.menus || [])[0];
    const vars = getRdpVars(uid, { curMachineId: vmName });
    const payload = buildRdpPayload(detailMenu, vars, uid);
    return await i.editReply(payload);
  }

  // 4. Các nút bấm thông thường: chuyển tiếp tới onButton
  if (i.isButton()) {
    return await onButton(i);
  }
}

// ----------------- XỬ LÝ SỰ KIỆN NÚT BẤM (rdp:...) -----------------
async function onButton(i) {
  const D = require('discord.js');
  const [, mid, ri, ci, owner] = i.customId.split(':');
  const d = (botCtx && typeof botCtx.db === 'function' ? botCtx.db() : null) || loadBridgeState();
  const rdp = d.rdp || (d.shared && d.shared.rdp) || d;
  if (!rdp || !Array.isArray(rdp.menus)) {
    return i.reply({ content: '⚠️ Menu này chưa được cấu hình.', flags: D.MessageFlags.Ephemeral });
  }

  const menu = rdp.menus.find(m => m.id === mid);
  const btn = menu?.rows?.[+ri]?.[+ci];
  if (!menu || !btn) {
    return i.reply({ content: '⚠️ Menu hoặc nút này đã bị xóa/sửa trên trang quản lý.', flags: D.MessageFlags.Ephemeral });
  }

  const uid = i.user.id;
  const cfg = getRdpConfig();
  const isRoot = isRootAdmin(uid, cfg.rootAdmin);

  if (!isUserAllowed(uid, i.member, cfg)) {
    return i.reply({ content: `⛔ Bạn chưa được cấp quyền sử dụng hệ thống máy ảo! Hãy liên hệ Admin tối cao (<@${cfg.rootAdmin}>).`, flags: D.MessageFlags.Ephemeral });
  }

  if (menu.ownerOnly !== false && owner !== 'any' && owner !== uid && !isRoot) {
    return i.reply({ content: '🚫 Đây là menu cá nhân của người khác. Hãy gõ `!may` để mở menu của bạn!', flags: D.MessageFlags.Ephemeral });
  }

  const actions = (Array.isArray(btn.actions) && btn.actions.length > 0)
    ? btn.actions
    : (btn.action ? [btn.action] : []);

  // NẾU LÀ NÚT TẠO MÁY BẰNG MODAL: HIỂN THỊ BẢNG ẨN TRỰC TIẾP TRƯỚC KHI DEFER!
  if (actions.some(a => a.type === 'modal' || a.value === 'modal_create')) {
    return await showCreateMachineModal(i, uid);
  }

  const isEphemeralTrigger = (btn.ephemeral === true || actions.some(a => a.type === 'panel' || a.value === 'mgr' || a.value === 'create'));

  if (isEphemeralTrigger) {
    await i.deferReply({ flags: D.MessageFlags.Ephemeral });
  } else {
    await i.deferUpdate();
  }

  const send = async p => {
    try {
      await i.editReply(p);
    } catch (e) {
      if (botCtx && typeof botCtx.log === 'function') {
        botCtx.log('error', 'rdp onButton editReply: ' + e.message);
      }
    }
  };

  try {
    let activeMenu = menu;
    let explicitResponse = null;

    for (const act of actions) {
      const actType = act?.type;
      const actVal = act?.value;

      if (actType === 'panel' || actType === 'menu') {
        if (actVal === 'close') {
          explicitResponse = { content: '👋 Đã đóng bảng điều khiển. Gõ `!may` để mở lại!', components: [], embeds: [] };
          break;
        }

        if (actVal === 'mgr') {
          activeMenu = rdp.menus.find(m => m.id === 'manager') || activeMenu;
        } else if (actVal === 'create') {
          const autoName = `may-${Date.now().toString(36).slice(-4)}`;
          const customCreate = rdp.menus.find(m => m.id === 'create' || m.id === 'create_panel');
          if (customCreate) {
            activeMenu = customCreate;
          } else {
            activeMenu = {
              id: 'create_panel',
              ownerOnly: true,
              embed: {
                enabled: true,
                color: '#10b981',
                title: '➕ TẠO MÁY ẢO GAMEVIEWER & STARDESK MỚI',
                description: `👉 **Chọn mã PIN có sẵn bên dưới để tạo máy nhanh:**\n• Tên máy tự sinh: \`${autoName}\` (Thời lượng 5h)\n• Hoặc gõ lệnh: \`!may tao <tên> 5h <mã_pin>\` trong kênh chat.`
              },
              rows: [
                [
                  { label: '🔑 PIN Aistv2026 (5h)', emoji: '🔑', style: 'primary', action: { type: 'quickcreate', value: `${autoName}:Aistv2026:5h` } },
                  { label: '🔑 PIN Admin8888 (5h)', emoji: '🔑', style: 'secondary', action: { type: 'quickcreate', value: `${autoName}:Admin8888:5h` } },
                  { label: '🎲 PIN Random (5h)', emoji: '🎲', style: 'secondary', action: { type: 'quickcreate', value: `${autoName}:random:5h` } }
                ],
                [
                  { label: '🔙 Quay Lại', emoji: '🔙', style: 'secondary', action: { type: 'panel', value: 'mgr' } },
                  { label: '❌ Đóng', emoji: '❌', style: 'danger', action: { type: 'panel', value: 'close' } }
                ]
              ]
            };
          }
        } else {
          const targetMenu = rdp.menus.find(m => m.id === actVal);
          if (targetMenu) activeMenu = targetMenu;
        }
      }

      if (actType === 'quickcreate') {
        const [qName, qPinVal, qDur] = (actVal || '').split(':');
        const finalPin = qPinVal === 'random' ? generateRandomPin() : qPinVal;
        await createMachineWorkflow(qName, qDur, finalPin, uid, i.member?.displayName || i.user.username);
        const mgrMenu = rdp.menus.find(m => m.id === 'manager') || activeMenu;
        rdp.selectedVm = rdp.selectedVm || {};
        rdp.selectedVm[uid] = qName;
        activeMenu = mgrMenu;
      }

      if (actType === 'toggle_pin') {
        rdp.pinMasked = !rdp.pinMasked;
        if (botCtx && typeof botCtx.saveSoon === 'function') botCtx.saveSoon();
        saveBridgeState(rdp);
      }

      if (actType === 'refresh') {
        await syncAllMachinesWithGithub();
      }

      if (actType === 'nav') {
        const allM = rdp.machines || {};
        const myKeys = Object.keys(allM);
        if (actVal && actVal.startsWith('select:')) {
          const selName = actVal.slice(7);
          if (allM[selName]) {
            rdp.selectedVm = rdp.selectedVm || {};
            rdp.selectedVm[uid] = selName;
            if (botCtx && typeof botCtx.saveSoon === 'function') botCtx.saveSoon();
            saveBridgeState(rdp);
          }
        } else if (myKeys.length) {
          const cur = (rdp.selectedVm && rdp.selectedVm[uid]) || myKeys[0];
          const idx = myKeys.indexOf(cur);
          let nextIdx = idx >= 0 ? idx : 0;
          if (actVal === 'prev') nextIdx = (idx - 1 + myKeys.length) % myKeys.length;
          else if (actVal === 'next') nextIdx = (idx + 1) % myKeys.length;
          rdp.selectedVm = rdp.selectedVm || {};
          rdp.selectedVm[uid] = myKeys[nextIdx];
          if (botCtx && typeof botCtx.saveSoon === 'function') botCtx.saveSoon();
          saveBridgeState(rdp);
        }
      }

      if (actType === 'set_dur') {
        const curKey = (rdp.selectedVm && rdp.selectedVm[uid]) || Object.keys(rdp.machines || {})[0];
        if (curKey && rdp.machines && rdp.machines[curKey]) {
          rdp.machines[curKey].duration = normalizeDuration(actVal);
          if (botCtx && typeof botCtx.saveSoon === 'function') botCtx.saveSoon();
          saveBridgeState(rdp);
        }
      }

      if (actType === 'set_pin') {
        const curKey = (rdp.selectedVm && rdp.selectedVm[uid]) || Object.keys(rdp.machines || {})[0];
        const pinVal = actVal === 'random' ? generateRandomPin() : actVal;
        if (curKey && rdp.machines && rdp.machines[curKey]) {
          rdp.machines[curKey].gvPin = pinVal;
          if (botCtx && typeof botCtx.saveSoon === 'function') botCtx.saveSoon();
          saveBridgeState(rdp);
          try {
            const tpl = loadTaomayTemplate();
            if (tpl) {
              const newYml = buildVmWorkflow(tpl, curKey, rdp.machines[curKey].duration || '5h', pinVal, cfg.storageRepo);
              const curF = await ghRequest('GET', cfg.runnerRepo, `/contents/.github/workflows/${curKey}.yml`, null, cfg.token);
              if (curF && curF.sha) {
                await ghRequest('PUT', cfg.runnerRepo, `/contents/.github/workflows/${curKey}.yml`, {
                  message: `[AISTV] Đổi mã PIN máy ${curKey} thành ${pinVal}`,
                  content: Buffer.from(newYml, 'utf8').toString('base64'),
                  sha: curF.sha
                }, cfg.token);
              }
            }
          } catch {}
        }
      }

      if (actType === 'vm') {
        const curKey = (rdp.selectedVm && rdp.selectedVm[uid]) || Object.keys(rdp.machines || {})[0];
        if (curKey) {
          const curM = rdp.machines && rdp.machines[curKey];
          if (actVal === 'start') {
            await dispatchWorkflow(cfg.runnerRepo, `${curKey}.yml`, {
              duration: normalizeDuration(curM?.duration),
              pin_code: curM?.gvPin || 'Aistv2026'
            }, cfg.token);
            if (curM) { curM.status = 'in_progress'; curM.isOnline = true; }
          } else if (actVal === 'restart') {
            await cancelWorkflowRuns(cfg.runnerRepo, `${curKey}.yml`, cfg.token);
            await new Promise(r => setTimeout(r, 2000));
            await dispatchWorkflow(cfg.runnerRepo, `${curKey}.yml`, {
              duration: normalizeDuration(curM?.duration),
              pin_code: curM?.gvPin || 'Aistv2026'
            }, cfg.token);
            if (curM) { curM.status = 'in_progress'; curM.isOnline = true; }
          } else if (actVal === 'stop') {
            await cancelWorkflowRuns(cfg.runnerRepo, `${curKey}.yml`, cfg.token);
            if (curM) { curM.status = 'completed'; curM.isOnline = false; }
          } else if (actVal === 'reload_info') {
            await syncAllMachinesWithGithub();
          } else if (actVal === 'delete_disk') {
            if (isRoot || curM?.ownerId === uid) {
              try {
                const res = await deleteMachineDisk(curKey);
                await i.followUp({
                  content: `💽 **ĐÃ XÓA Ổ ĐĨA MÁY [${(curM?.displayName || curKey).toUpperCase()}] THÀNH CÔNG!**\n• Kho lưu: \`${res.storageRepo}\`\n• Release ổ đĩa: \`${res.relTag}\`\n• Nhánh trạng thái: \`${res.stateBranch}\`\n✨ Lần khởi động tiếp theo, hệ thống sẽ tự động tạo ổ mới tinh từ đầu!`,
                  flags: D.MessageFlags.Ephemeral
                }).catch(() => {});
              } catch (err) {
                await i.followUp({ content: `❌ Lỗi khi xóa ổ đĩa máy ${curKey}: ${err.message}`, flags: D.MessageFlags.Ephemeral }).catch(() => {});
              }
            } else {
              await i.followUp({ content: `🚫 Bạn không có quyền xóa ổ đĩa máy này vì không phải chủ sở hữu hay Admin!`, flags: D.MessageFlags.Ephemeral }).catch(() => {});
            }
          } else if (actVal === 'delete') {
            if (isRoot || curM?.ownerId === uid) {
              try {
                await deleteMachineFull(curKey);
                activeMenu = rdp.menus.find(m => m.id === 'main') || activeMenu;
                await i.followUp({ content: `🗑️ Đã xóa HOÀN TOÀN máy ảo **${(curM?.displayName || curKey).toUpperCase()}** (gồm file workflow và ổ đĩa lưu trữ)!`, flags: D.MessageFlags.Ephemeral }).catch(() => {});
              } catch (err) {
                await i.followUp({ content: `❌ Lỗi xóa máy ảo: ${err.message}`, flags: D.MessageFlags.Ephemeral }).catch(() => {});
              }
            } else {
              await i.followUp({ content: `🚫 Bạn không có quyền xóa máy ảo này vì không phải chủ sở hữu!`, flags: D.MessageFlags.Ephemeral }).catch(() => {});
            }
          }
        }
      }

      if (actType === 'prompt') {
        const curKey = (rdp.selectedVm && rdp.selectedVm[uid]) || Object.keys(rdp.machines || {})[0];
        const curM = (rdp.machines && rdp.machines[curKey]) || {};
        const promptText = [
          `🖥️ **THÔNG TIN KẾT NỐI & PROMPT CHO MÁY [${(curM.displayName || curM.name || curKey || 'Chưa chọn').toUpperCase()}]**`,
          '```yaml',
          `Tên máy: ${curM.displayName || curM.name || curKey || 'Chưa có'}`,
          `Trạng thái: ${curM.isOnline ? 'ONLINE' : 'OFFLINE'}`,
          `GameViewer ID: ${curM.gvId || 'Chờ cấp ID'}`,
          `Mã PIN: ${curM.gvPin || 'Aistv2026'}`,
          `StarDesk ID: ${curM.stardeskId || '-'}`,
          `User hệ thống: runneradmin`,
          `Mật khẩu máy: ${curM.pass || curM.gvPin || 'Aistv@2026'}`,
          `Thời lượng: ${curM.duration || '5h'}`,
          `Chủ sở hữu: ${curM.owner || curM.ownerId || uid}`,
          `Runner Repo: ${cfg.runnerRepo}`,
          `Storage Repo: ${cfg.storageRepo}`,
          '```',
          `💡 *Bạn có thể copy đoạn trên để dán vào GameViewer / StarDesk hoặc gửi cho trợ lý AI!*`
        ].join('\n');
        await i.followUp({ content: promptText, flags: D.MessageFlags.Ephemeral }).catch(() => {});
      }

      if (actType === 'cmd') {
        const cmd = rdp.commands.find(c => c.id === actVal);
        if (cmd && cmd.type === 'scan') {
          await scanAndRebuildWorkflowsDirect(true);
        }
      }
    }

    if (explicitResponse) return send(explicitResponse);

    if (botCtx && typeof botCtx.saveSoon === 'function') botCtx.saveSoon();
    saveBridgeState(rdp);
    const vars = getRdpVars(uid);
    return send(buildRdpPayload(activeMenu, vars, uid));
  } catch (err) {
    if (botCtx && typeof botCtx.log === 'function') {
      botCtx.log('error', `rdp button error: ${err.message}`);
    }
    return send({ content: `❌ Lỗi thao tác: ${err.message}`, components: [], embeds: [] });
  }
}

module.exports = {
  getNextMachineId,
  init,
  onMessage,
  onButton,
  onInteraction,
  showCreateMachineModal,
  handleModalCreateSubmit,
  loadBridgeState,
  saveBridgeState,
  getRdpConfig,
  ghRequest,
  loadTaomayTemplate,
  buildVmWorkflow,
  dispatchWorkflow,
  cancelWorkflowRuns,
  createMachineWorkflow,
  restartMachineWorkflow,
  stopMachineWorkflow,
  deleteMachineDisk,
  deleteMachineFull,
  scanAndRebuildWorkflowsDirect,
  syncAllMachinesWithGithub,
  getRdpVars,
  buildRdpPayload
};
