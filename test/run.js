'use strict';
const assert = require('assert');
const Module = require('module');
const { convert, annotate, findAll, parseYear, seirekiSuffix } = require('../eras');

let pass = 0;
function t(name, fn) { try { fn(); pass++; } catch (e) { console.error('FAIL:', name, '\n  ', e.message); process.exitCode = 1; } }
const yr = (e, y) => { const r = convert(e, y); return r.ok ? r.year : r.reason; };

// ---- 変換コア ----
t('基本(江戸)', () => {
  assert.strictEqual(yr('天明', '3'), 1783);
  assert.strictEqual(yr('寛政', '12'), 1800);
  assert.strictEqual(yr('元禄', '16'), 1703);
  assert.strictEqual(yr('慶長', '5'), 1600);       // 関ヶ原
  assert.strictEqual(yr('天正', '18'), 1590);      // 小田原征伐
  assert.strictEqual(yr('文化', '元'), 1804);
  assert.strictEqual(yr('元和', '元'), 1615);
  assert.strictEqual(yr('明治', '4'), 1871);
});
t('年内改元で重なる年(元号の最終年 = 次の元号の元年)', () => {
  assert.strictEqual(yr('慶応', '4'), 1868);
  assert.strictEqual(yr('明治', '元'), 1868);
  assert.strictEqual(yr('天明', '9'), 1789);
  assert.strictEqual(yr('寛政', '元'), 1789);
  assert.strictEqual(yr('文政', '13'), 1830);
  assert.strictEqual(yr('天保', '元'), 1830);
  assert.strictEqual(yr('元文', '6'), 1741);
  assert.strictEqual(yr('寛保', '元'), 1741);
});
t('元号の長さを超える年は変換しない', () => {
  assert.strictEqual(yr('天明', '10'), 'out-of-range');
  assert.strictEqual(yr('万延', '3'), 'out-of-range');
  assert.strictEqual(yr('天保', '16'), 'out-of-range');
  assert.strictEqual(yr('天保', '15'), 1844);
  assert.strictEqual(yr('令和', '8'), 2026);       // 令和は上限なし
});
t('数字表記: 全角・漢数字', () => {
  assert.strictEqual(parseYear('１２'), 12);
  assert.strictEqual(parseYear('十二'), 12);
  assert.strictEqual(parseYear('二十'), 20);
  assert.strictEqual(parseYear('二十一'), 21);
  assert.strictEqual(parseYear('十'), 10);
  assert.strictEqual(parseYear('一二'), 12);
  assert.strictEqual(parseYear('十十'), null);
  assert.strictEqual(yr('寛政', '十二'), 1800);
  assert.strictEqual(yr('享保', '二十一'), 1736);
});
t('0年や不正は拒否', () => {
  assert.strictEqual(yr('天明', '0'), 'bad-year');
  assert.strictEqual(yr('天明', '〇'), 'bad-year');
  assert.strictEqual(yr('なし', '3'), 'unknown-era');
});

// ---- Wikipedia「日本の元号一覧」との照合 ----
// 同記事の「改元日(西暦)」列の年(応仁〜明治の52件、取得日 2026-10-13)。
const WIKI_START_YEARS = [1467,1469,1487,1489,1492,1501,1504,1521,1528,1532,1555,1558,1570,1573,1593,1596,
  1615,1624,1645,1648,1652,1655,1658,1661,1673,1681,1684,1688,1704,1711,1716,1736,1741,1744,1748,1751,
  1764,1772,1781,1789,1801,1804,1818,1831,1845,1848,1855,1860,1861,1864,1865,1868];
// 改元日が旧暦12月で新暦では翌年1月にあたる5元号。元年は和暦の年基準なので、改元日の西暦年より1年前。
const RETROACTIVE = new Set(['文禄', '正保', '天保', '弘化', '安政']);
t('Wikipediaの改元日の西暦年と一致(例外はRETROACTIVEの5元号のみ、かつ1年前)', () => {
  const { ERAS } = require('../eras');
  const upto = ERAS.findIndex((e) => e[0] === '明治') + 1;
  assert.strictEqual(upto, WIKI_START_YEARS.length);
  const diffs = [];
  ERAS.slice(0, upto).forEach(([name, start], i) => {
    if (start !== WIKI_START_YEARS[i]) diffs.push([name, start, WIKI_START_YEARS[i]]);
  });
  assert.deepStrictEqual(diffs.map((d) => d[0]).sort(), [...RETROACTIVE].sort());
  diffs.forEach(([name, start, wiki]) => assert.strictEqual(start, wiki - 1, name));
});
t('立年改元の5元号', () => {
  assert.strictEqual(yr('文禄', '元'), 1592);
  assert.strictEqual(yr('正保', '元'), 1644);
  assert.strictEqual(yr('天保', '元'), 1830);
  assert.strictEqual(yr('弘化', '元'), 1844);
  assert.strictEqual(yr('安政', '元'), 1854);
  assert.strictEqual(yr('天正', '20'), 1592);   // 天正20年 = 文禄元年
  assert.strictEqual(yr('嘉永', '7'), 1854);    // 嘉永7年 = 安政元年
});

