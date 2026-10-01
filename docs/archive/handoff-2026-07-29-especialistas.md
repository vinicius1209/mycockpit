# Handoff — Especialistas → chat Slack → composer Lexical (2026-07-29)

> Handoff de sessão. Cobre tudo que evoluiu **desde a implementação dos Especialistas**
> até o repo enxuto de hoje. Decisões congeladas em **ADR-026** (Especialista: papel, não
> modo) e **ADR-027** (cutover do composer). Plano de origem: `especialistas-plan.md`.
> Estado: tudo na `main` (`7c038b0`), pushado — uma só branch.

## TL;DR — o que existe agora

1. **Especialistas** entregues (E1·E2·E3): persona-conselheiro read-only, marketplace com
   avatares, piloto/volante + barra de presença.
2. **Chat estilo Slack**: autor por avatar+nome, mensagens agrupadas, "digitando", custo da
   sessão no topo.
3. **Composer Lexical** é o **único** composer: menção atômica (pill), `@especialistas`,
   `@arquivos`, `/comandos`, paste, histórico ↑/↓ — textarea/toggle aposentados.
4. **Repo limpo**: 9 branches mergeadas deletadas, só `main`; ADRs escritos; código morto
   do `ComposerShell` removido.

## Linha do tempo (o caminho, não só o destino)

| Fase | O que | Onde |
|---|---|---|
| **S0–S3** | Especialista conselheiro (read-only `fusion-ro`) + identidade/marketplace + piloto/volante | `lib/advisor.ts`, `lib/marketplace.ts`, `store/chat.ts`, `components/settings/Especialistas.tsx` |
| **Polish** | marketplace dialog largo, starter team (6), Settings limpo, `@`-popover agrupado com avatar, parecer inline no fio | `Especialistas.tsx`, `MessageList.tsx`, `PresenceBar.tsx` |
| **Avatar** | DiceBear offline determinístico: `thumbs` + cor pela categoria = "família" | `lib/avatar.ts` (+ `.test.ts`), `docs/mocks/avatar-system.html` |
| **AppDialog** | wrapper compartilhado sobre `ui/dialog` (X padrão em `top-3 right-3`) | `components/ui/` (AppDialog) |
| **Chat Slack** | `groupByAuthor`/`GroupRow`, `resolveExecutorIdentity`, presença, custo no topo | `MessageList.tsx`, `PresenceBar.tsx` |
| **Composer Lexical** | migração em fases atrás de toggle → paridade total → **cutover** | `LexicalComposer.tsx`, `CommandConsole.tsx`, `lexicalDraft.ts`, `lib/focusComposer.ts` |
| **Cleanup** | branches deletadas, ADR-026/027, `ComposerShell` só-input | `docs/decisions.md`, `ComposerShell.tsx` |

## Decisões que amarram o design (não reabrir sem motivo)

- **1 conceito só — `Especialista`.** Não há entidade/tabela nova. Dois **papéis derivados
  do estado da conversa**: **conselheiro** (`@menção` → read-only, parecer inline) e
  **piloto** (`conv.presetId` = quem executa). Detalhe em **ADR-026**.
- **Read-only é `fusion-ro`**, não "leitura". Isso bloqueia Bash/Edit/Write **e** passa
  `--strict-mcp-config {}` (sem MCP/`ask_user`) → sem efeito colateral externo e **sem
  hang** esperando humano. Trocar isso reabre os dois bugs que a S1 tomou.
- **Reinjeção de persona sobrevive a restart**: `needsPersonaReinject(conv)` é **derivada
  do estado persistido** (presetId + digest null + `hasExecutorTurn`), não um flag efêmero
  (o erro da S3).
- **Rubrica é injetada no prompt** (mesmo predicado do digest). Se voltar a ser só
  decorativa, volta o falso aviso de drift.
- **Avatar**: a cor **vem da categoria** (`categoryColor`), estilo base único `thumbs`. Pro
  `thumbs` a cor dominante é o **corpo** (`shapeColor`), não `backgroundColor` — por isso
  `avatarSvg` pinta os dois. Mexer aqui foi o que fez a cor "não aparecer" antes.
