# Preflight de capacidades sem falso incidente, plano de implementação

> Status em 01/09/2026: **implementado e validado**. A policy, o ciclo de
> aceite, os overrides de um turno, a omissão no manifesto v5, as superfícies
> secundárias e a evidência de startup foram entregues na ADR-147. Marcar um
> binding como `browser` continua proibindo que ele abra um navegador próprio,
> mas não torna o MCP obrigatório por consequência. A obrigatoriedade pertence
> somente a `required`.
>
> Incidente de origem: um binding Playwright habilitado, opcional
> (`required = false`), com `fallback = ask` e `browser = true`, impediu uma
> conversa que não pedia navegador. O backend não iniciou o CLI, mas emitiu
> `Error + Done`; a interface apresentou “Execução interrompida” e “Turno
> encerrado” para um turno que nunca começou.

## Resultado de produto

Uma integração opcional indisponível não impede uma conversa comum:

```text
pedido enviado
  → Frota calcula as capacidades efetivas
  → Playwright opcional sem navegador fica fora deste turno
  → o agent inicia com as demais capacidades
  → a faixa de capacidades registra a omissão, sem poluir o fio
```

Uma capacidade realmente exigida continua fail-closed, mas não vira erro de
execução:

```text
pedido ainda no composer
  → preflight encontra uma exigência não atendida
  → nenhum processo, sessão, custo ou turno é criado
  → a interface explica o que falta e oferece a próxima decisão humana
```

A correção não reduz liberdade, desempenho, contexto, limite ou permissão do
usuário. Ela remove um bloqueio indevido no caso opcional. Qualquer redução de
permissão ou continuação sem uma exigência só acontece por gesto explícito e
vale apenas para aquele envio.

## Veredito arquitetural

Hoje quatro conceitos estão comprimidos nos mesmos campos e mensagens:

1. o servidor está habilitado para o projeto e o agent;
2. o servidor deve usar o navegador possuído pela Frota;
3. o servidor é obrigatório para o turno;
4. a ausência pede uma decisão humana ou admite degradação.

O conserto é separar essas perguntas e dar a cada resultado um ciclo de vida
próprio:

- **binding** declara intenção durável;
- **preflight** resolve a disponibilidade deste envio;
- **manifesto** descreve somente o que entrou num turno aceito;
- **incidente terminal** descreve somente uma execução que de fato começou;
- **gate do composer** guarda uma decisão necessária antes da execução.

Não haverá classificação do texto do prompt por palavras como “browser” ou
“Playwright”. Necessidade por turno só pode vir de configuração explícita ou,
numa evolução posterior, de um gesto explícito no composer. Inferir intenção
por heurística seria atividade inventada e uma nova fonte de bloqueios falsos.

## Contratos que não podem regredir

- Sem binding explícito, preservar integralmente a configuração nativa do CLI.
- Em modo gerenciado, uma falha do control plane nunca pode reexpor MCPs globais
  removidos pela policy.
- `browser = true` nunca pode cair para o launch original que abre Chrome,
  Firefox ou outro navegador fora da Frota.
- `required = false` nunca bloqueia o turno por ausência daquele servidor ou
  recurso.
- `required = true` nunca é ignorado silenciosamente.
- Nenhum fallback muda o modo de permissão sem gesto humano.
- Nenhum preflight bloqueado produz `Result`, `Error`, `Done`, custo, token,
  notificação de turno concluído, sugestão ou auto-resume.
- Revezamento continua transacional: `beginTransplant` só nasce depois que o
  preflight aceita o envio; até lá, agent, modelo e sessão de origem ficam
  intactos.
- A decisão vem de policy e capabilities, nunca do nome do provider.
- Motivos e disposições são enums tipados; texto livre serve apenas como detalhe
  sanitizado e auditável.

## Matriz de policy

### Ausência do servidor ou do recurso associado

| Configuração | Resultado | Efeito no turno | Apresentação |
|---|---|---|---|
| `required = false`, qualquer fallback | `omit-and-continue` | remove somente esse MCP do plano | linha neutra na faixa de capacidades |
| `required = true`, `fallback = ask` | `needs-decision` | não inicia até a pessoa decidir | gate âmbar no composer |
| `required = true`, `fallback = deny` | `blocked-by-policy` | não inicia e não oferece bypass | gate âmbar com caminho de correção |
| `required = true`, `fallback = allow-readonly` | `needs-readonly-consent` | não inicia até a pessoa aceitar “Só lê” neste envio | gate âmbar com ação explícita |

