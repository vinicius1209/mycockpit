/**
 * Núcleo puro da guarda de "tokens mortos": padrões que o STYLEGUIDE já
 * decidiu que NÃO voltam. Cada padrão é uma entrada declarativa em
 * `DEAD_TOKEN_RULES`; acrescentar padrão novo é acrescentar um objeto, não
 * escrever código.
 *
 * Forma de uma regra:
 *   id          identificador curto (aparece no erro e nas exceções)
 *   descricao   o que a regra protege, em uma linha
 *   regra       ponteiro pra seção do STYLEGUIDE que manda
 *   extensoes   extensões de arquivo varridas
 *   ignorar     função (relPath) => boolean, arquivos fora do alcance
 *   detectar    função (source, relPath) => Array<{linha, trecho, dica}>
 *   excecoes    mapa relPath -> {max, motivo} (ratchet: não pode crescer)
 */

import { lineAt, splitSpans } from "./spans.mjs";

const TS_EXT = new Set([".ts", ".tsx"]);

const isTest = (relPath) => /\.test\.[cm]?[jt]sx?$/.test(relPath);

/**
 * Varredura literal: acha todas as ocorrências de um regex e devolve
 * linha + trecho.
 *
 * @param {string} source
 * @param {RegExp} pattern regex com flag `g`
 * @param {(match: RegExpExecArray) => string} [dica]
 */
