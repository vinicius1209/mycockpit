# SPEC, guardar para depois: a mensagem do composer vira nota

> Status: **implementada**, 27/09/2026 (ADR-270). A seção 0b registra o que
> a implementação mudou.
> Produto: `docs/composer-vira-nota-prd.md` (D1 a D12, R1 a R7). Mock:
> `docs/mocks/composer-vira-nota.html`.
> ADR: uma, na entrega. **Confira o máximo real** em `docs/decisions.md`.

## 0. O que a leitura do código corrigiu no PRD

1. **`⌥↵` não está livre** (E11 do PRD estava errado). `enterTarget` só olha
   ⌘ e Shift (`composerSubmitKeys.tsx:14-23`), então hoje `⌥↵` age como Enter:
   envia, ou corrige o turno em voo. Dar a ele "guardar" **muda** um
   comportamento; é a escolha aprovada (D6), e a ADR registra.
2. **O toast de "feito" tem uma ação só** (`avisos.ts`, `OpcoesDeFeito.acao`).
   Fica o **Desfazer**; o "Abrir" sai. O contador de notas, que sobe junto,
   já diz onde a nota foi parar (D5 reduzido).
3. **Blocos**: `textoDoEnvio(texto, valor, blocos)` (`lib/textoDoEnvio.ts`) já
   compõe citação, colagem e marcação no texto que iria ao motor. A nota
   guarda exatamente esse texto (D3), sem regra nova.
4. **`clear` do rascunho e `pullQueued` não apagam os arquivos** dos anexos
   (`composerDrafts.ts:210`, `filaComposer.ts`). "Desfazer" só devolve as
   referências. `removeQueued` apaga (`chat.ts:2048`) e não é usado aqui.
5. **`CommandConsole.tsx` está em 698 de 700 linhas.** Nada passa por ele: o
   menu lê o rascunho da store quando abre, e o `⌥↵` chama a ação do plugin
   de teclas com o texto recém-serializado.

## 0b. O que a implementação mudou nesta SPEC

1. A lógica mora em `app/src/components/notes/notaGuardada.ts` (e não em
   `lib/`): ela usa `pullQueued`, que é de `components/chat/filaComposer.ts`.
2. O menu é `components/chat/ItensDeGuardar.tsx`, arquivo próprio: só monta com
   o menu aberto, e o despacho segue sem ler store.
3. `lib.rs` ficou duas linhas acima da baseline com o registro do comando; o
   fecho `.setup` saiu para `app/src-tauri/src/inicio.rs` (1233 → 1190). Os
   testes de migração, que eram o outro candidato, citam o nome antigo e
   levariam a catraca de marca junto.
4. `levarAoComposer` não põe no composer o título derivado ("2 imagens") de
   nota só de anexos: só texto de verdade volta como fala.

## 1. Invariantes

1. Guardar nunca aciona motor, nunca enfileira e nunca despacha.
2. Nada do rascunho se perde: se a cópia de um anexo falha, a nota não nasce,
   os anexos copiados até ali são apagados e o rascunho fica intacto.
3. A nota não se apaga sozinha (D8).
4. O escopo vem do gesto e está no rótulo (D2).
5. Os bytes dos anexos não passam pela ponte: a cópia é no Rust.

## 2. Rust: `app/src-tauri/src/anexo_entre_donos.rs`

Módulo novo (`attachments.rs` está em 932 de 1000). Um comando:

```rust
#[derive(Deserialize)]
#[serde(tag = "tipo", rename_all = "kebab-case")]
pub enum DonoDoAnexo { Conversa { id: String }, Nota { id: String } }

#[tauri::command]
pub async fn copiar_anexo(app, path: String, nome: String, para: DonoDoAnexo,
                          active: State<ActiveConvs>) -> Result<Attachment, String>
```

1. `ler_sob_a_raiz(app_data, attachments_root, path)`: canoniza e exige o
   prefixo da raiz de anexos (a mesma regra de `read_attachment`); fora dela,
   `Err("caminho de anexo inválido")`.
2. Grava com `attachments::save_note_to_disk` ou `save_to_disk` (já
   `pub(crate)`): o sniff, a allowlist, o teto de 10 MB e o dedup por hash são
   os mesmos. Nenhuma regra de tipo duplicada.
3. `async` + `spawn_blocking` (hot path Tauri, `check:tauri-hot-paths`).

Testes: `ler_sob_a_raiz` com caminho válido, `..` para fora e symlink para
fora (fixtures em `temp_dir`).

## 3. Modelo

- `StickyNote` ganha `origem?: "composer" | "fila"` (`notes/types.ts`).
- `addNote(draft, opcoes?)` passa a respeitar `draft.id`, `draft.attachments`
  e `draft.origem`, e ganha `opcoes.abrir` (padrão `true`, como hoje): guardar
  não abre a gaveta.

## 4. `app/src/lib/notaGuardada.ts`

