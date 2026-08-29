# Arquitetura atual

> Documento vivo, revisado em 29/08/2026. Para comportamento por agente, as
> fontes executáveis são `app/src-tauri/src/adapters.rs` e o espelho
> `app/src/lib/agents.ts`. Planos e matrizes datadas explicam decisões, mas não
> substituem esses registries.

## Mapa geral

```text
React 19 (Painel | Trabalho | Features)
        │
        ├── zustand: navegação, transcript, execuções e estado de UI
        ├── SQLite: projetos, conversas, rascunhos, custo e artefatos
        │
        └── Tauri IPC + Channel
                    │
              Runner Rust
                    │
        ┌───────────┼───────────────┐
        │           │               │
   adapters     MCP control     serviços locais
        │       + gateways      git, fs, tray,
        │                       Companion, STT
        ▼
Claude Code · Codex · Antigravity · OpenCode
```

A UI conhece eventos normalizados, nunca o stream particular de um fornecedor.
O adapter traduz a saída da CLI e declara capacidades; componentes genéricos
consultam o registry, não comparam ids de agentes.

## Superfícies e navegação

As três superfícies permanentes estão em
`app/src/components/layout/titleBarModes.ts`:

| Superfície | Objeto principal |
|---|---|
| **Painel** | retrospectiva de custo e entregas |
| **Trabalho** | conversas e execução dos agentes |
| **Features** | especificação e entrega com gates |

Agendamentos, Planos de voo e Frota são workspaces globais. Conversas podem
continuar executando quando outra superfície ou outro projeto está visível; a
sidebar e a faixa de status exibem o estado real sem transformar seleção em
atividade.

## Donos de estado no frontend

| Estado | Dono | Regra |
|---|---|---|
| projeto, configurações e navegação | `store/app.ts` | configuração global e seleção de superfície |
| transcript, sessão e execução da conversa | `store/chat.ts` | estado operacional; não recebe digitação do composer |
| texto e anexos ainda não enviados | `store/composerDrafts.ts` | durável por conversa; persiste em `conversation_drafts` |
| permissões e perguntas pendentes | `store/interactions.ts` | uma fila real compartilhada pela UI e pelo Companion |
| notas | `store/stickyNotes.ts` | só entram no prompt por menção ou gesto explícito |
| missões, disputas, cards e worktrees | stores próprias | não duplicar esses estados no chat |

Zustand + efeitos é o padrão das superfícies atuais. Existe um
`QueryClientProvider` na raiz, mas ele não é fonte de verdade dessas stores e
não autoriza introduzir TanStack Query numa superfície que já segue store +
efeito.

## Fluxo de uma conversa

1. O composer lê e grava `useComposerDrafts` para o `activeId`.
2. O gesto de enviar resolve projeto, cwd, permissão, agente, modelo e anexos.
3. O frontend inicia o turno em `store/chat.ts`; `agent.rs` abre a CLI e envia
   `AgentEvent` normalizado por `Channel`.
4. O reducer anexa eventos ao transcript e persiste `conversations.items`.
5. Só depois do envio aceito o rascunho é limpo. Trocar de conversa ou reiniciar
   o app não apaga texto nem anexos pendentes.

O scroll do Trabalho pertence a `useChatScroll.ts`. Ele observa o wrapper real
do transcript recebido por `contentRef`, porque a régua de turnos e a timeline
podem precedê-lo e o wrapper keyed muda a cada conversa. Não use
`firstElementChild` nem `scrollIntoView` para reconstruir essa âncora. Ver
ADR-122.

## Runner e adapters

- `app/src-tauri/src/agent.rs`: ciclo de vida do processo, Channel e eventos.
- `app/src-tauri/src/adapters.rs`: trait, capabilities e tradução dos streams.
- `app/src/lib/agents.ts`: espelho usado pela UI, com testes-gêmeos de contrato.
- `app/src-tauri/src/mcp_control.rs`: registry, bindings, health e transporte
  MCP efetivo por projeto e agente.
- `app/src-tauri/src/work_gateway.rs`: processos longos iniciados por ferramenta
  e telemetria de trabalho.

O contrato conceitual e a evidência histórica por versão estão em
[`agent-runner.md`](./agent-runner.md). Matrizes datadas precisam ser verificadas
novamente antes de alterar uma capability.

## Persistência

O banco é SQLite local. Migrações canônicas vivem em
`app/src-tauri/src/lib.rs`, com um statement por versão. Tabelas acessadas ou
criadas pelo frontend usam funções `ensure*Tables`; o helper `addColumn` mora em
`app/src/lib/db/schema.ts` e é re-exportado por `app/src/lib/db.ts`.

Entidades centrais:

- `projects`: caminho, política e ordenação;
- `conversations`: transcript serializado, sessão, agente, modelo e contexto;
- `conversation_drafts`: texto, anexos e atualização do rascunho por conversa;
- `turn_costs`: ledger de custo por turno;
- `missions`, `deliveries`, `stage_runs`: execução e evidência das Features;
- `mcp_servers`, `mcp_bindings`, `mcp_health`: control plane MCP.

O app é local-first. Identificadores como `mycockpit.db`, `.mycockpit/`,
`mc.app` e `dev.vinicius.mycockpit` permanecem por compatibilidade e não são a
marca pública.

## Regras de extensão

- Capability nova entra nos registries Rust e TypeScript, com teste-gêmeo.
- Evento desconhecido vira `Unknown`; pré-condição ausente aborta o efeito.
- Estado de execução, custo e decisão tem uma fonte única.
- Mudança estrutural recebe ADR em `docs/decisions.md`.
- Mudança visível segue `docs/STYLEGUIDE.md` antes da implementação.
