# PRD, edição de arquivos no visualizador

> Status: **proposta revisada, sem código.** SPEC em
> `docs/edicao-de-arquivos-spec.md`. Mock em
> `docs/mocks/edicao-de-arquivos.html` (aba suja, busca, conflito, fechar, só
> leitura, Markdown).
> Origem: pedido de 26/09/2026 para editar na Frota "estilo um vscode".
> ADR: abre na F1, antes do primeiro commit. O número sai na hora:
> **confira o máximo real** em `docs/decisions.md` na hora de numerar.
> Relacionados: `docs/abas-no-principal-plan.md` (ADR-243/244, as abas),
> `docs/competitors-xirp.md` (o corte do Monaco).

## 0. O que mudou nesta revisão (26/09/2026)

A primeira versão acertava a direção (CodeMirror 6, reaproveitar a guarda de
escopo, escrita atômica) e errava em pontos que perdem dado ou que o código
não sustenta. Este bloco manda sobre qualquer leitura da versão anterior.

1. **Salvar um arquivo truncado apagava o resto dele.** A leitura atual corta
   em 400 KB / 100 mil caracteres e cola um aviso no texto. Agora a edição tem
   leitura própria, sem corte, e arquivo que não cabe abre só leitura (D2).
2. **O ⌘S sobrescrevia em silêncio o que o agente gravou.** Agora toda gravação
   leva a versão que a pessoa leu, e o Rust recusa se o disco mudou (D3, D6).
3. **A escrita herdava o escopo da leitura**, que inclui `~/.claude`, o brain
   do agy e os anexos. Agora escreve só na raiz efetiva da conversa e nas
   pastas vinculadas ao projeto (D3).
4. **O comando ia para `sources.rs`, que já está congelado acima do teto**
   (1176 linhas na baseline, teto 1000). Vai para um módulo novo (D3).
5. **O buffer ia para o store das abas**, que persiste a cada `set`, com chave
   por conversa. Agora o buffer mora no `EditorState`, por caminho absoluto, e
   o store guarda só quem está sujo (D4).
6. **CRLF e BOM se perdiam no primeiro salvamento** (o CM normaliza para LF).
   Agora a leitura detecta e a gravação devolve igual (D2).
7. **Promessas que o CodeMirror não cumpre sozinho** (contagem "3 de 12",
   `Ctrl+H`, `@codemirror/history`, painel que respeita o guia) viraram
   trabalho nosso e explícito (D7).
8. **Fechar pelo ⌘W do Mac, em lote, e sair do app** não estavam cobertos
   (D5).
9. **Emoji, toast a cada ⌘S, diálogo "do sistema ou popover", números de peso
   sem fonte**: trocados por primitivas do guia e por medição no build.

## 1. O pedido, nas palavras de quem usa

> "agora eu quero saber a possibilidade o usuario conseguir editar os arquivos
> abertos, estilo um vscode mesmo, conseguir abrir, editar, fazer seleção,
> control+F etc"

O ajuste pequeno e médio (uma linha, um nome, um termo trocado no arquivo
todo) hoje exige sair da Frota. A conversa já abre o arquivo que o agente
citou; o gesto seguinte, corrigir, leva a outra janela.

## 2. Evidência

