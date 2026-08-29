# A margem do fio — estudo e proposta

> Estudo de 29/08/2026. Pergunta que o originou: **o que colocar no espaço
> vazio entre a sidebar e a coluna de 760px do fio?**
>
> Entregáveis: este documento + `docs/mocks/margem-viva.html` (cinco estados,
> três larguras, dois temas). **Nenhuma linha de app foi tocada.**
>
> Fontes: varredura de mercado (2025–2026) e inventário do próprio código, com
> `file:line`. As duas convergiram numa resposta que nenhuma das duas dava
> sozinha.

---

## 0. A resposta em uma frase

**A margem não é um lugar para encher — é um SLOT que troca de conteúdo com o
estado do turno.** Ocioso mostra marcos; rodando mostra até onde o agente foi e
o que ele está vendo; bloqueado mostra a decisão e mais nada. E **nada ali
narra tempo**: o relógio é do composer.

---

## 1. A contradição, primeiro

A varredura de mercado derrubou a premissa da pergunta:

> **Ninguém no estado da arte mantém um rail vertical fino e permanente ao lado
> da conversa.** O padrão convergido em 12 meses é sidebar de sessões à
> esquerda + painéis que o usuário abre e arrasta.

- **Claude Code Desktop** (redesign de 14/04/2026): painéis arrastáveis
  (`chat, diff, browser, terminal, file, plan, tasks, subagent`), nada
  permanente — tudo abre pelo menu ou atalho.
- **Cursor 3**: "Agents Window" lista todo agente ativo num painel único.
- **Zed**: Threads Sidebar agrupada por projeto; Terminal Threads gerenciando
  `claude`/`amp`/`codex`.
- **Devin Desktop**: kanban de agentes por status.
- **Antigravity 2.0**: tirou o IDE do próprio IDE; tarefas à direita.
- **Maestri**: o outlier — canvas infinito com PTY como nó.

E o precedente que mais dói: **o minimapa é o caso canônico de periferia
ignorada**. A crítica recorrente é que "scrollar com o minimapa também dá pra
fazer com a scrollbar" — ele sobrevive porque é **desligável**.

Some a isso o custo real medido no nosso layout:

