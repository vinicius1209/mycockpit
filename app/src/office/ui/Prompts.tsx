// Overlays DOM ancorados no mundo (§6): menu-balão de proximidade (DeskMenu),
// falas na cena (balão do BOSS ao enviar + streaming sobre o AGENT), balões de
// entrega e legenda de ditado. A ESTRUTURA renderiza por transições discretas
// (store); a POSIÇÃO é escrita via translate3d no MESMO rAF do render da cena
// (frame() recebe o worldToScreen interpolado + a âncora do boss do stage —
// zero wobble). Raiz pointer-events-none (o menu reabilita nos botões), balões
// opacos, tamanho fixo de tela (só o anchor projeta).
//
// Hot path: NADA aqui assina o ConvState inteiro — o streaming entra por
// seletor estreito (useDeskStreamSnippet, por VALOR) sempre que a mesa do dock
// tem turno rodando (§5.4 v2 — não só minimizado) e as entregas vêm PRONTAS do
// snapshot: o bridge/derive é o dono único do TTL.
import { forwardRef, useImperativeHandle, useMemo, useRef } from "react"
import {
  BOSS_DESK_ID,
  NOTICE_BOARD_ID,
  type DeskPlacement,
  type DeskSnapshot,
  type FloorPlan,
  type Vec2,
} from "@/lib/fleet/types"
import { deskAnchorWorld } from "../scene/logic"
import { GATE_WAIT_OFFSET } from "../scene/behaviors/mission"
import { useDeskStreamSnippet } from "../bridge/hooks"
import {
  BossDeskMenu,
  DeskMenu,
  GateVisitMenu,
  MissionTableMenu,
  NoticeBoardMenu,
} from "./DeskMenu"
import { MISSION_TABLE_ID } from "./missionTable"
import { useOfficeUi } from "./store"

export type PromptsHandle = {
  /** Chamar no MESMO rAF do render da cena, DEPOIS do update da câmera.
   *  `bossScreen` = âncora do boss em px de tela (stage.bossScreen()). */
  frame: (
    worldToScreen: (wx: number, wy: number) => Vec2,
    bossScreen: Vec2,
  ) => void
}

/** deskId sentinela dos balões ancorados no BOSS (posição vem do stage). */
const BOSS_ANCHOR = "@boss"

/** Âncora do PONTO DE ESPERA do gate-visit: onde o agent fica em pé na frente
 *  da mesa do Boss (interactTile do posto de comando) — o balão "✋" fica
 *  sobre a cabeça DELE, não sobre o tampo da mesa. */
const GATE_WAIT_ANCHOR = "@gate-wait"

/** Balões da cena são de RELANCE: ~2 linhas / ~90 chars. O line-clamp corta
 *  visualmente; o corte de texto evita uma palavra gigante furar a largura. */
const clampSay = (s: string): string => (s.length > 90 ? `${s.slice(0, 89)}…` : s)

/** Bolinhas "pensando" (… animado) pro balão de streaming sem output. */
function ThinkingDots() {
  return (
    <span className="flex items-center gap-1 py-0.5">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="size-1.5 rounded-full bg-foreground/60 motion-safe:animate-bounce"
          style={{ animationDelay: `${i * 160}ms` }}
        />
      ))}
    </span>
  )
}

