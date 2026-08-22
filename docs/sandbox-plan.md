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

### S2 ✅ — Envolver o spawn, e SÓ nos modos que prometem não escrever (22/08/2026)
- O `adapters.rs` passa a envelopar o comando em `sandbox-exec -f <perfil>`
  quando o modo é `leitura`/`plan`/`fusionRo`. Nos modos que escrevem, nada muda
  — sandbox ali seria teatro.
- **Fail-closed com voz:** se o `sandbox-exec` não existir ou o perfil não
  compilar, o turno NÃO roda em modo permissivo silenciosamente. Ou avisa e
  recusa, ou avisa e rebaixa — mas avisa.

### S3 ✅ — Distinguir "o sandbox negou" de "o agente quebrou" (22/08/2026)
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

## Como ficou o S2 (22/08/2026)

**A costura é UMA.** Os três adapters têm `Command::new` próprio, mas todos
passam por `agent.rs:574` (e o retry em 641). Envolver ali, e não em três
lugares, é o que impede um motor novo nascer sem confinamento por esquecimento.

E o ponto exato importa: o `build_command` devolve o comando **antes** do
`run_once` configurar stdio. Por isso o `envelopa` só precisa preservar
programa, argumentos, cwd e ambiente — não tem como perder o que ainda não foi
posto. Num ponto mais tarde, o envelope teria que reconstruir pipes.

### A decisão que eu revi antes de escrever

Eu tinha dito que recusaria o turno quando o `sandbox-exec` faltasse. **Estava
errado, e o motivo é simples:** hoje "Só lê" já roda sem sandbox nenhum. Passar
a bloquear seria uma REGRESSÃO — tiraria do usuário algo que ele tem hoje, numa
máquina onde nada mudou.

O §9 proíbe seguir **em silêncio** com menos garantia. Seguir **avisando** cumpre
a regra sem quebrar ninguém. Então cada caminho de falha emite um `Notice` com o
motivo, e o selo do S4 é onde isso vira tela permanente em vez de aviso de turno.

Três caminhos, três frases distintas (o motivo viaja, não só o fato):
perfil não montável para este diretório · `sandbox-exec` indisponível ·
perfil não gravável.

### Detalhes que a escrita revelou

- **`extra_dirs` entram no perfil.** O usuário pediu "Só lê", não "só lê o
  projeto principal". Proteger a raiz e deixar a pasta irmã liberada por
  `--add-dir` aberta seria um buraco exatamente onde ele concedeu acesso de
  propósito.
- **A remoção de env é copiada como remoção.** `get_envs()` devolve `None` para
  variável que o adapter APAGOU. Copiar só as presentes desfaria a decisão dele
  pelas costas.
- **`LimpaPerfil` é guarda RAII, não `remove_file` no fim.** O run pode sair por
  `?` no meio, que é justamente onde a limpeza no fim não roda. Perfil é arquivo
  por turno: sem isso, `/tmp` cresce em silêncio.

### A prova de ponta

`prova_real_o_agente_nao_escreve_no_projeto` usa o caminho de produção inteiro —
`Alvo` montado como o `agent.rs` monta, `perfil_macos`, `envelopa` — contra um
processo que tenta escrever. Resultado: bloqueio, arquivo intacto, e o stderr
capturado (`Operation not permitted`) fica impresso no teste **como insumo do
S3**, que é quem vai traduzir isso em frase pro usuário.

## Como ficou o S3 (22/08/2026)

`classifica(confinado, stderr, sucesso, emitiu_saida) -> Veredito` + `frase()`.
Puro, 9 testes. Emitido como `Notice` ANTES do `Done`, senão o bloqueio chega na
tela como "turno falhou" e o usuário não descobre que foi o "Só lê" dele
FUNCIONANDO.

### As quatro decisões que o classificador carrega

- **`confinado` é checado PRIMEIRO.** Um "operation not permitted" pode vir do
  trabalho do próprio agente (tentar escrever em `/etc`). Sem sandbox aplicado,
  lê-lo como bloqueio nosso poria uma frase errada com toda a confiança.
- **`confinou` = o perfil foi mesmo aplicado**, não "o modo pediu". Quando o
  `sandbox-exec` faltou e o turno rodou solto (S2), nada aqui se aplica.
- **Falha do RUNNER vence a negação.** As duas assinaturas podem estar no mesmo
  stderr. A do runner é mais específica E é culpa NOSSA — contá-la como "o
  agente foi barrado" culparia o inocente e esconderia um defeito do Frota. A
  frase diz isso com todas as letras: *"Isso é falha do Frota, não do agente."*
- **Assinaturas POR BACKEND, não uma união.** `SEATBELT_RUNNER` e
  `SEATBELT_NEGOU` têm nome de backend de propósito: o Landlock do S5 fala outro
  dialeto, e uma lista só passaria a "reconhecer" no macOS frases que só existem
  no Linux. Reconhecimento falso é pior que nenhum, porque a frase fica errada
  com confiança.

### O silêncio do agy virou sinal

`Outcome` ganhou `emitiu_saida`. Não é telemetria: é o único jeito de separar
"confinado e trabalhou" de "confinado e engoliu o bloqueio". O agy sai com
`exit 0`, stdout vazio e stderr sem assinatura nenhuma — **ele não falha, finge
que funcionou**.

`SilencioSuspeito` existe só por causa dele, e a frase é deliberadamente
desconfiada em vez de afirmativa (*"costuma ser o motor engolindo um
bloqueio: desconfie do resultado"*): não temos como PROVAR que foi bloqueio,
e afirmar o que não se sabe seria o mesmo pecado do rótulo sem dente.

E o caminho feliz não vira ruído: turno confinado que PRODUZIU saída é
`Irrelevante` — sem isso a funcionalidade viraria aviso em todo turno de leitura.
