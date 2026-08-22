# O sandbox do Frota: transformar rótulo em garantia (plano)

> Status: proposto em 22/08/2026, com a fronteira JÁ MEDIDA (seção abaixo).
> Aprovado com uma condição do usuário: **não degradar a experiência**. Essa
> condição não é um adendo — ela é o que decide o desenho, e a medição mostrou
> exatamente por quê.

## O problema, em uma frase

Quando você escolhe "Só lê", o Frota **pede** ao motor que não escreva. Quem
decide é o motor. E medido na ADR-061: `agy --mode plan -p "crie o arquivo X"`
criou o arquivo.

O `ModeSelect` já confessa isso em três frases — "sandbox do sistema" (Codex),
"modo da CLI" (Claude), "só um pedido no prompt" (agy). Honestidade sobre uma
fraqueza continua sendo a fraqueza: **"Só lê" significa três coisas diferentes
dependendo de quem você escolheu.**

## Onde a ideia nasceu (crédito honesto)

A técnica não é nossa e não é nova: é do sistema operacional (Seatbelt no macOS,
Landlock no Linux). O **Codex** já sandboxa, o **agy** tem `--sandbox`, e o
**DeepSeek Harness** tem os três backends mais um addon nativo em C.

O que seria novo é o **lugar**. Verificado nos concorrentes clonados:

| orquestrador | cria sandbox? |
|---|---|
| Orca | nada encontrado |
| Paseo | nada encontrado |
| Buzz | só **afrouxa** o do Codex (`sandbox_workspace_write.network_access = true`) |

O DSH sandboxa, mas ele é motor e host ao mesmo tempo — não orquestra CLIs de
terceiros. Subir o sandbox para o ORQUESTRADOR é o que ninguém faz.

E o desconforto que fica registrado: *ninguém fazer* pode ser oportunidade ou
pode ser "tentaram e a fronteira é intratável". Por isso a fase 0 foi medir.

## Fase 0 ✅ — A fronteira, MEDIDA (22/08/2026)

Três CLIs instaladas (claude 2.1.220, codex, agy 1.1.18), um turno real de
leitura ("quantas linhas tem a.py"), `sandbox-exec` de verdade.

### Tentativa 1: negar toda escrita (allowlist mínima)

| CLI | resultado |
|---|---|
| claude | **funciona** (respondeu) |
| codex | **falha explícita** — `failed to initialize in-process app-server client: Operation not permitted` |
| agy | **`exit 0` com saída VAZIA** |

O caso do agy é o achado que desenha o plano inteiro: ele **não falha, finge que
funcionou**. Nenhuma mensagem de erro, nenhum "permission denied" no stderr,
código de saída zero, resposta nenhuma. Uma implementação ingênua teria
entregue um "Só lê" que, no agy, silenciosamente não faz nada.

### Tentativa 2: allowlist com as áreas de estado dos agentes

Liberando `~/.claude`, `~/.codex`, `~/.gemini`, caches e temp:

| CLI | resultado |
|---|---|
| claude | funciona |
| codex | **passou a funcionar** |
| agy | **ainda vazio** |

### Tentativa 3: inverter — liberar por padrão, NEGAR o projeto

| CLI | resultado |
|---|---|
| agy | **funciona** |

### A conclusão que inverte o desenho ingênuo

O instinto (e o que o DSH faz, porque ele é dono do processo) é **allowlist**:
nega tudo, libera o necessário. Medido aqui, allowlist quebra 2 de 3 motores, e
um deles **em silêncio** — que é precisamente a degradação de experiência que o
usuário proibiu.

Para um ORQUESTRADOR de binário de terceiro, a forma que funciona é
**denylist**: liberar por padrão e negar o que precisamos proteger.

Isso é uma troca real e ela vai escrita na cara do usuário, não escondida:
denylist protege **o seu projeto**, não protege `~/Documents`. É menos do que
"sandbox total" e é mais do que temos hoje, que é nada.

## Fases

### S1 ✅ — A política, pura e testável (22/08/2026)
- `sandbox.rs`: monta o perfil a partir de (modo, raiz do projeto, worktree).
  Função PURA gerando o texto do perfil, testável sem lançar processo — mesmo
  padrão de `modes.rs`.
- Denylist: nega escrita na raiz do projeto e no worktree da conversa. O resto
  segue liberado (a medida acima manda).
- **O `.git` merece linha própria:** "Só lê" que deixa reescrever histórico não
  é só lê.

### S2 — Envolver o spawn, e SÓ nos modos que prometem não escrever
- O `adapters.rs` passa a envelopar o comando em `sandbox-exec -f <perfil>`
  quando o modo é `leitura`/`plan`/`fusionRo`. Nos modos que escrevem, nada muda
  — sandbox ali seria teatro.