export const Prompts = forwardRef<PromptsHandle, { plan: FloorPlan | null }>(
  function Prompts({ plan }, ref) {
    const nearDeskId = useOfficeUi((s) => s.nearDeskId)
    const dockDeskId = useOfficeUi((s) => s.dockDeskId)
    const dockMinimized = useOfficeUi((s) => s.dockMinimized)
    const dockConvId = useOfficeUi((s) => s.dockConvId)
    const recording = useOfficeUi((s) => s.recording)
    const partial = useOfficeUi((s) => s.dictationPartial)
    const snapshot = useOfficeUi((s) => s.snapshot)
    const bossSay = useOfficeUi((s) => s.bossSay)
    // Gate-visit: agent em pé na mesa do Boss esperando decisão (pack mission
    // da cena → store). waiting=true acende o balão "✋" no ponto de espera.
    const gateVisit = useOfficeUi((s) => s.gateVisit)

    const desks = useMemo(() => {
      const m = new Map<string, DeskPlacement>()
      for (const r of plan?.rooms ?? [])
        for (const d of r.desks) m.set(d.id, d)
      return m
    }, [plan])
    // Tiles-âncora da projeção: mesas + interactables sem mesa (mesa de
    // reunião — O-2). O frame() só precisa do tile; o resto do DeskPlacement
    // fica no mapa de mesas (menu/deliveries).
    const anchorPoints = useMemo(() => {
      const m = new Map<string, Vec2>()
      for (const [id, d] of desks) m.set(id, deskAnchorWorld(d.tile))
      for (const it of plan?.interactables ?? []) {
        m.set(it.id, it.tile)
        // ponto de espera do gate-visit: atendimento do posto de comando
        // (targets.bossDesk = interactTile+0.5) + o MESMO deslocamento
        // lateral do pack — o balão "✋" cai sobre a cabeça do walker
        if (it.id === BOSS_DESK_ID) {
          m.set(GATE_WAIT_ANCHOR, {
            x: it.interactTile.x + 0.5 + GATE_WAIT_OFFSET.x,
            y: it.interactTile.y + 0.5 + GATE_WAIT_OFFSET.y,
          })
        }
      }
      return m
    }, [desks, plan])
    const anchorPointsRef = useRef(anchorPoints)
    anchorPointsRef.current = anchorPoints

    /** DeskSnapshot da mesa `id` no último snapshot (estado vivo p/ menu). */
    const snapOf = (id: string | null): DeskSnapshot | undefined => {
      if (!id || !snapshot) return undefined
      for (const room of snapshot.rooms)
        for (const d of room.desks) if (d.id === id) return d
      return undefined
    }

    // chave única do overlay → { el, deskId } (posicionado pelo frame()).
    // Chave própria (não o deskId): a MESMA mesa pode ter mais de um balão
    // (ex.: entrega + ditado) sem um sobrescrever o outro no mapa.
    const anchors = useRef(
      new Map<string, { el: HTMLDivElement; deskId: string }>(),
    )
    // Callback refs ESTÁVEIS por chave (cache): ref novo a cada render faria o
    // React desanexar/reanexar TODOS os anchors por re-render — hot path.
    const refFns = useRef(
      new Map<string, (el: HTMLDivElement | null) => void>(),
    )
    const anchorRef = (key: string, deskId: string) => {
      let fn = refFns.current.get(key)
      if (!fn) {
        fn = (el: HTMLDivElement | null) => {
          if (el) anchors.current.set(key, { el, deskId })
          else {
            anchors.current.delete(key)
            refFns.current.delete(key) // chave morta (balão saiu) não acumula
          }
        }
        refFns.current.set(key, fn)
      }
      return fn
    }

    useImperativeHandle(
      ref,
      () => ({
        frame(worldToScreen, bossScreen) {
          for (const { el, deskId } of anchors.current.values()) {
            let p: Vec2
            if (deskId === BOSS_ANCHOR) {
              p = bossScreen
            } else {
              const t = anchorPointsRef.current.get(deskId)
              if (!t) continue
              p = worldToScreen(t.x, t.y)
            }
            el.style.transform = `translate3d(${Math.round(p.x)}px, ${Math.round(p.y)}px, 0)`
          }
        },
      }),
      [],
    )

    // Entregas: o snapshot JÁ vem expirado pelo derive (TTL único, lá) — aqui
    // só se filtra o que tem mesa na planta (âncora) e memoiza por snapshot.
    const deliveries = useMemo(
      () => (snapshot?.deliveries ?? []).filter((d) => desks.has(d.deskId)),
      [snapshot, desks],
    )

    const dockOpen = dockDeskId !== null && !dockMinimized
    // Menu-balão de proximidade (§5.2 v2): mesa em alcance e SEM dock aberto
    // pra ela. Sair do raio (nearDeskId=null) e abrir o dock fecham o menu.
    const menuDeskId =
      nearDeskId && (!dockOpen || nearDeskId !== dockDeskId) ? nearDeskId : null
    // Mesa de reunião (O-2): menu próprio (lançar/acompanhar missão) — o
    // DeskMenu de agent não se aplica (não há DeskPlacement pro id).
    const missionMenu = menuDeskId === MISSION_TABLE_ID
    // Mesa do Boss (posto de comando, §8): menu próprio "Abrir Central" — ou,
    // com um agent esperando DECISÃO ali (gate-visit), o menu "✋ Responder".
    // Com o dock DELE já aberto (Responder cumprido), o balão sai da frente.
    const gateDesk = gateVisit ? desks.get(gateVisit.deskId) : undefined
    const gateHandled =
      gateVisit !== null && !dockMinimized && dockDeskId === gateVisit.deskId
    const bossDeskMenu = menuDeskId === BOSS_DESK_ID && !gateHandled
    // Quadro de avisos do corredor: menu próprio com os agendados (read-only).
    const boardMenu = menuDeskId === NOTICE_BOARD_ID
    const menuDesk =
      menuDeskId && !missionMenu && !bossDeskMenu && !boardMenu
        ? desks.get(menuDeskId)
        : undefined

    // Legenda do ditado ao vivo sobre a mesa do dock (§5.5).
    const dictationDeskId = recording && dockDeskId ? dockDeskId : null
    // Balão de streaming: turno da mesa do dock rodando. O texto vem do conv
    // (snippet); sem output ainda (pensando) ⇒ "…" animado — o sinal de "está
    // rodando" vem do SNAPSHOT (typing/thinking), que também cobre a fixture.
    const dockSnap = snapOf(dockDeskId)
    const dockSnapState = dockSnap?.state
    const dockTurnLive =
      dockSnapState === "typing" || dockSnapState === "thinking"
    // Texto e "vivo" saem da MESMA conversa: a que acendeu a mesa (snapshot);
    // o dockConvId só entra quando a mesa não carimbou nenhuma. Sem isso, uma
    // divergência entre as duas deixava "…" animado eternamente sem texto.
    // Seletor por VALOR (string|null): só re-renderiza quando o snippet muda.
    const streamText = useDeskStreamSnippet(
      dockSnap?.convId ?? dockConvId,
      dockDeskId !== null,
    )
    const streamDeskId =
      dockDeskId && (streamText !== null || dockTurnLive) ? dockDeskId : null

    return (
      <div
        className="pointer-events-none absolute inset-0 z-10 overflow-hidden"
      >
        {menuDesk && (
          <div
            ref={anchorRef(`menu:${menuDesk.id}`, menuDesk.id)}
            className="absolute top-0 left-0 will-change-transform"
          >
            <div className="-translate-x-1/2 translate-y-[calc(-100%_-_84px)]">
              <DeskMenu desk={menuDesk} snap={snapOf(menuDesk.id)} />
            </div>
          </div>
        )}

        {missionMenu && (
          <div
            ref={anchorRef(`menu:${MISSION_TABLE_ID}`, MISSION_TABLE_ID)}
            className="absolute top-0 left-0 will-change-transform"
          >
            <div className="-translate-x-1/2 translate-y-[calc(-100%_-_84px)]">
              <MissionTableMenu />
            </div>
          </div>
        )}

        {bossDeskMenu && (
          <div
            ref={anchorRef(`menu:${BOSS_DESK_ID}`, BOSS_DESK_ID)}
            className="absolute top-0 left-0 will-change-transform"
          >
            <div className="-translate-x-1/2 translate-y-[calc(-100%_-_84px)]">
              {gateVisit && gateDesk ? (
                <GateVisitMenu desk={gateDesk} snap={snapOf(gateDesk.id)} />
              ) : (
                <BossDeskMenu />
              )}
            </div>
          </div>
        )}

        {/* balão "✋" do gate-visit: o agent CHEGOU e espera em pé na frente da
            mesa do Boss; some quando o menu (que já diz tudo) está aberto */}
        {gateVisit?.waiting && !bossDeskMenu && (
          <div
            ref={anchorRef(`gate:${GATE_WAIT_ANCHOR}`, GATE_WAIT_ANCHOR)}
            className="absolute top-0 left-0 will-change-transform"
          >
            <div className="-translate-x-1/2 -translate-y-[118px]">
              <div className="relative w-max rounded-lg border border-st-queued/60 bg-card px-2.5 py-1.5 text-[12px] leading-snug shadow-md motion-safe:animate-in motion-safe:fade-in-0 motion-safe:zoom-in-95 motion-safe:duration-200">
                <p className="text-foreground/90">
                  <span aria-hidden="true">✋</span> Preciso de uma decisão
                </p>
                <span className="absolute -bottom-[5px] left-1/2 size-2 -translate-x-1/2 rotate-45 border-r border-b border-st-queued/60 bg-card" />
              </div>
            </div>
          </div>
        )}

        {boardMenu && (
          <div
            ref={anchorRef(`menu:${NOTICE_BOARD_ID}`, NOTICE_BOARD_ID)}
            className="absolute top-0 left-0 will-change-transform"
          >
            {/* o quadro é desenhado ALTO na parede — folga maior que a das mesas */}
            <div className="-translate-x-1/2 translate-y-[calc(-100%_-_96px)]">
              <NoticeBoardMenu />
            </div>
          </div>
        )}

        {bossSay && (
          <div
            ref={anchorRef("boss-say", BOSS_ANCHOR)}
            className="absolute top-0 left-0 will-change-transform"
          >
            <div className="-translate-x-1/2 translate-y-[calc(-100%_-_118px)]">
              <div className="relative max-w-[240px] rounded-lg border border-brass/60 bg-card px-2.5 py-1.5 text-[12px] leading-snug shadow-md motion-safe:animate-in motion-safe:fade-in-0 motion-safe:zoom-in-95 motion-safe:duration-200">
                <p className="line-clamp-2 text-foreground/90">{clampSay(bossSay.text)}</p>
                <span className="absolute -bottom-[5px] left-1/2 size-2 -translate-x-1/2 rotate-45 border-r border-b border-brass/60 bg-card" />
              </div>
            </div>
          </div>
        )}

        {deliveries.map((d) => (
          <div
            key={`${d.deskId}-${d.at}`}
            ref={anchorRef(`delivery:${d.deskId}:${d.at}`, d.deskId)}
            className="absolute top-0 left-0 will-change-transform"
          >
            <div className="-translate-x-1/2 -translate-y-[110px]">
              <div className="max-w-[240px] rounded-lg rounded-bl-sm border border-st-success/50 bg-card px-2.5 py-1.5 text-[12px] leading-snug shadow-md motion-safe:animate-in motion-safe:fade-in-0 motion-safe:zoom-in-95 motion-safe:duration-200">
                <p className="line-clamp-2 text-foreground/90">{clampSay(d.text)}</p>
              </div>
            </div>
          </div>
        ))}

        {dictationDeskId && desks.has(dictationDeskId) && (
          <div
            ref={anchorRef(`dictation:${dictationDeskId}`, dictationDeskId)}
            className="absolute top-0 left-0 will-change-transform"
          >
            <div className="-translate-x-1/2 -translate-y-[110px]">
              <div className="flex max-w-[240px] items-center gap-1.5 rounded-lg border border-st-running/50 bg-card px-2.5 py-1.5 text-[12px] shadow-md motion-safe:animate-in motion-safe:fade-in-0 motion-safe:duration-200">
                <span className="size-1.5 shrink-0 rounded-full bg-st-error motion-safe:animate-pulse" />
                <span className="truncate text-foreground/90">
                  {partial?.trim() ? partial : "Ouvindo…"}
                </span>
              </div>
            </div>
          </div>
        )}

        {streamDeskId && desks.has(streamDeskId) && (
          <div
            ref={anchorRef(`stream:${streamDeskId}`, streamDeskId)}
            className="absolute top-0 left-0 will-change-transform"
          >
            <div className="-translate-x-1/2 -translate-y-[124px]">
              <div className="max-w-[240px] rounded-lg rounded-bl-sm border border-st-running/50 bg-card px-2.5 py-1.5 text-[12px] leading-snug shadow-md motion-safe:animate-in motion-safe:fade-in-0 motion-safe:duration-200">
                {streamText ? (
                  <p className="line-clamp-2 text-foreground/90">{clampSay(streamText)}</p>
                ) : (
                  <ThinkingDots />
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    )
  },
)
