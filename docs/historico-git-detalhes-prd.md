# PRD, detalhes do histórico de alterações

> Status: **Especificação técnica aprovada para implementação**.
> Origem: pedido do usuário sobre a aba Alterações (evidência na branch `feat/olist-product-sync`, anexo `9b8ea7ea00a4977e.png`).
> Mock visual canônico: `docs/mocks/historico-git-detalhes.html` (aberto pelo comando `open docs/mocks/historico-git-detalhes.html`).
> Relação com PRDs anteriores: estende a seção BD4 de `docs/explorador-de-arquivos-prd.md` ("Histórico e desfazer").
> Diretriz de marca: Frota (ADR-222). Nenhuma menção ao nome legado.

---

## 1. O pedido, nas palavras de quem usa

"Quero que você estude a nossa feature da aba 'Alterações', principalmente como funciona a parte do 'Histórico' e pense como poderíamos incluir detalhes nesse histórico semelhante a ferramentas de desenvolvimento modernas como VS Code, Zed, etc."

---

## 2. Evidência e diagnóstico do código atual

### 2.1 Na Coluna Lateral (`app/src/components/layout/DiffPanel/HistoricoGit.tsx`)
A implementação atual do `HistoricoGit` (linhas 68-85) entrega uma lista estática com as seguintes restrições:
1. **Sem interatividade:** cada item é renderizado em um elemento `<li>` sem evento de clique (`onClick`), sem foco por teclado e sem estado ativo/selecionado (`bg-sel`).
2. **Sem visualização de arquivos tocados:** o desenvolvedor não tem visibilidade dos arquivos modificados por um commit anterior sem recorrer ao terminal ou ao GitHub.
3. **Sem abertura de diff:** a linha 370 do `docs/explorador-de-arquivos-prd.md` previa *"Clicar num commit abre o diff dele na aba de diff que já existe"*, mas essa navegação não foi conectada.
4. **Metadados truncados:** apenas a primeira linha do commit (`%s`) é trazida; corpo longo (`%b`), email do autor (`%ae`) e métricas de linhas alteradas (`+X −Y`) são ignorados.
5. **Gesto único isolado:** a única ação é o botão "Desfazer último commit" (`git reset --soft HEAD~1`). Faltam atalhos para copiar hash SHA, ver commit no navegador ou filtrar a lista.

### 2.2 No Backend Rust (`app/src-tauri/src/git_sync.rs`)
O comando Tauri `git_historico` (linhas 415-428) invoca:
```bash
git log -n <quantos> --format=%H%x1f%h%x1f%s%x1f%an%x1f%ct
git rev-list HEAD --not --remotes -n <quantos>
```
Ele retorna a estrutura `Commit`:
```rust
pub struct Commit {
    pub hash: String,
    pub curto: String,
    pub mensagem: String,
    pub autor: String,
    pub quando: i64,
    pub nao_enviado: bool,
}
```
Não existem comandos em Rust para obter os arquivos de um commit individual (`--numstat`) nem o patch unificado de um commit arbitrário (`git show <hash>`).

### 2.3 No Painel Principal (`app/src/components/layout/DiffPanel.tsx`)
O `loadGitDiff` opera exclusivamente sobre a área de trabalho não commitada (`git diff HEAD`). No entanto, o parser `parsePatch` (`app/src/lib/git.ts`, linha 300) é agnóstico e de alto rendimento (processa 120.000 linhas em 16ms), sendo capaz de consumir o unified diff de qualquer commit do Git sem alterações em sua lógica interna.

---

## 3. Decisões estruturais

### D1. Carga sob demanda (Lazy Loading) no Rust
A lista inicial do Histórico preserva o tempo de resposta instantâneo (<5ms para 20 commits). Arquivos tocados (`git show --numstat`) e o diff unificado (`git show <hash>`) só são consultados quando o usuário clica para expandir o commit ou para abri-lo no painel principal.

