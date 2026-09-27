# SPEC, edição de arquivos no visualizador

> Status: **implementada**, 26/09/2026 (ADR-269). O bloco de correção abaixo
> manda sobre o texto original.
> Produto: `docs/edicao-de-arquivos-prd.md` (decisões D1 a D11, requisitos R1 a
> R10). Mock: `docs/mocks/edicao-de-arquivos.html`.
> Relacionados: ADR-164 (saída única), ADR-232 (teto do Rust), ADR-243/244
> (abas), `useAlteracoesVivas` (sinais de disco).
> ADR: uma, aberta na F1. O número sai na hora (duas frentes já colidiram);
> **confira o máximo real** em
> `docs/decisions.md` antes de numerar (`check-adr-unico.mjs` cobra).

## 0. Correções da implementação (26/09/2026)

1. **Sem `lineSeparator`.** O CodeMirror guarda `\n` por dentro (o padrão), e o
   salvar devolve CRLF com `doc.sliceString(0, fim, "\r\n")`
   (`textoParaODisco`). Com a facet, colar texto LF num arquivo CRLF deixava
   `\n` solto dentro da linha, e o Rust recusava por fins inconsistentes.
2. **Só leitura é `EditorState.readOnly`, sem `EditorView.editable.of(false)`.**
   Sem `contenteditable` o texto não recebe foco, e o ⌘F e as setas morriam
   nos arquivos só leitura. Trava de fonte em `editor.fonte.test.ts`.
3. **`fecharArquivos` continua síncrono quando não há o que perguntar.** Os
   testes de `abasNoPrincipal.test.ts` conferem o estado na linha seguinte, e
   não se afrouxa teste existente. O portão virou `planoDoPortao` (síncrono) +
   `resolverPerguntas` (assíncrono, `null` quando cancela, e aí nada do lote
   fecha) + `soltarAsFechadas`.
4. **Onde o código mora**: as funções puras da §7.4 estão juntas em
   `lib/edicao/regras.ts`; os gestos (salvar, manter, descartar, soltar
   conversa) em `lib/edicao/acoes.ts`; o portão em `lib/edicao/portao.ts`. O
   painel de busca se dividiu em `estadoDaBusca.ts`, `painelDeBusca.tsx` e
   `BuscaNoArquivo.tsx` (fast refresh exige arquivo só de componente).
   `components/layout/raizEfetiva.ts` é a regra "worktree ou projeto", agora
   usada pelo `FileTab`, pela tira e pelo portão.
5. **Donos são `Map<conversa, chave>`**, para o portão saber se a OUTRA
   conversa ainda tem aquela aba aberta pela chave dela.
6. **O mesmo arquivo com editor já montado noutra superfície** mostra o
   estático: dois editores do mesmo buffer divergiriam.
7. **Selo de só leitura** é um chip (`controle("chip")`) com `Tooltip`, não
   `Badge` (que é pílula de 12px). O ⌘S com foco no cabeçalho do arquivo
   **não** foi feito: o ⌘S vale no texto e no painel de busca.
8. **Seleção, achados e alternâncias são neutros** (tons de `--foreground`,
   `sel`). O mock usava âmbar; foi corrigido (seleção não é cor, ADR-043).
9. **Medido** (`vite build`): nada do CodeMirror no `main`; editor + núcleo
   ~114 KB gzip; com as sete linguagens ~243 KB.

O PRD decide o que a pessoa ganha e por quê. Esta SPEC decide tipos,
fronteiras, estados, algoritmos, testes e gates. Código ou ADR posterior podem
corrigir o contrato, desde que escrevam a divergência num bloco de correção no
topo deste arquivo.

## 1. Resultado técnico

1. Um módulo Rust novo, `edicao.rs`, com três comandos assíncronos:
   `abrir_para_edicao`, `versao_no_disco` e `salvar_arquivo`. A escrita é
   atômica, versionada por blake3 e limitada às pastas graváveis do projeto.
2. No front, o texto vive em `EditorState` do CodeMirror 6, num registro de
   módulo por caminho absoluto. Um store pequeno diz quem está sujo e quem
   está em conflito.
3. O visualizador troca o `CodePreview` pelo editor, carregado sob demanda. O
   `CodePreview` continua existindo como o que se vê enquanto o chunk carrega.
4. Fechar aba, apagar conversa e sair do app passam por portões que já
   existem (`fecharArquivos`, o `confirm` de exclusão, o inventário de saída da
   ADR-164). Nenhum caminho novo de saída.
5. A reconciliação com o disco reaproveita os sinais da aba Alterações,
   extraídos para um módulo compartilhado. Sem watcher.

## 2. Invariantes

1. **Nenhuma gravação sem versão.** `salvar_arquivo` sempre recebe a versão
   que o front leu, e grava só se o disco ainda é essa versão.
2. **Nenhum byte que a pessoa não mudou muda.** Fim de linha, BOM e permissões
   voltam como estavam. Salvar sem editar produz um arquivo idêntico byte a
   byte.
3. **Nenhum texto truncado é gravável.** O que passa de 2 MB abre só leitura.
4. **Escrita só em pasta gravável**: raiz efetiva da conversa e `extra_dirs`
   do projeto. A lista de escrita é **separada** da de leitura; nada entra
   nela por herança.
5. **Recarregar nunca apaga o que a pessoa escreveu.** Buffer sujo não é
   substituído sem o gesto "Usar a do disco".
6. **Sujo é fato**: sujo ⇔ o documento atual difere do documento base. Não é
   "foi tocado".
7. **O app não salva sozinho**, em nenhuma circunstância (troca de aba, perda
   de foco, saída, conflito).
8. **Uma identidade por arquivo**: a chave é o caminho absoluto canônico
   devolvido pelo Rust, nunca `conversa + relativo`.
9. **Buffer não persiste.** Nada do texto editado vai para localStorage,
   SQLite ou disco fora do arquivo alvo.
10. Nenhum código genérico compara nome de motor. Os sinais de mudança vêm de
    `classificarAcao(...).muda`, como na aba Alterações.
11. Render desconhecido degrada: se o chunk do editor falhar ao carregar, a
    tela mostra o `CodePreview` só leitura e um `avisar.erro`, nunca um
    buraco.

## 3. Não regressões

