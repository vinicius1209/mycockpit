# Log de decisões (ADRs)

Decisões tomadas na entrevista de discovery (junho/2026). Formato curto:
**Contexto → Decisão → Consequência.** Status: ✅ aceito.

---

### ADR-001 — Escopo pessoal-primeiro ✅
- **Contexto:** o plano original oscilava entre ferramenta pessoal e produto (cloud,
  posicionamento, A/B testing).
- **Decisão:** construir como **ferramenta pessoal**; decidir "produto" só depois de uso
  diário. Arquitetura não fecha portas, mas cloud/auth/A-B saem do escopo inicial.
- **Consequência:** sucesso = "uso todo dia", não market fit.

### ADR-002 — A dor é coordenar agents fora do terminal, não memória ✅
- **Contexto:** o plano abria por "ChatGPT desktop" e por um motor de memória.
- **Decisão:** a dor real é **usar claude/codex/opencode no terminal cru**. Reexplicar
  contexto **não** é a dor (`CLAUDE.md`/`AGENTS.md`/memórias do CLI já cobrem).
- **Consequência:** sem memory engine no início; o cockpit só **lê/mostra** os arquivos.

### ADR-003 — Camada fina sobre o `claude` CLI ✅
- **Decisão:** o v0.1 é um **front-end do `claude` CLI já instalado e autenticado**.
- **Consequência:** zero gestão de API key; reusa auth/assinatura; não reimplementa
  terminal/git/MCP no v0.1.

### ADR-004 — Chat é o centro, com seletor de destino+modelo ✅
- **Contexto:** referência visual = shadcn `@blocks-so/ai-02` (input com seletor de modelo).
- **Decisão:** a superfície de comando é um chat com seletor de **destino** (Agent ou
  Modelo direto) + modelo, anexo e *chips* de ação.
- **Consequência:** UI coerente; "destino" é o eixo que roteia a mensagem.

### ADR-005 — v0.1 = Claude Code apenas, um por vez ✅
- **Decisão:** integrar **um agent fundo** (Claude Code), ponta a ponta; **um por vez**
  (sem paralelismo).
- **Consequência:** prova o conceito inteiro com 1/3 do trabalho; outros agents no v0.2.
- **Suporte:** Claude Code tem a melhor saída estruturada (`stream-json` + Agent SDK);
  Codex logo atrás; OpenCode mais simples; Aider o mais fraco.

### ADR-006 — Dirigir via CLI subprocess + `stream-json` (adiar Agent SDK) ✅
- **Decisão:** backend Rust faz `spawn` do `claude` e parseia o JSONL. Não embutir o
  Agent SDK (sidecar Node) no v0.1.
- **Consequência:** menos dependências; reconsiderar o SDK quando precisar de callback de
  permissão interativo fino. (ver `architecture.md`)

### ADR-007 — Sem terminal embutido no v0.1 ✅
- **Decisão:** eventos estruturados (incl. `Bash`) viram **cartões no chat**; nada de
  xterm.js/PTY no v0.1.
- **Consequência:** escopo menor; resolve a dor "parar de usar o terminal" por outra via.

### ADR-008 — PTY/tmux adiados para v0.2 ✅
- **Decisão:** terminal real entra no v0.2: `portable-pty` primeiro; **tmux control mode**
  quando quisermos persistência + multiplexação.
- **Consequência:** decisão PTY-vs-tmux fica documentada e arquivada até lá.
- **Pesquisa:** tmux control mode (`-C`/`-CC`) tem esquema de eventos real
  (`%output`, `%window-add`, `%exit`…), mas dá ciclo de vida, não estado semântico;
  prior art: TmuxCC, iTerm2.

### ADR-009 — Política de permissão por projeto ✅
- **Contexto:** rodar agent headless = ele pode editar arquivos e rodar Bash sem você no
  terminal.
- **Decisão:** autonomia é **parametrizada por projeto**, com default são
  (`acceptEdits` + Bash pergunta), sobrescrevível.
- **Consequência:** segurança sem fricção fixa; é a única decisão de segurança do v0.1.
- **Achado M0 (validado):** `--allowedTools` é só auto-aprovação e **NÃO restringe** (o
  agent rodou `Bash` fora da lista). O gate real é `--disallowedTools`/`--tools`; gating
  fino mid-run exige o callback `canUseTool` do Agent SDK (pode reabrir o ADR-006).

### ADR-010 — `AgentEvent` normalizado + trait `AgentRunner` como costura ✅
- **Decisão:** a UI conhece só eventos normalizados; cada agent é um adapter. Definir o
  schema desde já, mesmo com um só agent.
- **Consequência:** Codex/OpenCode/Aider entram no v0.2 sem reescrever a UI.
  (ver `agent-runner.md`)