### D2. Dois níveis complementares de inspeção
1. **Nível 1 (Inline Accordion na Coluna):** um clique no chevron do commit expande uma gaveta leve dentro da própria coluna lateral. Mostra autor, data, corpo da mensagem e lista compacta de arquivos com badges `M`/`A`/`D`/`R` e contagem `+X −Y`.
2. **Nível 2 (Aba Inspecionar Commit no Painel Principal):** um clique no commit ou no botão "Abrir diff na aba" abre uma nova aba na tira superior (`MainTabs.tsx`) exibindo o cabeçalho canônico do commit e todos os hunks no `DiffPanel.tsx` já existente.

### D3. Reuso integral do visualizador de Diff
Zero duplicação de layout ou de parser. O componente `DiffPanel.tsx` recebe opcionalmente a propriedade `commitHash?: string`. Quando presente, lê o diff do commit em vez do diff da working tree, mantendo syntax highlighting, contagem de linhas e regras de corte (`MAX_LINHAS_POR_ARQUIVO`).

### D4. Filtro e busca local instantânea
A busca no Histórico opera na memória do cliente sobre os commits já carregados (filtrando por mensagem, autor ou hash curto), sem disparar novos processos no sistema operacional.

### D5. Decisão Humana no Cockpit de Agentes
A ação "Pedir ao agente para analisar" preenche o rascunho do composer da conversa ativa (`useComposerDrafts`) com o contexto do commit (hash, autor, mensagem e lista de arquivos modificados), sem despachar o envio automaticamente.

---

## 4. Contratos de dados

### 4.1 Backend Rust (`app/src-tauri/src/git_sync.rs`)

```rust
#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ArquivoDoCommit {
    pub caminho: String,
    pub caminho_antigo: Option<String>,
    pub status: String, // "modified" | "added" | "deleted" | "renamed"
    pub additions: u32,
    pub deletions: u32,
    pub binario: bool,
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DetalhesDoCommit {
    pub hash: String,
    pub curto: String,
    pub mensagem: String,
    pub corpo: String,
    pub autor: String,
    pub autor_email: String,
    pub quando: i64,
    pub pais: Vec<String>,
    pub arquivos: Vec<ArquivoDoCommit>,
    pub total_additions: u32,
    pub total_deletions: u32,
}
```

Comandos Tauri registrados em `lib.rs`:
* `git_detalhes_do_commit(cwd: String, hash: String) -> Result<DetalhesDoCommit, ErroDeGit>`:
  Executa `git show -s --format=%H%x1f%h%x1f%s%x1f%b%x1f%an%x1f%ae%x1f%ct%x1f%P <hash>` e `git diff-tree --no-commit-id --name-status --numstat -r -M <hash>` via `spawn_blocking`.
* `git_diff_do_commit(cwd: String, hash: String) -> Result<String, ErroDeGit>`:
  Executa `git show --patch --format="" <hash>` devolvendo o unified diff bruto.

### 4.2 Camada de Serviços TypeScript (`app/src/lib/gitSync.ts`)

```typescript
export interface ArquivoDoCommit {
  caminho: string
  caminhoAntigo: string | null
  status: "modified" | "added" | "deleted" | "renamed"
  additions: number
  deletions: number
  binario: boolean
}

export interface DetalhesDoCommit {
  hash: string
  curto: string
  mensagem: string
  corpo: string
  autor: string
  autorEmail: string
  quando: number
  pais: string[]
  arquivos: ArquivoDoCommit[]
  totalAdditions: number
  totalDeletions: number
}

export const detalhesDoCommit = (cwd: string, hash: string) =>
  invoke<DetalhesDoCommit>("git_detalhes_do_commit", { cwd, hash })

export const diffDoCommit = (cwd: string, hash: string) =>
  invoke<string>("git_diff_do_commit", { cwd, hash })
```

### 4.3 Navegação e Estado (`app/src/store/app.ts`)

A união discriminada `MainTab` passa a suportar visualização de commits:
```typescript
export type MainTab =
  | { kind: "conversa" }
  | { kind: "diff"; focusPath?: string; focusSeq?: number }
  | { kind: "commit"; hash: string; focusPath?: string; focusSeq?: number }
  | { kind: "arquivo"; path: string }
  | { kind: "navegador" }
```

