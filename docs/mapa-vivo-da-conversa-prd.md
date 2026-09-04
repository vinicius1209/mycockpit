# PRD, mapa vivo da conversa

> Status: primeira entrega implementada e validada, 04/09/2026.
> Frente de origem: `docs/sidebar-cockpit-plan.md`.
> Contrato técnico: `docs/mapa-vivo-da-conversa-spec.md`.
> Relação com memória: complementa `docs/memoria-de-conversa-plan.md`, mas não
> substitui o orçamento semântico usado em handoff e compactação.
> Decisão de produto: a conversa linear continua sendo um chat livre. O Frota
> não exige que a pessoa declare uma meta antes de conversar.

> **Registro da entrega:** a aba `Conversa` substituiu `Plano`, com fatos
> imediatos, leitura semântica versionada, fontes no fio e ajustes humanos. A
> rota padrão é local e gratuita. No Mac compatível, o sidecar Foundation
> Models é one-shot, sem tools, MCP, rede ou sessão persistente; sem essa rota,
> a superfície continua com fatos canônicos. A medição real no M1 Pro variou
> entre 12,5 s e 39,7 s, por isso a geração assíncrona usa teto de 45 s e mantém
> o último mapa válido durante a espera. Fallback remoto do mapa permanece fora
> da UI até existir consentimento específico.

## 1. Resumo executivo

O painel atual chama de “Norte da conversa” a combinação entre título, primeiro
pedido e última resposta concluída. Esses elementos são rastreáveis, mas não
explicam uma conversa longa. O primeiro pedido pode ser exploratório, casual,
incompleto ou já ter sido substituído por outro assunto. A última resposta pode
ser apenas uma etapa intermediária.

Esta frente transforma a aba lateral num **mapa vivo da conversa**: uma leitura
curta, estruturada, revisável e com fontes sobre o que a conversa passou a
tratar. Ela funciona sem configuração prévia e evolui conforme novos turnos são
concluídos.

O mapa separa quatro naturezas de informação:

1. **Evidência original:** assunto inicial e trechos do fio, sem reescrita.
2. **Leitura semântica:** foco atual, mudanças de rumo, entendimentos e pontos
   em aberto, produzidos por um modelo e sempre ligados aos itens de origem.
3. **Estado operacional:** plano publicado, tarefas, trabalho em segundo plano,
   falhas e pedidos pendentes, derivados das fontes canônicas do Frota.
4. **Correções humanas:** contexto que a pessoa ajustou ou fixou e que nenhum
   modelo pode sobrescrever.

No macOS compatível, a primeira fonte semântica será o modelo on-device do
Foundation Models, a tecnologia que alimenta Apple Intelligence. Em qualquer
outro caso, o produto mantém uma projeção determinística imediata e pode usar
um helper alternativo quando a pessoa tiver autorizado essa rota.

O mapa não despacha trabalho, não cria plano, não altera o transcript, não
resume silenciosamente para dentro do prompt do agente e não bloqueia o envio
de mensagens.

## 2. Correção conceitual

### 2.1 Uma conversa não nasce como missão

No modo linear, o uso normal é semelhante a um chat:

1. a pessoa abre uma conversa;
2. escreve algo que pode ou não conter um pedido completo;
3. descobre o problema junto com o agente;
4. muda de direção, corrige premissas e acrescenta restrições;
5. decide, ou não, transformar parte da conversa em trabalho estruturado.

Portanto, **“objetivo” não é um campo obrigatório**. O produto reconhece graus
de estrutura sem impor um formulário mental à pessoa.

### 2.2 Vocabulário fechado

| termo | significado | quem pode produzi-lo |
|---|---|---|
| **Assunto inicial** | primeiro conteúdo humano útil; é origem, não compromisso | projeção determinística |
| **Foco atual** | melhor leitura provisória do que ocupa a conversa agora | modelo ou correção humana |
| **Objetivo explícito** | resultado que a pessoa declarou ou fixou sem ambiguidade | pessoa; o modelo só pode propor |
| **Mudança de rumo** | transição relevante entre focos, com antes, depois e fontes | modelo estruturado |
| **Entendimento** | fato, preferência ou restrição que permanece vigente | modelo, com fonte e nível de certeza |
| **Ponto em aberto** | pergunta, decisão ou problema ainda não encerrado | modelo ou estado canônico |
| **Último desfecho** | resultado observado do turno mais recente | estado canônico e recibo do turno |
| **Etapa** | item de um plano publicado pelo agente | `TaskCreate` e `TaskUpdate` |

Na UI, `Objetivo explícito` só aparece quando existir. O fallback visual nunca
renomeia `Foco atual` para objetivo.

### 2.3 O que “determinístico” significa nesta frente

A projeção determinística não tenta compreender toda a conversa. Ela garante
uma superfície útil enquanto a camada semântica não está disponível:

- assunto inicial original;
- título persistido;
- último turno encerrado e seu desfecho;
- plano e tarefas canônicas;
- trabalho em segundo plano realmente vivo;
- pedidos pendentes realmente observados;
- idade do último mapa válido.

Ela é o esqueleto honesto do painel, não o resumo ideal. O modelo acrescenta
interpretação sem ganhar autoridade sobre esses fatos.

## 3. Problema do produto

### 3.1 Sintoma atual

Em conversas longas, a pessoa abre a aba lateral e encontra um trecho do
primeiro prompt e um pedaço da última resposta. Para se orientar, ainda precisa
reler o fio e reconstruir mentalmente:

- qual assunto permaneceu relevante;
- o que mudou desde o pedido inicial;
- quais decisões ou restrições continuam valendo;
- o que já foi resolvido;
- o que ficou pendente;
- por que o agente está fazendo o que faz agora.

### 3.2 Causas

