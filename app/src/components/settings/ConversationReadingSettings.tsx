import { useEffect, useState } from "react"
import { RotateCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { RichSelect } from "@/components/ui/RichSelect"
import { Switch } from "@/components/ui/switch"
import { Field, SectionHeader, SELECT_TRIGGER } from "@/components/settings/parts"
import { sectionDef } from "@/components/settings/sections"
import { probeUtilitySources } from "@/lib/utility"
import type { UtilityFailureCode, UtilitySourceDescriptor } from "@/lib/utility/types"
import { useApp } from "@/store/app"
import { useConversationMaps } from "@/store/conversationMaps"

const SOURCE_OPTIONS = [
  {
    value: "free_only",
    label: "No dispositivo",
    description: "Apple Intelligence quando disponível, sem custo remoto",
  },
  {
    value: "off",
    label: "Somente fatos",
    description: "Sem leitura semântica, o estado real continua visível",
  },
]

const FAILURE_LABELS: Partial<Record<UtilityFailureCode, string>> = {
  unsupported_os: "Este sistema não oferece Apple Intelligence.",
  device_not_eligible: "Este Mac não é compatível com Apple Intelligence.",
  intelligence_disabled: "Apple Intelligence está desativada no sistema.",
  model_not_ready: "O modelo local ainda está sendo preparado pelo sistema.",
  locale_unsupported: "O modelo local não oferece leitura em pt-BR.",
  framework_unavailable: "Foundation Models não está disponível neste build.",
  deadline_exceeded: "A verificação local demorou mais do que o esperado.",
  protocol_error: "O componente local precisa ser atualizado.",
  probe_failed: "Não foi possível verificar o modelo local agora.",
}

function sourceStatus(source: UtilitySourceDescriptor | undefined): string {
  if (!source) return "Verificando o modelo local…"
  if (source.availability === "available") {
    return "Apple Intelligence disponível neste Mac, em pt-BR."
  }
  return (
    FAILURE_LABELS[source.failure?.code ?? "probe_failed"] ??
    "A leitura semântica local não está disponível agora."
  )
}

export function ConversationReadingSettings() {
  const settings = useApp((state) => state.settings)
  const setSettings = useApp((state) => state.setSettings)
  const [sources, setSources] = useState<UtilitySourceDescriptor[] | null>(null)
  const [checking, setChecking] = useState(false)
  const definition = sectionDef("conversation-reading")
  const task = settings.utilityInference.tasks.conversation_map!

  async function probe() {
    setChecking(true)
    const next = await probeUtilitySources("pt-BR")
    setSources(next)
    setChecking(false)
  }

  useEffect(() => {
    void probe()
  }, [])

  function updateUtility(patch: Partial<typeof settings.utilityInference>) {
    setSettings({
      utilityInference: { ...settings.utilityInference, ...patch },
    })
  }

  function setRoute(value: string) {
    if (value === "off") useConversationMaps.getState().cancelAll()
    updateUtility({
      tasks: {
        ...settings.utilityInference.tasks,
        conversation_map: {
          ...task,
          route: value === "off" ? "off" : "free_only",
        },
      },
    })
  }

  const apple = sources?.find((source) => source.id === "apple-foundation-model")

  return (
    <div>
      <SectionHeader title={definition.title} description={definition.question} />
      <div className="divide-y divide-border/50">
        <Field
          label="Atualizar automaticamente"
          hint="Atualiza depois que um turno assenta. Nunca abre um run nem bloqueia o chat."
        >
          <Switch
            checked={settings.utilityInference.automaticConversationMaps}
            onCheckedChange={(automaticConversationMaps) =>
              updateUtility({ automaticConversationMaps })
            }
            aria-label="Atualizar a leitura das conversas automaticamente"
          />
        </Field>
        <Field
          label="Fonte"
          hint="Sem modelo local, a aba continua mostrando pedido, desfecho, tarefas e decisões reais."
        >
          <RichSelect
            value={task.route === "off" ? "off" : "free_only"}
            onValueChange={setRoute}
            options={SOURCE_OPTIONS}
            triggerClassName={SELECT_TRIGGER}
            aria-label="Fonte da leitura das conversas"
          />
        </Field>
      </div>
      <div className="mt-5 rounded-lg bg-secondary/45 px-3 py-3">
        <div className="flex items-start gap-3">
          <p className="min-w-0 flex-1 text-[12px] leading-relaxed text-muted-foreground">
            {sourceStatus(apple)}
          </p>
          <Button
            type="button"
            variant="ghost"
            size="icone-compacto"
            aria-label="Verificar novamente"
            disabled={checking}
            onClick={() => void probe()}
          >
            <RotateCw
              className={checking ? "animate-spin motion-reduce:animate-none" : undefined}
            />
          </Button>
        </div>
        <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground/70">
          A rota padrão roda no dispositivo, sem tools, MCPs, sessão de agente ou cobrança remota.
        </p>
      </div>
    </div>
  )
}
