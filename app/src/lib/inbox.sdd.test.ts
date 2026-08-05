// INBOX — descoberto ≠ pendente (semântica do sino).
//
// O caso real: chat novo no projeto meuingresso3.0 e o sino acendeu "2" — dois
// "Aprovar PRD" de planos SDD criados em MAIO/2026 pelo fluxo do usuário NO
// TERMINAL. O app está certo em LER o .claude/plans; estava errado em contar
// isso como interrupção. Badge é sinal de "precisa de você AGORA"; 68 dias de
// dívida arqueológica não é agora.
//
// Fixtures = manifests REAIS (ADR-016: fixture inventada esconde bug):
//  · sdd-auth-05-mobile-mfa e sdd-auth-06-cleanup, copiados de
//    ~/projetos/meuingresso3.0/.claude/plans (stage "prd", prd.approved false,
//    created_at 2026-05-28) — exatamente os dois que acenderam o "2".
//  · prospector-crm-import, de prime-sales-hub: manifest real, com stage "pr" e
//    merged_at null retomados do commit ANTERIOR ao plan-sync que o mandou pra
//    "done" (git show 20f3534d^) e o pr_url do manifest atual — o estado que o
//    plano teve de fato entre abrir o PR e mergear.

import { beforeEach, describe, expect, it, vi } from "vitest"
import type { SddPlanMark } from "@/lib/db"
import type { Project } from "@/lib/types"

// Estado dos mocks (resetado a cada teste).
let marks: SddPlanMark[] | null = []
let marksThrows = false
/** (project_id, slug) com etapa DIRIGIDA pelo cockpit — as linhas de stage_runs,
 *  a prova documental da adoção. */
let driven: { projectId: string; slug: string }[] | null = []
let drivenThrows = false
/** Falhas que o adoptSddPlan simula antes de aceitar (retry curto). */
let adoptFailures = 0
let adoptCalls = 0
let fusionPendentes: { convId: string; projectId: string; title: string | null }[] = []
let propostas: {
  id: string
  projectId: string | null
  body: string
  createdAt: number
}[] = []

vi.mock("@/lib/db", () => ({
  listPendingDecisions: () => Promise.resolve(fusionPendentes),
  listOpenProposals: () => Promise.resolve(propostas),
  listSddPlanMarks: () =>
    marksThrows
      ? Promise.reject(new Error("database is locked"))
      : Promise.resolve(marks),
  listDrivenPlanKeys: () =>
    drivenThrows
      ? Promise.reject(new Error("database is locked"))
      : Promise.resolve(driven),
  adoptSddPlan: () => {
    adoptCalls++
    return adoptCalls <= adoptFailures
      ? Promise.reject(new Error("database is locked"))
      : Promise.resolve()
  },
}))

// loadSddPlans é o único mock do módulo do SDD: o NORMALIZADOR real (parseSddPlan)
// continua valendo, então o manifest cru do disco passa pelo mesmo parse do app.
vi.mock("@/lib/sdd", async (orig) => {
  const actual = await orig<typeof import("@/lib/sdd")>()
  return {
    ...actual,
    loadSddPlans: (path: string) => Promise.resolve(planosPorPath[path] ?? []),
  }
})

import {
  adoptPlan,
  cardDecisions,
  foundDecisions,
  ignoredDecisions,
  pendingDecisions,
  scanDecisions,
} from "@/lib/inbox"
import { parseSddPlan, type SddPlan } from "@/lib/sdd"

// ── manifests REAIS (copiados do disco, sem edição) ────────────────────────
const MANIFEST_MFA = `{
  "$schema": "../../schemas/manifest.schema.json",
  "slug": "sdd-auth-05-mobile-mfa",
  "title": "F6 (parte) — Mobile Bearer/refresh + UI MFA TOTP",
  "sponsor": "vinicius",
  "branch": "feature/sdd-auth-05-mobile-mfa",
  "created_at": "2026-05-28T20:00:00Z",
  "merged_at": null,
  "stage": "prd",
  "stages_completed": ["init"],
  "blocked_by": ["sdd-auth-03-login-flows"],

  "artifacts": {
    "prd": { "path": "PRD.md", "approved": false, "approved_at": null, "approved_by": null },
    "spec": { "path": "SPEC.md", "approved_at": null, "sub_specs": [] },
    "migrations": [],
    "rpcs": [],
    "rls_policies": [],
    "edge_functions": [],
    "frontend_files": [],
    "api_routes": [],
    "i18n_keys": [],
    "tests": []
  },

  "promised_in_spec": {
    "scenario_matrix": [],
    "navigation_surfaces": [],
    "consistency_anchors": []
  },

  "verification": {
    "scenarios_validated": null,
    "all_nav_surfaces_updated": null,
    "consistency_check_passed": null,
    "i18n_keys_complete": null,
    "rls_audit_passed": null,
    "tests_passing": null,
    "build_passing": null,
    "type_check_passing": null
  },

  "links": {
    "pr_url": null,
    "merge_commit": null,
    "issue_url": null,
    "discussion_url": null
  }
}`

