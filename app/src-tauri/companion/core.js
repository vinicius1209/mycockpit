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
  //   #/launch[/<projectId>]      → lançar tarefa (C2; projeto pré-escolhido)
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
    if (parts[0] === "launch") {
      var l = { screen: "launch" };
      if (parts[1]) l.projectId = parts[1];
      return l;
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
    if (r.screen === "launch") {
      return "#/launch" + (r.projectId ? "/" + encodeURIComponent(r.projectId) : "");
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

  // ---------------- parar turno (C2, semântica honesta) ----------------
  // Espelha o Stop do app: turno FINALIZANDO não é interrompível (o runId já
  // foi embora; o CLI está fechando) — o botão não finge que para. Item torto
  // ou desconhecido é fail-open: deixa parar (o executor no Mac é a verdade
  // final e devolve o veredito pelo action-result).

  function stopDisposition(item) {
    if (item && item.finalizing) {
      return {
        can: false,
        label: "Finalizando…",
        reason: "Turno finalizando, não dá mais para interromper.",
      };
    }
    return { can: true, label: "Parar", reason: null };
  }

  // ---------------- id de ação (C2, idempotência) ----------------
  // Um id POR GESTO: o retry da MESMA batida reusa o id (o servidor dedupe e
  // duas batidas nunca viram duas tarefas). `rand` injetado (puro/testável);
  // sem rand, Math.random. 32 hex.

  function makeActionId(rand) {
    var r = typeof rand === "function" ? rand : Math.random;
    var out = "";
    for (var i = 0; i < 32; i++) {
      var n = Math.floor(r() * 16);
      if (!(n >= 0 && n < 16)) n = 0; // rand torto nunca gera char inválido
      out += n.toString(16);
    }
    return out;
  }

  // ---------------- retry de lançamento (C2, janela honesta) ----------------
  // O dedupe do servidor guarda o actionId por 5 min (ACTION_DEDUPE_TTL no
  // companion.rs — gêmeo consciente). "Tentar de novo não duplica" só é
  // VERDADE dentro dessa janela: passado o TTL, o mesmo id volta a valer e um
  // retry viraria SEGUNDA tarefa paga. A decisão é pura: dentro da janela
  // (com margem de segurança sob o TTL do servidor, relógio nunca joga a
  // favor) reusa o id e a copy tranquiliza; fora, o id morre e a copy avisa
  // que relançar pode duplicar — honesto, não cômodo.

  var ACTION_REUSE_TTL_MS = 4 * 60 * 1000; // margem sob os 5 min do servidor

  function launchRetryDisposition(nowMs, sentAtMs) {
    if (typeof sentAtMs !== "number" || !isFinite(sentAtMs) || sentAtMs <= 0) {
      return { reuse: false, warn: null }; // sem gesto anterior: id novo, sem aviso
    }
    if (nowMs - sentAtMs <= ACTION_REUSE_TTL_MS) {
      return { reuse: true, warn: null };
    }
    return {
      reuse: false,
      warn: "A proteção contra duplicar expirou. Confira no briefing se a tarefa apareceu; lançar de novo pode duplicar. Toque em Lançar para confirmar.",
    };
  }

  // ---------------- resposta de pergunta com opções (C2) ----------------
  // Monta o payload do answer_interaction a partir das perguntas estruturadas
  // (choices do snapshot) + o que o usuário marcou/digitou. Regras:
  //   - selected = labels marcados + texto livre (se houver), nessa ordem —
  //     mesmo shape do desktop (QuestionAnswer.answers[].selected).
  //   - single-select: no máx. 1 label marcado (o excedente é descartado).
  //   - pergunta sem NADA (nem opção nem texto) ⇒ resposta incompleta: null
  //     (a UI desabilita o enviar — nunca viaja resposta vazia muda).

  function buildQuestionAnswer(choices, picks) {
    if (!Array.isArray(choices) || !choices.length) return null;
    var answers = [];
    for (var i = 0; i < choices.length; i++) {
      var q = choices[i] || {};
      var p = (picks && picks[i]) || {};
      var sel = Array.isArray(p.selected) ? p.selected.filter(function (s) {
        return typeof s === "string" && s !== "";
      }) : [];
      if (!q.multiSelect && sel.length > 1) sel = sel.slice(0, 1);
      var free = typeof p.other === "string" ? p.other.trim() : "";
      if (free) sel = sel.concat([free]);
      if (!sel.length) return null; // incompleta: não viaja resposta muda
      answers.push({
        header: typeof q.header === "string" ? q.header : "",
        selected: sel,
      });
    }
    return { answers: answers };
  }

  return {
    parseRoute: parseRoute,
    routeHash: routeHash,
    backoffDelay: backoffDelay,
    connReduce: connReduce,
    connLabel: connLabel,
    offlineBanner: offlineBanner,
    seenAgo: seenAgo,
    stopDisposition: stopDisposition,
    makeActionId: makeActionId,
    buildQuestionAnswer: buildQuestionAnswer,
    ACTION_REUSE_TTL_MS: ACTION_REUSE_TTL_MS,
    launchRetryDisposition: launchRetryDisposition,
  };
});
