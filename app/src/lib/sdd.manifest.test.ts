// Parse dos manifests REAIS do disco (ADR-016: fixture inventada esconde bug).
//
// O caso que motivou este arquivo: `checkout-architecture-longterm`, do
// meuingresso3.0, tem `"stage": "PRD"` em CAIXA ALTA e `artifacts.prd` como
// STRING (caminho), não objeto. Antes do lowercase no normStage, o "PRD" nunca
// batia com o pipeline (todo comparador usa minúscula): o plano ficava fora do
// trilho da UI e INADOTÁVEL — nunca listado como gate no inbox, nem como
// descoberto. O manifest abaixo é o do disco, sem uma vírgula de edição.

import { describe, expect, it } from "vitest"
import { parseSddPlan, stageIndex } from "./sdd"

const MANIFEST_CAIXA_ALTA = String.raw`
{
  "slug": "checkout-architecture-longterm",
  "title": "Arquitetura do Checkout (long-term, escala Madonna 100k)",
  "sponsor": "Vinicius (engenharia / produto)",
  "created_at": "2026-05-29",
  "stage": "PRD",
  "stages_completed": ["investigation", "PRD"],
  "stages_pending": ["SPEC", "implementation", "tests", "review", "release"],
  "constraints": {
    "ui_frozen": "Layout aprovado é intocável. Toda mudança é em rotas, contratos de API, RPC, migrations, jobs e infra.",
    "platform": "Vercel (Next.js 14 App Router) + Supabase (Postgres + Auth + Storage + Realtime + pg_cron)",
    "pre_launch": true,
    "performance_p0": "2s percebido = desistência"
  },
  "artifacts": {
    "prd": ".claude/plans/checkout-architecture-longterm/PRD.md",
    "spec": null,
    "spec_dba": null,
    "spec_dev_edge": null,
    "spec_dev_next": null,
    "spec_dev_frontend": null,
    "spec_tester": null,
    "migrations": [],
    "rpcs": [],
    "edge_functions": [],
    "rls_policies": []
  },
  "promised_in_spec": {
    "migrations": [
      "20260530120000_order_status_enum_expand",
      "20260530120100_order_items_snapshot_columns",
      "20260530120200_payment_intents",
      "20260530120300_payment_webhook_log",
      "20260530120400_seat_holds_unique",
      "20260530120500_idempotency_records",
      "20260530120600_rate_limit_buckets",
      "20260530120700_waiting_room_buckets",
      "20260530120800_events_realtime_stock_mv",
      "20260530120900_rpc_seat_hold_atomic",
      "20260530121000_rpc_order_reserve",
      "20260530121100_rpc_order_confirm",
      "20260530121200_rpc_order_expire_pending",
      "20260530121300_rpc_order_refund",
      "20260530121400_rpc_order_force_cancel",
      "20260530121500_rpc_payment_reconcile_one",
      "20260530121600_cron_jobs",
      "20260530121700_rls_payment_intents",
      "20260530121800_deprecate_orders_post_route",
      "20260530121900_events_log_partitioning"
    ],
    "rpcs": [
      "public.seat_hold_atomic(uuid[], text, int)",
      "public.seat_hold_renew(uuid[], text)",
      "public.seat_hold_release_atomic(uuid[], text)",
      "public.order_reserve(jsonb, text)",
      "public.order_confirm(uuid, text, jsonb)",
      "public.order_reject(uuid, text)",
      "public.order_expire_pending()",
      "public.order_refund(uuid, text)",
      "public.order_force_cancel(uuid, uuid, text)",
      "public.payment_reconcile_one(uuid)",
      "public.idempotency_get_or_insert(text, text, jsonb)",
      "public.rate_limit_consume(text, int, numeric)",
      "public.waiting_room_join(uuid)",
      "public.waiting_room_grant(uuid, int)",
      "public.waiting_room_release(uuid)"
    ],
    "edge_functions": [
      "supabase/functions/checkout-reserve/index.ts",
      "supabase/functions/checkout-confirm/index.ts",
      "supabase/functions/seat-hold-atomic/index.ts",
      "supabase/functions/seat-hold-release/index.ts",
      "supabase/functions/coupons-validate/index.ts"
    ],
    "next_routes_new": [
      "app/api/v1/webhooks/mercadopago/route.ts (POST, runtime nodejs, sem middleware auth)",
      "app/api/v1/webhooks/mercadopago/dlq/replay/route.ts (POST, admin)",
      "app/api/v1/orders/[id]/status/route.ts (GET, polling)"
    ],
    "next_routes_deprecated": [
      "POST /api/v1/orders -> 410 Gone (X-Deprecated-Use-Edge-Function: checkout-reserve)",
      "POST /api/v1/seat-maps/[id]/hold -> Edge Function seat-hold-atomic",
      "DELETE /api/v1/seat-maps/[id]/hold -> Edge Function seat-hold-release",
      "POST /api/v1/coupons/validate -> Edge Function coupons-validate",
      "POST /api/v1/upload/receipt -> deprecated (PSP nativo)"
    ],
    "frontend_pages_new_no_ui_change": [
      "app/checkout/[slug]/aguardando/page.tsx (componentes do design system existentes)",
      "app/checkout/[slug]/queue/page.tsx (modal padrão shadcn)",
      "app/admin/integrations/mercadopago/page.tsx (cards padrão admin)"
    ],
    "i18n_keys": [
      "checkout.queue.title",
      "checkout.queue.position",
      "checkout.queue.estimatedWait",
      "checkout.reserve.expired",
      "checkout.payment.awaiting",
      "checkout.payment.confirmed",
      "checkout.payment.rejected",
      "checkout.payment.expired",
      "errors.seatTaken",
      "errors.couponExhausted",
      "errors.rateLimited"
    ],
    "scenario_matrix_lines": 18,
    "consistency_anchors": [
      ".claude/agents/references/architect/api-vs-edge.md:49-105 (Edge Function shape)",
      "supabase/migrations/20260529150000_rls_funcional_auth_uid.sql:77-95 (RPC SECURITY DEFINER + search_path)",
      ".claude/agents/references/architect/api-vs-edge.md:184-199 (idempotency + rate-limit)",
      "skills/meuingresso-domain mandamento 2 (snapshot de preço em order_items)",
      "skills/mercado-pago (HMAC verification + idempotency + reversão de cupom)"
    ],
    "navigation_surfaces": [
      "middleware.ts: skip auth para /api/v1/webhooks/mercadopago",
      "middleware.ts: matcher publico /checkout/:slug/queue",
      "docs/manual/index.js sec13 — adicionar subseção 'Estados do pedido' + 'Webhooks de pagamento'",
      "lib/admin-permissions.ts: can_manage_payment_webhooks"
    ]
  },
  "decisions_open": [
    "Waiting Room storage: Postgres vs Vercel KV vs Upstash",
    "Modelo A (reserve baixa estoque) vs B (so paid)",
    "Janela hold/expires_at: 10min ou 7min em show grande",
    "'chargedback' enum novo vs reusar 'refunded'",
    "PSP_RETURN_WINDOW_DAYS para withdrawal de promotor",
    "Strategy migracao: feature flag gradual vs cutover",
    "'pending' significa pre-PSP attempt, 'reserved' significa preference criada — ok?",
    "Refund automatico em pedido expirado com webhook tardio",
    "buyer_email -> user_id confirmacao obrigatoria",
    "coupons.used_count incrementa em reserved ou paid",
    "Idempotency-Key opcional ou obrigatorio",
    "Webhook MP retry behavior",
    "Cron interval 1min — aceita custo",
    "Refund > R$ 500 aprovacao dupla",
    "CAPI Meta dispara em paid (confirmar)"
  ],
  "risks_critical_p0": [
    "TOCTOU em quantity_sold causa oversell visivel sob carga",
    "seat_holds sem UNIQUE permite hold duplo",
    "Webhook MP duplicado sem idempotency duplica venda",
    "Sem rate-limit em coupons/validate permite DoS",
    "Crash no meio dos 12 steps deixa estado parcial irrecuperavel"
  ],
  "hand_off_next": "architect (gera SPEC) -> dba + dev em paralelo apos SPEC aprovado"
}
`

