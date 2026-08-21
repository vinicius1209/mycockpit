# Modos de sessão — um eixo só, declarado por motor (plano)

> Status: **M0 ✅ · M0.5 ✅ · M1 ✅ · M2 ✅ · M3 ✅ (21/08/2026)** · M4 pendente. Nasceu da ADR-056, que
> fechou o gate de plano e deixou registrado o que ficou torto: o ACP trata plano
> como MODO DE SESSÃO e nós tratamos como flag por turno. Ao investigar, o
> problema é maior que o plano.

## O achado: quatro vocabulários para um eixo só

O app tem HOJE quatro conjuntos de valores diferentes para a mesma decisão
("quanto o agente pode fazer sem me perguntar"):

| Onde | Valores | Arquivo |
|---|---|---|
| Conversa / projeto | `leitura · padrao · liberado` | `lib/types.ts:4` |
| Agendamento | `leitura · padrao · auto` | `lib/db.ts:1841` |
| Motor (Rust) | `Leitura · Padrao · Auto · Liberado · FusionRo` | `adapters.rs:74` |
| Plano | booleano `planFirst`, **ortogonal aos três acima** | `lib/types.ts:27` |

Consequências mensuráveis, não teóricas:

- **`Auto` não é alcançável da conversa.** Existe no Rust e no agendamento, com
  descrição própria ("autonomia sem pausar mas com o freio de cada CLI"), e o
  seletor do composer não o oferece. Você só chega nele agendando.
- **O plano precisa de um hack pra conviver com a permissão.** O
  `adapters.rs:952` diz por escrito: *"Planejar primeiro SUBSTITUI o
  `--permission-mode` do modo neste turno (senão emitiríamos a flag 2x)"* — e o
  match tem um braço vazio só pra isso. O modelo está brigando com a realidade.

## O que o mercado faz

No ACP (e no Paseo, que o implementa) **plano é um MODO**, na mesma lista dos
outros, declarado POR PROVEDOR:

```ts
const CLAUDE_MODES = [
  { id: "plan",             label: "Plan Mode",         colorTier: "planning" },
  { id: "default",          label: "Always Ask",        colorTier: "safe" },
  { id: "acceptEdits",      label: "Accept File Edits", colorTier: "moderate" },
  { id: "bypassPermissions", …                          colorTier: "dangerous" },
]
const OPENCODE_MODES = [ { id: "build" }, { id: "plan" }, … ]
```

Repare que os ids do Claude **são literalmente os valores de
`--permission-mode`**. É um eixo só, e `plan` é um valor dele. Nossa própria
camada Rust já sabe disso — é por isso que o plano tem que "substituir" a
permissão. A UI é que finge que são duas coisas.

O Paseo também marca `isUnattended?: boolean` no modo mais permissivo (o que
roda sem perguntar), e tem um TODO honesto no arquivo: os modos deveriam vir do
provedor em runtime, não de uma lista estática.

### Lista estática está ERRADA, e a prova está na máquina (21/08/2026)

A primeira versão deste plano dizia "estático é o certo, nenhuma CLI reporta os
próprios modos". Isso é falso — **as três reportam**, e a defasagem JÁ aconteceu
nas três:

| CLI | Instalada | `--help` enumera | O que o nosso código diz |
|---|---|---|---|
| Claude Code | 2.1.220 | `acceptEdits, auto, bypassPermissions, manual, dontAsk, plan` | "validado claude **2.1.209**" |
| Codex | 0.147.0 | `read-only, workspace-write, danger-full-access` | "validado codex **0.144.4**" |
| agy | 1.1.17 | `--mode (accept-edits, plan)` | "teste de **2026-07** → NÃO usamos `--mode plan`" |

Três fatos que doem:

- **O Claude tem `manual` e `dontAsk`** — dois modos que o app não conhece e
  nunca ofereceu. Ninguém percebeu porque a defasagem é silenciosa.
- **O agy hoje TEM `--mode plan`.** A decisão de não usar veio de um teste de
  julho, quando ele não segurava; é exatamente o padrão já registrado na memória
  do projeto (o agy ganhou `--output-format json` e hooks entre versões e
  precisou de revalidação). O "melhor esforço por prompt" pode estar obsoleto.
