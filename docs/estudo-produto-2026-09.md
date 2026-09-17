# Onde a Frota cresce — estudo de mercado e ideias (16/09/2026)

> Gatilho: *"o nosso compactar atualmente efetivamente compacta? … dá uma
> estudada nas nossas features, telas, funcionalidades e sugere ideias pra
> gente evoluir. Faça busca na web, veja os projetos clonados. Pensei até em
> inovar em algum app mobile, algo na nuvem."*
>
> Método: evidência do banco e da sessão real para a parte do compactar;
> leitura do nosso código e dos clones (`~/projetos/orca`, `paseo`, `comet`);
> pesquisa web de setembro/2026. Fontes no fim. Nada aqui é decisão: é
> material para decidir. O que já estava mapeado em `roadmap.md` e
> `product-evolution.md` NÃO se repete — este doc cobre o que mudou depois.

---

## 0. A pergunta: o `/compactar` compacta mesmo?

**Compacta. Medido, não inferido.** Sessão `8f7bba12`, turno das 23:09 de
15/09, linha `compact_boundary` do próprio Claude Code:

| campo | valor |
|---|---|
| `trigger` | `manual` (foi o nosso comando, não o auto-compact) |
| `preTokens` | 882.525 |
| `postTokens` | **8.090** |
| `cumulativeDroppedTokens` | 874.435 |
| `durationMs` | 158.380 (2min38) |

E o fio registrou a coreografia inteira, na ordem certa: `compactar: comando
/compact enviado ao Claude Code (turno técnico)` → `Contexto cheio: o Claude
Code compactou a conversa` → `Contexto compactado.`

Então por que a dúvida apareceu? Porque **o app não te mostrou a prova.** Três
buracos, todos pequenos e todos com o dado já na mão:

**B1 — o anel fica cego logo depois de compactar.** O turno de compactação
devolve um `result` sem `usage` (os dois `turn_costs` dele têm
input/output/cache zerados), então a última medida morre e a conversa fica com
`context_basis = 'unavailable'`. Você vê *88%* antes e *nada* depois. O número
certo existia: `preTokens`/`postTokens` vêm dentro do próprio `compact_boundary`
e o adapter **descarta** (`app/src-tauri/src/adapters.rs:2045` transforma o
evento inteiro num `Notice` de texto fixo). A linha honesta seria
`882.525 → 8.090 tokens`, e o anel voltaria a 4% na hora.

**B2 — a compactação não se declara como despesa.** Custou **US$ 4,67** e 2min38,
gravados em `turn_costs` como dois turnos comuns, sem etiqueta. Num app cuja
tese é custo, a operação de manutenção mais cara do dia é invisível.

**B3 — a régua é nossa e o CLI já tem a dele.** `COMPACT_OFFER_THRESHOLD = 0,70`
é palpite calibrado por pesquisa. O Claude Code de 2026 expõe `/context`
(quebra real do que ocupa a janela) e `/autocompact <n>` (limiar configurável,
default ~167k em janela de 200k). Não lemos nem um nem outro.

→ vira a **ideia I1**, e é a de melhor razão valor/custo da lista.

> **Status (16/09/2026): B1 e B3 resolvidos na ADR-196.** O anel mede contra o
> limiar que o próprio Claude Code aplica, lido por `get_context_usage` (0,7s,
> custo zero, sessão intacta), e o fim do `/compactar` mede o contexto resumido
> e escreve antes → depois no fio. B2 (etiquetar o custo) segue aberto.

---

## 1. O mapa honesto do que já temos

| superfície | o que é forte | onde é raso |
|---|---|---|
| Trabalho (fio) | streaming normalizado de 5 motores, plano vivo, custo por turno, notas, anexos, mapa da conversa | prova de compactação (§0); citação não pula pra linha |
| Painel | heatmap de custo, auditoria, entregas | é retrospectiva; não impede gasto, só conta depois |
| Frota / Agendamentos / Planos de voo | despacho com gesto humano, agendamento com escolhas | agendamento sem precheck nem política de execução perdida (R7) |
| Medidor de janela de uso | statusline + RPC do Codex, stale-drop honesto | não cruza com custo em US$; são dois mundos |
| Companion | web na LAN, pareamento com aceite no desktop, revogação viva | sem push, sem fora da LAN, sem paridade de ação |
| Especialistas | 4 personas versionadas no projeto, com guarda de parser | opinam quando chamados; não entram sozinhos em nenhum portão |
| Missões / Fusion | execução multi-fase, disputa entre motores | a disputa não vira aprendizado ("quem é mais barato pra isto") |

---

## 2. O que o mercado fez enquanto a gente construía

