// Configurações ▸ Serviços. A pergunta: "quais serviços externos o app usa, e
// com qual conta".
//
// ── POR QUE NÃO É MAIS UMA SEÇÃO "GITHUB" ──────────────────────────────────
// Era. O usuário desmontou em uma frase: *"esse item novo ficou exclusivo no
// menu GitHub, qual o sentido? se amanhã eu quiser um novo app para integrar?"*
// — o rail cresceria UM ITEM POR FORNECEDOR.
//
// O agravante: eu tinha escrito a crítica certa na análise do Orca (eles têm UM
// painel `Integrations` com cartão por provedor) e construí o contrário. Agora
// a seção é a PERGUNTA, e o fornecedor é o cartão.
//
// ── E POR QUE ELA DEIXOU DE SER SÓ LEITURA ─────────────────────────────────
// Também era. Eu tinha recusado rodar `gh auth switch` com o argumento de que
// "mexer no ambiente global é fora do nosso quintal". O argumento não se
// sustenta, e a refutação estava no próprio repo: em *Agentes na máquina* o app
// já roda `npm i -g` e `brew upgrade` no clique do usuário — instalar pacote
// global é muito mais invasivo que trocar de conta. Recusar aqui era
// incoerência disfarçada de princípio.
//
// O cuidado real não é recusar, é DIZER A CONSEQUÊNCIA: trocar aqui vale pro
// terminal também, porque a conta ativa é do `gh`. Isso fica na tela, ao lado
// do botão, não num tooltip.

import { useCallback, useEffect, useState } from "react"
import { Check, Loader2, Copy, RotateCcw } from "lucide-react"
import { toast } from "sonner"
import {
  diagnosticoDoGh,
  lerGhStatus,
  trocarContaGh,
  GH_DESCONHECIDO,
  type GhStatus,
} from "@/lib/github"
import {
  Card,
  CardBody,
  CardHead,
  Consequencia,
  Note,
  SectionHeader,
  Selo,
} from "@/components/settings/parts"
import { sectionDef } from "@/components/settings/sections"
import { OpenCodeProvidersCard } from "@/components/settings/OpenCodeProvidersCard"
import { detectAgents, refreshOpenCodeModels, toProbeMap } from "@/lib/detect"
import { useApp } from "@/store/app"
import { cn } from "@/lib/utils"

/** Comando copiável. O app mostra e copia; quem roda é você — instalar e logar
 *  seguem sendo gesto seu no terminal (trocar de conta, não: essa o app faz). */
