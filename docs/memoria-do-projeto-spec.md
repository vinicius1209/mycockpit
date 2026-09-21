# SPEC · memória durável do projeto na Frota

> **Status:** Especificação revisada em 20/09/2026, pronta para execução.
> **Origem:** [`docs/memoria-do-projeto-plan.md`](./memoria-do-projeto-plan.md).
> **Depende de:** Fase 0 (rename `.mycockpit/` → `.frota/`), descrita na §2.
> **Frentes e contratos relacionados:** [`docs/memoria-de-conversa-plan.md`](./memoria-de-conversa-plan.md), [`docs/context-handoff.md`](./context-handoff.md), [`docs/busca-no-fio-prd.md`](./busca-no-fio-prd.md), [`docs/decisions.md`](./decisions.md) (ADR-213, ADR-220).
> **ADRs a abrir:** uma para o rename, uma para a memória durável. Confira o máximo real em `docs/decisions.md` antes de numerar (o máximo em 20/09/2026 é ADR-221).

---

## 1. Resultado técnico

Esta especificação define a **memória durável do projeto** na Frota: o aprendizado que hoje morre no fim da conversa passa a viver em arquivos Markdown versionados no repositório, legíveis por humanos, revisáveis em PR e disponíveis para qualquer motor conectado (Claude Code, Codex, Antigravity, o que vier).

**O disco é a única camada.** Não há índice derivado nesta versão. A pasta é a verdade, a varredura é a busca, e o que sobrevive a um reinício é tudo que existe.

### 1.1 Por que não há SQLite aqui (e quando ele entra)

A versão anterior desta SPEC propunha três tabelas, oito statements de migração, três triggers e um grafo materializado. Foi recusado por medição, não por gosto.

O corpus real mais próximo que existe hoje é a pasta de memória acumulada neste mesmo projeto ao longo de meses: **22 arquivos, 65.338 bytes no total, maior arquivo com 950 bytes**. O índice FTS5 da conversa, que justificou a ADR-220, opera sobre 41MB. Três ordens de grandeza de diferença.

Ler 65KB do disco e pontuar em memória custa microssegundos. O preço do índice, em contrapartida, é a conta mais cara da casa: **migração é história, não se edita**. Oito migrações irreversíveis para acelerar uma varredura que ninguém sente é gasto sem contrapartida.

E o disco como única camada dissolve quatro problemas de desenho de uma vez:

1. Não existe defasagem entre índice e arquivo, porque não existe índice. `git checkout` no meio de um turno troca os arquivos e a próxima busca já vê a troca.
2. O servidor MCP não precisa de `project_id`: ele já recebe a raiz do projeto em `FROTA_CONTEXT_ROOT` e lê dali.
3. Não existe contador de acesso para alguém esquecer de incrementar, nem conexão de escrita para furar o invariante read-only.
4. Não existe flag `is_superseded` gravada que o sync incremental esqueça de limpar quando o arquivo que invalidava é apagado.

**Gate para o SQLite entrar:** quando a varredura completa de `.frota/memory/` no corpus real passar de **15ms** medidos (o mesmo rigor da ADR-213, número colhido, não estimado), abre-se ADR própria para o índice. Até lá, a porta fica fechada e sem dívida.

---

## 2. Fase 0, pré-requisito: o nome é Frota

Esta frente propõe `.frota/memory/`. Isso só é coerente se `.mycockpit/` deixar de existir. Caso contrário a Frota passa a ter **duas casas no repositório para a mesma preocupação**: `.mycockpit/` guardando doutrina, personas, comandos e handoff, e `.frota/` guardando memória. Fronteira partida por acidente de cronologia.

Além disso, `.mycockpit/.gitignore` é `*` com allowlist explícita. Uma pasta `memory/` criada lá dentro nasceria **fora do git**, contradizendo o invariante 1 desta SPEC.

O rename tem etapas com riscos muito diferentes e **não é uma varredura só**. Decisão em **ADR-222**, plano completo em `docs/frota-rename-plan.md` (seção "A virada de 21/09/2026"). O que esta SPEC exige como pré-condição é só o passo 3 de lá:

- `.mycockpit/` → `.frota/`, com `.frota/.gitignore` ganhando `!memory/` e `!memory/**` na allowlist.