- A projeção atual é posicional, início e fim, não semântica.
- Um chat livre não oferece um campo explícito de objetivo.
- Respostas longas misturam raciocínio, operações, resultado e próximos passos.
- Plano, transcript e memória de handoff respondem perguntas diferentes.
- Uma síntese opaca sem fontes poderia parecer correta mesmo quando estiver
  desatualizada ou interpretar mal uma correção humana.

### 3.3 Oportunidade

O Frota já possui itens tipados, ids estáveis, resultados, tarefas, recibos,
custos e um orçamento semântico para memória. Isso permite combinar precisão
estrutural com interpretação local, sem transformar o painel em outra fonte de
verdade.

## 4. Resultado esperado

Depois de abrir o painel, a pessoa deve conseguir responder em poucos segundos:

1. Sobre o que esta conversa trata agora?
2. Como ela chegou até aqui?
3. O que já está entendido ou fixado?
4. O que ainda está em aberto?
5. O que aconteceu no último turno?
6. Existe trabalho real em andamento ou esperando uma decisão?

O produto é bem-sucedido quando essa leitura reduz a necessidade de percorrer
o histórico sem esconder que uma parte dela foi inferida.

## 5. Pessoas e cenários principais

### 5.1 Conversa exploratória

A pessoa pergunta sobre uma ideia, compara possibilidades e só depois formula
um pedido. O mapa começa pelo assunto inicial, mostra um foco provisório e não
inventa objetivo, plano ou pendência.

### 5.2 Trabalho iterativo

A conversa alterna diagnóstico, implementação, teste e correção. O mapa mantém
o foco atual e uma trajetória curta, sem copiar cada resposta do agente.

### 5.3 Mudança real de assunto

A pessoa abandona a primeira frente e passa a discutir outra. O mapa registra
que o rumo mudou e reduz o assunto antigo a histórico. O primeiro prompt não
continua comandando a tela.

### 5.4 Correção humana

O modelo entendeu errado o foco. A pessoa usa “Ajustar leitura”, corrige uma
frase e pode fixá-la. A correção vence futuras gerações até ser liberada.

### 5.5 Conversa sem modelo disponível

O Mac não oferece Apple Intelligence, o modelo ainda está sendo preparado ou o
locale não é suportado. A aba continua funcional com evidência e estado
determinístico. Se houver fallback autorizado, ele pode assumir a leitura.

### 5.6 Conversa muito longa

O transcript excede a janela do modelo on-device. O Frota atualiza o mapa por
incrementos, compacta capítulos antigos e faz rebase em blocos, sem truncar o
miolo silenciosamente.

## 6. Princípios e invariantes

1. **Chat primeiro:** nenhuma pergunta de onboarding exige meta, escopo ou
   plano antes do primeiro envio.
2. **Interpretação não é verdade:** toda afirmação semântica guarda fontes e
   nível de certeza.
3. **Pessoa vence modelo:** correção fixada não é reescrita automaticamente.
4. **Estado canônico vence resumo:** tarefa, run, falha, custo e decisão
   pendente continuam nos donos atuais.
5. **Sem atividade inventada:** o mapa pode dizer “em discussão”, nunca
   “executando” sem um run real.
6. **Incremental por padrão:** turnos novos atualizam um estado pequeno; não se
   reenvia o transcript completo a cada mensagem.
7. **Local primeiro:** no Mac compatível, Foundation Models é a rota preferida.
8. **Fallback não bloqueante:** nenhuma falha de resumo impede conversar.
9. **Custo consentido:** fallback faturável nunca liga por consequência de um
   erro local; exige política aprovada pela pessoa.
10. **Sem ferramentas:** o gerador de mapa recebe texto enquadrado e não recebe
    MCP, shell, arquivos, sessão retomável ou capacidade de efeito.
11. **Sem poluir o fio:** geração do mapa não cria mensagem, conversa, turno,
    notificação de conclusão ou presença na frota.
12. **Sem dependência circular:** na v1, o mapa não é injetado no agente. Uma
    futura integração com handoff exige avaliação e decisão próprias.
13. **Fail-open no render:** payload desconhecido mantém a projeção segura.
14. **Fail-closed no efeito:** resposta inválida nunca substitui o último mapa
    válido.

## 7. Arquitetura de informação

### 7.1 Modelo semântico

```ts
type EvidenceRef = {
  itemId: string
  role: "user" | "assistant" | "system"
}

type SemanticClaim = {
  id: string
  text: string
  certainty: "explicit" | "inferred"
  evidence: EvidenceRef[]
}

type DirectionChange = {
  from: string
  to: string
  evidence: EvidenceRef[]
}

type ConversationMapV1 = {
  schemaVersion: 1
  initialSubject: SemanticClaim | null
  currentFocus: SemanticClaim | null
  explicitGoal: SemanticClaim | null
  directionChanges: DirectionChange[]
  understandings: SemanticClaim[]
  constraints: SemanticClaim[]
  openThreads: SemanticClaim[]
  latestOutcome: SemanticClaim | null
  summarizedThroughItemId: string | null
}
```

### 7.2 Regras do schema

- `initialSubject` conserva a origem e não muda durante a vida da conversa.
- `currentFocus` pode mudar; o anterior só permanece se explicar a trajetória.
- `explicitGoal` fica `null` quando o chat não contém uma meta declarada.
- Todo claim inferido possui ao menos uma referência válida.
- Claim com `certainty: explicit` precisa citar conteúdo humano. Uma fala do
  agente, sozinha, não transforma hipótese em decisão do usuário.
- `directionChanges` guarda no máximo quatro transições significativas.
- `understandings`, `constraints` e `openThreads` guardam no máximo cinco itens
  cada. Itens assentados recuam; o painel não vira arquivo morto.
- `latestOutcome` não declara sucesso se o resultado canônico falhou, foi
  interrompido ou ainda não terminou.
- Texto de claim tem limites de caracteres definidos e validados antes de
  persistir.
- Referência a item inexistente invalida a geração inteira.

### 7.3 Camada humana separada

Correções não ficam misturadas ao JSON gerado:

