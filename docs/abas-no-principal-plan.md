# Abas no painel principal — o diff ganha largura (plano)

> Status: **implementado e promovido no build #248** (21/08/2026). Nasceu do teste do build
> #238: o usuário abriu um arquivo na aba Alterações e o diff apareceu espremido
> numa coluna de ~390px, cortando linha no meio. Palavras dele: "olha que
> experiência ruim, sem formatação, sem espaço, fica meio inútil".

## O diagnóstico é dimensional, não estético

O painel direito abre em `defaultSize="30%"` e tem teto de `maxSize="42%"`
(`AppShell.tsx`). Numa janela de ~1500px isso dá ~480px, e depois da calha de
número de linha sobram ~390px para o código. Código tem largura mínima, e 390px
está abaixo dela.

Tem um segundo defeito, mais silencioso: ao expandir inline, a lista **perde o
próprio trabalho**. Você rola 200 linhas de diff para chegar ao próximo arquivo.
Dois trabalhos no mesmo container, os dois degradados.

### Como os três clonados resolvem (lido no código, 20/08/2026)

| | Onde o diff vive | Evidência |
|---|---|---|
| **Paseo** | aba tipada no painel principal | `WorkspaceTabTarget` com 12 variantes; `working_diff` tem `focusPath` |
| **Orca** | diff + árvore de arquivos, redimensionável | árvore abre em `256px`, teto `640px`, e ele **garante `200px` extras só pro diff** |
| **Buzz** | dentro da mensagem, com modo expandido | `DiffMessage` → `DiffMessageExpanded` + `DiffViewer` |
| **Frota (hoje)** | acordeão dentro de coluna ≤42% | — |

O número do Orca é o contraste que importa: **a árvore sozinha dele é mais larga
que a nossa coluna inteira** (árvore + diff). Três de três dão largura cheia ao
diff; somos o único que não dá.

## O que NÃO muda

- **A aba Alterações continua**, e continua sendo boa: branch, ±totais, status
  por arquivo, contagem, Commit/Abrir PR. Isso é ambiente e escaneável, e coluna
  estreita é o lugar certo. O que sai dela é o papel de LEITOR.
- **O switcher do topo** (Painel · Trabalho · Features) fica como está.
- **A conversa nunca desmonta** (ver a restrição dura abaixo).

## As três restrições que desenham tudo

1. **Remontar o chat trava a main thread.** `AppShell.tsx` já resolve isso
   mantendo `MissionControl` e `ChatPanel` montados e alternando por CSS
   (`hidden`), com o motivo escrito lá: "o memo dos itens não sobrevive a
   remount". A aba de diff entra na MESMA regra — alterna por CSS, nunca
   desmonta a conversa.
2. **Duas camadas de navegação na mesma região é risco real.** Já existe o
   switcher central (modo = que espaço). Uma tira de abas somaria um segundo
   nível (aba = que superfície dentro do trabalho). O Paseo não tem os dois: lá
   o nível de cima é o workspace, na sidebar. A decisão de produto posterior é
   tratar **Conversa como âncora permanente**, com um + discreto de ações. Assim
   uma aba transitória pode entrar e sair sem fazer a navegação inteira piscar.
3. **A ADR-037 apostou o contrário** ("o passado recolhe, o vivo respira") e
   listou "canvas infinito como superfície" no *não trazer*. Aba não é canvas:
   é limitada, nomeada e fechável; a tira fixa ancora a conversa, enquanto as
   demais abas somem quando fechadas. Mas isto é uma
   releitura consciente daquela aposta, registrada aqui para não ser uma
   revogação em silêncio.

## O modelo

União discriminada, igual à do Paseo — que começou com poucas variantes e foi
somando sem retrabalho, porque a forma aguenta:

```ts
export type MainTab =
  | { kind: "conversa" }
  | { kind: "diff"; focusPath?: string }
```

**Duas variantes, e só.** Terminal, arquivo avulso e PR são fase 2, e só se a
fase 1 se provar.

Mora em `useApp` (mesma família do `viewMode`), **fora do `partialize`**:
reabrir o app numa tela de diff que você não lembra de ter aberto é pior que
reabrir na conversa. Aba é gesto da sessão, não preferência.

## Fases