- **A casa já resolveu esse problema uma vez, do jeito certo:** MODELOS não são
  lista estática, são sonda (`src-tauri/src/model_list.rs`, M1 do
  `model-autonomy-plan.md`) — justamente porque mudam sem avisar. Modo é o mesmo
  tipo de dado.

### O modelo correto é HÍBRIDO, e a distinção é de segurança

Descobrir dá os **ids**; não dá a **semântica**. Saber que existe `dontAsk` não
diz o quanto ele libera — e este é o eixo de segurança. Oferecer um modo cuja
semântica a gente não conhece é fail-open com nome bonito.

Então:

- **Ids: descobertos** por sonda do `--help`, cacheados por VERSÃO do binário
  (mesmo padrão da sonda de modelos e do `detect.rs`: timeout curto, falha vira
  "desconhecido", nunca trava).
- **Semântica: curada** no registry (rótulo, descrição, `enforcement`,
  `unattended`, `planning`).
- **Id descoberto SEM curadoria não é oferecido — mas é REPORTADO.** "O Claude
  2.1.220 tem 2 modos que o Frota ainda não conhece" vira sinal visível, no
  mesmo lugar onde a atualização de CLI já aparece. Fail-closed COM sintoma, em
  vez da defasagem muda de hoje.
- **Id curado que SUMIU do `--help`** também é sinal: o motor tirou o modo, e
  continuar mandando a flag é erro na cara do usuário no próximo turno.

## As restrições duras

1. **Este é o eixo de SEGURANÇA.** Qualquer refatoração aqui pode afrouxar
   permissão em silêncio, e o §9 é fail-closed. A invariante que manda no plano
   inteiro: **nenhuma migração pode ALARGAR o que um agente podia fazer**. Com
   teste, para cada valor antigo.
2. **Há contratos persistidos.** O modo vive no `.mycockpit/config.toml` de cada
   projeto (arquivo do USUÁRIO, editado à mão), no SQLite
   (`updateProjectPermission`), nos agendamentos e na autonomia por fase de
   missão. Trocar o vocabulário sem mapear cria projeto que abre em modo errado.
3. **Os motores são desiguais, e isso é honesto.** Codex tem sandbox de OS
   (`read-only` / `workspace-write` / `danger-full-access`), Claude tem
   `--permission-mode` de verdade, e o agy tem **prefixo de prompt** — o próprio
   adaptador chama de "melhor esforço documentado" (`adapters.rs:2402`). O
   registry precisa dizer isso na cara, não achatar os três.

## O modelo alvo

**Um eixo, `sessionMode`, com os valores declarados POR MOTOR no registry.**

```ts
interface AgentModeDef {
  id: string                       // valor que o motor entende ("plan", "read-only"…)
  label: string                    // "Planejar", "Pede", "Liberado"
  description: string              // o que FAZ, em pt-BR
  /** Como o motor SEGURA isto: sandbox de SO, flag da CLI, ou só prompt.
   *  É o que deixa o "melhor esforço" do agy visível em vez de escondido. */
  enforcement: "sandbox" | "flag" | "prompt"
  /** Roda sem pedir aprovação (o `isUnattended` do Paseo). */
  unattended?: boolean
  /** Este é o modo de PLANEJAR — o que arma o gate ao fim do turno. */
  planning?: boolean
}
```

O composer passa a ter **um** controle ("Modo"), não permissão + toggle de
planejar. O gate de plano continua exatamente como a ADR-056 deixou; o que muda
é que aprovar **troca o modo** (como o CLI faz ao autorizar a saída do
planejamento) em vez de desligar um booleano paralelo.

## Fases

### M0 ✅ — Inventário e rede de segurança (antes de qualquer refatoração)
- Tabela dos 4 vocabulários → valor canônico, escrita como **função pura com
  teste por valor**. É a rede: nenhuma linha de UI muda nesta fase.
- Teste que trava a invariante 1: para cada valor antigo, o modo resolvido não
  pode ter `unattended` nem `enforcement` mais frouxo que o de hoje.
- Fixture de upgrade: projeto com `config.toml` antigo, agendamento antigo e
  missão antiga abrindo no modo certo.

