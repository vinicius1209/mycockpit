// Testes do store de UI do office (§5.2/§5.4/§5 Esc + menu-balão v2) — store
// vanilla + funções puras, sem DOM. Roda com:
// bunx vitest run src/office/ui/ui.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  BOSS_DESK_ID,
  NOTICE_BOARD_ID,
  type DeskSnapshot,
  type OfficeSnapshot,
  type SimEvent,
} from "@/lib/fleet/types"
import { deskLiveConvId, deskMenuKind, deskMenuPrimary } from "./DeskMenu"
import {
  applyRecovery,
  buildRecoveryChoice,
  cancelRecovery,
  pickRevezamento,
  revezamentoTargets,
} from "./recovery"
import { editPhase, phasesCustomized } from "@/lib/missionDraft"
import type { MissionPhaseDef, MissionPreset } from "@/lib/missionTypes"
import {
  MISSION_TABLE_ID,
  effectiveTablePreset,
  launchFromTable,
  missionConversationTitle,
  missionLaunchBlock,
  missionTableMenu,
  parseMissionSig,
  phaseAgentOptions,
  presetDraft,
  presetOptionLabel,
} from "./missionTable"
import { missionPanelSubtitle, showsMissionPanel } from "./missionPanel"
import {
  BOSS_SAY_MS,
  DOCK_ITEMS_WINDOW,
  decideDockLeave,
  decideEsc,
  deskSnapshotById,
  dockItemsStart,
  needsDeskConversation,
  officeEscape,
  otherLiveConvId,
  useOfficeUi,
  type DockLeaveCtx,
} from "./store"

// officeEscape/DeskMenu executam efeitos via bridge — mocados pra manter o
// teste hermético (sem stores do app/Tauri): dockLeaveCtx devolve o ctx armado
// por cada teste; cancelDictation/cancelDeskTurn só registram a chamada.
const h = vi.hoisted(() => ({
  ctx: { hasDraft: false, turnActive: false },
  cancelDictation: vi.fn(async () => {}),
  cancelDeskTurn: vi.fn(async () => {}),
  openScheduledView: vi.fn(),
  /** Conversas que estão numa missão RODANDO (deskMissionRunning do bridge). */
  missionConvs: new Set<string>(),
  /** Conversas que EXISTEM no store de chat (deskConvExists do bridge); null =
   *  qualquer id existe (caso comum: snapshot real vem do próprio useChat). */
  knownConvs: null as Set<string> | null,
}))
vi.mock("../bridge/hooks", () => ({
  dockLeaveCtx: () => h.ctx,
  openScheduledView: h.openScheduledView,
  deskMissionRunning: (convId: string | null) =>
    !!convId && h.missionConvs.has(convId),
  deskConvExists: (convId: string | null) =>
    !!convId && (h.knownConvs === null || h.knownConvs.has(convId)),
}))
vi.mock("../bridge/voice", () => ({ cancelDictation: h.cancelDictation }))
vi.mock("@/lib/fleet/send", () => ({
  cancelDeskTurn: h.cancelDeskTurn,
  DESK_TITLE_PREFIX: "Mesa · ",
}))
// DeskMenu importa o bridge da missão (MissionTableMenu) — mocado pra não
// puxar os stores do app pro teste hermético; a lógica pura vive em
// ui/missionTable e é testada direto abaixo.
vi.mock("../bridge/mission", () => ({ useMissionTableSig: () => null }))

// --- factories locais -------------------------------------------------------

const DESK_A = "proj-1::claude-code"
const DESK_B = "proj-1::codex"

function evtNear(deskId: string | null): SimEvent {
  return { kind: "near-desk", deskId }
}

function evtArrived(deskId: string): SimEvent {
  return { kind: "arrived-at-desk", deskId }
}

function ctx(p: Partial<DockLeaveCtx> = {}): DockLeaveCtx {
  return { hasDraft: false, turnActive: false, ...p }
}

function mesaSnap(patch: Partial<DeskSnapshot> = {}): DeskSnapshot {
  return {
    id: DESK_A,
    projectId: "proj-1",
    agent: "claude-code",
    state: "idle",
    label: "Disponível",
    ...patch,
  }
}

/** Snapshot do office com as mesas dadas (o que o derive entrega ao store). */
function officeSnap(...desks: DeskSnapshot[]): OfficeSnapshot {
  return {
    rooms: [
      {
        projectId: "proj-1",
        name: "Projeto 1",
        agg: "idle",
        costUsd: 0,
        desks,
      },
    ],
    deliveries: [],
  }
}

beforeEach(() => {
  // Reseta o store inteiro entre testes (getInitialState inclui as actions).
  useOfficeUi.setState(useOfficeUi.getInitialState(), true)
  h.ctx = ctx()
  h.missionConvs.clear()
  h.knownConvs = null
  h.cancelDictation.mockClear()
  h.openScheduledView.mockClear()
})

// --- chegada na mesa ⇒ MENU-BALÃO (§5.2/§5.3 v2) ----------------------------