- `read_text_file` e seus três consumidores (`ProjectFileViewer.tsx:176`,
  `MarkdownViewerDialog.tsx:50`, `contextoDoProjetoPecas.tsx:185`) não mudam
  de contrato.
- `ProjectFileViewer.test.ts` continua passando **sem edição**. Ele exige
  `highlightCode(content, language)` no fonte: o `CodePreview` fica como
  fallback do `Suspense` (§7.9), então a exigência continua verdadeira.
- `useAlteracoesVivas.test.ts` continua passando sem edição, e
  `assinaturaDasMudancas` segue exportada do mesmo arquivo.
- O shape persistido de `frota.abasDaConversa` (versão 1) não muda.
- `scoped_file_path` não muda de comportamento. `sources.rs` não ganha linhas
  (baseline 1176, acima do teto de 1000).
- `lib.rs` está **exatamente** no congelado (1276/1276). Registrar comando
  exige tirar linhas antes (§6.7). A baseline não sobe.
- Imagem, vídeo, áudio, PDF, SVG e "sem prévia" seguem pelos caminhos de hoje.

## 4. Autoridade e fluxo

```text
            disco
              │  abrir_para_edicao / versao_no_disco / salvar_arquivo
              ▼
  ┌──────────────────────┐        ┌───────────────────────────┐
  │ edicao.rs (Rust)     │        │ sinaisDoDisco.ts          │
  │ escopo · versão ·    │        │ ação que muda arquivo,    │
  │ atomicidade          │        │ fim de turno, foco,       │
  └──────────┬───────────┘        │ gravação feita aqui       │
             │ ArquivoEditavel    └─────────────┬─────────────┘
             ▼                                  │ aoMudar(cwd)
  ┌──────────────────────┐   reconciliar()      │
  │ buffers.ts (Map)     │◄─────────────────────┘
  │ EditorState, base,   │
  │ versão, donos        │──► useEdicao (sujos, avisos, modo)
  └──────────┬───────────┘          │
             │                      ├──► AbasDeArquivo (ponto)
             ▼                      ├──► traySnapshot (arquivosSujos)
       CodeEditor (view)            └──► portões de fechar e apagar
```

Precedência: **o que a pessoa escreveu > o disco > o cache**. O disco só vence
o buffer por gesto.

## 5. Vocabulário de código

| produto | código |
|---|---|
| arquivo aberto para edição | `ArquivoEditavel` (Rust e TS) |
| versão | `versao` (hex blake3 de 64 caracteres dos bytes crus) |
| texto em edição | `Buffer` em `lib/edicao/buffers.ts` |
| alterações não salvas | `sujo` |
| o disco discordou | `aviso: "conflito"` |
| o arquivo sumiu | `aviso: "sumiu"` |
| pasta onde se pode gravar | `pastas_gravaveis` |
| a pergunta ao fechar | `pedirParaFechar` |

## 6. Backend: `app/src-tauri/src/edicao.rs`

Módulo novo, abaixo de 1000 linhas com os testes dentro (ADR-232). Se os
testes empurrarem para perto do teto, eles vão para `edicao_tests.rs`, como
`work_mcp_setup_tests.rs`.

### 6.1 Tipos

```rust
pub(crate) const LIMITE_EDITAVEL: u64 = 2 * 1024 * 1024;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum FimDeLinha { Lf, Crlf }

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArquivoEditavel {
    pub conteudo: String,          // sem BOM
    pub versao: String,            // blake3 dos bytes crus, BOM incluído
    pub fim_de_linha: FimDeLinha,  // Lf quando o arquivo não tem quebra
    pub bom: bool,
    pub gravavel: bool,
    pub motivo: Option<String>,    // Some ⇔ !gravavel
    pub caminho_absoluto: String,  // canônico; é a identidade no front
}

#[derive(Debug, PartialEq, Serialize)]
#[serde(tag = "tipo", rename_all = "kebab-case")]
pub enum ErroAoSalvar {
    Conflito { versao: String },   // a versão que está no disco agora
    Sumiu,
    ForaDasPastas,
    SoLeitura { motivo: String },
    Falhou { detalhe: String },
}
```

O erro serializado segue o precedente de `UsageFetchError` (objeto com
discriminante; o front degrada forma desconhecida para `falhou`, §7.1).

### 6.2 Pastas graváveis

```rust
fn pastas_gravaveis(root: &str) -> Vec<PathBuf> {
    // canonicalize(root) + canonicalize de cada crate::frota_dir::resolve_extra_dirs(root)
    // Entradas que não canonicalizam são descartadas, sem erro.
}
fn gravavel(canon: &Path, root: &str) -> bool {
    pastas_gravaveis(root).iter().any(|p| canon.starts_with(p))
}
```

- Chama `resolve_extra_dirs` com a mesma `root` que `scoped_file_path` recebe
  (a raiz efetiva: worktree ou projeto), então leitura e escrita concordam
  sobre o que é `extra_dir`.
- `~/.claude`, o brain do agy e os anexos não entram por serem autorizados
  para leitura. Se um deles estiver **dentro** de um `extra_dir`, fica
  gravável: a regra é de prefixo, e a pessoa vinculou a pasta-mãe. A ADR
  registra isso junto com a consequência do `~/projetos` (PRD, D3).

### 6.3 `abrir_para_edicao(app, root, path) -> Result<ArquivoEditavel, String>`

`async`, corpo em `tauri::async_runtime::spawn_blocking` (comando síncrono do
Tauri 2 roda na thread principal; o padrão é o de `read_project_sources`).

1. `canon = sources::scoped_file_path(root, path, anexos)?`. Mesma porta da
   leitura; o erro é o mesmo texto de hoje, o que mantém `arquivoSumiu(...)`
   funcionando no front.
2. `tamanho = metadata(canon).len()`. Se `> LIMITE_EDITAVEL`: devolve
   `gravavel: false`, `motivo: "Grande demais para editar aqui (3,4 MB)"`,
   conteúdo de `sources::read_text_file_scoped` (a função passa de privada a
   `pub(crate)`: uma palavra, zero linhas), `versao` do arquivo inteiro lido
   em blocos por um `blake3::Hasher`, `fim_de_linha: Lf`, `bom: false`.
