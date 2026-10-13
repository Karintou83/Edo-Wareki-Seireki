'use strict';
const vscode = require('vscode');
const { findAll, findRelative, dedupeLinks, INDEX, seirekiSuffix, eraLink } = require('./eras');

const SELECTOR = [{ scheme: 'file' }, { scheme: 'untitled' }, { scheme: 'vscode-userdata' }];

/** 設定を読み、併記する文字列の作り方(括弧・年リンク)を返す */
function suffixOptions() {
  const cfg = vscode.workspace.getConfiguration('warekiSeireki');
  return {
    paren: cfg.get('parenStyle', 'fullwidth'),
    linkYear: cfg.get('linkYear', true),
  };
}

function hoverText(item) {
  const r = item.result;
  const label = `${item.era}${item.yearStr}年`;  // [[ ]] を除いた表記
  if (r.ok) {
    return new vscode.MarkdownString(
      `**${label}** = **${r.year}年**\n\n` +
      `<small>年のみの対応(旧暦の月日は扱いません)。旧暦12月は新暦の翌年にあたることがあります。</small>`
    );
  }
  if (r.reason === 'out-of-range') {
    const era = INDEX.get(item.era);
    return new vscode.MarkdownString(
      `**${label}**: ${item.era}は ${r.maxYear} 年までです(元年 = ${era.start}年)。`
    );
  }
  return undefined;
}


/** 同じ段落(空行・見出し行で区切る)で、指定した行より前の部分を、改行でつないで返す */
function paragraphBefore(document, line) {
  const parts = [];
  for (let i = line - 1; i >= 0; i--) {
    const t = document.lineAt(i).text;
    if (t.trim() === '') break;
    parts.unshift(t);
    if (/^=+.*=+\s*$/.test(t)) break; // 見出し行は含めて、そこで止める
  }
  return parts.join('\n');
}

function relativeHoverText(item) {
  if (!item.result) return undefined;
  const label = `${item.prefix}${item.yearStr}年`;
  if (item.result.ok) {
    return new vscode.MarkdownString(
      `**${label}** = ${item.era}${item.yearStr}年 = **${item.result.year}年**\n\n` +
      `<small>同じ段落で直前に出る元号(${item.era})を引き継いでいます。年のみの対応です。</small>`
    );
  }
  if (item.result.reason === 'out-of-range') {
    return new vscode.MarkdownString(`**${label}**: 直前の元号 ${item.era} は ${item.result.maxYear} 年までです。`);
  }
  return undefined;
}

/** マウスを合わせた位置にある和暦表記の西暦を、吹き出しで見せる(見るだけ) */
function hoverProvider() {
  return {
    provideHover(document, position) {
      const line = document.lineAt(position.line).text;
      const inRange = (m) => m.index <= position.character && position.character < m.end;
      let hit = findAll(line).find(inRange);
      let md;
      if (hit) {
        md = hoverText(hit);
      } else {
        hit = findRelative(line, paragraphBefore(document, position.line)).find(inRange);
        if (hit) md = relativeHoverText(hit);
      }
      if (!hit) return undefined;
      if (!md) return undefined;
      md.supportHtml = true;
      const range = new vscode.Range(position.line, hit.index, position.line, hit.end);
      return new vscode.Hover(md, range);
    },
  };
}

/**
 * インライン補完。和暦の「年」の直後にカーソルがあるとき、
 * カーソルの先に薄い文字で「（1590年）」または「（[[1590年]]）」を見せ、Tab キーで受け入れると入力される。
 * 受け入れるまでは文章は変わらない。
 *
 * インライン補完はカーソルより後ろにしか文字を足せないため、元号側の [[ ]] は付けられない。
 * リンク付きの元号([[天正]]18年)も、リンクなしの元号(天正18年)も、直後に足す文字は同じ。
 */
function inlineProvider() {
  return {
    provideInlineCompletionItems(document, position) {
      const cfg = vscode.workspace.getConfiguration('warekiSeireki');
      if (!cfg.get('inlineSuggestion', true)) return undefined;
      const lineText = document.lineAt(position.line).text;
      // カーソルの直前が、ちょうど和暦の「年」で終わっているものだけ
      let hit = findAll(lineText).find((m) => m.end === position.character);
      if (!hit) {
        // 「同3年」「翌3年」: 同じ段落の直前の元号を引き継ぐ
        hit = findRelative(lineText, paragraphBefore(document, position.line)).find((m) => m.end === position.character);
      }
      if (!hit || !hit.result || !hit.result.ok || hit.alreadyAnnotated || hit.insideLink) return undefined;
      const text = seirekiSuffix(hit.result.year, suffixOptions());
      return [new vscode.InlineCompletionItem(text, new vscode.Range(position, position))];
    },
  };
}