const MANIFEST_CLEANUP = `{
  "$schema": "../../schemas/manifest.schema.json",
  "slug": "sdd-auth-06-cleanup",
  "title": "F6 (final) — Deletar lib/auth.ts e JWT_SECRET legacy",
  "sponsor": "vinicius",
  "branch": "feature/sdd-auth-06-cleanup",
  "created_at": "2026-05-28T20:00:00Z",
  "merged_at": null,
  "stage": "prd",
  "stages_completed": ["init"],
  "blocked_by": ["sdd-auth-03-login-flows", "sdd-auth-04-rls-funcional", "sdd-auth-05-mobile-mfa"],

  "artifacts": {
    "prd": { "path": "PRD.md", "approved": false, "approved_at": null, "approved_by": null },
    "spec": { "path": "SPEC.md", "approved_at": null, "sub_specs": [] },
    "migrations": [],
    "rpcs": [],
    "rls_policies": [],
    "edge_functions": [],
    "frontend_files": [],
    "api_routes": [],
    "i18n_keys": [],
    "tests": []
  },

  "promised_in_spec": {
    "scenario_matrix": [],
    "navigation_surfaces": [],
    "consistency_anchors": []
  },

  "verification": {
    "scenarios_validated": null,
    "all_nav_surfaces_updated": null,
    "consistency_check_passed": null,
    "i18n_keys_complete": null,
    "rls_audit_passed": null,
    "tests_passing": null,
    "build_passing": null,
    "type_check_passing": null
  },

  "links": {
    "pr_url": null,
    "merge_commit": null,
    "issue_url": null,
    "discussion_url": null
  }
}`

// real, com stage/merged_at do snapshot pré-merge (ver cabeçalho)
const MANIFEST_PR = `{
  "$schema": "../schemas/plan-manifest.schema.json",
  "slug": "prospector-crm-import",
  "title": "Importação extensível e segura de Leads do Prime Prospector",
  "sponsor": "Vinicius Machado",
  "branch": "feature/prospector-crm-import",
  "created_at": "2026-07-14T18:34:43Z",
  "stage": "pr",
  "stages_completed": [
    "discovery",
    "prd",
    "spec",
    "implementation",
    "test",
    "review"
  ],
  "merged_at": null,
  "artifacts": {
    "prd": {
      "path": "PRD.md",
      "approved": true,
      "approved_at": "2026-07-14T18:34:43Z"
    },
    "spec": {
      "path": "SPEC.md",
      "approved_at": "2026-07-14T18:34:43Z"
    },
    "migrations": [
      "supabase/migrations/20260714181137_prospector_crm_import.sql"
    ],
    "frontend_files": [
      "src/features/client/components/ClientImportExcel.tsx",
      "src/features/client/hooks/useClientImportExcel.ts",
      "src/integrations/supabase/types.ts"
    ],
    "edge_functions": [
      "supabase/functions/import-clients-excel/index.ts",
      "supabase/functions/_shared/client-import.ts",
      "supabase/functions/_shared/cors.ts"
    ],
    "tests": [
      "supabase/functions/_shared/__tests__/client-import.test.ts",
      "src/features/client/components/ClientImportExcel.test.tsx",
      "supabase/tests/rpc/import_prospector_lead.test.sql"
    ]
  },
  "promised_in_spec": {
    "scenario_matrix": [
      {
        "persona": "administrador",
        "input": "CNPJ novo válido",
        "ui": [
          "Resumo mostra um Lead criado"
        ],
        "backend": "Lead criado no pipeline e estágio iniciais"
      },
      {
        "persona": "administrador",
        "input": "Mesmo CNPJ com ou sem máscara",
        "ui": [
          "Resumo mostra registro já existente"
        ],
        "backend": "Concilia sem duplicar"
      },
      {
        "persona": "administrador",
        "input": "CNPJ com DV inválido",
        "ui": [
          "Linha aparece como erro"
        ],
        "backend": "Nenhum dado persiste"
      },
      {
        "persona": "administrador",
        "input": "Reimportação com telefone e Instagram divergentes",
        "ui": [
          "Avisos aparecem nos detalhes"
        ],
        "backend": "Dados curados e contatos são preservados"
      },
      {
        "persona": "administrador",
        "input": "Origem e Instagram para campos vazios",
        "ui": [
          "Linha processada"
        ],
        "backend": "clients.origem e clients.social_media.instagram preenchidos"
      },
      {
        "persona": "administrador",
        "input": "Endereço sem localidade válida",
        "ui": [
          "Aviso de endereço ignorado"
        ],
        "backend": "Nenhum endereço parcial é criado"
      },
      {
        "persona": "administrador",
        "input": "Payload inválido durante criação",
        "ui": [
          "Linha aparece como erro"
        ],
        "backend": "Transação da linha é revertida"
      },
      {
        "persona": "usuário sem permissão",
        "input": "Tenta importar ou chamar RPC",
        "ui": [
          "Acesso negado"
        ],
        "backend": "Edge bloqueia e RPC não concede EXECUTE"
      }
    ],
    "navigation_surfaces": [
      "src/features/client/components/ClientImportExcel.tsx"
    ],
    "consistency_anchors": [
      {
        "category": "edge-auth",
        "canon_file": "src/shared/lib/edgeFunctions.ts",
        "reference_doc": ".claude/skills/prime-domain/SKILL.md"
      },
      {
        "category": "lead-pipeline",
        "canon_file": "supabase/migrations/20260714181137_prospector_crm_import.sql",
        "reference_doc": ".claude/skills/prime-domain/references/schema-gotchas.md"
      }
    ]
  },
  "verification": {
    "scenarios_validated": false,
    "all_nav_surfaces_updated": true,
    "consistency_check_passed": true,
    "tests_passing": true,
    "build_passing": true,
    "type_check_passing": true,
    "lint_passing": true
  },
  "links": {
    "pr_url": "https://github.com/primeinternacionaltech/prime-sales-hub/pull/543",
    "issue_url": null,
    "discussion_url": null,
    "merge_commit": "1564272758fee1d6cd9a466bc7fe9e2e61fd51fc"
  }
}`

