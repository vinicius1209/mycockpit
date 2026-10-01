// Configurações ▸ Conversas ▸ Modelo auxiliar (ADR-268). Chamava "Sugestões",
// e o nome descrevia um dos sete usos: o mesmo modelo nomeia a conversa quando
// o motor não nomeia, escreve o recibo da notificação, destila as lições do
// feedback, rascunha skill pela paleta e roda nas missões. Desligar sem saber
// disso era desligar o nome da conversa sem querer.

import { RichSelect } from "@/components/ui/RichSelect"
import { Switch } from "@/components/ui/switch"
import { Field, Note, Row, SELECT_TRIGGER, SectionHeader } from "@/components/settings/parts"
import { sectionDef } from "@/components/settings/sections"
import { useApp } from "@/store/app"
import { DEFAULT_HELPER_FEATURES, type HelperFeatures } from "@/lib/settings"

const HELPER_OPTIONS = [
  { value: "off", label: "Desligado", description: "Nenhum dos usos abaixo acontece" },
  { value: "haiku", label: "Haiku", description: "Rápido e barato (recomendado)" },
  { value: "sonnet", label: "Sonnet", description: "Mais capaz" },
  { value: "opus", label: "Opus", description: "Máxima qualidade" },
]

/** O que o modelo auxiliar faz, na ordem em que a pessoa sente falta. */
const USOS_DO_AUXILIAR: { id: keyof HelperFeatures; titulo: string; dica: string }[] = [
  { id: "conversationTitle", titulo: "Nome da conversa", dica: "Quando o motor não dá o título no primeiro turno." },
  { id: "turnReceipt", titulo: "Recibo da notificação", dica: "O resumo do turno que terminou com você em outra conversa." },
  { id: "composerSuggestions", titulo: "Sugestões do composer", dica: "Os próximos passos oferecidos depois de cada resposta." },
  { id: "learningLessons", titulo: "Lições", dica: "O que fica aprendido quando você reage a uma resposta." },
]

export interface ModeloAuxiliarProps {
  helperModel?: string | null
  helperFeatures?: Partial<HelperFeatures>
  onModelChange?: (m: string | null) => void
  onFeatureChange?: (f: keyof HelperFeatures, v: boolean) => void
}

export function ModeloAuxiliar(props: ModeloAuxiliarProps = {}) {
  const def = sectionDef("suggestions")
  const storeHelperModel = useApp((s) => s.settings.helperModel)
  const storeHelperFeatures = useApp((s) => s.settings.helperFeatures)
  const setSettings = useApp((s) => s.setSettings)

  const helperModel = props.helperModel !== undefined ? props.helperModel : storeHelperModel
  const helperFeatures = props.helperFeatures !== undefined ? props.helperFeatures : storeHelperFeatures
  const isOff = !helperModel
  const features: HelperFeatures = {
    ...DEFAULT_HELPER_FEATURES,
    ...helperFeatures,
  }

  const handleModelChange = props.onModelChange ?? ((v: string | null) => setSettings({ helperModel: v }))
  const handleFeatureChange =
    props.onFeatureChange ??
    ((id: keyof HelperFeatures, checked: boolean) => {
      setSettings({
        helperFeatures: {
          ...features,
          [id]: checked,
        },
      })
    })

  return (
    <div>
      <SectionHeader title={def.title} description={def.question} />
      <div className="divide-y divide-border/40">
        <Field
          label="Modelo"
          hint="Vale para todos os projetos, a não ser que um projeto escolha outro no .frota/config.toml. Cada uso é um turno curto e pago."
        >
          <RichSelect
            value={helperModel ?? "off"}
            onValueChange={(v) => handleModelChange(v === "off" ? null : v)}
            options={HELPER_OPTIONS}
            triggerClassName={SELECT_TRIGGER}
            aria-label="Modelo auxiliar"
          />
        </Field>
      </div>
      <ul className="mt-4 flex flex-col gap-1.5">
        {USOS_DO_AUXILIAR.map((uso) => (
          <Row
            key={uso.id}
            titulo={uso.titulo}
            dica={uso.dica}
            direita={
              <Switch
                checked={!isOff && (features[uso.id] ?? true)}
                disabled={isOff}
                onCheckedChange={(checked) => handleFeatureChange(uso.id, checked)}
                aria-label={uso.titulo}
              />
            }
          />
        ))}
      </ul>
      <Note>
        Desligado, nenhum dos usos acima acontece. Com um modelo ativo, cada opção
        pode ser ligada ou desligada individualmente.
      </Note>
    </div>
  )
}
