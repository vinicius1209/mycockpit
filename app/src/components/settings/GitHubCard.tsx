// Configurações ▸ GitHub. A pergunta: "qual CLI e quais contas o app usa pra
// PRs e checks — e qual delas está ativa".
//
// Por que esta seção existe: o app JÁ usava o `gh` e JÁ sabia ler todas as
// contas logadas (`run_gh_any_account`, que tenta cada identidade sem trocar a
// conta ativa global). O diagnóstico existia dentro do Rust e morria lá — e o
// custo disso já foi pago nesta máquina, com "repository not found" num repo
// que existe, porque a conta ativa era a errada.
//
// A lista de contas é ESTADO (leitura da máquina). Os comandos são AÇÃO DO
// HUMANO: o card mostra e copia, nunca executa. `gh auth login` e
// `gh auth switch` mexem no ambiente do usuário fora do app, e conduzir isso
// daqui seria efeito colateral fora do nosso quintal.

import { useEffect, useState } from "react"
import { AlertTriangle, Check, Copy, Loader2, RotateCcw, X } from "lucide-react"
import {
  diagnosticoDoGh,
  lerGhStatus,
  GH_DESCONHECIDO,
  GH_LOGIN_COMMAND,
  type GhStatus,
} from "@/lib/github"
import { Note, SectionHeader } from "@/components/settings/parts"
import { sectionDef } from "@/components/settings/sections"
import { cn } from "@/lib/utils"

/** Comando copiável — mesmo gesto do "copiar comando" de Agentes na máquina:
 *  ícone-only não caberia aqui (o comando É a informação), então o comando
 *  aparece em mono e o botão copia. */
function ComandoCopiavel({ cmd }: { cmd: string }) {
  const [copiado, setCopiado] = useState(false)
  return (
    <div className="mt-2 flex items-center gap-2">
      <code className="min-w-0 flex-1 truncate rounded-md border bg-secondary/40 px-2.5 py-1.5 font-mono text-[12px] text-foreground">
        {cmd}
      </code>
      <button
        type="button"
        onClick={() => {
          void navigator.clipboard?.writeText(cmd).then(() => {
            setCopiado(true)
            window.setTimeout(() => setCopiado(false), 1500)
          })
        }}
        title="Copiar comando"
        aria-label="Copiar comando"
        className="flex size-7 shrink-0 items-center justify-center rounded-md border text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      >
        {/* Confirmação de cópia NÃO é verde: §2 reserva verde pra marco raro ou
            probe real, e "copiei um texto" é o mais ambiente dos estados. */}
        {copiado ? (
          <Check className="size-3.5 text-foreground" />
        ) : (
          <Copy className="size-3.5" />
        )}
      </button>
    </div>
  )
}

export function GitHubCard() {
  const [status, setStatus] = useState<GhStatus>(GH_DESCONHECIDO)
  // "ainda não olhei" é estado próprio: sem ele, o primeiro frame afirmaria
  // "gh não instalado" (o default pessimista) em toda abertura da seção.
  const [lendo, setLendo] = useState(true)
  const def = sectionDef("github")

  async function verificar() {
    setLendo(true)
    setStatus(await lerGhStatus())
    setLendo(false)
  }

  useEffect(() => {
    void verificar()
  }, [])

  const d = diagnosticoDoGh(status)

  return (
    <div>
      <SectionHeader
        title={def.title}
        description={def.question}
        action={
          <button
            onClick={() => void verificar()}
            disabled={lendo}
            className="flex items-center gap-1.5 text-[12px] text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
          >
            <RotateCcw className={cn("size-3.5", lendo && "animate-spin")} />
            Verificar agora
          </button>
        }
      />

      {lendo ? (
        <div className="flex items-center gap-2 rounded-lg border border-border/50 bg-secondary/20 px-3 py-3 text-[13px] text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          Lendo o estado do gh nesta máquina…
        </div>
      ) : (
        <div className="rounded-lg border border-border/50 bg-secondary/20 px-3 py-3">
          <div className="flex items-start gap-3">
            <span className="mt-px shrink-0">
              {d.estado === "sem-cli" ? (
                <X className="size-4 text-st-error" />
              ) : d.estado === "ok" ? (
                <Check className="size-4 text-st-success" />
              ) : (
                <AlertTriangle className="size-4 text-st-warning" />
              )}
            </span>
            <div className="min-w-0 flex-1">
              {d.estado === "sem-cli" && (
                <>
                  <div className="text-[13px] text-foreground">
                    gh não está instalado nesta máquina
                  </div>
                  <div className="text-[12px] leading-snug text-muted-foreground">
                    Sem ele o app não lê PRs, checks nem faz merge. O resto do
                    Frota funciona igual.
                  </div>
                  <ComandoCopiavel cmd={d.comando} />
                </>
              )}

              {d.estado === "sem-conta" && (
                <>
                  <div className="text-[13px] text-foreground">
                    gh instalado
                    {status.version ? ` v${status.version}` : ""}, nenhuma conta
                    logada
                  </div>
                  <div className="text-[12px] leading-snug text-muted-foreground">
                    Rode o login num terminal. O app mostra o comando e não o
                    executa: login é gesto seu.
                  </div>
                  <ComandoCopiavel cmd={d.comando} />
                </>
              )}

              {d.estado === "sem-ativa" && (
                <>
                  <div className="text-[13px] text-foreground">
                    {d.contas.length} conta(s) logada(s), nenhuma marcada como
                    ativa
                  </div>
                  <div className="text-[12px] leading-snug text-muted-foreground">
                    Não consegui ler qual está ativa no gh
                    {status.version ? ` v${status.version}` : ""}. O app segue
                    tentando todas, mas não sei dizer qual responde primeiro.
                  </div>
                </>
              )}

              {d.estado === "ok" && (
                <>
                  <div className="text-[13px] text-foreground">
                    gh v{status.version}
                    <span className="text-muted-foreground">
                      {" · "}
                      {d.contas.length === 1
                        ? "1 conta logada"
                        : `${d.contas.length} contas logadas`}
                    </span>
                  </div>
                  <ul className="mt-2 flex flex-col gap-1">
                    {d.contas.map((c) => (
                      <li
                        key={c.user}
                        className="flex items-center gap-2 text-[12px]"
                      >
                        <span
                          className={cn(
                            "font-mono",
                            c.active ? "text-foreground" : "text-muted-foreground",
                          )}
                        >
                          {c.user}
                        </span>
                        {c.active && (
                          <span className="rounded bg-secondary px-1 py-px text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
                            ativa
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* A ressalva que justifica listar TODAS as contas em vez de só a ativa:
          é o comportamento real do app, e é o que diferencia o card de um selo
          "conectado" que não explica falha nenhuma. */}
      {d.estado === "ok" && d.contas.length > 1 && (
        <Note>
          Num PR que a conta ativa não enxerga, o app tenta as outras contas
          logadas antes de desistir, e nunca troca a sua conta ativa. Se quiser
          trocar mesmo assim, é <code className="font-mono">gh auth switch</code>{" "}
          num terminal.
        </Note>
      )}
      {d.estado === "ok" && d.contas.length === 1 && (
        <Note>
          Leitura da máquina, não preferência do app: quem manda é o{" "}
          <code className="font-mono">{GH_LOGIN_COMMAND}</code> do seu terminal.
        </Note>
      )}
    </div>
  )
}
