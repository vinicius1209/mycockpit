# Capabilities, tools, extensões e recursos

> Status em 30/08/2026: contrato v4, manifesto efetivo, Tool Catalog, skills e
> MCPs de plugins, grants renováveis, processos supervisionados, Resource Broker
> e nova arquitetura de Configurações implementados. Decisões canônicas:
> ADR-126 a 130.

## O problema que esta arquitetura resolve

A tela antiga tratava MCP como se fosse sinônimo de ferramenta e misturava, no
mesmo cartão, descoberta de configuração, health, binding por projeto,
instalação permanente no CLI e posse de navegador. Isso escondia quatro fatos:

- providers já possuem tools nativas, mesmo sem MCP;
- MCP é um transporte possível, não a entidade de produto;
- skills, plugins e apps podem produzir instruções, tools, UI ou conexões, com
  ciclos de vida e riscos diferentes;
- navegador e controle do macOS são recursos com identidade e posse, não apenas
  checkboxes num servidor MCP.

O resultado prático era uma UI incapaz de responder a pergunta principal:
**o que este run recebeu, por qual caminho e sob controle de quem?**

## O que a comparação local ensinou

| Fonte auditada | Acerto aproveitado | Limite que a Frota mantém |
|---|---|---|
| Paseo | `PaseoToolCatalog` é independente do transporte; o mesmo catálogo é serializado para MCP e injetado como host tools quando o runtime suporta | não copiar seu daemon ou despacho entre agents; a decisão continua humana |
| Orca | Browser e Computer Use são superfícies distintas, com alvo explícito (`worktreeId`, `browserPageId`); plugins têm manifest, capabilities, consentimento e processo supervisionado | não copiar a dependência de Electron nem tratar UI embutida como capability universal |
| Frota | adapters e eventos normalizados já isolam diferenças de provider; bindings MCP por projeto permitem preflight | deixar de centralizar o domínio em MCP e publicar o estado efetivo do run |

Evidência principal da comparação: `paseo/packages/server/src/server/agent/tools/types.ts`,
`paseo/packages/server/src/server/agent/providers/omp/host-tools.ts`,
`paseo/packages/server/src/server/agent/mcp-server.ts`,
`orca/src/main/runtime/orca-runtime-browser.ts`,
`orca/src/shared/plugins/plugin-manifest.ts`,
`orca/src/shared/plugins/plugin-capabilities.ts` e
`orca/src/main/plugins/plugin-host-process.ts`.

## Modelo de domínio

```text
Skill · Plugin · App · MCP externo · Frota · Provider
                         │
                         ▼
               Capability / Tool Catalog
                         │
                         ▼
                    Policy Engine
                         │
              ┌──────────┴──────────┐
              ▼                     ▼
      EffectiveRunManifest    Resource Broker
              │                     │
              └──────────┬──────────┘
                         ▼
                 Provider Adapter
```

### Capability

Possibilidade que um adapter, extensão ou recurso declara. Capability não é
prova de disponibilidade: o registry informa o mecanismo suportado; preflight e
manifesto informam o estado deste run.

### Tool

Operação chamável, identificada por nome e origem. A definição pode incluir
schema, risco e handler, mas não carrega a decisão de transporte.

### Materializador

Como uma fonte entrega tools ao motor. O vocabulário v1 suporta:

- `provider-native`: tools que pertencem ao runtime;
- `frota-gateway`: catálogo interno e versionado, hoje materializado por MCP;
- `external-mcp`: servidor externo descoberto e roteado;
- transportes `native`, `mcp`, `cli` e `acp`.

Cada materializador declara duas dimensões independentes:

| Dimensão | Valores | Significado |
|---|---|---|
| escopo | run, project, user, global | por quanto tempo a configuração sobrevive |
| força | hard, advisory | se a Frota garante exatamente a superfície ou depende de estado do provider |

Inventário também é evidência, não booleano:

- `declared`: catálogo fixo da Frota;
- `probe`: `tools/list` observado antes do run;
- `runtime-count`: handshake publica a contagem, completada pelo evento de sessão;
- `opaque`: não existe catálogo completo auditado.

### Manifesto efetivo do run

`run_manifest.rs` monta um snapshot sanitizado depois que gateways e policy
foram materializados e antes do spawn. O evento normalizado `run_manifest`
entrega ao frontend:

