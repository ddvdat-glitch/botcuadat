// ============================================================================
// SCRIPT 2 - AI OLLAMA (chạy local) TRẢ LỜI KHI BỊ TAG HOẶC BỊ REPLY
// Trả lời cực ngắn (1-2 từ), cục súc, chửi bậy. Có công tắc bật/tắt.
//
// Cài trên web (tab Script):
//   Ngôn ngữ : JavaScript
//   Trigger  : \[\[BOT_TAGGED\]\]|^!ai\b
//   Kiểu khớp: regex
//   Kiểu trả : reply      Cooldown: 3      Thời gian tối đa: 15000
//   (ô "Chỉ nhận tin từ ID" để TRỐNG)
//
// Yêu cầu: máy chạy bot đã cài Ollama và đã pull model:
//     ollama pull qwen2.5:7b        (nói tiếng Việt tốt hơn llama3.2)
//
// Lệnh (bật/tắt/đổi model chỉ Admin / chủ server):
//   !ai on | !ai off          bật / tắt AI
//   !ai model <tên model>     đổi model
//   !ai clear                 xóa trí nhớ cuộc trò chuyện
//   !ai                       xem trạng thái
// ============================================================================

// ------------------------------ CẤU HÌNH ------------------------------------
const OLLAMA_URL = 'http://127.0.0.1:11434/api/chat';
const DEFAULT_MODEL = 'qwen2.5:7b';
const MAX_WORDS = 2;        // số từ tối đa của câu trả lời (1-2 từ)
const MEMORY_TURNS = 6;     // nhớ bao nhiêu tin gần nhất của mỗi kênh
const HTTP_TIMEOUT = 13000; // ms (phải nhỏ hơn "Thời gian tối đa" của script)

const SYSTEM_PROMPT = [
  'Mày là một thằng bạn cục súc, mất dạy, nói chuyện kiểu chợ búa trên mạng.',
  'LUÔN trả lời bằng tiếng Việt, đúng 1 đến 2 TỪ, tuyệt đối không giải thích, không dài dòng, không xin lỗi, không chào hỏi.',
  'Giọng điệu thô tục, chửi thề, gắt gỏng, xéo xắt, ví dụ: "đm", "câm mồm", "ngu vl", "cút", "khùng à", "cc", "biến", "vãi lồn".',
  'Chỉ chửi kiểu cợt nhả, trêu chọc giữa bạn bè. KHÔNG xúc phạm chủng tộc, tôn giáo, giới tính, khuyết tật hay dòng tộc người khác; KHÔNG đe dọa bạo lực thật.',
  'Nếu câu hỏi đòi thông tin thật, vẫn trả lời cộc lốc 1-2 từ.',
  'Chỉ in ra câu trả lời, không giải thích, không ngoặc kép, không emoji.'
].join('\n');
// ----------------------------------------------------------------------------

const isStaff = ctx.user.isAdmin || ctx.user.isOwner;
const text = String(ctx.content || '').trim();
const model = store.model || DEFAULT_MODEL;

// ---- Lệnh điều khiển ----
const cmd = text.match(/^!ai(?:\s+(\S+))?(?:\s+(.+))?$/i);
if (cmd) {
  const sub = (cmd[1] || '').toLowerCase(), arg = (cmd[2] || '').trim();
  const needStaff = () => { if (!isStaff) { reply('Chỉ Admin / chủ server mới dùng được.'); return true; } return false; };
  if (['on', 'bat', 'bật'].includes(sub)) {
    if (needStaff()) return;
    store.enabled = true; return '✅ AI đã **BẬT**. Tag hoặc reply bot để nói chuyện.';
  }
  if (['off', 'tat', 'tắt'].includes(sub)) {
    if (needStaff()) return;
    store.enabled = false; return '⛔ AI đã **TẮT**.';
  }
  if (sub === 'model') {
    if (needStaff()) return;
    if (!arg) return 'Model hiện tại: `' + model + '`';
    store.model = arg; return 'Đã đổi model sang `' + arg + '`';
  }
  if (sub === 'clear') {
    if (needStaff()) return;
    store.hist = {}; return '🧹 Đã xóa trí nhớ.';
  }
  return 'AI đang **' + (store.enabled === false ? 'TẮT' : 'BẬT') + '** | model: `' + model + '`';
}

// ---- Chỉ trả lời khi đang bật ----
if (store.enabled === false) return;

// ---- Chuẩn bị nội dung người dùng ----
let q = text
  .replace(/\[\[BOT_TAGGED\]\]/g, '')
  .replace(/<@!?\d{15,25}>/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();
if (!q) q = '(chỉ gọi tên, không nói gì)';
const refText = ctx.reply && ctx.reply.content ? String(ctx.reply.content).slice(0, 300) : '';
const userLine = (refText ? '[đang trả lời tin: "' + refText + '"] ' : '') + ctx.user.display + ': ' + q.slice(0, 400);

store.hist = store.hist || {};
const hist = store.hist[ctx.channelId] = store.hist[ctx.channelId] || [];

const messages = [{ role: 'system', content: SYSTEM_PROMPT }, ...hist, { role: 'user', content: userLine }];

// ---- Gọi Ollama ----
const ac = new AbortController();
const timer = setTimeout(() => ac.abort(), HTTP_TIMEOUT);
let out = '';
try {
  const res = await fetch(OLLAMA_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: ac.signal,
    body: JSON.stringify({
      model, messages, stream: false, keep_alive: '30m',
      options: { temperature: 0.9, top_p: 0.9, num_predict: 24 }
    })
  });
  if (!res.ok) throw new Error('Ollama trả về HTTP ' + res.status + ' - ' + (await res.text()).slice(0, 200));
  const data = await res.json();
  out = String((data.message && data.message.content) || '');
} catch (e) {
  throw new Error(e.name === 'AbortError'
    ? 'Ollama quá chậm (>' + HTTP_TIMEOUT + 'ms) - model đang nạp? thử lại / dùng model nhỏ hơn'
    : 'Không gọi được Ollama (' + OLLAMA_URL + '): ' + e.message + ' - đã chạy "ollama serve" và "ollama pull ' + model + '" chưa?');
} finally { clearTimeout(timer); }

// ---- Làm sạch + ép ngắn 1-2 từ ----
out = out
  .replace(/<think>[\s\S]*?<\/think>/gi, '')
  .split('\n').map(s => s.trim()).filter(Boolean)[0] || '';
out = out.replace(/^["'“”‘’`*_\-–\s]+|["'“”‘’`*_\s]+$/g, '').replace(/^(mày|bot|ai)\s*[:：]\s*/i, '');
const words = out.split(/\s+/).filter(Boolean).slice(0, MAX_WORDS);
out = words.join(' ').replace(/[.,;:!?…]+$/, '');
if (!out) out = 'cút';

// ---- Lưu trí nhớ ----
hist.push({ role: 'user', content: userLine }, { role: 'assistant', content: out });
while (hist.length > MEMORY_TURNS * 2) hist.shift();

return out;
