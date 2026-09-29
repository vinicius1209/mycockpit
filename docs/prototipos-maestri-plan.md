# Plano · o que veio do estudo do Maestri (G7, G1, G8, G3, F2)

## Status (28/09/2026)

**Entregue, na ordem do plano:** G7 (ADR-272), G1 (ADR-273), G8 (ADR-274),
G3 (ADR-275) e F2 (ADR-276). Decisões do §0 tomadas como propostas (o dono
aprovou o mock). Este bloco manda sobre o texto abaixo onde divergirem:

- **G7:** Codex no `app-server` (ADR-272) e Antigravity (ADR-277, pelo
  `media` do transcript do próprio agy). Claude e OpenCode não geram imagem
  nativamente; por MCP, a imagem devolvida já vira evidência. O `codex exec`
  não teve o formato do item de imagem colhido e segue mostrando `Unknown`. O
  "Salvar no projeto" ficou no lightbox, para toda imagem do fio, e lembra a
  pasta por projeto só na sessão.
- **G1:** a meta mostra tipo e tamanho; páginas, linhas e dimensões ficaram de
  fora. html, md, json, svg e txt não viram cartão.
- **G8:** sem capability. A decisão é pelo dado (`fase` no item), porque o
  mesmo motor fala com fase no app-server e sem fase no `exec`.
- **G3:** não houve marcador privado: o formato público é o próprio texto
  `[imagem N]`, e isso tornou o G3.4 quase gratuito. Soltar do Finder segue
  para a fileira (o evento do Tauri não tem cursor). Sem capability nova: a
  costura é do transporte de cada motor. O `do_run` renumera o prompt quando
  um anexo cai no caminho.
- **F2:** o aviso é componente próprio com a casca do `ContinuityBanner`, e a
  folga no seletor mora na dica do trilho de ícones (o seletor não é menu de
  texto desde o PRD do revezamento).
- **Estrutura:** para caber, os testes inline do `agent.rs` e do `adapters.rs`
  foram para arquivos próprios (os do `adapters.rs` divididos por motor), o
  redutor de itens saiu do `store/chat.ts`, e os testes da migração do banco
  saíram do `lib.rs`. As catracas de tamanho e de marca só desceram.
- **§8:** o `~/.codex/config.toml` desta máquina deixou de fixar modelo (o
  Codex segue o padrão da conta). Na Frota, "Padrão" continua sem mandar
  modelo; se um dia a conta recusar o padrão, o erro chega como falha do
  turno. Fica como pendência à parte.

Fora deste plano por decisão do dono (27/09): G2 (barra segmentada da cota),
F1 isolada, F3 a F10, G4 a G6 e G9.

## 0. Decisões pendentes

| # | pergunta | proposta | afeta |
|---|---|---|---|
| D1 | G8: opção A (narração em voz baixa), B (resposta com trilho) ou C (narração recolhida)? | A | G8.3 |
| D2 | G1: cartão só para arquivo fora do código (relatório, imagem, planilha) ou para todo arquivo criado? | fora do código | G1.2 |
| D3 | G7: "Salvar no projeto" pergunta a pasta sempre ou lembra a última por projeto? | lembra | G7.3 |
| D4 | G7: aceitar fixture montada do payload real de julho + schema oficial até haver captura ao vivo? | sim, marcada NEEDS-VERIFY | G7.1 |
| D5 | G3: a ficha mostra nome do arquivo ou só miniatura e número? | nome, cortado no meio | G3.2 |
| D6 | F2: limiar fixo (85%) ou configurável por plano? | fixo no começo | F2.2 |
| D7 | F2: a projeção ("acaba antes de voltar") entra junto? | sim, se D6 fixo | F2.1 |
| D8 | F2: OpenCode aparece no cartão sem folga ("sem medidor · US$ hoje") ou só no seletor? | nos dois | F2.4 |

## 1. Ordem e por quê

1. **G7 · imagem gerada** (P). É conteúdo que some hoje: o item
   `imageGeneration` do Codex cai no `_ => vec![]` de
   `app/src-tauri/src/codex_appserver.rs:257`. Correção antes de feature.
2. **G1 · cartão de arquivo entregue** (M). Mesmo lugar do fio que o G7,
   mesma primitiva do composer.
3. **G8 · resposta com peso** (M). Usa a `phase` que o G7 já vai ler do mesmo
   item `agentMessage`.
