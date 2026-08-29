import { useEffect, useMemo, useRef, useState } from "react"
import {
  AlertCircle,
  AlertTriangle,
  Brain,
  ChevronDown,
  FileDiff,
  FileText,
  FolderGit2,
  FolderPlus,
  ListChecks,
  PanelRight,
  Plug,
  RefreshCw,
  X,
} from "lucide-react"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Section,
  StageBadge,
  TabBtn,
} from "@/components/layout/contextPanelChrome"
import { DiffIndex } from "@/components/layout/DiffIndex"
import { TaskChecklist } from "@/components/chat/TaskChecklist"
import { deriveTasks } from "@/lib/tasks"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Markdown } from "@/components/common/Markdown"
import { LearningSection } from "@/components/layout/LearningSection"
import { MissionsSection } from "@/components/layout/MissionsSection"
import { useActiveProject, useApp } from "@/store/app"
import { useChat } from "@/store/chat"
import { useComposerDrafts } from "@/store/composerDrafts"
import type { ProjectConfig } from "@/store/app"
import { readProjectContext } from "@/lib/context"
import type { ClaudeDir, ContextFile, ProjectContext } from "@/lib/context"
import { loadGitDiff } from "@/lib/git"
import { fixPrefill } from "@/lib/deliveryDiff"
import { focusConsoleComposer } from "@/lib/focusComposer"
import { readProjectSources, readTextFile } from "@/lib/sources"
import { agentLabel } from "@/lib/agent"
import {
  sourceLabel,
  vendorReadingNote,
  vendorSources,
  type VendorFacts,
} from "@/lib/contextSources"
import {
  DoctrineSection,
  type DoctrineSeed,
} from "@/components/layout/DoctrineSection"
import type { ProjectSources } from "@/lib/sources"
import { open as openDialog } from "@tauri-apps/plugin-dialog"
import { writeMycockpitConfig } from "@/lib/mycockpit"
import { fmtBytes } from "@/lib/format"
import { isTauri } from "@/lib/db"
import { cn, formatDisplayPath, shortPath } from "@/lib/utils"

/** Linha de arquivo de instrução, 3 estados (presente/ausente), sem cheque. */
function FileRow({
  file,
  expanded,
  onToggle,
}: {
  file: ContextFile
  expanded: boolean
  onToggle: () => void
}) {
  const canExpand = file.exists && !!file.content
  return (
    <div>
      <button
        disabled={!canExpand}
        onClick={onToggle}
        className={cn(
          "flex w-full items-center justify-between rounded-md px-2 py-1.5 transition-colors",
          canExpand ? "hover:bg-accent/45" : "cursor-default",
          !file.exists && "opacity-45",
        )}
      >
        <span className="flex items-center gap-2 font-mono text-[13px] text-foreground/90">
          <FileText className="size-3.5 text-muted-foreground" />
          {file.name}
        </span>
        <span className="flex items-center gap-1.5">
          {file.exists ? (
            <span className="font-mono text-[11px] tabular-nums text-muted-foreground/70">
              {fmtBytes(file.bytes)}
            </span>
          ) : (
            <span className="text-[11px] text-muted-foreground/45">ausente</span>
          )}
          {canExpand && (
            <ChevronDown
              className={cn(
                "size-3.5 text-muted-foreground transition-transform",
                expanded && "rotate-180",
              )}
            />
          )}
        </span>
      </button>
      {expanded && file.content && (
        <pre
          data-selectable
          className="mt-1 mb-1 max-h-72 overflow-auto rounded-md border bg-background/40 p-2.5 font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-muted-foreground"
        >
          {file.content}
        </pre>
      )}
    </div>
  )
}