const planosPorPath: Record<string, SddPlan[]> = {}

function projeto(id: string, name: string, path: string): Project {
  return {
    id,
    name,
    path,
    createdAt: 1,
    hasClaudeMd: false,
    hasAgentsMd: false,
    status: "idle",
  }
}

const ingresso = projeto("p-ingresso", "meuingresso3.0", "/Users/vm/meuingresso3.0")
const prime = projeto("p-prime", "prime-sales-hub", "/Users/vm/prime-sales-hub")

beforeEach(() => {
  marks = []
  marksThrows = false
  driven = []
  drivenThrows = false
  adoptFailures = 0
  adoptCalls = 0
  fusionPendentes = []
  propostas = []
  for (const k of Object.keys(planosPorPath)) delete planosPorPath[k]
  planosPorPath[ingresso.path] = [
    parseSddPlan("sdd-auth-05-mobile-mfa", MANIFEST_MFA),
    parseSddPlan("sdd-auth-06-cleanup", MANIFEST_CLEANUP),
  ]
})

describe("scanDecisions — gate de SDD só DESCOBERTO no disco", () => {
  it("os dois PRDs de maio aparecem na lista, mas ficam FORA do badge", async () => {
    const ds = await scanDecisions([ingresso])
    expect(ds).toHaveLength(2)
    expect(pendingDecisions(ds)).toHaveLength(0) // o badge do sino
    expect(foundDecisions(ds)).toHaveLength(2) // "Encontrados no projeto"
  })

  it("o item carrega origem e idade: .claude/plans/<slug> + created_at de maio", async () => {
    const [d] = await scanDecisions([ingresso])
    if (d.kind !== "prd") throw new Error("kind errado")
    expect(d.origin.path).toBe(".claude/plans/sdd-auth-05-mobile-mfa")
    expect(d.origin.discovered).toBe(true)
    expect(d.createdAt).toBe("2026-05-28T20:00:00Z")
    expect(d.planTitle).toBe("F6 (parte) — Mobile Bearer/refresh + UI MFA TOTP")
  })

  it("PR aberto que o app achou no disco também não conta no badge", async () => {
    planosPorPath[prime.path] = [parseSddPlan("prospector-crm-import", MANIFEST_PR)]
    const ds = await scanDecisions([prime])
    expect(ds).toHaveLength(1)
    expect(ds[0].kind).toBe("pr")
    expect(pendingDecisions(ds)).toHaveLength(0)
    const [d] = foundDecisions(ds)
    if (d.kind !== "pr") throw new Error("kind errado")
    expect(d.origin.path).toBe(".claude/plans/prospector-crm-import")
    expect(d.createdAt).toBe("2026-07-14T18:34:43Z")
  })
})