O valor de `fallback` fica dormente enquanto `required = false`. A interface
preserva o valor salvo, mas só exibe o seletor quando “exigir” estiver ativo.
Isso permite ligar e desligar a exigência sem apagar a preferência.

### Casos de navegador

| Estado | Binding opcional | Binding exigido |
|---|---|---|
| navegador vivo e broker livre | injeta `--cdp-endpoint` e seleciona o MCP | igual |
| navegador desligado | omite o MCP, não usa os args de origem e continua | gate antes do turno |
| Chromium ausente | omite o MCP e continua | gate com caminho para configurar o navegador |
| piloto ocupado | omite o MCP e continua | gate que informa que o recurso está em uso |
| endpoint morre durante a materialização | omite se ainda não houve aceite; se exigido, gate tardio tipado | gate tardio tipado |

“Opcional” não significa permitir um segundo navegador. Significa continuar sem
aquele MCP. Essa é a diferença que preserva segurança e elimina o bloqueio
indevido ao mesmo tempo.

### Falhas que continuam globais

Se o inventário do próprio agent falhar num run gerenciado, a Frota não pode
provar quais MCPs foram removidos ou materializados. Esse caso continua
fail-closed para o efeito, mas passa a ser um `preflight-blocked` de domínio
`control-plane`, nunca um erro do agent. O mesmo vale para corrupção de policy
ou incapacidade de construir uma configuração gerenciada válida.

## Modelo de domínio proposto

### 1. Resultado tipado do planejador

Substituir `McpRunPlan.blocked: Option<String>` e notices de policy em texto
livre por estruturas que separam causa, disposição e copy:

```rust
enum McpPlanDisposition {
    Selected,
    Omitted,
    NeedsDecision,
    BlockedByPolicy,
    NeedsReadonlyConsent,
}

enum McpPlanIssueCode {
    SourceMissing,
    Incompatible,
    HealthUnavailable,
    AuthenticationRequired,
    BrowserOffline,
    BrowserUnavailable,
    BrowserBusy,
    ProxyUnavailable,
    InventoryUnavailable,
}

struct McpPlanIssue {
    source_id: String,
    source_label: String,
    code: McpPlanIssueCode,
    disposition: McpPlanDisposition,
    detail: Option<String>,
}

struct McpPreflightGate {
    fingerprint: String,
    issues: Vec<McpPlanIssue>,
    allowed_recoveries: Vec<McpRecovery>,
}
```

`McpRecovery` é uma união fechada, por exemplo `StartProjectBrowser`,
`OpenMcpSettings`, `OmitForThisRun` e `RetryReadOnly`. O backend publica quais
gestos a policy permite; o frontend escolhe a copy em pt-BR. Nenhum rótulo de
botão atravessa a fronteira Rust/TypeScript.

`McpRunPlan` passa a carregar:

- `selected`, somente servidores materializados;
- `omitted`, causas não fatais;
- `gate`, exigências não atendidas;
- `audit_notices`, mudanças de transporte que precisam ficar auditáveis;
- leases e proxies, como hoje.

### 2. Avaliação e materialização no mesmo caminho autoritativo

Refatorar `plan_for_run` em passos internos, sem duplicar policy no React:

1. descobrir bindings e fontes;
2. avaliar health, portabilidade e recursos;
3. aplicar a matriz `required × fallback` numa função pura;
4. se houver gate, devolver o gate sem adquirir efeito durável;
5. materializar somente as fontes selecionadas;
6. adquirir leases e proxies;
7. revalidar a policy antes do aceite;
8. construir o manifesto efetivo.

O health probe pode atualizar o cache, como já faz. Ligar navegador, adquirir
piloto, abrir proxy e iniciar provider continuam efeitos posteriores à policy.
Se a disponibilidade mudar durante a aquisição, a mesma função de disposição
decide omissão opcional ou gate exigido. Não haverá um segundo algoritmo de
fallback na ramificação de browser.

### 3. Fronteira de aceite do envio

O frontend hoje chama `useChat.start` antes de `runAgent`. A ordem deve ser
invertida semanticamente:

```text
submit
  → estado efêmero “preparando”
  → backend calcula o preflight

  gate
    → mantém texto e anexos no rascunho
    → limpa “preparando”
    → mostra a decisão

  run_manifest
    → aceita o envio
    → grava a mensagem no fio
    → limpa o rascunho
    → marca o turno como running
    → provider pode iniciar
```