4. **G3 · imagem no meio do texto** (G). Composer, rascunho, envio e quatro
   adapters, com teste de contrato por motor.
5. **F2 · onde gastar** (M/G). Regra de cota, memória de episódio e dois
   componentes.

## 2. Restrições que valem para todas as histórias

- **Catraca de tamanho: quatro arquivos no teto.** Medido em 27/09:
  `adapters.rs` 7515, `agent.rs` 2317, `codex_appserver.rs` 1963 e
  `store/chat.ts` 2045, todos iguais à baseline. Qualquer linha a mais neles
  quebra `bun run check`. A história que toca um deles **começa dividindo o
  arquivo** (recorte fechado, com nome próprio), nunca subindo o teto. Perto
  do limite por tipo: `LexicalComposer.tsx` 639 de 700 e `messageNodes.ts`
  429 de 500.
- **Número de ADR**: a máxima em 27/09 era a 271 (outra frente registrou
  durante este estudo). Conferir de novo na hora de numerar; `bun run check`
  cobra (`adrUnico.mjs`).
- **Fixture real** (ADR-016). Já colhido e guardado em
  `docs/assets/maestri-chat/spike-g7/` (pasta local, fora do git): stream real
  do `codex app-server` 0.157.1 com `phase: commentary` e `final_answer`
  (`app-server-codex-sem-image-gen.jsonl`), payload real de geração de imagem
  de 29/07 (`rollout-2026-07-29-image-gen.jsonl`) e trecho do schema oficial.
  O que virar fixture de teste entra em `app/src/test/` ou ao lado do código,
  com o base64 cortado.
- **Agnosticismo**: capability nova entra em `adapters.rs` e no espelho
  `src/lib/agents.ts`, com teste-gêmeo e teste de contrato. Nenhum `if` por
  nome de motor.
- **Suítes antes de entregar**: `bun run test`, `bunx tsc -b --force`,
  `cargo test`, `bun run check`.

## 3. G7 · a imagem que o motor gera aparece no fio (P)

**Evidência (27/09):** schema do app-server 0.157.1 define o item
`imageGeneration` com `id`, `status`, `result` (obrigatório, a imagem inteira
em base64), `revisedPrompt`, `savedPath`, `failure` e `transparentBackground`.
O payload real de julho tinha `result` com 3,3 MB e `savedPath` em
`~/.codex/generated_images/<thread>/<call>.png`. O item irmão `imageView`
(o agente olhou uma imagem local) também cai no `_ => vec![]`.
A captura ao vivo não saiu: a conta do Codex desta máquina está no plano
"free" e a ferramenta `image_gen` não aparece nele.

### G7.0 · dividir o mapeamento de itens do Codex
`map_item_started` e `map_item_completed` saem de `codex_appserver.rs` para
`codex_itens.rs`. Sem mudança de comportamento; os testes existentes passam
sem alteração. Abre espaço para G7.1 e G8.1.

### G7.1 · mapear `imageGeneration` e `imageView`
- `item/started` com `imageGeneration` → `AgentEvent::Tool` com o nome do
  vocabulário do contrato (ADR-253) para gerar imagem, input com o
  `revisedPrompt` quando vier.
- `item/completed` → `ToolResult` com `images` = cópia de `savedPath` para a
  pasta de evidência do turno, pelo mesmo `EvidenceSink` da imagem de MCP
  (`evidence::collect_images`, `evidence.rs:77`). Sem `savedPath`, decodifica
  `result` direto para o arquivo de evidência.
- `failure` presente → `ToolResult` com `ok: false` e o motivo.
- **O base64 nunca atravessa o Channel.** Teste: o evento serializado de um
  item com `result` de 3 MB tem menos de 10 KB.
- `imageView` → ação de leitura com o caminho.
- Testes: fixture montada com os valores reais de julho no formato do schema
  (D4), marcada NEEDS-VERIFY até a captura ao vivo; caso de falha; caso sem
  `savedPath`.

### G7.2 · a ação e a miniatura no fio
- `FraseDaAcao`: "Gerou imagem" + o prompt curto; falha diz "A geração
  falhou" com o motivo.
- A miniatura já aparece pelo caminho de evidência (`MiniaturasDoFio.tsx`),
  com lightbox e arrasto (ADR-214). O prompt revisado vai no `HoverCard` da
  miniatura.
- Aceite: com a fixture, o fio mostra ação + miniatura; lightbox abre; a busca
  do fio não indexa base64.

