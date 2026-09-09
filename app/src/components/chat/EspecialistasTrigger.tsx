// <EspecialistasTrigger> — a porta dos Especialistas no rodapé do composer.
//
// Era um `<Sparkles>`, o glifo universal de "IA mágica": não dizia QUEM está
// disponível, nem QUANTOS existem, nem se o time foi instalado. Um clique cego
// num rodapé que já tem seis controles.
//
// Agora o botão MOSTRA o time, com as caras que o app já gera offline e já usa
// no marketplace, no menu de `@` e na faixa de presença. A cor de cada cara é o
// domínio (`categoryColor`), então a pilha também diz "tem gente de engenharia,
// design e ops aqui" sem gastar uma palavra.
//
// AGNÓSTICO POR CONSTRUÇÃO: nada aqui sabe qual motor está selecionado. Persona
// é conceito do produto, não de fornecedor — o mesmo botão vale com claude-code,
// codex e agy, e continuará valendo com o próximo. Se um dia precisar variar por
// motor, a resposta é uma capability no registry, nunca um `if` de nome aqui.
//
// DEGRADAÇÃO HONESTA: sem persona nenhuma, não se inventa cara. O botão volta ao
// glifo neutro, porque a porta continua existindo (é por ela que se instala o
// time inicial) mas não há ninguém pra retratar.

import { Sparkles } from "lucide-react"
import { AgentFace } from "@/components/chat/AgentFace"
import { Button } from "@/components/ui/button"
import { usePresets } from "@/store/presets"
import type { AgentDef } from "@/lib/agentDefs"

/** Quantas caras cabem antes da pilha virar mingau. Três é o que o rodapé
 *  comporta sem empurrar o resto da fileira, e já basta pra ler "é um time". */
export const CARAS_VISIVEIS = 3

/** Lado da cara nesta superfície. O controle é `padrao` (32px), então 20px
 *  deixa a folga óptica de 6px em cima e embaixo — a mesma medida que o menu de
 *  `@` já usa pra esta cara em linha de lista. */
const LADO_DA_CARA = 20

/** Rótulo do botão. PURO, e exportado porque é ele que o teste fixa: é a única
 *  coisa que uma pessoa com leitor de tela recebe deste controle. */
export function rotuloDosEspecialistas(total: number): string {
  if (total === 0) return "Especialistas"
  if (total === 1) return "1 especialista"
  return `${total} especialistas`
}

type Cara = Pick<
  AgentDef,
  "id" | "category" | "avatarStyle" | "avatarSeed" | "slug" | "name"
>

/**
 * A porta, sem store. O container abaixo é que lê o zustand.
 *
 * A separação NÃO é preferência de estilo: componente que lê a store direto e
 * é renderizado por `renderToStaticMarkup` na suíte enxerga para sempre o
 * estado INICIAL (zustand v5 + SSR usa `getInitialState`), então a versão com
 * store é intestável aqui. Quem precisa provar comportamento recebe props.
 */
export function PortaDosEspecialistas({
  time,
  total,
  onOpen,
}: {
  /** Até `CARAS_VISIVEIS` personas, já fatiadas. */
  time: Cara[]
  /** Quantas existem no escopo (pode ser maior que `time.length`). */
  total: number
  onOpen: () => void
}) {
  const rotulo = rotuloDosEspecialistas(total)
  return (
    <Button
      variant="ghost"
      size={total === 0 ? "icone-padrao" : "padrao"}
      onClick={onOpen}
      className="rounded-full text-muted-foreground hover:text-foreground"
      title={rotulo}
      aria-label={rotulo}
    >
      {total === 0 ? (
        <Sparkles className="size-4" />
      ) : (
        <>
          {/* Pilha sobreposta: o anel é da COR DA SUPERFÍCIE, não uma borda —
              assim ele separa uma cara da outra sem virar mais um filete
              tingido na tela (§4). */}
          <span className="flex items-center">
            {time.map((def, i) => (
              <AgentFace
                key={def.id}
                def={def}
                size={LADO_DA_CARA}
                olhar
                className={i > 0 ? "-ml-1.5 ring-[1.5px] ring-card" : "ring-[1.5px] ring-card"}
              />
            ))}
          </span>
          {/* `tabular-nums`: o número muda quando o projeto troca de escopo, e
              dígito de largura variável faria a fileira dançar (§6). */}
          <span className="tabular-nums">{total}</span>
        </>
      )}
    </Button>
  )
}

export function EspecialistasTrigger({ onOpen }: { onOpen: () => void }) {
  const list = usePresets((s) => s.list)
  return (
    <PortaDosEspecialistas
      time={list.slice(0, CARAS_VISIVEIS)}
      total={list.length}
      onOpen={onOpen}
    />
  )
}