`run_manifest` continua sendo o primeiro evento de um envio aceito. O backend
deve verificar `gate` antes de emiti-lo. Para um preflight recusado, emitir o
novo evento `AgentEvent::PreflightBlocked { gate }` e retornar um outcome
`not-started`, sem `Error` e sem `Done`.

O Channel preserva a ordem dos eventos. O callback do frontend trata
`run_manifest` como fronteira transacional: primeiro chama `start` ou
`beginTransplant`, depois reduz o manifesto. Eventos posteriores encontram a
conversa já em voo.

### 4. Estado efêmero de preparação

Adicionar ao estado operacional da conversa, sem persistir como transcript:

```ts
type RunPreparation = {
  runId: string
  phase: "checking" | "materializing"
  startedAt: number
}

type PreflightGate = {
  runId: string
  fingerprint: string
  issues: McpPlanIssue[]
  allowedRecoveries: McpRecovery[]
}
```

O rascunho continua pertencendo a `useComposerDrafts`. O gate não precisa de
migração nem item invisível no fio: se o app reiniciar, o rascunho persistido
continua lá e a configuração quebrada continua visível nas Configurações.

O composer não pode apagar o Lexical nem chamar
`useComposerDrafts.clear` no submit. Ele limpa ambos somente no aceite. Enquanto
o preflight está em andamento, o conteúdo fica visível e o envio fica protegido
contra clique duplo. Se o preflight bloquear, nada precisa ser reconstruído.

Preparação é indexada pelo `convId` capturado no início, nunca pela conversa em
foco depois dos awaits. Trocar de projeto ou conversa durante o probe não move o
pedido. Rejeição do invoke antes de `run_manifest` limpa `preparing`, conserva o
rascunho e apresenta uma falha de preparação acionável, sem criar item no fio.

Feedback proporcional:

- até 1 segundo, apenas controle de envio indisponível;
- de 1 a 3 segundos, indicador discreto;
- acima de 3 segundos, “Verificando capacidades…”;
- movimento respeita `prefers-reduced-motion`.

### 5. Gate tardio e falha de startup

Mesmo com a fronteira acima, uma lease pode ser perdida ou o processo pode
falhar entre o manifesto e a sessão. Esses casos precisam de evidência própria:

- gate tardio antes do spawn: `PreflightBlocked`, com rollback somente do
  estado operacional daquele `runId`; a mensagem aceita permanece no fio e
  ganha o marco neutro “Turno não iniciado”;
- falha ao criar o processo: `StartupFailed`, não `Error` terminal;
- execução confirmada e depois encerrada: `Error` ou `LimitReached`, que seguem
  para a sequência factual da ADR-143.

Adicionar uma evidência normalizada de início, emitida na fronteira em que o
processo do adapter foi criado. A apresentação terminal só pode afirmar
“Execução interrompida” quando essa evidência existir. `session` continua sendo
prova de sessão do provider, mas não deve ser usada como substituto universal
de spawn porque os adapters têm cadências diferentes.

## Manifesto efetivo

Evoluir `EffectiveRunManifest` para uma nova versão com omissões tipadas:

```ts
interface EffectiveCapabilityOmission {
  sourceId: string
  sourceLabel: string
  code: McpPlanIssueCode
  detail: string | null
}

interface EffectiveRunManifest {
  // campos atuais
  omissions: EffectiveCapabilityOmission[]
}
```

O campo `blocked` deixa de existir no manifesto novo, pois um envio bloqueado
não tem manifesto de run. O espelho TypeScript pode ler `blocked?` em payloads
antigos durante a transição, mas nenhuma escrita nova usa esse campo.

Notices de planejamento deixam de virar `ChatItem.notice` automaticamente.
Omissão, substituição de endpoint e inventário parcial pertencem ao manifesto.
`AgentEvent::Notice` permanece para fatos não fatais ocorridos durante uma
execução real, como anexo expirado.

## UI e copy

### Capacidade opcional omitida

Usar a faixa existente `RunCapabilityStrip`, em E0/E1 e sem criar outro cartão.
O resumo recolhido acrescenta, quando necessário:

```text
1 capacidade não entrou
```

No detalhe, uma seção “Fora deste turno” mostra:

```text
Playwright
navegador do projeto desligado
```

O tom é cinza. O turno está seguindo e não espera decisão, portanto âmbar seria
falso. Não há toast, ponto vermelho na conversa, aviso terminal ou abertura
automática do detalhe.

### Capacidade exigida

Usar o mesmo idioma visual dos gates próximos ao composer. Não reutilizar a
sequência de incidente da ADR-143 e não introduzir modal, pois o restante do
app continua utilizável.

Exemplo para `required + ask`:

```text
Navegador necessário
Playwright usa o navegador deste projeto, que está desligado. O turno ainda
não começou.

[Ligar e enviar]  [Continuar sem Playwright]  Revisar vínculo
```

- uma ação primária por estado;
- âmbar somente porque há decisão humana pendente;
- “Continuar sem Playwright” só aparece quando o backend autoriza
  `OmitForThisRun`;
- “Ligar e enviar” descreve os dois efeitos e só reenvia depois de confirmar o
  navegador vivo;
- `deny` oferece correção, nunca bypass;
- `allow-readonly` oferece “Continuar só lendo” e mostra que a mudança vale
  somente para este turno;
- nenhuma ação é automática após a tela assentar.

### Configurações MCP

Na linha de `McpAgentRows`:

- “navegador” passa a significar “usar o navegador deste projeto”;
- o aviso diferencia opcional de exigido;
- com opcional desligado: “navegador desligado; este MCP fica fora do próximo
  turno”;
- com exigido desligado: “navegador desligado; o próximo turno não inicia até
  você decidir”;
- o seletor “Se faltar” aparece somente quando “exigir” estiver ativo;
- nenhum valor é apagado ao recolher o seletor;
- não criar nova superfície, manter a hierarquia da linha atual.

As funções `browserBindingWarning`, `browserChainLine` e `browserRowNotice`
passam a receber `required` e a derivar a copy da mesma função pura de policy.
Elas não podem repetir a regra em condicionais próprias.

## Mudanças por camada

### Rust, policy e runner

Arquivos principais:

- `app/src-tauri/src/mcp_control.rs`
- `app/src-tauri/src/agent.rs`
- `app/src-tauri/src/run_manifest.rs`
- adapters que possuem a fronteira real de spawn

Trabalho:

1. extrair `resolve_binding_disposition(binding, availability)` como função
   pura e exaustiva;
2. remover o bloqueio incondicional da ramificação `binding.browser`;
3. omitir o servidor inteiro quando o navegador opcional não puder ser
   materializado;
4. nunca reutilizar os args de origem como fallback de browser;
5. substituir `blocked: Option<String>` por `gate` e `omitted` tipados;
6. mover a checagem do gate para antes de `RunManifest`;
7. emitir `PreflightBlocked` sem `Error + Done`;
8. devolver outcome tipado de `run_agent`;
9. emitir evidência de spawn antes de qualquer evento do processo;
10. validar override por `fingerprint`, source e policy no backend.

### TypeScript, contrato e stores

Arquivos principais:

- `app/src/lib/agent.ts`
- `app/src/lib/tooling.ts`
- `app/src/store/chat.ts`
- um módulo extraído para reducer e tipos de preflight
- `app/src/store/chat/runManifest.ts`
- `app/src/store/composerDrafts.ts`

Trabalho:

1. espelhar enums e payloads do Rust;
2. fazer `runAgent` devolver `started | not-started | startup-failed`;
3. adicionar `preparing` e `preflightGate` ao estado operacional;
4. criar uma transação única de aceite que grava o pedido, inicia o turno e
   reduz o manifesto;
5. impedir `finish` de criar `finishedUnseen` para `not-started`;
6. impedir persist, custo, auto-resume, fila, sugestão e notificação terminal
   quando o turno não começou;
7. conservar o rascunho até o aceite;
8. fazer retry reutilizar o mesmo rascunho e um override validável, sem bolha
   duplicada.

### React

Arquivos principais:

- `app/src/components/chat/CommandConsole.tsx`
- `app/src/components/chat/LexicalComposer.tsx`
- `app/src/components/chat/BannersDoComposer.tsx`
- novo componente pequeno de gate, usando primitives existentes
- `app/src/components/chat/RunCapabilityStrip.tsx`
- `app/src/components/chat/messageNodes.ts`
- `app/src/components/settings/McpAgentRows.tsx`
- `app/src/lib/browser.ts`

