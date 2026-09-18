# Nome da conversa por inteligência — PRD

## Status (18/09/2026)

**R1 a R5 entregues (18/09/2026, ADR-215).** As duas queixas estão fechadas: a
conversa ganha nome de gente no fim do primeiro turno, e a linha de sugestões só
existe quando há inteligência utilitária no projeto.

Onde divergiu do texto abaixo:
- O levantamento contava cinco cópias da régua do helper incluindo
  `useProjectConfig.ts`, que na verdade é a outra metade da cadeia (ele PRODUZ o
  campo). A quinta cópia real era `store/mission.ts:430`, achada no grep de call
  sites e migrada junto.
- `SuggestionChips` virou container e a linha pura saiu como `LinhaDeSugestoes`:
  `CommandConsole.tsx` está exatamente no teto de 700 e não podia receber a prop
  nova. De quebra, a linha pura ficou testável sob `renderToStaticMarkup`.
- **O prompt ganhou uma regra que o PRD não previa, e ela veio de payload real.**
  Rodando o one-shot do app, a conversa "oi" devolveu "Qual é o assunto do
  trabalho": o modelo respondia em vez de nomear. Daí a sentinela `SEM ASSUNTO`,
  que o parser mapeia para `null`. Outra rodada devolveu "Sem assunto." em
  minúscula e com ponto, então a comparação normaliza caixa, acento e pontuação.
- R4 não virou ação do store: `store/chat.ts` está congelado no ratchet, então
  `nomearConversa` é função de módulo chamada de `notifyTurnEnd`, o funil que os
  cinco caminhos de fim de turno já atravessam.
- R5 não precisou de código: a resolução do ADR-142 já estava lá. Ganhou o teste
  que faltava, e `conversationTitle` foi exportada para isso.

Frente aberta a partir de uma queixa direta do usuário em 18/09/2026. Antes
desta entrega não havia linha nenhuma de código do lado do título: a busca por
`conversation_title`, `autoTitle` e `título automático` no repositório inteiro
devolvia **uma** ocorrência, e ela era uma exclusão de escopo
(`docs/mapa-vivo-da-conversa-prd.md:909`).

Encosta em ADR-142 (`docs/decisions.md:5222`, título de conversa é estado
vigente, recibo é histórico) e em ADR-126 (`docs/decisions.md:126`, nome de
conversa é entrada NÃO confiável quando vai pro SO). Reaproveita inteiro o
gateway de inferência utilitária que o mapa vivo trouxe
(`app/src/lib/utility/gateway.ts`).

---

## O problema, nas palavras do usuário

"Por que ainda as conversas no Frota não têm inteligência de renomear
devidamente sozinha? Tipo, se eu inicio uma conversa com o agente e mando 'oi',
ela fica salva com o nome 'oi'. Eu havia pedido para alguém fazer uma feature
com uma camada de inteligência sabe? Que evitasse a necessidade de eu
manualmente ter que renomear ou ter que ficar lembrando do que se trata a
conversa."

E, na mesma sessão, sobre o composer:

"Inclusive, os badge/pills de sugestões, mesmo desabilitado nas configurações
ainda aparecem, e eu acho errado, consome espaço. Eles deveriam ser dinâmicos
baseado na configuração né."

As duas queixas têm a mesma raiz: **a tela não sabe se a camada de inteligência
utilitária está ligada.** A sidebar não a chama quando deveria; o composer
oferece o gesto dela quando ela está desligada.

## Evidência (estado atual)

- **O título é uma função pura de 8 linhas, sem inteligência nenhuma:**
  `deriveTitle` (`app/src/lib/convTitle.ts:24`) pega o primeiro item
  `kind === "user"`, faz `trim`, colapsa espaço e corta em 44 caracteres. Sem
  anexo e sem texto honesto, devolve `null` e a lista mostra "Nova conversa"
  (`components/layout/ConversationList.tsx:182`).
- **O título é imutável depois do primeiro envio.** Nos dois pontos que nomeiam
  (`store/chat.ts:1919` e `store/chat.ts:2092`) o patch é
  `c.title ? c : { ...c, title: deriveTitle(items) }`: nasceu, nunca mais é
  revisto. É por isso que "oi" fica "oi" para sempre.
- **Não há como distinguir título humano de título derivado.**
  `ConversationMeta` (`lib/db/conversations.ts:29-43`) tem `title: string | null`
  e mais nada; `renameConversation` (`store/chat.ts:1122`) grava no mesmo campo
  que o `deriveTitle` usa.
