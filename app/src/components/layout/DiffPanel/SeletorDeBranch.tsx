// O nome da branch no cabeçalho da aba Alterações vira seletor: trocar, criar a
// partir daqui, guardar e recuperar alterações (docs/explorador-de-arquivos-prd.md,
// BD3 e BD5). Branches e stash só são lidos quando o seletor abre.

import { useState } from "react"
import { Archive, ArchiveRestore, ChevronDown, ChevronLeft, GitBranch, GitBranchPlus, Trash2 } from "lucide-react"
import {
  Command,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { controle } from "@/components/ui/controle"
import { avisar } from "@/lib/avisos"
import { confirm, perguntar } from "@/lib/confirm"
import {
  comoErroDeGit,
  guardar,
  listarBranches,
  listarGuardadas,
  quandoDaBranch,
  recuperarGuardada,
  trocarBranch,
  type Branch,
  type Guardada,
} from "@/lib/gitSync"
import { avisarGravacao, haTurnoNaPasta } from "@/lib/sinaisDoDisco"
import { cn } from "@/lib/utils"

const arquivos = (n: number) => `${n} arquivo${n === 1 ? "" : "s"} alterado${n === 1 ? "" : "s"}`

export function SeletorDeBranch({
  cwd,
  branch,
  alteracoes,
}: {
  cwd: string
  branch: string
  alteracoes: number
}) {
  const [aberto, setAberto] = useState(false)
  const [vista, setVista] = useState<"branches" | "guardadas">("branches")
  const [busca, setBusca] = useState("")
  const [branches, setBranches] = useState<Branch[] | null>(null)
  const [guardadas, setGuardadas] = useState<Guardada[]>([])
  const [rodando, setRodando] = useState(false)
  const [now, setNow] = useState(() => Date.now())

  async function carregar() {
    setRodando(haTurnoNaPasta(cwd))
    setNow(Date.now())
    try {
      const [b, g] = await Promise.all([listarBranches(cwd), listarGuardadas(cwd)])
      setBranches(b)
      setGuardadas(g)
    } catch (e) {
      setBranches([])
      avisar.erro("Não consegui listar as branches.", { detalhe: comoErroDeGit(e).detalhe })
    }
  }

  function abrir(v: boolean) {
    setAberto(v)
    if (!v) return
    setVista("branches")
    setBusca("")
    void carregar()
  }

  function terminou(texto: string) {
    avisar.feito(texto)
    setAberto(false)
    avisarGravacao(cwd)
  }

  async function trocar(nome: string, criar: boolean, guardando?: boolean) {
    if (haTurnoNaPasta(cwd)) {
      avisar.erro("Há um turno rodando nesta pasta.", {
        detalhe: "Trocar de branch mudaria os arquivos debaixo do agente. Espere o turno terminar.",
      })
      return
    }
    let guardar = guardando ?? false
    if (guardando === undefined && !criar && alteracoes > 0) {
      const r = await perguntar({
        title: `Trocar para ${nome}`,
        description: `Há ${arquivos(alteracoes)} em ${branch}. Levando, elas continuam na área de trabalho, na nova branch; guardando, você as recupera depois pela lista de guardadas.`,
        confirmLabel: "Levar as alterações",
        alternativa: "Guardar (stash) e trocar",
      })
      if (r === "cancelar") return
      guardar = r === "alternativa"
    }
    try {
      await trocarBranch(cwd, nome, { criar, guardar })
      terminou(criar ? `Branch ${nome} criada` : `Na branch ${nome}`)
    } catch (e) {
      const erro = comoErroDeGit(e)
      if (erro.tipo === "alteracoes-locais") {
        avisar.erro(`As alterações conflitam com ${nome}.`, {
          detalhe: "Levar sobrescreveria arquivos que mudam entre as duas branches.",
          acao: { rotulo: "Guardar e trocar", fazer: () => void trocar(nome, false, true) },
        })
      } else {
        avisar.erro(`Não consegui trocar para ${nome}.`, { detalhe: erro.detalhe })
      }
    }
  }

  async function guardarAgora() {
    try {
      await guardar(cwd, "")
      terminou("Alterações guardadas")
    } catch (e) {
      avisar.erro("Não consegui guardar as alterações.", { detalhe: comoErroDeGit(e).detalhe })
    }
  }

  async function recuperar(g: Guardada) {
    try {
      await recuperarGuardada(cwd, g.referencia, false)
      terminou("Alterações recuperadas")
    } catch (e) {
      avisar.erro("Não consegui recuperar as alterações.", { detalhe: comoErroDeGit(e).detalhe })
    }
  }

  async function apagar(g: Guardada) {
    const ok = await confirm({
      title: "Apagar as alterações guardadas?",
      description: g.mensagem,
      confirmLabel: "Apagar",
      danger: true,
    })
    if (!ok) return
    try {
      await recuperarGuardada(cwd, g.referencia, true)
      setGuardadas(await listarGuardadas(cwd))
      avisarGravacao(cwd)
    } catch (e) {
      avisar.erro("Não consegui apagar as alterações guardadas.", { detalhe: comoErroDeGit(e).detalhe })
    }
  }

  const q = busca.trim()
  const filtradas = (branches ?? []).filter((b) => b.nome.toLowerCase().includes(q.toLowerCase()))
  const existe = (branches ?? []).some((b) => b.nome === q)
  const item = "text-[13px]"

  return (
    <Popover open={aberto} onOpenChange={abrir}>
      <PopoverTrigger asChild>
        {/* -ml-1.5 é óptico: a área de clique cresce para fora e o glifo fica
            no trilho em que o nome da branch sempre esteve. */}
        <button
          type="button"
          aria-label={`Branch ${branch}. Trocar de branch`}
          className={cn(
            controle("chip"),
            "-ml-1.5 min-w-0 px-1.5 font-mono text-muted-foreground hover:bg-accent/40 hover:text-foreground",
          )}
        >
          <GitBranch className="size-3 shrink-0" />
          <span className="truncate">{branch}</span>
          <ChevronDown className="size-3 shrink-0" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-0">
        <Command shouldFilter={false}>
          {vista === "branches" ? (
            <>
              <CommandInput value={busca} onValueChange={setBusca} placeholder="Buscar ou nomear branch" className="text-[13px]" />
              <CommandList>
                {rodando && (
                  <p className="px-3 pt-2 text-[12px] text-st-warning">
                    Há um turno rodando nesta pasta. A troca espera ele terminar.
                  </p>
                )}
                <CommandGroup>
                  <CommandItem
                    className={item}
                    disabled={rodando || existe}
                    onSelect={() => (q ? void trocar(q, true) : undefined)}
                  >
                    <GitBranchPlus />
                    {q ? `Criar ${q} a partir daqui` : "Nova branch a partir daqui (digite o nome)"}
                  </CommandItem>
                </CommandGroup>
                <CommandGroup heading="Recentes">
                  {branches === null ? (
                    <p className="px-2 py-1.5 text-[12px] text-muted-foreground">Lendo…</p>
                  ) : (
                    filtradas.map((b) => (
                      <CommandItem
                        key={b.nome}
                        value={b.nome}
                        className={cn(item, "font-mono")}
                        disabled={b.atual || rodando}
                        onSelect={() => void trocar(b.nome, false)}
                      >
                        <GitBranch />
                        <span className="min-w-0 flex-1 truncate">{b.nome}</span>
                        <span className="shrink-0 font-sans text-[11px] text-muted-foreground">{quandoDaBranch(b, now)}</span>
                      </CommandItem>
                    ))
                  )}
                  {branches !== null && filtradas.length === 0 && (
                    <p className="px-2 py-1.5 text-[12px] text-muted-foreground">Nenhuma branch com esse nome.</p>
                  )}
                </CommandGroup>
                <CommandGroup className="border-t border-border/40">
                  <CommandItem className={item} disabled={alteracoes === 0} onSelect={() => void guardarAgora()}>
                    <Archive />
                    Guardar alterações (stash)
                  </CommandItem>
                  <CommandItem className={item} disabled={guardadas.length === 0} onSelect={() => setVista("guardadas")}>
                    <ArchiveRestore />
                    <span className="flex-1">Recuperar guardadas</span>
                    {guardadas.length > 0 && (
                      <span className="font-mono text-[11px] tabular-nums text-muted-foreground">{guardadas.length}</span>
                    )}
                  </CommandItem>
                </CommandGroup>
                <p className="border-t border-border/40 px-3 py-2 text-[11px] text-muted-foreground">
                  Conversas em worktree não são afetadas pela troca.
                </p>
              </CommandList>
            </>
          ) : (
            <CommandList>
              <CommandGroup>
                <CommandItem className={item} onSelect={() => setVista("branches")}>
                  <ChevronLeft />
                  Voltar
                </CommandItem>
              </CommandGroup>
              <CommandGroup heading="Guardadas">
                {guardadas.map((g) => (
                  <CommandItem key={g.referencia} value={g.referencia} className={item} onSelect={() => void recuperar(g)}>
                    <ArchiveRestore />
                    <span className="min-w-0 flex-1 truncate" title={g.mensagem}>
                      {g.mensagem}
                    </span>
                    <button
                      type="button"
                      aria-label="Apagar estas alterações guardadas"
                      title="Apagar"
                      onClick={(e) => {
                        e.stopPropagation()
                        void apagar(g)
                      }}
                      className={cn(controle("chip", { quadrado: true }), "text-muted-foreground hover:text-st-error")}
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          )}
        </Command>
      </PopoverContent>
    </Popover>
  )
}
