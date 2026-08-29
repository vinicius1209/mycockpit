// Configurações. O rail e o conteúdo leem o MESMO registro (sections.ts):
// cada seção responde uma pergunta do usuário, e nenhum bloco mora numa seção
// que não responde a pergunta dele. Foi a correção do build 191, onde "CLIs
// instaladas" acumulou medidor de uso, hooks de terminal e curador de modelos.
//
// Seção pedida de fora (tray, UsagePill, paleta) passa por resolveSection:
// id órfão cai numa seção válida, nunca em painel vazio.

import { useEffect, useMemo, useState } from "react"
import { getVersion } from "@tauri-apps/api/app"
import { Minus, Plus, RotateCcw } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { RichSelect } from "@/components/ui/RichSelect"
import { Switch } from "@/components/ui/switch"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { useApp } from "@/store/app"
import { usageWindowAgents } from "@/lib/agentRoster"
import { lerGhStatus } from "@/lib/github"
import {
  aplicarKeepAwake,
  KEEP_AWAKE_OPTIONS,
  type KeepAwake,
} from "@/lib/keepAwake"
import { MissionSettings } from "@/components/settings/MissionSettings"
import { CompanionSettings } from "@/components/settings/CompanionSettings"
import { McpSettings } from "@/components/settings/McpSettings"
import { CostMaintenance } from "@/components/settings/CostMaintenance"
import { SessionCostLimit } from "@/components/settings/SessionCostLimit"
import { UsageMeterSettings } from "@/components/settings/UsageMeterSettings"
import { HooksSettings } from "@/components/settings/HooksSettings"
import { MachineAgents } from "@/components/settings/MachineAgents"
import { NewChatDefaults } from "@/components/settings/NewChatDefaults"
import { ServicosSettings } from "@/components/settings/ServicosSettings"
import { ConfinamentoCard } from "@/components/settings/ConfinamentoCard"
import { DictationSettings } from "@/components/settings/DictationSettings"
import { ModelsSettings } from "@/components/settings/ModelsSettings"
import { EspecialistasContent } from "@/components/settings/Especialistas"
import { restartOnboarding } from "@/components/onboarding/persistence"
import {
  Block,
  BlockTitle,
  Field,
  Note,
  SectionHeader,
  SELECT_TRIGGER,
} from "@/components/settings/parts"
import {
  resolveSection,
  sectionDef,
  precisaDeAtencao,
  sectionsByGroup,
  secoesDisponiveis,
  type SectionId,
} from "@/components/settings/sections"
import { cn } from "@/lib/utils"
import {
  CONVERSATION_SCALES,
  DEFAULT_CONVERSATION_SCALE,
  conversationScalePercent,
  normalizeConversationScale,
  stepConversationScale,
} from "@/lib/conversationScale"

const HELPER_OPTIONS = [
  { value: "off", label: "Desligado", description: "Sem sugestões automáticas" },
  { value: "haiku", label: "Haiku", description: "Rápido e barato (recomendado)" },
  { value: "sonnet", label: "Sonnet", description: "Mais capaz" },
  { value: "opus", label: "Opus", description: "Máxima qualidade" },
]


/** Cabeçalho padrão de uma seção do registro (título + a pergunta dela). */
function Header({ id }: { id: SectionId }) {
  const def = sectionDef(id)
  return <SectionHeader title={def.title} description={def.question} />
}

