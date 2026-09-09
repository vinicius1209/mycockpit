# Fluidez operacional: navegação, envio e trabalho observável

> **Status em 09/09/2026:** fases 0 a 6 implementadas no código-fonte e
> registradas na ADR-175. A fase 7 continua sob o dono vizinho
> `docs/fluidez-do-fio-plan.md`; a integração é protegida por
> `check:fluidez`, sem duplicar essa implementação aqui. A auditoria original
> foi feita sobre o `HEAD` `8e167d3` (`oficial-370`) e o aplicativo instalado
> `0.1.0-test.370`. Nenhum novo aplicativo foi instalado por esta entrega.
> Este documento absorve a direção do estudo "Explorador de Arquivos Lazy &
> Resiliente", mas amplia o escopo porque a listagem de arquivos não era a
> única fonte de latência observada.
>
> **Donos vizinhos:** `docs/sidebar-cockpit-plan.md` continua dono do produto
> Arquivos; `docs/fluidez-do-fio-plan.md` continua dono do custo de render por
> token, Markdown e virtualização; `docs/mcp-preflight-plan.md` continua dono da
> policy de aceite do envio; `docs/mapa-vivo-da-conversa-prd.md` e
> `docs/mapa-vivo-da-conversa-spec.md` continuam donos da semântica do mapa.
> Este plano cuida da faixa operacional entre o gesto humano e essas frentes:
> navegação, filesystem, trabalho oculto, preparação do envio, transporte,
> persistência e observabilidade.
>
> **Decisão:** a implementação estrutural está registrada na ADR-175, numerada
> depois da conferência da versão máxima real do arquivo.

## Estado da implementação

- A: telemetria operacional, tamanho exato e deduplicação determinística do
  mapa, com atualização somente em transição terminal;
- B e C: explorador lazy/paginado, busca limitada e ignore-aware, cache com
  single-flight e geração, `@` assíncrono somente depois de query e menções
  efetivas persistidas no rascunho;
- D e E: shell de navegação imediato, hidratação protegida contra resposta
  velha, leituras por aba visível, polling suspenso e saída de processo em
  deltas numerados e limitados;
- F e G: preparação de envio anterior ao primeiro `await`, inventário Codex em
  cache factual invalidável e vida do run derivada de eventos e da árvore real
  de processos;
- H: journal incremental transacional para itens de conversa, com bootstrap,
  change-set coalescido e fallback integral verificável;
- I: compatibilidade mantida com a frente de render já existente, cuja guarda
  determinística é `check:fluidez`.

Validação final nesta árvore: 3.979 testes frontend em 405 arquivos, 758 testes
Rust (7 ignorados por exigirem prova manual), 10 cenários Playwright das
superfícies afetadas, TypeScript, build de produção e todas as guardas passaram.
O build conserva o aviso já existente de chunks acima de 500 kB; esta frente
não alterou o limite nem declarou o aviso resolvido.

## 0. A decisão em uma frase

**O gesto muda a tela no primeiro quadro; disco, processo, banco, inferência e
índice trabalham fora da faixa de interação, com cache factual, cancelamento e
um desfecho que a pessoa consegue entender.**

Não vamos comprar fluidez escondendo trabalho, descartando saída, apagando
rascunho, desmontando o chat, inventando progresso ou matando um processo por
conta própria. A correção é de arquitetura e observabilidade, não de teatro.

## 1. Por que o plano do explorador sozinho não basta

O explorador lazy corrige uma dívida real: `ProjectFilesPanel` consome hoje um
inventário completo, monta a árvore inteira e herda o teto silencioso de 8.000
caminhos. Porém a mesma operação também alimenta o `@` do composer, e esse
segundo consumidor roda mesmo quando a aba Arquivos não está aberta.

Trocar apenas a árvore por `list_dir_children` deixaria estes problemas vivos:

1. `useAtMentions` ainda iniciaria `list_project_files` ao trocar de projeto;
2. `read_project_context` e `read_project_sources` continuariam tocando disco
   em comandos Tauri síncronos;
3. o badge de Alterações continuaria carregando o patch completo fora da aba;
4. o Painel continuaria consultando o banco a cada 30 segundos mesmo escondido;
5. o mapa da conversa continuaria recalculando a partir de `items` e repetindo
   entradas que a inferência já recusou como grandes demais;
6. o caminho de envio ainda teria inventário nativo, transcript integral e uma
   segunda coreografia da Mesa com feedback tardio;
7. o modo Liberado do Codex continuaria ocultando `item.started` e
   `item.updated`, fazendo trabalho legítimo parecer travamento;
8. streaming e processos gerenciados continuariam provocando snapshots e
   eventos maiores do que a mudança que os originou.

Este plano trata o explorador como a primeira peça de uma correção maior, sem
misturar seu contrato visual com os donos de mapa, fio ou runner.

## 2. Evidência atual

### 2.1 Dados medidos

- A cópia segura do SQLite usada na auditoria tinha 10 projetos e 21 conversas.
- Os transcripts somavam aproximadamente 6,60 MiB; a maior conversa ocupava
  aproximadamente 2,38 MiB. Essa conversa é a fixture de escala mínima dos
  testes de navegação, envio e persistência.
- A amostra do aplicativo não mostrou CPU alta sustentada no instante medido.
  A latência é intermitente, portanto não se deve atribuí-la a CPU global sem
  um perfil por gesto.