Trabalho:

1. fazer `onSend` observar o aceite antes de limpar o editor;
2. mostrar preparação real sem inventar “rodando”;
3. renderizar o gate no composer, não no fio terminal;
4. acrescentar omissões ao detalhe do manifesto;
5. reservar a sequência da ADR-143 para turno iniciado;
6. apresentar startup e gate tardio com copy factual;
7. manter teclado, foco, Esc e movimento reduzido;
8. revisar temas claro e escuro, sem introduzir cor ou elevação nova.

## Call sites obrigatórios

Mudar o contrato de `runAgent` exige revisar todos os consumidores. Nenhum pode
continuar marcando “running” antes do aceite.

| Superfície | Comportamento esperado |
|---|---|
| `ChatPanel` | rascunho fica no composer até `run_manifest`; gate não cria turno |
| `lib/fleet/send` | mesma transação do chat e do Companion; revezamento só começa após aceite |
| handoff em `ChatPanel` e `lib/fleet/send` | origem permanece intacta durante o preflight |
| `scheduleEngine` | opcional degrada; exigência bloqueada registra `blocked`, não `failed` |
| `store/fusion` | candidato fica `preparing`, só depois `running`; gate não conta como falha do modelo |
| `SddView` | etapa diferencia “não iniciada” de execução falha |
| `compact` | não cria turno técnico nem notice antes do aceite |
| `advisor` | devolve motivo `not-started` sem contaminar o fio do executor |

O status `blocked` de agendamento pode usar o campo `TEXT` existente em
`schedule_runs`; confirmar o schema real antes da implementação. Se qualquer
constraint ou coluna nova for necessária, conferir a migração máxima em
`src-tauri/src/lib.rs` e seguir o contrato de migrations do repositório.

## Fases de implementação

### P0, registrar a decisão e corrigir os documentos

- adicionar uma ADR após conferir a máxima real de `docs/decisions.md`;
- corrigir o bloco de policy no topo de `browser-plan.md`;
- atualizar “Bindings e roteamento” em `mcp-control-plane.md`;
- registrar a nova fronteira de eventos em `agent-runner.md`;
- atualizar `architecture.md` se o módulo de preflight virar dono do aceite.

Não pré-numerar a ADR neste plano porque `docs/decisions.md` está sendo tocado
por outra frente e a máxima pode mudar.

### P1, policy pura e fixture do incidente

- criar tipos de disponibilidade, disposição, issue e gate;
- implementar a matriz numa função pura;
- colher do SQLite uma fixture sanitizada com o shape real do incidente:
  `required = 0`, `fallback = ask`, `browser = 1`;
- provar que o resultado é `omit-and-continue`;
- provar que `required = 1` gera cada gate correspondente;
- manter teste real do launch `npx @playwright/mcp@latest`.

### P2, planejador e manifesto

- refatorar `plan_for_run` para usar uma única decisão em todos os ramos;
- materializar somente selecionados;
- carregar omissões tipadas;
- evoluir o manifesto e remover bloqueio de manifests novos;
- não emitir notices de planejamento no transcript.

### P3, ciclo de aceite

- adicionar `PreflightBlocked` e outcome de `run_agent`;
- checar gate antes de `RunManifest`;
- criar `preparing` no frontend;
- atrasar `start` e `beginTransplant` até o manifesto;
- atrasar a limpeza do rascunho até o aceite;
- ajustar `finish` e os efeitos pós-turno.

P2 e P3 devem entrar juntas no mesmo commit funcional. Publicar somente metade
recriaria a mentira com outro nome.

### P4, gate e recuperação humana

- implementar o gate próximo ao composer;
- ligar as ações de navegador e Configurações;
- implementar overrides de um turno com fingerprint;
- para “Só lê”, alterar a permissão efetiva somente depois do gesto e mostrar a
  mudança na linha de execução;
- nunca reexecutar automaticamente ao apenas abrir Configurações.

### P5, startup e superfícies secundárias

- normalizar evidência de spawn e `StartupFailed`;
- revisar todos os call sites da tabela;
- adicionar `blocked` ao histórico de agendamentos sem chamá-lo de falha;
- garantir que Fusion, SDD, compactação e conselheiro não inventem execução.

### P6, UI e configurações

- adaptar `RunCapabilityStrip` para omissões;
- adaptar copy da linha MCP e do navegador;
- remover “Run bloqueado” da faixa de manifesto;
- manter a superfície dentro das escalas e primitives do guia;
- dividir arquivos se qualquer catraca de tamanho disparar.