O rename inteiro foi decidido em 21/09/2026 (ADR-222) e vale para tudo, inclusive identificador do bundle, banco, Keychain e chaves persistidas. Os passos que tocam estado instalado fora do repositório **não bloqueiam** esta frente e correm depois. Só o rename da pasta é pré-condição daqui.

---

## 3. A fronteira com `lessons`: dois estágios, um bloco

A tabela `lessons` já existe e já entrega regra acionável por projeto no prompt (`app/src/lib/learning.ts`, `app/src/lib/fleet/promptCascade.ts`). Criar um segundo sistema ao lado dela colocaria **duas seções dizendo "regras aprendidas, siga-as"** no mesmo prompt, com dois critérios de morte diferentes e dois dedups.

A separação correta não é por tipo de conteúdo, é por **estágio de vida**, e `lessons` já modela isso (`LessonStatus = "active" | "candidate" | "archived"`, `app/src/lib/db.ts:348`).

> **Lição é o que o app suspeita. Memória é o que a pessoa assinou.**

| | `lessons` (existe) | `.frota/memory/` (nasce aqui) |
|---|---|---|
| origem | destilação automática de evento de alto sinal | promoção com gesto humano |
| onde vive | SQLite local da máquina | Markdown no git |
| viaja no clone | não | sim |
| revisável em PR | não | sim |
| morre por | curador (rebaixa a injetada que nunca foi reforçada) | `supersedes` declarado, e só |
| dedup | `ruleSimilarity` ≥ 0.6 (`learning.ts:186`) | o mesmo, no gesto de promoção |

**O card da Fase 4 não cria memória do nada: ele promove.** Ao promover, a lição de origem recebe o status `promoted` (valor novo na união de tipo em `db.ts:348`, nenhuma migração de schema). Como `listActiveLessons` só devolve ativas, a promovida sai do bloco de lições **sozinha**, e nada fica nos dois lados por construção.

**Um renderer, um bloco.** `renderLessons` (`learning.ts:150`) passa a receber as duas fontes já unidas e continua sendo o único lugar que formata regra de projeto para o prompt. Não se cria `formatProjectMemoryBlock`.

---

## 4. Invariantes

1. **O Markdown em disco é a única autoridade.** Não há cópia, índice ou cache com direito a discordar dele.
2. **Zero rede e zero LLM no caminho de leitura.** Varredura, pontuação, resolução de `supersedes` e montagem do bloco rodam nativos em Rust, local, sem chave de API e sem custo de token. A **captura** (rascunho da regra) pode usar o helper barato que já existe, e é opt-in: o invariante vale para ler, não para sugerir.
3. **A decisão é humana.** Nenhum arquivo é escrito em `.frota/memory/` sem clique explícito. O agente pede o gesto, a pessoa confirma.
4. **Fail-open no render, fail-closed no efeito.** Frontmatter corrompido em um arquivo degrada aquele arquivo para "não indexável" e o resto segue; nunca quebra o envio do turno. Escrita com pré-condição faltando aborta.
5. **Invalidação visível, nunca silenciosa.** Uma memória superada sai do bloco do prompt e some da busca padrão. Um `supersedes` que aponta para arquivo inexistente vira **aresta pendente reportada na UI**, não um no-op silencioso: a lei da casa é estado real, nunca teatro.
6. **O MCP permanece estritamente read-only.** Toda tool declara `readOnlyHint: true` e `destructiveHint: false`. Nenhuma tool exposta a CLI escreve arquivo ou banco.
7. **Agnosticismo de motor.** Nenhuma comparação de nome de motor no caminho de memória. Toda CLI recebe o mesmo contrato.
8. **Escrita atômica.** Arquivo temporário no mesmo diretório e `std::fs::rename`, para que uma queda no meio nunca deixe `.md` pela metade dentro do git.
9. **Copy em pt-BR, sem travessão.** Vírgula, ponto, parênteses; "·" e "→" são permitidos.

---

## 5. Não-regressões (verificadas contra o código, não presumidas)

