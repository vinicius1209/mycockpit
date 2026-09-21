# Orca Chat UI vs. Frota headless

> **Status:** memória arquitetural versionada  
> **Data da leitura:** 24/08/2026  
> **Snapshots comparados:** Orca `09ec516ae50b7b83fa65343d9ad96159e3fe71fc` e
> Frota `9b1a5b3d0b68ae22f6ce8203f77cd9f594946383`

## Conclusão curta

Sim: a Frota executa os agentes em modo **headless**, isto é, sem abrir ou
embutir a interface TUI interativa do Claude Code, Codex ou Agy.

O Orca experimental faz outra escolha. Ele mantém a TUI real dentro de um PTY e
coloca uma interface de chat por cima dela. A tela parece um chat, mas o agente
continua sendo controlado como um programa de terminal.

Em uma frase:

```text
Orca       = terminal/TUI real + transcript do provider projetado como chat
Frota  = protocolo headless estruturado + eventos normalizados virando chat
```

Essa diferença não é apenas visual. Ela define quem controla a sessão, de onde
vem a verdade do transcript, como funcionam permissões e como a memória pode
viajar entre providers.

## O que “headless” significa aqui

Headless não quer dizer necessariamente “mão única” ou “sem interação”. Quer
dizer que não dependemos de uma TUI visível e de suas sequências de teclado para
operar o agente.

Hoje a Frota usa três formas de transporte headless:

| Agente / modo | Transporte | Continuidade nativa | Interação durante o turno |
|---|---|---|---|
| Claude | `claude -p --output-format stream-json` | `--resume` | `ask_user` e aprovação pelos MCPs efêmeros da Frota |
| Codex Padrão | `codex app-server`, JSON-RPC/NDJSON por stdio | `thread/resume` | Bidirecional; pode pedir aprovação e aguardar a resposta |
| Codex nos demais modos | `codex exec --json` | `codex exec resume` | Mão única; não pausa para aprovação |
| Agy | `agy -p --output-format stream-json` | Sem resume nativo confiável | Contexto reapresentado pelo Frota; limitações são expostas honestamente |

O `codex app-server` continua sendo headless: não há TUI. A diferença é que seu
protocolo é bidirecional. Portanto, **headless não é sinônimo de one-shot**.

## Como o modo Chat UI do Orca funciona

O modelo mental do Orca é este:

```text
mensagem no composer
        |
        v
teclas/bytes enviados ao PTY
        |
        v
TUI real do Claude/Codex/... continua executando
        |
        +------------------------+
        |                        |
        v                        v
arquivo JSONL do provider     hooks/status
        |                        |
        +-----------+------------+
                    v
       mensagens normalizadas do Chat UI
                    |
                    v
         overlay React sobre o terminal
```

### 1. O terminal continua sendo o dono da execução

O `TerminalPane` não é substituído por outro runner. O terminal permanece
montado e o Chat UI aparece como uma camada sobre ele. Alternar para o modo chat
altera a representação da sessão, não o processo que executa o agente.

### 2. O composer escreve no PTY

Ao enviar uma mensagem, o Orca não chama uma API conversacional do Claude ou do
Codex. Ele encaminha a entrada para a sessão de terminal existente. Isso preserva
compatibilidade com menus, comandos e comportamentos nativos da TUI, mas também
mantém a UI acoplada a esse protocolo de terminal.

### 3. O chat é reconstruído dos transcripts do provider

O Orca localiza os arquivos de sessão nativos e acompanha seu crescimento. Cada
provider tem decodificadores próprios, que convertem seus registros JSONL em um
modelo comum de mensagem. No snapshot estudado existem rotas específicas para
Claude/OpenClaude, Codex, Grok e OMP.

Esse transcript é a principal fonte de verdade visual. O envio otimista do
usuário e os previews vindos de hooks precisam depois ser reconciliados com o
registro persistido pelo provider, evitando mensagens duplicadas.

### 4. Hooks completam o que o transcript não diz a tempo

Os hooks ajudam a descobrir identidade do agente, id da sessão, caminho do
transcript, estado de execução, perguntas e previews. Eles dão vivacidade ao
chat antes de o arquivo persistido alcançar a mesma informação.

### 5. A TUI é o escape de compatibilidade

Como a sessão real continua sendo um terminal, o Orca pode voltar à apresentação
de terminal quando a abstração de chat não entende alguma tela ou interação. É
uma vantagem de fidelidade, comprada com bastante complexidade de PTY, daemon,
hooks, parsing de transcripts e reconciliação.