/** Nó .claude/ expansível com as contagens reais por categoria. */
function ClaudeNode({ cd }: { cd: ClaudeDir }) {
  const [open, setOpen] = useState(false)

  if (!cd.exists) {
    return (
      <div className="flex items-center justify-between rounded-md px-2 py-1.5 opacity-45">
        <span className="flex items-center gap-2 font-mono text-[13px]">
          <FolderGit2 className="size-3.5 text-muted-foreground" />
          .claude/
        </span>
        <span className="text-[11px] text-muted-foreground/45">ausente</span>
      </div>
    )
  }

  const rows: [string, number][] = [
    ["Subagents", cd.agents],
    ["Comandos", cd.commands],
    ["Skills", cd.skills],
    ["Planos", cd.plans],
    ["Hooks", cd.hooks],
  ]
  const present = rows.filter(([, n]) => n > 0)
  const kinds = present.length + (cd.settings ? 1 : 0)

  return (
    <div>
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between rounded-md px-2 py-1.5 transition-colors hover:bg-accent/45"
      >
        <span className="flex items-center gap-2 font-mono text-[13px] text-foreground/90">
          <FolderGit2 className="size-3.5 text-muted-foreground" />
          .claude/
        </span>
        <span className="flex items-center gap-1.5">
          <span className="text-[11px] text-muted-foreground/70">
            {kinds} {kinds === 1 ? "tipo" : "tipos"}
          </span>
          <ChevronDown
            className={cn(
              "size-3.5 text-muted-foreground transition-transform",
              open && "rotate-180",
            )}
          />
        </span>
      </button>
      {open && (
        <div className="animate-reveal-down mt-0.5 mb-1 ml-[18px] flex flex-col gap-px border-l border-border/60 pl-2">
          {present.map(([label, n]) => (
            <div
              key={label}
              className="flex items-center justify-between px-2 py-1 text-[12px]"
            >
              <span className="text-muted-foreground">{label}</span>
              <span className="font-mono tabular-nums text-foreground/80">{n}</span>
            </div>
          ))}
          {cd.settings && (
            <div className="flex items-center justify-between px-2 py-1 text-[12px]">
              <span className="text-muted-foreground">Permissões</span>
              <span className="font-mono text-foreground/70">settings.json</span>
            </div>
          )}
          {kinds === 0 && (
            <div className="px-2 py-1 text-[12px] text-muted-foreground/60">
              vazio
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function SkeletonRows() {
  return (
    <div className="flex flex-col gap-1.5">
      {[0, 1, 2].map((i) => (
        <div key={i} className="h-7 animate-pulse rounded-md bg-accent/40" />
      ))}
    </div>
  )
}

type DetailTarget = { title: string; path: string }

/** Detalhe de um item de contexto (persona/spec/memória): lê o arquivo e renderiza. */
function DetailDialog({
  root,
  target,
  onClose,
}: {
  /** Raiz permitida da leitura (pasta do projeto; ~/.claude passa também). */
  root: string
  target: DetailTarget | null
  onClose: () => void
}) {
  const [content, setContent] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!target) return
    let cancelled = false
    setContent(null)
    setLoading(true)
    readTextFile(root, target.path)
      .then((c) => !cancelled && setContent(c))
      .catch(() => !cancelled && setContent("_não foi possível ler o arquivo._"))
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [target, root])

  return (
    <Dialog open={!!target} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex max-h-[80vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl">
        <DialogHeader className="border-b px-5 py-3 text-left">
          <DialogTitle className="font-mono text-[14px]">
            {target?.title}
          </DialogTitle>
          {target && (
            <DialogDescription className="truncate font-mono text-[11px]">
              {shortPath(target.path)}
            </DialogDescription>
          )}
        </DialogHeader>
        <div className="overflow-auto px-5 py-4">
          {loading ? (
            <p className="text-[13px] text-muted-foreground">carregando…</p>
          ) : (
            content && <Markdown text={content} />
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

type Status = "loading" | "ready" | "error" | "browser"

export function ContextPanel() {
  const project = useActiveProject()
  const [ctx, setCtx] = useState<ProjectContext | null>(null)
  const [sources, setSources] = useState<ProjectSources | null>(null)
  const [status, setStatus] = useState<Status>("loading")
  const [expanded, setExpanded] = useState<string | null>(null)
  const [reload, setReload] = useState(0)
  // Referência do agente nasce COLAPSADA: é consulta rara, abre sob demanda.
  const [showAgentCtx, setShowAgentCtx] = useState(false)
  const [detail, setDetail] = useState<DetailTarget | null>(null)
  const tab = useApp((s) => s.contextPanelTab)
  const setTab = useApp((s) => s.setContextPanelTab)
  // Enquanto o agente TRABALHA o que interessa é o que ele mexeu — ajuste é
  // coisa de antes de começar. Ao entrar em run, o painel vai pra Alterações uma
  // vez; depois disso a sua escolha manda (não sequestra a aba a cada turno).
  const jumpedOnRun = useRef(false)
  // diff atribuído à conversa ativa: worktree isolado dela, senão a pasta do projeto.
  const activeWorktree = useChat(
    (s) =>
      (s.projectId
        ? s.conversationsByProject[s.projectId]
        : undefined
      )?.find((c) => c.id === s.activeId)?.worktreePath ?? null,
  )
  // P3: Entrega→diff só vale enquanto a conversa dela é a ativa.
  const activeConvId = useChat((s) => s.activeId)
  const deliveryDiff = useApp((s) => s.deliveryDiff)
  const delivery =
    deliveryDiff && deliveryDiff.convId === activeConvId ? deliveryDiff : null
  useEffect(() => {
    if (delivery) setTab("alteracoes")
  }, [delivery, setTab])

  // Prefill + foco de “Pedir correção” (P3) e dos comentários do diff.
  function prefillComposer(convId: string, text: string) {
    useComposerDrafts.getState().setText(convId, text)
    setTimeout(focusConsoleComposer, 120)
  }

  function requestDeliveryFix() {
    if (!delivery) return
    prefillComposer(delivery.convId, fixPrefill(delivery.text))
    useApp.getState().clearDeliveryDiff()
  }

  function closeDeliveryDiff() {
    useApp.getState().clearDeliveryDiff()
    setTab("contexto")
  }
  // running da conversa ativa: quando o turno termina, recarrega a contagem de
  // arquivos alterados (o diff mudou) → badge na aba Alterações.
  const running = useChat((s) =>
    s.activeId ? (s.byId[s.activeId]?.running ?? false) : false,
  )
  // Agent da conversa ATIVA — a régua de quem lê o quê. Conversa nova já vem
  // carimbada (setConversationAgent), então isto reflete a escolha do composer.
  const defaultAgent = useApp((s) => s.settings.defaultAgent)
  const convAgent = useChat((s) =>
    s.activeId ? (s.byId[s.activeId]?.agent ?? null) : null,
  )
  const readerAgent = convAgent ?? defaultAgent ?? null
  const [changedCount, setChangedCount] = useState(0)
  useEffect(() => {
    if (running && !jumpedOnRun.current) {
      jumpedOnRun.current = true
      setTab("alteracoes")
    }
    if (!running) jumpedOnRun.current = false
  }, [running, setTab])
  // items da conversa ativa SÓ com a aba Plano visível (evita re-render nas outras).
  const planItems = useChat((s) =>
    tab === "plano" && s.activeId ? s.byId[s.activeId]?.items : undefined,
  )
  const planTasks = useMemo(
    () => (planItems ? deriveTasks(planItems) : []),
    [planItems],
  )
  const setMycockpit = useApp((s) => s.setMycockpit)
  const cfg = useApp((s) => (project ? s.mycockpit[project.id] : undefined))

  // upsert da config do projeto em memória (cria com defaults se ainda não há)
  function upsertConfig(patch: Partial<ProjectConfig>) {
    if (!project) return
    const cur: ProjectConfig = cfg ?? {
      exists: true,
      permission: project.permissionMode ?? "padrao",
      helper: "haiku",
      mode: "linear",
      extraDirs: [],
    }
    setMycockpit(project.id, { ...cur, ...patch, exists: true })
  }

  /** Adiciona/remove pastas liberadas (viram --add-dir no próximo turno). Persiste
   *  no .mycockpit/config.toml; o Rust resolve no spawn. Aplica ao PRÓXIMO envio
   *  (o gate de diretório do CLI é fixo no spawn — não expande mid-run). */
  function setExtraDirs(dirs: string[]) {
    if (!project) return
    upsertConfig({ extraDirs: dirs })
    void writeMycockpitConfig(project.path, { extraDirs: dirs })
  }

  async function onAddExtraDir() {
    if (!project) return
    const picked = await openDialog({
      directory: true,
      multiple: false,
      title: "Liberar pasta ao agente",
    })
    if (typeof picked !== "string") return
    const cur = cfg?.extraDirs ?? []
    if (cur.includes(picked)) return
    setExtraDirs([...cur, picked])
  }

  // (a troca de permissão mora em lib/permission.ts, chamada pela ExecutionRow —
  // as três camadas que precisam concordar estão lá, em fonte única.)

  const projectPath = project?.path
  useEffect(() => {
    let cancelled = false
    setExpanded(null)
    if (!projectPath) return
    // Separar 'fora do app' de 'erro de disco' (antes ambos viravam ctx=null).
    if (!isTauri()) {
      setCtx(null)
      setSources(null)
      setStatus("browser")
      return
    }
    setStatus("loading")
    Promise.all([
      readProjectContext(projectPath),
      readProjectSources(projectPath),
    ])
      .then(([c, s]) => {
        if (!cancelled) {
          setCtx(c)
          setSources(s)
          setStatus("ready")
        }
      })
      .catch(() => {
        if (!cancelled) {
          setCtx(null)
          setSources(null)
          setStatus("error")
        }
      })
    return () => {
      cancelled = true
    }
  }, [projectPath, reload])

  // Contagem de arquivos alterados p/ o badge da aba Alterações. Recarrega
  // quando o worktree muda, no reload manual, e ao fim de cada turno (running).
  useEffect(() => {
    let cancelled = false
    const cwd = activeWorktree ?? projectPath
    if (!cwd) {
      setChangedCount(0)
      return
    }
    void loadGitDiff(cwd).then((d) => {
      if (!cancelled) setChangedCount(d.isRepo ? d.files.length : 0)
    })
    return () => {
      cancelled = true
    }
  }, [activeWorktree, projectPath, reload, running])

  // Fatos do disco sobre as fontes de FORNECEDOR (cada uma tem um dono; ver
  // lib/contextSources). O painel dizia "o que o agente enxerga" e contava tudo
  // isso junto — numa conversa Codex era verdade sobre o disco e mentira sobre o
  // contexto daquele agent.
  const vendorFacts: VendorFacts = {
    claudeMd: !!ctx?.files.find((f) => f.name === "CLAUDE.md")?.exists,
    agentsMd: !!ctx?.files.find((f) => f.name === "AGENTS.md")?.exists,
    personas: sources?.personas.length ?? 0,
    memories: sources?.memory.exists ? sources.memory.count : 0,
  }
  const vendorNote = vendorReadingNote(
    readerAgent,
    readerAgent ? agentLabel(readerAgent) : "",
    vendorFacts,
  )
  /** Sementes da doutrina: só os NOMES das instruções de CLI que existem e têm
   *  conteúdo — o texto é lido integral na hora de semear. */
  const doctrineSeeds: DoctrineSeed[] =
    ctx?.files
      .filter((f) => f.exists && f.content && f.content.trim())
      .map((f) => f.name) ?? []

  // Resumo numa linha do cabeçalho colapsado: as fontes do FORNECEDOR (o que o
  // app injeta tem seção própria acima e não precisa ser recontado aqui).
  const agentCtxSummary = (() => {
    const parts = vendorSources(vendorFacts)
      .filter((s) => s.present)
      .map(sourceLabel)
    return parts.length
      ? parts.join(" · ")
      : "nenhum arquivo de CLI neste projeto"
  })()

  return (
    // CARTÃO FLUTUANTE (E1): superfície própria (`bg-card` + raio + `--shadow-sm`,
    // sem borda) — a proibição do §4 é de borda aninhada, não de raio, mas em
    // troca fica mais forte: nada aqui dentro pode ter hairline de largura total.
    <aside className="reveal-right flex h-full w-full flex-col overflow-hidden rounded-xl bg-card shadow-[var(--shadow-sm),var(--lift)]">
      {/* `@container`: a tira decide rótulo × ícone pela largura REAL do painel
          (redimensionável), não por breakpoint de janela — ver `TabBtn`. */}
      <header className="@container flex h-11 shrink-0 items-center gap-1 px-2.5">
        <TabBtn
          active={tab === "contexto"}
          onClick={() => setTab("contexto")}
          icon={PanelRight}
          label="Contexto"
        />
        <TabBtn
          active={tab === "alteracoes"}
          onClick={() => setTab("alteracoes")}
          icon={FileDiff}
          badge={changedCount}
          label="Alterações"
        />
        <TabBtn
          active={tab === "plano"}
          onClick={() => setTab("plano")}
          icon={ListChecks}
          label="Plano"
        />
      </header>

      {!project ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
          <p className="text-[13px] text-muted-foreground">
            Nenhum projeto selecionado.
          </p>
        </div>
      ) : tab === "alteracoes" ? (
        <DiffIndex
          cwd={activeWorktree ?? project.path}
          delivery={delivery}
          onRequestFix={requestDeliveryFix}
          onCloseDelivery={closeDeliveryDiff}
        />
      ) : tab === "plano" ? (
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {planTasks.length > 0 ? (
            <TaskChecklist tasks={planTasks} />
          ) : (
            <p className="px-2 py-10 text-center text-[13px] text-muted-foreground">
              Sem plano nesta conversa. Quando o agent criar tarefas, a checklist
              aparece aqui.
            </p>
          )}
        </div>
      ) : (
        <ScrollArea className="flex-1">
          {/* Identidade (nome/path) mora no titlebar + sidebar; copiar o caminho
              vive no menu de contexto do projeto. Painel começa nos controles. */}
          <Section title="Ajustes">
            <div className="flex flex-col gap-2.5">
              {/* Permissões MUDARAM DE CASA: viraram o controle de 3 posições na
                  linha de execução do composer (ExecutionRow). Ficavam aqui, a
                  três cliques do lugar onde a consequência aparece — e o composer
                  só falava do assunto DEPOIS que você tinha liberado. */}

              {/* Pastas permitidas: viram --add-dir. Resolve o caso de o agent
                  precisar de um repo irmão fora do cwd (ex.: backend). Aplica ao
                  PRÓXIMO turno — o gate de diretório do CLI é fixo no spawn. */}
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-[13px] text-muted-foreground">
                    Pastas permitidas
                  </span>
                  <button
                    onClick={() => void onAddExtraDir()}
                    // Sem hairline: o painel é cartão, e a proibição de borda
                    // aninhada vale pros controles dele também (§4). O chip se
                    // separa por preenchimento, e sai do brass no hover porque
                    // brass é ação PRIMÁRIA e esta é secundária (§2).
                    className="flex h-7 items-center gap-1.5 rounded-md bg-secondary/60 px-2.5 text-[12px] text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                    aria-label="Adicionar pasta permitida"
                  >
                    <FolderPlus className="size-3.5" />
                    Adicionar
                  </button>
                </div>
                {(cfg?.extraDirs?.length ?? 0) === 0 ? (
                  <p className="text-[11px] leading-snug text-muted-foreground/70">
                    Só o diretório do projeto é acessível. Libere um repo irmão
                    (ex.: backend) para o agent alcançá-lo.
                  </p>
                ) : (
                  <ul className="flex flex-col gap-1">
                    {cfg!.extraDirs.map((dir) => (
                      <li
                        key={dir}
                        className="group/dir flex items-center gap-1.5 rounded-md bg-secondary/40 px-2 py-1"
                      >
                        <FolderGit2 className="size-3.5 shrink-0 text-muted-foreground/70" />
                        <span
                          className="min-w-0 flex-1 truncate font-mono text-[11px] text-foreground/90"
                          title={dir}
                        >
                          {formatDisplayPath(dir)}
                        </span>
                        <button
                          onClick={() =>
                            setExtraDirs(
                              cfg!.extraDirs.filter((d) => d !== dir),
                            )
                          }
                          title="Remover"
                          aria-label={`Remover ${dir}`}
                          className="shrink-0 rounded p-0.5 text-muted-foreground opacity-0 transition-opacity group-hover/dir:opacity-100 hover:text-st-error"
                        >
                          <X className="size-3" />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {cfg?.exists && (
                <p className="text-[11px] text-muted-foreground/55">
                  salvo em <span className="font-mono">.mycockpit/config.toml</span>
                </p>
              )}
            </div>
          </Section>


          {/* DOUTRINA: a instrução do próprio app, a única que alcança os três
              agents (nós injetamos). Vem antes do aprendizado porque é a regra
              escrita pelo humano — o resto abaixo é destilado por máquina. */}
          <Section title="Doutrina">
            <DoctrineSection projectPath={project.path} seeds={doctrineSeeds} />
          </Section>


          {/* Auto-aprendizado (M1/M2): entregas no recall + lições podáveis.
              Auditável — o app propõe, você revisa/remove (princípio do doc). */}
          <Section title="Aprendizado">
            <LearningSection key={reload} projectId={project.id} />
          </Section>


          {/* MH4.3 — histórico das missões do projeto (o índice `missions` do
              banco deixou de ser órfão): desfecho honesto (ressalva incluída),
              custo e o viewer de artefatos por linha. */}
          <Section title="Missões">
            <MissionsSection
              key={reload}
              projectId={project.id}
              projectPath={project.path}
            />
          </Section>

          {/* Arquivos DAS CLIs, colapsado. O título era "o que o agente
              enxerga" e prometia demais: isto é mobília de fornecedor, cada
              linha com um dono, e o agent da conversa pode não ler nada disso —
              é o que a nota cruzada abaixo diz na cara. O conteúdo só monta
              quando aberto (deixa o painel enxuto no dia a dia). Entra no mesmo
              compasso das seções (24px acima, `px-5`, `.label-mono`): sem o
              divisor que existia aqui, título fora do compasso lia como
              continuação da seção anterior. O chevron foi pra DIREITA, onde ele
              já está no `FileRow` e no `ClaudeNode`. */}
          <button
            onClick={() => setShowAgentCtx((v) => !v)}
            className="mt-6 flex w-full items-center gap-2 px-5 text-left"
            aria-expanded={showAgentCtx}
          >
            <div className="min-w-0 flex-1">
              <span className="label-mono">Arquivos das CLIs</span>
              {!showAgentCtx && (
                <div className="mt-1 truncate text-[12px] text-muted-foreground/60">
                  {agentCtxSummary}
                </div>
              )}
            </div>
            <ChevronDown
              className={cn(
                "size-3.5 shrink-0 text-muted-foreground transition-transform",
                showAgentCtx && "rotate-180",
              )}
            />
          </button>

          {showAgentCtx && (
            <>
          {/* A régua honesta: o que o agent DESTA conversa lê do disco. Sem
              isto o painel listava 3 personas e 9 memórias do Claude Code numa
              conversa Codex, como se fossem contexto dela. */}
          {vendorNote && (
            <p className="px-5 pt-2 text-[11px] leading-snug text-muted-foreground/75">
              {vendorNote}
            </p>
          )}

          {/* Zona de INVENTÁRIO (read-only): o que o claude enxerga no cwd */}
          <Section title="No contexto do agente">
            {status === "loading" && <SkeletonRows />}

            {status === "browser" && (
              <p className="text-[13px] leading-relaxed text-muted-foreground/70">
                Inventário disponível no app (tauri dev).
              </p>
            )}

            {status === "error" && (
              <button
                onClick={() => setReload((r) => r + 1)}
                className="flex w-full items-center gap-2 rounded-md border border-st-error/40 bg-st-error/10 px-3 py-2 text-[12px] text-foreground/85 transition-colors hover:bg-st-error/15"
              >
                <AlertCircle className="size-3.5 shrink-0 text-st-error" />
                Não foi possível ler o contexto
                <RefreshCw className="ml-auto size-3.5 text-muted-foreground" />
              </button>
            )}

            {status === "ready" && ctx && (
              <div className="flex flex-col gap-3">
                {sources && sources.drift.length > 0 && (
                  <div className="flex flex-col gap-1.5">
                    {sources.drift.map((d) => (
                      <div
                        key={d.copy}
                        className="flex items-start gap-2 rounded-md border border-st-queued/40 bg-st-queued/10 px-2.5 py-1.5 text-[12px] leading-snug text-foreground/85"
                      >
                        <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-st-queued" />
                        <span>
                          <span className="font-mono">{d.copy}</span> está{" "}
                          {d.days_stale}d atrás de{" "}
                          <span className="font-mono">{d.source}</span> (cópia
                          stale)
                        </span>
                      </div>
                    ))}
                  </div>
                )}
                <div className="flex flex-col gap-0.5">
                  <div className="mb-0.5 text-[11px] text-muted-foreground/55">
                    Instruções
                  </div>
                  {ctx.files.map((f) => (
                    <FileRow
                      key={f.name}
                      file={f}
                      expanded={expanded === f.name}
                      onToggle={() =>
                        setExpanded((cur) => (cur === f.name ? null : f.name))
                      }
                    />
                  ))}
                </div>

                <div className="flex flex-col gap-0.5">
                  <div className="mb-0.5 text-[11px] text-muted-foreground/55">
                    Extensões
                  </div>
                  <ClaudeNode cd={ctx.claude_dir} />
                  {/* comandos da CASA (onde a skill promovida mora): valem em
                      qualquer motor via expansão app-side */}
                  {ctx.mycockpit_commands > 0 && (
                    <div className="flex items-center justify-between rounded-md px-2 py-1.5">
                      <span className="flex items-center gap-2 font-mono text-[13px] text-foreground/90">
                        <FolderGit2 className="size-3.5 text-muted-foreground" />
                        .mycockpit/commands
                      </span>
                      <span className="text-[11px] text-muted-foreground/70">
                        {ctx.mycockpit_commands}{" "}
                        {ctx.mycockpit_commands === 1 ? "comando" : "comandos"}
                      </span>
                    </div>
                  )}
                </div>

                {ctx.mcp_servers != null && (
                  <div className="flex flex-col gap-0.5">
                    <div className="mb-0.5 text-[11px] text-muted-foreground/55">
                      MCP
                    </div>
                    <div className="flex items-center justify-between rounded-md px-2 py-1.5">
                      <span className="flex items-center gap-2 font-mono text-[13px] text-foreground/90">
                        <Plug className="size-3.5 text-muted-foreground" />
                        .mcp.json
                      </span>
                      <span className="text-[11px] text-muted-foreground/70">
                        {ctx.mcp_servers}{" "}
                        {ctx.mcp_servers === 1 ? "servidor" : "servidores"}
                      </span>
                    </div>
                  </div>
                )}
              </div>
            )}
          </Section>

          {/* Fase 2, fontes REAIS indexadas (não copiadas). "Subagents", não
              "Personas": persona do app é preset (.mycockpit/agents), e ter duas
              seções com o mesmo nome e donos diferentes confundia. Isto aqui é
              CONTEXTO EXTERNO lido por code agents (.claude/agents, AGENTS.md),
              não os especialistas do app, que é o que o "@" do composer menciona. */}
          {status === "ready" && sources && sources.personas.length > 0 && (
            <Section title="Subagents do Claude Code">
              <div className="flex flex-col gap-1.5">
                {sources.personas.map((p) => (
                  <button
                    key={p.name}
                    onClick={() => setDetail({ title: p.name, path: p.path })}
                    className="w-full rounded-md px-2 py-1.5 text-left transition-colors hover:bg-accent/40"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate font-mono text-[13px] text-foreground/90">
                        {p.name}
                      </span>
                      {p.model && p.model !== "inherit" && (
                        <span className="shrink-0 rounded border px-1 py-px text-[11px] tracking-wide text-muted-foreground uppercase">
                          {p.model}
                        </span>
                      )}
                    </div>
                    {p.description && (
                      <p className="mt-0.5 line-clamp-2 text-[12px] leading-snug text-muted-foreground/80">
                        {p.description}
                      </p>
                    )}
                  </button>
                ))}
              </div>
            </Section>
          )}

          {status === "ready" && sources && sources.specs.length > 0 && (
            <Section title="Specs">
              <div className="flex flex-col gap-1">
                {sources.specs.map((s) => (
                  <button
                    key={s.slug}
                    onClick={() =>
                      setDetail({ title: s.title ?? s.slug, path: s.path })
                    }
                    className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-accent/40"
                  >
                    <span className="truncate text-[12px] text-foreground/90">
                      {s.title ?? s.slug}
                    </span>
                    {s.stage && <StageBadge stage={s.stage} />}
                  </button>
                ))}
              </div>
            </Section>
          )}

          {status === "ready" && sources?.memory.exists && (
            <Section title="Memórias">
              <button
                onClick={() =>
                  sources.memory.path &&
                  setDetail({ title: "MEMORY.md", path: sources.memory.path })
                }
                disabled={!sources.memory.path}
                className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left transition-colors hover:bg-accent/40 disabled:cursor-default disabled:hover:bg-transparent"
              >
                <span className="flex items-center gap-2 text-[13px] text-muted-foreground">
                  <Brain className="size-3.5" />
                  memória do projeto
                </span>
                <span className="text-[11px] text-muted-foreground/70">
                  {sources.memory.count}{" "}
                  {sources.memory.count === 1 ? "nota" : "notas"}
                </span>
              </button>
            </Section>
          )}
            </>
          )}
          {/* Piso do rolamento: sem os divisores, a última seção terminava
              encostada na borda do cartão. 16px é o mesmo respiro do mock. */}
          <div className="h-4" aria-hidden />
        </ScrollArea>
      )}

      <DetailDialog
        root={project?.path ?? ""}
        target={detail}
        onClose={() => setDetail(null)}
      />
    </aside>
  )
}