- O log continha 171 ocorrências históricas de `input_too_large`; 22 eram de
  09/09 e 10 ocorreram entre 13:00 e o instante da auditoria. Há repetição real,
  não apenas risco teórico.
- Os testes direcionados revalidados antes deste plano passaram: 29 casos de
  frontend e 3 contratos Rust ligados a preparo, terminalidade, fluidez e
  transporte.

### 2.2 Achados confirmados no código

| Prioridade | Superfície | Evidência | Efeito possível |
|---|---|---|---|
| P0 | `sources::list_project_files` | comando Tauri síncrono; `git` síncrono; fallback recursivo com profundidade 10 e teto 8.000 | congela a thread principal e trunca sem dizer |
| P0 | `useAtMentions` | chama `listProjectFiles` na montagem de cada projeto | trocar projeto pode iniciar varredura sem gesto de busca |
| P0 | raiz ampla não-Git | projetos cadastrados podem apontar para `projetos/` ou para a Home | varredura longa e alertas de privacidade no macOS |
| P0 | `useConversationMapRefresh` | depende da identidade completa de `items` | agenda derivação em cada mudança do streaming |
| P0 | `conversationMaps.scheduleRefresh` | calcula turnos antes de retornar durante run; falha não guarda o digest recusado | custo O(N) por evento e repetição de `input_too_large` |
| P1 | `read_project_context` e `read_project_sources` | comandos síncronos de filesystem | troca de projeto disputa a thread da UI |
| P1 | `ContextPanel` | lê contexto/fontes na troca de projeto e usa `loadGitDiff` para o contador | trabalho fora da aba e patch integral para obter uma contagem |
| P1 | `MissionControl` | permanece montado e atualiza seis famílias de dados a cada 30 segundos | contenção periódica do SQLite quando a tela está escondida |
| P1 | `openProject` e `loadProjectConversations` | têm proteção contra resultado velho, mas não compartilham toda promessa em voo | leituras duplicadas entre sidebar, painel e navegação direta |
| P1 | `mcp_control` | inventário do próprio motor ainda não tem cache de vida do processo | um envio do motor pode pagar subprocesso de inventário outra vez |
| P1 | `fleet/send.ts` | `beginPreparation` ocorre depois da composição assíncrona | a Mesa conserva a forma anterior ao ADR-169 |
| P1 | `CodexAdapter` em `codex exec --json` | descarta `item.started` e `item.updated` | modo Liberado pode parecer mudo durante uma ação longa |
| P1 | `ProcessMemoryWatch` | observa app e filho direto, não toda a árvore | memória e vida de descendentes ficam incompletas |
| P2 | `schedulePersist` | snapshot integral aproximadamente a cada 1,2 segundo | custo cresce com o histórico durante streaming |
| P2 | `saveConversation` | serializa e substitui `conversations.items` inteiro | write amplification e disputa do banco |
| P2 | `work_gateway.append_output` | a cada linha emite a linha e um `ManagedProcessView` com o tail completo | payload e redução crescem durante output volumoso |
| P2 | bolha viva | Markdown acumulado ainda pode ser reprocessado por token | custo quadrático tratado pela F3 do plano do fio |

### 2.3 O que não está provado

- O tamanho do codebase, sozinho, não é uma causa.
- A atividade do WebKit observada em incidentes anteriores não prova OOM nem a
  causa desta latência.
- Um agente ficar vários minutos sem texto não prova que ele travou; pode estar
  executando uma ferramenta, esperando um filho ou sintetizando a resposta.
- O bundle principal é grande, mas partes novas como Planos de voo já são lazy.
  Dividir bundle não sobe de prioridade sem perfil de startup ou transição.

Essas hipóteses continuam mensuráveis, mas não autorizam correção especulativa.

## 3. Invariantes da implementação

### 3.1 Faixa de interação

1. `#[tauri::command]` que toca disco, processo ou rede é assíncrono.
2. Trabalho bloqueante roda em `spawn_blocking` ou serviço equivalente, nunca
   no executor da interface.
3. Resultado assíncrono carrega geração/revisão; resposta velha não pode
   sobrescrever a seleção atual.
4. Trabalho independente compartilha promessa em voo por chave estável.
5. Nenhum efeito cresce com o transcript no caminho de troca de projeto.
6. Entre Enter e `run_manifest`, só permanece trabalho que depende daquele
   turno ou um flush necessário para tornar o contexto exato.

### 3.2 Honestidade e preservação

1. A bolha enviada continua nascendo de `run_manifest`.
2. Rascunho e anexos só são limpos depois do aceite real.
3. Cache mostra idade/revisão quando isso muda o significado do dado.
4. Falha mantém o último dado válido e diz que a atualização falhou.
5. Sem evento de progresso, a UI não inventa etapa em andamento.
6. O Frota nunca mata, retoma ou despacha trabalho sem gesto humano.
7. O chat permanece montado nas trocas de superfície; scroll, seleção e busca
   não podem ser sacrificados para esconder custo de remount.

### 3.3 Escopo e filesystem

1. Nenhuma busca recursiva automática parte da Home.
2. Navegar um nível é diferente de indexar uma árvore inteira.
3. Raiz canônica e caminho relativo são validados antes de qualquer leitura.
4. Symlink de diretório nunca é atravessado implicitamente. A entrada continua
   visível, porque projetos reais usam links para arquivos de configuração; o
   conteúdo só abre quando o alvo canônico continua dentro da raiz autorizada.
