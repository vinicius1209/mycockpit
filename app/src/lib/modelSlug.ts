// O ID DO MODELO, ANTES DE VIRAR UM PROCESSO.
//
// A fronteira de verdade é o Rust: `validate_model_slug` (src-tauri/adapters.rs)
// recusa slug vazio ou com QUALQUER whitespace antes de montar o RunRequest —
// nenhum processo nasce. Isso é fail-closed e continua sendo a guarda.
//
// O que faltava era o lado de cá. O input "Modelo custom…" do composer aceita id
// arbitrário (é dia-1 de modelo novo: o CLI aceita antes de a lista curada
// existir) e não passava por validação nenhuma no TS — só `trim()` e
// não-vazio. Um id colado com o rótulo junto ("Gemini 3.7 Flash (High)") ia pro
// estado, era PERSISTIDO em `conversations.req_model`, e só então o Rust
// recusava. Como `normalizeModelValue` corta apenas TAB/CR/LF (de propósito:
// não chuta onde cortar um rótulo com espaço), a releitura devolve o mesmo id
// quebrado e a conversa fica num beco até a saída de emergência.
//
// Esta função é ESPELHO, não substituta: ela nunca pode ser mais PERMISSIVA que
// o Rust. Os casos do teste são os mesmos da suíte de lá, de propósito.

/**
 * O que há de errado com este id de modelo? `null` = nada (pode seguir).
 *
 * Mesma régua do `validate_model_slug`: vazio depois do trim, ou qualquer
 * caractere de espaço em qualquer posição. Não há allowlist — `claude-opus-5[1m]`,
 * `gpt-5.6-sol` e `gemini-3.7-flash-high` são todos válidos, e precisam ser: o
 * app é agnóstico de motor e não decide a gramática de id de ninguém.
 */
export function problemaNoSlug(model: string | null): string | null {
  if (model === null) return null
  if (model.trim() === "")
    return "O id do modelo está vazio. Escolha um modelo no seletor."
  if (/\s/.test(model)) {
    const limpo = model.trim().split(/\s+/)[0]
    return `Esse id veio com texto colado ("${model}"), então o CLI não reconhece. O id parece ser "${limpo}".`
  }
  return null
}
