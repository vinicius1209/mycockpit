import { describe, expect, it } from "vitest"
import { presentTool } from "@/lib/toolview"
import { describeToolGroup } from "@/lib/toolGroup"
import { fraseDoShell, segmentosDoShell } from "@/lib/toolShell"

// Payload REAL: o turno do protocolo de arquivos no Rust, 23/09/2026 (sessão
// b6cd7444 do Claude Code), com `command` e `description` como vieram.
const REAL = {
  lerSources: {
    description: "Read file byte reader, path validation and tauri setup",
    command:
      'cd /Users/x/app/src-tauri && sed -n 320,370p src/sources.rs; grep -n "fn validate_project_path\\|fn canon_inside" src/sources.rs',
  },
  buscarResolver: {
    description: "Read the scoped path resolver for reuse",
    command:
      'grep -n "fn scoped_file_path" -A40 src/sources.rs; wc -l src/sources.rs; grep -n "src-tauri/sources.rs" ../../scripts/lints/file-size-baseline.json',
  },
  moverBloco: {
    description: "Move the legacy DB migration functions out of lib.rs",
    command:
      "python3 - <<'EOF'\np='lib.rs'; s=open(p).read()\nini=s.index('/// As árvores de blob')\nopen(p,'w').write(s[:ini])\nEOF",
  },
  corrigirImport: {
    description: "Fix the remaining test import and rerun",
    command:
      "sed -i '' 's/    use super::migrar_arvores_entre;/    use crate::manutencao_do_banco::migrar_arvores_entre;/' src/lib.rs && python3 - <<'EOF'\np='src/manutencao_do_banco.rs'; s=open(p).read()\nEOF",
  },
  testar: {
    description: "Show raw cargo test output",
    command: "cargo test --lib migracao_do_banco 2>&1 | tail -5",
  },
}

describe("toolShell · edição disfarçada de leitura (bug de 23/09)", () => {
  it("sed -i é EDIÇÃO: entra como mudança, não como verificação", () => {
    const v = presentTool("Bash", REAL.corrigirImport)
    expect(v.category).toBe("change")
    expect(v.verb).toBe("Editar")
    expect(v.object).toMatchObject({ kind: "file", path: "src/lib.rs", mais: 1 })
  })

  it("script que abre arquivo para escrita também é mudança", () => {
    expect(presentTool("Bash", REAL.moverBloco).category).toBe("change")
  })

  it("sed -n continua leitura, com a faixa de linhas no objeto", () => {
    const v = presentTool("Bash", REAL.lerSources)
    expect(v.category).toBe("inspect")
    expect(v.verb).toBe("Ler")
    expect(v.object).toMatchObject({ kind: "file", path: "src/sources.rs", range: "320–370", mais: 1 })
    // a narração do agente não some: vai para o hover
    expect(v.narration).toBe(REAL.lerSources.description)
  })

  it("o grupo real deixa de chamar uma edição de 'verificação'", () => {
    const tools = [REAL.lerSources, REAL.buscarResolver, REAL.moverBloco, REAL.corrigirImport].map(
      (input) => ({ name: "Bash", input, result: { ok: true } }),
    )
    const label = describeToolGroup(tools).label
    expect(label).not.toContain("verifica")
    expect(label).toBe("Editou 1 arquivo · rodou 1 comando · leu 1 arquivo · buscou 1 vez")
  })
})

describe("toolShell · verbo + objeto", () => {
  it("busca vira 'padrão em arquivo', mesmo com narração", () => {
    const v = presentTool("Bash", REAL.buscarResolver)
    expect(v.verb).toBe("Buscar")
    expect(v.object).toMatchObject({ kind: "text", text: "fn scoped_file_path em sources.rs", mais: 2 })
  })

  it("sem arquivo nem busca, a narração é a frase (e não ganha verbo na frente)", () => {
    const v = presentTool("Bash", REAL.testar)
    expect(v.verb).toBe("Testar")
    expect(v.object).toEqual({ kind: "text", text: "Show raw cargo test output", mais: 1, frase: true })
  })

  it("sem narração, o nome da família: o comando cru nunca vira rótulo", () => {
    const f = fraseDoShell("cargo test --lib migracao_do_banco 2>&1 | tail -5", null)
    expect(f).toEqual({
      verb: "Testar",
      object: { kind: "text", text: "Executar testes", mais: 1, frase: true },
    })
  })

  it("heredoc sem narração não vaza o corpo do script", () => {
    const f = fraseDoShell(REAL.moverBloco.command, null)
    expect(f.object).toMatchObject({ kind: "text", text: "Alterar arquivos" })
    expect(JSON.stringify(f)).not.toContain("open(p")
  })

  it("segmenta respeitando aspas: o | dentro de um padrão não é pipe", () => {
    expect(segmentosDoShell(`grep -E "a|b" x.ts | head -3; wc -l y.rs`)).toEqual([
      `grep -E "a|b" x.ts`,
      "head -3",
      "wc -l y.rs",
    ])
  })
})