### M0.5 ✅ — A sonda de modos
- Comando Rust que roda o `--help` do motor e extrai os ids (parse por motor: o
  Claude lista em `(choices: …)`, o Codex em `[possible values: …]`, o agy entre
  parênteses no `--mode`). Cache por versão do binário, timeout curto, falha =
  "desconhecido" (nunca lista vazia, que seria confundida com "não tem modo").
- Diferença contra o registry vira sinal: id novo (não oferecemos, avisamos) e
  id sumido (avisamos antes de o turno falhar).
- **Revalidar o `--mode plan` do agy nesta fase** — a decisão de não usar é de
  julho e o binário mudou.

### M1 ✅ — O registry declara a SEMÂNTICA dos modos
- `AgentModeDef[]` por motor em `lib/agents.ts`, ao lado das outras
  capabilities. O registry é a CURADORIA (o que cada id significa e o quanto
  libera), não a fonte da lista — a lista vem da sonda do M0.5.
- `Permission` do Rust passa a receber o **id do modo**, e o mapeamento
  motor-a-motor sai dos `match` espalhados e vira dado.
- O braço vazio do `plan_first` em `adapters.rs:954` **morre** — plano vira um
  id de modo como qualquer outro.

### M2 ✅ — Um controle só no composer
- O seletor de permissão e o toggle "Planejar" viram um seletor de modo, com os
  valores do motor ATIVO (trocar de agent troca a lista, como já acontece com
  modelo e esforço).
- `Auto` deixa de ser inalcançável: se o motor declara, aparece.
- `enforcement: "prompt"` aparece com aviso na cara — escolher "planejar" no agy
  não é a mesma garantia que no Codex, e esconder isso é o tipo de silêncio que
  esta casa já pagou caro.

### M3 ✅ — Modo é de SESSÃO
- `sessionMode` na conversa (persistido), com o projeto dando o default.
- Aprovar o plano **troca o modo** de volta; recusar mantém — o comportamento
  que a ADR-056 já implementou, agora expresso no modelo em vez de num booleano.

### M4 — Agendamento e missão no mesmo eixo
- `SchedulePermission` e a autonomia por fase passam a usar os mesmos ids.
  Enquanto isso não acontece, M0 garante que os três convivem sem divergir.

## O que NÃO fazer

- **Não** começar pela UI. O eixo é de segurança; a rede (M0) vem antes.
- **Não** achatar os motores num denominador comum. O agy NÃO tem sandbox, e o
  registry tem que dizer isso — foi por não dizer que o "planejar" do agy parece
  igual ao do Codex sendo que um é sandbox de SO e o outro é um pedido no prompt.
- **Não** oferecer id descoberto sem curadoria. Descoberta dá o nome, não o
  risco; este é o eixo de segurança e um modo desconhecido não pode virar opção.
- **Não** deixar a defasagem muda. Modo novo no motor e modo que sumiu são os
  DOIS um sinal — é a ausência desse sinal que deixou `manual`/`dontAsk`
  passarem batido e o `--mode plan` do agy envelhecer sem revalidação.
- **Não** renomear valor persistido sem mapa. `.mycockpit/config.toml` é arquivo
  do usuário.
- **Não** deixar o gate de plano de fora do modelo: ele é o consumidor do
  `planning: true`, e é o teste vivo de que o eixo unificado funciona.

## Definition of done

- Um controle só no composer, com os valores do motor ativo (interseção entre o
  que a sonda achou e o que o registry sabe explicar).
- Modo novo do motor aparece como AVISO, nunca como opção silenciosa.
- `Auto` alcançável na conversa se o motor declarar.
- `adapters.rs` sem o braço vazio de `plan_first`; plano é um id de modo.
- Projeto com `config.toml` antigo abre no MESMO modo efetivo de antes — teste
  por valor, para os quatro vocabulários.
- Nenhum valor migra para algo mais permissivo. Teste explícito.
- `tsc` 0, suíte verde, 6 guardas, e2e verde.

## Como ficou (21/08/2026)

**M0** — `lib/sessionMode.ts`: os quatro vocabulários viram um eixo, com a régua
de `PERMISSIVIDADE` que torna a invariante de segurança verificável
(`naoAlarga`). 16 testes, incluindo os casos que dariam errado calados:
`inherit` de fase não vira `auto`, e o agendamento não alcança `liberado`.

