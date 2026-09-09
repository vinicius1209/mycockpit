// O BANNER NÃO OFERECE O GESTO QUANDO ELE NÃO CABE.
//
// O `BlockedDirBanner` era o único aviso acima do composer sem guarda de turno:
// o vizinho imediato dele, o `PlanPendingCard`, já tinha `&& !running &&
// !finalizing`. A assimetria custou o incidente 2026-08-16 — clicar em "Liberar
// e reenviar" no meio de um turno fez o mesmo prompt rodar duas vezes por
// inteiro (~2,4M de tokens a mais).
//
// O botão não podia funcionar ali por um motivo de arquitetura, não de gosto: o
// `--add-dir` entra no `build_command` do SPAWN (`src-tauri/src/adapters.rs`),
// então nenhuma pasta é emendada num processo vivo, nem com resume nativo.
//
// Renderização server-side (`renderToStaticMarkup`), o padrão do repo
// (`InteractionHost.test.tsx`): a marcação destes banners é função pura das
// props.
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import {
  AutoResumeBanner,
  BlockedDirBanner,
  CotaEsgotadaBanner,
  MotorAusenteBanner,
  PreflightGateBanner,
  RevezamentoStagedBanner,
} from "@/components/chat/ComposerBanners"
import { RESUME_REASON_LIMIT } from "@/lib/autoResume"
import { PENDING_DECISION } from "@/lib/attention"
import type { McpPreflightGate } from "@/lib/tooling"

const PASTA = "/Users/viniciusmachado/.gemini/antigravity-cli"

function montar(busy: boolean) {
  return renderToStaticMarkup(
    <BlockedDirBanner
      dir={PASTA}
      busy={busy}
      onAllow={() => {}}
      onDismiss={() => {}}
    />,
  )
}

describe("com turno em voo", () => {
  it("o botão de liberar e reenviar NÃO aparece", () => {
    expect(montar(true)).not.toContain("Liberar e reenviar")
  })

  it("o aviso FICA (o bloqueio está acontecendo agora)", () => {
    const html = montar(true)
    expect(html).toContain("barrado ao acessar uma pasta fora do projeto")
    expect(html).toContain(PASTA)
  })

  it("e explica o prazo, sem prometer conserto neste turno", () => {
    const html = montar(true)
    expect(html).toContain("liberar")
    expect(html).toContain("assim que ele terminar")
    // Copy do §7: nada de travessão na prosa da UI.
    expect(html).not.toContain("—")
  })

  it("a saída (dispensar) continua disponível", () => {
    expect(montar(true)).toContain('aria-label="Dispensar aviso"')
  })
})

describe("com a conversa parada", () => {
  it("o gesto volta, porque agora ele nasce num turno novo", () => {
    expect(montar(false)).toContain("Liberar e reenviar")
  })

  it("sem a nota de prazo (ela seria ruído: o botão funciona)", () => {
    expect(montar(false)).not.toContain("assim que ele terminar")
  })
})

describe("a tinta é a de decisão pendente, não a do gesto", () => {
  it("o contêiner usa a receita única do lib/attention (ADR-043)", () => {
    for (const parte of PENDING_DECISION.split(" ")) {
      expect(montar(false)).toContain(parte)
    }
  })

  it("o botão primário dentro dele continua brass (§2: brass é gesto)", () => {
    expect(montar(false)).toContain("bg-brass")
  })
})

describe("MotorAusenteBanner", () => {
  it("mostra o comando quando a receita é conhecida", () => {
    const html = renderToStaticMarkup(
      createElement(MotorAusenteBanner, {
        label: "Codex",
        aviso: { comando: "brew install codex", ehLink: false },
      }),
    )
    expect(html).toContain("Codex")
    expect(html).toContain("brew install codex")
    expect(html).toContain("Copiar")
  })

  it("oferece ABRIR, não copiar, quando a receita é um endereço", () => {
    const html = renderToStaticMarkup(
      createElement(MotorAusenteBanner, {
        label: "Antigravity",
        aviso: { comando: "https://antigravity.google/cli", ehLink: true },
      }),
    )
    expect(html).toContain("Abrir")
    expect(html).not.toContain(">Copiar<")
  })

  it("sem receita, diz que não conhece em vez de chutar uma", () => {
    const html = renderToStaticMarkup(
      createElement(MotorAusenteBanner, {
        label: "Motor novo",
        aviso: { comando: null, ehLink: false },
      }),
    )
    expect(html).toContain("não vou chutar")
    expect(html).not.toContain("Copiar")
  })
})