describe("chegada na mesa — abre o menu-balão, não mais o dock", () => {
  it("arrived-at-desk marca a mesa em alcance (menu) e NÃO abre o dock", () => {
    useOfficeUi.getState().handleSimEvent(evtArrived(DESK_A))
    const s = useOfficeUi.getState()
    expect(s.nearDeskId).toBe(DESK_A) // menu deriva de nearDeskId
    expect(s.dockDeskId).toBeNull() // dock só pela ação primária do menu
  })

  it("chegar em OUTRA mesa com o dock aberto aplica §5.4 (minimiza c/ draft)", () => {
    const s = useOfficeUi.getState()
    s.openDock(DESK_A)
    s.handleSimEvent(evtArrived(DESK_B), ctx({ hasDraft: true }))
    const st = useOfficeUi.getState()
    expect(st.nearDeskId).toBe(DESK_B)
    expect(st.dockDeskId).toBe(DESK_A)
    expect(st.dockMinimized).toBe(true)
  })

  it("chegar na mesa do dock MINIMIZADO não mexe no chip (menu abre por cima)", () => {
    const s = useOfficeUi.getState()
    s.openDock(DESK_A)
    s.setDockConv("conv-1")
    s.minimizeDock()
    s.handleSimEvent(evtArrived(DESK_A))
    const st = useOfficeUi.getState()
    expect(st.nearDeskId).toBe(DESK_A)
    expect(st.dockDeskId).toBe(DESK_A)
    expect(st.dockMinimized).toBe(true) // restaurar é ação do menu/chip
    expect(st.dockConvId).toBe("conv-1")
  })
})

// --- ação primária do menu (tecla E / botão) --------------------------------

describe("deskMenuPrimary — todas as primárias abrem o dock", () => {
  it("abre o dock da mesa (Conversar/Abrir/Responder/Acompanhar)", () => {
    deskMenuPrimary(DESK_A)
    const s = useOfficeUi.getState()
    expect(s.dockDeskId).toBe(DESK_A)
    expect(s.dockMinimized).toBe(false)
  })

  it("mesma mesa minimizada ⇒ restaura preservando a conversa", () => {
    const s = useOfficeUi.getState()
    s.openDock(DESK_A)
    s.setDockConv("conv-1")
    s.minimizeDock()
    deskMenuPrimary(DESK_A)
    const st = useOfficeUi.getState()
    expect(st.dockDeskId).toBe(DESK_A)
    expect(st.dockMinimized).toBe(false)
    expect(st.dockConvId).toBe("conv-1") // conversa preservada
  })

  it("outra mesa ⇒ troca o dock e zera a conversa (re-resolve)", () => {
    const s = useOfficeUi.getState()
    s.openDock(DESK_A)
    s.setDockConv("conv-1")
    deskMenuPrimary(DESK_B)
    const st = useOfficeUi.getState()
    expect(st.dockDeskId).toBe(DESK_B)
    expect(st.dockConvId).toBeNull()
  })
})

// --- estado e conteúdo do MESMO fio (mesa acesa abre a conversa que roda) ---

