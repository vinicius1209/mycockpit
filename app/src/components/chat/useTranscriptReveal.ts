import {
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react"
import type { TranscriptRevealRequest } from "@/store/appTypes"
import type { ChatItem } from "@/store/chat"

/** Revela uma fonte do mapa sem inferir o wrapper do transcript nem usar
 * scrollIntoView, que desloca superfícies flexíveis inteiras (ADR-122). */
export function useTranscriptReveal({
  reveal,
  items,
  threadItems,
  hiddenCount,
  windowStart,
  setShowAll,
}: {
  reveal: TranscriptRevealRequest | null | undefined
  items: readonly ChatItem[]
  threadItems: readonly ChatItem[]
  hiddenCount: number
  windowStart: number
  setShowAll: Dispatch<SetStateAction<boolean>>
}) {
  const [revealedItemId, setRevealedItemId] = useState<string | null>(null)
  const handledRevealRef = useRef<number | null>(null)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!reveal || !items.some((item) => item.id === reveal.itemId)) return
    if (handledRevealRef.current === reveal.nonce) return
    if (hiddenCount > 0) {
      const targetIndex = threadItems.findIndex(
        (item) => item.id === reveal.itemId,
      )
      if (targetIndex >= 0 && targetIndex < windowStart) {
        setShowAll(true)
        return
      }
    }
    const frame = requestAnimationFrame(() => {
      const root = listRef.current
      const scroller = root?.closest<HTMLElement>("[data-chat-scroll]")
      const targets = root?.querySelectorAll<HTMLElement>("[data-chat-item-ids]")
      const target = [...(targets ?? [])].find((element) =>
        (element.dataset.chatItemIds ?? "").split(" ").includes(reveal.itemId),
      )
      if (!root || !scroller || !target) return
      handledRevealRef.current = reveal.nonce
      const top =
        target.getBoundingClientRect().top -
        scroller.getBoundingClientRect().top +
        scroller.scrollTop -
        72
      const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches
      scroller.scrollTo({
        top: Math.max(0, top),
        behavior: reduced ? "auto" : "smooth",
      })
      setRevealedItemId(reveal.itemId)
    })
    const clear = window.setTimeout(() => setRevealedItemId(null), 1_800)
    return () => {
      cancelAnimationFrame(frame)
      clearTimeout(clear)
    }
  }, [hiddenCount, items, reveal, setShowAll, threadItems, windowStart])

  return { listRef, revealedItemId }
}
