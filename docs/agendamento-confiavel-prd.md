# Agendamento confiável — PRD

## Status (12/09/2026)

**Etapa 1 entregue: R1 + R2 + R3.** Suítes rodadas de verdade: `cargo test`
782 ok, `bun run test` 4164 ok em 427 arquivos, `bunx tsc -b --force` limpo,
`bun run check` exit 0.

O que passou a existir:

- capability `SandboxProprio` (`Nenhum` · `MelhorEsforco` · `SistemaOperacional`)
  com espelho `sandboxProprio` em `lib/agentDefinition.ts` e os cinco valores em
  `lib/agents.ts`. Enum e não bool, pela mesma razão do `McpEscopo`;
- `sandbox.rs::confina` consulta a capability, então o envelope sai de cena onde
  o motor já confina. Guardado por `motor_que_confina_sozinho_NAO_e_envelopado`
  e `melhor_esforco_NAO_dispensa_o_envelope`;
- `SemPerfil::MotorConfina` separa "o motor confina" de "o modo escreve": duas
  ausências legítimas que o usuário precisa ouvir diferentes;
- `Alvo::canonicalizado` + `canonicaliza` resolvem symlink antes da regra virar
  perfil, com teste que cria symlink de verdade
  (`caminho_com_symlink_entra_no_perfil_JA_RESOLVIDO`);
- `assinatura_de_runner` + campo `sandbox_runner_hint` no `Outcome`: o
  classificador passou a ver o stdout estruturado, não só o stderr. Fixture real
  da linha do incidente;
- `Selo::Motor` e `confinamento(proprio)`: o selo virou máquina × motor, com
  `sandbox_confinamento(agent)` resolvendo pelo registry. `ConfinamentoCard` e
  `ModeSelect` deixaram de implicar que as linhas cobrem todo motor;
- teste de contrato: motor que declara confinar sozinho **tem** que passar flag
  de sandbox no comando, senão a Frota tira o envelope e o turno fica sem
  confinamento nenhum.

Achado na revisão de 12/09 e corrigido: varrer o stream inteiro reintroduziu um
falso positivo. A lista do stderr inclui `failed to compile`, inequívoca naquele
canal porque ele é do nosso wrapper; no stream é texto do AGENTE, e agente de
código dizendo "failed to compile" é rotina. A varredura do stream passou a usar
uma lista estreita (`sandbox-exec:` e `sandbox_apply`, saída literal do binário),
guardada por `agente_falando_de_compilacao_NAO_vira_falha_de_sandbox`.

**Não provado nesta etapa:** o turno de Codex em Leitura pelo caminho de spawn
do app (só pela CLI, nas medidas da seção de evidência, e pelos unitários do
comando montado). A prova de ponta pede o app rodando.

**Anomalia registrada:** durante a implementação, 13 call sites de teste em
`sandbox.rs` e `agent.rs` foram reescritos por algo que não fui eu, usando o
enum que eu havia acabado de criar. As edições estavam corretas e preservavam a
intenção (`None` e `SandboxProprio::Nenhum` são os valores neutros), e os hooks
configurados na máquina são só de notificação. Origem não identificada. Fica
aqui porque edição não auditada em arquivo do eixo de segurança é fato
relevante, não ruído.

---


> Gatilho: a automação "Pendencias na Prime" (projeto Maclan) rodou às 07:00 de
> 04/09, 06/09 e 09/09 de 2026. As três foram gravadas como `ok`, custaram
> US$ 1,16 somados e não entregaram nada. Levantamento e medidas: 09–11/09/2026.
>
> Continuação de `docs/automation-evolution.md` (F6), que desenhou a feature, e
> vizinho de `docs/sandbox-plan.md`, cujo S2 é a causa raiz do incidente.

## O problema, na frase do usuário

"Eu quero que o nosso agendamento seja capaz de funcionar, simplesmente
funcionar."