5. Limite de segurança nunca é silencioso: toda resposta limitada declara
   `hasMore` ou `truncated`.
6. Em Git, o contrato é rastreados mais não rastreados não ignorados.
7. Fora de Git, regras `.gitignore` e `.ignore` aninhadas precisam ser
   respeitadas pelo enumerador; lista fixa de nomes não é equivalente.

## 4. Arquitetura alvo

```text
gesto humano
    |
    +--> estado local imediato e factual
    |
    +--> serviço assíncrono cancelável
            |
            +--> cache por raiz/conversa/revisão
            |
            +--> worker de filesystem, processo ou banco
            |
            +--> resultado com geração + proveniência + limite

ProjetoFileService
    +--> cache de diretórios ------> aba Arquivos
    +--> índice/busca compartilhada +--> busca da aba Arquivos
                                     +--> autocomplete @

ConversationRuntime
    +--> navegação single-flight
    +--> journal incremental
    +--> export de contexto por revisão
    +--> eventos normalizados do runner
    +--> diagnóstico de silêncio e árvore de processos
```

As duas divisões importantes são:

- árvore e busca não compartilham o mesmo contrato;
- estado do app e sessão nativa do fornecedor não compartilham a mesma fonte de
  verdade. O primeiro continua sendo o dono da continuidade.

## 5. Fase 0, conter o desperdício e instalar a régua

Esta fase é pequena e vem antes das refatorações maiores.

### 5.1 Parar a repetição do mapa

- Calcular o tamanho do payload final codificado, não apenas o tamanho do bloco
  de evidência.
- Comparar esse tamanho ao perfil efetivo antes de chamar `utility_generate`.
- Registrar por tentativa os bytes de `previousMap`, `pins`, `turns`,
  `evidence`, ids permitidos e envelope.
- Manter uma chave de falha por:
  `conversationId + inputDigest + policySignature + promptVersion + pinsRevision`.
- Uma falha determinística como `input_too_large` não tenta outra vez enquanto
  a chave não mudar. Gesto explícito de Atualizar pode tentar novamente, mas
  precisa dizer que está repetindo uma entrada antes recusada.
- Preservar o último mapa válido e marcar a leitura semântica como indisponível
  ou desatualizada. Fatos canônicos e pins humanos continuam visíveis.
- A supressão pode começar em memória para conter o episódio; persistência de
  backoff só entra se o perfil mostrar repetição relevante após restart.

### 5.2 Medir a faixa operacional

Estender `lib/fleet/perf.ts` com spans locais, desligados por padrão:

- `nav.project.intent`;
- `nav.project.meta_ready`;
- `nav.conversation.loaded`;
- `files.root.request` e `files.root.ready`;
- `files.search.request` e `files.search.ready`;
- `composer.submit`;
- `composer.preparation.visible`;
- `runner.manifest`;
- `runner.first_event`;
- `db.conversation.persist`;
- `map.refresh.request` e `map.refresh.settled`.

Adicionar um buffer circular exportável no diagnóstico local. Ele guarda
duração, tamanho, cache hit/miss e código de desfecho, nunca prompt, conteúdo de
arquivo ou segredo.

### 5.3 Guardas determinísticas

- Teste que proíbe `list_project_files` durante mera troca de projeto.
- Teste que uma falha determinística do mapa não chama o gateway de novo com o
  mesmo digest.
- Guarda para novos comandos Tauri síncronos que chamem filesystem/processo.
  Se uma guarda geral não for confiável, cobrir inicialmente a lista fechada de
  comandos desta frente e registrar a dívida da guarda estrutural.
- Fixture real da conversa de aproximadamente 2,38 MiB, sanitizada sem mudar a
  distribuição de itens e tamanhos.

### Gate da Fase 0

- zero repetição automática do mesmo `input_too_large` no mesmo processo;
- relatório local consegue separar interação, banco, IPC e runner;
- nenhuma copy nova aparece para o caso quente abaixo de 1 segundo.

## 6. Fase 1, explorador lazy e busca compartilhada

### 6.1 Contratos Rust

Substituir o uso de inventário completo no explorador por dois comandos:

```rust
pub async fn list_dir_children(
    root: String,
    rel_path: String,
    cursor: Option<String>,
    limit: Option<u32>,
) -> Result<ProjectDirPage, String>

pub async fn search_project_files(
    root: String,
    query: String,
    cursor: Option<String>,
    limit: Option<u32>,
) -> Result<ProjectFileSearchPage, String>
```

O corpo síncrono de filesystem/processo roda fora da thread da UI. Cada pedido
tem deadline, geração e limite máximo imposto pelo backend.

Tipos mínimos:

```text
ProjectDirEntry
  name
  relPath
  kind: directory | file
  isSymlink

ProjectDirPage
  parent
  entries
  nextCursor
  truncated
  rootRevision

ProjectFileSearchPage
  query
  entries
  nextCursor
  truncated
  source: git | ignored-walk
  rootRevision
```

`truncated` não é erro e nunca some da UI. "Fim do teto artificial" significa
fim do corte silencioso global, não resposta sem limite.

### 6.2 Classificação da raiz

O backend classifica a raiz canônica antes de escolher estratégia:

- **repo Git:** busca por inventário Git, incluindo rastreados e não rastreados
  não ignorados;