```ts
type ConversationMapPins = {
  currentFocus?: { text: string; pinnedAt: number }
  explicitGoal?: { text: string; pinnedAt: number }
  constraints?: Array<{ id: string; text: string; pinnedAt: number }>
}
```

O compositor da view aplica a ordem:

```text
correção humana > fato canônico > leitura semântica > evidência original
```

Limpar uma correção volta a permitir a leitura do modelo. A correção não edita
mensagens antigas e não é enviada ao agente nesta entrega.

### 7.4 Estado operacional fora do modelo

A view final combina o mapa persistido com valores derivados no momento do
render:

- `deriveTasks(items)`;
- `pendingDeferred(items)`;
- pedidos humanos pendentes resolvidos pelo `run_id`;
- último resultado e recibo de turno;
- estado `running` e `finalizing` da conversa;
- idade e validade do mapa.

Esses campos não entram no payload que o modelo pode reescrever.

## 8. Experiência do painel

### 8.1 Nome e lugar

A aba hoje chamada `Plano` passa a se chamar **Conversa**. Ela continua
abrigando o plano canônico quando existir, mas não pressupõe que todo chat tenha
um. Em larguras estreitas, o ícone permanece com `aria-label` e `title`, pelo
contrato de degradação das abas do painel.

### 8.2 Composição proposta

```text
Conversa                                      Atualizada agora

Rumo atual
Corrigir o scroll automático sem roubar a leitura manual.
Leitura do fio · Ver fontes

Trajetória
Rolagem automática  →  detecção da intenção de leitura  →  validação

Entendido até aqui
• Trocar de conversa deve chegar ao fim imediatamente.
• Scroll manual para cima suspende o acompanhamento.

Em aberto
• Confirmar o retorno automático depois de novas mensagens.

Último desfecho
Os testes do hook passaram; falta inspeção no aplicativo.

Etapas
[checklist canônica, somente se existir]

Trabalho em segundo plano
[somente atividade real, somente se existir]
```

### 8.3 Direção visual

- O elemento memorável é a **trajetória**, uma linha curta de mudanças de rumo,
  não uma pilha de cartões.
- `Rumo atual` recebe a maior ênfase tipográfica permitida no painel.
- As seções usam proximidade assimétrica do `Section` canônico.
- Não há cartão dentro do painel E1 para cada tópico.
- Cinza carrega o estado saudável. Cor só aparece para decisão pendente, run
  vivo ou falha, nos papéis já definidos pelo guia.
- Não há gradiente, score de confiança, porcentagem teatral ou avatar de IA.
- A origem `Leitura do fio` é metadado discreto, não badge permanente.
- Itens com fonte abrem um detalhe simples: trecho, autor e ação “Ver no fio”.
- “Ver no fio” navega pelo wrapper real do transcript e respeita ADR-122; não
  usa `scrollIntoView` em superfície flexível.

### 8.4 Estados da UI

#### Conversa vazia

Texto: `A conversa ainda não começou.`

Não existe CTA para definir objetivo.

#### Primeiro envio ainda sem resposta

Mostra `Assunto inicial` com o trecho original. Não exibe “atualizando” como se
houvesse inferência concluída.

#### Atualização em andamento

Mantém o mapa anterior. Se o painel estiver aberto, o metadado muda para
`Atualizando leitura…` com movimento cinza e reduzido quando solicitado pelo
sistema. O conteúdo não some e não entra em skeleton.

#### Atualizado

Mostra `Atualizada agora` ou horário absoluto quando necessário. A interface
não expõe o nome do modelo na leitura cotidiana.

#### Desatualizado

Se houver itens posteriores ao watermark, mostra `2 turnos novos` e a ação
`Atualizar`. O mapa antigo permanece legível.

#### Modelo local indisponível

A projeção determinística continua sem alerta no painel. O motivo detalhado
fica nas Configurações. Se a pessoa pedir atualização manual e nenhuma rota
semântica existir, o retorno é: `A leitura inteligente não está disponível;
os fatos da conversa continuam atualizados.`

#### Resposta inválida ou prazo esgotado

O último mapa válido permanece. Uma falha isolada não gera toast. Falhas
repetidas aparecem em Configurações e logs, nunca como erro do turno principal.

#### Correção humana

A ação `Ajustar leitura` abre um editor pequeno para `Rumo atual`. A opção
`Fixar esta leitura` impede substituição automática e muda o metadado para
`Fixado por você`. `Voltar à leitura automática` remove apenas o pin.

## 9. Geração incremental

### 9.1 Unidade de atualização

O pipeline trabalha por **turnos assentados**, não por eventos individuais.
Um turno assenta quando ocorre um destes desfechos:

- `result` concluído, com sucesso ou falha;
- cancelamento confirmado;
- incidente terminal que encerrou o run;
- mensagem humana sem run, quando a conversa fica ociosa pelo debounce.

Texto parcial, delta de streaming e ferramenta ainda aberta não avançam o
watermark.

### 9.2 Entrada do modelo

Cada atualização recebe somente:

1. schema e instruções confiáveis;
2. último mapa válido;
3. pins humanos;
4. novos turnos desde `summarizedThroughItemId`;
5. sinais determinísticos relevantes, marcados como dados;
6. ids dos itens que podem ser citados.

Conteúdo da conversa é entrada não confiável. Ele é serializado em blocos com
papel e id e nunca interpolado nas instruções de sistema.

### 9.3 Redutor

O gerador produz um mapa completo pequeno, não um patch textual. O frontend ou
backend valida:

- schema;
- limites;
- enumerações;
- unicidade dos ids;
- existência e papel das referências;
- watermark monotônico;
- compatibilidade com o desfecho canônico.

Somente depois da validação o snapshot substitui o anterior de forma atômica.

### 9.4 Conversas maiores que a janela

O modelo on-device informa sua janela em runtime. O pipeline nunca assume um
número fixo. Quando a entrada exceder o teto:

