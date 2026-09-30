# PRD, Pull Requests na aba Alterações

> Status: **Especificação técnica aprovada para implementação**.
> Origem: pedido do usuário sobre a aba Alterações (evidência na branch `fix/olist-product-brand-fallback`, anexo `95b8c12f932ce620.png`).
> Mock visual canônico: `docs/mocks/pull-requests-git.html`.
> Diretriz de marca: Frota (ADR-222). Nenhuma menção ao nome legado.

---

## 1. O pedido, nas palavras de quem usa

"Na nossa aba de git, alterações, voce acha que daria para adicionar informação sobre pull requests abertos? ou mergeados tambem? Voce é um engenheiro de software seniro nisso e construiu diversos forks de VsCode e entende muito disso, inclusive no Froa"

---

## 2. Evidência e diagnóstico do código atual

### 2.1 Ponto cego no rodapé da aba (`app/src/components/layout/DiffIndex.tsx`)
A aba Alterações tem um rodapé estático (linhas 498-509) que exibe permanentemente o botão:
```tsx
<GitPullRequest className="size-3" /> Abrir pull request
```
- **Sem detecção de PR existente:** Se a branch atual já possui um Pull Request aberto no GitHub, a Frota não sabe. Clicar em "Abrir pull request" abre o formulário e falha ao submeter (`gh pr create` devolve erro informando que o PR já existe).
- **Sem aviso de branch mergeada:** Quando um PR é aprovado e mergeado no GitHub, a pessoa continua trabalhando na branch local sem saber que ela já foi incorporada à branch principal (`main` ou `develop`), correndo risco de gerar commits em branches mortas.
- **Feedback efêmero:** Se o usuário abre o PR pelo app, o link fica guardado apenas no estado volátil `prUrl` da sessão React; ao trocar de aba ou reiniciar, a informação é perdida.

### 2.2 Capacidades já disponíveis no Backend Rust (`app/src-tauri/src/github.rs` e `git.rs`)
- O módulo `github.rs` já gerencia comunicação com o executável `gh` via `tokio::process::Command` com timeout de 4 segundos e parse estruturado.
- O comando `git_estado_do_repo` (`app/src-tauri/src/git_sync.rs`) já sinaliza se o repositório possui remoto no GitHub (`remoto_github: bool`).
- O `gh` CLI nativo na máquina já suporta consultar o PR associado à branch atual em formato JSON estruturado:
  ```bash
  gh pr view --json number,title,state,isDraft,url,reviewDecision,statusCheckRollup,mergedAt,baseRefName,headRefName
  ```

---

## 3. Decisões estruturais

### D1. Foco contextual na branch ativa primeiro
O maior ganho ergonômico no fluxo diário é o conhecimento sobre a **branch atual**. A UI evolui em dois pontos de contato:
1. **Cabeçalho:** Um chip compacto ao lado do nome da branch (ex: `#467` verde se aberto, roxo se mergeado) com link direto para o navegador.
2. **Rodapé contextual:**
   - **Sem PR:** Mantém o botão `[ ⑂ Abrir pull request ]`.
   - **PR Aberto:** Card compacto com número, título, checks de CI (`✓ N checks passando` ou `✕ falha`), reviews e botão `Abrir no GitHub`.
   - **PR Mergeado:** Card com badge de merge roxo (`--git-merged`), aviso explicativo e botão de um clique: `[ Voltar para main ]` (faz checkout seguro).

### D2. Desacoplamento assíncrono (Local-First inviolável)
O comando local `loadGitStatus` roda em ~5ms. Uma chamada de rede ao GitHub via `gh` leva entre 300ms e 1.2s.
- **Regra:** O render da aba Alterações **nunca** bloqueia aguardando a rede. A aba abre de imediato com os arquivos e status locais.
- A consulta do PR roda em segundo plano e preenche o card suavemente assim que resolver.

### D3. Cache em memória por pasta e branch
Para evitar chamadas desnecessárias ao processo `gh` a cada ganho de foco da janela:
- Guardamos o resultado em um cache `Map<string, PrStatus>` indexado por `${cwd}:${branch}`.
- O cache é invalidado em:
  1. Clique no botão de recarregar manual (↻).
  2. Envio de commits (push).
  3. Troca de branch.
  4. Sucesso na criação de um PR pelo `PrComposer`.

### D4. Degradação honesta e fail-open
- Se o projeto não tem remoto do GitHub (`remoto_github === false`), nenhuma chamada é feita.
- Se o `gh` não estiver instalado, não estiver autenticado ou a máquina estiver offline, o erro é absorvido silenciosamente (sem toasts invasivos) e a UI mantém o botão padrão.
- Se o comando retornar código diferente de zero com "no pull requests found", consideramos honestamente que não há PR para a branch (`null`).

### D5. Backend em `github.rs` (Respeitando a baseline de `git.rs`)
O arquivo `app/src-tauri/src/git.rs` está congelado no teto da baseline de tamanho. O novo comando Tauri `gh_pr_status` reside em `app/src-tauri/src/github.rs`, que foi projetado exatamente para as interações com o `gh` CLI.

---

## 4. Contrato de dados e interfaces

### 4.1 Estrutura no Rust (`app/src-tauri/src/github.rs`)
```rust
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PrStatusInfo {
    pub number: u64,
    pub title: String,
    /// "OPEN" | "MERGED" | "CLOSED"
    pub state: String,
    pub is_draft: bool,
    pub url: String,
    pub base_ref_name: String,
    pub head_ref_name: String,
    /// "APPROVED" | "CHANGES_REQUESTED" | "REVIEW_REQUIRED" | None
    pub review_decision: Option<String>,
    /// Quantidade de checks passando e com falha
    pub checks_passing: u32,
    pub checks_failing: u32,
    pub checks_pending: u32,
}
```

### 4.2 Comando Tauri
```rust
#[tauri::command]
pub async fn gh_pr_status(cwd: String, branch: String) -> Result<Option<PrStatusInfo>, String>
```

---

## 5. Critérios de Aceite

1. **CA1 (PR Aberto):** Em uma branch com PR aberto, o rodapé da aba Alterações exibe o número, título, checks e botão de abrir na web. O cabeçalho exibe badge `#N`.
2. **CA2 (PR Mergeado):** Em uma branch cujo PR já foi mergeado, o rodapé sinaliza em roxo que a branch foi incorporada e exibe o botão `Voltar para main` (ou base branch equivalente).
3. **CA3 (Sem PR):** Em uma branch sem PR, o rodapé continua exibindo o botão original `Abrir pull request`.
4. **CA4 (Sem bloqueio da tela):** A lista de arquivos modificados e o histórico continuam interativos instantaneamente, mesmo se a rede do GitHub estiver lenta ou indisponível.
5. **CA5 (Testes):** Testes unitários no Rust cobrindo o parse do JSON do `gh pr view` com dados reais e testes unitários no frontend validando a renderização dos diferentes estados.