// ---- 検出 ----
t('検出: 一般語を誤検出しない', () => {
  assert.strictEqual(findAll('文化財を守る。文明の発達。天正の頃。').length, 0);
  assert.strictEqual(findAll('平和な時代').length, 0);
  assert.strictEqual(findAll('[[文化財]]3年').length, 0);
});
t('検出: ウィキリンク付きの元号 [[天正]]18年', () => {
  const [m] = findAll('関白は[[天正]]18年に出陣。');
  assert.strictEqual(m.text, '[[天正]]18年');
  assert.strictEqual(m.era, '天正');
  assert.strictEqual(m.yearStr, '18');
  assert.strictEqual(m.linked, true);
  assert.strictEqual(m.result.year, 1590);
  assert.strictEqual(m.index, 3);
  assert.strictEqual(m.end, 3 + '[[天正]]18年'.length);
});
t('検出: パイプ付きリンク [[文化 (元号)|文化]]3年 と、リンクなしは linked=false', () => {
  const [a] = findAll('[[文化 (元号)|文化]]3年');
  assert.strictEqual(a.era, '文化');
  assert.strictEqual(a.linked, true);
  assert.strictEqual(a.result.year, 1806);
  const [b] = findAll('天正18年');
  assert.strictEqual(b.linked, false);
});
t('検出: リンクと平文が混在しても、それぞれ正しく拾う', () => {
  const r = findAll('[[天正]]18年と天明3年と[[寛政]]元年');
  assert.deepStrictEqual(r.map((m) => [m.era, m.linked]), [['天正', true], ['天明', false], ['寛政', true]]);
});

// ---- 併記 ----
t('併記: 基本と複数', () => {
  const r = annotate('天明3年の飢饉と寛政元年の改革。');
  assert.strictEqual(r.text, '天明3年（1783年）の飢饉と寛政元年（1789年）の改革。');
  assert.strictEqual(r.converted, 2);
});
t('併記: 半角括弧', () => {
  assert.strictEqual(annotate('文政10年', { paren: 'halfwidth' }).text, '文政10年(1827年)');
});
t('併記: 年にウィキリンクを付ける(linkYear)', () => {
  assert.strictEqual(annotate('天正18年', { linkYear: true }).text, '天正18年（[[1590年]]）');
  assert.strictEqual(annotate('[[天正]]18年に', { linkYear: true }).text, '[[天正]]18年（[[1590年]]）に');
  assert.strictEqual(annotate('[[天正]]18年に', { linkYear: false }).text, '[[天正]]18年（1590年）に');
  assert.strictEqual(annotate('[[天正]]18年', { linkYear: true, paren: 'halfwidth' }).text, '[[天正]]18年([[1590年]])');
});
t('併記: seirekiSuffix', () => {
  assert.strictEqual(seirekiSuffix(1590), '（1590年）');
  assert.strictEqual(seirekiSuffix(1590, { linkYear: true }), '（[[1590年]]）');
});
t('併記: 月日が続いても、年の直後にだけ付ける(月日は触らない)', () => {
  assert.strictEqual(annotate('嘉永6年6月3日').text, '嘉永6年（1853年）6月3日');
});
t('併記: 冪等(併記済みは再併記しない。年リンク付きの併記済みも認識する)', () => {
  const once = annotate('寛政12年').text;
  const twice = annotate(once);
  assert.strictEqual(twice.text, once);
  assert.strictEqual(twice.already, 1);
  assert.strictEqual(annotate('寛政12年(1800年)').text, '寛政12年(1800年)');
  assert.strictEqual(annotate('寛政12年（西暦1800年）').text, '寛政12年（西暦1800年）');
  for (const s of ['[[天正]]18年（[[1590年]]）', '天正18年（[[1590年]]）', '[[天正]]18年（1590年）']) {
    const r = annotate(s, { linkYear: true });
    assert.strictEqual(r.text, s, s);
    assert.strictEqual(r.already, 1, s);
  }
});
t('併記: リンクの文字列の中([[天正18年]])では何もしない(リンクを壊さない)', () => {
  assert.strictEqual(annotate('[[天正18年]]', { linkYear: true }).text, '[[天正18年]]');
});
t('併記: 範囲外は変換せず報告する', () => {
  const r = annotate('天明10年と天明3年');
  assert.strictEqual(r.text, '天明10年と天明3年（1783年）');
  assert.strictEqual(r.skipped.length, 1);
  assert.strictEqual(r.skipped[0].text, '天明10年');
});
t('併記: 全角数字・漢数字も元の表記を保つ', () => {
  assert.strictEqual(annotate('寛政１２年').text, '寛政１２年（1800年）');
  assert.strictEqual(annotate('寛政十二年').text, '寛政十二年（1800年）');
});

