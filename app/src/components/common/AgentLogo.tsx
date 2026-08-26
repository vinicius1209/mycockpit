import { cn } from "@/lib/utils"

/**
 * Logos OFICIAIS de cada code agent, do produto e não da empresa: Claude Code,
 * Codex, Antigravity e OpenCode.
 *
 * POR QUE VENDORIZADO e não como dependência: os SVGs vêm da coleção
 * `@lobehub/icons` (MIT, github.com/lobehub/lobe-icons), que tem 903 ícones e
 * peer dependency de `antd ^6` + `@lobehub/ui ^5`. Arrastar o antd inteiro para
 * um app shadcn/Tailwind — com o bundle já em 1.4MB — para usar TRÊS ícones não
 * se paga. Aqui são ~1.7KB de path, offline por construção (o app é Tauri, CDN
 * de ícone não é opção) e sem risco de bundle.
 *
 * A tentativa anterior era uma INICIAL em quadradinho colorido ("C", "X", "A").
 * Falhou no primeiro contato: o usuário perguntou "o que é esse C?". Era um
 * código que só o autor sabia ler — copiei a forma do Warp (avatar + selo) sem
 * notar que o conteúdo deles é reconhecível porque é o logo do Warp.
 *
 * Cor: o Claude Code carrega o coral da marca (#D97757, do próprio SVG) porque é
 * assim que ele é reconhecido; Codex e Antigravity são monocromáticos no
 * original e herdam `currentColor`, o que os deixa obedecer ao tema.
 */
export const AGENT_LOGO_LABEL: Record<string, string> = {
  "claude-code": "Claude Code",
  codex: "Codex",
  agy: "Antigravity",
  opencode: "OpenCode",
}

function Claude({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <path clipRule="evenodd" d="M20.998 10.949H24v3.102h-3v3.028h-1.487V20H18v-2.921h-1.487V20H15v-2.921H9V20H7.488v-2.921H6V20H4.487v-2.921H3V14.05H0V10.95h3V5h17.998v5.949zM6 10.949h1.488V8.102H6v2.847zm10.51 0H18V8.102h-1.49v2.847z" fill="#D97757" fillRule="evenodd"></path>
    </svg>
  )
}

function Codex({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" fillRule="evenodd" className={className} aria-hidden="true">
      <path clipRule="evenodd" d="M8.086.457a6.105 6.105 0 013.046-.415c1.333.153 2.521.72 3.564 1.7a.117.117 0 00.107.029c1.408-.346 2.762-.224 4.061.366l.063.03.154.076c1.357.703 2.33 1.77 2.918 3.198.278.679.418 1.388.421 2.126a5.655 5.655 0 01-.18 1.631.167.167 0 00.04.155 5.982 5.982 0 011.578 2.891c.385 1.901-.01 3.615-1.183 5.14l-.182.22a6.063 6.063 0 01-2.934 1.851.162.162 0 00-.108.102c-.255.736-.511 1.364-.987 1.992-1.199 1.582-2.962 2.462-4.948 2.451-1.583-.008-2.986-.587-4.21-1.736a.145.145 0 00-.14-.032c-.518.167-1.04.191-1.604.185a5.924 5.924 0 01-2.595-.622 6.058 6.058 0 01-2.146-1.781c-.203-.269-.404-.522-.551-.821a7.74 7.74 0 01-.495-1.283 6.11 6.11 0 01-.017-3.064.166.166 0 00.008-.074.115.115 0 00-.037-.064 5.958 5.958 0 01-1.38-2.202 5.196 5.196 0 01-.333-1.589 6.915 6.915 0 01.188-2.132c.45-1.484 1.309-2.648 2.577-3.493.282-.188.55-.334.802-.438.286-.12.573-.22.861-.304a.129.129 0 00.087-.087A6.016 6.016 0 015.635 2.31C6.315 1.464 7.132.846 8.086.457zm-.804 7.85a.848.848 0 00-1.473.842l1.694 2.965-1.688 2.848a.849.849 0 001.46.864l1.94-3.272a.849.849 0 00.007-.854l-1.94-3.393zm5.446 6.24a.849.849 0 000 1.695h4.848a.849.849 0 000-1.696h-4.848z"></path>
    </svg>
  )
}

function Antigravity({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" fillRule="evenodd" className={className} aria-hidden="true">
      <path d="M21.751 22.607c1.34 1.005 3.35.335 1.508-1.508C17.73 15.74 18.904 1 12.037 1 5.17 1 6.342 15.74.815 21.1c-2.01 2.009.167 2.511 1.507 1.506 5.192-3.517 4.857-9.714 9.715-9.714 4.857 0 4.522 6.197 9.714 9.715z"></path>
    </svg>
  )
}

/** Logo do agent. `null` para agent sem logo conhecido — não inventa símbolo
 *  (a lição do "C": marca que precisa de legenda não é marca). */
/** OpenCode. Geometria do `opencode.ai/favicon.svg` (canvas 512 oficial), com
 *  os preenchimentos adaptados a `currentColor` — mesma regra do Codex e do
 *  Antigravity aqui: monocromático obedece ao tema. O `viewBox` de 512 fica
 *  como está; ele escala, e reencaixar a mão é como marca vira desenho torto. */
function OpenCode({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 512 512" className={className} aria-hidden="true" fill="none">
      <path d="M320 224V352H192V224H320Z" fill="currentColor" fillOpacity="0.28" />
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M384 416H128V96H384V416ZM320 160H192V352H320V160Z"
        fill="currentColor"
      />
    </svg>
  )
}

export function AgentLogo({
  agent,
  className,
}: {
  agent: string
  className?: string
}) {
  const cls = cn("size-full", className)
  if (agent === "claude-code" || agent === "") return <Claude className={cls} />
  if (agent === "codex") return <Codex className={cls} />
  if (agent === "agy") return <Antigravity className={cls} />
  if (agent === "opencode") return <OpenCode className={cls} />
  return null
}

export function agentLogoLabel(agent: string): string {
  return AGENT_LOGO_LABEL[agent] ?? agent
}