| janela | painel direito | gutter por lado | o que cabe |
|---|---|---|---|
| 1280 | não / sim | 138 / **−17** | ícones / **nada** |
| 1512 (14") | não / sim | 232 / **49** | margem / **só a régua** |
| 1920 | não / sim | 398 / 164 | margem / coluna estreita |
| 2560 | não / sim | 657 / 346 | margem / margem |

**No laptop com o painel direito aberto — o caso mais comum — sobram 49px.**
Qualquer desenho que EXIJA largura já nasceu errado.

**Conclusão que sobrevive:** um rail permanente com telemetria é a pior das
opções. O que a pesquisa recomenda, e o que este estudo propõe, é um slot
**contextual e colapsável**.

---

## 2. A doutrina da casa diz a mesma coisa, por outro caminho

O §1 do STYLEGUIDE: *"a UI mostra o estado real da frota e pede a próxima
decisão — **tudo que não é estado nem decisão recua**"*. O §5 fecha: nada que
não tenha o que dizer ocupa tela.

E há uma cicatriz específica que decide o desenho inteiro: **"dois relógios
narrando o mesmo agora" foi o bug dos builds 181/182** (ADR-037, §6). A linha
viva do composer é a **dona única do agora**. Portanto:

> **O composer é o RELÓGIO do turno. A margem é o MAPA dele.**

Essa frase é a régua que aceita e recusa cada ideia abaixo. Cronômetro,
"rodando…", barra de progresso, spinner: **recusados por construção** — não por
gosto, por reincidência.

---

## 3. O que já existe e não tem tela (o inventário)

Este foi o achado que mudou a proposta de "inventar widget" para "dar tela ao
que já streama":

| dado | onde já existe | onde aparece hoje |
|---|---|---|
| **`managedProcess.output`** — tail de 240 linhas, emitido **por linha** | `work_gateway.rs:26,125-141` | **em lugar nenhum** |
| **arquivos tocados no turno vivo** | `lib/mentionRank.ts:169-186` | só ranqueia o menu `@` |
| **árvore de subagentes ao vivo** | `lib/toolTree.ts` (`nodeIsRunning`) | dentro do disclosure, que recolhe sozinho |
| **tool corrente** | `lib/toolGroup.ts:126-132` | cabeçalho do grupo; a linha viva diz só "está trabalhando…" |
| **runs de OUTROS projetos** (`TrayActivity`: título, agent, modelo, início) | `src-tauri/src/tray.rs:27-37` | **só na bandeja do SO** |
| **`BrowserSession` viva** (endpoint CDP, pid) | `src-tauri/src/browser.rs` | nenhuma superfície no fio |
| **evidência visual** (screenshot por `tool_result`) | `src-tauri/src/evidence.rs:23-115` | thumbnail dentro do nó da tool |

E o que **não** existe, pra ninguém propor: **custo e tokens parciais do turno
não são emitidos** — `usage`/`costUsd` só chegam no evento `result`
(`store/chat.ts:1043-1051`). "Custo ao vivo na margem" é mudança de backend,
não de UI.

**Convergência que vale nomear:** o "olho" do navegador que a pergunta imaginou
já está especificado como **B2.3** no `browser-plan` — screencast CDP
(`Page.startScreencast` → JPEG → canvas) com **takeover humano** e a regra "um
navegador, dois pilotos, **um pilota por vez**". A pesquisa confirma que
screencast é a escolha certa: polling de screenshot gera pressão de GC e
throttling sob carga; o CDP empurra frame só quando há mudança visual. **VNC
está fora** — ele só aparece em sandbox remoto, onde não há alternativa.

---

## 4. A proposta: três estados, um slot

### Ocioso — a régua ganha NOME
A régua atual mapeia turnos anônimos. Marcos nomeados (plano aprovado, 1º edit,
teste falhou, PR aberto) transformam "onde estou" em "o que aconteceu". É a
mudança conservadora — e a pesquisa sugere que é a certa, porque minimapa
anônimo é o que as pessoas desligam.

### Rodando — até onde ele foi, e o que ele vê
Duas perguntas, dois módulos:

1. **Raio de alcance** — arquivos tocados, **agrupados por diretório** (a
   pesquisa é explícita: lista por ordem de escrita vira log sem hierarquia),
   com `±` por arquivo. Dado pronto, custo ~zero.
2. **O olho** — miniatura do que o agente está vendo. Começa pelo **PTY**, que
   já streama e não tem tela; o navegador entra quando o B2.3 for feito.

### Bloqueado — a decisão, sozinha
Quando o turno para esperando você, a margem **esvazia** e mostra só o pedido.
É o único estado em que ela pede algo, e por isso o único com cor. Se aceitar
qualquer coisa além de decisão, vira o *audit noise* que o próprio Google
admite no Agent Manager do Antigravity.

### A regra de largura
Progressiva, por container query (mesma mecânica do ADR-111):

| gutter | mostra |
|---|---|
| < 38px | nada |
| 38–90 | régua |
| 90–150 | régua + raio em ícones |
| 150–220 | régua + raio nomeado |
| ≥ 220 | + o olho |

E **colapsável por gesto**, sempre. O minimapa sobreviveu por ser desligável;
não vamos aprender isso na marca.

---

## 5. O que fica FORA da margem, e por quê

- **A frota (outros projetos).** O dado existe (`TrayActivity`) e é valioso —
  a pesquisa confirma que fleet strip só vale quando mostra o que a sidebar
  **não** mostra. Mas a margem é desta conversa; pôr outra conversa ali cria um
  segundo sino. **Casa certa: a faixa de status**, no `PainelDaFaixa` que a
  ADR-118 acabou de padronizar — irmã de "N sessões paradas".
- **Custo ao vivo.** Não há dado (§3).
- **Mapa/treemap do repositório.** Bonito no mock, e é literalmente um
  minimapa: só sobrevive com landmarks NOMEADOS. Fica para depois do raio de
  alcance provar que a pergunta "até onde ele foi" tem demanda.

---

## 6. O espaço em branco competitivo

A varredura não achou **ninguém** mostrando capacidades ativas como estado
persistente: quais skills carregadas, plan mode ligado, MCP servers/tools
ativos, subagentes vivos. O análogo mais próximo é o `tasks pane` do Claude
Code Desktop (subagentes e shells, clicáveis, com botão de matar).

Isso casa com duas coisas nossas: **"agnosticismo é mecanismo"** (o registry já
descreve capacidade por motor, `adapters.rs:319+`) e **"escopo explícito, nunca
herdado em silêncio"**. O que falta é o elo: hoje o registry é **estático por
motor**, e nada diz *"este turno está usando a skill X"* — não há campo de skill
no `AgentEvent`.

**Condição para existir:** cada item precisa ser **acionável** (um toggle, um
"matar", um "abrir"). Lista de selos que não faz nada é decoração, e decoração
permanente é exatamente o que o mercado abandonou.

---

## 7. Fases

| # | o quê | custo | por quê agora |
|---|---|---|---|
| **M1** | **O olho do PTY** — a saída do processo gerenciado ganha tela | baixo (o dado já streama) | é o maior retorno por linha do estudo: existe um terminal ao vivo no store sem nenhuma superfície |
| **M2** | **Raio de alcance** agrupado por diretório | baixo (`arquivosTocados` pronto) | responde a pergunta que dá medo em agente solto |
| **M3** | **Estado bloqueado** — a decisão na margem | médio | tira a decisão do meio do fio quando a tela é larga |
| **M4** | **Régua semântica** (marcos nomeados) | médio | derruba a crítica do minimapa anônimo |
| **M5** | **A frota na faixa de status** (fora da margem) | baixo | `TrayActivity` já agrega; só falta tela |
| **M6** | **Capacidades ativas** (o espaço em branco) | alto | precisa de campo novo no `AgentEvent` — e de cada item ser acionável |
| **B2.3** | **O olho do navegador** (screencast CDP + takeover) | alto | já especificado no `browser-plan`; a margem é a casa do PiP |

---

## 8. O que NÃO fazer

- **Rail permanente com telemetria.** É o minimapa de novo: espaço caro,
  atenção zero, invisível para metade da base (49px no laptop com painel).
- **Cronômetro, spinner ou "rodando…" na margem.** Dois relógios já custaram
  os builds 181/182.
- **PiP animado sem estado real.** O §6 reserva movimento pro que está vivo **e
  termina sozinho**; um terminal que pisca por piscar é espetáculo.
- **Aceitar evento além de decisão no estado bloqueado.** É a fronteira que
  separa "inbox" de "audit noise".
- **VNC.** Screencast CDP resolve, custa menos e já está desenhado.