### F1.1 — A tira e o hospedeiro
- `store/app`: `mainTab: MainTab`, `openDiffTab(focusPath?)`, `closeDiffTab()`.
- `components/layout/MainTabs.tsx`: a tira. Reusa a régua visual do `TabBtn`
  (`contextPanelChrome.tsx`), que já degrada para ícone em container estreito.
  **Conversa fica sempre visível** e o + oferece Nova tarefa, Duplicar conversa,
  Fork do último turno e Todos os comandos.
- `AppShell.tsx`: dentro do cartão do `id="chat"`, a tira acima e as superfícies
  alternando por `hidden` — o padrão que já está lá, não um novo.
- Fechar a aba (× ou Esc) volta pra conversa. Trocar de conversa **mantém** a
  aba aberta: ela significa "as alterações da conversa ativa", que é o mesmo
  contrato do `cwd` que o `DiffPanel` já usa hoje.

### F1.2 — `DiffView`: o diff com largura
Layout do Orca, com os números dele como ponto de partida: lista de arquivos à
esquerda (~240px, redimensionável) + diff do arquivo selecionado ocupando o
resto, com piso de 200px.

Reusa o que já existe — `DiffLineRow`, `useDiffComments`, `staleComments`,
`composeDiffComments` — porque comentário no diff é feature entregue (F1/F3 do
`comentarios-no-diff-plan.md`) e ela só melhora com espaço.

**Custo estrutural previsto:** `DiffPanel.tsx` está em ~640 linhas (teto 700). As
primitivas compartilhadas (`FileBlock`, `STATUS_META`, o cabeçalho de arquivo)
saem para `DiffPanel/parts.tsx` ANTES da `DiffView` existir. Dividir o arquivo,
nunca subir o teto.

### F1.3 — A coluna vira índice puro
- Clicar num arquivo em Alterações **abre a aba** com `focusPath` naquele
  arquivo, em vez de expandir o acordeão.
- O acordeão inline sai. É ele o defeito, não um atalho a preservar.
- Ficam na coluna: barra sticky (branch, ±totais, abrir no editor, refresh),
  lista de arquivos, tira de órfãos e o `ShipBar` (Commit/Abrir PR).

### F1.4 ✅ — Teto de render (medido e entregue em 21/08/2026)

O Orca tem limite explícito (`MAX_RENDERED_DIFF_LINES_PER_SIDE = 120_000`,
`MAX_RENDERED_DIFF_COMBINED_CHARACTERS = 6_000_000`); nós **não temos nenhum**.
Antes da aba, o acordeão numa coluna estreita escondia o problema — ninguém
expande arquivo gigante ali. A superfície larga convida exatamente isso.

**Escala, medida:** um patch de 120k linhas dá **~8 MB de texto**; 50k dá 3,4 MB;
10k dá 0,67 MB. Os números do Orca caem justo nessa faixa, o que sugere que eles
mediram algo parecido — mas número de outra casa não é medida nossa.

#### A ordem importa: MEDIR antes de cortar

O erro fácil aqui é copiar `120_000` do Orca e chamar de decisão. Nosso pipeline
é outro (`parsePatch` em `lib/git.ts` + render por linha em React, com o `memo`
por item), então o ponto onde ele dobra é NOSSO, não deles.

1. **Onde dobra.** Medir três coisas separadas com patches sintéticos crescentes
   (1k → 10k → 50k → 120k linhas): tempo de `parsePatch`, tempo até a primeira
   pintura, e responsividade do scroll. São gargalos diferentes e o teto tem que
   mirar o primeiro que chega.
2. **Qual eixo corta.** Linhas, caracteres, ou os dois (o Orca usa os dois: um
   arquivo de 500 linhas de 20 mil colunas passa no teste de linha e mata o
   render). A medida decide.
3. **Só então o número.**

#### O que o teto NÃO pode fazer

- **Sumir com o arquivo.** Diff cortado tem que DIZER que foi cortado, com o
  tamanho real e um caminho de saída (abrir no editor — o gesto já existe,
  ADR-054). Esconder mudança grande é o pior desfecho possível num painel cuja
  função é mostrar o que mudou.
- **Cortar no meio de um hunk sem marcar.** O corte é por arquivo, e o arquivo
  cortado aparece na lista com o motivo.
