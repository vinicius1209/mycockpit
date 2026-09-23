# Plano · cortar os arquivos grandes

Status em 23/09/2026: plano aprovado para execução em fatias; nada cortado
ainda. A catraca de tamanho passou a cobrir o Rust (ADR-232), então nenhum
destes arquivos pode crescer enquanto espera a vez.

## Por que

Arquivo grande é opaco: quem mexe lê centenas de linhas que não são da tarefa,
e a mudança esbarra em vizinho que ninguém revisou. Foi dentro do
`MessageList.tsx` de 2.800 linhas que 11 varreduras O(N) se esconderam, e é o
motivo de a catraca existir.

| arquivo | linhas | teto | o que mora nele hoje |
|---|---|---|---|
| `app/src-tauri/src/adapters.rs` | 7.733 | 1.000 | contrato (`RunRequest`, `Capabilities`, trait, registry) + 4 adapters + ~3.400 linhas de teste |
| `app/src/store/chat.ts` | 2.136 | 500 | ~60 ações do store: navegação, sessão, streaming (`handleEvent`, `handleWorkEvent`), fila, fusão, transplante |
| `app/src/lib/db.ts` | 2.023 | 500 | projetos, fusão, missões, entregas, propostas, ledger de custo, lições, presets, quadro de cards |
| `app/src/components/chat/MessageList.tsx` | 1.481 | 700 | `ToolLine`, `ToolNodeList`, `ToolGroup`, `MessageItem` e a lista |

## Regras de toda fatia

1. **Mover, não reescrever.** Uma fatia só muda onde o código mora. Nenhum
   comportamento novo, nenhum teste alterado além do caminho do import. Se um
   teste quebrou, a fatia está errada.
2. **Uma fatia por commit**, com as suítes inteiras (`bun run test`,
   `bunx tsc -b --force`, `cargo test -- --skip emergency_release`) e
   `bun run check:file-size -- --update` para a baseline descer junto.
3. **O arquivo original vira fachada** enquanto houver import de fora
   (reexporta), e a fachada some quando os call sites migrarem.
4. **Divisão por responsabilidade, não por tamanho.** O corte segue as costuras
   que já existem (os comentários `// ----` do `db.ts`, os `impl AgentAdapter`
   do `adapters.rs`), não o número de linhas.

## As fatias, em ordem

A ordem vai do menor risco e maior ganho para o maior risco.

### 1. `adapters.rs` → `adapters/`

O corte mais limpo: cada motor já é um `impl AgentAdapter` separado.

- `adapters/mod.rs`: `RunRequest`, `Capabilities`, o trait, o registry
  (`resolve`, `capabilities_of`, `registered_agents`) e os helpers
  compartilhados;
- `adapters/claude.rs`, `codex.rs`, `agy.rs`, `opencode.rs`: um por motor,
  cada um com os próprios testes;
- `adapters/contrato_tests.rs`: os testes que atravessam todos os motores
  (matriz de capabilities, `negar_mcp_so_chega_ao_argv_de_quem_declara`).

Risco: `pub(crate)` que hoje é privado ao arquivo. Mitigação: `pub(super)`.

### 2. `db.ts` → `lib/db/<domínio>.ts`

`lib/db/` já existe (`conversations.ts`, `conversationItems.ts`, `schema.ts`).
Cada seção `// ----` vira um arquivo: `projects.ts`, `fusion.ts`,
`missions.ts`, `ledger.ts`, `lessons.ts`, `presets.ts`, `board.ts`. O `db.ts`
fica com `getDb`/`isTauri` e reexporta os demais até os imports migrarem.

Risco: baixo; são funções independentes sobre `getDb()`.

### 3. `MessageList.tsx` → `components/chat/mensagens/`

`ToolLine`, `ToolNodeList`, `ToolGroup` e `MessageItem` já são componentes
`memo` isolados: cada um no seu arquivo. O `MessageList` fica com a lista, o
scroll e a virtualização.

Risco: médio. Identidade de `memo` e props estáveis precisam sobreviver ao
corte; conferir com os testes de render e o perf do fio (ADR-122).

### 4. `chat.ts` → fatias de `store/chat/`

O mais delicado, e por isso o último. `store/chat/` já tem o molde
(`navigation.ts`, `clone.ts`, `itemPersistence.ts`): funções que recebem
`get`/`set` e são ligadas no `create`. Candidatos, na ordem:

1. `handleWorkEvent` (~180 linhas) → `store/chat/eventosDeTrabalho.ts`;
2. fila e sugestões (`enqueue`, `dequeueQueued`, `removeQueued`,
   `*Suggestions`) → `store/chat/fila.ts`;
3. revezamento de motor (`passWheel`, `returnWheel`, `beginTransplant`) →
   `store/chat/revezamento.ts`;
4. `handleEvent` (~190 linhas, o reducer do streaming) por último, com as
   fixtures reais de stream.

Risco: alto em `handleEvent`, porque é o caminho quente de todo token. Ele
só se move depois das três primeiras, com medição antes e depois.

## Fora deste plano

`store/mission.ts` (1.260), `ChatPanel.tsx` (1.016) e os outros congelados
seguem a mesma regra quando alguém precisar mexer neles: quem mexe, corta.
