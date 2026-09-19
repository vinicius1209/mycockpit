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
| `bench6.py` | **double check:** 3 caminhos (blob, `conversation_items`, FTS5 sobre a tabela) |
| `bench7.py` | a extração em SQL é gêmea exata do `searchable_text` do Rust? |
| `bench8.py` | varredura de candidatos refeita sobre o índice vindo da tabela |
| `bench9.py` | custo e correção dos triggers na escrita |
| `bench10.py` | triggers sob `DELETE` em massa, cascade e lote em uma transação |
| `bench11.py` | o pior caso: `replaceAll` do `persist` reindexando tudo |
| `bench12.py` | a correção: upsert idempotente + guarda no trigger |

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

## O número que vale: medido em release, não em Python

Todo benchmark deste diretório é um protótipo em Python, e ele **superestimou o
ganho**. A medição do código que ficou, em perfil release, contra o banco real
(conversa de 3.286 itens, 12 queries):

| | varredura | índice | |
|---|---|---|---|
| total das 12 queries | 316ms | **91ms** | **3,5x** |
| melhor caso | 24,8ms | 1,9ms | 13x |
| pior caso | 28,5ms | 17,4ms | 1,6x |
| top-10 idêntico | (referência) | **12 de 12** | |

O Python parseava JSON muito mais devagar que o `serde_json`, então a varredura
aparecia em 60ms quando na verdade custa 24-30ms. Os protótipos continuam úteis
para a FORMA da decisão (qual desenho, qual corte, qual gêmea); para a MAGNITUDE
do ganho, vale só a medição em release.

Corte de candidatos, em release: 100 dá 8x com 6 de 12 queries corretas; 200 dá
6x com 8; 400 dá 4x com 9; **800 dá 3,5x com as 12**. Ficou 800, porque a
premissa da ADR-213 é que o ranking não muda.

## O que o double check de 18/09/2026 mudou

A árvore tinha avançado e apareceu `conversation_items` (migração 48), fonte
itemizada que o primeiro benchmark desconhecia. O que isso mudou:

- **Ler a tabela em vez do blob não ganha nada:** 61,0ms contra 60,5ms. O custo
  é parsear 3.286 JSONs, não o formato de armazenamento.
- **A extração de texto em SQL é gêmea exata do Rust:** 7.721 de 7.721 itens
  idênticos, byte a byte. É isso que autoriza manter o índice por trigger.
- **Trigger ingênuo custa 3.310ms por persist**, porque `replaceAll` apaga a
  conversa inteira antes de reinserir. Com o `DELETE` inicial removido (é
  redundante) e guarda `WHEN old.item_json IS NOT new.item_json`, cai para
  **8ms** parado e 21ms com 10 itens alterados.
- **Consistência dos triggers verificada:** após `DELETE position>=50`, cascade
  da conversa e 200 re-upserts, o índice fica com 0 órfãs, 0 faltando, 0
  duplicadas.
- **Fidelidade real: 95,7%** no corpus de 3 conversas (100% só na maior).
- **Erro de método corrigido:** o porte inicial serializava o `input` das
  ferramentas com `json.dumps` padrão, enquanto o `Display` do `serde_json` é
  compacto. Tokens eram os mesmos, números não se moveram, porte corrigido.

Perda irredutível: 4,3%, com candidatos ilimitados. É o piso da técnica: o score
atual casa por substring e acha o termo no meio da palavra; índice de tokens
não faz isso nem com prefixo.
