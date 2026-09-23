// A aba CONTEXTO do painel direito: ajustes do projeto, doutrina, aprendizado,
// missões e os arquivos das CLIs lidos do disco.
//
// Saiu do `ContextPanel` (16/09/2026, ADR-200) para o painel caber mais uma aba
// sem que a catraca de tamanho decidisse o produto. O corte é o de dono: tudo
// aqui tem estado próprio (leitura do disco, seção aberta, diálogo de detalhe)
// e nada disso interessa às outras abas. O painel ficou só com o roteamento.

import { useEffect, useState } from "react"
import {
  AlertCircle,
  AlertTriangle,
  Brain,
  ChevronDown,
  FolderGit2,
  FolderPlus,
  Plug,
  RefreshCw,
  X,
} from "lucide-react"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Section } from "@/components/layout/contextPanelChrome"
import {
  ClaudeNode,
  DetailDialog,
  FileRow,
  SkeletonRows,
  type DetailTarget,
  type Status,
} from "@/components/layout/contextoDoProjetoPecas"
import { LearningSection } from "@/components/layout/LearningSection"
import { MissionsSection } from "@/components/layout/MissionsSection"
import { PastaAntigaDoProjeto } from "@/components/layout/PastaAntigaDoProjeto"
import { useApp } from "@/store/app"
import type { ProjectConfig } from "@/store/app"
import type { Project } from "@/lib/types"
import { readProjectContext } from "@/lib/context"
import type { ProjectContext } from "@/lib/context"
import { readProjectSources } from "@/lib/sources"
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
import { writeProjectConfig } from "@/lib/configDoProjeto"
import { isTauri } from "@/lib/db"
import { controle } from "@/components/ui/controle"
import { cn, formatDisplayPath } from "@/lib/utils"


export function ContextoDoProjeto({
  project,
  readerAgent,
}: {
  project: Project
  /** Agent da conversa ativa: a régua de quem lê o quê. */
  readerAgent: string | null
}) {
  const [ctx, setCtx] = useState<ProjectContext | null>(null)
  const [sources, setSources] = useState<ProjectSources | null>(null)
  const [status, setStatus] = useState<Status>("loading")
  const [expanded, setExpanded] = useState<string | null>(null)
  const [reload, setReload] = useState(0)
  // Referência do agente nasce COLAPSADA: é consulta rara, abre sob demanda.
  const [showAgentCtx, setShowAgentCtx] = useState(false)
  const [detail, setDetail] = useState<DetailTarget | null>(null)

  const setProjectConfig = useApp((s) => s.setProjectConfig)
  const cfg = useApp((s) => (project ? s.projectConfigs[project.id] : undefined))

  // upsert da config do projeto em memória (cria com defaults se ainda não há)
  function upsertConfig(patch: Partial<ProjectConfig>) {
    if (!project) return
    const cur: ProjectConfig = cfg ?? {
      exists: true, pasta: ".frota",
      permission: project.permissionMode ?? "padrao",
      helper: "haiku",
      mode: "linear",
      extraDirs: [],
    }
    setProjectConfig(project.id, { ...cur, ...patch, exists: true })
  }

  /** Adiciona/remove pastas liberadas (viram --add-dir no próximo turno). Persiste
   *  no .frota/config.toml; o Rust resolve no spawn. Aplica ao PRÓXIMO envio
   *  (o gate de diretório do CLI é fixo no spawn — não expande mid-run). */
  function setExtraDirs(dirs: string[]) {
    if (!project) return
    upsertConfig({ extraDirs: dirs })
    void writeProjectConfig(project.path, { extraDirs: dirs })
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

  // A troca de permissão mora em lib/permission.ts; as três camadas que
  // precisam concordar estão lá, em fonte única.

  const projectPath = project?.path
  useEffect(() => {
    let cancelled = false
    if (!projectPath) return
    setExpanded(null)
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
    <>
          <ScrollArea className="min-h-0 flex-1">
            {/* Identidade (nome/path) mora no titlebar + sidebar; copiar o caminho
                vive no menu de contexto do projeto. Painel começa nos controles. */}
            <Section title="Ajustes">
              <div className="flex flex-col gap-2.5">
                {/* Permissões MUDARAM DE CASA: viraram o controle de 3 posições no
                    rodapé do composer. Ficavam aqui, a
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
                      className={cn(
                      controle("compacto"),
                      "bg-secondary/60 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground",
                    )}
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
                    salvo em <span className="font-mono">{cfg.pasta}/config.toml</span>
                  </p>
                )}
                {cfg && cfg.pasta !== ".frota" && (
                  <PastaAntigaDoProjeto
                    project={project}
                    pasta={cfg.pasta}
                    onMigrou={() => setReload((n) => n + 1)}
                  />
                )}
              </div>
            </Section>
  
  
            {/* DOUTRINA: a instrução do próprio app, a única que alcança os três
                agents (nós injetamos). Vem antes do aprendizado porque é a regra
                escrita pelo humano — o resto abaixo é destilado por máquina. */}
            <Section title="Doutrina">
              <DoctrineSection key={reload} projectPath={project.path} seeds={doctrineSeeds} />
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
                  className={cn(
                  controle("padrao"),
                  "w-full border border-st-error/40 bg-st-error/10 text-foreground/85 transition-colors hover:bg-st-error/15",
                )}
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
                      <div className="flex h-7 items-center justify-between rounded-md px-2.5">
                        <span className="flex items-center gap-2 font-mono text-[13px] text-foreground/90">
                          <FolderGit2 className="size-3.5 text-muted-foreground" />
                          {cfg?.pasta ?? ".frota"}/commands
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
                      <div className="flex h-7 items-center justify-between rounded-md px-2.5">
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
                "Personas": persona do app é preset (pasta da Frota, agents/), e ter duas
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
                      className="w-full rounded-md text-left transition-colors hover:bg-accent/40"
                    >
                      {/* Linha de altura variável (nome + descrição): não é
                          degrau da escada, então o respiro mora no conteúdo, com
                          o mesmo trilho de 10px das linhas compactas vizinhas. */}
                      <div className="px-2.5 py-1.5">
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
                      </div>
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
                  className={cn(
                  controle("compacto"),
                  "w-full justify-between text-left transition-colors hover:bg-accent/40 disabled:cursor-default disabled:hover:bg-transparent",
                )}
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
        <DetailDialog
          root={project.path}
          target={detail}
          onClose={() => setDetail(null)}
        />
    </>
  )
}
