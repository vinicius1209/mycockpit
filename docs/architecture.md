# Arquitetura atual

> Documento vivo, revisado em 05/09/2026. Para comportamento por agente, as
> fontes executáveis são `app/src-tauri/src/adapters.rs` e os espelhos
> `app/src/lib/agents.ts` + `app/src/lib/agentTooling.ts`. Planos e matrizes
> datadas explicam decisões, mas não substituem esses registries.

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
   adapters    Tool/Capability  serviços locais
        │      catalog + policy git, fs, tray,
        │       + gateways      browser, STT
        │                       Companion, STT
        ▼
             adapters registrados
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
| mapa vivo da conversa | `store/conversationMaps.ts` | semântico derivado; pins humanos e fatos canônicos vencem a geração |
| alterações do projeto | Git via `lib/git.ts` | consulta sob demanda; a UI não antecipa stage, descarte, commit ou pull request |
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

## Ciclo de vida da saída

`app/src-tauri/src/quit.rs` é a única fronteira de saída definitiva. Fechar a
janela principal continua sendo ocultação quando `Continuar ao fechar` está
ativo. `Cmd+Q`, o menu nativo, a barra de menus e o botão vermelho sem
continuidade apenas solicitam a saída ao coordenador.

A primeira passagem de `RunEvent::ExitRequested` é impedida. O Rust consulta os
donos reais de runs, processos, navegador, plugins, ditado, inferências,
updates e Companion; automações vêm do SQLite, e o snapshot do instrumento
complementa trabalho diferido e sessões externas. Havendo consequência, uma confirmação
nativa mantém `Continuar no Frota` como ação segura. Só depois do aceite a
admissão fecha, os recursos próprios drenam com prazo e a segunda passagem é
liberada. Sessões observadas no Terminal nunca recebem sinal.

## Runner e adapters

- `app/src-tauri/src/agent.rs`: ciclo de vida do processo, Channel e eventos.
- `app/src-tauri/src/quit.rs`: inventário, confirmação nativa, latch de duas
  passagens, teardown limitado e recibo local sem conteúdo sensível.
- `app/src-tauri/src/adapters.rs`: trait, capabilities e tradução dos streams.
- `app/src/lib/agents.ts` + `app/src/lib/agentTooling.ts`: espelho usado pela UI,
  separado por domínio e coberto por testes-gêmeos de contrato.
- `app/src-tauri/src/mcp_control.rs`: registry, bindings, health, policy tipada
  de preflight e transporte MCP efetivo por projeto e agente.
- `app/src-tauri/src/run_manifest.rs`: snapshot sanitizado das instruções,
  fontes, omissões opcionais e recursos realmente materializados antes do spawn.
- `app/src-tauri/src/resource_broker.rs`: recursos operados por tools, dono,
  evidência e resolução fail-closed do navegador do projeto.
- `app/src-tauri/src/experience_broker.rs`: uma lease de piloto por navegador
  de projeto, compartilhada por runs, plugins e takeover humano.
- `app/src-tauri/src/browser.rs`, `browser_cdp.rs` e `browser_panel.rs`: ciclo
  de vida do Chromium isolado, inventário/preview/input CDP e janela própria;
  WebSockets e frames nunca entram no manifesto ou no banco.
- `app/src-tauri/src/notch.rs` e `hud.rs`: geometria de tela medida e presenter
  nativo do instrumento, separado do snapshot renderizado.
- `app/src-tauri/src/desktop.rs`: sondas reais de Screen Recording e
  Accessibility; permissão não equivale a controller materializado.
- `app/src-tauri/src/plugin_manifest.rs`: schema fechado, paths contidos,
  fingerprint e inventário sem efeito de plugins.
- `app/src-tauri/src/plugin_grants.rs` e `plugin_control.rs`: consentimento
  renovável, auditoria e projeção única para Configurações.
- `app/src-tauri/src/plugin_runtime.rs` e `plugin_protocol.rs`: worker efêmero
  supervisionado e protocolo JSON Lines fechado.
- `app/src-tauri/src/plugin_contributions.rs`: skills namespaced e revalidação
  da proveniência invocada, sem escrever em diretórios de provider.
- `app/src-tauri/src/plugin_mcp.rs`: definições MCP por run, health e launcher
  stdio supervisionado com descriptor efêmero.
- `app/src-tauri/src/tool_gateway.rs`: Tool Catalog por run, hoje materializado
  como o MCP interno `mc-tools` para adapters com essa capability.
- `app/src-tauri/src/work_gateway.rs`: processos longos iniciados por ferramenta
  e telemetria de trabalho.
- `app/src-tauri/src/utility.rs`: gateway tipado e limitado para inferências
  auxiliares; o mapa usa o sidecar one-shot `intelligence/main.swift` no Mac.
- `app/src-tauri/src/git.rs` e `app/src/lib/git.ts`: fronteira de controle de
  versão; caminhos e repositório são validados antes de efeitos, e o descarte
  do diretório de trabalho preserva o índice preparado.
- `app/src/lib/utility/` e `app/src/lib/conversationMap/`: scheduler comum,
  perfis de finalidade, projeção factual, validação semântica e composição.
- `app/src/lib/tooling.ts` e `app/src/lib/resources.ts`: espelho do manifesto,
  materializadores e claims de navegador/desktop.
- `app/src/components/settings/LocalResourcesSettings.tsx` e
  `ExtensionsSettings.tsx`: posse de recursos e extensões separadas de MCP.

O contrato conceitual e a evidência histórica por versão estão em
[`agent-runner.md`](./agent-runner.md). Matrizes datadas precisam ser verificadas
novamente antes de alterar uma capability.

Na interface, `DiffIndex` é o índice estreito de controle de versão.
`GitSection` organiza os conjuntos preparado e não preparado, enquanto a aba
principal de diff continua responsável pela leitura. `CommitComposer` e
`PrComposer` iniciam efeitos somente após gesto humano; erros voltam para a
superfície em vez de serem convertidos em repositório vazio.

Tools, MCPs, skills, plugins e recursos locais têm domínios separados. O
contrato, a comparação com Orca/Paseo e a migração estão em
[`capability-tooling-architecture.md`](./capability-tooling-architecture.md).

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
- `conversation_maps`, `conversation_map_pins`: leitura derivada e correções
  humanas em registros separados;
- `utility_inference_usage`: observação de fonte, latência, sucesso e custo
  conhecido ou desconhecido por finalidade;
- `missions`, `deliveries`, `stage_runs`: execução e evidência das Features;
- `mcp_servers`, `mcp_bindings`, `mcp_health`: control plane MCP;
- `plugin_grants`, `plugin_audit_events`: decisão humana atual e trilha recente
  de grants, enablement e chamadas de plugin.

O app é local-first. Identificadores como `mycockpit.db`, `.mycockpit/`,
`mc.app` e `dev.vinicius.mycockpit` permanecem por compatibilidade e não são a
marca pública.

## Regras de extensão

- Capability nova entra nos registries Rust e TypeScript, com teste-gêmeo.
- Evento desconhecido vira `Unknown`; pré-condição ausente aborta o efeito.
- Estado de execução, custo e decisão tem uma fonte única.
- Mudança estrutural recebe ADR em `docs/decisions.md`.
- Mudança visível segue `docs/STYLEGUIDE.md` antes da implementação.
- Processo separado de plugin é contenção de ciclo de vida, não uma alegação de
  sandbox completo do sistema operacional.
