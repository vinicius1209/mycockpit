# A memória de uma conversa: do recap ao grafo (plano)

> Status: proposto em 23/08/2026, com a **fase 0 já medida** nas conversas reais
> desta máquina. Pedido do usuário: *"quero esse produto em nível profissional
> arquitetural e algorítmico, não apenas funcionar por funcionar."*

## A pergunta que originou

Trocar de motor no meio da conversa é **handoff**: cada CLI guarda a sessão dela
por um id próprio e nenhuma retoma a da outra. O Frota já resolve isso com
`beginTransplant` → recap (~3k) + ponteiro pro histórico exportado em
`.mycockpit/context/<convId>.md`.

O usuário perguntou duas coisas: *"o banco local, ponteiros, grafos — não
poderiam melhorar isso?"* e *"o recap de 3k é suficiente?"*.

## Fase 0 ✅ — A medida (23/08/2026)

Quatro conversas reais desta máquina, algoritmo real (`serializeContext`).

### Quanto o recap de 3k preserva

| conversa | itens | contexto completo | perdidos | preservado |
|---|---|---|---|---|
| 0ae552bf | 175 | 19k | 74 | 57,7% |
| **16b3735b** | **1885** | **234k** | **1323** | **29,8%** |
| 1d0ce136 | 285 | 110k | 176 | 38,2% |
| 20e1f62d | 621 | 62k | 351 | 43,5% |

**Não é suficiente.** E o número é menos grave que a FORMA: o corte é 30% do
início + 70% do fim, então o que some é o MIOLO. Numa sessão longa, o início é
"o que eu pedi", o fim é "onde estamos", e o miolo é *tudo que se descobriu e
descartou*. Some exatamente a parte cara.

Agravante de design: o recap **parece completo** — tem começo e fim, e um único
marcador `[… N itens omitidos …]` no meio. Truncagem que parece íntegra é pior
que truncagem óbvia.

### Do que a conversa é feita — e esta medida reescreve o problema

| tipo | itens (conv. de 1885) | % dos BYTES |
|---|---|---|
| `tool` | 1617 | **90%** |
| `text` (resposta do agente) | 191 | 5% |
| `result` | 36 | 3% |
| `user` (o que você pediu) | 34 | **~0%** |

**O orçamento é gasto quase todo em telemetria de ferramenta.** E o sinal — o
que foi pedido, decidido, quebrado — é uma fração mínima.

Medindo só a intenção humana + erros:

| conversa | bytes | cabe em 3k? |
|---|---|---|
| 0ae552bf | 248 | **sim** |
| 20e1f62d | 1.268 | **sim** |
| 16b3735b | 7.594 | quase |
| 1d0ce136 | 20.554 | não |

Em duas das quatro, **toda** a intenção humana caberia no orçamento de hoje.

**A conclusão que desenha o plano:** o problema não é o tamanho do orçamento nem
falta de compressão. É que a seleção é **posicional** (início/fim) quando
deveria ser **por significado**. Um algoritmo que escolhesse por tipo antes de
escolher por posição já ganharia muito, sem grafo nenhum.

## A vantagem estrutural que o Frota tem, e quase não usa

Isto não é um log de chat. É uma lista de itens TIPADOS, ao lado de um repo git,
de um ledger de custo e de uma fila de decisões:

| pergunta | hoje respondida por | poderia ser respondida por |
|---|---|---|
| que arquivos mudaram? | prosa no transcript | `git diff` — EXATO |
| que ferramentas rodaram em quê? | prosa | `input` dos itens `tool` — EXATO |
| que decisões o humano tomou? | prosa | itens `planGate` com `decision` — EXATO |
| o que falhou e não foi resolvido? | prosa | itens `error`/`result` — EXATO |
| quanto custou cada trecho? | não responde | ledger |

Muito do que um grafo "descobriria" nós **já sabemos com precisão** e estamos
jogando fora ao serializar como texto. Isso muda a ordem das fases: extrair
fatos vem ANTES de inferir relações.

## O argumento REAL a favor do grafo (não é compressão)

Compressão é o argumento fraco — resolve-se com orçamento por tipo (G1).

