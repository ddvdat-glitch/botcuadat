// Chạy script người dùng viết (Python / JavaScript) trong tiến trình con riêng:
// - code script nằm trong data.json (KHÔNG cần file .js/.py riêng)
// - phần "chạy script" (runner) được nhúng sẵn trong file này, truyền qua tham số node -e / python -c
// - có giới hạn thời gian, giới hạn dung lượng output
// - môi trường (env) được lọc sạch, KHÔNG có token / secret
const { spawn, spawnSync } = require('child_process');
const os = require('os');

const MARK = '@@RESULT@@';
const MAX_OUT = 48 * 1024 * 1024;   // v2: tăng để script gửi được tệp (base64) về cho bot

// ---------- Runner JavaScript (hàm này được chuyển thành chuỗi rồi chạy bằng `node -e`) ----------
function jsRunner() {
  const MARK = '@@RESULT@@';
  const chunks = [];
  process.stdin.on('data', d => chunks.push(d));
  process.stdin.on('end', async () => {
    let inp;
    try { inp = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
    catch { console.error('Dữ liệu đầu vào không hợp lệ'); process.exit(2); }

    const out = { replies: [], reactions: [], actions: [], delete: false, ui: [] };
    const ctx = inp.ctx || {}, store = inp.store || {}, shared = inp.shared || {};
    const show = a => typeof a === 'string' ? a : (() => { try { return JSON.stringify(a); } catch { return String(a); } })();
    const print = (...a) => process.stdout.write(a.map(show).join(' ') + '\n');
    const act = (type, target, extra) => out.actions.push({ type, target: target == null ? 'sender' : String(target), ...extra });

    // ui: nút bấm / sửa tin / hẹn giờ (bot thực hiện sau khi script chạy xong)
    const ui = {
      send: (payload, tag) => out.ui.push({ type: 'send', payload, tag }),          // gửi tin MỚI vào kênh
      reply: (payload, tag) => out.ui.push({ type: 'reply', payload, tag }),        // khi đang xử lý nút bấm: trả lời (mặc định CHỈ NGƯỜI BẤM thấy)
      update: (payload, tag) => out.ui.push({ type: 'update', payload, tag }),      // khi đang xử lý nút bấm: sửa chính tin chứa nút đó
      edit: (tag, payload) => out.ui.push({ type: 'edit', tag, payload }),          // sửa tin đã gửi bằng tag (kể cả tin ẩn)
      after: (seconds, data) => out.ui.push({ type: 'after', seconds, data })       // sau N giây chạy lại script với ctx.event = 'timer'
    };
    const api = {
      ctx, store, shared, print, require, ui,
      reply: (...t) => { out.replies.push(t.map(String).join(' ')); },
      mute: (t, seconds, reason) => act('mute', t, { seconds, reason }),
      unmute: (t, reason) => act('unmute', t, { reason }),
      ban: (t, seconds, reason) => act('ban', t, { seconds, reason }),
      unban: (t, reason) => act('unban', t, { reason }),
      kick: (t, reason) => act('kick', t, { reason }),
      addRole: (t, roleId) => act('addRole', t, { roleId }),
      removeRole: (t, roleId) => act('removeRole', t, { roleId }),
      deleteMsg: () => { out.delete = true; },
      react: e => { out.reactions.push(String(e)); }
    };
    api.add_role = api.addRole; api.remove_role = api.removeRole; api.delete_msg = api.deleteMsg;

    try {
      const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
      const fn = new AsyncFunction(...Object.keys(api), String(inp.code || ''));
      const ret = await fn(...Object.values(api));
      if (typeof ret === 'string' && ret.trim()) out.replies.push(ret);
    } catch (e) { console.error((e && e.stack) || String(e)); process.exit(1); }

    process.stdout.write('\n' + MARK + JSON.stringify({ out, store, shared }), () => process.exit(0));
  });
}
const JS_RUNNER = '(' + jsRunner.toString() + ')()';

// ---------- Runner Python (chạy bằng `python -c`) ----------
const PY_RUNNER = String.raw`
import sys, json, traceback
MARK = '@@RESULT@@'
inp = json.loads(sys.stdin.read() or '{}')
out = {'replies': [], 'reactions': [], 'actions': [], 'delete': False}
ctx = inp.get('ctx') or {}
store = inp.get('store') or {}
shared = inp.get('shared') or {}

def reply(*t): out['replies'].append(' '.join(str(x) for x in t))
def _act(type_, target='sender', **kw):
    d = {'type': type_, 'target': 'sender' if target is None else str(target)}; d.update(kw); out['actions'].append(d)
def mute(target='sender', seconds=60, reason=''): _act('mute', target, seconds=seconds, reason=reason)
def unmute(target='sender', reason=''): _act('unmute', target, reason=reason)
def ban(target='sender', seconds=0, reason=''): _act('ban', target, seconds=seconds, reason=reason)
def unban(target='sender', reason=''): _act('unban', target, reason=reason)
def kick(target='sender', reason=''): _act('kick', target, reason=reason)
def add_role(target, role_id): _act('addRole', target, roleId=role_id)
def remove_role(target, role_id): _act('removeRole', target, roleId=role_id)
def delete_msg(): out['delete'] = True
def react(emoji): out['reactions'].append(str(emoji))
addRole, removeRole, deleteMsg = add_role, remove_role, delete_msg

env = {'__name__': '__main__', 'ctx': ctx, 'store': store, 'shared': shared, 'reply': reply, 'mute': mute,
       'unmute': unmute, 'ban': ban, 'unban': unban, 'kick': kick, 'add_role': add_role, 'remove_role': remove_role,
       'addRole': addRole, 'removeRole': removeRole, 'delete_msg': delete_msg, 'deleteMsg': deleteMsg, 'react': react}
try:
    exec(compile(inp.get('code') or '', '<script>', 'exec'), env)
except SystemExit:
    pass
except BaseException:
    traceback.print_exc(); sys.exit(1)
if isinstance(env.get('store'), dict): store = env['store']
if isinstance(env.get('shared'), dict): shared = env['shared']
sys.stdout.write('\n' + MARK + json.dumps({'out': out, 'store': store, 'shared': shared}, ensure_ascii=False, default=str))
sys.stdout.flush()
`;

const RUNTIMES = {
  javascript: { label: 'JavaScript (Node)', cmd: process.execPath, args: ['-e', JS_RUNNER], version: process.version, ok: true },
  python: { label: 'Python', cmd: null, args: ['-c', PY_RUNNER], version: '', ok: false }
};

function detectRuntimes() {
  const cands = process.platform === 'win32' ? ['python', 'python3', 'py'] : ['python3', 'python'];
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
    const finish = r => { if (done) return; done = true; if (timer) clearTimeout(timer); resolve({ ms: Date.now() - t0, stdout, stderr, ...r }); };
    let child;
    try {
      child = spawn(rt.cmd, rt.args, { env: safeEnv(), cwd: os.tmpdir(), windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (e) { return resolve({ ok: false, error: 'Không chạy được: ' + e.message, ms: 0 }); }
    const timer = timeoutMs > 0 ? setTimeout(() => { killed = 'time'; child.kill('SIGKILL'); }, timeoutMs) : null;   // v2: timeoutMs = 0 -> KHÔNG giới hạn thời gian

    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', d => { size += d.length; if (size > MAX_OUT) { killed = 'size'; child.kill('SIGKILL'); } else stdout += d; });
    child.stderr.on('data', d => { if (stderr.length < 8000) stderr += d; });
    child.on('error', e => finish({ ok: false, error: 'Không chạy được: ' + e.message }));
    child.on('close', code2 => {
      if (killed === 'time') return finish({ ok: false, error: `Quá thời gian cho phép (${timeoutMs} ms)` });
      if (killed === 'size') return finish({ ok: false, error: 'Output quá lớn' });
      const i = stdout.lastIndexOf(MARK);
      if (code2 !== 0 || i < 0) {
        const tail = stderr.trim().split('\n').slice(-8).join('\n');
        return finish({ ok: false, error: tail || (code2 === 0 ? 'Script kết thúc sớm (không trả kết quả)' : `Script thoát với mã ${code2}`) });
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