Método de abertura:
```typescript
openCommitTab: (hash: string, focusPath?: string) => void
```

---

## 5. Superfícies de UI e Interação

### 5.1 Coluna Lateral (`HistoricoGit.tsx`)
* **Linha do Commit:**
  * Altura canônica 32px (`h-8`), interativa com `role="button"`.
  * Hash curto em fonte mono (`font-mono text-[11px] text-muted-foreground`).
  * Iniciais do autor em círculo de 16px ou avatar discreto.
  * Título do commit truncado com peso médio (`font-medium text-[12px] text-foreground/90`).
  * Badge de status: `"não enviado"` em `bg-secondary` neutro ou tempo relativo (`hoje`, `há 2 dias`).
  * Foco de teclado visível apenas sob intenção de navegação (`data-modalidade="teclado"`).
* **Barra de Filtro Local:**
  * Input no degrau `chip` (24px) no topo do histórico com ícone de busca.
  * Filtragem instantânea sem latência de rede ou disco.
* **Inline Accordion:**
  * Acionado pelo chevron à esquerda da linha.
  * Carrega os arquivos via `detalhesDoCommit(cwd, hash)`.
  * Exibe metadados, corpo do commit e a lista de arquivos com a mesma tipografia do `GitSection` (`M`/`A`/`D`/`R` e deltas `+ / −`).
  * Barra de ações rápidas: `[Abrir diff na aba]`, `[Copiar SHA]`, `[GitHub]`.

### 5.2 Tira de Abas (`MainTabs.tsx`)
* Quando `mainTab.kind === "commit"`, exibe uma aba com fechar (`AbaComFechar`):
  * Ícone `GitCommitHorizontal` (Lucide).
  * Rótulo: `commit: <curto>`.
  * Tooltip com o título completo do commit.

### 5.3 Painel Principal (`CommitTab.tsx` e `DiffPanel.tsx`)
* **Card de Cabeçalho do Commit:**
  * Assunto em destaque (`text-[14px] font-semibold`).
  * Corpo formatado com quebras de linha em `text-[12px] text-muted-foreground`.
  * Linha do autor: nome, email e data absoluta formatada com timezone local.
  * Pílula de SHA com 1 clique para copiar (`copyText`) e feedback no tooltip.
  * Link direto para abrir no navegador remoto (GitHub/GitLab) via `openUrl`.
  * Botão de cockpit: "Pedir ao agente para analisar".
  * Barra de métricas: `N arquivos alterados · +X adições · −Y remoções · Parent: <hash_pai>`.
* **Corpo do Diff:**
  * Reúso do `DiffPanel.tsx` alimentado com o patch de `diffDoCommit(cwd, hash)`.
  * Suporte nativo a hunks colapsáveis, cópia de trechos e visualização de imagens.

---

## 6. Requisitos com critérios de aceite

- **R1 (Carga sob demanda):** abrir a aba Alterações ou recolher/expandir a seção Histórico não deve disparar leituras de arquivos ou patches de commits anteriores; apenas a lista leve de até 20 commits é consultada.
  *Double check:* teste de integração Rust validando que `git_historico` executa apenas `git log` e `git rev-list`.

- **R2 (Expansão inline):** clicar no chevron de um commit na coluna deve carregar e exibir os arquivos modificados e seus deltas (`+X −Y`) sem fechar outros blocos da coluna.
  *Double check:* teste de componente Vitest em `HistoricoGit.test.tsx` verificando transição de estado fechado/aberto e chamada de `detalhesDoCommit`.

- **R3 (Filtro local):** digitar no campo de busca do Histórico deve filtrar os commits exibidos por substring em mensagem, autor ou hash sem requisições adicionais ao backend.
  *Double check:* teste unitário puro da função de filtragem com fixtures reais de histórico.