/**
 * カーソルの直前が「リンクなしの元号+年」で終わっていれば、元号部分だけを [[天正]] に書き換える。
 * 書き換えたら true。カーソルより前の編集なので、カーソル位置は保たれる。
 */
async function linkEraAtCursor(editor) {
  const cfg = vscode.workspace.getConfiguration('warekiSeireki');
  if (!cfg.get('autoLinkEra', true)) return false;
  if (!editor || !editor.selection || !editor.selection.isEmpty) return false;
  const pos = editor.selection.active;
  const lineText = editor.document.lineAt(pos.line).text;
  const hit = findAll(lineText).find((m) => m.end === pos.character);
  if (!hit || hit.linked || hit.inOpenLink || !hit.result.ok) return false;
  const link = eraLink(hit.era, cfg.get('eraLinkTargets', {}));
  const range = new vscode.Range(pos.line, hit.index, pos.line, hit.eraEnd);
  // 元号のリンクと同時に、西暦も実際に挿入する(設定でオフにできる)。併記済みなら足さない。
  const suffix = cfg.get('autoAnnotateWithLink', true) && !hit.alreadyAnnotated
    ? seirekiSuffix(hit.result.year, suffixOptions()) : '';
  const ok = await editor.edit((eb) => {
    eb.replace(range, link);
    if (suffix) eb.insert(pos, suffix);
  }, { undoStopBefore: false, undoStopAfter: false });
  if (ok) {
    // カーソルを、書き換え後の文末(「年」または併記した「）」)の後ろに置く
    const col = pos.character + (link.length - hit.era.length) + suffix.length;
    const np = new vscode.Position(pos.line, col);
    editor.selection = new vscode.Selection(np, np);
    if (!suffix && vscode.commands.executeCommand) {
      // 書き換えで薄い文字の候補が消えるので、もう一度出す
      try { await vscode.commands.executeCommand('editor.action.inlineSuggest.trigger'); } catch (_) { /* 無視 */ }
    }
  }
  return !!ok;
}


/**
 * カーソルの直前が「同3年」「翌3年」で終わっていれば、同じ段落の直前の元号を引き継いで、西暦を挿入する。
 * (薄い文字の候補は、他のAI補完と競合して出ないことがあるため、実際に挿入する方式も用意している)
 */
async function annotateRelativeAtCursor(editor) {
  const cfg = vscode.workspace.getConfiguration('warekiSeireki');
  if (!cfg.get('autoAnnotateRelative', true)) return false;
  if (!editor || !editor.selection || !editor.selection.isEmpty) return false;
  const pos = editor.selection.active;
  const lineText = editor.document.lineAt(pos.line).text;
  const hit = findRelative(lineText, paragraphBefore(editor.document, pos.line)).find((m) => m.end === pos.character);
  if (!hit || !hit.result || !hit.result.ok || hit.alreadyAnnotated || hit.insideLink) return false;
  const suffix = seirekiSuffix(hit.result.year, suffixOptions());
  const ok = await editor.edit((eb) => eb.insert(pos, suffix), { undoStopBefore: false, undoStopAfter: false });
  if (ok) {
    const np = new vscode.Position(pos.line, pos.character + suffix.length);
    editor.selection = new vscode.Selection(np, np);
  }
  return !!ok;
}

/**
 * 自動リンク。入力が止まって少し待ってから(既定 600ms)、カーソル直前の元号を調べる。
 * 日本語入力(IME)の変換中に文章を書き換えると入力が壊れるおそれがあるため、すぐには動かさない。
 * 貼り付けなど、1回で2文字以上が入った変更は対象外。
 */