export function matchLiteral(source, pattern, dica) {
  const hits = [];
  const re = new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`);
  let match;
  while ((match = re.exec(source)) !== null) {
    hits.push({
      linha: lineAt(source, match.index),
      trecho: match[0],
      dica: dica ? dica(match) : undefined,
    });
    if (match[0].length === 0) re.lastIndex += 1;
  }
  return hits;
}

/**
 * Verde em QUALQUER propriedade, não só na cor do texto.
 *
 * A regra nasceu olhando só `text-st-success`, e o buraco apareceu na primeira
 * auditoria depois dela: o stepper do `SddView` pintava a etapa concluída com
 * `bg-st-success` — verde ambiente permanente numa lista, exatamente o padrão
 * que o §9 item 4 matou — e passava batido pela guarda. Verde é verde: o §2 não
 * fala de `color`, fala de quando a tinta pode aparecer.
 *
 * Cobre as utilidades de cor do Tailwind, os arbitrários (`bg-st-success/15`,
 * `bg-st-success/[0.10]`) e o `var(--st-success)` cru dentro de TS/TSX (style
 * inline, `color-mix`). CSS não entra: `index.css` é onde o token é DEFINIDO.
 */
// O `(?![\w-])` no fim é o que o `\b` não fazia: hífen é fronteira de palavra,
// então `\b` deixava um hipotético `bg-st-success-foo` casar como se fosse o
// token. Fim de classe do Tailwind é `"`, espaço ou `/` (opacidade).
const VERDE_UTILIDADES =
  /\b(?:text|bg|border|ring|fill|stroke|outline|decoration|divide|accent|caret|shadow|from|via|to)-st-success(?![\w-])|var\(--st-success\)/g;

const TRAVESSAO = "—";

/**
 * Acha travessão em prosa que o usuário LÊ: dentro de literal de string ou
 * solto como texto JSX. Comentário e JSDoc não contam (o travessão ali é do
 * dev, não da UI).
 *
 * Tolerado (§7): "—" sozinho como glifo de valor ausente numa célula, seja
 * como literal inteiro (`value ?? "—"`) seja como texto JSX isolado
 * (`<span>—</span>`).
 *
 * @param {string} source
 * @returns {Array<{linha: number, trecho: string, dica?: string}>}
 */
export function acharTravessaoEmCopy(source) {
  const hits = [];
  let anterior = null;
  for (const span of splitSpans(source)) {
    // Comentário é conversa entre devs; regex não é prosa.
    if (span.kind !== "string" && span.kind !== "code") {
      anterior = span;
      continue;
    }
    if (!span.text.includes(TRAVESSAO)) {
      anterior = span;
      continue;
    }

    if (span.kind === "string") {
      // Literal inteiro é só o glifo de ausência: tolerado.
      if (conteudoLiteral(span.text).trim() === TRAVESSAO) {
        anterior = span;
        continue;
      }
      // Argumento de `console.*` é saída de dev, não copy de UI: o §7 governa
      // o que o USUÁRIO lê. Carve-out estrutural, não exceção por arquivo.
      if (anterior?.kind === "code" && ARGUMENTO_DE_CONSOLE_RE.test(anterior.text)) {
        anterior = span;
        continue;
      }
      // …e o mesmo vale quando o argumento é um TEMPLATE com interpolação: o
      // `${…}` parte o literal em vários spans, e o span do travessão passa a
      // vir depois de um `)` em vez do `console.warn(`. Sem isto o carve-out
      // valia só pra string simples, e a mesma frase de dev passava ou não
      // dependendo de ter uma variável no meio.
      if (linhaDeConsole(source, span.start)) {
        anterior = span;
        continue;
      }
      for (const offset of ocorrencias(span.text)) {
        hits.push({
          linha: lineAt(source, span.start + offset),
          trecho: recorte(span.text, offset),
        });
      }
      anterior = span;
      continue;
    }

    // Corpo do arquivo: aqui travessão só aparece como texto JSX solto.
    for (const offset of ocorrencias(span.text)) {
      if (isGlifoJsxIsolado(span.text, offset)) continue;
      hits.push({
        linha: lineAt(source, span.start + offset),
        trecho: recorte(span.text, offset),
      });
    }
    anterior = span;
  }
  return hits;
}

const ARGUMENTO_DE_CONSOLE_RE = /\bconsole\.\w+\(\s*$/;
const CHAMADA_DE_CONSOLE_RE = /\bconsole\.\w+\(/;

/** A linha física em que o span começa contém uma chamada de `console.*`?
 *  Cobre o template com interpolação (chamada de uma linha só); a chamada
 *  quebrada em várias linhas continua coberta pelo span anterior. */
function linhaDeConsole(source, offset) {
  const ini = source.lastIndexOf("\n", offset) + 1;
  const fim = source.indexOf("\n", offset);
  return CHAMADA_DE_CONSOLE_RE.test(source.slice(ini, fim === -1 ? undefined : fim));
}

function ocorrencias(text) {
  const out = [];
  let from = text.indexOf(TRAVESSAO);
  while (from !== -1) {
    out.push(from);
    from = text.indexOf(TRAVESSAO, from + 1);
  }
  return out;
}

function conteudoLiteral(text) {
  const first = text[0];
  if (first === '"' || first === "'" || first === "`") {
    const last = text[text.length - 1];
    const end = last === first && text.length > 1 ? text.length - 1 : text.length;
    return text.slice(1, end);
  }
  // Pedaço de template entre `}` e `${`/crase.
  return text.replace(/^\}/, "").replace(/(?:`|\$\{)$/, "");
}

/**
 * Num trecho de texto JSX, o travessão vale como glifo de ausência se estiver
 * sozinho entre as fronteiras de marcação mais próximas (`<`, `>`, `{`, `}`).
 */
function isGlifoJsxIsolado(text, offset) {
  const fronteiras = new Set(["<", ">", "{", "}"]);
  let inicio = offset;
  while (inicio > 0 && !fronteiras.has(text[inicio - 1])) inicio -= 1;
  let fim = offset + 1;
  while (fim < text.length && !fronteiras.has(text[fim])) fim += 1;
  return text.slice(inicio, fim).trim() === TRAVESSAO;
}

function recorte(text, offset) {
  const inicio = Math.max(0, offset - 28);
  const fim = Math.min(text.length, offset + 28);
  return `${inicio > 0 ? "…" : ""}${text.slice(inicio, fim).replace(/\s+/g, " ").trim()}${fim < text.length ? "…" : ""}`;
}

/**
 * As regras. Ordem = ordem do relatório.
 * @type {Array<{id: string, descricao: string, regra: string, extensoes: Set<string>, ignorar?: (p: string) => boolean, detectar: (source: string, relPath: string) => Array<{linha: number, trecho: string, dica?: string}>, excecoes?: Record<string, {max: number, motivo: string}>}>}
 */
export const DEAD_TOKEN_RULES = [
  {
    id: "shadow-pesada",
    descricao: "sombra fora das 3 elevações (E0 hairline · E1 --shadow-sm · E2 --shadow-pop)",
    regra: "STYLEGUIDE §4",
    extensoes: TS_EXT,
    detectar: (source) =>
      matchLiteral(source, /\bshadow-(?:md|lg|xl|2xl)\b/g, () => "use `shadow-[var(--shadow-sm)]` (E1) ou `shadow-[var(--shadow-pop)]` (E2)"),
    // Sem exceção: a passada de 12/08/2026 zerou o app, inclusive os
    // primitives shadcn (§9 item 6). Voltar a zero é o estado natural.
    excecoes: {},
  },
  {
    id: "verde-ambiente",
    descricao: "`st-success` em QUALQUER propriedade (texto, fundo, borda, anel…) fora das famílias que o §2 declara (marco de turno/plano, probe real, domínio git)",
    regra: "STYLEGUIDE §2 (linha do Verde) + §9 item 4",
    extensoes: TS_EXT,
    ignorar: isTest,
    detectar: (source) =>
      matchLiteral(source, VERDE_UTILIDADES, () => "verde é marco raro ou probe real; estado ambiente saudável é cinza"),
    // Ratchet por arquivo: o número é o uso REAL, congelado. Não pode crescer.
    // Quem precisar de verde novo abre ADR (§2 diz que exceção não listada não
    // existe) ou, o mais provável, usa cinza.
    //
    // RECONTADO em 15/08/2026, quando a regra passou a olhar TODAS as
    // propriedades e não só `text-`. Os números subiram porque a varredura
    // enxerga mais, não porque entrou verde novo: cada acréscimo está nomeado
    // no motivo. O único verde que a varredura larga achou e que NÃO era
    // declarável foi o `bg-st-success` do stepper do `SddView`, que virou
    // cinza na mesma passada.
    excecoes: {
      // Família "probe real": verde só depois que a checagem rodou de verdade.
      "components/settings/CompanionSettings.tsx": { max: 2, motivo: "probe do companion passou (doutrina 'verde exige probe'): o dot 'servidor no ar' + o check da lista" },
      "components/settings/HooksSettings.tsx": { max: 1, motivo: "probe de hook passou" },
      "components/settings/MachineAgents.tsx": { max: 2, motivo: "probe de agent na máquina passou" },
      // A linha por agent saiu de McpSettings.tsx para McpAgentRows.tsx (a
      // catraca de tamanho); o verde é o MESMO e continua sendo probe real.
      "components/settings/McpAgentRows.tsx": { max: 1, motivo: "probe de servidor MCP passou" },
      "components/settings/UsageMeterSettings.tsx": { max: 1, motivo: "probe do medidor de uso passou" },
      "components/onboarding/NotificationStep.tsx": { max: 1, motivo: "permissão de notificação concedida de verdade" },
      // Família "marco de turno/plano no fio" (ADR-037): máx. 1 por turno.
      "components/chat/MessageList.tsx": { max: 5, motivo: "marcos do fio (turno/plano concluído), ADR-037; +1 pelo `bg-st-success/10` da linha de ADIÇÃO do diff, que é domínio git" },
      "components/chat/ChatPanel.tsx": { max: 1, motivo: "marco de plano concluído" },
      "components/mission/MissionTimeline.tsx": { max: 4, motivo: "marco de fase da missão; +3 pelo nó `border/bg-st-success` da fase concluída e pelo `bg-st-success/15` do selo. TRIAGEM PENDENTE: o nó tem a MESMA forma do stepper do SddView que esta passada despintou, e a defesa dele (é marco no fio, não badge ambiente) merece decisão escrita antes de virar folclore" },
      // o verde do DESFECHO da missão veio inteiro da MissionTimeline quando o
      // resumo virou arquivo próprio: marco de plano concluído (ADR-037), não
      // verde novo.
      "components/mission/DoneSummary.tsx": { max: 3, motivo: "marco de missão concluída; +1 pelo `bg-st-success/[0.05]` do fundo do mesmo marco" },
      "components/mission/FlightPlansView.tsx": { max: 2, motivo: "marco de plano de voo concluído" },
      "components/mission/MissionPlanCanvas.tsx": { max: 1, motivo: "marco de fase concluída no canvas" },
      "components/sdd/SddView.tsx": { max: 8, motivo: "marcos de etapa do SDD (spec/plan/tasks concluídos); +1 pelo `border-st-success/40` do mesmo marco. O `bg-st-success` do stepper NÃO está aqui: virou cinza em 15/08/2026 (§9 item 4)" },
      "components/layout/InboxBell.tsx": { max: 2, motivo: "marco de item do inbox resolvido" },
      // Família "domínio git": `+N` e linha de adição têm cor própria (§2).
      "components/layout/DiffPanel.tsx": { max: 4, motivo: "adições do diff (domínio git tem cor própria); apertado de 6→4 quando a linha do hunk (2 usos) mudou pra DiffPanel/comments.tsx" },
      "components/layout/DiffPanel/comments.tsx": { max: 2, motivo: "mesma família de DiffPanel.tsx: `bg-st-success/[0.10]` (fundo da linha ADD) e `text-st-success` (sinal `+`) da linha do hunk, extraídos de lá pro comentário inline" },
      // Triagem fina deixada de fora da passada de 12/08/2026, de propósito
      // (§9 item 4): aqui o cinza colapsaria uma distinção que a tela precisa.
      "components/chat/TaskChecklist.tsx": { max: 1, motivo: "§9 item 4: triagem de check por linha adiada de propósito" },
      "components/common/Markdown.tsx": { max: 1, motivo: "§9 item 4: triagem de check por linha adiada de propósito" },
      "components/fusion/FusionBoard.tsx": { max: 1, motivo: "§9 item 4: triagem de check por linha adiada de propósito" },
      "components/layout/LearningSection.tsx": { max: 3, motivo: "§9 item 4: badge ativa/arquivada, cinza colapsaria a distinção; +1 pelo fundo do mesmo badge. TRIAGEM PENDENTE: o `hover:text-st-success` do botão Promover não é marco nem probe, é verde de afordância" },
    },
  },
  {
    id: "travessao-em-copy",
    descricao: "travessão '—' em prosa de UI (use vírgula, ponto ou parênteses; '·' e '→' são ok)",
    regra: "STYLEGUIDE §7",
    extensoes: TS_EXT,
    ignorar: isTest,
    detectar: (source) => acharTravessaoEmCopy(source),
    // Escopo deliberado do §9 item 7: a regra vale pra copy que o usuário LÊ.
    // Texto de PROMPT é entrada do agent, não prosa de UI. Em vez de ignorar
    // os arquivos inteiros (o que engoliria copy nova que aparecesse neles), a
    // exceção é por arquivo COM contagem: o número congela onde está.
    excecoes: {
      "lib/mission.ts": { max: 5, motivo: "prompt de fase/gate da missão (entrada do agent)" },
      "lib/handoff.ts": { max: 2, motivo: "bloco de handoff injetado no prompt" },
      "lib/missionHandoff.ts": { max: 2, motivo: "instrução de handoff entre fases, no prompt" },
      "lib/skills.ts": { max: 2, motivo: "prompt de extração de skill" },
      "lib/learning.ts": { max: 1, motivo: "bloco de recall injetado no prompt" },
      "lib/planMode.ts": { max: 1, motivo: "prompt do turno de execução pós-aprovação" },
      "lib/doctrine.ts": { max: 1, motivo: "aviso de truncagem dentro do prompt de doutrina" },
      "lib/transcript.ts": { max: 1, motivo: "cabeçalho do transcript injetado no prompt" },
      "lib/trust.ts": { max: 1, motivo: "cabeçalho anti-injeção do histórico, no prompt" },
    },
  },
];

/**
 * Aplica as regras sobre um conjunto de arquivos já lidos.
 *
 * @param {Array<{relPath: string, source: string}>} arquivos
 * @param {typeof DEAD_TOKEN_RULES} [rules]
 * @returns {{violacoes: Array<object>, excecoesFolgadas: Array<object>}}
 */
export function avaliarTokensMortos(arquivos, rules = DEAD_TOKEN_RULES) {
  const violacoes = [];
  const excecoesFolgadas = [];

  for (const rule of rules) {
    /** @type {Map<string, number>} */
    const usoPorArquivo = new Map();

    for (const { relPath, source } of arquivos) {
      if (!rule.extensoes.has(extensao(relPath))) continue;
      if (rule.ignorar?.(relPath)) continue;

      const hits = rule.detectar(source, relPath);
      if (hits.length === 0) continue;

      const excecao = rule.excecoes?.[relPath];
      usoPorArquivo.set(relPath, hits.length);
      const permitido = excecao?.max ?? 0;
      if (hits.length <= permitido) continue;

      // Só reporta o excedente: os N primeiros estão cobertos pela exceção.
      for (const hit of hits.slice(permitido)) {
        violacoes.push({
          ruleId: rule.id,
          descricao: rule.descricao,
          regra: rule.regra,
          relPath,
          linha: hit.linha,
          trecho: hit.trecho,
          dica: hit.dica,
          permitido,
          encontrado: hits.length,
        });
      }
    }

    // Exceção que sobrou folgada é ratchet a apertar: o número desce, nunca
    // sobe. Não derruba o CI, mas aparece no relatório.
    for (const [relPath, excecao] of Object.entries(rule.excecoes ?? {})) {
      const uso = usoPorArquivo.get(relPath) ?? 0;
      if (uso < excecao.max) {
        excecoesFolgadas.push({ ruleId: rule.id, relPath, max: excecao.max, uso });
      }
    }
  }

  return { violacoes, excecoesFolgadas };
}

function extensao(relPath) {
  const dot = relPath.lastIndexOf(".");
  return dot === -1 ? "" : relPath.slice(dot);
}