- **A régua de 44 caracteres está duplicada fora do módulo dela:** o Companion
  reimplementa `flat.length > 44 ? ... : flat` em `lib/companionAction.ts:425`,
  com um comentário admitindo a cópia.
- **O encanamento de inferência utilitária existe e está em produção.**
  `generateUtilityText` (`lib/utility/gateway.ts:234`) já entrega prazo, rota
  (`device` / `free_only` / `approved_helper` / `off`), digest de entrada,
  custo registrado (`recordUtilityUsage`) e falha honesta. Sete finalidades
  usam (`lib/utility/types.ts:1-8`): `conversation_map`,
  `composer_suggestions`, `turn_receipt`, `lesson_distillation`, `skill_draft`,
  `model_curator`, `commit_message`. **`conversation_title` não está lá.**
- **Já existe o molde exato do que falta.** `scheduleSuggestionsImpl`
  (`store/chat/suggestions.ts:31-88`) é uma tarefa utilitária agendada no fim do
  turno, com debounce, token de invalidação por conversa, anticoncorrência e
  persistência. Um módulo de título é esse arquivo com outro prompt.
- **O gancho de fim de turno já existe e já é compartilhado:** `notifyTurnEnd`
  (`lib/notify.ts:30`) roda em cinco chamadores (`fleet/send.ts:552` e `:716`,
  `chat/ChatPanel.tsx:738`, `chat/autoResumeAgendar.ts:82`,
  `lib/chatHandoff.ts:190`), e em `send.ts:552` aparece colado em
  `scheduleSuggestions(convId)` — o par é o lugar natural do título.
- **O app já escreve texto bom para um artefato cru:** `commit_message` pega um
  diff e devolve uma frase (`lib/commitAi.ts:54`). A conversa é o único
  artefato do Frota que ainda se nomeia no braço.
- **Os chips são incondicionais.** `SuggestionChips`
  (`components/chat/ComposerParts.tsx:428-473`) tem três ramos: buscando →
  sugestões → **`CHIPS`** (`:26-30`, "Explicar o projeto", "Rodar os testes",
  "Criar uma branch"). O terceiro ramo é o `else` final e não consulta
  configuração nenhuma. `CommandConsole.tsx:681` o renderiza sempre.