### P7, documentação, QA e entrega

- fechar ADR e planos com o comportamento entregue;
- executar suítes completas;
- validar visualmente estados opcionais e exigidos;
- gerar build somente sem conversa `running`, `finalizing` ou `preparing`;
- promoção e reinício continuam sendo um gate separado e explícito.

## Estratégia de testes

### Rust

- fixture real do binding do incidente resulta em plano aceito, Playwright em
  `omitted`, nenhuma lease e nenhum `blocked`;
- binding opcional sem navegador jamais preserva `--browser`, `--headless` ou
  endpoint da origem no plano efetivo;
- binding exigido com `ask` gera gate com `OmitForThisRun`;
- binding exigido com `deny` gera gate sem bypass;
- binding exigido com `allow-readonly` exige consentimento, nunca injeta apenas
  uma frase no prompt;
- navegador vivo injeta CDP e adquire uma única lease;
- broker ocupado segue a mesma matriz de policy;
- inventário do agent indisponível gera gate de control plane;
- manifesto aceito contém omissões e nunca `blocked`;
- preflight recusado não emite `RunManifest`, `Error`, `Done` ou spawn;
- override com fingerprint velho, source diferente ou policy incompatível é
  recusado;
- contratos continuam agnósticos a provider.

### Store e TypeScript

- submit inicia `preparing`, não `running`;
- `run_manifest` faz o aceite atômico e grava uma única mensagem do usuário;
- `preflight_blocked` conserva rascunho, anexos, agent e sessão;
- `not-started` não marca conversa como concluída ou falha;
- nenhum custo é gravado sem evidência de início;
- fila e auto-resume não drenam depois de preflight bloqueado;
- retry por recovery não duplica a mensagem;
- duplo clique não abre dois preflights nem dois runs;
- trocar de conversa durante o probe não muda o dono do pedido;
- omissão aparece no manifesto e não cria `ChatItem.notice` ou `IncidentNode`;
- `StartupFailed` nunca produz “Execução interrompida”.

### Componentes

- faixa recolhida resume a quantidade omitida;
- detalhe nomeia a fonte e a causa, sem âmbar quando o turno segue;
- gate mostra somente recuperações autorizadas;
- `deny` não renderiza “Continuar sem…”;
- “Só lê” explicita o escopo de um turno;
- texto e anexos permanecem no composer quando o preflight bloqueia;
- Enter, clique, foco por teclado e Esc seguem funcionando;
- movimento reduzido preserva o indicador estático.

### Integração

1. Playwright opcional, navegador desligado, prompt sem relação com browser:
   agent inicia e responde.
2. Mesmo binding, prompt menciona browser: não há heurística; o turno inicia
   sem Playwright e o manifesto diz que ele ficou fora.
3. Playwright exigido com `ask`: nenhum processo inicia; “Continuar sem
   Playwright” inicia somente após clique.
4. Playwright exigido com `deny`: somente corrigir configuração libera.
5. Ligar e enviar: Chromium fica vivo, lease é adquirida e o MCP recebe o CDP.
6. Browser ocupado: opcional segue sem; exigido pede decisão.
7. Revezamento bloqueado no preflight: origem continua retomável.
8. Agendamento bloqueado: histórico diz “não iniciado”, sem custo e sem
   conversa falsamente concluída.
9. Trocar de projeto durante um probe lento: aceite ou gate permanece na
   conversa de origem e não altera o composer em foco.

## QA visual

Matriz mínima:

| eixo | casos |
|---|---|
| tema | claro, escuro |
| largura | 760 px, janela estreita, painel lateral aberto |
| estado | preparando, omissão opcional, gate `ask`, gate `deny`, gate “Só lê” |
| conteúdo | uma omissão, várias omissões, detalhe técnico longo |
| interação | Enter, clique, Tab, Shift+Tab, Esc, retry, abrir Configurações |
| movimento | padrão e `prefers-reduced-motion` |

Rubrica específica:

- a mensagem ainda não aceita permanece no composer;
- a sidebar nunca mostra ponto vermelho para preflight;
- a faixa não transforma degradação opcional em alerta;
- gate e incidente terminal não parecem a mesma superfície;
- há no máximo uma ação primária;
- nenhuma copy afirma que turno, sessão ou execução existiu sem evidência;
- zoom do transcript não quebra a faixa;
- o detalhe continua auditável a um gesto.

