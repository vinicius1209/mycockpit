// Configurações ▸ Ditado. A pergunta: "falar no lugar de digitar, em pt-BR e
// sem sair da máquina".
//
// Saiu do SettingsDialog quando a guarda de tamanho mordeu pela 2ª vez nesta
// sessão (763 de 700). Mesmo critério da 1ª vez: esta virou a seção com LÓGICA
// própria — captura de atalho, enumeração de microfones do CoreAudio e a lista
// de vocabulário —, enquanto as outras seções do arquivo são campo + switch.

import { useEffect, useState } from "react"
import { X } from "lucide-react"
import { RichSelect } from "@/components/ui/RichSelect"
import { Switch } from "@/components/ui/switch"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { useApp } from "@/store/app"
import { sttDevices, type MicDevice } from "@/lib/stt"
import {
  DEFAULT_DICTATION_HOTKEY,
  captureHotkey,
  formatHotkey,
} from "@/lib/dictationHotkey"
import {
  Field,
  SectionHeader,
  SELECT_TRIGGER,
} from "@/components/settings/parts"
import { sectionDef } from "@/components/settings/sections"
import { cn } from "@/lib/utils"

/** Campo "Atalho do ditado": mostra o combo formatado e grava um novo — em
 *  modo captura o PRÓXIMO keydown com ≥1 modificador vira o combo (validação
 *  em captureHotkey, pura); Esc cancela. Listener em CAPTURE + stopPropagation
 *  pra tecla nenhuma vazar pro dialog (Esc fecharia as Configurações). */
function HotkeyField() {
  const combo = useApp((s) => s.settings.dictationHotkey)
  const enabled = useApp((s) => s.settings.dictationEnabled)
  const setSettings = useApp((s) => s.setSettings)
  const [capturing, setCapturing] = useState(false)
  const [warn, setWarn] = useState<string | null>(null)

  useEffect(() => {
    if (!capturing) return
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault()
      e.stopPropagation()
      if (e.code === "Escape") {
        setCapturing(false)
        setWarn(null)
        return
      }
      const r = captureHotkey(e)
      if (r.kind === "pending") return // só modificador — segue esperando
      if (r.kind === "needs-modifier") {
        setWarn("Use ao menos um modificador: ⌥, ⌃, ⇧ ou ⌘.")
        return
      }
      if (r.kind === "reserved") {
        setWarn("⌘K é a paleta de comandos do app, escolha outro combo.")
        return
      }
      setSettings({ dictationHotkey: r.combo })
      setCapturing(false)
      setWarn(null)
    }
    window.addEventListener("keydown", onKey, true)
    return () => window.removeEventListener("keydown", onKey, true)
  }, [capturing, setSettings])

  // fora do modo captura o aviso não fica pendurado
  useEffect(() => {
    if (!capturing) setWarn(null)
  }, [capturing])

  return (
    <div className="py-3">
      <div className="text-[13px] text-foreground">Atalho do ditado</div>
      <div className="mb-2 text-[12px] leading-snug text-muted-foreground">
        Toque alterna o ditado; segurar é push-to-talk (solta, insere).
      </div>
      <div className="flex items-center gap-2">
        <span
          className={cn(
            "inline-flex h-8 min-w-[130px] items-center justify-center rounded-md border bg-secondary/40 px-2.5 font-mono text-[13px]",
            capturing
              ? "border-ring text-foreground motion-safe:animate-pulse"
              : combo
                ? "text-foreground"
                : "text-muted-foreground",
          )}
          aria-live="polite"
        >
          {capturing
            ? "pressione o combo…"
            : combo
              ? formatHotkey(combo)
              : "desativado"}
        </span>
        <Button
          size="sm"
          variant="secondary"
          disabled={!enabled}
          onClick={() => setCapturing((c) => !c)}
        >
          {capturing ? "Cancelar (Esc)" : "Gravar atalho"}
        </Button>
      </div>
      <div className="mt-1.5 flex items-center gap-2">
        <Button
          size="sm"
          variant="ghost"
          className="text-muted-foreground"
          disabled={!enabled || combo === DEFAULT_DICTATION_HOTKEY}
          onClick={() => {
            setCapturing(false)
            setSettings({ dictationHotkey: DEFAULT_DICTATION_HOTKEY })
          }}
        >
          Restaurar padrão
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="text-muted-foreground"
          disabled={!enabled || combo === null}
          onClick={() => {
            setCapturing(false)
            setSettings({ dictationHotkey: null })
          }}
        >
          Desativar
        </Button>
      </div>
      {warn && <div className="mt-1.5 text-[12px] text-st-warning">{warn}</div>}
    </div>
  )
}