| # | achado | onde |
|---|---|---|
| E1 | O visualizador de código é HTML estático do highlight.js. Selecionar é o único gesto. | `app/src/components/layout/ProjectFileViewer.tsx:59` |
| E2 | Markdown só existe renderizado; o texto cru não aparece. | `ProjectFileViewer.tsx:287` |
| E3 | O arquivo é lido **uma vez**: o efeito depende só de `kind`, `midia`, `path` e `root`. Se o agente mudar o arquivo, a tela não fica sabendo. | `ProjectFileViewer.tsx:190` |
| E4 | `read_text_file` trunca em 400 KB ou 100 mil caracteres e **acrescenta** `"… (arquivo truncado por tamanho)"` ao texto. Três consumidores usam essa leitura. | `app/src-tauri/src/sources.rs:9-10`, `:241`; `ProjectFileViewer.tsx:176`, `MarkdownViewerDialog.tsx:50`, `contextoDoProjetoPecas.tsx:185` |
| E5 | `scoped_file_path` autoriza a raiz, os `extra_dirs`, `~/.claude`, o brain do agy e os anexos. Serve para ler; para escrever é largo demais. | `sources.rs:258-318` |
| E6 | `sources.rs` tem 1176 linhas, congelado na baseline acima do teto de 1000 do Rust (ADR-232). Não pode crescer. | `scripts/lints/file-size-baseline.json:30`, `scripts/lints/fileSizeRatchet.mjs:72` |
| E7 | Não há comando de escrita de arquivo do projeto. Mudar arquivo hoje é o agente ou o editor externo (`OpenInEditor`). | `app/src-tauri/src/lib.rs:938` (só leitura registrada) |
| E8 | O store das abas persiste a cada `set` (o comentário avisa) e usa `\0` como separador de chave. O tipo das abas não tem noção de "alterado". | `app/src/store/abasDeArquivo.ts:57`, `:66-68`, `:152`; `app/src/lib/abasDeArquivo.ts:40` |
| E9 | Todo fechamento de aba (×, botão do meio, menu de contexto, "Fechar todas", ⌘W) passa por `fecharArquivos`. No Mac, o ⌘W chega pelo menu nativo como `frota://fechar-aba`, não como tecla. | `app/src/components/layout/abasNoPrincipal.ts:55`, `:71`, `:242`; `atalhosDasAbas.ts:4-6` |
| E10 | A raiz do arquivo é a da conversa: `worktree ?? project.path`. O mesmo caminho relativo aponta para arquivos diferentes em conversas com worktree. | `app/src/components/layout/FileTab.tsx:54` |
| E11 | A aba Alterações já sabe quando algo pode ter mudado no disco (ação que muda arquivo, fim de turno, foco da janela), sem watcher e sem nome de motor. O Rust evita FSEvents de propósito. | `app/src/components/layout/DiffPanel/useAlteracoesVivas.ts:43`, `:93`; `app/src-tauri/src/bastidores.rs:8` |
| E12 | O `confirm` do app responde só sim ou não. Não existe primitiva de controle segmentado nem barra de busca em superfície. | `app/src/lib/confirm.ts:35`; `app/src/components/ui/` |
| E13 | O menu do Mac é o `Menu::default` do Tauri, que traz Editar (Desfazer, Refazer, Copiar). | `app/src-tauri/src/menu_da_janela.rs:60` |
| E14 | As cores de código já são tokens do tema (`--hljs-keyword`, `--hljs-string`...), com variante clara e escura. | `app/src/index.css:869-882` |

## 3. Princípio

**O primeiro ⌘S que existir já é seguro.** Nenhuma gravação sem saber qual
versão a pessoa leu, nenhum byte que ela não mudou (fim de linha, BOM,
permissão) muda junto, e nenhuma escrita fora das pastas que a pessoa deu ao
projeto. Editar é
gesto da pessoa; o app não salva sozinho, não recarrega por cima do que ela
escreveu e não esconde que o disco mudou.

## 4. Decisões

### D1. Motor: CodeMirror 6, carregado sob demanda

- Pacotes: `@codemirror/state`, `view`, `commands` (histórico e keymap
  padrão; **não existe `@codemirror/history`**), `search` (a API, não o
  painel), `language`, `autocomplete` (só `closeBrackets`) e as linguagens
  `lang-javascript`, `lang-json`, `lang-markdown`, `lang-rust`, `lang-python`,
  `lang-css`, `lang-html`.
- O editor e cada linguagem entram por `import()` dinâmico: quem nunca abre
  arquivo não paga. Extensão sem linguagem abre como texto puro, sem erro.
- **Peso medido, não estimado**: a F2 mede o chunk no `vite build` e escreve o
  número na ADR. Orçamento proposto: 250 KB gzip para o núcleo mais as
  linguagens da lista.
- O tema do CM lê os **mesmos** tokens `--hljs-*` (E14): o código tem a mesma
  cor no fio e no editor, nos dois temas.
- Monaco segue fora (seção 8).

### D2. Leitura para edição, sem corte e com a identidade dos bytes

Comando novo `abrir_para_edicao(root, path) -> ArquivoEditavel`:

