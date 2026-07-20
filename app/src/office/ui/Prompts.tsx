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
import type {
  DeskPlacement,
  DeskSnapshot,
  FloorPlan,
  Vec2,
} from "../engine/types"
import { useDeskStreamSnippet } from "../bridge/hooks"
import { DeskMenu, MissionTableMenu } from "./DeskMenu"
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
    // Streaming vira balão sobre o agent SEMPRE que a mesa do dock tem turno
    // rodando (§5.4 v2) — dock aberto incluso (o dock mostra o texto pleno).
    // Seletor por VALOR (string|null): só re-renderiza quando o snippet muda.
    const streamText = useDeskStreamSnippet(dockConvId, dockDeskId !== null)

    const desks = useMemo(() => {
      const m = new Map<string, DeskPlacement>()
      for (const r of plan?.rooms ?? [])
        for (const d of r.desks) m.set(d.id, d)
      return m
    }, [plan])
    // Tiles-âncora da projeção: mesas + interactables sem mesa (mesa de
    // reunião — O-2). O frame() só precisa do tile; o resto do DeskPlacement
    // fica no mapa de mesas (menu/deliveries).
    const anchorTiles = useMemo(() => {
      const m = new Map<string, Vec2>()
      for (const [id, d] of desks) m.set(id, d.tile)
      for (const it of plan?.interactables ?? []) m.set(it.id, it.tile)
      return m
    }, [desks, plan])
    const anchorTilesRef = useRef(anchorTiles)
    anchorTilesRef.current = anchorTiles

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
              const t = anchorTilesRef.current.get(deskId)
              if (!t) continue
              // Âncora no centro do tile da mesa; o offset visual (subir o
              // balão) é CSS fixo dentro do elemento — só o anchor projeta.
              p = worldToScreen(t.x + 0.5, t.y + 0.5)
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
    const menuDesk =
      menuDeskId && !missionMenu ? desks.get(menuDeskId) : undefined

    // Legenda do ditado ao vivo sobre a mesa do dock (§5.5).
    const dictationDeskId = recording && dockDeskId ? dockDeskId : null
    // Balão de streaming: turno da mesa do dock rodando. O texto vem do conv
    // (snippet); sem output ainda (pensando) ⇒ "…" animado — o sinal de "está
    // rodando" vem do SNAPSHOT (typing/thinking), que também cobre a fixture.
    const dockSnapState = snapOf(dockDeskId)?.state
    const dockTurnLive =
      dockSnapState === "typing" || dockSnapState === "thinking"
    const streamDeskId =
      dockDeskId && (streamText !== null || dockTurnLive) ? dockDeskId : null

    return (
      <div
        aria-hidden="true"
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