### G7.3 · "Salvar no projeto"
- Botão `chip` ao lado da miniatura: diálogo de salvar do sistema, com a
  última pasta do projeto (D3), e comando Rust que copia a evidência.
- Fail-closed: destino fora de pasta gravável aborta com o motivo; nome
  existente não é sobrescrito sem confirmação.
- ADR: "a imagem gerada vira evidência do turno; o base64 nunca entra no fio".

## 4. G1 · o arquivo entregue vira cartão (M)

### G1.1 · corte no meio, puro e único
`nomeCortadoNoMeio(nome, max)` em `src/lib/`: a extensão sobrevive sempre,
graphemes contados certo (acento, emoji). Usado pelo `CartaoDeArquivo` do
composer (hoje corta no fim pelo CSS) e pelo cartão novo. Testes com nomes
reais do fio.

### G1.2 · quais arquivos o turno entregou
`entregasDoTurno(items)` puro: arquivos **criados** no turno (não editados).
Sinal de criação por motor, normalizado no adapter: Claude pelo resultado do
Write, Codex pelo `fileChange` com tipo de inclusão, agy e OpenCode a
conferir no stream real. Sem sinal claro, o arquivo não vira cartão e segue
como pílula (fail-open no render). Com D2 = "fora do código", filtra por
extensão de documento, dado e mídia. Imagem gerada (G7) não duplica: ela já
tem miniatura.

### G1.3 · o cartão
- A geometria do `CartaoDeArquivo` (quadro 40px, nome 12, meta 11) sobe para
  uma base compartilhada em `components/`, usada pelo composer e pelo fio.
  Duas superfícies, um gesto, uma primitiva.
- Meta lida do disco ao mostrar: tipo, tamanho e o dado do tipo (páginas,
  linhas, dimensões) quando barato de ler. Arquivo ausente: "não está mais no
  disco", sem ação de abrir.
- Clique abre na aba do arquivo (ADR-240). Hover: Abrir e Mostrar na pasta.
  Fonte de arrasto (ADR-214).
- Lugar: logo abaixo da última fala do turno. Com G8 entregue, abaixo da
  resposta.
- Aceite: turno real do fixture `fio-real.json` que criou arquivos mostra os
  cartões; apagar o arquivo muda o cartão sem recarregar a conversa.

## 5. G8 · a resposta final com peso próprio (M, depende de D1)

### G8.1 · a fase da fala, onde o motor diz
- Capability nova `fase_da_fala` (Codex sim, os outros não).
- `item/started` de `agentMessage` traz `phase` antes dos deltas (conferido
  no stream real). O evento de texto passa a levar a fase opcional
  (`AgentEvent` em `agent.rs` e a união em `src/lib/agent.ts:40`), e o item de
  texto guarda (`store/chat.ts:594`). `null` quer dizer "não sei", como o
  próprio schema manda tratar.
- `agent.rs` e `store/chat.ts` estão no teto: dividir antes (§2).

### G8.2 · qual fala é a resposta
`respostaDoTurno(items, terminou)` puro, em módulo próprio:
- com a fase: a fala marcada `final_answer`;
- sem a fase: a última fala depois da última ação, **só com o turno
  terminado**;
- turno rodando sem fase: nenhuma. Nada é "final" antes de ser.
Testes: `app-server-codex-sem-image-gen.jsonl` (Codex real, com as duas
fases) e `src/test/fio-real.json` (Claude real). Turno interrompido: a última
fala não vira resposta (a interrupção tem marco próprio, ADR-180).

### G8.3 · o render
Com D1 = A: narração em 13 e cor secundária, resposta em 14 e cor de texto,
aplicado quando a resposta existe (sem piscar durante o turno, sem animação,
ADR-179). Só apresentação: busca, cópia, citar trecho e recibo não mudam.
Aceite: mesmo fio antes e depois, nenhum texto some; `messageNodes.ts` fica
abaixo de 500 linhas.

## 6. G3 · imagem no meio do texto do composer (G)

**Evidência (27/09):** `turn/start` do Codex aceita `input` como lista de
`text` e `localImage` intercalados (schema 0.157.1); a Frota hoje manda o
texto inteiro e as imagens depois (`turn_params`, `codex_appserver.rs:128`).
Claude recebe os caminhos numa lista no fim do prompt (`adapters.rs:2217`),
Antigravity por `-i` e OpenCode por `-f` (ADR-260). O rascunho é uma string
por conversa, com menção serializada como `@nome` (`lexicalDraft.ts`).