```
ArquivoEditavel {
  conteudo: String         // sem BOM, fins de linha como estão
  versao: String           // blake3 dos bytes do disco (a crate já existe)
  fim_de_linha: "lf" | "crlf"
  bom: bool
  gravavel: bool
  motivo: Option<String>   // por que é só leitura, na língua da pessoa
}
```

- **Sem truncar.** Acima de 2 MB, o comando devolve `gravavel: false` com
  motivo "Grande demais para editar aqui (3,4 MB)" e o conteúdo da leitura
  atual; o editor abre só leitura. Arquivo cortado nunca é gravável.
- **Fins de linha**: todos LF → `lf`; todos CRLF → `crlf`, e o editor usa a
  facet `EditorState.lineSeparator` com `"\r\n"`. Misturados → só leitura,
  motivo "Fins de linha misturados". É raro, e o CM não tem como devolver byte a
  byte.
- **BOM** sai na leitura e volta na gravação.
- Não UTF-8 continua sendo erro, como hoje.
- `read_text_file` não muda: os três consumidores de leitura (E4) seguem como
  estão.

### D3. Escrita atômica, versionada e só na pasta da conversa

Comando novo `salvar_arquivo(root, path, conteudo, versao_esperada) ->
Result<String /* versão nova */, ErroAoSalvar>`, com `ErroAoSalvar` sendo
`Conflito { versao_no_disco }`, `Sumiu`, `ForaDaPasta`, `SoLeitura` e
`Falhou(String)`.

- **Módulo novo `app/src-tauri/src/edicao.rs`**, com os testes dele. Nada entra
  em `sources.rs` (E6). O módulo reusa `scoped_file_path` para canonicalizar e
  **depois** aplica a regra própria de escrita.
- **Escopo de escrita**: a raiz efetiva da conversa (a `root` que o
  `FileTab` passa, E10) e os `extra_dirs` do projeto
  (`frota_dir::resolve_extra_dirs`), porque foi a pessoa que vinculou cada um
  (decidido em 26/09/2026). `~/.claude`, o brain do agy, os anexos e qualquer
  outro caminho absoluto abrem **só leitura**, com motivo "Fora das pastas do
  projeto". A regra é uma lista explícita em `edicao.rs`, separada da lista de
  leitura, para que autorizar leitura nova nunca autorize escrita junto.
- **Consequência registrada**: o vínculo atual inclui `~/projetos` inteiro, então
  a Frota pode salvar arquivo de outro projeto aberto por esta conversa. A ADR
  diz isso com todas as letras; o cabeçalho mostra o caminho absoluto
  quando o arquivo está fora da raiz, para ninguém editar o projeto errado sem
  ver.
- **Versão**: o Rust relê os bytes, calcula o blake3 e compara com
  `versao_esperada` imediatamente antes do rename. Diferente → `Conflito`, e
  nada é escrito. A janela entre a comparação e o rename é de microssegundos,
  e a ADR a registra, sem prometer trava.
- **Atomicidade**: temporário único no mesmo diretório
  (`.<nome>.frota-<aleatório>.tmp`), `write_all`, **permissões copiadas do
  original** (um script `+x` continua executável), `sync_all`, `rename`. Em
  qualquer erro, o temporário é apagado; ele nunca fica no `git status`.
- Symlink dentro da pasta: grava no alvo canônico, que é o que
  `scoped_file_path` já resolve. Alvo fora da pasta → `ForaDaPasta`.
- Criar arquivo novo está **fora** deste PRD: `scoped_file_path` exige que o
  arquivo exista, e isso continua valendo. Arquivo apagado entre abrir e salvar
  → `Sumiu`.
- Comando auxiliar `versao_no_disco(root, path) -> Option<String>` (`None` se
  sumiu), para a reconciliação da D6.

### D4. O buffer mora no editor, o sujo mora num store pequeno

- **Identidade do arquivo é o caminho absoluto** (raiz efetiva + relativo),
  nunca `conversa + caminho`. O mesmo arquivo aberto em duas conversas é **um**
  buffer; o mesmo relativo em dois worktrees são **dois**.
- O texto vive no `EditorState` do CM, guardado num `Map` de módulo
  (`lib/edicao/buffers.ts`) com `{ estado, base, versao, fimDeLinha, bom }`.
  Trocar de aba ou de conversa desmonta a view e **não** perde texto nem
  histórico de desfazer.
