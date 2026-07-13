// Detecção HEURÍSTICA (mas robusta por PATH, não por wording) de acesso a pasta
// bloqueado pelo gate de diretório do CLI. Quando um tool_result FALHA e o texto
// cita um caminho absoluto FORA da raiz do projeto + um termo de acesso, é forte
// sinal de que o agent quis tocar num repo irmão. Vira o banner "Liberar e
// reenviar" (Phase 3 do extra_dirs). Falha graciosa: null = não sugere nada.

/** Termos que, junto de um path fora da raiz, indicam bloqueio de diretório.
 *  Amplos de propósito (varia por CLI/versão), mas exigidos p/ evitar ruído. */
const ACCESS_RE =
  /(allowed director|outside (the )?(allowed|working|permitted)|not permitted|permission denied|--add-dir|add-dir|fora do diret[óo]rio|n[ãa]o permit|eacces|cannot access|not allowed to (access|read|write)|no access to|access denied)/i

/** Extrai caminhos absolutos "limpos" (sem espaços/aspas) do texto. */
function absPaths(text: string): string[] {
  const m = text.match(/\/[^\s'"`():,]+/g)
  return m ?? []
}

/** Normaliza: remove barra final; se o último segmento parece arquivo (tem "."),
 *  sobe pro diretório-pai (é ele que entra no --add-dir). */
function toDir(p: string): string {
  const clean = p.replace(/\/+$/, "")
  const lastSlash = clean.lastIndexOf("/")
  const last = clean.slice(lastSlash + 1)
  if (last.includes(".") && lastSlash > 0) return clean.slice(0, lastSlash)
  return clean
}

/** True se `p` está dentro de `root` (mesma pasta ou subpasta). */
function within(p: string, root: string): boolean {
  const r = root.replace(/\/+$/, "")
  return p === r || p.startsWith(r + "/")
}

/** Retorna a pasta candidata a liberar (fora da raiz e ainda não permitida), ou
 *  null. `text` = tool_result que falhou; `projectRoot` = cwd/raiz do projeto;
 *  `allowed` = extra_dirs já liberados. */
export function detectBlockedDir(
  text: string,
  projectRoot: string,
  allowed: string[] = [],
): string | null {
  if (!text || !projectRoot) return null
  if (!ACCESS_RE.test(text)) return null

  const roots = [projectRoot, ...allowed].map((r) => r.replace(/\/+$/, ""))
  for (const raw of absPaths(text)) {
    const dir = toDir(raw)
    if (dir.length < 2) continue
    // dentro da raiz ou de alguma pasta já liberada → não é o problema.
    if (roots.some((r) => within(dir, r))) continue
    // ignora paths de sistema óbvios (não são "repo irmão" que o user liberaria).
    if (/^\/(usr|bin|etc|dev|proc|sys|opt|var|tmp|private)\b/.test(dir)) continue
    return dir
  }
  return null
}
