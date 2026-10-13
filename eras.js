'use strict';
/**
 * 和暦(元号)→西暦「年」の変換コア。VS Code に依存しない純粋なロジック。
 *
 * 方針:
 *  - 年のみを扱う(月日は扱わない)。旧暦の月日は出典によって差があり、
 *    どの暦かを確定できない場合があるため、あえて変換しない。
 *  - 「元年の西暦」は、その元号の元年が属する西暦年(慣用の対応)。
 *    旧暦12月が新暦の翌年1〜2月にあたる場合でも、和暦の年に対応する
 *    西暦年は1つに決める(例: 寛政12年 = 1800年)。
 *  - 年内改元の年は2つの元号が同じ西暦年を共有する
 *    (例: 慶応4年 = 明治元年 = 1868年)。
 *
 * データの出典と注意:
 *  - 日本語版Wikipedia「日本の元号一覧」の改元日(西暦)の列と照合済み(test/run.js)。
 *    52元号(応仁〜明治)のうち47は開始年が一致する。
 *  - 一致しない5元号(文禄・正保・天保・弘化・安政)は、改元日が旧暦12月で、新暦では翌年1月に
 *    あたるもの。「元年」は和暦の年が基準なので、Wikipediaの改元日の西暦年より1年前を採る
 *    (例: 安政は嘉永7年11月27日=1855年1月15日の改元だが、立年改元により1854年が元年)。
 *    根拠: 同記事の注記(安政の例)。表の値は ICU(Intl)の日本暦とも照合済み(tools/verify-with-intl.js)。
 */

// [元号, 元年の西暦年]  ※古い順。対象は応仁(1467)〜令和。
const ERAS = [
  ['応仁', 1467], ['文明', 1469], ['長享', 1487], ['延徳', 1489], ['明応', 1492],
  ['文亀', 1501], ['永正', 1504], ['大永', 1521], ['享禄', 1528], ['天文', 1532],
  ['弘治', 1555], ['永禄', 1558], ['元亀', 1570], ['天正', 1573], ['文禄', 1592],
  ['慶長', 1596], ['元和', 1615], ['寛永', 1624], ['正保', 1644], ['慶安', 1648],
  ['承応', 1652], ['明暦', 1655], ['万治', 1658], ['寛文', 1661], ['延宝', 1673],
  ['天和', 1681], ['貞享', 1684], ['元禄', 1688], ['宝永', 1704], ['正徳', 1711],
  ['享保', 1716], ['元文', 1736], ['寛保', 1741], ['延享', 1744], ['寛延', 1748],
  ['宝暦', 1751], ['明和', 1764], ['安永', 1772], ['天明', 1781], ['寛政', 1789],
  ['享和', 1801], ['文化', 1804], ['文政', 1818], ['天保', 1830], ['弘化', 1844],
  ['嘉永', 1848], ['安政', 1854], ['万延', 1860], ['文久', 1861], ['元治', 1864],
  ['慶応', 1865], ['明治', 1868], ['大正', 1912], ['昭和', 1926], ['平成', 1989],
  ['令和', 2019],
];

const INDEX = new Map();
ERAS.forEach(([name, start], i) => {
  const next = ERAS[i + 1];
  INDEX.set(name, {
    name,
    start,
    // 最終年: 次の元号の元年と同じ西暦年まで(年内改元で重なる年を含む)。令和は上限なし。
    maxYear: next ? next[1] - start + 1 : Infinity,
  });
});

const ERA_NAMES = ERAS.map((e) => e[0]);

const FULLWIDTH_DIGITS = '０１２３４５６７８９';
const KANJI_DIGITS = '〇一二三四五六七八九';

/** 「元」「12」「１２」「十二」「二十一」などを整数にする。解釈できなければ null。 */
function parseYear(s) {
  if (s === '元') return 1;
  if (/^[0-9０-９]+$/.test(s)) {
    const half = s.replace(/[０-９]/g, (c) => String(FULLWIDTH_DIGITS.indexOf(c)));
    return Number(half);
  }
  if (/^[〇一二三四五六七八九十]+$/.test(s)) {
    const d = (c) => KANJI_DIGITS.indexOf(c);
    if (s.includes('十')) {
      const [tens, units, ...rest] = s.split('十');
      if (rest.length > 0 || tens.length > 1 || units.length > 1) return null;
      const t = tens === '' ? 1 : d(tens);
      const u = units === '' ? 0 : d(units);
      if (t < 1 || u < 0) return null;
      return t * 10 + u;
    }
    // 位取り表記(一二 = 12)
    let n = 0;
    for (const c of s) n = n * 10 + d(c);
    return n;
  }
  return null;
}