### Observação sobre o fallback por scrollback

Existe implementação de extração a partir do scrollback do terminal, mas, no
snapshot estudado, a busca por referências não mostrou essa rota conectada ao
fluxo de produção do Chat UI. Portanto, ela não deve ser descrita como a fonte
normal das mensagens: a rota principal é o transcript nativo do provider.

## Como a Frota funciona

O modelo mental atual é o inverso:

```text
mensagem no chat
      |
      v
runner headless escolhido por capacidade/modo
      |
      v
stream-json ou JSON-RPC/NDJSON
      |
      v
adapter específico do provider
      |
      v
AgentEvent normalizado
      |
      +---------------------+
      v                     v
UI/Fio Vivo             SQLite/transcript
```

### 1. A UI conhece eventos da Frota, não telas de terminal

Claude, Codex e Agy emitem formatos diferentes. Os adapters Rust traduzem esses
formatos para `AgentEvent`: `session`, `text`, `tool`, `tool_result`,
`deferred_work`, `result`, `limit_reached`, `error`, `done` e outros.

O frontend recebe esses eventos por um `Channel<AgentEvent>` do Tauri e os reduz
em itens do fio. O contrato da UI é nosso; não é o layout textual de uma TUI nem
o schema histórico de um arquivo de transcript do provider.

### 2. Cada envio abre ou retoma uma execução headless

A Frota não mantém um terminal invisível como autoridade principal. Ele
inicia um processo/protocolo adequado ao turno e tenta retomar a sessão nativa
quando o provider oferece essa capacidade.

O caminho Codex Padrão merece atenção: a Frota usa `app-server` porque
`codex exec` é mão única e, sem TTY, não consegue parar para pedir aprovação. Se
o `app-server` falhar antes de o turno começar, o runner cai para `codex exec` e
emite um aviso visível sobre a perda do gate naquele turno.

### 3. A persistência e a continuidade pertencem ao aplicativo

A sessão nativa do provider é uma otimização importante, mas não é a única
memória. A Frota conserva e reapresenta contexto por meio de:

- transcript e estado da conversa em SQLite;
- doutrina e instruções do projeto;
- lições e contexto recuperável;
- ids de sessão nativos, quando disponíveis;
- recap de fallback quando o resume falha ou não existe;
- artefatos de handoff e o MCP `mc-context`.

Isso permite que a conversa sobreviva a uma troca de modelo ou provider sem
fingir que Claude e Codex compartilham a mesma sessão nativa. Não compartilham.
O que atravessa a troca é o contexto controlado pelo Frota.

### 4. O revezamento entre agentes é transacional

Na troca de provider, a Frota registra a intenção de transplante, inicia o
destino com o contexto preparado e só confirma a mudança quando o destino emite
sua primeira `session`. Uma falha anterior a esse ponto não deve apagar a origem
nem produzir uma falsa continuidade.

O Chat UI do Orca, isoladamente, não resolve esse problema. Ele preserva muito
bem a sessão TUI de um provider e a representa como chat; a Frota trata a
continuidade **entre** providers como responsabilidade do produto.

## Comparação direta

| Dimensão | Orca Chat UI | Frota |
|---|---|---|
| Autoridade da execução | Sessão PTY/TUI mantida pelo Orca | Runner/protocolo headless por turno |
| Aparência do chat | Projeção sobre o terminal existente | Interface nativa do domínio do app |
| Fonte principal das mensagens | Transcript JSONL nativo do provider | Eventos estruturados normalizados em tempo real |
| Envio do prompt | Bytes/teclas para o PTY | Prompt no comando ou requisição do protocolo |
| Continuidade no mesmo provider | Processo/sessão TUI e transcript nativo | Resume nativo quando disponível + fallback do app |
| Troca entre providers | Não é função central desse modo | Handoff explícito com memória controlada pelo app |
| Aprovação/perguntas | Interações da TUI respondidas pelo terminal | Canais próprios: MCPs e Codex app-server |
| Persistência do produto | Estado do terminal + transcripts dos providers | SQLite, transcript normalizado e artefatos de contexto |
| Compatibilidade com novidades da TUI | Alta, pois a TUI real continua presente | Depende do adapter reconhecer novos eventos/capacidades |
| Risco de mudança de schema | Decodificadores de transcript e hooks | Decodificadores de stream-json/JSON-RPC |
| Complexidade dominante | PTY, daemon, terminal headless, hooks e reconciliação | Adapters, protocolos, persistência e semântica de handoff |
| Escape para casos não estruturados | Voltar à visão de terminal | Ainda não há uma TUI embutida como fallback |