1. preserva o mapa anterior e os pins;
2. divide novos itens por fronteira de turno;
3. atualiza o mapa sequencialmente, um bloco por sessão curta;
4. registra quantos blocos foram necessários;
5. cancela sem persistir se qualquer bloco produzir referência inválida.

Não existe corte cego por início e fim.

### 9.5 Rebase periódico

Atualização incremental pode acumular interpretação ruim. Um rebase é feito:

- quando muda `schemaVersion` ou `promptVersion`;
- quando uma fonte citada deixa de existir após clone/importação;
- após 20 turnos assentados desde o último rebase;
- após uma correção humana relevante;
- por gesto `Reconstruir leitura` nas Configurações.

O rebase usa o seletor semântico já existente em
`lib/memoriaDaConversa.ts`, preserva todos os pedidos humanos e processa o
restante em blocos. O mapa atual só é trocado ao fim do rebase completo.

## 10. Apple Intelligence como primeira rota

### 10.1 Escolha técnica

Criar um sidecar Swift separado, provisoriamente chamado
`frota-intelligence`, seguindo o padrão já provado pelo ditado:

- compilado por `swiftc` no `build.rs`;
- incluído em `bundle.externalBin` no macOS;
- assinado junto com o aplicativo;
- stdin e stdout em JSON por linha;
- processo iniciado e encerrado pelo Frota;
- sem daemon independente;
- sem rede, ferramentas ou leitura de arquivos;
- uma geração por processo na primeira versão, liberando recursos ao terminar.

O sidecar do ditado não deve absorver esta função. Reconhecimento contínuo de
áudio e inferência textual curta têm dependências, permissões e ciclos de vida
diferentes; juntar os dois ampliaria o raio de falha.

### 10.2 Contrato nativo

```text
--probe
  saída: disponibilidade, motivo, locales suportados, contextSize

--summarize
  entrada: SummaryRequestV1 em stdin
  saída: SummaryResponseV1 em stdout
```

No Swift:

- proteger importação com `#if canImport(FoundationModels)`;
- proteger execução com disponibilidade da versão do macOS;
- consultar `SystemLanguageModel.default.availability`;
- validar `supportsLocale(Locale(identifier: "pt_BR"))`;
- usar `LanguageModelSession` sem tools;
- gerar pelo `GenerationSchema` dinâmico equivalente a `ConversationMapV1`;
- não chamar `prewarm` no boot;
- nunca manter uma sessão viva depois do pedido;
- rejeitar segunda geração concorrente;
- devolver erro tipado, sem texto livre como protocolo.

### 10.3 Por que Guided Generation

O Foundation Models consegue gerar tipos Swift com schema e amostragem
restrita. Isso reduz parsing frágil, mas não substitui validação de semântica,
fontes, watermark ou limites. Saída estruturalmente válida ainda pode conter
uma interpretação ruim.

### 10.4 Disponibilidade observável

O probe publica uma destas condições genéricas:

```text
available
unsupported_os
device_not_eligible
intelligence_disabled
model_not_ready
locale_unsupported
framework_unavailable
probe_failed
```

O mapeamento dos enums da Apple para essas condições mora dentro do adapter
nativo. A UI não compara textos ou modelos de Mac.

### 10.5 Limites de recursos

- Nenhum preload no boot.
- Uma geração local por vez em todo o aplicativo.
- Prioridade abaixo do run principal e nunca concorrente com build ou operação
  explicitamente marcada como pesada, quando esse sinal estiver disponível.
- Payload limitado antes do spawn.
- Prazo de geração e cancelamento pelo id da tentativa.
- Encerramento do sidecar quando a janela principal fechar ou a tentativa for
  invalidada.
- Logs rotativos sem transcript, prompt ou resposta completos.

Essas guardas existem para que uma conveniência de orientação não concorra com
o trabalho principal nem volte a criar consumo de memória sem teto.

## 11. Gateway agnóstico e fallbacks

### 11.1 Dívida atual

O comando `suggest` existente é um one-shot contido e sem MCP, mas instancia um
CLI específico. Ele pode inspirar timeouts, contenção e invalidação; não é a
fronteira final desta feature.

As **pills sugeridas no composer** são o consumidor mais visível desse comando,
por meio de `store/chat/suggestions.ts`, mas não são o único. A auditoria do
estado atual encontrou estas famílias:

| finalidade | consumidor atual | política hoje |
|---|---|---|
| próximas ações do composer | `store/chat/suggestions.ts` | debounce e token por conversa |
| recibo do turno em background | `lib/turnReceipt.ts` | prazo próprio e fallback textual |
| destilar aprendizado | `lib/learning.ts` | parser e no-op próprios |
| rascunhar skill | `lib/skills.ts` | template determinístico próprio |
| curar catálogo de modelos | `lib/modelCurator.ts` | frequência semanal e cwd neutro |
| destilar correções de missão | `lib/missionDelivery.ts` | delega para aprendizado |

Além disso, o juiz do Fusion compartilha o builder Rust `claude_oneshot`, mas
tem responsabilidade e risco diferentes. Ele não deve ser misturado às tarefas
baratas só porque hoje usa o mesmo processo.

O problema não é haver prompts diferentes. Cada finalidade precisa de contrato
próprio. A dívida é cada consumidor também precisar decidir transporte,
provider, contenção, retry, custo, observabilidade e interpretação de erro.

### 11.2 Nova fronteira

Criar `UtilityInferenceGateway`, independente de chat e de sessão de agente:

```ts
type UtilityCapability = {
  id: string
  available: boolean
  supportedTasks: UtilityTaskKind[]
  locality: "device" | "local-process" | "remote"
  billable: boolean
  structuredOutput: boolean
  sessionless: boolean
  toolsDisabled: boolean
  reportsCost: boolean
  supportedLocales: string[] | "runtime"
  maxInputTokens: number | "runtime"
}
```