describe("abrir a mesa leva a conversa VIVA (não a 'Mesa · <agent>' vazia)", () => {
  it("mesa Digitando ⇒ a primária abre a conversa que RODA, sem pedir a da mesa", () => {
    useOfficeUi.setState({
      snapshot: officeSnap(
        mesaSnap({ state: "typing", label: "Digitando", convId: "conv-viva" }),
      ),
    })
    deskMenuPrimary(DESK_A)
    const st = useOfficeUi.getState()
    expect(st.dockDeskId).toBe(DESK_A)
    expect(st.dockConvId).toBe("conv-viva")
    // com o fio carimbado, o dock NÃO chama o ensureDeskConversation
    expect(needsDeskConversation(st.dockDeskId, st.dockConvId)).toBe(false)
  })

  it("mesa Pensando ⇒ mesmo caminho (o estado veio dessa conversa)", () => {
    useOfficeUi.setState({
      snapshot: officeSnap(
        mesaSnap({ state: "thinking", label: "Pensando", convId: "conv-viva" }),
      ),
    })
    deskMenuPrimary(DESK_A)
    expect(useOfficeUi.getState().dockConvId).toBe("conv-viva")
  })

  it("SEM turno vivo ⇒ nada é carimbado e o dock cai no fallback da mesa", () => {
    useOfficeUi.setState({ snapshot: officeSnap(mesaSnap()) })
    deskMenuPrimary(DESK_A)
    const st = useOfficeUi.getState()
    expect(st.dockConvId).toBeNull()
    // é isto que dispara o ensureDeskConversation ("Mesa · <agent>")
    expect(needsDeskConversation(st.dockDeskId, st.dockConvId)).toBe(true)
  })

  it("approval esperando resposta abre o fio do pedido (card no lugar certo)", () => {
    useOfficeUi.setState({
      snapshot: officeSnap(
        mesaSnap({
          state: "hand",
          hand: "approval",
          label: "Aguardando aprovação",
          convId: "conv-approval",
        }),
      ),
    })
    deskMenuPrimary(DESK_A)
    expect(useOfficeUi.getState().dockConvId).toBe("conv-approval")
  })

  it("fase de MISSÃO não vira conversa da mesa (o painel lê desk.convId)", () => {
    h.missionConvs.add("conv-missao")
    useOfficeUi.setState({
      snapshot: officeSnap(
        mesaSnap({ state: "typing", label: "Executando", convId: "conv-missao" }),
      ),
    })
    deskMenuPrimary(DESK_A)
    expect(useOfficeUi.getState().dockConvId).toBeNull()
  })

  it("mão levantada por GATE de missão também não adota a conversa da missão", () => {
    h.missionConvs.add("conv-missao")
    useOfficeUi.setState({
      snapshot: officeSnap(
        mesaSnap({
          state: "hand",
          hand: "gate",
          label: "Precisa de você",
          convId: "conv-missao",
        }),
      ),
    })
    deskMenuPrimary(DESK_A)
    expect(useOfficeUi.getState().dockConvId).toBeNull()
  })

  it("tecla E (sem convId) resolve o MESMO fio que o botão do menu passa", () => {
    const desk = mesaSnap({
      state: "typing",
      label: "Digitando",
      convId: "conv-viva",
    })
    useOfficeUi.setState({ snapshot: officeSnap(desk) })
    // botão do menu: passa o que tem em mãos (snap do próprio componente)
    deskMenuPrimary(DESK_A, deskLiveConvId(desk))
    const doBotao = useOfficeUi.getState().dockConvId
    useOfficeUi.setState({ dockDeskId: null, dockConvId: null })
    // tecla E: só o deskId — a resolução sai do snapshot do store
    deskMenuPrimary(DESK_A)
    expect(useOfficeUi.getState().dockConvId).toBe(doBotao)
    expect(doBotao).toBe("conv-viva")
  })

  it("rail resolve o mesmo fio que o menu (openDeskFromBoss lê o snapshot)", () => {
    const desk = mesaSnap({
      state: "typing",
      label: "Digitando",
      convId: "conv-viva",
    })
    useOfficeUi.setState({ snapshot: officeSnap(desk) })
    // o que o OfficeMode.openDeskFromBoss calcula a partir do deskId da rail
    const snapshot = useOfficeUi.getState().snapshot
    expect(deskLiveConvId(deskSnapshotById(snapshot, DESK_A))).toBe("conv-viva")
    expect(deskSnapshotById(snapshot, DESK_B)).toBeUndefined()
  })

  it("mesa já aberta noutra conversa: o fio vivo assume; sem fio, preserva", () => {
    const s = useOfficeUi.getState()
    s.openDock(DESK_A, "conv-mesa")
    s.openDock(DESK_A, "conv-viva") // turno começou em outro fio
    expect(useOfficeUi.getState().dockConvId).toBe("conv-viva")
    useOfficeUi.getState().openDock(DESK_A) // sem fio vivo ⇒ não zera
    expect(useOfficeUi.getState().dockConvId).toBe("conv-viva")
  })

  it("deskLiveConvId: mesa apagada/ociosa ou sem convId ⇒ null", () => {
    expect(deskLiveConvId(undefined)).toBeNull()
    expect(deskLiveConvId(mesaSnap({ convId: "c1" }))).toBeNull() // idle
    expect(
      deskLiveConvId(mesaSnap({ state: "off", label: "Não detectado" })),
    ).toBeNull()
    expect(deskLiveConvId(mesaSnap({ state: "typing" }))).toBeNull() // sem conv
  })

  it("id sem conversa nenhuma (fixture do browser) não é adotado", () => {
    // fora do Tauri o snapshot vem do sim-data: carimbar "sim-conv-1" deixaria
    // o dock preso no "Abrindo a conversa da mesa…" — cai no fallback.
    h.knownConvs = new Set(["conv-real"])
    useOfficeUi.setState({
      snapshot: officeSnap(
        mesaSnap({ state: "typing", label: "Digitando", convId: "sim-conv-1" }),
      ),
    })
    deskMenuPrimary(DESK_A)
    const st = useOfficeUi.getState()
    expect(st.dockConvId).toBeNull()
    expect(needsDeskConversation(st.dockDeskId, st.dockConvId)).toBe(true)
  })
})

// --- divergência honesta no dock (estado de um fio, conteúdo de outro) ------

describe("otherLiveConvId — o dock diz que o trabalho está em outra conversa", () => {
  // o 2º argumento é o fio VIVO da mesa (deskLiveConvId), a mesma régua do
  // menu-balão: missão e id sem conversa já saíram fora antes de chegar aqui.
  const vivo = (desk: DeskSnapshot) => deskLiveConvId(desk)

  it("mesa trabalhando em conversa diferente da aberta ⇒ devolve o fio vivo", () => {
    expect(
      otherLiveConvId(
        "conv-mesa",
        vivo(mesaSnap({ state: "typing", convId: "conv-viva" })),
      ),
    ).toBe("conv-viva")
    expect(
      otherLiveConvId(
        "conv-mesa",
        vivo(mesaSnap({ state: "thinking", convId: "conv-viva" })),
      ),
    ).toBe("conv-viva")
  })

  it("mesma conversa ⇒ sem aviso (é o caso normal depois da correção)", () => {
    expect(
      otherLiveConvId(
        "conv-viva",
        vivo(mesaSnap({ state: "typing", convId: "conv-viva" })),
      ),
    ).toBeNull()
  })

  it("mesa parada ⇒ sem aviso (histórico velho não é trabalho em curso)", () => {
    expect(
      otherLiveConvId("conv-mesa", vivo(mesaSnap({ convId: "conv-outra" }))),
    ).toBeNull()
  })

  it("fase de MISSÃO não vira aviso (o painel de missão já toma o dock)", () => {
    h.missionConvs.add("conv-missao")
    expect(
      otherLiveConvId(
        "conv-mesa",
        vivo(mesaSnap({ state: "typing", convId: "conv-missao" })),
      ),
    ).toBeNull()
  })

  it("dock ainda resolvendo a conversa (null) ⇒ sem aviso, só o loader", () => {
    expect(
      otherLiveConvId(
        null,
        vivo(mesaSnap({ state: "typing", convId: "conv-viva" })),
      ),
    ).toBeNull()
  })
})

