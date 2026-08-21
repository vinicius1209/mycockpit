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

### F1.4 — Teto de render (condicional, não bloqueia)
O Orca tem limite explícito (`MAX_RENDERED_DIFF_LINES_PER_SIDE = 120_000`,
`MAX_RENDERED_DIFF_COMBINED_CHARACTERS = 6_000_000`); nós **não temos nenhum**.
Hoje o acordeão esconde o problema porque quase ninguém expande arquivo gigante
numa coluna estreita. Uma superfície larga convida exatamente isso. Entra se o
uso real mostrar travada — com número medido, não por precaução.

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
