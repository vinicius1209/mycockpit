// Passo 3 — notificações. O botão de teste É a sonda: mandar a notificação é o
// que faz o macOS mostrar o diálogo de autorização, e o retorno do nativeNotify
// diz por onde ela saiu. O estado vem do RESULTADO, nunca de um "vá nas
// Preferências do Sistema e confira" (que empurra pro usuário um trabalho que
// o app pode fazer).
//
// Sem controle de som: o app não toca som nenhum hoje. Capability ausente some
// com o toggle (§5.1 do STYLEGUIDE), em vez de um seletor que não faz nada.

import { useState } from "react"
import { Bell, Check, Loader2, TriangleAlert } from "lucide-react"
import { Button } from "@/components/ui/button"
import { nativeNotify } from "@/lib/notify"
import { cn } from "@/lib/utils"
import { notifyMessage, notifyStateFromPath, type NotifyState } from "./flow"

export function NotificationStep() {
  const [state, setState] = useState<NotifyState>("unknown")

  async function sendTest() {
    setState("testing")
    const path = await nativeNotify(
      "Frota",
      "Notificação de teste. É assim que o Frota avisa quando um turno termina com a janela no fundo.",
    )
    setState(notifyStateFromPath(path))
  }

  const message = notifyMessage(state)
  const ok = state === "native" || state === "fallback"

  return (
    <div className="flex flex-col gap-3">
      <div>
        <h2 className="text-[14px] font-semibold text-foreground">
          Deixe o Frota te chamar
        </h2>
        <p className="mt-0.5 text-[12px] leading-snug text-muted-foreground">
          Turno que termina, permissão que trava e missão que para acontecem com
          a janela no fundo. Sem aviso do sistema, você só descobre voltando aqui
          para olhar.
        </p>
      </div>

      {/* Achatado em E0: cartão com raio dentro do cartão do wizard seria
          card-em-card (§8). A separação é hairline. */}
      <div className="border-t border-border/60 pt-3">
        <div className="flex items-center gap-3">
          <Bell className="size-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0 flex-1 text-[12px] leading-snug text-muted-foreground">
            O teste dispara o pedido de autorização do macOS. Autorize na
            janelinha que aparecer.
          </div>
          <Button
            size="padrao"
            variant={ok ? "outline" : "default"}
            disabled={state === "testing"}
            onClick={() => void sendTest()}
            className="shrink-0"
          >
            {state === "testing" && <Loader2 className="size-3.5 animate-spin" />}
            {ok ? "Enviar de novo" : "Enviar notificação de teste"}
          </Button>
        </div>

        {message && (
          <div className="mt-2.5 flex items-start gap-2 border-t border-border/60 pt-2.5">
            {ok ? (
              // verde exige probe, e aqui houve um: a notificação saiu de fato.
              <Check className="mt-px size-3.5 shrink-0 text-st-success" />
            ) : (
              <TriangleAlert className="mt-px size-3.5 shrink-0 text-st-warning" />
            )}
            <p
              className={cn(
                "text-[12px] leading-snug",
                ok ? "text-foreground" : "text-st-warning",
              )}
            >
              {message}
            </p>
          </div>
        )}
      </div>

      <p className="text-[11px] leading-snug text-muted-foreground">
        Não recebeu nada? Siga assim mesmo. O sino dentro do app e o ícone da
        barra de menus continuam registrando tudo.
      </p>
    </div>
  )
}
