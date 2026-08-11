"use strict";
/* ============================================================
   FROTA · Companion — service worker mínimo (C1).

   Regra de ouro: SÓ o shell entra no cache (página, core, manifest,
   ícones). /api NUNCA é cacheado — snapshot e conversa são sempre
   vivos; dado velho é responsabilidade da PÁGINA, carimbado com
   "visto há…" no banner de offline, nunca de um cache escondido
   fingindo frescor.

   Estratégia do shell: rede primeiro (atualiza o cache de carona),
   cache como fallback — abrir o app com o Mac fora do ar mostra o
   shell + banner honesto, nunca tela branca.
   ============================================================ */

var CACHE = "frota-companion-shell-v1";
var SHELL = [
  "/",
  "/core.js",
  "/manifest.webmanifest",
  "/icon-192.png",
  "/icon-512.png",
  "/apple-touch-icon.png",
];

self.addEventListener("install", function (e) {
  e.waitUntil(
    caches.open(CACHE)
      .then(function (c) { return c.addAll(SHELL); })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener("activate", function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== CACHE; })
        .map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener("fetch", function (e) {
  var url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== self.location.origin) return;
  // dados NUNCA cacheados: /api vai direto à rede; offline falha de verdade e
  // a página mostra o estado honesto (banner + retry automático).
  if (url.pathname === "/api" || url.pathname.indexOf("/api/") === 0) return;
  e.respondWith(
    fetch(e.request).then(function (res) {
      if (res && res.ok) {
        var copy = res.clone();
        caches.open(CACHE).then(function (c) { c.put(e.request, copy); });
      }
      return res;
    }).catch(function () {
      return caches.match(e.request, { ignoreSearch: true }).then(function (hit) {
        if (hit) return hit;
        if (e.request.mode === "navigate") return caches.match("/");
        return Promise.reject(new Error("offline sem cache"));
      });
    })
  );
});
