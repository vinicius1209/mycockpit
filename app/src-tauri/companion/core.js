"use strict";
/* ============================================================
   FROTA · Companion — núcleo PURO do cliente web (C1).

   Este é o MESMO arquivo nas duas pontas: servido ao celular pelo
   binário (GET /core.js, include_str! em companion.rs) e importado
   direto pelo vitest (src/lib/companionWeb.test.ts) — nada de
   implementação gêmea pra divergir.

   Formato UMD à mão: no browser vira o global `CompanionCore`
   (script clássico, funciona até de file:// no mock); no teste o
   import por efeito colateral também deixa o global disponível.
   Só funções puras aqui — zero DOM, zero fetch, `now` sempre
   injetado por parâmetro.
   ============================================================ */
(function (root, factory) {
  var api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.CompanionCore = api;
})(typeof self !== "undefined" ? self : globalThis, function () {
  // ---------------- rotas (history API real) ----------------
  // A URL codifica a tela; voltar no browser volta UMA tela e F5 restaura:
  //   #/                          → briefing (home)
  //   #/agents/<projectId>        → escolha de agent do projeto
  //   #/chat/<pid>/<agent>        → chat de mesa (conversa resolvida no app)
  //   #/chat/<pid>/<agent>/<conv> → chat de conversa explícita (não-mesa)
  // Fail-open: hash malformado, desconhecido ou de token (#token=…) cai no
  // briefing — rota estranha nunca crasha nem tranca o usuário.

  function parseRoute(hash) {
    var h = typeof hash === "string" ? hash : "";
    if (h.charAt(0) === "#") h = h.slice(1);
    if (h.charAt(0) !== "/") return { screen: "brief" };
    var parts = [];
    var raw = h.slice(1).split("/");
    for (var i = 0; i < raw.length; i++) {
      if (raw[i] === "") continue;
      var seg = raw[i];
      try { seg = decodeURIComponent(seg); } catch (e) { /* %-lixo: usa cru */ }
      parts.push(seg);
    }
    if (!parts.length) return { screen: "brief" };
    if (parts[0] === "agents" && parts[1]) {
      return { screen: "agents", projectId: parts[1] };
    }
    if (parts[0] === "chat" && parts[1] && parts[2]) {
      var r = { screen: "chat", projectId: parts[1], agent: parts[2] };
      if (parts[3]) r.convId = parts[3];
      return r;
    }
    return { screen: "brief" };
  }

  function routeHash(route) {
    var r = route || {};
    if (r.screen === "agents" && r.projectId) {
      return "#/agents/" + encodeURIComponent(r.projectId);
    }
    if (r.screen === "chat" && r.projectId && r.agent) {
      return "#/chat/" + encodeURIComponent(r.projectId) + "/" + encodeURIComponent(r.agent)
        + (r.convId ? "/" + encodeURIComponent(r.convId) : "");
    }
    return "#/";
  }

  // ---------------- reconexão (máquina de estados) ----------------
  // connecting (primeira tentativa) → on → reconnecting (caiu; attempt cresce
  // e retryInMs segue backoff exponencial com teto). Evento desconhecido não
  // muda nada (fail-open). Quem agenda o timer é a página; aqui só a verdade.

  function backoffDelay(attempt) {
    var n = typeof attempt === "number" && attempt > 0 ? attempt : 0;
    return Math.min(15000, 1000 * Math.pow(2, n));
  }

  var CONN_INITIAL = { status: "connecting", attempt: 0, retryInMs: null };

  function connReduce(state, event) {
    var s = state || CONN_INITIAL;
    if (event === "open") return { status: "on", attempt: 0, retryInMs: null };
    if (event === "down") {
      var attempt = (s.attempt || 0) + 1;
      return { status: "reconnecting", attempt: attempt, retryInMs: backoffDelay(attempt - 1) };
    }
    if (event === "connect") {
      return {
        status: (s.attempt || 0) > 0 ? "reconnecting" : "connecting",
        attempt: s.attempt || 0,
        retryInMs: null,
      };
    }
    return s;
  }

  function connLabel(state) {
    if (!state) return "conectando…";
    if (state.status === "on") return "conectado";
    if (state.status === "connecting") return "conectando…";
    return "reconectando…";
  }

  // ---------------- banner de offline (decisão pura) ----------------
  // Honestidade em DUAS pontas: dado VELHO restaurado do cache (snapStale) é
  // carimbado JÁ no boot, sem esperar a primeira queda de rede — Mac desligado
  // sem RST não ganha dezenas de segundos de "custos de ontem" fingindo vivos.
  // E "nunca tive dado" com rede boa não flasha banner mentiroso: sem stale e
  // sem queda real (reconnecting), nada aparece durante o handshake.

  function offlineBanner(s) {
    if (!s || s.mock || !s.token || s.screen === "pair") return false;
    if (s.conn === "on") return false;
    return s.connStatus === "reconnecting" || !!s.snapStale;
  }

  // ---------------- "visto há" (carimbo honesto) ----------------
  // Dado velho nunca finge vivo: quando o Mac está fora do ar, a página mostra
  // o último snapshot CARIMBADO com a idade real. Sem timestamp → "" (nunca
  // inventa idade).

  function seenAgo(nowMs, atMs) {
    if (typeof atMs !== "number" || !isFinite(atMs) || atMs <= 0) return "";
    var s = Math.max(0, (nowMs - atMs) / 1000);
    if (s < 60) return "visto agora";
    if (s < 3600) return "visto há " + Math.round(s / 60) + " min";
    if (s < 86400) return "visto há " + Math.round(s / 3600) + " h";
    return "visto há " + Math.round(s / 86400) + " d";
  }

  return {
    parseRoute: parseRoute,
    routeHash: routeHash,
    backoffDelay: backoffDelay,
    connReduce: connReduce,
    connLabel: connLabel,
    offlineBanner: offlineBanner,
    seenAgo: seenAgo,
  };
});