- **pasta explícita não-Git:** árvore lazy permitida; busca usa walker
  ignore-aware apenas após consulta humana, com deadline, orçamento de visitas
  e paginação;
- **Home ou raiz sensível ampla:** árvore de um nível permitida; busca recursiva
  recusada com orientação para selecionar uma pasta mais específica;
- **raiz inexistente ou inacessível:** falha fechada no efeito, sem manter dados
  de outro projeto na tela.

Não haverá fallback que transforme silenciosamente um erro do Git numa
varredura recursiva ampla. O resultado deve declarar a estratégia escolhida.

### 6.3 Semântica de ignore e symlink

- Usar mecanismo consciente de `.gitignore`/`.ignore` em vez de uma lista
  isolada de diretórios pesados.
- Exclusões estruturais do Frota (`.git`, `.DS_Store`, artefatos conhecidos)
  continuam por cima da regra do projeto.
- Symlinks continuam visíveis. Link de arquivo só abre se o alvo canônico ficar
  na raiz autorizada; link de diretório não é expandido na primeira entrega.
  Isso preserva arquivos reais como `CLAUDE.md` sem transformar um atalho em
  varredura fora do projeto ou introduzir ciclo de diretórios.
- Testar raiz symlinkada, link de arquivo interno/externo, link de diretório,
  symlink intermediário, `..`, caminho absoluto, diretório removido durante a
  leitura e nome não UTF-8.

### 6.4 Cache e concorrência

Criar um serviço/store próprio, não estado apenas do componente:

- chave de diretório: `canonicalRoot + rootRevision + relPath`;
- chave de busca: `canonicalRoot + rootRevision + normalizedQuery + page`;
- single-flight por chave;
- LRU limitado por raiz e bytes aproximados;
- geração por projeto para descartar resposta velha;
- invalidação por Atualizar e por sinal real de mudança do worktree;
- cache de cada raiz preservado ao trocar de aba ou projeto;
- revalidação nunca mostra a árvore de outro projeto como se fosse a atual.

O botão Atualizar conserva expansão, seleção e foco quando os mesmos caminhos
continuarem existindo. Nó removido perde apenas seu estado descendente.

### 6.5 Árvore da aba Arquivos

- `ProjectFilesPanel` pede somente o primeiro nível ao montar.
- Diretório fechado carrega filhos apenas no primeiro `ArrowRight` ou clique.
- Diretório já carregado abre imediatamente.
- Erro de um nó fica naquele nó com ação Tentar novamente; a raiz inteira não
  some.
- `ArrowUp`, `ArrowDown`, `ArrowLeft`, `ArrowRight`, `Home`, `End`, `Enter` e
  espaço seguem uma árvore ARIA com roving tabindex.
- Resultado de busca abre o arquivo no palco e limpar a busca devolve árvore,
  expansão e foco anteriores.
- A contagem deixa de prometer o total global. Copy possível: "N itens nesta
  pasta" e, na busca, "N resultados" mais "há mais resultados" quando houver.
- Feedback segue a régua do STYLEGUIDE: primeiro quadro reserva estado; até 1s
  não pisca spinner; de 1 a 3s usa spinner discreto; acima de 3s nomeia
  "Lendo esta pasta" ou "Buscando arquivos" apenas enquanto o pedido existir.

### 6.6 Busca e autocomplete `@`

O `@` é parte obrigatória desta fase. Sem ele, a causa de troca lenta continua.

- Remover a listagem eager de `useAtMentions`.
- Consulta vazia devolve especialistas, notas e arquivos tocados nesta conversa
  sem indexar o projeto.
- Consulta de arquivo usa `search_project_files` pelo `onSearch` assíncrono do
  `BeautifulMentionsPlugin`.
- Aplicar debounce curto apenas ao backend, calibrado pelo perfil. Personas e
  notas locais continuam instantâneas.
- Resposta velha de uma consulta não substitui uma mais recente.
- O teto visual continua sendo `MAX_POPOVER_ITEMS`; o backend recebe um limite
  pequeno para o `@` e um limite maior para a aba Arquivos.
- O ranqueamento mantém nome exato, prefixo, nome contendo, caminho contendo e
  promoção de arquivos tocados.
- O mesmo arquivo escolhido precisa reconstruir o pill após trocar conversa ou
  reiniciar o app. Como o draft atual persiste apenas texto e anexos, esta
  frente precisa persistir os valores de menção escolhidos ou adotar outro
  contrato equivalente. Não se remove o inventário eager antes de existir um
  teste de round-trip do draft com menção de arquivo.
- Se for adicionada coluna a `conversation_drafts`, seguir
  `ensureComposerDraftTables` + `addColumn`, sem mover rascunho para `useChat`.

### Gate da Fase 1

- trocar de projeto não chama busca recursiva nem inventário global;
- abrir Arquivos muda a superfície no primeiro quadro;
- pasta reaberta não toca o backend até invalidação real;
- Home nunca entra em busca recursiva;
- nenhum limite é silencioso;
- draft com arquivo mencionado sobrevive a remount e restart;
- árvore e `@` usam a mesma fonte de busca, sem listas divergentes.

## 7. Fase 2, navegação transacional e trabalho por aba

### 7.1 Projeto e conversa

- Introduzir single-flight para `ensureLoaded`, `openProject` e
  `loadProjectConversations`, com chaves por projeto/conversa.
- Manter `openGen` como defesa contra resultado velho; single-flight não o
  substitui.