function autoLinkScheduler() {
  let timer = null;
  const schedule = () => {
    const cfg = vscode.workspace.getConfiguration('warekiSeireki');
    if (!cfg.get('autoLinkEra', true) && !cfg.get('autoAnnotateRelative', true)) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(async () => {
      timer = null;
      const editor = vscode.window.activeTextEditor;
      try {
        if (!(await linkEraAtCursor(editor))) await annotateRelativeAtCursor(editor);
      } catch (_) { /* 無視 */ }
    }, cfg.get('autoLinkDelayMs', 600));
  };
  return {
    onChange(e) {
      const editor = vscode.window.activeTextEditor;
      if (!editor || editor.document !== e.document) return;
      if (e.contentChanges.length !== 1) return;
      const ch = e.contentChanges[0];
      if (ch.rangeLength === 0 && ch.text.length > 1) return; // 貼り付け
      schedule();
    },
    // 日本語入力の確定(Enter)では文章の変更が起きないことがあるので、カーソルの移動も見る
    onSelection(e) { if (e.textEditor === vscode.window.activeTextEditor) schedule(); },
    dispose() { if (timer) clearTimeout(timer); },
  };
}

// ---- 差分の確認つきで一括編集を適用する ----
const PREVIEW_SCHEME = 'wareki-preview';
const previewStore = new Map(); // uri 文字列 → 内容
let previewSeq = 0;
function previewProvider() {
  return { provideTextDocumentContent: (uri) => previewStore.get(uri.toString()) || '' };
}

/**
 * 編集の一覧(文書全体の文字位置 start/end と置き換える文字 text)を適用する。
 * preview が true で、設定 previewDiff がオン(既定)なら、まず「変更前 ↔ 変更後」の差分を開き、「適用」を押したときだけ書き換える。
 * 適用した/したことにする(プレビューなし)なら true。
 * @param {string} done 適用したあとに出すメッセージ
 */
async function applyEdits(editor, edits, done, summary, { preview = false } = {}) {
  const doc = editor.document;
  const apply = async (ed = editor) => {
    await ed.edit((eb) => {
      for (const x of edits) eb.replace(new vscode.Range(doc.positionAt(x.start), doc.positionAt(x.end)), x.text);
    });
    vscode.window.showInformationMessage(done);
    return true;
  };
  if (!preview || !vscode.workspace.getConfiguration('warekiSeireki').get('previewDiff', true)) return apply();

  const before = doc.getText();
  const sorted = [...edits].sort((a, b) => a.start - b.start);
  let after = '';
  let last = 0;
  for (const x of sorted) { after += before.slice(last, x.start) + x.text; last = x.end; }
  after += before.slice(last);

  const id = ++previewSeq;
  const left = vscode.Uri.parse(`${PREVIEW_SCHEME}:/変更前-${id}`);
  const right = vscode.Uri.parse(`${PREVIEW_SCHEME}:/変更後-${id}`);
  previewStore.set(left.toString(), before);
  previewStore.set(right.toString(), after);
  await vscode.commands.executeCommand('vscode.diff', left, right, `差分の確認: ${summary}`);
  const choice = await vscode.window.showInformationMessage(`${summary}。差分を確認して、よければ「適用」を押してください。`, '適用', 'キャンセル');
  // 差分のタブを閉じる(いま開いているのが差分のタブのときだけ)
  try {
    const tab = vscode.window.tabGroups && vscode.window.tabGroups.activeTabGroup.activeTab;
    if (tab && tab.input && tab.input.modified && tab.input.modified.scheme === PREVIEW_SCHEME) {
      await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
    }
  } catch (_) { /* 無視 */ }
  previewStore.delete(left.toString());
  previewStore.delete(right.toString());
  if (choice !== '適用') return false;
  // 差分を開いている間に元のエディタは閉じた扱いになるため、文書を開き直して、新しいエディタで編集する
  // (古いエディタのまま edit すると「TextEditor#edit not possible on closed editors」になる)
  const reopened = await vscode.window.showTextDocument(doc);
  return apply(reopened || editor);
}

/** 選択範囲(なければ全文)の、リンクなしの元号をまとめて [[ ]] で囲む */
async function linkErasCommand() {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return;
  const doc = editor.document;
  const sel = editor.selection;
  const range = sel.isEmpty
    ? new vscode.Range(doc.positionAt(0), doc.positionAt(doc.getText().length))
    : sel;
  const base = doc.offsetAt(range.start);
  const text = doc.getText(range);
  const targets = vscode.workspace.getConfiguration('warekiSeireki').get('eraLinkTargets', {});
  const edits = findAll(text)
    .filter((m) => !m.linked && !m.inOpenLink && m.result.ok)
    .map((m) => ({ start: base + m.index, end: base + m.eraEnd, text: eraLink(m.era, targets) }));
  if (edits.length === 0) { vscode.window.showInformationMessage('リンクを付ける元号はありません'); return; }
  await applyEdits(editor, edits, `${edits.length}件の元号にリンクを付けました`, `元号${edits.length}件にリンクを付ける`);
}

