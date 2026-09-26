// Como uma notificação chega ao SO — e o que fazer quando não chega.
//
// Extraído de lib/notify.ts quando ele passou do teto (o recibo de turno, M2,
// foi a gota). O recorte é o certo: aqui mora só o TRANSPORTE (permissão,
// plugin nativo, fallback por osascript, aviso quando nada entrega); os
// EVENTOS do produto — turno terminou, gate abriu, missão travou — continuam
// no notify.ts, que é onde a regra de negócio deles vive.

import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification"
import { invoke } from "@tauri-apps/api/core"
import { avisar } from "@/lib/avisos"
import { isTauri } from "@/lib/db"


/** Truncamento defensivo de título em notificação nativa (follow-up S2): o
 *  Notification Center corta sem avisar; melhor cortar NÓS com reticências
 *  do que deixar o SO engolir o resto do corpo. */
export function clipTitle(title: string, max = 80): string {
  const t = title.trim()
  return t.length > max ? `${t.slice(0, max)}…` : t
}

/** Já avisamos que a notificação do SO não está disponível? (1× por sessão — o
 *  aviso é informação, não alarme recorrente.) */
let nativeBlockedWarned = false

/** Notificação NATIVA do SO. Nunca derruba nada: sem autorização, o feed do sino
 *  e a tray continuam sendo o sinal.
 *
 *  ⚠️ Isto FALHA em builds ad-hoc: o macOS só registra um app no Notification
 *  Center quando ele consegue pedir autorização, e app não assinado com
 *  identidade real costuma ser recusado direto — verificado nesta máquina, o
 *  `dev.vinicius.mycockpit` não aparece em `com.apple.ncprefs` nem no db do
 *  usernoted, ou seja NENHUMA nativa foi entregue até hoje. O `catch` vazio
 *  fazia isso parecer "a feature não existe"; agora avisa uma vez e segue. */
/** Por onde a notificação saiu — o botão de teste das Configurações mostra isto.
 *  "nativo" = plugin do SO (nome/ícone do Frota); "osascript" = fallback (chega
 *  como Script Editor); "falhou" = nenhum dos dois passou. */
export type NotifyPath = "nativo" | "osascript" | "falhou" | "fora-do-app"

export async function nativeNotify(
  title: string,
  body: string,
): Promise<NotifyPath> {
  if (!isTauri()) return "fora-do-app"
  try {
    let granted = await isPermissionGranted()
    if (!granted) granted = (await requestPermission()) === "granted"
    if (granted) {
      sendNotification({ title, body })
      return "nativo"
    }
    return await fallbackNotify(title, body, "sem autorização do sistema")
  } catch (e) {
    return await fallbackNotify(
      title,
      body,
      e instanceof Error ? e.message : String(e),
    )
  }
}

/** Plano B: `osascript`, que usa a autorização do Script Editor (concedida) em
 *  vez da nossa (que o macOS recusa por causa da assinatura ad-hoc — ver
 *  src-tauri/src/osnotify.rs). A notificação sai atribuída ao Script Editor, não
 *  ao Frota: feio, mas CHEGA. O texto vai como argv, nunca interpolado no
 *  AppleScript (seria injeção — título de conversa é entrada não confiável).
 *
 *  Só quando os DOIS caminhos falham é que avisamos que não há aviso — senão o
 *  toast apareceria em todo turno concluído. */
async function fallbackNotify(
  title: string,
  body: string,
  why: string,
): Promise<NotifyPath> {
  try {
    await invoke("notify_via_osascript", { title, body })
    if (!nativeBlockedWarned) {
      nativeBlockedWarned = true
      console.warn(
        `[notify] plugin nativo indisponível (${why}); usando osascript (a notificação aparece como "Script Editor")`,
      )
    }
    return "osascript"
  } catch (e) {
    warnNativeBlocked(`${why}; osascript também falhou: ${String(e)}`)
    return "falhou"
  }
}

/** Deixa rastro da indisponibilidade UMA vez: console (pro log) + toast (pra
 *  você). Sem isto o sintoma é "o app não me avisa" e a causa fica invisível. */
function warnNativeBlocked(reason: string) {
  if (nativeBlockedWarned) return
  nativeBlockedWarned = true
  console.warn(`[notify] nenhuma notificação de SO disponível: ${reason}`)
  avisar.nota("Avisos do sistema indisponíveis; use o sino e o ícone da bandeja.", {
    detalhe:
      "Nem o plugin nativo nem o osascript entregaram. O feed no app continua funcionando.",
    duracao: 8000,
  })
}
