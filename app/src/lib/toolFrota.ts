// As tools dos MCPs da PRÓPRIA Frota, com nome humano no fio (ADR-241).
//
// Até 23/09/2026 elas caíam no balde genérico "Executar ferramenta": numa
// sessão real, 85 chamadas de `work_update`, `work_plan` e `ask_user` viraram
// quatro linhas iguais, e o nome de verdade ficava num `meta` que o grupo de
// uma ação só nem mostra. O app não reconhecia o próprio contrato.
//
// Casa pelo NOME DA TOOL, que é contrato nosso (o servidor MCP é da Frota):
// cada motor prefixa do seu jeito (`mcp__frota-work__work_update` no Claude,
// `work_update` puro no Codex), então o que conta é o último segmento. Nada
// aqui compara nome de motor.

import type { ToolView } from "@/lib/toolview"
import { PERSONALIZADO, nomeDoTamanho } from "@/lib/tamanhoDaPagina"

function str(i: Record<string, unknown>, k: string): string | null {
  const v = i[k]
  return typeof v === "string" && v.trim() ? v.trim() : null
}

/** `mcp__servidor__tool` → `tool`; nome puro fica como está. */
export function nomeDaTool(name: string): string {
  const partes = name.split("__")
  return partes.length >= 3 && partes[0] === "mcp" ? partes.slice(2).join("__") : name
}

function view(
  verb: string,
  objeto: string | null,
  category: ToolView["category"],
  detail: string | null,
): ToolView {
  return {
    kind: "generic",
    label: objeto ? `${verb}: ${objeto}` : verb,
    verb,
    object: objeto ? { kind: "text", text: objeto } : null,
    narration: null,
    category,
    emphasis: "quiet",
    meta: null,
    detail,
  }
}

const ESTADO_DA_ETAPA: Record<string, string> = {
  completed: "Concluir etapa",
  in_progress: "Começar etapa",
  pending: "Reabrir etapa",
}

/** ToolView de uma tool da Frota, ou null quando o nome não é nosso. */
export function presentFrotaTool(
  name: string,
  i: Record<string, unknown>,
  detail: string | null,
): ToolView | null {
  switch (nomeDaTool(name)) {
    case "work_plan": {
      const n = Array.isArray(i.tasks) ? i.tasks.length : 0
      return view("Publicar o plano", n ? `${n} ${n === 1 ? "etapa" : "etapas"}` : null, "coordinate", detail)
    }
    case "work_update": {
      const status = str(i, "status") ?? ""
      return view(ESTADO_DA_ETAPA[status] ?? "Atualizar etapa", str(i, "title") ?? str(i, "id"), "coordinate", detail)
    }
    case "ask_user": {
      const qs = Array.isArray(i.questions) ? (i.questions as Record<string, unknown>[]) : []
      const primeira = qs[0] ? str(qs[0], "question") ?? str(qs[0], "header") : null
      return view("Perguntar a você", primeira, "coordinate", detail)
    }
    case "conversation_title":
      return view("Dar título à conversa", str(i, "title"), "coordinate", detail)
    case "approval_prompt":
      return view("Pedir aprovação", str(i, "tool_name"), "coordinate", detail)
    case "process_start":
      return view("Iniciar processo", str(i, "label") ?? str(i, "command"), "execute", detail)
    case "process_poll":
      return view("Consultar processo", str(i, "process_id"), "inspect", detail)
    case "process_stop":
      return view("Parar processo", str(i, "process_id"), "execute", detail)
    case "context_manifest":
      return view("Ler o índice da memória", null, "inspect", detail)
    case "context_search":
      return view("Buscar na memória", str(i, "query"), "inspect", detail)
    case "context_read":
      return view("Ler a memória", str(i, "ref"), "inspect", detail)
    // frota-desktop: nomes só nossos, casam puros também.
    case "desktop_status":
      return view("Ver o estado da tela", null, "inspect", detail)
    case "desktop_capture":
      return view("Capturar a tela", null, "inspect", detail)
    case "desktop_click":
      return view("Clicar na tela", null, "execute", detail)
    case "desktop_type":
      return view("Digitar na tela", str(i, "text"), "execute", detail)
    case "desktop_key":
      return view("Apertar tecla", str(i, "key"), "execute", detail)
    case "desktop_move":
    case "desktop_drag":
      return view("Mover o ponteiro", null, "execute", detail)
    default:
      return servidorDaTool(name) === "frota-browser" ? presentNavegadorDaFrota(nomeDaTool(name), i, detail) : null
  }
}

/** `mcp__frota-browser__browser_snapshot` → `frota-browser`. Nome puro não tem
 *  servidor: `browser_*` solto é ambíguo com as tools nativas de navegador de
 *  outros motores (`toolview.ts`), então o navegador da Frota só é reconhecido
 *  com o prefixo. */
function servidorDaTool(name: string): string | null {
  const partes = name.split("__")
  return partes.length >= 3 && partes[0] === "mcp" ? partes[1] : null
}

/** "Celular", "Tablet · girado", "Personalizado 1024×768". */
function tamanhoPedido(i: Record<string, unknown>): string | null {
  const preset = str(i, "tamanho")
  if (!preset) return null
  const base =
    preset === PERSONALIZADO
      ? `Personalizado ${Number(i.largura) || "?"}×${Number(i.altura) || "?"}`
      : nomeDoTamanho({ preset, largura: 0, altura: 0, celular: false, girado: false })
  return i.girado === true ? `${base} · girado` : base
}

function presentNavegadorDaFrota(
  tool: string,
  i: Record<string, unknown>,
  detail: string | null,
): ToolView {
  switch (tool) {
    case "browser_navigate":
      return view("Abrir no navegador", str(i, "url")?.replace(/^https?:\/\//, "") ?? null, "web", detail)
    case "browser_snapshot":
      return view("Ler a página", null, "web", detail)
    case "browser_capture":
      return view("Capturar a página", null, "web", detail)
    case "browser_evaluate":
      return view("Rodar script na página", null, "web", detail)
    case "browser_upload":
      return view("Enviar arquivo à página", null, "web", detail)
    case "browser_click":
      return view("Clicar na página", null, "web", detail)
    case "browser_type":
      return view("Digitar na página", null, "web", detail)
    case "browser_resize":
      return view("Mudar o tamanho da página", tamanhoPedido(i), "web", detail)
    default:
      return view("Usar o navegador", tool, "web", detail)
  }
}
