// dx-youken-app の service worker。
// 画面のファイル（HTML・JS・CSS・アイコン）だけを置いておき、電波が弱くてもアプリが開くようにする。
// 案件のデータ（GAS とのやり取り）は別のサイトあてなので、ここでは扱わない・保存しない。
// 画面を更新したら VERSION を上げる。消す置き場は dxy- で始まるものだけ（同じサイトにほかのアプリの置き場があるため）。
const VERSION = 'dxy-v28';
const SHELL = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './config.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  // ブラウザの保存（GitHub Pages は10分）を通さず、サイトから取り直して置く（2026-11-05：公開直後に古い画面が出たため）
  event.waitUntil(caches.open(VERSION).then((cache) => cache.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' })))));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith('dxy-') && k !== VERSION).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

// 同じサイトの GET だけ。新しい画面を優先し、つながらないときだけ置いておいた画面を出す
// 毎回サイトに「変わったか」を問い合わせる（no-cache）。変わっていなければ短い返事（304）で済む。
// 問い合わせないと、GitHub Pages の10分の保存期間のあいだ古い画面が出る（2026-11-05 公開直後に起きた）
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  event.respondWith(
    fetch(req, { cache: 'no-cache' })
      .then((res) => {
        const copy = res.clone();
        caches.open(VERSION).then((cache) => cache.put(req, copy));
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: true }))
  );
});