- **Fail-closed com voz:** se o `sandbox-exec` não existir ou o perfil não
  compilar, o turno NÃO roda em modo permissivo silenciosamente. Ou avisa e
  recusa, ou avisa e rebaixa — mas avisa.

### S3 — Distinguir "o sandbox negou" de "o agente quebrou"
É a fase que cumpre a condição do usuário, e a que o DSH nos ensina:
assinaturas de stderr POR backend (`Operation not permitted`, `os error 1`,
`sandbox-exec: ...`), não uma união genérica.

- Sem isso, todo bloqueio parece bug do Frota.
- Com isso, vira uma frase no recibo: *"o agente tentou escrever fora do
  projeto e foi barrado"*.
- **E o caso agy exige mais:** ele não emite assinatura nenhuma. Turno que sai
  com `exit 0` e produção vazia sob sandbox precisa ser tratado como
  SUSPEITO — silêncio não é sucesso.

### S4 — O selo honesto: `completa` × `parcial`
Roubado do DSH (`docs/subsystems/sandbox.md`), e aqui vale mais ainda porque a
nossa é denylist:

- o `ModeSelect` deixa de dizer só "sandbox do sistema" e passa a dizer o que
  ESTE modo, NESTE motor, NESTA máquina realmente garante;
- `sandbox-exec` está deprecated pela Apple (segue funcionando; o Chrome usa) e
  no Linux o Landlock depende do kernel. Prometer garantia que não temos seria
  repetir o problema com a nossa assinatura.

### S5 — Linux (Landlock)
Depois do macOS provado. Backend diferente, mesma política pura de S1.

## O que o sandbox NÃO faz

- **Não substitui o worktree.** Worktree isola o que o agente VÊ; sandbox isola
  o que ele CONSEGUE FAZER. Camadas diferentes, as duas continuam valendo.
- **Não vale para os modos de escrita.** Em `padrao`/`auto`/`liberado` o agente
  deve escrever — sandbox ali seria enfeite.
- **Não protege o disco inteiro.** É denylist, por medida, não por preguiça.

## Definition of done

- "Só lê" impede escrita no projeto nos TRÊS motores, verificado com turno real
  que tenta escrever (não com `--version`).
- Nenhum motor quebra em silêncio: agy sob sandbox produzindo vazio é erro
  visível, não sucesso.
- O que o modo garante está escrito na tela, com `completa`/`parcial`.
- `tsc` 0, suíte verde, 6 guardas, e2e, `cargo test`.

## O que NÃO fazer

- **Não** copiar o `120_000` do outro — aqui é a mesma regra do teto do diff:
  número de outra casa não é medida nossa. A política sai da fase 0.
- **Não** ligar sandbox em modo de escrita "por segurança". Vira teatro e
  quebra turno legítimo.
- **Não** engolir falha de sandbox. Fail-closed do §9 vale inteiro: sem
  garantia, ou avisa ou recusa, nunca segue fingindo.

## Como ficou o S1 (22/08/2026)

`src-tauri/src/sandbox.rs`: `confina(Permission)` + `perfil_macos(modo, alvo)`,
função pura devolvendo o TEXTO do perfil Seatbelt. 10 testes puros + 1 prova
real na máquina.

**Nada mudou pro usuário ainda, e isso é de propósito.** O módulo não lança
processo nenhum — envolver o spawn é o S2. Separar assim deixou a política
testável sem `sandbox-exec`, sem rede e sem gastar turno de agente.

Três decisões que a escrita revelou:

- **`SemPerfil` é enum, não `Option`.** O S2 precisa DIZER o que houve: modo que
  escreve (ausência legítima) é uma coisa; nenhum caminho utilizável (perfil que
  mentiria) é outra. Recusar em silêncio seria o mesmo fail-open que este módulo
  veio matar.
- **Caminho com aspas não vira regra.** Uma aspa fecharia o s-expression e
  poderia ABRIR o perfil inteiro. Perfil malformado é pior que perfil nenhum,
  porque parece que está protegendo.
- **O `.git` ganhou linha própria, e não é redundância.** Num worktree o `.git` é
  ARQUIVO apontando pro repo principal, que fica FORA do subpath da raiz. Sem a
  linha, "Só lê" numa conversa isolada deixaria reescrever histórico.

**A prova real é a que importa.** Os testes puros garantem a FORMA do texto; só
a prova (`#[ignore]`, padrão do `modes.rs`) garante que o `sandbox-exec` aceita
o texto E que ele bloqueia de fato. Perfil sintaticamente lindo que não compila
protege exatamente nada — e falharia ABERTO. Verificado: escrita recusada com o
conteúdo intacto, leitura funcionando.