- Store novo `store/edicao.ts` (zustand, padrão de `store/fusion.ts`) com
  `sujos: Record<caminhoAbsoluto, true>` e `avisos: Record<caminhoAbsoluto,
  "conflito" | "sumiu">`. **Não persiste**: buffer não sobrevive a fechar o app
  (D5 pergunta antes).
- **Sujo é fato, não toque.** Sujo = texto atual diferente de `base`. Desfazer
  até o original apaga o ponto, como no VS Code.
- O store das abas (E8) não muda de forma. A tira lê `useEdicao` para
  desenhar o ponto.

### D5. Fechar com alteração pergunta, em qualquer caminho

- **Um portão só**: `fecharArquivos` (E9) passa a perguntar antes de fechar se
  alguma das abas pedidas está suja **e** é a última aba daquele arquivo
  aberta em qualquer conversa. Se outra conversa ainda tem o arquivo, fecha sem
  perguntar: o buffer continua lá.
- **Primitiva**: o `confirm` do app ganha o parâmetro opcional `alternativa`
  e passa a responder `"confirmar" | "alternativa" | "cancelar"` quando ele
  vem. Divergência vira parâmetro, não superfície nova (STYLEGUIDE §12).
  Botões: "Salvar", "Não salvar", "Cancelar". Em lote, o título diz quantos e a
  descrição lista os nomes.
- "Salvar" que falhe (conflito, sumiu, disco) **não fecha**: a aba fica e a
  faixa da D6 explica.
- **Sair do app e fechar a janela** com buffer sujo passam pela mesma
  pergunta. A F3 confere no código quem trata `ExitRequested` e o fechar da
  janela (bandeja, ⌘Q, menu) antes de interceptar, e o aceite cobre cada
  caminho.
- Apagar a conversa não pergunta: os buffers são por arquivo e seguem se outra
  conversa tiver a aba; se não tiver, a pergunta acontece ao fechar as abas
  (o `esquecer` passa pelo portão).

### D6. O disco mudou: reconciliação honesta, sem watcher

- **Sinais**: os mesmos da aba Alterações (E11), extraídos para uma função
  compartilhada em vez de copiados: ação que muda arquivo terminando, fim de
  turno, janela voltando ao foco. Mais um: a aba voltar à vista.
- A cada sinal, cada buffer montado pergunta `versao_no_disco`. Função pura
  `reconciliar({ sujo, versaoBase }, versaoNoDisco)` decide:
  - igual → nada;
  - diferente e **limpo** → recarrega. Cursor e rolagem ficam se a linha ainda
    existe; o histórico de desfazer **zera** (desfazer para um texto que não
    está mais no disco seria mentir);
  - diferente e **sujo** → faixa de conflito, e o buffer não é tocado;
  - `None` → faixa de sumiço.
- **Faixa de conflito** (dentro do editor, no topo, não toast): "Este arquivo
  mudou no disco depois que você começou a editar." com **"Usar a do disco"**
  (descarta o buffer) e **"Manter a minha"** (adota a versão do disco como
  base; o próximo ⌘S grava por cima, agora por decisão).
- O mesmo estado nasce quando o ⌘S volta `Conflito`: o ⌘S nunca atropela.
- **Faixa de sumiço**: "Este arquivo não está mais no disco. O que você
  escreveu ainda está aqui." com **"Copiar o texto"** e **"Fechar sem
  salvar"**. Recriar o arquivo fica fora (D3).
- Comparar as duas versões lado a lado fica fora do primeiro corte (seção 7).

### D7. Busca e substituição: painel nosso sobre a API do CM

O painel padrão do `@codemirror/search` não mostra contagem, não tem `Ctrl+H`
e desenha controles fora das escalas §3 e §13. Então:

- Componente `components/editor/BuscaNoArquivo.tsx`, ancorado no canto
  superior direito do editor, montado pela API de painel do CM e dirigido por
  `SearchQuery`, `setSearchQuery`, `findNext`, `findPrevious`, `replaceNext` e
  `replaceAll`.
- **Contagem nossa**: "3 de 12" pelo cursor da query, com teto de 1.000
  ("1.000+") para não travar arquivo grande. Sem casamento: "Nada".
