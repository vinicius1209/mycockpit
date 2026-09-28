# PRD, o explorador de arquivos e a aba Alterações

> Parte A: a árvore (botão direito, hover, arrastar). Parte B: as ações de git
> na aba Alterações (push, pull, branches, histórico), acrescentada em 27/09.

> Status (28/09): Parte A implementada, F1 (ADR-279) e F2 a F4 (ADR-280).
> Parte B implementada (ADR-278). Decisões da conversa na seção 7. Mocks:
> `docs/mocks/explorador-de-arquivos.html` (Parte A) e
> `docs/mocks/alteracoes-git.html` (Parte B).
> Origem: pedido de 27/09/2026, com print da árvore.
> ADR: abre na implementação; **confira o máximo real** em `docs/decisions.md`.

## 1. O pedido, nas palavras de quem usa

> "seria possível a gente estudar e planejar a inserção de ações com o mouse no
> clique direito e até mesmo algumas informações úteis com o hover do mouse?
> além disso o nosso efeito hoje de hover para arrastar um arquivo aqui pro
> composer, ou até mesmo uma pasta (não sei se é possível) é meio ruim/limitado"

## 2. Evidência

| # | achado | onde |
|---|---|---|
| E1 | O hover da linha é o `title` nativo do navegador ("CLAUDE.md (link)"): caixa do sistema, com atraso do sistema, fora do guia, e só com caminho, link e ignorado. | `app/src/components/layout/ProjectFilesPanel.tsx:415` |
| E2 | O botão direito na árvore não abre nada útil: a linha não se declara para o menu global (`data-ctx-arquivo`), e a árvore não tem menu próprio. | `AppContextMenu.tsx:189`, `ProjectFilesPanel.tsx` |
| E3 | Já existem **dois idiomas** de menu de arquivo: o global, nos chips do fio ("Abrir no editor", "Copiar caminho relativo", "Mostrar na pasta"), e o da aba, montado à mão ("Abrir ao lado da conversa", "Mostrar na árvore", "Copiar caminho"). O mesmo gesto já diverge até no rótulo de copiar. | `lib/contextMenu.ts:126-129`, `AbasDeArquivo.tsx:217`, `:226`, `FraseDaAcao.tsx:60` |
| E4 | Arrastar da árvore **já leva pasta**: a carga vai com `pasta: isDirectory` e vira o cartão de pasta no rascunho (ADR-252). O gesto existe; o problema é a cara dele. | `ProjectFilesPanel.tsx:421-428`, `lib/soltura.ts`, `BlocosDoRascunho.tsx:182` |
| E5 | Durante o arrasto de dentro, **o composer não reage**: a camada marca `data-arrasto-sobre` no cartão, mas nenhum estilo o lê (só as linhas de reordenar). O único retorno é um rótulo de 12px ao lado do cursor, com o caminho inteiro truncado. | `CamadaDeArrasto.tsx:287-289`, `index.css:501-520`, `ComposerShell.tsx:53` |
| E6 | Arrastando **do Finder**, o composer ganha um véu inteiro "Solte para anexar · N itens". O mesmo gesto tem dois idiomas conforme a origem. | `SolturaNoComposer.tsx:105-117` |
| E7 | O rótulo diz "Solte para anexar config.ts", mas o arquivo **não** vira anexo: vira cartão (citação do caminho, ADR-252). O verbo promete outra coisa. | `lib/soltura.ts:140` |
| E8 | O alvo é só o cartão do composer. Soltar no fio, logo acima, não faz nada, e o fio é a área grande da tela. | `ComposerShell.tsx:53`, `CamadaDeArrasto.tsx:110` |
| E9 | Um arquivo por vez: a árvore não tem seleção múltipla, então citar cinco arquivos são cinco arrastos. | `ProjectFilesPanel.tsx` (foco único, `focusedPath`) |
| E10 | A entrada da árvore só traz nome, caminho, tipo, link e ignorado. Tamanho, data e estado git não vêm; o git mora em `git_status`, que a aba Alterações já lê. | `lib/fileTree.ts:114`, `project_files.rs:20`, `lib/git.ts:164-196` |
| E11 | O arrasto de dentro é por ponteiro (o WebView engole o do sistema, ADR-214). Consequência: arrastar da árvore **para fora do app** (Finder, outro editor) não é possível por este mecanismo. | `CamadaDeArrasto.tsx:1-11` |