/**
 * 元号名と年表記から西暦年を求める。
 * @returns {{ok:true, year:number, era:string, n:number} |
 *           {ok:false, reason:'unknown-era'|'bad-year'|'out-of-range', era:string, n?:number, maxYear?:number, start?:number}}
 */
function convert(eraName, yearStr) {
  const era = INDEX.get(eraName);
  if (!era) return { ok: false, reason: 'unknown-era', era: eraName };
  const n = parseYear(yearStr);
  if (n === null || n < 1) return { ok: false, reason: 'bad-year', era: eraName };
  if (n > era.maxYear) {
    return { ok: false, reason: 'out-of-range', era: eraName, n, maxYear: era.maxYear, start: era.start };
  }
  return { ok: true, year: era.start + n - 1, era: eraName, n };
}

// 元号名の直後に「元」または数字(半角・全角・漢数字)が来て、さらに「年」が続くものだけを拾う。
// (「文化財」「文明の」などの一般語を誤検出しないため、数字と「年」を必須にしている)
// ウィキ記法のリンク付き元号も拾う:  [[天正]]18年  /  [[文化 (元号)|文化]]3年
//   グループ1: リンク付きの元号名 / グループ2: リンクなしの元号名 / グループ3: 年の表記
const YEAR_PART = '元|[0-9０-９]{1,3}|[〇一二三四五六七八九十]{1,3}';
function makeRegExp() {
  const names = ERA_NAMES.join('|');
  return new RegExp(`(?:\\[\\[(?:[^\\[\\]|\\n]*\\|)?(${names})\\]\\]|(${names}))(${YEAR_PART})年`, 'g');
}

// すでに西暦が併記されている(直後が「（1800年）」「(1800年)」「（[[1800年]]）」など)か
const ALREADY_ANNOTATED = /^[（(]\s*(?:西暦\s*)?(?:\[\[)?[0-9０-９]{3,4}\s*年/;

/**
 * 併記する文字列を作る。例: （1590年） / （[[1590年]]） / (1590年)
 * @param {number} year 西暦年
 * @param {{paren?: 'fullwidth'|'halfwidth', linkYear?: boolean}} [opts]
 */
function seirekiSuffix(year, opts = {}) {
  const [open, close] = opts.paren === 'halfwidth' ? ['(', ')'] : ['（', '）'];
  const y = opts.linkYear ? `[[${year}年]]` : `${year}年`;
  return `${open}${y}${close}`;
}


// 元号の記事名が「元号名」と違うもの(曖昧さ回避付き)。{ 元号名: 記事名 }
// 出典: 日本語版Wikipedia「元号一覧 (日本)」のリンク先(2026-10-13確認)。応仁〜令和の52元号のうち、
// 下の8つ以外は記事名が元号名そのままなので、[[元号名]] とします。
//   設定 warekiSeireki.eraLinkTargets でも追加・上書きできます。
const ERA_LINK_TARGETS = {
  '文明': '文明 (日本)',
  '弘治': '弘治 (日本)',
  '天文': '天文 (元号)',
  '元和': '元和 (日本)',
  '正徳': '正徳 (日本)',
  '天和': '天和 (日本)',
  '安永': '安永 (元号)',
  '文化': '文化 (元号)',
};

/** 元号名のウィキリンクを作る。例: [[天正]] / [[文化 (元号)|文化]] */
function eraLink(era, overrides = {}) {
  const target = (overrides && overrides[era]) || ERA_LINK_TARGETS[era] || era;
  return target === era ? `[[${era}]]` : `[[${target}|${era}]]`;
}

/** index の位置が、閉じていない [[ の内側(リンク記法の途中)か */
function insideOpenLink(text, index) {
  const before = text.slice(0, index);
  return before.lastIndexOf('[[') > before.lastIndexOf(']]');
}

/** テキスト中の和暦年表記をすべて見つける。 */
function findAll(text) {
  const re = makeRegExp();
  const found = [];
  let m;
  while ((m = re.exec(text)) !== null) {
    const end = m.index + m[0].length;
    const era = m[1] || m[2];
    const rest = text.slice(end);
    found.push({
      index: m.index,
      end,
      text: m[0],
      era,
      yearStr: m[3],
      eraEnd: m[1] !== undefined ? null : m.index + m[2].length, // リンクなし元号の名前部分の終わり
      inOpenLink: m[1] === undefined && insideOpenLink(text, m.index),
      linked: m[1] !== undefined,          // [[天正]]18年 のように元号にリンクが付いている
      result: convert(era, m[3]),
      alreadyAnnotated: ALREADY_ANNOTATED.test(rest),
      // [[天正18年]] のようにリンクの文字列の中で終わっている場合は、直後に足すとリンクを壊すので対象外
      insideLink: /^\]\]/.test(rest),
    });
  }
  return found;
}


/**
 * 「同3年」「翌3年」のように、元号を省略した年表記を見つける。
 * 元号は、同じ段落でそれより前にいちばん近く出てくる元号を引き継ぐ(「同3年」「翌3年」はどちらも
 * その元号の3年)。引き継ぎ元がなければ result は null。
 * @param {string} line 調べる行
 * @param {string} [before] この行より前の、同じ段落のテキスト(行は改行でつなぐ)
 */
function findRelative(line, before = '') {
  const re = new RegExp(`([同翌])(${YEAR_PART})年`, 'g');
  const found = [];
  let m;
  while ((m = re.exec(line)) !== null) {
    const end = m.index + m[0].length;
    const ctx = findAll(before + '\n' + line.slice(0, m.index));
    const src = ctx.length ? ctx[ctx.length - 1] : null;
    const rest = line.slice(end);
    found.push({
      index: m.index,
      end,
      text: m[0],
      prefix: m[1],
      yearStr: m[2],
      era: src ? src.era : null,
      result: src ? convert(src.era, m[2]) : null,
      alreadyAnnotated: ALREADY_ANNOTATED.test(rest),
      insideLink: /^\]\]/.test(rest),
    });
  }
  return found;
}