- adapter escolhido;
- instruções de plugin invocadas e revalidadas;
- fontes e transportes;
- escopo e força de cada fonte;
- nomes/contagem somente quando observados;
- notices e motivo de bloqueio;
- se o conjunto externo está em modo gerenciado;
- recursos locais resolvidos, dono, evidência, estado e caminho de entrega;
- um marcador explícito quando recursos do provider não puderam ser observados.

Launch, argv, env, headers, URLs sensíveis e credenciais nunca entram no
manifesto. A faixa **Capacidades deste run** mostra o snapshot junto ao composer
e não o persiste: depois de reiniciar, um preflight antigo não vira estado atual.

### Resource Broker

Recursos possuem identidade, dono e política próprios. O primeiro contrato
endurecido é o navegador do projeto:

- identidade: projeto;
- dono: processo da Frota;
- entrega: binding explícito para um materializador compatível;
- política atual: binding marcado exige endpoint vivo;
- falha: bloqueio antes do spawn, nunca abertura silenciosa de outro browser.

Computer Use do macOS é outro `ResourceKind`. O broker já mede Screen Recording
e Accessibility por APIs nativas, mas continua separando permissão do SO de
materialização. O catálogo distingue `project-browser`, `external-browser` e
`desktop-control`:

- o primeiro é forte, possuído pela Frota e resolvido pelo binding antes do spawn;
- os dois últimos são claims advisory observados em integrações dos providers;
- fingerprints de integração usam allowlist exata e independente de provider;
- alias desconhecido fica “não classificado”, nunca recebe permissão por substring.

Um `computer-use` global pode, portanto, aparecer na UI sem a Frota fingir que
consegue concedê-lo ou revogá-lo por run. O estado TCC publicado é resultado de
sonda nativa; mesmo com ambos os grants, `controllerAvailable=false` até existir
um materializador próprio.

O navegador possui um segundo eixo: **piloto**. `ExperienceBroker` permite uma
lease por projeto para run, chamada de plugin ou pessoa. Inventário e screencast
são observação e não exigem lease; todo input exige. A posse de run/plugin cai
por RAII e a humana usa token/heartbeat com expiração. O Chromium nasce em
segundo plano e o painel próprio consome o mesmo target CDP sem expor WebSocket.

Tools de plugin usam leases efêmeros. O preflight resolve o recurso ao montar o
catálogo do run e a chamada revalida antes do spawn:

- `project-browser` só fica pronto se o Chromium do projeto já estiver vivo;
- o endpoint CDP só entra no ambiente do worker durante a lease;
- `external-browser` é bloqueado, sem fallback para outro Chrome ou Firefox;
- `desktop-control` é bloqueado até existir um controller próprio por run;
- fechar Configurações, aprovar plugin ou montar catálogo nunca inicia recurso.

### Extensões

Os nomes abaixo não são intercambiáveis:

| Tipo | Papel | Pode contribuir |
|---|---|---|
| skill | instrução versionada e recursos de apoio | prompt, assets e scripts declarados |
| plugin | pacote instalável com manifest e consentimento | skills, materializadores, comandos, UI e apps |
| app | conexão autenticada com serviço | tools e recursos remotos |
| MCP | protocolo/transporte de tool e resource | tools externas, prompts e resources |

`plugin_manifest.rs` implementa a fronteira do plugin v1:

- `frota-plugin.json` com schema fechado, API/engine gate e ids seguros;
- capabilities em allowlist, contribuição MCP exige `mcp:provide`;
- todos os paths são relativos e precisam permanecer dentro do pacote;
- todo arquivo regular do pacote entra no fingerprint, em ordem estável;
- symlink é recusado e a leitura tem limites de entradas, arquivos e bytes;
- versão usa SemVer real; erro de leitura ou identidade duplicada falha fechado;
- pacotes em `app_data/plugins` são inventariados sem executar código.

`plugin_grants.rs`, `plugin_runtime.rs`, `plugin_contributions.rs`,
`plugin_mcp.rs` e `tool_gateway.rs` completam o ciclo:

1. a pessoa revisa a combinação exata de chave, fingerprint e capabilities;
2. grant e auditoria mudam na mesma transação; ele pode ser desativado sem
   perder a revisão ou revogado;
3. somente plugins com grant atual e ligado entram no Tool Catalog do run;
4. adapters com MCP por run recebem `mc-tools` por configuração efêmera;
5. uma chamada volta ao processo da Frota, revalida pacote, grant e recurso;
6. só então nasce um worker separado, que termina ao fim daquela chamada.