## 3. Princípio

**Um arquivo tem um catálogo só de gestos, em todo lugar.** A linha da árvore,
a aba e o arquivo citado no fio oferecem as mesmas ações com os mesmos nomes; o
que muda é só o que faz sentido naquele lugar. E todo gesto do mouse tem
equivalente no teclado.

## 4. Decisões propostas

### D1. Menu de contexto: um catálogo único de ações de arquivo
- A regra pura (`alvo → itens`) sai de `lib/contextMenu.ts` para um catálogo de
  arquivo que a árvore, a aba e o chip do fio consomem. Um rótulo por ação, e a
  aba passa a usar os mesmos rótulos (fecha E3).
- **Arquivo:** Abrir · Abrir ao lado da conversa · Abrir no editor (externo) ·
  Abrir no app padrão (imagem, PDF, o que o visualizador não lê) ｜ **Citar no
  composer** ｜ Ver alterações (só com mudança no git, sem contagem) ｜ Copiar nome · Copiar
  caminho relativo · Copiar caminho completo ｜ Mostrar na pasta.
- **Pasta:** Citar no composer ｜ Buscar nesta pasta (preenche a busca com o
  escopo) · Recolher tudo dentro ｜ Copiar caminho relativo · Copiar caminho
  completo ｜ Mostrar na pasta.
- **Várias linhas selecionadas (D4):** Citar N itens no composer ｜ Copiar
  caminhos.
- Item que não faz não existe (ADR-042): fora do Tauri, "Mostrar na pasta" some;
  sem git, "Ver alterações" some.
- **Fora deste corte:** criar, renomear, mover e apagar. Mexem no disco e pedem
  confirmação e desfazer próprios; entram num PRD seguinte, se você quiser.

### D2. Hover: um cartão no estilo do app, no lugar do `title` nativo
- `HoverCard` (a mesma primitiva do cartão de anexo, ADR-252), com atraso de
  ~500 ms, para o lado do fio (a árvore mora à direita). Some o `title`.
- **Arquivo:** caminho relativo completo (mono) · tipo, tamanho e "alterado há
  3 min" · linhas, quando é texto pequeno · "ignorado pelo git" · "aberto numa
  aba" · link → destino · e **quem alterou** (D2b). **Sem** "modificado no git
  +12 −3": não ajuda a decidir nada ali, e o estado já aparece na letra da linha
  (D3).
- **Imagem:** a miniatura no topo do cartão.
- **Pasta:** quantos itens (quando já carregada).
- **Dados:** um comando novo, leve e sob demanda (`detalhe_do_caminho`: stat,
  linhas até 1 MB, destino do link), chamado só quando o cartão abre. O git vem
  do `git_status` que a aba Alterações já lê, sem rodar git de novo, e só
  alimenta a letra da linha (D3) e o item "Ver alterações" (D1).

### D2b. Quem alterou: de qualquer conversa, com o motor de cada uma
Pedido de 27/09: "e se foi outro agente em outra conversa? poderia ter mais
distinção, até mesmo o ícone do code agent".

- **Até três linhas, a mais recente primeiro**, uma por conversa que ALTEROU o
  arquivo, de qualquer conversa do projeto: o logo do motor (`AgentLogo`, o
  mesmo da sidebar), o nome do motor, onde ("nesta conversa" ou o título da
  outra) e quando. Clicar na linha de outra conversa abre a conversa. Mais que
  três vira "e mais 2 conversas".
- **Só alteração, nunca leitura.** O `arquivosTocados` do `@` conta qualquer
  `file_path` de tool, inclusive o `Read`, e "mexeu" mentiria para um arquivo só
  lido. A régua é a do fio: `classificarAcao(item).muda`, a mesma da aba
  Alterações, sem nome de motor.
- **"Fora da Frota"**: se o disco mudou depois da última alteração conhecida
  (o `mtime` é mais novo), a primeira linha diz "alterado fora de uma conversa ·
  há 2 min", sem ícone. É você num editor, um terminal ou o git; o app não
  inventa autor.