### G3.0 · spike de 30 minutos
Com uma conta que aceite o modelo: mandar ao Codex duas imagens intercaladas
e perguntar "o que tem na imagem 1"; mandar ao Claude o caminho no ponto do
texto. Confirma que a posição chega ao modelo. Resultado no topo deste plano.

### G3.1 · o marcador, puro
`anexoNoTexto.ts`: marcador privado na string do rascunho (formato que ninguém
digita, com o id do anexo), numeração pela ordem de aparição, e as três
saídas: intercalada (lista de partes), caminho no ponto (Claude) e "[imagem
N]" com legenda da ordem (Antigravity, OpenCode). Anexo sem marcador segue
como hoje. Testes de ida e volta e de cada saída.

### G3.2 · a ficha no editor
Nó decorador próprio em arquivo novo (o `LexicalComposer.tsx` está a 61
linhas do teto), com `planDraft`/`serializePlan` estendidos. Colar e soltar
imagem põem a ficha no cursor (`SolturaNoComposer.tsx`); backspace apaga;
clique abre o lightbox. Nome cortado no meio (G1.1) conforme D5.

### G3.3 · o envio
O prompt com marcadores atravessa até o Rust. Capability nova
`imagem_intercalada` (Codex sim): `turn_params` monta as partes intercaladas.
Claude: o caminho vai no ponto, e a lista final só para anexo sem marcador.
Antigravity e OpenCode: "[imagem N]" e legenda, argv na mesma ordem.
`adapters.rs` no teto: o `render_attachments` de cada motor sai para módulo
próprio antes. Teste de contrato por motor com o payload exato do mock.

### G3.4 · onde mais o marcador aparece
Nenhum marcador cru pode vazar: balão do fio (miniatura no ponto, em
`UserMessageBubble.tsx`), envelope do revezamento (`lib/handoff.ts`), índice
de busca, Companion (`companion/core.js`, fail-open para "[imagem N]") e a
nota (ADR-270). Grep dos call sites do texto do rascunho antes de fechar.

ADR: "a imagem entra no ponto do texto; o motor recebe pela capability".

## 7. F2 · a Frota sugere onde gastar (M/G)

**Base:** `checkAgentQuota` e `eligibleHandoffTargets`
(`src/lib/quotaExhausted.ts`), `deriveComposerContinuity`
(`src/lib/composerContinuity.ts:22`), `ContinuityBanner.tsx`, e o
`useUsage` que guarda só a última leitura por motor (`store/usage.ts`).
Motores com janela: Claude (statusline), Codex (rpc), Antigravity (print).
OpenCode e Modelo direto: `usageWindow: null`.

### F2.1 · ritmo, só com leitura real (D7)
`useUsage` passa a guardar a leitura anterior de cada janela. `ritmoDaJanela`
puro: exige duas leituras da **mesma** janela (mesmo `resetsAt`), ritmo
positivo, e leitura recente (`snapshotUsable`). Fora disso, sem projeção.
Testes com `now` injetável.

### F2.2 · o estado "perto"
`checkAgentQuota` vira `estadoDaCota`: `ok`, `perto` (a partir de 85% numa
janela lida, D6, ou projeção de 100% antes do reset) e `esgotada`. A
contraprova de hoje vale para os dois (turno concluído depois da leitura a
desmente). Os chamadores atuais continuam lendo `esgotada` como antes.

### F2.3 · a folga de cada destino
`eligibleHandoffTargets` passa a devolver a folga lida de cada destino (qual
janela, quanto livre, idade da leitura) ou "sem medidor" com o gasto de hoje
(`turn_costs`). Só leitura recente conta como folga sugerida. Nada afirma que
outro motor usa outro plano quando não sabe (ADR-165).

### F2.4 · o cartão e o seletor
- `ContinuityBanner` ganha o estado de aviso antecipado, com a copy do mock.
  `deriveComposerContinuity` recebe o estado "perto".
- "Agora não" encerra o episódio: `Map` de módulo por conversa, motor e
  `resetsAt` (padrão do watchdog), sem persistir. Janela nova ou uso abaixo
  do limiar abre episódio novo.
- `IdentityPicker`: a folga à direita de cada motor, sempre, da mesma fonte.
- Escolher prepara o próximo envio pelo revezamento que já existe (ADR-165,
  ADR-206). Nada troca sozinho.
