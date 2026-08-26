// Listas CURADAS de modelo e effort por motor, e os remaps de valor legado.
//
// Saiu de `agents.ts` (que ficou grande demais pra guarda de tamanho) e o corte
// é o natural: `agents.ts` é o REGISTRY (identidade + espelho das capabilities
// do Rust); aqui é o CATÁLOGO CURADO — o conhecimento escrito à mão sobre o que
// cada CLI aceita hoje. É exatamente este arquivo que o model-autonomy-plan
// quer encolher: M1 (`lib/modelList.ts`) já pergunta ao CLI o que existe e M2
// (`lib/modelSmoke.ts`) testa o que funciona. Enquanto a derivação não cobre
// tudo, a curadoria mora aqui, sozinha e visível.
//
// Não importa de `agents.ts` de propósito: a dependência é só num sentido
// (registry → catálogo), sem ciclo.

export interface AgentModelOption {
  value: string
  label: string
  /** Rótulo compacto exibido só no trigger (ver RichOption.pill). */
  pill?: string
  /** Linha secundária no seletor rico (padrão blocks.so ai-02). */
  description?: string
}

// Aliases do Claude Code ("opus", "sonnet"…) resolvem NO SERVIDOR e mudam com
// versão do CLI/provider/entitlements — `opus` já resolveu p/ 4.7, depois 4.8,
// e desde o claude 2.1.219 (24/jul/2026) → **Opus 5** (novo default Opus). Pin
// confiável = ID COMPLETO. 1M de contexto é DEFAULT no Opus 5/4.8, Sonnet 5 e
// Fable 5 (sem beta header, preço padrão); o sufixo "[1m]" segue aceito e faz o
// init reportar "…[1m]", que o contextWindowFor usa pro anel mostrar 1M — por
// isso os pins abaixo carregam o sufixo.
export const CLAUDE_MODELS: AgentModelOption[] = [
  { value: "default", label: "Padrão", pill: "modelo", description: "Deixa o Claude Code escolher" },
  { value: "claude-opus-5[1m]", label: "Opus 5", description: "Pin exato · o Opus mais novo, 1M nativo ($5/$25)" },
  { value: "claude-sonnet-5[1m]", label: "Sonnet 5", description: "Pin exato · 1M nativo, rápido e equilibrado" },
  { value: "fable", label: "Fable", description: "Topo de linha (Fable 5, ~2x o preço do Opus)" },
  { value: "claude-opus-4-8[1m]", label: "Opus 4.8", description: "Pin da geração anterior (1M nativo)" },
  { value: "opus", label: "Opus (alias)", description: "O CLI decide a versão (hoje → Opus 5), pode divergir" },
  { value: "sonnet", label: "Sonnet (alias)", description: "O CLI decide a versão, pode divergir" },
  { value: "haiku", label: "Haiku", description: "Mais rápido e barato (200k)" },
]
// Codex: sem família "-codex" desde o 5.4 (gpt-5.5-codex/5.6-codex NÃO existem);
// `gpt-5.6` puro é ID de API (rejeitado com auth ChatGPT) — os slugs do CLI são
// sol/terra/luna. Catálogo enumerável via `codex debug models` (JSON). Contexto
// DENTRO do Codex = 272k (na API os mesmos modelos têm 1M). gpt-5.3-codex e o3
// saíram do catálogo (400 com auth ChatGPT) — removidos do picker.
export const CODEX_MODELS: AgentModelOption[] = [
  { value: "default", label: "Padrão", pill: "modelo", description: "Deixa o Codex escolher (hoje Sol)" },
  { value: "gpt-5.6-sol", label: "Sol (5.6)", description: "Frontier da família 5.6 · o mais capaz" },
  { value: "gpt-5.6-terra", label: "Terra (5.6)", description: "Equilíbrio qualidade/custo da 5.6" },
  { value: "gpt-5.6-luna", label: "Luna (5.6)", description: "Leve e rápido, alto volume" },
  { value: "gpt-5.5", label: "gpt-5.5", description: "Geração anterior, ainda forte" },
  { value: "gpt-5.4", label: "gpt-5.4", description: "Equilibrado, metade do preço do 5.5" },
  { value: "gpt-5.4-mini", label: "gpt-5.4-mini", description: "Pequeno e rápido, alto volume" },
]
export const CLAUDE_EFFORTS: AgentModelOption[] = [
  { value: "default", label: "Padrão", pill: "effort", description: "Padrão do modelo" },
  { value: "low", label: "low", description: "Rápido, mais raso" },
  { value: "medium", label: "medium", description: "Equilíbrio" },
  { value: "high", label: "high", description: "Raciocina mais fundo" },
  { value: "xhigh", label: "xhigh", description: "Bem mais fundo" },
  { value: "max", label: "max", description: "Esforço máximo" },
]
// agy: o `value` É a string EXATA que o `agy --model` espera. Slugs só ficaram
// ESTÁVEIS na CLI 1.1.5 (release de 21/07/2026) — antes disso pinagem por nome
// era frágil por design. Lista completa espelha `agy models` 1.1.5 (11 slugs);
// o effort vem embutido no sufixo -high/-medium/-low, sem seletor separado. O
// default de fábrica não é contratual (o agy persiste o último modelo do picker
// no settings dele), então a descrição do "Padrão" não afirma qual modelo é.
export const AGY_MODELS: AgentModelOption[] = [
  { value: "default", label: "Padrão", pill: "modelo", description: "Deixa o agy escolher" },
  { value: "gemini-3.6-flash-high", label: "Flash 3.6 (High)", description: "Mais capaz (Google)" },
  { value: "gemini-3.6-flash-medium", label: "Flash 3.6 (Med)", description: "Equilíbrio (Google)" },
  { value: "gemini-3.6-flash-low", label: "Flash 3.6 (Low)", description: "Rápido e barato (Google)" },
  { value: "gemini-3.5-flash-high", label: "Flash 3.5 (High)", description: "Geração anterior, fundo (Google)" },
  { value: "gemini-3.5-flash-medium", label: "Flash 3.5 (Med)", description: "Geração anterior (Google)" },
  { value: "gemini-3.5-flash-low", label: "Flash 3.5 (Low)", description: "Geração anterior, leve (Google)" },
  { value: "gemini-3.1-pro-high", label: "Gemini Pro (High)", description: "Mais capaz (Google)" },
  { value: "gemini-3.1-pro-low", label: "Gemini Pro (Low)", description: "Pro raso, mais rápido (Google)" },
  { value: "claude-sonnet-4-6", label: "Sonnet", description: "Claude via cota Google" },
  { value: "claude-opus-4-6-thinking", label: "Opus", description: "Claude mais capaz, via Google" },
  { value: "gpt-oss-120b-medium", label: "GPT-OSS 120B", description: "Modelo aberto da OpenAI via Google" },
]

