// InfNum — số "tiến sát vô hạn" dùng chung cho bot (Node) và trang Tu Tiên (trình duyệt).
// Một số = [a, b]  nghĩa là  ∞^a × 10^b
//   a : TẦNG VÔ HẠN (số nguyên). Hơn nhau 1 tầng = hơn nhau vô hạn lần, không thể bù bằng số lượng.
//   b : log10 của độ lớn trong tầng (b có thể lên tới 1e300 → 10^(10^300), vượt xa giới hạn của Number).
// Số 0 là [0, -1e300]. Lưu JSON được (không có Infinity / NaN).
(function (root, factory) {
  const m = factory();
  if (typeof module === 'object' && module.exports) module.exports = m; else root.InfNum = m;
})(typeof self !== 'undefined' ? self : this, function () {
  const ZB = -1e300, MAXB = 1e300, L10 = Math.log10;
  const ZERO = () => [0, ZB];
  const isZ = x => !x || x[1] <= ZB;
  const norm = x => {
    if (!Array.isArray(x) || x.length < 2) return ZERO();
    let a = Math.trunc(+x[0]), b = +x[1];
    if (!Number.isFinite(a)) a = 0;
    if (!Number.isFinite(b)) b = b > 0 ? MAXB : ZB;
    return b <= ZB ? ZERO() : [a, Math.min(b, MAXB)];
  };
  const num = n => (n > 0 && Number.isFinite(n)) ? [0, L10(n)] : ZERO();
  const cmp = (x, y) => {
    const zx = isZ(x), zy = isZ(y);
    if (zx || zy) return zx && zy ? 0 : zx ? -1 : 1;
    if (x[0] !== y[0]) return x[0] > y[0] ? 1 : -1;
    return x[1] === y[1] ? 0 : x[1] > y[1] ? 1 : -1;
  };
  const max = (x, y) => cmp(x, y) >= 0 ? x : y;
  const min = (x, y) => cmp(x, y) <= 0 ? x : y;
  const add = (x, y) => {
    if (isZ(x)) return y.slice(); if (isZ(y)) return x.slice();
    if (x[0] !== y[0]) return (x[0] > y[0] ? x : y).slice();
    const hi = Math.max(x[1], y[1]), d = Math.abs(x[1] - y[1]);
    return d > 16 ? [x[0], hi] : [x[0], hi + L10(1 + Math.pow(10, -d))];
  };
  const sub = (x, y) => {                 // x - y (không âm; nếu y >= x → 0)
    if (isZ(y)) return x.slice();
    if (cmp(y, x) >= 0) return ZERO();
    if (x[0] !== y[0]) return x.slice();
    const d = x[1] - y[1];
    return d > 16 ? x.slice() : [x[0], x[1] + L10(1 - Math.pow(10, -d))];
  };
  const mul = (x, y) => (isZ(x) || isZ(y)) ? ZERO() : [x[0] + y[0], Math.min(x[1] + y[1], MAXB)];
  const div = (x, y) => isZ(x) ? ZERO() : isZ(y) ? [1e6, 0] : [x[0] - y[0], x[1] - y[1]];
  const scale = (x, n) => (isZ(x) || !(n > 0)) ? ZERO() : [x[0], x[1] + L10(n)];     // nhân với số thường n > 0
  const addLog = (x, l) => isZ(x) ? ZERO() : [x[0], Math.min(x[1] + l, MAXB)];        // nhân với 10^l
  const layer = (x, k) => isZ(x) ? ZERO() : [x[0] + k, x[1]];                         // nhảy k tầng vô hạn
  // x / y  ra số thường (chặn trong [0, Infinity])
  const ratio = (x, y) => {
    if (isZ(x)) return 0; if (isZ(y)) return Infinity;
    if (x[0] !== y[0]) return x[0] > y[0] ? Infinity : 0;
    const d = x[1] - y[1]; return d > 308 ? Infinity : d < -308 ? 0 : Math.pow(10, d);
  };
  const toNum = x => isZ(x) ? 0 : (x[0] === 0 && x[1] < 308) ? Math.pow(10, x[1]) : Infinity;

  const SUP = '⁰¹²³⁴⁵⁶⁷⁸⁹';
  const sup = n => String(n).split('').map(c => c === '-' ? '⁻' : (SUP[+c] ?? c)).join('');
  const comma = n => Math.round(n).toLocaleString('en-US');
  const sci = b => {                       // 10^b dạng m e k
    const e = Math.floor(b); let m = Math.pow(10, b - e); if (m >= 9.995) { m = 1; return '1.00e' + (e + 1); }
    return m.toFixed(2) + 'e' + e;
  };
  const core = b => {
    if (b < 0) return b > -300 ? sci(b) : '10^' + (b <= -1e9 ? '(' + b.toExponential(2) + ')' : comma(b));
    if (b < 6) { const n = Math.pow(10, b); return n < 10 ? n.toFixed(2).replace(/\.?0+$/, '') : n < 1000 ? n.toFixed(1).replace(/\.0$/, '') : comma(n); }
    if (b < 308) return sci(b);
    return '10^' + (b < 1e9 ? comma(b) : '(' + b.toExponential(2).replace('e+', 'e') + ')');
  };
  const fmt = x => {
    x = norm(x); if (isZ(x)) return '0';
    const a = x[0], b = x[1], one = Math.abs(b) < 1e-9;
    if (a === 0) return core(b);
    const head = a > 0 ? '∞' + (a === 1 ? '' : (a < 1000 ? sup(a) : '^' + a)) : 'ε' + (a === -1 ? '' : sup(-a));
    return one ? head : head + '×' + core(b);
  };
  const bar = (r, n = 10) => { r = Math.max(0, Math.min(1, +r || 0)); const f = Math.round(r * n); return '█'.repeat(f) + '░'.repeat(n - f); };
  return { ZERO, isZ, norm, num, cmp, max, min, add, sub, mul, div, scale, addLog, layer, ratio, toNum, fmt, bar };
});