3. Senão, lê todos os bytes. `versao = blake3::hash(&bytes).to_hex()`.
4. `bom = bytes.starts_with(&[0xEF, 0xBB, 0xBF])`; o corpo é o resto.
5. UTF-8 inválido → `Err("O arquivo não é texto UTF-8 válido: …")`, o mesmo
   texto de `read_text_file_scoped`.
6. Fins de linha, numa passada: `crlf` = ocorrências de `\r\n`; `lf` = `\n` não
   precedido de `\r`; `cr` = `\r` não seguido de `\n`.
   - `cr > 0`, ou `crlf > 0 && lf > 0` → `gravavel: false`, motivo "Fins de
     linha misturados".
   - `crlf > 0` → `Crlf`. Senão → `Lf`.
7. `gravavel(canon, root)` falso → `gravavel: false`, motivo "Fora das pastas
   do projeto".
8. Permissão de escrita no arquivo (`metadata.permissions().readonly()`) →
   `gravavel: false`, motivo "O arquivo está protegido contra escrita".

A ordem dos motivos, quando vários valem: tamanho, fora das pastas, protegido,
fins de linha. Só o primeiro é mostrado.

### 6.4 `versao_no_disco(app, root, path) -> Result<Option<String>, String>`

`async` + `spawn_blocking`. `None` quando `scoped_file_path` falha por
inexistência (a mesma classificação de `arquivoSumiu`); qualquer outro erro
volta `Err`. Hash por stream, sem carregar o arquivo inteiro.

### 6.5 `salvar_arquivo(app, root, path, conteudo, versao_esperada, fim_de_linha, bom) -> Result<String, ErroAoSalvar>`

`async` + `spawn_blocking`. Devolve a versão nova.

1. `canon = scoped_file_path(...)`. Falha por inexistência → `Sumiu`; outra
   falha de escopo → `ForaDasPastas`.
2. `!gravavel(canon, root)` → `ForaDasPastas`.
3. `conteudo` com `\r` quando `fim_de_linha == Lf`, ou com `\n` solto quando
   `Crlf`, → `Falhou { detalhe: "fins de linha inconsistentes" }`. É bug do
   front, e o Rust não "conserta".
4. Bytes finais: `[EF BB BF]` se `bom`, mais `conteudo.as_bytes()`.
5. Acima de `LIMITE_EDITAVEL` → `SoLeitura { motivo }`.
6. Temporário: `dir(canon)/.{nome}.frota-{16 hex aleatórios}.tmp`, aberto com
   `create_new(true)`. O aleatório vem do `rand` que já está no `Cargo.toml`
   (o mesmo dos tokens do Companion); sem crate nova.
7. `write_all`, depois `set_permissions(tmp, metadata(canon).permissions())`,
   depois `sync_all`.
8. **Checagem de versão**: `blake3(ler(canon)) != versao_esperada` →
   apaga o temporário, `Conflito { versao: a_do_disco }`.
9. `rename(tmp, canon)`. No Unix, `File::open(dir)?.sync_all()` em seguida
   (durabilidade do diretório); falha aqui só registra `log::warn!`.
10. Qualquer erro dos passos 6 a 9 apaga o temporário antes de voltar
    `Falhou { detalhe }`. Guarda RAII (`struct Temporario(PathBuf)` com `Drop`
    que remove se não foi "consumido") para não depender de cada `?`.
11. Devolve `blake3(bytes_finais)`.

A janela entre o passo 8 e o 9 existe e é de microssegundos. A ADR diz isso,
sem prometer trava. Não há `flock`: o agente não respeitaria, e seria teatro.

Symlink: `canon` já é o alvo resolvido, então o link continua link e o alvo é
reescrito. Se o alvo está fora das pastas graváveis, o passo 2 barra.

Dono e grupo do arquivo não são preservados (o `rename` cria inode novo com o
dono do processo). Num Mac de usuário único isso é o mesmo dono; a ADR
registra.

### 6.6 Nada de novo em `sources.rs`

A única mudança é a visibilidade de `read_text_file_scoped` (`fn` →
`pub(crate) fn`), sem linha a mais.

### 6.7 Registro em `lib.rs`

Custa 4 linhas (`mod edicao;` e três entradas no `generate_handler!`). Como o
arquivo está no congelado, **a F1 começa extraindo um bloco coeso de
`lib.rs`** para módulo próprio, no precedente do commit 14922d5
(`subcomandos.rs`). Candidato: o fecho de `.on_window_event` (linhas ~789 a
835) para `janela_eventos.rs`. A baseline de `lib.rs` **desce** para o novo
tamanho no mesmo commit, como a catraca exige.

### 6.8 Saída do app (ADR-164)

- `TraySnapshot` (Rust e TS) ganha `#[serde(default)] pub arquivos_sujos: u32`
  / `arquivosSujos: number`.
- `QuitInventory` ganha `unsaved_files: usize`, lido do snapshot.
- `needs_confirmation()` passa a ser verdadeiro também quando
  `unsaved_files > 0`. `interrupts_work()` **não** muda.
- `message()` acrescenta "1 arquivo com alterações não salvas será
  descartado." / "{n} arquivos com alterações não salvas serão descartados.",
  via `push_count`.
- `action_label()`: quando só há arquivo sujo (nada que `interrupts_work`),
  "Descartar e sair"; os outros casos seguem.
- Fechar a janela com bandeja ligada só esconde (`lib.rs:805`): os buffers
  sobrevivem e não há pergunta. Sem bandeja, o fechar vira `request_quit` e cai
  no inventário acima.

## 7. Frontend

Árvore nova:

```text
app/src/lib/edicao/
  api.ts            invoke + parseErroAoSalvar
  buffers.ts        registro de módulo (Map)
  sujo.ts           estaSujo
  reconciliar.ts    reconciliar
  fechar.ts         planoDeFechamento
  contagem.ts       contarAchados
  linguagens.ts     carregarLinguagem
  *.test.ts
app/src/lib/sinaisDoDisco.ts (+ .test.ts)
app/src/store/edicao.ts
app/src/components/editor/
  CodeEditor.tsx  BuscaNoArquivo.tsx  FaixaDoArquivo.tsx  temaDoEditor.ts
```

### 7.1 `lib/edicao/api.ts`