- Alternâncias: maiúsculas (`Aa`), palavra inteira (`ab`), expressão regular
  (`.*`). Regex inválida deixa o campo em erro e a contagem diz "Expressão
  inválida", sem exceção.
- Teclas: ⌘F / Ctrl+F abre com a seleção como termo; ⌘⌥F / Ctrl+H abre com
  substituição; Enter e ⇧Enter navegam; ⌘G / F3 também; Esc fecha e devolve o
  foco ao texto. As de substituir ficam desligadas em arquivo só leitura.
- É a primeira barra de busca dentro de superfície. Nasce como primitiva
  reutilizável (o terminal dos Bastidores é o próximo candidato), não como
  detalhe do editor.

### D8. Teclado e seleção "estilo VS Code"

- **Multi-cursor**: ⌥+clique adiciona cursor (padrão do VS Code; o CM usa ⌘ no
  Mac e Ctrl no Linux, então configuramos `clickAddsSelectionRange`). ⇧⌥+arrastar
  faz seleção retangular. ⌘D / Ctrl+D pega a próxima ocorrência.
- ⌘Z / ⌘⇧Z vão para o histórico do CM. O menu Editar nativo (E13) é o risco
  aqui: o aceite prova que o ⌘Z pelo teclado **e** pelo menu desfaz no editor,
  não no WebView.
- Tab indenta; Esc seguido de Tab sai do editor (convenção de acessibilidade do
  CM, sem armadilha de foco).
- ⌘S / Ctrl+S salva o arquivo à vista quando o foco está no editor ou no
  cabeçalho dele. Não existe "salvar tudo".
- Os atalhos das abas (⌘1-9, ⌃Tab, ⌘⇧T) continuam valendo com o foco no
  editor; nenhum keymap do CM os consome.

### D9. Quando é só leitura, a tela diz por quê

Todo arquivo de texto passa a abrir no CM (busca, seleção e navegação para
todos). A diferença é só gravar:

| caso | motivo na tela |
|---|---|
| fora da raiz efetiva e dos `extra_dirs` (`~/.claude`, brain do agy, anexos) | "Fora das pastas do projeto" |
| acima de 2 MB | "Grande demais para editar aqui (3,4 MB)" |
| fins de linha misturados | "Fins de linha misturados" |

No cabeçalho, um selo `Só leitura` com o motivo no tooltip, e "Abrir no
editor" continua ao lado. Nada de editor que aceita digitação e falha no ⌘S.

### D10. Markdown: prévia por padrão, "Editar" como gesto

- `.md` e `.mdx` abrem na prévia de hoje.
- Um botão no cabeçalho (`Button size="compacto"`, ícone lucide), cujo rótulo
  é o destino: "Editar" na prévia, "Ver prévia" no editor. Sem controle
  segmentado novo (E12) e sem emoji.
- O modo é por arquivo, na memória da sessão. Com buffer sujo, a prévia
  renderiza o buffer, não o disco, e o ponto da aba segue aceso.

### D11. Onde o código mora

- `app/src-tauri/src/edicao.rs` (D2, D3), registrado em `lib.rs`.
- `app/src/lib/edicao/` (buffers, `reconciliar`, `estaSujo`, portão de
  fechar: puros e testáveis sem DOM).
- `app/src/store/edicao.ts` (D4).
- `app/src/components/editor/` (`CodeEditor`, `BuscaNoArquivo`,
  `FaixaDoArquivo`, tema).
- `ProjectFileViewer.tsx` (332 linhas) só troca `CodePreview` pelo editor
  preguiçoso e ganha o botão da D10; a lógica não entra nele.

## 5. Requisitos com aceite

### R1. Ler para editar (F1)
- *Aceite:* `abrir_para_edicao` devolve o conteúdo inteiro de um arquivo de
  1,5 MB; um de 3 MB volta `gravavel: false` com motivo; CRLF puro volta
  `crlf`; BOM volta `bom: true` e sai do conteúdo; misturado volta só leitura.
- *Double check:* `cargo test` em `app/src-tauri`, com fixtures reais do repo
  (um `.bat` CRLF, um arquivo com BOM).

