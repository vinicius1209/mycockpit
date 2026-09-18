# Busca no fio: medição de FTS5 contra a varredura atual

Data: 18/09/2026, macOS. Decisão: ADR-213. PRD: `docs/busca-no-fio-prd.md`.

## Como foi medido

Sobre uma **cópia** do banco real (`dev.vinicius.mycockpit/mycockpit.db`, 36MB,
22 conversas, 11.421 itens). O banco vivo foi aberto apenas em `mode=ro` e não
foi alterado. `bench.py` porta **fielmente** o `searchable_text`
(`context_gateway.rs:484`) e o `tokens` (`:514`) do Rust, para que o lado
"atual" da comparação seja o algoritmo de produção e não uma aproximação.

Python é teto pessimista dos dois lados. Em Rust ambos caem; o que sustenta a
decisão é a razão entre eles, não o número absoluto.

## Os scripts

| arquivo | o que responde |
|---|---|
| `bench.py` | porte fiel do algoritmo atual; constrói o índice; FTS5 puro vs varredura |
| `bench2.py` | por que `"erro de build"` custava 16ms fixos; variantes de montagem da query |
| `bench3.py` | qualidade (sobreposição do top-10), custo de escrita, tamanho com e sem texto |
| `bench4.py` | híbrido (FTS5 como candidato + score atual); fidelidade e perda irredutível |
| `bench5.py` | varredura do limite de candidatos: onde fica o joelho de fidelidade |

Rodar na ordem, do próprio diretório (`bench2`..`bench5` importam `bench`), com
`SRC`/`FTS` apontando para uma cópia, nunca para o banco vivo.

## Os resultados que sustentam a ADR

Decomposição do custo atual, maior conversa (3.199 itens, blob de 5,0MB):
`SELECT` 53ms · parse 25ms · **varredura 28ms**. A varredura, que o rascunho
culpava, é o terço mais barato.

FTS5 puro como substituto: 30x mais rápido, **32% de sobreposição no top-10**.
Recusado, muda o que o agente enxerga.

FTS5 como gerador de candidatos, score atual preservado:

| candidatos | fidelidade | p95 |
|---|---|---|
| 50 | 71% | 5,5ms |
| 200 | 86% | 7,3ms |
| **800** | **97%** | 15,3ms |
| ilimitado | 97% | 17,1ms |

Na maior conversa, com 800 candidatos: mediana 61,5ms → **4,3ms** (14x), pior
caso 66,4ms → 15,9ms, fidelidade 97%.

Escrita: 0,55ms por item (p95 1,14ms). Construção: 0,58s para 11.353 itens.
Índice: 23,8MB guardando o texto (7,7MB vs 3,0MB contentless, por 3.191 itens).

Patológico: `de*` casa 7.976 documentos, e `"erro de build"` custava 16ms
independentes do tamanho da conversa. Stopwords fora + prefixo só em token de
4+ caracteres derruba para 1-2ms.

Perda irredutível: 3%, com candidatos ilimitados. É o piso da técnica: o score
atual casa por substring e acha o termo no meio da palavra; índice de tokens
não faz isso nem com prefixo.