```ts
export type FimDeLinha = "lf" | "crlf"
export interface ArquivoEditavel {
  conteudo: string; versao: string; fimDeLinha: FimDeLinha; bom: boolean
  gravavel: boolean; motivo: string | null; caminhoAbsoluto: string
}
export type ErroAoSalvar =
  | { tipo: "conflito"; versao: string }
  | { tipo: "sumiu" } | { tipo: "fora-das-pastas" }
  | { tipo: "so-leitura"; motivo: string }
  | { tipo: "falhou"; detalhe: string }

export function abrirParaEdicao(root: string, path: string): Promise<ArquivoEditavel>
export function versaoNoDisco(root: string, path: string): Promise<string | null>
export function salvarArquivo(a: {
  root: string; path: string; conteudo: string; versaoEsperada: string
  fimDeLinha: FimDeLinha; bom: boolean
}): Promise<{ ok: true; versao: string } | { ok: false; erro: ErroAoSalvar }>

/** Forma desconhecida vira `falhou` com a mensagem crua (fail-open). */
export function parseErroAoSalvar(e: unknown): ErroAoSalvar
```

`salvarArquivo` nunca lança: o `catch` converte em `{ ok: false }`, e quem
chama decide a tela (sem `catch` silencioso).

### 7.2 `lib/edicao/buffers.ts`

```ts
export interface Buffer {
  caminho: string            // absoluto canônico (identidade)
  root: string; relativo: string
  estado: EditorState        // o texto, a seleção, o histórico
  base: Text                 // o documento da última leitura/gravação
  versao: string
  fimDeLinha: FimDeLinha; bom: boolean
  gravavel: boolean; motivo: string | null
  versaoDoConflito: string | null  // a versão do disco quando o aviso é "conflito"
  donos: Set<string>         // conversas que montaram este arquivo nesta sessão
}
export function obter(caminho: string): Buffer | undefined
/** A aba conhece `root` e a chave; só o Rust conhece o caminho canônico
 *  (symlink, `~/`). O índice nasce quando `abrirParaEdicao` responde. */
export function caminhoDaAba(root: string, chave: string): string | undefined
export function registrar(b: Buffer): void
export function guardarEstado(caminho: string, estado: EditorState): void
export function rebasear(caminho: string, base: Text, versao: string): void
export function descartar(caminho: string): void
export function adicionarDono(caminho: string, convId: string): void
export function soltarDono(caminho: string, convId: string): void
```

- Módulo, não store: `EditorState` é grande e imutável, e não pode causar
  render nem ir para `persist`.
- `registrar` também grava o índice `root\0chave → caminho` usado por
  `caminhoDaAba`. Aba que nunca montou editor não tem entrada, e isso está
  certo: sem buffer, não há o que estar sujo.
- `base` é `Text` do CM, para o `estaSujo` comparar com `doc.eq(base)` (checa
  tamanho e compara por pedaço; não aloca `toString` de 2 MB por tecla).
- `__resetParaTeste()` exportado, no padrão de reset de módulo do
  `watchdog.test.ts`.

### 7.3 `store/edicao.ts`

```ts
interface EdicaoState {
  sujos: Record<string, true>
  avisos: Record<string, "conflito" | "sumiu">
  /** Markdown: "previa" | "editor", por caminho. Memória da sessão. */
  modo: Record<string, "previa" | "editor">
  salvando: Record<string, true>
  marcarSujo(caminho: string, sujo: boolean): void
  marcarAviso(caminho: string, aviso: "conflito" | "sumiu" | null): void
  setModo(caminho: string, modo: "previa" | "editor"): void
  marcarSalvando(caminho: string, v: boolean): void
  esquecer(caminho: string): void
}
```

`create<EdicaoState>((set, get) => ...)`, sem `persist`. Toda ação é no-op se o
valor não muda (a regra do `trocar` de `abasDeArquivo.ts`). Não precisa
hidratar no boot: começa vazio por definição (invariante 9).

### 7.4 Funções puras

```ts
// sujo.ts
export function estaSujo(doc: Text, base: Text): boolean      // !doc.eq(base)

// reconciliar.ts
export type Reconciliacao = "nada" | "recarregar" | "conflito" | "sumiu"
export function reconciliar(
  b: { sujo: boolean; versao: string; aviso: "conflito" | "sumiu" | null },
  noDisco: string | null,
): Reconciliacao
// null → "sumiu" · igual → "nada" · diferente e limpo → "recarregar"
// diferente e sujo → "conflito" · já em conflito com a mesma versão → "nada"

// fechar.ts
export interface PlanoDeFechamento {
  fechaDireto: string[]                    // chaves de aba
  perguntar: { chave: string; caminho: string; nome: string }[]
}
export function planoDeFechamento(a: {
  chaves: readonly string[]; convId: string
  caminhoDe: (chave: string) => string | null   // caminhoDaAba; null para diff ou sem buffer
  sujos: Record<string, true>
  donos: (caminho: string) => ReadonlySet<string>
  abertaEm: (convId: string, chave: string) => boolean
}): PlanoDeFechamento
// pergunta só se: é arquivo, está sujo, e nenhuma OUTRA conversa dona ainda o tem aberto

// contagem.ts
export function contarAchados(
  achados: Iterable<{ from: number; to: number }>, cabecaDaSelecao: number, teto = 1000,
): { atual: number; total: number; passou: boolean }
// rótulo: "Nada" · "3 de 12" · "3 de 1.000+"
```

### 7.5 `CodeEditor.tsx`

Carregado por `React.lazy(() => import("@/components/editor/CodeEditor"))`.

Props: `{ root, relativo, convId }`. Ciclo:

1. Monta: se `obter(caminho)` existe, usa o `estado` guardado; senão chama
   `abrirParaEdicao`, cria o `EditorState` e `registrar`. `adicionarDono`.
2. Cria `EditorView({ state, parent })`.
3. Desmonta: `guardarEstado(caminho, view.state)` e `view.destroy()`. O dono
   **não** sai aqui: trocar de aba não é fechar (§8).

Extensões, nesta ordem:

```ts
[
  lineNumbers(), highlightActiveLineGutter(), highlightActiveLine(),
  drawSelection(), EditorState.allowMultipleSelections.of(true),
  history(), indentOnInput(), bracketMatching(), closeBrackets(),
  highlightSelectionMatches(),
  rectangularSelection({ eventFilter: (e) => e.altKey && e.shiftKey }),
  EditorView.clickAddsSelectionRange.of((e) => e.altKey),
  search({ top: true, createPanel: criarPainelDeBusca }),
  keymap.of([...atalhosDaFrota, ...closeBracketsKeymap, ...defaultKeymap,
             ...searchKeymap, ...historyKeymap, indentWithTab]),
  EditorView.domEventHandlers({ beforeinput: desfazerPeloMenu }),
  EditorView.updateListener.of(aoMudar),
  compartimentos.linguagem.of([]),
  compartimentos.somenteLeitura.of(leitura(gravavel)),
  compartimentos.fimDeLinha.of(fimDeLinha === "crlf"
    ? EditorState.lineSeparator.of("\r\n") : []),
  temaDoEditor,
]
```

- `leitura(false)` = `[EditorState.readOnly.of(true), EditorView.editable.of(false)]`.
  Só leitura continua com busca e seleção; o `searchKeymap` de substituir é
  inerte porque o documento é readOnly, e o painel esconde a linha (§7.8).
- `aoMudar(u)`: se `u.docChanged`, `marcarSujo(caminho, estaSujo(u.state.doc,
  base))`. Nada de trabalho por tecla além disso.
- `desfazerPeloMenu(e)`: `inputType === "historyUndo"` → `undo(view)`,
  `"historyRedo"` → `redo(view)`, `preventDefault`, `true`. Cobre o Desfazer do
  menu Editar nativo (E13 do PRD), que chega como `beforeinput` e não como
  tecla.
- O contêiner leva `data-selectable` e `select-text`, como o `CodePreview`.

### 7.6 Tema (`temaDoEditor.ts`)

- `EditorView.theme` com **variáveis CSS** (`var(--background)`,
  `var(--foreground)`, `var(--border)` e as `--hljs-*`), sem hex. Um tema só
  serve claro e escuro, porque `.dark` troca as variáveis (`index.css:869-882`).
- `HighlightStyle.define` com `tags` de `@lezer/highlight`:
  `keyword`/`tagName` → `--hljs-keyword`; `string`/`attributeName` →
  `--hljs-string`; `number`/`bool` → `--hljs-number`; `function(...)`,
  `typeName`, `heading` → `--hljs-title`; `variableName` definida →
  `--hljs-variable`; `comment` → `--muted-foreground` itálico. Espelha o mapa
  das classes `.hljs-*`.
- Fonte: `font-mono`, 12px, `line-height: 1.55`, os mesmos do `CodePreview`.
  Gutter com `bg-card` e divisor `border-border/40` (STYLEGUIDE §4).
- Seleção e casamentos de busca usam tokens de seleção existentes; a F2
  confere em `docs/STYLEGUIDE.md` §2 qual token é o de destaque e não inventa
  cor.

### 7.7 Linguagens (`linguagens.ts`)

```ts
export function carregarLinguagem(caminho: string): Promise<Extension | null>
```

Parte de `detectLanguage` (`lib/syntaxHighlight.ts:51`), para existir um mapa
de extensão só:

| `detectLanguage` | pacote |
|---|---|
| `typescript`, `javascript` (e tsx/jsx pela extensão) | `@codemirror/lang-javascript` com `{ typescript, jsx }` |
| `json` | `@codemirror/lang-json` |
| `markdown` | `@codemirror/lang-markdown` |
| `rust` | `@codemirror/lang-rust` |
| `python` | `@codemirror/lang-python` |
| `css` | `@codemirror/lang-css` |
| `html`, `xml` | `@codemirror/lang-html` |
| qualquer outro, ou `null` | `null` (texto puro) |

Cada pacote por `import()` próprio. A extensão entra por
`compartimentos.linguagem.reconfigure(...)` depois de montar: o texto aparece
antes da cor. Falha no `import()` loga e segue sem cor.

### 7.8 `BuscaNoArquivo.tsx`

- `createPanel(view)` devolve `{ dom, top: true, mount, update, destroy }`; o
  `dom` recebe um `createRoot` do React. O painel é absoluto no canto superior
  direito do editor (mock, seção 1), não a faixa inteira do CM.
- Estado de verdade é o `SearchQuery` do CM (`getSearchQuery`,
  `setSearchQuery`). O React só espelha; `update(u)` relê quando
  `u.transactions` trazem efeito de busca ou o documento muda.
- Contagem: itera `query.getCursor(state)` até `teto + 1` e chama
  `contarAchados`. Só roda com `query.valid`; inválida mostra "Expressão
  inválida" e borda de erro. Recalcula no máximo a cada `requestAnimationFrame`.
- Controles: campo com `controle("compacto")`; alternâncias `Aa`, `ab`, `.*`
  e setas com `controle("chip")`; "Substituir" e "Todas" com `Button
  size="chip"`. Fontes 11 (contagem, rótulos) e 12 (campos, mono).
- Linha de substituir só existe com `gravavel`. `replaceAll` é uma transação
  só, e o histórico do CM a desfaz num passo.
- Esc fecha (`closeSearchPanel`) e devolve o foco a `view.focus()`.

### 7.9 Integração no `ProjectFileViewer.tsx`

O efeito de leitura atual continua, para todos os tipos. Muda só o ramo de
texto:

```tsx
state.status === "text" && kind !== "markdown"
  ? <Suspense fallback={<CodePreview path={path} content={state.content} />}>
      <CodeEditor root={root} relativo={path} convId={convId} />
    </Suspense>
```

- O `read_text_file` continua abastecendo o fallback e o Markdown. O editor
  faz a própria `abrirParaEdicao`. Custa uma leitura a mais no primeiro
  abrir; em troca, o fallback aparece na hora e nenhum contrato de leitura
  muda.
- `convId` chega do `FileTab` (ele já tem).
- Markdown: `modo[caminho] === "editor"` monta o `CodeEditor`; senão, a
  `<Markdown>` com o texto do **buffer**, quando ele existe, e com
  `state.content` quando não.
- Botão no cabeçalho, só para `kind === "markdown"`: `<Button size="compacto"
  variant="ghost">` com `Pencil` + "Editar" ou `Eye` + "Ver prévia".
- Selo de só leitura: `<Badge>` com `Lock` e "Só leitura", e o `motivo` em
  `Tooltip` (`components/ui/tooltip`).
- `FaixaDoArquivo` entre o cabeçalho e o editor quando `avisos[caminho]`
  existe.