- `mc-context` (que na Fase 0 vira `frota-context`) continua respondendo os mesmos contratos de `context_manifest`, `context_search` sem o parâmetro `scope`, e `context_read`. Cliente que não conhece `scope` não muda de comportamento.
- A busca léxica da conversa ativa (`conversation_item_fts`, ADR-220) não é tocada. Esta frente não cria tabela, não cria migração e não abre conexão de escrita nova.
- O bloco de regras injetado no prompt continua limitado **por contagem, não por caracteres**: `MAX_LESSONS_INJECTED = 8` (`learning.ts:28`), com cada regra já truncada em 300 caracteres na gravação (`learning.ts:201`). Não existe hoje, e não se inventa aqui, um teto de 2.500 caracteres. `MEMORIA_BUDGET = 3_000` (`memoriaDaConversa.ts:46`) pertence ao `/compactar` e é outra coisa.
- A promoção não apaga lição nenhuma: muda status. Reversível.

---

## 6. Autoridade e fluxo

```text
                     [Turno do agente concluído]
                                  |
                  +---------------+---------------+
                  v                               v
       [planGate aprovado]               [erro seguido de resolucao]
                  |                               |
                  +---------------+---------------+
                                  v
                    [licao candidata em `lessons`]
                      automatica, local, descartavel
                                  |
                        (card de promocao no cockpit)
                                  |
                          GESTO HUMANO EXPLICITO
                                  |
                                  v
                  [escrita atomica em .frota/memory/]
                  decisions/ gotchas/ procedures/ sessions/
                  + licao de origem marcada `promoted`
                                  |
              +-------------------+-------------------+
              v                                       v
     [inicio do proximo turno]              [consulta durante o turno]
     varredura -> supersedes -> top N        MCP frota-context stdio
     bloco unico via renderLessons           context_search(scope="project")
                                             memory_read(path)
```

O que atravessa reinício, troca de máquina e `rm -rf` do diretório de dados do app: **a pasta `.frota/memory/`, e só ela**. Tudo o mais é reconstruído na próxima varredura ou é descartável por desenho.

---

## 7. Modelo de dados

### 7.1 A pasta

```
.frota/
  .gitignore          # * + allowlist, agora com !memory/ e !memory/**
  memory/
    decisions/        # escolhas estruturais que sobreviveram ao gate
    gotchas/          # armadilha que ja custou retrabalho
    procedures/       # como se roda teste, lint, build, deploy aqui
    sessions/         # sumario de conversa, quando valeu a pena
```

**A identidade de uma memória é o caminho relativo dela dentro de `memory/`.** Não o campo `id:` do frontmatter, que é rótulo humano e pode repetir por descuido de template. Caminho é único por definição do sistema de arquivos, e é o que o `supersedes` cita.

Consequência assumida: mover ou renomear um arquivo **quebra** o `supersedes` que apontava para ele. Isso é correto e é preferível ao alternativo, porque a quebra é **visível** (a aresta vira pendente e a UI mostra), enquanto um id que sobrevive ao rename esconde a divergência entre o que o arquivo diz e o que o índice acha.

### 7.2 O arquivo

`.frota/memory/gotchas/numero-de-migracao.md`:

```markdown
---
title: Conferir a versão máxima de migração antes de numerar
kind: gotcha
tags: [sqlite, migrations, tauri]
created: 2026-09-20
salience: 1.0
is_invariant: true
supersedes: []
---

As migrações do SQLite em `app/src-tauri/src/lib.rs` são lineares e sequenciais.
Nunca infira o número da próxima somando 1 à que você acabou de ver no diff.
Confira a maior versão real no fim do vetor antes de criar a sua.
```

Campos, e quem é dono de cada um:

| campo | dono | obrigatório | nota |
|---|---|---|---|
| `title` | humano | sim | é o que entra no bloco do prompt |
| `kind` | derivado da pasta | não | a pasta manda; o campo é redundante e serve de conferência |
| `tags` | humano | não | default `[]` |
| `created` | app, na promoção | não | **não use mtime como idade**: corrigir um typo não rejuvenesce a regra. Ausente, cai para o mtime e é assim que os arquivos escritos à mão entram |
| `salience` | humano | não | default `1.0`, peso inicial |
| `is_invariant` | humano | não | default `false`. `true` = imune ao decaimento |
| `supersedes` | app ou humano | não | lista de caminhos relativos a `memory/` |