### ADR-011 — Codex pede permissão via `app-server`, não via `exec` ✅
- **Contexto:** o seletor de permissões prometia um contrato uniforme ("Padrão = o agente
  pede antes de agir") que **só o Claude cumpria**. `codex exec` é mão única: não existe
  `--ask-for-approval` no subcomando (verificado no `--help` da 0.144.6) e, sem TTY, ele
  nunca pausa. No modo Padrão o Codex mudava só o confinamento e **nunca perguntava nada**.
- **Decisão:** para o modo **Padrão** do Codex, trocar o transporte para
  `codex app-server` — o mesmo binário falando JSON-RPC (NDJSON) no stdio, que é o que a
  extensão de IDE do Codex usa. Ele manda `item/commandExecution/requestApproval` e FICA
  PARADO esperando a resposta. Os outros modos seguem no `exec` (battle-tested), e
  `plan_first` também (turno read-only não tem o que aprovar).
- **Consequência:** os cards de aprovação que já existiam passaram a valer para o Codex
  **sem UI nova** — o payload traz `command`/`cwd`, o mesmo shape do `ApprovalData`.
  Falha ANTES do turno (spawn/handshake/thread) cai no `exec` com aviso visível: perde-se
  o gate naquele turno, nunca o turno.
- **Achado que definiu o mapeamento (provado na máquina):** `approvalPolicy: "on-request"`
  **não pede nada** — o modelo só escala se o sandbox barrar, e um `touch` fora do
  workspace passou liso. Quem pede é `"untrusted"`. Teste que trava isso:
  `padrao_usa_untrusted_o_unico_que_pergunta`.
- **Risco aceito:** `codex app-server` é marcado `[experimental]` no `--help`. Por isso
  ele não substitui o `exec`, só cobre o modo que estava quebrado.
- **Limite honesto (agy):** `--dangerously-skip-permissions` é *"auto-approve all tool
  permission requests"*; o agy TEM pedidos de permissão, mas só na TUI. Em `-p` não há
  canal e sem a flag ele TRAVA esperando um humano que não aparece. Não há
  `mcp-server`/`app-server`/ACP na 1.1.7 ⇒ **impossível** hoje. A UI passou a dizer isso
  na cara (`lib/permissionNote.ts`) em vez de fingir contrato uniforme.

### ADR-012 — Envio re-entrante mira a conversa de ORIGEM, nunca o foco ✅
- **Contexto:** uma mensagem enfileirada numa conversa do projeto X foi enviada na conversa
  aberta do projeto Y. O `handleSend` lia `useChat.getState().activeId`, e a drenagem da
  fila (no `finally` do turno) **re-entrava** minutos depois, relendo o foco — que já era
  outro. Pior: o `project` vinha do closure antigo, então rodava com o `cwd`/permissão de X
  escrevendo na conversa de Y.
- **Decisão:** todo envio resolve o alvo por `lib/sendTarget.ts`, e o projeto sai de
  `conv.projectId` (o dono do fio), **nunca** do projeto em foco. Quem re-entra (drenagem
  da fila, auto-resume) passa o `convId` de origem explicitamente.
- **Consequência:** turno em background termina no lugar certo; o `notifyTurnEnd` já sabia
  usar `c.projectId`, então o aviso sai com o nome do projeto dono.
- **Nota:** o `office/bridge/send.ts` já era correto (recebe os ids explícitos). A regra
  entrou na lista fechada de paridade do §9 do `agent-office.md`.

### ADR-013 — Interação pendente avisa por 3 canais, e nenhum pode ser silencioso ✅
- **Contexto:** o usuário não sabia quando um turno parava esperando ele. Três falhas
  somadas: (1) `announceArrival` filtrava `kind !== "approval"` ⇒ **pergunta não avisava
  nada**; (2) a bandeja contava só disputa do Fusion ⇒ cega justo com o app em background;
  (3) a notificação nativa **nunca funcionou** — o `dev.vinicius.mycockpit` não está no
  `com.apple.ncprefs` (que lista 17 apps de terceiro), quase certamente por assinatura
  ad-hoc, e o `catch {}` do `nativeNotify` engolia isso desde sempre.
- **Decisão:** pergunta e permissão avisam pelos mesmos três canais — feed do sino,
  contagem de decisões da bandeja, e SO. Para o SO, fallback via `osascript` quando o
  plugin nativo falha (usa a autorização do Script Editor, concedida). Silêncio total só
  quando os DOIS caminhos falham, e aí com toast explicando.
- **Consequência:** o aviso chega hoje, com o custo de sair atribuído ao "Script Editor".
  O conserto definitivo é assinar o app com Developer ID.
- **Segurança:** título/corpo vêm de nome de conversa e comando de agente — entrada NÃO
  confiável. O texto vai como **argv** (`on run argv`), nunca interpolado no fonte do
  AppleScript: interpolar seria injeção de código (`" & (do shell script "…") & "`).
  Provado na máquina que a forma argv não injeta; travado pelo teste
  `payload_vai_como_argv_nunca_no_fonte_do_script`. **Nunca trocar por `format!`.**

### ADR-014 — Composer: estado do turno acima, despacho junto do enviar ✅
- **Contexto:** 13 alvos de clique numa linha, todos com o mesmo peso visual. Quatro
  (preset/agent/modelo/esforço) **travam no 1º envio** — ocupavam o melhor espaço da tela
  para exibir estado imutável. A ação primária era o 13º círculo da fila. E o controle de
  maior consequência (permissão) morava no painel de contexto, a três cliques.
- **Decisão (variante B do mock + split D1):** uma **linha de execução** acima do campo
  concentra o que altera o turno (permissão em 3 posições, planejar antes, contexto,
  identidade colapsada); o rodapé fica só com o que modifica a mensagem (ditado, anexo) e
  o que a despacha. Enviar/Disputa/Missão viram um **split button** — os três consomem o
  MESMO rascunho (`initialTask={value}` + limpa o composer), logo são a mesma ação com
  três destinos, não três ferramentas.
- **Consequência:** 13 → 4 alvos no rodapé. Permissão sai do painel e passa a mostrar o
  modo ATUAL em vez de só alertar depois que você liberou. Com turno rodando, a linha diz
  "vale a partir do próximo envio" — o `--permission-mode` é fixo no spawn e sem esse
  aviso o controle mentiria.
- **Correção de rota registrada:** a primeira proposta jogava ⚔/🚀 no mesmo menu do anexo.
  Errado — anexo *modifica* a mensagem, os outros dois a *despacham*. Famílias diferentes.
- **Fonte única:** a troca de permissão escreve nas três camadas que precisam concordar
  (store, SQLite, `.mycockpit/config.toml`) em `lib/permission.ts`. Duas cópias, e uma que
  esquecesse o config.toml deixaria a UI mentindo sobre o próximo turno.

### ADR-015 — Auto-compact do CLI é dele; nosso dever é não esconder ✅
- **Contexto:** contexto a 100% e nada avisava. O `system/compact_boundary` do stream-json
  caía no `vec![]` do `ClaudeAdapter` (todo `system` que não fosse `init` era descartado).
- **Decisão:** não implementar compactação própria — o auto-compact do Claude Code existe
  (`autoCompactEnabled`/`autoCompactWindow`/`autoCompactThreshold` no binário 2.1.219) e
  está ligado por default. Nosso dever é **surfaçar**: `compact_boundary` e
  `microcompact_boundary` viram aviso no fio, e o anel de contexto deixa de ser mudo acima
  de 90% (ganha texto).
- **Consequência:** você fica sabendo que o modelo perdeu detalhe, em vez de descobrir pelo
  comportamento.
- **Premissa descartada na verificação:** cogitou-se blindar `buildResumeFallback` com
  orçamento de tokens, achando que ele mandava o fio inteiro. **Não manda:** já chama
  `serializeContext(items, 3000)`, que corta cabeça 30% / cauda 70% com marcador. E o
  `renderTranscript` é ilimitado de propósito — vai para DISCO
  (`.mycockpit/context/<convId>.md`), não para o prompt. Não havia risco a blindar.

### ADR-016 — Quem responde "quem está esperando você" é o run, não o kind ✅
- **Contexto:** uma PERGUNTA (`ask_user`) pendente não acendia nada na sidebar e o card
  dela sempre caía no toast do canto, mesmo com a conversa dona aberta na tela. Causa: os
  resolvedores usavam `convIdForInteraction`, que devolvia `null` para question com o
  comentário "question NÃO carrega run_id". **A afirmação era falsa** — em `approval.rs` o
  campo é `run_id: String` e o `handle_conn` o anexa em TODA emissão, sem ramificar por kind.
- **Decisão:** o dono de um pedido se resolve por `run_id` (`ownerByRunId`), sem filtro de
  kind — é a régua de todo mundo que responde "quem está esperando você": aviso
  (`announceArrival`), card inline (`computeContextualSplit`) e sinal da sidebar
  (`awaitingKey`). O recorte approval-only sobrevive só onde a superfície fala de
  permissão: a mão da mesa no Office (rótulo "Aguardando aprovação" — levantar essa mão
  por uma pergunta seria teatro) e o item de aprovação do companion.
- **Consequência:** pergunta pendente acende conversa + projeto e renderiza no fio da
  conversa dona, como a permissão sempre fez.
- **Achado que vale mais que a correção:** as fixtures de `question` das suítes **nunca
  carregavam `run_id`**, contradizendo o payload real. Por isso a suíte era incapaz de
  pegar esse bug — passava pelo motivo errado. As fixtures foram corrigidas, não os testes
  afrouxados.
- **Bônus da mesma família (achado pelo juiz no diff):** enquanto o `runIdOf` lia só
  `data.run_id`, **nenhum approval real era roteado para a conversa dona** — todos caíam
  no host global mesmo com a conversa aberta. Mesmo motivo: fixture com o campo no lugar
  errado escondia o bug.
- **As três superfícies que ficaram para trás (fechadas na revisão do juiz):** o
  `InteractionHost` usava a régua approval-only para o cabeçalho e o "Abrir" do card, então
  pergunta no toast global aparecia sem origem; o `QuestionCard` retornava antes de olhar
  `compact`, e o toast do canto renderizava o formulário INTEIRO de um turno que você não
  está olhando (agora é `QuestionTeaser`: resumo + "Responder" que leva à conversa, porque
  decidir sem o fio à vista é decidir no escuro); e o `companion.ts` resolvia o alvo UMA vez
  com a régua restrita e reusava no ramo `question`, mandando pergunta pro celular sem
  conversa, sem projeto e sem agent. `ownerByRunId` deixou de ser privado para isso.
- **Mesma fixture irreal, terceiro lugar:** a `question` do `companion.test.ts` também não
  carregava `run_id` — a suíte "provava" que pergunta chega sem conversa, provando só que o
  fixture era falso.

### ADR-017 — Silêncio é aceitável para cosmético, nunca para quem está esperando ✅
- **Contexto:** a notificação nativa ficou morta por meses atrás de um `catch {}` vazio, e
  o sintoma para o usuário era "o app não me avisa". Uma auditoria varreu `app/src` inteiro:
  **139 pontos de descarte TOTAL de erro** (25 `.catch(() => …)` + 114 blocos `catch {}`).
- **Decisão:** silêncio segue permitido — a auditoria foi honesta e ~110 dos 139 são
  fallback de parse com resultado visível, onde calar é correto. A régua nova é a pergunta:
  **alguém está esperando um resultado deste caminho?** Se sim, o mínimo é uma linha de log.
- **Os 4 de severidade alta (a corrigir):** `interactions.ts:78` (a entrega da SUA resposta
  ao agente — não é best-effort, é o único caminho; falha = turno pendurado sem card),
  `interactions.ts:604` (falha ao registrar o listener = a feature inteira apagando sem
  sintoma), `learning.ts:347` (`catch { return false }`, mas `false` já significa
  "duplicata" no contrato — erro e duplicata viram a mesma coisa na UI),
  `SddView.tsx:882` (o comentário afirma que o erro chega pelo stream; falso para falha de spawn).
- **Consequência:** a régua entra na revisão. Nenhuma correção foi aplicada em lote —
  classificar "silêncio é correto aqui" é julgamento de produto, um por um.

### ADR-018 — O número da bandeja conta CONVERSAS, não pedidos ✅
- **Contexto:** a contagem de "decisões" da tray somava o tamanho da fila de interações. Um
  turno pode pedir 20 `Bash` idênticos, e um clique em "Aprovar todas" zera os 20 — a
  bandeja anunciava "20 decisões" para uma decisão só.
- **Decisão:** contar **conversas distintas** com pedido pendente
  (`awaitingDecisionCount`). Pedido órfão (sem dono resolvível) conta como um: o card
  continua na tela esperando, zerar esconderia um turno parado.
- **Consequência:** o número volta a dizer quanto trabalho te espera. É a mesma colapsagem
  que o aviso já fazia por episódio (`announceArrival` dedupa por conversa) e o card por
  assinatura — agora os três concordam.

### ADR-019 — Lições não dependem da tela em que você está ✅
- **Contexto:** o `handleSend` injetava as lições do projeto no prompt só quando
  `viewMode === "linear"`, e esse valor vinha do closure da render. Enfileirar na conversa A,
  ir para o Escritório e deixar o turno terminar drenava a fila no alvo certo (a frente do
  `sendTarget` consertou o alvo) mas **sem as lições**, só porque a tela tinha mudado.
- **Decisão:** remover a condição. O `handleSend` **é** o turno linear — Fusion e Mission
  têm dispatchers próprios e nunca passam por ele —, então o `viewMode` era um proxy, e um
  proxy errado. O `sendFromDesk` do office já injetava sem condição; agora os dois caminhos
  concordam.
- **Consequência:** um turno em background aprende igual a um turno na tela.
- **Padrão que isto reforça:** valor de TELA não decide comportamento de TURNO. Foi a mesma
  causa raiz do ADR-012 (a fila lia o foco) — ali sobrou o `viewMode`, aqui foi fechado.
