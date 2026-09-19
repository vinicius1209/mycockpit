// AS MINIATURAS DO FIO: evidência de tool, anexo do histórico e o selo de
// leitura. Saiu do `MessageList.tsx` quando a catraca de tamanho disparou, e é
// recorte fechado: tudo aqui responde "como uma imagem aparece na conversa".
//
// É também o lugar onde a imagem vira FONTE de arrasto (capricho R8): a
// miniatura leva o anexo ao composer pelo mesmo motor de ponteiro das outras
// fontes (ADR-214). Quem não pode ser arrastado (PDF, arquivo sumido) não
// oferece o gesto.

import { useEffect, useState } from "react"
import { FileText } from "lucide-react"
import { cn } from "@/lib/utils"
import { attachmentUrl, type Attachment } from "@/lib/attachments"
import { EVIDENCE_MISSING, evidenceName, evidenceUrl } from "@/lib/evidence"
import type { LightboxImage } from "@/store/lightbox"
import { iniciarArrasto } from "@/components/common/CamadaDeArrasto"

/** Galeria de lightbox a partir dos paths de evidência de UMA tool. */
export function evidenceGallery(paths: string[]): LightboxImage[] {
  return paths.map((path) => ({
    path,
    name: evidenceName(path),
    source: "evidencia" as const,
  }))
}

/** Thumbnail de evidência visual de tool_result (B1). Arquivo sumido do disco
 *  → chip honesto ("evidência removida"), nunca <img> quebrada. */
export function EvidenceThumb({ path, onOpen }: { path: string; onOpen: () => void }) {
  const [url, setUrl] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let alive = true
    evidenceUrl(path)
      .then((u) => alive && setUrl(u))
      .catch(() => alive && setFailed(true))
    return () => {
      alive = false
    }
  }, [path])
  if (failed) {
    return (
      <span className="rounded-md border bg-card px-2.5 py-1.5 text-[12px] text-muted-foreground">
        {EVIDENCE_MISSING}
      </span>
    )
  }
  if (!url) {
    return <span className="h-20 w-28 animate-pulse rounded-lg border bg-secondary/40" />
  }
  return (
    <button
      type="button"
      onClick={onOpen}
      // R8: a evidência também se arrasta até o composer, como anexo.
      onPointerDown={(event) =>
        iniciarArrasto(
          event,
          {
            tipo: "imagem",
            id: `imagem:${path}`,
            anexo: { path, name: evidenceName(path), kind: "image" },
          },
          evidenceName(path),
        )
      }
      title={`${evidenceName(path)} (clique para ampliar, arraste para anexar)`}
      className="overflow-hidden rounded-lg border transition-colors hover:border-brass/60"
    >
      <img
        src={url}
        alt={evidenceName(path)}
        className="max-h-32 max-w-[220px] object-contain"
      />
    </button>
  )
}

/** Thumbnail de um anexo no histórico (bytes → object URL cacheado). */
export function AttachmentThumb({
  att,
  read,
  onOpen,
}: {
  att: Attachment
  /** Selo de leitura: null = nada a afirmar (inlinado / sem telemetria). */
  read: { text: string; warn: boolean } | null
  /** Abre o anexo no lightbox (só imagens; PDF segue chip). */
  onOpen?: () => void
}) {
  const [url, setUrl] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let alive = true
    attachmentUrl(att)
      .then((u) => alive && setUrl(u))
      .catch(() => alive && setFailed(true))
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [att.path])
  if (att.kind === "pdf") {
    return (
      <span className="flex items-center gap-1.5 rounded-md border bg-card px-2.5 py-1.5 text-[12px] text-muted-foreground">
        <FileText className="size-3.5 shrink-0" />
        <span className="max-w-[160px] truncate">{att.name}</span>
        <ReadBadge read={read} />
      </span>
    )
  }
  if (failed) {
    return (
      <span className="rounded-md border bg-card px-2.5 py-1.5 text-[12px] text-muted-foreground">
        anexo expirado
      </span>
    )
  }
  if (!url) {
    return <span className="size-20 animate-pulse rounded-lg border bg-secondary/40" />
  }
  // Parte 2 do B1: o anexo enviado volta a ser ABRÍVEL (feedback real:
  // "depois de enviada eu não consigo abrir e ver detalhes") — clique abre o
  // mesmo lightbox da evidência de tool.
  return (
    <span className="relative inline-flex">
      <button
        type="button"
        onClick={onOpen}
        disabled={!onOpen}
        onPointerDown={(event) =>
          iniciarArrasto(event, { tipo: "imagem", id: `imagem:${att.path}`, anexo: att }, att.name)
        }
        title={onOpen ? `${att.name} (clique para ampliar, arraste para anexar)` : att.name}
        className={cn(
          "overflow-hidden rounded-lg border",
          onOpen && "transition-colors hover:border-brass/60",
        )}
      >
        <img
          src={url}
          alt={att.name}
          className="max-h-44 max-w-[220px] object-contain"
        />
      </button>
      {read && (
        <span className="absolute right-1 bottom-1">
          <ReadBadge read={read} />
        </span>
      )}
    </span>
  )
}

/** Selo do anexo: prova de que o agent ABRIU o arquivo (Claude/agy tratam o
 *  anexo como ponteiro — "respondeu" nunca significou "olhou"). */
function ReadBadge({ read }: { read: { text: string; warn: boolean } | null }) {
  if (!read) return null
  return (
    <span
      title={
        read.warn
          ? "O agent respondeu sem abrir este anexo; a resposta pode não considerá-lo."
          : "O agent abriu este anexo durante o turno."
      }
      className={cn(
        "rounded px-1.5 py-0.5 text-[11px] font-medium backdrop-blur-sm",
        read.warn
          ? "bg-st-warning/20 text-st-warning ring-1 ring-st-warning/40"
          : "bg-card/85 text-muted-foreground ring-1 ring-border",
      )}
    >
      {read.text}
    </span>
  )
}