### R2. Salvar versionado e atômico (F1)
- *Aceite:* salva e devolve a versão nova; com `versao_esperada` velha volta
  `Conflito` e o arquivo fica **byte a byte** igual; `../` e symlink para fora
  voltam `ForaDaPasta`; arquivo num `extra_dir` salva; caminho em `~/.claude`
  e nos anexos volta
  `ForaDaPasta`; arquivo `0755` continua `0755`; CRLF e BOM fazem ida e volta
  sem diferença; erro de escrita não deixa `.frota-*.tmp` no diretório;
  arquivo apagado volta `Sumiu`.
- *Double check:* `cargo test`; `git status` limpo depois da suíte.

### R3. Editor e tema (F2)
- *Aceite:* `.ts`, `.rs`, `.json`, `.py`, `.css` com cor; extensão
  desconhecida em texto puro; Geist Mono 12px (escala §3); cores iguais às do
  fio nos dois temas; 10 mil linhas rolam sem engasgo; o chunk do editor só
  carrega ao abrir o primeiro arquivo de texto.
- *Double check:* `vite build` com o tamanho do chunk registrado na ADR;
  abrir `app/src/lib/db/schema.ts` e `app/src-tauri/src/lib.rs` no app.

### R4. Busca e substituição (F2)
- *Aceite:* ⌘F abre com a seleção preenchida; mostra "3 de 12"; Enter e ⇧Enter
  navegam; `Aa`, palavra inteira e regex alternam e recontam; regex inválida
  diz "Expressão inválida" sem exceção; "Substituir todas" é **um** passo de
  desfazer; substituir não aparece em arquivo só leitura; Esc devolve o foco.
- *Double check:* vitest da contagem e do teto "1.000+" (função pura); no app,
  trocar `useChat` por `useChatX` em um arquivo e desfazer com um ⌘Z.

### R5. Editar e salvar (F3)
- *Aceite:* digitar acende o ponto na aba; desfazer até o original apaga;
  ⌘S grava, apaga o ponto e **não** mostra toast (o ponto é o retorno,
  STYLEGUIDE §12); falha mostra `avisar.erro("Não consegui salvar
  FileTab.tsx.")` com a causa no detalhe e a aba segue suja; a aba Alterações
  relê em até 1 s depois do salvamento.
- *Double check:* vitest de `estaSujo`; no app, `git diff` mostra só a linha
  mudada num arquivo CRLF.

### R6. Seleção e teclado (F3)
- *Aceite:* ⌥+clique cria cursores e a digitação vai para todos; ⇧⌥+arrastar
  seleciona coluna; ⌘D pega a próxima; ⌘Z pelo teclado e por Editar →
  Desfazer desfazem no CM; ⌘1-9 e ⌃Tab trocam de aba com o foco no editor;
  Esc+Tab sai do editor.
- *Double check:* no app, no Mac e no Linux (Ctrl no lugar de ⌘).

### R7. Fechar com alteração (F3)
- *Aceite:* ×, botão do meio, "Fechar outras", "Fechar todas", ⌘W pelo menu do
  Mac e Ctrl+W no Linux perguntam quando há aba suja; "Não salvar" fecha e
  descarta; "Cancelar" não fecha nada do lote; "Salvar" com conflito não fecha;
  o mesmo arquivo aberto em outra conversa fecha sem perguntar; sair do app
  e fechar a janela com buffer sujo perguntam.
- *Double check:* vitest do portão (função pura sobre abas + sujos); o teste
  do `confirm` cobre a terceira resposta.

### R8. Reconciliação (F4)
- *Aceite:* arquivo limpo mudado pelo agente recarrega sozinho ao fim da ação;
  arquivo sujo mudado mostra a faixa e o buffer fica intacto; ⌘S com o disco
  mudado mostra a mesma faixa e não grava; "Manter a minha" seguido de ⌘S
  grava; arquivo apagado mostra a faixa de sumiço e "Copiar o texto" copia o
  buffer.
- *Double check:* vitest de `reconciliar` nos quatro casos; no app, editar sem
  salvar, `echo x >> arquivo` no terminal, voltar o foco à janela.

### R9. Só leitura honesto (F2)
- *Aceite:* cada linha da tabela da D9 mostra o selo e o motivo; o editor não
  aceita digitação; busca funciona; "Abrir no editor" segue onde está hoje.