// ---- vscode をモックして拡張機能の振る舞いを確認 ----
class Position { constructor(l, c) { this.line = l; this.character = c; } translate(dl, dc) { return new Position(this.line + (dl || 0), this.character + (dc || 0)); } }
class Range {
  constructor(a, b, c, d) { if (typeof a === 'number') { this.start = new Position(a, b); this.end = new Position(c, d); } else { this.start = a; this.end = b; } }
  // 本物の vscode.Range と同じく、始点と終点が同じなら空
  get isEmpty() { return this.start.line === this.end.line && this.start.character === this.end.character; }
}
class Selection extends Range { constructor(a, b) { super(a, b); } get active() { return this.end; } }
class MarkdownString { constructor(v) { this.value = v; } }
class Hover { constructor(c, r) { this.contents = c; this.range = r; } }
class InlineCompletionItem { constructor(insertText, range) { this.insertText = insertText; this.range = range; } }

class Doc {
  constructor(text) { this.text = text; this.uri = { scheme: 'file', path: '/test' }; }
  get lines() { return this.text.split('\n'); }
  getText(r) { return r ? this.text.slice(this.offsetAt(r.start), this.offsetAt(r.end)) : this.text; }
  offsetAt(p) { const ls = this.lines; let o = 0; for (let i = 0; i < p.line; i++) o += ls[i].length + 1; return o + p.character; }
  positionAt(o) { const ls = this.lines; let rem = o; for (let i = 0; i < ls.length; i++) { if (rem <= ls[i].length) return new Position(i, rem); rem -= ls[i].length + 1; } return new Position(ls.length - 1, ls[ls.length - 1].length); }
  lineAt(n) { return { text: this.lines[n] }; }
}
function makeEditor(text, selection) {
  const doc = new Doc(text);
  return {
    document: doc,
    selection: selection || new Selection(new Position(0, 0), new Position(0, 0)),
    async edit(fn) {
      const ins = [];
      fn({
        insert: (pos, s) => ins.push({ o: doc.offsetAt(pos), e: doc.offsetAt(pos), s }),
        replace: (r, s) => ins.push({ o: doc.offsetAt(r.start), e: doc.offsetAt(r.end), s }),
      });
      ins.sort((a, b) => b.o - a.o).forEach((i) => { doc.text = doc.text.slice(0, i.o) + i.s + doc.text.slice(i.e); });
      return true;
    },
  };
}
const state = { config: {}, messages: [], hover: null, inline: null, command: null, editor: null, registered: [], change: null, executed: [], choice: undefined, closeOnDiff: false };
const noop = { dispose() {} };
const vscodeMock = {
  Uri: { parse: (s) => ({ toString: () => s, scheme: s.split(':')[0] }) }, Position, Range, Selection, MarkdownString, Hover, InlineCompletionItem,
  window: { showTextDocument: async (doc) => { const old = state.editor; if (state.closeOnDiff && old && old.document === doc) { const fresh = { document: doc, selection: old.selection, edit: old._origEdit }; state.editor = fresh; return fresh; } return old; }, onDidChangeTextEditorSelection: () => { state.registered.push('selection'); return noop; }, get activeTextEditor() { return state.editor; }, showInformationMessage: (m, ...btns) => { state.messages.push(m); return Promise.resolve(btns.length ? state.choice : undefined); } },
  workspace: { registerTextDocumentContentProvider: (s, p) => { state.contentProvider = p; state.registered.push('content'); return noop; }, onDidChangeTextDocument: (f) => { state.change = f; state.registered.push('change'); return noop; }, getConfiguration: () => ({ get: (k, d) => (k in state.config ? state.config[k] : d) }) },
  languages: {
    registerHoverProvider: (_s, p) => { state.hover = p; state.registered.push('hover'); return noop; },
    registerInlineCompletionItemProvider: (_s, p) => { state.inline = p; state.registered.push('inline'); return noop; },
  },
  commands: { executeCommand: async (c, ...a) => { state.executed.push([c, ...a]); if (c === 'vscode.diff' && state.closeOnDiff && state.editor) { state.editor._origEdit = state.editor.edit; state.editor.edit = async () => { throw new Error('TextEditor#edit not possible on closed editors'); }; } if (c === 'vscode.diff') state.diff = { before: state.contentProvider.provideTextDocumentContent(a[0]), after: state.contentProvider.provideTextDocumentContent(a[1]) }; }, registerCommand: (n, f) => { if (n.endsWith('dedupeLinks')) state.dedupe = f; else state.command = f; state.registered.push('command:' + n); return noop; } },
};
const origLoad = Module._load;
Module._load = function (req, ...rest) { return req === 'vscode' ? vscodeMock : origLoad.call(this, req, ...rest); };
const ext = require('../extension');
Module._load = origLoad;
state.config.previewDiff = false; // 既存のテストは、確認なしで適用する動き
ext.activate({ subscriptions: [] });