describe("needsDeskConversation — quando o dock resolve a conversa da mesa", () => {
  it("mesa de agent sem conversa ⇒ resolve; com conversa ⇒ não", () => {
    expect(needsDeskConversation(DESK_A, null)).toBe(true)
    expect(needsDeskConversation(DESK_A, "conv-viva")).toBe(false)
  })

  it("sem dock, ou mesa de REUNIÃO, nunca resolve conversa de mesa", () => {
    expect(needsDeskConversation(null, null)).toBe(false)
    expect(needsDeskConversation(MISSION_TABLE_ID, null)).toBe(false)
  })
})

// --- conteúdo do menu por estado (lógica pura) ------------------------------

describe("deskMenuKind — menu certo pro estado da mesa", () => {
  it("ocioso/indefinido ⇒ idle (Conversar)", () => {
    expect(deskMenuKind("idle", false)).toBe("idle")
    expect(deskMenuKind(undefined, false)).toBe("idle")
  })

  it("typing/thinking ⇒ running (mini-status + Abrir + Parar)", () => {
    expect(deskMenuKind("typing", false)).toBe("running")
    expect(deskMenuKind("thinking", false)).toBe("running")
  })

  it("typing/thinking numa conversa de MISSÃO ⇒ mission (Acompanhar)", () => {
    expect(deskMenuKind("typing", true)).toBe("mission")
    expect(deskMenuKind("thinking", true)).toBe("mission")
  })

  it("hand vence missão (gate/approval mostram Responder)", () => {
    expect(deskMenuKind("hand", true)).toBe("hand")
    expect(deskMenuKind("hand", false)).toBe("hand")
  })

  it("mesa apagada ⇒ off (explicação, sem ações)", () => {
    expect(deskMenuKind("off", false)).toBe("off")
  })

  it("recovery pendente ⇒ hand mesmo pintada como trabalhando (entrega 4)", () => {
    // o derive ainda mostra typing/thinking na fase parada; a recuperação
    // sobe pra "hand" (Precisa de você) — mesmo tratamento do gate.
    expect(deskMenuKind("thinking", true, true)).toBe("hand")
    expect(deskMenuKind("typing", true, true)).toBe("hand")
    expect(deskMenuKind("idle", false, true)).toBe("hand")
    // sem recovery, nada muda (default do 3º parâmetro)
    expect(deskMenuKind("thinking", true)).toBe("mission")
  })
})

// --- sair do raio (§5.4) ----------------------------------------------------

describe("dock — sair do raio da mesa (§5.4)", () => {
  it("com draft ⇒ minimiza pro chip (nunca descarta em silêncio)", () => {
    const s = useOfficeUi.getState()
    s.openDock(DESK_A)
    s.handleSimEvent(evtNear(null), ctx({ hasDraft: true }))
    const st = useOfficeUi.getState()
    expect(st.dockDeskId).toBe(DESK_A)
    expect(st.dockMinimized).toBe(true)
  })

  it("com turno ativo ⇒ minimiza (streaming vira balão sobre o agent)", () => {
    const s = useOfficeUi.getState()
    s.openDock(DESK_A)
    s.handleSimEvent(evtNear(null), ctx({ turnActive: true }))
    expect(useOfficeUi.getState().dockMinimized).toBe(true)
  })

  it("sem draft e sem turno ⇒ fecha de vez", () => {
    const s = useOfficeUi.getState()
    s.openDock(DESK_A)
    s.setDockConv("conv-1")
    s.handleSimEvent(evtNear(null), ctx())
    const st = useOfficeUi.getState()
    expect(st.dockDeskId).toBeNull()
    expect(st.dockConvId).toBeNull()
  })

  it("trocar o alcance pra OUTRA mesa também aplica §5.4 no dock aberto", () => {
    const s = useOfficeUi.getState()
    s.openDock(DESK_A)
    s.handleSimEvent(evtNear(DESK_B), ctx({ hasDraft: true }))
    const st = useOfficeUi.getState()
    expect(st.nearDeskId).toBe(DESK_B)
    expect(st.dockDeskId).toBe(DESK_A)
    expect(st.dockMinimized).toBe(true)
  })

  it("dock MINIMIZADO não é mexido ao andar pelo escritório (chip fica)", () => {
    const s = useOfficeUi.getState()
    s.openDock(DESK_A)
    s.minimizeDock()
    s.handleSimEvent(evtNear(null), ctx())
    const st = useOfficeUi.getState()
    expect(st.dockDeskId).toBe(DESK_A)
    expect(st.dockMinimized).toBe(true)
  })

  it("near-desk atualiza o alvo de proximidade sempre", () => {
    useOfficeUi.getState().handleSimEvent(evtNear(DESK_B))
    expect(useOfficeUi.getState().nearDeskId).toBe(DESK_B)
    useOfficeUi.getState().handleSimEvent(evtNear(null))
    expect(useOfficeUi.getState().nearDeskId).toBeNull()
  })
})

// --- Esc (coordenador §5) ---------------------------------------------------

describe("decideEsc — prioridade do coordenador", () => {
  it("gravando vence tudo (cancela o ditado, dock intacto)", () => {
    expect(
      decideEsc({ recording: true, dockOpen: true, ...ctx({ hasDraft: true }) }),
    ).toBe("cancel-dictation")
  })

  it("dock aberto sem draft/turno ⇒ fecha", () => {
    expect(decideEsc({ recording: false, dockOpen: true, ...ctx() })).toBe(
      "close-dock",
    )
  })

  it("dock aberto com draft ⇒ minimiza (§5.4 vale pro Esc também)", () => {
    expect(
      decideEsc({ recording: false, dockOpen: true, ...ctx({ hasDraft: true }) }),
    ).toBe("minimize-dock")
  })

  it("dock aberto com turno ativo ⇒ minimiza", () => {
    expect(
      decideEsc({
        recording: false,
        dockOpen: true,
        ...ctx({ turnActive: true }),
      }),
    ).toBe("minimize-dock")
  })

  it("nada aberto ⇒ none (Esc NÃO sai do office)", () => {
    expect(decideEsc({ recording: false, dockOpen: false, ...ctx() })).toBe(
      "none",
    )
  })
})

