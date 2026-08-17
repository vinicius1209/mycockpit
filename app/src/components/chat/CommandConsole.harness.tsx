// Bancada dos testes do COMPOSER: os mocks de store e o render, num lugar só.
//
// Por que existe uma bancada em vez de repetir os mocks em cada arquivo: o
// composer é a faixa que decide se o agente executa comando na sua máquina, e a
// cobertura dele se divide em vários arquivos (permissão, envio, identidade)
// pela catraca de tamanho. Mocks copiados divergiriam — e mock que diverge é
// como um teste passa afirmando o contrário do app.
//
// Três decisões de método, todas medidas, não supostas:
//
// 1. **Os stores são MOCKADOS.** O zustand v5 em SSR devolve `getInitialState()`
//    e não o estado corrente — um `useChat.setState` antes do render não chega
//    ao componente. Sem mock, todo teste renderizaria o estado de fábrica e
//    passaria dizendo nada.
// 2. **`importOriginal` no que é REGRA.** `hasExecutorTurn`, `pendingDeferred` e
//    `deferredStopWarning` vêm do módulo de verdade: são as réguas que o
//    composer consulta, e trocá-las por fake seria testar o fake.
// 3. **`lazy` do React vira um talo síncrono.** O editor Lexical entra por
//    `lazy()` e `renderToStaticMarkup` não sabe esperar Suspense (medido:
//    "A component suspended while responding to synchronous input"). O talo
//    ecoa o `placeholder`, que é o que o composer decide e o que se quer ver.
//    O editor em si tem cobertura própria (`lexicalDraft.test.ts`, `mentions`,
//    `slashPill`) e o teclado dele é assunto de e2e.
import { renderToStaticMarkup } from "react-dom/server"
import { vi } from "vitest"
import type { Attachment } from "@/lib/attachments"
import type { AgentRunConfig, PermissionMode, Project } from "@/lib/types"
import type { ChatItem, ConvState, QueuedMsg } from "@/store/chat"
import type { ProjectConfig } from "@/store/app"

export const PROJ_FOCO = "9d0f2f7a-6f4a-4b0e-9c6f-2b1d4a55c101"
export const PROJ_DONO = "f2c1a3d4-1111-4444-8888-aaaabbbbcccc"
export const CONV = "6f1c8b90-0e2a-4b77-9a55-8b2f1c0d3e44"

export function projeto(
  id: string,
  permissionMode: PermissionMode | undefined,
): Project {
  return {
    id,
    name: id === PROJ_FOCO ? "mycockpit" : "mypeople",
    path: `/Users/dev/projetos/${id === PROJ_FOCO ? "mycockpit" : "mypeople"}`,
    createdAt: 1_752_700_000_000,
    permissionMode,
  }
}

export function config(permission: PermissionMode): ProjectConfig {
  return { exists: true, permission, helper: "haiku", mode: "linear", extraDirs: [] }
}

/** Conversa como o store a guarda (`ConvState`), com os campos que o composer
 *  lê. Os defaults são os de uma conversa NOVA, ainda sem turno. */
export function conversa(over: Partial<ConvState> = {}): ConvState {
  return {
    projectId: PROJ_DONO,
    agent: "claude-code",
    reqModel: null,
    effort: null,
    worktreePath: null,
    items: [],
    sessionId: null,
    model: null,
    streamingTextId: null,
    running: false,
    finalizing: false,
    runId: null,
    startedAt: null,
    suggestions: [],
    suggesting: false,
    queued: [],
    ...over,
  }
}

/** Turno de executor JÁ acontecido: é ele que trava agent/modelo/esforço
 *  (`hasExecutorTurn`, a régua de verdade importada do store). */
export const TURNO_DO_USUARIO: ChatItem = {
  id: "item-user-1",
  kind: "user",
  text: "roda os testes e me mostra o resultado",
  ts: 1_755_300_000_000,
}

/** Defaults de fábrica que interessam ao composer (`lib/settings.ts`). */
const SETTINGS_PADRAO = {
  defaultAgent: "claude-code",
  defaultModel: "claude-opus-5[1m]",
  defaultEffort: "default",
  missionEnabled: true,
  dictationEnabled: false,
  dictationHotkey: "alt+Space",
  dictationVocab: "",
}

/** O estado dos dois stores, sob controle do teste. */
export const app = {
  projects: [] as Project[],
  activeProjectId: PROJ_FOCO as string | null,
  mycockpit: {} as Record<string, ProjectConfig>,
  limitedAgents: {} as Record<string, string>,
  missionLaunchRequested: 0,
  fusionLaunchRequested: 0,
  settings: { ...SETTINGS_PADRAO },
}

export const chat = {
  activeId: CONV as string | null,
  drafts: {} as Record<string, string>,
  byId: {} as Record<string, ConvState>,
  conversations: [] as { id: string; agent: string | null }[],
  projectId: PROJ_DONO as string | null,
}