O argumento forte é **invalidação**. Um transcript é uma lista append-only: ele
replica a tentativa errada da linha 40 com a mesma autoridade da correção da
linha 900. O agente novo lê "vamos usar polling" e "trocamos polling por
websocket" como duas afirmações igualmente vivas, e a ordem é a única pista.

Um grafo tem a aresta que o texto não tem: **`supersedes`**. "A decisão B
invalida a A." É isso que impede contexto velho de envenenar o turno novo — e é
o defeito que aparece justamente nas conversas longas, onde o recap já falha.

**Se o grafo for construído só pra caber mais coisa no prompt, não vale o
preço.** Vale pra dizer o que NÃO é mais verdade.

## Fases

### G1 — Orçamento por SIGNIFICADO (sem grafo, sem ML)

Substituir "30% início + 70% fim" por uma alocação declarada:

```
1. intenção humana        — TODOS os itens `user`, sempre. É o mais barato
                            (medido: ~0% dos bytes) e o mais insubstituível.
2. decisões               — `planGate` + como foram resolvidos.
3. falhas não resolvidas  — `error`/`result` sem sucesso posterior no mesmo alvo.
4. estado atual           — os últimos N turnos, verbatim.
5. o resto                — ferramentas AGREGADAS ("47 leituras em src/", não 47 linhas).
```

- **Determinístico**, testável, sem chamada extra. Roda em ms.
- **Declara o que cortou**, por categoria — não um marcador único no meio.
- Provavelmente já resolve a maioria dos casos, e é o que torna G3 avaliável:
  sem G1, não dá pra saber se a falha é de seleção ou de representação.

### G2 — O ponteiro vira navegável

Hoje: `.mycockpit/context/<convId>.md`, um blob. O agente pode ler, mas ler
200KB pra achar uma decisão é o mesmo problema com outro nome.

- Âncoras estáveis por turno (`#t-042`) no export.
- O recap CITA âncoras: *"a decisão sobre o schema está em #t-042"*.
- **Índice no topo do arquivo**: decisões, arquivos tocados, erros — cada um com
  a âncora. O agente pula direto.

Isto é "grafo" no sentido útil (nós endereçáveis + referências) com custo de
âncora em markdown.

### G3 — O grafo, se G1+G2 não bastarem

**Nós:** `turno`, `arquivo`, `decisão`, `erro`, `ferramenta`, `símbolo`.
**Arestas:** `tocou`, `causou`, `resolveu`, `reverteu`, **`supersedes`**,
`responde`.

- **Construção incremental e SEM LLM** no que der: `tocou` sai do `input` da
  ferramenta; `causou`/`resolveu` saem da adjacência erro→sucesso no mesmo alvo;
  `supersedes` sai de decisão sobre o mesmo alvo em ordem posterior.
  O que exigir julgamento (dois nomes diferentes pro mesmo conceito) fica de
  fora da v1 — inferência fraca envenena mais que ausência.
- **Recuperação:** sementes = casamento EXATO do prompt novo contra nós
  (caminhos, símbolos), depois expansão em largura com peso por aresta, com teto
  de orçamento. Sem semente, cai no G1.
- **Poda por invalidação:** nó alcançado por `supersedes` entra marcado como
  histórico, ou não entra. É a razão de existir do grafo.

### G4 — Embeddings, por último e talvez nunca

Só depois de G3 provar que a recuperação exata não alcança. Vem por último
porque é o menos explicável (não dá pra dizer POR QUE aquele trecho entrou), o
mais caro de manter e o menos alinhado com um app local-first de compra única.

## Como saber se cada fase valeu

Cada fase entrega junto uma medida, e a medida é a mesma:
**pegar uma conversa longa real, cortar no meio, transplantar, e perguntar ao
agente novo cinco coisas que só o miolo responde.** Hoje isso falha; a fase que
não mover essa agulha não valeu.

## O que NÃO fazer

- **Não** começar pelo grafo. G1 é 10% do custo e provavelmente a maior parte do
  ganho; sem ele não dá pra atribuir mérito a G3.
- **Não** inferir com LLM o que o `input` da ferramenta já diz exato. Trocar
  precisão por inferência é perder de graça.
- **Não** deixar a projeção mentir. Todo recorte declara o que cortou — foi
  parecer completo que fez o recap de hoje passar despercebido.
- **Não** construir grafo que só comprime. Sem `supersedes`, é índice caro.