Só `supersedes` existe como relação nesta versão. `fixes`, `contradicts` e `causes` estavam no plano e **ficam de fora da v1**: nenhuma delas tem consumidor definido (a fusão RRF que as usaria também saiu), e relação sem leitor é campo que apodrece divergindo do código.

### 7.3 Tipos em Rust (`app/src-tauri/src/project_memory.rs`)

```rust
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MemoryKind {
    Gotcha,
    Decision,
    Procedure,
    Session,
}

/// Uma memória lida do disco. Não há linha de banco correspondente:
/// esta struct nasce da varredura e morre no fim da chamada.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectMemory {
    /// Identidade. Caminho relativo a `.frota/memory/`, com `/` sempre,
    /// inclusive no Windows, para que `supersedes` seja comparável.
    pub path: String,
    pub kind: MemoryKind,
    pub title: String,
    pub body: String,
    pub tags: Vec<String>,
    pub created_at: i64,
    pub salience: f64,
    pub is_invariant: bool,
    /// Derivado da varredura inteira, nunca de um arquivo só.
    pub is_superseded: bool,
    pub supersedes: Vec<String>,
}

/// O resultado de UMA varredura. É o índice inteiro, e é efêmero.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryScan {
    pub items: Vec<ProjectMemory>,
    /// `supersedes` que apontam para caminho que não existe na varredura.
    /// Vai para a UI. Invariante 5: quebra é visível, nunca no-op.
    pub pendentes: Vec<MemoryEdgePendente>,
    /// Arquivo cujo frontmatter não parseou. Fail-open: o resto entrou.
    pub ilegiveis: Vec<MemoryParseError>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryEdgePendente {
    pub source_path: String,
    pub target_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryParseError {
    pub path: String,
    pub motivo: String,
}
```

`rename_all = "camelCase"` nas structs que atravessam a fronteira Tauri, seguindo `conversation_items.rs:14`. O enum fica em `snake_case` porque o valor dele é dado, não nome de campo.

---

## 8. Algoritmos

### 8.1 Varredura e resolução de `supersedes`, em duas passadas

A ordem de leitura do diretório não pode mudar o resultado. Uma passada só torna a resolução dependente de quem foi lido primeiro, que é o bug que esta seção existe para não ter.

```
passada 1: le todo .frota/memory/**/*.md
           parseia frontmatter, monta Vec<ProjectMemory>
           arquivo que nao parseia vai para `ilegiveis` e o resto segue

passada 2: para cada item, para cada caminho em supersedes:
             alvo existe na passada 1?  -> marca alvo.is_superseded = true
             alvo nao existe?           -> empurra para `pendentes`
```

**Idempotência por construção:** o resultado depende só do conteúdo do diretório, nunca do estado anterior. Apagar o arquivo B que superava A faz A voltar a valer na varredura seguinte, sem ninguém precisar lembrar de limpar flag. Era o que a versão com coluna gravada não conseguia fazer.

### 8.2 Decaimento

$$\text{retention} = \text{salience} \cdot e^{-\lambda \Delta t}$$

```rust
pub struct DecayParams {
    /// 0.02 = meia-vida de ~35 dias para item nunca revisitado.
    pub lambda: f64,
    /// 0.20: abaixo disso, a memória nao entra no bloco do prompt.
    pub cold_threshold: f64,
}

impl Default for DecayParams {
    fn default() -> Self {
        Self { lambda: 0.02, cold_threshold: 0.20 }
    }
}

pub fn retencao(p: &DecayParams, m: &ProjectMemory, agora: i64) -> f64 {
    // Superada nao compete por contexto. Continua no git, continua legivel,
    // so nao entra no prompt.
    if m.is_superseded {
        return 0.0;
    }
    // Invariante declarada e imune ao tempo: foi isso que `is_invariant` quis dizer.
    if m.is_invariant {
        return 1.0;
    }
    let dias = ((agora - m.created_at).max(0) as f64) / 86_400.0;
    (m.salience * (-p.lambda * dias).exp()).clamp(0.0, 1.0)
}
```

