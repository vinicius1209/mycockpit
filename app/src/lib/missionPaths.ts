// Caminhos de artefato de missão — ISOLADOS por missão (correção de
// confiabilidade, jul/2026). Antes tudo vivia em `.mission/<i>-<persona>.json`
// com nomes fixos por ÍNDICE de fase, então duas missões no mesmo cwd se
// SOBRESCREVIAM (o executor de uma missão nova esmagava o handoff de outra —
// perda de histórico, avisada pelo próprio agente). Agora cada missão ganha
// `.mycockpit/missions/<slug>/…`: slug único → zero colisão, histórico
// preservado. Consolidado sob `.mycockpit/` (a pasta do app por projeto, já
// gitignorada com `*`), aposentando o `.mission/` da raiz. Puro e testável.

/** Raiz das missões, sob a pasta do app (`.mycockpit/` já é `*` no gitignore). */
export const MISSIONS_ROOT = ".mycockpit/missions"

/** slugify defensivo: minúsculo, sem acento, não-alfanumérico → "-", colapsa,
 *  apara e limita o tamanho (nomes de pasta previsíveis e sem surpresa de FS). */
export function slugifyTask(task: string): string {
  return task
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // tira diacríticos (combining marks)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+/, "")
    .slice(0, 40)
    .replace(/-+$/, "")
}

/** Slug único da missão: data + id curto + tarefa. O id curto (do UUID) é o
 *  desempate — mesmo com tarefas iguais no mesmo dia, não colide. `now`
 *  injetável (Date.now() do chamador) pra manter a função pura e testável. */
export function missionSlug(task: string, missionId: string, now: number): string {
  const date = new Date(now).toISOString().slice(0, 10) // YYYY-MM-DD
  const short = missionId.replace(/-/g, "").slice(0, 6) || "mission"
  const name = slugifyTask(task)
  return [date, short, name].filter(Boolean).join("-")
}

/** Pasta relativa (sob o cwd) de UMA missão. */
export function missionDir(slug: string): string {
  return `${MISSIONS_ROOT}/${slug}`
}

/** Caminho do handoff de uma fase DENTRO da pasta da missão. */
export function handoffFileName(
  dir: string,
  phaseIdx: number,
  persona: string,
): string {
  return `${dir}/${phaseIdx}-${persona}.json`
}

/** run-state da missão (retomada) DENTRO da pasta da missão. */
export function runStatePath(dir: string): string {
  return `${dir}/run-state.json`
}

/** Ponteiro por conversa → dir da missão ATIVA/última. Como as pastas de
 *  missão são gitignoradas (não dá pra achá-las com `git ls-files`), o boot lê
 *  este ponteiro pra saber ONDE está o run-state da conversa. Sobrescrever é OK:
 *  há no máx. UMA missão por conversa de cada vez, então o ponteiro só rastreia
 *  a corrente. convId é UUID (seguro como nome de arquivo). */
export function activePointerPath(convId: string): string {
  return `${MISSIONS_ROOT}/active-${convId}.json`
}