/** O que o composer MANDOU enviar (texto, config do run, anexos). */
export const enviados: {
  text: string
  cfg: AgentRunConfig
  attachments: Attachment[]
}[] = []

/** Zera a bancada. Chamar em `beforeEach` — estado de módulo vaza entre casos. */
export function resetarBancada() {
  app.projects = [projeto(PROJ_FOCO, "padrao"), projeto(PROJ_DONO, "padrao")]
  app.activeProjectId = PROJ_FOCO
  app.mycockpit = {}
  app.limitedAgents = {}
  app.settings = { ...SETTINGS_PADRAO }
  chat.activeId = CONV
  chat.drafts = {}
  chat.byId = { [CONV]: conversa() }
  chat.conversations = [{ id: CONV, agent: "claude-code" }]
  chat.projectId = PROJ_DONO
  enviados.length = 0
  vi.clearAllMocks()
}

// Os `vi.mock` ficam no TOPO deste módulo (não dentro de uma função): o vitest
// os iça, e ícar de dentro de função é deprecado — vira erro numa versão
// futura. Quem importa a bancada já recebe os mocks instalados.
vi.mock("@/store/app", async (orig) => {
  const real = await orig<typeof import("@/store/app")>()
  return {
    ...real,
    useApp: Object.assign(
      (seletor: (s: typeof app) => unknown) => seletor(app),
      { getState: () => app },
    ),
    useActiveProject: () =>
      app.projects.find((p) => p.id === app.activeProjectId) ?? null,
  }
})

vi.mock("@/store/chat", async (orig) => {
  const real = await orig<typeof import("@/store/chat")>()
  const acoes = {
    setDraft: vi.fn(),
    setConversationAgent: vi.fn(),
    setConversationPreset: vi.fn(),
    setPlanFirst: vi.fn(),
    removeQueued: vi.fn(),
  }
  return {
    ...real,
    useChat: Object.assign(
      (seletor: (s: typeof chat) => unknown) => seletor(chat),
      { getState: () => ({ ...chat, ...acoes }) },
    ),
    useActiveConv: () => (chat.activeId ? chat.byId[chat.activeId] : undefined) ?? conversa(),
  }
})

vi.mock("@/store/presets", () => ({
  usePresets: Object.assign(
    (seletor: (s: { list: unknown[] }) => unknown) => seletor({ list: [] }),
    { getState: () => ({ load: vi.fn() }) },
  ),
}))

// Diálogos: montam sempre (fechados) e não são o composer.
vi.mock("@/components/mission/MissionLauncher", () => ({
  MissionLauncher: () => null,
}))
vi.mock("@/components/fusion/FusionLauncher", () => ({
  FusionLauncher: () => null,
}))

vi.mock("react", async (orig) => {
  const real = await orig<typeof import("react")>()
  return {
    ...real,
    default: real,
    // Talo síncrono do editor: ecoa o placeholder que o composer escolheu.
    lazy: () => (props: { placeholder?: string }) =>
      real.createElement("div", { "data-editor": "1" }, props.placeholder),
  }
})

/** Renderiza o composer como o ChatPanel o monta. */
export async function montar(
  props: Partial<{
    disabled: boolean
    running: boolean
    finalizing: boolean
    missionRunning: boolean
    onOpenEspecialistas: () => void
  }> = {},
) {
  const { CommandConsole } = await import("@/components/chat/CommandConsole")
  return renderToStaticMarkup(
    <CommandConsole
      onSend={(text, cfg, attachments) =>
        enviados.push({ text, cfg, attachments })
      }
      onStop={() => {}}
      {...props}
    />,
  )
}

/** O modo mostrado no LETREIRO da linha de Execução (colapso do composer: os
 *  botões `role="radio"` só existem com o painel aberto, inacessível em SSR —
 *  o letreiro é quem mostra o modo SEMPRE, aberto ou fechado). */
export function modoMarcado(html: string): string | null {
  const m = html.match(/<button[^>]*aria-expanded="[^"]*"[^>]*>(.*?)<\/button>/s)
  if (!m) return null
  return m[1].replace(/<[^>]*>/g, "").trim() || null
}

/** O botão de `aria-label` dado está desabilitado? (null = não existe)
 *
 *  Procura o ATRIBUTO `disabled=""` (o que o React emite), não a substring
 *  "disabled": a classe do Button traz `disabled:pointer-events-none` e
 *  `disabled:opacity-40`, então um `includes("disabled")` daria true em TODO
 *  botão do composer — o teste passaria dizendo o contrário do que vê. */
export function desabilitado(html: string, rotulo: string): boolean | null {
  const re = new RegExp(`<button[^>]*aria-label="${rotulo}"[^>]*>`)
  const m = html.match(re)
  return m ? / disabled=""/.test(m[0]) : null
}

/** Fila de mensagens digitadas durante o turno. */
export function fila(text: string, attachments: Attachment[] = []): QueuedMsg {
  return { text, attachments }
}