describe("decideDockLeave (§5.4 puro)", () => {
  it("draft ou turno ⇒ minimize; vazio ⇒ close", () => {
    expect(decideDockLeave(ctx({ hasDraft: true }))).toBe("minimize")
    expect(decideDockLeave(ctx({ turnActive: true }))).toBe("minimize")
    expect(decideDockLeave(ctx())).toBe("close")
  })
})

// --- officeEscape (executor único do Esc) -----------------------------------

describe("officeEscape — decide E executa (engine/input + composer)", () => {
  it("gravando ⇒ cancela o ditado via voice; dock e store intactos", () => {
    const s = useOfficeUi.getState()
    s.openDock(DESK_A)
    s.setRecording(true)
    expect(officeEscape()).toBe("cancel-dictation")
    const st = useOfficeUi.getState()
    expect(h.cancelDictation).toHaveBeenCalledTimes(1)
    expect(st.dockDeskId).toBe(DESK_A)
    expect(st.dockMinimized).toBe(false)
    // recording=false NÃO sai daqui — chega pelo onDictationEnded (voice.ts)
    expect(st.recording).toBe(true)
  })

  it("dock aberto com draft ⇒ minimiza (§5.4 via ctx do bridge)", () => {
    useOfficeUi.getState().openDock(DESK_A)
    h.ctx = ctx({ hasDraft: true })
    expect(officeEscape()).toBe("minimize-dock")
    const st = useOfficeUi.getState()
    expect(st.dockDeskId).toBe(DESK_A)
    expect(st.dockMinimized).toBe(true)
    expect(h.cancelDictation).not.toHaveBeenCalled()
  })

  it("dock aberto com turno ativo ⇒ minimiza", () => {
    useOfficeUi.getState().openDock(DESK_A)
    h.ctx = ctx({ turnActive: true })
    expect(officeEscape()).toBe("minimize-dock")
    expect(useOfficeUi.getState().dockMinimized).toBe(true)
  })

  it("dock aberto sem draft/turno ⇒ fecha de vez (conversa zerada)", () => {
    const s = useOfficeUi.getState()
    s.openDock(DESK_A)
    s.setDockConv("conv-1")
    expect(officeEscape()).toBe("close-dock")
    const st = useOfficeUi.getState()
    expect(st.dockDeskId).toBeNull()
    expect(st.dockConvId).toBeNull()
  })

  it("dock minimizado ⇒ none (o chip fica; Esc não sai do office)", () => {
    const s = useOfficeUi.getState()
    s.openDock(DESK_A)
    s.minimizeDock()
    expect(officeEscape()).toBe("none")
    const st = useOfficeUi.getState()
    expect(st.dockDeskId).toBe(DESK_A)
    expect(st.dockMinimized).toBe(true)
  })

  it("nada aberto, nada gravando ⇒ none (sem efeito colateral)", () => {
    expect(officeEscape()).toBe("none")
    expect(h.cancelDictation).not.toHaveBeenCalled()
  })
})

// --- extras discretos -------------------------------------------------------

describe("estado auxiliar", () => {
  it("camera-mode espelha o modo da câmera no HUD", () => {
    useOfficeUi
      .getState()
      .handleSimEvent({ kind: "camera-mode", mode: "inspect" })
    expect(useOfficeUi.getState().cameraMode).toBe("inspect")
  })

  it("parar de gravar limpa a legenda parcial junto", () => {
    const s = useOfficeUi.getState()
    s.setRecording(true)
    s.setDictationPartial("testando um dois")
    s.setRecording(false)
    const st = useOfficeUi.getState()
    expect(st.recording).toBe(false)
    expect(st.dictationPartial).toBeNull()
  })
})

// --- mesa de reunião (O-2 — lançar missão da sala comum) --------------------

describe("missionTableMenu — menu-balão da mesa de reunião", () => {
  it("sem missão (ou conversa sem missão) ⇒ Lançar missão", () => {
    expect(missionTableMenu(null)).toEqual({ kind: "launch" })
  })

  it("missão RODANDO ⇒ acompanhar com fase 1-based", () => {
    expect(
      missionTableMenu({ status: "running", current: 1, phaseCount: 3 }),
    ).toEqual({ kind: "running", phase: 2, total: 3 })
  })

  it("current além do fim clampa no total (nunca 'fase 4/3')", () => {
    expect(
      missionTableMenu({ status: "running", current: 3, phaseCount: 3 }),
    ).toEqual({ kind: "running", phase: 3, total: 3 })
  })

  it("missão terminada (done/error/aborted) volta a oferecer o lançamento", () => {
    for (const status of ["done", "error", "aborted"] as const) {
      expect(missionTableMenu({ status, current: 3, phaseCount: 3 })).toEqual({
        kind: "launch",
      })
    }
  })
})

