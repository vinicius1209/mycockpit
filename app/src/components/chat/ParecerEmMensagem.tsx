// O especialista como gente do time (ADR-267, mock
// `docs/mocks/especialista-na-conversa.html`, B1 e C): ele ENTRA na conversa,
// você o vê lendo de verdade (o que o motor abriu), o texto chega conforme ele
// escreve, e a resposta é uma mensagem num balão, com as ações no rodapé no
// mesmo idioma das mensagens do executor.
//
// O cartão bege de antes (`AdviceCard`) segue para os pareceres antigos: o
// histórico não muda de cara ("só os novos").

import { useState } from "react"
import { Check, Copy, CornerDownRight, Reply, ShipWheel, X } from "lucide-react"
import { AgentAvatar } from "@/components/chat/AgentAvatar"
import { LevadoNoPedido } from "@/components/chat/RastroDoParecer"
import { Markdown } from "@/components/common/Markdown"
import { Button } from "@/components/ui/button"
import { avisar } from "@/lib/avisos"
import { categoryColor } from "@/lib/avatar"
import { quemVemDepois } from "@/lib/filaDeConselheiros"
import { focusConsoleComposer } from "@/lib/focusComposer"
import { LENDO_A_CONVERSA, type Consultado } from "@/lib/parecerAoVivo"
import { parecerJaTrazido } from "@/lib/parecerTrazido"
import { cn } from "@/lib/utils"
import { useChat, type ChatItem } from "@/store/chat"
import { useComposerDrafts } from "@/store/composerDrafts"
import { useFilaDeConselheiros } from "@/store/filaConselheiros"
import { usePresets } from "@/store/presets"

type Parecer = Extract<ChatItem, { kind: "advice" }>

/** Acima disto o balão mostra o começo e "Mostrar tudo" (o "Show more" do
 *  Slack): um parecer de três telas empurra o resto do fio para longe. */
const LONGO = 900

const BALAO = "max-w-full rounded-2xl rounded-tl-md border bg-card px-4 py-2.5 text-[14px]"

/** Mesma revelação do rodapé do executor (`TurnActions`): no hover ou foco do
 *  turno, e sempre em tela sem hover. */
const NO_HOVER =
  "pointer-events-none opacity-0 transition-opacity duration-150 group-hover/turno:pointer-events-auto group-hover/turno:opacity-100 group-focus-within/turno:pointer-events-auto group-focus-within/turno:opacity-100 [@media(hover:none)]:pointer-events-auto [@media(hover:none)]:opacity-100"

/** A cor da persona (a do avatar), por categoria. Persona apagada cai no
 *  latão, como o avatar. */
export function usePersona(personaId: string, nome?: string) {
  const persona = usePresets((s) => s.list.find((p) => p.id === personaId || (nome && p.name === nome)))
  return { persona, cor: categoryColor(persona?.category) }
}

/** "Íris entrou na conversa · especialista em Design": a primeira vez que ela
 *  fala nesta conversa, como o "entrou no canal" do Slack. */
export function EntrouNaConversa({ personaId, nome }: { personaId: string; nome: string }) {
  const { persona } = usePersona(personaId, nome)
  const papel = persona?.category && persona.category !== "Geral" ? `especialista em ${persona.category}` : "especialista"
  return (
    <div className="flex items-center gap-2 pl-10 text-[12px] text-muted-foreground">
      <AgentAvatar def={persona} seed={persona ? undefined : personaId || nome} size={16} rounded />
      <span>
        <span className="font-medium text-foreground">{persona?.name ?? nome}</span> entrou na conversa · {papel}
      </span>
    </div>
  )
}

/** O parecer como mensagem: o balão e o rodapé. O nome, o selo e a hora moram
 *  no cabeçalho do grupo (`GroupRow`). */
export function ParecerEmMensagem({ item }: { item: Parecer }) {
  const [inteiro, setInteiro] = useState(false)
  const longo = item.text.length > LONGO
  return (
    <div className="flex min-w-0 flex-col items-start gap-1.5">
      <div data-selectable className={BALAO}>
        <div
          className={cn(
            longo && !inteiro && "max-h-72 overflow-hidden [mask-image:linear-gradient(to_bottom,black_70%,transparent)]",
          )}
        >
          <Markdown text={item.text} />
        </div>
        {longo && (
          <button
            type="button"
            onClick={() => setInteiro(!inteiro)}
            className="mt-1 text-[13px] text-brass hover:underline"
          >
            {inteiro ? "Mostrar menos" : "Mostrar tudo"}
          </button>
        )}
      </div>
      <RodapeDoParecer item={item} />
      <LevadoNoPedido adviceId={item.id} />
    </div>
  )
}

/** A ação principal sempre à mão (trazer ao executor, que é estado: o mesmo
 *  clique tira); o resto são os ícones do rodapé do fio, no hover. */