Hoje ele não funciona, e o modo como ele falha é pior que a falha: a combinação
que o próprio formulário recomenda (Leitura, com Codex) é **garantidamente
quebrada**, e o desfecho gravado é `ok`. O usuário não tem como descobrir sozinho
— nem pelo sino, nem pela lista, nem pelo histórico.

## Evidência

Tudo abaixo foi medido nesta máquina (macOS 25.6, codex-cli 0.153.2,
claude 2.1.266), não deduzido do código.

### D1 · Sandbox duplo mata todo shell em Leitura e em Planejar

`sandbox.rs:57` envelopa o processo em `sandbox-exec` com `(allow default)`;
`adapters.rs:2306` manda `-s read-only`, e o Codex roda `/usr/bin/sandbox-exec`
com política `(deny default)` a cada comando. macOS recusa aplicar perfil
restritivo dentro de perfil já aplicado.

Reprodução mínima:

```
sandbox-exec -f allow-default.sb sandbox-exec -f deny-default.sb /bin/sh -c 'echo ok'
→ sandbox-exec: sandbox_apply: Operation not permitted   (exit 71)
```

Com o comando de produção literal, `pwd` e `cat` devolveram a mesma linha e
exit 71. Não é exclusivo do agendamento: `confina()` também liga com
`plan_first`, então **"Planejar primeiro" + Codex está cego no chat inteiro**.

### D2 · Tools MCP sem `annotations` são bloqueadas por aprovação

Servidor MCP de teste, duas tools idênticas, única diferença o hint:

| tool | resultado |
|---|---|
| `com_hint` (`readOnlyHint: true`) | `{"content":[{"text":"PROVA-COM_HINT"}]}` |
| `sem_hint` (sem `annotations`) | `MCP tool call requires approval, but approval policy is never` |

`context_gateway.rs:188` já declara as annotations e explica o motivo no
comentário. `work_gateway.rs`, `tool_gateway.rs` e `hook_gateway.rs` têm zero.

### D3 · O desfecho mente

`scheduleOutcome.ts:44` (`turnOutcome`) só olha o último `result`. O Codex
terminou com `is_error: false` porque *narrou* a falha em vez de falhar. Três
runs `ok`, sino mudo, `last_run_status = ok`.

### D4 · O diagnóstico do sandbox é cego

`sandbox.rs:classifica` lê o **stderr** do motor. A assinatura `sandbox-exec:`
sai no stdout JSON, dentro do `exec_command_output`. `Veredito::RunnerFalhou`
nunca disparou e a frase "Falha do Frota, não do agente" nunca apareceu.

### D5 · O perfil não canonicaliza caminhos

`perfil_macos` escreve `req.cwd` cru na regra `(subpath "...")`. Seatbelt exige
caminho canônico. Medido em `/tmp` (symlink de `/private/tmp`): o perfil **não
bloqueou nada** e o arquivo de teste foi destruído. Projeto atrás de symlink tem
hoje um "Só lê" decorativo.

### D6 · Sem rede em Auto, não existe PR

| modo | escrita no projeto | escrita fora | leitura | rede |
|---|---|---|---|---|
| `read-only` | bloqueada | bloqueada | disco inteiro | **bloqueada** |
| `workspace-write` (= Auto) | permitida | bloqueada¹ | disco inteiro | **bloqueada** |
| `workspace-write` + `network_access=true` | permitida | bloqueada¹ | disco inteiro | **liberada** |

¹ exceto `/tmp` e `$TMPDIR`, writable por padrão no workspace-write do Codex.

Em Auto: `curl` → `000` (exit 6), `git ls-remote` → "Could not resolve host"
(exit 128). A etapa final da automação da Prime ("crie uma PR para a develop")
nunca teria funcionado, mesmo sem D1 a D5.

### D7 · "Padrão" promete escrita e entrega bloqueio

`unattendedAnswerAfterMin` tem default 10. Qualquer pedido de permissão num run
desassistido expira fail-closed em 10 minutos. O modo aparece no formulário como
"pode editar" e na prática não edita.