**O termo de reforço por acesso saiu da v1.** No plano ele era `σ · ln(1 + access_count) · e^(-μ·dias_sem_acesso)`, e não havia quem incrementasse `access_count`: o consumidor natural é o servidor MCP, que roda em **outro processo** e abre o banco em `SQLITE_OPEN_READ_ONLY` (`context_gateway.rs:545`). Fórmula com termo que ninguém alimenta é teatro de sofisticação. O termo volta quando existir um canal de escrita que não fure o invariante 6, e com medição que mostre que o ranking sem ele erra.

**Decaimento ranqueia, nunca apaga.** O plano falava em "poda". Podar arquivo que a pessoa assinou e commitou é o app decidindo por ela, contra o invariante 3. Item frio some do bloco do prompt e continua no git, no disco e na busca explícita.

### 8.3 Busca

Reuso, não invenção. `pontuar()` (`context_gateway.rs:338`) é descrita no próprio arquivo como "a fórmula de relevância, em UM lugar só", já é a verdade de referência contra a qual o índice da conversa foi medido, e já foi comparada com BM25 e o BM25 perdeu (ADR-213). A busca de memória chama **essa** função sobre `title + body + tags`.

```
1. varredura (8.1)
2. descarta is_superseded, salvo include_superseded = true
3. pontua com `pontuar()`, os mesmos termos e as mesmas stopwords
4. multiplica pela retencao (8.2)
5. ordena, corta em N, snippet de 250 chars
```

Sem FTS, sem trigram, sem RRF. O trigram existe na conversa porque o corpus é código em 41MB; aqui o corpus é prosa em pt-BR com 65KB e a varredura já casa substring nativamente. A fusão RRF saiu junto com as relações que ela fundiria (§7.2).

---

## 9. Interfaces

### 9.1 MCP (`context_gateway.rs`)

Duas mudanças, ambas retrocompatíveis.

**`context_search` ganha `scope`.** Ausente ou `"conversation"` = comportamento de hoje, byte por byte.

```json
{
  "name": "context_search",
  "description": "Busca sob demanda no histórico da conversa corrente ou na memória durável do projeto (decisões, gotchas e procedimentos). Retorna referências compactas.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "query": { "type": "string", "description": "Termo, identificador ou frase a localizar." },
      "scope": {
        "type": "string",
        "enum": ["conversation", "project", "all"],
        "default": "conversation",
        "description": "conversation = histórico da conversa ativa; project = memória durável do projeto; all = ambos."
      },
      "limit": { "type": "integer", "minimum": 1, "maximum": 10, "default": 6 }
    },
    "required": ["query"],
    "additionalProperties": false
  },
  "annotations": {
    "readOnlyHint": true, "destructiveHint": false,
    "idempotentHint": true, "openWorldHint": false
  }
}
```

**`memory_read`, nova.**

```json
{
  "name": "memory_read",
  "description": "Lê na íntegra um documento da memória do projeto pelo caminho relativo (ex: 'gotchas/numero-de-migracao.md').",
  "inputSchema": {
    "type": "object",
    "properties": {
      "path": { "type": "string", "description": "Caminho relativo dentro de .frota/memory/" }
    },
    "required": ["path"],
    "additionalProperties": false
  },
  "annotations": {
    "readOnlyHint": true, "destructiveHint": false,
    "idempotentHint": true, "openWorldHint": false
  }
}
```

**De onde vem a raiz.** `scope="project"` resolve a pasta como `FROTA_CONTEXT_ROOT/.frota/memory/`. A variável já existe (hoje `MYCOCKPIT_CONTEXT_ROOT`, `context_gateway.rs:21`, renomeada na Fase 0) e já é populada em todo run (`GatewayConfig::apply_env`). **Nenhuma variável de ambiente nova, e nenhum `project_id`**: a raiz é o projeto. Era um acoplamento que a versão com banco tinha e não sabia fechar, porque `project_id` é identidade do frontend e o MCP nunca a recebeu.

**Travessia de caminho.** `memory_read` reusa o clamp de raiz de `read_project_file` (`context_gateway.rs:611`), com a raiz apertada de `ROOT` para `ROOT/.frota/memory`. Canonicaliza e rejeita o que sair da pasta, inclusive por symlink. Sem exceção para `..`.

### 9.2 Comandos Tauri