describe("parseMissionSig — assinatura por valor do bridge", () => {
  it("parseia status:current:total", () => {
    expect(parseMissionSig("running:0:3")).toEqual({
      status: "running",
      current: 0,
      phaseCount: 3,
    })
  })

  it("null e assinatura malformada ⇒ null", () => {
    expect(parseMissionSig(null)).toBeNull()
    expect(parseMissionSig("weird")).toBeNull()
    expect(parseMissionSig("exploded:x:y")).toBeNull()
  })
})

describe("missionLaunchBlock — guardas do botão Lançar missão", () => {
  const ok = {
    hasProjects: true,
    isTauri: true,
    missionRunning: false,
    task: "arruma o parser",
  }

  it("sem projetos ⇒ CTA (vence qualquer outra guarda)", () => {
    expect(
      missionLaunchBlock({ ...ok, hasProjects: false, isTauri: false, task: "" }),
    ).toBe("sem-projeto")
  })

  it("browser puro (isTauri false) ⇒ 'requer o app'", () => {
    expect(missionLaunchBlock({ ...ok, isTauri: false })).toBe("fora-do-app")
  })

  it("missão já rodando ⇒ bloqueia relançar (guarda visível)", () => {
    expect(missionLaunchBlock({ ...ok, missionRunning: true })).toBe(
      "missao-rodando",
    )
  })

  it("tarefa vazia/só espaços ⇒ bloqueia", () => {
    expect(missionLaunchBlock({ ...ok, task: "   " })).toBe("tarefa-vazia")
  })

  it("tudo certo ⇒ null (pode lançar)", () => {
    expect(missionLaunchBlock(ok)).toBeNull()
  })
})

describe("missionConversationTitle — título da conversa da missão", () => {
  it("prefixa 'Missão · ' e colapsa whitespace", () => {
    expect(missionConversationTitle("  arruma\n o parser  ")).toBe(
      "Missão · arruma o parser",
    )
  })

  it("trunca tarefas longas com reticências", () => {
    const t = missionConversationTitle("a".repeat(100))
    expect(t.startsWith("Missão · ")).toBe(true)
    expect(t.endsWith("…")).toBe(true)
    expect(t.length).toBeLessThan(60)
  })

  it("tarefa vazia não gera título vazio", () => {
    expect(missionConversationTitle("")).toBe("Missão · sem título")
  })
})

// --- edição do TIME no form da mesa (preset + fases editáveis) ---------------

function phaseDef(over: Partial<MissionPhaseDef> = {}): MissionPhaseDef {
  return {
    id: "plan",
    label: "Planejar",
    persona: "planner",
    agent: "claude-code",
    model: null,
    effort: null,
    maxRetries: 1,
    ...over,
  }
}

function presetOf(over: Partial<MissionPreset> = {}): MissionPreset {
  return {
    id: "feature",
    name: "Feature completa",
    maxCostUsd: 25,
    phases: [
      phaseDef(),
      phaseDef({
        id: "build",
        label: "Executar",
        persona: "executor",
        agent: "codex",
      }),
      phaseDef({ id: "review", label: "Revisar", persona: "reviewer" }),
    ],
    ...over,
  }
}

describe("effectiveTablePreset — preset efetivo do lançamento", () => {
  it("sem edição ⇒ nome intacto, fases CLONADAS, teto do rascunho", () => {
    const base = presetOf()
    const eff = effectiveTablePreset(base, base.phases, 10)
    expect(eff.name).toBe("Feature completa")
    expect(eff.phases).toEqual(base.phases)
    expect(eff.phases[0]).not.toBe(base.phases[0]) // clone, nunca o preset
    expect(eff.maxCostUsd).toBe(10)
  })

  it("fase editada ⇒ '· personalizado' e o agent trocado no preset", () => {
    const base = presetOf()
    const edited = editPhase(base.phases, 1, { agent: "agy" })
    const eff = effectiveTablePreset(base, edited, null)
    expect(eff.name).toBe("Feature completa · personalizado")
    expect(eff.phases[1].agent).toBe("agy")
    expect(eff.phases[1].model).toBeNull() // troca de agent re-semeia o modelo
    expect(eff.maxCostUsd).toBeNull()
  })
})

type TableLaunchArgs = {
  projectId: string
  title: string
  task: string
  preset: MissionPreset
}

describe("launchFromTable — preset efetivo chega ao launch", () => {
  it("fase editada + teto viajam no preset; título 'Missão · …'", async () => {
    const launch = vi.fn(async (_args: TableLaunchArgs) => "conv-nova")
    const base = presetOf()
    const edited = editPhase(base.phases, 1, { agent: "agy" })
    const convId = await launchFromTable(
      { launch },
      {
        projectId: "p1",
        task: "arruma o parser",
        preset: base,
        phases: edited,
        capUsd: 12.5,
      },
    )
    expect(convId).toBe("conv-nova")
    expect(launch).toHaveBeenCalledTimes(1)
    const args = launch.mock.calls[0][0]
    expect(args.projectId).toBe("p1")
    expect(args.title).toBe("Missão · arruma o parser")
    expect(args.preset.phases[1].agent).toBe("agy")
    expect(args.preset.name).toBe("Feature completa · personalizado")
    expect(args.preset.maxCostUsd).toBe(12.5)
  })

  it("sem edição ⇒ o preset viaja limpo (nome e fases do preset)", async () => {
    const launch = vi.fn(async (_args: TableLaunchArgs) => "conv-2")
    const base = presetOf()
    await launchFromTable(
      { launch },
      {
        projectId: "p1",
        task: "t",
        preset: base,
        phases: base.phases,
        capUsd: base.maxCostUsd,
      },
    )
    const args = launch.mock.calls[0][0]
    expect(args.preset.name).toBe("Feature completa")
    expect(args.preset.phases).toEqual(base.phases)
  })
})