### Medida do Codex `read-only` sozinho (sem o envelope da Frota)

A rota escolhida depende desta medida. Sete tentativas, incluindo evasão:

| tentativa | resultado |
|---|---|
| escrita no cwd via shell | bloqueada pelo kernel |
| escrita fora do cwd | bloqueada |
| escrita via `apply_patch` (via nativa, sem shell) | `writing is blocked by read-only sandbox` |
| escrita em pasta de `--add-dir` | bloqueada |
| `python3` / `perl` / `cp` | as três bloqueadas |
| processo destacado (`nohup sh -c ... &`) | bloqueado (perfil herdado pelos filhos) |
| leitura de pasta irmã e de `/etc/hosts` | funciona |

O `read-only` do Codex é **estritamente mais apertado** que a denylist da Frota
em todo eixo (ela libera rede e só protege o projeto). A troca aperta, nunca
afrouxa: o `naoAlarga` de `sessionMode.ts` continua valendo.

## Decisões

**Rota B no sandbox: o envelope da Frota sai onde o motor já confina.**
Não é confiar no motor, é medir o motor. Argumento que fechou a questão:
`sandbox.rs:143` faz `disponivel()` ser `cfg!(target_os = "macos")`, então **em
Linux o envelope nunca aplicou** e o Codex já é o único guarda lá — e funciona.
O que existe hoje no macOS é regressão de plataforma, não proteção.

A decisão vira capability, nunca comparação de nome de motor. Bool não serve:
são três realidades, e é a lição do `managed_mcp: bool` → `McpEscopo` registrada
no próprio `adapters.rs`.

```rust
pub enum SandboxProprio {
    /// Não confina por conta própria. O envelope da Frota é quem vale.
    Nenhum,
    /// Diz confinar, mas EMUDECE em vez de falhar (agy, fase 0 do sandbox-plan).
    /// Não conta como garantia: o envelope continua valendo.
    MelhorEsforco,
    /// Aplica sandbox de SO, MEDIDO. Dispensa o envelope, e colide com ele.
    SistemaOperacional,
}
```

Valores conferidos: codex `SistemaOperacional`; agy `MelhorEsforco` (`--sandbox`
= "terminal restrictions"); claude 2.1.266 `Nenhum` (não expõe sandbox);
opencode `Nenhum` (zero menção no `--help`). Se o Claude ganhar sandbox de bash
no macOS, cai na mesma colisão e vira uma linha no registry, não um bug novo.

**"Padrão" sai do agendamento.** Leitura + Auto é o par honesto (D7). Linhas já
gravadas com `padrao` caem para `leitura`: fail-closed. Subir para `auto` seria
afrouxar sem gesto humano.

**Rede é chave explícita por automação, desligada por padrão.** Ligar rede num
run desassistido abre baixar, postar e vazar. Isso merece gesto por automação,
não um default novo em Auto. O caminho é `-c sandbox_workspace_write.network_access=true`,
que dá rede **mantendo a escrita confinada ao projeto** — melhor que `liberado`,
que abriria o disco inteiro para conseguir a mesma coisa.

**Cada rodada é única, e o prompt é o contrato.** Sem continuidade de thread
entre execuções (`resume` continua `null`). O estado mora no artefato externo
(o board JSON), não na memória do agente: fonte da verdade inspecionável, que é
a mesma lei de "estado real, nunca teatro". Consequência aceita: o prompt precisa
saber se instruir sozinho, e por isso R8 e R9 sobem de prioridade.

## Requisitos

