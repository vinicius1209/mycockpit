// Configurações ▸ Novas conversas. A pergunta: "com o que uma conversa nova
// começa: agent, modelo e esforço".
//
// Saiu do SettingsDialog quando a guarda de tamanho mordeu (702 de 700): a
// regra da casa é DIVIDIR, não subir o teto. Esta seção era o corte natural
// porque é a que tem lógica própria — as outras são campo + switch.
//
// A lógica própria é uma só, e é o motivo desta seção existir separada: a
// escolha do padrão CRUZA com o probe real da máquina. `available` no catálogo
// (lib/agents) quer dizer "não é 'em breve'", NUNCA "existe aqui". Sem o
// cruzamento dava pra eleger como padrão um agent que a seção "Agentes na
// máquina" — dois cliques ao lado — sabe que não está instalado, e a falha só
// aparecia no primeiro envio da conversa seguinte, longe da causa.

import { AlertTriangle } from "lucide-react"
import { RichSelect } from "@/components/ui/RichSelect"
import { useApp } from "@/store/app"
import {
  DESTINATIONS,
  agentModels,
  agentEfforts,
  normalizeModelValue,
} from "@/lib/agents"
import { estadoNaMaquina } from "@/lib/detect"
import { Field, Note, SectionHeader, SELECT_TRIGGER } from "@/components/settings/parts"
import { sectionDef } from "@/components/settings/sections"

export function NewChatDefaults() {
  const settings = useApp((s) => s.settings)
  const setSettings = useApp((s) => s.setSettings)
  const def = sectionDef("new-chats")
  const padraoAusente =
    estadoNaMaquina(settings.defaultAgent, settings.detected) === "ausente"

  return (
    <div>
      <SectionHeader title={def.title} description={def.question} />
      <div className="divide-y divide-border/50">
        <Field label="Agent" hint="Pré-selecionado ao abrir uma conversa nova.">
          <RichSelect
            value={settings.defaultAgent}
            onValueChange={(v) =>
              // troca de agent → zera modelo/effort p/ o default do novo agent
              setSettings({
                defaultAgent: v,
                defaultModel: null,
                defaultEffort: null,
              })
            }
            options={DESTINATIONS.filter((d) => d.available).map((d) => {
              const estado = estadoNaMaquina(d.id, settings.detected)
              return {
                value: d.id,
                label: d.label,
                // "desconhecido" NÃO desabilita: mapa vazio é máquina que ainda
                // não foi olhada, não máquina vazia (ver estadoNaMaquina).
                disabled: estado === "ausente",
                description:
                  estado === "ausente"
                    ? "não instalado nesta máquina"
                    : d.description,
              }
            })}
            triggerClassName={SELECT_TRIGGER}
            aria-label="Agent default"
          />
        </Field>
        <Field label="Modelo">
          {/* normaliza o persistido: id que saiu do picker (o3,
              gpt-5.3-codex) exibiria "Padrão" mentiroso no trigger
              enquanto os envios continuariam com o valor morto. */}
          <RichSelect
            value={
              normalizeModelValue(settings.defaultAgent, settings.defaultModel) ??
              "default"
            }
            onValueChange={(v) =>
              setSettings({ defaultModel: v === "default" ? null : v })
            }
            options={agentModels(settings.defaultAgent)}
            triggerClassName={SELECT_TRIGGER}
            aria-label="Modelo default"
          />
        </Field>
        {agentEfforts(settings.defaultAgent).length > 0 && (
          <Field label="Esforço">
            <RichSelect
              value={settings.defaultEffort ?? "default"}
              onValueChange={(v) =>
                setSettings({ defaultEffort: v === "default" ? null : v })
              }
              options={agentEfforts(settings.defaultAgent)}
              triggerClassName={SELECT_TRIGGER}
              aria-label="Effort default"
            />
          </Field>
        )}
      </div>
      {/* O padrão salvo pode ter sido desinstalado DEPOIS de escolhido. O aviso
          fica FORA do dropdown de propósito: dentro, só quem abrisse a lista
          descobriria, e o trigger fechado seguiria exibindo um nome que não
          roda. */}
      {padraoAusente && (
        <div className="mt-3 flex items-start gap-2 rounded-md border border-st-warning/40 bg-st-warning/10 px-2.5 py-2 text-[12px] leading-snug text-st-warning">
          <AlertTriangle className="mt-px size-3.5 shrink-0" />
          <span>
            O agent padrão não está instalado nesta máquina. Conversas novas vão
            falhar no primeiro envio até você instalar a CLI ou escolher outro
            padrão aqui.
          </span>
        </div>
      )}
      <Note>
        Conversas já iniciadas mantêm o config do 1º envio; isto vale só para
        novas. Quais modelos aparecem nesta lista é assunto da seção Modelos.
      </Note>
    </div>
  )
}