- **Composer é um só (Lexical)** e fica **lazy** mesmo assim (chunk ~82 kB gzip fora do
  `main`). Só o `CommandConsole` usa. Detalhe em **ADR-027**.

## Mapa mental do composer (pra quem for mexer)

- `CommandConsole.tsx` — orquestra: monta `lexicalInput`, injeta no `ComposerShell` via
  `input=`. Hooks (`useSlashCommands`/`useAtMentions`/`usePromptHistory`/`useAttachments`)
  cuidam da lógica; o teclado chega pelos **plugins** do editor.
- `LexicalComposer.tsx` — o editor. Plugins: `EnterToSubmitPlugin`, `SlashMenuKeysPlugin`,
  `PasteAttachmentsPlugin`, `HistoryRecallPlugin`, `DraftSyncPlugin`, `FocusBridgePlugin`.
  Menu de menção (`@`) posiciona-se `position: fixed` medindo o rect do editor e **abre pra
  cima** (igual o AtPopover antigo). `AT_PUNCTUATION` custom pra `@src/lib/db.ts` funcionar.
- `lexicalDraft.ts` — serialização string↔Lexical (`$serializeDraft`/`$setDraft`).
- `ComposerShell.tsx` — **só chrome** (cartão + header + chips + slot `input` + footer +
  anel de foco). Não tem mais textarea.
- `lib/focusComposer.ts` — foco programático (tray://new-task, cards) mira
  `data-composer="console"`, que vive no **contenteditable do Lexical** (`LexicalComposer:458`).
- **Não passam pelo ComposerShell**: Arena/Fusion/Mission têm `<Textarea>` próprio — não
  foram tocados no cutover.

## Convenções/armadilhas aprendidas (custaram tempo)

- **`vite build` é o portão real, não o `tsc`.** O build pegou `.kind`↔`.type` e um `scope`
  fora do union (`"project"` vs `PresetScope "projeto"`) que o `tsc` deixou passar. Sempre
  rodar `./scripts/build.sh test` antes de considerar pronto (e `open` o `.app`).
- **Worktrees em paralelo**: agentes nasciam da **base errada** repetidamente. Sempre
  `git merge-base --is-ancestor <base> <branch>` antes de `git merge --ff-only`.
- **`.frota/` fica untracked de propósito**: o `.gitignore` dela versiona só
  `instructions.md` + `agents/`; o resto (`config.toml`, `context/`) é estado local. `git
  add .frota` não pega nada (é esperado).
- **Conta GitHub**: pushes vão pela conta `vinicius1209`; "Repository not found" =
  `gh auth switch --user vinicius1209`.
- **Package manager = `bun`**. Testes: `bun run test` (vitest, pt-BR). Build: `./scripts/build.sh test`.

## O que ficou DELIBERADAMENTE de fora (E4 — não é dívida, é escopo)

- **Mesa / grupo salvo** (um conjunto de especialistas reusável).
- **Especialista-de-síntese** (alguém que fecha o debate).
- **Auto-pitaco** (a persona entrando sozinha, sem `@`).

São **aditivos opt-in pós-MVP, jamais modo** (respeita `autonomy.md`). Só entram com pedido
explícito. Toda a supervisão hoje reusa ADR-013/021/024 — **nenhuma trava nova**.

## Follow-ups pequenos (nada bloqueia)

- Nenhum pendente crítico. O código morto do `ComposerShell` já saiu; branches já limpas.
- Se um dia a Arena/Fusion quiserem menção atômica, o `LexicalComposer` já é reusável via
  o slot `input` do `ComposerShell` (hoje só o console usa).

## Como validar rápido

```
bun run test            # vitest — 1480 passando
(cd app && bunx tsc --noEmit)
./scripts/build.sh test # portão real
open builds/test/*/Frota.app   # sempre abrir o build de teste
```