O roteador pergunta por capability. Código genérico não compara nome de motor.
Adapters Rust e o espelho TypeScript recebem testes-gêmeos.
Uma fonte só entra na disputa quando suporta a finalidade, o schema, o locale e
o volume de entrada daquela chamada. Ser on-device não basta se o pedido não
cabe na janela ou exige um contrato que a fonte não entrega.

### 11.3 Perfis por finalidade

Centralizar transporte não significa criar um prompt universal. Cada chamada
declara um perfil fechado:

```ts
type UtilityTaskKind =
  | "conversation_map"
  | "composer_suggestions"
  | "turn_receipt"
  | "lesson_distillation"
  | "skill_draft"
  | "model_curator"

type UtilityRequest<TInput> = {
  task: UtilityTaskKind
  input: TInput
  projectId?: string
  conversationId?: string
  inputDigest: string
  deadlineMs: number
  routePolicy: "device_only" | "free_only" | "approved_helper"
}
```

Um registry de perfis define para cada tarefa:

- prompt versionado;
- schema de entrada e saída;
- janela e limites;
- localidade permitida;
- se pode usar rota faturável;
- prazo e política de cancelamento;
- fallback determinístico;
- se o resultado pode ser persistido;
- como custo e falha são registrados.

O domínio continua dono do significado. Por exemplo, `parseSuggestions`
continua sabendo que uma pill tem até seis palavras, enquanto o gateway sabe
como obter e validar uma resposta estruturada. `turnReceipt` continua sabendo
quando uma notificação pode esperar, enquanto o gateway executa a corrida com
prazo e cancela a tentativa perdedora quando o transporte permitir.

### 11.4 Uma resolução de configuração

Hoje vários call sites repetem a precedência entre helper do projeto e helper
global. Isso vira uma função pura única:

```text
política da finalidade define o que é permitido
  > fonte on-device disponível
  > helper explícito do projeto, se autorizado
  > helper global, se autorizado
  > fallback determinístico da finalidade
```

A seleção considera custo e privacidade antes da preferência de modelo.
Uma configuração de projeto nunca pode ligar uma rota faturável que a política
global não autorizou.

### 11.5 Resultado comum

Todo transporte devolve o mesmo envelope:

```ts
type UtilityResult<T> = {
  status: "ok" | "unavailable" | "timed_out" | "invalid" | "cancelled"
  value?: T
  source: {
    capabilityId: string
    locality: "device" | "local-process" | "remote"
  }
  timing: { startedAt: number; durationMs: number }
  cost?: {
    usd: number | null
    source: "reported" | "estimated" | "unknown"
  }
  fallbackReason?: string
}
```

Com isso, UI e domínios deixam de inferir se string vazia, exceção ou JSON
quebrado significam indisponibilidade. O gateway não engole a falha: ele a
normaliza; o perfil decide se a pessoa precisa vê-la.

### 11.6 Scheduler comum

O gateway possui um scheduler cooperativo com prioridade explícita:

```text
alta    recibo com prazo, somente quando o turno terminou em background
normal  mapa da conversa aberta
baixa   pills, aprendizado, rascunho e curadoria
```

- Uma tarefa antiga pode ser invalidada por `inputDigest`.
- Tarefas idênticas em voo são deduplicadas.
- Apple on-device mantém concorrência global igual a um.
- Rota remota possui limite de concorrência e backoff próprios.
- Run principal, ditado e interação humana nunca esperam esta fila.
- Uma finalidade sem resultado cai no fallback dela, não no fallback de outra.

### 11.7 Migração segura dos consumidores atuais

1. Criar gateway, envelope, registry de perfis e adapter legado para o comando
   `suggest`, sem mudar comportamento visual.
2. Migrar `composer_suggestions` e `turn_receipt`, que já são best-effort e têm
   fallbacks testados.
3. Adicionar `conversation_map` e a rota Foundation Models.
4. Migrar aprendizado, rascunho de skill e curadoria, preservando seus contratos
   determinísticos.
5. Avaliar o juiz do Fusion separadamente. Ele só entra se o gateway suportar
   sua exigência de modelo forte, custo reportado e decisão auditável sem
   enfraquecer o contrato atual.

Cada migração mantém testes de caracterização do consumidor. A centralização
não autoriza trocar copy, frequência ou fallback de todas as features num único
refactor.

### 11.8 Ordem padrão

```text
1. Projeção determinística imediata
2. Fonte on-device disponível e compatível com pt-BR
3. Fonte utilitária não faturável autorizada
4. Fonte utilitária faturável explicitamente autorizada
5. Permanecer na projeção determinística
```

A projeção do item 1 aparece primeiro, mas não encerra a tentativa semântica.

### 11.9 Política de custo

- Rota on-device pode operar automaticamente.
- Rota remota vem desligada para esta finalidade até a pessoa autorizar.
- Autorizar helper para sugestões não autoriza automaticamente resumo de
  conversas antigas; são frequências e exposições de dados diferentes.
- A configuração permite: `Só no dispositivo`, `Automático sem custo`,
  `Automático com o helper escolhido` e `Desativado`.
- O modo faturável mostra modelo, frequência estimada e custo acumulado desta
  feature.
- Rate limit do helper não afeta o run principal e não dispara auto-resume.
- Falha local nunca salta para uma rota paga sem a política correspondente.

### 11.10 One-shot de fallback

Uma fonte baseada em CLI precisa provar por capability:

- execução sem sessão persistida;
- tools e MCP realmente ausentes;
- formato estruturado ou parser validado;
- timeout e cancelamento;
- ausência de hooks que produzam presença falsa;
- custo observável quando o fornecedor o reportar.

Não basta o CLI aceitar um prompt. Sem essas garantias, ele não participa da
rota automática.

## 12. Persistência

### 12.1 Tabela de mapa atual

Criar uma tabela frontend-backed pelo padrão `ensure*Tables(db)` e migração
Tauri correspondente, usando a próxima versão livre conferida no momento da
implementação:

