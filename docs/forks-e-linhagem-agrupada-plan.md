# Forks agrupados na Sidebar e abas de ramos no palco (plano)

> Status: **F1 a F3 e comparação de leitura entregues** (03/09/2026).
> **Correção de entrega:** o comparador carrega os dois históricos sem roubar
> a seleção, permite escolher qual ramo continua ativo e descartar uma
> alternativa com a limpeza já centralizada em `removeConversation`. Promoção
> de código, merge e composers independentes continuam fora desta entrega.
> Trocar a conversa ativa não é “promover”; essa ação só entra quando houver
> efeito Git real e confirmação humana.
> Nasceu da auditoria de UX sobre a dissonância da aba `[ Conversa ] [+]`: ao duplicar
> ou forkar um turno, a conversa filha nascia solta no rodapé da lista do projeto
> na sidebar, e o topo continuava exibindo uma única aba genérica. A evolução une
> o modelo de árvore na sidebar com comutação de ramos no palco e split view opcional.

---

## 1. O diagnóstico arquitetural

Hoje, `forkConversationAtImpl` ([`app/src/store/chat/clone.ts`](file:///Users/viniciusmachado/projetos/mycockpit/app/src/store/chat/clone.ts#L204)) gera uma nova conversa com título `Nome (fork)` e isolamento em git worktree (`isolateFork`). Porém:

1. **Ausência de parentesco no banco:** a tabela `conversations` não registra quem gerou quem. A conversa filha é inserida como irmã plana no fim de `conversationsByProject[owner]`.
2. **Dissonância espacial no palco:** a barra de abas do centro ([`MainTabs.tsx`](file:///Users/viniciusmachado/projetos/mycockpit/app/src/components/layout/MainTabs.tsx)) exibe apenas a aba fixa `[ Conversa ]` e o botão `+`. Clicar em "Fork do último turno" cria uma linha distante na sidebar e substitui o chat inteiro, em vez de abrir o ramo ao lado.
3. **Custo de worktrees invisível:** o fork cria um worktree no disco (`.mycockpit/worktrees/`), mas a interface não oferece um fechamento semântico (promover o patch vencedor para a branch principal ou descartar o experimento limpando a pasta).

---

## 2. O modelo mental corrigido

O trabalho mantém a serenidade e fluidez linear do estilo ChatGPT para o caso comum, mas ganha estrutura de engenharia quando ramificado:

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│ PROJETO: mycockpit                                                                     │
├──────────────────────────┬─────────────────────────────────────────────────────────────┤
│ SIDEBAR (Árvore)         │ PALCO PRINCIPAL (Abas de Ramos da Tarefa)                   │
│                          │                                                             │
│ ▼ mycockpit              │ [ 🗩 Original ]  [ 🗩 Fork: Split views ]  [+]  │ [◫ Split]  │
│   estudo-arquitetura     ├─────────────────────────────────────────────────────────────┤
│   ▼ sobre-abas (2 ramos) │                                                             │
│     ↳ Original (Turno 1) │ CHAT / STAGE:                                               │
│     ↳ Fork: Split views  │ • Foco serial respirável em um ramo por vez                 │
│   sobre-permissoes       │ • Ou Split View lado a lado sob demanda                     │
│                          │                                                             │
└──────────────────────────┴─────────────────────────────────────────────────────────────┘
```

1. **Na Sidebar (Biblioteca):** conversas sem forks permanecem como itens normais de lista. Quando uma conversa tem forks (ou é ela própria um fork), ela é renderizada agrupada em um cluster pai-filho (`GroupedTaskCluster`).
2. **No Palco (Mesa de Trabalho):** a tira de abas superior deixa de ter o rótulo abstrato `[ Conversa ]` e passa a refletir os **Ramos da Linhagem Ativa**:
   * Aba 1: `[ 🗩 Original ]`
   * Aba 2: `[ 🗩 Fork: Split views ]`
   * `[ + ]`: abre o dropdown para criar um novo fork a partir do último turno ou duplicar.
3. **Split View sob Demanda (`[ ◫ Split ]`):** um botão na ponta da barra de abas divide o cartão em duas colunas (50/50), colocando o Ramo Original à esquerda e o Fork à direita para comparação imediata de raciocínio e diffs.

---

## 3. Modelo de dados e migração

### 3.1 Migração SQLite (Rust / Tauri)
Em [`src-tauri/src/lib.rs`](file:///Users/viniciusmachado/projetos/mycockpit/app/src-tauri/src/lib.rs), a versão máxima atual é 42 (`create_plugin_audit_events`). A nova migração será a **43**:

```rust
Migration {
    version: 43,
    description: "add_parent_id_to_conversations",
    sql: "ALTER TABLE conversations ADD COLUMN parent_id TEXT REFERENCES conversations(id) ON DELETE SET NULL;",
    kind: MigrationKind::Up,
}
```

### 3.2 Espelho no Frontend (`schema.ts`)
Em [`app/src/lib/db/schema.ts`](file:///Users/viniciusmachado/projetos/mycockpit/app/src/lib/db/schema.ts), garantir a idempotência no boot para ambientes de desenvolvimento e teste:

```ts
export async function ensureConversationHierarchySchema(db: Database): Promise<void> {
  await addColumn(
    db,
    "ALTER TABLE conversations ADD COLUMN parent_id TEXT REFERENCES conversations(id) ON DELETE SET NULL",
  )
}
```

### 3.3 Metadados da Conversa (`ConversationMeta`)
Em [`app/src/lib/db/conversations.ts`](file:///Users/viniciusmachado/projetos/mycockpit/app/src/lib/db/conversations.ts):

```ts
export interface ConversationMeta {
  id: string
  title: string | null
  updatedAt: number
  color: string | null
  worktreePath: string | null
  agent: string | null
  parentId?: string | null // Id da conversa de origem (null se for raiz)
  hasDraft?: boolean
}
```

---

## 4. Fases de implementação

### Fase F1 · Persistência de Parentesco e Rastreio de Linhagem
* **Objetivo:** registrar quem é pai de quem no momento do fork/duplicação sem quebrar retrocompatibilidade com conversas já existentes.
* **Tarefas:**
  1. Adicionar Migration 43 em `src-tauri/src/lib.rs` e `ensureConversationHierarchySchema` em `schema.ts`.
  2. Atualizar queries `SELECT` e `UPDATE` em `lib/db/conversations.ts` para carregar e gravar `parent_id`.
  3. Ajustar `forkConversationAtImpl` e `duplicateConversationImpl` em [`store/chat/clone.ts`](file:///Users/viniciusmachado/projetos/mycockpit/app/src/store/chat/clone.ts) para receber o `parentId` e persisti-lo.
  4. Testes de unidade em `store/chat/clone.test.ts` cobrindo linhagem pai/filho e preservação de metadados.

### Fase F2 · Renderização Agrupada na Sidebar (`ConversationList.tsx`)
* **Objetivo:** agrupar conversas que pertencem à mesma família em um bloco sanfonado com recuo sutil.
* **Tarefas:**
  1. Criar helper selector puro `buildConversationTree(metas: ConversationMeta[])`:
     * Agrupa filhos sob a conversa raiz (`parentId == null` ou pai original).
     * Se uma conversa filha for selecionada, o grupo pai expande automaticamente.
  2. Criar componente `GroupedTaskRow.tsx` em `components/layout/Sidebar/`:
     * Cabeçalho com o título da tarefa base e badge de quantidade de ramos (`2 ramos`).
     * Lista de ramos aninhada com o glifo `↳` e rótulo do ramo (`Original`, `Fork: abordagem B`).
     * Suporte ao menu de contexto (renomear, duplicar, excluir ramo, alterar cor).
  3. Preservar o drag-and-drop (`convDnd`) entre grupos no mesmo projeto.

### Fase F3 · Abas de Ramos no Palco Principal (`MainTabs.tsx`)
* **Objetivo:** fazer com que as abas do centro representem os ramos da família de conversas ativa.
* **Tarefas:**
  1. Identificar a família ativa:
     * Raiz: `activeConv.parentId ?? activeConv.id`.
     * Ramos irmãos: todas as conversas do projeto cujo `id === raizId` ou `parentId === raizId`.
  2. Se a conversa ativa tiver 2 ou mais ramos, `MainTabs` desenha uma aba para cada ramo:
     * `[ 🗩 Original ]` `[ 🗩 Fork #1 ]` `[ + ]`.
  3. Clicar em uma aba faz `switchConversation(ramoId)` instantâneo (reutilizando a montagem em cache sem remount de árvore).
  4. O botão `+` abre o menu existente ("Fork do último turno", "Duplicar conversa"), criando um novo ramo já associado ao mesmo pai.

### Fase F4 · Split View de Ramos e Ações de Ciclo de Vida
* **Objetivo:** permitir comparação visual lado a lado e resolução definitiva de forks.
* **Tarefas:**
  1. Adicionar estado `branchSplitOpen: boolean` e `branchSplitTargetId: string | null` em `store/app.ts`.
  2. Botão `[ ◫ Split Ramos ]` na ponta direita de `MainTabs.tsx`.
  3. No `AppShell.tsx`: quando o split de ramos estiver ativo, o container de chat divide em duas colunas (50/50), exibindo o ramo base e o fork lado a lado com composers independentes.
  4. Ciclo de Vida do Ramo:
     * Botão no cabeçalho do fork: **"Promover Ramo"** (aplica o diff do worktree na branch base via git merge/cherry-pick e arquiva o fork).
     * Botão **"Descartar Ramo"** (confirmação humana com limpeza de pasta via `removeWorktree`).

---

## 5. As guardas e critérios de aceitação

1. **A decisão é humana:** nenhum fork é promovido, mergeado ou deletado automaticamente; a confirmação é sempre explícita da pessoa.
2. **Zero remount de chat:** alternar entre abas de ramos da mesma tarefa usa toggle por CSS (`hidden`), preservando rascunhos de composer (`useComposerDrafts`) e posição de rolagem.
3. **Catracas do projeto:**
   * Nenhum arquivo novo acima de 500 linhas.
   * `bun run check` sem erros de lint ou estilo.
   * `cargo test` e `bun run test` 100% verdes.
   * Copy estritamente em pt-BR, sem travessões.