describe("presetDraft — troca de preset RESETA as edições", () => {
  it("rascunho novo do preset destino: fases limpas + teto dele", () => {
    const a = presetOf()
    const edited = editPhase(a.phases, 0, { agent: "codex" })
    expect(phasesCustomized(a.phases, edited)).toBe(true) // estava sujo
    const b = presetOf({ id: "barato", name: "Econômico", maxCostUsd: 5 })
    const draft = presetDraft(b)
    expect(phasesCustomized(b.phases, draft.phases)).toBe(false) // limpo
    expect(draft.capUsd).toBe(5)
    expect(draft.phases[0]).not.toBe(b.phases[0]) // clone, editar não muta
  })
})

describe("phaseAgentOptions — agent indisponível não aparece", () => {
  const available = [
    { id: "claude-code", label: "Claude Code" },
    { id: "codex", label: "Codex" },
  ]

  it("agent atual disponível ⇒ só a lista de disponíveis (opencode fora)", () => {
    const opts = phaseAgentOptions(available, "claude-code")
    expect(opts).toEqual(available)
    expect(opts.some((o) => o.id === "opencode")).toBe(false)
  })

  it("agent atual FORA do ar entra no topo (select não fica vazio), sem trazer outros indisponíveis", () => {
    const opts = phaseAgentOptions(available, "opencode")
    expect(opts[0].id).toBe("opencode")
    expect(opts.slice(1)).toEqual(available)
  })
})

describe("presetOptionLabel — nome + nº de fases", () => {
  it("plural e singular", () => {
    expect(presetOptionLabel(presetOf())).toBe("Feature completa · 3 fases")
    expect(
      presetOptionLabel(presetOf({ name: "Solo", phases: [phaseDef()] })),
    ).toBe("Solo · 1 fase")
  })
})

describe("mesa de reunião no store de UI", () => {
  it("deskMenuPrimary abre o dock genérico pro id da mesa de reunião", () => {
    deskMenuPrimary(MISSION_TABLE_ID)
    const s = useOfficeUi.getState()
    expect(s.dockDeskId).toBe(MISSION_TABLE_ID)
    expect(s.dockMinimized).toBe(false)
    expect(s.dockConvId).toBeNull() // nunca resolve conversa de mesa pra ela
  })

  it("deskMenuPrimary da MESA DO BOSS pede a Central (nunca abre dock)", () => {
    deskMenuPrimary(BOSS_DESK_ID)
    const s = useOfficeUi.getState()
    expect(s.bossCenterRequested).toBe(true) // OfficeMode consome e abre
    expect(s.dockDeskId).toBeNull() // posto de comando não tem dock
    s.clearBossCenterRequest()
    expect(useOfficeUi.getState().bossCenterRequested).toBe(false)
  })

  it("deskMenuPrimary da MESA DO BOSS com gate-visit vira 'Responder': abre o dock do agent", () => {
    // agent esperando DECISÃO em pé na mesa do Boss (espelho do pack mission)
    useOfficeUi.setState({ gateVisit: { deskId: DESK_A, waiting: true } })
    deskMenuPrimary(BOSS_DESK_ID)
    const s = useOfficeUi.getState()
    expect(s.dockDeskId).toBe(DESK_A) // dock da mesa DELE (gate card no fio)
    expect(s.dockMinimized).toBe(false)
    expect(s.bossCenterRequested).toBe(false) // a Central fica na secundária
  })

  it("deskMenuPrimary do QUADRO DE AVISOS abre a view Agendado (nunca dock)", () => {
    deskMenuPrimary(NOTICE_BOARD_ID)
    const s = useOfficeUi.getState()
    expect(h.openScheduledView).toHaveBeenCalledTimes(1) // bridge → useApp
    expect(s.dockDeskId).toBeNull() // quadro é read-only, sem dock
    expect(s.bossCenterRequested).toBe(false)
  })

  it("setMissionTableConv registra/limpa a conversa da missão lançada", () => {
    useOfficeUi.getState().setMissionTableConv("conv-missao")
    expect(useOfficeUi.getState().missionTableConvId).toBe("conv-missao")
    useOfficeUi.getState().setMissionTableConv(null)
    expect(useOfficeUi.getState().missionTableConvId).toBeNull()
  })
})

// --- painel de missão no dock da mesa (task #14) ----------------------------

describe("showsMissionPanel — dock da mesa vira painel de missão", () => {
  it("mesa hospedando missão RODANDO ⇒ painel toma o corpo do dock", () => {
    expect(showsMissionPanel({ status: "running" })).toBe(true)
  })

  it("sem missão na conversa da mesa (null) ⇒ comportamento atual intacto", () => {
    expect(showsMissionPanel(null)).toBe(false)
  })

  it("missão terminada (done/error/aborted) ⇒ volta à conversa da mesa", () => {
    for (const status of ["done", "error", "aborted"]) {
      expect(showsMissionPanel({ status })).toBe(false)
    }
  })
})

describe("missionPanelSubtitle — cabeçalho contextual do dock em missão", () => {
  it("fase 1-based + persona da fase corrente", () => {
    expect(
      missionPanelSubtitle({ current: 1, total: 3, persona: "executor" }),
    ).toBe("Executando missão · fase 2/3 · executor")
  })

  it("current além do fim clampa no total (nunca 'fase 4/3')", () => {
    expect(
      missionPanelSubtitle({ current: 3, total: 3, persona: "revisor" }),
    ).toBe("Executando missão · fase 3/3 · revisor")
  })
})