| comando | assinatura | nota |
|---|---|---|
| `project_memory_scan` | `(root_path: String) -> Result<MemoryScan, String>` | Varredura completa (§8.1). É a única leitura, e serve busca, bloco do prompt e UI. Sem estado entre chamadas. |
| `project_memory_write` | `(root_path: String, item: NovaMemoria) -> Result<String, String>` | Escrita atômica (invariante 8). Recusa caminho fora de `memory/` e recusa sobrescrever arquivo existente sem `overwrite: true`. |
| `project_memory_retire` | `(root_path: String, path: String, por: String) -> Result<(), String>` | Adiciona `path` ao `supersedes` do arquivo `por`. Não apaga nada, não marca nada: escreve no frontmatter de quem invalida, que é onde a verdade mora. |

`project_memory_sync` **não existe**. Não há o que sincronizar.

**Cache, se doer:** se a varredura a cada envio incomodar na prática, o cache entra em memória no processo do app, com invalidação por mtime da pasta, e morre junto com o app. Nunca em disco, nunca no SQLite. Cache que sobrevive ao processo é índice, e índice tem ADR (§1.1).

---

## 10. Injeção no prompt

`buildLearningBlocks` (`learning.ts:41`) passa a unir as duas fontes antes de renderizar. Mudança de uma função, não de uma cascata.

```
1. listActiveLessons(projectId)            -> candidatas (ja exclui `promoted`)
2. project_memory_scan(projectPath)        -> promovidas
3. descarta is_superseded e retencao < cold_threshold
4. ordena: is_invariant primeiro, depois retencao, depois `uses`
5. corta em MAX_LESSONS_INJECTED (8)
6. renderLessons(lista unica)
```

Regras a respeitar, cada uma por um motivo que já custou caro:

- **Filtre na consulta, não no render.** O invariante 5 diz que superada nunca entra no working set. Filtrar dentro do renderer significa que a conta dos 8 já foi feita sobre o conjunto errado, e o bloco sai com menos regra do que cabia.
- **Um renderer só.** `renderLessons` continua sendo o único lugar que formata regra de projeto. Não se cria um segundo com o mesmo cabeçalho e a mesma frase.
- **Cap é de contagem.** Não se introduz teto de caracteres novo. Se for preciso um, ele vem com medição e ADR, não com constante inventada na SPEC.
- **A cascata não muda.** `promptCascade.ts` continua recebendo `lessonsBlock` pronto. De dentro pra fora: notas → lições → doutrina. Memória de projeto é lição promovida e entra na camada de lição, não numa camada nova.

---

## 11. Testes

A lei da casa: **fixture com payload REAL**. Os arquivos de memória usados nos testes são colhidos, não inventados. A pasta acumulada deste projeto (22 arquivos reais) é o corpus de partida.

### 11.1 Rust (`cargo test` em `app/src-tauri`)

1. **`project_memory_scan_test.rs`**
   - Varredura de fixture real em tmpdir, com subpastas, acentos e um arquivo de frontmatter quebrado.
   - Valida fail-open: o quebrado aparece em `ilegiveis` e **todos** os outros entram.
   - **Valida independência de ordem:** roda a varredura com a ordem do diretório embaralhada e exige `MemoryScan` idêntico. É o teste que protege a §8.1.
2. **`project_memory_supersedes_test.rs`**
   - A superada por B: `is_superseded` de A é `true` e A some do resultado padrão.
   - `include_superseded = true` devolve A carimbada.
   - **Apagar B e revarrer devolve A ao ativo**, sem intervenção. É o teste de idempotência que a versão com coluna gravada não passava.
   - `supersedes` para caminho inexistente vira `pendentes`, nunca no-op.
3. **`project_memory_escrita_test.rs`**
   - Escrita atômica: nenhum `.md` parcial fica no diretório se a escrita falhar no meio.
   - Recusa caminho com `..`, caminho absoluto e symlink que saia de `memory/`.
   - Recusa sobrescrever sem `overwrite`.
4. **`decay_test.rs`**
   - Vetores fechados: 0 dias = `salience`; 35 dias com salience 1.0 ≈ 0.50; 120 dias < `cold_threshold`; `is_invariant` = 1.0 em qualquer idade; superada = 0.0.
