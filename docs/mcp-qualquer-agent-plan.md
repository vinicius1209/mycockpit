# MCP para qualquer code agent, em qualquer máquina (plano)

> Proposto em 26/08/2026. **Tudo abaixo foi MEDIDO** nos binários desta máquina
> (claude 2.1.220, codex, agy 1.1.21, opencode 1.18.21). Referências apontam
> arquivo e símbolo, nunca `arquivo:linha`.

## A restrição que manda no desenho

O Frota vai ser instalado em outras máquinas. **Nada pode ser fixo aqui.**

Auditado antes de propor: os `/Users/<nome>/...` que existem no código estão
**todos em fixture de teste** (JSON capturado); os caminhos de produção saem de
`$HOME` e os binários de `command -v`. A base está limpa, e o plano não pode
sujá-la.

## O erro de modelagem que este plano corrige

Hoje a capability é `managed_mcp: bool`. Ela colapsa **quatro realidades
diferentes em duas**, e é dessa perda que saíram os dois bugs de copy dos
ADR-100 e ADR-101 (a tela dizendo "não suportado" para um CLI que suporta MCP
muito bem).

Medido, um por um:

| motor | como o app instala um MCP | escopo real |
|---|---|---|
| Claude Code | config injetada no spawn | **por run** |
| Codex | config injetada no spawn | **por run** |
| OpenCode | `opencode.json` no diretório do projeto | **por projeto** |
| Antigravity | `agy mcp add` (config global do CLI) | **global** |

**As duas medições que fecham a tabela, feitas hoje:**

- **OpenCode é por projeto.** Com `mcp` no `opencode.json` do diretório,
  `opencode mcp list` DENTRO dele mostra o servidor; FORA mostra
  "No MCP servers configured". Escopo real, sem truque.
- **Antigravity é global, e só.** `agy mcp add|remove|list|enable|disable`
  existe (1.1.21, com `--type stdio|http`, `--header`, `--env`), mas **sem flag
  de escopo**. Testado config por projeto (`.gemini/config/mcp_config.json` no
  cwd): **ignorado**. Testado `ANTIGRAVITY_EXECUTABLE_DATA_DIR`: não afeta MCP.
  Só `HOME` reposiciona, e o token OAuth mora na MESMA árvore
  (`~/.gemini/antigravity-cli/`), então HOME falso derruba o login — além de
  afetar todo o processo (git, ssh, npm), não só o agy.

## A decisão de arquitetura

**1. `managed_mcp: bool` vira `mcp_escopo: McpEscopo`** (`PorRun`, `PorProjeto`,
`Global`, `Nenhum`). Continua sendo decisão por **capability, nunca por nome**
(G1.1); o que muda é a capability passar a ter as palavras que a realidade tem.

**2. A instalação é feita pelo CLI DO AGENT, não por caminho que o app
adivinha.** Esta é a decisão que resolve a portabilidade:

> em vez de o Frota saber que o agy guarda MCP em
> `~/.gemini/config/mcp_config.json`, ele roda `agy mcp add …` e deixa o CLI
> decidir onde escrever NAQUELA máquina.

O caminho do config é conhecimento do fornecedor, muda com a versão e com o
sistema. Guardar esse caminho é justamente criar o "fixo aqui" que o usuário
proibiu. Rodar o comando do CLI é portátil por construção, e ainda sobrevive a
mudanças de layout deles. (O `opencode mcp add` também existe, e vale a mesma
regra.)

**3. Escopo `Global` nunca é escrito em silêncio.** É gesto explícito do
humano, com a frase dizendo o que vai acontecer ("isto vale para TODOS os
projetos e continua depois do run") e com desfazer pelo mesmo caminho
(`agy mcp remove`). Mesma disciplina do `gh auth login` no cartão de Serviços:
o app MOSTRA e conduz, não decide sozinho.

**4. Escopo `PorProjeto` é escrito, mas só no bloco que o app é dono.** O
`opencode.json` pertence ao repositório do usuário e pode estar versionado:
mexer nele é diferente de mexer num arquivo efêmero. O app merge apenas as
entradas que criou, nunca reescreve o arquivo inteiro, e a tela diz que aquilo
é um arquivo do repositório.

## O que NÃO fazer

- **Não** trocar `HOME` para forjar escopo no agy. Foi medido que funciona, e é
  justamente por funcionar que precisa estar escrito aqui: `HOME` vale para o
  processo INTEIRO, então todo comando que o agente rodar dentro da missão veria
  um home falso (git, ssh, npm). O raio de dano é maior que o problema.
- **Não** escrever no `mcp_config.json` do usuário e "restaurar depois". Duas
  missões simultâneas se atropelam, e um crash deixa o arquivo alterado para
  sempre.
- **Não** guardar caminho de config de agent nenhum no código. Se for preciso
  saber onde está, pergunte ao CLI.
- **Não** dizer "não suportado" para motor que fala MCP. O limite é do Frota, e
  a frase tem de dizer isso (ADR-101).

## Fases

### F1 — A capability ganha as palavras certas
`McpEscopo` no `adapters.rs`, um valor por motor com a evidência e a data ao
lado (padrão da casa). `managed_mcp` deixa de existir; quem lia o bool passa a
ler o escopo. A UI deriva a frase do escopo, e some a última copy que mente.

### F2 — Instalar pelo CLI do agent
`mcp install`/`mcp uninstall` por adapter, executando o comando do próprio CLI.
Sem caminho de config no nosso código. Falha do comando vira erro honesto na
tela, com stderr, nunca "não deu certo".

### F3 — O gesto humano para escopo Global
Botão explícito, frase que diz o alcance (todos os projetos, permanente) e
desfazer pelo mesmo caminho. Nada acontece sem clique.

### F4 — Escopo por projeto no OpenCode
Merge só do bloco do app no `opencode.json`, com aviso de que o arquivo é do
repositório.

### F5 — O proxy do app, onde ele cabe
O `roteavel_por_proxy` (login do Frota) hoje só vale para escopo `PorRun`.
Revisar o que ele significa nos outros escopos, agora que eles existem no
vocabulário.

## Definition of done

- Nenhum caminho de config de agent no código de produção (guarda automática).
- Cada motor diz a verdade sobre o próprio escopo, e a tela nunca chama de
  "não suportado" quem suporta.
- Instalar um MCP no agy e no opencode funciona pelo app, pelo CLI deles.
- `cargo`, `tsc`, `vitest`, guardas da casa, e2e.
