// A PORTA ÚNICA dos avisos do app (ADR-261, mock `docs/mocks/avisos.html`).
//
// # O que havia
//
// Cerca de 300 chamadas de `toast` espalhadas em 90 arquivos, cada uma com o
// seu tempo, o seu texto e a sua ideia de quando avisar. O toast morava no
// centro de baixo, EM CIMA do composer; o pedido do agente para ligar o
// navegador era um toast sem prazo, e fechar era recusar; e a confirmação
// dizia "Navegador do projeto ligado" sem dizer qual (25/09/2026).
//
// # A regra: cinco naturezas, cinco lugares
//
// - **Pedido** (precisa de decisão sua): NUNCA passa por aqui. É cartão da
//   fila de interações, dentro da conversa que pediu (`lib/pedidosDeRecurso`).
// - **Feito** (resultado do seu gesto): o melhor lugar é o próprio gesto. Toast
//   só quando o lugar some (menu de contexto, atalho): curto e dizendo o objeto.
// - **Nota** (o seu gesto não aconteceu, e por quê): "Abra uma conversa para
//   ditar", "Conversa ainda carregando". Neutra, curta, sem identidade.
// - **Evento** (algo aconteceu sem você): toast com a linha de identidade
//   (projeto · conversa), uma ação, e cópia no sino.
// - **Erro**: toast com identidade quando há dono. Com ação, fica até você
//   fechar; sem ação, some sozinho.
//
// Uma guarda (`scripts/check-avisos.mjs`, núcleo em `scripts/lints/avisos.mjs`)
// proíbe importar `sonner` fora daqui e do `components/ui/sonner.tsx`.

import { createElement } from "react"
import { toast } from "sonner"
import { CorpoDoAviso, type IdentidadeDoAviso } from "@/components/ui/aviso"
import { useNotifs } from "@/store/notifications"
import { useApp } from "@/store/app"
import { useChat } from "@/store/chat"

/** Quanto cada natureza fica na tela, em ms. */
export const DURACAO = {
  feito: 2_500,
  nota: 4_000,
  /** Feito que se desfaz: tempo de ler e mudar de ideia. */
  feitoComDesfazer: 6_000,
  evento: 8_000,
  erro: 8_000,
} as const

/** De quem é o aviso. `projeto` aceita id ou caminho; `conversa`, o id. Sem
 *  projeto, a conversa já diz de qual projeto é. */
export interface Origem {
  projeto?: string | null
  conversa?: string | null
}

export interface Acao {
  rotulo: string
  fazer: () => void
}

interface Comum {
  detalhe?: string | null
  /** Id estável: o mesmo aviso não empilha, e dá para fechar por fora. */
  id?: string
  /** Sobrescreve a duração da natureza. `Infinity` = até fechar. */
  duracao?: number
  aoFechar?: () => void
}

export interface OpcoesDeFeito extends Comum {
  acao?: Acao
}

export type OpcoesDeNota = OpcoesDeFeito

export interface OpcoesDeEvento extends Comum {
  origem?: Origem
  acao?: Acao
  /** Segunda ação, discreta (cancelar, dispensar, abrir outra coisa). */
  secundaria?: Acao
  /** Vai também para o sino (padrão: sim, quando há projeto). */
  sino?: boolean
}

export interface OpcoesDeErro extends Comum {
  origem?: Origem
  acao?: Acao
  secundaria?: Acao
}

interface Projetinho {
  id: string
  name: string
  path: string
  color?: string | null
}

interface ConversaMin {
  id: string
  title?: string | null
}

/** A identidade de uma origem a partir dos dados vivos. Projeto por id ou
 *  caminho; sem projeto, o da conversa. Sem nada, `null` (o aviso não inventa
 *  dono). Puro. */
