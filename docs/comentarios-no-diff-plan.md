# Comentários no diff — âncora honesta (plano)

> Status: **F0 ✅ · F1 ✅ · F3 ✅ (todos 19/08/2026)** · **F2 ✅ (20/08/2026,
> ADR-053)** — decidido pela **B** (fork isola sempre), a pedido do usuário
> ("quero que seja um fork de verdade assim como é no Orca ou Paseo"), com a
> contrapartida que a B exige: worktree e branch morrem com a conversa, e o que
> sobra aparece na faixa de status. Ver o §F2 abaixo, que registra a
> recomendação original e por que ela mudou.
> Nasceu da revisão de 19/08/2026 sobre a leva "fork + comentário no diff +
> Frota" (inspirada em Orca/Paseo, ver `competitors-orca.md`). O comentário
> inline no diff foi entregue em `DiffPanel/comments.tsx` + `deliveryDiff.ts`;
> a revisão achou um bug real (corrigido) e uma classe de deriva que o
> band-aid não cobre (F1).

## A dor

O comentário inline ancora por **posição no diff parseado**:
`lineKey(path, hunkIndex, lineIndex)` (`DiffPanel/comments.tsx`). Posição não é
identidade: basta o diff ser re-parseado com outro recorte de hunks para a
mesma chave apontar para outra linha.

Dois caminhos chegam nisso:

1. **Trocar de `cwd`** (outra conversa/worktree com a aba Alterações aberta) —
   o diff recarrega, os comentários não. Você veria "2 comentários no diff" e
   mandaria `app/src/foo.ts:42` **de outro repositório** para o agente.
   → **F0, já corrigido**: `commentApi.clear()` no mesmo efeito do `cwd`
   (`DiffPanel.tsx`). Repositório diferente = comentário inválido, ponto.

2. **"Atualizar" depois do agente mexer nos arquivos** — os hunks mudam de
   forma (split, merge, reordenação) e os índices deixam de casar. O badge
   passa a aparecer sob **outra linha**. → **F1, aberto.**

O estrago de (2) é menor do que parece e é importante ser preciso: `path`,
`lineNo` e `codeText` são capturados **no momento do comentário**, então a
mensagem enviada ao agente continua honesta. O que mente é a **tela**: o badge
sob a linha errada. É bug de exibição, não de output corrompido.

## A causa raiz

Índice de array é identidade **derivada do render**, não do conteúdo. Qualquer
re-parse do mesmo arquivo pode produzir outra indexação sem que uma única
linha do código tenha mudado.

## F1 — Âncora por identidade + órfão visível ✅

> Entregue em 19/08/2026. `DiffPanel.tsx` foi de 629 → **615** linhas mesmo
> ganhando a tira de órfãos, porque a barra de envio saiu para
> `DiffPanel/sendBar.tsx` antes (como o plano mandava). +20 testes.

**Três passos, todos testáveis puros:**

1. **Chave de identidade, não de posição.** `lineKey` passa a ser
   `${path}@${side}:${lineNo}`, com `side = "old"` para linha `del` e `"new"`
   para `add`/`ctx` (uma linha deletada só existe do lado antigo). Sobrevive a
   split/merge/reordenação de hunk, que é o caso comum do "Atualizar".

2. **Validação no render.** O comentário só desenha no lugar quando existe uma
   linha com a mesma chave **e** `line.text === comment.codeText`. Função pura
   `commentFor(comments, path, line): DiffComment | null` — o casamento é por
   conteúdo, não por fé.

3. **Órfão VISÍVEL, nunca descartado.** Comentário que não casa mais não some
   e não é re-ancorado por adivinhação: vai para uma tira no rodapé do painel
   ("N comentário(s) saíram do lugar"), com o `path:linha` original e o trecho
   citado, ainda editável/removível, e **ainda entra na mensagem** — a citação
   já o torna auto-suficiente. `composeDiffComments` marca esses com
   "(a linha mudou depois do comentário)".

**Por que não re-ancorar por similaridade:** errar o palpite é pior que
admitir. É o §6 do STYLEGUIDE aplicado ao próprio comentário — "não sei"
degrada pro pessimista, e aqui o pessimista é "saiu do lugar", não "achei que
era esta linha aqui".

