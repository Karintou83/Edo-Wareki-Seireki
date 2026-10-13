'use strict';
// 開発用: eras.js の表を、Node 内蔵 ICU(Intl)の日本暦と突き合わせる。
// 比較するのは各元号の「元年と最終年を除く内部の年」の6月15日時点のみ。
// (改元がある年は、旧暦の日付を新暦の日付として扱う ICU の仕様や
//  「旧暦の年号年に対応する西暦年」という慣用とずれやすいので除外する)
const { ERAS, INDEX } = require('../eras');
const fmt = new Intl.DateTimeFormat('ja-JP-u-ca-japanese', { era: 'long', year: 'numeric' });
function icu(y) {
  const parts = fmt.formatToParts(new Date(y, 5, 15));
  const era = parts.find((p) => p.type === 'era').value;
  const yr = parts.find((p) => p.type === 'year').value;
  return { era, n: yr === '元' ? 1 : Number(String(yr).replace(/[^0-9]/g, '')) };
}
let checked = 0; const bad = [];
ERAS.forEach(([name, start], i) => {
  const next = ERAS[i + 1];
  const endY = next ? next[1] : Math.min(start + 10, 2026);
  for (let y = start + 1; y < endY; y++) {
    const got = icu(y); checked++;
    const want = { era: name, n: y - start + 1 };
    if (got.era !== want.era || got.n !== want.n) bad.push({ y, want, got });
  }
});
console.log(`内部の年 ${checked} 件を ICU と照合: 不一致 ${bad.length} 件`);
bad.forEach((b) => console.log(' ', JSON.stringify(b)));
// 境界年(改元の年)の参考表示: 6/15時点でICUが返す元号
console.log('\n[参考] 改元の年(6/15時点でICUが返す元号)と、表の元年の西暦:');
const odd = [];
ERAS.forEach(([name, start]) => {
  const g = icu(start);
  if (g.era !== name || g.n !== 1) odd.push(`${name}元年=${start}: ICU(${start}/6/15)=${g.era}${g.n}年`);
});
console.log(odd.length ? odd.join('\n') : '(なし)');