Skills aprovadas ganham namespace estável e são expandidas pelo app para
qualquer adapter. O runner revalida o claim antes do spawn e registra a origem
no manifesto v4. MCPs contribuídos passam por conformance estática e health por
run; stdio usa um launcher da Frota com descriptor 0600 e HTTP recusa
credenciais literais. Adapter sem MCP forte por run degrada com notice, nunca
com escrita escondida em configuração global.

O worker fala JSON Lines v1, tem frame de 1 MiB, handshake de 4 s, chamada de
120 s, encerramento de 2 s, stderr drenado com retenção limitada, ambiente
reconstruído por allowlist e grupo de processo próprio. Abrir a tela, descobrir,
aprovar ou habilitar não faz spawn. O catálogo usa nomes estáveis como
`plugin__publisher_id__tool_id` e não autoaprova a tool no provider.

Processo separado contém crash, timeout e órfãos; não é sandbox completo do
sistema operacional. Capabilities são declarações revisadas e gates para o que
a Frota entrega, não uma promessa de bloquear syscalls arbitrárias do executável.
Por isso a UI diz explicitamente que plugin com `main` é código local confiável.
O ambiente não recebe segredos arbitrários e a capability `secrets:read` ainda
não possui host API. O protocolo completo está em [`plugin-runtime.md`](./plugin-runtime.md).

Alterar capability, manifesto ou qualquer arquivo regular do pacote invalida o
consentimento. O pacote falha fechado ao exceder 4.096 entradas, 2.048 arquivos,
32 MiB por arquivo ou 128 MiB no total; o manifesto tem limite próprio de 128 KiB.
Uma skill sem código não recebe implicitamente permissões de plugin. O contrato
de autoria vive em [`../plugin-sdk`](../plugin-sdk/README.md); seus exemplos são
testados pelo parser e pelo probe reais do app.

## Arquitetura de informação de Configurações

A navegação segue perguntas humanas, não detalhes de transporte. O rail expande
somente o domínio ativo; busca e deep links continuam chegando à seção exata:

1. **Agentes:** quais motores existem e o que cada adapter suporta.
2. **Capacidades e permissões:** quais efeitos podem ocorrer e com qual policy.
3. **Navegador e desktop:** recursos locais, posse, alvo e grants.
4. **Conexões:** contas, apps e serviços autenticados.
5. **MCPs:** descoberta, health e bindings, sem controlar o ciclo de vida do browser.
6. **Extensões:** skills/comandos efetivos por adapter e plugins descobertos,
   com capabilities, fingerprint e estado de execução explícito.

O preflight do run permanece na conversa. Configurações explica intenção e
estado durável; o manifesto junto ao composer mostra o resultado efetivo.

## Migração

- [x] separar materializador, transporte, escopo, força e evidência no registry;
- [x] espelho TypeScript com testes-gêmeos;
- [x] carregar nomes reais de tools do probe MCP até o plano;
- [x] emitir e renderizar o manifesto efetivo do run;
- [x] tornar o navegador marcado fail-closed;
- [x] inventariar MCPs nativos de Agy e OpenCode sem tratá-los como binding portável;
- [x] introduzir Tool Catalog interno e materializá-lo como MCP por run;
- [x] extrair navegador/desktop da tela de MCP e aplicar a nova arquitetura de informação;
- [x] implementar schema, validação, fingerprint e inventário de plugins;
- [x] implementar consentimento persistido e host supervisionado de plugins;
- [x] aplicar leases efêmeros de recursos às chamadas de plugin;
- [x] materializar skills e definições MCP contribuídas por plugin;
- [ ] adicionar materializadores native/ACP para adapters que os suportarem;
- [x] adicionar Resource Broker v1 para browser e claims advisory de desktop;
- [x] adicionar arbitragem forte de piloto e sondas do SO para desktop;
- [ ] materializar controller de desktop por run e brokers de portal no Linux.

## Guardas

- código genérico consulta capabilities, nunca id de provider;
- uma fonte opaca continua opaca na UI, zero nunca substitui desconhecido;
- configuração persistente de provider é `advisory` até existir controle real;
- binding que promete recurso específico falha fechado se o recurso não existe;
- todo efeito continua dependendo de gesto humano;
- qualquer capability nova entra nos registries Rust/TS e nos testes-gêmeos.
- “capability concedida” nunca vira alegação de sandbox que o SO não impõe.
