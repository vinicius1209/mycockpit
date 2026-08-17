// A FAIXA QUE DECIDE SE O AGENTE EXECUTA COMANDO NA SUA MÁQUINA.
//
// É o controle de maior consequência do app inteiro e estava sem um teste
// sequer. O que se prova aqui é a LIGAÇÃO: `lib/permission` já tinha teste puro,
// mas teste puro não impede o componente de contornar a função — e a faixa tinha
// mesmo a precedência copiada inline. Então a asserção é sempre sobre a MARCAÇÃO
// que o usuário vê (qual botão está marcado, qual está desabilitado, qual aviso
// aparece), nunca sobre o helper isolado.
//
// Renderização server-side (`renderToStaticMarkup`), que é o que o repo tem —
// sem jsdom, sem testing-library. Com um porém que vale registrar: o zustand v5
// em SSR devolve `getInitialState()`, NÃO o estado corrente (medido: um
// `useApp.setState` antes do render não chega ao componente). Por isso o store é
// MOCKADO aqui — sem isso o teste renderizaria sempre o estado de fábrica e
// passaria dizendo nada. Gesto (clicar no segmented) precisa de DOM de verdade e
// mora em `e2e/composer-permissao.spec.ts`.
import { renderToStaticMarkup } from "react-dom/server"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { PermissionMode, Project } from "@/lib/types"
import type { ProjectConfig } from "@/store/app"

// Estado do useApp sob controle do teste (o mock lê daqui a cada render).
const app: { projects: Project[]; mycockpit: Record<string, ProjectConfig> } = {
  projects: [],
  mycockpit: {},
}

vi.mock("@/store/app", () => ({
  useApp: Object.assign(
    (seletor: (s: typeof app) => unknown) => seletor(app),
    { getState: () => app },
  ),
}))

const { ExecutionRow } = await import("@/components/chat/ExecutionRow")

/** Projeto real do banco do autor (caminho e nome trocados; a forma é a que o
 *  `lib/db` devolve: id uuid, `permissionMode` = o cache do SQLite). */
const PROJETO: Project = {
  id: "9d0f2f7a-6f4a-4b0e-9c6f-2b1d4a55c101",
  name: "mycockpit",
  path: "/Users/dev/projetos/mycockpit",
  createdAt: 1_752_700_000_000,
  hasClaudeMd: true,
  hasAgentsMd: true,
  status: "idle",
  permissionMode: "padrao",
}

function config(permission: PermissionMode): ProjectConfig {
  return {
    exists: true,
    permission,
    helper: "haiku",
    mode: "linear",
    extraDirs: [],
  }
}

/** A faixa como o CommandConsole a monta (props reais do call site). */
function render(
  over: Partial<React.ComponentProps<typeof ExecutionRow>> = {},
) {
  return renderToStaticMarkup(
    <ExecutionRow
      project={PROJETO}
      convAgent="claude-code"
      planFirst={false}
      onTogglePlanFirst={() => {}}
      running={false}
      identityLabel="Claude Code · Opus 5 · xhigh"
      identityLocked={false}
      identity={<span data-identidade="1">seletores crus</span>}
      {...over}
    />,
  )
}

/** O modo marcado no radiogroup, lido do `aria-checked` da marcação. */
function marcado(html: string): string | null {
  const botoes = html.match(/<button[^>]*role="radio"[^>]*>.*?<\/button>/g) ?? []
  const on = botoes.find((b) => b.includes('aria-checked="true"'))
  if (!on) return null
  return on.replace(/<[^>]*>/g, "").trim()
}

beforeEach(() => {
  app.projects = [PROJETO]
  app.mycockpit = {}
})