**A categoria virou commodity.** Conductor (Melty/YC) popularizou o orquestrador
macOS com worktree por agente; hoje disputam o mesmo espaço Crystal, Nimbalyst,
Superset, Paneflow, Claude Squad, Fractal, o **JetBrains Air** e o **Intent** da
Augment Code. O Vibe Kanban, referência do ano passado, teve a empresa
encerrada em abril/2026 e sobrevive como OSS comunitário. Mensagem: *"eu
orquestro vários agentes em worktrees"* não é mais uma proposta de valor.

**O GitHub normalizou o vocabulário.** O Agent HQ entrega "mission control" para
agentes de qualquer fornecedor e consagra o `AGENTS.md` como política de
comportamento no repositório. Bom para nós (o nosso `CLAUDE.md`/`AGENTS.md` por
bloco já é exatamente isso) e perigoso: a camada de orquestração está virando
plataforma de terceiro.

**O celular deixou de ser diferencial — para o Claude.** A Anthropic lançou o
Remote Control em fev/2026 (sessão local dirigida do claude.ai/code ou do app
iOS/Android) e em ago/2026 passou a listar cada máquina rodando
`claude remote-control` como um card no app. Paseo e Vicoa já tratam mobile como
superfície de primeira classe **multi-motor**. Ou seja: mobile só paga se for
agnóstico e trouxer o que a Anthropic não dá.

**O custo saiu de controle, e ninguém resolveu.** Gartner acusa falta de
transparência dos fornecedores; contas saltaram de US$ 20/100 para US$ 2.000 a
5.000 por dev/mês, com casos de US$ 20.000; a Uber queimou o orçamento de IA de
2026 inteiro em abril; 41% dos times não sabem o que os assistentes custam.
**Este é o buraco onde a Frota já mora** — e ainda não ocupa, porque o Painel
conta o passado em vez de governar o presente.

---

## 3. O que os clones ensinam hoje (o que mudou desde os estudos)

- **Zeron (`~/projetos/comet`)** reescreveu tudo em Rust com **Loro (CRDT)** e
  gpui: engine headless que é a verdade, viewport que só renderiza, e — o ponto
  que interessa — **`WorkspaceScope` imutável por boot** (`Local`, `Synced`,
  `Development`). Autenticar **não** troca o banco em silêncio; a troca só vale
  no próximo start. O plano de comandos é durável dentro do doc (send/steer/
  interrupt viram entradas com dedupe e TTL), então **enviar offline enfileira**
  e o dispositivo dono executa. É o desenho mais honesto de "nuvem opcional" que
  li: quem não loga nunca abre socket.
- **Orca** tem mobile RN/Expo com RPC em `ws://<desktop>:6768` e pareamento por
  QR — o mesmo caminho do nosso Companion, só que app nativo e com relay.
- **Paseo** paga caro pela escolha de *um* app Expo para desktop+web+mobile
  (RN-Web dentro do Electron). Já registramos que não seguimos isso.

---

## 4. As ideias, por razão valor/custo

### I1 · Compactar com prova (baixo custo, faz hoje)
Emitir do `compact_boundary` um evento estruturado com `pre`/`post` (não um
`Notice` de texto), alimentar o snapshot de contexto com o `postTokens` e
escrever no fio *"contexto 882.525 → 8.090 tokens"*. Etiquetar o turno como
manutenção no `turn_costs` para o Painel poder dizer *"US$ 18 do mês foram
compactação"*. Precisa de payload REAL de stream-json em fixture (a captura de
15/09 serve: dá pra reproduzir num turno barato numa conversa pequena).
Complemento: ler `/context` e o limiar do `/autocompact` em vez de só o nosso
0,70.

### I2 · Sair da retrospectiva para o **governo de gasto** (a tese comercial)
O mercado inteiro está gritando sobre conta surpresa e ninguém vende controle
local. A Frota tem `turn_costs`, `usage_baselines` e o medidor de janela — falta
o gesto: **teto por projeto/dia e por missão**, com três reações escolhidas por
você (avisar, pedir confirmação, parar), a projeção "neste ritmo, hoje fecha em
US$ X" e o cruzamento custo-em-dólar × janela-do-plano num só lugar. Nada disso
é daemon nem despacho automático: é o app pedindo a decisão antes, em vez de
mostrar o estrago depois. **É a frente que eu priorizaria.**

### I3 · Compactar sem humano (retomar `compactar-sem-humano-plan.md`)
O plano já existe, C1 nunca entrou: reconhecer estouro de contexto como falha
recuperável e compactar sozinho **apenas onde `ehDesassistido()` diz que não há
a quem perguntar** (missão, agendamento, background). Hoje uma missão longa
chega a 100% e morre. Com I1 pronto, a prova da compactação automática já sai de
graça.

### I4 · Nuvem honesta, no desenho do Zeron, sem virar SaaS
Perfil de trabalho decidido **no boot** e imutável: `Local` (o que existe hoje,
zero rede) × `Sincronizado`. Antes de escrever qualquer backend, a versão barata
é **Tailscale/rede privada + o Companion atual**: 90% do valor por 2% do custo,
e prova a demanda. Se a demanda existir, o passo seguinte é fila de comandos
durável (enviar com o Mac dormindo, o dono executa quando acorda), não um
servidor de transcript.