## Avaliação de engenharia: qual estrutura é melhor?

Esta seção é um parecer, não apenas uma descrição do código. O resultado depende
do objetivo do produto:

- para construir um **terminal universal**, com máxima fidelidade aos CLIs, a
  estrutura do Orca é melhor;
- para construir uma **plataforma de coordenação de agentes**, com memória,
  ferramentas, custos e handoff controlados pelo produto, a estrutura do
  Frota é melhor.

Para a proposta concreta da Frota, a escolha recomendada é manter a
arquitetura **headless e event-first**.

### Resultado por critério

| Critério | Estrutura mais forte | Motivo |
|---|---|---|
| Fidelidade ao comportamento nativo da TUI | Orca | A sessão real do terminal continua sendo executada |
| Compatibilidade inicial com muitos CLIs | Orca | Um novo CLI pode funcionar como terminal antes de ganhar um decoder completo |
| Manutenção e previsibilidade do domínio | Frota | A UI depende de `AgentEvent`, não de telas e sequências de teclado |
| Representação de tools, custos e tarefas | Frota | Os conceitos são eventos estruturados e persistíveis |
| Memória e troca entre providers | Frota | A continuidade pertence ao aplicativo, não a uma sessão nativa isolada |
| Políticas e permissões do produto | Frota | O app possui canais e estados explícitos para interação e aprovação |
| Observabilidade e auditoria | Frota | Runner, eventos e persistência formam um contrato controlado pelo produto |
| Sobrevivência a uma feature nova da TUI | Orca | Mesmo que o Chat UI não entenda a novidade, o terminal ainda pode exibi-la |

### Por que a Frota é melhor para este produto

O fluxo principal da Frota possui uma fronteira arquitetural mais limpa:

```text
protocolo estruturado -> adapter -> AgentEvent -> UI + persistência
```

Isso permite que o frontend trabalhe com conceitos do produto — sessão, texto,
tool, resultado, custo, limite, trabalho diferido e erro — sem interpretar a
apresentação de um terminal. É uma base mais adequada para Fio Vivo, telemetria,
revezamento, memória local, execução em modos distintos e evolução consistente
da experiência.

No Orca, o Chat UI precisa conciliar mais fontes de verdade:

```text
PTY/TUI + hooks + transcript do provider + estado otimista da interface
```

Essas fontes podem chegar em momentos diferentes. O ganho é fidelidade; o custo
é sincronização, condições de corrida, lógica de deduplicação e dependência dos
detalhes de cada terminal e provider.

### Onde o Orca é genuinamente superior

O Orca degrada melhor quando aparece uma interação ainda desconhecida. Se o
decoder de chat não compreender uma nova tela ou comando, a TUI real continua
existindo como escape. Ele também consegue aceitar mais CLIs inicialmente,
porque qualquer programa de terminal já possui uma representação funcional.

Isso faz do Orca uma estrutura melhor para um produto cujo contrato principal é
“executar qualquer agent de terminal com fidelidade”. Não é uma arquitetura
inferior; ela otimiza outro problema.

### Desvantagens reais da Frota

A escolha headless também tem custos que não devem ser escondidos:

- features novas podem aparecer primeiro na TUI e exigir evolução do adapter;
- o comportamento em modo print/headless pode divergir do modo interativo;
- resume, aprovação e perguntas não são uniformes entre providers;
- um schema estruturado que mudar pode interromper partes da experiência;
- uma troca de provider preserva contexto controlado pelo app, mas não garante
  equivalência perfeita com toda a memória interna do provider anterior;
- ainda não existe uma TUI embutida para operações não representadas pelos
  eventos conhecidos.

### Veredito

Se fosse necessário escolher apenas uma estrutura para a Frota, a escolha de
engenharia seria:

> **Frota headless/event-first como núcleo do produto.**

A recomendação não é transformar a Frota em um clone da arquitetura do Orca.
É adotar um híbrido assimétrico, preservando uma única autoridade principal:

1. manter eventos normalizados e SQLite como fonte do produto;
2. oferecer “Abrir no terminal” como ferramenta de diagnóstico ou escape;
3. permitir leitura/importação de transcripts nativos para recuperação e
   auditoria, sem usá-los como banco principal;
4. declarar por capability quais transports suportam streaming, resume,
   aprovação, interação e tarefas diferidas;
