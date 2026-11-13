/**
 * DX改善のご提案（取り組みごとの形）のパワポを作る（2026-11-13 久夫さん指示：手で作った21枚の提案書と同じ見せ方で書き出す）
 *
 * お手本：案件フォルダの DX改善提案_株式会社マイクロ電子サービス_20261113.pptx
 *   表紙 → 解決する課題（だれの課題かごとのカード）→ 課題と取り組みの対応 → 全体の前提（進め方）
 *   → 取り組みごとに ①業務の流れと課題（矢羽根と課題のカード）②改善策（改善後の流れ・写真・今と改善後・見本・変わること）③進め方（作業計画の横棒）
 *   → 仕組みと情報管理（構成図）→ 体制（役割の図）→ 全体の工程（横棒と判断の節目）→ 費用と効果（表とグラフ）→ 道筋（棒）→ リスク → 次に決めること
 *
 * 色の決まり（2026-11-13）：見出しの帯・表紙の帯・ロゴはブランドのオレンジ。そのほかのオレンジは Kamo's BASE の作業・支援費だけ。
 *   紺＝御社と資料の基本（人・改善後・効果・表の見出し）、赤＝課題・リスク、グレー＝今の状態と補足。一緒にする作業は紺にオレンジの縁
 *
 * 読み方：分析の文章（prompts.gs の ANALYSIS_FORM の形）。決まった形で書かれていない節は、文字と表のページにする。
 * 使い方：window.DXY_buildProposal(分析の文章, 写真の配列（data URL。0＝今・1＝対策後）, 写真の説明（なくてよい）, { company: 会社名 })
 *   → PptxGenJS のプレゼンテーションを返す（writeFile は呼ぶ側）
 */