### I5 · Mobile: PWA com dentes, não app nativo
Já temos Companion web pareado. O que falta não é plataforma, é **capacidade**:
aprovar/recusar permissão, responder uma pergunta do agente, ver o diff e o
custo do dia, e receber aviso quando o agente trava. Notificação sem servidor de
push próprio (decisão registrada) tem duas saídas legítimas: Web Push via
serviço de terceiro **opt-in**, ou o caminho que já usamos, catch-up com
watermark. App nativo (RN/Expo) só se o Companion PWA provar uso diário —
Anthropic já entrega remote control nativo para quem só usa Claude.

### I6 · Caixa de entrada de trabalho externo (R8, agora com urgência)
Issue/PR do GitHub vira conversa com um clique. Estava na fila média; o Agent HQ
transformou isso em expectativa de base. É também o gancho natural do nosso
Inbox, que hoje só enxerga o que nasceu dentro do app.

### I7 · Especialistas com posto de trabalho
Os quatro nasceram ontem e só falam quando chamados. O passo barato é dar a cada
um **um portão**: Prova no fim de uma missão (o que não está provado), Régua num
diff que toca UI, Cronômetro quando o teto de I2 se aproxima. Rodando no gateway
utilitário (modelo barato), vira segunda opinião de centavos — e continua sendo
opinião: quem aprova é você.

### I8 · Aprender com a disputa (Fusion → recomendação)
Temos disputa entre motores e o custo de cada turno. Ninguém colhe o resultado.
Com `turn_costs` + tipo de tarefa dá para responder *"em tarefa de teste, o agy
custou 1/8 do Opus e passou"*. É a única métrica que nenhum concorrente tem, e
conversa direto com I2.

### I9 · O que NÃO fazer
Reescrever em CRDT porque o Zeron reescreveu (não temos multi-dispositivo real
para justificar); app mobile nativo antes do PWA provar uso; servidor de push
próprio; virar mais um orquestrador de worktree genérico — essa briga já tem dez
donos e nenhum ganhando.

---

## 5. Mobile e nuvem, em uma frase

**A nuvem não é o produto; é um perfil.** Rede privada + Companion agora, fila
de comandos durável depois, backend só se alguém pagar por ele. E o mobile não
precisa ser app: precisa poder **aprovar, responder e barrar gasto** — que é
justamente o que nenhum app de celular do mercado faz de forma agnóstica.

## 6. Se for pra escolher três gestos

1. **I1** — a prova da compactação (dias, não semanas; conserta a pergunta que
   gerou este estudo).
2. **I2** — teto de gasto com reação escolhida (a frente que diferencia o
   produto num mercado que está em pânico com a conta).
3. **I3** — compactar sozinho onde não há humano (destrava missão longa e
   reaproveita I1).

---

## Fontes

- [9 Best AI Coding Agent Desktop Apps in 2026 — Augment Code](https://www.augmentcode.com/tools/best-ai-coding-agent-desktop-apps)
- [Best Multi-Agent Desktop Apps (2026) — Nimbalyst](https://nimbalyst.com/blog/best-multi-agent-desktop-apps-claude-code-codex-2026/)
- [Best Tools for Managing Parallel AI Coding Agents in 2026 — DEV](https://dev.to/stravukarl/best-tools-for-managing-parallel-ai-coding-agents-in-2026-14l8)
- [Introducing Agent HQ: Any agent, any way you work — GitHub Blog](https://github.blog/news-insights/company-news/welcome-home-agents/)
- [GitHub Agent HQ opens platform to third-party coding agents — TechTarget](https://www.techtarget.com/searchsoftwarequality/news/366633584/GitHub-Agent-HQ-opens-platform-to-third-party-coding-agents)
- [How to control Claude Code from your phone (2026) — explainx.ai](https://www.explainx.ai/blog/claude-code-mobile-remote-control-phone-guide-2026)
- [Best Mobile Apps for Claude Code in 2026 — Nimbalyst](https://nimbalyst.com/blog/best-mobile-apps-for-claude-code-2026/)
- [AI coding agents could soon cost more than the developers using them — The Register](https://www.theregister.com/ai-and-ml/2026/06/24/ai-coding-agents-could-soon-cost-more-than-the-developers-using-them/5260864)
- [Coding agent cost management — PointFive](https://www.pointfive.co/blog/coding-agent-cost-management-discipline)
- [Explore the context window — Claude Code Docs](https://code.claude.com/docs/en/context-window)
- [Inside Claude Code's Compaction System — Decode Claude](https://decodeclaude.com/compaction-deep-dive/)
- Código lido localmente: `~/projetos/comet/ARCHITECTURE.md` (Zeron), `~/projetos/orca/mobile/README.md`, `~/projetos/paseo`.