- **O motor de cada alteração é rastreado, não suposto.** Pedido de 27/09:
  "temos que saber, ou mostrar apenas o último motor mesmo, mas o ideal seria
  ter o rastreamento". Hoje nenhum item de tool guarda o motor que o produziu;
  a conversa só guarda o motor ATUAL, e uma conversa que passou por
  revezamento (Claude → Codex) atribuiria ao Codex o que o Claude fez. Três
  camadas, da mais forte para a mais fraca:
  1. **Daqui para frente, carimbo.** Todo item de tool nasce com `agent` (o
     motor do turno que o produziu), no mesmo ponto em que o reducer já cria o
     item. Vale para o chat linear, a mesa e o revezamento.
  2. **O passado, reconstruído pelo custo do turno.** `turn_costs` grava cada
     turno com `conv_id`, `agent` e a hora do result (ADR-047). Uma ação
     pertence ao turno cujo result vem logo depois dela no fio, antes da
     próxima fala sua: a primeira linha de `turn_costs` da mesma conversa com
     `created_at` ≥ a hora da ação, dentro desse limite, diz o motor. Derivado
     na leitura, sem migração e sem reescrever histórico.
  3. **Sem registro nenhum** (turno que morreu antes do result, ou conversa
     anterior ao ledger): o motor do turno vizinho, se o de antes e o de depois
     concordam; senão, o motor atual da conversa, como você aceitou. Não há
     "motor não registrado" na tela.
  O teste cobre as três camadas com um fio real que teve revezamento.
- **Limite honesto:** alteração feita por fase de missão ou candidato de
  disputa não mora em `conversation_items`, então não entra nesta primeira
  versão. A missão guarda `files_touched` por fase (com o motor da fase), e é o
  caminho para ela entrar depois.
- **Dados:** a busca vai ao índice FTS que já cobre os itens de todas as
  conversas (`conversation_item_fts`, que indexa nome e input das tools): o
  caminho vira a consulta, o Rust devolve os itens candidatos do projeto com
  título, motor e hora da conversa, e o front confirma o caminho e aplica a
  régua de alteração. Só quando o cartão abre, como o resto do hover.

### D3. Sinais na própria linha, sem precisar de hover
- Letra de estado git à direita (M, A, U), em cinza, no lugar do ponto de "aberto
  numa aba" quando os dois coexistem, com a legenda no hover. **Sem cor**: o
  verde e o vermelho de diff são do domínio git (§2), e uma árvore inteira
  colorida vira ruído; a letra basta.
- Pasta com filho modificado ganha um ponto discreto, como no VS Code.

### D4. Seleção múltipla
- ⌘+clique (Ctrl+clique no Linux) alterna uma linha; Shift+clique seleciona o
  intervalo. Seleção usa `sel`, neutra (ADR-043). Esc limpa.
- A seleção vale para o menu (D1) e para o arrasto (D5).

### D5. Arrastar: o mesmo idioma venha de onde vier
- **O composer reage igual** ao arrasto do Finder: o mesmo véu, com o verbo
  certo. "Solte para citar config.ts" (cartão), "Solte para citar a pasta
  docs", "Solte para citar 3 itens"; "anexar" só para imagem e PDF, que viram
  anexo de verdade (fecha E5, E6, E7).
- **Alvo maior:** a coluna da conversa inteira (fio e composer) aceita a
  soltura, e o véu cobre a coluna; soltar no fio vai para o rascunho (fecha E8).
- **O fantasma** vira um cartão pequeno: ícone do tipo, o nome (não o caminho
  inteiro), e "+2" quando são vários.
- Pasta continua valendo (E4) e aparece como tal no fantasma e no véu.
- **Equivalente sem arrastar:** "Citar no composer" no menu, e **⌘↵ na linha
  focada** (Ctrl+↵ no Linux). O foco fica na árvore, para citar outro em
  seguida; o cartão que aparece no rascunho é o retorno.
- **Sem conflito de atalho** (levantado em 27/09): os cinco ⌘↵ do app são
  locais a um campo de texto focado (o composer no modo de envio ⌘↵,
  `TurnNote.tsx:97`, `CommitComposer.tsx:119`, `DiffPanel/comments.tsx:170`,
  `StickyNoteCard.tsx:171`), e o editor de arquivo usa o seu dentro dele; nenhum
  é global, e a linha da árvore não é campo de texto. A nuance é de sentido: no
  Frota ⌘↵ é "confirmar o que estou escrevendo", e citar põe no rascunho sem
  enviar, que é leitura próxima. O handler fica na linha (`onKeyDown`), nunca
  em `window`, e um teste de fonte trava isso.
