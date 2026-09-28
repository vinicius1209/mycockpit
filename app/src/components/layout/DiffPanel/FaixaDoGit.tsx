// A faixa que aparece quando um gesto de rede falha: o motivo em uma frase e a
// saída que resolve (docs/explorador-de-arquivos-prd.md, BD1 e BD2). Neutra; o
// âmbar fica só no ícone, que é o que pede decisão. Nunca oferece --force.

import { useState } from "react"
import { TriangleAlert } from "lucide-react"
import { Button } from "@/components/ui/button"
import { avisar, mensagemDe } from "@/lib/avisos"
import type { GitStatus } from "@/lib/git"
import { trocarContaGh } from "@/lib/github"
import { contasParaTrocar, guardar, type GestoDeRede } from "@/lib/gitSync"
import { useGitSync, type FaixaDoGit as Faixa } from "@/store/gitSync"

const VERBO: Record<GestoDeRede, string> = {
  enviar: "enviar",
  publicar: "publicar",
  trazer: "trazer",
  "trazer-e-enviar": "sincronizar",
  buscar: "buscar",
}

const plural = (n: number) => `${n} commit${n === 1 ? "" : "s"}`

/** A frase da faixa. Pura, para o teste ler o que a pessoa lê. */
export function fraseDaFaixa(f: Faixa, s: Pick<GitStatus, "ahead" | "behind">): string {
  const e = f.erro
  switch (e.tipo) {
    case "acesso": {
      const ativa = e.contaAtiva ? ` (${e.contaAtiva})` : ""
      const dono = contasParaTrocar(e)[0] === e.dono && e.dono ? ` O dono é ${e.dono}, uma conta que também está no gh.` : ""
      return e.contas.length > 0
        ? `O GitHub recusou: a conta ativa${ativa} não tem acesso a este repositório.${dono}`
        : "O remoto recusou o acesso. Confira a credencial deste repositório."
    }
    case "divergiu":
    case "recusado":
      return s.behind > 0 && s.ahead > 0
        ? `O remoto tem ${plural(s.behind)} que você não tem, e você tem ${s.ahead} que ele não tem. Trazer sem mesclar não dá.`
        : "O remoto tem commits que você não tem. Traga primeiro, depois envie."
    case "alteracoes-locais":
      return "Trazer mexeria em arquivos que você alterou e ainda não commitou."
    case "sem-rede":
      return "Não consegui falar com o remoto. Confira a rede e tente de novo."
    case "prazo":
      return "O remoto não respondeu em 2 minutos."
    default:
      return `Não consegui ${VERBO[f.gesto]}.`
  }
}

export function FaixaDoGit({ cwd, faixa, status }: { cwd: string; faixa: Faixa; status: GitStatus }) {
  const executar = useGitSync((s) => s.executar)
  const fechar = useGitSync((s) => s.fecharFaixa)
  const [detalhes, setDetalhes] = useState(false)
  const { erro, gesto } = faixa
  const envia = gesto === "enviar" || gesto === "trazer-e-enviar"

  async function trocarERepetir(conta: string) {
    try {
      await trocarContaGh(conta)
    } catch (e) {
      avisar.erro(`Não consegui trocar para ${conta}.`, { detalhe: mensagemDe(e) })
      return
    }
    void executar(cwd, gesto)
  }

  async function guardarERepetir() {
    try {
      await guardar(cwd, "Frota: alterações guardadas para trazer commits")
    } catch (e) {
      avisar.erro("Não consegui guardar as alterações.", { detalhe: mensagemDe(e) })
      return
    }
    void executar(cwd, gesto)
  }

  const saidas =
    erro.tipo === "acesso" ? (
      contasParaTrocar(erro).slice(0, 2).map((c) => (
        <Button key={c} type="button" variant="outline" size="chip" onClick={() => void trocarERepetir(c)}>
          Trocar para {c} e {VERBO[gesto]}
        </Button>
      ))
    ) : erro.tipo === "divergiu" || erro.tipo === "recusado" ? (
      <Button
        type="button"
        variant="outline"
        size="chip"
        onClick={() => void executar(cwd, envia ? "trazer-e-enviar" : "trazer", { rebase: true })}
      >
        {envia ? "Trazer com rebase e enviar" : "Trazer com rebase"}
      </Button>
    ) : erro.tipo === "alteracoes-locais" ? (
      <Button type="button" variant="outline" size="chip" onClick={() => void guardarERepetir()}>
        Guardar (stash) e trazer
      </Button>
    ) : (
      <Button type="button" variant="outline" size="chip" onClick={() => void executar(cwd, gesto)}>
        Tentar de novo
      </Button>
    )

  return (
    <div role="alert" className="shrink-0 border-b border-border/40 px-3 py-2.5">
      <div className="flex items-start gap-2">
        <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-st-warning" aria-hidden="true" />
        <p className="min-w-0 flex-1 text-[12px] leading-snug text-foreground/90">{fraseDaFaixa(faixa, status)}</p>
      </div>
      {detalhes && erro.detalhe && (
        <pre className="mt-2 max-h-32 overflow-auto rounded-md bg-muted/40 px-2 py-1.5 font-mono text-[11px] whitespace-pre-wrap text-muted-foreground">
          {erro.detalhe}
        </pre>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-1.5 pl-5.5">
        {saidas}
        <Button type="button" variant="ghost" size="chip" onClick={() => fechar(cwd)}>
          Agora não
        </Button>
        {erro.detalhe && (
          <Button
            type="button"
            variant="ghost"
            size="chip"
            className="ml-auto text-muted-foreground"
            onClick={() => setDetalhes((d) => !d)}
          >
            {detalhes ? "Esconder detalhes" : "Detalhes"}
          </Button>
        )}
      </div>
    </div>
  )
}
