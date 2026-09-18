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
    // R4 (companion-chat-prd): o painel de números saiu da tela inicial.
    if (parts[0] === "painel") return { screen: "painel" };
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
    if (r.screen === "painel") return "#/painel";
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

  // ---------------- markdown seguro (C3, subset próprio) ----------------
  // Decisão registrada no plano: o app usa react-markdown+rehype, mas o
  // cliente é vanilla offline-first com CSP 'self' — embutir o renderer do
  // app custaria um bundle inteiro no binário. Este subset cobre o que os
  // fios REAIS desta máquina usam (levantado do SQLite: negrito 372×, fences
  // 45×, tabelas 36×, listas 199×, headers 113×, links 16×, quotes 16×).
  // Regra de ouro: TODO texto escapa antes de virar HTML (conteúdo de LLM é
  // hostil); só links http(s) viram <a>; javascript:/data: ficam texto puro.

  function mdEsc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function mdInline(raw) {
    var codes = [];
    // \u0000 e o sentinela dos spans de codigo: some da ENTRADA antes (texto
    // hostil com NUL nunca injeta placeholder falso).
    var s = String(raw == null ? "" : raw).replace(/\u0000/g, "");
    // `code` sai ANTES do resto (negrito/link nunca mexem dentro de codigo)
    s = s.replace(/`([^`\n]+)`/g, function (_, c) {
      codes.push(c);
      return "\u0000" + (codes.length - 1) + "\u0000";
    });
    var h = mdEsc(s);
    h = h.replace(/\[([^\]\n]+)\]\((https?:[^\s()<>"']+)\)/g, function (_, t, u) {
      return '<a href="' + u + '" rel="noopener noreferrer" target="_blank">' + t + "</a>";
    });
    h = h.replace(/\*\*([^*\n]+?)\*\*/g, "<strong>$1</strong>");
    h = h.replace(/(^|[\s(])\*([^*\s][^*\n]*?)\*(?=$|[\s).,;:!?])/g, "$1<em>$2</em>");
    return h.replace(/\u0000(\d+)\u0000/g, function (_, i) {
      return "<code>" + mdEsc(codes[Number(i)]) + "</code>";
    });
  }

  function mdRow(ln) {
    return ln.replace(/^\s*\|/, "").replace(/\|\s*$/, "").split("|").map(function (c) {
      return c.trim();
    });
  }

  function renderMarkdown(text) {
    var lines = String(text == null ? "" : text).replace(/\r\n/g, "\n").split("\n");
    var out = [];
    var i = 0;
    while (i < lines.length) {
      var ln = lines[i];
      var fence = ln.match(/^```(\S*)\s*$/);
      if (fence) {
        // bloco de código: <pre> legível no celular (scroll horizontal, nunca
        // quebra no meio do token); fence sem fechamento rende até o fim.
        var buf = [];
        i++;
        while (i < lines.length && !/^```\s*$/.test(lines[i])) { buf.push(lines[i]); i++; }
        i++;
        out.push('<pre class="mdcode"><code>' + mdEsc(buf.join("\n")) + "</code></pre>");
        continue;
      }
      var hm = ln.match(/^(#{1,4})\s+(.*)$/);
      if (hm) {
        out.push('<div class="mdh mdh' + hm[1].length + '">' + mdInline(hm[2]) + "</div>");
        i++;
        continue;
      }
      if (/^>\s?/.test(ln)) {
        var qb = [];
        while (i < lines.length && /^>\s?/.test(lines[i])) {
          qb.push(lines[i].replace(/^>\s?/, ""));
          i++;
        }
        out.push('<blockquote class="mdq">' + qb.map(mdInline).join("<br>") + "</blockquote>");
        continue;
      }
      if (/^\s*\|.*\|\s*$/.test(ln) && i + 1 < lines.length && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1])) {
        var head = mdRow(ln);
        i += 2;
        var rows = [];
        while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) { rows.push(mdRow(lines[i])); i++; }
        out.push('<div class="mdtablewrap"><table class="mdtable"><thead><tr>' +
          head.map(function (c) { return "<th>" + mdInline(c) + "</th>"; }).join("") +
          "</tr></thead><tbody>" +
          rows.map(function (r) {
            return "<tr>" + r.map(function (c) { return "<td>" + mdInline(c) + "</td>"; }).join("") + "</tr>";
          }).join("") + "</tbody></table></div>");
        continue;
      }
      if (/^\s*[-*]\s+/.test(ln)) {
        var ul = [];
        // sub-itens indentados entram achatados na mesma lista (limitação
        // aceita: aninhamento real fica pro desktop)
        while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
          ul.push("<li>" + mdInline(lines[i].replace(/^\s*[-*]\s+/, "")) + "</li>");
          i++;
        }
        out.push('<ul class="mdl">' + ul.join("") + "</ul>");
        continue;
      }
      var om = ln.match(/^\s*(\d+)[.)]\s+/);
      if (om) {
        var ol = [];
        var startN = Number(om[1]) || 1;
        while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) {
          ol.push("<li>" + mdInline(lines[i].replace(/^\s*\d+[.)]\s+/, "")) + "</li>");
          i++;
        }
        out.push('<ol class="mdl"' + (startN !== 1 ? ' start="' + startN + '"' : "") + ">" + ol.join("") + "</ol>");
        continue;
      }
      if (/^\s*(---+|\*\*\*+)\s*$/.test(ln)) {
        out.push('<hr class="mdhr">');
        i++;
        continue;
      }
      if (ln.trim() === "") { i++; continue; }
      // parágrafo: PROGRESSO POR CONSTRUÇÃO — a linha corrente é consumida
      // SEMPRE, mesmo quando "parece bloco" mas o handler acima a rejeitou
      // (tabela sem linha separadora, fence inválida): vira texto. Sem isso o
      // while externo girava pra sempre (revisão C3). As linhas SEGUINTES só
      // entram no mesmo parágrafo enquanto forem simples.
      var pb = [mdInline(ln)];
      i++;
      while (i < lines.length && lines[i].trim() !== "" &&
             !/^(```|#{1,4}\s|>\s?|\s*[-*]\s+|\s*\d+[.)]\s+|\s*\|.*\|\s*$)/.test(lines[i])) {
        pb.push(mdInline(lines[i]));
        i++;
      }
      out.push('<p class="mdp">' + pb.join("<br>") + "</p>");
    }
    return out.join("");
  }

  // ---------------- tempo de trabalho (C3, "trabalhando há…") ----------------
  // Carimbo honesto do turno vivo: startedAt inválido → "" (nunca inventa).

  function elapsedLabel(nowMs, atMs) {
    if (typeof atMs !== "number" || !isFinite(atMs) || atMs <= 0) return "";
    var s = Math.max(0, (nowMs - atMs) / 1000);
    if (s < 60) return "há " + Math.floor(s) + " s";
    if (s < 3600) return "há " + Math.round(s / 60) + " min";
    return "há " + Math.round(s / 3600) + " h";
  }

  // ---------------- emenda da janela do fio (C3) ----------------
  // O servidor manda janelas ({items, start} sobre o fio completo); o cliente
  // guarda UMA faixa contígua. Regras:
  //   tail (refetch da cauda): a cauda FRESCA substitui a sobreposição — itens
  //   de tool MUTAM quando o result chega, dedupe por id manteria o velho.
  //   Buraco entre o que temos e a cauda (fio cresceu muito) descarta o velho:
  //   faixa com lacuna mentiria a cronologia.
  //   older (carregar anteriores): só emenda se a página termina EXATAMENTE
  //   onde a faixa atual começa; página rasgada é ignorada (retry re-pede).

  function mergeThreadTail(cur, tail) {
    if (!tail || !Array.isArray(tail.items) || typeof tail.start !== "number" || tail.start < 0) {
      return cur || null;
    }
    if (!cur || !Array.isArray(cur.items) || typeof cur.start !== "number" || tail.start <= cur.start) {
      return { items: tail.items, start: tail.start };
    }
    if (tail.start > cur.start + cur.items.length) {
      return { items: tail.items, start: tail.start };
    }
    return { items: cur.items.slice(0, tail.start - cur.start).concat(tail.items), start: cur.start };
  }

  function mergeThreadOlder(cur, older) {
    if (!cur || !Array.isArray(cur.items) || typeof cur.start !== "number") return cur || null;
    if (!older || !Array.isArray(older.items) || typeof older.start !== "number") return cur;
    if (older.start + older.items.length !== cur.start) return cur;
    return { items: older.items.concat(cur.items), start: older.start };
  }

  // ---------------- adoção de conversa pelo veredito (C3) ----------------
  // O ok atrasado do send_message só pode ADOTAR o convId no chat aberto se o
  // veredito casa projeto E agent (revisão C3): envio na mesa do codex + mesa
  // do claude aberta no MESMO projeto antes do veredito não pode envenenar o
  // fallback de mesa do claude com a conversa do codex. Chat já resolvido ou
  // veredito de fracasso nunca adotam.

  function adoptConvOnVerdict(chat, verdict) {
    if (!chat || chat.convId || !verdict || !verdict.ok) return false;
    if (typeof verdict.convId !== "string" || !verdict.convId) return false;
    return verdict.projectId === chat.projectId && verdict.agent === chat.agent;
  }

  // ---------------- blob do fio (C3, path validado no cliente também) --------
  // Espelho consciente do blob_path_parts do companion.rs (defesa nas duas
  // pontas): só attachments/ e evidence/, pasta hex/uuid, arquivo no alfabeto
  // seguro, e SÓ imagem vira <img> (pdf continua chip com nome).

  function blobUrlPath(path) {
    if (typeof path !== "string") return null;
    var m = path.match(/^(attachments|evidence)\/([0-9a-fA-F-]+)\/([A-Za-z0-9._-]+)$/);
    if (!m || m[3].indexOf("..") >= 0) return null;
    var ext = m[3].toLowerCase().split(".").pop();
    if (["png", "jpg", "jpeg", "webp", "gif"].indexOf(ext) < 0) return null;
    return "/api/blob/" + m[1] + "/" + m[2] + "/" + m[3];
  }

  // ---------------- pareamento v2 (C4) ----------------
  // O QR carrega um token de PAREAMENTO de uso único (#pair=…), nunca mais a
  // credencial definitiva (#token= v1 morreu — guarda anti-downgrade: página
  // v2 NUNCA instala credencial vinda de fragment). O token definitivo só
  // chega pelo poll de /pair/status DEPOIS do aceite humano no Mac.

  function pairTokenFromHash(hash) {
    var m = String(hash == null ? "" : hash).match(/[#&]pair=([0-9a-fA-F]{16,})/);
    return m ? m[1] : null;
  }

  // Nome honesto do aparelho pro aceite no desktop ("iPhone · Safari"): sai do
  // user-agent REAL, resumido — nunca inventado. UA irreconhecível → rótulo
  // neutro (o desktop ainda sanitiza do lado dele).
  function deviceLabel(ua) {
    var s = String(ua == null ? "" : ua);
    var dev = /iPhone/.test(s) ? "iPhone"
      : /iPad/.test(s) ? "iPad"
      : /Android/.test(s) ? "Android"
      : /Macintosh|Mac OS X/.test(s) ? "Mac"
      : /Windows/.test(s) ? "Windows"
      : /Linux/.test(s) ? "Linux"
      : "";
    // ordem importa: todo Chrome tem "Safari" no UA e todo Edge tem "Chrome"
    var br = /EdgiOS|Edg\//.test(s) ? "Edge"
      : /CriOS|Chrome\//.test(s) ? "Chrome"
      : /FxiOS|Firefox\//.test(s) ? "Firefox"
      : /Safari\//.test(s) ? "Safari"
      : "";
    if (!dev && !br) return "Aparelho";
    if (!dev) return br;
    return br ? dev + " · " + br : dev;
  }

  // ---------------- tema (C4, dark/light honesto com o sistema) ----------------
  // Sem escolha guardada, o tema segue o sistema (prefers-color-scheme);
  // escolha explícita ("light"/"dark") vence e persiste. Valor estranho no
  // storage nunca crasha: cai no sistema.

  function effectiveTheme(stored, systemDark) {
    if (stored === "light" || stored === "dark") return stored;
    return systemDark ? "dark" : "light";
  }

  // ---------------- teto do snapshot cacheado (C4, nit C1) ----------------
  // O snapshot restaurado do localStorage já nasce carimbado ("visto há…"),
  // mas dado de mais de 7 dias não ajuda ninguém: não restaura (a página
  // mostra o estado de conexão em vez de um briefing arqueológico).

  var SNAP_MAX_AGE_MS = 7 * 24 * 3600 * 1000;

  function snapshotRestorable(nowMs, atMs) {
    if (typeof atMs !== "number" || !isFinite(atMs) || atMs <= 0) return false;
    return nowMs - atMs <= SNAP_MAX_AGE_MS;
  }

  // ---------------- aviso sem Notification (C4, degradação honesta) ----------
  // Em http de LAN o browser nega Notification (contexto inseguro); o canal
  // honesto é vibração + título da aba piscando. Puro: só o texto do título.

  function titleBadge(base, n) {
    var b = String(base == null ? "" : base);
    var k = typeof n === "number" && isFinite(n) && n > 0 ? Math.floor(n) : 0;
    return k > 0 ? "(" + k + ") " + b : b;
  }

  // ---------------- R4 · tela inicial chat-first ----------------
  // As conversas de todos os projetos (snapshot `projects[].recent`, R3) numa
  // lista só: quem pede você primeiro, depois quem roda, depois a mais recente.
  // Conversa que nunca rodou (agent null) abre com o primeiro motor utilizável
  // do projeto; sem nenhum, a linha vem sem motor e a página não a abre.

  function motorDe(a) {
    return a == null ? null : typeof a === "string" ? a : a.agent || null;
  }

  function homeConversations(snap, projectId) {
    var ps = (snap && Array.isArray(snap.projects)) ? snap.projects : [];
    var out = [];
    for (var i = 0; i < ps.length; i++) {
      var p = ps[i];
      if (!p || (projectId && p.id !== projectId)) continue;
      var primeiro = Array.isArray(p.agents) && p.agents.length ? motorDe(p.agents[0]) : null;
      var rs = Array.isArray(p.recent) ? p.recent : [];
      for (var j = 0; j < rs.length; j++) {
        var c = rs[j];
        if (!c || !c.convId) continue;
        out.push({
          convId: c.convId,
          projectId: p.id,
          projectName: p.name,
          agent: c.agent || primeiro,
          title: c.title || "Conversa",
          updatedAt: typeof c.updatedAt === "number" ? c.updatedAt : 0,
          running: !!c.running,
          pedeVoce: !!c.pedeVoce,
        });
      }
    }
    out.sort(function (a, b) {
      return (Number(b.pedeVoce) - Number(a.pedeVoce)) ||
        (Number(b.running) - Number(a.running)) ||
        (b.updatedAt - a.updatedAt);
    });
    return out;
  }

  // Atalhos do campo de mensagem: "/parar" para o turno da conversa aberta;
  // "/btw <texto>" manda o texto marcado como prioridade (é mensagem comum, não
  // ação nova no servidor). Qualquer outra coisa segue como mensagem.
  function parseChatShortcut(text) {
    var t = String(text == null ? "" : text).trim();
    if (/^\/parar$/i.test(t)) return { kind: "stop" };
    var m = /^\/btw\s+([\s\S]+)$/i.exec(t);
    if (m) return { kind: "message", text: "Prioridade (enviado do celular): " + m[1].trim() };
    return { kind: "message", text: t };
  }

  // ---------------- R5 · dois Macs ----------------
  // Cada Mac serve a sua página com o próprio nome no <meta name="frota-maquina">.
  // Sem nome (mock, servidor antigo), a página segue como "Companion".
  function machineName(raw) {
    var t = String(raw == null ? "" : raw).replace(/\s+/g, " ").trim();
    return t || null;
  }
  // Título da notificação: com dois Macs, diz de qual máquina ela veio.
  function notificationTitle(machine, text) {
    var m = machineName(machine);
    return (m || "FROTA") + " · " + String(text == null ? "" : text);
  }

  // ---------------- soltar arquivo na página (A7, 18/09/2026) ----------------
  // O Companion também é aberto no navegador do Mac, e lá arrastar é o gesto
  // natural. A página aceita o mesmo que o botão de anexo aceita (imagem e PDF,
  // até 10 MB), então a triagem é uma regra só, aqui, e não duas no HTML.
  var ANEXO_MAX_BYTES = 10 * 1024 * 1024;
  function triagemDeArquivos(lista) {
    var arquivos = Array.prototype.slice.call(lista || []);
    var aceitos = [];
    var recusados = [];
    for (var i = 0; i < arquivos.length; i++) {
      var f = arquivos[i];
      var tipo = String((f && f.type) || "");
      var nome = String((f && f.name) || "arquivo");
      if (tipo.indexOf("image/") !== 0 && tipo !== "application/pdf") {
        recusados.push({ nome: nome, motivo: "só imagem e PDF" });
      } else if ((f && f.size) > ANEXO_MAX_BYTES) {
        recusados.push({ nome: nome, motivo: "acima de 10MB" });
      } else {
        aceitos.push(f);
      }
    }
    return { aceitos: aceitos, recusados: recusados };
  }
  // "Solte para anexar · 2 itens". Zero item não vira rótulo: sem rótulo, sem
  // alvo aceso na tela.
  function rotuloDaSoltura(quantos) {
    var n = Number(quantos) || 0;
    if (n <= 0) return null;
    return "Solte para anexar · " + n + (n === 1 ? " item" : " itens");
  }
  // O que dizer de quem ficou de fora, sem transformar recusa em silêncio.
  function avisoDeRecusa(recusados) {
    var lista = recusados || [];
    if (!lista.length) return null;
    return lista
      .map(function (r) { return r.nome + " (" + r.motivo + ")"; })
      .join(", ");
  }

  return {
    machineName: machineName,
    notificationTitle: notificationTitle,
    homeConversations: homeConversations,
    parseChatShortcut: parseChatShortcut,
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
    renderMarkdown: renderMarkdown,
    elapsedLabel: elapsedLabel,
    mergeThreadTail: mergeThreadTail,
    mergeThreadOlder: mergeThreadOlder,
    adoptConvOnVerdict: adoptConvOnVerdict,
    blobUrlPath: blobUrlPath,
    pairTokenFromHash: pairTokenFromHash,
    deviceLabel: deviceLabel,
    effectiveTheme: effectiveTheme,
    SNAP_MAX_AGE_MS: SNAP_MAX_AGE_MS,
    snapshotRestorable: snapshotRestorable,
    titleBadge: titleBadge,
    ANEXO_MAX_BYTES: ANEXO_MAX_BYTES,
    triagemDeArquivos: triagemDeArquivos,
    rotuloDaSoltura: rotuloDaSoltura,
    avisoDeRecusa: avisoDeRecusa,
  };
});