export function resolverIdentidade(
  origem: Origem | undefined,
  projetos: Projetinho[],
  chat: {
    byId: Record<string, { projectId?: string } | undefined>
    conversationsByProject: Record<string, ConversaMin[] | undefined>
    conversations: ConversaMin[]
  },
): (IdentidadeDoAviso & { projectId: string }) | null {
  if (!origem) return null
  const conversa = origem.conversa ?? null
  const chaveDoProjeto = origem.projeto ?? (conversa ? chat.byId[conversa]?.projectId : null) ?? null
  const projeto = chaveDoProjeto
    ? projetos.find((p) => p.id === chaveDoProjeto || p.path === chaveDoProjeto)
    : undefined
  if (!projeto) return null
  const lista = chat.conversationsByProject[projeto.id] ?? chat.conversations
  const titulo = conversa ? lista.find((c) => c.id === conversa)?.title?.trim() || null : null
  return { projeto: projeto.name, cor: projeto.color ?? null, conversa: titulo, projectId: projeto.id }
}

function identidadeViva(origem: Origem | undefined) {
  if (!origem) return null
  return resolverIdentidade(origem, useApp.getState().projects, useChat.getState())
}

function corpo(texto: string, identidade: IdentidadeDoAviso | null, detalhe?: string | null, erro = false) {
  return createElement(CorpoDoAviso, { identidade, texto, detalhe, erro })
}

const botao = (a?: Acao) => (a ? { label: a.rotulo, onClick: () => a.fazer() } : undefined)

export { mensagemDe } from "@/lib/mensagemDe"

export const avisar = {
  /** Resultado de um gesto seu que não tem lugar para aparecer. Uma linha,
   *  sem identidade: você acabou de fazer, sabe de onde é. Diga o OBJETO
   *  ("Caminho de x.ts copiado"), não só o verbo. */
  feito(texto: string, o: OpcoesDeFeito = {}): string | number {
    return toast(corpo(texto, null, o.detalhe), {
      id: o.id,
      duration: o.duracao ?? (o.acao ? DURACAO.feitoComDesfazer : DURACAO.feito),
      action: botao(o.acao),
      onDismiss: o.aoFechar,
    })
  },

  /** O seu gesto não aconteceu, e por quê. Neutra: não é erro, é a regra
   *  ("Missão em andamento. Pare a missão para enviar manualmente."). */
  nota(texto: string, o: OpcoesDeNota = {}): string | number {
    return toast(corpo(texto, null, o.detalhe), {
      id: o.id,
      duration: o.duracao ?? DURACAO.nota,
      action: botao(o.acao),
      onDismiss: o.aoFechar,
    })
  },

  /** Algo aconteceu sem você. Com projeto, vai também para o sino. */
  evento(texto: string, o: OpcoesDeEvento = {}): string | number {
    const identidade = identidadeViva(o.origem)
    if (identidade && o.sino !== false) {
      useNotifs.getState().push({
        kind: "evento",
        title: texto,
        subtitle: identidade.conversa ? `${identidade.projeto} · ${identidade.conversa}` : identidade.projeto,
        projectId: identidade.projectId,
        convId: o.origem?.conversa ?? undefined,
      })
    }
    return toast(corpo(texto, identidade, o.detalhe), {
      id: o.id,
      duration: o.duracao ?? DURACAO.evento,
      action: botao(o.acao),
      cancel: botao(o.secundaria),
      onDismiss: o.aoFechar,
    })
  },

  /** Algo deu errado. Com ação, fica até você fechar. */
  erro(texto: string, o: OpcoesDeErro = {}): string | number {
    const identidade = identidadeViva(o.origem)
    // `toast.error` traz o ícone de alerta: o erro sem dono não se confunde
    // com um "feito".
    return toast.error(corpo(texto, identidade, o.detalhe, true), {
      id: o.id,
      duration: o.duracao ?? (o.acao ? Infinity : DURACAO.erro),
      action: botao(o.acao),
      cancel: botao(o.secundaria),
      onDismiss: o.aoFechar,
    })
  },

  /** Tira um aviso da tela pelo id. */
  fechar(id: string | number): void {
    toast.dismiss(id)
  },
}