| # | requisito | aceite |
|---|---|---|
| R1 | Envelope da Frota dispensado quando a capability do motor é `SistemaOperacional` | teste-gêmeo Rust↔TS; teste de contrato cobrindo os quatro motores; turno real de Codex em Leitura executa `pwd` e `cat` |
| R2 | Caminhos do perfil Seatbelt canonicalizados antes de virar regra | teste com raiz atrás de symlink prova que a escrita é barrada |
| R3 | `classifica` enxerga a saída do stream, não só o stderr | fixture real do `exec_command_output` com `sandbox-exec:` produz `RunnerFalhou` |
| R4 | `work_gateway`, `tool_gateway` e `hook_gateway` declaram `annotations` | turno real de Codex chama `work_plan` sem erro de aprovação |
| R5 | Run desassistido que termina sem trabalho é `failed`, com motivo | `turnOutcome` recusa exit 0 cujo turno só produziu texto e tools falhas |
| R6 | "Padrão" removido do vocabulário de agendamento | tipo `ScheduleVocab` sem `padrao`; clamp leva linha gravada para `leitura`; form não oferece |
| R7 | Chave "esta automação precisa de rede" por agendamento, default desligada | coluna nova via `addColumn` em `lib/db/schedules.ts`; desligada não emite a flag; ligada emite e o form explica o que abre |
| R8 | Anexos no agendamento | coluna nova; filtrados por `supports_attachment`; arquivo ausente no disparo falha com o motivo, não em silêncio |
| R9 | Projeto é contrato de escopo no formulário | caminho citado no prompt fora do escopo do projeto vira aviso na criação; prompt que pede PR em modo sem rede vira aviso |

Tabela `schedules` é de frontend: colunas novas entram por `ensureScheduleTables`
+ `addColumn` em `app/src/lib/db/schedules.ts`, **não** por migração Rust (a
máxima real no `lib.rs` hoje é 49 e não é para ser tocada por esta frente).

## Não-objetivos

- **Rodar com o app fechado.** O tick é do front, a cada 60s, e o que venceu há
  mais de `CATCHUP_GRACE_MS` (5 min) vira notificação em vez de disparar. Não é
  defeito consertável aqui: "nada de daemon fora do app" é lei do `CLAUDE.md`.
  É teto de produto, e precisa estar dito na tela.
- **Retry automático.** Segue decisão humana ("Rodar agora").
- **Continuidade entre rodadas.** Decidido acima.
- **`liberado` em automação.** Continua clampado fora, pelo tipo e pelo motor.

## Limites que permanecem, por motor

- **Codex** — em Leitura não tem rede (D6). Em Auto só tem rede com R7 ligada.
- **Claude** — nunca teve a colisão de sandbox. Tem rede em Auto (não aplica
  sandbox de SO).
- **agy** — quando é barrado, **emudece** em vez de falhar (exit 0, saída
  vazia). Quem cobre isso é o `SilencioSuspeito` do S3, e ele depende de o
  envelope continuar valendo para o agy — o que a rota B preserva.

O mesmo rótulo "Auto" significa coisas diferentes por motor quanto a rede. Isso
precisa estar declarado no registry e visível na tela, não escondido em
comentário.

## Ordem de entrega

1. R1 + R2 + R3 (sandbox: destrava o Codex e torna o bloqueio legível)
2. R5 (desfecho honesto: sem isso, nada do resto é verificável pelo usuário)
3. R4 (MCP: medir antes os valores certos para `work_plan`/`work_update`, que
   **não** são read-only de verdade e não podem mentir no contrato MCP)
4. R6 + R7 (vocabulário e rede)
5. R8 + R9 (anexos e escopo)

Cada etapa fecha com `bun run test`, `bunx tsc -b --force` e `cargo test`
rodados de verdade.

## Risco conhecido

`app/src-tauri/src/adapters.rs` tem trabalho não commitado de outra frente
(hunks em ~316, ~1453, ~2146 e no módulo de testes em ~4183). As mudanças desta
frente caem na struct `Capabilities`, nas quatro consts de CAPS e no trecho de
sandbox do `CodexAdapter`. Regiões diferentes, mas exigem edição cirúrgica: não
reverter o que não é desta tarefa.