/** Valores gravados por versões anteriores do app, antes de `agy models`
 * padronizar seus ids em kebab-case. Mantém conversas antigas executáveis. */
const LEGACY_AGY_MODELS: Record<string, string> = {
  "Gemini 3.5 Flash (Low)": "gemini-3.5-flash-low",
  "Gemini 3.1 Pro (High)": "gemini-3.1-pro-high",
  "Claude Sonnet 4.6 (Thinking)": "claude-sonnet-4-6",
  "Claude Opus 4.6 (Thinking)": "claude-opus-4-6-thinking",
}

/** Normaliza valores persistidos de uma conversa antes que cheguem ao adapter. */
export function normalizeAgyModel(model: string | null): string | null {
  if (!model || model === "default") return model
  return LEGACY_AGY_MODELS[model] ?? model
}

/** Modelos do codex que SAÍRAM do catálogo do CLI (400 com auth ChatGPT desde
 *  jul/2026). Remapeia pro vizinho vivo mais próximo — mesma disciplina do
 *  LEGACY_AGY_MODELS: valor persistido (settings/schedule/conversa) não pode
 *  virar erro fixo em todo envio. */
const LEGACY_CODEX_MODELS: Record<string, string> = {
  "gpt-5.3-codex": "gpt-5.5",
  o3: "gpt-5.5",
}

/** "opus[1m]" saiu do picker: o alias resolvia server-side pra versão da vez
 *  (4.7, depois 4.8, hoje Opus 5) e o pin exato é o conserto. Segue VÁLIDO no
 *  CLI, então o remap é escolha de produto: valor legado converge pro pin que o
 *  picker oferece HOJE como topo (Opus 5). */
const LEGACY_CLAUDE_MODELS: Record<string, string> = {
  "opus[1m]": "claude-opus-5[1m]",
}