- **O desligamento existe e é visível.** A seção "Sugestões"
  (`components/settings/sections.ts:164-170`, "Qual modelo escreve as sugestões
  automáticas do composer") tem um campo só, "Modelo helper (padrão)", com
  opção `off` que grava `helperModel: null` (`settings/SettingsDialog.tsx:461`).
  A geração respeita (`store/chat/suggestions.ts:55`, `if (!helperModel) return`),
  mas o `else` dos chips nunca soube que isso aconteceu.
- **A régua de "qual helper vale aqui" está copiada em cinco lugares:**
  `cfg ? cfg.helper : settings.helperModel` em `lib/notify.ts:79-83`,
  `store/chat/suggestions.ts:53-54`, `store/mission.ts:430-433`,
  `components/chat/feedbackDoFio.ts:24-26` e
  `components/common/CommandMenu.tsx:166-168`. Nenhuma delas é exportada; a UI
  não tem onde perguntar.
- **`hooks/useProjectConfig.ts:39` NÃO é uma sexta cópia, é a outra metade.** Ele
  PRODUZ `mycockpit[id].helper` lendo o `.mycockpit/config.toml` (`"off"` vira
  `null`, ausente cai no default global), e por isso usa `??` onde os
  consumidores usam ternário. A ordem dos consumidores não pode virar
  `cfg?.helper ?? global`: `null` ali é resposta ("este projeto desligou"), não
  ausência, e o `??` ressuscitaria o helper num projeto que o desligou.
- **O travessão vaza por aqui.** `docs/mypeople-patterns-plan.md:395` registra
  que "título de schedule ainda gera travessão via nome da conversa" — hoje o
  travessão só entra se a pessoa digitar; com um modelo escrevendo, passa a ser
  saída provável e precisa de trava.

## Decisões

1. **Renomeia UMA vez, no fim do primeiro turno.** É o regime escolhido pelo
   usuário em 18/09/2026, e é o mais barato de defender: no fim do primeiro
   turno já existe pedido e resposta, que é o mínimo para nomear com
   honestidade, e ainda não existe hábito da pessoa com aquele nome.
2. **O título humano é intocável, e a prova é derivada, não persistida.** Um
   título ainda não apropriado por ninguém é exatamente aquele que satisfaz
   `title === deriveTitle(items)` (ou `title == null`). Quem renomeou na mão
   quebrou essa igualdade e fica fora para sempre. **Isso dispensa migração,
   coluna e flag**, é puro, replay-safe, e sobrevive a fork (`Nome (fork)` não
   bate com `deriveTitle`, logo ramo não é renomeado). O custo é uma borda
   inofensiva: quem renomear à mão para exatamente o texto derivado é tratado
   como não-renomeado.
3. **Vai pelo gateway, como oitava finalidade.** `conversation_title` entra em
   `UtilityTaskKind` com perfil próprio. Nada de chamada solta ao helper: rota,
   prazo, consentimento remoto e contabilidade de custo são os que já existem.
4. **Helper desligado é degradação honesta, não espera.** Sem helper para o
   projeto, o nome continua sendo o `deriveTitle` de hoje. Nada de "gerando…",
   nada de placeholder, nada de linha vazia reservada na sidebar.
5. **A renomeação é fire-and-forget, e o feed se corrige sozinho.** Não seguramos
   a notificação de fim de turno esperando o nome. ADR-142 já mandou HUD,
   bandeja e Companion resolverem o título pelo `convId`, usando a cópia do feed
   só como fallback: quando o nome novo cai no store, os três instrumentos
   passam a mostrá-lo sem que nada reescreva histórico.
6. **"Uma vez" é uma renomeação bem-sucedida, não uma tentativa.** Se o helper
   estava fora do ar no primeiro turno, a condição da decisão 2 continua
   verdadeira e a tentativa se repete no fim do turno seguinte, no máximo até o
   terceiro turno da conversa. Passou disso, a conversa fica com o nome cru e
   ninguém mais gasta chamada com ela. A contagem sai dos `items`, não de estado
   novo.
7. **Os chips passam a responder à mesma pergunta.** A régua espalhada em cinco
   cópias vira uma função exportada, e o composer a consulta: sem inteligência
   utilitária para aquele projeto, a linha de chips não é renderizada — não é
   esvaziada, não é desabilitada, não ocupa altura.

## Requisitos

### R1 · Uma régua só para "há inteligência aqui" (P) ✅
- Extrair `cfg ? cfg.helper : settings.helperModel` para módulo próprio
  (`lib/helperDoProjeto.ts`), exportando o núcleo puro (`resolverHelper`), o
  leitor de store (`helperDoProjeto`) e o booleano que a tela pergunta
  (`temInteligencia`).
- Migrar as cinco cópias (`notify.ts:79`, `store/chat/suggestions.ts:53`,
  `store/mission.ts:430`, `feedbackDoFio.ts:24`, `CommandMenu.tsx:166`) sem mudar
  comportamento de nenhuma. `useProjectConfig.ts:39` fica como está: é a outra
  metade da cadeia, não uma cópia.
- **Ficam de fora, e é de propósito:** `lib/modelCurator.ts:183` e
  `DiffPanel/CommitComposer.tsx:39` olham só o default GLOBAL, ignorando a
  config do projeto. Uniformizar os dois mudaria comportamento de superfície,
  que não é o que R1 se propõe; vira item próprio se for para mudar.
- **Aceite:** teste do resolvedor cobrindo as quatro entradas (projeto define,
  projeto não define com global ligado, projeto desligou com global ligado,
  ambos nulos); nenhuma leitura de `mycockpit[...].helper` sobra fora do módulo.

### R2 · Chips só quando há inteligência (P) ✅
- `SuggestionChips` deixa de renderizar o ramo `CHIPS` quando o projeto da
  conversa ativa não tem helper. Sem helper e sem sugestões, o componente
  devolve `null` e o composer não reserva a altura.
- Com helper ligado, nada muda: buscando → sugestões → chips estáticos como
  fallback, exatamente como hoje.
- A decisão é do projeto DONO da conversa, não do projeto ativo na tela (mesma
  régua do `notifyTurnEnd`, que já busca por `c.projectId`).
- **Aceite:** teste de render com helper `null` não encontra "Explicar o
  projeto" nem nó com altura; com helper `"haiku"` encontra os três; alternar a
  configuração com o app aberto muda a tela sem recarregar.

### R3 · `conversation_title` como finalidade do gateway (P) ✅
- Entrada nova em `UtilityTaskKind` (`lib/utility/types.ts:1`) e perfil em
  `UTILITY_PROFILES` (`lib/utility/profiles.ts:14`): prioridade `low`, prazo
  padrão 4.000 ms, `maxInputBytes` 16 KB, `requiresStructuredOutput: false`,
  `canPersist: true`, `canUseBillableSource: true`, `promptVersion: 1`.
- Prompt e parser puros em `lib/tituloDaConversa.ts`, no molde do
  `turnReceipt.ts`: pt-BR, 3 a 6 palavras, nomeia o ASSUNTO (não a ação, não o
  desfecho), sem aspas, sem markdown, sem ponto final, **sem travessão**, teto
  de 44 caracteres para caber na régua da sidebar.
- O parser devolve `null` como desfecho de primeira classe (lixo, resposta
  conversacional, string curta demais, ou travessão que sobreviveu ao prompt).
  `null` significa "fica o nome de hoje".
- Entrada do modelo = `buildContext(items)` (`lib/suggestions.ts`), o mesmo
  recorte que o recibo de turno já usa.
- **Aceite:** testes do parser com payload REAL colhido do helper (ADR-016),
  cobrindo resposta boa, resposta com aspas e markdown, resposta com travessão,
  "Claro! Aqui está:" e string de 2 caracteres; nenhum título devolvido passa de
  44 caracteres nem contém "—".

### R4 · Renomear no fim do primeiro turno (M) ✅
- Módulo `store/chat/titulo.ts` espelhando `store/chat/suggestions.ts`: memória
  de módulo com token de invalidação por conversa, guarda de `running` /
  `finalizing`, e descarte da resposta se um run novo começou durante a chamada.
- Gatilho no mesmo ponto em que `scheduleSuggestions` já é chamado, ao lado de
  `notifyTurnEnd`. Condição de disparo, toda derivada dos `items`:
  `title == null || title === deriveTitle(items)`, **e** contagem de itens
  `kind === "user"` menor ou igual a 3 (decisão 6).
- Ao receber um título válido, chama a `renameConversation` que já existe
  (`store/chat.ts:1122`), que já persiste no SQLite e já acha o projeto dono
  pelo id — inclusive com a conversa em projeto não-ativo.
- Re-checa a condição de disparo DEPOIS da resposta chegar: se a pessoa
  renomeou na mão durante os 4 segundos da chamada, o resultado é descartado.
- **Aceite:** conversa que começa com "oi" e discute o watchdog termina o
  primeiro turno chamada de watchdog, no store e no SQLite; conversa renomeada à
  mão no meio do primeiro turno chega ao fim com o nome da pessoa; helper
  desligado deixa o nome cru e não emite chamada nenhuma; fork mantém
  `Nome (fork)`; cancelamento no primeiro turno não renomeia.

### R5 · O nome novo chega aos instrumentos (P) ✅
- Conferir que feed do sino, bandeja e Companion mostram o nome novo assim que
  ele cai, pela resolução por `convId` que ADR-142 já instalou, sem reescrever o
  evento congelado.
- Nenhum histórico é reescrito: a cópia antiga no evento continua lá, como manda
  o ADR.
- **Aceite:** renomeação no fim do primeiro turno em background muda o texto no
  HUD e no popover da bandeja sem recarregar; o evento persistido conserva o
  texto original.

## Não-objetivos

- **Renomear continuamente enquanto o assunto deriva.** É o regime seguinte,
  decidido pelo usuário como fora desta entrega. Exige trava explícita de título
  humano e paga uma chamada por turno.
- **Usar o mapa vivo como fonte do título.** `mapa-vivo-da-conversa-prd.md:909`
  exclui isso da v1 dele, e a exclusão continua de pé: o título é finalidade
  própria, com prompt próprio e custo próprio.
- **Renomear ramo, fork ou conversa da mesa criada pelo Companion.** Nenhum deles
  satisfaz a condição da decisão 2, e é assim que deve ficar.
- **Coluna, flag ou migração para marcar título humano.** Derivável, logo não se
  persiste.
- **Tirar a renomeação manual do caminho.** O gesto da sidebar
  (`ConversationRow.tsx:125`) continua igual e continua vencendo.

## Ordem de entrega

R1 → R2 (fecham a queixa do composer e desbloqueiam a pergunta que o título
precisa fazer) → R3 → R4 → R5.

Tudo entregue em 18/09/2026. R1 e R2 saíram primeiro e sozinhos, como o corte
previa; R3, R4 e R5 vieram na sequência.

## Riscos

- **Uma chamada a mais por conversa.** É `haiku` com entrada de até 16 KB e
  prazo de 4 s, na mesma ordem de grandeza do recibo de turno, e acontece uma
  vez na vida de cada conversa. O custo aparece em `recordUtilityUsage` como
  qualquer outra finalidade.
- **O nome muda debaixo do olho.** A troca acontece no fim do turno, quando a
  atenção está no fio e não na sidebar. Mitigação adicional: não renomear
  enquanto a linha estiver em edição na sidebar.
- **Nome ruim é pior que nome cru.** Por isso o parser é conservador e `null` é
  desfecho de primeira classe: na dúvida, fica o texto que a pessoa escreveu.
- **Título escrito por modelo continua sendo entrada não confiável.** Ele já
  viaja para o AppleScript da notificação; ADR-126 travou a forma `argv` e o
  teste `payload_vai_como_argv_nunca_no_fonte_do_script` segue valendo. A
  superfície não aumenta, mas a probabilidade de texto estranho sim, e é mais um
  motivo para o parser barrar markdown e aspas.
- **Travessão.** O modelo tende a escrever "—", que o guia proíbe
  (`CLAUDE.md`, copy em pt-BR). O prompt pede e o parser garante.

## Arquivos que mudam

Nasce: `lib/helperDoProjeto.ts` (R1), `lib/tituloDaConversa.ts` (R3),
`store/chat/titulo.ts` (R4), com os testes ao lado.

Muda: `lib/utility/types.ts`, `lib/utility/profiles.ts`,
`components/chat/ComposerParts.tsx` (476 linhas, teto genérico de tsx é 700),
`lib/notify.ts` (488, teto de `ts` é 500), `components/chat/feedbackDoFio.ts`,
`components/common/CommandMenu.tsx`, `hooks/useProjectConfig.ts`,
`store/chat/suggestions.ts`, `docs/decisions.md` (a ADR desta frente saiu como
**215**: nasceu 214, e a frente do arrasto tomou esse número em paralelo).

**Três arquivos do caminho estão congelados pelo ratchet e não podem crescer uma
linha:** `store/chat.ts` (2150), `lib/fleet/send.ts` (718) e
`components/chat/CommandConsole.tsx` (700, exatamente no teto de tsx). O
agendamento, a condição de disparo e a leitura do helper **nascem nos módulos
novos**; nesses três só cabe trocar linha por linha. `lib/notify.ts` tem 12
linhas de folga: se a fiação não couber nelas, ela não mora lá.

Nenhuma migração de SQLite (decisão 2). A máxima real em
`src-tauri/src/lib.rs` é **51**, e continua sendo.

## Double check (18/09/2026)

Conferido no código, não na memória:
`deriveTitle` em `convTitle.ts:24` com o corte em 44 (`:29`); os dois patches
`c.title ? c : ...` em `store/chat.ts:1919` e `:2092`; `ConversationMeta` sem
campo de origem (`lib/db/conversations.ts:29-43`); `renameConversation` no store
(`chat.ts:1122`) e no DB (`lib/db/conversations.ts:120-128`); cópia da régua de
44 no Companion (`companionAction.ts:425`); as sete finalidades em
`lib/utility/types.ts:1-8` **sem** título; `generateUtilityText` em
`gateway.ts:234` e `recordUtilityUsage` em `:256`; `UTILITY_PROFILES` em
`profiles.ts:14`; `scheduleSuggestionsImpl` e `generateSuggestionsImpl` em
`store/chat/suggestions.ts:31` e `:38`, com `if (!helperModel) return` em `:55`;
os cinco chamadores de `notifyTurnEnd` (`send.ts:552`, `:716`,
`ChatPanel.tsx:738`, `autoResumeAgendar.ts:82`, `chatHandoff.ts:190`) e o par com
`scheduleSuggestions` em `send.ts:553`; `CHIPS` em `ComposerParts.tsx:26` com o
`else` incondicional em `:464`; `SuggestionChips` renderizado sem guarda em
`CommandConsole.tsx:681`; a seção "Sugestões" em `sections.ts:164` e o campo com
`off` em `SettingsDialog.tsx:461`; as cinco cópias da régua do helper; ADR-142
em `decisions.md:5222` e a nota de segurança de título em `decisions.md:126`;
exclusão do título automático no mapa vivo em `mapa-vivo-da-conversa-prd.md:909`;
travessão via nome de conversa em `mypeople-patterns-plan.md:395`.
Tamanhos e tetos lidos de `scripts/lints/file-size-baseline.json` e de `wc -l`.
Máxima de ADR (213) e de migração (51) contadas no arquivo.
