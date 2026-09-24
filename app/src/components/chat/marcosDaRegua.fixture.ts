import type { ChatItem } from "@/store/chat"

// Payload REAL da conversa que motivou a ADR-250 (24/09/2026, itens 474 a 687),
// com as ferramentas resumidas a uma e os textos longos cortados. É o caso em
// que a régua desenhava 34 traços para 13 pedidos e mostrava a narração no
// lugar da resposta.
export const FIO: ChatItem[] = [
  { kind: "user", id: "95cebfce", text: "pode fazer os commits separados por assunto, e pode seguir", ts: 1790257990163 },
  {
    kind: "text",
    id: "a1239972",
    text: "Antes de commitar, confiro o estado da árvore. Outras frentes estão trabalhando nela ao mesmo tempo, e só posso commitar o que é meu.",
    ts: 1790257997588,
  },
  {
    kind: "tool",
    id: "cbefed0b",
    name: "Bash",
    input: { command: "git status --short" },
    result: { ok: true, text: "", lines: 0 },
    ts: 1790257998513,
  },
  {
    kind: "notice",
    id: "ae2254a2",
    message:
      "A árvore de processos deste run atingiu 2301 MB (incluindo 1796 MB em comandos e compiladores filhos; o processo principal consome 505 MB) e continua rodando sem teto artificial.",
    ts: 1790258220198,
  },
  {
    kind: "text",
    id: "f5b6fcac",
    text: "Os seis commits estão feitos e verificados. Agora estou investigando o título automático.",
    ts: 1790258340803,
  },
  {
    kind: "text",
    id: "71e788fd",
    text: "Fiz os commits separados por assunto e segui com o próximo item aprovado: o título das conversas, que também já está commitado.",
    ts: 1790258935191,
  },
  {
    kind: "result",
    id: "14f85668",
    ok: true,
    text: "Fiz os commits separados por assunto e segui com o próximo item aprovado: o título das conversas, que também já está commitado.",
    costUsd: 9.1229662,
    costSource: "reported",
    model: "claude-opus-5-5[1m]",
    durationMs: 950731,
    ts: 1790258940894,
  },
  {
    kind: "user",
    id: "3052124b",
    text: "1. isso a gente deixa pra depois ainda, vamos vendo.\n2. quero ver no mock\n3. ok, mock",
    ts: 1790261431985,
  },
  {
    kind: "text",
    id: "0143ff48",
    text: "O mock da barra v2 está aberto. Para os detalhes, antes de desenhar a régua de risquinhos à esquerda do chat preciso saber o que o laranja e o cinza significam hoje.",
    ts: 1790261505154,
  },
  { kind: "text", id: "6b42e2dc", text: "You've hit your session limit · resets 2:50pm (America/Sao_Paulo)", ts: 1790261892588 },
  {
    kind: "result",
    id: "df4e636d",
    ok: false,
    text: "",
    costUsd: 5.725137399999994,
    costSource: "reported",
    model: "claude-opus-5-5[1m]",
    durationMs: 460642,
    ts: 1790261892627,
  },
  {
    kind: "limit",
    id: "1d499168",
    message: "You've hit your session limit · resets 2:50pm (America/Sao_Paulo)",
    resetHint: "2:50pm (America/Sao_Paulo)",
    ts: 1790261892646,
  },
  { kind: "notice", id: "02d3f24e", message: "auto-resume: retomando (tentativa 1/3)", ts: 1790272218068 },
  {
    kind: "user",
    id: "a8dd1a1e",
    text: "O turno anterior parou num limite de uso/espera. O limite já deve ter resetado: continue a tarefa pendente de onde parou (não repita o que já foi feito).",
    ts: 1790272221111,
  },
  {
    kind: "text",
    id: "20845ae2",
    text: "Terminei as três frentes que você aprovou nos mocks. São mais três commits locais.",
    ts: 1790272528202,
  },
  {
    kind: "result",
    id: "5cdc5925",
    ok: true,
    text: "Terminei as três frentes que você aprovou nos mocks. São mais três commits locais.",
    costUsd: 10.117915400000015,
    costSource: "reported",
    model: "claude-opus-5-5[1m]",
    durationMs: 310490,
    ts: 1790272531601,
  },
]