export function SettingsDialog() {
  const open = useApp((s) => s.settingsOpen)
  const setOpen = useApp((s) => s.setSettingsOpen)
  const requested = useApp((s) => s.settingsSection)
  const clearRequested = useApp((s) => s.clearSettingsSection)
  const theme = useApp((s) => s.theme)
  const toggleTheme = useApp((s) => s.toggleTheme)
  const settings = useApp((s) => s.settings)
  const setSettings = useApp((s) => s.setSettings)
  const conversationScale = normalizeConversationScale(
    settings.conversationScale,
  )
  // 1ª camada de esconder: build sem nenhum motor com hooks não mostra a seção
  // (nem o toggle). A decisão vem do registry de capabilities, nunca de nome.
  // A MESMA lista que a paleta ⌘K usa (secoesDisponiveis): seção escondida no
  // rail e alcançável pela paleta seria um destino fantasma.
  const available = useMemo(() => secoesDisponiveis(), [])
  // Fatos do rail. `gh` é lido ao ABRIR (dois comandos locais, ~ms) e começa
  // como undefined, que significa "ainda não olhei" — e não olhar nunca pinta
  // alarme. `detected` já mora no store, de graça.
  const [ghDoRail, setGhDoRail] = useState<
    { installed: boolean; contas: number } | undefined
  >(undefined)
  useEffect(() => {
    if (!open) return
    void lerGhStatus().then((g) =>
      setGhDoRail({ installed: g.installed, contas: g.accounts.length }),
    )
  }, [open])
  const fatosDoRail = useMemo(
    () => ({ detected: settings.detected, gh: ghDoRail }),
    [settings.detected, ghDoRail],
  )
  const hasUsageMeter = useMemo(() => usageWindowAgents().length > 0, [])
  const [section, setSection] = useState<SectionId>(() =>
    resolveSection(null, available),
  )
  const [version, setVersion] = useState("")

  useEffect(() => {
    getVersion().then(setVersion).catch(() => {})
  }, [])

  // Deep link (tray, medidor da barra, paleta): consome o pedido UMA vez, já
  // resolvido — id que não existe mais cai numa seção válida.
  useEffect(() => {
    if (!open || !requested) return
    setSection(resolveSection(requested, available))
    clearRequested()
  }, [open, requested, available, clearRequested])


  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent
        // X: o DialogCloseX PADRÃO do dialog base (canto do dialog, z alto,
        // chip) — nada de X custom dentro do scroll (era o bug recorrente).
        // mais largo E mais alto: a área de conteúdo estava com ~456px (o form
        // de preset de 3 colunas truncava tudo). Agora ~700px de conteúdo, com
        // teto por viewport pra não estourar telas baixas.
        className="flex h-[min(88vh,640px)] w-[92vw] max-w-[900px] gap-0 overflow-hidden rounded-xl border-border/60 p-0 shadow-[var(--shadow-pop)] sm:max-w-[900px]"
        onOpenAutoFocus={(e) => {
          // Foco padrão do Radix vai pro 1º botão do rail (Aparência) — errado
          // num deep link (guia de setup, tray, medidor, paleta): o dialog abre
          // já mostrando a seção pedida, mas o anel de foco ficava preso no 1º
          // item, incoerente com o conteúdo exibido. Resolve igual ao efeito de
          // deep link, sem depender do timing dele.
          e.preventDefault()
          const resolved = resolveSection(requested, available)
          const root = e.currentTarget as HTMLElement | null
          const el = root?.querySelector<HTMLElement>(`[data-section="${resolved}"]`)
          el?.focus()
        }}
      >
        <DialogHeader className="sr-only">
          <DialogTitle>Configurações</DialogTitle>
          <DialogDescription>Preferências do app.</DialogDescription>
        </DialogHeader>

        {/* Rail — os grupos vêm do registro; com 15 seções ele precisa do
            próprio scroll (viewport baixo não pode comer a última seção). */}
        <nav className="flex w-44 shrink-0 flex-col gap-0.5 overflow-y-auto border-r border-border/60 bg-rail p-2">
          {sectionsByGroup(available).map(({ group, sections }) => (
            <div key={group.id} className="contents">
              <div className="label-mono px-2 pt-3 pb-1">{group.label}</div>
              {sections.map((s) => (
                <button
                  key={s.id}
                  data-section={s.id}
                  onClick={() => setSection(s.id)}
                  className={cn(
                    // denso na lateral (régua de ~34px do STYLEGUIDE §8)
                    "flex items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-[13px] transition-colors",
                    section === s.id
                      ? "bg-accent text-foreground"
                      : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                  )}
                >
                  <span className="grid size-5 shrink-0 place-items-center">
                    <s.icon className="size-4" />
                  </span>
                  <span className="min-w-0 truncate">{s.label}</span>
                  {/* Selo à DIREITA e em caixa alta: é estado da seção, não
                      parte do nome dela. Dentro do título ("Missões (beta)")
                      ele não podia ser lido nem estilizado como estado. */}
                  {s.badge && (
                    <span className="ml-auto shrink-0 rounded bg-secondary px-1 py-px text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
                      {s.badge}
                    </span>
                  )}
                  {/* Ponto de atenção: coisa meio-configurada que VOCÊ pode
                      consertar (CLI deslogada, gh sem conta). Nunca capacidade
                      ausente por escolha nem limitação da máquina — ponto que
                      não apaga ensina a ignorar o ponto. */}
                  {precisaDeAtencao(s.id, fatosDoRail) && (
                    <span
                      className={cn("size-1.5 shrink-0 rounded-full bg-st-warning", !s.badge && "ml-auto")}
                      title="Precisa de atenção"
                      aria-label="Precisa de atenção"
                    />
                  )}
                </button>
              ))}
            </div>
          ))}
        </nav>

        {/* Conteúdo — o X padrão do dialog base flutua no canto sup-direito;
            o SectionHeader reserva pr-9 pra nada passar por baixo dele. */}
        <div className="relative flex-1 overflow-y-auto p-5">
          {section === "appearance" && (
            <div>
              <Header id="appearance" />
              <div className="divide-y divide-border/50">
                <Field
                  label="Tema claro"
                  hint="Sua escolha agora fica salva entre reinícios."
                >
                  <Switch
                    checked={theme === "light"}
                    onCheckedChange={() => toggleTheme()}
                    aria-label="Tema claro"
                  />
                </Field>
                <Field
                  label="Tamanho das conversas"
                  hint="Só o fio muda. Atalhos: ⌘/Ctrl +, ⌘/Ctrl − e ⌘/Ctrl 0."
                >
                  <div
                    role="group"
                    aria-label="Tamanho das conversas"
                    className="flex items-center gap-1"
                  >
                    <Button
                      type="button"
                      variant="outline"
                      size="icone-padrao"
                      title="Diminuir fonte (⌘/Ctrl −)"
                      aria-label="Diminuir fonte da conversa"
                      disabled={conversationScale === CONVERSATION_SCALES[0]}
                      onClick={() =>
                        setSettings({
                          conversationScale: stepConversationScale(
                            conversationScale,
                            -1,
                          ),
                        })
                      }
                    >
                      <Minus className="size-3.5" />
                    </Button>
                    <output
                      aria-live="polite"
                      className="w-12 text-center font-mono text-[12px] tabular-nums text-foreground"
                    >
                      {conversationScalePercent(conversationScale)}
                    </output>
                    <Button
                      type="button"
                      variant="outline"
                      size="icone-padrao"
                      title="Aumentar fonte (⌘/Ctrl +)"
                      aria-label="Aumentar fonte da conversa"
                      disabled={
                        conversationScale ===
                        CONVERSATION_SCALES[CONVERSATION_SCALES.length - 1]
                      }
                      onClick={() =>
                        setSettings({
                          conversationScale: stepConversationScale(
                            conversationScale,
                            1,
                          ),
                        })
                      }
                    >
                      <Plus className="size-3.5" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icone-padrao"
                      title="Restaurar 100% (⌘/Ctrl 0)"
                      aria-label="Restaurar tamanho da conversa"
                      disabled={conversationScale === DEFAULT_CONVERSATION_SCALE}
                      onClick={() =>
                        setSettings({
                          conversationScale: DEFAULT_CONVERSATION_SCALE,
                        })
                      }
                    >
                      <RotateCcw className="size-3.5" />
                    </Button>
                  </div>
                </Field>
                <div className="pt-3 text-[12px] leading-snug text-muted-foreground">
                  Sidebar, painel de contexto e o modo (Linear/SDD) também
                  são lembrados automaticamente ao reabrir o app.
                </div>
              </div>
            </div>
          )}

          {section === "tray" && (
            <div>
              <Header id="tray" />
              <div className="divide-y divide-border/50">
                <Field
                  label="Continuar ao fechar"
                  hint="Mantém agents e automações rodando quando a janela é fechada. Use Sair para encerrar tudo."
                >
                  <Switch
                    checked={settings.keepInTrayOnClose}
                    onCheckedChange={(v) =>
                      setSettings({ keepInTrayOnClose: v })
                    }
                    aria-label="Continuar na barra de menus ao fechar"
                  />
                </Field>
                <div className="py-3">
                  <div className="text-[13px] text-foreground">
                    Instrumento compacto
                  </div>
                  <p className="mt-1 text-[12px] leading-snug text-muted-foreground">
                    Um clique mostra frota, decisões e automações. O clique
                    secundário abre o menu nativo de segurança.
                  </p>
                </div>
              </div>
              {settings.trayCloseHintShown && (
                <button
                  onClick={() => setSettings({ trayCloseHintShown: false })}
                  className="mt-3 text-[12px] text-muted-foreground transition-colors hover:text-brass"
                >
                  Mostrar novamente o aviso ao fechar
                </button>
              )}
            </div>
          )}

          {section === "new-chats" && <NewChatDefaults />}

          {section === "autopilot" && (
            <div>
              <Header id="autopilot" />
              {/* Sono da máquina: o caso real é a missão de 4 fases às 3h que
                  morre porque o Mac dormiu. Fica AQUI porque a pergunta da
                  seção é "o que o app faz sozinho enquanto ninguém olha", e
                  segurar o sono é exatamente isso. */}
              <div className="divide-y divide-border/50">
                <Field
                  label="Manter o computador acordado"
                  hint="Dormir no meio de um turno perde o trabalho e o turno já foi pago."
                >
                  <RichSelect
                    value={settings.keepAwake}
                    onValueChange={(v) => {
                      setSettings({ keepAwake: v as KeepAwake })
                      void aplicarKeepAwake(v as KeepAwake)
                    }}
                    options={KEEP_AWAKE_OPTIONS}
                    triggerClassName={SELECT_TRIGGER}
                    aria-label="Manter o computador acordado"
                  />
                </Field>
              </div>
              <Note>
                Só impede o sono por OCIOSIDADE; fechar a tampa continua
                dormindo. Fora do macOS a preferência fica sem efeito.
              </Note>
              <BlockTitle hint="Quando o turno para num limite de uso, o app reenvia sozinho depois do reset. Cada tentativa é um run pago.">
                Auto-revive em rate limit
              </BlockTitle>
              <div className="divide-y divide-border/50">
                <Field
                  label="Retomar automaticamente"
                  hint="Vale para o turno que parou num limite de uso ou num “vou tentar depois”."
                >
                  <Switch
                    checked={settings.autoResume}
                    onCheckedChange={(v) => setSettings({ autoResume: v })}
                    aria-label="Auto-revive em rate limit"
                  />
                </Field>
                <Field
                  label="Máximo de tentativas"
                  hint="Teto de reenvios automáticos por turno (protege o custo)."
                >
                  <Input
                    type="number"
                    min={1}
                    max={20}
                    value={settings.autoResumeMaxTries}
                    onChange={(e) => {
                      const n = Math.max(1, Math.min(20, Number(e.target.value) || 1))
                      setSettings({ autoResumeMaxTries: n })
                    }}
                    disabled={!settings.autoResume}
                    className="h-8 w-20 text-[13px]"
                    aria-label="Máximo de tentativas de auto-resume"
                  />
                </Field>
              </div>

              <Block>
                <BlockTitle hint="Só funciona com o app aberto: o vigia é um ticker da janela, não um daemon.">
                  Vigia de silêncio
                </BlockTitle>
                <div className="divide-y divide-border/50">
                  <Field
                    label="Avisar após (minutos)"
                    hint="Cobre turnos rodando sem produzir nada novo E cards do board parados em revisão/bloqueado. Dispara notificação + aviso acionável. 0 desliga."
                  >
                    <Input
                      type="number"
                      min={0}
                      max={120}
                      value={settings.stalledAfterMin}
                      onChange={(e) => {
                        const n = Math.max(0, Math.min(120, Number(e.target.value) || 0))
                        setSettings({ stalledAfterMin: n })
                      }}
                      className="h-8 w-20 text-[13px]"
                      aria-label="Minutos de silêncio até avisar turno mudo"
                    />
                  </Field>
                </div>
              </Block>

              <Block>
                <BlockTitle hint="Vale SÓ para runs disparados por automação (view Agendado). Conversa que você digitou nunca expira.">
                  Automação desassistida
                </BlockTitle>
                <div className="divide-y divide-border/50">
                  <Field
                    label="Responder sozinho após (minutos)"
                    hint="Se o agente pedir permissão ou fizer uma pergunta e ninguém responder nesse tempo, o app nega no seu lugar, o turno termina e o motivo fica no fio e no sino. 0 desliga (o turno espera para sempre e, sem ninguém para responder, congela)."
                  >
                    <Input
                      type="number"
                      min={0}
                      max={120}
                      value={settings.unattendedAnswerAfterMin}
                      onChange={(e) => {
                        const n = Math.max(0, Math.min(120, Number(e.target.value) || 0))
                        setSettings({ unattendedAnswerAfterMin: n })
                      }}
                      className="h-8 w-20 text-[13px]"
                      aria-label="Minutos até responder sozinho numa automação desassistida"
                    />
                  </Field>
                </div>
              </Block>
            </div>
          )}

          {section === "presets" && (
            // Uma superfície só: o marketplace inline (grid + detalhe + criar),
            // sem dialog-sobre-dialog. Altura própria pro scroll interno.
            <div className="flex h-[min(70vh,560px)] flex-col overflow-hidden rounded-xl border border-border/60 bg-card/30">
              <EspecialistasContent />
            </div>
          )}

          {section === "suggestions" && (
            <div>
              <Header id="suggestions" />
              <div className="divide-y divide-border/50">
                <Field
                  label="Modelo helper (padrão)"
                  hint="Usado quando o projeto não define um no .mycockpit/config.toml."
                >
                  <RichSelect
                    value={settings.helperModel ?? "off"}
                    onValueChange={(v) =>
                      setSettings({ helperModel: v === "off" ? null : v })
                    }
                    options={HELPER_OPTIONS}
                    triggerClassName={SELECT_TRIGGER}
                    aria-label="Modelo helper"
                  />
                </Field>
              </div>
            </div>
          )}

          {section === "dictation" && <DictationSettings />}

          {section === "missions" && <MissionSettings />}

          {section === "companion" && <CompanionSettings />}

          {section === "integrations" && <McpSettings />}

          {section === "machine" && <MachineAgents />}

          {section === "sandbox" && <ConfinamentoCard />}

          {section === "services" && <ServicosSettings />}

          {section === "models" && <ModelsSettings />}

          {/* Sessões abertas fora do app: capacidade própria, com o preview do
              que será escrito no config de hooks (disclosure progressiva). */}
          {section === "hooks" && <HooksSettings />}

          {section === "ledger" && (
            <div>
              <Header id="ledger" />
              {/* Duas medições da MESMA pergunta, e a copy diz a diferença:
                  janela do plano (carona, sem US$) × custo estimado em US$.
                  Sem nenhum motor com medidor o bloco some (e o custo sobe,
                  sem buraco de margem no lugar dele). */}
              <UsageMeterSettings />
              <div className={hasUsageMeter ? "mt-6" : undefined}>
                <SessionCostLimit />
              </div>
              <div className="mt-6">
                <BlockTitle hint="O ledger de custo em US$ por turno, e a reconstrução das linhas gravadas antes da correção do acumulado.">
                  Histórico de custo
                </BlockTitle>
                <CostMaintenance />
              </div>
            </div>
          )}

          {section === "about" && (
            <div>
              <Header id="about" />
              <div className="space-y-1 text-[13px]">
                <div className="font-medium text-foreground">Frota</div>
                <div className="font-mono text-[12px] text-muted-foreground">
                  local{version ? ` · v${version}` : ""}
                </div>
                <p className="pt-2 text-[12px] leading-snug text-muted-foreground">
                  Cockpit de agents. Preferências globais ficam salvas localmente;
                  config por projeto vive no painel de contexto.
                </p>
              </div>
              <div className="mt-4 border-t border-border/50 pt-3">
                <button
                  onClick={() => {
                    // limpa o progresso ANTES de reabrir, senão o wizard
                    // retomaria no último passo concluído.
                    restartOnboarding()
                    setOpen(false)
                  }}
                  className="flex items-center gap-1.5 text-[13px] text-muted-foreground transition-colors hover:text-brass"
                >
                  <RotateCcw className="size-3.5" />
                  Refazer onboarding (verificar agents de novo)
                </button>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