/** Seletor de microfone.
 *
 *  O `AVAudioEngine` do sidecar sempre abria o device de ENTRADA PADRÃO DO
 *  SISTEMA. Quem tem headset — e pior, quem tem um loopback virtual (BlackHole,
 *  Teams Audio) como padrão do SO — ditava pelo microfone errado, às vezes por
 *  um device que não capta voz nenhuma, e não tinha onde consertar no app.
 *
 *  A opção guarda o UID do CoreAudio, nunca o nome: nome muda com o idioma do
 *  sistema e se repete entre dois headsets iguais.
 *
 *  Device salvo que sumiu NÃO é barrado aqui — o sidecar cai no padrão do
 *  sistema e avisa pelo canal `warn` no momento do ditado, que é quando a
 *  verdade existe. Aqui a lista só o mantém visível e marcado, pra você não
 *  achar que está gravando por ele. */
function MicrofoneField() {
  const device = useApp((s) => s.settings.dictationDevice)
  const enabled = useApp((s) => s.settings.dictationEnabled)
  const setSettings = useApp((s) => s.setSettings)
  const [devices, setDevices] = useState<MicDevice[]>([])

  useEffect(() => {
    void sttDevices().then(setDevices)
  }, [])

  // O salvo que não está na lista vira opção própria, marcada. Sumir com ele
  // faria o seletor exibir "Padrão do sistema" enquanto a preferência gravada
  // diz outra coisa: a tela mentindo sobre o próprio estado.
  const sumiu = device !== null && !devices.some((d) => d.uid === device)

  return (
    <Field
      label="Microfone"
      hint="Qual entrada o ditado abre. O padrão do sistema nem sempre é a que você quer."
    >
      <RichSelect
        value={device ?? "default"}
        onValueChange={(v) =>
          setSettings({ dictationDevice: v === "default" ? null : v })
        }
        options={[
          {
            value: "default",
            label: "Padrão do sistema",
            description: "Segue o microfone das Preferências do macOS",
          },
          ...devices.map((d) => ({ value: d.uid, label: d.name })),
          ...(sumiu && device
            ? [
                {
                  value: device,
                  label: "Microfone desconectado",
                  description: "O escolhido não está aqui; o ditado usa o padrão",
                },
              ]
            : []),
        ]}
        disabled={!enabled}
        triggerClassName={SELECT_TRIGGER}
        aria-label="Microfone do ditado"
      />
    </Field>
  )
}

export function DictationSettings() {
  const enabled = useApp((s) => s.settings.dictationEnabled)
  const vocabulario = useApp((s) => s.settings.dictationVocab)
  const setSettings = useApp((s) => s.setSettings)
  const [vocabDraft, setVocabDraft] = useState("")
  const def = sectionDef("dictation")

  function addVocab() {
    const t = vocabDraft.trim()
    if (!t || vocabulario.includes(t)) {
      setVocabDraft("")
      return
    }
    setSettings({ dictationVocab: [...vocabulario, t] })
    setVocabDraft("")
  }

  return (
      <div>
        <SectionHeader title={def.title} description={def.question} />
        <div className="divide-y divide-border/50">
          <Field
            label="Ativar ditado"
            hint="Mostra o botão de microfone no composer."
          >
            <Switch
              checked={enabled}
              onCheckedChange={(v) => setSettings({ dictationEnabled: v })}
              aria-label="Ativar ditado"
            />
          </Field>
          <MicrofoneField />
          <HotkeyField />
          <div className="py-3">
            <div className="text-[13px] text-foreground">
              Vocabulário personalizado
            </div>
            <div className="mb-2 text-[12px] leading-snug text-muted-foreground">
              Termos que o reconhecedor costuma errar (nomes de serviços,
              siglas). Somados aos termos fixos.
            </div>
            <div className="flex gap-2">
              <Input
                value={vocabDraft}
                onChange={(e) => setVocabDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault()
                    addVocab()
                  }
                }}
                placeholder="ex.: cadastro-pessoa-gateway"
                className="h-8 text-[13px]"
                disabled={!enabled}
              />
              <Button
                size="sm"
                variant="secondary"
                onClick={addVocab}
                disabled={!enabled || !vocabDraft.trim()}
              >
                Adicionar
              </Button>
            </div>
            {vocabulario.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {vocabulario.map((t) => (
                  <span
                    key={t}
                    className="flex items-center gap-1.5 rounded-md border bg-secondary/50 px-2 py-1 text-[12px] text-foreground/80"
                  >
                    {t}
                    <button
                      onClick={() =>
                        setSettings({
                          dictationVocab: vocabulario.filter(
                            (x) => x !== t,
                          ),
                        })
                      }
                      className="text-muted-foreground hover:text-st-error"
                      aria-label={`Remover ${t}`}
                    >
                      <X className="size-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
  )
}
