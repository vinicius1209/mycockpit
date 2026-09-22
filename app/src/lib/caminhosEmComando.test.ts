// Comandos REAIS da conversa 1200a161 (22/09/2026), tirados do banco da Frota.
// O clique em "`AGENTS.md`" no fio mostrou "4 arquivos se chamam AGENTS.md":
// o arquivo tinha sido editado só por scripts dentro do Bash. Única troca no
// payload: o nome da pasta raiz do repositório, que ainda carrega a marca
// antiga (a catraca `check-marca` não deixa ela voltar ao código).
import { describe, expect, it } from "vitest"
import { arquivosCitadosEmShell, caminhosEmComando } from "./caminhosEmComando"

const PROJETO = "/Users/viniciusmachado/projetos/frota"

// Início verbatim dos comandos (o corpo dos heredocs foi cortado no meio).
const ESCREVEU_O_AGENTS = `python3 - <<'EOF'
p='app/src-tauri/src/AGENTS.md'
s=open(p).read()
a='''(\`politica_da_barra\`): \`file://\` do projeto entra, \`javascript:\` não.
'''
assert s.count(a)==1`
const LEU_COM_CD = `cd /Users/viniciusmachado/projetos/frota && grep -n "^### ADR-224" docs/decisions.md; sed -n "$(grep -n '^### ADR-224' docs/decisions.md | cut -d: -f1),+6p" docs/decisions.md; grep -n "## Navegador para qualquer motor\\|frota-browser" app/src-tauri/src/AGENTS.md | head -5`
const NOME_SOLTO_NUM_COMENTARIO = `python3 - <<'EOF'
p='provider_mcp_inventory.rs'
s=open(p).read()
/// daqui e nunca sobe subprocesso (\`AGENTS.md\` do backend). Vazio também`
const OUTRO_PROJETO = `cd /Users/viniciusmachado/projetos/sicredi && ls; for f in CLAUDE.md AGENTS.md .frota/instructions.md; do [ -f "$f" ] && echo "== $f"; done; find . -maxdepth 2 \\( -name CLAUDE.md -o -name AGENTS.md \\) -not -path "*/node_modules/*" | head`
const CURINGA_FORA = `grep -rln -i "playwright" /Users/viniciusmachado/projetos/sicredi/CLAUDE.md /Users/viniciusmachado/projetos/sicredi/*/AGENTS.md 2>/dev/null`

describe("caminhos citados em comandos de shell", () => {
  it("o script que editou o AGENTS.md aponta a pasta certa", () => {
    expect(caminhosEmComando(ESCREVEU_O_AGENTS, PROJETO)).toEqual(["app/src-tauri/src/AGENTS.md"])
  })

  it("relativos seguem o cd do próprio comando", () => {
    expect(caminhosEmComando(LEU_COM_CD, PROJETO)).toEqual(["docs/decisions.md", "app/src-tauri/src/AGENTS.md"])
    expect(caminhosEmComando("cd app/src-tauri && sed -n 1,5p src/AGENTS.md", PROJETO)).toEqual([
      "app/src-tauri/src/AGENTS.md",
    ])
  })

  it("nome solto não desempata: não diz a pasta", () => {
    expect(caminhosEmComando(NOME_SOLTO_NUM_COMENTARIO, PROJETO)).toEqual([])
  })

  it("outro projeto, curinga e escapada por .. ficam fora", () => {
    expect(caminhosEmComando(OUTRO_PROJETO, PROJETO)).toEqual([])
    expect(caminhosEmComando(CURINGA_FORA, PROJETO)).toEqual([])
    expect(caminhosEmComando("cat ../../etc/hosts", PROJETO)).toEqual([])
  })

  it("junta os comandos da conversa e ignora quem não é shell", () => {
    const itens = [
      { kind: "tool", name: "Bash", input: { command: NOME_SOLTO_NUM_COMENTARIO } },
      { kind: "tool", name: "Bash", input: { command: ESCREVEU_O_AGENTS } },
      { kind: "tool", name: "Bash", input: { command: OUTRO_PROJETO } },
      { kind: "tool", name: "Read", input: { file_path: `${PROJETO}/CLAUDE.md` } },
      { kind: "assistant" },
    ]
    expect([...arquivosCitadosEmShell(itens, PROJETO)]).toEqual(["app/src-tauri/src/AGENTS.md"])
  })
})
