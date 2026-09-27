// Configurações ▸ Conversas ▸ Modelo auxiliar (ADR-268). Chamava "Sugestões",
// e o nome descrevia um dos sete usos: o mesmo modelo nomeia a conversa quando
// o motor não nomeia, escreve o recibo da notificação, destila as lições do
// feedback, rascunha skill pela paleta e roda nas missões. Desligar sem saber
// disso era desligar o nome da conversa sem querer.

import { RichSelect } from "@/components/ui/RichSelect"
import { Field, Note, Row, SELECT_TRIGGER, SectionHeader } from "@/components/settings/parts"
import { sectionDef } from "@/components/settings/sections"
import { useApp } from "@/store/app"

const HELPER_OPTIONS = [
  { value: "off", label: "Desligado", description: "Nenhum dos usos abaixo acontece" },
  { value: "haiku", label: "Haiku", description: "Rápido e barato (recomendado)" },
  { value: "sonnet", label: "Sonnet", description: "Mais capaz" },
  { value: "opus", label: "Opus", description: "Máxima qualidade" },
]

/** O que o modelo auxiliar faz, na ordem em que a pessoa sente falta. */
const USOS_DO_AUXILIAR: { titulo: string; dica: string }[] = [
  { titulo: "Nome da conversa", dica: "Quando o motor não dá o título no primeiro turno." },
  { titulo: "Recibo da notificação", dica: "O resumo do turno que terminou com você em outra conversa." },
  { titulo: "Sugestões do composer", dica: "Os próximos passos oferecidos depois de cada resposta." },
  { titulo: "Lições", dica: "O que fica aprendido quando você reage a uma resposta." },
]

export function ModeloAuxiliar() {
  const def = sectionDef("suggestions")
  const helperModel = useApp((s) => s.settings.helperModel)
  const setSettings = useApp((s) => s.setSettings)
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
            onValueChange={(v) => setSettings({ helperModel: v === "off" ? null : v })}
            options={HELPER_OPTIONS}
            triggerClassName={SELECT_TRIGGER}
            aria-label="Modelo auxiliar"
          />
        </Field>
      </div>
      <ul className="mt-4 flex flex-col gap-1.5">
        {USOS_DO_AUXILIAR.map((uso) => (
          <Row key={uso.titulo} titulo={uso.titulo} dica={uso.dica} />
        ))}
      </ul>
      <Note>
        Desligado, nada disso acontece: a conversa fica com a primeira frase
        como nome, e a notificação sai sem resumo.
      </Note>
    </div>
  )
}
