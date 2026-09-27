// Qual modelo helper vale NESTE projeto, e a pergunta derivada dela: existe
// inteligência utilitária aqui?
//
// A regra `cfg ? cfg.helper : settings.helperModel` estava copiada em cinco
// consumidores (`lib/notify.ts`, `store/chat/suggestions.ts`, `store/mission.ts`,
// `components/chat/feedbackDoFio.ts`, `components/common/CommandMenu.tsx`) e
// nenhuma cópia era exportada. A consequência não foi divergência entre elas —
// eram idênticas — e sim que **a UI não tinha onde perguntar**: a linha de chips
// do composer oferecia "Explicar o projeto" com o helper desligado nas
// Configurações, porque o `else` que os desenha não tinha como saber.
//
// A cadeia inteira tem duas metades, e só a segunda mora aqui:
//
// 1. `hooks/useProjectConfig.ts` PRODUZ `projectConfigs[projectId].helper` lendo
//    `.frota/config.toml` do projeto ativo: `"off"` vira `null`, e ausência
//    cai no default global. Ele já dobrou o global lá dentro.
// 2. Este módulo RESOLVE para quem consome: com a config do projeto carregada,
//    ela manda (já é a resolução final); sem ela — projeto não-ativo, config
//    ilegível, app recém-aberto — vale o default global.
//
// Por isso a ordem NÃO é `cfg?.helper ?? global`: `null` em `cfg.helper` é
// resposta ("este projeto desligou"), não ausência. Trocar o ternário por `??`
// ressuscitaria o helper num projeto que o desligou de propósito.

import { useApp } from "@/store/app"
import type { ProjectConfig } from "@/store/appTypes"

/** As duas fontes, sem store no meio — é o que torna a regra testável. */
export interface FontesDoHelper {
  /** Espelho de `.frota/config.toml` do projeto, ou `undefined` quando a
   *  config nunca foi lida (projeto não-ativo é o caso comum). */
  cfg: Pick<ProjectConfig, "helper"> | undefined
  /** Default global (Configurações › Modelo auxiliar; `null` = desligado). */
  global: string | null
}

/** Modelo helper efetivo, ou `null` quando não há nenhum. Puro. */
export function resolverHelper({ cfg, global }: FontesDoHelper): string | null {
  return cfg ? cfg.helper : global
}

/** Modelo helper efetivo do projeto, lido do store. `null` = desligado, e todo
 *  consumidor trata isso como degradação honesta (nunca espera, nunca finge). */
export function helperDoProjeto(projectId: string | undefined | null): string | null {
  if (!projectId) return null
  const app = useApp.getState()
  return resolverHelper({
    cfg: app.projectConfigs[projectId],
    global: app.settings.helperModel,
  })
}

/** Há inteligência utilitária neste projeto? A pergunta que a TELA faz: quem
 *  desenha não quer o nome do modelo, quer saber se o gesto existe. */
export function temInteligencia(projectId: string | undefined | null): boolean {
  return helperDoProjeto(projectId) !== null
}
