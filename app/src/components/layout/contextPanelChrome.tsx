// A GRAMÁTICA VISUAL do painel direito, num arquivo só: seção, aba e badge de
// estágio. Saiu do `ContextPanel.tsx` porque ele estava no teto da catraca do
// §10 e a regra é dividir, nunca subir o teto — e porque as três peças mudam
// juntas: são a receita de "seção" e de "ativo" do painel (ADR-043, Fase 2).
import type { ReactNode } from "react"
import type { LucideIcon } from "lucide-react"
import { Activity, Eye, FileDiff, Folder, Route } from "lucide-react"
import { cn } from "@/lib/utils"
import type { ContextPanelTab } from "@/store/app"

/** Seção do painel. Separação por PROXIMIDADE ASSIMÉTRICA (§4): 24px acima do
 *  título, 8px abaixo (razão 3:1) — é isso que gruda o título no conteúdo dele
 *  e o descola do anterior. Zero `<Separator />`: eram 7 hairlines que
 *  ignoravam o `px-5` das seções e corriam de parede a parede enquanto o
 *  conteúdo respirava 20px. */
export function Section({
  title,
  children,
}: {
  title: string
  children: ReactNode
}) {
  return (
    <section className="px-5 pt-6 pb-0 first:pt-1">
      <div className="mb-2">
        <span className="etiqueta">{title}</span>
      </div>
      {children}
    </section>
  )
}

/** Aba do painel (Arquivos | Conversa | Alterações | Contexto). Ativa = a MESMA
 *  receita das linhas da árvore (§2, ADR-043): preenchimento neutro `--sel` +
 *  peso, sem tinta. Saiu o sublinhado brass, que era a terceira linguagem de
 *  "ativo" do app, e o contador saiu do brass junto (número é metadado, não gesto).
 *  Sem pip: o pip é o marcador do GUTTER de lista/árvore, e uma tira
 *  horizontal de abas não tem gutter.
 *
 *  SEM CAIXA-ALTA (build 206). A aba usava `uppercase` + `tracking`, que é
 *  **o mesmo tratamento dos títulos de seção** deste mesmo painel (`.etiqueta`
 *  em AJUSTES, DOUTRINA, APRENDIZADO…). Duas naturezas opostas com a mesma
 *  roupa: aba é CONTROLE (clica), título de seção é RÓTULO (lê) — a hierarquia
 *  do painel achatava, e não dava pra distinguir navegação de conteúdo. O
 *  título de seção MANTÉM o tratamento, que ali é correto.
 *  O custo era medido, não estético: com caixa-alta a tira antiga media
 *  **353,6px**; sem, **298,9px** (−15%). A quarta aba elevou a largura mínima
 *  de rótulos completos para 400px. A quinta (Bastidores, ADR-200) mudou a
 *  receita, medida no navegador em 16/09/2026 com o pior caso de contador
 *  Aba do painel direito (Arquivos | Conversa | Alterações | Bastidores | Contexto).
 *  Sempre ícones, sem salto ou alternância de layout ao redimensionar o painel
 *  (ex.: ao abrir um processo em background nos Bastidores). O nome completo
 *  mora no `title` (tooltip) e no `aria-label`.
 *  O contador (badge) continua visível ao lado do ícone quando presente. */
export function TabBtn({
  active,
  onClick,
  icon: Icon,
  label,
  badge,
}: {
  active: boolean
  onClick: () => void
  icon: LucideIcon
  /** Rótulo acessível e tooltip (`title`/`aria-label`). */
  label: string
  /** Contador opcional (ex.: nº de arquivos alterados). 0 = sem badge. */
  badge?: number
}) {
  return (
    <button
      onClick={onClick}
      title={label}
      aria-label={label}
      className={cn(
        "flex h-[26px] min-w-0 flex-auto items-center justify-center gap-1.5 rounded-md px-2 text-[11px] font-medium transition-colors",
        active
          ? "bg-sel text-foreground"
          : "text-muted-foreground/50 hover:bg-sel-hover hover:text-muted-foreground",
      )}
    >
      <Icon className="size-3.5 shrink-0" />
      {badge != null && badge > 0 && (
        <span
          className={cn(
            "font-mono font-semibold tabular-nums",
            active ? "text-muted-foreground" : "text-faint",
          )}
        >
          {badge}
        </span>
      )}
    </button>
  )
}

/** Ordem semântica aprovada no mock do cockpit. Centralizar aqui evita que o
 *  cabeçalho e o roteamento do painel ganhem ordens divergentes. */
export function ContextPanelTabs({
  tab,
  changedCount,
  liveCount = 0,
  onSelect,
}: {
  tab: ContextPanelTab
  changedCount: number
  /** Trabalhos em segundo plano vivos na conversa ativa (ADR-200). */
  liveCount?: number
  onSelect: (tab: ContextPanelTab) => void
}) {
  return (
    <header className="flex h-11 shrink-0 items-center gap-1 px-2.5">
      <TabBtn
        active={tab === "arquivos"}
        onClick={() => onSelect("arquivos")}
        icon={Folder}
        label="Arquivos"
      />
      <TabBtn
        active={tab === "conversa"}
        onClick={() => onSelect("conversa")}
        icon={Route}
        label="Conversa"
      />
      <TabBtn
        active={tab === "alteracoes"}
        onClick={() => onSelect("alteracoes")}
        icon={FileDiff}
        badge={changedCount}
        label="Alterações"
      />
      <TabBtn
        active={tab === "bastidores"}
        onClick={() => onSelect("bastidores")}
        icon={Activity}
        badge={liveCount}
        label="Bastidores"
      />
      <TabBtn
        active={tab === "contexto"}
        onClick={() => onSelect("contexto")}
        icon={Eye}
        label="O que o agente vê"
      />
    </header>
  )
}