describe("parseSddPlan — manifest real com stage em CAIXA ALTA", () => {
  const plan = parseSddPlan("checkout-architecture-longterm", MANIFEST_CAIXA_ALTA)

  it("normaliza a caixa do stage: PRD vira prd e entra no pipeline", () => {
    expect(plan.stageRaw).toBe("PRD") // o cru continua honesto
    expect(plan.stage).toBe("prd")
    expect(stageIndex(plan.stage)).toBeGreaterThanOrEqual(0)
  })

  it("normaliza a caixa também nas etapas concluídas", () => {
    expect(plan.stagesCompleted).toEqual(["investigation", "prd"])
  })

  it("com o stage normalizado, o plano vira um gate de PRD por aprovar", () => {
    // é exatamente a condição do scanDecisions (kind "prd"): sem o lowercase,
    // este plano jamais aparecia no inbox, nem como descoberto.
    expect(plan.stage === "prd" && !!plan.artifacts.prd && !plan.artifacts.prd.approved).toBe(
      true,
    )
  })

  it("artifacts.prd STRING não quebra o normalize e cai no PRD.md relativo", () => {
    // No dado real esta chave é uma string com o caminho a partir da RAIZ do
    // repo (".claude/plans/<slug>/PRD.md"); o normalize não a entende como
    // objeto e usa o default "PRD.md". Isso é o certo por acidente feliz: a UI
    // resolve o caminho como <projeto>/.claude/plans/<slug>/<path>, então usar
    // a string daria um caminho duplicado. Fica registrado no ADR-032.
    expect(plan.artifacts.prd).toEqual({
      path: "PRD.md",
      approved: false,
      approvedAt: null,
    })
  })

  it("o resto do manifest heterogêneo passa sem exceção (parse tolerante)", () => {
    expect(plan.hasManifest).toBe(true)
    expect(plan.title).toBe("Arquitetura do Checkout (long-term, escala Madonna 100k)")
    expect(plan.createdAt).toBe("2026-05-29")
    // promised_in_spec.scenario_matrix nem existe aqui (o manifest traz
    // "scenario_matrix_lines": 18, um INT) → matriz vazia, sem crash.
    expect(plan.scenarioMatrix).toEqual([])
    // consistency_anchors são STRINGS neste manifest (o schema pede objeto):
    // viram âncoras vazias em vez de derrubar a view.
    expect(plan.consistencyAnchors).toHaveLength(5)
    expect(plan.consistencyAnchors[0]).toEqual({
      category: "",
      canon_file: "",
      reference_doc: "",
    })
    expect(plan.verification).toEqual({})
    expect(plan.links).toEqual({})
  })
})

describe("parseSddPlan — alias de stage é case-insensitive", () => {
  it("Developer/TEST-SUITE/Code-Review caem no mesmo trilho dos minúsculos", () => {
    expect(parseSddPlan("x", `{"stage":"Developer"}`).stage).toBe("implementation")
    expect(parseSddPlan("x", `{"stage":"TEST-SUITE"}`).stage).toBe("test")
    expect(parseSddPlan("x", `{"stage":"Code-Review"}`).stage).toBe("review")
  })

  it("stage desconhecido continua devolvido (em minúscula), nunca inventado", () => {
    // "implemented" existe no disco (checkout-cartao-sdk) e não é do pipeline:
    // segue como está, sem virar outra etapa por adivinhação.
    expect(parseSddPlan("x", `{"stage":"Implemented"}`).stage).toBe("implemented")
    expect(stageIndex("implemented")).toBe(-1)
  })
})
