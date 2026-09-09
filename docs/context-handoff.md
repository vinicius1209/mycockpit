# Continuidade híbrida entre code agents

> Status: implementado em 2026-07-29. Contrato v1.

## Objetivo

Continuar uma conversa em outro provider sem tentar transferir a sessão privada
do provider de origem e sem despejar todo o histórico na janela do novo modelo.

O Frota é o dono da memória durável. A sessão nativa é uma otimização:

1. **Disco/worktree** — fonte de verdade do trabalho materializado.
2. **SQLite** — histórico integral da conversa e metadados do cockpit.
3. **Transcript markdown** — memória humana/pull, legível por qualquer CLI.
4. **Manifesto JSON** — índice estruturado do handoff.
5. **Prompt compacto** — working set necessário para começar.
6. **MCP `mc-context`** — recuperação sob demanda, com caps.

## Artefatos

Cada handoff cross-provider sobrescreve atomicamente o par:

```text
.mycockpit/context/<conversation-id>.md
.mycockpit/context/<conversation-id>.handoff.json
```

Os arquivos são locais/ignorados pelo git. O manifesto contém:

- provider de origem e destino;
- pedido pendente integral;
- falha/limite que encerrou o provider anterior;
- histórico recente tail-biased;
- branch e referências leves dos arquivos alterados;
- lições ativas do projeto;
- ponteiros para transcript, manifesto e, quando suportado, conversa SQLite;
- flags explícitas de truncamento.

O prompt não duplica o pedido: ele aparece uma vez, no final. Conteúdo antigo
fica no transcript/SQLite e só entra na janela quando o agent o pede.

## Orçamentos

| Camada | Teto |
|---|---:|
| Histórico recente no prompt | 6.000 chars (~1,5k tokens) |
| Lições no handoff | 2.500 chars, máx. 8 regras |
| Arquivos alterados no índice | 40 |
| Manifesto no disco | 256 KiB |
| Leitura MCP por chamada | 24.000 chars / 400 linhas |
| Resultados de busca MCP | 10 |

Persona e doutrina mantêm os caps próprios. O pedido do usuário não é truncado.

## MCP `mc-context`

O mesmo server read-only é registrado por run:

### `context_manifest`

Lê o manifesto do handoff corrente. É a primeira chamada recomendada quando o
agent precisa confirmar estado, arquivos ou a razão da troca.

### `context_search`

Busca somente no histórico SQLite da conversa corrente. Retorna resumos curtos
e refs `conversation:item:N`; não expõe SQL nem o banco inteiro.

### `context_read`

Expande uma ref da busca ou lê um path relativo ao cwd. Canonicaliza o path,
recusa traversal/symlink para fora da raiz e aplica caps de linhas/caracteres.

## Matriz de providers

| Provider | Push compacto | Arquivos | SQLite via MCP | Sessão nativa |
|---|---:|---:|---:|---:|
| Claude Code | sim | sim | sim | `--resume` |
| Codex `exec` | sim | sim | sim | `exec resume` |
| Codex app-server | sim | sim | sim | `thread/resume` |
| Antigravity | sim | sim | não nesta CLI | não |
| OpenCode | sim | sim | não nesta integração | não |

O Codex recebe o MCP por overrides `-c` efêmeros; o config global do usuário não
é alterado. `command`, `args` e `env` são transportados explicitamente, pois o
Codex não repassa automaticamente o ambiente do processo pai ao subprocesso
MCP. As três tools declaram `readOnlyHint`, evitando aprovação impossível no
headless. O Claude recebe o server no `--mcp-config` do run. `fusion-ro` continua
sem MCP por contrato. O Agy degrada honestamente para prompt + paths.

## Falhas

- Falha do resume nativo: nova sessão + recap curto + ponteiro do transcript.
- Falha do export: o revezamento segue com o working set e, nos providers com
  gateway, SQLite; integrações sem gateway não recebem MCP inexistente.
- Falha antes do stream/spawn: vira item `error` persistido, não apenas toast.
- O revezamento é transacional: preparar a memória não troca o agent, a sessão
  ou o modelo da conversa. O destino só é confirmado no primeiro evento
  `session`; se falhar antes disso, a origem permanece pronta para retry.
- `result.is_error` do Claude preserva telemetria e produz um único incidente
  terminal. Limite de uso prevalece sobre o `exit code` genérico consequente.
- A interface agrupa o incidente terminal e sua telemetria em um único cartão:
  limite esperado usa âmbar, erro de configuração/execução usa vermelho e o
  detalhe técnico fica recolhido.
- O incidente terminal permanece factual no fio. Quando existe um pedido de
  executor pendente, a faixa única acima do composer oferece continuação
  imediata em Claude Code, Antigravity ou OpenCode, desde que o destino esteja
  instalado, autenticado, com cota e compatível com os anexos.
- Depois de um turno concluído, cota esgotada oferece os mesmos destinos, mas a
  escolha apenas prepara o próximo envio. O verbo do botão explicita a
  diferença e nenhum trabalho é despachado sem o gesto posterior da pessoa.
- Uma retomada automática já agendada aparece dentro dessa mesma faixa. Trocar
  de destino a cancela; o cancelamento próprio continua disponível sem criar um
  segundo aviso concorrente.

## Validação

Os testes cobrem:

- orçamento e truncamento tail-biased;
- pedido no final sem duplicação;
- transcript pleno fora do prompt;
- manifesto JSON validado;
- busca SQLite ranqueada e limitada;
- leitura de arquivo confinada à raiz;
- registro MCP em Claude, Codex exec e Codex app-server;
- annotations read-only e transporte explícito do ambiente no Codex;
- falha estruturada do Claude convertida em um incidente acionável e sem
  duplicatas;
- seleção compartilhada de destinos, filtrando ausência, autenticação, cota,
  tipo de destino e anexos incompatíveis;
- prioridade da continuação imediata sobre a preparação preventiva e sobre a
  apresentação separada da retomada automática;
- preparo visível antes do primeiro `await`, pergunta a Especialista ignorada
  como pedido pendente e anexos do executor preservados;
- rollback do revezamento antes da sessão e commit no primeiro `session` do
  destino;
- paridade do revezamento entre Linear e Office;
- degradação quando o export falha.