(function (root) {
  'use strict';
  // 配色（2026-11-14 久夫さん「ちょっと暗い。洗練された配色に」）：濃い紺の塗りをやめ、明るい青（スチールブルー）を基本に、
  // 白地を広く・枠は淡い青・帯は薄い面にして軽く見せる。オレンジ（ブランド・当社）と赤（課題）の決まりはそのまま
  var ORANGE = 'E7741D', NAVY = '3A6EA5', NAVYD = '23466F', RED = 'C8463A', GREY = '6B7280', GFILL = 'A7AFBA', INK = '2B2F36', LINE = 'D3DAE3';
  var LIGHT = 'F5F7FA', LNAVY = 'EBF2F9', CARDLINE = 'C5D5E8', LRED = 'FDEEEC', KBT = 'FDF1E7', WHITE = 'FFFFFF';
  var FONT = 'Meiryo', W = 13.33, H = 7.5;
  // 差出人（表紙）は屋号だけ（2026-11-14 久夫さん決定。個人の名前は入れない）
  var PRESENTER_SUB = 'DX推進・生成AI導入支援／経済産業省 DX認定事業者';
  // 当社のメニュー（費用の行で、この名前の金額だけオレンジにする）
  var KB_MENU = /AI活用診断|社内研修|導入伴走|業務改善まるごと|保守・運用|採用ページ|Instagram|SNS ?投稿|ホームページ|^合計|当社/;
  // 御社の人（担当の欄に当社と一緒に出たら「一緒に」）
  var CUST_RE = /社長|所長|若手|事務|技術|担当|社員|御社|経理|部長|みなさま|お客様|現場|店長|職人|スタッフ|従業員/;

  // ---------------------------------------------------------------- 文章を読む
  function strip(s) { return String(s == null ? '' : s).replace(/\*\*/g, '').trim(); }
  function sections(text) {
    var out = [], cur = null;
    String(text || '').split('\n').forEach(function (raw) {
      var l = raw.replace(/\s+$/, '');
      var m = l.match(/^##\s+(.*)$/);
      if (m) { cur = { title: strip(m[1]).replace(/^\d+\s*[.．]\s*/, ''), lines: [] }; out.push(cur); return; }
      if (/^#\s/.test(l)) return;
      if (cur) cur.lines.push(l);
    });
    return out;
  }
  function split(lines, marks) {
    var re = new RegExp('^' + marks + '\\s+(.*)$'), out = [{ head: '', lines: [] }];
    lines.forEach(function (l) { var m = l.match(re); if (m) out.push({ head: strip(m[1]), lines: [] }); else out[out.length - 1].lines.push(l); });
    return out;
  }
  function tables(lines) {
    var out = [], cur = null;
    lines.forEach(function (l) {
      if (/^\s*\|/.test(l)) {
        var cells = l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(strip);
        if (cells.every(function (c) { return /^:?-{2,}:?$/.test(c) || c === ''; })) return;
        if (!cur) { cur = []; out.push(cur); }
        cur.push(cells);
      } else cur = null;
    });
    return out;
  }
  function bulletsOf(lines) {
    return lines.filter(function (l) { return /^\s*[-・*]\s+/.test(l); }).map(function (l) { return strip(l.replace(/^\s*[-・*]\s+/, '')); });
  }
  function kv(b) { var m = String(b).match(/^([^：:]{1,16})[：:]\s*([\s\S]*)$/); return m ? { k: m[1].trim(), v: m[2].trim() } : { k: '', v: String(b) }; }
  function pick(bs, key) { return bs.map(kv).filter(function (o) { return o.k === key; }).map(function (o) { return o.v; }); }
  function nosOf(s) { return (String(s || '').match(/\d+/g) || []); }
  // かっこの外の区切りで分ける（「社長（承認、確保）、若手（登録）」→ 2つ）
  function splitTop(s, seps) {
    var out = [], cur = '', d = 0;
    String(s || '').split('').forEach(function (ch) {
      if (ch === '（' || ch === '(' || ch === '【' || ch === '「') d++;
      if (ch === '）' || ch === ')' || ch === '】' || ch === '」') d = Math.max(0, d - 1);
      if (d === 0 && seps.indexOf(ch) >= 0) { if (cur.trim()) out.push(cur.trim()); cur = ''; if (ch === '＝') cur = '＝'; return; }
      cur += ch;
    });
    if (cur.trim()) out.push(cur.trim());
    return out;
  }
  function nameParen(s) { var m = String(s).match(/^([^（(]*)[（(]([\s\S]*)[）)]\s*$/); return m ? { name: m[1].trim(), desc: m[2].trim() } : { name: String(s).trim(), desc: '' }; }
  function sentences(s) { return String(s || '').split(/(?<=。)/).map(function (x) { return x.trim(); }).filter(Boolean); }
  function flows(lines) {
    return lines.filter(function (l) { return /^\s*\d+\s*[.．]\s*[^｜|]+[｜|]/.test(l); }).map(function (l) {
      var iss = null;
      var p = l.replace(/^\s*\d+\s*[.．]\s*/, '').split(/[｜|]/).map(strip).filter(function (x) {
        var m = x.match(/^課題\s*(\d+)$/); if (m) { iss = m[1]; return false; } return true;
      });
      return { name: p[0] || '', who: (p[1] || '').replace(/^（(.*)）$/, '$1'), det: p[2] || '', iss: iss };
    });
  }
  function colIdx(head, re, dflt) { for (var i = 0; i < head.length; i++) if (re.test(head[i])) return i; return dflt; }

  function model(text) {
    var M = { issues: [], issueMap: {}, root: '', map: [], mapNotes: [], pre: null, acts: [], others: [], cover: {} };
    var tm = String(text || '').match(/^\s*[-・*]\s*表紙の題[：:]\s*(.+)$/m); if (tm) M.cover.title = strip(tm[1]);
    var nm = String(text || '').match(/^\s*[-・*]\s*表紙の数字[：:]\s*(.+)$/m); if (nm) M.cover.nums = strip(nm[1]);
    sections(text).forEach(function (s) {
      var t = s.title, am = t.match(/^取り組み\s*([A-ZＡ-Ｚ])/);
      if (/解決する課題/.test(t)) readIssues(s, M);
      else if (/課題と取り組み/.test(t)) readMap(s, M);
      else if (/全体の前提/.test(t)) M.pre = readAct(s, '前提');
      else if (am) M.acts.push(readAct(s, am[1]));
      else M.others.push(s);
    });
    return M;
  }
  function readIssues(s, M) {
    var tb = tables(s.lines)[0] || [];
    if (tb.length > 1) {
      var h = tb[0], iT = colIdx(h, /課題/, 0), iW = colIdx(h, /だれ|誰/, 1), iF = colIdx(h, /事実/, 2), iC = colIdx(h, /原因/, 3), iP = colIdx(h, /優先/, 4);
      tb.slice(1).forEach(function (r, k) {
        var c = r[iT] || '', m = c.match(/課題\s*(\d+)\s*[：:]?\s*(.*)/);
        var it = { no: m ? m[1] : String(k + 1), title: m ? (m[2] || c) : c, who: r[iW] || '', fact: r[iF] || '', cause: r[iC] || '', pri: r[iP] || '' };
        M.issues.push(it); M.issueMap[it.no] = it;
      });
    }
    M.root = pick(bulletsOf(s.lines), '根っこの課題')[0] || '';
  }
  function readMap(s, M) {
    var tb = tables(s.lines)[0] || [];
    if (tb.length > 1) {
      var h = tb[0], iA = colIdx(h, /取り組み/, 0), iI = colIdx(h, /課題/, 1), iS = colIdx(h, /段階|時期/, 2), iC = colIdx(h, /費用/, 3), iE = colIdx(h, /効果/, 4);
      tb.slice(1).forEach(function (r) {
        var a = r[iA] || '', m = a.match(/^([A-ZＡ-Ｚ])[\s　：:]+(.*)$/);
        var key = m ? m[1] : (/前提/.test(a) ? '前提' : a.slice(0, 2));
        var title = m ? m[2] : a.replace(/^全体の前提[：:]?\s*/, '');
        M.map.push({ key: key, title: title, label: a, issues: nosOf(r[iI]), issuesText: r[iI] || '', stage: r[iS] || '', cost: r[iC] || '', effect: r[iE] || '' });
      });
    }
    M.mapNotes = bulletsOf(s.lines);
  }
  function readAct(s, key) {
    var t = s.title;
    var A = { key: key, full: t, name: t.replace(/^取り組み\s*[A-ZＡ-Ｚ]\s*[：:]\s*/, '').replace(/^全体の前提[^：:]*[：:]\s*/, '').replace(/（課題[^（）]*）/g, '').replace(/（任意）/g, '').trim(),
      issues: nosOf((t.match(/（課題[^（）]*）/) || [''])[0]), optional: /任意/.test(t),
      p1: { head: '', steps: [], bs: [] }, p2: { head: '', steps: [], bs: [], mocks: [], rows: null }, p3: { head: '', table: null, bs: [] }, extra: [] };
    split(s.lines, '###').forEach(function (p) {
      if (/①/.test(p.head)) A.p1 = { head: p.head, steps: flows(p.lines), bs: bulletsOf(p.lines) };
      else if (/②/.test(p.head)) {
        var sub = split(p.lines, '####');
        A.p2 = { head: p.head, steps: flows(sub[0].lines), bs: bulletsOf(sub[0].lines), mocks: [], rows: null };
        sub.slice(1).forEach(function (q) {
          var tb = tables(q.lines)[0];
          if (/今と改善後/.test(q.head) && tb) A.p2.rows = tb;
          else if (/見本/.test(q.head)) A.p2.mocks.push({ name: q.head.replace(/^見本\s*[：:]?\s*/, '') || '見本', table: tb || null, notes: bulletsOf(q.lines) });
          else A.p2.bs = A.p2.bs.concat(bulletsOf(q.lines));
        });
      } else if (/③/.test(p.head)) A.p3 = { head: p.head, table: tables(p.lines)[0] || null, bs: bulletsOf(p.lines) };
      else A.extra = A.extra.concat(p.lines);
    });
    return A;
  }

  // ---------------------------------------------------------------- 文字の大きさ
  function vlen(s) { var n = 0; s = String(s); for (var i = 0; i < s.length; i++) n += s.charCodeAt(i) < 0x2000 ? 0.55 : 1; return n; }
  function plain(t) {
    if (typeof t === 'string') return t.split('\n');
    return t.map(function (p) { return typeof p === 'string' ? p : p.map(function (r) { return r[0]; }).join(''); });
  }
  function fitSize(t, w, h, size, min, bullet) {
    var ps = plain(t), s = size;
    for (; s > min; s -= 0.5) {
      var cpl = Math.max(1, (w - 0.12 - (bullet ? 0.25 : 0)) * 72 / s);
      var lines = ps.reduce(function (n, p) { return n + Math.max(1, Math.ceil(vlen(p) / cpl)); }, 0);
      if (lines * s * 1.3 / 72 + ps.length * (bullet ? s * 0.35 / 72 : 0) + 0.08 <= h) return s;
    }
    return min;
  }

  // ---------------------------------------------------------------- 本体
  function build(text, images, plan, opts) {
    opts = opts || {};
    var pptx = new root.PptxGenJS();
    pptx.layout = 'LAYOUT_WIDE';
    var S = pptx.ShapeType;
    var M = model(text);
    var pages = [];
    // 写真として使うのは、写真風の画像（2026-11-12〜。写真の説明 plan にカードがある）だけ。
    // それより前の文字入りの「効果のイメージ図」は、写真の枠に入れると切れて読めないため使わない（2026-11-14 アプリで試して分かった）
    // 見分け方：画像の記録（opts.visual）に style: 'photo' がある、または写真風に切り替えた 2026-11-12 以降に作った画像
    // （写す人物・場面の項目は古い図の説明にもあるため、見分けに使えない）
    var vis = opts.visual || {};
    var photoOk = !!plan && (vis.style === 'photo' || String(vis.updated || '') >= '2026-11-12');
    images = photoOk ? (images || []).map(function (d) { return d ? String(d).replace(/^data:/, '') : null; }) : [];
    var nIss = M.issues.length;

    // ---- 部品
    function runsOf(t, factor, bullet, space) {
      if (typeof t === 'string') return t;
      var out = [];
      t.forEach(function (p, i) {
        var arr = typeof p === 'string' ? [[p, {}]] : p;
        arr.forEach(function (r, j) {
          var o = r[1] || {}, op = {};
          if (o.b != null) op.bold = o.b;
          if (o.c) op.color = o.c;
          if (o.s) op.fontSize = Math.round(o.s * factor * 2) / 2;
          if (j === 0 && bullet) { op.bullet = { indent: 12 }; op.paraSpaceAfter = space || 4; }
          if (j === 0 && !bullet && space) op.paraSpaceAfter = space;
          if (j === arr.length - 1 && i < t.length - 1) op.breakLine = true;
          out.push({ text: r[0], options: op });
        });
      });
      return out;
    }
    function T(sl, x, y, w, h, t, size, o) {
      o = o || {};
      var s2 = o.nofit ? size : fitSize(t, w, h, size, o.min || Math.min(size, 8), o.bullet);
      var op = { x: x, y: y, w: w, h: h, fontFace: o.face || FONT, fontSize: s2, color: o.color || INK, bold: !!o.bold,
        align: o.align || 'left', valign: o.valign || 'top', margin: o.margin != null ? o.margin : 3 };
      if (o.shape) { op.shape = o.shape; if (o.shape === S.roundRect) op.rectRadius = o.r != null ? o.r : 0.08; }
      if (o.fill) op.fill = { color: o.fill };
      if (o.line) op.line = { color: o.line, width: o.lw || 1, dashType: o.dash ? 'dash' : 'solid' };
      if (typeof t === 'string' && o.space) op.paraSpaceAfter = o.space;
      sl.addText(runsOf(t, s2 / size, o.bullet, o.space), op);
    }
    function box(sl, x, y, w, h, fill, line, o) {
      o = o || {};
      var op = { x: x, y: y, w: w, h: h };
      if (!o.rect) op.rectRadius = o.r != null ? o.r : 0.08;
      if (fill) op.fill = { color: fill };
      if (line) op.line = { color: line, width: o.lw || 1, dashType: o.dash ? 'dash' : 'solid' };
      sl.addShape(o.rect ? S.rect : (o.shape || S.roundRect), op);
    }
    function tag(sl, x, y, w, label, fill, size) {
      T(sl, x, y, w, 0.28, label, size || 10, { bold: true, color: WHITE, fill: fill || NAVY, shape: S.roundRect, r: 0.06, align: 'center', valign: 'middle', margin: 1, nofit: true });
    }
    function arrow(sl, x, y, w, h, color, kind) { sl.addShape(kind || S.rightArrow, { x: x, y: y, w: w, h: h, fill: { color: color || NAVY } }); }
    function person(sl, cx, y, color, k) {
      k = k || 1;
      sl.addShape(S.ellipse, { x: cx - 0.17 * k, y: y, w: 0.34 * k, h: 0.34 * k, fill: { color: color } });
      // 胴体の角の丸めは指定しない（round2SameRect に rectRadius を付けると PowerPoint で開けなくなる）
      sl.addShape(S.round2SameRect, { x: cx - 0.3 * k, y: y + 0.38 * k, w: 0.6 * k, h: 0.36 * k, fill: { color: color } });
    }
    function check(sl, x, y, label) {
      T(sl, x, y, 0.34, 0.34, '✓', 12, { bold: true, color: WHITE, fill: NAVY, shape: S.ellipse, align: 'center', valign: 'middle', margin: 0, nofit: true });
      if (label) T(sl, x + 0.38, y, 2.6, 0.34, label, 9.5, { bold: true, color: NAVY, valign: 'middle' });
    }
    // 書類の絵。PptxGenJS の ShapeType.folderCorner は PowerPoint の形の名前（foldedCorner）と違い開けなくなるため、名前を直接書く
    function docIcon(sl, x, y, w, h, fill, line) { sl.addShape('foldedCorner', { x: x, y: y, w: w, h: h, fill: { color: fill || WHITE }, line: { color: line || NAVY, width: 1 } }); }
    function vline(sl, x1, y1, x2, y2, color, w, dash) {
      sl.addShape(S.line, { x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(x2 - x1), h: Math.abs(y2 - y1), line: { color: color || LINE, width: w || 1.25, dashType: dash ? 'dash' : 'solid' } });
    }
    function logo(sl, x, y, w, h, size) {
      T(sl, x, y, w, h, [[["Kamo's", { c: INK }], ['BASE', { c: ORANGE }]]], size, { bold: true, face: 'Arial Black', valign: 'middle', margin: 0, nofit: true });
    }
    function header(title, tg) {
      var sl = pptx.addSlide();
      sl.background = { color: WHITE };
      sl.addShape(S.rect, { x: 0, y: 0, w: W, h: 0.95, fill: { color: ORANGE } });
      var tw = tg ? 9.75 : 12.33;
      var size = Math.max(15, Math.min(24, Math.floor((tw - 0.15) * 72 / Math.max(1, vlen(title)) * 2) / 2));
      T(sl, 0.5, 0.12, tw, 0.7, title, size, { bold: true, color: WHITE, valign: 'middle', nofit: true });
      if (tg) T(sl, W - 2.75, 0.27, 2.25, 0.42, tg, 11, { bold: true, color: ORANGE, fill: WHITE, shape: S.roundRect, r: 0.06, align: 'center', valign: 'middle', margin: 1 });
      pages.push(sl);
      return sl;
    }
    function lead(sl, t) { if (t) T(sl, 0.5, 1.05, 12.33, 0.42, t, 13.5, { valign: 'middle', min: 10 }); }
    function note(sl, t, y) { if (t) T(sl, 0.5, y || 6.95, 12.33, 0.3, t, 9, { color: GREY, min: 7.5 }); }
    function supportStrip(sl, y, t, h) {
      if (!t) return;
      h = h || 0.6;
      T(sl, 0.5, y, 12.33, h, [[["Kamo's BASE の支援　", { b: true, c: ORANGE }], [t, {}]]], 11.5, { fill: KBT, line: ORANGE, shape: S.roundRect, r: 0.06, valign: 'middle', margin: 6, min: 8 });
    }
    function band(sl, y, head, body) {
      T(sl, 0.5, y, 12.33, 0.55, [[[head, { b: true, c: NAVYD }], [body, { c: INK }]]], 11.5, { fill: LNAVY, shape: S.rect, valign: 'middle', margin: 12, min: 8 });
      sl.addShape(S.rect, { x: 0.5, y: y, w: 0.08, h: 0.55, fill: { color: NAVY } });
    }
    function issueTag(no) { return '課題' + no; }
    function stageOf(key) {
      var r = M.map.filter(function (x) { return x.key === key; })[0];
      return r ? r.stage.replace(/（/, '・').replace(/）/, '') : '';
    }
    function actByKey(k) { return M.acts.filter(function (a) { return a.key === k; })[0]; }
    function addTable(sl, x, y, w, rows, colW, o) {
      o = o || {};
      var body = rows.map(function (r, i) {
        return r.map(function (c, j) {
          var head = i === 0;
          var cell = { text: String(c == null ? '' : c), options: { fontFace: FONT, fontSize: head ? (o.headSize || 11) : (o.size || 10.5), bold: head || (o.boldFirst && j === 0), color: head ? WHITE : INK,
            fill: { color: head ? (o.headFill || NAVY) : (o.zebra !== false && i % 2 === 0 ? LIGHT : WHITE) }, valign: 'middle', margin: [3, 5, 3, 5] } };
          if (o.cell) o.cell(cell, i, j, r);
          return cell;
        });
      });
      sl.addTable(body, { x: x, y: y, w: w, colW: colW, rowH: o.rowH || 0.4, border: { type: 'solid', pt: 0.75, color: 'FFFFFF' } });
    }

    // ---- 1 表紙
    (function cover() {
      var sl = pptx.addSlide();
      sl.background = { color: WHITE };
      pages.push(sl);
      var img = images[1] || images[0];
      if (img) {
        sl.addImage({ data: img, x: 6.55, y: 0, w: W - 6.55, h: H, sizing: { type: 'cover', w: W - 6.55, h: H } });
        T(sl, W - 2.6, H - 0.45, 2.45, 0.3, 'イメージ（AI で作成した写真）', 9, { color: WHITE, fill: NAVY, shape: S.rect, align: 'center', valign: 'middle', margin: 0, nofit: true });
      } else sl.addShape(S.rect, { x: 6.55, y: 0, w: W - 6.55, h: H, fill: { color: LNAVY } });
      sl.addShape(S.rect, { x: 0, y: 0, w: 0.18, h: H, fill: { color: ORANGE } });
      logo(sl, 0.6, 0.5, 3.0, 0.5, 20);
      if (opts.company) T(sl, 0.6, 1.55, 5.7, 0.45, opts.company + ' 御中', 16, { min: 11 });
      var title = M.cover.title || 'DX改善のご提案';
      var tl = splitTop(title, ['、']).map(function (x, i, a) { return x + (i < a.length - 1 ? '、' : ''); });
      T(sl, 0.6, 2.1, 5.8, 1.9, tl, 30, { bold: true, min: 18, valign: 'middle' });
      T(sl, 0.6, 4.05, 5.7, 0.45, M.cover.title ? 'DX改善のご提案' + (nIss ? '（' + nIss + 'つの課題の解決）' : '') : (nIss ? nIss + 'つの課題を解決する取り組み' : ''), 18, { bold: true, color: NAVY, min: 12 });
      var nums = splitTop(M.cover.nums || '', ['／']).slice(0, 3);
      nums.forEach(function (nn, i) {
        var p = nn.split(/[｜|]/), big = strip(p[0]), lab = strip(p[1] || '');
        var lp = lab.match(/^([^（]*)(（.*）)?$/) || [lab, lab, ''];
        var x = 0.6 + i * 1.95;
        box(sl, x, 4.75, 1.8, 1.0, LNAVY, null);
        T(sl, x + 0.05, 4.8, 1.7, 0.45, big, 20, { bold: true, color: NAVY, align: 'center', valign: 'middle', min: 12 });
        T(sl, x + 0.05, 5.22, 1.7, 0.5, [lp[1] || '', lp[2] || ''].filter(Boolean), 9.5, { align: 'center', valign: 'middle', min: 7.5 });
      });
      if (nums.length) T(sl, 0.6, 5.82, 5.7, 0.3, '目標の数字は目安【仮定】。初回面談と最初の試行で確かめます', 9.5, { color: GREY });
      var d = new Date();
      T(sl, 0.6, 6.2, 5.8, 1.0, [d.getFullYear() + '年' + (d.getMonth() + 1) + '月' + d.getDate() + '日', "Kamo's BASE", PRESENTER_SUB], 11, { color: GREY, space: 2 });
    })();

    // ---- 2 解決する課題（だれの課題かごと）
    (function issuesPage() {
      if (!nIss) return;
      var sl = header('この提案で解決する' + nIss + 'つの課題：だれが、何に困っているか');
      lead(sl, 'この提案書は、次の' + nIss + 'つの課題を解決するためのものです。困っている人ごとに並べました。');
      var owners = [], byWho = {};
      M.issues.forEach(function (it) {
        var k = it.who || '（未記入）';
        if (!byWho[k]) { byWho[k] = []; owners.push(k); }
        byWho[k].push(it);
      });
      var cols = owners.length, gap = 0.11, CWD = (12.33 - gap * (cols - 1)) / cols;
      var maxN = Math.max.apply(null, owners.map(function (o) { return byWho[o].length; }));
      var yEnd = M.root ? 6.02 : 6.85, ch = Math.min(1.75, (yEnd - 2.37 - 0.1 * (maxN - 1)) / maxN);
      owners.forEach(function (o, i) {
        var x = 0.5 + i * (CWD + gap);
        box(sl, x, 1.55, CWD, 0.72, LIGHT, null);
        person(sl, x + 0.4, 1.6, NAVY, 0.8);
        T(sl, x + 0.8, 1.55, CWD - 0.85, 0.72, [[[o, { b: true, s: 15 }]], [[byWho[o].map(function (it) { return issueTag(it.no); }).join('・'), { s: 10, c: GREY }]]], 12, { valign: 'middle', min: 8 });
        byWho[o].forEach(function (it, k) {
          var y = 2.37 + k * (ch + 0.1);
          box(sl, x, y, CWD, ch, WHITE, CARDLINE);
          tag(sl, x + 0.1, y + 0.1, 0.75, issueTag(it.no), NAVY, 10);
          if (it.pri) tag(sl, x + CWD - 1.0, y + 0.1, 0.9, '優先度 ' + it.pri, /高/.test(it.pri) ? RED : GREY, 9);
          T(sl, x + 0.1, y + 0.42, CWD - 0.2, 0.36, it.title, 12.5, { bold: true, min: 9 });
          T(sl, x + 0.1, y + 0.78, CWD - 0.2, ch - 0.82, [[['事実　', { b: true, c: GREY }], [it.fact, {}]], [['原因　', { b: true, c: RED }], [it.cause, {}]]], 10, { min: 7.5, space: 3 });
        });
      });
      if (M.root) {
        var ss = sentences(M.root), head = ss.length > 1 ? ss[0] : '', rest = ss.length > 1 ? ss.slice(1).join('') : M.root;
        T(sl, 0.5, 6.15, 12.33, 0.78, [[['根っこの課題　' + head, { b: true, s: 14, c: NAVYD }], [rest, { s: 11.5, c: INK }]]], 12, { fill: LNAVY, shape: S.rect, valign: 'middle', margin: 12, min: 8 });
        sl.addShape(S.rect, { x: 0.5, y: 6.15, w: 0.08, h: 0.78, fill: { color: NAVY } });
      }
    })();

    // ---- 3 課題と取り組みの対応
    (function mapPage() {
      if (!M.map.length) return;
      var pre = M.map.filter(function (r) { return r.key === '前提'; })[0];
      var acts = M.map.filter(function (r) { return r.key !== '前提'; });
      var sl = header('今回のご提案：' + (nIss ? nIss + 'つの課題を、' : '') + acts.length + 'つの取り組みで解決する');
      lead(sl, (nIss ? nIss + 'つの課題を、' : '') + acts.length + 'つの取り組みで解決します。このあと取り組みごとに、①業務の流れと課題 ②改善策 ③進め方の順で説明します。');
      var XI = 0.5, WI = 3.2, XA = 4.05, WA = 3.8, XS = 7.95, WS = 1.45, XC = 9.5, WC = 1.3, XE = 10.9, WE = 1.93;
      [[XI, WI, '解決する課題（だれの課題か）'], [XA, WA, '取り組み（何をするか）'], [XS, WS, '段階'], [XC, WC, '当社の費用'], [XE, WE, '効果（年）']].forEach(function (c) {
        T(sl, c[0], 1.52, c[1], 0.35, c[2], 10.5, { bold: true, color: GREY, align: 'center' });
      });
      var cell = function (x, w, y, h, t, size, bold, color) {
        box(sl, x, y, w, h, LIGHT, null);
        // 「15万円〜（導入伴走パック）」は、金額を大きく、かっこの中を小さく2行目に
        var i0 = String(t).indexOf('（'), main = i0 > 0 ? String(t).slice(0, i0) : String(t), subt = i0 > 0 ? String(t).slice(i0) : '';
        T(sl, x + 0.04, y, w - 0.08, h, subt ? [[[main, { b: bold, c: color || INK }]], [[subt, { b: false, s: size * 0.72, c: color === ORANGE ? ORANGE : GREY }]]] : [[[main, { b: bold, c: color || INK }]]], size, { align: 'center', valign: 'middle', min: 7.5 });
      };
      var y = 1.9;
      if (pre) {
        box(sl, XI, y, 12.33, 0.5, LIGHT, null);
        T(sl, XI + 0.15, y, XS - XI - 0.2, 0.5, [[['全体の前提　', { b: true, c: NAVY }], [pre.title, {}]]], 11, { valign: 'middle', min: 8 });
        T(sl, XS, y, WS, 0.5, pre.stage.replace(/（/, '\n').replace(/）/, '').split('\n'), 10, { bold: true, color: NAVY, align: 'center', valign: 'middle', min: 7.5 });
        T(sl, XC, y, WC, 0.5, pre.cost.replace(/（.*$/, ''), 13, { bold: true, color: ORANGE, align: 'center', valign: 'middle', min: 8 });
        T(sl, XE, y, WE, 0.5, pre.effect, 10.5, { align: 'center', valign: 'middle', min: 7.5 });
        y += 0.6;
      }
      var first = M.mapNotes.filter(function (b) { return /^最初は/.test(b); })[0];
      var bottom = first ? 6.45 : 6.9;
      var hs = acts.map(function (r) { return Math.max(0.7, Math.max(1, r.issues.length) * 0.56); });
      var tot = hs.reduce(function (a, b) { return a + b; }, 0) + 0.1 * (acts.length - 1), k0 = Math.min(1, (bottom - y) / tot);
      acts.forEach(function (r, i) {
        var h = hs[i] * k0, nos = r.issues.length ? r.issues : [null];
        var chh = (h - 0.08 * (nos.length - 1)) / nos.length;
        nos.forEach(function (no, k) {
          var yy = y + k * (chh + 0.08), it = no && M.issueMap[no];
          box(sl, XI, yy, WI, chh, WHITE, CARDLINE);
          if (no) tag(sl, XI + 0.08, yy + (chh - 0.28) / 2, 0.65, issueTag(no), NAVY, 9.5);
          T(sl, XI + (no ? 0.8 : 0.1), yy, WI - (no ? 0.85 : 0.2), chh, it ? [[[it.title, { b: true }]], [[it.who + 'の課題', { s: 9, c: GREY }]]] : [r.issuesText], 10.5, { valign: 'middle', min: 7.5 });
        });
        arrow(sl, XI + WI + 0.05, y + h / 2 - 0.15, 0.25, 0.3, NAVY);
        box(sl, XA, y, WA, h, LNAVY, null);
        T(sl, XA + 0.1, y, 0.45, h, r.key, 20, { bold: true, color: NAVY, align: 'center', valign: 'middle', nofit: true });
        var A = actByKey(r.key), desc = A ? (pick(A.p2.bs, 'やること')[0] || pick(A.p2.bs, '変わること')[0] || '') : '';
        T(sl, XA + 0.55, y, WA - 0.6, h, h > 0.95 && desc ? [[[r.title, { b: true, s: 11.5 }]], [[desc, { s: 9.5 }]]] : [[[r.title, { b: true, s: 11.5 }]]], 11, { valign: 'middle', min: 7.5 });
        cell(XS, WS, y, h, r.stage, 10.5, true, NAVY);
        cell(XC, WC, y, h, r.cost, 12, true, ORANGE);
        cell(XE, WE, y, h, r.effect, 10.5, false, INK);
        y += h + 0.1;
      });
      if (first) band(sl, 6.55, '最初は' + (first.match(/^最初は([^：:]*)[：:]/) || ['', ''])[1] + '：', first.replace(/^最初は[^：:]*[：:]\s*/, ''));
    })();

    // ---- ③ 進め方（作業スコープと作業計画）
    function spanOf(s) {
      var m = String(s || '').match(/(\d+)\s*(?:[〜~～\-－]\s*(\d+))?\s*(週|か月|ヶ月|カ月|ケ月)/);
      if (!m) return null;
      var a = +m[1], b = m[2] ? +m[2] : a;
      return { s0: a - 1, s1: b, unit: m[3] === '週' ? '週目' : 'か月目' };
    }
    function costItems(v) {
      var items = [], notes = [];
      var parts = [], d = 0, cur = '';
      // かっこの外の「（運用費：…）」は別の行にする
      String(v).split('').forEach(function (ch) {
        if (ch === '（') { if (d === 0) { parts.push(cur); cur = ''; } d++; cur += ch; return; }
        cur += ch;
        if (ch === '）') { d = Math.max(0, d - 1); if (d === 0) { parts.push(cur); cur = ''; } }
      });
      parts.push(cur);
      var main = '';
      parts.forEach(function (p) {
        var m = p.match(/^（\s*(運用費[\s\S]*)）$/);
        if (m) splitTop(m[1].replace(/^運用費[：:]\s*/, ''), ['、', '。', '＋']).forEach(function (x) { items.push(x); });
        else main += p;
      });
      items = splitTop(main.replace(/^運用費[：:]\s*/, ''), ['＋', '、', '。', '＝']).concat(items);
      return items.map(function (it) {
        var sum = /^＝/.test(it); it = it.replace(/^＝\s*/, '').replace(/^運用費[：:]\s*/, '');
        var am = it.match(/((?:月\s*)?(?:年\s*)?(?:約\s*)?[0-9０-９][0-9０-９,.]*(?:\s*[〜~]\s*[0-9０-９.,]*)?\s*万?円[〜~]?)/);
        if (!am) { if (it) notes.push(it); return null; }
        var idx = it.indexOf(am[1]), name = it.slice(0, idx).trim(), after = it.slice(idx + am[1].length).trim(), amt = am[1];
        var tags = (name.match(/【[^】]*】/g) || []).join(''); name = name.replace(/【[^】]*】/g, '').trim();
        var pm = after.match(/^（([^（）]*)）([\s\S]*)$/);
        if (pm) { if (vlen(pm[1]) <= 8) amt += '（' + pm[1] + '）'; else notes.push(pm[1]); after = pm[2].trim(); }
        amt += after + tags;
        if (sum && !name) name = '合計';
        return [name || '費用', amt];
      }).filter(Boolean).concat(notes.length ? [['', notes.join('。')]] : []);
    }
    function planPage(title, tg, ld, A) {
      var tb = A.p3.table;
      if (!tb || tb.length < 2) return;
      var h0 = tb[0], iT = colIdx(h0, /作業|やること/, 0), iW = colIdx(h0, /担当|だれ/, 1), iS = colIdx(h0, /時期|いつ/, 2);
      var rows = tb.slice(1).map(function (r) { return { task: r[iT] || '', who: r[iW] || '', when: r[iS] || '', sp: spanOf(r[iS]) }; });
      var gantt = rows.every(function (r) { return r.sp; });
      var sl = header(title, tg);
      lead(sl, ld);
      [['当社', ORANGE, null], ['御社', NAVY, null], ['一緒に', NAVY, ORANGE]].forEach(function (lg, k) {
        var lx = 12.83 - (3 - k) * 0.95;
        box(sl, lx, 1.16, 0.3, 0.2, lg[1], lg[2], { rect: true, lw: 2 });
        T(sl, lx + 0.33, 1.08, 0.62, 0.34, lg[0], 9.5, { valign: 'middle', margin: 0, nofit: true });
      });
      var XT = 0.5, WT = 4.75, XO = 5.3, WO = 2.3, XP = 7.65, WP = 12.83 - XP;
      var cols = [];
      if (gantt) {
        var n = Math.max.apply(null, rows.map(function (r) { return r.sp.s1; }));
        for (var c = 0; c < n; c++) cols.push((c + 1) + rows[0].sp.unit);
      } else cols = ['時期'];
      var pw = WP / cols.length;
      [[XT, WT, '作業スコープ（やること）'], [XO, WO, '担当']].forEach(function (c) {
        T(sl, c[0], 1.5, c[1] - 0.05, 0.38, c[2], 11, { bold: true, color: WHITE, fill: NAVY, shape: S.rect, align: 'center', valign: 'middle', nofit: true });
      });
      cols.forEach(function (c, k) { T(sl, XP + k * pw, 1.5, pw - 0.05, 0.38, c, 11, { bold: true, color: WHITE, fill: NAVY, shape: S.rect, align: 'center', valign: 'middle', min: 8 }); });
      var RH = Math.min(0.5, (6.95 - 1.75 - 1.95) / rows.length - 0.05);
      rows.forEach(function (r, i) {
        var y = 1.95 + i * (RH + 0.05);
        box(sl, XT, y, 12.33, RH, i % 2 === 0 ? LIGHT : WHITE, null, { rect: true });
        T(sl, XT + 0.08, y, WT - 0.15, RH, r.task, 10.5, { valign: 'middle', min: 7.5 });
        var w0 = r.who.replace(/（[^（）]*）/g, ''), kb = /当社/.test(w0), cu = CUST_RE.test(w0);
        T(sl, XO + 0.05, y, WO - 0.1, RH, r.who, 10, { bold: true, color: kb && !cu ? ORANGE : NAVY, valign: 'middle', min: 7.5 });
        if (gantt) box(sl, XP + r.sp.s0 * pw + 0.03, y + 0.1, (r.sp.s1 - r.sp.s0) * pw - 0.06, Math.max(0.12, RH - 0.2), kb && !cu ? ORANGE : NAVY, kb && cu ? ORANGE : null, { lw: 2.5 });
        else T(sl, XP + 0.05, y, WP - 0.1, RH, r.when, 10, { valign: 'middle', min: 7.5 });
      });
      var yb = 1.95 + rows.length * (RH + 0.05) + 0.15, hb = 6.9 - yb;
      var bs = A.p3.bs, outs = [];
      pick(bs, '残るもの').forEach(function (v) { outs = outs.concat(splitTop(v, ['、'])); });
      box(sl, 0.5, yb, 4.0, hb, WHITE, CARDLINE);
      T(sl, 0.65, yb + 0.05, 3.7, 0.35, '御社に残るもの', 12, { bold: true, color: NAVYD, nofit: true });
      var orow = Math.max(1, Math.ceil(outs.length / 2)), oh = Math.min(0.62, (hb - 0.5) / orow);
      outs.slice(0, 8).forEach(function (o, k) {
        var xx = 0.65 + (k % 2) * 1.85, yy = yb + 0.45 + Math.floor(k / 2) * oh;
        docIcon(sl, xx, yy + 0.04, 0.3, Math.min(0.42, oh - 0.1), LNAVY, CARDLINE);
        T(sl, xx + 0.36, yy - 0.03, 1.47, oh, o, 9.5, { bold: true, valign: 'middle', min: 7 });
      });
      box(sl, 4.65, yb, 3.85, hb, LIGHT, null);
      T(sl, 4.8, yb + 0.05, 3.6, 0.35, [[['費用（税抜）', { b: true, c: NAVY }], ['　オレンジ＝当社の支援費', { s: 9, c: ORANGE }]]], 12, { nofit: true });
      var ci = [];
      pick(bs, '費用').forEach(function (v) { ci = ci.concat(costItems(v)); });
      var cih = Math.min(0.42, (hb - 0.5) / Math.max(1, ci.length));
      ci.forEach(function (c, k) {
        var yy = yb + 0.45 + k * cih;
        if (!c[0]) { T(sl, 4.8, yy, 3.6, cih, c[1], 9, { color: GREY, valign: 'middle', min: 7 }); return; }
        T(sl, 4.8, yy, 1.9, cih, c[0], 10, { valign: 'middle', min: 7 });
        T(sl, 6.6, yy, 1.85, cih, c[1], 11, { bold: true, color: KB_MENU.test(c[0]) ? ORANGE : NAVY, align: 'right', valign: 'middle', min: 7 });
      });
      box(sl, 8.65, yb, 4.18, hb, LIGHT, null);
      T(sl, 8.8, yb + 0.05, 3.9, 0.35, '御社の負担と、終わりの条件', 12, { bold: true, color: NAVY, nofit: true });
      var conds = [];
      pick(bs, '御社の負担').forEach(function (v) { conds.push('負担：' + v); });
      pick(bs, '終わりの条件').forEach(function (v) { conds.push('終わりの条件：' + v); });
      if (conds.length) T(sl, 8.8, yb + 0.42, 3.9, hb - 0.45, conds, 9.5, { bullet: true, min: 7, space: 3 });
      note(sl, pick(bs, '当社の支援')[0] || '', 6.95);
    }

    // ---- ① 業務の流れと課題
    function flowPage(A, K) {
      var P = A.p1, steps = P.steps;
      var msg = (P.head.split(/[：:]/)[1] || '').trim();
      var sl = header('取り組み' + K + '①：' + (msg || '業務の流れと課題') + (A.issues.length ? '（' + A.issues.map(issueTag).join('・').replace(/・課題/g, '・') + '）' : ''), K + '｜① 流れと課題');
      lead(sl, pick(P.bs, '要点')[0] || '今の業務の流れと、課題が起きているところです。');
      var n = steps.length, SW = 12.33 / n;
      T(sl, 0.5, 1.5, 6.0, 0.3, '今の業務の流れ', 11, { bold: true, color: GREY, nofit: true });
      steps.forEach(function (st, i) {
        var x = 0.5 + i * SW;
        sl.addShape(i ? S.chevron : S.homePlate, { x: x, y: 1.82, w: SW + 0.05, h: 0.6, fill: { color: GFILL } });
        T(sl, x + 0.25, 1.82, SW - 0.4, 0.6, st.name, 11.5, { bold: true, color: WHITE, align: 'center', valign: 'middle', margin: 0, min: 7.5 });
        T(sl, x + 0.05, 2.46, SW - 0.1, 0.3, st.who, 10.5, { bold: true, color: NAVY, align: 'center', min: 7.5 });
        var hot = !!st.iss;
        T(sl, x + 0.08, 2.8, SW - 0.16, 1.2, st.det, 11, { fill: hot ? LRED : WHITE, line: hot ? RED : LINE, shape: S.roundRect, align: 'center', valign: 'middle', min: 7.5, margin: 4 });
        if (hot) tag(sl, x + (SW - 0.8) / 2, 2.66, 0.8, issueTag(st.iss), RED, 9.5);
      });
      T(sl, 0.5, 4.08, 12.0, 0.3, '赤い枠＝課題が起きているところ', 10, { bold: true, color: RED, nofit: true });
      var nos = [], extra = [];
      P.bs.forEach(function (b) {
        var o = kv(b), m = o.k.match(/^課題\s*(\d+)/);
        if (!m) return;
        if (nos.indexOf(m[1]) < 0) nos.push(m[1]);
        var it = M.issueMap[m[1]];
        if (it && it.cause && o.v.indexOf(it.cause) === 0) { var rest = o.v.slice(it.cause.length).replace(/^[。、\s]+/, ''); if (rest) extra.push(rest); }
      });
      steps.forEach(function (st) { if (st.iss && nos.indexOf(st.iss) < 0) nos.push(st.iss); });
      var m = nos.length, CW = m ? (12.33 - 0.15 * (m - 1)) / m : 12.33, foot = extra.join('');
      nos.forEach(function (no, k) {
        var it = M.issueMap[no] || { title: '', who: '', fact: '', cause: '' }, x = 0.5 + k * (CW + 0.15), y = 4.45, hh = foot ? 1.85 : 2.3;
        box(sl, x, y, CW, hh, WHITE, CARDLINE);
        person(sl, x + 0.4, y + 0.15, NAVY, 0.75);
        tag(sl, x + 0.8, y + 0.15, 0.75, issueTag(no), NAVY, 10);
        T(sl, x + 1.65, y + 0.1, CW - 1.75, 0.38, it.title, 13, { bold: true, valign: 'middle', min: 9 });
        T(sl, x + 0.8, y + 0.5, CW - 0.9, 0.3, it.who ? it.who + 'の課題' : '', 10, { bold: true, color: NAVY, min: 8 });
        T(sl, x + 0.2, y + 0.9, CW - 0.35, hh - 0.95, [[['事実　', { b: true, c: GREY }], [it.fact, {}]], [['原因　', { b: true, c: RED }], [it.cause, {}]]], 12, { min: 8, space: 5 });
      });
      if (foot) T(sl, 0.5, 6.42, 12.33, 0.5, [[['つながり　', { b: true, c: GREY }], [foot, {}]]], 11, { fill: LIGHT, shape: S.roundRect, valign: 'middle', margin: 8, min: 8 });
    }

    // ---- ② 改善策
    function afterFlow(sl, steps, y) {
      var n = steps.length, SW = 12.33 / n;
      T(sl, 0.5, y - 0.02, 6.0, 0.3, '改善後の流れ', 11, { bold: true, color: NAVY, nofit: true });
      steps.forEach(function (st, i) {
        var x = 0.5 + i * SW;
        sl.addShape(i ? S.chevron : S.homePlate, { x: x, y: y + 0.3, w: SW + 0.05, h: 0.62, fill: { color: NAVY } });
        T(sl, x + 0.25, y + 0.3, SW - 0.4, 0.62, st.name, 11, { bold: true, color: WHITE, align: 'center', valign: 'middle', margin: 0, min: 7.5 });
        T(sl, x + 0.05, y + 0.95, SW - 0.1, 0.3, st.who, 10.5, { bold: true, color: NAVY, align: 'center', min: 7.5 });
      });
    }
    function photoBlock(sl, x, y, w, h, img) {
      sl.addImage({ data: img, x: x, y: y, w: w, h: h - 0.32, sizing: { type: 'cover', w: w, h: h - 0.32 } });
      T(sl, x, y + h - 0.3, w, 0.3, '対策後の職場のイメージ（AI で作成。実在の社員ではありません）', 9, { color: GREY, min: 7 });
    }
    function rowsBlock(sl, x, y, w, h, tb) {
      var rows = tb.slice(1), n = rows.length, WP = 1.3, WA = 0.4, WN = (w - WP - WA - 0.2) * 0.43, WNEW = w - WP - WA - 0.2 - WN;
      var XN = x + WP + 0.1, XAr = XN + WN + 0.05, XNew = XAr + WA + 0.05;
      T(sl, XN, y, WN, 0.35, '今', 14, { bold: true, color: GREY, align: 'center', nofit: true });
      T(sl, XNew, y, WNEW, 0.35, '改善後', 14, { bold: true, color: NAVY, align: 'center', nofit: true });
      var rh = Math.min(1.6, (h - 0.45 - 0.12 * (n - 1)) / n);
      rows.forEach(function (r, i) {
        var yy = y + 0.45 + i * (rh + 0.12);
        box(sl, x, yy, WP, rh, LIGHT, null);
        person(sl, x + WP / 2, yy + Math.max(0.08, rh / 2 - 0.55), NAVY, Math.min(1, rh / 1.35));
        T(sl, x, yy + rh - 0.4, WP, 0.36, r[0] || '', 11, { bold: true, align: 'center', min: 7.5 });
        T(sl, XN, yy, WN, rh, r[1] || '', 11.5, { fill: LIGHT, shape: S.roundRect, valign: 'middle', margin: 6, min: 8 });
        arrow(sl, XAr, yy + rh / 2 - 0.18, WA - 0.1, 0.36, NAVY);
        var nv = String(r[2] || ''), ss = sentences(nv);
        T(sl, XNew, yy, WNEW, rh, ss.length > 1 ? [[[ss[0], { b: true, c: NAVY }]], ss.slice(1).join('')] : [[[nv, { b: true, c: NAVY }]]], 11.5, { fill: LNAVY, line: CARDLINE, shape: S.roundRect, valign: 'middle', margin: 6, min: 8 });
      });
    }
    function mockBlock(sl, x, y, w, h, m) {
      var tb = m.table, wide = tb && tb[0] && tb[0].length >= 3;
      box(sl, x, y, w, h, LIGHT, null, { rect: true });
      var notesH = m.notes.length ? 0.5 : 0.1;
      box(sl, x + 0.15, y + 0.15, w - 0.3, h - 0.3 - notesH, WHITE, LINE, { rect: true });
      T(sl, x + 0.25, y + 0.2, w - 1.4, 0.38, m.name, 12.5, { bold: true, min: 9 });
      tag(sl, x + w - 1.1, y + 0.25, 0.85, wide ? '記入例' : '見本', NAVY, 9);
      var top = y + 0.65, avail = h - 0.3 - notesH - 0.55;
      if (tb && wide) {
        var cw = tb[0].map(function (c, j) { return Math.max(2.6, Math.max.apply(null, tb.map(function (r) { return Math.min(14, vlen(r[j] || '')); }))); });
        var sum = cw.reduce(function (a, b) { return a + b; }, 0), tw = w - 0.5;
        var rowH = Math.min(0.6, avail / tb.length);
        addTable(sl, x + 0.25, top, tw, tb, cw.map(function (c) { return c / sum * tw; }), { size: rowH < 0.45 ? 9 : 10, headSize: 10, rowH: rowH });
      } else if (tb) {
        var rows = tb.slice(1).length ? tb.slice(1) : tb, rh = Math.min(0.5, avail / rows.length);
        var lw = Math.min((w - 0.6) * 0.42, Math.max(0.45, Math.max.apply(null, rows.map(function (r) { return vlen(r[0] || ''); })) * 0.15 + 0.2));
        rows.forEach(function (r, k) {
          var yy = top + k * rh;
          T(sl, x + 0.3, yy, lw, rh, r[0] || '', 10, { bold: true, color: GREY, valign: 'middle', min: 7 });
          T(sl, x + 0.3 + lw, yy, w - 0.6 - lw, rh, r.slice(1).join('　'), 10.5, { valign: 'middle', min: 7 });
          vline(sl, x + 0.3, yy + rh - 0.02, x + w - 0.3, yy + rh - 0.02, LINE, 0.75);
        });
      }
      if (m.notes.length) {
        var ck = m.notes.map(kv).filter(function (o) { return /確かめる/.test(o.k); })[0];
        if (ck) check(sl, x + 0.2, y + h - 0.45, ck.v);
        else T(sl, x + 0.15, y + h - 0.48, w - 0.3, 0.42, m.notes.join('。'), 9.5, { color: GREY, min: 7 });
      }
    }
    function changesBlock(sl, x, y, w, h, items) {
      box(sl, x, y, w, h, LNAVY, CARDLINE);
      T(sl, x + 0.15, y + 0.08, w - 0.3, 0.35, '変わること', 13, { bold: true, color: NAVYD, nofit: true });
      T(sl, x + 0.15, y + 0.5, w - 0.3, h - 0.55, items, 12.5, { bullet: true, min: 8, space: 8 });
    }
    function improvePages(A, K, img) {
      var P = A.p2;
      var msg = (P.head.split(/[：:]/)[1] || '').trim();
      var title = '取り組み' + K + '②：' + (msg || A.name);
      var changes = pick(P.bs, '変わること'), support = pick(P.bs, '当社の支援')[0] || '';
      var blocks = [];
      if (img) blocks.push({ t: 'photo', w: 4.0 });
      if (P.rows && P.rows.length > 1) blocks.push({ t: 'rows', w: 8.1 });
      P.mocks.forEach(function (m) { blocks.push({ t: 'mock', m: m, w: m.table && m.table[0] && m.table[0].length >= 3 ? 7.3 : 4.0 }); });
      if (changes.length) blocks.push({ t: 'changes', w: 4.0 });
      var pg = [[]], used = 0;
      blocks.forEach(function (b) {
        var need = b.w + (pg[pg.length - 1].length ? 0.17 : 0);
        if (used + need > 12.34 && pg[pg.length - 1].length) { pg.push([]); used = 0; need = b.w; }
        pg[pg.length - 1].push(b); used += need;
      });
      pg.forEach(function (bl, pi) {
        var last = pi === pg.length - 1;
        var sl = header(title + (pi ? '（続き）' : ''), K + '｜② 改善策' + (pi ? '（続き）' : ''));
        if (pi === 0) lead(sl, pick(P.bs, 'やること')[0] || '');
        var top = pi === 0 ? 1.6 : 1.25;
        if (pi === 0 && P.steps.length) { afterFlow(sl, P.steps, 1.55); top = 2.95; }
        var bottom = last && support ? 6.2 : 6.88;
        var sumW = bl.reduce(function (a, b) { return a + b.w; }, 0) + 0.17 * Math.max(0, bl.length - 1);
        var grow = bl.filter(function (b) { return b.t === 'changes'; })[0] || bl[bl.length - 1];
        if (grow) grow.w += Math.max(0, 12.33 - sumW);
        var x = 0.5;
        bl.forEach(function (b) {
          var h = bottom - top;
          if (b.t === 'photo') photoBlock(sl, x, top, b.w, h, img);
          else if (b.t === 'rows') rowsBlock(sl, x, top, b.w, h, P.rows);
          else if (b.t === 'mock') mockBlock(sl, x, top, b.w, h, b.m);
          else changesBlock(sl, x, top, b.w, h, changes);
          x += b.w + 0.17;
        });
        if (last) supportStrip(sl, 6.32, support);
      });
    }

    // ---- 流れの書いていない取り組み（任意など）は ①②③ を1枚に
    function threeColPage(A, K) {
      var sl = header('取り組み' + K + '：' + A.name + (A.optional ? '（任意）' : ''), K + '｜①〜③');
      lead(sl, pick(A.p2.bs, 'やること')[0] || (A.optional ? 'この取り組みは任意です。時期はご相談のうえ決めます。' : ''));
      var c1 = A.p1.bs.map(function (b) { var o = kv(b); return /^課題/.test(o.k) ? o.v + '（' + o.k.replace(/^課題\s*\d+\s*/, '').replace(/^（|）$/g, '') + '）' : (o.k === '要点' ? o.v : b); });
      var c2 = pick(A.p2.bs, '変わること');
      var c3 = [];
      var tb = A.p3.table;
      if (tb && tb.length > 1) {
        var h0 = tb[0], iT = colIdx(h0, /作業|やること/, 0), iW = colIdx(h0, /担当/, 1), iS = colIdx(h0, /時期/, 2);
        tb.slice(1).forEach(function (r) { c3.push((r[iT] || '') + '（' + [r[iW], r[iS]].filter(Boolean).join('・') + '）'); });
      }
      A.p3.bs.forEach(function (b) { var o = kv(b); if (o.k !== '当社の支援') c3.push(b); });
      var cols = [['① 今の業務と課題', GFILL, LIGHT, c1], ['② 改善策', NAVY, LNAVY, c2], ['③ 進め方', NAVY, LNAVY, c3]];
      var support = pick(A.p2.bs, '当社の支援').concat(pick(A.p3.bs, '当社の支援')).join('。');
      var bottom = support ? 6.15 : 6.85;
      cols.forEach(function (c, i) {
        var x = 0.5 + i * 4.17;
        T(sl, x, 1.6, 3.99, 0.55, c[0], 14, { bold: true, color: WHITE, fill: c[1], shape: S.rect, valign: 'middle', margin: 8, nofit: true });
        box(sl, x, 2.15, 3.99, bottom - 2.15, c[2], null, { rect: true });
        if (c[3].length) T(sl, x + 0.15, 2.3, 3.7, bottom - 2.45, c[3], 13, { bullet: true, min: 8, space: 8 });
        if (i < 2) arrow(sl, x + 4.0, (2.15 + bottom) / 2 - 0.17, 0.16, 0.35, c[1]);
      });
      supportStrip(sl, 6.28, support);
    }

    // ---- 仕組みと情報管理
    function systemPage(s) {
      var parts = split(s.lines, '###');
      var get = function (re) { var p = parts.filter(function (q) { return re.test(q.head); })[0]; return p ? bulletsOf(p.lines) : []; };
      var classes = get(/分け方|区分/), sys = get(/^仕組み|構成/), rules = get(/ルール|止まった/);
      var sv = function (k) { return pick(sys, k)[0] || ''; };
      if (!sv('クラウド') && !sv('使う人')) return genericPage(s);
      var sl = header(s.title, nIss ? nIss + 'つの課題の前提' : '');
      var cloud = nameParen(sv('クラウド'));
      lead(sl, (cloud.name ? cloud.name + ' を中心に、' : '') + '今あるシステムを活かします。AI に入れる前と、使う前に人が確かめます。');
      T(sl, 0.5, 1.6, 2.4, 1.55, [[['今あるシステム', { b: true }]], [[sv('今あるシステム'), { s: 10 }]]], 12, { fill: LIGHT, shape: S.roundRect, margin: 6, min: 7.5 });
      arrow(sl, 2.95, 2.15, 0.45, 0.4, NAVY);
      var proc = pick(classes, '加工して入れる')[0] || '';
      T(sl, 3.45, 1.6, 2.2, 1.55, [[['入れる資料を選ぶ', { b: true, c: NAVY }]], [['下の区分で選び、' + (proc ? '必要なら' + proc.replace(/^.*?から、?/, '') : '入れてよい資料だけにする'), { s: 10 }]]], 11, { fill: LNAVY, line: CARDLINE, shape: S.roundRect, margin: 6, min: 7.5 });
      check(sl, 3.5, 3.22, '人が確かめる');
      arrow(sl, 5.7, 2.15, 0.45, 0.4, NAVY);
      box(sl, 6.2, 1.5, 4.0, 3.55, LNAVY, CARDLINE);
      T(sl, 6.32, 1.55, 3.8, 0.35, cloud.name || 'クラウド', 12.5, { bold: true, color: NAVY, min: 9 });
      var items = splitTop(cloud.desc, ['、']).slice(0, 5), ih = (3.55 - 0.5) / Math.max(1, items.length);
      items.forEach(function (it, k) {
        var p = it.split(/[＝=]/);
        T(sl, 6.32, 1.95 + k * ih, 3.76, ih - 0.08, p.length > 1 ? [[[p[0], { b: true }]], [[p.slice(1).join('＝'), { s: 10 }]]] : [[[it, { b: true }]]], 11.5, { fill: WHITE, shape: S.roundRect, valign: 'middle', margin: 5, min: 7.5 });
      });
      arrow(sl, 10.25, 2.95, 0.45, 0.4, NAVY);
      box(sl, 10.75, 1.5, 2.08, 3.55, LIGHT, null);
      T(sl, 10.8, 1.55, 2.0, 0.35, '使う人', 12.5, { bold: true, align: 'center', nofit: true });
      var users = splitTop(nameParen(sv('使う人')).name, ['・', '、']).slice(0, 4), uh = Math.min(0.85, 2.5 / Math.max(1, users.length));
      users.forEach(function (u, k) {
        person(sl, 11.2, 2.0 + k * uh, NAVY, Math.min(0.7, uh * 0.8));
        T(sl, 11.5, 2.0 + k * uh, 1.3, Math.max(0.4, uh * 0.65), u, 11, { bold: true, valign: 'middle', min: 8 });
      });
      check(sl, 10.82, 4.6, '答えは人が判断');
      if (sv('事務')) {
        T(sl, 0.5, 3.75, 3.0, 0.35, '事務', 12.5, { bold: true, color: NAVY, nofit: true });
        T(sl, 0.5, 4.12, 5.55, 0.9, sv('事務'), 11, { fill: LIGHT, shape: S.roundRect, valign: 'middle', margin: 6, min: 8 });
      }
      if (classes.length) {
        T(sl, 0.5, 5.2, 6.0, 0.35, 'AI に入れる情報の区分', 12.5, { bold: true, nofit: true });
        var cc = classes.slice(0, 3), cw = (12.33 - 0.2 * (cc.length - 1)) / cc.length;
        cc.forEach(function (b, k) {
          var o = kv(b), col = /入れない/.test(o.k) ? RED : /加工/.test(o.k) ? GREY : NAVY, fill = col === RED ? LRED : col === GREY ? LIGHT : LNAVY;
          T(sl, 0.5 + k * (cw + 0.2), 5.57, cw, 0.82, [[[(o.k || '') + '　', { b: true, c: col }], [o.v, { s: 10.5 }]]], 11.5, { fill: fill, line: col, shape: S.roundRect, valign: 'middle', margin: 6, min: 8 });
        });
      }
      if (rules.length) T(sl, 0.5, 6.47, 12.33, 0.55, rules.join('　'), 9.5, { color: GREY, min: 7 });
    }

    // ---- 体制
    function teamPage(s) {
      var parts = split(s.lines, '###');
      var get = function (re) { var p = parts.filter(function (q) { return re.test(q.head); })[0]; return p ? bulletsOf(p.lines) : []; };
      var cust = get(/御社|お客様/), kb = get(/当社/), partners = get(/連携/);
      if (!cust.length) return genericPage(s);
      var sl = header(s.title);
      var tops = [], lows = [];
      cust.forEach(function (b) {
        var o = kv(b);
        splitTop(o.v, ['、']).forEach(function (seg) {
          var np = nameParen(seg), r = { role: o.k, name: np.name, desc: np.desc.split('、').join('／') };
          if (/決める/.test(o.k)) tops.push(r); else lows.push(r);
        });
      });
      if (!tops.length && lows.length) tops.push(lows.shift());
      var role = function (x, y, w, h, r) {
        box(sl, x, y, w, h, WHITE, CARDLINE);
        person(sl, x + 0.45, y + 0.15, NAVY, 0.8);
        T(sl, x + 0.85, y + 0.08, w - 0.95, 0.4, r.name, 13, { bold: true, min: 9 });
        if (r.role) tag(sl, x + 0.85, y + 0.5, 1.0, r.role, NAVY, 9.5);
        T(sl, x + 0.15, y + 0.88, w - 0.3, h - 0.95, r.desc, 10.5, { min: 7.5 });
      };
      var AW = 10.4;
      var tw = Math.min(4.0, (AW - 0.25 * (tops.length - 1)) / tops.length), tx = 0.5 + (AW - (tw * tops.length + 0.25 * (tops.length - 1))) / 2;
      tops.forEach(function (r, i) { role(tx + i * (tw + 0.25), 1.15, tw, 1.55, r); });
      if (lows.length) {
        var lw = (AW - 0.25 * (lows.length - 1)) / lows.length, cx = [];
        lows.forEach(function (r, i) { var x = 0.5 + i * (lw + 0.25); cx.push(x + lw / 2); role(x, 3.15, lw, 1.6, r); });
        vline(sl, 0.5 + AW / 2, 2.7, 0.5 + AW / 2, 2.95, GREY, 1.5);
        if (cx.length > 1) vline(sl, cx[0], 2.95, cx[cx.length - 1], 2.95, GREY, 1.5);
        cx.forEach(function (c) { vline(sl, c, 2.95, c, 3.15, GREY, 1.5); });
      }
      box(sl, 11.1, 1.15, 1.73, 3.6, KBT, ORANGE);
      T(sl, 11.15, 1.22, 1.63, 0.6, ["Kamo's", 'BASE'], 13, { bold: true, color: ORANGE, align: 'center', nofit: true });
      tag(sl, 11.35, 1.9, 1.2, '整える', ORANGE, 9.5);
      var kbItems = kb.length ? splitTop(kb[0], ['、']) : [];
      T(sl, 11.18, 2.3, 1.6, 2.4, kbItems, 10, { min: 7, space: 5 });
      if (partners.length) {
        var ptxt = partners.join(''), ss = sentences(ptxt), tail = ss.filter(function (x) { return /窓口|調整/.test(x); }).join('');
        var body = ss.filter(function (x) { return !/窓口|調整/.test(x); }).join('').replace(/。$/, '');
        var list = splitTop(body, ['、']).slice(0, 5), pw = (12.33 - 0.15 * (list.length - 1)) / Math.max(1, list.length);
        T(sl, 0.5, 5.0, 12.33, 0.35, '必要なときだけ協力していただく連携先' + (tail ? '（' + tail.replace(/。$/, '') + '）' : ''), 11.5, { bold: true, color: GREY, min: 8 });
        list.forEach(function (p, k) {
          var np = nameParen(p);
          T(sl, 0.5 + k * (pw + 0.15), 5.4, pw, 0.85, np.desc ? [[[np.name, { b: true }]], [[np.desc, { s: 10 }]]] : [[[np.name, { b: true }]]], 11, { fill: WHITE, line: LINE, dash: true, shape: S.roundRect, valign: 'middle', margin: 6, min: 7.5 });
        });
      }
      if (kb.length > 1) T(sl, 0.5, 6.4, 12.33, 0.5, kb.slice(1).join('　'), 10.5, { color: GREY, min: 8 });
    }

    // ---- 全体の工程
    function durOf(s) {
      s = String(s || '');
      var m = s.match(/(\d+)\s*(?:[〜~～]\s*(\d+))?\s*週/);
      if (m) return { d: (+(m[2] || m[1])) / 4.3, tail: false };
      m = s.match(/(\d+(?:\.\d+)?)\s*(?:[〜~～]\s*(\d+(?:\.\d+)?))?\s*(?:か月|ヶ月|カ月|ケ月)/);
      if (m) return { d: +(m[2] || m[1]), tail: false };
      return { d: 1.3, tail: true };
    }
    function schedulePage(s) {
      var tb = tables(s.lines)[0];
      if (!tb || tb.length < 2) return genericPage(s);
      var h0 = tb[0], iN = colIdx(h0, /段階/, 0), iD = colIdx(h0, /期間/, 1), iA = colIdx(h0, /取り組み|中身/, 2), iC = colIdx(h0, /条件|節目/, 3);
      var rows = tb.slice(1).map(function (r) { var d = durOf(r[iD]); return { n: r[iN] || '', d: d.d, tail: d.tail || /定着|任意/.test(r[iN] || ''), dur: r[iD] || '', a: r[iA] || '', c: r[iC] || '' }; });
      var t = 0;
      rows.forEach(function (r) { r.s0 = t; t += r.d; r.s1 = t; });
      var core = rows.filter(function (r) { return !r.tail; }), months = core.length ? core[core.length - 1].s1 : t;
      var MON = Math.min(12, Math.max(1, Math.ceil(t - 0.001)));
      var sl = header('全体の工程：約' + Math.round(months) + 'か月。各段階の終わりに、御社と結果を確かめる');
      var GX = 2.9, GW = 9.93, mw = GW / MON, rh = Math.min(0.7, 3.0 / rows.length);
      for (var m = 0; m < MON; m++) {
        var x = GX + m * mw;
        T(sl, x, 1.15, mw - 0.04, 0.42, (m + 1) + 'か月目' + (m === MON - 1 && rows[rows.length - 1].tail ? '〜' : ''), 10.5, { bold: true, color: GREY, fill: LIGHT, shape: S.rect, align: 'center', valign: 'middle', min: 7 });
        vline(sl, x, 1.6, x, 1.75 + rows.length * rh, LIGHT, 0.75);
      }
      var ms = 0;
      rows.forEach(function (r, k) {
        var y = 1.75 + k * rh;
        T(sl, 0.5, y, 2.35, rh - 0.1, [[[r.n + (r.dur ? '（' + r.dur + '）' : ''), { b: true }]], [[r.a, { s: 9.5, c: GREY }]]], 11.5, { valign: 'middle', min: 7 });
        var bw = Math.max(0.3, (Math.min(r.s1, MON) - r.s0) * mw - 0.05);
        // 棒の中の文字は、棒が十分に長いときだけ（短い棒は節目の印と重なるため）
        if (bw >= 1.6) T(sl, GX + r.s0 * mw, y + 0.08, bw, rh - 0.24, r.a, 10, { bold: true, color: WHITE, fill: NAVY, shape: S.roundRect, align: 'center', valign: 'middle', min: 7 });
        else box(sl, GX + r.s0 * mw, y + 0.08, bw, rh - 0.24, NAVY, null);
        if (!r.tail && r.c) {
          ms++;
          r.ms = ms;
          sl.addText(String(ms), { x: GX + r.s1 * mw - 0.2, y: y + 0.06, w: 0.42, h: rh - 0.2, shape: S.diamond, fill: { color: NAVY }, line: { color: WHITE, width: 1 }, fontFace: FONT, fontSize: 10, bold: true, color: WHITE, align: 'center', valign: 'middle', margin: 0 });
        }
      });
      var mrows = rows.filter(function (r) { return r.ms; }).slice(0, 4);
      var y0 = 1.75 + rows.length * rh + 0.15;
      if (mrows.length) {
        T(sl, 0.5, y0, 12.33, 0.35, '◆ 判断の節目：次に進むときに確かめること', 12.5, { bold: true, color: NAVY, nofit: true });
        var bw2 = (12.33 - 0.2 * (mrows.length - 1)) / mrows.length, bh = Math.min(1.3, 6.4 - (y0 + 0.4));
        mrows.forEach(function (r, k) {
          var x = 0.5 + k * (bw2 + 0.2), yy = y0 + 0.4;
          box(sl, x, yy, bw2, bh, LIGHT, null);
          sl.addText(String(r.ms), { x: x + 0.12, y: yy + 0.1, w: 0.36, h: 0.4, shape: S.diamond, fill: { color: NAVY }, fontFace: FONT, fontSize: 9.5, bold: true, color: WHITE, align: 'center', valign: 'middle', margin: 0 });
          T(sl, x + 0.55, yy + 0.08, bw2 - 0.65, 0.42, '節目' + r.ms + '（' + r.n + 'の終わり）', 11.5, { bold: true, valign: 'middle', min: 8 });
          T(sl, x + 0.15, yy + 0.52, bw2 - 0.3, bh - 0.55, r.c, 10.5, { min: 7.5 });
        });
      }
      var bs = bulletsOf(s.lines);
      if (bs.length) T(sl, 0.5, 6.45, 12.33, 0.5, bs.join('　'), 10.5, { color: GREY, min: 7.5 });
    }

    // ---- 費用と効果
    function costPage(s) {
      var parts = split(s.lines, '###');
      var get = function (re) { return parts.filter(function (q) { return re.test(q.head); })[0]; };
      var pS = get(/支援費/), pR = get(/運用費/), pE = get(/効果/);
      var tS = pS && tables(pS.lines)[0], tR = pR && tables(pR.lines)[0], tE = pE && tables(pE.lines)[0];
      if (!tS && !tE) return genericPage(s);
      var allB = bulletsOf(s.lines);
      var rec = pick(allB, '回収の見込み')[0] || '';
      var rp = (rec.match(/([^、。（）]*で回収できる見込み)/) || [])[1];
      var sl = header('費用と効果' + (rp ? '：' + rp + '【仮定】' : ''), nIss ? nIss + 'つの課題すべて' : '');
      var y = 1.1;
      if (tS) {
        T(sl, 0.5, y, 6.0, 0.42, '当社の支援費（税抜）', 16, { bold: true, color: ORANGE, nofit: true });
        var rows = tS.map(function (r, i) { return i ? r.map(function (c, j) { return j === 0 ? String(c).replace(/（/, '\n（') : j === 1 ? String(c).replace(/：/, '\n') : c; }) : r; });
        var rh = Math.min(0.56, 3.0 / rows.length);
        addTable(sl, 0.5, y + 0.45, 6.0, rows, [1.25, 3.45, 1.3], { size: 10, headFill: ORANGE, rowH: rh, boldFirst: true, cell: function (cell, i, j, r) {
          if (i > 0 && /合計/.test(r[0])) { cell.options.fill = { color: KBT }; cell.options.bold = true; }
          if (i > 0 && j === 2) { cell.options.color = ORANGE; cell.options.bold = true; }
        } });
        y += 0.45 + rows.length * rh + 0.25;
      }
      if (tR) {
        T(sl, 0.5, y, 6.0, 0.42, '運用費（月額・税抜）', 14, { bold: true, color: NAVY, nofit: true });
        var rh2 = Math.min(0.36, 1.6 / tR.length);
        addTable(sl, 0.5, y + 0.42, 6.0, tR, [4.0, 2.0], { size: 10, rowH: rh2, cell: function (cell, i, j, r) { if (i > 0 && /当社/.test(r[0])) { cell.options.color = ORANGE; cell.options.bold = true; } } });
        y += 0.42 + tR.length * rh2 + 0.12;
        var rb = bulletsOf(pR.lines);
        if (rb.length) {
          var ss = sentences(rb.join(''));
          T(sl, 0.5, y, 6.0, Math.max(0.3, 7.0 - y), [[[ss[0] || '', { b: true, s: 12 }]]].concat(ss.slice(1).length ? [[[ss.slice(1).join(''), { s: 10, c: GREY }]]] : []), 12, { min: 7.5 });
        }
      }
      // 効果
      T(sl, 6.85, 1.1, 6.0, 0.42, '効果：人の時間を金額にした年間の目安【仮定】', 14, { bold: true, color: NAVY, min: 10 });
      var labels = [], vals = [];
      if (tE && tE.length > 1) {
        var hE = tE[0], iL = 0, iV = colIdx(hE, /金額|年間/, hE.length - 1), iH = colIdx(hE, /時間/, -1);
        tE.slice(1).forEach(function (r) {
          var v = parseFloat(String(r[iV] || '').replace(/[^0-9.]/g, ''));
          if (!isNaN(v)) { labels.push(r[iL]); vals.push(v); }
        });
      }
      var total = (pick(M.mapNotes, '効果の合計')[0] || '').replace(/【[^】]*】/g, '');
      if (!total && vals.length) total = '年 約' + vals.reduce(function (a, b) { return a + b; }, 0) + '万円相当';
      if (total) T(sl, 6.85, 1.5, 6.0, 0.6, total, 26, { bold: true, color: NAVY, valign: 'middle', min: 14 });
      if (vals.length) {
        sl.addChart(pptx.ChartType.bar, [{ name: '年間（万円）', labels: labels.slice().reverse(), values: vals.slice().reverse() }], {
          x: 6.85, y: 2.15, w: 6.0, h: 2.9, barDir: 'bar', chartColors: [NAVY], showValue: true, dataLabelFormatCode: '0"万円"', dataLabelPosition: 'outEnd',
          dataLabelFontSize: 11, dataLabelFontBold: true, dataLabelFontFace: FONT, dataLabelColor: INK, valAxisHidden: true, valGridLine: { style: 'none' }, catGridLine: { style: 'none' },
          catAxisLabelFontSize: 10, catAxisLabelFontFace: FONT, catAxisLabelColor: INK, catAxisLineColor: LINE, showLegend: false, barGapWidthPct: 60,
          valAxisMinVal: 0, valAxisMaxVal: Math.ceil(Math.max.apply(null, vals) * 1.3)
        });
      }
      if (rec) {
        var rs = sentences(rec);
        T(sl, 6.85, 5.2, 6.0, 1.1, [rs.slice(0, -1).join('') || rec].concat(rs.length > 1 ? [[[rs[rs.length - 1], { b: true, c: NAVY }]]] : []), 12, { fill: LNAVY, shape: S.roundRect, valign: 'middle', margin: 8, min: 8, space: 3 });
      }
      var rest = (pE ? bulletsOf(pE.lines) : []).filter(function (b) { return !/^回収の見込み/.test(b); });
      if (rest.length) T(sl, 6.85, 6.38, 6.0, 0.62, rest.join('　'), 9.5, { color: GREY, min: 7 });
    }

    // ---- 目標の根拠と道筋
    function roadPage(s) {
      var tb = tables(s.lines)[0];
      if (!tb || tb.length < 2) return genericPage(s);
      var ti = s.lines.findIndex(function (l) { return /^\s*\|/.test(l); });
      var before = bulletsOf(s.lines.slice(0, ti)), after = bulletsOf(s.lines.slice(ti));
      var h0 = tb[0], iY = colIdx(h0, /時期|年/, 0), iD = colIdx(h0, /やること/, 1), iS = colIdx(h0, /状態|届く/, 2);
      var rows = tb.slice(1).map(function (r) {
        var st = r[iS] || '', mm = st.match(/([0-9]+(?:\.[0-9]+)?)\s*倍/), np = nameParen(r[iD] || '');
        return { y: r[iY] || '', title: np.name, items: np.desc ? splitTop(np.desc, ['、']) : [], state: st, v: mm ? +mm[1] : null };
      });
      var sl = header(s.title);
      var ld = before.filter(function (b) { return /＝|×/.test(b); })[0] || '';
      lead(sl, ld);
      var reasons = before.filter(function (b) { return b !== ld; }).slice(0, 4);
      var top = 1.55;
      if (reasons.length) {
        var rw = (12.33 - 0.15 * (reasons.length - 1)) / reasons.length;
        reasons.forEach(function (b, k) {
          var o = kv(b);
          T(sl, 0.5 + k * (rw + 0.15), top, rw, 0.8, o.k ? [[[o.k, { b: true, c: NAVY }]], [[o.v, { s: 10 }]]] : [b], 11, { fill: LIGHT, shape: S.roundRect, valign: 'middle', margin: 6, min: 7.5 });
        });
        top += 0.95;
      }
      var hasV = rows.some(function (r) { return r.v; }), px = hasV ? 8.05 : 0.5, pwid = hasV ? 4.78 : 12.33;
      if (hasV) {
        var bars = [{ y: '今', v: 1.0, cap: '今', col: GFILL }].concat(rows.filter(function (r) { return r.v; }).map(function (r) { return { y: r.y, v: r.v, cap: r.title, col: NAVY }; }));
        var BASE = 5.85, maxV = Math.max.apply(null, bars.map(function (b) { return b.v; })), SC = (BASE - top - 0.85) / maxV, bwid = Math.min(1.25, 6.6 / bars.length - 0.35);
        T(sl, 0.55, top, 5.0, 0.32, '目安（今を1とした倍率）【仮定】', 11, { bold: true, color: GREY, nofit: true });
        bars.forEach(function (b, i) {
          var x = 0.75 + i * (7.0 / bars.length), hh = b.v * SC;
          box(sl, x, BASE - hh, bwid, hh, b.col, null, { rect: true });
          T(sl, x - 0.2, BASE - hh - 0.45, bwid + 0.4, 0.42, (Math.round(b.v * 10) / 10).toFixed(1) + '倍', 16, { bold: true, color: b.col === GFILL ? GREY : NAVY, align: 'center', nofit: true });
          T(sl, x - 0.25, BASE + 0.08, bwid + 0.5, 0.3, b.y, 12, { bold: true, align: 'center', min: 8 });
          if (b.cap !== b.y) T(sl, x - 0.25, BASE + 0.38, bwid + 0.5, 0.3, b.cap, 9.5, { color: GREY, align: 'center', min: 7 });
        });
        vline(sl, 0.55, BASE, 7.6, BASE, GREY, 1.25);
      }
      var ph = (6.5 - top - 0.15 * (rows.length - 1)) / rows.length;
      rows.forEach(function (r, k) {
        var y = top + k * (ph + 0.15);
        box(sl, px, y, pwid, ph, WHITE, CARDLINE);
        T(sl, px, y, 1.25, ph, [[[r.y, { b: true, s: 13, c: WHITE }]], [[r.title, { s: 9.5, c: WHITE }]]], 12, { fill: NAVY, shape: S.rect, align: 'center', valign: 'middle', min: 7 });
        T(sl, px + 1.35, y + 0.08, pwid - 1.45, ph - 0.12, r.items.concat(r.state ? [r.state] : []), 11, { bullet: true, min: 7.5, space: 3 });
      });
      if (after.length) T(sl, 0.5, 6.6, 12.33, 0.42, after.join('　'), 10, { color: GREY, min: 7.5 });
    }

    // ---- リスク
    function riskPage(s) {
      var bs = bulletsOf(s.lines), support = pick(bs, '当社の支援')[0] || '';
      var items = bs.map(kv).filter(function (o) { return o.k !== '当社の支援'; });
      if (!items.length) return genericPage(s);
      var sl = header(s.title);
      lead(sl, '進めるときに起きやすい失敗と、その防ぎ方です。');
      var cols = items.length > 3 ? 2 : 1, rowsN = Math.ceil(items.length / cols), cw = (12.33 - 0.2 * (cols - 1)) / cols;
      var bottom = support ? 6.15 : 6.85, ch = Math.min(1.3, (bottom - 1.6 - 0.15 * (rowsN - 1)) / rowsN);
      items.forEach(function (o, k) {
        var x = 0.5 + (k % cols) * (cw + 0.2), y = 1.6 + Math.floor(k / cols) * (ch + 0.15);
        box(sl, x, y, cw, ch, WHITE, RED);
        tag(sl, x + 0.12, y + 0.12, 0.8, 'リスク', RED, 9.5);
        T(sl, x + 1.05, y + 0.06, cw - 1.15, 0.4, o.k || '', 13, { bold: true, color: RED, valign: 'middle', min: 9 });
        T(sl, x + 0.15, y + 0.5, cw - 0.3, ch - 0.55, o.v, 11, { min: 7.5 });
      });
      supportStrip(sl, 6.28, support);
    }

    // ---- 次に決めること
    function nextPage(s) {
      var bs = bulletsOf(s.lines), support = pick(bs, '当社の支援')[0] || '';
      var items = bs.map(kv).filter(function (o) { return o.k !== '当社の支援'; });
      if (!items.length) return genericPage(s);
      var sl = header(s.title);
      var n = Math.min(4, items.length), cw = (12.33 - 0.2 * (n - 1)) / n;
      items.slice(0, 4).forEach(function (o, i) {
        var x = 0.5 + i * (cw + 0.2);
        box(sl, x, 1.3, cw, 2.35, WHITE, CARDLINE);
        T(sl, x + 0.15, 1.35, 0.9, 0.6, ('0' + (i + 1)).slice(-2), 24, { bold: true, color: NAVY, valign: 'middle', nofit: true });
        T(sl, x + 1.0, 1.35, cw - 1.15, 0.6, o.k || '', 16, { bold: true, valign: 'middle', min: 10 });
        T(sl, x + 0.15, 2.0, cw - 0.3, 1.6, sentences(o.v).length > 1 ? sentences(o.v) : [o.v], 12, { bullet: true, min: 8, space: 6 });
      });
      var ss = sentences(support), s1 = ss.filter(function (x) { return /初回面談/.test(x); })[0] || '';
      var steps = [s1 || '初回面談で、今の業務と数字を伺う', '第1段階' + (M.pre && M.pre.name ? '「' + M.pre.name + '」' : '') + 'を始める', '試行の結果を見て、次の段階に進むかを御社で決める'];
      T(sl, 0.5, 3.85, 6.0, 0.35, '次の一歩', 14, { bold: true, color: NAVY, nofit: true });
      steps.forEach(function (t, k) {
        var x = 0.5 + k * 4.15;
        T(sl, x, 4.25, 3.75, 0.8, [[[(k + 1) + '　', { b: true, c: NAVY, s: 15 }], [t.replace(/。$/, ''), {}]]], 11.5, { fill: LNAVY, shape: S.roundRect, valign: 'middle', margin: 6, min: 8 });
        if (k < 2) arrow(sl, x + 3.8, 4.5, 0.3, 0.3, NAVY);
      });
      var reason = ss.filter(function (x) { return x !== s1; }).join('');
      box(sl, 0.5, 5.4, 12.33, 1.35, WHITE, ORANGE);
      logo(sl, 0.8, 5.85, 2.0, 0.45, 15);
      T(sl, 3.0, 5.45, 9.7, 1.25, [[['お任せいただける理由　', { b: true, c: ORANGE }]], reason || '試して終わりにせず、現場に残るところまで伴走します'], 11, { valign: 'middle', min: 8, space: 2 });
    }

    // ---- 決まった形でない節：見出し・箇条書き・表をそのまま
    function genericPage(s) {
      var sl = header(s.title), y = 1.25;
      var cont = function () { sl = header(s.title + '（続き）'); y = 1.25; };
      var buf = [];
      var flushText = function () {
        if (!buf.length) return;
        var hh = Math.min(6.9 - y, buf.reduce(function (n, l) { return n + Math.max(1, Math.ceil(vlen(l) / 58)); }, 0) * 0.3 + 0.1);
        if (hh < 0.4) { cont(); hh = Math.min(5.6, buf.length * 0.32 + 0.1); }
        T(sl, 0.5, y, 12.33, hh, buf.map(function (l) { return l.replace(/^\s*[-・*]\s+/, '・').replace(/\*\*/g, ''); }), 13, { min: 8, space: 4 });
        y += hh + 0.1; buf = [];
      };
      var tb = [];
      var flushTable = function () {
        if (!tb.length) return;
        var rows = tb.filter(function (r) { return !r.every(function (c) { return /^:?-{2,}:?$/.test(c) || c === ''; }); });
        var rh = 0.38, need = rows.length * rh;
        if (y + need > 6.9) cont();
        addTable(sl, 0.5, y, 12.33, rows.slice(0, Math.floor((6.9 - y) / rh)), rows[0].map(function () { return 12.33 / rows[0].length; }), { size: 10, rowH: rh });
        y += Math.min(need, 6.9 - y) + 0.15; tb = [];
      };
      s.lines.forEach(function (l) {
        if (/^\s*\|/.test(l)) { flushText(); tb.push(l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(strip)); return; }
        flushTable();
        var m = l.match(/^#{3,4}\s+(.*)$/);
        if (m) { flushText(); if (y > 6.3) cont(); T(sl, 0.5, y, 12.33, 0.4, strip(m[1]), 15, { bold: true, color: NAVY, nofit: true }); y += 0.45; return; }
        if (strip(l)) buf.push(l);
      });
      flushText(); flushTable();
    }

    // ---- 組み立て
    var firstPhotoUsed = false;
    if (M.pre) planPage(M.pre.full, nIss ? nIss + 'つの課題の前提' : '全体の前提', pick(M.pre.p3.bs, '要点')[0] || 'ほかの取り組みを始める前に、進め方と情報の扱いを決めます（計画は案）。', M.pre);
    M.acts.forEach(function (A) {
      var K = A.key;
      if (!A.p1.steps.length && !A.p2.steps.length) { threeColPage(A, K); return; }
      if (A.p1.steps.length) flowPage(A, K);
      var img = null;
      if (!firstPhotoUsed && images[1]) { img = images[1]; firstPhotoUsed = true; }
      improvePages(A, K, img);
      var st = stageOf(K);
      planPage('取り組み' + K + '③：進め方' + (st ? '（' + st + '）' : ''), K + '｜③ 進め方', pick(A.p3.bs, '要点')[0] || '作業の範囲・計画・担当・費用です（計画は案）。', A);
    });
    M.others.forEach(function (s) {
      var t = s.title;
      if (/仕組み|情報管理|構成/.test(t)) systemPage(s);
      else if (/体制/.test(t)) teamPage(s);
      else if (/工程|スケジュール/.test(t)) schedulePage(s);
      else if (/費用と効果/.test(t)) costPage(s);
      else if (/道筋|目標の根拠/.test(t)) roadPage(s);
      else if (/リスク|失敗/.test(t)) riskPage(s);
      else if (/次に決める/.test(t)) nextPage(s);
      else genericPage(s);
    });
    // ページ番号（表紙を除く）
    pages.forEach(function (sl, i) {
      if (i === 0) return;
      sl.addText((i + 1) + ' / ' + pages.length, { x: W - 1.3, y: H - 0.32, w: 0.9, h: 0.28, fontFace: FONT, fontSize: 9, color: GREY, align: 'right', margin: 0 });
    });
    return pptx;
  }

  root.DXY_buildProposal = build;
  root.DXY_proposalModel = model;   // 確かめ用
})(typeof window !== 'undefined' ? window : this);