- Unificar o gesto de Sidebar, Inbox, tray e lista de conversas numa função de
  navegação autoritativa. Ela registra intenção, seleciona o shell imediatamente
  e carrega o alvo sem chamadas duplicadas.
- Enquanto o alvo ainda não carregou, o envio fica fail-closed com a conversa
  correta; conteúdo da conversa anterior não pode coexistir com o novo projeto
  como se fosse o alvo.
- Conversa quente aparece do cache; conversa fria mostra estrutura estável sem
  desmontar o `ChatPanel`.
- Prefetch limitado pode carregar a conversa escolhida após a lista de metas,
  nunca todas as conversas do projeto.

### 7.2 Contexto e alterações

- Tornar `read_project_context` e `read_project_sources` assíncronos e mover
  filesystem para worker bloqueante.
- Carregar somente o necessário à aba atual; prewarm só depois da primeira
  pintura e apenas se não competir com turno ou navegação.
- Cachear por raiz canônica e revisão das fontes.
- Substituir `loadGitDiff` do badge por `git_status` ou comando de contagem
  dedicado.
- Carregar o patch completo somente quando Alterações ou um arquivo de diff for
  aberto.
- Alteração de `running` não recarrega patch completo apenas para atualizar uma
  contagem.

### Gate da Fase 2

- um gesto de projeto gera no máximo uma leitura de metas e uma do transcript
  escolhido;
- nenhum patch completo é carregado fora de Alterações;
- aba Contexto fechada não lê suas fontes no caminho crítico;
- alternância rápida A, B, A termina em A sem flash de B tardio;
- rascunho, anexos e scroll continuam pertencendo à conversa correta.

## 8. Fase 3, trabalho oculto só quando há consumidor

### 8.1 Painel

- Manter `MissionControl` montado para preservar o ganho de remount.
- Separar "montado" de "ativo": polling só ocorre quando `viewMode` é Painel e
  a janela está visível.
- Consolidar ledger, entregas, fusões, contagens e lições num snapshot
  compartilhado com uma única revisão.
- Atualizar por mutações reais e revalidar ao revelar com stale-while-revalidate.
- Não zerar a tela durante revalidação nem afirmar que dado velho é atual.

### 8.2 Mapa da conversa

- `useConversationMapRefresh` observa transições de terminalidade, não a
  identidade completa de `items`.
- Durante `running`/`finalizing`, nenhuma geração é agendada e nenhuma passagem
  completa por turnos é feita por delta.
- Manter índice incremental de turnos assentados e watermark, atualizando
  somente a cauda alterada.
- Rebase continua existindo, mas roda em repouso e com orçamento explícito.
- `inputDigest` é calculado antes de marcar geração e governa dedupe,
  cancelamento e backoff.
- `input_too_large`, `invalid_request` e `invalid_response` determinísticos não
  entram em loop. Falhas transitórias usam backoff limitado com jitter e uma
  tentativa por episódio.
- Registrar qual componente do payload ultrapassou o teto para corrigir a
  composição, sem gravar conteúdo sensível.

### 8.3 Saída de processos gerenciados

- `process_output` passa a emitir `{processId, stream, seq, line, updatedAt}` ou
  lote equivalente, não o tail inteiro em toda linha.
- O frontend anexa por sequência e mantém seu próprio tail limitado.
- Snapshot completo fica restrito a start, poll, reconexão e terminal.
- Linhas podem ser coalescidas em lotes curtos, mas não descartadas.
- Persistência recebe o mesmo lote, evitando um save completo por linha.

### Gate da Fase 3

- Painel escondido não faz polling periódico;
- mapa faz no máximo uma tentativa por nova janela terminal/digest;
- zero geração de mapa por `text_delta`;
- `process_output` tem payload proporcional às linhas novas;
- revelar Painel ou Fio Vivo recupera o snapshot sem perder saída.

## 9. Fase 4, envio quente e consistente nas duas superfícies

### 9.1 Preservar o que já foi entregue

- `beginPreparation` do composer principal continua antes do primeiro await
  relevante.
- `redeDePreparo` continua limpando o carimbo em erro síncrono ou assíncrono.
- `run_manifest` continua sendo a fronteira de aceite.
- Enter durante run continua "Interromper e enviar"; Tab continua fila; a fila
  drena uma vez somente depois do terminal real.

### 9.2 Fechar o cache do próprio motor

- Inventário nativo por CLI ganha cache de vida do processo.
- Cache tem single-flight e gesto nomeado de invalidação: instalar/remover MCP,
  trocar CLI, Reverificar ou detectar versão diferente.
- Manifesto registra fonte, idade e última verificação do cache.
- Erro de inventário continua diferente de inventário vazio.
- Nenhum lock permanece segurado enquanto subprocesso sobe.

### 9.3 Trazer a Mesa para o mesmo contrato

- Medir `sendFromDesk` separadamente antes de mover chamadas.
- Declarar preparo no primeiro quadro da superfície da Mesa.
- Reutilizar a mesma rede de limpeza ou extrair uma primitiva compartilhada de
  despacho, sem fundir stores nem perder as guardas específicas da Mesa.
- Não apagar o pedido até `onAccepted` receber `started` ou `queued` real.
- Manter testes de paridade ChatPanel/Mesa e adicionar ordem de preparo.

### 9.4 Contexto do envio por revisão