/** Slug de modelo é o VALOR de uma flag (`--model <slug>`), nunca uma linha de
 *  listagem. Em 14/08/2026 um parser velho de `agy models` (TSV `slug<TAB>
 *  Rótulo`) devolveu a linha inteira como slug, e o valor sujo foi PERSISTIDO
 *  (conversa, agenda, `defaultModel`, frontmatter de especialista). O CLI
 *  recusava tudo com "model … is not recognized as a known model".
 *
 *  Saneia na LEITURA, mesma disciplina do LEGACY_*: nada de migração de
 *  schema, e todo valor guardado antes do conserto volta executável na
 *  primeira vez que alguém o lê. Fica DEPOIS do remap legado de propósito —
 *  há chave legada com espaço ("Gemini 3.5 Flash (Low)"), e cortar antes
 *  destruiria o remap dela.
 *
 *  Corta SÓ em TAB/quebra de linha, que são o separador da listagem: ali o
 *  pedaço da frente é o slug POR CONSTRUÇÃO, não um palpite. Valor com só
 *  espaços (um rótulo puro, ex. "Gemini 3.6 Flash (High)") NÃO é chutado —
 *  adivinhar ali produziria um slug limpo e errado; ele segue inteiro e a
 *  fronteira no Rust recusa dizendo o que houve. Genérico: a regra é do
 *  transporte, não de um fornecedor. */
function limparSlug(model: string): string | null {
  const primeiro = model.split(/[\t\r\n]/, 1)[0]?.trim() ?? ""
  return primeiro || null
}

/** Normalização de valor persistido de modelo, POR agent.
 *  Ponto único pra UI (display honesto) e pros despachos (schedule/hydrate)
 *  não reenviarem um id morto pra sempre. */
export function normalizeModelValue(
  agent: string,
  model: string | null,
): string | null {
  if (!model || model === "default") return model
  const remapeado =
    agent === "agy"
      ? normalizeAgyModel(model)
      : agent === "codex"
        ? (LEGACY_CODEX_MODELS[model] ?? model)
        : agent === "claude-code"
          ? (LEGACY_CLAUDE_MODELS[model] ?? model)
          : model
  if (!remapeado || remapeado === "default") return remapeado
  return limparSlug(remapeado)
}
// max/ultra são exclusivos da família 5.6 (ultra só Sol/Terra: dispara
// subagentes e consome quota agressivamente); 5.5/5.4 param em xhigh — o
// backend rejeita acima disso, o erro aparece no fio (honesto, sem mascarar).
export const CODEX_EFFORTS: AgentModelOption[] = [
  { value: "default", label: "Padrão", pill: "effort", description: "Padrão do modelo" },
  { value: "minimal", label: "minimal", description: "Mínimo" },
  { value: "low", label: "low", description: "Rápido, mais raso" },
  { value: "medium", label: "medium", description: "Equilíbrio" },
  { value: "high", label: "high", description: "Raciocina mais fundo" },
  { value: "xhigh", label: "xhigh", description: "Bem mais fundo" },
  { value: "max", label: "max", description: "Fundo máximo (só família 5.6)" },
  { value: "ultra", label: "ultra", description: "Máximo + subagentes (Sol/Terra; pesa na cota)" },
]

/** OpenCode (1.17.9). O dialeto é `provider/model` — é assim que
 *  `opencode models` lista e é o que o `-m` aceita.
 *
 *  Lista CURADA e curta de propósito: a máquina tem 88 modelos em 4 provedores,
 *  e despejar todos aqui seria o seletor virando catálogo. A lista viva entra
 *  pelo `opencode models` no F4 do plano; até lá, os que valem por provedor.
 *
 *  Cada provedor depende de credencial PRÓPRIA (`opencode providers list`):
 *  modelo de provedor não conectado falha com 401, e a seção Serviços é onde
 *  isso aparece. */
export const OPENCODE_MODELS: AgentModelOption[] = [
  { value: "default", label: "Padrão", pill: "modelo", description: "Deixa o OpenCode escolher" },
  { value: "google/gemini-2.5-flash-lite", label: "Gemini Flash Lite", description: "Rápido e barato (conta Google)" },
  { value: "google/gemini-2.5-pro", label: "Gemini 2.5 Pro", description: "Mais capaz (conta Google)" },
  { value: "openai/gpt-5.6-sol", label: "Sol (5.6)", description: "Frontier da OpenAI, pela conta ChatGPT" },
  { value: "opencode-go/kimi-k3", label: "Kimi K3", description: "Plano OpenCode Go (US$ 10/mês)" },
  { value: "opencode-go/minimax-m3", label: "MiniMax M3", description: "Plano OpenCode Go" },
  { value: "opencode-go/qwen3.8-max", label: "Qwen 3.8 Max", description: "Plano OpenCode Go" },
]

/** `--variant` do OpenCode: esforço de raciocínio, e o próprio --help diz que
 *  é ESPECÍFICO DO PROVEDOR. Modelo que não entende o variant ignora. */
export const OPENCODE_EFFORTS: AgentModelOption[] = [
  { value: "default", label: "Padrão", pill: "effort", description: "Padrão do modelo" },
  { value: "minimal", label: "minimal", description: "Mínimo" },
  { value: "high", label: "high", description: "Raciocina mais fundo" },
  { value: "max", label: "max", description: "Esforço máximo" },
]