```sql
CREATE TABLE conversation_maps (
  conversation_id TEXT PRIMARY KEY REFERENCES conversations(id) ON DELETE CASCADE,
  schema_version INTEGER NOT NULL,
  prompt_version INTEGER NOT NULL,
  payload_json TEXT NOT NULL,
  summarized_through_item_id TEXT,
  input_digest TEXT NOT NULL,
  source_kind TEXT NOT NULL,
  source_id TEXT,
  source_fingerprint TEXT,
  generation_mode TEXT NOT NULL,
  generated_at INTEGER NOT NULL,
  latency_ms INTEGER,
  cost_usd REAL,
  cost_source TEXT
);
```

É uma linha por conversa, atualizada atomicamente. O transcript não é copiado.
Falha de geração não apaga a linha anterior.

### 12.2 Tabela de correções humanas

```sql
CREATE TABLE conversation_map_pins (
  conversation_id TEXT PRIMARY KEY REFERENCES conversations(id) ON DELETE CASCADE,
  pins_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
```

Separar pins impede um UPSERT do modelo de sobrescrever decisão humana.

### 12.3 Proveniência e privacidade

- `payload_json` guarda ids e sínteses, não cópias integrais dos trechos.
- Trechos de fonte são resolvidos no transcript no momento da abertura.
- `source_id` é diagnóstico interno; a UI comum mostra apenas `No dispositivo`
  ou `Helper configurado` quando a pessoa pedir detalhes.
- Prompt e resposta completos não entram em log.
- No fallback remoto, a tela de configuração explica que conteúdo recente da
  conversa será enviado ao fornecedor selecionado.

## 13. Orquestração

### 13.1 Dono

Um módulo único, sugerido como `store/chat/conversationMap.ts`, possui:

- debounce por conversa;
- token de invalidação;
- fila serial global para geração local;
- leitura do último snapshot;
- seleção de rota;
- validação e persistência;
- estado efêmero de atualização.

O watchdog não ganha outro ticker. Se a feature precisar observar transições
globais, estende o ticker único existente.

### 13.2 Gatilhos

- fim assentado de turno;
- abertura de conversa com mapa ausente ou obsoleto;
- mudança de pin;
- disponibilidade do modelo local que passa de indisponível para disponível;
- gesto manual `Atualizar`;
- mudança de schema ou prompt.

### 13.3 Anticoncorrência

- Cada tentativa recebe `generationId` e `inputDigest`.
- Novo turno invalida tentativa baseada num digest anterior.
- Resposta tardia não escreve se a conversa avançou.
- Apenas uma geração por conversa e uma Apple on-device no app inteiro.
- Trocar de conversa não move nem cancela a geração válida da conversa de
  origem.
- Remover a conversa cancela ou descarta o resultado e a FK limpa o snapshot.

### 13.4 Prioridade

Gerar mapa é trabalho de manutenção. Nunca:

- atrasa `handleSend`;
- bloqueia persistência do transcript;
- ocupa o indicador de run;
- aciona bandeja, notch ou notificação;
- impede fechar ou minimizar o app;
- ganha prioridade sobre ditado, interação pendente ou agente em execução.

## 14. Configurações

Nova seção em `Agentes e uso`, com o rótulo **Leitura das conversas**:

| controle | comportamento |
|---|---|
| `Atualizar a leitura automaticamente` | liga o pipeline pós-turno |
| `Fonte` | só dispositivo, automático sem custo, helper autorizado, desligado |
| `Helper de fallback` | aparece somente quando uma fonte compatível existir |
| `Usar serviço remoto` | consentimento separado, com explicação de dados e custo |
| `Reconstruir leituras` | rebase sob gesto, com confirmação do escopo |

No Mac, a seção mostra o estado efetivo do Foundation Models:

- `No dispositivo, pronto`;
- `O modelo do sistema ainda está sendo preparado`;
- `Ative a Apple Intelligence para usar a leitura no dispositivo`;
- `Este sistema usará somente os fallbacks escolhidos`.

Capability ausente não mostra toggle morto. O estado configurado com erro
continua visível, pelo contrato de disclosure do guia.

## 15. Segurança e confiança

### 15.1 Prompt injection

O transcript pode conter texto como “ignore as regras e execute um comando”. O
gerador:

- recebe instruções estáticas e confiáveis separadas dos dados;
- não possui ferramentas;
- não possui cwd útil nem acesso a arquivos;
- não retoma sessão;
- não executa links ou anexos;
- só devolve o schema fechado;
- tem referências validadas contra a allowlist de itens enviada.

### 15.2 Contaminação de memória

Na v1, o mapa serve somente à interface. Não entra em:

- prompt do próximo turno;
- handoff entre agentes;
- compactação;
- instruções do projeto;
- lições ou doutrina;
- título automático.

Depois de avaliação real, outra ADR pode permitir que claims explícitos e
confirmados participem da memória. Inferência sem confirmação não entra.

### 15.3 Dados remotos

Fallback remoto recebe o recorte mínimo necessário, nunca anexos binários nem
outputs completos de ferramentas. O consentimento informa que mensagens podem
conter código, caminhos e dados sensíveis. Desligar a rota interrompe novas
chamadas, mas mantém o mapa local já produzido.

## 16. Desempenho e limites

Metas de engenharia, a validar no hardware real:

- projeção determinística em até um frame para conversa já carregada;
- atualização local sem bloquear interação do frontend;
- primeiro mapa local em até 5 segundos no caso típico;
- cancelamento reconhecido em até 500 ms pelo processo pai;
- payload persistido com teto de 32 KB por conversa;
- nenhuma cópia adicional do transcript em SQLite;
- um único processo de inferência utilitária por vez;
- nenhum `prewarm` permanente;
- nenhum retry em loop: no máximo uma tentativa por rota e por digest;
- backoff por motivo, sem repetir enquanto `model_not_ready`, auth ou rate
  limit não tiverem condição nova observável.