### R10. Markdown (F3)
- *Aceite:* `.md` abre na prévia; "Editar" abre o texto cru; editar e "Ver
  prévia" mostra o novo trecho renderizado com o ponto aceso; ⌘S funciona nos
  dois modos.
- *Double check:* no app, com `docs/decisions.md`.

## 6. O que a pessoa vê

Tudo no mock: `docs/mocks/edicao-de-arquivos.html`.

- **Aba suja**: o × vira ponto (mesma caixa de 16px; o ponto está centrado
  opticamente no glifo). No hover o × volta, para fechar continuar a um clique.
- **Cabeçalho**: caminho, selo `Só leitura` quando for o caso, "Editar"/"Ver
  prévia" no Markdown, e os botões de hoje.
- **Faixa do arquivo**: dentro do editor, abaixo do cabeçalho, para conflito e
  sumiço. Não é toast: é estado do arquivo, e fica até a decisão.
- **Busca**: painel no canto superior direito do texto, com as duas linhas
  (buscar, substituir) e a contagem.

## 7. Fora do escopo

- Criar, renomear e apagar arquivo pela Frota.
- Comparar buffer × disco lado a lado (a aba de diff pode servir depois).
- Salvar automático, salvar tudo, formatar ao salvar, LSP, autocompletar de
  código, lint inline.
- Avisar o agente de que a pessoa editou um arquivo que ele leu. Pode virar
  nota no fio depois; hoje o motor descobre sozinho, e o app não inventa.
- Editar pelo Companion do celular.

## 8. Descartado e por quê

1. **Monaco.** Exige Web Workers dedicados no Vite, carrega o editor inteiro
   do VS Code para um uso de ajuste pontual, e o próprio estudo do Xirp
   (`docs/competitors-xirp.md`) registra que ele vem junto de um app Electron
   de centenas de MB. O CM6 entrega busca, multi-cursor e histórico, modular e
   sob demanda.
2. **`textarea` ou `contenteditable` cru.** Sem realce em tempo real em
   arquivo médio, sem busca com regex, sem multi-cursor.
3. **Buffer no store das abas.** Persistiria o texto a cada tecla e amarraria
   o arquivo à conversa (D4).
4. **Watcher de arquivo.** O app já tem os sinais (E11) e o Rust evita
   FSEvents por motivo registrado.

## 9. Decidido depois da revisão

- **`extra_dirs` são graváveis desde o início** (26/09/2026). A proposta era só
  leitura no primeiro corte; a escolha foi o contrário, com a consequência
  escrita na D3.

## 10. Fatiamento

1. **F1, Rust sem tela**: `edicao.rs` com `abrir_para_edicao`,
   `versao_no_disco`, `salvar_arquivo` e a suíte do R1/R2. Abre a ADR.
2. **F2, editor só leitura**: CM no lugar do `CodePreview` para todo texto,
   tema, linguagens preguiçosas, busca (R3, R4, R9). Já entrega o ⌘F em
   qualquer arquivo **sem nenhum risco de escrita**, e mede o peso.
3. **F3, edição**: gravável, sujo, ⌘S, portão de fechar, sair do app,
   Markdown, teclado (R5, R6, R7, R10).
4. **F4, reconciliação**: sinais compartilhados com a aba Alterações, recarga,
   faixas (R8).

Cada fase fecha com `bun run check`, `bun run test`, `bunx tsc -b --force` e
`cargo test`.

## 11. Double check contra as leis

- **Agnosticismo**: nenhum passo olha nome de motor; os sinais da D6 vêm da
  classificação de ação que muda arquivo, a mesma da aba Alterações.
- **Estado real**: o ponto é diferença de fato, a recarga zera o desfazer em
  vez de fingir continuidade, e o conflito aparece em vez de ser resolvido
  por baixo.
- **Fail-closed no efeito**: sem versão, sem gravar; fora da pasta, sem
  gravar; truncado, sem gravar.
- **A decisão é humana**: nada salva sozinho, e sobrescrever o disco depois de
  um conflito exige "Manter a minha" e um ⌘S.
- **Guardas**: `sources.rs` não cresce; `ProjectFileViewer.tsx` só troca a
  peça; fonte 11/12/13, controles `chip`/`compacto`; confirmação pelo `confirm`
  estendido; nenhum Radix cru fora de `components/ui/`.