O transcript integral ainda atravessa a ponte em cada envio. Não trocar isso
por cache possivelmente velho.

Ordem segura:

1. introduzir revisão monotônica da conversa;
2. persistir todo delta pendente antes do run;
3. o backend exporta o contexto da revisão exata a partir da fonte canônica;
4. `run_manifest` carimba a revisão usada;
5. divergência de revisão falha antes do efeito ou refaz o export.

Essa etapa depende da Fase 6. Até lá, o custo integral permanece conhecido e
correto, sem otimização que possa enviar contexto desatualizado.

### 9.5 Feedback proporcional

- Até 100ms, nenhuma animação.
- Até 1s, controle desabilitado com geometria estável.
- Entre 1 e 3s, spinner discreto e acessível.
- Acima de 3s, etapa factual derivada da operação atual, por exemplo:
  "Preparando contexto", "Verificando integrações" ou "Iniciando o agente".
- Nunca usar cronômetro ou estágio sintético para preencher silêncio.

### Gate da Fase 4

- envio quente não inicia inventário nativo novo;
- composer e Mesa mostram aceite/preparo sem limpar prematuramente o pedido;
- fila e interrupção passam a matriz de todos os motores com capabilities;
- `run_manifest` declara cache e revisão usados;
- falha anterior ao manifesto devolve o texto integral ao controle humano.

## 10. Fase 5, distinguir trabalho longo de ponte muda

### 10.1 Eventos do Codex

- No adapter de `codex exec --json`, mapear `item.started` para Tool iniciada e
  `item.updated` para atualização replay-safe quando o payload observado
  suportar isso.
- Usar fixtures reais da versão de CLI suportada. Evento desconhecido continua
  `Unknown`; não inferir ferramenta a partir de prosa.
- Não migrar todos os modos para app-server apenas para obter visibilidade. O
  app-server continua restrito ao contrato em que sua estabilidade e aprovação
  foram provadas.
- A decisão genérica usa capability/transport descriptor, não comparação de
  nome do motor na UI.

### 10.2 Vida e recursos do processo

- Observar o grupo/árvore do processo do run, não apenas o filho direto.
- Expor separadamente: processo principal vivo, número de descendentes, RSS do
  grupo, último byte lido e último evento normalizado.
- Não usar RSS como progresso. Memória apenas descreve recurso.
- Processo principal encerrado sem terminal gera incidente de ponte, não
  "trabalhando" eterno.
- `mc-work` complementa o stream do fornecedor; ausência de uso de `mc-work`
  nunca transforma um run normal em falha.

### 10.3 Watchdog factual

- Auditar quais assinaturas rearmam `itemsSignature`; heartbeat técnico,
  persistência ou métrica não podem fingir progresso do agente.
- Ao atingir o limiar, a linha viva passa a uma destas formas, conforme
  evidência:
  - "Processo ativo, sem eventos há N min";
  - "Processo encerrou sem concluir o turno";
  - "Não foi possível confirmar o estado do processo".
- Pedido de aprovação/pergunta continua "esperando você", não mudo.
- Toast sai uma vez por episódio; a linha permanece factual depois que o toast
  some.
- Ações continuam "Ver conversa" e "Cancelar turno". Nada cancela sozinho.

### Gate da Fase 5

- ação longa do Codex Liberado aparece antes de `item.completed` quando o stream
  nativo publicou o início;
- aos 10 minutos sem evento, a conversa não continua apenas com o genérico
  "está trabalhando";
- processo morto sem terminal é distinguido de processo vivo silencioso;
- cálculo de RSS inclui descendentes pertencentes ao run e nenhum processo de
  outra conversa.

## 11. Fase 6, persistência proporcional à mudança

### 11.1 Decisão de armazenamento

O objetivo é parar de serializar todo o transcript a cada 1,2 segundo sem
reduzir a recuperação após crash. A implementação deve comparar duas opções com
a fixture real antes da ADR:

1. `conversation_items`, UPSERT do item alterado por id/posição, mais snapshot
   compacto em repouso;
2. journal append-only de eventos normalizados, com redução e compactação.

A opção vencedora precisa cumprir todos estes contratos:

- append e atualização de tool/texto são proporcionais à mudança;
- ordem é determinística e replay-safe;
- item atualizado fora da cauda não duplica;
- leitura da conversa de 2,38 MiB permanece dentro do gate;
- crash perde no máximo a mesma janela atual de aproximadamente 1,2 segundo;
- rollback consegue voltar ao JSON integral sem perder evento.

A tendência recomendada é `conversation_items` com snapshot de compatibilidade,
porque o estado final já é composto por itens com ids estáveis. A ADR só fecha
a escolha depois do benchmark de write, load, compactação e recuperação.

### 11.2 Migração sem risco

- Conferir a versão máxima real em `src-tauri/src/lib.rs`.
- Uma migration por statement.
- Criar `ensureConversationItemTables` e `addColumn` no frontend se houver
  tabela/coluna consumida pelo TypeScript.
- Primeira etapa faz dual-write e continua lendo `conversations.items`.
- Comparar hash/contagem/ordem entre snapshot e itens incrementais.
- Segunda etapa prefere a fonte nova e usa o snapshot como fallback.
- Terceira etapa compacta em idle/terminal, mantendo export e rollback.
- Nunca fazer backfill pesado no primeiro quadro do boot; usar lotes e progresso
  factual fora do caminho de navegação.

