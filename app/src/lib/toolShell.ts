// O shell visto pela UI: família semântica (o que o comando FAZ) e o objeto
// (sobre o QUE ele age). Saiu do `toolview` quando a linha da ação passou a
// separar verbo de objeto (ADR-241): as duas perguntas são sobre o mesmo
// comando e mudam juntas. Determinístico e barato: não tenta "entender" o
// shell, só reconhece as famílias que importam na tela.

import type { ToolCategory, ToolEmphasis, ToolObject } from "@/lib/toolview"

export interface SemanticTool {
  label: string
  category: ToolCategory
  emphasis: ToolEmphasis
}

/** Remove só o launcher que o Codex inclui no campo `command`. Isso é
 * apresentação: `detail` continua guardando o comando EXATO para auditoria. */
export function unwrapShellCommand(command: string): string {
  const cmd = command.trim()
  const m = cmd.match(
    /^(?:\/bin\/)?(?:zsh|bash|sh)\s+-[a-z]*c\s+(["'])([\s\S]*)\1$/i,
  )
  if (!m) return cmd
  const body = m[2]
  return m[1] === '"'
    ? body.replace(/\\"/g, '"').replace(/\\\\/g, "\\")
    : body
}

/** Extrai o rótulo que o próprio agent narrou: `echo "=== label ===" && resto`. */
export function bashEchoLabel(cmd: string): string | null {
  const m = cmd.match(
    /^\s*echo\s+["']?\s*[=\-#*]*\s*([^"'|&;=]+?)\s*[=\-#*]*\s*["']?\s*(?:&&|;)/,
  )
  const label = m?.[1]?.trim()
  return label && label.length > 1 ? label : null
}

/** Comando que ESCREVE em arquivo sem cara de escrita: edição in-place
 *  (`sed -i`, `perl -pi`) e script que abre arquivo para escrita. Visto em
 *  23/09/2026: `sed -i '' 's/…/' src/lib.rs` saía como "inspect" porque a
 *  família do `sed -n` casava antes, e uma edição real entrou na contagem de
 *  "verificações". Precisa vir ANTES das famílias de leitura. */
const ESCREVE_EM_ARQUIVO =
  /(?:^|[\s;&|(])(?:sed\s+(?:-[a-z]+\s+)*-[a-z]*i\b|perl\s+-[a-z]*i)|\bopen\([^)]*,\s*["'][wa]\+?["']|\.write_text\(|writeFileSync\(/

export function presentShell(command: string): SemanticTool {
  const cmd = unwrapShellCommand(command)
  const lower = cmd.toLowerCase()

  // Ações sensíveis primeiro: não podem ser diluídas como "verificação" só
  // porque o mesmo comando também contém um `git status` ou `find`.
  if (/\bgit\s+push\b/.test(lower))
    return { label: "Enviar alterações ao repositório", category: "change", emphasis: "warning" }
  if (/(?:^|[;&|]\s*)rm\s+(?:-[^\s]+\s+)*\S+/.test(lower))
    return { label: "Remover arquivos", category: "change", emphasis: "warning" }
  if (/\bgit\s+(?:reset|clean)\b/.test(lower))
    return { label: "Reorganizar o estado do repositório", category: "change", emphasis: "warning" }

  if (
    /\b(?:vitest|pytest)\b/.test(lower) ||
    /\bcargo\s+test\b/.test(lower) ||
    /\b(?:bun|npm|pnpm|yarn)\s+(?:run\s+)?test\b/.test(lower)
  )
    return { label: "Executar testes", category: "validate", emphasis: "normal" }
  if (/\b(?:typecheck|type-check)\b/.test(lower) || /\btsc(?:\s|$)/.test(lower))
    return { label: "Verificar tipos", category: "validate", emphasis: "normal" }
  if (/\b(?:oxlint|eslint|biome|ruff)\b/.test(lower) || /\brun\s+lint\b/.test(lower))
    return { label: "Validar o código", category: "validate", emphasis: "normal" }
  if (/\bcargo\s+check\b/.test(lower))
    return { label: "Verificar o projeto Rust", category: "validate", emphasis: "normal" }
  if (/\b(?:bun|npm|pnpm|yarn)\s+(?:run\s+)?build\b/.test(lower))
    return { label: "Gerar o build", category: "validate", emphasis: "normal" }

  if (/\bgit\s+commit\b/.test(lower))
    return { label: "Criar commit", category: "change", emphasis: "normal" }
  if (/\bgit\s+(?:switch|checkout|branch|merge|rebase)\b/.test(lower))
    return { label: "Atualizar a branch de trabalho", category: "change", emphasis: "normal" }
  if (/\b(?:npm|pnpm|yarn|bun)\s+(?:install|add)\b/.test(lower))
    return { label: "Instalar dependências", category: "change", emphasis: "normal" }
  if (/\bsqlite3\b/.test(lower) && /\b(?:insert|update|delete|drop|alter)\b/.test(lower))
    return { label: "Atualizar dados locais", category: "change", emphasis: "warning" }
  if (ESCREVE_EM_ARQUIVO.test(cmd))
    return { label: "Alterar arquivos", category: "change", emphasis: "normal" }

  // Script inline (`python3 -c`, `node -e`): o corpo tem palavras de tudo
  // (`find(`, `cat`), então decide ANTES das famílias de inspeção. Sem este
  // caso, o motor que não narra o comando (o agy, ADR-253) ficava com
  // "Executar comando" em dezenas de linhas seguidas (24/09/2026).
  if (/\b(?:psql|mysql|mongosh)\b/.test(lower) || /\bsupabase\s+db\s+(?:query|dump)\b/.test(lower))
    return { label: "Consultar o banco de dados", category: "inspect", emphasis: "quiet" }
  if (/(?:^|[\s;&|(])(?:python3?|node|deno|ruby|php)\s+(?:-[a-z]+\s+)*-(?:c|e)\b/.test(lower))
    return /https?:\/\//.test(lower)
      ? { label: "Consultar um serviço externo", category: "web", emphasis: "normal" }
      : { label: "Rodar um script", category: "execute", emphasis: "normal" }

  if (/\bsqlite3\b/.test(lower))
    return { label: "Consultar dados locais", category: "inspect", emphasis: "quiet" }
  if (/\bgit\s+status\b/.test(lower))
    return { label: "Verificar o estado do repositório", category: "inspect", emphasis: "quiet" }
  if (/\bgit\s+diff\b/.test(lower))
    return { label: "Inspecionar alterações", category: "inspect", emphasis: "quiet" }
  if (/\bgit\s+(?:log|show|blame)\b/.test(lower))
    return { label: "Consultar o histórico do Git", category: "inspect", emphasis: "quiet" }
  if (/(?:^|[\s;&|$(])(?:rg|grep)\b/.test(lower))
    return { label: "Buscar no projeto", category: "inspect", emphasis: "quiet" }
  if (/(?:^|[\s;&|$(])(?:sed|nl|cat|head|tail|wc|find|ls|pwd)\b/.test(lower))
    return { label: "Inspecionar arquivos", category: "inspect", emphasis: "quiet" }
  if (/\b(?:curl|wget)\b/.test(lower))
    return { label: "Consultar um serviço externo", category: "web", emphasis: "normal" }
  if (/(?:^|[;&|]\s*)(?:cp|mv|mkdir|touch)\b/.test(lower))
    return { label: "Alterar arquivos", category: "change", emphasis: "normal" }
  return { label: "Executar comando", category: "execute", emphasis: "normal" }
}

// ---------------------------------------------------------------------------
// Verbo + objeto (ADR-241)
// ---------------------------------------------------------------------------

export interface ShellFrase {
  verb: string
  object: ToolObject | null
}

/** Quebra o comando nos segmentos de topo (`&&`, `||`, `;`, `|`, quebra de
 *  linha), respeitando aspas. Heredoc não é aberto: o corpo não é comando. */
export function segmentosDoShell(cmd: string): string[] {
  const out: string[] = []
  let atual = ""
  let aspa: string | null = null
  for (let i = 0; i < cmd.length; i++) {
    const c = cmd[i]
    if (aspa) {
      atual += c
      if (c === "\\" && aspa === '"') {
        atual += cmd[++i] ?? ""
      } else if (c === aspa) aspa = null
      continue
    }
    if (c === "'" || c === '"') {
      aspa = c
      atual += c
      continue
    }
    const dois = cmd.slice(i, i + 2)
    if (dois === "&&" || dois === "||") {
      out.push(atual)
      atual = ""
      i++
      continue
    }
    if (c === "\n") {
      // Corpo de heredoc não é comando: pula até a linha do terminador.
      const tag = atual.match(/<<-?\s*['"]?(\w+)['"]?\s*$/)?.[1]
      if (tag) {
        const fim = cmd.indexOf(`\n${tag}`, i)
        i = fim < 0 ? cmd.length : fim + tag.length
      }
      out.push(atual)
      atual = ""
      continue
    }
    if (c === ";" || (c === "|" && cmd[i + 1] !== "|")) {
      out.push(atual)
      atual = ""
      continue
    }
    atual += c
  }
  out.push(atual)
  return out.map((s) => s.trim()).filter(Boolean)
}

/** Palavras do segmento sem aspas externas; `2>&1` e redirecionamentos saem. */
function palavras(seg: string): string[] {
  const out: string[] = []
  const re = /"((?:[^"\\]|\\.)*)"|'([^']*)'|(\S+)/g
  for (let m = re.exec(seg); m; m = re.exec(seg)) {
    const w = m[1] ?? m[2] ?? m[3]
    if (m[3] && /^\d?>{1,2}/.test(m[3])) continue
    out.push(w)
  }
  return out
}

const nomeBase = (p: string) => p.split("/").filter(Boolean).pop() ?? p
const pareceArquivo = (w: string) => /[\w-]\.[\w]+$/.test(w) && !/^-/.test(w)

/** Um shell no fio como VERBO + OBJETO. A primeira ação de verdade manda (o
 *  `cd` de preâmbulo não conta); as demais viram "+N". Arquivo lido ou editado
 *  vira pílula e busca vira "padrão em arquivo", mesmo com narração (ela vai
 *  para o hover): é o que Read e Grep nativos já mostram. Fora disso, a
 *  narração do agente é a frase; sem ela, o nome da família do comando. */
export function fraseDoShell(command: string, narration: string | null): ShellFrase {
  const cmd = unwrapShellCommand(command)
  const segs = segmentosDoShell(cmd).filter((s) => !/^cd\s/.test(s))
  const mais = Math.max(0, segs.length - 1)
  const seg = segs[0] ?? ""
  const w = palavras(seg)
  const [prog, ...args] = w
  const texto = (t: string): ToolObject => ({ kind: "text", text: t, mais })

  if (prog === "sed" && args.some((a) => /^-[a-z]*i/.test(a))) {
    const alvo = args.filter(pareceArquivo).pop()
    if (alvo) return { verb: "Editar", object: { kind: "file", path: alvo, mais } }
  }
  if (prog === "sed" || prog === "cat" || prog === "head" || prog === "tail" || prog === "nl") {
    const alvo = args.filter(pareceArquivo).pop()
    if (alvo) {
      const faixa = seg.match(/\bsed\s+-n\s+['"]?(\d+),(\d+)p/)
      return {
        verb: "Ler",
        object: { kind: "file", path: alvo, range: faixa ? `${faixa[1]}–${faixa[2]}` : null, mais },
      }
    }
  }
  if (prog === "grep" || prog === "rg") {
    const soltos = args.filter((a) => !a.startsWith("-") && !/^\d+$/.test(a))
    const [padrao, onde] = soltos
    if (padrao)
      return {
        verb: "Buscar",
        object: texto(onde ? `${padrao} em ${nomeBase(onde)}` : padrao),
      }
  }
  const fam = presentShell(cmd)
  const verb = fam.label === "Executar testes" ? "Testar" : "Rodar"
  // Sem arquivo nem busca legível, a narração do agente é a melhor frase que
  // existe: ela diz o PORQUÊ ("Gerar PDF (iPhone SE)"), o comando só o como.
  // Sem narração, o nome da família ("Consultar dados locais"): o comando
  // cru NUNCA é rótulo (cabeçalho do `toolview`), ele mora no detalhe.
  return { verb, object: { kind: "text", text: narration ?? fam.label, mais, frase: true } }
}
