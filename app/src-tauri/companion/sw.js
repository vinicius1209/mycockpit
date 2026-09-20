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

var CACHE = "frota-companion-shell-v8"; /* 19/09: aviso com a tela fechada (A6) */
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
  // ALLOWLIST, não denylist: só o shell listado passa pelo cache. Qualquer
  // rota nova (inclusive dado servido fora de /api num C2/C3 futuro) vai
  // direto à rede — dado nunca vira snapshot velho silencioso; offline falha
  // de verdade e a página mostra o estado honesto (banner + retry).
  if (SHELL.indexOf(url.pathname) < 0) return;
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

/* ============================================================
   A6 · aviso com a tela fechada.

   O Mac cifra o aviso ponta a ponta (RFC 8291) e o serviço de push do
   navegador só transporta bytes. Aqui ele chega decifrado pelo próprio
   navegador, e a única coisa que o worker faz é mostrar e, no toque, levar à
   tela certa.

   Push sem corpo legível não vira notificação inventada: mostra o aviso
   genérico, porque prometer o que não se sabe é pior do que dizer pouco.
   ============================================================ */

self.addEventListener("push", function (e) {
  var aviso = { titulo: "FROTA", corpo: "Algo pede você.", url: "/", tag: "frota" };
  try {
    var lido = e.data ? e.data.json() : null;
    if (lido && typeof lido === "object") {
      aviso.titulo = String(lido.titulo || aviso.titulo);
      aviso.corpo = String(lido.corpo || aviso.corpo);
      aviso.url = String(lido.url || aviso.url);
      aviso.tag = String(lido.tag || aviso.tag);
    }
  } catch (err) { /* corpo ilegível: segue o genérico */ }
  e.waitUntil(
    self.registration.showNotification(aviso.titulo, {
      body: aviso.corpo,
      tag: aviso.tag,
      renotify: true,
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      data: { url: aviso.url },
    })
  );
});

/* Tocar leva à conversa: reusa a aba aberta quando existe (navegar nela é mais
   rápido e não multiplica sessões), senão abre uma. */
self.addEventListener("notificationclick", function (e) {
  e.notification.close();
  var destino = (e.notification.data && e.notification.data.url) || "/";
  e.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(function (janelas) {
      for (var i = 0; i < janelas.length; i++) {
        var j = janelas[i];
        if (new URL(j.url).origin === self.location.origin) {
          return j.navigate(destino).then(function (c) { return c && c.focus() })
        }
      }
      return self.clients.openWindow(destino);
    })
  );
});