// --- janela do histórico do dock (S2 — perf) --------------------------------

describe("dockItemsStart — cauda de DOCK_ITEMS_WINDOW itens", () => {
  it("lista curta renderiza inteira (start 0)", () => {
    expect(dockItemsStart(0, false)).toBe(0)
    expect(dockItemsStart(DOCK_ITEMS_WINDOW, false)).toBe(0)
  })

  it("lista longa renderiza só a cauda", () => {
    expect(dockItemsStart(DOCK_ITEMS_WINDOW + 1, false)).toBe(1)
    expect(dockItemsStart(200, false)).toBe(200 - DOCK_ITEMS_WINDOW)
  })

  it("'ver tudo' abre a lista inteira", () => {
    expect(dockItemsStart(200, true)).toBe(0)
  })
})

// --- fala do boss (balão curto na cena, §5.4 v2) ----------------------------

describe("sayAsBoss — balão curto sobre o boss", () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it("trunca em 60 chars e colapsa whitespace", () => {
    useOfficeUi.getState().sayAsBoss(`  ${"a".repeat(80)}  `)
    const say = useOfficeUi.getState().bossSay
    expect(say?.text).toBe(`${"a".repeat(60)}…`)
  })

  it("texto vazio/só espaços não vira balão", () => {
    useOfficeUi.getState().sayAsBoss("   \n  ")
    expect(useOfficeUi.getState().bossSay).toBeNull()
  })

  it("expira sozinho após BOSS_SAY_MS", () => {
    useOfficeUi.getState().sayAsBoss("oi, status do projeto?")
    expect(useOfficeUi.getState().bossSay?.text).toBe("oi, status do projeto?")
    vi.advanceTimersByTime(BOSS_SAY_MS + 10)
    expect(useOfficeUi.getState().bossSay).toBeNull()
  })

  it("fala nova supersede a anterior (o TTL antigo não apaga a nova)", () => {
    const s = useOfficeUi.getState()
    s.sayAsBoss("primeira")
    vi.advanceTimersByTime(BOSS_SAY_MS - 500)
    s.sayAsBoss("segunda")
    vi.advanceTimersByTime(600) // TTL da primeira dispara — a segunda FICA
    expect(useOfficeUi.getState().bossSay?.text).toBe("segunda")
    vi.advanceTimersByTime(BOSS_SAY_MS)
    expect(useOfficeUi.getState().bossSay).toBeNull()
  })
})

// --- revezamento (troca de provedor após limite/erro — entregas 1) ----------

describe("revezamentoTargets — alvos do revezamento", () => {
  const agents = [
    { id: "claude-code", label: "Claude Code" },
    { id: "codex", label: "Codex" },
    { id: "agy", label: "Antigravity" },
  ]

  it("exclui o agent atual e mantém os outros", () => {
    expect(revezamentoTargets("claude-code", agents)).toEqual([
      { id: "codex", label: "Codex" },
      { id: "agy", label: "Antigravity" },
    ])
  })

  it("nenhum outro agent ⇒ lista vazia (nada pra revezar)", () => {
    expect(revezamentoTargets("codex", [{ id: "codex", label: "Codex" }])).toEqual(
      [],
    )
  })
})

describe("pickRevezamento — chama continueInAgent com o alvo certo", () => {
  it("encaminha (args, targetAgent) pro continueInAgent injetado", () => {
    const continueInAgent = vi.fn()
    const args = {
      convId: "c1",
      projectId: "p1",
      projectPath: "/tmp/p1",
      agent: "claude-code",
      text: "",
    }
    pickRevezamento({ continueInAgent }, args, "codex")
    expect(continueInAgent).toHaveBeenCalledTimes(1)
    expect(continueInAgent).toHaveBeenCalledWith(args, "codex")
  })
})

// --- recuperação de missão (card do MissionDock — entrega 3) -----------------

describe("buildRecoveryChoice — escolha do card de recuperação", () => {
  it("'default' vira null (agent decide) — modelo e effort", () => {
    expect(buildRecoveryChoice("codex", "default")).toEqual({
      agent: "codex",
      model: null,
      effort: null,
    })
  })

  it("modelo/effort reais são preservados", () => {
    expect(buildRecoveryChoice("claude-code", "opus", "high")).toEqual({
      agent: "claude-code",
      model: "opus",
      effort: "high",
    })
  })

  it("modelo null direto também vira null", () => {
    expect(buildRecoveryChoice("agy", null)).toEqual({
      agent: "agy",
      model: null,
      effort: null,
    })
  })
})

describe("applyRecovery / cancelRecovery — chamam resolve/abort certos", () => {
  it("applyRecovery chama resolve(convId, choice)", () => {
    const resolve = vi.fn()
    const abort = vi.fn()
    const choice = { agent: "codex", model: null, effort: null }
    applyRecovery({ resolve, abort }, "conv-x", choice)
    expect(resolve).toHaveBeenCalledWith("conv-x", choice)
    expect(abort).not.toHaveBeenCalled()
  })

  it("cancelRecovery chama abort(convId) (desistir)", () => {
    const resolve = vi.fn()
    const abort = vi.fn()
    cancelRecovery({ resolve, abort }, "conv-x")
    expect(abort).toHaveBeenCalledWith("conv-x")
    expect(resolve).not.toHaveBeenCalled()
  })
})