(async () => {
  t('登録: ホバー・インライン補完・併記コマンドだけ(クイックフィックスや点線ヒントは持たない)', () => {
    assert.deepStrictEqual(state.registered.sort(), ['change', 'command:warekiSeireki.annotate', 'command:warekiSeireki.dedupeLinks', 'command:warekiSeireki.linkEras', 'content', 'hover', 'inline', 'selection']);
  });

  // ---- インライン補完 ----
  const inlineAt = (text, ch, line = 0) => {
    const e = makeEditor(text); state.editor = e;
    return state.inline.provideInlineCompletionItems(e.document, new Position(line, ch));
  };
  t('インライン: 「年」の直後で、薄い文字として併記を提案する(挿入位置はカーソルのみ)', () => {
    state.config.linkYear = false;
    const r = inlineAt('将軍は天明3年', 7);
    delete state.config.linkYear;
    assert.strictEqual(r.length, 1);
    assert.strictEqual(r[0].insertText, '（1783年）');
    assert.deepStrictEqual([r[0].range.start.character, r[0].range.end.character], [7, 7]);
  });
  t('インライン: 既定では年にウィキリンクを付ける', () => {
    assert.strictEqual(inlineAt('天正18年', 5)[0].insertText, '（[[1590年]]）');
  });
  t('インライン: リンク付きの元号 [[天正]]18年 でも提案する(元号側は触らない)', () => {
    const r = inlineAt('[[天正]]18年', '[[天正]]18年'.length);
    assert.strictEqual(r[0].insertText, '（[[1590年]]）');
    assert.strictEqual(r[0].range.start.character, 9);
    assert.strictEqual(inlineAt('[[文化 (元号)|文化]]3年', '[[文化 (元号)|文化]]3年'.length)[0].insertText, '（[[1806年]]）');
  });
  t('インライン: 文章の途中(「年」の直後で続きがある)でも提案する', () => {
    assert.strictEqual(inlineAt('将軍は[[天正]]18年に就任。', 3 + '[[天正]]18年'.length)[0].insertText, '（[[1590年]]）');
    assert.strictEqual(inlineAt('将軍は天明3年に就任。', 7)[0].insertText, '（[[1783年]]）');
  });
  t('インライン: 「年」の直後以外・併記済み・範囲外・一般語・リンク内では出さない', () => {
    assert.strictEqual(inlineAt('将軍は天明3年に就任。', 6), undefined);   // 「年」の手前
    assert.strictEqual(inlineAt('将軍は天明3年に就任。', 8), undefined);   // 「に」の後
    assert.strictEqual(inlineAt('天明3年（1783年）', 4), undefined);        // 併記済み
    assert.strictEqual(inlineAt('[[天正]]18年（[[1590年]]）', 9), undefined); // リンク付きで併記済み
    assert.strictEqual(inlineAt('天明10年', 5), undefined);                 // 範囲外
    assert.strictEqual(inlineAt('来年', 2), undefined);                     // 和暦ではない
    assert.strictEqual(inlineAt('[[文化財]]3年', 9), undefined);            // 元号ではない
    assert.strictEqual(inlineAt('[[天正18年]]', 8), undefined);             // リンクの文字列の中
  });
  t('インライン: 漢数字・「元年」・改元の年にも対応', () => {
    assert.strictEqual(inlineAt('寛政十二年', 5)[0].insertText, '（[[1800年]]）');
    assert.strictEqual(inlineAt('文化元年', 4)[0].insertText, '（[[1804年]]）');
    assert.strictEqual(inlineAt('慶応4年', 4)[0].insertText, '（[[1868年]]）');
  });
  t('インライン: 設定(年リンクのオフ・半角括弧・補完のオフ)', () => {
    state.config.linkYear = false;
    assert.strictEqual(inlineAt('[[天正]]18年', 9)[0].insertText, '（1590年）');
    state.config.parenStyle = 'halfwidth';
    assert.strictEqual(inlineAt('文政10年', 5)[0].insertText, '(1827年)');
    delete state.config.parenStyle; delete state.config.linkYear;
    state.config.inlineSuggestion = false;
    assert.strictEqual(inlineAt('文政10年', 5), undefined);
    delete state.config.inlineSuggestion;
  });
  t('インライン: 複数行でも、カーソルのある行だけを見る', () => {
    const r = inlineAt('天明3年（1783年）\n寛政元年', 4, 1);
    assert.strictEqual(r[0].insertText, '（[[1789年]]）');
  });

  // ---- ホバー ----
  t('ホバー: 和暦の上で西暦を出す/外れたら出さない', () => {
    const ed = makeEditor('将軍は天明3年に就任。'); state.editor = ed;
    const h = state.hover.provideHover(ed.document, new Position(0, 4)); // 「天明3年」の「明」付近
    assert.ok(h && h.contents.value.includes('1783年'));
    assert.deepStrictEqual([h.range.start.character, h.range.end.character], [3, 7]);
    assert.strictEqual(state.hover.provideHover(ed.document, new Position(0, 1)), undefined);
  });
  t('ホバー: リンク付き [[天正]]18年 は、リンク記号を含む範囲で出し、表示は記号なし', () => {
    const ed = makeEditor('[[天正]]18年'); state.editor = ed;
    const h = state.hover.provideHover(ed.document, new Position(0, 4));
    assert.ok(h.contents.value.includes('**天正18年** = **1590年**'));
    assert.deepStrictEqual([h.range.start.character, h.range.end.character], [0, 9]);
  });
  t('ホバー: 範囲外は注意を出す', () => {
    const ed = makeEditor('天明10年'); state.editor = ed;
    const h = state.hover.provideHover(ed.document, new Position(0, 1));
    assert.ok(h.contents.value.includes('9 年まで'));
  });

  // ---- 併記コマンド(まとめて) ----
  state.messages.length = 0;
  let ed = makeEditor('天明3年の飢饉。\n[[寛政]]元年の改革。\n天明10年は不正。'); state.editor = ed;
  state.config.linkYear = false;
  await state.command();
  t('コマンド(全文): 併記と報告(リンク付き元号も)', () => {
    assert.strictEqual(ed.document.text, '天明3年（1783年）の飢饉。\n[[寛政]]元年（1789年）の改革。\n天明10年は不正。');
    assert.ok(state.messages[0].includes('2件に西暦を併記'));
    assert.ok(state.messages[0].includes('1件は元号の範囲外'));
  });
  state.messages.length = 0;
  const before = ed.document.text;
  await state.command();
  t('コマンド: 2回目は冪等', () => {
    assert.strictEqual(ed.document.text, before);
    assert.ok(state.messages[0].includes('0件に西暦を併記'));
    assert.ok(state.messages[0].includes('2件は併記済み'));
  });
  delete state.config.linkYear;
  ed = makeEditor('[[天正]]18年。天明3年。', new Selection(new Position(0, 0), new Position(0, 11))); state.editor = ed;
  await state.command();
  t('コマンド(選択範囲のみ): 選択外は触らない。年リンクは既定でオン', () => {
    assert.strictEqual(ed.document.text, '[[天正]]18年（[[1590年]]）。天明3年。');
  });
  state.config.parenStyle = 'halfwidth';
  ed = makeEditor('文政10年'); state.editor = ed; await state.command();
  t('コマンド: 半角括弧', () => { assert.strictEqual(ed.document.text, '文政10年([[1827年]])'); });
  delete state.config.parenStyle;


  // ---- 元号の自動リンク ----
  t('eraLink', () => {
    const { eraLink } = require('../eras');
    assert.strictEqual(eraLink('天正'), '[[天正]]');
    assert.strictEqual(eraLink('文化'), '[[文化 (元号)|文化]]');
    assert.strictEqual(eraLink('元和'), '[[元和 (日本)|元和]]');
    assert.strictEqual(eraLink('天和'), '[[天和 (日本)|天和]]');
    assert.strictEqual(eraLink('安永'), '[[安永 (元号)|安永]]');
    assert.strictEqual(eraLink('寛政'), '[[寛政]]');
    assert.strictEqual(eraLink('寛政', { 寛政: '寛政 (仮)' }), '[[寛政 (仮)|寛政]]');
    assert.strictEqual(Object.keys(require('../eras').ERA_LINK_TARGETS).length, 8);
  });
  const linkAt = async (text, col, cfg = {}) => {
    Object.assign(state.config, cfg);
    const ed = makeEditor(text); state.editor = ed;
    const p = new Position(0, col === undefined ? text.length : col);
    ed.selection = new Selection(p, p);
    const r = await ext.linkEraAtCursor(ed);
    linkAt.cursor = ed.selection.active.character;
    for (const k of Object.keys(cfg)) delete state.config[k];
    return [r, ed.document.text];
  };
  assert.deepStrictEqual(await linkAt('天正18年'), [true, '[[天正]]18年（[[1590年]]）']);
  assert.deepStrictEqual(await linkAt('彼は文化3年'), [true, '彼は[[文化 (元号)|文化]]3年（[[1806年]]）']);
  assert.deepStrictEqual(await linkAt('[[天正]]18年'), [false, '[[天正]]18年']);
  assert.deepStrictEqual(await linkAt('[[天正18年'), [false, '[[天正18年']);
  assert.deepStrictEqual(await linkAt('天明10年'), [false, '天明10年']);
  assert.deepStrictEqual(await linkAt('文化財3年'), [false, '文化財3年']);
  assert.deepStrictEqual(await linkAt('天正18年', undefined, { autoLinkEra: false }), [false, '天正18年']);
  assert.deepStrictEqual(await linkAt('天正18年です', 5), [true, '[[天正]]18年（[[1590年]]）です']); // 後ろに文字があっても、カーソル直前なら
  assert.deepStrictEqual(await linkAt('天正18年です', 8), [false, '天正18年です']);   // カーソルが離れていれば何もしない
  assert.deepStrictEqual(await linkAt('天正18年', undefined, { autoAnnotateWithLink: false }), [true, '[[天正]]18年']);
  assert.deepStrictEqual(await linkAt('天正18年（1590年）', 5), [true, '[[天正]]18年（1590年）']); // 併記済みなら足さない
  assert.deepStrictEqual(await linkAt('天正18年', undefined, { linkYear: false, parenStyle: 'halfwidth' }), [true, '[[天正]]18年(1590年)']);
  await linkAt('天正18年');
  assert.strictEqual(linkAt.cursor, '[[天正]]18年（[[1590年]]）'.length); // カーソルは文末へ
  { // 一括コマンド
    const ed = makeEditor('天正18年と[[寛政]]元年と文化3年と天明10年'); state.editor = ed;
    await ext.linkErasCommand();
    assert.strictEqual(ed.document.text, '[[天正]]18年と[[寛政]]元年と[[文化 (元号)|文化]]3年と天明10年');
  }
  t('登録に自動リンク用のイベント・コマンドがある', () => {
    assert.ok(state.registered.includes('selection'));
    assert.ok(state.registered.includes('command:warekiSeireki.linkEras'));
  });

  // ---- 「同〇年」「翌〇年」 ----
  const { findRelative } = require('../eras');
  t('同・翌: 直前の元号を引き継いで西暦にする', () => {
    const r = findRelative('文化2年に着任し、翌3年に昇進、同5年に没した。');
    assert.deepStrictEqual(r.map((x) => [x.text, x.era, x.result.year]), [['翌3年', '文化', 1806], ['同5年', '文化', 1808]]);
  });
  t('同・翌: 直前に出た元号を使う(複数あるとき)・リンク付き・漢数字・元年', () => {
    const r = findRelative('[[文化 (元号)|文化]]2年、[[文政]]元年、同三年、翌十年');
    assert.deepStrictEqual(r.map((x) => [x.text, x.era, x.result.year]), [['同三年', '文政', 1820], ['翌十年', '文政', 1827]]);
  });
  t('同・翌: 前の行(同じ段落)から引き継ぐ・元号がなければ結果なし・範囲外', () => {
    assert.strictEqual(findRelative('同3年に', '天明2年\n本文')[0].result.year, 1783);
    assert.strictEqual(findRelative('同3年に')[0].result, null);
    assert.strictEqual(findRelative('同12年に', '天明2年')[0].result.reason, 'out-of-range');
    assert.deepStrictEqual(findRelative('翌年、同年'), []); // 数字がないものは対象外
  });
  t('同・翌: 併記済みは alreadyAnnotated', () => {
    assert.strictEqual(findRelative('同3年（1783年）', '天明2年')[0].alreadyAnnotated, true);
  });
  t('インライン: 同3年・翌3年の直後で西暦を提案する(同じ段落の直前の元号を引き継ぐ)', () => {
    state.config.linkYear = false;
    const a = inlineAt('文化2年に着任し、同5年', 12);
    const b = inlineAt('文化2年に着任。\n翌3年', 3, 1);
    const c = inlineAt('文化2年に着任。\n\n翌3年', 3, 2);   // 空行で段落が変わる
    const d = inlineAt('翌3年', 3);                           // 元号なし
    const e = inlineAt('文化2年、同16年', 9);                   // 範囲外
    delete state.config.linkYear;
    assert.strictEqual(a[0].insertText, '（1808年）');
    assert.strictEqual(b[0].insertText, '（1806年）');
    assert.strictEqual(c, undefined);
    assert.strictEqual(d, undefined);
    assert.strictEqual(e, undefined);
  });
  t('ホバー: 同3年に、引き継いだ元号と西暦を出す', () => {
    const ed = makeEditor('文化2年、同5年'); state.editor = ed;
    const h = state.hover.provideHover(ed.document, new Position(0, 7));
    assert.ok(h.contents.value.includes('文化5年') && h.contents.value.includes('1808年'));
    assert.deepStrictEqual([h.range.start.character, h.range.end.character], [5, 8]);
  });

  // ---- 「同〇年」の自動挿入 ----
  const relAt = async (text, line, col, cfg = {}) => {
    Object.assign(state.config, cfg);
    const ed = makeEditor(text); state.editor = ed;
    const p = new Position(line, col);
    ed.selection = new Selection(p, p);
    const r = await ext.annotateRelativeAtCursor(ed);
    for (const k of Object.keys(cfg)) delete state.config[k];
    return [r, ed.document.text, ed.selection.active.character];
  };
  assert.deepStrictEqual(await relAt('文化2年に着任し、同5年', 0, 12), [true, '文化2年に着任し、同5年（[[1808年]]）', 23]);
  assert.deepStrictEqual(await relAt('文化2年に着任。\n翌3年', 1, 3), [true, '文化2年に着任。\n翌3年（[[1806年]]）', 14]);
  assert.deepStrictEqual(await relAt('翌3年', 0, 3), [false, '翌3年', 3]);                  // 元号なし
  assert.deepStrictEqual(await relAt('文化2年、同5年', 0, 8), [true, '文化2年、同5年（[[1808年]]）', 19]);
  assert.deepStrictEqual(await relAt('文化2年、同5年（1808年）', 0, 8), [false, '文化2年、同5年（1808年）', 8]);
  assert.deepStrictEqual(await relAt('文化2年、同5年', 0, 8, { autoAnnotateRelative: false }), [false, '文化2年、同5年', 8]);

  // ---- 重複リンクの整理 ----
  const { dedupeLinks } = require('../eras');
  const doc1 = [
    '[[天正]]18年（[[1590年]]）に[[天正]]19年。',
    '',
    '== 経歴 ==',
    '[[天正]]3年（[[1575年]]）。[[天正]]4年（[[1576年]]）。[[織田信長]]と[[織田信長]]。',
    '=== 小見出し ===',
    '[[文化 (元号)|文化]]2年（[[1805年]]）、[[文化]]の発展、[[文化 (元号)|文化]]3年（[[1575年]]）。',
    '== 晩年 ==',
    '[[天正]]5年（[[1577年]]）、[[1575年]]、[[天正]]6年。',
  ].join('\n');
  t('重複リンク: 最初の概要は触らず、節(== ==)ごとに初出だけ残す', () => {
    assert.strictEqual(dedupeLinks(doc1).text, [
      '[[天正]]18年（[[1590年]]）に[[天正]]19年。',
      '',
      '== 経歴 ==',
      '[[天正]]3年（[[1575年]]）。天正4年（[[1576年]]）。[[織田信長]]と[[織田信長]]。',
      '=== 小見出し ===',
      '[[文化 (元号)|文化]]2年（[[1805年]]）、[[文化]]の発展、文化3年（1575年）。',
      '== 晩年 ==',
      '[[天正]]5年（[[1577年]]）、[[1575年]]、天正6年。',
    ].join('\n'));
  });
  t('重複リンク: 元号・年以外のリンクと、[[文化]](文化の記事)は対象外・件数と種類', () => {
    const r = dedupeLinks(doc1);
    assert.deepStrictEqual(r.removed.map((x) => x.kind + ':' + x.key), ['era:天正', 'era:文化', 'year:1575年', 'era:天正']);
  });
  t('重複リンク: 見出しの行は触らない・設定の上書きに対応・何度実行しても同じ', () => {
    const d = '導入\n== [[天正]]の頃 ==\n[[天正]]3年と[[天正]]4年\n== B ==\n[[元和 (日本)|元和]]元年、[[元和 (日本)|元和]]2年';
    assert.strictEqual(dedupeLinks(d).text, '導入\n== [[天正]]の頃 ==\n[[天正]]3年と天正4年\n== B ==\n[[元和 (日本)|元和]]元年、元和2年');
    assert.strictEqual(dedupeLinks('x\n== A ==\n[[元和 (X)|元和]]1年[[元和 (X)|元和]]2年', { 元和: '元和 (X)' }).text, 'x\n== A ==\n[[元和 (X)|元和]]1年元和2年');
    const once = dedupeLinks(doc1).text;
    assert.strictEqual(dedupeLinks(once).text, once);
  });
  { const ed = makeEditor(doc1); state.editor = ed; await state.dedupe();
    t('重複リンクのコマンド: 全文に適用して件数を知らせる', () => {
      assert.ok(ed.document.text.includes('天正4年（[[1576年]]）') && !ed.document.text.includes('[[天正]]4年'));
      assert.ok(state.messages[state.messages.length - 1].includes('4件'));
    });
    const ed2 = makeEditor(doc1); state.editor = ed2;
    ed2.selection = new Selection(ed2.document.positionAt(doc1.indexOf('== 晩年')), ed2.document.positionAt(doc1.length));
    await state.dedupe();
    t('重複リンクのコマンド: 選択範囲だけに適用', () => {
      assert.ok(ed2.document.text.includes('[[天正]]4年'));      // 範囲外は残る
      assert.ok(ed2.document.text.endsWith('[[1575年]]、天正6年。'));
    });
  }

  // ---- 差分の確認 ----
  delete state.config.previewDiff; // 既定(オン)に戻す
  { const ed = makeEditor('天明3年と天明4年。'); state.editor = ed;
    state.executed.length = 0; state.choice = 'キャンセル';
    await state.command();
    t('差分: 併記コマンドは差分を開かず、すぐ適用する', () => {
      assert.strictEqual(ed.document.text, '天明3年（[[1783年]]）と天明4年（[[1784年]]）。');
      assert.ok(!state.executed.some((x) => x[0] === 'vscode.diff'));
    });
  }
  { const ed = makeEditor(doc1); state.editor = ed; state.choice = 'キャンセル'; await state.dedupe();
    t('差分: 重複リンクの整理は、差分を開き、キャンセルで書き換えない', () => {
      assert.strictEqual(ed.document.text, doc1);
      assert.strictEqual(state.diff.before, doc1);
      assert.ok(state.diff.after.includes('天正4年（[[1576年]]）') && !state.diff.after.includes('[[天正]]4年'));
    });
    state.closeOnDiff = true; // 差分を開くと元のエディタが閉じた扱いになる(本物の動作)
    state.choice = '適用'; await state.dedupe();
    state.closeOnDiff = false;
    t('差分: 重複リンクの整理を適用(差分で元のエディタが閉じても編集できる)', () => { assert.ok(ed.document.text.includes('天正4年（[[1576年]]）')); });
  }
  state.config.previewDiff = false;

  console.log(`${pass} 件のテストが成功${process.exitCode ? '(失敗あり)' : ''}`);
})();
