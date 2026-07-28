// QUEM LÊ O QUÊ — o painel dizia "o que o agente enxerga" e listava a mobília do
// Claude Code (`CLAUDE.md`, `.claude/agents`, `~/.claude/.../memory`). Numa
// conversa Codex ou Antigravity aquilo era verdade sobre o DISCO e mentira sobre
// o contexto DAQUELE agent. Aqui a leitura passa a ser cruzada com o agent da
// conversa, e as fontes ganham dono explícito.
//
// Regra da casa: fonte do APP (a doutrina, as personas, as lições) vale nos três
// porque quem injeta é o app. Fonte de FORNECEDOR só vale pro dono dela.

/** Uma fonte de contexto que NÃO é do app: existe no disco, mas só o dono lê. */
export interface VendorSource {
  /** Como aparece na UI (nome do arquivo/pasta). */
  label: string
  /** Agent que lê esta fonte. */
  owner: string
  /** Está no disco? */
  present: boolean
  /** Quantidade, quando a fonte é uma coleção (personas, memórias). */
  count?: number
}

/** O que o inventário do projeto apurou no disco. */
export interface VendorFacts {
  /** `CLAUDE.md` na raiz. */
  claudeMd: boolean
  /** `AGENTS.md` na raiz. */
  agentsMd: boolean
  /** Subagents em `.claude/agents/*.md`. */
  personas: number
  /** Arquivos em `~/.claude/projects/<path-encoded>/memory` (fora o índice). */
  memories: number
}

const CLAUDE = "claude-code"
const CODEX = "codex"

/** As fontes de fornecedor, sempre na mesma ordem (a UI decide o que mostrar). */
export function vendorSources(f: VendorFacts): VendorSource[] {
  return [
    { label: "CLAUDE.md", owner: CLAUDE, present: f.claudeMd },
    { label: "AGENTS.md", owner: CODEX, present: f.agentsMd },
    {
      label: ".claude/agents",
      owner: CLAUDE,
      present: f.personas > 0,
      count: f.personas,
    },
    {
      label: "memórias do CLI",
      owner: CLAUDE,
      present: f.memories > 0,
      count: f.memories,
    },
  ]
}

/** As fontes que ESTE agent leria, existam ou não. Lista vazia = o agent não
 *  tem convenção de arquivo conhecida (o caso do agy: a CLI não documenta
 *  nenhuma, e afirmar que lê ou que não lê seria invenção — então o painel só
 *  fala do que temos certeza, que é a doutrina injetada). */
export function readableBy(agent: string, f: VendorFacts): VendorSource[] {
  return vendorSources(f).filter((s) => s.owner === agent)
}

/** Rótulo com contagem quando a fonte é coleção: ".claude/agents (3)". */
export function sourceLabel(s: VendorSource): string {
  return s.count != null ? `${s.label} (${s.count})` : s.label
}

/** Frase honesta sobre o que o agent DESTA conversa lê do disco, além da
 *  doutrina que o app injeta. `agent` null (sem conversa aberta) → null.
 *  `label` é o nome humano do agent (agentLabel), injetado pelo caller pra este
 *  módulo não depender do catálogo. */
export function vendorReadingNote(
  agent: string | null,
  label: string,
  f: VendorFacts,
): string | null {
  if (!agent) return null
  const meus = readableBy(agent, f)
  if (meus.length === 0) {
    return `O ${label} não tem arquivo de instrução próprio conhecido — nesta conversa, do disco só chega a doutrina que o app injeta.`
  }
  const presentes = meus.filter((s) => s.present)
  if (presentes.length === 0) {
    const nomes = meus.map((s) => s.label).join(", ")
    // singular/plural: com uma fonte só, "nada disso" soa evasivo — o ponto é
    // justamente nomear o arquivo que falta (foi o caso do AGENTS.md aqui).
    const falta =
      meus.length === 1 ? "e o arquivo não existe" : "mas nada disso existe"
    return `O ${label} leria ${nomes}, ${falta} aqui — só a doutrina do app chega.`
  }
  return `Nesta conversa o ${label} também lê: ${presentes.map(sourceLabel).join(", ")}.`
}
