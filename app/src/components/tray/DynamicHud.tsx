import { useEffect, useRef, useState } from "react"
import { MotionConfig, motion, useReducedMotion } from "motion/react"
import { invoke } from "@tauri-apps/api/core"
import { listen, type UnlistenFn } from "@tauri-apps/api/event"
import { getCurrentWindow } from "@tauri-apps/api/window"
import { DynamicHudCompact } from "@/components/tray/DynamicHudCompact"
import { DynamicHudExpanded } from "@/components/tray/DynamicHudExpanded"
import { setHudExpanded, type HudRuntimeView } from "@/lib/hud"
import type { TraySnapshot } from "@/lib/tray"
import { cn } from "@/lib/utils"

const EMPTY: TraySnapshot = {
  running: 0,
  decisions: 0,
  blocking: 0,
  activities: [],
  decisionConvId: null,
  decisionProjectId: null,
  nextSchedule: null,
  lastRun: null,
  lastTurn: null,
  enabledSchedules: 0,
  deferred: 0,
  external: [],
}

export function DynamicHud({ runtime }: { runtime: HudRuntimeView }) {
  const [snapshot, setSnapshot] = useState<TraySnapshot>(EMPTY)
  const [now, setNow] = useState(Date.now())
  const [closing, setClosing] = useState(false)
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const collapseTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const hoverBlockedUntilLeave = useRef(false)
  const nativeCollapseCommitted = useRef(false)
  const reduceMotion = useReducedMotion()
  const expanded = runtime.expanded
  const position = runtime.effectivePosition
  const notch = position === "notch"
  const primary = snapshot.activities[0]
  const requiresDecision = snapshot.decisions > 0

  const cancelCollapse = () => {
    if (nativeCollapseCommitted.current) return
    if (leaveTimer.current) clearTimeout(leaveTimer.current)
    leaveTimer.current = null
    if (collapseTimer.current) clearTimeout(collapseTimer.current)
    collapseTimer.current = null
    setClosing(false)
  }

  const changeExpanded = (
    next: boolean,
    focus = false,
    blockHover = false,
    autoCollapse = false,
  ) => {
    if (next) {
      if (nativeCollapseCommitted.current) return
      cancelCollapse()
      void setHudExpanded(true, focus, autoCollapse).catch((cause) =>
        console.error("Falha ao redimensionar o instrumento:", cause),
      )
      return
    }
    if (collapseTimer.current) return
    if (blockHover) hoverBlockedUntilLeave.current = true
    if (reduceMotion) {
      void setHudExpanded(false, false).catch((cause) => {
        nativeCollapseCommitted.current = false
        console.error("Falha ao redimensionar o instrumento:", cause)
      })
      return
    }
    setClosing(true)
    collapseTimer.current = setTimeout(() => {
      collapseTimer.current = null
      void setHudExpanded(false, false).catch((cause) => {
        nativeCollapseCommitted.current = false
        setClosing(false)
        console.error("Falha ao redimensionar o instrumento:", cause)
      })
    }, 140)
  }

  useEffect(() => {
    if (!expanded) {
      nativeCollapseCommitted.current = false
      setClosing(false)
    }
  }, [expanded])

  useEffect(() => {
    document.documentElement.classList.add("tray-surface")
    void invoke<TraySnapshot>("get_tray_snapshot")
      .then(setSnapshot)
      .catch((cause) => console.error("Snapshot da bandeja indisponível:", cause))
    let disposed = false
    const unlisteners: UnlistenFn[] = []
    const track = (request: Promise<UnlistenFn>) =>
      void request
        .then((unlisten) => {
          if (disposed) unlisten()
          else unlisteners.push(unlisten)
        })
        .catch((cause) => console.warn("Listener do instrumento indisponível:", cause))
    track(
      listen<TraySnapshot>("tray://snapshot", (event) => {
        setSnapshot(event.payload)
        setNow(Date.now())
      }),
    )
    track(
      listen<string>("app://theme", (event) => {
        const dark = event.payload === "dark"
        document.documentElement.classList.toggle("dark", dark)
        void getCurrentWindow()
          .setTheme(dark ? "dark" : "light")
          .catch((cause) => console.warn("Tema do instrumento indisponível:", cause))
      }),
    )
    track(
      listen("hud://hover-leave", () => {
        nativeCollapseCommitted.current = true
        changeExpanded(false)
      }),
    )
    const timer = window.setInterval(() => {
      if (!document.hidden) setNow(Date.now())
    }, 30_000)
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") changeExpanded(false, false, true)
    }
    window.addEventListener("keydown", keydown)
    return () => {
      disposed = true
      unlisteners.forEach((unlisten) => unlisten())
      window.clearInterval(timer)
      window.removeEventListener("keydown", keydown)
      if (hoverTimer.current) clearTimeout(hoverTimer.current)
      if (leaveTimer.current) clearTimeout(leaveTimer.current)
      if (collapseTimer.current) clearTimeout(collapseTimer.current)
      document.documentElement.classList.remove("tray-surface")
    }
  }, [])

  const enter = () => {
    if (nativeCollapseCommitted.current) return
    cancelCollapse()
    if (expanded || !runtime.hoverExpand || hoverBlockedUntilLeave.current) return
    hoverTimer.current = setTimeout(() => changeExpanded(true, false, false, true), 90)
  }

  const leave = () => {
    hoverBlockedUntilLeave.current = false
    if (hoverTimer.current) clearTimeout(hoverTimer.current)
    if (!expanded) return
    leaveTimer.current = setTimeout(() => changeExpanded(false), 320)
  }

  const statusText = requiresDecision
    ? `${snapshot.decisions} ${snapshot.decisions === 1 ? "decisão" : "decisões"}`
    : snapshot.running > 0
      ? `${snapshot.running} em voo`
      : "Frota pronta"

  return (
    <MotionConfig reducedMotion="user">
      <main className="flex h-screen w-screen select-none" onPointerEnter={enter} onPointerLeave={leave}>
        <motion.section
          initial={false}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.16 }}
          className={cn(
            "dynamic-hud-shell dark h-full w-full overflow-hidden bg-hud-shell text-popover-foreground",
            !notch && "shadow-[var(--shadow-pop)]",
            position === "notch" && "rounded-b-[13px] border-x border-b",
            position === "island" && "rounded-b-[13px] border-x border-b",
            position === "left" && "rounded-r-[13px] border-y border-r",
            position === "right" && "rounded-l-[13px] border-y border-l",
            position === "bottom" && "rounded-t-[13px] border-x border-t",
          )}
          aria-label="Instrumento da Frota"
        >
          {!expanded ? (
            <DynamicHudCompact
              runtime={runtime}
              snapshot={snapshot}
              primary={primary}
              statusText={statusText}
              now={now}
              onExpand={() => changeExpanded(true, true, false, true)}
            />
          ) : (
            <DynamicHudExpanded snapshot={snapshot} now={now} statusText={statusText} closing={closing} />
          )}
        </motion.section>
      </main>
    </MotionConfig>
  )
}