```ts
export type EscopoDoGuardar = "conversa" | "projeto"

/** Guarda o rascunho da conversa. `texto` é o recém-serializado do editor
 *  (pode estar um tique à frente da store). */
export async function guardarRascunho(convId: string, escopo: EscopoDoGuardar, texto?: string): Promise<boolean>

/** Tira o item da fila e guarda. */
export async function guardarDaFila(convId: string, indice: number, escopo: EscopoDoGuardar): Promise<boolean>

/** Devolve texto e anexos da nota ao rascunho da conversa, como fala sua. */
export async function levarAoComposer(nota: StickyNote, convId: string): Promise<boolean>

/** Puros. */
export function tituloDoGuardado(texto: string, anexos: readonly Attachment[]): string
export function rotuloDoEscopo(escopo: EscopoDoGuardar, projeto: string | null): string
```

Fluxo de `guardarRascunho`:
1. Lê o rascunho (`useComposerDrafts`), compõe com `textoDoEnvio`. Sem texto e
   sem anexo: não faz nada.
2. Projeto = o da conversa (`useChat.byId[convId].projectId`), o mesmo que
   dono do fio. `escopo === "conversa"` grava `convId` e `projectId`;
   `"projeto"` só `projectId`.
3. Gera o id, copia cada anexo para a nota (`copiar_anexo`). Falha:
   `wipeNoteAttachments(id)`, `avisar.erro("Não consegui guardar a nota.",
   { detalhe })`, rascunho intacto, `false`.
4. `addNote({ id, content, projectId, convId, attachments, origem:
   "composer" }, { abrir: false })`; título derivado quando não há texto (D7:
   "2 imagens", "relatorio.pdf").
5. Guarda uma cópia do rascunho, `clear(convId)`.
6. `avisar.feito("Guardado nas notas desta conversa.", { acao: { rotulo:
   "Desfazer", fazer } })`; "do projeto X" no escopo projeto.
7. `fazer`: devolve o rascunho (acrescenta ao que houver, com
   `acrescentarAoRascunho`, blocos e anexos somados) e `deleteNote(id)`, que
   já apaga os arquivos da nota.

`guardarDaFila`: `pullQueued` → mesmos passos 2 a 4 com `origem: "fila"`;
falha devolve o item à mesma posição; Desfazer idem e apaga a nota.

`levarAoComposer`: copia os anexos da nota para a conversa (`para: conversa`),
respeita `MAX_ATTACH_COUNT` (o que passar vira `avisar.nota`), acrescenta o
texto com `acrescentarAoRascunho`, foca o composer (`focusConsoleComposer`).
A nota fica (D8).

## 5. Tela

- **`ComposerDispatch.tsx`**: componente `ItensDeGuardar` (lê store; só monta
  com o menu aberto, então não afeta os testes estáticos) com o rótulo de
  grupo "Guardar para depois", "Nota desta conversa" (`⌥↵`) e "Nota do
  projeto" com o nome. Sem turno: entra no menu do Enviar, depois de Missão.
  Com turno: o par Enfileirar | ⚡ ganha um terceiro segmento, chevron, que
  abre Enfileirar (⇥), Corrigir agora (↵, só com turno rodando) e o grupo.
  Ícones `StickyNote` e `FolderClosed`; nada de âmbar nos itens (D12).
- **`composerSubmitKeys.tsx`**: `enterTarget` ganha `alt` opcional e devolve
  `"guardar"`; o plugin chama `guardarRascunho(activeId, "conversa",
  texto)`. Os testes existentes não mudam.
- **`FilaDoComposer.tsx`**: prop `onGuardar?: (i, escopo) => void`; ícone
  `StickyNote` no hover, ao lado do ✕, abrindo um `DropdownMenu` com as duas
  linhas. `BaseDoComposer.tsx` liga em `guardarDaFila`.
- **`StickyNoteCard.tsx`**: com `origem`, o carimbo diz "do composer" ou "da
  fila", e o primeiro botão é "Levar ao composer"; "Usar no prompt" segue.
  `StickyNotesDock.tsx` passa o handler.

## 6. Testes

- Rust: `ler_sob_a_raiz` (válido, `..`, symlink).
- TS puro: `tituloDoGuardado`, `rotuloDoEscopo`, `enterTarget` com `alt`.
- TS com store e `invoke` simulado: guardar → nota com conteúdo composto e
  anexos copiados, rascunho vazio, gaveta fechada; Desfazer devolve tudo e
  apaga a nota; falha na cópia deixa o rascunho e não cria nota; guardar da
  fila e desfazer devolvem o item ao mesmo índice; levar ao composer acrescenta
  e mantém a nota; `addNote` respeita id, anexos, origem e `abrir: false`.
- Fixture: o texto real do print de 27/09.

## 7. Fases

1. **F1**: `anexo_entre_donos.rs`, `origem`, `addNote`.
2. **F2**: `notaGuardada.ts`, menu, `⌥↵`, toast.
3. **F3**: fila, "Levar ao composer", carimbo.

Cada fase fecha com `bun run check`, `bun run test`, `bunx tsc -b --force`,
`cargo test`.