5. recorrer a PTY somente para um agent sem protocolo estruturado suficiente.

Em síntese: **o Orca vence como terminal universal; a Frota vence como
plataforma de coordenação de agentes. Para o produto que estamos construindo, a
estrutura da Frota é a melhor base.**

## O que faz sentido aprender com o Orca

### Manter

1. **Adapters e capabilities explícitos por provider.** Não presumir que todos
   suportam resume, aprovação, streaming, perguntas e tarefas diferidas da mesma
   forma.
2. **Reconciliação determinística.** Evento otimista, preview e registro
   persistido precisam de identidade estável para não duplicar mensagens.
3. **Paginação e leitura incremental.** Conversas grandes não devem exigir
   reconstrução integral do transcript a cada atualização.
4. **Estado honesto de sessão.** Separar “processo vivo”, “turno trabalhando”,
   “aguardando usuário”, “sessão retomada” e “fallback iniciado”.
5. **Adaptador desconhecido não some silenciosamente.** A Frota já segue
   essa regra ao converter eventos novos em `Unknown`.

### Não importar como arquitetura padrão

1. **PTY/daemon apenas para imitar uma TUI.** Para agentes com saída estruturada,
   isso adicionaria duas fontes de verdade e muito estado concorrente.
2. **Transcript do provider como banco principal do produto.** Ele é útil para
   recuperação e auditoria, mas não deve substituir o transcript normalizado e
   a memória controlada pelo Frota.
3. **Interação por teclas como contrato de domínio.** Menus e prompts textuais
   mudam mais facilmente que eventos/protocolos explícitos.

## Decisão arquitetural registrada

A Frota deve continuar **headless e event-first** como caminho principal.

Um possível leitor de transcripts nativos pode ser útil no futuro como camada de
recuperação, auditoria ou importação de uma sessão externa. Ele não deve virar a
fonte principal do chat enquanto os providers entregarem eventos estruturados.

Uma visualização de terminal só se justificaria para um agent sem protocolo
estruturado suficiente ou para diagnóstico avançado. Nesse caso, deve ser uma
capability/fallback explícito, não uma dependência escondida de todos os agents.

## Mapa do código consultado

### Orca

- `src/renderer/src/components/terminal-pane/TerminalPane.tsx`: terminal e
  montagem da camada de Chat UI.
- `src/renderer/src/components/native-chat/NativeChatView.tsx`: composição da
  experiência de chat.
- `src/renderer/src/components/native-chat/native-chat-runtime-send.ts`: envio
  para a sessão de runtime/PTY.
- `src/renderer/src/components/native-chat/use-native-chat-transcript-lifecycle.ts`:
  ciclo de leitura do transcript.
- `src/main/native-chat/transcript-watch.ts` e
  `transcript-incremental-reader.ts`: acompanhamento incremental.
- `src/main/native-chat/transcript-line-decoders-*.ts`: adapters dos schemas
  nativos.
- `src/main/agent-hooks/server.ts`: sinais de sessão, estado e interação.
- `src/renderer/src/components/native-chat/native-chat-scrape-fallback.ts`:
  implementação de fallback por scrollback, sem rota produtiva encontrada no
  snapshot.

### Frota

- `app/src-tauri/src/agent.rs`: seleção do runner e fallback do Codex
  `app-server` para `exec`.
- `app/src-tauri/src/adapters.rs`: comandos headless e normalização de eventos de
  Claude, Codex e Agy.
- `app/src-tauri/src/codex_appserver.rs`: transporte bidirecional headless do
  Codex e pedidos de aprovação.
- `app/src/lib/agent.ts`: contrato `AgentEvent` recebido pelo frontend.
- `app/src/store/chat.ts`: redução dos eventos no transcript controlado pelo app.
- `docs/architecture.md`: decisão CLI subprocess + stream-json.
- `docs/agent-runner.md`: contrato dos adapters e política de contexto.
- `docs/context-handoff.md`: memória durável e revezamento entre providers.
- `docs/stream-json-notes.md`: limites práticos dos modos print/headless.

## Quando revisar esta memória

Revisar este documento se ocorrer qualquer uma destas mudanças:

- a Frota adotar terminal/PTY embutido;
- `codex app-server` substituir `codex exec` em todos os modos;
- Claude ou Agy ganharem um protocolo bidirecional estável usado pelo app;
- transcripts nativos passarem a participar da recuperação de conversas;
- o Orca retirar o PTY como autoridade do Chat UI;
- o handoff deixar de ser controlado pelo Frota.