5. **`context_gateway_test.rs`** (estende o existente)
   - `tools/list` traz `memory_read` e o `scope` em `context_search`, com `readOnlyHint: true` nas duas.
   - **Não-regressão:** `context_search` sem `scope` devolve exatamente o payload de hoje.
   - `memory_read("../../etc/passwd")` é recusado.

### 11.2 TypeScript (`bun run test` em `app/`)

1. **`projectMemory.test.ts`** · parse de frontmatter dos arquivos reais, defaults corretos quando o campo falta, `kind` vindo da pasta.
2. **`learningBlocks.test.ts`** · a união das duas fontes respeita `MAX_LESSONS_INJECTED`, põe `is_invariant` na frente, e **não** deixa passar superada nem fria. Lição `promoted` não aparece.
3. **`promocao.test.ts`** · promover marca a lição de origem como `promoted`; promover regra 85% parecida com memória existente é barrado por `isNovelRule` **antes** de incomodar a pessoa.

Para ler arquivo de fonte em teste, `import.meta.glob(..., { query: "?raw", import: "default", eager: true })`. `node:fs` não existe no `tsconfig` de `src/`, e isso já passou por uma fresta do `tsc --noEmit`.

---

## 12. Fases e gates

| fase | entrega | gate de aceite |
|---|---|---|
| **0. Nome** | `.mycockpit/` → `.frota/` (passo 3 de `docs/frota-rename-plan.md`), `.frota/.gitignore` com `!memory/` e `!memory/**`, e a guarda `scripts/check-marca.mjs` ampliada (ela JÁ existe e roda no CI; o cabeçalho dela ainda ensina a decisão revogada) | `bun run check` acusa qualquer "mycockpit" novo em qualquer casing; `cargo test` e `bun run test` verdes; app abre e acha o handoff |
| **1. Leitura** | `project_memory.rs`: varredura em duas passadas, `supersedes`, decaimento, pontuação via `pontuar()`. Comando `project_memory_scan` | `cargo test` verde nos testes 1, 2 e 4 da §11.1, **incluindo a revarredura pós-remoção** |
| **2. MCP** | `scope` em `context_search` e `memory_read` no gateway | cliente antigo sem `scope` não muda de comportamento; `memory_read` recusa travessia; annotations preservadas |
| **3. Prompt** | `buildLearningBlocks` unindo as duas fontes, um renderer só | vitest: bloco único, cap de 8 respeitado, invariante na frente, superada e fria fora, `promoted` fora |
| **4. Promoção** | Escrita (`project_memory_write`, `project_memory_retire`) e o card de promoção no cockpit | nada é escrito em `.frota/memory/` sem clique; promover marca a origem; dedup barra a quase-duplicata |

A ordem importa: **3 antes de 4**. Ler antes de escrever é o que garante que o primeiro arquivo promovido tenha para onde ir. No plano original a Fase 2 servia `memory_read` sobre uma pasta que só nasceria na Fase 3.

---

## 13. Fora da v1, e por quê

| item | por quê ficou fora |
|---|---|
| Índice SQLite, FTS5 trigram, `memory_edges` | corpus real de 65KB contra 41MB da conversa. Oito migrações irreversíveis sem ganho medido. Gate de reabertura na §1.1 |
| Relações `fixes`, `contradicts`, `causes` | sem consumidor definido. Relação sem leitor apodrece divergindo do código |
| Fusão RRF | fundiria as relações acima. Sem elas, é `pontuar()` com um multiplicador |
| Reforço por acesso no decaimento | ninguém pode incrementar sem furar o invariante 6. Volta com canal e com medição |
| Poda automática de memória fria | apagar arquivo assinado pela pessoa é o app decidindo por ela (invariante 3). Frio sai do prompt e fica no git |
| `sessions/` populada automaticamente | a pasta existe no layout, mas sumário de conversa é outra frente (`memoria-de-conversa-plan.md`). Nada escreve lá na v1 |
| Rename dos passos 4 a 8 (env, headers, servers, chaves persistidas, identidade do app) | decididos em 21/09/2026 (ADR-222) e planejadas em `docs/frota-rename-plan.md`, mas correm **depois** desta frente: tocam estado fora do repositório (hooks instalados, diretório de dados, perfis de navegador) e não são pré-condição da memória durável |