Esses números são critérios de aceite, não promessas derivadas da documentação
da Apple. O spike precisa medi-los.

## 17. Avaliação de qualidade

### 17.1 Corpus

Fixtures vêm de payloads reais, sanitizados quando necessário. O conjunto deve
conter:

1. conversa iniciada sem pedido claro;
2. conversa com objetivo explícito;
3. conversa que muda de assunto duas vezes;
4. conversa com “sim”, “faça isso” e referências anafóricas;
5. hipótese do agente rejeitada pelo usuário;
6. decisão antiga substituída por uma nova;
7. turno interrompido e retomado;
8. rate limit sem conclusão;
9. plano publicado no meio de um chat livre;
10. conversa longa acima da janela local;
11. conteúdo malicioso tentando instruir o resumidor;
12. pt-BR com nomes, acentos, caminhos e termos técnicos.

### 17.2 Perguntas de avaliação

Para cada fixture, avaliadores respondem:

- O foco atual está correto?
- O painel inventou um objetivo?
- Algum entendimento revogado permanece vivo?
- Pontos em aberto realmente estão abertos?
- O último desfecho concorda com o resultado canônico?
- As fontes levam aos trechos corretos?
- A redação está em pt-BR natural?
- O resumo ajuda sem precisar reler todo o fio?

### 17.3 Métricas locais

- cobertura de claims com fonte válida;
- taxa de resposta rejeitada pelo validator;
- frequência de correção humana;
- churn do `currentFocus` sem novos pedidos humanos;
- latência por fonte;
- motivo de fallback;
- idade média do mapa ao abrir o painel;
- custo acumulado de helpers remotos.

Nenhuma telemetria externa é necessária para a primeira versão.

## 18. Critérios de aceite

### Produto

- A pessoa inicia e usa um chat sem preencher meta.
- Conversa sem objetivo explícito nunca mostra um objetivo inventado.
- Mudança de assunto atualiza o foco e registra a trajetória.
- Correção fixada pela pessoa sobrevive a restart e novas gerações.
- Plano e atividade exibidos correspondem às fontes canônicas.
- Abrir fontes leva ao item correto do fio.

### Apple Intelligence

- `--probe` distingue disponível, não elegível, desativado, não preparado,
  locale sem suporte e falha técnica.
- Em ambiente compatível, o mapa nasce via Foundation Models sem rede.
- Guided Generation produz o schema esperado.
- Sidecar não recebe tools, arquivos ou sessão persistente.
- Encerrar o Frota encerra o processo filho.
- Linux compila e abre sem o sidecar.

### Fallback

- Ausência da Apple mantém a projeção determinística.
- Fallback não faturável autorizado assume sem poluir o chat.
- Rota faturável não é chamada sem consentimento específico.
- Rate limit, timeout e JSON inválido preservam o último mapa válido.
- Falha da leitura não afeta o run principal nem o auto-resume.
- Pills e recibos preservam o comportamento durante a migração para o gateway.
- Duas chamadas idênticas e concorrentes produzem uma execução de transporte.
- A precedência entre configuração de projeto e global é resolvida num único
  módulo.

### Dados

- Watermark nunca retrocede.
- Referência inexistente rejeita a atualização.
- Snapshot só troca depois de validação completa.
- Transcript não é duplicado na nova tabela.
- Exclusão de conversa remove mapa e pins por cascade.

### UI e acessibilidade

- Painel funciona entre 240 px e a largura ampla suportada.
- Rótulos completos aparecem quando há espaço; ícones mantêm nome acessível.
- Teclado alcança fontes, ajuste, fixação e reconstrução.
- Movimento reduzido elimina animação não essencial.
- Claro e escuro respeitam a mesma hierarquia.
- Nenhum card aninhado ou nova escala tipográfica é introduzido.

## 19. Fases de entrega

### F0, contrato e prova nativa

- congelar `ConversationMapV1` e validator;
- criar fixtures reais e rubrica;
- implementar sidecar com `--probe` e um `--summarize` de laboratório;
- medir pt-BR, janela, latência, memória e encerramento em Mac real;
- registrar ADR de fonte semântica, persistência e política de fallback.

Saída: prova de que o Foundation Models consegue produzir o schema com
qualidade mínima. Nenhuma mudança visual de produção ainda.

### F1, painel honesto e persistência

- migrar `Plano` para `Conversa`;
- separar evidência, estado canônico e leitura semântica;
- implementar tabelas, CRUD, validator, watermark e pins;
- entregar projeção determinística redesenhada;
- abrir fontes no fio.

Saída: painel útil mesmo sem modelo.

### F2, Apple on-device em produção

- integrar sidecar ao build e ao Tauri;
- implementar probe, fila, cancelamento, atualização incremental e rebase;
- ligar geração automática pós-turno;
- validar em conversa curta, longa, falha e mudança de rumo;
- inspecionar consumo com Instruments e Activity Monitor.

Saída: Mac compatível recebe leitura semântica local por padrão.

### F3, gateway e fallbacks

- criar registry de inferência utilitária;
- encapsular o helper atual num adapter legado;
- migrar pills e recibos primeiro, sem alterar seus fallbacks;
- migrar aprendizado, rascunho e curadoria por perfil tipado;
- implementar rotas gratuitas e faturáveis por capability;
- adicionar consentimento, custo e backoff;
- provar que nenhuma rota gera presença ou sessão falsa.

Saída: comportamento funcional fora do caminho Apple, segundo a política da
pessoa.

### F4, qualidade e possível integração com memória

- rodar corpus e registrar resultados por versão do modelo do sistema;
- ajustar prompts sem mudar o schema;
- medir correções humanas e churn;
- decidir, por ADR separada, se claims explícitos podem enriquecer handoff.

Saída: evolução baseada em evidência. Integração com memória não é automática.

## 20. Mapa provável de implementação