### 11.3 Integração com envio e work events

- O reducer devolve ids/posições alterados ou um change-set explícito.
- Persistência coalesce change-sets, não snapshots inteiros.
- `process_output` em lote atualiza somente o item da ferramenta correspondente.
- Antes do envio, flush da revisão atual é obrigatório e limitado à cauda
  pendente.
- Export de contexto passa a ler a revisão confirmada no backend.

### Gate da Fase 6

- bytes escritos por `text_delta` deixam de crescer com o transcript;
- reload após kill controlado reconstrói exatamente itens, tools e sessão;
- dual-write encontra zero divergência na suíte e no soak;
- nenhuma migração bloqueia a primeira pintura;
- envio nunca exporta revisão anterior à fala visível.

## 12. Fase 7, renderização do fio sem duplicar plano

Esta fase é executada pelo dono existente `docs/fluidez-do-fio-plan.md`:

1. F3, Markdown por blocos na bolha viva;
2. F4a, régua independente do DOM;
3. F4b, busca no fio;
4. F4c, virtualização atrás de flag e com rollback.

Dependências deste plano:

- a persistência incremental não pode destruir a identidade estável usada pelos
  blocos;
- navegação não pode remontar o chat e invalidar todos os memos;
- virtualização só entra depois de preservar busca, seleção, scroll, âncoras,
  anexos e lightbox;
- os contadores determinísticos de fluidez continuam sendo gate de CI.

Bundle splitting e troca de substrato ficam fora enquanto o perfil não os
colocar acima de filesystem, mapa, persistência ou Markdown.

## 13. Matriz de testes

### 13.1 Rust

- diretório comum, vazio, inacessível e removido durante leitura;
- traversal absoluto/relativo e symlinks internos/externos;
- Git com rastreado, não rastreado e ignorado aninhado;
- pasta não-Git com `.ignore` aninhado;
- Home recusada para busca recursiva;
- paginação sem duplicar, pular ou reordenar itens;
- timeout e resultado tardio;
- cache do inventário da própria CLI, invalidação e single-flight;
- fixtures reais de `item.started`, `item.updated`, `item.completed`;
- grupo de processos sem contaminar outro run;
- migração, dual-write, replay e fallback do transcript.

### 13.2 TypeScript e stores

- árvore lazy imutável e projeção apenas dos nós visíveis;
- single-flight por raiz, diretório, busca, projeto e conversa;
- geração A, B, A com respostas fora de ordem;
- resultado limitado mantém `truncated`;
- busca e árvore preservam expansão, foco e seleção;
- `@` vazio não indexa e query usa busca assíncrona;
- menção de arquivo faz round-trip no rascunho;
- mapa não agenda em delta e deduplica digest recusado;
- polling respeita view e visibilidade;
- change-set de persistência atualiza item correto;
- fila drena uma vez em success, error e cancelled.

### 13.3 Componentes

- árvore ARIA por teclado, inclusive Home/End e retry por nó;
- copy de parcial, vazio, erro, cache desatualizado e raiz ampla;
- feedback de duração sem spinner piscando;
- composer e Mesa mantêm geometria no preparo;
- linha viva distingue processo ativo, morto e desconhecido;
- `prefers-reduced-motion` conserva sinal estático visível;
- temas claro/escuro e painel na largura mínima.

### 13.4 Integração e soak

Cenários obrigatórios:

1. alternar 30 vezes entre dois repos Git e uma pasta não-Git;
2. selecionar uma raiz ampla sem disparar scan da Home;
3. pesquisar e mencionar arquivo em repo grande;
4. abrir conversa de aproximadamente 2,38 MiB, enviar, interromper, enfileirar e
   retomar;
5. manter dois agentes rodando enquanto navega e abre diff;
6. processo gerenciado emitindo milhares de linhas;
7. mapa com payload acima do limite e mesma conversa recebendo novos deltas;
8. matar o app durante streaming e validar recuperação exata;
9. janela escondida por 10 minutos sem polling indevido;
10. sessão Codex Liberado com comando longo e eventos de início/fim.

Fixtures de stream vêm de payload real sanitizado, conforme ADR-016.

## 14. Metas de desempenho e correção

Metas propostas para a máquina de referência; confirmar baseline antes de
transformar tempo de parede em gate local. CI usa invariantes determinísticas.

| Gesto/fluxo | Meta |
|---|---|
| feedback visual de clique ou Enter | até 100ms |
| projeto quente, shell correto visível | p95 até 120ms |
| conversa fria de até 2,5 MiB | p95 até 500ms |
| expansão de pasta local já no cache | sem IPC |
| expansão fria de pasta local | p95 até 150ms depois do gesto |
| autocomplete local de especialista/nota | até 100ms |
| busca de arquivo após debounce | p95 até 300ms para primeira página |
| `run_manifest` com caches quentes | p95 até 500ms |
| query comum do SQLite durante run | p95 abaixo de 20ms, p99 abaixo de 100ms |
| long task atribuível a navegação/envio | nenhuma acima de 50ms |
| scan recursivo automático da Home | zero |
| diff completo fora da aba Alterações | zero |
| polling do Painel escondido | zero |
| geração de mapa durante streaming | zero |
| repetição do mesmo digest determinístico | zero |
| perda de rascunho/anexo/saída | zero |
| despacho ou cancelamento automático novo | zero |