describe("scanDecisions — adoção (gesto humano PELO APP)", () => {
  it("plano adotado volta a contar como pendência, o outro segue descoberto", async () => {
    marks = [
      {
        projectId: ingresso.id,
        slug: "sdd-auth-05-mobile-mfa",
        adoptedAt: 1_770_000_000_000,
        ignoredAt: null,
      },
    ]
    const ds = await scanDecisions([ingresso])
    const pend = pendingDecisions(ds)
    expect(pend).toHaveLength(1)
    expect(pend[0].kind === "prd" && pend[0].slug).toBe("sdd-auth-05-mobile-mfa")
    expect(foundDecisions(ds)).toHaveLength(1)
  })

  it("a adoção é PERSISTIDA: vale mesmo com a interação em outra sessão", async () => {
    // nada em memória, só a marca no banco — é o que uma sessão anterior deixou.
    marks = [
      {
        projectId: ingresso.id,
        slug: "sdd-auth-06-cleanup",
        adoptedAt: 1,
        ignoredAt: null,
      },
    ]
    const pend = pendingDecisions(await scanDecisions([ingresso]))
    expect(pend.map((d) => (d.kind === "prd" ? d.slug : ""))).toEqual([
      "sdd-auth-06-cleanup",
    ])
  })

  it("marca de OUTRO projeto não adota o plano de mesmo slug daqui", async () => {
    marks = [
      {
        projectId: "outro-projeto",
        slug: "sdd-auth-05-mobile-mfa",
        adoptedAt: 1,
        ignoredAt: null,
      },
    ]
    expect(pendingDecisions(await scanDecisions([ingresso]))).toHaveLength(0)
  })
})

describe("scanDecisions — adoção derivada de stage_runs (prova documental)", () => {
  it("etapa dirigida pelo cockpit adota o plano MESMO sem marca gravada", async () => {
    // o cenário da auditoria: o gesto aconteceu, a marca não gravou.
    marks = []
    driven = [{ projectId: ingresso.id, slug: "sdd-auth-05-mobile-mfa" }]
    const ds = await scanDecisions([ingresso])
    const pend = pendingDecisions(ds)
    expect(pend.map((d) => (d.kind === "prd" ? d.slug : ""))).toEqual([
      "sdd-auth-05-mobile-mfa",
    ])
    expect(foundDecisions(ds).map((d) => (d.kind === "prd" ? d.slug : ""))).toEqual([
      "sdd-auth-06-cleanup",
    ])
  })

  it("retroativo: plano dirigido ANTES desta regra não é rebaixado a descoberto", async () => {
    // banco antigo: nenhuma linha em sdd_plan_marks, só o histórico de runs.
    marks = []
    driven = [
      { projectId: ingresso.id, slug: "sdd-auth-05-mobile-mfa" },
      { projectId: ingresso.id, slug: "sdd-auth-06-cleanup" },
    ]
    expect(pendingDecisions(await scanDecisions([ingresso]))).toHaveLength(2)
  })

  it("etapa dirigida em OUTRO projeto com o mesmo slug não adota o plano daqui", async () => {
    driven = [{ projectId: "outro-projeto", slug: "sdd-auth-05-mobile-mfa" }]
    expect(pendingDecisions(await scanDecisions([ingresso]))).toHaveLength(0)
  })

  it("ignorar vence a adoção derivada (o gesto explícito manda)", async () => {
    driven = [{ projectId: ingresso.id, slug: "sdd-auth-05-mobile-mfa" }]
    marks = [
      {
        projectId: ingresso.id,
        slug: "sdd-auth-05-mobile-mfa",
        adoptedAt: null,
        ignoredAt: 1_770_000_000_000,
      },
    ]
    const ds = await scanDecisions([ingresso], { includeIgnored: true })
    expect(pendingDecisions(ds)).toHaveLength(0)
    expect(ignoredDecisions(ds)).toHaveLength(1)
  })

  it("falha ao ler as etapas dirigidas também é fail-open (conta tudo)", async () => {
    drivenThrows = true
    const ds = await scanDecisions([ingresso])
    expect(pendingDecisions(ds)).toHaveLength(2)
    expect(foundDecisions(ds)).toHaveLength(0)
  })
})