describe("AutoResumeBanner", () => {
  const html = renderToStaticMarkup(
    <AutoResumeBanner
      nextAt={Date.parse("2026-08-31T14:30:02-03:00")}
      tries={2}
      maxTries={5}
      reason={RESUME_REASON_LIMIT}
      onCancel={() => {}}
      onResumeNow={() => {}}
    />,
  )

  it("diz que é a próxima tentativa, sem fingir que ela já aconteceu", () => {
    expect(html).toContain("próxima tentativa 2 de 5")
    expect(html).toContain("após o reset do limite")
  })

  it("é uma faixa neutra, não um segundo cartão âmbar", () => {
    expect(html).toContain("border bg-card")
    for (const parte of PENDING_DECISION.split(" ")) {
      expect(html).not.toContain(parte)
    }
    expect(html).not.toContain("animate-pulse")
  })

  it("preserva o gesto imediato e a saída", () => {
    expect(html).toContain("Retomar agora")
    expect(html).toContain('aria-label="Cancelar auto-resume"')
  })
})

describe("PreflightGateBanner", () => {
  const gate: McpPreflightGate = {
    fingerprint: "gate-playwright",
    issues: [
      {
        sourceId: "playwright",
        sourceLabel: "Playwright",
        code: "browser-offline",
        disposition: "needs-readonly-consent",
        detail: "navegador desligado",
      },
    ],
    allowedRecoveries: [
      { kind: "start-project-browser", sourceId: "playwright" },
      { kind: "retry-readonly", sourceId: "playwright" },
      { kind: "open-mcp-settings", sourceId: "playwright" },
    ],
  }
  const html = renderToStaticMarkup(
    <PreflightGateBanner
      gate={gate}
      onStartBrowser={() => {}}
      startBrowserSends
      onOpenSettings={() => {}}
      onRetryReadonly={() => {}}
    />,
  )

  it("explica que o turno ainda não começou", () => {
    expect(html).toContain("O turno ainda não começou")
    expect(html).toContain("Ligar e enviar")
  })

  it("mantém uma única ação primária quando há alternativas", () => {
    expect(html.match(/data-variant="default"/g)).toHaveLength(1)
    expect(html.match(/data-variant="ghost"/g)).toHaveLength(2)
  })
})

describe("revezamento proativo", () => {
  it("oferece alternativas dentro da superfície de decisão", () => {
    const html = renderToStaticMarkup(
      <CotaEsgotadaBanner
        agentLabel="Codex"
        resetHint="em 4d 15h"
        alternatives={[
          { id: "claude-code", label: "Claude Code" },
          { id: "agy", label: "Antigravity" },
        ]}
        onSelect={() => {}}
      />,
    )
    expect(html).toContain("Codex chegou ao limite de uso")
    expect(html).toContain("Volta em 4d 15h")
    expect(html).toContain("Usar Claude Code")
    expect(html).toContain("Usar Antigravity")
    for (const parte of PENDING_DECISION.split(" ")) {
      expect(html).toContain(parte)
    }
    expect(html.match(/data-variant="default"/g)).toHaveLength(1)
  })

  it("não inventa saída quando nenhum outro motor foi confirmado", () => {
    const html = renderToStaticMarkup(
      <CotaEsgotadaBanner
        agentLabel="Codex"
        resetHint={null}
        alternatives={[]}
        onSelect={() => {}}
      />,
    )
    expect(html).toContain("Nenhum outro motor disponível foi confirmado")
    expect(html).not.toContain(">Usar ")
  })

  it("distingue troca preparada de troca já confirmada", () => {
    const html = renderToStaticMarkup(
      <RevezamentoStagedBanner
        sourceLabel="Codex"
        targetLabel="Claude Code"
        onUndo={() => {}}
      />,
    )
    expect(html).toContain("Próximo envio: Claude Code no lugar de Codex")
    expect(html).toContain("só será confirmada quando o novo motor abrir a sessão")
    expect(html).toContain("Desfazer")
    expect(html).toContain("border bg-card")
    for (const parte of PENDING_DECISION.split(" ")) {
      expect(html).not.toContain(parte)
    }
  })
})