- A lógica fica em `components/editor/`. O `ProjectFileViewer.tsx` (332 linhas)
  ganha só o ramo, o botão, o selo e a faixa.

### 7.10 Ponto na aba (`AbasDeArquivo.tsx`)

- A tira resolve o caminho de cada chave de arquivo por `caminhoDaAba(root,
  chave)` e lê `useEdicao((s) => s.sujos[caminho])`. Sem entrada no índice, a
  aba está limpa.
- Suja: o `<X>` dá lugar a um ponto de 7px na **mesma caixa** do botão (o nome
  não se move). Em `group-hover/aba` o `X` volta. Comentário no código dizendo
  que os 7px são ajuste óptico (STYLEGUIDE §14).
- `aria-label` do botão passa a "Fechar {nome} (alterações não salvas)".

### 7.11 `FaixaDoArquivo.tsx`

| aviso | texto | ações |
|---|---|---|
| `conflito` | "Este arquivo mudou no disco depois que você começou a editar." | "Usar a do disco" (ghost) · "Manter a minha" |
| `sumiu` | "Este arquivo não está mais no disco. O que você escreveu ainda está aqui." | "Fechar sem salvar" (ghost) · "Copiar o texto" |

Botões `size="compacto"`. Superfície: faixa interna com divisor
`border-border/40`, sem sombra (STYLEGUIDE §4). Efeitos em §8.

### 7.12 Teclado

`atalhosDaFrota` (keymap do CM, antes dos padrões):

| tecla | efeito |
|---|---|
| `Mod-s` | `salvar(caminho)` (§8) |
| `Mod-Alt-f`, e `Ctrl-h` fora do Mac | abre a busca com a linha de substituir |

- Fora do CM, com o foco no cabeçalho do arquivo, o `Mod-s` também salva: um
  `onKeyDown` no contêiner do visualizador chama a mesma função.
- Nenhum keymap do CM usa `Mod-1..9`, `Ctrl-Tab` ou `Mod-Shift-t`; o
  `aoTeclar` de `abasNoPrincipal.ts` recebe essas teclas como hoje. Teste de
  fonte trava isso (§12.3).

## 8. Máquina de estados do buffer

```text
            abrir                 digitar (≠ base)
 (nenhum) ───────► LIMPO ─────────────────────────► SUJO
                    ▲  ▲◄──── desfazer até a base ───┘ │
                    │  │                               │ ⌘S
     recarregar ────┘  │ ok                            ▼
     (disco mudou,     └──────────────────────── SALVANDO
      estava limpo)                                    │ Conflito
                                                       ▼
           "Usar a do disco" ◄──────────────────── CONFLITO ◄── sinal de disco
           → LIMPO com o disco                          │        com SUJO
                                                        │ "Manter a minha"
                                                        ▼
                                                  SUJO com base = disco
 qualquer estado ── versao_no_disco = null ──► SUMIU
```

Efeitos:

- **salvar(caminho)**: se `salvando` ou não `gravavel`, nada. `marcarSalvando`.
  Chama `salvarArquivo` com `estado.doc.toString()` (o CM já junta com o
  separador do arquivo), `versaoEsperada = buffer.versao`, `fimDeLinha`, `bom`.
  - ok → `rebasear(caminho, doc, versaoNova)`, `marcarSujo(false)`,
    `sinaisDoDisco.avisarGravacao(root)`.
  - `conflito` → `marcarAviso("conflito")`; a versão do erro fica guardada no
    buffer como `versaoDoConflito`.
  - `sumiu` → `marcarAviso("sumiu")`.
  - `fora-das-pastas`, `so-leitura`, `falhou` → `avisar.erro("Não consegui
    salvar {nome}.", { detalhe })`; o buffer segue sujo.
  - Sem toast em caso de sucesso (STYLEGUIDE §12: o ponto apagar é o retorno).
- **recarregar**: `abrirParaEdicao`; novo `EditorState` com o texto novo e a
  seleção principal limitada ao novo tamanho, **sem histórico** (desfazer não
  volta para um texto que não está mais no disco); `rebasear`; a view recebe
  `setState` se estiver montada.
- **"Usar a do disco"**: igual a recarregar; limpa o aviso.
- **"Manter a minha"**: `buffer.versao = versaoDoConflito` (a do disco);
  `base` **não** muda, então o ponto segue aceso; limpa o aviso. O próximo ⌘S
  grava por cima, por decisão.
- **"Copiar o texto"**: `copyText(doc.toString())` e
  `avisar.feito("Texto de {nome} copiado.")` (o lugar não some, mas o gesto é
  invisível sem ele, como o "Copiar caminho" de hoje).
- **"Fechar sem salvar"**: `descartar`, `esquecer`, fecha a aba sem perguntar.

## 9. Portões

### 9.1 Fechar aba

`fecharArquivos(chaves)` em `abasNoPrincipal.ts` vira `async` e começa por:

```ts
const plano = planoDeFechamento({ ... })
if (plano.perguntar.length > 0) {
  const r = await confirm({ ..., alternativa: "Não salvar" })
  if (r === "cancelar") return
  if (r === "confirmar") {
    const falhas = await salvarTodos(plano.perguntar)  // sequencial
    // quem falhou não fecha; a faixa ou o avisar.erro explicam
  }
  if (r === "alternativa") plano.perguntar.forEach((p) => descartar(p.caminho))
}
// segue o corpo atual com as chaves que podem fechar
```

- Todo chamador de `fecharArquivos` (×, botão do meio, menu de contexto,
  "Fechar outras/à direita/todas", `fecharAVista` do ⌘W e do
  `frota://fechar-aba`, `aoFecharSumido`) passa a usar `void` na chamada; a
  assinatura pública continua aceitando a mesma lista.
- Depois de fechar, `soltarDono(caminho, convId)` para cada arquivo; buffer
  sem dono e limpo é descartado.
- Copy: uma aba → título "Salvar as alterações em {nome}?", descrição "Se não
  salvar, o que você escreveu nesta aba se perde."; lote → "{n} arquivos têm
  alterações não salvas", descrição com os nomes, botão "Salvar os {n}".

### 9.2 Extensão do `confirm`

