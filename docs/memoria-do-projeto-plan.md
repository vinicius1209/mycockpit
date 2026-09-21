# A memória viva do projeto: do chat efêmero à superinteligência durável (plano)

> **Status:** Proposto em 19/09/2026.  
> **Objetivo:** Dotar o Frota de memória de longo prazo contínua, cross-session e cross-agent, inspirada na arquitetura do `ai-memory` (Akita on Rails) e alinhada com as diretrizes e leis do Frota (Tauri 2, React 19, Rust, SQLite, local-first, decisão humana).  
> **A pergunta que guia este plano:** *"Como fazer o Frota acumular inteligência sobre o projeto para que o desenvolvedor nunca mais precise perder tempo lembrando os agentes sobre decisões passadas, gotchas e procedimentos?"*

---

## 1. O Diagnóstico Atual (Double-Check do Código do Frota)

Uma verificação profunda na árvore atual do repositório revelou um ecossistema com fundações sólidas, mas com um elo quebrado entre sessões:

### O Que Já Está Construído e Funciona Bem
1. **Orçamento por Significado (G1 em [`lib/memoriaDaConversa.ts`](file:///Users/viniciusmachado/projetos/mycockpit/app/src/lib/memoriaDaConversa.ts)):**  
   Provado com medições reais: 90% dos bytes de uma conversa são ruído de ferramentas (`tool`), e a intenção humana (`user`) ocupa <1%. O G1 já filtra o que importa no `/compactar` e na exportação do transcript.
2. **Índice FTS5 com Trigram no SQLite (Migrações 52 a 59 em [`lib.rs`](file:///Users/viniciusmachado/projetos/mycockpit/app/src-tauri/src/lib.rs)):**  
   Entregue em ADR-213 e ADR-220: busca de texto ultrarrápida no banco local com tokenizador `trigram`, capaz de localizar identificadores em camelCase (como `useWatchdog`) no histórico.
3. **Gateway MCP Read-Only ([`context_gateway.rs`](file:///Users/viniciusmachado/projetos/mycockpit/app/src-tauri/src/context_gateway.rs)):**  
   Subcomando `context-server` (`mc-context`) que atende Claude Code, Codex, Antigravity e outros via stdio com annotations `readOnlyHint`, provendo `context_manifest`, `context_search` e `context_read`.
4. **Protótipo de Lições ([`learning.ts`](file:///Users/viniciusmachado/projetos/mycockpit/app/src/lib/learning.ts)):**  
   Tabelas de `deliveries` e `lessons` com ranking de usos e reforço via 👍.

### As Três Fraturas que Geram Perda de Tempo
1. **Memória Confinada à Conversa Ativa:**  
   O MCP `mc-context` busca exclusivamente dentro da conversa atual (`WHERE conversation_id = ?`). Se você abrir uma nova conversa amanhã no mesmo projeto, o agente nasce completamente amnésico.
2. **Lições Isoladas no Frontend e Sem Estrutura Semântica:**  
   A tabela `lessons` guarda apenas strings simples ("não quebrar o contrato"). Não possui categorização (decisões, armadilhas, procedimentos), não é exposta pelo MCP do Rust aos agentes e não possui versionamento em arquivos legíveis pelo humano.
3. **Falta de Invalidação (`supersedes` / Fase G3 pendente):**  
   Se uma decisão tomada na semana passada foi superada por outra hoje, ambas competem pelo contexto. O agente lê "vamos usar polling" e "trocamos polling por websocket" como fatos simultaneamente válidos, gerando alucinações caras.

---

## 2. A Arquitetura em Duas Camadas: Markdown + SQLite

Inspirada no modelo do `ai-memory`, mas embutida diretamente no runtime Rust/Tauri do Frota, sem servidores externos, daemons ou containers:

```
┌─────────────────────────────────────────────────────────────────┐
│                    DISCO DO PROJETO (Git)                       │
│                                                                 │
│   .frota/memory/ (ou .mycockpit/memory/)                        │
│   ├── decisions/     ADRs e escolhas estruturais (planGates)    │
│   ├── gotchas/       Armadilhas e lições aprendidas em código   │
│   ├── procedures/    Comandos de teste, lint, build e deploy    │
│   └── sessions/      Sumários de conversas passadas             │
│                                                                 │
│   Fonte da verdade · Editável por humanos · Git versionado      │
└────────────────┬────────────────────────────────────────────────┘
                 │ Reconciliação / Watcher / Reindex
                 ▼
┌─────────────────────────────────────────────────────────────────┐
│                  SQLITE LOCAL DA FROTA (Rust)                   │
│                                                                 │
│   tabela project_memories                                       │
│   tabela project_memories_fts (FTS5 trigram)                    │
│   tabela memory_edges (supersedes, fixes, contradicts, causes)  │
│   tabela memory_decay (salience, acessos, meia-vida)            │
│                                                                 │
│   Índice derivado rápido · Busca sub-milissegundo · Reconstruível│
└────────────────┬────────────────────────────────────────────────┘
                 │ MCP stdio (mc-context)
                 ▼
┌─────────────────────────────────────────────────────────────────┐
│                  AGENTES (Claude, Codex, Agy)                   │
│                                                                 │
│   Push compacto no boot + Pull sob demanda durante o turno      │
└─────────────────────────────────────────────────────────────────┘
```

### Camada 1: O Markdown no Projeto (Fonte da Verdade)
Os arquivos vivem em `.frota/memory/` (com fallback retrocompatível para `.mycockpit/memory/`):
* Cada conceito possui seu próprio arquivo `.md` com cabeçalho YAML padronizado:
```yaml
---
id: gotcha-tauri-migration-max
title: Conferir versão máxima de migração antes de numerar
kind: gotcha
tags: [sqlite, migrations, tauri]
salience: 1.0
is_invariant: true
relations:
  causes: []
  fixes: []
  contradicts: []
  supersedes: []
---

No Frota, as migrações SQLite em `app/src-tauri/src/lib.rs` são lineares e sequenciais.
Sempre confira a maior versão existente no arquivo antes de registrar uma nova.
```

### Camada 2: O SQLite como Índice Derivado
Se o banco SQLite for apagado ou restaurado, uma varredura de `.frota/memory/` repovoa a tabela `project_memories` e seu índice FTS5 instantaneamente.
* **Busca textual:** FTS5 com `trigram` (aproveitando o mesmo padrão da ADR-220 para bater termos em camelCase).
* **Relações de Invalidação:** Tabela `memory_edges` conectando nós por id.

---

## 3. As Quatro Peças Algorítmicas

### Algoritmo 1: O Grafo de Invalidação (`supersedes`) — A Solução do G3
A tese de [memoria-de-conversa-plan.md](file:///Users/viniciusmachado/projetos/mycockpit/docs/memoria-de-conversa-plan.md) é estendida para o projeto:
* O que o grafo resolve é **o que NÃO é mais verdade**.
* Quando uma decisão ou gotcha ganha uma aresta `supersedes -> <id_antigo>`, o nó antigo recebe `is_superseded = 1` no banco.
* **Regra de ouro na montagem do contexto:** Nós marcados como `is_superseded` **nunca** entram no working set padrão injetado no prompt, e nas buscas MCP eles vêm rebaixados com score zero a menos que a busca peça explicitamente `include_superseded: true`.
* **Resultado prático:** O agente novo nunca mais tentará aplicar soluções que a equipe já descartou.

### Algoritmo 2: Fórmula Matemática de Decaimento Puro (`decay.rs`)
Memória que acumula lixo sem critério de poda intoxica o contexto. Em vez de pagar chamadas caras de LLM para "resumir o lixo", adotamos a fórmula analítica pura validada no `ai-memory`:

$$\text{retention} = \text{salience} \cdot e^{-\lambda \Delta t} + \sigma \cdot \ln(1 + \text{access\_count}) \cdot e^{-\mu \cdot \text{dias\_sem\_acesso}}$$

* $\lambda = 0.02$: Meia-vida cronológica de ~35 dias para itens não revisitados.
* $\sigma = 0.6$: Bônus logarítmico para memórias frequentemente consultadas pelos agentes.
* $\mu = 0.04$: Fator de amortecimento de recência.
* `is_invariant: true`: Itens marcados como invariantes (regras absolutas de arquitetura) recebem imunidade total ao decaimento.
* **Sem custo de API:** A função roda em microssegundos no Rust (`f64`), mantendo o Frota 100% local-first.

### Algoritmo 3: Busca Híbrida com RRF (Reciprocal Rank Fusion)
A consulta MCP combina duas forças:
1. **FTS5 Trigram:** Cobertura léxica exata e de substrings em identificadores de código.
2. **Grafo de Relações:** Expansão de vizinhos conectados por `causes` e `fixes`.
3. **Fusão RRF:**
$$RRF(d) = \sum \frac{1}{k + rank_i(d)} \times \text{autoridade}(d)$$
Onde a autoridade favorece regras invariantes e penaliza itens obsoletos ou com pontuação fria de retenção.

### Algoritmo 4: Captura Passiva com Decisão Humana Ativa
Respeitando a lei fundamental do Frota: **A decisão é humana. Nada de despacho ou alteração automática sem confirmação.**
1. **Sinal de Alto Valor:**  
   - Um item `planGate` é aprovado pelo usuário no chat.
   - Um erro de ferramenta (`error`/`limit`) é sucedido por uma resolução bem-sucedida no mesmo arquivo.
   - O usuário clica em 👍 no fim de um turno.
2. **Proposta de Aprendizado:**  
   O sistema gera um rascunho de regra/gotcha (via prompt leve local ou utilitário).
3. **O Gate no Cockpit:**  
   A interface exibe um card discreto no topo ou no composer:
   > *"O agente aprendeu: 'Conferir versão máxima de migração antes de numerar'. Deseja salvar na memória do projeto?"*  
   > `[Salvar como Gotcha]` `[Editar]` `[Ignorar]`
4. Ao aprovar, o arquivo `.frota/memory/gotchas/...md` é escrito no disco e indexado no SQLite.

---

## 4. Evolução do MCP `mc-context` ([`context_gateway.rs`](file:///Users/viniciusmachado/projetos/mycockpit/app/src-tauri/src/context_gateway.rs))

O servidor MCP stdio ganha novos poderes mantendo estrita compatibilidade com versões anteriores:

```json
{
  "name": "context_search",
  "description": "Busca no histórico da conversa corrente ou na memória durável do projeto.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "query": { "type": "string", "description": "Termos a localizar" },
      "scope": { 
        "type": "string", 
        "enum": ["conversation", "project", "all"], 
        "default": "conversation",
        "description": "Onde buscar: apenas no fio atual, na memória do projeto, ou em ambos."
      },
      "limit": { "type": "integer", "minimum": 1, "maximum": 10 }
    },
    "required": ["query"]
  }
}
```

Nova ferramenta auxiliar de memória:
```json
{
  "name": "memory_read",
  "description": "Lê na íntegra um documento de decisão, gotcha ou procedimento da memória do projeto.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "path": { "type": "string", "description": "Caminho relativo em .frota/memory/ (ex: gotchas/vite-node-fs.md)" }
    },
    "required": ["path"]
  },
  "annotations": { "readOnlyHint": true }
}
```

---

## 5. Estratégia Completa de Testes

Como rege a lei da casa: **"Fixture com payload REAL, colhido de stream ou incidente: fixture inventada esconde bug."**

### 1. Testes Unitários em Rust (`app/src-tauri` via `cargo test`)
* **`decay_math_test.rs`:**  
  Vetor de testes fechado garantindo as propriedades da fórmula de decaimento:
  - Idade avançada sem acessos converge para valores abaixo de `cold_threshold` (0.20).
  - Acessos frequentes e recentes ressuscitam o score.
  - `is_invariant = true` mantém score máximo independente do tempo.
* **`memory_fts_contract_test.rs`:**  
  Gêmea SQL validando que a inserção de um item na tabela `project_memories` aciona o trigger FTS5 e que termos com letras maiúsculas, underscores e camelCase são encontrados pelo trigram.
* **`memory_invalidation_test.rs`:**  
  Garante que ao inserir uma aresta `supersedes`, o item apontado passa a ser ignorado por queries que não declarem `include_superseded`.

### 2. Testes Unitários em TypeScript (`app/src` via `bun run test` / vitest)
* **`projectMemory.test.ts`:**  
  Parsing de frontmatter YAML em Markdown, validação de tipos de dados (`kind: "gotcha" | "decision" | "procedure"`).
* **`budgetCascade.test.ts`:**  
  Garante que o bloco de memória de projeto respeita o teto de tokens (~2.000 chars) no prompt cascade sem estourar o orçamento do composer.
* **`dedupRules.test.ts`:**  
  Garante que uma regra semelhante em 80% de tokens com outra já existente é descartada antes de incomodar o usuário.

### 3. Testes de Contrato de MCP (`context_gateway_test.rs`)
* Simulação de cliente JSON-RPC via stdio testando `initialize`, `tools/list`, `context_search(scope="project")` e `memory_read`.
* Verificação rigorosa de que todas as tools contêm `readOnlyHint: true` para evitar que o Codex trave em headless pedindo aprovação.

---

## 6. Fases de Execução e Roadmap Incremental

| Fase | Escopo | Arquivos Envolvidos | Aceite |
|---|---|---|---|
| **Fase 1: Schema SQLite & Backend Rust** | Migração 60 no SQLite (`project_memories`, FTS5 trigram, `memory_edges`). Módulo Rust `project_memory.rs` com busca e decaimento. | `app/src-tauri/src/lib.rs`<br>`app/src-tauri/src/project_memory.rs` | `cargo test` passa com 100% de cobertura nos algoritmos puros. |
| **Fase 2: Expansão do MCP `mc-context`** | Permitir que `context_search` consulte a memória do projeto via `scope="project"` e servir `memory_read`. | `app/src-tauri/src/context_gateway.rs` | Agente via stdio consegue buscar e ler arquivos de memória com `readOnlyHint`. |
| **Fase 3: Armazenamento em Markdown (`.frota/memory`)** | Sincronizador bidirecional: lê arquivos `.md` do repositório, extrai YAML frontmatter e indexa no SQLite no boot. | `app/src/lib/projectMemory/`<br>`app/src-tauri/src/project_memory_fs.rs` | Criar um `.md` manualmente no disco reflete no SQLite sem restart do app. |
| **Fase 4: Injeção Inteligente no Prompt Cascade** | No `handleSend` / `sendFromDesk`, incluir no prompt inicial o bloco compilado das lições e decisões de maior autoridade do projeto. | `app/src/lib/fleet/promptCascade.ts`<br>`app/src/lib/handoff.ts` | O agente recebe o contexto no primeiro turno sem necessidade de o usuário digitar nada. |
| **Fase 5: UI do Gate de Aprendizado** | Card discreto no Cockpit quando um `planGate` é aprovado ou turno com 👍 encerra, permitindo com um clique gravar um novo gotcha. | `app/src/components/chat/MemorySuggestionCard.tsx` | Decisão humana preservada: nada é gravado no repositório sem confirmação. |

---

## 7. O Que Esta Arquitetura Entrega

1. **Aceleração Real do Trabalho:** O usuário nunca mais precisará escrever *"lembre-se de que neste projeto os testes rodam com bunx tsc -b"*. O agente já sabe antes do primeiro comando.
2. **Imunidade a Alucinações de Contexto Velho:** Graças ao grafo de `supersedes`, planos e decisões descartadas deixam de competir com as vigentes.
3. **Independência Total de Nuvem e Modelos Pagos:** Todo o mecanismo de indexação, busca, decaimento e grafo funciona em Rust localmente com custo zero de tokens.
4. **Transparência Absoluta:** O conhecimento acumulado pertence ao usuário, em Markdown sob controle do Git, visível e editável a qualquer momento.