describe("o modo que a faixa mostra é o que o próximo turno vai usar", () => {
  it("sem config no disco, vale o cache do SQLite", () => {
    app.projects = [{ ...PROJETO, permissionMode: "leitura" }]
    expect(marcado(render())).toBe("Só lê")
  })

  it("o .mycockpit/config.toml VENCE o cache do SQLite", () => {
    // A divergência é real: o arquivo é versionado no git e editável à mão, o
    // cache é derivado. Quem manda no spawn é o arquivo — se a faixa mostrasse
    // o cache, ela estaria mentindo sobre o que o agente pode fazer.
    app.projects = [{ ...PROJETO, permissionMode: "leitura" }]
    app.mycockpit = { [PROJETO.id]: config("liberado") }
    expect(marcado(render())).toBe("Liberado")
  })

  it("sem config e sem cache, cai em Pede — nunca fail-open pra Liberado", () => {
    app.projects = [{ ...PROJETO, permissionMode: undefined }]
    expect(marcado(render())).toBe("Pede")
  })

  it("sem projeto ativo, os três botões ficam desabilitados", () => {
    // `disabled={!project}`: sem projeto não há `.mycockpit` onde gravar, e um
    // segmented clicável que não grava nada é o pior dos mundos — parece que
    // você mudou o modo.
    const html = render({ project: null })
    const radios = html.match(/<button[^>]*role="radio"[^>]*>/g) ?? []
    expect(radios).toHaveLength(3)
    expect(radios.every((b) => b.includes("disabled"))).toBe(true)
  })

  it("trocar de projeto troca o modo mostrado (o modo é do PROJETO)", () => {
    // Mesma família do bug do `destination` sobrevivendo à troca de conversa:
    // estado de uma superfície que não segue quem a alimenta.
    const outro: Project = {
      ...PROJETO,
      id: "f2c1a3d4-1111-4444-8888-aaaabbbbcccc",
      name: "mypeople",
      path: "/Users/dev/projetos/mypeople",
      permissionMode: "liberado",
    }
    app.projects = [PROJETO, outro]
    app.mycockpit = { [PROJETO.id]: config("leitura") }
    expect(marcado(render())).toBe("Só lê")
    expect(marcado(render({ project: outro }))).toBe("Liberado")
  })
})

describe("o modo perigoso se anuncia, e só ele", () => {
  it("Liberado marcado acende o âmbar e o triângulo", () => {
    app.mycockpit = { [PROJETO.id]: config("liberado") }
    const html = render()
    expect(html).toContain("bg-st-warning/15")
    // O triângulo do lucide vira <svg> com a classe do call site.
    expect(html).toMatch(/<svg[^>]*class="[^"]*size-3/)
  })

  it("Pede e Só lê NÃO acendem âmbar (sinal que acende sempre não é sinal)", () => {
    for (const modo of ["padrao", "leitura"] as const) {
      app.mycockpit = { [PROJETO.id]: config(modo) }
      expect(render()).not.toContain("bg-st-warning/15")
    }
  })
})

describe("a faixa não mente sobre QUANDO a troca passa a valer", () => {
  it("com turno em andamento, diz que a permissão vale no próximo envio", () => {
    // O `--permission-mode` é fixo no spawn. Sem esta linha o segmented pareceria
    // agir agora, e é a promessa que a copy faz ao usuário.
    expect(render({ running: true })).toContain(
      "Turno em andamento: a permissão vale a partir do próximo envio.",
    )
  })

  it("sem turno em andamento, o aviso não aparece", () => {
    expect(render({ running: false })).not.toContain("Turno em andamento")
  })
})

describe("quem OBEDECE ao modo é a CLI da conversa, não o projeto", () => {
  it("Antigravity em Pede: a faixa avisa que o motor ignora o modo", () => {
    app.mycockpit = { [PROJETO.id]: config("padrao") }
    const html = render({ convAgent: "agy" })
    expect(html).toContain("Antigravity IGNORA este modo")
    expect(html).toContain("text-st-warning/90")
  })

  it("Claude Code em Pede: contrato cumprido, nenhuma nota", () => {
    app.mycockpit = { [PROJETO.id]: config("padrao") }
    expect(render({ convAgent: "claude-code" })).not.toContain("IGNORA")
  })

  it("conversa sem agent definido não inventa nota", () => {
    expect(render({ convAgent: null })).not.toContain("IGNORA")
  })
})

describe("a linha de identidade nasce fechada", () => {
  it("em repouso, os seletores crus NÃO estão na marcação", () => {
    const html = render()
    expect(html).toContain('aria-expanded="false"')
    expect(html).not.toContain("data-identidade")
    // fechada, o resumo é que aparece
    expect(html).toContain("Claude Code · Opus 5 · xhigh")
  })

  it("travada, o cadeado explica por que os seletores não obedecem", () => {
    const html = render({ identityLocked: true })
    expect(html).toContain(
      "Agent e modelo ficam fixos a partir do 1º envio desta conversa",
    )
  })
})