function RodapeDoParecer({ item }: { item: Parecer }) {
  const [copiado, setCopiado] = useState(false)
  const { persona } = usePersona(item.personaId)
  const trazido = useComposerDrafts((s) => {
    const convId = useChat.getState().activeId
    return convId ? parecerJaTrazido(s.byConv[convId]?.blocos, item.id) : false
  })
  // Passar o volante: só com a persona existindo, sem ser já a piloto e sem
  // turno em voo (senão `passWheel` não faz nada e o gesto mentiria).
  const podeVolante = useChat((s) => {
    const c = s.activeId ? s.byId[s.activeId] : undefined
    return !!persona && !!c && c.presetId !== item.personaId && !c.running && !c.finalizing
  })
  const naConversa = (fn: (convId: string) => void) => () => {
    const convId = useChat.getState().activeId
    if (convId) fn(convId)
  }
  const trazer = naConversa((convId) =>
    useComposerDrafts.getState().alternarParecer(convId, {
      tipo: "parecer",
      id: crypto.randomUUID(),
      itemId: item.id,
      personaId: item.personaId,
      personaNome: item.personaName,
      texto: item.text,
    }),
  )
  const responder = naConversa((convId) => {
    useComposerDrafts.getState().appendText(convId, `@${item.personaName} `)
    focusConsoleComposer()
  })
  const volante = naConversa((convId) => {
    void useChat
      .getState()
      .passWheel(convId, item.personaId, persona!.name)
      .then((ok) => {
        if (ok) avisar.feito(`${item.personaName} vai pilotar o próximo turno (a doutrina viaja no envio).`)
      })
  })
  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(item.text)
      setCopiado(true)
      setTimeout(() => setCopiado(false), 1500)
    } catch {
      avisar.erro("Não foi possível copiar o parecer.")
    }
  }
  const dispensar = naConversa((convId) => useChat.getState().removeThreadItem(convId, item.id))
  const icone = "text-muted-foreground hover:text-foreground"
  return (
    <div className="flex items-center gap-1">
      <Button
        type="button"
        size="chip"
        variant={trazido ? "secondary" : "outline"}
        onClick={trazer}
        title={trazido ? "Clique para tirar do próximo turno" : "O parecer vai como contexto do próximo envio"}
        className={trazido ? undefined : "text-brass hover:text-brass"}
      >
        {trazido ? <Check /> : <CornerDownRight />}
        {trazido ? "No próximo turno" : "Trazer pro executor"}
      </Button>
      <div data-testid="acoes-do-parecer" className={cn("flex items-center gap-0.5", NO_HOVER)}>
        <Button type="button" variant="ghost" size="icone-chip" onClick={responder} title={`Responder a ${item.personaName}`} className={icone}>
          <Reply className="size-3.5" />
          <span className="sr-only">Responder a {item.personaName}</span>
        </Button>
        {podeVolante && (
          <Button type="button" variant="ghost" size="icone-chip" onClick={volante} title="Passar o volante: o próximo turno é desta persona" className={icone}>
            <ShipWheel className="size-3.5" />
            <span className="sr-only">Passar o volante</span>
          </Button>
        )}
        <Button type="button" variant="ghost" size="icone-chip" onClick={() => void copiar()} title="Copiar o parecer" className={icone}>
          {copiado ? <Check className="size-3.5 text-foreground" /> : <Copy className="size-3.5" />}
          <span className="sr-only">Copiar o parecer</span>
        </Button>
        <Button type="button" variant="ghost" size="icone-chip" onClick={dispensar} title="Dispensar: tira o parecer do fio" className={icone}>
          <X className="size-3.5" />
          <span className="sr-only">Dispensar</span>
        </Button>
      </div>
    </div>
  )
}

/** A chegada ao vivo: o cabeçalho dele, o balão de "digitando" até o primeiro
 *  pedaço de texto e, depois, o texto crescendo no balão. Embaixo, o que ele
 *  está fazendo, tirado dos eventos do motor (nunca de um roteiro). */
export function ChegadaDoEspecialista({ advising, estreia }: { advising: Consultado; estreia: boolean }) {
  const { persona, cor } = usePersona(advising.id, advising.name)
  // Com mais de um chamado, a chegada também diz quem vem depois.
  const proxima = useFilaDeConselheiros((s) => quemVemDepois(s.porConversa[useChat.getState().activeId ?? ""]))
  const texto = advising.aoVivo?.texto.trim()
  return (
    <div className="flex flex-col gap-3">
      {estreia && <EntrouNaConversa personaId={advising.id} nome={advising.name} />}
      <div className="flex gap-3 animate-cockpit-rise">
        <div className="w-7 shrink-0 pt-0.5">
          <AgentAvatar def={persona} seed={persona ? undefined : advising.id || advising.name} size={28} rounded />
        </div>
        <div className="flex min-w-0 flex-1 flex-col items-start gap-1.5">
          <CabecalhoDoEspecialista nome={persona?.name ?? advising.name} cor={cor} />
          {texto ? (
            <div data-selectable className={BALAO}>
              <Markdown text={texto} />
            </div>
          ) : (
            <div className="flex items-center gap-1 rounded-2xl rounded-tl-md border bg-card px-3.5 py-3" aria-hidden>
              {[0, 1, 2].map((i) => (
                <span
                  key={i}
                  className="animate-cockpit-pulse size-1.5 rounded-full"
                  style={{ animationDelay: `${i * 0.18}s`, backgroundColor: cor }}
                />
              ))}
            </div>
          )}
          <span className="text-[12px] text-muted-foreground" aria-live="polite">
            {advising.aoVivo?.estado ?? LENDO_A_CONVERSA}…{proxima && <span className="text-muted-foreground/70"> · {proxima}</span>}
          </span>
        </div>
      </div>
    </div>
  )
}

/** Nome na cor dela, o selo "especialista" (como o "BOT" do Discord) e a hora,
 *  com a versão e o digest da persona no hover (a auditoria segue ali). */
export function CabecalhoDoEspecialista({
  nome,
  cor,
  hora,
  auditoria,
}: {
  nome: string
  cor: string
  hora?: string | null
  auditoria?: string
}) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="text-[13px] font-medium" style={{ color: cor }}>
        {nome}
      </span>
      <span className="rounded bg-secondary px-1 text-[11px] text-muted-foreground">especialista</span>
      {hora && (
        <span className="text-[11px] tabular-nums text-muted-foreground/60" title={auditoria}>
          {hora}
        </span>
      )}
    </div>
  )
}