- **R4 (Abertura de aba de commit):** clicar no commit ou no botão "Abrir diff na aba" deve alternar `mainTab` para `{ kind: "commit", hash }` e exibir a aba correspondente na tira de abas.
  *Double check:* teste Vitest em `MainTabs.test.tsx` e `abasNoPrincipal.test.ts`.

- **R5 (Inspeção completa de diff):** a aba do commit deve exibir o cabeçalho canônico e renderizar o diff unificado de todos os arquivos tocados pelo commit, respeitando o limite `MAX_LINHAS_POR_ARQUIVO`.
  *Double check:* teste unitário em `git.test.ts` com fixture de `git show` parseada por `parsePatch`.

- **R6 (Cópia de SHA e URL remota):** o botão de cópia deve enviar o SHA completo de 40 caracteres para a área de transferência com aviso de confirmação. Se houver remoto do GitHub configurado, o botão do GitHub deve abrir a página do commit no navegador padrão.
  *Double check:* teste Vitest verificando chamada do `copyText` e formação da URL no padrão `https://github.com/<owner>/<repo>/commit/<hash>`.

- **R7 (Contexto para o agente):** o botão "Pedir ao agente para analisar" deve injetar o resumo das alterações no composer da conversa ativa via `useComposerDrafts.appendText`, sem disparar o envio.
  *Double check:* teste de integração do fluxo do composer verificando prefill de rascunho sem acionamento de `send`.

- **R8 (Regras do STYLEGUIDE e acessibilidade):** conformidade estrita com a paleta de tokens neutros (`sel`, `sel-hover`), escala tipográfica fechada (11/12/13/14px), controles em `chip` (24px) e suporte a navegação por teclado (`Enter`, `Espaço`, `Setas`).
  *Double check:* `bun run check` sem violação de lints de design e validação de `aria-expanded` nos botões de acordeão.

---

## 7. Orçamento de desempenho e integridade

1. **Latência de interface:**
   * Listagem de 20 commits: < 15ms.
   * Expansão inline (`git_detalhes_do_commit`): < 20ms para commits de até 50 arquivos.
   * Renderização do diff completo no painel principal: < 50ms para patches até 20.000 linhas.
2. **Uso de memória:**
   * Detalhes de commits abertos inline armazenados em cache volátil de componente (`Map<hash, DetalhesDoCommit>`), liberados ao trocar de repositório (`cwd`).
3. **Threading no backend:**
   * Toda chamada de Git roda obrigatoriamente dentro de `spawn_blocking`, sem bloquear a thread do runtime assíncrono nem a interface do Tauri.

---

## 8. Fora de escopo

* Rebase interativo ou reordenação visual de commits por arrastar e soltar (drag & drop).
* Grafo de árvore complexo em múltiplas colunas SVG coloridas (estilo GitGraph denso): o foco é utilidade de decisão e legibilidade tipográfica limpa estilo Zed.
* Edição retroativa de mensagens de commits antigos ou operações com `--force`.

---

## 9. Fatiamento de entrega

| Fase | Escopo | Arquivos Envolvidos |
|---|---|---|
| **F1: Contratos e Backend Rust** | Comandos `git_detalhes_do_commit` e `git_diff_do_commit` em Rust, tipos TypeScript em `gitSync.ts` e testes unitários com repositório temporário. | `app/src-tauri/src/git_sync.rs`, `app/src-tauri/src/lib.rs`, `app/src/lib/gitSync.ts`. |
| **F2: Coluna Lateral e Expansão Inline** | Linhas clicáveis com seleção neutra, busca local, acordeão inline de arquivos e ações rápidas (copiar SHA, abrir no GitHub). | `app/src/components/layout/DiffPanel/HistoricoGit.tsx`, `HistoricoGit.test.tsx`. |
| **F3: Painel Principal e Integração de Diff** | Aba de commit na tira (`MainTabs.tsx`), cabeçalho detalhado do commit, renderização de diff no `DiffPanel.tsx` e atalho de envio para o composer do agente. | `app/src/components/layout/MainTabs.tsx`, `app/src/store/app.ts`, `app/src/components/layout/CommitTab.tsx`, `app/src/components/layout/DiffPanel.tsx`. |
