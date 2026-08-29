# X2 — Onde o prompt entra na linha de comando

> Spec para leitura, não para execução. Escrita em 29/08/2026 depois de ler os
> quatro adapters. Nada foi implementado.

## O problema, em uma frase

Cada motor recebe o prompt de um jeito, e esse "jeito" hoje só existe como
**código espalhado dentro de quatro `build_command` de ~200 linhas cada**, com
as regras de ordem escritas em comentário.

## Como está hoje (medido, não lembrado)

| motor | como o prompt entra | onde |
|---|---|---|
| **claude** | `-p` como flag, e o texto no fim atrás de `--` | último argumento |
| **codex** | só `--` e o texto | último argumento |
| **opencode** | posicional puro, sem `--` | último argumento |
| **agy** | `-p <texto>`, os dois grudados | **no meio**, antes das outras flags |

Quatro CLIs, quatro convenções. Nenhuma errada: é o que cada fornecedor
escolheu.

## Por que isso já custou

**Um bug real (e9f7b737).** No claude, o `--` encerra o parsing de opções. A
linha estava saindo `-- <prompt> --output-format stream-json`, então o
`--output-format` virou *texto do prompt* em vez de flag. O CLI caiu em modo
texto, o app esperava JSON, e a UI ficou sem output. Nada falhou, nada logou:
só não apareceu nada.

**Uma armadilha viva.** Anexos são injetados dentro da string do prompt. No
**agy** o `render_attachments` tem que rodar **antes** do `cmd.arg("-p")`,
porque o texto já vai grudado na flag. No **codex** é o oposto: o texto vai no
fim, então dá pra montar depois. Inverter a ordem no agy não dá erro — **o
anexo simplesmente some**.

Hoje as duas regras vivem em comentário. Comentário não roda na CI.

## A ideia que o Paseo dá

Eles resolvem com um sentinela. O perfil declara a linha inteira, com um
marcador no lugar do texto:

```
claude {{{prompt}}}
opencode --prompt={{{prompt}}}
```

E têm uma regra fina junto: **argumento que só existe pra carregar o prompt é
descartado quando não há prompt.** Sem isso, um `opencode --prompt=` vazio vira
uma flag quebrada.

## O que cabe aqui, e o que não cabe

**Não copiar o formato de string.** O sentinela deles resolve um problema que
nós não temos: no Paseo o *usuário* escreve perfis num JSON, então precisa de
uma sintaxe que um não-programador consiga expressar. Nosso registry é Rust
compilado, e o `build_command` faz muito mais que posicionar o prompt (anexos,
permissão, canal de sistema, MCP, resume de sessão). Trocar tudo isso por
template de string seria perder tipo e ganhar string.

**Copiar a ideia por trás.** Que é: *a posição do prompt é conhecimento do
FORNECEDOR, e conhecimento de fornecedor mora num lugar declarado, não
espalhado.* É a mesma regra que o app já aplica em `INSTALL_COMMANDS` e
`UPDATE_COMMANDS`.

## A proposta

### 1. O adapter DECLARA onde o prompt entra

Um dado no contrato, ao lado das outras capabilities. Algo como:

```rust
enum PosicaoDoPrompt {
    /// último argumento, atrás de `--`     → claude, codex
    UltimoAtrasDeSeparador,
    /// último argumento, sem separador     → opencode
    UltimoPosicional,
    /// grudado numa flag: `-p <texto>`     → agy
    ColadoNaFlag(&'static str),
}
```

### 2. Um helper único aplica a declaração

Uma função que recebe o `Command` montado, o texto final do prompt e a
declaração, e faz a colocação. O `build_command` de cada adapter deixa de
posicionar o prompt na mão e passa a chamar esse helper **no fim**.

### 3. A ordem dos anexos vira regra derivada, não comentário

A declaração já responde a pergunta que hoje mora no comentário: se o prompt
está **colado numa flag**, os anexos precisam entrar no texto antes; se ele é o
**último argumento**, tanto faz. O helper pode assumir isso, em vez de cada
adapter lembrar.

### 4. Um teste de contrato em loop

O padrão já existe na casa (`contrato_capabilities_x_comportamento_por_agent`).
Para cada motor do registry, montar um comando e afirmar:

- o prompt aparece **exatamente uma vez** na linha
- nenhuma flag aparece **depois** do prompt quando a posição é "último"
- com anexo, o path do anexo está **dentro** do texto que foi entregue
- sem prompt, nenhum argumento órfão sobra (a regra prompt-only do Paseo)

Esse teste é o item mais valioso da frente. Ele teria pegado o e9f7b737.

## O que esta frente NÃO resolve

Ela **não** vai fazer motor novo entrar sem release. Isso é a PA4 (provider ACP
por config), e é outra frente. O que a X2 faz é deixar a matriz de casos
especiais pronta pra receber a PA4 quando ela vier — hoje um provider definido
por config não teria onde declarar essa informação.

## Tamanho e risco

**Pequeno em linhas, delicado em ordem.** Não muda comportamento nenhum: o
objetivo é que a linha de comando gerada continue **byte a byte igual** para os
quatro motores. O teste de contrato é escrito antes, contra a linha atual, e é
ele quem prova que nada mudou.

Risco real: o `build_command` do claude tem ramos (`--permission-prompt-tool` só
no Padrão, `--add-dir` com anexos, canal de sistema por run). Mexer na
montagem sem cobrir os ramos é como o e9f7b737 nasceu. A ordem de trabalho é
teste primeiro, refactor depois.

## Pergunta aberta para você decidir

O `PosicaoDoPrompt` deve morar no **registry de capabilities** (junto com
`sessionResume`, `systemChannel` etc., com espelho em TypeScript e teste-gêmeo),
ou é detalhe interno do Rust que o front nunca precisa saber?

Minha leitura: **é interno.** O front nunca monta linha de comando, e capability
existe pra UI decidir o que oferecer. Colocar no espelho TS seria pagar o
teste-gêmeo por um dado que ninguém do outro lado lê. Mas se a PA4 vier, isso
muda: aí o usuário declara, e o que o usuário declara precisa ser visível.
