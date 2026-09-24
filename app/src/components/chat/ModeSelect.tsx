// UM controle de MODO no composer (docs/modos-de-sessao-plan.md, M2).
//
// Substitui o par "permissão + toggle Planejar", que fingia serem dois eixos.
// Não são: o `adapters.rs` já resolvia isso na marra, com um braço vazio no
// match e o comentário "Planejar primeiro SUBSTITUI o --permission-mode do modo
// neste turno". E é o mesmo desenho do mercado — no ACP (e no Paseo) `plan` é um
// valor da lista de modos, não uma chave paralela.
//
// As opções vêm da INTERSEÇÃO entre o que a sonda achou no binário e o que o
// registry sabe explicar (`modosOferecidos`). Modo que o motor anuncia e a gente
// não curou NÃO aparece aqui — vira aviso no sino. Neste eixo, oferecer o que
// não se entende é fail-open sem sintoma.
//
// O `enforcement` fica visível porque a diferença é real e sumia: "só lê" no
// Codex é sandbox do sistema operacional; no agy seria um pedido no prompt.
// Mesmo botão, garantias diferentes.

import { Eye, ShieldAlert, ShieldCheck, ClipboardList, Zap } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import type { AgentModeDef } from "@/lib/agentModes"
import {
  notaDeQuemSegura,
  SEM_CONFINAMENTO,
  type Confinamento,
} from "@/lib/confinamento"
import type { SessionMode } from "@/lib/sessionMode"
import { cn } from "@/lib/utils"

const ICONE: Record<SessionMode, typeof Eye> = {
  plan: ClipboardList,
  leitura: Eye,
  fusionRo: Eye,
  padrao: ShieldCheck,
  auto: Zap,
  liberado: ShieldAlert,
}

/** Como o motor SEGURA o modo, em uma palavra. Sandbox é garantia do sistema
 *  operacional; flag é o motor se autogovernando; prompt é só um pedido. */
const ENFORCEMENT_NOTA: Record<AgentModeDef["enforcement"], string> = {
  sandbox: "sandbox do sistema",
  flag: "modo da CLI",
  prompt: "só um pedido no prompt",
}

export function ModeSelect({
  modes,
  value,
  onChange,
  onDefinirPadrao,
  disabled,
  confinamento = SEM_CONFINAMENTO,
}: {
  /** Já filtrados: motor anuncia E o app sabe explicar. */
  modes: AgentModeDef[]
  value: SessionMode
  /** Muda o modo DESTA conversa (M3). */
  onChange: (def: AgentModeDef) => void
  /** Grava o modo atual como default do PROJETO. Ausente = sem projeto.
   *  Existe como gesto separado porque são escopos diferentes, e o controle
   *  antigo mudava o projeto inteiro sem nunca dizer isso. */
  onDefinirPadrao?: () => void
  disabled?: boolean
  /** O que o SANDBOX DO FROTA garante nesta máquina (S4). Quando presente, ele
   *  substitui a nota do motor nos modos que prometem não escrever — porque aí
   *  quem segura passa a ser o sistema, e dizer "modo da CLI" seria descrever o
   *  freio antigo enquanto o novo é que está valendo. */
  confinamento?: Confinamento
}) {
  // Sem modos curados pro motor ativo (hoje: agy) o controle NÃO aparece. Um
  // seletor vazio prometeria escolha que não existe, e o aviso do sino já conta
  // o porquê — em vez de um menu mudo aqui.
  if (modes.length === 0) return null
  const atual = modes.find((m) => m.canonico === value) ?? null
  const Icon = ICONE[value]
  const perigoso = value === "liberado"
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={disabled}>
        <Button
          variant="ghost"
          size="padrao"
          className="h-8 gap-1.5 px-2.5 text-[12px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          title={`Modo de execução: ${atual?.label ?? "padrão"}`}
          aria-label="Modo de execução do agente"
        >
          {/* O aviso de "Liberado" vive no ÍCONE, não no botão inteiro
              (ADR-167). O glifo já muda sozinho (escudo-check → escudo-alerta):
              a cor só CONFIRMA o que a forma disse, então o sinal sobrevive a
              daltonismo e não some se a tinta falhar. Pintar o controle todo
              punha o aviso no mesmo degrau hierárquico do Enviar e dava dois
              primários ao rodapé; e âmbar aceso o tempo todo vira papel de
              parede, ainda por cima no MESMO token de "precisa de você"
              (`st-warning` é `st-queued`). */}
          <Icon
            className={cn("size-3.5 shrink-0", perigoso && "text-st-warning")}
          />
          {/* Abaixo de 520px de rodapé, só o escudo: o glifo já diz o modo
              (ADR-167) e o nome segue no title e no menu (ADR-240). */}
          <span className="hidden @min-[520px]/composer:inline">{atual?.label ?? "Modo"}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-72 p-1.5">
        <div className="px-2 py-1 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
          Modo de execução
        </div>
        <DropdownMenuSeparator className="my-1" />
        <DropdownMenuRadioGroup
          value={atual?.id ?? ""}
          onValueChange={(id) => {
            const def = modes.find((m) => m.id === id)
            if (def) onChange(def)
          }}
        >
          {modes.map((m) => {
            const active = m.id === atual?.id
            const MIcon = ICONE[m.canonico]
            const alerta = m.canonico === "liberado"
            return (
              <DropdownMenuRadioItem
                key={m.id}
                value={m.id}
                className={cn(
                  "flex flex-col items-start gap-0.5 rounded-md p-2 pl-2 text-left [&>span:first-child]:hidden",
                  active
                    ? alerta
                      ? "bg-st-warning/15 text-st-warning focus:bg-st-warning/20 focus:text-st-warning"
                      : "bg-accent text-foreground focus:bg-accent focus:text-foreground"
                    : "hover:bg-accent/50",
                )}
              >
                <div className="flex items-center gap-1.5 text-[13px] font-medium">
                  <MIcon className="size-3.5" />
                  {m.label}
                </div>
                <div
                  className={cn(
                    "text-[11px]",
                    active && alerta ? "text-st-warning/80" : "text-muted-foreground",
                  )}
                >
                  {m.description}
                </div>
                {/* Quem segura. Fica na linha de baixo, em sussurro: é o dado
                    que separa uma garantia de um pedido educado.
                    Com confinamento do Frota, o selo VENCE a nota do motor nos
                    modos que prometem não escrever — e diz "parcial" de
                    propósito: a política é denylist, protege o projeto e não o
                    disco. Prometer "completa" aqui seria repetir, com a nossa
                    assinatura, o rótulo sem dente que o sandbox veio consertar. */}
                <div className="text-[11px] text-muted-foreground/60">
                  {notaDeQuemSegura(
                    m.canonico,
                    confinamento,
                    ENFORCEMENT_NOTA[m.enforcement],
                  )}
                </div>
              </DropdownMenuRadioItem>
            )
          })}
        </DropdownMenuRadioGroup>
        {onDefinirPadrao && (
          <>
            <DropdownMenuSeparator className="my-1" />
            <DropdownMenuItem
              onSelect={onDefinirPadrao}
              className="rounded-md p-2 text-[12px] text-muted-foreground"
            >
              Usar como padrão deste projeto
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