Tempo de filesystem remoto, volume lento ou CLI externa pode ultrapassar a
meta. Nesses casos a interface continua responsiva, mostra a operação factual e
permite cancelar ou seguir trabalhando.

## 15. Ordem de entrega e rollback

Cada linha é uma entrega isolada. Não juntar tudo num único PR.

| Entrega | Conteúdo | Rollback seguro |
|---|---|---|
| A | dedupe/size do mapa + spans operacionais | remover instrumentação e manter último mapa válido |
| B | comandos async, escopo e árvore lazy | voltar o painel, sem reativar scan eager no `@` |
| C | busca compartilhada + `@` assíncrono + round-trip de menção | manter busca da aba e restaurar somente o fornecedor de sugestões |
| D | single-flight de navegação + contexto/diff por aba | desativar prefetch, preservando geração contra resposta velha |
| E | Painel ativo e mapa por terminalidade + output incremental | voltar ao snapshot no poll, sem voltar ao evento-tail por linha |
| F | cache de inventário + preparo da Mesa | invalidar cache por gesto e manter fallback de inventário explícito |
| G | eventos do runner + liveness da árvore de processo | degradar para Unknown, nunca para progresso inventado |
| H | persistência incremental em dual-write | continuar lendo snapshot integral |
| I | F3/F4 do plano do fio | flag de virtualização volta ao render estável anterior |

Regras de promoção:

- nenhuma entrega afrouxa teste ou baseline;
- cada mudança estrutural atualiza ADR, arquitetura e plano dono;
- mudança de UI passa pela rubrica do STYLEGUIDE nos dois temas;
- suíte completa antes de build: `bun run test`, `bun run check`,
  `bunx tsc -b --force`, `bun run build`, `cargo test` e E2E afetado;
- build instalada só depois de pedido humano e verificação de artefato, assinatura
  e equivalência.

## 16. Arquivos e donos prováveis

### Explorador e busca

- `app/src-tauri/src/sources.rs`
- `app/src-tauri/src/lib.rs`
- `app/src/lib/sources.ts`
- `app/src/lib/fileTree.ts`
- novo serviço/store de índice de projeto
- `app/src/components/layout/ProjectFilesPanel.tsx`
- `app/src/hooks/useAtMentions.ts`
- `app/src/hooks/useMentionSearch.ts`
- `app/src/components/chat/LexicalComposer.tsx`
- `app/src/components/chat/lexicalDraft.ts`
- `app/src/store/composerDrafts.ts`
- `app/src/lib/db/conversationDrafts.ts`
- `app/src/lib/db/schema.ts`

### Navegação e trabalho oculto

- `app/src/store/chat.ts`
- `app/src/store/app.ts`
- `app/src/components/layout/Sidebar.tsx`
- `app/src/components/layout/ConversationList.tsx`
- `app/src/components/layout/ContextPanel.tsx`
- `app/src/components/panel/MissionControl.tsx`
- `app/src/store/conversationMaps.ts`
- `app/src/components/chat/useConversationMapRefresh.ts`
- `app/src/lib/conversationMap/*`
- `app/src/lib/utility/*`

### Envio, runner e persistência

- `app/src/components/chat/ChatPanel.tsx`
- `app/src/components/chat/redeDePreparo.ts`
- `app/src/lib/fleet/send.ts`
- `app/src-tauri/src/mcp_control.rs`
- `app/src-tauri/src/agent.rs`
- `app/src-tauri/src/adapters.rs`
- `app/src-tauri/src/codex_appserver.rs`
- `app/src-tauri/src/run_resources.rs`
- `app/src-tauri/src/work_gateway.rs`
- `app/src/lib/watchdog.ts`
- `app/src/lib/work.ts`
- `app/src/lib/db/conversations.ts`
- `app/src-tauri/src/lib.rs` para migrations canônicas

## 17. Fora de escopo

- trocar Tauri/React/WebKit por outro substrato;
- redesenhar o produto Arquivos ou transformar o visualizador em editor;
- adicionar daemon ou indexador permanente fora do app;
- usar cloud para indexar arquivos locais;
- despachar subtarefa ou cancelar run sem decisão humana;
- fazer o mapa da conversa entrar no prompt do agente;
- usar virtualização antes da F4 preservar busca e navegação;
- tratar toda demora externa como bug do Frota;
- otimizar bundle sem perfil que o coloque no caminho crítico.

## 18. Definition of done

O plano termina quando, na mesma build candidata:

- trocar projeto não inicia filesystem recursivo, diff integral nem trabalho de
  aba fechada;
- Arquivos navega por diretório, pesquisa com limites visíveis e compartilha a
  busca com o `@`;
- Home nunca é indexada recursivamente;
- contexto, fontes e comandos de arquivo não bloqueiam a thread da UI;
- mapa não deriva por token nem repete entrada determinística recusada;
- Painel escondido não consulta periodicamente o banco;
- o envio principal e a Mesa dão feedback no primeiro quadro e usam caches
  factuais;
- Codex Liberado mostra ações que seu stream realmente publicou;
- silêncio distingue processo vivo, morto, bloqueado e desconhecido;
- persistência e output são proporcionais à mudança, com recuperação integral;
- fio preserva rascunho, anexos, scroll, seleção, busca e contexto;
- as metas são medidas nos cenários de soak e as invariantes determinísticas
  passam na CI;
- docs, ADRs, contratos gêmeos e call sites descrevem a mesma implementação.