**Arquivos:**

- `lib/deliveryDiff.ts` — `DiffComment` ganha `side`; `composeDiffComments`
  marca o órfão. (~82 linhas hoje, folga larga.)
- `components/layout/DiffPanel/comments.tsx` — `lineKey` por identidade,
  `commentFor`, e `useDiffComments` expõe `stale` derivado. (~171 hoje.)
- `components/layout/DiffPanel.tsx` — a tira de órfãos e a contagem da barra
  de envio somando os dois grupos. **Atenção ao tamanho: 629 linhas, teto tsx
  700.** A tira provavelmente exige extrair a barra de envio para
  `DiffPanel/sendBar.tsx` — divida o arquivo, não suba o teto.
- Testes: `comments.test.tsx` (casamento e órfão por render SSR) e
  `deliveryDiff.test.ts` (marcação do órfão na composição).

**Definition of done:** comentar uma linha → mexer no arquivo por fora →
"Atualizar" → o comentário aparece na tira de órfãos com o trecho original, e
o texto enviado diz que a linha mudou. Nenhum badge sob linha errada em
nenhum momento.

## F2 — Fork não cria worktree (decisão de produto, não bug)

`clone.ts` grava `worktreePath: null` no fork. Foi deliberado: duas conversas
escrevendo o mesmo worktree colidiriam, e herdar o worktree da origem seria
exatamente isso. Mas a comparação que motivou o fork (Orca/Paseo) era sobre
**worktrees paralelos**, então hoje "fork" ainda não é "branch paralela".

Três saídas, com o custo honesto de cada uma:

| | O que faz | Custo |
|---|---|---|
| **A (hoje)** | fork compartilha a pasta do projeto | não entrega o paralelismo prometido |
| **B** | fork cria worktree sempre | `removeWorktree` recusa com mudança não-commitada → lixo que só sai na mão; falha no meio deixa meio-estado |
| **C** | fork normal + ação "Isolar" (já existe no menu de contexto da conversa) | dois gestos em vez de um |

**Recomendação: C por enquanto** — o `toggleWorktree` de `ConversationList.tsx`
já faz exatamente isso e é reversível. B só se o uso real provar que o segundo
gesto incomoda; aí entra como "Forkar e isolar", opção explícita, nunca
default silencioso que enche o repo de worktree órfão.

> **Desfecho (20/08/2026, ADR-053):** foi **B**, por decisão do usuário. E a
> ressalva escrita acima estava certa: um dia depois, o próprio repo do projeto
> tinha `mycockpit/05b6b458` com a pasta já removida e o branch vivo. Então a B
> só ficou de pé quando ganhou o que faltava: `remove_worktree` apaga o branch
> com `branch -d` (o git segura o que tem trabalho), a conversa apagada leva o
> worktree junto, e o que sobra vira item na faixa de status com diálogo pra
> recolher. A lição: **quem cria automático precisa recolher automático**. Sem
> isso, "B" não era uma opção, era um vazamento com nome bonito.

## F3 — Título de fork acumula ✅

> Entregue em 19/08/2026 (`cloneTitle` em `store/chat/clone.ts`, +9 testes).

Forkar um fork vira `Conversa (fork) (fork)`. Fix: função pura em `clone.ts`

```ts
cloneTitle(srcTitle: string, marker: "fork" | "cópia", siblings: string[]): string
```

que (1) tira o sufixo ` (fork)` / ` (fork N)` / ` (cópia)` / ` (cópia N)` do
fim, (2) reanexa com o menor N livre entre os irmãos do mesmo projeto. Dois
forks da mesma origem viram `(fork)` e `(fork 2)` em vez de dois títulos
idênticos. Teste direto: é função pura, sem store.

## Ordem sugerida

**F3** (pequeno, isolado, fecha um incômodo visível) → **F1** (o substancial;
faça a extração do `sendBar` antes de encostar na tira de órfãos) → **F2** só
com decisão sua, porque é produto, não conserto.
