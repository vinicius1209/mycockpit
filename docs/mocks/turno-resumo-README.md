# Barra de resumo do turno — 3 POCs visuais

> Mocks estáticos (17/08/2026), NÃO código do app. Abrir no browser:
> `turno-resumo-a.html` · `-b.html` · `-c.html`. Os três renderizam a MESMA
> cena (o turno real do print: "pausa o Docker do projeto" → shell agregado →
> prosa com bullets → resumo de fim de turno), com as strings reais
> (`49s`, `3↓·1.4k↑`, `cache 308k`, `claude-opus-4-8`, `US$ 2,97`). Cada mock
> tem tema claro/escuro (toggle) e navegação A/B/C no topo.

## O diagnóstico

A barra hoje (`TurnTelemetry` + `TurnFeedback` em `MessageList.tsx:1548,1327`)
empilha **3 linhas em TODO turno, sempre visíveis**: telemetria (status ·
tempo · tokens · cache · modelo · custo), um chip "Diff" solto numa linha
própria, e depois de um hairline, thumbs + "Transformar em aprendizado". Isso
é chrome fixo competindo com a prosa do agente logo acima — o que devia ser
uma legenda de rodapé pesa quase tanto quanto a resposta.

Achado à parte, direto do STYLEGUIDE (`docs/STYLEGUIDE.md` §2): **o custo está
em brass** (`text-brass` em `TurnTelemetry`), e a regra fechada desde
14/08/2026 é "custo nunca é gesto, nunca brass" — valor absoluto sem teto do
usuário é cinza até ele definir um limite em Configurações ▸ Uso e custo. Os
três mocks corrigem isso, sem exceção.

## A — Legenda muda

**Tese:** o footer devia pesar quase zero por padrão — a maioria dos turnos
nunca é auditada nem recebe reação. A telemetria vira UMA linha cinza; Diff e
reações somem e só aparecem no hover/foco do cartão (Tab entra, revela) — a
4ª camada de esconder do §5 aplicada ao próprio footer, não só ao conteúdo.

**Resolve:** as 3 linhas viram 1 por padrão (o maior ganho de silêncio dos
três). **Sacrifica:** descoberta — quem nunca passou o mouse não sabe que dá
pra reagir; mobile/touch não tem "hover" (mitigável com um `:focus-within` via
tap, mas o affordance de "isso existe" fica mais fraco que em B/C).

## B — Uma linha só

**Tese:** não esconde a ação, encaixa ela do lado da telemetria. Tudo em UMA
linha sempre visível: telemetria à esquerda, 4 ícones à direita (Diff,
👍, 👎, 🎓) com `title`/`aria-label` no lugar do texto. Mata o chip "Diff"
órfão e o hairline extra sem esconder nada.

**Resolve:** 3 linhas → 1, sem trade-off de descoberta (tudo continua
visível). **Sacrifica:** é o menos silencioso dos três — quem faz 40 turnos
numa sessão vê 40 barras de ícones idênticas, mesmo que nunca clique.

## C — Ficha expansível

**Tese:** nem todo número pesa igual. Status + tempo + custo é o que o olho
escaneia; tokens/cache/modelo é auditoria. A linha 1 fica só com os três +
ícones de ação (herdados de B); o resto entra no MESMO `<details>` que o
cartão de **incidente** já usa pra "Detalhes técnicos" (`MessageList.tsx:1939`)
— reuso de um padrão existente, não uma peça nova.

**Resolve:** a linha 1 fica do tamanho do "concluído · 49s" que os incidentes
já mostram — a barra de sucesso passa a pesar o mesmo que a de erro.
**Sacrifica:** 2 estados por cartão em vez de 1 (mais superfície de interação
pra manter); tokens/cache ficam 1 clique mais longe de quem realmente
acompanha custo turno a turno (perfil que existe: é o público do próprio
`CostAudit.tsx`).

## Recomendação

**B.** Razões:

1. Resolve o problema estrutural que motivou a queixa (3 linhas → 1, chip
   órfão, hairline extra) sem introduzir um estado novo (hover-reveal de A,
   disclosure de C) — menor delta sobre o componente real, e os dois maiores
   riscos dos outros dois (descoberta em A, custo de auditoria em C) não
   existem em B.
2. A é o mais silencioso mas trafega mal em touch/tablet (o app roda em
   Mac/Linux, mas o cartão sem indício nenhum de "há ação aqui" até o mouse
   passar é uma aposta maior que o ganho).
3. C é o mais elegante para quem lê custo turno a turno, mas essa audiência já
   tem o `CostAudit.tsx` — o footer de CADA turno não precisa carregar esse
   público, e o toggle extra é complexidade que B evita de graça.
4. B mantém A/C como evolução: nada no layout de B impede que uma passada
   futura aplique hover-reveal (A) OU disclosure (C) por cima, se o uso real
   mostrar que a densidade ainda incomoda.

A correção de custo (brass → cinza) é comum aos três e deveria entrar
independente da direção escolhida — é a única mudança aqui que é conserto de
regra existente, não exploração de layout.