- **Arrastar para fora do app** (Finder, outro editor) fica fora: o mecanismo
  por ponteiro não fala com o sistema (E11). Registrado como limite, não
  prometido.

## 5. Requisitos com aceite

### R1. Menu da árvore
- *Aceite:* botão direito numa linha abre o menu do catálogo; pasta e arquivo
  mostram os itens da D1; com três linhas selecionadas, "Citar 3 itens"; itens
  sem suporte não aparecem; a aba de arquivo usa os mesmos rótulos.
- *Double check:* teste puro do catálogo (alvo → itens) cobrindo arquivo,
  pasta, múltiplos, fora do Tauri e sem git; teste de fonte de que a aba e a
  árvore leem o mesmo catálogo.

### R2. Cartão de hover
- *Aceite:* o `title` nativo sai; após ~500 ms o cartão abre com os dados da D2,
  sem linha de diff do git;
  imagem mostra miniatura; sair da linha fecha; nada é pedido ao Rust antes de o
  cartão abrir.
- *Double check:* teste Rust de `detalhe_do_caminho` (arquivo, pasta, link,
  fora da raiz recusado); no app, passar o mouse por 20 linhas rápido não
  dispara 20 leituras.

### R2b. Quem alterou
- *Aceite:* um arquivo alterado pelo Claude nesta conversa e pelo Codex em
  outra mostra as duas linhas, com os logos, a mais recente primeiro; um
  arquivo só lido não mostra nenhuma; clicar na outra conversa a abre; `mtime`
  mais novo que a última alteração conhecida põe "alterado fora de uma
  conversa" no topo; numa conversa que trocou de Claude para Codex, a ação
  anterior à troca mostra o Claude (carimbo ou reconstrução pelo custo do
  turno), nunca o motor atual por engano.
- *Double check:* teste puro da régua (alteração × leitura, caminho relativo ×
  absoluto; carimbo, reconstrução por `turn_costs`, vizinho e último motor),
  com itens reais de um fio que tem `Read` e `Edit` no mesmo arquivo e um
  revezamento; teste Rust da consulta ao FTS restrita ao projeto, com o
  `turn_costs` ao lado.

### R3. Sinais na linha
- *Aceite:* arquivo modificado mostra "M", novo "A", não rastreado "U"; pasta com
  filho mudado mostra o ponto; tudo neutro; a legenda vem no hover.

### R4. Seleção múltipla
- *Aceite:* ⌘/Ctrl+clique e Shift+clique selecionam; Esc limpa; o teclado segue
  navegando pelo foco sem perder a seleção.

### R5. Arrasto
- *Aceite:* arrastar da árvore acende o véu na coluna da conversa com o verbo
  certo; soltar no fio ou no composer cria os cartões; vários itens viram vários
  cartões; imagem da árvore vira anexo e diz "anexar"; o fantasma mostra ícone e
  nome.
- *Double check:* teste puro do rótulo (arquivo, pasta, vários, imagem) e da
  regra de alvo; no app, arrastar a pasta `docs` e ver o cartão de pasta.

## 5b. Orçamento de desempenho

Pedido de 27/09: "não quero degradação no desempenho". Regra: **nenhum custo
novo por token, por frame ou por linha visível**; o que custa roda sob demanda,
fora do render, e é medido.

**Medido no banco real** (27/09, cópia só leitura do `frota.db`: 102 MB, 26
conversas, 11.625 itens, 1.719 turnos):

| consulta | resultado |
|---|---|
| `conversation_item_fts` MATCH do caminho (trigram) | 13 a 71 candidatos, 10 a 20 ms |
| a consulta inteira do "quem alterou" (índice + itens de tool + conversa + `turn_costs` por candidato) | 10 a 15 ms |
| volume dos candidatos de `PLAN.md` | 52 itens, **165 KB de JSON** (quase tudo texto de resultado) |
| itens de tool com hora (`ts`) | 8.443 de 8.526 (99%) |
| `turn_costs` por conversa e hora | usa só `idx_turn_costs_time` e filtra a conversa depois |