- Aceite: com leituras reais gravadas (fixture de statusline e rpc), o cartão
  aparece a 85%, some com "Agora não", volta na janela seguinte; leitura velha
  perde a cor de alerta e diz a idade; OpenCode nunca mostra percentual.

ADR: "a cota avisa antes de acabar, e quem escolhe o destino é a pessoa".

## 8. Achado à parte (não é deste plano)

No teste do G7, o `~/.codex/config.toml` desta máquina aponta para
`gpt-6-astra`, que a conta atual recusa ("not supported when using Codex with
a ChatGPT account"). Um turno do Codex pela Frota **sem modelo escolhido**
herda esse padrão e falha. Vale conferir se a Frota sempre manda `model` no
`thread/start` (`thread_params`, `codex_appserver.rs:112`, só manda quando há)
e se o erro chega ao fio com o motivo.

## 9. Revisão de 28/09

Conferido no código depois de entregue. Corrigido no commit `d635dc1`:

| # | achado | onde | correção |
|---|---|---|---|
| R1 | a espera pela imagem do agy (até 500 ms com `std::thread::sleep`) rodava dentro do leitor assíncrono do stream e travava o turno, inclusive o "parar" | `agy_ferramentas.rs`, laço de `agent.rs:1547` | uma tentativa ao fechar o passo; pendente é tentado de novo nas linhas seguintes e vira resultado tardio; o redutor junta imagem tardia |
| R2 | imagem colada recusada (tamanho, limite, erro) deixava as fichas seguintes apontando a imagem errada | `hooks/useAttachments.ts` | o `addFiles` tira a referência da que não entrou e renumera |
| R3 | com motor que não lê imagem, a imagem citada sumia da fileira e levava o aviso "não suportado" | `CommandConsole.tsx` | nesse caso tudo fica na fileira |
| R4 | a ficha pendente piscava âmbar "não anexada" enquanto salvava | `FichaDeImagem.tsx` | "anexando…", neutra |
| R5 | entrega fora do projeto que não é imagem abria no visualizador de Markdown | `EntregasDoTurno.tsx` | mostra na pasta |

Achado que NÃO é desta frente, deixado para quem cuida:

- **"Abrir no app padrão" do `ProjectFileViewer.tsx:373` não tem permissão.**
  Ele chama `openPath` do plugin opener, e o `opener:default` do Tauri 2.5.4
  só libera abrir URL e mostrar na pasta (conferido no `default.toml` do
  plugin). O caminho certo é um comando Rust que abra só documento, nunca
  executável; ele precisa de registro no `lib.rs`, que está no teto.

Mudança de outra frente sobre esta: o aviso do F2 foi para a tira do composer,
com recolher e dispensar (ADR-281, commits `0a47eba` e `22595b8`).

## 10. O que falta, em ordem

1. ✅ **Composer** (ADR-282, commit `b9683da`). Mudou na implementação: só o
   motor fica à direita (com logo), o contexto é pizza sem texto e sem
   vermelho, e o esforço virou deslizador. O texto abaixo é o pedido original.
   (nova frente, pedido de 28/09). Mock
   `docs/mocks/composer-refino.html`: instrução do campo no tom de metadado e
   com teclas desenhadas; motor em texto de gente ("Opus mais recente",
   "raciocínio alto"); modo seguro só com ícone e Liberado com texto âmbar;
   contexto com número; microfone perto do enviar. Cinco decisões no fim do
   mock. É ajuste de tom, texto e ordem, sem comportamento novo.
2. **Pendências desta frente:** abrir no app padrão (acima); imagem gerada
   pelo `codex exec` (colher o formato quando houver conta com geração); meta
   extra do cartão de entrega (páginas, linhas, dimensões); soltar imagem do
   Finder no ponto do texto; o "Padrão" do Codex sem modelo explícito (§8).
3. **Do estudo** (`docs/competitors-maestri-2026-09-27.md`): ✅ F7, G6, G4 e
   G9 entregues em 29/09 (ADR-283). Ainda não feitos: F3 worktree que
   nasce pronto; F4 `@conversa`; F5 ferramenta `deliver`; F6 Mermaid; G5
   aparelho no navegador; F8 segredos no Keychain; o resto de F1 (volta às
   e cota no Companion).
   G2 continua fora por decisão sua.