- **Valer para o COMENTÁRIO.** Comentário ancora em `path@side:linha`; se a
  linha não foi renderizada, não há onde ancorar. O arquivo cortado não oferece
  comentário — e diz por quê, em vez de deixar o gesto falhar calado.

#### Onde o teto mora

No pipeline PURO (`lib/git.ts`), não no componente: assim o mesmo corte vale
para a coluna, para a aba e para qualquer superfície futura, e dá pra testar
sem montar React. O componente só desenha o aviso.

## O que NÃO fazer

- **Não** persistir a aba aberta (ver o modelo).
- **Não** fazer a tira aparecer e desaparecer junto com Alterações: Conversa e
  o + são a âncora estável da superfície Trabalho.
- **Não** desmontar a conversa ao trocar de aba: a restrição 1 é medida, não
  teórica.
- **Não** abrir a aba sozinha ao fim de um turno. O painel direito já tem a
  regra de não sequestrar a aba a cada turno (`ContextPanel.tsx`: "depois disso
  a sua escolha manda"); a aba do principal é mais intrusiva ainda, então é
  gesto humano, sempre.
- **Não** transformar em editor. Ler o diff e comentar, sim; editar, não — o
  atalho para o editor de verdade já existe (ADR-054).

## Definition of done

- Com uma aba, Conversa e o + continuam visíveis; abrir/fechar Alterações não
  desloca nem remove essa âncora.
- Clicar num arquivo em Alterações abre a aba já naquele arquivo.
- Trocar de aba não remonta o `ChatPanel` (verificável: o scroll do fio e o
  estado do composer sobrevivem à ida e volta).
- Comentário no diff funciona na superfície larga, incluindo a tira de órfãos.
- Fechar a aba volta pra conversa; reabrir o app volta pra conversa.
- `tsc` 0, suíte verde, 6 guardas, nenhum arquivo acima do teto.

## Como ficou o F1.4 (21/08/2026)

O plano mandava medir antes de cortar, e a medição mudou o desenho três vezes.

**Pintura real no navegador** (Chromium, marcação igual à do `DiffView`):

| caso | build DOM | layout | scroll p95 |
|---|---|---|---|
| 10k linhas | 18ms | 136ms | 24ms |
| 20k linhas | 37ms | 271ms | 58ms |
| 50k linhas | 112ms | 724ms | 134ms |
| 120k linhas | 272ms | 2426ms | 443ms |
| 500 linhas × 20k colunas | 2ms | **414ms** | **91ms** |

1. **O parser não era o gargalo.** `parsePatch` faz 120k linhas em 16ms.
   Otimizá-lo teria sido trabalho no lugar errado, e era pra onde a intuição
   apontava.
2. **É o LAYOUT, não o build do DOM.** 2426ms contra 272ms nos 120k. Por isso o
   teto tem que morder antes da árvore existir.
3. **A medição em Node quase mentiu.** Primeiro medi com `renderToStaticMarkup`,
   e a tabela dizia que só o número de linhas custava: 10 MB em 500 linhas saía
   em 3ms. No navegador as MESMAS 500 linhas largas custam 414ms de layout e
   **mais scroll (91ms) que 20 MIL linhas normais (58ms)** — porque
   `renderToStaticMarkup` não faz layout, e é no layout que linha larga dói.
   Sem repetir a medida no navegador, o teto teria UM eixo e o bundle
   minificado entraria inteiro.

**Os números:** `MAX_LINHAS_POR_ARQUIVO = 20_000` (layout ~271ms, scroll ~58ms —
a borda do aceitável) e `MAX_CHARS_POR_ARQUIVO = 2_000_000`. Dois eixos, igual ao
Orca — mas agora por uma razão medida aqui, não por imitação. Os deles
(`120_000` linhas) travariam o nosso painel por 2,4 segundos.

Mora em `lib/git.ts` (`corteDoArquivo`, puro e exportado), então o mesmo corte
vale pra coluna, pra aba e pro que vier. O componente só desenha o aviso: motivo,
tamanho real, saída pro editor, e a frase de por que aquele arquivo não aceita
comentário (sem linha desenhada não há `path@side:linha` pra ancorar).