```ts
export interface ConfirmReq { ...; alternativa?: string }
export type RespostaDoConfirm = "confirmar" | "alternativa" | "cancelar"
export function confirm(req: ConfirmReq): Promise<boolean>               // intocado
export function perguntar(req: ConfirmReq & { alternativa: string }): Promise<RespostaDoConfirm>
```

- O store guarda um `resolve` de `RespostaDoConfirm`; `confirm` adapta
  (`r === "confirmar"`). Nenhum chamador existente muda.
- `ConfirmHost` desenha `alternativa` como `Button variant="ghost"` à
  **esquerda** do rodapé, longe do Enter; "Cancelar" e o confirmar ficam onde
  estão. Esc e o fechar do Radix respondem "cancelar". `enterConfirma` segue
  valendo para o confirmar.
- A largura é a do confirm (`sm:max-w-sm`); o lote lista até 5 nomes e resume o
  resto ("e mais 3").

### 9.3 Apagar conversa

- `removeConversation` não pergunta (é store). Os dois chamadores com gesto,
  `ConversationList.tsx:214` e `BranchSplitView.tsx:221`, acrescentam à
  confirmação existente a linha de `avisoDeSujosDaConversa(convId)`: "{n}
  arquivo(s) com alterações não salvas, abertos só nesta conversa, serão
  descartados." (`null` quando não há).
- Depois de apagar, `remove.ts` chama `soltarConversa(convId)` ao lado do
  `useAbasDeArquivo.getState().esquecer(id)` (`remove.ts:150`), que solta o
  dono de todos os buffers e descarta os que ficaram sem dono.
- Os dois já confirmam hoje ("Apagar…" na lista, "Descartar ramo?" no
  `BranchSplitView.tsx:209`); a linha entra na `description` existente, sem
  diálogo novo. No ramo com worktree, os arquivos somem do disco junto, e o
  aviso diz isso do mesmo jeito.

### 9.4 Saída

`traySnapshot.ts` assina `useEdicao` e publica `arquivosSujos:
Object.keys(sujos).length`. O resto é §6.8.

## 10. Reconciliação

### 10.1 `lib/sinaisDoDisco.ts`

Extrai o corpo do `useEffect` de `useAlteracoesVivas.ts:64-102`:

```ts
/** Chama `aoMudar` (amortecido, 700 ms) quando a pasta `cwd` pode ter mudado. */
export function assinarMudancasNaPasta(cwd: string, aoMudar: () => void): () => void
/** O app gravou algo em `cwd`: acorda quem assina essa pasta. */
export function avisarGravacao(cwd: string): void
```

- Os mesmos gatilhos de hoje (assinatura de ações que mudam arquivo, `focus`,
  `visibilitychange`), mais `avisarGravacao` via `Set` de ouvintes de módulo.
- `useAlteracoesVivas` passa a ser `useEffect(() =>
  assinarMudancasNaPasta(cwd, () => relerRef.current()), [cwd])`. A aba
  Alterações ganha de graça o sinal de gravação (R5 do PRD).

### 10.2 Quem reconcilia

- Um `useEffect` por `CodeEditor` montado assina a pasta `root` dele e, a cada
  sinal, chama `versaoNoDisco` e aplica `reconciliar`.
- Buffers **sujos e não montados** também precisam saber (a pessoa volta à aba
  e deve ver a faixa): ao montar, o `CodeEditor` roda uma reconciliação antes
  do primeiro paint útil.
- Buffer limpo e não montado não é vigiado. Ao montar, ele simplesmente relê.
- Custo: um hash por arquivo montado por sinal amortecido. Um arquivo de 2 MB
  custa poucos milissegundos no `spawn_blocking`.

## 11. Segurança

- A escrita só aceita caminho que passou por `scoped_file_path` **e** pela
  lista de escrita. `..`, symlink para fora e caminho absoluto fora das pastas
  voltam `ForaDasPastas`.
- A página não escolhe a raiz de escrita além do que já escolhe para ler: a
  `root` vem do `FileTab` (projeto ativo ou worktree da conversa).
- O conteúdo nunca é interpretado: vai como bytes.
- O temporário nasce com `create_new` (não segue symlink plantado com o mesmo
  nome) e nome aleatório.
- Log: `log::info!` com caminho relativo e tamanho no salvamento; **nunca** o
  conteúdo.

## 12. Testes

### 12.1 Rust (`cargo test`, em `edicao.rs` ou `edicao_tests.rs`)

Fixtures em `std::env::temp_dir()` com tag e `process::id()` (padrão de
`sources.rs:731`). Conteúdo de fixture colhido de arquivos reais do repo
(`app/src/lib/db/schema.ts` para LF; um `.bat`/`.ps1` real ou um arquivo do
Windows colhido para CRLF; um CSV exportado com BOM).

| caso | espera |
|---|---|
| abrir LF, CRLF, BOM, sem quebra | `fim_de_linha`, `bom` e `conteudo` certos; versão = blake3 dos bytes crus |
| abrir misturado, `\r` solto | só leitura, "Fins de linha misturados" |
| abrir 2 MB + 1 | só leitura com tamanho no motivo |
| abrir em `~/.claude` falso (HOME temporário) | só leitura, "Fora das pastas do projeto" |
| abrir em `extra_dir` | gravável |
| salvar ida e volta sem editar | arquivo idêntico byte a byte, versão igual |
| salvar CRLF e BOM editados | só a linha mudada difere |
| salvar com versão velha | `Conflito { versao }`, arquivo intocado, sem `.tmp` |
| salvar `../fora` e symlink para fora | `ForaDasPastas` |
| salvar em `~/.claude` e anexos | `ForaDasPastas` |
| salvar arquivo apagado | `Sumiu` |
| salvar arquivo `0755` | continua `0755` |
| salvar com `\r` num LF | `Falhou`, arquivo intocado |
| erro de escrita (diretório só leitura) | `Falhou`, sem `.tmp` sobrando |
| `QuitInventory` com `unsaved_files` | confirma, mensagem singular/plural, "Descartar e sair" |
| `TraySnapshot` antigo sem o campo | desserializa com 0 |

### 12.2 TypeScript puro (`bun run test`)

- `estaSujo`: digitar e desfazer volta a limpo; CRLF não conta como mudança.
- `reconciliar`: os cinco resultados, inclusive conflito repetido → `nada`.
- `planoDeFechamento`: aba de diff nunca pergunta; limpa não pergunta; suja
  com outra conversa dona e aberta não pergunta; lote misto separa certo.