describe("adoptPlan — a escrita não desiste na primeira", () => {
  const semEspera = () => Promise.resolve()

  it("banco travado numa tentativa: a seguinte grava e a adoção vale", async () => {
    adoptFailures = 1
    expect(await adoptPlan(ingresso.id, "sdd-auth-05-mobile-mfa", semEspera)).toBe(
      true,
    )
    expect(adoptCalls).toBe(2)
  })

  it("travado em todas: devolve false (o chamador avisa, não finge que gravou)", async () => {
    adoptFailures = 99
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    expect(await adoptPlan(ingresso.id, "sdd-auth-05-mobile-mfa", semEspera)).toBe(
      false,
    )
    expect(adoptCalls).toBe(3) // 1 + 2 retries
    expect(warn).toHaveBeenCalled() // ADR-017: nada de catch silencioso
    warn.mockRestore()
  })
})

describe("scanDecisions — ignorar plano", () => {
  it("plano ignorado some da varredura normal", async () => {
    marks = [
      {
        projectId: ingresso.id,
        slug: "sdd-auth-05-mobile-mfa",
        adoptedAt: null,
        ignoredAt: 1_770_000_000_000,
      },
    ]
    const ds = await scanDecisions([ingresso])
    expect(ds).toHaveLength(1)
    expect(foundDecisions(ds).map((d) => (d.kind === "prd" ? d.slug : ""))).toEqual([
      "sdd-auth-06-cleanup",
    ])
  })

  it("com includeIgnored ele volta, separado, pra ação de desfazer", async () => {
    marks = [
      {
        projectId: ingresso.id,
        slug: "sdd-auth-05-mobile-mfa",
        adoptedAt: null,
        ignoredAt: 1_770_000_000_000,
      },
    ]
    const ds = await scanDecisions([ingresso], { includeIgnored: true })
    expect(ds).toHaveLength(2)
    expect(pendingDecisions(ds)).toHaveLength(0)
    expect(foundDecisions(ds)).toHaveLength(1) // o ignorado não polui os achados
    const ign = ignoredDecisions(ds)
    expect(ign).toHaveLength(1)
    expect(ign[0].kind === "prd" && ign[0].slug).toBe("sdd-auth-05-mobile-mfa")
  })

  it("plano adotado E ignorado continua fora do badge (o ignorar manda)", async () => {
    marks = [
      {
        projectId: ingresso.id,
        slug: "sdd-auth-05-mobile-mfa",
        adoptedAt: 1,
        ignoredAt: 2,
      },
    ]
    const ds = await scanDecisions([ingresso], { includeIgnored: true })
    expect(pendingDecisions(ds)).toHaveLength(0)
    expect(ignoredDecisions(ds)).toHaveLength(1)
    // o outro plano (sem marca nenhuma) segue como achado, não como pendência
    expect(foundDecisions(ds).map((d) => (d.kind === "prd" ? d.slug : ""))).toEqual([
      "sdd-auth-06-cleanup",
    ])
  })
})

describe("scanDecisions — fail-open na leitura das marcas", () => {
  it("erro ao ler a tabela conta TUDO (nunca esconde pendência real)", async () => {
    marksThrows = true
    const ds = await scanDecisions([ingresso])
    expect(pendingDecisions(ds)).toHaveLength(2)
    expect(foundDecisions(ds)).toHaveLength(0)
  })

  it("sem banco (fora do Tauri) também conta tudo", async () => {
    marks = null
    const ds = await scanDecisions([ingresso])
    expect(pendingDecisions(ds)).toHaveLength(2)
  })
})

describe("scanDecisions — o que NASCEU no app não muda", () => {
  it("disputa do fusion e proposta do lead seguem contando no badge", async () => {
    fusionPendentes = [
      { convId: "c1", projectId: ingresso.id, title: "quem escreve melhor" },
    ]
    propostas = [
      { id: "prop-1", projectId: ingresso.id, body: "1. Priorize o card A", createdAt: 5 },
    ]
    const ds = await scanDecisions([ingresso])
    const pend = pendingDecisions(ds)
    expect(pend).toHaveLength(2)
    expect(pend.map((d) => d.kind).sort()).toEqual(["fusion", "proposal"])
    // e os dois PRDs de maio continuam fora do alarme
    expect(foundDecisions(ds)).toHaveLength(2)
  })

  it("card do board em revisão conta no badge (não tem origem de disco)", () => {
    const ds = cardDecisions(
      [
        {
          id: "c1",
          projectId: ingresso.id,
          title: "revisar o import",
          body: null,
          state: "review",
          assigneeAgent: null,
          conversationId: null,
          owner: null,
          pinned: false,
          pinRank: null,
          createdAt: 1,
          updatedAt: 1,
          archivedAt: null,
        },
      ],
      [ingresso],
    )
    expect(pendingDecisions(ds)).toHaveLength(1)
    expect(foundDecisions(ds)).toHaveLength(0)
  })
})
