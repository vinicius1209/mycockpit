import { agentDef, availability, machineAgents } from "@/lib/agents"
import { updateAvailable, type AgentProbe } from "@/lib/detect"
import type { ModelNewsItem, ModelNewsTone } from "@/lib/modelPromotion"

/** SAÚDE DE FERRAMENTA — regras puras do que o sino mostra sobre as CLIs da
 *  máquina (sem login, atualização disponível).
 *
 *  Por que existe: até aqui esses dois estados só apareciam na Frota do Painel,
 *  e o Painel deixou de ser a aba inicial (ADR-040). Na prática, CLI que perdeu
 *  o login virava coisa que você só descobre quando um turno falha.
 *  Visibilidade permanente mora na moldura (sino, faixa, tray), nunca numa aba.
 *
 *  O que este módulo NÃO é: a faixa "precisa de você" decide TRABALHO (qual
 *  proposta adotar, qual disputa vence, qual gate aprovar) e o item some quando
 *  você decide. Isto é SAÚDE DE FERRAMENTA: não há trabalho pra escolher, há
 *  uma ferramenta que não está pronta, e o item some quando o estado da MÁQUINA
 *  muda. Por isso mora numa seção própria do sino e nunca entra na fila.
 *
 *  FONTE ÚNICA: nada aqui reimplementa detecção. "Sem login" sai de
 *  `availability()` (o mesmo veredito que barra o despacho em
 *  `dispatchBlockReason`) e "tem update" sai de `updateAvailable()` (o mesmo que
 *  acende o botão Atualizar em Configurações ▸ Agentes na máquina), lendo o
 *  mesmo `settings.detected` que a Frota lê. Se um dia a Frota e o sino
 *  discordarem, é bug de um consumidor, não de duas verdades. */

export type ToolHealthKind = "auth" | "update" | "models"

interface ToolHealthBase {
  /** id da CLI no registry. */
  agent: string
  /** Rótulo longo do registry ("Claude Code"). */
  label: string
  /** Conta no badge do sino. Ver `blockingToolCount` pro porquê. */
  blocking: boolean
}

/** CLI que você ligou e que perdeu o login. Impedimento: conta no badge. */
export interface ToolAuthItem extends ToolHealthBase {
  kind: "auth"
  current: null
  latest: null
}

/** CLI com versão nova disponível. Conveniência: não conta no badge. */
export interface ToolUpdateItem extends ToolHealthBase {
  kind: "update"
  /** Versão instalada, como o probe leu. */
  current: string | null
  /** Versão alvo do update. É a CHAVE da dispensa: dispensar a v2.1.220 não
   *  silencia a v2.1.230. */
  latest: string | null
}

/** Notícia sobre MODELOS daquele motor (M3 do model-autonomy-plan): o que
 *  entrou sozinho, o que foi reprovado e com que motivo, o que o fornecedor
 *  anunciou que vai aposentar. O texto inteiro vem pronto da regra pura
 *  (`lib/modelPromotion`); aqui é só o encaixe no sino. */
export interface ToolModelNewsItem extends ToolHealthBase {
  kind: "models"
  /** id do aviso, com a assinatura do conteúdo (chave de lista e de dispensa). */
  id: string
  tone: ModelNewsTone
  title: string
  detail: string
}

export type ToolHealthItem = ToolAuthItem | ToolUpdateItem | ToolModelNewsItem

/** Guardas de tipo pra quem separa a lista por seção (o `filter` sozinho não
 *  estreita a união, e estreitar é o que deixa `latest` legível no update). */
export function isAuthItem(i: ToolHealthItem): i is ToolAuthItem {
  return i.kind === "auth"
}
export function isUpdateItem(i: ToolHealthItem): i is ToolUpdateItem {
  return i.kind === "update"
}
export function isModelNewsItem(i: ToolHealthItem): i is ToolModelNewsItem {
  return i.kind === "models"
}

