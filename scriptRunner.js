// Chạy script người dùng viết (Python / JavaScript) trong tiến trình con riêng:
// - có giới hạn thời gian, giới hạn dung lượng output
// - môi trường (env) được lọc sạch, KHÔNG có token / secret
const { spawn, spawnSync } = require('child_process');
const path = require('path');
const os = require('os');

const MARK = '@@RESULT@@';
const MAX_OUT = 512 * 1024;

const RUNTIMES = {
  javascript: { label: 'JavaScript (Node)', cmd: process.execPath, args: [path.join(__dirname, 'run_js.js')], version: process.version, ok: true },
  python: { label: 'Python', cmd: null, args: [path.join(__dirname, 'run_py.py')], version: '', ok: false }
};

// Thêm ngôn ngữ khác: khai báo thêm vào RUNTIMES + viết file runner tương ứng (xem run_py.py làm mẫu).
function detectRuntimes() {
  const cands = process.platform === 'win32' ? ['python', 'python3'] : ['python3', 'python'];
  for (const c of cands) {
    try {
      const r = spawnSync(c, ['--version'], { encoding: 'utf8', windowsHide: true, timeout: 8000 });
      const out = (r.stdout || '') + (r.stderr || '');
      if (r.status === 0 && /Python 3/.test(out)) {
        RUNTIMES.python.cmd = c; RUNTIMES.python.ok = true; RUNTIMES.python.version = out.trim();
        break;
      }
    } catch { /* thử lệnh tiếp theo */ }
  }
  return runtimeInfo();
}
const runtimeInfo = () => Object.fromEntries(Object.entries(RUNTIMES).map(([k, v]) => [k, { label: v.label, ok: v.ok, version: v.version }]));

function safeEnv() {
  const keep = new Set(['PATH', 'SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP', 'HOME', 'USERPROFILE', 'LANG', 'COMSPEC', 'PATHEXT']);
  const e = {};
  for (const k of Object.keys(process.env)) if (keep.has(k.toUpperCase())) e[k] = process.env[k];
  e.PYTHONIOENCODING = 'utf-8'; e.PYTHONUTF8 = '1';
  return e;
}

function runScript(lang, code, input, timeoutMs = 5000) {
  return new Promise(resolve => {
    const rt = RUNTIMES[lang];
    if (!rt || !rt.ok) return resolve({ ok: false, error: `Máy chưa có môi trường chạy "${lang}"`, ms: 0 });
    const t0 = Date.now();
    let stdout = '', stderr = '', size = 0, killed = false, done = false;
    const finish = r => { if (done) return; done = true; clearTimeout(timer); resolve({ ms: Date.now() - t0, stdout, stderr, ...r }); };
    let child;
    try {
      child = spawn(rt.cmd, rt.args, { env: safeEnv(), cwd: os.tmpdir(), windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (e) { return resolve({ ok: false, error: 'Không chạy được: ' + e.message, ms: 0 }); }
    const timer = setTimeout(() => { killed = 'time'; child.kill('SIGKILL'); }, timeoutMs);

    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', d => { size += d.length; if (size > MAX_OUT) { killed = 'size'; child.kill('SIGKILL'); } else stdout += d; });
    child.stderr.on('data', d => { if (stderr.length < 8000) stderr += d; });
    child.on('error', e => finish({ ok: false, error: 'Không chạy được: ' + e.message }));
    child.on('close', code => {
      if (killed === 'time') return finish({ ok: false, error: `Quá thời gian cho phép (${timeoutMs} ms)` });
      if (killed === 'size') return finish({ ok: false, error: 'Output quá lớn' });
      const i = stdout.lastIndexOf(MARK);
      if (code !== 0 || i < 0) {
        const tail = stderr.trim().split('\n').slice(-8).join('\n');
        return finish({ ok: false, error: tail || (code === 0 ? 'Script kết thúc sớm (không trả kết quả)' : `Script thoát với mã ${code}`) });
      }
      let res;
      try { res = JSON.parse(stdout.slice(i + MARK.length)); } catch { return finish({ ok: false, error: 'Kết quả script không đọc được' }); }
      finish({ ok: true, out: res.out, store: res.store, shared: res.shared, stdout: stdout.slice(0, i) });
    });
    child.stdin.on('error', () => {});
    child.stdin.end(JSON.stringify({ ctx: input.ctx, store: input.store, shared: input.shared, code }));
  });
}

module.exports = { runScript, detectRuntimes, runtimeInfo, RUNTIMES };
