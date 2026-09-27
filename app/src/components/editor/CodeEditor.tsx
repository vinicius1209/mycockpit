// O editor de arquivo (docs/edicao-de-arquivos-spec.md §7.5). Carregado sob
// demanda pelo `ProjectFileViewer`; enquanto o chunk chega, e se ele falhar, a
// tela mostra o visualizador estático (`reserva`), nunca um buraco.
//
// O texto não mora no componente: mora no buffer (`lib/edicao/buffers.ts`),
// por arquivo. Trocar de aba ou de conversa desmonta a view e guarda o estado,
// com o histórico de desfazer junto.

import { useEffect, useRef, useState, type ReactNode } from "react"
import { closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete"
import { defaultKeymap, history, historyKeymap, indentWithTab, redo, undo } from "@codemirror/commands"
import { bracketMatching, indentOnInput } from "@codemirror/language"
import { highlightSelectionMatches, openSearchPanel, search, searchKeymap } from "@codemirror/search"
import { Compartment, EditorSelection, EditorState, type Extension } from "@codemirror/state"
import {
  drawSelection,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
  rectangularSelection,
  type KeyBinding,
} from "@codemirror/view"
import { campoDeSubstituir, mostrarSubstituir } from "@/components/editor/estadoDaBusca"
import { criarPainelDeBusca } from "@/components/editor/painelDeBusca"
import { FaixaDoArquivo } from "@/components/editor/FaixaDoArquivo"
import { realceDoEditor, temaDoEditor } from "@/components/editor/temaDoEditor"
import { ehApple } from "@/components/layout/atalhosDasAbas"
import { avisar } from "@/lib/avisos"
import { copyText } from "@/lib/clipboard"
import { currentPlatform } from "@/lib/commandMenu"
import { descartarArquivo, manterAMinha, salvar } from "@/lib/edicao/acoes"
import { abrirParaEdicao, versaoNoDisco, type ArquivoEditavel } from "@/lib/edicao/api"
import {
  adicionarDono,
  estadoAtual,
  obter,
  obterDaAba,
  rebasear,
  registrar,
  textoAtual,
  type Buffer,
} from "@/lib/edicao/buffers"
import { carregarLinguagem } from "@/lib/edicao/linguagens"
import { estaSujo, nomeDoArquivo, reconciliar } from "@/lib/edicao/regras"
import { assinarMudancasNaPasta } from "@/lib/sinaisDoDisco"
import { mensagemDe } from "@/lib/mensagemDe"
import { useEdicao } from "@/store/edicao"

const linguagem = new Compartment()

/** Caminho que o Rust aceita: relativo vira absoluto contra a raiz. */
function absoluto(root: string, chave: string): string {
  return chave.startsWith("/") ? chave : `${root.replace(/\/$/, "")}/${chave}`
}

/** O Desfazer do menu Editar nativo chega como `beforeinput`, não como tecla. */
const desfazerPeloMenu = EditorView.domEventHandlers({
  beforeinput(e, view) {
    if (e.inputType === "historyUndo") return undo(view), e.preventDefault(), true
    if (e.inputType === "historyRedo") return redo(view), e.preventDefault(), true
    return false
  },
})

function abrirBusca(comSubstituir: boolean) {
  return (view: EditorView) => {
    view.dispatch({ effects: mostrarSubstituir.of(comSubstituir) })
    return openSearchPanel(view)
  }
}

function extensoes(caminho: string, gravavel: boolean, lingua: Extension = []): Extension[] {
  const atalhos: KeyBinding[] = [
    { key: "Mod-s", run: () => (void salvar(caminho), true), preventDefault: true },
    { key: "Mod-f", run: abrirBusca(false), scope: "editor search-panel", preventDefault: true },
    { key: "Mod-Alt-f", run: abrirBusca(true), scope: "editor search-panel", preventDefault: true },
  ]
  // Ctrl+H é o substituir do Linux; no Mac, ⌃H apaga para trás nos campos.
  if (!ehApple(currentPlatform())) atalhos.push({ key: "Ctrl-h", run: abrirBusca(true), preventDefault: true })
  return [
    lineNumbers(),
    highlightActiveLineGutter(),
    highlightActiveLine(),
    drawSelection(),
    EditorState.allowMultipleSelections.of(true),
    history(),
    indentOnInput(),
    bracketMatching(),
    closeBrackets(),
    highlightSelectionMatches(),
    // "Estilo VS Code": ⌥+clique põe outro cursor, ⇧⌥+arrastar seleciona coluna.
    rectangularSelection({ eventFilter: (e) => e.altKey && e.shiftKey }),
    EditorView.clickAddsSelectionRange.of((e) => e.altKey && !e.shiftKey),
    campoDeSubstituir,
    search({ top: true, createPanel: criarPainelDeBusca }),
    keymap.of([...atalhos, ...closeBracketsKeymap, ...defaultKeymap, ...searchKeymap, ...historyKeymap, indentWithTab]),
    desfazerPeloMenu,
    EditorView.updateListener.of((u) => {
      if (!u.docChanged) return
      const b = obter(caminho)
      if (b) useEdicao.getState().marcarSujo(caminho, estaSujo(u.state.doc, b.base))
    }),
    linguagem.of(lingua),
    // Só leitura é `readOnly`, e NÃO `editable: false`: sem `contenteditable` o
    // texto não recebe foco, e o ⌘F e as setas morreriam junto.
    EditorState.readOnly.of(!gravavel),
    temaDoEditor,
    realceDoEditor,
  ]
}

function criarEstado(a: ArquivoEditavel, anterior?: EditorState): EditorState {
  const estado = EditorState.create({
    doc: a.conteudo,
    extensions: extensoes(a.caminhoAbsoluto, a.gravavel, (anterior && linguagem.get(anterior)) || []),
  })
  if (!anterior) return estado
  // Recarregar mantém o cursor onde dá; o texto novo pode ser menor.
  const pos = Math.min(anterior.selection.main.head, estado.doc.length)
  return estado.update({ selection: EditorSelection.cursor(pos) }).state
}

function novoBuffer(a: ArquivoEditavel, root: string, chave: string): Buffer {
  const estado = criarEstado(a)
  return {
    caminho: a.caminhoAbsoluto,
    root,
    relativo: chave,
    estado,
    vista: null,
    base: estado.doc,
    versao: a.versao,
    fimDeLinha: a.fimDeLinha,
    bom: a.bom,
    gravavel: a.gravavel,
    motivo: a.motivo,
    versaoDoConflito: null,
    donos: new Map(),
  }
}

/** Lê o disco de novo e troca o texto, SEM histórico: desfazer não volta para
 *  um texto que não está mais no disco. */
async function recarregar(b: Buffer): Promise<void> {
  const a = await abrirParaEdicao(b.root, b.caminho)
  const estado = criarEstado(a, estadoAtual(b))
  Object.assign(b, { fimDeLinha: a.fimDeLinha, bom: a.bom, gravavel: a.gravavel, motivo: a.motivo })
  rebasear(b.caminho, estado.doc, a.versao)
  if (b.vista) b.vista.setState(estado)
  else b.estado = estado
  const edicao = useEdicao.getState()
  edicao.marcarSujo(b.caminho, false)
  edicao.marcarAviso(b.caminho, null)
}

/** O disco pode ter mudado: decide e age (spec §10). */
async function conferirODisco(b: Buffer): Promise<void> {
  let noDisco: string | null
  try {
    noDisco = await versaoNoDisco(b.root, b.caminho)
  } catch (e) {
    console.warn(`edição: não consegui conferir ${b.caminho}`, e)
    return
  }
  if (obter(b.caminho) !== b) return // descartado enquanto conferia
  const edicao = useEdicao.getState()
  if (noDisco !== null && edicao.avisos[b.caminho] === "sumiu") edicao.marcarAviso(b.caminho, null)
  const sujo = Boolean(edicao.sujos[b.caminho])
  switch (reconciliar({ sujo, versao: b.versao, versaoDoConflito: b.versaoDoConflito }, noDisco)) {
    case "recarregar":
      await recarregar(b).catch((e) => console.warn(`edição: não consegui recarregar ${b.caminho}`, e))
      return
    case "conflito":
      b.versaoDoConflito = noDisco
      edicao.marcarAviso(b.caminho, "conflito")
      return
    case "sumiu":
      edicao.marcarAviso(b.caminho, "sumiu")
      return
    case "nada":
      return
  }
}

export default function CodeEditor({
  root,
  chave,
  convId,
  reserva,
  aoFechar,
  aoMotivo,
}: {
  root: string
  chave: string
  convId: string | null
  /** O visualizador estático: o que se vê se o editor não puder montar. */
  reserva: ReactNode
  aoFechar?: () => void
  /** Diz ao cabeçalho se o arquivo é só leitura, e por quê (`null` = grava). */
  aoMotivo?: (motivo: string | null) => void
}) {
  const host = useRef<HTMLDivElement>(null)
  const [buffer, setBuffer] = useState<Buffer | null>(() => obterDaAba(root, chave) ?? null)
  const [falhou, setFalhou] = useState(false)
  const [ocupado, setOcupado] = useState(false)
  const aviso = useEdicao((s) => (buffer ? s.avisos[buffer.caminho] : undefined))
  const avisarMotivo = useRef(aoMotivo)
  useEffect(() => {
    avisarMotivo.current = aoMotivo
  })
  useEffect(() => {
    avisarMotivo.current?.(buffer && !buffer.gravavel ? (buffer.motivo ?? "Só leitura") : null)
  }, [buffer])

  useEffect(() => {
    const existente = obterDaAba(root, chave)
    if (existente) {
      setBuffer(existente)
      return
    }
    let cancelado = false
    setBuffer(null)
    abrirParaEdicao(root, absoluto(root, chave))
      .then((a) => {
        if (!cancelado) setBuffer(registrar(novoBuffer(a, root, chave), root, chave))
      })
      .catch((e) => {
        if (cancelado) return
        console.warn(`edição: não consegui abrir ${chave}`, e)
        setFalhou(true)
      })
    return () => {
      cancelado = true
    }
  }, [root, chave])

  useEffect(() => {
    const pai = host.current
    if (!buffer || !pai) return
    // O mesmo arquivo já tem editor montado em outra superfície: dois editores
    // do mesmo buffer divergiriam. Esta mostra o estático.
    if (buffer.vista?.dom.isConnected) {
      setOcupado(true)
      return
    }
    setOcupado(false)
    if (convId) adicionarDono(buffer.caminho, convId, chave)
    const view = new EditorView({ state: buffer.estado, parent: pai })
    buffer.vista = view
    const atual = linguagem.get(view.state)
    if (!atual || (Array.isArray(atual) && atual.length === 0)) {
      void carregarLinguagem(chave).then((ext) => {
        if (ext && buffer.vista === view) view.dispatch({ effects: linguagem.reconfigure(ext) })
      })
    }
    return () => {
      buffer.estado = view.state
      if (buffer.vista === view) buffer.vista = null
      view.destroy()
    }
  }, [buffer, convId, chave])

  // Reconciliação: ao montar (a pessoa volta à aba) e a cada sinal da pasta.
  useEffect(() => {
    if (!buffer) return
    void conferirODisco(buffer)
    return assinarMudancasNaPasta(buffer.root, () => void conferirODisco(buffer))
  }, [buffer])

  if (falhou || ocupado) return <>{reserva}</>
  const nome = buffer ? nomeDoArquivo(buffer.caminho) : ""
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {buffer && aviso && (
        <FaixaDoArquivo
          aviso={aviso}
          aoUsarODisco={() =>
            void recarregar(buffer).catch((e: unknown) =>
              avisar.erro(`Não consegui ler ${nome} do disco.`, { detalhe: mensagemDe(e) }),
            )
          }
          aoManter={() => manterAMinha(buffer.caminho)}
          aoCopiar={() => void copyText(textoAtual(buffer), `Texto de ${nome} copiado.`)}
          aoFechar={
            aoFechar &&
            (() => {
              descartarArquivo(buffer.caminho)
              aoFechar()
            })
          }
        />
      )}
      {!buffer && reserva}
      <div
        ref={host}
        data-selectable
        className={buffer ? "relative min-h-0 flex-1 overflow-hidden select-text" : "hidden"}
        onKeyDown={(e) => {
          // ⌘S com o foco fora do texto (no painel de busca, por exemplo).
          // O keymap do texto já tratou (e marcou) o que nasceu lá dentro.
          if (e.defaultPrevented) return
          if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s" && buffer) {
            e.preventDefault()
            void salvar(buffer.caminho)
          }
        }}
      />
    </div>
  )
}