/** Itens de saúde das CLIs, já na ordem de HIERARQUIA: impedimento antes de
 *  conveniência (todo "sem login" vem antes de todo "tem update"), e dentro de
 *  cada grupo a ordem do registry (estável entre renders).
 *
 *  As 4 camadas de esconder (STYLEGUIDE §5) aplicadas aqui:
 *  1. CLI não instalada não gera item. E esta é uma guarda REAL, não
 *     decorativa: o `detect.rs` reporta `auth: "missing"` também pra ferramenta
 *     AUSENTE (detect.rs:252), então ler `probe.auth` sem checar `installed`
 *     acusaria "sem login" em toda CLI que o usuário nem tem.
 *  3. Probe que não assentou não gera item. Sem entrada em `detected` (boot
 *     antes da 1ª detecção, ou detecção que falhou) não há leitura, e sem
 *     leitura não se inventa aviso (§6: "sem status confiável, não inventa").
 *     `auth: "unknown"` cai no mesmo balde de propósito: o agy não tem
 *     subcomando de auth e degrada pra "unknown" sempre que `agy models` falha
 *     (detect.rs:296); promover isso a "sem login" deixaria o sino aceso pra
 *     sempre acusando um problema que o app não mediu. A Frota segue mostrando
 *     "auth desconhecida", que é o painel onde você foi olhar de propósito.
 *  4. Dispensa persistida, só no que é dispensável: ver `dismissedUpdates`.
 *
 *  A 2ª camada ("não-configurado esconde, configurado-com-erro FICA") é o
 *  motivo de "sem login" NÃO ser dispensável: é uma ferramenta que você ligou e
 *  que quebrou. Dispensar impedimento é esconder falha. */
export function toolHealthItems(
  detected: Record<string, AgentProbe>,
  /** agent → versão de update já dispensada pelo usuário. A comparação é com a
   *  `latest` EXATA: versão nova volta a aparecer (mesmo dedupe por versão do
   *  `lastNotifiedVersions`). */
  dismissedUpdates: Record<string, string> = {},
): (ToolAuthItem | ToolUpdateItem)[] {
  const auth: ToolAuthItem[] = []
  const updates: ToolUpdateItem[] = []

  for (const def of machineAgents()) {
    const probe = detected[def.id]
    // Camadas 1 e 3, juntas e antes de qualquer leitura de auth/versão.
    if (!probe || !probe.installed) continue

    if (availability(def.id, detected) === "installed-not-authenticated")
      auth.push({
        agent: def.id,
        label: def.label,
        kind: "auth",
        current: null,
        latest: null,
        blocking: true,
      })

    if (updateAvailable(probe) && dismissedUpdates[def.id] !== probe.latest)
      updates.push({
        agent: def.id,
        label: def.label,
        kind: "update",
        current: probe.version,
        latest: probe.latest,
        blocking: false,
      })
  }

  return [...auth, ...updates]
}

/** As notícias de MODELO no formato do sino. A regra de o QUE é notícia (e por
 *  quanto tempo) é pura e mora em `lib/modelPromotion.modelNews`; aqui só se
 *  decide o encaixe: seção de Ferramentas, e `blocking: false` SEMPRE.
 *
 *  Por que nenhuma delas conta no badge: modelo novo é conveniência pura (o
 *  seletor ganhou uma opção, nada quebrou); candidato reprovado também (ele
 *  nunca esteve disponível, e continua não estando); e aposentadoria anunciada
 *  não impede nada HOJE, o modelo segue funcionando enquanto o fornecedor não
 *  desliga. Mesma régua do "atualização disponível": sino permanentemente aceso
 *  não informa mais nada, que é o custo que o ADR-040 recusou. Tudo continua NA
 *  LISTA, e o estado durável mora em Configurações ▸ Modelos. */
export function modelHealthItems(
  news: readonly ModelNewsItem[],
): ToolModelNewsItem[] {
  return news.map((n) => ({
    agent: n.agent,
    label: agentDef(n.agent)?.label ?? n.agent,
    kind: "models",
    id: n.id,
    tone: n.tone,
    title: n.title,
    detail: n.detail,
    blocking: false,
  }))
}

/** Quanto a saúde das ferramentas soma no badge do sino.
 *
 *  Só impedimento conta. "Sem login" BLOQUEIA trabalho (é o mesmo veredito que
 *  aborta o despacho antes do run) e some com um gesto seu, então acender o
 *  alarme é honesto. "Atualização disponível" é conveniência: dura dias, não
 *  impede nada, e contá-la deixaria o sino permanentemente aceso, exatamente o
 *  custo que o ADR-040 recusou pra faixa. Sino sempre aceso não informa mais
 *  nada; o item continua NA LISTA, só não grita.
 *
 *  (Rate limit segue fora do badge pelo mesmo teste: nenhum gesto seu resolve,
 *  ele volta sozinho na hora que a própria linha já diz.) */
export function blockingToolCount(items: readonly ToolHealthItem[]): number {
  return items.filter((i) => i.blocking).length
}