**Decisões que saem da medição:**
- O Rust devolve só nome da tool, input e hora de cada candidato, nunca o
  `item_json` inteiro: os 165 KB viram poucos KB. Teto de 40 candidatos, os
  mais recentes.
- Índice novo `turn_costs(conv_id, created_at)` (uma migração de um statement;
  conferir a versão máxima real no `lib.rs`), para a reconstrução do motor não
  crescer com o histórico.
- Observação: a definição em `conversation_items.rs` (`FTS_CRIAR_TABELA`) diz
  `unicode61`, mas o banco real é `trigram` (a migração posterior trocou). A
  SPEC usa a tabela como ela é, e o teste roda contra a SQL das migrações.

**Mapeado, a verificar na implementação:**

| risco | como não degrada | como se mede |
|---|---|---|
| hover em cada linha | **uma** instância de `HoverCard` para a árvore inteira, reposicionada na linha sob o mouse; nada por linha | 1.000 linhas visíveis, rolagem sem queda de quadro |
| leituras ao passar o mouse | nada é pedido antes dos ~500 ms; sair da linha cancela; resultado em cache por caminho e `mtime` | passar por 20 linhas rápido dispara zero leituras |
| `detalhe_do_caminho` | assíncrono, `spawn_blocking`, linhas só até 1 MB | < 10 ms em arquivo de 1 MB |
| letra de git nas linhas | o **mesmo** `git_status` da aba Alterações, numa fonte compartilhada por pasta, com os sinais e o amortecimento de `lib/sinaisDoDisco` (uma leitura por rajada, nunca por linha) | uma chamada de git por sinal, com a árvore e a aba abertas juntas |
| pasta com filho mudado | o conjunto de pastas-ancestrais calculado uma vez por status, e a linha só consulta o conjunto | O(1) por linha |
| carimbo `agent` no item | só na criação do item de tool, fora do caminho dos deltas de texto; cerca de 20 bytes por item | `check:fluidez` (custo por token) segue verde |
| véu do arrasto | liga e desliga ao entrar e sair da coluna, não a cada movimento | nenhum render novo por `pointermove` além do fantasma, que já existe |
| seleção múltipla | um `Set` no estado da árvore | sem custo mensurável |

## 6. Fora do escopo

- Criar, renomear, mover e apagar (PRD próprio, com confirmação e desfazer).
- Arrastar da árvore para fora do app (E11).
- Mudar o que o cartão de arquivo faz no envio (ADR-252 segue valendo).

## 7. Decidido em 27/09

1. **Operações de disco** (novo arquivo, renomear, mover para a lixeira) ganham
   um PRD seguinte, com confirmação e desfazer próprios.
2. **⌘↵ cita** na linha focada; sem conflito (D5).
3. **Sem "modificado no git +12 −3"** no hover nem contagem no menu: não é
   informação útil ali. A letra da linha (D3) fica, e sai se incomodar na tela.

## 8. Fatiamento

1. **F1, menu:** catálogo único, menu da árvore, a aba migrando para ele.
2. **F2, hover:** `detalhe_do_caminho`, cartão, letra de git na linha, e o
   carimbo `agent` nos itens de tool novos.
3. **F2b, quem alterou:** consulta ao FTS e a lista com os logos.
4. **F3, arrasto:** véu único na coluna, verbo certo, fantasma novo.
5. **F4, seleção múltipla:** seleção, e menu e arrasto em lote.

## 9. Double check contra as leis

- **Agnosticismo:** nada aqui olha motor. O cartão de pasta de fora do projeto
  segue a capability `pastasExtras` (ADR-252).
- **Estado real:** o hover mostra o que o disco e o git dizem, pedido na hora; o
  "agente mexeu" vem do fio, não de palpite.
- **Decisão humana:** citar e soltar são gestos; nada é enviado sozinho.
- **Guia:** um catálogo e uma primitiva por gesto (regra 1), `HoverCard` e
  `ContextMenu` de `components/ui`, seleção neutra, controles nos degraus.

---

# Parte B, a aba Alterações: as ações de git que faltam

> **Status (28/09/2026):** BF1 a BF4 implementadas (ADR-278), com três
> correções ao texto abaixo: a busca automática ao voltar o foco ficou de fora
> deste corte (a busca é gesto, e o `↓` diz a idade); clicar num commit do
> Histórico não abre o diff, porque a aba de diff ainda não lê commit; e o menu
> por arquivo (BD7) espera o catálogo da Parte A. Trazer commits também é
> barrado com turno rodando na pasta, pelo mesmo motivo da troca de branch.

