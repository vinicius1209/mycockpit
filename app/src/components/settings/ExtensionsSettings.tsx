import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { listen } from "@tauri-apps/api/event"
import { Boxes, Loader2, RefreshCcw, Sparkles } from "lucide-react"
import { Button } from "@/components/ui/button"
import { PillSelect } from "@/components/ui/PillSelect"
import {
  Block,
  BlockTitle,
  Card,
  CardBody,
  Row,
  SectionHeader,
} from "@/components/settings/parts"
import {
  PluginReviewCard,
  type PluginConfirmation,
} from "@/components/settings/PluginReviewCard"
import { AGENTS, agentDef } from "@/lib/agents"
import {
  extensionKindLabel,
  mergeExtensionEntries,
  type AgentCommandInventory,
  type ExtensionEntry,
} from "@/lib/extensions"
import {
  approvePlugin,
  inspectPlugins,
  revokePluginGrant,
  setPluginEnabled,
  stopPluginRuntime,
  type PluginInventory,
} from "@/lib/plugins"
import { initialMcpProjectId } from "@/lib/mcp"
import { readProjectCommands } from "@/lib/sources"
import { useApp } from "@/store/app"
import { cn } from "@/lib/utils"
import { isTauri } from "@/lib/db"

const RUNTIME_AGENTS = AGENTS.filter((agent) => agent.available && agent.kind === "agent")

function agentLabel(id: string): string {
  return agentDef(id)?.shortLabel ?? id
}

function originLabel(entry: ExtensionEntry): string {
  const scope = entry.origin === "global" ? "usuário" : "projeto"
  if (entry.kind === "shared-skill") {
    return `${scope} · expandida pela Frota`
  }
  if (entry.kind === "plugin-skill") {
    return `${scope} · plugin revisado · expandida pela Frota`
  }
  return `${entry.source} · ${scope} · depende do provider`
}

function ExtensionRow({ entry }: { entry: ExtensionEntry }) {
  return (
    <Row
      glifo={<Sparkles className="size-3.5 text-brass" />}
      titulo={<span className="font-mono">/{entry.name}</span>}
      dica={
        <>
          {extensionKindLabel(entry.kind)} · {originLabel(entry)}
          {entry.description ? ` · ${entry.description}` : ""}
        </>
      }
      direita={
        <span className="max-w-32 truncate font-mono text-[11px] text-muted-foreground">
          {entry.agents.map(agentLabel).join(" · ")}
        </span>
      }
    />
  )
}

