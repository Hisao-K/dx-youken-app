// dx-youken-app（DX要件定義）の画面（PWA）。
// 画面だけを受け持ち、データの出し入れはすべて GAS（AppApi）に任せる。ログインと録音の送り方は議事録デスク（gijiroku-app）と同じ。
// 案件のデータはこの端末にもこのサイトにも保存しない（端末に覚えるのは GAS の URL とログイン中のトークンだけ）。
(function () {
  'use strict';

  var CONFIG = window.DXY_CONFIG || {};
  var API_URL_STORE = 'dxy.api';
  var TOKEN_KEY = 'dxy.idt';
  var GAS_URL_RE = /^https:\/\/script\.google\.com\/(a\/macros\/[^/]+|macros)\/s\/[A-Za-z0-9_-]+\/exec$/;
  var IS_LOCAL = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
  var POLL_MS = 10000;
  var CHUNK_TRIES = 5;
  var KIND_LABEL = { text: '要件の文章', audio: '録音', survey: 'アンケートの結果' };
  var STEP_TAB = { s3: '目的・課題・ヒアリング', s4: '対策', s5: '分析' };  // 2026-11-05 タブ名を「目的・課題」「対策」に（久夫さん指示）

  var state = {
    apiUrl: '', idToken: '', session: 0, tokenWaiters: [],
    cfg: null, caseId: '', c: null, tab: 'reg', matOpen: {}, hosokuOpen: {}, dirty: false, uploading: false, pollTimer: 0,
  };

  // =========================
  //  小物
  // =========================
  function $(id) { return document.getElementById(id); }

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      var v = attrs[k];
      if (v == null || v === false) return;
      if (k === 'text') node.textContent = v;
      else if (k === 'class') node.className = v;
      else if (k === 'onclick') node.addEventListener('click', v);
      else if (k === 'oninput') node.addEventListener('input', v);
      else if (k === 'onchange') node.addEventListener('change', v);
      else if (k === 'value') node.value = v;
      else if (k === 'checked') node.checked = !!v;
      else if (k === 'disabled') node.disabled = !!v;
      else node.setAttribute(k, v === true ? '' : v);
    });
    (children || []).forEach(function (ch) { if (ch) node.appendChild(typeof ch === 'string' ? document.createTextNode(ch) : ch); });
    return node;
  }

  function storageGet(key) { try { return localStorage.getItem(key) || ''; } catch (e) { return ''; } }
  function storageSet(key, v) { try { localStorage.setItem(key, v); } catch (e) { /* 保存できなくても動かす */ } }
  function sessionGet(key) { try { return sessionStorage.getItem(key) || ''; } catch (e) { return ''; } }
  function sessionSet(key, v) { try { v ? sessionStorage.setItem(key, v) : sessionStorage.removeItem(key); } catch (e) { /* 同上 */ } }

  function msg(id, text, kind) {
    var p = $(id);
    if (!p) return;
    p.textContent = text || '';
    p.className = 'msg' + (kind ? ' ' + kind : '');
  }

  function busy(text) { $('busy-text').textContent = text || '処理しています…'; $('busy').hidden = false; }
  function idle() { $('busy').hidden = true; }

  function show(view) {
    ['setup', 'login', 'list', 'case'].forEach(function (v) { $('view-' + v).hidden = v !== view; });
    $('back').hidden = view !== 'case';
    window.scrollTo(0, 0);
  }

  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function ymd(d) { return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
  function mb(bytes) { return (bytes / 1024 / 1024).toFixed(1) + 'MB'; }
  function hm(s) { return String(s || '').replace('T', ' ').slice(5, 16); }
  function errText(x) { return (x && (x.message || String(x))) || '失敗しました。'; }
  /** GAS が返すリンクのうち、Google ドライブ・ドキュメントのものだけを使う */
  function safeLink(url) { return /^https:\/\/((docs|drive)\.google\.com|forms\.gle)\//.test(String(url || '')) ? url : ''; }

  function blobToBase64(blob) {
    return new Promise(function (resolve, reject) {
      var r = new FileReader();
      r.onload = function () { resolve(String(r.result).split(',')[1] || ''); };
      r.onerror = function () { reject(r.error); };
      r.readAsDataURL(blob);
    });
  }

  function autosize(t) { t.style.height = 'auto'; t.style.height = (t.scrollHeight + 4) + 'px'; }

  /** 中身を入れ替える（出さない部分＝null は飛ばす） */
  function put(node, items) { node.replaceChildren.apply(node, items.filter(Boolean)); }

  // =========================
  //  設定（GAS の URL）
  // =========================
  function validApiUrl(u) {
    if (IS_LOCAL && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(u)) return true;
    return GAS_URL_RE.test(u);
  }
  function apiLabel(u) { var m = String(u || '').match(/\/s\/([A-Za-z0-9_-]+)\//); return m ? '…' + m[1].slice(-8) : u; }

  /** リンクの ?api= は、確認して OK のときだけ使う（議事録デスク・名刺管理君と同じ） */
  function loadApiUrl() {
    var params = new URLSearchParams(location.search);
    var fromLink = params.get('api');
    var saved = storageGet(API_URL_STORE);
    if (fromLink && validApiUrl(fromLink) && fromLink !== saved) {
      var question = validApiUrl(saved)
        ? '接続先を切り替えますか？\n\n今の接続先: ' + apiLabel(saved) + '\n新しい接続先: ' + apiLabel(fromLink)
        : 'このリンクの接続先を使いますか？\n\n接続先: ' + apiLabel(fromLink);
      if (IS_LOCAL || confirm(question + '\n\nKamo\'s BASE から受け取ったリンクのときだけ「OK」を押してください。')) {
        storageSet(API_URL_STORE, fromLink);
        sessionSet(TOKEN_KEY, '');
        saved = fromLink;
      }
    }
    if (fromLink) {
      params.delete('api');
      try { history.replaceState(null, '', location.pathname + (params.toString() ? '?' + params : '') + location.hash); } catch (e) { /* 消せなくても動かす */ }
    }
    state.apiUrl = validApiUrl(saved) ? saved : '';
  }

  $('setup-save').addEventListener('click', function () {
    var u = $('setup-url').value.trim();
    if (!validApiUrl(u)) { msg('setup-msg', '設定コードの形が違います。https://script.google.com/macros/s/…/exec の形のURLを貼り付けてください。', 'err'); return; }
    if (u !== storageGet(API_URL_STORE)) sessionSet(TOKEN_KEY, '');
    storageSet(API_URL_STORE, u);
    state.apiUrl = u;
    start();
  });

  // =========================
  //  ログイン（Google）
  // =========================
  function decodeJwt(token) {
    try {
      var part = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
      var json = decodeURIComponent(atob(part).split('').map(function (c) { return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2); }).join(''));
      return JSON.parse(json);
    } catch (e) { return null; }
  }
  function apiId(u) { var m = String(u || '').match(/\/s\/([A-Za-z0-9_-]+)\//); return m ? m[1] : (IS_LOCAL ? 'local' : ''); }
  function loginNonce() {
    var bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return apiId(state.apiUrl) + '.' + Array.prototype.map.call(bytes, function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
  }
  function tokenValid(token) {
    var p = token && decodeJwt(token);
    return !!(p && p.exp * 1000 - Date.now() > 60 * 1000 && String(p.nonce || '').split('.')[0] === apiId(state.apiUrl));
  }
  function devMode() { return IS_LOCAL && CONFIG.devIdToken; }

  function setToken(token) {
    state.idToken = token || '';
    sessionSet(TOKEN_KEY, state.idToken);
    var p = token && decodeJwt(token);
    $('who').textContent = p ? p.email : (devMode() ? '（模擬環境）' : '');
    $('logout').hidden = !state.idToken && !devMode();
  }

  function onCredential(res) {
    if (!devMode() && !tokenValid(res.credential)) { msg('login-msg', 'ログインをやり直してください（接続先が変わったため）。', 'err'); return; }
    setToken(res.credential);
    state.tokenWaiters.splice(0).forEach(function (w) { w(state.idToken); });
    if (!$('view-login').hidden) enterMain();
  }

  function initGoogle() {
    if (devMode()) return true;
    if (!CONFIG.googleClientId) { msg('login-msg', 'アプリの設定が終わっていません（Google のクライアントIDが未設定）。', 'err'); return false; }
    if (!(window.google && google.accounts && google.accounts.id)) return false;
    google.accounts.id.initialize({
      client_id: CONFIG.googleClientId, nonce: loginNonce(), callback: onCredential,
      auto_select: true, itp_support: true, use_fedcm_for_prompt: true,
    });
    google.accounts.id.renderButton($('gsi-button'), { theme: 'outline', size: 'large', text: 'signin_with', locale: 'ja' });
    return true;
  }

  function freshToken() {
    if (devMode()) return Promise.resolve(CONFIG.devIdToken);
    if (tokenValid(state.idToken)) return Promise.resolve(state.idToken);
    return new Promise(function (resolve, reject) {
      var done = false;
      state.tokenWaiters.push(function (t) { done = true; resolve(t); });
      try { google.accounts.id.prompt(); } catch (e) { /* 下のタイマーでログイン画面へ */ }
      setTimeout(function () {
        if (done) return;
        state.tokenWaiters.splice(0);
        endSession('ログインの有効期限が切れました。もう一度ログインしてください。', 'err');
        reject(new Error('ログインが必要です'));
      }, 6000);
    });
  }

  /** 「閉じる」＝ログアウト。画面に出ている案件・入力中の文字を消してログイン画面に戻す */
  function logout() {
    if (state.uploading) { alert('ファイルを送っている途中です。送り終わってから閉じてください。'); return; }
    if (Rec.busy()) { alert('録音中です。「■ 止める」を押してから閉じてください。'); return; }
    if (state.dirty && !confirm('保存していない直しがあります。消えますが、閉じますか？')) return;
    if (!confirm('ログアウトして閉じますか？\n次に開いたときは、ログインからになります。')) return;
    try { google.accounts.id.disableAutoSelect(); } catch (e) { /* 未読み込みでも続ける */ }
    endSession('ログアウトしました。アプリを閉じるときは、スマホの操作で閉じてください。', 'ok');
  }

  function endSession(text, kind) {
    state.session++;
    setToken('');
    try { google.accounts.id.cancel(); } catch (e) { /* 何もしない */ }
    idle();
    stopPoll();
    state.uploading = false;
    state.dirty = false;
    state.c = null;
    state.caseId = '';
    ['case-list', 'case-head', 'tab-reg', 'tab-step'].forEach(function (id) { $(id).replaceChildren(); });
    $('new-form').reset();
    $('new-form').hidden = true;
    show('login');
    msg('login-msg', text, kind);
  }

  $('who').addEventListener('click', logout);
  $('logout').addEventListener('click', logout);

  // =========================
  //  GAS とのやり取り
  // =========================
  function api(action, params) {
    var session = state.session;
    var never = function () { return new Promise(function () {}); };
    return freshToken().then(function (idToken) {
      if (session !== state.session) return never();
      return fetch(state.apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },   // 事前確認（プリフライト）を出さない
        body: JSON.stringify(Object.assign({ action: action, idToken: idToken }, params || {})),
        redirect: 'follow',
      }).catch(function (e) {
        throw new Error('通信できませんでした。電波のよい場所でもう一度お試しください。\n[原因] ' + e.message);
      }).then(function (res) {
        return res.json().catch(function () { throw new Error('応答を読めませんでした。\n[原因] HTTP ' + res.status); });
      }).then(function (json) {
        if (session !== state.session) return never();
        if (!json.ok && json.code === 'AUTH') { endSession(json.message, 'err'); return never(); }
        return json;
      }, function (e) { if (session !== state.session) return never(); throw e; });
    }, function (e) { if (session !== state.session) return never(); throw e; });
  }

  /** 画面を止めて呼ぶ。失敗したら msgId に出す。成功したら応答を返す（失敗は null） */
  function call(action, params, busyText, msgId) {
    busy(busyText);
    return api(action, params).then(function (res) {
      idle();
      if (!res.ok) { if (msgId) msg(msgId, errText(res), 'err'); else alert(errText(res)); return null; }
      return res;
    }).catch(function (e) {
      idle();
      if (msgId) msg(msgId, errText(e), 'err'); else alert(errText(e));
      return null;
    });
  }

  // =========================
  //  はじまり・一覧
  // =========================
  function start() {
    loadApiUrl();
    if (!state.apiUrl) { show('setup'); return; }
    setToken(sessionGet(TOKEN_KEY));
    if (devMode() || tokenValid(state.idToken)) { enterMain(); return; }
    show('login');
    var tries = 0;
    (function waitGsi() {
      if (initGoogle()) return;
      if (++tries < 50) setTimeout(waitGsi, 200);
      else msg('login-msg', 'Google のログインを読み込めませんでした。電波を確かめて、開き直してください。', 'err');
    })();
  }

  function enterMain() {
    show('list');
    api('config').then(function (res) {
      if (!res.ok) { msg('list-msg', errText(res), 'err'); return; }
      state.cfg = res;
      $('n-savedir').replaceChildren.apply($('n-savedir'), res.saveDirs.map(function (d) { return el('option', { value: d.key, text: d.label }); }));
      loadCases();
    }).catch(function (e) { msg('list-msg', errText(e), 'err'); });
  }

  function loadCases() {
    msg('list-msg', '読み込んでいます…');
    return api('listCases').then(function (res) {
      if (!res.ok) { msg('list-msg', errText(res), 'err'); return; }
      msg('list-msg', res.items.length ? '' : 'まだ案件はありません。「＋ 新しい相談」から登録してください。');
      $('case-list').replaceChildren.apply($('case-list'), res.items.map(function (it) {
        return el('li', {}, [el('button', { onclick: function () { openCase(it.id); } }, [
          el('span', { class: 'name', text: it.title }),
          el('span', { class: 'sub', text: it.stage + '｜' + hm(it.updated) + (it.pending ? '｜処理中' : '') }),
        ])]);
      }));
    }).catch(function (e) { msg('list-msg', errText(e), 'err'); });
  }

  $('list-reload').addEventListener('click', loadCases);
  $('new-open').addEventListener('click', function () { $('new-form').hidden = !$('new-form').hidden; });
  $('new-save').addEventListener('click', function () {
    var org = document.querySelector('input[name="n-org"]:checked').value;
    call('createCase', {
      title: $('n-title').value, company: $('n-company').value, org_type: org, source: $('n-source').value,
      saveDir: $('n-savedir').value, ref_urls: $('n-refs').value, text: $('n-text').value,
    }, '登録しています…', 'new-msg').then(function (res) {
      if (!res) return;
      $('new-form').reset();
      $('new-form').hidden = true;
      openCase(res.case.id, 'reg').then(function () {
        msg('case-msg', '登録しました。会社情報の取得を始めています（1〜2分。裏で進むので、そのまま材料を入れて構いません）。', 'ok');
      });
    });
  });

  $('back').addEventListener('click', function () {
    if (state.uploading) { alert('ファイルを送っている途中です。送り終わってから戻ってください。'); return; }
    if (Rec.busy()) { alert('録音中です。「■ 止める」を押してから戻ってください。'); return; }
    if (state.dirty && !confirm('保存していない直しがあります。消えますが、一覧に戻りますか？')) return;
    Rec.release();   // 止めてある録音は端末の中に残る。次にこの案件を開くと戻せる
    stopPoll();
    state.dirty = false;
    state.c = null;
    state.caseId = '';
    $('bar-title').textContent = 'DX要件定義';
    show('list');
    loadCases();
  });

  window.addEventListener('beforeunload', function (e) {
    var unsent = Rec.current() && Rec.current().status === 'stopped';
    if (!state.uploading && !state.dirty && !Rec.busy() && !unsent) return;
    e.preventDefault();
    e.returnValue = '';
  });

  // =========================
  //  案件
  // =========================
  function openCase(id, tab) {
    state.caseId = id;
    state.dirty = false;
    if (tab) state.tab = tab;
    show('case');
    return refreshCase(false);
  }

  /** 案件を読み直す。quiet＝処理の進み具合を見るための読み直し（直している途中の段は描き直さない） */
  function refreshCase(quiet) {
    var id = state.caseId;
    if (!quiet) busy('読み込んでいます…');
    return api('getCase', { caseId: id, withDesk: true }).then(function (res) {
      idle();
      if (id !== state.caseId) return;
      if (!res.ok) { msg('case-msg', errText(res), 'err'); return; }
      setCase(res.case, quiet);
    }).catch(function (e) { idle(); msg('case-msg', errText(e), 'err'); });
  }

  /** 受け取った案件で画面を描き直す。quiet で直している途中なら、見出しと状態だけを描き直す */
  function setCase(c, quiet) {
    var keepDesk = state.c && state.c.desk;
    state.c = c;
    if (!c.desk && keepDesk) c.desk = keepDesk;
    $('bar-title').textContent = c.title;
    renderHead();
    if (!(quiet && state.dirty)) { state.dirty = false; renderTab(); }
    else if (isStepTab()) renderStepStatus();
    schedulePoll();
  }

  function working() {
    var c = state.c;
    if (!c) return false;
    return (c.jobs || []).length > 0 || Object.keys(c.steps).some(function (s) { return c.steps[s].deskPending; });
  }

  function schedulePoll() {
    stopPoll();
    if (!working()) return;
    state.pollTimer = setTimeout(function () {
      state.pollTimer = 0;
      if (document.visibilityState === 'visible' && !state.uploading) refreshCase(true); else schedulePoll();
    }, POLL_MS);
  }
  function stopPoll() { if (state.pollTimer) clearTimeout(state.pollTimer); state.pollTimer = 0; }

  function renderHead() {
    var c = state.c;
    var jobs = (c.jobs || []).map(function (j) {
      return j.type === 'transcribe' ? '文字起こし' : j.type === 'extract' ? 'ファイルの読み取り' : j.type === 'company' ? '会社情報の取得' : STEP_TAB[j.step] + 'を作成';
    });
    put($('case-head'), [
      el('div', { class: 'sub', text: c.company + '｜' + c.source }),
      el('div', { class: 'links' }, [
        safeLink(c.links.folder) ? el('a', { href: c.links.folder, target: '_blank', rel: 'noopener', text: '案件フォルダ' }) : null,
        safeLink(c.links.md) ? el('a', { href: c.links.md, target: '_blank', rel: 'noopener', text: '分析の md' }) : null,
        safeLink(c.links.questionnaire) ? el('a', { href: c.links.questionnaire, target: '_blank', rel: 'noopener', text: '質問票（Word）' }) : null,
        c.surveyForm && safeLink(c.surveyForm.editUrl) ? el('a', { href: c.surveyForm.editUrl, target: '_blank', rel: 'noopener', text: '質問票（フォーム）' }) : null,
        el('button', { class: 'link', text: '読み直す', onclick: function () {
          if (state.dirty && !confirm('保存していない直しがあります。消えますが、読み直しますか？')) return;
          state.dirty = false; refreshCase(false);
        } }),
      ]),
      jobs.length ? el('div', { class: 'warn', text: '処理中：' + jobs.join('・') + '（終わると自動で表示が変わります）' }) : null,
      c.lastError ? el('div', { class: 'errbox', text: c.lastError }) : null,
    ]);
    document.querySelectorAll('.tabs button').forEach(function (b) {
      var t = b.dataset.tab;
      var label = { reg: '会社・要件', s3: '目的・課題', s4: '対策', s5: '分析' }[t];
      var s = c.steps[t];
      if (s) label += s.deskPending ? ' 🕐' : s.review === 'needed' && s.content ? ' ●' : s.ok ? ' ✓' : '';
      if (s && s.stale) label += '！';
      b.textContent = label;
      b.setAttribute('aria-selected', String(t === state.tab));
    });
  }

  function isStepTab() { return ['s3', 's4', 's5'].indexOf(state.tab) >= 0; }

  document.querySelectorAll('.tabs button').forEach(function (b) {
    b.addEventListener('click', function () {
      if (!state.c || b.dataset.tab === state.tab) return;
      if (state.dirty && !confirm('保存していない直しがあります。消えますが、ほかのタブへ移りますか？')) return;
      state.dirty = false;
      state.tab = b.dataset.tab;
      renderHead();
      renderTab();
    });
  });

  function renderTab() {
    $('tab-reg').hidden = state.tab !== 'reg';
    $('tab-step').hidden = !isStepTab();
    // 材料を入れる欄はタブごとに1つだけ置く（同じ id の欄が隠れたタブに残らないように、見ていないタブは空にする）
    if (state.tab !== 'reg') $('tab-reg').replaceChildren();
    if (!isStepTab()) $('tab-step').replaceChildren();
    msg('case-msg', '');
    if (state.tab === 'reg') renderReg();
    else renderStep(state.tab);
  }

  /** 操作のあと、返ってきた案件で描き直す */
  function after(res, note) {
    if (!res) return;
    state.dirty = false;
    setCase(res.case, false);
    if (note) msg('case-msg', note, 'ok');
  }

  // =========================
  //  材料
  // =========================
  var MAT_STATUS = {
    done: ['文字にした', 'st-done'], error: ['エラー', 'st-err'], running: ['処理中', 'st-run'],
    queued: ['待機中', 'st-wait'], uploading: ['アップロード中', 'st-wait'],
  };

  /** 材料の一覧（状態・中身を見る・やり直す・外す） */
  function materialList(list) {
    var c = state.c;
    return el('div', { class: 'list' }, list.map(function (m) {
      var st = MAT_STATUS[m.status] || ['不明', 'st-wait'];
      var ir = m.importResult;
      return el('div', { class: 'mat' }, [
        el('div', { class: 'head' }, [
          el('span', { class: 'badge ' + st[1], text: st[0] }),
          el('span', { class: 'badge st-wait', text: kindLabel(m) }),
          m.company ? el('span', { class: 'badge st-run', text: '同じ会社のほかの案件で入れたもの' }) : null,
          matPlace(m) ? el('span', { class: 'badge st-wait', text: matPlace(m) }) : null,
          el('span', { class: 'name', text: m.name }),
        ]),
        el('div', { class: 'sub', text: [m.date, m.chars ? m.chars.toLocaleString() + '字' : '', m.durationSec ? Math.round(m.durationSec / 60) + '分の録音' : '', m.progress].filter(String).join('｜') }),
        m.error ? el('div', { class: 'errbox', text: m.error }) : null,
        ir ? el('div', { class: 'warn', text: '質問票として取り込み：' + ir.filled.length + '問に回答を入れた' +
          (ir.same ? '／同じ回答 ' + ir.same + '問' : '') + (ir.blank ? '／空欄 ' + ir.blank + '問' : '') +
          (ir.conflicts.length ? '／回答が入っているため上書きしなかった 問' + ir.conflicts.join('・') : '') +
          (ir.unmatched.length ? '／問いの文が合わず入れなかった 質問票のNo.' + ir.unmatched.join('・') : '') }) : null,
        el('div', { class: 'acts' }, [
          m.status === 'done' ? el('button', { class: 'small', text: '中身を見る・直す', onclick: function () { openMaterial(m); } }) : null,
          m.status === 'error' && m.srcFileId ? el('button', { class: 'small', text: 'やり直す', onclick: function () {
            call('retryMaterial', { caseId: c.id, materialId: m.id }, 'やり直しています…', 'case-msg').then(function (r) { after(r, '待機中にしました'); });
          } }) : null,
          ir && ir.conflicts.length ? el('button', { class: 'small', text: '回答が入っている欄も上書きする', onclick: function () {
            if (!confirm('回答が入っている欄も、この質問票の回答で上書きしますか？')) return;
            call('reimportSurvey', { caseId: c.id, materialId: m.id, overwrite: true }, '受け付けています…', 'case-msg').then(function (r) { after(r, '取り込み直しを受け付けました'); });
          } }) : null,
          m.company ? null : el('button', { class: 'small', text: '外す', onclick: function () {
            if (!confirm('「' + m.name + '」を材料から外しますか？（ファイルはゴミ箱へ移します）')) return;
            call('removeMaterial', { caseId: c.id, materialId: m.id }, '外しています…', 'case-msg').then(function (r) { after(r, '外しました'); });
          } }),
        ]),
      ]);
    }));
  }

  /** 材料を入れるタブの名前（材料の一覧に「どこで入れたか」を出す） */
  function matPlace(m) { return m.step === 's3' ? '目的・課題で入れた' : m.step === 's4' ? '対策で入れた' : ''; }

  /**
   * 材料を入れる画面。種類（要件の文章・録音・アンケートの結果）を選び、入れ方が2つ以上ある種類は入れ方も選ぶ。
   * 選んだものに要る欄だけを出す（2026-11-05 久夫さん指示）。
   */
  var HOWS = {
    text: [['type', '文を打つ・貼る'], ['file', 'ファイルを選ぶ']],
    audio: [['rec', 'このアプリで録音する'], ['file', '録音のファイルを選ぶ']],
    survey: [['file', 'ファイル'], ['drive', 'Google フォーム'], ['type', '文を貼る']],
  };
  var KIND_TEXT = {
    text: { name: '例：相談の原文／打ち合わせのメモ', date: '日付（受け取った日）' },
    audio: { name: '例：ヒアリング①', date: '日付（打ち合わせの日）' },
    survey: { name: '例：事前アンケート', date: '日付（回答の日）' },
  };

  /**
   * 方針0〜2・方針3〜5のタブで入れられる種類と、その呼び方（2026-11-05 久夫さん指示）。
   * この段で要件の文書や事前アンケートを入れることはないので、打ち合わせの録音・メモと、
   * 方針0〜2で書き出した追加の質問票の回答だけにする。データの種類（text・audio・survey）は会社・要件のタブと同じ。
   */
  var STEP_KINDS = { s3: ['audio', 'text', 'survey'], s4: ['audio', 'text'] };
  var STEP_KIND_LABEL = { text: '打ち合わせのメモ', audio: '打ち合わせの録音', survey: '追加の質問票の回答' };
  var STEP_HOWS = { text: [['type', '文を打つ・貼る'], ['file', 'ファイルを選ぶ']], audio: HOWS.audio, survey: [['file', 'ファイル'], ['type', '文を貼る']] };
  var STEP_KIND_TEXT = {
    text: { name: '例：2回目の打ち合わせのメモ', date: '日付（打ち合わせの日）' },
    audio: { name: '例：ヒアリング②', date: '日付（打ち合わせの日）' },
    survey: { name: '例：追加の質問票の回答', date: '日付（回答の日）' },
  };

  /** 材料の種類の呼び方（方針のタブで入れたものは、そのタブでの呼び方） */
  function kindLabel(m) { return (STEP_KINDS[m.step] && STEP_KIND_LABEL[m.kind]) || KIND_LABEL[m.kind] || m.kind; }

  /** 材料を入れるタブの名前 */
  function placeName(step) { return step === 's3' ? '目的・課題' : step === 's4' ? '対策' : '会社・要件'; }

  // =========================
  //  このアプリで録音する（2026-11-05 久夫さん指示。会社・要件／方針0〜2／方針3〜5のどのタブでも同じ仕組み）
  // =========================
  /**
   * 録音は、画面の描き直し（処理の進み具合の読み直し・タブの切り替え）で止まらないよう、入力欄の外で持つ。
   * 録った分は10秒ごとに端末の中（IndexedDB）にも書く。送る前に画面が閉じても、次にそのタブを開くと「送っていない録音」として戻せる。
   * 録音は、録音を始めたタブ（案件と段）の材料になる。同時に録れるのは1本だけ。
   */
  var Rec = (function () {
    var MAX_SEC = 3 * 3600 - 60;   // 受け付ける長さの上限（3時間）の少し前で止める
    var SLICE_MS = 10000;
    var TYPES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4;codecs=mp4a.40.2', 'audio/mp4', 'audio/ogg;codecs=opus'];
    var r = null;        // 今の録音 { id, caseId, step, mime, status: recording|paused|stopping|stopped, accMs, since, chunks, started, sec, file, form, note }
    var subs = [];       // { node, fn }：画面の欄。node が画面から外れたら呼ばない
    var timer = 0;

    function emit(what) {
      subs = subs.filter(function (s) { return s.node.isConnected; });
      subs.slice().forEach(function (s) { s.fn(what); });
    }
    function on(node, fn) { subs.push({ node: node, fn: fn }); }

    // ---- 端末の中の保存（IndexedDB）。使えない端末では保存なしで録音だけする ----
    var dbp = null;
    function db() {
      if (!dbp) dbp = new Promise(function (res, rej) {
        var q = indexedDB.open('dxy-rec', 1);
        q.onupgradeneeded = function () {
          var d = q.result;
          d.createObjectStore('recs', { keyPath: 'id' });
          d.createObjectStore('chunks', { autoIncrement: true }).createIndex('rec', 'recId');
        };
        q.onsuccess = function () { res(q.result); };
        q.onerror = function () { rej(q.error); };
      });
      return dbp;
    }
    function tx(stores, mode, fn) {
      try {
        return db().then(function (d) {
          return new Promise(function (res, rej) {
            var t = d.transaction(stores, mode);
            var req = fn(t);
            t.oncomplete = function () { res(req && 'result' in req ? req.result : undefined); };
            t.onerror = t.onabort = function () { rej(t.error); };
          });
        });
      } catch (e) { return Promise.reject(e); }
    }
    function quiet(p) { return p.catch(function () { return null; }); }
    function saveMeta(x) {
      return quiet(tx(['recs'], 'readwrite', function (t) {
        return t.objectStore('recs').put({ id: x.id, caseId: x.caseId, step: x.step, mime: x.mime, started: x.started,
                                           sec: secOf(x), done: x.status === 'stopped', form: x.form || {} });
      }));
    }
    function saveChunk(x, blob) { return quiet(tx(['chunks'], 'readwrite', function (t) { return t.objectStore('chunks').add({ recId: x.id, blob: blob }); })); }
    function removeSaved(id) {
      return quiet(tx(['recs', 'chunks'], 'readwrite', function (t) {
        t.objectStore('recs').delete(id);
        t.objectStore('chunks').index('rec').openCursor(IDBKeyRange.only(id)).onsuccess = function (e) {
          var cur = e.target.result;
          if (cur) { cur.delete(); cur.continue(); }
        };
      }));
    }

    function secOf(x) { return Math.round((x.accMs + (x.status === 'recording' ? Date.now() - x.since : 0)) / 1000); }
    function two(n) { return (n < 10 ? '0' : '') + n; }
    function clock(sec) { return Math.floor(sec / 3600) + ':' + two(Math.floor(sec / 60) % 60) + ':' + two(sec % 60); }
    function makeFile(blob, mime, started) {
      var d = new Date(started);
      var ext = /mp4/.test(mime) ? 'm4a' : /ogg/.test(mime) ? 'ogg' : 'webm';
      var name = '録音_' + d.getFullYear() + two(d.getMonth() + 1) + two(d.getDate()) + '_' + two(d.getHours()) + two(d.getMinutes()) + '.' + ext;
      return new File([blob], name, { type: String(mime).split(';')[0] });
    }

    function start(caseId, step, form) {
      if (r) return Promise.reject(new Error(r.status === 'stopped' ? '送っていない録音があります。送るか消してから録音してください。' : 'ほかで録音中です。'));
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || !window.MediaRecorder) {
        return Promise.reject(new Error('この端末・ブラウザでは録音できません。録音アプリで録ったファイルを「録音のファイルを選ぶ」から入れてください。'));
      }
      var mime = TYPES.filter(function (t) { try { return MediaRecorder.isTypeSupported(t); } catch (e) { return false; } })[0] || '';
      return navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } }).then(function (stream) {
        var opt = { audioBitsPerSecond: 32000 };   // 3時間で約45MB（受け付ける上限 300MB に収まる）
        if (mime) opt.mimeType = mime;
        var mr = new MediaRecorder(stream, opt);
        var x = r = { id: 'R' + Date.now(), caseId: caseId, step: step || '', mime: mr.mimeType || mime || 'audio/webm', status: 'recording',
                      accMs: 0, since: Date.now(), chunks: [], started: Date.now(), form: form || {}, note: '', mr: mr, stream: stream };
        mr.ondataavailable = function (e) {
          if (!e.data || !e.data.size) return;
          x.chunks.push(e.data);
          saveChunk(x, e.data);
          saveMeta(x);
        };
        mr.onstop = function () { finish(x); };
        mr.onerror = function () { x.note = '録音が途中で止まりました。ここまでの分は残っています。'; stop(); };
        stream.getAudioTracks().forEach(function (t) {
          t.onended = function () { if (x.status === 'recording' || x.status === 'paused') { x.note = 'マイクが使えなくなったので、そこで止めました。ここまでの分は残っています。'; stop(); } };
        });
        mr.start(SLICE_MS);
        saveMeta(x);
        keepAwake(true);
        timer = setInterval(function () {
          if (x.status === 'recording' && secOf(x) >= MAX_SEC) { x.note = '3時間になったので止めました。続きは新しい録音で録ってください。'; stop(); }
          emit('tick');
        }, 1000);
        emit('state');
      });
    }
    function pause() {
      if (!r || r.status !== 'recording') return;
      r.mr.pause(); r.accMs += Date.now() - r.since; r.status = 'paused'; saveMeta(r); emit('state');
    }
    function resume() {
      if (!r || r.status !== 'paused') return;
      r.mr.resume(); r.since = Date.now(); r.status = 'recording'; saveMeta(r); emit('state');
    }
    function stop() {
      if (!r || (r.status !== 'recording' && r.status !== 'paused')) return;
      if (r.status === 'recording') r.accMs += Date.now() - r.since;
      r.status = 'stopping';
      emit('state');
      try { r.mr.stop(); } catch (e) { finish(r); }
    }
    function finish(x) {
      if (x.status === 'stopped') return;
      clearInterval(timer);
      try { x.stream.getTracks().forEach(function (t) { t.stop(); }); } catch (e) { /* 止まっていればそのまま */ }
      x.status = 'stopped';
      x.sec = secOf(x);
      x.file = makeFile(new Blob(x.chunks, { type: x.mime }), x.mime, x.started);
      x.chunks = [];
      x.mr = x.stream = null;
      saveMeta(x);
      keepAwake(false);
      emit('state');
    }
    /** 録音を消す（端末の中の保存も消す） */
    function discard() {
      if (!r) return Promise.resolve();
      var x = r;
      r = null;
      clearInterval(timer);
      try { if (x.mr && x.mr.state !== 'inactive') { x.mr.onstop = null; x.mr.stop(); } } catch (e) { /* 何もしない */ }
      try { if (x.stream) x.stream.getTracks().forEach(function (t) { t.stop(); }); } catch (e) { /* 何もしない */ }
      keepAwake(false);
      return removeSaved(x.id).then(function () { emit('state'); });
    }
    /** 送り終えた */
    function sent(id) { if (r && r.id === id) r = null; return removeSaved(id); }
    /** 案件から離れるとき。止めてある録音は端末の中に残し、次に開いたときに戻せる */
    function release() { if (r && r.status === 'stopped') r = null; }
    /** その案件・タブの、送っていない録音（端末の中の保存） */
    function pending(caseId, step) {
      return quiet(tx(['recs'], 'readonly', function (t) { return t.objectStore('recs').getAll(); })).then(function (list) {
        return (list || []).filter(function (m) { return m.caseId === caseId && m.step === (step || '') && !(r && r.id === m.id); })
          .sort(function (a, b) { return a.started - b.started; });
      });
    }
    /** 端末の中の保存から戻す */
    function restore(meta) {
      if (r) return Promise.reject(new Error('録音中か、ほかに送っていない録音があります。'));
      return tx(['chunks'], 'readonly', function (t) { return t.objectStore('chunks').index('rec').getAll(IDBKeyRange.only(meta.id)); }).then(function (rows) {
        if (!rows || !rows.length) throw new Error('この録音の中身が端末に残っていません。');
        // 途中で閉じた録音は、最後に書いた長さより最大10秒長い（文字起こしで終わりが切れないよう、長めに見ておく）
        var sec = (meta.sec || 0) + (meta.done ? 0 : SLICE_MS / 1000);
        r = { id: meta.id, caseId: meta.caseId, step: meta.step, mime: meta.mime, status: 'stopped', accMs: sec * 1000, since: 0, chunks: [],
              started: meta.started, sec: sec, form: meta.form || {}, note: meta.done ? '' : '途中で画面が閉じた録音です。最後の数秒は入っていないことがあります。',
              file: makeFile(new Blob(rows.map(function (x) { return x.blob; }), { type: meta.mime }), meta.mime, meta.started) };
        if (!meta.done) saveMeta(r);
        emit('state');
      });
    }
    function setForm(form) { if (r) { r.form = form; if (r.status !== 'stopping') saveMeta(r); } }

    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible' && r && (r.status === 'recording' || r.status === 'paused')) keepAwake(true);
    });

    return {
      on: on, start: start, pause: pause, resume: resume, stop: stop, discard: discard, sent: sent, release: release,
      pending: pending, restore: restore, setForm: setForm, clock: clock, secOf: secOf,
      current: function () { return r; },
      busy: function () { return !!r && r.status !== 'stopped'; },
      here: function (caseId, step) { return !!r && r.caseId === caseId && r.step === (step || ''); },
    };
  })();

  /** opts: { step: 入れたタブ（s3・s4。会社・要件のタブなら空）, kind: 最初に選んでおく種類, title: 見出し } */
  function addMaterialForm(opts) {
    opts = opts || {};
    var inStep = !!STEP_KINDS[opts.step];
    var hows_ = inStep ? STEP_HOWS : HOWS, texts = inStep ? STEP_KIND_TEXT : KIND_TEXT;
    var kind = opts.kind || 'text', how = hows_[kind][0][0];
    var caseId = state.c.id, place = opts.step || '';
    if (Rec.here(caseId, place)) { kind = 'audio'; how = 'rec'; }   // このタブで録音中・送っていない録音があるときは録音の欄を出す
    var file = null, durationSec = 0;
    var kinds = el('div', { class: 'kinds' }, (inStep ? STEP_KINDS[opts.step] : ['text', 'audio', 'survey']).map(function (k) {
      return el('label', {}, [el('input', { type: 'radio', name: 'm-kind', value: k, checked: k === kind, onchange: function () {
        kind = k; how = hows_[k][0][0]; clearFile(); refresh();
      } }), inStep ? STEP_KIND_LABEL[k] : KIND_LABEL[k]]);
    }));
    var hows = el('div', { class: 'kinds' });
    var howBox = el('div', {}, [el('div', { class: 'field', text: '入れ方' }), hows]);
    var name = el('input', { maxlength: '100' });
    var nameLabel = el('label', { class: 'field' }, ['名前', name]);
    var date = el('input', { type: 'date', value: ymd(new Date()) });
    var dateText = el('span', {});
    var dateLabel = el('label', { class: 'field' }, [dateText, date]);
    var textArea = el('textarea', { id: 'm-text', rows: '6', placeholder: '打つ・声で入れる・貼り付ける' });
    var fileInput = el('input', { type: 'file', hidden: true });
    var fileInfo = el('div', { class: 'sub' });
    var attendees = el('input', { maxlength: '300', placeholder: '例：山田社長、佐藤課長、鴨崎' });
    var glossary = el('input', { maxlength: '1000', placeholder: '例：サロンワーク、ブルーカーボン' });
    var driveUrl = el('input', { type: 'url', placeholder: 'https://docs.google.com/spreadsheets/d/…' });
    var meter = el('div', {});
    var progress = el('div', { class: 'progress', hidden: true }, [el('div', { class: 'meter' }, [meter]), el('p', { class: 'sub' })]);
    var audioBox = el('div', {}, [
      el('label', { class: 'field' }, ['参加者（任意。話した人の名前を当てやすくなる）', attendees]),
      el('label', { class: 'field' }, ['用語（任意。固有名詞・専門用語の書き方）', glossary]),
    ]);
    var textLabel = el('span', {});
    var textBox = el('div', {}, [
      el('label', { class: 'field' }, [textLabel, textArea]),
      el('div', { class: 'row' }, [
        el('button', { type: 'button', class: 'small proof', 'data-target': 'm-text', text: '誤変換を確かめる' }),
      ]),
      el('button', { type: 'button', class: 'primary wide', text: 'この文を入れる', onclick: addText }),
    ]);
    var driveBox = el('div', {}, [
      el('label', { class: 'field' }, ['Google フォームの URL（フォームそのもの、または回答のスプレッドシート）', driveUrl]),
      el('p', { class: 'sub', text: 'すべての回答を文にして入れ、いちばん新しい回答は問いの文が同じ回答欄にも入れます。フォームは kamozaki0413@kamobase.com が編集者のものにしてください。' }),
      el('button', { type: 'button', class: 'primary wide', text: 'このファイルを入れる', onclick: addDrive }),
    ]);
    var pick = el('button', { type: 'button', class: 'wide', text: 'ファイルを選ぶ', onclick: function () { if (!state.uploading) { fileInput.value = ''; fileInput.click(); } } });
    var send = el('button', { type: 'button', class: 'primary wide', text: 'ファイルを送る', disabled: true, onclick: function () { sendFile(file, durationSec, ''); } });
    var fileNote = el('p', { class: 'sub' });
    var fileBox = el('div', {}, [fileNote, pick, fileInput, fileInfo, send]);
    var recBox = el('div', { class: 'rec' });
    var out = el('p', { class: 'msg' });

    function clearFile() { file = null; durationSec = 0; fileInput.value = ''; fileInfo.textContent = ''; }

    // ---- このアプリで録音する欄 ----
    var recClock = null, recUrl = '';
    function formValues() { return { name: name.value, date: date.value, attendees: attendees.value, glossary: glossary.value }; }
    var cur0 = Rec.current();
    if (Rec.here(caseId, place) && cur0.form) {
      name.value = cur0.form.name || ''; attendees.value = cur0.form.attendees || ''; glossary.value = cur0.form.glossary || '';
      if (cur0.form.date) date.value = cur0.form.date;
    }
    [name, date, attendees, glossary].forEach(function (i) { i.addEventListener('input', function () { if (Rec.here(caseId, place)) Rec.setForm(formValues()); }); });

    function recFail(e) { out.textContent = (e && e.name === 'NotAllowedError') ? 'マイクを使う許可がありません。ブラウザの設定で、このサイトのマイクを「許可」にしてください。' : errText(e); out.className = 'msg err'; }

    function renderRec() {
      var r = Rec.current();
      recClock = null;
      if (recUrl) { URL.revokeObjectURL(recUrl); recUrl = ''; }
      if (r && !Rec.here(caseId, place)) {
        var where = r.caseId === caseId ? '「' + placeName(r.step) + '」のタブ' : 'ほかの案件';
        recBox.replaceChildren(el('div', { class: 'warn', text: Rec.busy()
          ? where + 'で録音中です。録音は同時に1本だけです。'
          : where + 'に、送っていない録音があります。そちらで送るか消してから録音してください。' }));
        return;
      }
      if (!r) {
        var list = el('div', {});
        Rec.pending(caseId, place).then(function (ps) {
          list.replaceChildren.apply(list, ps.map(function (p) {
            var d = new Date(p.started);
            return el('div', { class: 'warn' }, [
              el('div', { text: '送っていない録音があります：' + (d.getMonth() + 1) + '/' + d.getDate() + ' ' + d.getHours() + ':' + ('0' + d.getMinutes()).slice(-2) + ' から・約' + Math.max(1, Math.round((p.sec || 0) / 60)) + '分' + (p.done ? '' : '（途中で画面が閉じた録音）') }),
              el('div', { class: 'row' }, [
                el('button', { type: 'button', class: 'small', text: 'この録音を戻す', onclick: function () { Rec.restore(p).catch(recFail); } }),
                el('button', { type: 'button', class: 'small', text: '消す', onclick: function () {
                  if (!confirm('この録音を消しますか？（元に戻せません）')) return;
                  Rec.sent(p.id).then(renderRec);
                } }),
              ]),
            ]);
          }));
        });
        recBox.replaceChildren(
          list,
          el('p', { class: 'sub', text: '打ち合わせの音声を、このアプリでそのまま録ります（3時間まで）。録った分は端末の中にも少しずつ残すので、途中で画面が閉じても、次に開いたときに戻せます。' }),
          el('p', { class: 'sub', text: '録音中はこの画面を開いたままにしてください。画面が消えないようにします。ほかのアプリに切り替えたり画面を閉じたりすると、スマホでは録音が止まることがあります。' }),
          el('button', { type: 'button', class: 'primary wide rec-start', text: '● 録音を始める', onclick: function () {
            out.textContent = '';
            Rec.start(caseId, place, formValues()).catch(recFail);
          } })
        );
        return;
      }
      if (r.status === 'recording' || r.status === 'paused' || r.status === 'stopping') {
        recClock = el('div', { class: 'rec-clock' + (r.status === 'recording' ? ' on' : ''), text: '' });
        tickRec();
        recBox.replaceChildren(
          recClock,
          el('div', { class: 'row' }, [
            r.status === 'recording' ? el('button', { type: 'button', text: '一時停止', onclick: Rec.pause }) : null,
            r.status === 'paused' ? el('button', { type: 'button', text: '再開する', onclick: Rec.resume }) : null,
            el('button', { type: 'button', class: 'primary', text: '■ 止める', disabled: r.status === 'stopping', onclick: Rec.stop }),
          ]),
          el('p', { class: 'sub', text: '録音中も、ほかのタブを見たり文字を打ったりできます。この画面は開いたままにしてください。' })
        );
        return;
      }
      // 止めた録音：聞き直して送る
      var url = recUrl = URL.createObjectURL(r.file);
      recBox.replaceChildren(
        r.note ? el('div', { class: 'warn', text: r.note }) : null,
        el('div', { class: 'sub', text: '🎧 ' + r.file.name + '（' + mb(r.file.size) + '・' + Rec.clock(r.sec) + '）' }),
        el('audio', { controls: true, src: url, preload: 'metadata', class: 'rec-play' }),
        el('button', { type: 'button', class: 'primary wide', text: 'この録音を送る', disabled: state.uploading, onclick: function () {
          var id = r.id;
          sendFile(r.file, r.sec, id);
        } }),
        el('button', { type: 'button', class: 'wide', text: '録音を消す', disabled: state.uploading, onclick: function () {
          if (!confirm('この録音を消しますか？（送っていないので、元に戻せません）')) return;
          Rec.discard();
        } })
      );
    }
    function tickRec() {
      var r = Rec.current();
      if (!recClock || !r) return;
      var sec = Rec.secOf(r);
      recClock.textContent = (r.status === 'recording' ? '● 録音中　' : r.status === 'paused' ? '⏸ 一時停止中　' : '止めています…　') + Rec.clock(sec);
    }

    function refresh() {
      // 入れ方の選択（2つ以上あるときだけ出す）
      hows.replaceChildren.apply(hows, hows_[kind].map(function (h) {
        return el('label', {}, [el('input', { type: 'radio', name: 'm-how', value: h[0], checked: h[0] === how, onchange: function () { how = h[0]; clearFile(); refresh(); } }), h[1]]);
      }));
      howBox.hidden = hows_[kind].length < 2;
      name.placeholder = texts[kind].name;
      dateText.textContent = texts[kind].date;
      audioBox.hidden = kind !== 'audio';
      textBox.hidden = how !== 'type';
      driveBox.hidden = how !== 'drive';
      fileBox.hidden = how !== 'file';
      recBox.hidden = how !== 'rec';
      if (how === 'rec') renderRec();
      textLabel.textContent = inStep
        ? (kind === 'survey' ? '質問票の回答（メールなどで届いた文を貼る）' : '打ち合わせのメモ（打つ・声で入れる・貼る）')
        : (kind === 'survey' ? 'アンケートの回答（メールなどの文を貼る）' : '要件の文章（打つ・声で入れる・貼る）');
      fileInput.accept = kind === 'audio' ? 'audio/*,.m4a,.mp3,.wav,.aac,.ogg,.webm,.flac'
        : kind === 'survey' ? '.docx,.doc,.xlsx,.xls,.pdf,.csv,image/*'
        : '.docx,.doc,.xlsx,.xls,.pptx,.ppt,.pdf,.txt,.md,.csv,.tsv,.html,.htm';
      pick.textContent = kind === 'audio' ? '録音のファイルを選ぶ' : 'ファイルを選ぶ';
      fileNote.textContent = kind === 'audio' ? 'スマホの録音アプリで録ったファイル（m4a・mp3 など）を選びます。iPhone のボイスメモは、先に「"ファイル"に保存」してから選びます。'
        : kind === 'survey' && inStep ? '書き出した追加の質問票に、お客様が書き込んだ Word を選びます。回答はヒアリング項目の回答欄に入ります（回答が入っている欄は上書きしません）。'
        : kind === 'survey' ? 'Word・Excel・PDF・csv・紙のアンケートの写真。書き出した質問票に書き込んでもらった Word なら、回答欄に自動で入ります。'
        : inStep ? '打ち合わせのメモのファイル（Word・PDF・txt など）。中の文字を取り出して入れます。'
        : 'Word・Excel・PowerPoint・PDF・txt・md・csv・html。中の文字を取り出して入れます。';
      send.disabled = state.uploading || !file;
    }

    fileInput.addEventListener('change', function () {
      file = fileInput.files && fileInput.files[0];
      durationSec = 0;
      if (!file) return refresh();
      if (!name.value.trim()) name.value = file.name.replace(/\.[^.]+$/, '').slice(0, 100);
      fileInfo.textContent = (kind === 'audio' ? '🎧 ' : '📄 ') + file.name + '（' + mb(file.size) + '）';
      if (kind === 'audio') audioDuration(file).then(function (s) {
        durationSec = Math.round(s);
        if (s) fileInfo.textContent = '🎧 ' + file.name + '（' + mb(file.size) + '・' + Math.round(s / 60) + '分）';
      });
      refresh();
    });

    function addText() {
      if (!textArea.value.trim()) { msg('', ''); out.textContent = '文を入れてください'; out.className = 'msg err'; return; }
      call('addText', { caseId: state.c.id, kind: kind, name: name.value, date: date.value, text: textArea.value, step: opts.step || '' }, '入れています…', 'case-msg')
        .then(function (r) { after(r, '材料に入れました'); });
    }
    function addDrive() {
      call('addDriveFile', { caseId: state.c.id, kind: 'survey', name: name.value, date: date.value, url: driveUrl.value, step: opts.step || '' }, '受け付けています…', 'case-msg')
        .then(function (r) { after(r, '受け付けました。文字にし終わると「文字にした」になります'); });
    }
    /** ファイルを送る。recId＝このアプリで録った録音（送り終えたら端末の中の保存を消す） */
    async function sendFile(file, durationSec, recId) {
      if (!file || state.uploading) return;
      state.uploading = true;
      refresh();
      keepAwake(true);
      progress.hidden = false;
      out.textContent = '送り終わるまで、この画面を開いたままにしてください。';
      out.className = 'msg';
      try {
        var startRes = await api('uploadStart', {
          caseId: caseId, kind: kind, name: name.value, date: date.value, fileName: file.name, mimeType: file.type || '',
          size: file.size, durationSec: durationSec, attendees: attendees.value, glossary: glossary.value, step: place,
        });
        if (!startRes.ok) throw new Error(errText(startRes));
        var offset = 0;
        for (;;) {
          var r = await sendChunk(startRes.uploadId, file, offset, startRes.chunkSize);
          if (r.done) break;
          offset = r.next;
          meter.style.width = Math.round(100 * offset / file.size) + '%';
          progress.lastChild.textContent = '送っています ' + Math.floor(100 * offset / file.size) + '%（' + mb(offset) + ' / ' + mb(file.size) + '）';
        }
        meter.style.width = '100%';
        if (recId) await Rec.sent(recId);
        state.uploading = false;
        keepAwake(false);
        refreshCase(false).then(function () {
          msg('case-msg', (kind === 'audio' ? '受け付けました。文字起こしは裏で進みます（アプリを閉じても続きます）。終わると「文字にした」になります。' : '受け付けました。文字にし終わると「文字にした」になります。') +
            (opts.step && state.c.steps[opts.step].content ? '文字にし終わると、反映した案を作ります。案ができたら、比べてから「反映する」を押してください。' : ''), 'ok');
        });
      } catch (e) {
        progress.hidden = true;
        out.textContent = '送れませんでした。もう一度「' + (recId ? 'この録音を送る' : 'ファイルを送る') + '」を押してください。' + (recId ? '録音は端末の中に残っています。' : '') + '\n' + errText(e);
        out.className = 'msg err';
      } finally {
        state.uploading = false;
        keepAwake(false);
        refresh();
      }
    }

    var form = el('div', { class: 'panel' }, [
      el('h3', { text: opts.title || '材料を入れる' }), kinds, howBox, nameLabel, dateLabel,
      audioBox, textBox, driveBox, fileBox, recBox, progress, out,
    ]);
    // 録音の状態が変わったら録音の欄を描き直す（1秒ごとは時計だけ）
    Rec.on(form, function (what) {
      if (how !== 'rec') return;
      if (what === 'tick') tickRec(); else renderRec();
    });
    refresh();
    return form;
  }

  function openMaterial(m) {
    call('getMaterial', { caseId: state.c.id, materialId: m.id }, '読み込んでいます…', 'case-msg').then(function (res) {
      if (!res) return;
      openDialog(m.name + '（' + kindLabel(m) + '）', '直すと、以降に作る・直す段でこの中身を使います。', res.text, function (text) {
        return call('saveMaterial', { caseId: state.c.id, materialId: m.id, text: text }, '保存しています…', 'case-msg').then(function (r) { after(r, '材料を保存しました'); return !!r; });
      });
    });
  }

  /** 録音の長さを読む。読めない形式なら 0（そのときは GAS 側で数える） */
  function audioDuration(file) {
    return new Promise(function (resolve) {
      var url = URL.createObjectURL(file);
      var a = document.createElement('audio');
      var settled = false;
      function done(v) { if (settled) return; settled = true; URL.revokeObjectURL(url); resolve(v); }
      a.preload = 'metadata';
      a.onloadedmetadata = function () { done(isFinite(a.duration) && a.duration > 0 ? a.duration : 0); };
      a.onerror = function () { done(0); };
      setTimeout(function () { done(0); }, 8000);
      a.src = url;
    });
  }

  var wakeLock = null;
  function keepAwake(on) {
    try {
      if (on && navigator.wakeLock) navigator.wakeLock.request('screen').then(function (l) { wakeLock = l; }).catch(function () {});
      if (!on && wakeLock && !Rec.busy()) { wakeLock.release(); wakeLock = null; }   // 録音中は画面を消さないままにする
    } catch (e) { /* 対応していない端末はそのまま */ }
  }

  /** 1つ分を送る。通信が切れたら、どこまで受け取ったかを聞いて続ける（議事録デスクと同じ） */
  async function sendChunk(uploadId, file, offset, chunkSize) {
    var lastErr = null;
    for (var i = 0; i < CHUNK_TRIES; i++) {
      try {
        if (i > 0) {
          await sleep(2000 * i);
          var st = await api('uploadStatus', { uploadId: uploadId });
          if (!st.ok) throw new Error(errText(st));
          if (st.done || st.next !== offset) return st;
        }
        var data = await blobToBase64(file.slice(offset, Math.min(offset + chunkSize, file.size)));
        var res = await api('uploadChunk', { uploadId: uploadId, offset: offset, data: data });
        if (!res.ok) {
          if (res.code === 'E004' || res.code === 'BAD_REQUEST') throw Object.assign(new Error(errText(res)), { fatal: true });
          throw new Error(errText(res));
        }
        return res;
      } catch (e) {
        if (e.fatal || /ログインが必要/.test(e.message)) throw e;
        lastErr = e;
      }
    }
    throw lastErr;
  }

  // =========================
  //  登録
  // =========================
  function renderReg() {
    var c = state.c;
    var org = c.org_type === 'municipality' ? 'municipality' : 'company';
    var word = org === 'municipality' ? '自治体他' : '会社';
    var company = el('input', { value: c.company, maxlength: '100' });
    var source = el('input', { value: c.source, maxlength: '200' });
    var memo = el('textarea', { rows: '4', value: c.memo || '' });
    var refs = el('textarea', { rows: '2', value: (c.ref_urls || []).join('\n') });
    var summary = el('textarea', { rows: '6', value: c.original_summary || '' });
    var orgs = el('div', { class: 'radios' }, ['相談先',
      el('label', {}, [el('input', { type: 'radio', name: 'r-org', value: 'company', checked: org === 'company' }), ' 会社']),
      el('label', {}, [el('input', { type: 'radio', name: 'r-org', value: 'municipality', checked: org === 'municipality' }), ' 自治体他'])]);
    [company, source, memo, refs, summary].forEach(function (x) { x.addEventListener('input', function () { state.dirty = true; }); });
    var allMats = (c.materials || []).concat(c.companySurveys || []);
    put($('tab-reg'), [
      el('div', { class: 'panel' }, [
        el('div', { class: 'sub', text: '案件名：' + c.title + '／フォルダ：案件／' + (c.subdir ? c.subdir + '／' : '') + c.title + '（会社名を直しても、フォルダは動きません）' }),
        orgs,
        el('label', { class: 'field' }, [word + '名（情報を調べるためだけに使う。分析のファイルには書かない）', company]),
        el('label', { class: 'field' }, ['相談の出どころ', source]),
        el('label', { class: 'field' }, ['議論のメモ（任意）', memo]),
        el('label', { class: 'field' }, ['参照URL（1行に1つ。入れると、情報の取得はこのページだけを読む）', refs]),
        el('label', { class: 'field' }, ['材料の要点（AIで整理。直してもよい）', summary]),
        el('div', { class: 'row' }, [
          el('button', { class: 'primary', text: '登録内容を保存', onclick: function () {
            call('updateRegistration', {
              caseId: c.id, company: company.value, source: source.value, memo: memo.value, ref_urls: refs.value, original_summary: summary.value,
              org_type: document.querySelector('input[name="r-org"]:checked').value,
            }, '保存しています…', 'case-msg').then(function (r) { if (r) after(r, (r.notes || []).join('\n') || '保存しました'); });
          } }),
          el('button', { text: '材料から要点を整理', onclick: function () {
            call('summarize', { caseId: c.id }, '整理しています…', 'case-msg').then(function (r) { after(r, '要点を整理しました'); });
          } }),
        ]),
      ]),
      el('h3', { text: '要件（材料）' }),
      el('p', { class: 'sub', text: '目的・課題と対策を作るときに使う入力です。要件の文章・録音・アンケートの結果を、何本でも入れられます。打ち合わせの録音は、目的・課題・対策のタブからも入れられます。アンケートの結果は会社のフォルダ（案件／会社名／アンケート）に置き、同じ会社のどの案件からも使えます。' }),
      allMats.length ? materialList(allMats) : el('p', { class: 'sub', text: 'まだ材料はありません。' }),
      addMaterialForm({ kind: 'text' }),
      el('h3', { text: word + '情報' }),
      c.company_info_stale ? el('div', { class: 'warn', text: '名前か種類を直した後、情報を取得し直していません。' }) : null,
      c.companyError ? el('div', { class: 'errbox', text: c.companyError }) : null,
      el('div', { class: 'row' }, [
        el('button', { text: c.company_info ? '取得し直す' : word + '情報を取得', onclick: function () {
          call('companyInfo', { caseId: c.id }, '受け付けています…', 'case-msg').then(function (r) { after(r, '受け付けました。1〜2分で取れます（裏で進みます）'); });
        } }),
        el('span', { class: 'sub', text: c.company_info_updated ? '取得 ' + hm(c.company_info_updated) : 'Google 検索で公開情報を集めます' }),
      ]),
      c.company_info ? el('div', { class: 'readonly', text: c.company_info }) : null,
    ]);
  }

  // =========================
  //  段（方針0〜2・方針3〜5・分析）
  // =========================
  function stepStatusText(s) {
    if (!s.content) return 'まだ作っていません';
    var by = s.by === 'desk' ? 'デスク（Claude）' : s.by === 'gemini' ? 'Gemini（' + (s.model || '') + '）' : '手で';
    return [s.ok ? 'OK済み' : 'OK前', '作った・直した：' + by, s.updated ? '更新 ' + hm(s.updated) : ''].filter(String).join('｜');
  }

  function renderStepStatus() {
    var s = state.c.steps[state.tab];
    var box = $('step-status');
    if (!box) return;
    box.replaceChildren.apply(box, stepBadges(s, state.tab));
  }

  /** まだ取り込んでいないデスクの版（新しい順） */
  function newDeskVersions(step) {
    var c = state.c;
    return ((c && c.desk && c.desk.versions) || []).filter(function (v) { return v.step === step && !v.applied; });
  }

  function deskApplyButton(v) {
    return el('button', { class: 'small primary', text: 'デスクの版を取り込む', onclick: function () {
      if (state.dirty && !confirm('保存していない直しがあります。デスクの版で置き換えますか？')) return;
      if (!confirm('この段の中身を、デスクの版で置き換えます（今の中身は「取り込む前の版」に残ります）。よいですか？')) return;
      call('applyDeskVersion', { caseId: state.c.id, fileId: v.fileId }, '取り込んでいます…', 'case-msg').then(function (r) {
        // 取り込みの答えにはデスクの版の一覧が付かず、手元の一覧を使い続けるので、取り込んだ印をここで付ける
        if (r && r.ok) v.applied = true;
        after(r, 'デスクの版を取り込みました');
      });
    } });
  }

  function stepBadges(s, step) {
    var out = [el('div', { class: 'status', text: stepStatusText(s) })];
    // 2026-11-05 デスクの版が届いたら、画面の上に出す（手で直している途中の読み直しでは下の欄が描き直されず、気づけなかったため）
    var fresh = newDeskVersions(step);
    if (fresh.length) out.push(el('div', { class: 'warn desk-new' }, [
      el('div', { text: 'デスクの版が届きました：' + fresh[0].name + (fresh.length > 1 ? '（ほかに' + (fresh.length - 1) + '件）' : '') }),
      el('div', { class: 'row' }, [deskApplyButton(fresh[0])]),
    ]));
    var line = [];
    if (s.running) line.push(el('span', { class: 'badge st-run', text: 'Gemini が作っています（裏で進みます）' }));
    if (s.deskPending) line.push(el('span', { class: 'badge st-wait', text: 'デスクに依頼中（家のPCで「依頼を片づけて」）' }));
    if (s.content && s.review === 'needed') line.push(el('span', { class: 'badge st-run', text: 'デスクのレビュー前' }));
    if (s.stale) line.push(el('span', { class: 'badge st-err', text: '前の段か登録内容が変わった' }));
    if (s.proposal) line.push(el('span', { class: 'badge st-run', text: s.proposal.status === 'ready' ? '反映前の案あり' : s.proposal.status === 'error' ? '案を作れなかった' : s.proposal.remake ? '作り直した案を作っています' : '材料を反映した案を作っています' }));
    if (line.length) out.push(el('div', {}, line));
    if (s.fallbackModel) out.push(el('div', { class: 'warn', text: '設定のモデルが使えないため、' + s.fallbackModel + ' で作りました。' }));
    if (s.error) out.push(el('div', { class: 'errbox', text: s.error }));
    return out;
  }

  /**
   * 追加の質問票を Google フォームにする（2026-11-05 久夫さん指示）。前のフォームに回答がまだなければ同じフォームを作り直す（URL は同じ）。
   * 回答があるときは、確かめてから新しいフォームを作る（前のフォームと回答は残る）
   */
  function makeSurveyForm(c, renew) {
    busy('フォームを作っています…');
    api('questionnaireForm', { caseId: c.id, renew: !!renew }).then(function (r) {
      idle();
      if (r.ok) {
        after(r, (r.isNew ? 'フォームを作りました。' : '今のフォームの問いを作り直しました（お客様に送る URL は前と同じです）。') +
          '下の「お客様に送る URL」をお送りください。' + (r.warn ? '\n' + r.warn : ''));
        return;
      }
      if (r.code === 'E007') {
        if (confirm('今のフォームには、もう回答が' + r.count + '件あります。\n\n新しいフォームを作りますか？（今のフォームと回答は残ります。お客様には新しい URL を送り直してください）')) makeSurveyForm(c, true);
        return;
      }
      msg('case-msg', errText(r), 'err');
    }).catch(function (e) { idle(); msg('case-msg', errText(e), 'err'); });
  }

  /** 作ったフォーム：お客様に送る URL・編集・回答の取り込み */
  function surveyFormPanel(c) {
    var f = c.surveyForm;
    var url = safeLink(f.url);
    return el('div', { class: 'card' }, [
      el('div', { class: 'sub', text: '質問票のフォーム（' + f.count + '問・' + hm(f.time) + '）' }),
      url ? el('div', { class: 'row' }, [
        el('span', { text: 'お客様に送る URL：' }),
        el('a', { class: 'formurl', href: url, target: '_blank', rel: 'noopener', text: url }),
        el('button', { class: 'small', text: 'URL をコピー', onclick: function () {
          var done = function () { msg('case-msg', 'URL をコピーしました', 'ok'); };
          if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(done, function () { prompt('この URL をコピーしてください', url); });
          else prompt('この URL をコピーしてください', url);
        } }),
      ]) : null,
      el('div', { class: 'row' }, [
        safeLink(f.editUrl) ? el('a', { href: f.editUrl, target: '_blank', rel: 'noopener', text: 'フォームを開く（編集・回答の確認）' }) : null,
        el('button', { class: 'small primary', text: 'フォームの回答を取り込む', onclick: function () {
          if (state.dirty) { alert('先に「手で直した内容を保存」を押してください'); return; }
          // 今までの「フォームの URL を貼る」と同じ処理。追加の質問票の回答として、この案件の材料に入れる（回答が入っている欄は上書きしない）
          call('addDriveFile', { caseId: c.id, kind: 'survey', step: 's3', name: '追加の質問票の回答（フォーム）', url: f.id }, '取り込みを始めています…', 'case-msg')
            .then(function (r) { after(r, '取り込みを始めました。読み終えると、問いの文が同じ回答欄に入ります（回答が入っている欄は上書きしません）'); });
        } }),
      ]),
    ]);
  }

  function renderStep(step) {
    var c = state.c;
    var s = c.steps[step];
    var box = $('tab-step');
    var parts = [el('h2', { text: STEP_TAB[step] }), el('div', { id: 'step-status' }, stepBadges(s, step))];
    (c.warnings || []).forEach(function (w) { parts.push(el('div', { class: 'warn', text: w })); });
    var need = { s4: 's3', s5: 's4' }[step];
    if (need && !c.steps[need].ok) parts.push(el('div', { class: 'warn', text: '先に「' + STEP_TAB[need] + '」をOKしてください（作る・直すは、前の段のOKの後にできます）' }));
    if (s.proposal) parts.push(proposalPanel(step));
    if (step === 's3' || step === 's4') parts.push(stepMaterials(step));

    var content = null, hearing = null;
    if (s.content) {
      content = step === 's3' ? policyDoc(s.content) : step === 's4' ? strategyDoc(s.content) : slideDoc(s.content);
      if (step === 's3') parts.push(el('h3', { text: '目的・課題' }));
      if (step === 's5') {
        // 分析はスライドの形で出し、パワポ（pptx）に書き出せる（2026-11-05 久夫さん指示）
        parts.push(el('div', { class: 'row' }, [
          el('h3', { text: '分析（スライド）' }),
          el('button', { class: 'small primary', text: 'パワポ（pptx）を書き出す', onclick: function () {
            if (state.dirty) { alert('先に「保存」を押してください（パワポは保存した分析から作ります）'); return; }
            exportPptx(s.content);
          } }),
        ]));
      }
      parts.push(content);
      if (step === 's3') {
        parts.push(el('h3', { text: 'ヒアリング項目と回答' }));
        hearing = hearingTable(s.items || []);
        parts.push(hearing);
        parts.push(el('div', { class: 'row' }, [
          el('button', { text: '質問票（Word）を書き出す', onclick: function () {
            if (state.dirty) { alert('先に「手で直した内容を保存」を押してください（質問票は保存した問いから作ります）'); return; }
            call('questionnaire', { caseId: c.id }, '書き出しています…', 'case-msg').then(function (r) { after(r, '書き出しました。案件の上の「質問票（Word）」から開けます'); });
          } }),
          el('button', { text: 'Googleフォームに追加', onclick: function () {
            if (state.dirty) { alert('先に「手で直した内容を保存」を押してください（フォームは保存した問いから作ります）'); return; }
            makeSurveyForm(c, false);
          } }),
          s.lastFill ? el('span', { class: 'sub', text: '材料から回答欄を埋めた：' + s.lastFill.filled + '問（' + hm(s.lastFill.time) + '）' }) : null,
        ]));
        if (c.surveyForm) parts.push(surveyFormPanel(c));
      }
      if (step === 's5' && s.check) parts.push(el('h3', { text: '渡す前の点検' }), el('div', { class: 'readonly', text: s.check }));
      if (s.next) parts.push(el('h3', { text: '次に聞くこと' }), el('div', { class: 'readonly', text: s.next }));
      if (s.sorting) parts.push(el('details', {}, [el('summary', { text: 'デスクのレビュー（指摘と仕分け）' }), el('div', { class: 'readonly', text: s.sorting })]));
      if (s.before && s.before.content) parts.push(el('details', {}, [el('summary', { text: '取り込む前の版（' + hm(s.before.time) + '）' }), el('div', { class: 'readonly', text: s.before.content })]));
    } else {
      parts.push(el('p', { class: 'sub', text: 'まだ作っていません。「Gemini で作る」か「デスクに頼む」を押してください。入れた材料（文字になったもの）をすべて使って作ります。' }));
    }

    // デスクの版
    var versions = ((c.desk && c.desk.versions) || []).filter(function (v) { return v.step === step; });
    if (versions.length) {
      parts.push(el('h3', { text: 'デスクの版（家のPCで作ったもの）' }));
      parts.push(el('div', { class: 'list' }, versions.map(function (v) {
        return el('div', { class: 'mat' }, [
          el('div', { class: 'head' }, [el('span', { class: 'badge ' + (v.applied ? 'st-done' : 'st-run'), text: v.applied ? '取り込み済み' : '新しい版' }), el('span', { class: 'name', text: v.name })]),
          v.applied ? null : el('div', { class: 'acts' }, [deskApplyButton(v)]),
        ]);
      })));
    }

    // 材料・指示は本文の後に置き、ボタンの行だけを画面の下に固定する（スマホで本文が隠れないように）
    parts = parts.concat(actionBar(step));
    put(box, parts);
    if (content) docAreas().forEach(autosize);
  }

  window.addEventListener('resize', function () { docAreas().forEach(autosize); });

  /** 段の本文の入力欄（方針0〜2は節ごとに分けた複数の欄。閉じた補足の欄は除く） */
  function docAreas() {
    return Array.prototype.filter.call(document.querySelectorAll('#step-content, #step-doc textarea'), function (t) { return t.offsetParent !== null; });
  }

  /**
   * 方針0〜2の本文を、「### 補足」の前と後で分けて出す（2026-11-05 久夫さん指示）。
   * 最初に見えるのは各節の要点（「## 」の見出しから最初の「### 」の前まで）だけ。「### 」の小節（補足・課題1〜3・そのほかの事実）は、
   * 次の「## 」「### 」の見出しの前までをボタンで開く（2026-11-05 久夫さん指示：画面を開いたときは、簡潔にまとめた要件・ポイントだけを出す）。
   * 保存するときは、分けた欄を元の順につなぎ直す（policyText）。
   */
  /** byChapter＝「## 」の見出しごとにも欄を分ける（対策のタブで、節をカードに分けるため） */
  function splitPolicy(text, byChapter) {
    var segs = [], cur = null;
    String(text || '').split('\n').forEach(function (line) {
      var isHosoku = /^###\s/.test(line);
      var isHead = /^#{2,3}\s/.test(line);
      if (isHosoku) { cur = { kind: 'hosoku', head: line, lines: [] }; segs.push(cur); return; }
      if (!cur || (cur.kind === 'hosoku' && isHead) || (byChapter && /^##\s/.test(line) && cur.lines.length)) { cur = { kind: 'main', lines: [] }; segs.push(cur); }
      cur.lines.push(line);
    });
    segs.forEach(function (seg, i) { seg.ord = i; });
    return segs;
  }

  /** 欄を1つ作る。main＝見出しと要点（そのまま見せる）、hosoku＝「### 」の小節（ボタンで開く） */
  function segPart(seg, title) {
    var area = el('textarea', { class: 'doc part', value: seg.lines.join('\n'), oninput: function () { state.dirty = true; } });
    area.dataset.kind = seg.kind;
    area.dataset.ord = String(seg.ord);
    if (seg.kind === 'main') return area;
    area.dataset.head = seg.head;
    var key = seg.ord + ':' + title;
    var open = !!state.hosokuOpen[key];
    area.hidden = !open;
    var name = seg.head.replace(/^###\s*/, '');
    var label = function () { return /^補足$/.test(name) ? (open ? '補足を閉じる' : '補足を表示') + (title ? '（' + title + '）' : '') : (open ? '▾ ' : '▸ ') + name; };
    var btn = el('button', { type: 'button', class: 'small hosoku-btn', text: label() });
    btn.addEventListener('click', function () {
      open = !open;
      state.hosokuOpen[key] = open;
      area.hidden = !open;
      btn.textContent = label();
      if (open) autosize(area);
    });
    return el('div', { class: 'hosoku' }, [btn, area]);
  }

  function chapterTitle(seg) {
    var h = seg.lines.filter(function (l) { return /^##\s/.test(l); })[0];
    return h ? h.replace(/^##\s*/, '') : '';
  }

  function policyDoc(text) {
    var box = el('div', { id: 'step-doc', class: 'policydoc' });
    var title = '';
    splitPolicy(text).forEach(function (seg) {
      if (seg.kind === 'main' && chapterTitle(seg)) title = chapterTitle(seg);
      box.appendChild(segPart(seg, title));
    });
    return box;
  }

  /**
   * 対策のタブ（2026-11-05 久夫さん指示）。方針3を「真の課題」のカードとして最初に出し、次に方針4を「対策」のカード
   * （課題ごとの対策の表）、方針5と付をカードで出す。方針0〜2（ヒアリングの回答を反映した版）は最後にたたんで出す。
   * 欄の並びは本文の順と違うので、保存のときは data-ord（本文の中の順）でつなぎ直す（policyText）。
   */
  var STRATEGY_CARDS = [
    { no: '3', title: '真の課題' },
    { no: '4', title: '対策' },
    { no: '5', title: '体制' },
    { no: '付', title: '初回面談で確かめること' },
  ];
  function strategyDoc(text) {
    var box = el('div', { id: 'step-doc', class: 'policydoc strategy' });
    var chapters = [], cur = null;
    splitPolicy(text, true).forEach(function (seg) {
      var t = seg.kind === 'main' ? chapterTitle(seg) : '';
      if (t || !cur) { cur = { no: (t.match(/^(\d+|付)\s*[.．]/) || [])[1] || '', title: t, segs: [] }; chapters.push(cur); }
      cur.segs.push(seg);
    });
    var used = {};
    STRATEGY_CARDS.forEach(function (card) {
      chapters.forEach(function (ch, i) {
        if (ch.no !== card.no || used[i]) return;
        used[i] = true;
        var body = el('div', { class: 'card' }, [el('h3', { class: 'card-title', text: card.title })]);
        ch.segs.forEach(function (seg) {
          body.appendChild(seg.kind === 'main' && card.no === '4' ? tablePart(seg) : segPart(seg, ch.title));
        });
        box.appendChild(body);
      });
    });
    // 方針0〜2の写しと、型に合わない節は最後にたたむ（消さない。保存のときはそのまま残る）
    var rest = chapters.filter(function (ch, i) { return !used[i]; });
    if (rest.length) {
      var inner = el('div', { class: 'policydoc' });
      rest.forEach(function (ch) { ch.segs.forEach(function (seg) { inner.appendChild(segPart(seg, ch.title)); }); });
      var det = el('details', { class: 'card rest' }, [el('summary', { text: '目的・課題（ヒアリングの回答を反映した版）' }), inner]);
      det.addEventListener('toggle', function () { if (det.open) inner.querySelectorAll('textarea').forEach(function (t) { if (!t.hidden) autosize(t); }); });
      box.appendChild(det);
    }
    return box;
  }

  /**
   * 分析のタブ（2026-11-05 久夫さん指示）。「## 」の節を1枚ずつのスライドとして出す。表は表で、「### 」は小見出しで見せ、
   * 「このスライドを手で直す」で元の文章の欄を開く。保存は欄を本文の順（data-ord）につなぐ（policyText）
   */
  function splitChapters(text) {
    var out = [], cur = null;
    String(text || '').split('\n').forEach(function (line) {
      if (!cur || /^##\s/.test(line)) { cur = { lines: [] }; out.push(cur); }
      cur.lines.push(line);
    });
    return out.filter(function (ch, i) { return i > 0 || ch.lines.join('').trim() || out.length === 1; });
  }

  function slideDoc(text) {
    var box = el('div', { id: 'step-doc', class: 'slides' });
    var chs = splitChapters(text);
    chs.forEach(function (ch, i) {
      var title = chapterTitle(ch) || '前書き';
      var area = el('textarea', { class: 'doc part', value: ch.lines.join('\n'), oninput: function () { state.dirty = true; draw(); } });
      area.dataset.kind = 'main';
      area.dataset.ord = String(i);
      area.hidden = true;
      var view = el('div', { class: 'mdview' });
      var draw = function () { view.replaceChildren.apply(view, mdBlocks(area.value)); };
      draw();
      var btn = el('button', { type: 'button', class: 'small hosoku-btn', text: 'このスライドを手で直す' });
      btn.addEventListener('click', function () {
        area.hidden = !area.hidden;
        btn.textContent = area.hidden ? 'このスライドを手で直す' : '手で直す欄を閉じる';
        if (!area.hidden) autosize(area);
      });
      box.appendChild(el('section', { class: 'slide' }, [
        el('div', { class: 'slide-head' }, [el('span', { class: 'slide-title', text: title }), el('span', { class: 'slide-no', text: (i + 1) + ' / ' + chs.length })]),
        el('div', { class: 'slide-body' }, [view]),
        el('div', { class: 'hosoku' }, [btn, area]),
      ]));
    });
    return box;
  }

  function chapterTitleOf(lines) {
    var h = lines.filter(function (l) { return /^##\s/.test(l); })[0];
    return h ? h.replace(/^##\s*/, '') : '';
  }

  /** 表の行（「|」で始まる行）をセルの配列に */
  function mdCells(l) { return l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(function (x) { return x.trim().replace(/\*\*/g, '').replace(/<br\s*\/?>/gi, '\n'); }); }

  /** 文章を、見出し（### ）・表・それ以外の文に分ける（スライドとパワポで同じ分け方を使う） */
  function mdParts(text) {
    var out = [], buf = [], rows = [];
    var flushText = function () { var t = buf.join('\n').replace(/^\s+|\s+$/g, ''); if (t) out.push({ type: 'text', text: t.replace(/\*\*/g, '') }); buf = []; };
    var flushTable = function () {
      if (!rows.length) return;
      var body = rows.slice(1).filter(function (l) { return !/^\s*\|?\s*:?-{2,}/.test(l); });
      out.push({ type: 'table', head: mdCells(rows[0]), rows: body.map(mdCells) });
      rows = [];
    };
    String(text || '').split('\n').forEach(function (l) {
      if (/^##\s/.test(l)) return;
      if (/^###\s/.test(l)) { flushTable(); flushText(); out.push({ type: 'h', text: l.replace(/^#+\s*/, '') }); return; }
      if (/^\s*\|/.test(l)) { flushText(); rows.push(l); } else { flushTable(); buf.push(l); }
    });
    flushTable(); flushText();
    return out;
  }

  /** パワポ（pptx）を書き出す。PptxGenJS は押したときだけ読み込む（ふだんの画面を重くしないため） */
  var PPTX_LIB = 'https://cdn.jsdelivr.net/npm/pptxgenjs@3.12.0/dist/pptxgen.bundle.js';
  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      if (window.PptxGenJS) { resolve(); return; }
      var sc = document.createElement('script');
      sc.src = src; sc.onload = function () { resolve(); }; sc.onerror = function () { reject(new Error('パワポを作る部品を読み込めませんでした。電波のよい所でもう一度押してください')); };
      document.head.appendChild(sc);
    });
  }

  function buildPptx(text) {
    var ORANGE = 'E7741D', INK = '222222', FONT = 'Meiryo';
    var pptx = new window.PptxGenJS();
    pptx.layout = 'LAYOUT_WIDE';   // 13.33 × 7.5 インチ
    var W = 13.33, X = 0.5, CW = W - 1.0, TOP = 1.25, BOTTOM = 7.0;
    var today = new Date();
    var ymd = today.getFullYear() + '-' + ('0' + (today.getMonth() + 1)).slice(-2) + '-' + ('0' + today.getDate()).slice(-2);
    // 表紙（分析のファイルには会社名を書かない決まりのため、表紙にも会社名は入れない）
    var cover = pptx.addSlide();
    cover.background = { color: 'FFFFFF' };
    cover.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: W, h: 0.25, fill: { color: ORANGE }, line: { color: ORANGE } });
    cover.addText('DX要件分析', { x: X, y: 2.6, w: CW, h: 1.0, fontFace: FONT, fontSize: 40, bold: true, color: INK });
    cover.addText(ymd + '　初回面談の前の仮説', { x: X, y: 3.7, w: CW, h: 0.6, fontFace: FONT, fontSize: 18, color: '666666' });
    var newSlide = function (title, cont) {
      var sl = pptx.addSlide();
      sl.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: W, h: 0.95, fill: { color: ORANGE }, line: { color: ORANGE } });
      sl.addText(title + (cont ? '（続き）' : ''), { x: X, y: 0.12, w: CW, h: 0.7, fontFace: FONT, fontSize: 24, bold: true, color: 'FFFFFF' });
      return sl;
    };
    // 1行の高さ（インチ）と、1行に入る全角の文字数のおおよそ（14pt・幅12.3インチ）
    var LH = 0.3, PER_LINE = 60;
    var linesOf = function (t) { return t.split('\n').reduce(function (n, l) { return n + Math.max(1, Math.ceil(l.length / PER_LINE)); }, 0); };
    splitChapters(text).forEach(function (ch) {
      var title = chapterTitleOf(ch.lines);
      if (!title) return;
      var sl = newSlide(title, false), y = TOP;
      // 高さ h の物を置く前に、入らなければ新しいスライド（「続き」）に移る
      var room = function (h) { if (!sl || y + h > BOTTOM) { sl = newSlide(title, true); y = TOP; } };
      mdParts(ch.lines.join('\n')).forEach(function (p) {
        if (p.type === 'h') {
          room(0.9);   // 見出しだけがスライドの最後に残らないよう、次の1〜2行分も見込む
          sl.addText(p.text, { x: X, y: y, w: CW, h: 0.42, fontFace: FONT, fontSize: 16, bold: true, color: ORANGE });
          y += 0.48;
        } else if (p.type === 'text') {
          // 長い文は、スライドに収まる行数ずつに分ける
          var chunk = [];
          var hOf = function (ls) { return linesOf(ls.join('\n')) * LH + 0.1; };
          var flush = function () {
            if (!chunk.length) return;
            var h = hOf(chunk);
            room(h);
            sl.addText(chunk.join('\n'), { x: X, y: y, w: CW, h: h, fontFace: FONT, fontSize: 14, color: INK, valign: 'top' });
            y += h + 0.1;
            chunk = [];
          };
          p.text.split('\n').forEach(function (l) {
            if (sl && y + hOf(chunk.concat([l])) > BOTTOM) {
              flush();                                   // 今のスライドに入る分を置く
              if (y + hOf([l]) > BOTTOM) { sl = newSlide(title, true); y = TOP; }   // 次の行からは新しいスライド
            }
            chunk.push(l);
          });
          flush();
        } else if (p.type === 'table') {
          var n = p.head.length, fs = n >= 5 ? 10 : 12;
          var rows = [p.head.map(function (h) { return { text: h, options: { bold: true, color: 'FFFFFF', fill: { color: ORANGE } } }; })]
            .concat(p.rows.map(function (r) { return p.head.map(function (_, i) { return { text: r[i] || '' }; }); }));
          // 文の長い列を広くする
          var len = p.head.map(function (h, i) { return Math.max(4, Math.min(60, p.rows.reduce(function (m, r) { return Math.max(m, String(r[i] || '').length); }, h.length))); });
          var sum = len.reduce(function (a, b) { return a + b; }, 0);
          var colW = len.map(function (v) { return CW * v / sum; });
          // 表の高さの見積もり（全角1文字＝文字の大きさの幅として、列ごとの行数から出す）
          var rowH = function (cells) {
            var lines = cells.reduce(function (m, c, i) {
              var cpl = Math.max(1, Math.floor(colW[i] * 72 / fs) - 1);
              var nl = String(c.text || '').split('\n').reduce(function (a, s) { return a + Math.max(1, Math.ceil(s.length / cpl)); }, 0);
              return Math.max(m, nl);
            }, 1);
            return lines * fs * 1.3 / 72 + 0.12;
          };
          var est = rows.reduce(function (a, r) { return a + rowH(r); }, 0);
          if (y > TOP + 0.01 && y + Math.min(est, 1.5) > BOTTOM) { sl = newSlide(title, true); y = TOP; }
          var fits = y + est <= BOTTOM;
          sl.addTable(rows, { x: X, y: y, w: CW, colW: colW, fontFace: FONT, fontSize: fs, color: INK, border: { type: 'solid', pt: 0.5, color: 'BBBBBB' },
            valign: 'top', autoPage: !fits, autoPageRepeatHeader: true, autoPageSlideStartY: TOP, newSlideStartY: TOP });
          if (fits) y += est + 0.15;
          else { sl = null; y = BOTTOM + 1; }   // 表が次のスライドへ続いたときは、表の後を新しいスライドから続ける
        }
      });
    });
    return pptx;
  }

  function exportPptx(text) {
    busy('パワポを作っています…');
    loadScript(PPTX_LIB).then(function () {
      var d = new Date();
      var name = 'DX要件分析_' + d.getFullYear() + ('0' + (d.getMonth() + 1)).slice(-2) + ('0' + d.getDate()).slice(-2) + '.pptx';
      return buildPptx(text).writeFile({ fileName: name }).then(function () {
        idle();
        msg('case-msg', 'パワポを書き出しました（' + name + '）。ダウンロードの場所を見てください', 'ok');
      });
    }).catch(function (e) { idle(); msg('case-msg', errText(e), 'err'); });
  }
  window.DXY_buildPptx = function (text) { return loadScript(PPTX_LIB).then(function () { return buildPptx(text); }); };   // 動作確認用

  /** 対策の節の要点：表は表で見せ、「手で直す」で元の文章の欄を開く */
  function tablePart(seg) {
    var area = segPart(seg, '');
    var view = el('div', { class: 'mdview' });
    var draw = function () { view.replaceChildren.apply(view, mdBlocks(area.value)); };
    draw();
    area.hidden = true;
    area.addEventListener('input', draw);
    var btn = el('button', { type: 'button', class: 'small hosoku-btn', text: '表と文章を手で直す' });
    btn.addEventListener('click', function () {
      area.hidden = !area.hidden;
      btn.textContent = area.hidden ? '表と文章を手で直す' : '手で直す欄を閉じる';
      if (!area.hidden) autosize(area);
    });
    return el('div', { class: 'hosoku' }, [view, btn, area]);
  }

  /** 文章を、表（「|」で始まる行）とそれ以外に分けて見せる。「## 」の見出しの行は出さない（カードの見出しで足りる） */
  function mdBlocks(text) {
    // 分け方は mdParts と同じ（スライドの画面とパワポで見え方をそろえる）。セルの中の <br> は改行として見せる
    return mdParts(text).map(function (p) {
      if (p.type === 'h') return el('h4', { class: 'md-h', text: p.text });
      if (p.type === 'text') return el('div', { class: 'readonly', text: p.text });
      var table = el('table', { class: 'strat' }, [el('tr', {}, p.head.map(function (h) { return el('th', { text: h }); }))]);
      p.rows.forEach(function (r) {
        table.appendChild(el('tr', {}, p.head.map(function (h, i) { return el('td', { text: r[i] || '', 'data-label': h }); })));
      });
      return table;
    });
  }

  /** 分けた欄を元の本文につなぎ直す（欄の並びが本文の順と違うときも、data-ord の順に戻す） */
  function policyText() {
    var out = [];
    var areas = Array.prototype.slice.call(document.querySelectorAll('#step-doc textarea.part'));
    areas.sort(function (a, b) { return Number(a.dataset.ord) - Number(b.dataset.ord); });
    areas.forEach(function (t) {
      if (t.dataset.kind === 'hosoku') out.push(t.dataset.head);
      if (t.value !== '' || t.dataset.kind === 'main') out = out.concat(t.value.split('\n'));
    });
    return out.join('\n');
  }

  /**
   * 材料を反映した案の確認欄（2026-11-05 久夫さん指示）。録音などで前提が変わることがあるので、
   * 今の内容と反映した後を比べ、「反映する」を押したときだけ段の中身に入れる。
   */
  function proposalPanel(step) {
    var c = state.c;
    var s = c.steps[step];
    var p = s.proposal;
    var names = p.remake ? '今の材料で作り直' : '「' + (p.names || []).join('」「') + '」を反映';   // 「〜した案」の前の言葉
    var discard = el('button', { class: 'small', text: p.status === 'ready' ? '反映しない' : '案を消す', onclick: function () {
      if (!confirm(p.status === 'ready' ? 'この案を反映せずに消しますか？（今の内容はそのままです）' : '作っている案を消しますか？')) return;
      call('discardProposal', { caseId: c.id, step: step }, '消しています…', 'case-msg').then(function (r) { after(r, '案を消しました。今の内容はそのままです'); });
    } });
    if (p.status === 'making') {
      return el('div', { class: 'panel proposal' }, [
        el('h3', { text: names + 'した案を作っています' }),
        el('p', { class: 'sub', text: '1〜2分かかります（裏で進みます）。できると、ここに今の内容との違いが出ます。' }),
        p.error ? el('div', { class: 'warn', text: p.error }) : null,
        el('div', { class: 'row' }, [discard]),
      ]);
    }
    if (p.status === 'error') {
      return el('div', { class: 'panel proposal' }, [
        el('h3', { text: names + 'した案を作れませんでした' }),
        el('div', { class: 'errbox', text: p.error || '' }),
        el('p', { class: 'sub', text: p.remake ? '今の内容はそのままです。案を消してから、もう一度「Gemini で作り直す」を押してください。' : '今の内容はそのままです。案を消してから、材料を入れ直してください。' }),
        el('div', { class: 'row' }, [discard]),
      ]);
    }
    var changed = s.updated && p.base && String(s.updated) > String(p.base);
    var diff = diffView(s.content, p.content);
    var itemDiff = step === 's3' ? itemsDiffView(s.items || [], p.items || []) : null;
    var apply = el('button', { class: 'primary', text: '反映する', onclick: function () {
      if (state.dirty && !confirm('保存していない直しがあります。反映すると消えます。反映しますか？')) return;
      if (changed && !confirm('この案を作った後に、手で直した内容があります。反映すると、その直しは消えます（「取り込む前の版」には残ります）。反映しますか？')) return;
      call('applyProposal', { caseId: c.id, step: step }, '反映しています…', 'case-msg').then(function (r) { after(r, '反映しました。前の内容は「取り込む前の版」に残っています'); });
    } });
    return el('div', { class: 'panel proposal' }, [
      el('h3', { text: names + 'した案ができました' }),
      el('p', { class: 'sub', text: p.remake
        ? '今の内容から、次のように変わります。手で直した所や、残したい書き方が消えていないか確かめ、よければ「反映する」を押してください。押すまで、今の内容は変わりません。'
        : '今の内容から、次のように変わります。打ち合わせで前提が変わっていないか確かめ、よければ「反映する」を押してください。押すまで、今の内容は変わりません。' }),
      changed ? el('div', { class: 'warn', text: 'この案を作った後に、手で直した内容があります。反映すると、その直しは消えます。' }) : null,
      el('h4', { text: STEP_TAB[step].replace('・ヒアリング', '') + 'の文章' }),
      diff,
      itemDiff ? el('h4', { text: 'ヒアリング項目と回答' }) : null,
      itemDiff,
      el('details', {}, [el('summary', { text: '反映した後の全文を見る' }), el('div', { class: 'readonly', text: p.content })]),
      el('div', { class: 'row' }, [apply, discard]),
    ]);
  }

  /** 2つの文章の行ごとの違い（[['=', 行] | ['-', 行] | ['+', 行]]） */
  function lineDiff(a, b) {
    var A = String(a || '').split('\n'), B = String(b || '').split('\n');
    var n = A.length, m = B.length, pre = 0, suf = 0;
    while (pre < n && pre < m && A[pre] === B[pre]) pre++;
    while (suf < n - pre && suf < m - pre && A[n - 1 - suf] === B[m - 1 - suf]) suf++;
    var a2 = A.slice(pre, n - suf), b2 = B.slice(pre, m - suf);
    var L = [], i, j;
    for (i = 0; i <= a2.length; i++) L.push(new Int32Array(b2.length + 1));
    for (i = a2.length - 1; i >= 0; i--) for (j = b2.length - 1; j >= 0; j--) L[i][j] = a2[i] === b2[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
    var ops = A.slice(0, pre).map(function (l) { return ['=', l]; });
    i = 0; j = 0;
    while (i < a2.length && j < b2.length) {
      if (a2[i] === b2[j]) { ops.push(['=', a2[i]]); i++; j++; }
      else if (L[i + 1][j] >= L[i][j + 1]) ops.push(['-', a2[i++]]);
      else ops.push(['+', b2[j++]]);
    }
    while (i < a2.length) ops.push(['-', a2[i++]]);
    while (j < b2.length) ops.push(['+', b2[j++]]);
    return ops.concat(A.slice(n - suf).map(function (l) { return ['=', l]; }));
  }

  /** 違いの表示。変わった行の前後1行と、その節の見出しだけを出し、ほかは「…（変わらない N行）」にまとめる */
  function diffView(a, b) {
    var ops = lineDiff(a, b);
    if (!ops.some(function (o) { return o[0] !== '='; })) return el('p', { class: 'sub', text: '文章は変わりません。' });
    var keep = ops.map(function () { return false; });
    ops.forEach(function (o, k) {
      if (o[0] === '=') return;
      keep[k] = true;
      if (k > 0) keep[k - 1] = true;
      if (k + 1 < ops.length) keep[k + 1] = true;
      // その行が入っている節の見出し（####・###・## を近い順に1つずつ）も出す
      var minLv = 9;
      for (var h = k - 1; h >= 0 && minLv > 2; h--) {
        var hm2 = ops[h][0] === '=' && ops[h][1].match(/^(#{2,4})\s/);
        if (hm2 && hm2[1].length < minLv) { keep[h] = true; minLv = hm2[1].length; }
      }
    });
    var box = el('div', { class: 'diff' });
    var skipped = 0;
    function flush() { if (skipped) box.appendChild(el('div', { class: 'skip', text: '…（変わらない ' + skipped + '行）' })); skipped = 0; }
    ops.forEach(function (o, k) {
      if (!keep[k]) { skipped++; return; }
      flush();
      box.appendChild(el('div', { class: o[0] === '+' ? 'add' : o[0] === '-' ? 'del' : 'same', text: (o[0] === '+' ? '＋ ' : o[0] === '-' ? '－ ' : '　 ') + (o[1] || ' ') }));
    });
    flush();
    return box;
  }

  /** ヒアリング項目の違い：回答が入る問い・足す問い・なくなる問い */
  function itemsDiffView(cur, neu) {
    var norm = function (t) { return String(t || '').replace(/\s+/g, ''); };
    var byText = {};
    cur.forEach(function (it) { byText[norm(it.item)] = it; });
    var neuText = {};
    neu.forEach(function (it) { neuText[norm(it.item)] = true; });
    var answered = [], added = [];
    neu.forEach(function (it) {
      var old = byText[norm(it.item)];
      if (!old) { added.push(it); return; }
      if (String(it.answer || '').trim() !== String(old.answer || '').trim() && String(it.answer || '').trim()) answered.push(it);
    });
    var removed = cur.filter(function (it) { return !neuText[norm(it.item)]; });
    if (!answered.length && !added.length && !removed.length) return el('p', { class: 'sub', text: 'ヒアリング項目と回答は変わりません。' });
    var box = el('div', { class: 'diff' });
    answered.forEach(function (it) { box.appendChild(el('div', { class: 'add', text: '＋ 回答が入る：#' + it.no + ' ' + it.item + ' → ' + it.answer + (it.source ? '（' + it.source + '）' : '') })); });
    added.forEach(function (it) { box.appendChild(el('div', { class: 'add', text: '＋ 問いを足す：#' + it.no + ' ' + it.item + (it.answer ? ' → ' + it.answer : '') })); });
    removed.forEach(function (it) { box.appendChild(el('div', { class: 'del', text: '－ 問いがなくなる：#' + it.no + ' ' + it.item + (it.answer ? '（回答：' + it.answer + '）' : '') })); });
    return box;
  }

  /** 方針0〜2・方針3〜5のタブで、その段の打ち合わせの録音（ほかの材料も可）を入れる欄と、このタブで入れた材料の一覧 */
  function stepMaterials(step) {
    var mine = (state.c.materials || []).filter(function (m) { return m.step === step; });
    var open = Rec.here(state.c.id, step) || (state.matOpen[step] !== undefined ? state.matOpen[step] : !mine.length);
    var box = el('details', { class: 'panel stepmat', open: open || null }, [
      el('summary', { text: '🎧 打ち合わせの録音・メモを入れる' +(mine.length ? '（このタブで入れた材料 ' + mine.length + '本）' : '') }),
      el('p', { class: 'sub', text: (step === 's3'
        ? 'この段の打ち合わせの録音・メモと、書き出した追加の質問票の回答を入れます。'
        : 'この段の打ち合わせの録音・メモを入れます。') + (state.c.steps[step].content
        ? '文字にし終わると、その内容を反映した案を作ります（1〜2分）。案ができると、この画面の上に「今の内容」と「反映した後」を比べる欄が出ます。よければ「反映する」を押してください。押すまで、今の内容は変わりません。'
        : '文字にし終わった後に「Gemini で作る」を押すと、これも使って作ります。') }),
      mine.length ? materialList(mine) : null,
      addMaterialForm({ step: step, kind: 'audio', title: '録音・メモを入れる' }),
    ]);
    box.addEventListener('toggle', function () { state.matOpen[step] = box.open; });
    return box;
  }


  /** ヒアリング項目の表（区分ごと。問い・回答・【要確認】・出どころ） */
  function hearingTable(items) {
    var groups = (state.c && state.c.groups) || (state.cfg && state.cfg.groups) || [];
    var table = el('table', { class: 'hearing', id: 'hearing' });
    table.appendChild(el('tr', {}, [el('th', { text: '#' }), el('th', { text: '押さえる項目' }), el('th', { text: '回答' })]));
    function row(it) {
      var q = el('textarea', { class: 'item', value: it.item, oninput: function () { state.dirty = true; } });
      var a = el('textarea', { class: 'ans', value: it.answer || '', oninput: function () { state.dirty = true; } });
      var u = el('input', { type: 'checkbox', class: 'unk', checked: !!it.unknown, onchange: function () { state.dirty = true; } });
      var tr = el('tr', {}, [
        el('td', { class: 'no', text: String(it.no) }),
        el('td', {}, [q, el('button', { class: 'link small', text: 'この問いを消す', onclick: function () { tr.remove(); state.dirty = true; } })]),
        el('td', {}, [a, el('label', { class: 'unknown' }, [u, ' 【要確認】のまま']), it.source ? el('div', { class: 'src', text: '出どころ：' + it.source }) : null]),
      ]);
      tr.dataset.group = it.group || 'other';
      tr.dataset.oral = it.oral ? '1' : '';
      tr.dataset.manual = it.manual ? '1' : '';
      tr.dataset.source = it.source || '';
      return tr;
    }
    var written = items.filter(function (it) { return !it.oral; });
    groups.concat([{ key: 'other', label: '区分なし' }]).forEach(function (g) {
      var rows = written.filter(function (it) { return (g.key === 'other' ? groups.map(function (x) { return x.key; }).indexOf(it.group) < 0 : it.group === g.key); });
      if (g.key === 'other' && !rows.length) return;
      table.appendChild(el('tr', { class: 'grp' }, [el('th', { colspan: '3', text: g.label })]));
      rows.forEach(function (it) { table.appendChild(row(it)); });
      if (g.key !== 'other') {
        var addRow = el('tr', {}, [el('td', { colspan: '3' }, [el('button', { class: 'link small', text: '＋ この区分に問いを足す', onclick: function () {
          var tr = row({ no: '新', item: '', answer: '', group: g.key, manual: true });
          addRow.parentNode.insertBefore(tr, addRow);
          tr.querySelector('textarea').focus();
          state.dirty = true;
        } })])]);
        table.appendChild(addRow);
      }
    });
    var orals = items.filter(function (it) { return it.oral; });
    if (orals.length) {
      var oralLabel = (state.cfg && state.cfg.oralLabel) || '面談で口頭で聞く問い';
      // 口頭で聞く問いも、課題の番号とタイトルの区分ごとに分けて出す（2026-11-05 久夫さん指示：問いを課題に合わせる）
      var keys = groups.map(function (x) { return x.key; });
      groups.concat([{ key: 'other', label: '区分なし' }]).forEach(function (g) {
        var rows = orals.filter(function (it) { return g.key === 'other' ? keys.indexOf(it.group) < 0 : it.group === g.key; });
        if (!rows.length) return;
        table.appendChild(el('tr', { class: 'grp' }, [el('th', { colspan: '3', text: oralLabel + '：' + g.label })]));
        rows.forEach(function (it) { table.appendChild(row(it)); });
      });
    }
    return table;
  }

  function collectItems() {
    var out = [];
    document.querySelectorAll('#hearing tr').forEach(function (tr) {
      var q = tr.querySelector('textarea.item');
      if (!q) return;
      out.push({
        no: out.length + 1, item: q.value, answer: tr.querySelector('textarea.ans').value, unknown: tr.querySelector('input.unk').checked,
        group: tr.dataset.group, oral: !!tr.dataset.oral, manual: !!tr.dataset.manual, source: tr.dataset.source,
      });
    });
    return out;
  }

  function editBody(step) {
    var body = { caseId: state.c.id, step: step };
    var t = $('step-content');
    if (t) body.content = t.value;
    else if ($('step-doc')) body.content = policyText();
    if (step === 's3' && $('hearing')) body.items = collectItems();
    return body;
  }

  /**
   * 段の下に固定する操作の行。
   * 2026-11-05 久夫さん指示で「材料・指示で直す」の欄はなくした：本文は手で直して「保存」、材料（録音など）を入れたときは反映した案を比べて「反映する」。
   * 作る：入れた材料（文字になったもの）をすべて使う。デスクに頼む：中身がなければ作る、あればレビューして直す。
   */
  function actionBar(step) {
    var c = state.c;
    var s = c.steps[step];
    function saveFirst() {
      if (!state.dirty) return Promise.resolve(true);
      return call('edit', editBody(step), '手で直した内容を保存しています…', 'case-msg').then(function (r) { if (r) { state.c = r.case; state.dirty = false; } return !!r; });
    }
    var okLabel = step === 's5' ? 'OKしてmdに保存' : 'OKして次へ';
    var bar = el('div', { class: 'actionbar' }, [
      el('div', { class: 'row' }, [
        s.content ? null : el('button', { class: 'small primary', text: 'Gemini で作る', disabled: !!s.running, onclick: function () {
          call('runStep', { caseId: c.id, step: step, mode: 'make', instruction: '', materialIds: [] }, '受け付けています…', 'case-msg')
            .then(function (r) { after(r, '受け付けました。Gemini が作っています（30秒〜1分ほど。裏で進みます）'); });
        } }),
        // 中身がある段を、今の材料をすべて使って今の型で作り直す（2026-11-05 久夫さん指示）。案は違いを見て「反映する」を押したときだけ入る
        s.content ? el('button', { class: 'small', text: 'Gemini で作り直す', disabled: !!s.running || !!(s.proposal && s.proposal.status === 'making'), onclick: function () {
          var msgText = '入れた材料（文字になったもの）をすべて使って、今の型で作り直した案を作ります（1〜2分）。\n' +
            '案ができたら、今の内容との違いを見て「反映する」を押したときだけ入ります。手で直した所も、案では変わることがあります。' +
            (s.proposal ? '\n反映していない今の案は、この案に置き換わります。' : '') + '\n作り直しますか？';
          if (!confirm(msgText)) return;
          saveFirst().then(function (okSaved) {
            if (!okSaved) return;
            call('remakeProposal', { caseId: c.id, step: step }, '受け付けています…', 'case-msg')
              .then(function (r) { after(r, '受け付けました。作り直した案を作っています（1〜2分。裏で進みます）。できると、この画面の上に今の内容との違いが出ます'); });
          });
        } }) : null,
        el('button', { class: 'small', text: s.content ? 'デスクにレビューを頼む' : 'デスクに頼む', onclick: function () {
          saveFirst().then(function (okSaved) {
            if (!okSaved) return;
            var p = s.content ? { mode: 'revise', instruction: 'レビューして、採用した指摘で直す' } : { mode: 'make', instruction: '' };
            call('requestDesk', { caseId: c.id, step: step, mode: p.mode, instruction: p.instruction, materialIds: [] }, '依頼を置いています…', 'case-msg')
              .then(function (r) { after(r, 'デスクへの依頼を置きました。家のPCの Claude Code で「依頼を片づけて」と頼んでください'); });
          });
        } }),
        s.content ? el('button', { class: 'small', text: '保存', title: '手で直した内容を保存', onclick: function () {
          call('edit', editBody(step), '保存しています…', 'case-msg').then(function (r) { after(r, '保存しました'); });
        } }) : null,
        s.content ? el('button', { class: 'small primary', text: okLabel, onclick: function () {
          if (s.proposal && s.proposal.status === 'ready' && !confirm((s.proposal.remake ? '作り直した案' : '材料を反映した案') + 'が、まだ反映も取り消しもされていません。案を反映しないまま OK にしますか？')) return;
          if (s.review === 'needed' && !confirm('この段は「デスクのレビュー前」です。お客様に出す前にデスクのレビューを受けてください。このまま OK にしますか？')) return;
          var body = editBody(step);
          call('ok', body, 'OK にして md に書き出しています…', 'case-msg').then(function (r) {
            if (!r) return;
            var next = { s3: 's4', s4: 's5' }[step];
            if (next) state.tab = next;
            after(r, 'OK にして md に書き出しました');
          });
        } }) : null,
      ].filter(Boolean)),
    ]);
    return [bar];
  }

  // =========================
  //  誤変換の確かめ・文を見る窓
  // =========================
  var dlgSave = null;
  function openDialog(title, note, text, onSave) {
    $('dlg-title').textContent = title;
    $('dlg-note').textContent = note || '';
    $('dlg-text').value = text || '';
    dlgSave = onSave;
    $('dlg-ok').hidden = !onSave;
    $('dlg').showModal();
  }
  $('dlg-cancel').addEventListener('click', function () { $('dlg').close(); });
  $('dlg-ok').addEventListener('click', function () {
    if (!dlgSave) return;
    Promise.resolve(dlgSave($('dlg-text').value)).then(function (done) { if (done !== false) $('dlg').close(); });
  });

  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('button.proof');
    if (!b) return;
    e.preventDefault();
    var target = $(b.dataset.target);
    if (!target || !target.value.trim()) { alert('確かめる文がありません'); return; }
    call('proofread', { text: target.value }, '誤変換を確かめています…', null).then(function (r) {
      if (!r) return;
      var note = r.changes.length ? '直した箇所：' + r.changes.map(function (x) { return x.from + '→' + x.to; }).join('、') : '誤変換は見つかりませんでした';
      openDialog('誤変換を確かめた文', note + '（「反映する」で元の欄に入れます）', r.text, function (text) {
        target.value = text;
        target.dispatchEvent(new Event('input'));
        return true;
      });
      $('dlg-ok').textContent = '反映する';
    });
  });
  $('dlg').addEventListener('close', function () { $('dlg-ok').textContent = '保存する'; });

  // =========================
  //  起動
  // =========================
  if ('serviceWorker' in navigator && !IS_LOCAL) navigator.serviceWorker.register('sw.js').catch(function () {});
  start();
})();