## B1. O pedido

> "acrescente no plano a possibilidade de fazer push e quem sabe outras ações
> úteis do git na nossa aba de alterações, semelhante a muitas IDEs e ADEs no
> mercado"

O print mostra a aba: `main ↑3`, `+247 −232`, a mensagem de commit com gerador,
"Criar commit" com um menu ao lado, três arquivos e "Abrir pull request".

## B2. Evidência

| # | achado | onde |
|---|---|---|
| B-E1 | O app faz status, stage e unstage (arquivo e tudo), descartar (arquivo e tudo, com confirmação), diff, commit (com `amend`), pull request e worktrees. **Não faz** push avulso, pull, fetch, troca ou criação de branch, histórico, stash nem desfazer commit. | `app/src/lib/git.ts:184-280`, `app/src-tauri/src/git.rs` |
| B-E2 | O único push do app mora dentro do pull request: troca a conta do `gh` e faz `git push -u origin <branch>`. Quem só quer enviar os commits não tem botão. | `git.rs:995-998` |
| B-E3 | O `↑3` do cabeçalho é texto, não gesto; o `↓N` depende do último fetch, que o app nunca faz, então pode estar velho sem dizer. | `app/src/components/layout/DiffIndex.tsx:262-266` |
| B-E4 | O nome da branch também é só texto: não troca nem cria branch. | `DiffIndex.tsx:258-261` |
| B-E5 | O menu ao lado de "Criar commit" tem mensagem longa e `amend`, mas não "commit e enviar". | `DiffPanel/CommitComposer.tsx:229-240` |
| B-E6 | `git.rs` tem 1312 linhas, congelado acima do teto de 1000: comando novo de git vai para módulo próprio. | `scripts/lints/file-size-baseline.json` |
| B-E7 | Push com a conta errada do GitHub ativa falha com "repository not found", e já aconteceu neste repo. O app sabe trocar a conta (`gh_switch_account`), mas só o fluxo de pull request usa isso. | `github.rs:196`, `git.rs:995` |

## B3. Princípio

**Toda ação que sai da máquina ou reescreve histórico é gesto seu, e diz o que
vai fazer antes.** Nada de push automático, nada de `--force`, e o estado mostra
de quando é ("↓2 desde a busca de há 3 h").

## B4. Decisões propostas