export function ExtensionsSettings() {
  const projects = useApp((state) => state.projects)
  const activeProjectId = useApp((state) => state.activeProjectId)
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null)
  const project = useMemo(() => {
    const id =
      selectedProjectId && projects.some((item) => item.id === selectedProjectId)
        ? selectedProjectId
        : initialMcpProjectId(projects, activeProjectId)
    return projects.find((item) => item.id === id) ?? null
  }, [activeProjectId, projects, selectedProjectId])

  const [entries, setEntries] = useState<ExtensionEntry[]>([])
  const [plugins, setPlugins] = useState<PluginInventory | null>(null)
  const [unavailableAgents, setUnavailableAgents] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [busyPlugin, setBusyPlugin] = useState<string | null>(null)
  const [confirmation, setConfirmation] = useState<{
    pluginKey: string
    kind: Exclude<PluginConfirmation, null>
  } | null>(null)
  const [pluginErrors, setPluginErrors] = useState<Record<string, string>>({})
  const shownPathRef = useRef<string | null>(null)

  const load = useCallback(async () => {
    const path = project?.path ?? null
    shownPathRef.current = path
    setLoading(true)
    setError(null)
    const pluginPromise = inspectPlugins()
    const commandPromise = path
      ? Promise.allSettled(
          RUNTIME_AGENTS.map(async (agent): Promise<AgentCommandInventory> => ({
            agent: agent.id,
            commands: await readProjectCommands(path, agent.id),
          })),
        )
      : Promise.resolve([])
    try {
      const [pluginInventory, commandResults] = await Promise.all([
        pluginPromise,
        commandPromise,
      ])
      if (shownPathRef.current !== path) return
      const available: AgentCommandInventory[] = []
      const unavailable: string[] = []
      commandResults.forEach((result, index) => {
        if (result.status === "fulfilled") available.push(result.value)
        else unavailable.push(RUNTIME_AGENTS[index].id)
      })
      setEntries(mergeExtensionEntries(available))
      setUnavailableAgents(unavailable)
      setPlugins(pluginInventory)
    } catch (cause) {
      if (shownPathRef.current === path) {
        setError(cause instanceof Error ? cause.message : String(cause))
      }
    } finally {
      if (shownPathRef.current === path) setLoading(false)
    }
  }, [project])

  useEffect(() => {
    void load()
    return () => {
      shownPathRef.current = null
    }
  }, [load])

  useEffect(() => {
    if (!isTauri()) return
    let disposed = false
    const unlisten: Array<() => void> = []
    const refresh = () => {
      void inspectPlugins()
        .then((inventory) => {
          if (!disposed) setPlugins(inventory)
        })
        .catch((cause) => {
          if (!disposed) {
            setError(cause instanceof Error ? cause.message : String(cause))
          }
        })
    }
    void Promise.all([
      listen("plugin://inventory-changed", refresh),
      listen("plugin://runtime", refresh),
    ])
      .then((listeners) => {
        if (disposed) listeners.forEach((stop) => stop())
        else unlisten.push(...listeners)
      })
      .catch((cause) => {
        if (!disposed) {
          setError(cause instanceof Error ? cause.message : String(cause))
        }
      })
    return () => {
      disposed = true
      unlisten.forEach((stop) => stop())
    }
  }, [])

  const actOnPlugin = useCallback(
    async (pluginKey: string, action: () => Promise<void>) => {
      setBusyPlugin(pluginKey)
      setPluginErrors((current) => ({ ...current, [pluginKey]: "" }))
      try {
        await action()
        setConfirmation((current) =>
          current?.pluginKey === pluginKey ? null : current,
        )
        setPlugins(await inspectPlugins())
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause)
        setPluginErrors((current) => ({ ...current, [pluginKey]: message }))
      } finally {
        setBusyPlugin(null)
      }
    },
    [],
  )

  return (
    <div>
      <SectionHeader
        title="Skills e plugins"
        description="Quais extensões existem, para quais agents valem e que código a Frota se recusa a executar sem consentimento."
        action={
          <Button
            type="button"
            size="compacto"
            variant="ghost"
            onClick={() => void load()}
            disabled={loading}
          >
            <RefreshCcw className={cn("size-3.5", loading && "animate-spin")} />
            Atualizar
          </Button>
        }
      />

      {project && (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <span className="text-[12px] font-medium text-foreground">Projeto:</span>
          <PillSelect
            value={project.id}
            onValueChange={setSelectedProjectId}
            options={projects.map((item) => ({
              value: item.id,
              label: item.name,
            }))}
            triggerClassName="h-7 gap-1.5 px-2.5 text-[12px] text-foreground"
            title="Escopo deste painel; não muda o projeto ativo do app"
            aria-label="Projeto das skills"
          />
          {loading && <Loader2 className="size-3.5 animate-spin text-muted-foreground" />}
        </div>
      )}

      <BlockTitle hint="O inventário é calculado por adapter; a mesma skill compartilhada aparece uma vez com todos os destinos que a recebem.">
        Skills e comandos efetivos
      </BlockTitle>
      {entries.length > 0 ? (
        <ul className="space-y-1.5">
          {entries.map((entry) => (
            <ExtensionRow key={entry.key} entry={entry} />
          ))}
        </ul>
      ) : (
        <Card>
          <div className="px-3 py-2.5 text-[12px] leading-snug text-muted-foreground">
            {project
              ? "Nenhuma skill ou comando foi encontrado para este projeto."
              : "Adicione um projeto para inventariar skills e comandos."}
          </div>
        </Card>
      )}
      {unavailableAgents.length > 0 && (
        <p className="mt-2 text-[11px] text-st-warning">
          Inventário indisponível para: {unavailableAgents.map(agentLabel).join(", ")}.
        </p>
      )}

      <Block>
        <BlockTitle hint="Pacotes globais usam frota-plugin.json v1; manifesto, arquivos contribuídos e código entram no fingerprint de consentimento.">
          Plugins
        </BlockTitle>
        <div className="space-y-2">
          {plugins?.plugins.map((plugin) => (
            <PluginReviewCard
              key={plugin.key}
              plugin={plugin}
              confirmation={
                confirmation?.pluginKey === plugin.key ? confirmation.kind : null
              }
              busy={busyPlugin === plugin.key}
              error={pluginErrors[plugin.key] || null}
              onConfirm={(kind) => setConfirmation({ pluginKey: plugin.key, kind })}
              onCancel={() => setConfirmation(null)}
              onApprove={() => {
                const fingerprint = plugin.fingerprint
                if (!fingerprint) return
                void actOnPlugin(plugin.key, () =>
                  approvePlugin(plugin.key, fingerprint),
                )
              }}
              onEnable={(enabled) =>
                void actOnPlugin(plugin.key, () =>
                  setPluginEnabled(plugin.key, enabled),
                )
              }
              onRevoke={() =>
                void actOnPlugin(plugin.key, () => revokePluginGrant(plugin.key))
              }
              onStop={() =>
                void actOnPlugin(plugin.key, () => stopPluginRuntime(plugin.key))
              }
            />
          ))}
          {plugins && plugins.plugins.length === 0 && (
            <Card>
              <div className="flex items-center gap-2 px-3 py-2.5">
                <Boxes className="size-3.5 text-brass" />
                <span className="text-[12px] text-muted-foreground">
                  Nenhum pacote de plugin descoberto.
                </span>
              </div>
            </Card>
          )}
        </div>
        {plugins && (
          <p className="mt-2 text-[12px] leading-snug text-muted-foreground">
            {plugins.detail}
          </p>
        )}
      </Block>

      {error && (
        <Card className="mt-3 border-st-error/30 bg-st-error/5">
          <CardBody>
            <p className="text-[12px] text-st-error">{error}</p>
          </CardBody>
        </Card>
      )}
    </div>
  )
}