/** 選択範囲(なければ全文)の和暦の直後に、まとめて西暦を併記する */
async function annotateCommand() {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return;
  const doc = editor.document;
  const sel = editor.selection;
  const range = sel.isEmpty
    ? new vscode.Range(doc.positionAt(0), doc.positionAt(doc.getText().length))
    : sel;
  const base = doc.offsetAt(range.start);
  const text = doc.getText(range);
  const opts = suffixOptions();

  // 全文を置換せず、各和暦の直後に挿入だけ行う(カーソル位置・折りたたみ・差分表示を保つため)
  const inserts = [];
  const skipped = [];
  let already = 0;
  for (const it of findAll(text)) {
    if (it.insideLink) continue;
    if (it.alreadyAnnotated) { already++; continue; }
    if (!it.result.ok) { skipped.push(it); continue; }
    inserts.push({ start: base + it.end, end: base + it.end, text: seirekiSuffix(it.result.year, opts) });
  }

  const parts = [`${inserts.length}件に西暦を併記しました`];
  if (already) parts.push(`${already}件は併記済み`);
  if (skipped.length) {
    const names = skipped.slice(0, 3).map((s) => `${s.era}${s.yearStr}年`).join('、');
    parts.push(`${skipped.length}件は元号の範囲外で未変換(${names}${skipped.length > 3 ? ' ほか' : ''})`);
  }
  if (inserts.length > 0) {
    await applyEdits(editor, inserts, parts.join(' / '), `西暦を${inserts.length}件併記する`);
  } else {
    vscode.window.showInformationMessage(parts.join(' / '));
  }
}

/** 同じ節で2回目以降の元号・年へのリンクを外す(最初の概要は対象外)。選択範囲があればその範囲だけ。 */
async function dedupeLinksCommand() {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return;
  const doc = editor.document;
  const targets = vscode.workspace.getConfiguration('warekiSeireki').get('eraLinkTargets', {});
  // 節の判定は全文で行い、選択範囲があるときは、その範囲内のリンクだけを外す
  const { removed } = dedupeLinks(doc.getText(), targets);
  const sel = editor.selection;
  const lo = sel.isEmpty ? 0 : doc.offsetAt(sel.start);
  const hi = sel.isEmpty ? Infinity : doc.offsetAt(sel.end);
  const todo = removed.filter((r) => r.index >= lo && r.end <= hi);
  if (todo.length === 0) {
    vscode.window.showInformationMessage('外すリンクはありません(最初の概要は対象外です)');
    return;
  }
  const eras = todo.filter((r) => r.kind === 'era').length;
  await applyEdits(
    editor,
    todo.map((r) => ({ start: r.index, end: r.end, text: r.label })),
    `重複リンクを${todo.length}件外しました(元号 ${eras}件・年 ${todo.length - eras}件)。元に戻すには Ctrl+Z`,
    `重複リンク${todo.length}件を外す(元号 ${eras}・年 ${todo.length - eras})`,
    { preview: true }
  );
}

function activate(context) {
  const auto = autoLinkScheduler();
  context.subscriptions.push(
    vscode.languages.registerHoverProvider(SELECTOR, hoverProvider()),
    vscode.languages.registerInlineCompletionItemProvider(SELECTOR, inlineProvider()),
    vscode.workspace.onDidChangeTextDocument((e) => auto.onChange(e)),
    vscode.window.onDidChangeTextEditorSelection((e) => auto.onSelection(e)),
    { dispose: () => auto.dispose() },
    vscode.commands.registerCommand('warekiSeireki.linkEras', linkErasCommand),
    vscode.commands.registerCommand('warekiSeireki.dedupeLinks', dedupeLinksCommand),
    vscode.workspace.registerTextDocumentContentProvider(PREVIEW_SCHEME, previewProvider()),
    vscode.commands.registerCommand('warekiSeireki.annotate', annotateCommand),
  );
}
function deactivate() {}

module.exports = { activate, deactivate, hoverProvider, inlineProvider, annotateCommand, linkEraAtCursor, annotateRelativeAtCursor, linkErasCommand, dedupeLinksCommand, autoLinkScheduler, applyEdits };