### BD1. Sincronizar com o remoto
- **O `↑3` de texto vira o botão**, só ícone e contagem (decidido em 28/09: "os
  próprios ícones já dizem isso"): `↑3` quando só está à frente, `↓2` quando só
  está atrás, `↓2 ↑3` quando os dois (traz e depois envia). O texto mora no
  tooltip do app (`ui/tooltip`, o do §12 para o nome do que o ícone diz) e no
  `aria-label`: "Enviar 3 commits", "Trazer 2 commits", "Trazer 2 e enviar 3".
  Sem upstream, não há número para carregar o sentido, e uma seta sozinha se
  confundiria com o `↑`: "Publicar branch" (`push -u`) ganha ícone próprio,
  nuvem com seta, com o mesmo tooltip. Enviando, o ícone vira o spinner e o
  tooltip diz "Enviando 3 commits…".
- **Pull só avança** (`--ff-only`) por padrão. Se os dois lados divergiram, o
  app não mescla em silêncio: diz que divergiu e oferece "Trazer com rebase"
  como gesto explícito, ou parar.
- **Nunca `--force`.** Push recusado por histórico divergente vira a mesma
  explicação, com "Trazer primeiro".
- **Buscar (fetch)** no menu do botão, e o `↓` ganha a idade: "desde a busca de
  há 3 h". Busca automática só ao voltar o foco à janela, no máximo a cada 5
  min, e só se você ligar nas Configurações (desligada por padrão: rede e
  credencial são suas).
- **"Criar commit e enviar"** entra no menu do "Criar commit".
- Tudo que usa a rede roda fora da tela, com "Enviando 3 commits…" no próprio
  botão, e o erro do git no detalhe do aviso.

### BD2. A conta certa do GitHub
- Push, pull e fetch que falham com "repository not found" ou 403 num remoto do
  GitHub mostram **qual conta está ativa** e oferecem "Trocar para <conta>"
  (as contas vêm do `pr_context`, que já as lista), repetindo o gesto depois.
  É o caso que já custou tempo aqui.

### BD3. Branches
- O nome da branch vira um seletor: as branches locais (as recentes primeiro),
  "Nova branch a partir daqui" e a busca.
- **Trocar com alterações não commitadas** não perde nada: o app pergunta
  "Levar as alterações para <branch>", "Guardar (stash) e trocar" ou
  "Cancelar".
- **Trocar com um turno rodando nesta pasta é barrado**, com o motivo: mudar os
  arquivos debaixo de um agente trabalhando é o pior caso. Conversas em
  worktree não são afetadas, e o seletor diz isso.

### BD4. Histórico e desfazer
- Uma seção "Histórico" recolhida no fim da aba: os últimos 20 commits da
  branch, com mensagem, autor e quando, e os ainda não enviados marcados.
- **"Desfazer último commit"** (volta as alterações para a área de trabalho,
  `reset --soft HEAD~1`) só aparece enquanto o commit não foi enviado; depois de
  enviado, reescrever é trabalho de outro gesto, que não entra aqui.
- Clicar num commit abre o diff dele na aba de diff que já existe.

### BD5. Stash
- "Guardar alterações" (stash com mensagem) e a lista para "Recuperar" ou
  "Apagar" (esta com confirmação). Também é o caminho da BD3.

### BD6. Conflitos
- Rebase ou pull que para em conflito deixa a aba em modo conflito: a lista dos
  arquivos em conflito, "Abrir" cada um no editor da Frota, e **"Pedir ao
  agente para resolver"**, que escreve o pedido no composer da conversa (não
  envia: o gesto é seu). "Continuar" e "Abortar" o rebase ficam visíveis.

### BD7. Ações por arquivo
- A linha de arquivo da aba ganha o mesmo menu de contexto da Parte A (catálogo
  único), mais o que é de git: preparar, tirar do preparo, descartar (com a
  confirmação de hoje) e "Adicionar ao .gitignore".

## B5. Requisitos com aceite

- **BR1 Sincronizar:** à frente mostra `↑N`, atrás `↓N`, divergido `↓N ↑N`,
  cada um com o tooltip e o `aria-label` do que faz; pull divergido não mescla sozinho; push recusado não
  força; o `↓` mostra a idade da busca. *Double check:* teste Rust com
  repositórios temporários (remoto local `file://`): avançar, divergir, recusar.
- **BR2 Conta:** falha de acesso num remoto do GitHub mostra a conta ativa e o
  "Trocar para"; repete o gesto depois de trocar. *Double check:* teste puro da
  classificação da mensagem de erro com saídas reais do git.
- **BR3 Branches:** trocar com alteração pergunta as três saídas; turno rodando
  na pasta barra; nova branch nasce do HEAD atual.
- **BR4 Histórico:** 20 commits, os não enviados marcados; "Desfazer último
  commit" só em commit não enviado e devolve as alterações.
- **BR5 Stash, BR6 Conflitos, BR7 Menu por arquivo:** conforme BD5 a BD7.

## B6. Orçamento de desempenho

- Nada de rede sem gesto (ou sem a busca automática que você ligar).
- Histórico e branches são lidos só quando a seção ou o seletor abrem, com teto
  (20 commits, 50 branches).
- Depois de cada ação, o status relê pelo mesmo sinal da aba
  (`lib/sinaisDoDisco`), uma vez.
- Os comandos novos vão para um módulo Rust próprio (`git.rs` está congelado) e
  rodam em `spawn_blocking`, nunca na thread da tela.

## B7. Fora do escopo

- `--force`, reescrever histórico enviado, cherry-pick, blame, tags e
  submódulos.
- Resolver conflito linha a linha dentro da Frota (o editor abre o arquivo; a
  ferramenta de merge é outra frente).

## B8. Fatiamento

1. **BF1:** enviar, trazer, publicar e buscar, "Commit e enviar", conta certa
   (BD1, BD2). É o pedido direto.
2. **BF2:** branches e stash (BD3, BD5).
3. **BF3:** histórico e desfazer último commit (BD4).
4. **BF4:** conflitos e menu por arquivo (BD6, BD7).