**M0.5** — `src-tauri/src/modes.rs`: parser PURO por motor (o do Claude junta
três linhas, porque a ajuda quebra a lista), `known: false` quando não dá pra
ler, e uma prova real `#[ignore]` contra os binários da máquina. Rodando nos
três instalados:

```
claude-code  ["acceptEdits","auto","bypassPermissions","manual","dontAsk","plan"]
codex        ["read-only","workspace-write","danger-full-access"]
agy          ["accept-edits","plan"]
```

**M1** — `lib/agentModes.ts`: a curadoria do que o app SABE EXPLICAR, espelhando
o que o `adapters.rs` faz hoje. E o cruzamento que faltava:

- `manual` e `dontAsk` do Claude ficam **de fora de propósito** — o app nunca os
  mandou e ninguém validou o que liberam. Viram AVISO na seção Ferramentas do
  sino, que é onde "o cardápio mudou" já mora.
- `agy` tem curadoria VAZIA com nota: ele anuncia `--mode`, o app não manda a
  flag (emula por prompt), e a decisão de não adotar é de julho/2026 com um
  binário que já mudou.
- Modo que SUMIU do motor também é aviso — é o mais urgente dos dois, porque a
  flag continua sendo enviada até alguém reparar.

O aviso de modos **não tem dispensar**, diferente do de update e do de modelo:
dispensa é pra aviso que você resolveu, e este só some quando a curadoria
alcança o motor. Deixar dispensar reproduziria o silêncio que criou o problema.

**M2** — `ModeSelect.tsx` substitui o par "permissão + toggle Planejar". As
opções vêm do motor ATIVO, o `enforcement` fica visível ("sandbox do sistema" ×
"modo da CLI" × "só um pedido no prompt"), e o `Auto` deixou de ser inalcançável
da conversa (o Rust já o aceitava; só a UI não oferecia).

Dois defeitos que os testes existentes pegaram, e que valem registro porque a
correção mudou o modelo:

1. **A interseção com a sonda apagava o controle.** Com a sonda sem resposta
   (browser, binário fora do PATH, formato de ajuda mudado) a lista ficava vazia
   e o seletor de permissão SUMIA. Ficar sem controle é pior que ficar com uma
   lista velha: `modosOferecidos(agent, null)` agora devolve a curadoria
   inteira, que é o que o app já mandava antes da sonda existir.
2. **A interseção apagava o modo EMULADO.** "Só lê" no Claude não é
   `--permission-mode` nenhum (é `--disallowedTools`), e o agy não usa `--mode`
   pra nada. Filtrar por descoberta tirava os dois. Entrou o `probeId`: só o que
   o app REPASSA precisa ser confirmado pelo motor; o que ele emula não.

**M3** — o modo virou da CONVERSA, persistido (migração 37, `session_mode`
nullable: NULL = herda o projeto, que é diferente de "sem modo").

Três coisas caíram junto:

- **O "Planejar" passou a sobreviver ao restart.** Ele só vivia em memória (não
  havia coluna), então ligar e reabrir o app desligava sozinho — a mesma classe
  de sumiço silencioso do `pendingPlan` (ADR-056), achada de novo aqui.
- **Mudar o modo parou de mexer no projeto inteiro.** O controle antigo escrevia
  a permissão do PROJETO — todas as conversas dele junto — sem nunca dizer isso.
- **O default do projeto ganhou gesto próprio** ("Usar como padrão deste
  projeto", no mesmo menu). Sem ele haveria regressão: o composer era o ÚNICO
  lugar do app que definia a permissão do projeto.

**Escopo decidido:** o projeto é DEFAULT, não teto. Uma conversa pode estar mais
liberada que o padrão do projeto — é o modelo dos CLIs (você troca de modo na
sessão) e foi a régua que você pediu. Quem quiser guardrail usa o
`.mycockpit/config.toml`, que continua vencendo o cache.

**Pendente (M4):** agendamento e autonomia de fase ainda têm vocabulário
próprio. A rede do M0 é o que segura os três convivendo sem divergir.
