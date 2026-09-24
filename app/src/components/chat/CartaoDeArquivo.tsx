// O cartão do arquivo solto (ADR-252, mock `docs/mocks/arquivo-solto-no-composer.html`).
//
// Irmão da `MiniaturaDeAnexo`: a mesma geometria (quadro de 40px, nome em 12,
// meta em 11, "×" no canto ao passar o mouse) e o mesmo `HoverCard` para
// cima. O que muda é o que ele promete: o arquivo não é copiado, o motor
// recebe o caminho, e o de fora do projeto é lido SÓ neste envio. O detalhe
// diz isso com todas as letras, e as ações moram num rodapé de botões de
// verdade (degrau `chip`), porque texto solto não parece botão (pedido de
// 24/09/2026, na revisão do mock).

import { FolderOpen, X } from "lucide-react"
import { revealItemInDir } from "@tauri-apps/plugin-opener"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { FileIcon } from "@/components/ui/file-icon"
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card"
import { dentroDoProjeto, nomeDoCaminho, ondeMora, pastaDoCaminho } from "@/lib/arquivoCitado"
import { fmtBytes } from "@/lib/format"
import { cn } from "@/lib/utils"

/** Acima disto o detalhe avisa que o agente lê por partes. */
const GRANDE = 5 * 1024 * 1024

/** Caminho com `~` no lugar da home, para caber e se ler. Puro. */
export function caminhoCurto(caminho: string): string {
  return caminho.replace(/^\/Users\/[^/]+|^\/home\/[^/]+/, "~")
}

export interface ContextoDoCartao {
  projectPath: string | null
  /** O `extra_dirs` do projeto, já absoluto. */
  pastasLiberadas: readonly string[]
  /** O motor da conversa recebe pasta extra por envio (capability). */
  pastasExtras: boolean
  /** Nome do motor, para dizer quem não lê fora do projeto. */
  motor: string
}

/** A pasta já é lida sempre: ela, ou uma pasta acima dela, está no config. Puro. */
export function pastaJaLiberada(dir: string, liberadas: readonly string[]): boolean {
  return liberadas.some((l) => {
    const raiz = l.replace(/\/+$/, "")
    return dir === raiz || dir.startsWith(`${raiz}/`)
  })
}

/** `.` e `..` resolvidos, sem tocar no disco. Puro. */
function normalizar(caminho: string): string {
  const partes: string[] = []
  for (const p of caminho.split("/")) {
    if (!p || p === ".") continue
    if (p === "..") partes.pop()
    else partes.push(p)
  }
  return `/${partes.join("/")}`
}

/** O `extra_dirs` cru do TOML, absoluto: relativo é relativo à raiz do projeto
 *  (a mesma regra do `resolve_extra_dirs` no Rust). Puro. */
export function pastasAbsolutas(extraDirs: readonly string[], projectPath: string | null): string[] {
  return extraDirs.map((d) => (d.startsWith("/") ? normalizar(d) : projectPath ? normalizar(`${projectPath}/${d}`) : d))
}

export function CartaoDeArquivo({
  caminho,
  pasta,
  bytes,
  contexto,
  onRemover,
  onLiberarSempre,
}: {
  caminho: string
  pasta: boolean
  bytes: number
  contexto: ContextoDoCartao
  onRemover?: () => void
  /** Ausente: sem o gesto (a mensagem já foi enviada). */
  onLiberarSempre?: (pasta: string) => void
}) {
  const nome = nomeDoCaminho(caminho)
  const fora = !dentroDoProjeto(caminho, contexto.projectPath)
  const onde = ondeMora(caminho, pasta, contexto.projectPath)
  const dir = pastaDoCaminho(caminho, pasta)
  // Motor sem pasta extra não lê nem a pasta liberada no config: o
  // `extra_dirs` chega a ele pelo mesmo canal que ele não tem.
  const soOCaminho = fora && !contexto.pastasExtras
  const jaLiberada = fora && !soOCaminho && pastaJaLiberada(dir, contexto.pastasLiberadas)

  const meta = fora ? (
    <>
      {onde && <span className="text-st-warning">{onde}</span>}
      {onde && " · "}
      {soOCaminho ? "só o caminho" : "fora do projeto"}
    </>
  ) : (
    onde
  )

  const acesso = !fora ? null : soOCaminho ? (
    <p>Fora do projeto. O {contexto.motor} não lê fora do projeto: vai só o caminho.</p>
  ) : jaLiberada ? (
    <p>Fora do projeto, numa pasta que este projeto já libera.</p>
  ) : (
    <p>
      Fora do projeto. <b className="font-medium text-foreground">Só neste envio</b> o agente pode ler esta pasta.
    </p>
  )

  return (
    <span className="group/anexo relative inline-flex">
      <HoverCard>
        <HoverCardTrigger asChild>
          <button
            type="button"
            aria-label={`${nome}${fora ? ", fora do projeto" : ""}`}
            className={cn(
              "flex max-w-[260px] cursor-default items-center gap-2 rounded-lg bg-secondary/60 py-1 pr-2 pl-1 text-left transition-colors hover:bg-secondary",
              fora && "ring-1 ring-st-warning/30 ring-inset",
            )}
          >
            <span className="grid size-10 shrink-0 place-items-center rounded-md bg-background">
              <FileIcon path={caminho} folder={pasta} size={16} />
            </span>
            <span className="min-w-0">
              <span className="block truncate text-[12px] text-foreground">{nome}</span>
              <span className="block truncate text-[11px] text-muted-foreground">{meta}</span>
            </span>
          </button>
        </HoverCardTrigger>
        <HoverCardContent side="top" align="start" className="w-[320px] p-0">
          <div className="px-3 pt-2.5 pb-2.5 text-[12px] leading-relaxed text-muted-foreground">
            <div className="mb-1.5 truncate font-mono text-[11px] text-faint" title={caminho}>
              {caminhoCurto(fora ? dir : caminho)}
            </div>
            {acesso}
            <p>
              {/* Na bolha o tamanho não viaja (a mensagem guarda só o caminho): sem número, sem "0 B". */}
              {pasta ? "Pasta. " : bytes > 0 ? `${fmtBytes(bytes)}${bytes > GRANDE ? ", grande: o agente lê por partes" : ""}. ` : ""}
              O agente só lê, nada é executado.
            </p>
          </div>
          <div className="flex items-center gap-1.5 border-t border-border/40 px-2 py-1.5">
            {fora && !soOCaminho && !jaLiberada && onLiberarSempre && (
              <Button
                variant="outline"
                size="chip"
                title="Grava a pasta no .frota/config.toml: vale para os próximos envios deste projeto"
                onClick={() => onLiberarSempre(dir)}
              >
                Liberar sempre
              </Button>
            )}
            <Button
              variant="ghost"
              size="chip"
              className="text-muted-foreground"
              onClick={() =>
                void revealItemInDir(caminho).catch(() => toast.error("Não encontrei o arquivo (ele ainda existe?)"))
              }
            >
              <FolderOpen />
              Mostrar na pasta
            </Button>
          </div>
        </HoverCardContent>
      </HoverCard>
      {onRemover && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onRemover()
          }}
          aria-label={`Remover ${nome}`}
          title="Remover"
          className="absolute -top-1.5 -right-1.5 grid size-4.5 place-items-center rounded-full border bg-popover text-muted-foreground opacity-0 shadow-[var(--shadow-pop)] transition-opacity group-hover/anexo:opacity-100 hover:text-foreground focus-visible:opacity-100"
        >
          <X className="size-3" />
        </button>
      )}
    </span>
  )
}