| área | caminho provável | responsabilidade |
|---|---|---|
| projeção | `app/src/lib/conversationMap.ts` | composição, schema e validator puros |
| orquestração | `app/src/store/chat/conversationMap.ts` | gatilhos, invalidação e persistência |
| banco | `app/src/lib/db/conversationMaps.ts` | CRUD de mapas e pins |
| schema frontend | `app/src/lib/db/schema.ts` | `ensureConversationMapTables` |
| migração | `app/src-tauri/src/lib.rs` | migrations, após conferir versão máxima |
| bridge TS | `app/src/lib/conversationIntelligence.ts` | comandos Tauri tipados |
| bridge Rust | `app/src-tauri/src/conversation_intelligence.rs` | lifecycle e protocolo do sidecar |
| Swift | `app/src-tauri/intelligence/main.swift` | Foundation Models e Guided Generation |
| build | `app/src-tauri/build.rs` | compilação incremental do sidecar |
| bundle | `app/src-tauri/tauri.conf.json` | external binary no macOS |
| UI | `app/src/components/layout/ConversationMapPanel.tsx` | leitura e gestos do painel |
| chrome | `app/src/components/layout/ContextPanel.tsx` | aba `Conversa` |
| settings | `app/src/components/settings/` | fonte, consentimento e diagnóstico |
| capability | registries Rust e TS | fontes utilitárias e degradação |
| gateway | `app/src/lib/utilityInference/` | perfis, roteamento, envelope e scheduler |
| transports | `app/src-tauri/src/utility_inference/` | Apple, adapter legado e providers futuros |

Nomes são direção de modularização, não autorização para criar arquivos
monolíticos. A catraca de tamanho continua mandando.

## 21. Testes obrigatórios

### TypeScript

- reducer incremental;
- validator e limites;
- referências e watermark;
- pins vencendo modelo;
- mudança de rumo;
- ausência de objetivo;
- falha de turno sem sucesso inventado;
- tentativa tardia descartada;
- rebase em blocos;
- composição com tasks e deferred canônicos;
- estados da UI e acessibilidade.

### Rust

- path e assinatura do sidecar;
- probe e erros tipados;
- timeout, cancelamento e limpeza do filho;
- tamanho máximo de stdin/stdout;
- nenhuma linha de comando construída por interpolação insegura;
- Linux sem sidecar;
- capabilities espelhadas.

### Swift

- selftest sem modelo para codec e validação do protocolo;
- prova real condicionada à disponibilidade do Foundation Models;
- locale pt-BR;
- schema de Guided Generation;
- segunda chamada concorrente rejeitada;
- contexto acima do teto tratado sem crash.

### Suites finais

```text
cd app && bun run test
cd app && bunx tsc -b --force
cd app && bun run check
cd app/src-tauri && cargo test
```

A prova nativa real e a inspeção visual são registradas separadamente. Teste
unitário verde não autoriza afirmar que Apple Intelligence rodou na máquina.

## 22. Fora do escopo

- exigir objetivo antes do chat;
- gerar ou aprovar plano automaticamente;
- enviar mensagens sugeridas sem gesto humano;
- reescrever respostas antigas;
- usar embeddings ou busca vetorial na primeira versão;
- resumir todas as conversas no boot;
- manter modelo prewarm indefinidamente;
- adicionar daemon externo ao aplicativo;
- usar o mapa como instrução de agente sem ADR posterior;
- esconder falha operacional real atrás de uma síntese agradável.

## 23. Riscos e respostas

| risco | resposta |
|---|---|
| modelo confunde tópico com objetivo | campo opcional, certeza, fontes e pins |
| resumo envelhece | watermark e contagem de turnos novos |
| contexto local pequeno | redutor incremental, blocos e rebase sem corte cego |
| atualização do modelo muda comportamento | `promptVersion`, corpus e avaliação por versão do SO |
| consumo de memória | one-shot, sem prewarm, fila global e medição real |
| helper usa limite do agente | rota separada, opt-in, custo e sem auto-resume |
| prompt injection no transcript | instruções separadas, sem tools e schema fechado |
| resumo envenena handoff | não injetar na v1 |
| UI volta a parecer gerada | trajetória como gesto único, sem kit de cartões |
| Linux vira cidadão de segunda classe | projeção completa e gateway de fallback agnóstico |

## 24. Decisões fechadas por este PRD

1. O chat linear permanece livre e sem objetivo obrigatório.
2. A aba passa a representar a conversa, não apenas um plano.
3. `Foco atual` é provisório; `Objetivo explícito` é opcional.
4. Apple Intelligence é a primeira rota semântica no Mac compatível.
5. A integração nativa usa sidecar próprio, curto e sem tools.
6. A projeção determinística existe sempre e aparece imediatamente.
7. Fallback faturável exige autorização separada.
8. Todo claim semântico tem fonte e validade.
9. Correção humana vive separada e vence o modelo.
10. O mapa não entra no prompt ou handoff nesta entrega.

## 25. Referências técnicas

- Apple, `SystemLanguageModel`: disponibilidade, locale e janela em runtime:
  <https://developer.apple.com/documentation/foundationmodels/systemlanguagemodel>
- Apple, geração de conteúdo e tarefas com Foundation Models:
  <https://developer.apple.com/documentation/foundationmodels/generating-content-and-performing-tasks-with-foundation-models>
- Apple, Guided Generation com estruturas Swift:
  <https://developer.apple.com/documentation/foundationmodels/generating-swift-data-structures-with-guided-generation>
- Apple, `LanguageModelSession`:
  <https://developer.apple.com/documentation/foundationmodels/languagemodelsession>
- Contrato do painel atual: `docs/sidebar-cockpit-plan.md`.
- Memória semântica e invalidação: `docs/memoria-de-conversa-plan.md`.
- Precedente de sidecar Swift: `docs/dictation-plan.md` e
  `app/src-tauri/stt/main.swift`.