function Comando({ cmd }: { cmd: string }) {
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
        {/* Confirmação de cópia não é verde: §2 reserva verde pra marco raro ou
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

function CartaoGitHub({
  status,
  onMudou,
}: {
  status: GhStatus
  onMudou: () => void
}) {
  const d = diagnosticoDoGh(status)
  const [trocando, setTrocando] = useState<string | null>(null)

  async function trocar(user: string) {
    setTrocando(user)
    try {
      await trocarContaGh(user)
      toast.success(`Conta ativa agora é ${user}`)
      onMudou()
    } catch (e) {
      // A mensagem do `gh` vai inteira: o usuário pediu uma mudança e ela não
      // aconteceu; genérico aqui esconde a única pista.
      toast.error(typeof e === "string" ? e : "Não consegui trocar a conta")
    } finally {
      setTrocando(null)
    }
  }

  const selo =
    d.estado === "sem-cli" ? (
      <Selo>não instalado</Selo>
    ) : d.estado === "ok" ? (
      <Selo tom="ok">conectado</Selo>
    ) : (
      <Selo tom="atencao">falta configurar</Selo>
    )

  return (
    <Card>
      <CardHead
        nome="GitHub"
        meta={status.version ? `gh v${status.version}` : undefined}
        selo={selo}
      />
      <CardBody>
        {d.estado === "sem-cli" && (
          <>
            <p className="text-[12px] leading-snug text-muted-foreground">
              Sem o <code className="font-mono">gh</code> o app não lê PRs,
              checks nem faz merge. O resto do Frota funciona igual.
            </p>
            <Comando cmd={d.comando} />
          </>
        )}

        {d.estado === "sem-conta" && (
          <>
            <p className="text-[12px] leading-snug text-muted-foreground">
              Nenhuma conta logada. Rode o login num terminal: o fluxo é
              interativo e o app não tem como conduzir.
            </p>
            <Comando cmd={d.comando} />
          </>
        )}

        {d.estado === "sem-ativa" && (
          <p className="text-[12px] leading-snug text-muted-foreground">
            {d.contas.length} conta(s) logada(s), mas não consegui ler qual está
            ativa. O app segue tentando todas; só não sei dizer qual responde
            primeiro.
          </p>
        )}

        {d.estado === "ok" && (
          <>
            <p className="mb-2 text-[12px] leading-snug text-muted-foreground">
              Pull requests, checks e merge. O app usa a conta ativa; num PR que
              ela não enxerga, tenta as outras antes de desistir.
            </p>
            <ul className="flex flex-col gap-0.5">
              {d.contas.map((c) => (
                <li
                  key={c.user}
                  className="group flex items-center gap-2 rounded-md px-2 py-1.5 transition-colors hover:bg-accent/50"
                >
                  <span
                    className={cn(
                      "font-mono text-[13px]",
                      c.active ? "text-foreground" : "text-muted-foreground",
                    )}
                  >
                    {c.user}
                  </span>
                  {c.active && <Selo tom="ok">ativa</Selo>}
                  {!c.active && (
                    <button
                      type="button"
                      disabled={trocando !== null}
                      onClick={() => void trocar(c.user)}
                      className="ml-auto flex shrink-0 items-center gap-1.5 rounded-md border px-2.5 py-1 text-[12px] text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 disabled:opacity-40"
                    >
                      {trocando === c.user && (
                        <Loader2 className="size-3 animate-spin" />
                      )}
                      Tornar ativa
                    </button>
                  )}
                </li>
              ))}
            </ul>
            {d.contas.length > 1 && (
              <Consequencia>
                Trocar aqui vale pro seu terminal também: a conta ativa é do{" "}
                <code className="font-mono">gh</code>, não do Frota.
              </Consequencia>
            )}
          </>
        )}
      </CardBody>
    </Card>
  )
}

export function ServicosSettings() {
  const [status, setStatus] = useState<GhStatus>(GH_DESCONHECIDO)
  // "ainda não olhei" é estado próprio: sem ele o primeiro frame afirmaria
  // "gh não instalado" (o default pessimista) em toda abertura da seção.
  const [lendo, setLendo] = useState(true)
  const [refreshToken, setRefreshToken] = useState(0)
  const setSettings = useApp((s) => s.setSettings)
  const def = sectionDef("services")

  const verificar = useCallback(async () => {
    setLendo(true)
    const [gh, tools] = await Promise.all([lerGhStatus(), detectAgents()])
    setStatus(gh)
    if (tools.length) setSettings({ detected: toProbeMap(tools, Date.now()) })
    await refreshOpenCodeModels()
    setRefreshToken((value) => value + 1)
    setLendo(false)
  }, [setSettings])

  useEffect(() => {
    void verificar()
  }, [verificar])

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
        <Card>
          <CardBody>
            <span className="flex items-center gap-2 text-[13px] text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              Lendo o estado dos serviços nesta máquina…
            </span>
          </CardBody>
        </Card>
      ) : (
        <>
          <CartaoGitHub status={status} onMudou={() => void verificar()} />
          <OpenCodeProvidersCard refreshToken={refreshToken} onChanged={verificar} />
        </>
      )}

      <Note>
        Cada serviço é um cartão. Um provedor novo entra aqui do lado, sem item
        novo no menu.
      </Note>
    </div>
  )
}