## Comparação com Orca e Paseo

O plano absorve dois padrões dos clones locais sem copiar sua arquitetura:

- **Orca** mantém preflight como estado próprio, com loading, erro, invalidação
  e deduplicação por contexto. A lição aplicável é não misturar prontidão com
  o estado de uma execução.
- **Paseo** registra browser tools como opt-in e, quando o host não está
  conectado, a falha pertence à chamada da tool, não ao nascimento de toda
  sessão do agent. A lição aplicável é que uma capacidade acessória não deve
  impedir trabalho sem relação com ela.

A Frota difere dos dois ao montar MCPs externos por run e impor bindings por
projeto. Por isso precisa omitir o servidor inteiro antes do spawn, em vez de
deixar uma tool incapaz exposta, mas o princípio é o mesmo: ausência opcional é
local à capability.

## Riscos e contenções

| Risco | Contenção |
|---|---|
| MCP opcional abrir navegador próprio | omitir o servidor inteiro; nunca usar launch de origem |
| policy duplicada entre Rust e React | Rust publica disposição e recoveries tipadas; React só apresenta |
| evento chegar antes de `start` | `run_manifest` é fronteira transacional e o callback aceita antes de reduzir |
| rascunho sumir em preflight | limpar Lexical e store somente após aceite |
| override burlar `required + deny` | backend revalida fingerprint, source e fallback |
| “Só lê” reduzir liberdade silenciosamente | somente por gesto e apenas no turno reenviado |
| omissão poluir o fio | registrar no manifesto, não em `ChatItem.notice` |
| startup continuar parecendo interrupção | evidência de spawn e evento `StartupFailed` próprios |
| chamada secundária manter semântica antiga | grep obrigatório de todos os `runAgent(` e testes por superfície |
| árvore paralela em `decisions.md` | conferir diff e máxima da ADR no momento da implementação |
| arquivo ultrapassar catraca | extrair reducers, tipos e componentes; nunca subir baseline |

## Fora de escopo

- inferir pelo texto do prompt que o usuário precisa de navegador;
- iniciar Chromium no boot ou manter daemon fora do app;
- habilitar MCP, navegador ou permissão sem gesto humano;
- mudar limites, modelos, contexto, custo ou auto-resume;
- permitir fallback para browser externo;
- redesenhar a sequência terminal da ADR-143;
- criar um sistema genérico de dependências de missão nesta frente;
- promover ou reiniciar o aplicativo como consequência da implementação.

## Validação e entrega

Depois dos testes focados, rodar as suítes completas exigidas pelo repositório:

```bash
cd app && bun run test
cd app && bunx tsc -b --force
cd app && bun run check
cd app/src-tauri && cargo test
git diff --check
```

Depois, fazer grep dos caminhos que mudam estado:

```bash
rg -n 'runAgent\(' app/src
rg -n 'PreflightBlocked|StartupFailed|RunManifest' app/src app/src-tauri/src
rg -n 'required|fallback|browser' app/src-tauri/src/mcp_control.rs app/src/lib app/src/components/settings
```

Build de teste só pode começar quando não houver conversa `running`,
`finalizing` ou `preparing`. Promover para Aplicativos, reiniciar o Frota,
commitar e enviar ao remoto são passos separados e dependem de autorização
explícita no momento da execução.

## Definition of done

- o binding real do incidente deixa o prompt comum iniciar sem Playwright;
- nenhum navegador externo nasce como fallback;
- capacidade opcional ausente fica auditável no manifesto e fora do fio;
- capacidade exigida segura o pedido no composer antes de criar turno;
- texto e anexos sobrevivem ao gate;
- `Error + Done` não é usado para preflight;
- “Execução interrompida” só aparece após evidência de execução;
- preflight não cria custo, sessão, conclusão, sugestão, auto-resume ou
  notificação terminal;
- revezamento permanece transacional;
- todos os call sites de `runAgent` adotam a nova fronteira;
- Configurações explicam a diferença entre “usar navegador” e “exigir”;
- temas, teclado, largura e movimento reduzido foram verificados;
- suítes completas, TypeScript, guardas, Rust e `git diff --check` passam;
- documentação e ADR descrevem a policy entregue, sem manter a correção antiga
  contraditória no topo de `browser-plan.md`.