/**
 * 同じ節(== 見出し == から次の == 見出し == まで)で、同じ元号・同じ年へのリンクが2回目以降に出てきたら、
 * リンクを外して文字だけにする。最初の概要(最初の == 見出し == より前)は対象外。
 * 対象は「元号の記事へのリンク」と「[[1590年]] のような西暦年へのリンク」だけ。
 * 見出しの行は触らず、数にも入れない。=== 小見出し === は節を区切らない(親の節にまとめる)。
 * @param {string} text
 * @param {Object} [overrides] 元号のリンク先記事名の追加・上書き(設定 eraLinkTargets と同じ)
 * @returns {{text:string, removed:Array<{index:number,end:number,key:string,kind:'era'|'year',label:string}>}}
 */
function dedupeLinks(text, overrides = {}) {
  const eraTargets = new Map(); // 記事名 → 元号名
  for (const name of ERA_NAMES) eraTargets.set((overrides && overrides[name]) || ERA_LINK_TARGETS[name] || name, name);
  const isH2 = (line) => /^==(?!=).*(?<!=)==\s*$/.test(line);
  const isHeading = (line) => /^=+.*=+\s*$/.test(line);
  const removed = [];
  let seen = null; // null = 最初の概要(対象外)
  let offset = 0;
  for (const line of text.split('\n')) {
    if (isH2(line)) {
      seen = new Set();
    } else if (seen && !isHeading(line)) {
      const re = /\[\[([^\[\]|\n]+)(?:\|([^\[\]\n]*))?\]\]/g;
      let m;
      while ((m = re.exec(line)) !== null) {
        const target = m[1].trim().replace(/_/g, ' ');
        let kind = null;
        let key = null;
        if (/^[0-9]{3,4}年$/.test(target)) { kind = 'year'; key = target; }
        else if (eraTargets.has(target)) { kind = 'era'; key = eraTargets.get(target); }
        if (!kind) continue;
        const k = kind + ':' + key;
        if (!seen.has(k)) { seen.add(k); continue; }
        const label = m[2] === undefined ? m[1].trim() : m[2];
        if (label === '') continue; // [[X|]] のような特殊な書き方は触らない
        removed.push({ index: offset + m.index, end: offset + m.index + m[0].length, key, kind, label });
      }
    }
    offset += line.length + 1;
  }
  let out = '';
  let last = 0;
  for (const r of removed) { out += text.slice(last, r.index) + r.label; last = r.end; }
  out += text.slice(last);
  return { text: out, removed };
}

/**
 * 和暦の直後に西暦を併記したテキストを返す。
 * @param {string} text
 * @param {{paren?: 'fullwidth'|'halfwidth', linkYear?: boolean}} [opts]
 */
function annotate(text, opts = {}) {
  const items = findAll(text);
  let out = '';
  let last = 0;
  let converted = 0;
  const skipped = []; // 範囲外などで変換しなかったもの
  let already = 0;
  for (const it of items) {
    out += text.slice(last, it.end);
    last = it.end;
    if (it.insideLink) continue;
    if (it.alreadyAnnotated) { already++; continue; }
    if (!it.result.ok) { skipped.push(it); continue; }
    out += seirekiSuffix(it.result.year, opts);
    converted++;
  }
  out += text.slice(last);
  return { text: out, converted, skipped, already };
}

module.exports = {
  ERAS, ERA_NAMES, ERA_LINK_TARGETS, eraLink, insideOpenLink, INDEX, parseYear, convert, findAll, findRelative, dedupeLinks, annotate, seirekiSuffix, makeRegExp, ALREADY_ANNOTATED,
};