- `contarAchados`: "Nada", posição atual, teto "1.000+".
- `parseErroAoSalvar`: as cinco formas e forma desconhecida → `falhou`.
- `perguntar`/`confirm`: as três respostas; Esc → cancelar; `confirm` antigo
  continua booleano.
- `sinaisDoDisco`: `avisarGravacao` acorda só quem assina a mesma pasta;
  amortecimento com relógio falso.
- `carregarLinguagem`: mapa de extensão a partir de `detectLanguage`;
  desconhecida → `null`.
- `traySnapshot`: publica `arquivosSujos`.

### 12.3 Testes de fonte (`import.meta.glob` `?raw`, padrão de `ProjectFileViewer.test.ts`)

- `CodeEditor.tsx` não contém `Mod-1`…`Mod-9`, `Ctrl-Tab` nem `Mod-Shift-t`.
- Nenhum arquivo de `components/editor/` importa `radix-ui` cru.
- `abasNoPrincipal.ts`: `fecharArquivos` chama `planoDeFechamento` antes de
  `useAbasDeArquivo.getState().fechar`.
- `store/edicao.ts` não usa `persist`.

### 12.4 No app (double check de cada fase)

- F2: abrir `app/src/lib/db/schema.ts` e `app/src-tauri/src/lib.rs`; ⌘F,
  alternâncias, regex inválida; arquivo de `~/.claude` mostra o selo.
- F3: editar, ⌘S, `git diff` mostra só a linha; ⌥+clique; ⌘Z pelo teclado e
  por Editar → Desfazer; fechar com ⌘W (menu) e em lote; sair com arquivo
  sujo mostra a linha nova no alerta nativo; Markdown ida e volta.
- F4: editar sem salvar, `echo x >> arquivo` no terminal, voltar à janela →
  faixa; ⌘S com disco mudado → faixa, nada gravado; arquivo limpo muda pelo
  agente → recarrega ao fim da ação.
- Linux: os mesmos gestos com Ctrl, e o `Ctrl-h`.

## 13. Orçamento

| medida | teto | onde se mede |
|---|---|---|
| chunk do editor + linguagens da lista, gzip | 250 KB | `vite build`, número na ADR |
| bundle `main` | +0 KB (tudo sob demanda) | `vite build` |
| tecla em arquivo de 10 mil linhas | sem engasgo visível | no app, F2 |
| `salvar_arquivo` de 2 MB | < 100 ms | teste Rust com `Instant`, só log |
| trabalho por sinal de disco | 1 hash por buffer montado | leitura do código |

Estourou o teto do chunk: a F2 corta linguagem da lista antes de subir o teto,
e subir é decisão da ADR.

## 14. Dependências

Novas em `app/package.json`: `@codemirror/state`, `@codemirror/view`,
`@codemirror/commands`, `@codemirror/search`, `@codemirror/language`,
`@codemirror/autocomplete`, `@lezer/highlight`, `@codemirror/lang-javascript`,
`-json`, `-markdown`, `-rust`, `-python`, `-css`, `-html`. Versões fixadas no
`bun.lock`. Nenhuma crate nova no Rust (`blake3` já existe; o aleatório do
temporário vem do que já está no `Cargo.toml`, conferido na F1).

## 15. Fases e gates

Cada fase fecha com `bun run check`, `bun run test`, `bunx tsc -b --force` (a
partir de `app/`) e `cargo test` (a partir de `app/src-tauri`), todos verdes, e
o double check de §12.4.

| fase | entrega | arquivos | gate próprio |
|---|---|---|---|
| **F1** | Rust sem tela; ADR aberta | `lib.rs` (extração §6.7 + registro), `janela_eventos.rs`, `edicao.rs`, `sources.rs` (visibilidade), `quit.rs`, `tray.rs`, `lib/tray.ts` (tipo), baseline de `lib.rs` para baixo | §12.1 inteira; `git status` limpo depois da suíte |
| **F2** | editor só leitura para todo texto, busca, selo | `components/editor/*`, `lib/edicao/{api,buffers,contagem,linguagens}.ts`, `ProjectFileViewer.tsx`, `FileTab.tsx`, `package.json` | chunk medido; `ProjectFileViewer.test.ts` intocado e verde |
| **F3** | gravar, sujo, ⌘S, portões, saída, Markdown | `store/edicao.ts`, `lib/edicao/{sujo,fechar}.ts`, `lib/confirm.ts`, `common/confirm.tsx`, `abasNoPrincipal.ts`, `AbasDeArquivo.tsx`, `traySnapshot.ts`, `ConversationList.tsx`, `BranchSplitView.tsx`, `store/chat/remove.ts` | nenhum caminho de fechar sem pergunta (§12.3); alerta de saída no Mac e no Linux |
| **F4** | reconciliação e faixas | `lib/sinaisDoDisco.ts`, `useAlteracoesVivas.ts`, `lib/edicao/reconciliar.ts`, `FaixaDoArquivo.tsx` | `useAlteracoesVivas.test.ts` intocado e verde |

A F2 já é entregável sozinha: ⌘F e seleção em qualquer arquivo, sem nenhum
caminho de escrita exposto na tela.

## 16. Riscos e o que a F2 prova primeiro

1. **Desfazer pelo menu nativo.** O `beforeinput` com `historyUndo` é a
   hipótese (§7.5). Se o WKWebView não o disparar para o `contenteditable` do
   CM, a alternativa é o item Desfazer do menu emitir evento para a página,
   como o `frota://fechar-aba`. Provar na F2, antes de expor escrita.
2. **IME e acentos** (ã, ç, dead keys no Mac; teclado ABNT no Linux). O CM 6
   trata composição, mas o WebKitGTK tem histórico próprio. Provar digitando
   pt-BR nos dois sistemas na F2.
3. **Foco e `user-select`**: o app desliga seleção fora de `data-selectable`.
   O contêiner do editor precisa dos dois atributos; sem eles o cursor some.
4. **`lib.rs` congelado**: se a extração do §6.7 não couber na F1, a F1 não
   começa. Não há atalho pela baseline.

## 17. Fora desta SPEC

O mesmo do PRD, seção 7: criar, renomear e apagar arquivo; comparar buffer ×
disco; salvar automático; LSP; avisar o agente da edição; Companion.
