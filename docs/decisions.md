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

### ADR-020 — "Sem flag" nunca significou "não vê" ✅
- **Contexto:** o `AgyAdapter` herdava `supports_attachment == false`, e todo anexo virava o
  aviso "não é suportado pelo agy e foi ignorado". A justificativa registrada era que o
  `agy` não tem flag de imagem — **verdade**, e com armadilha: o `-i` dele é
  `--prompt-interactive`, não `--image` (quem assume paridade com o Codex abre sessão
  interativa e trava sem TTY).
- **O erro:** a justificativa confundiu "não tem flag" com "não vê imagem". O Claude
  também não tem flag — recebe o path no prompt e abre com o `Read`. Provado na máquina:
  de um cwd VAZIO, com o arquivo fora do cwd e alcançável só por `--add-dir`, o agy leu
  PNG e PDF pela ferramenta interna `view_file` e respondeu certo sobre os dois.
- **Decisão:** ligar `Image` e `Pdf` no agy, com `render_attachments` espelhando o Claude.
  Detalhe que quebra em silêncio se invertido: no agy o prompt é o **valor** do `-p`,
  então a lista de anexos entra ANTES de `cmd.arg("-p")` — no Codex é o oposto (depois do
  `--`). Teste dedicado trava a ordem.
- **⚠️ Melhor esforço, não paridade:** numa das 4 rodadas do teste o agy leu errado uma
  página de PDF ("BANANA" no lugar de "BERIMBAU") **sem sinalizar falha**. Fica na mesma
  categoria do `--sandbox` e do plan_first emulado. A amostra é pequena demais para virar
  número — não sabemos se a taxa é 5% ou 25%.
- **O que a pesquisa também derrubou:** o `codex exec -i` com PDF **não dá erro** — exit 0,
  stderr vazio, e o rollout mostra o arquivo virando o literal `"image content"`. Nosso
  bloqueio de PDF no Codex estava certo, mas por sorte; agora está documentado.
- **O que decidimos NÃO fazer:** migrar o Claude para `--input-format stream-json`, apesar
  de provado que funciona (imagem base64 e bloco `document`, convivendo com `--resume`).
  Três motivos: o loop compartilhado força `stdin(Stdio::null())` porque o `codex exec`
  trava sem isso; perderíamos o resize/recompress que o `Read` faz de graça; e o caminho é
  não-documentado. Fica como plano B com o gatilho e as pegadinhas mapeados em
  `agent-runner.md` §7.2.

### ADR-021 — Automação desassistida não congela: o pedido expira, o turno morre honesto ✅
- **Contexto:** automação (view Agendado) roda sem ninguém na frente. Em modo Padrão o
  agent pede permissão e o backend **bloqueia sem timeout** (`approval.rs`: *"BLOQUEIA
  esperando a resposta, turno vivo, sem timeout"*). Resultado: às 18:30 o turno dispara,
  pede permissão e **fica pendurado** até você voltar. Não falha, não avisa — congela. E o
  modo Leitura não escapa: o `--permission-prompt-tool` não sobe, mas a tool `ask_user`
  sobe em todo modo com MCP.
- **Decisão:** quem DISPARA declara o run como desassistido (`markUnattendedRun`), e o
  vigia que já existe cobra o prazo (`settings.unattendedAnswerAfterMin`, default 10 min,
  0 desliga). No estouro, responde fail-closed pelo caminho normal e o motivo é honesto:
  *"negado automaticamente: execução desassistida e ninguém respondeu em N min"* — o
  modelo não ouve "dispensado pelo usuário" num momento em que não havia usuário.
- **Por que no front e não no Rust:** o `ApprovalListener` não tem o Channel de eventos do
  run, então de lá não sairia aviso visível no fio. O front já tinha fila, resposta e
  fail-closed prontos.
- **Sem `setTimeout` por pedido:** a cobrança é a passada do ticker que já existe. Elimina
  a classe de vazamento por construção — não há timer para cancelar.
- **Prazo por PEDIDO, não por run:** ancorar no run faria um pedido novo nascer já vencido,
  negando na cara de quem acabou de chegar para aprovar.
- **Duas superfícies, não uma:** notice no fio (o rastro que responde "por que a automação
  terminou sem fazer o que pedi") e item no sino (a conversa nasce em background; sem o
  feed, o desfecho só existiria numa tela que você não abriu). Nativa não — ela já saiu na
  chegada do pedido.
- **Correção do juiz aplicada:** turno parado esperando você **não é turno mudo**. Sem essa
  guarda, os dois limiares (ambos default 10 min) disparavam TRÊS avisos quase juntos.

### ADR-022 — Recorrência "Uma vez": o agendamento que não se repete ✅
- **Contexto:** "hoje às 18:30 quero o merge da PR da release" não é recorrência. O modelo
  só tinha `daily | weekly | cron`, e cron **não expressa "uma vez"** — `30 18 * * *` roda
  todo dia. Pôr o horário no prompt é inerte: o agent roda quando o disparo acontece, não
  quando o texto pede. O caso não cabia em lugar nenhum.
- **Decisão:** `{ kind: "once"; at }`. Depois de rodar, a automação **não some**: fica
  desabilitada e marcada como concluída, com "Reagendar". Apagar não deixaria rastro de
  que rodou nem do que produziu.
- **Consequência colateral desejada:** com "uma vez" existindo, o cron deixa de ser o
  escape para tudo — era ele que carregava casos que não são recorrentes.
- **Correções do juiz aplicadas:** "Reagendar" vale em QUALQUER estado da automação de uma
  vez (restringir a concluída/sem-próxima criava dois becos: mudar 18:30 para 19:00 era
  impossível, e uma pausada que perdeu o horário ficava sem botão nenhum). E o Switch só
  aparece quando ligar/desligar ainda significa algo — numa concluída ele mentiria.

### ADR-023 — Automação ganha "Auto", não "Liberado" ✅
- **Contexto:** o usuário pediu permissão Liberado em automação. O motivo é legítimo: sem
  ela, uma automação que precise escrever fica inútil — em Padrão, o que pedir permissão
  expira sozinho (ADR-021) porque não há quem aprove às 3h. O clamp cego não protegia,
  empurrava o trabalho de volta para a mão.
- **Decisão:** expor **Auto** e manter Liberado fora. Auto roda **sem pedir** — resolve o
  travamento — mas com o freio de cada CLI: Claude `--permission-mode auto` (classificador
  barra exfiltração, `rm` destrutivo, deploy), Codex `approval_policy=never` + sandbox de
  SO, agy `--sandbox`. O enum `Permission::Auto` já existia no Rust e não estava exposto em
  nenhum seletor.
- **Por que não Liberado:** o custo do erro é assimétrico. Auto barrando demais custa uma
  execução repetida; Liberado errando às 3h custa o repositório ou um deploy que você não
  pediu — e você descobre depois. Com você na frente, Liberado é escolha em tempo real; numa
  automação, é aposta feita de manhã.
- **A UI diz a garantia POR AGENT**, porque "Auto" não vale o mesmo nos três: no Claude é
  classificador de verdade, no Codex é sandbox de SO, e **no agy é só `--sandbox`
  best-effort** — o freio mais fraco dos três, no agent que já alucinou (ADR-020). Esconder
  isso repetiria o erro que o `permissionNote` corrigiu.
- **Fail-closed preservado:** valor desconhecido cai em Leitura, e "liberado" continua
  barrado no engine além do tipo.

### ADR-024 — Silêncio não vale para quem está esperando: os 4 pontos altos ✅
- **Contexto:** a auditoria dos 139 descartes totais de erro (ADR-017) elegeu 4 de
  severidade alta. Todos aplicados agora, e o critério foi o mesmo: **alguém está esperando
  um resultado deste caminho?**
- **`interactions.ts` (`answer`)** — a entrega da SUA decisão ao agent era `.catch(() => {})`.
  Não é best-effort: é o ÚNICO caminho. O comentário antigo supunha "se falhou, o run já
  morreu e o Drop cobre" — suposição, não fato: o invoke pode falhar com o run VIVO, e o
  card já saiu da tela. Agora loga, avisa e **devolve o pedido à fila** — se a entrega
  falhou, o agent pode continuar bloqueado, e sumir com o card afirmaria que a decisão
  chegou.
- **`interactions.ts` (listener)** — falha ao registrar `interaction://request` apagava a
  feature INTEIRA sem sintoma; o usuário veria "o agent travou sozinho". Agora grita com
  instrução (reiniciar o app).
- **`learning.ts` (`saveLesson`)** — `catch { return false }`, mas `false` já significava
  DUPLICATA no contrato: erro de banco chegava na UI como "já existe uma regra parecida".
  Você achava que estava tudo bem e a regra não existia. Virou
  `"salva" | "duplicata" | "erro"`, três desfechos e três mensagens.
- **`SddView.tsx`** — o comentário afirmava "erro já chega como card de Error no stream", o
  que é falso para falha de SPAWN: sem stream aberto, nenhum evento chega e o overlay só
  parava. Agora injeta o erro no fio, como fusion e mission já faziam.

### ADR-025 — O app tem contexto próprio: `.mycockpit/` é o `.claude/` da casa ✅
- **Contexto:** o **ADR-002** decidiu que "reexplicar contexto não é a dor — `CLAUDE.md` /
  `AGENTS.md` / memórias do CLI já cobrem". Era verdade quando o app era **só Claude Code**
  (ADR-005). Com três agents, virou furo, e dá pra medir neste repo: **0 de 2** arquivos de
  instrução presentes, **3 personas e 9 memórias** que só o Claude Code lê, e **4 das 5
  entregas gravadas feitas pelo codex** — que lê exatamente o `AGENTS.md` ausente. Os
  agents rodavam sem doutrina nenhuma, e o painel chamava aquilo de "o que o agente
  enxerga".
- **Decisão:** o contexto proprietário passa a morar em `.mycockpit/`, e o que torna isso
  agnóstico é o app **INJETAR** — não delegar à convenção de cada fornecedor:
  - `instructions.md` — a doutrina do projeto, injetada como bloco no prompt (1º turno em
    claude/codex, todo turno no agy, toda fase de missão, todo candidato de disputa);
  - `agents/*.md` — as personas, com escopo de projeto e global (`~/.mycockpit/agents`);
  - `config.toml` e `context/` — o que já existia.
- **Cascata do prompt:** persona → doutrina → lições → pedido. Regra escrita pelo humano vem
  antes de regra destilada por máquina.
- **Git:** a pasta nasceu 100% local (`.gitignore` = `*`). Agora é **seletiva** — doutrina e
  personas versionadas (revisáveis em PR, viajam no clone), `context/`, missões e worktrees
  fora. Upgrade automático do `*` legado; `.gitignore` editado à mão é preservado.
- **Consequência:** `CLAUDE.md` e `AGENTS.md` continuam existindo e sendo lidos pelos donos
  deles — o app só parou de fingir que aquilo era contexto de todo mundo. O painel agora
  cruza cada fonte com o agent da conversa e diz quem lê o quê.
- **O que NÃO entrou:** skills (`.claude/commands`, `.claude/skills`). Torná-las agnósticas
  exige o app injetar o CONTEÚDO da skill, não só validar o nome no preflight — é outro
  trabalho, com outro risco.

### ADR-026 — Especialista: a persona ganha um PAPEL (conselheiro read-only), não um modo ✅
- **Contexto:** o **ADR-025** já materializou personas em `.mycockpit/agents/*.md`. A dor
  que sobrava era **chamar uma persona pra opinar no MEIO da conversa** sem ela virar
  executora — e sem inventar um "modo Especialista" ao lado de Mission (pipeline) e
  Fusion (disputa). O medo declarado do dono era over-engineering ("motor Frota").
- **Decisão:** **1 conceito só** — `Especialista`. Dois **papéis DERIVADOS do estado da
  conversa**, não duas entidades nem tabela nova:
  - **Conselheiro** — `@menção` no fio dispara a persona contra o **contexto atual**
    (não o turno-1), em **read-only** (permissão `fusion-ro`: sem Bash/Edit/Write **e**
    `--strict-mcp-config {}` = sem MCP/`ask_user`, então não há efeito colateral externo
    nem *hang* esperando humano). O parecer entra **inline no fio** (estilo Slack),
    carimbado `persona@version`; **não trava** a identidade da conversa.
  - **Piloto (volante)** — `conv.presetId` = quem executa. Passar o volante re-carimba;
    "retomar o volante" volta pro agent base; remover o especialista tira-o da jogada
    (com confirmação). A reinjeção é `needsPersonaReinject(conv)`, **derivada do estado
    persistido** (presetId + digest null + `hasExecutorTurn`) → **sobrevive a restart**,
    ao contrário do flag efêmero que a S3 tentou primeiro.
- **Identidade & marketplace (E2):** frontmatter ganhou `category/rubric/avatar`. A
  **rubrica é injetada no prompt** (mesmo predicado do digest — não é decorativa). O
  **avatar é DiceBear offline determinístico** (`@dicebear/core`): um estilo base
  (`thumbs`) + **cor pela categoria** = o time vira uma *família* visual, a cor
  **significa** o domínio. Marketplace num **Dialog** (padrão blocks.so), não tela full.
- **Supervisão:** read-only é **fail-closed** e **reusa** ADR-013/021/024 — **nenhuma
  trava nova**. O humano segue no comando; o especialista só lê e opina.
- **O que NÃO entrou (E4, opt-in pós-MVP, JAMAIS modo):** mesa/grupo salvo,
  especialista-de-síntese, auto-pitaco (a persona entrando sozinha). Campo reservado
  vale mais que mecanismo especulativo (`autonomy.md`).

### ADR-027 — O composer vira UM só: Lexical com menção atômica, textarea aposentado ✅
- **Contexto:** o `@menção` (especialista/arquivo) num `<textarea>` era **texto solto** —
  sem pill, sem átomo, edição frágil; o *overlay* de highlight ainda desalinhava o cursor
  em multi-linha. Pra menção virar um objeto de verdade, o input precisava de um editor.
- **Decisão:** migrar o composer do console pra **Lexical** (`lexical` + `@lexical/react`
  + `lexical-beautiful-mentions`), com **pill de menção atômico**. Migração **em fases
  atrás de um toggle** (`composerEngine`) até **paridade total** (`/` comandos, paste de
  anexo, histórico ↑/↓, `@arquivos`), e então **cutover**: Lexical é o **único** composer;
  `<textarea>`, toggle e a setting `composerEngine` **saíram** (o `ComposerShell` virou
  só chrome + slot `input`).
- **Boot:** o grafo do Lexical (~82 kB gzip) fica **lazy** (`React.lazy`) mesmo sendo o
  único — baixa em paralelo ao boot e o chunk `main` fica enxuto (~94 kB gzip
  economizados). Nenhum outro arquivo importa o `LexicalComposer`, então o grafo inteiro
  sai do `main`.
- **Escopo:** só o **CommandConsole** usa o composer novo. **Arena/Fusion/Mission** têm
  `<Textarea>` próprio (não passam pelo `ComposerShell`) e **não foram tocados**. O foco
  programático (tray://new-task, cards) virou `lib/focusComposer.ts`, mirando o alvo
  estável `data-composer="console"` que agora vive no contenteditable do Lexical.
- **Como foi feito:** time em **worktrees isolados** (paralelo, sem conflito), cada fase
  com **gate de review** antes do merge; `vite build` (não só `tsc`) como portão real —
  pegou `.kind`↔`.type` e `scope` fora do union que o `tsc` deixou passar.

### ADR-028 — Trabalho diferido do provider é cidadão do fio: narrado, nunca morto em silêncio ✅
- **Contexto:** o incidente deep-research (31/07): o Claude Code lançou um workflow em
  background (tool `Workflow`), o turno "concluiu" e o resultado NUNCA chegou — o usuário
  cutucou 3 vezes em 2h até o modelo ler o journal na mão. Causa raiz: o app assumia que
  todo trabalho vive dentro do turno, mas o provider tem primitivos que o ultrapassam —
  e o `-p` espera background task por no máx. **10 min**
  (`CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS ?? 600000`, achado no bundle) antes do
  wind-down que orfana o trabalho. Nada era detectado: os eventos `system/task_*` do
  stream-json caíam no descarte (a MESMA lacuna do ADR-015, uma camada acima).
- **Decisão:** conceito normalizado **`AgentEvent::DeferredWork`** (deferred-work-plan):
  os 5 subtypes `system/task_*` + a string `<task-notification>` injetada no `--resume`
  viram um nó no Fio Vivo com ciclo de vida PRÓPRIO (`rodando · concluiu ·
  interrompido`), irmão do nó de processo externo do work-hierarchy-plan. O turno em
  hold diz o que roda em background; `Done`/replay com diferido vivo marca
  `interrupted` (nunca "rodando" falso); o quit avisa antes de matar; o spawn do claude
  sobe o ceiling pra **4h**; o vigia de turno mudo trata progresso de diferido como
  sinal de vida. Spike + inventário: `spikes/deferred-work/`, `stream-json-notes.md`.
- **Consequência:** pesquisa longa termina e o turno de conclusão chega no MESMO
  processo (comprovado: o CLI re-invoca o modelo e emite segundo `result` antes do EOF).
  Push de verdade entre turnos (processo residente com stdin stream-json aberto — sem
  ceiling; provado no spike) fica como evolução D2-B, que de quebra destrava anexo base64.
- **Guardas:** fail-open (sem `task_*` → comportamento de hoje; codex/agy nunca emitem
  → degradação honesta sem nó inventado); `<task-notification>` é entrada NÃO confiável
  (render-only, jamais comando); o nó diferido nunca segura o `finalizing`.

### ADR-029 — Evidência visual é cache com TTL, não acervo: o GC pode recolher, a UI nunca mente ✅
- **Contexto:** o B1 (browser-plan) gravou capturas de tool_result em `evidence/<convId>/`
  e o G3.3 estendeu o GC de anexos à pasta (mesma política: órfã só com refs
  não-vazias/F1, TTL 30d por `updated_at`, LRU até LOW_WATER, run ativo segura/F23).
  O review gate apontou a tensão: as refs do GC são por CONVERSA, não por item —
  conversa viva parada >30d (ou vítima do LRU) perde a pasta inteira enquanto o
  transcript ainda aponta os paths.
- **Decisão (aceite explícito):** evidência é **cache reconstituível**, não acervo:
  a fonte de verdade da conversa é o texto do fio; a captura é auxílio visual que
  o agent pode refazer. O GC recolhe pela política padrão e a UI degrada honesta
  (chip "evidência removida", nunca imagem quebrada — MessageList). Sem GC, um
  usuário de Playwright acumularia screenshots sem teto.
- **Consequência:** capturas de conversas antigas somem antes da conversa; quem
  precisar de evidência permanente anexa/exporta. **Caminho de upgrade registrado:**
  se isso morder de verdade, o conserto é refs por ITEM (`ChatItem.images` como
  fonte do GC), não afrouxar o TTL.

### ADR-030 — Custo de missão mora no ledger (turn_costs); deliveries sai da união, com perda transitória aceita ✅
- **Contexto:** até o MH2.1, o custo de uma missão só existia em `deliveries`
  (gravada UMA vez, no fim, e SÓ quando a missão terminava done) — missão
  abortada/estourada/falhada não deixava custo em lugar nenhum, e as somas do
  Painel misturavam duas fontes. O MH2.1 fez cada FASE gravar `turn_costs`
  (inclusive tentativas descartadas e desfechos ruins), a mesma fonte única do
  chat/disputa.
- **Decisão:** `deliveries` deixa de participar da união de custo
  (`loadLedger`, db.ts): vira registro de ENTREGA (recall/histórico; entrega ≠
  custo). Mantê-la na união contaria as missões novas em DOBRO (fase em
  turn_costs + total em deliveries), pra sempre.
- **Consequência (perda transitória, aceita):** o custo de missões concluídas
  ANTES do MH2.1 vivia só em `deliveries` e SOME das somas do Painel/cards.
  Preferimos um buraco histórico finito e honesto a uma dupla contagem
  permanente nas somas novas; quem precisar do valor antigo ainda o vê na
  própria delivery (a linha não foi apagada).

### ADR-031 — Fecho do gate MH3+MH4: presets congelados ao salvar time; prova de neutralidade exige commit por fase ✅
- **Contexto:** o gate de review do mission-hardening (MH3+MH4) aprovou com
  ressalvas e deixou dois aceites que merecem registro, não correção.
- **Decisão (a) — presets de fábrica materializam ao salvar time no Dock:**
  "Salvar como time" persiste a LISTA inteira de presets nas Settings
  (`saveTableMissionPresets`), o que congela os presets de fábrica como cópias
  do momento — um default futuro (novo teto, nova fase) NÃO alcança quem já
  salvou um time. Trade-off aceito: é o mesmo comportamento do "restaurar
  padrão" e de qualquer preset editado; a alternativa (merge por id a cada
  boot) reintroduziria a mágica silenciosa que o app evita. Quem quiser os
  defaults novos apaga o preset e o de fábrica volta.
- **Decisão (b) — lição de processo: plano multi-fase commita por fase:** a
  prova de neutralidade do MH4.1 (refactor do launch pra máquina de fases) se
  apoiou nas suítes (26 arquivos / 214 testes intactos), mas ficou SEM lastro
  auditável por diff — a árvore estava suja com MH1–MH3 não commitados e não
  dá pra isolar "o que o MH4.1 mudou" a posteriori. Doravante, execução de
  plano multi-fase fecha cada fase com commit próprio (mesmo em branch de
  trabalho): o diff da fase é parte da Definition of Done, não cortesia.
- **Consequência:** (a) documentado no mission-hardening-plan como quirk
  conhecido; (b) vale pra todo plano novo em docs/*-plan.md — o gate de review
  pode exigir o diff por fase como evidência.

### ADR-032 — No inbox, DESCOBERTO ≠ PENDENTE: o badge é sinal de agora, não arqueologia ✅
- **Contexto:** chat novo no `meuingresso3.0` e o sino acendeu "2" — dois "Aprovar PRD" de
  planos SDD criados em MAIO/2026 pelo fluxo do usuário no terminal
  (`.claude/plans/sdd-auth-05-mobile-mfa` e `sdd-auth-06-cleanup`, `stage:"prd"` e
  `artifacts.prd.approved:false`). Ler o `.claude/plans` está certo (é a fonte real); contar
  isso como interrupção não: o badge do sino significa "precisa de você AGORA", e 68 dias de
  dívida herdada do terminal não é agora.
- **Decisão:** gate do SDD (`prd`/`pr`) que o app apenas **descobriu no disco**, sem nenhum
  gesto humano pelo app naquele plano, entra na lista numa seção separada ("Encontrados no
  projeto", abaixo de "Precisam de você") e **não conta no badge nem na fila do Painel**. A
  **adoção** — criar o plano no app, aprovar o PRD, rodar/marcar/sincronizar etapa pelo
  SddView — promove o plano a pendência normal, e é **persistida** na tabela de frontend
  `sdd_plan_marks` (`project_id` + `slug` + `adopted_at` + `ignored_at`, `CREATE TABLE IF
  NOT EXISTS` em `lib/db.ts`, **sem migração no lib.rs**): vale cross-sessão. O que **nasceu
  no app** (disputa do Fusion, card do board, proposta do curador) segue contando sempre.
  "Ignorar este plano" some com o item e é reversível pela linha "N ignorados" do sino.
- **Guardas:** (a) **fail-open** — falha ao ler `sdd_plan_marks` (ou ausência de banco)
  volta ao comportamento antigo (tudo conta), com aviso no console; esconder pendência real
  por erro de leitura seria o pior dos dois mundos. (b) O app **nunca escreve** essa marca
  no `.claude/plans` do usuário: o plano é dado dele, o app só lê. (c) Origem e idade ficam
  visíveis no item (`.claude/plans/<slug> · criado há N d`) — procedência é parte do estado.
- **Consequência:** o número do sino volta a dizer "isto te espera". A régua da tray
  (ADR-018) não muda: ela nunca contou gate de SDD, só interações e disputas.
- **Revisão da auditoria (ago/2026) — a adoção não pode depender de UMA escrita:** o
  gate de review aprovou com ressalvas e apontou que a regra era **fail-open na leitura
  e fail-closed na escrita**: `adoptPlan` engolia a falha do `adoptSddPlan`, então um
  plano criado NO APP que pegasse um `database is locked` transitório aparecia segundos
  depois em "Encontrados no projeto · criado agora", fora do badge e sem gesto de
  recuperação. Correção em três camadas (todas entregues):
  1. **A adoção deriva também de `stage_runs(project_id, slug)`** (`listDrivenPlanKeys`,
     união com as marcas). Essa tabela só ganha linha quando o **cockpit dirigiu a
     etapa**, então é **prova documental**, não anotação: `sdd_plan_marks` virou **cache
     do gesto, não fonte única**. Escolhi as duas fontes (e não só uma) porque nenhuma
     cobre tudo: `stage_runs` não conhece "criei o plano" / "aprovei o PRD" / "marquei a
     etapa" (nada disso roda agent), e a marca sozinha era o ponto único de falha do
     achado. O fail-open continua valendo pelas duas: falha de leitura em **qualquer**
     das fontes volta a contar tudo.
  2. **`adoptPlan` faz retry curto** (90ms, 240ms) e **devolve se gravou**; falha final
     vai pro console (ADR-017) e vira aviso honesto na UI ("Plano criado, mas não
     consegui marcar a adoção").
  3. **"Adotar" no item descoberto** (Painel e sino): o humano promove o plano à fila com
     um clique, que é também o resgate de quem nasceu aqui e perdeu a marca.
- **Não-retroatividade (limite conhecido):** plano que o app dirigiu antes desta versão
  **volta adotado** de graça (o `stage_runs` é histórico e já estava lá). Plano que só
  foi *criado* ou teve o *PRD aprovado* pelo app antes da tabela existir continua
  rebaixado a "descoberto" — não há de onde derivar esse gesto. Recuperação: um clique em
  "Adotar". Não vale inventar backfill por heurística de data.
- **`sdd_plan_marks` é estado VIVO:** `hardDeleteProject` passou a apagá-la junto com
  cards/schedules/conversas. Sem isso ficavam linhas órfãs de um `project_id` morto que
  nada mais leria nem limparia. Atenção: re-adicionar a mesma pasta gera **id novo**,
  então as adoções **não voltam** (o disco é o mesmo, o projeto do app não).
- **Cobertura do SQL:** `db.sddMarks.test.ts` (fake SQLite mínimo, padrão
  `db.cards.test.ts`) fixa o que antes só existia no comentário: idempotência
  (`COALESCE` mantém o 1º `adopted_at`), "adotar limpa o ignorado", e a assimetria do
  `setSddPlanIgnored` (INSERT grava `adopted_at` NULL, DO UPDATE preserva a adoção — dá
  pra ignorar plano adotado e o desfazer devolve ele ao badge).
- **Furo aberto: o gate `pr` é caminho MORTO contra o toolchain real.** Varredura dos 49
  manifests em `~/projetos` (ago/2026): `links.pr_url` existe em 20 planos e **todos**
  estão com `stage:"done"` — inclusive os 3 com `merged_at: null`. Como o gate exige
  `pr_url && stage !== "done"`, ele nunca dispara. E o app **nunca escreve** `pr_url`:
  `git_create_pr` (git.rs) devolve a URL do `gh pr create` pra UI e ninguém a grava em
  manifest nenhum. Opções registradas, **nenhuma implementada** (decisão do dono):
  (i) o cockpit passa a gravar `pr_url` + `stage:"pr"` no manifest ao abrir PR por aqui
  (fecha o loop e faz o gate valer, ao custo de o app escrever mais uma chave no
  `.claude/plans` do usuário); (ii) o gate `pr` sai do inbox (menos código, e o PR aberto
  já aparece na fila do Painel por outro caminho); (iii) fica documentado como suporte a
  um toolchain de terceiro que grave `pr_url` antes do `done` — hoje nenhum dos meus
  grava. Enquanto não se decide, o custo é código morto com aparência de funcionalidade.
- **Drift de CAIXA no manifest (corrigido):** `normStage` não normalizava
  maiúsculas, então `checkout-architecture-longterm` (meuingresso3.0, `"stage":"PRD"`)
  era **inadotável**: fora do trilho da UI e nunca listado no inbox, nem como descoberto.
  Agora o alias é case-insensitive (`sdd.manifest.test.ts`, com o manifest real). O mesmo
  manifest mostra que o dado é heterogêneo além do stage: `artifacts.prd` é **string**
  (caminho) e não objeto, e `consistency_anchors` são strings. O parse tolerante
  sobrevive aos dois; no caso do PRD o default `"PRD.md"` até acerta o arquivo (a UI já
  prefixa `<projeto>/.claude/plans/<slug>/`, então usar a string daria caminho
  duplicado) — mas é acerto por acidente, e vale relembrar antes de "melhorar" isso.

### ADR-033 — O usage do `codex exec` é ACUMULADO DA THREAD: custo é delta, contexto é nível ✅
- **Contexto (prova empírica, codex 0.146, 04/08/2026):** o `usage` do evento
  `turn.completed` do `codex exec --json` não é do turno, é o total da THREAD.
  Dois turnos triviais no MESMO thread (o 2º via `exec resume`):
  `{"input_tokens":17494,"cached_input_tokens":9984,"output_tokens":6}` →
  `{"input_tokens":35005,"cached_input_tokens":27136,"output_tokens":12}`. O
  mesmo prompt, o dobro dos números. O adapter lia isso como gasto do turno,
  estimava custo em cima e o store gravava UMA linha por turno em `turn_costs`:
  cada linha carregava o acumulado e o app SOMAVA acumulados (explosão
  quadrática). No banco real do usuário: `codex/estimated` = 67 linhas,
  **US$ 4.217,63**, maior "turno" **US$ 160,02** com 195.249.694 input tokens e
  185.871.872 de cache — impossível. As linhas da mesma conversa cresciam
  monotonicamente (assinatura de acumulação). O `claude-code/reported` (203
  linhas, US$ 1.090,24) é real: o `result` do Claude é por turno.
  Painel, custo por conversa, custo por card, Escritório (US$ 4.695 numa sala) e
  o teto de missão do Codex mentiam pra cima.
- **Decisão 1 — onde mora o estado:** o adapter vive por RUN, a thread vive
  entre runs (o app dá `resume` a cada turno, com processo novo). Então o
  acumulado conhecido é PERSISTIDO pelo front (tabela `usage_baselines`, por
  `thread_id`) e viaja nos dois sentidos: entra no `RunRequest.usage_baseline`
  e volta no `Result.cumulative_usage` (acumulado CRU lido agora). O adapter só
  subtrai (`delta_from`, clamp em 0). Optei por subtrair no **Rust** e não no
  store porque o custo em USD é estimado lá (`pricing.rs`): se o front fizesse a
  subtração, ou duplicaria a tabela de preços, ou teria que diferenciar dinheiro
  no cliente. Assim o número que sai do runner **já é do turno**, e as três
  superfícies que gravam ledger (chat, disputa, missão) não precisaram saber de
  nada. O único ponto do app que conhece o baseline é o `runAgent` de
  `lib/agent.ts`, por onde TODAS as superfícies passam.
- **Decisão 2 — assimetria custo × contexto:** custo é SOMA de deltas; contexto
  é NÍVEL (o prompt do turno). Com um contador acumulado, o nível só aparece na
  DIFERENÇA — por isso o `ContextUsage` do exec passou a ser `delta.input`. Duas
  correções num lugar só: (a) somar acumulados fazia o anel crescer pra sempre
  (62k depois de dois turnos triviais de ~17,5k); (b) o cálculo antigo era
  `input + cached_input`, e como o `input_tokens` da API da OpenAI **já inclui**
  o cacheado (é o que o `pricing.rs` assume), isso contava o cache duas vezes.
  A leitura agora bate com o outro transporte do Codex (o app-server usa
  `tokenUsage.last`, que já é do último turno).
- **Decisão 3 — capability, não nome:** `cumulative_usage` entrou no registry
  (adapters.rs + espelho `cumulativeUsage` em lib/agents.ts, teste-gêmeo
  `matriz_cumulative_usage_por_agent` ↔ `agents.usage.test.ts`), com coerência
  cobrada no loop de contrato (`cumulative_usage` exige `session_resume`: o
  acumulado só cresce entre turnos da MESMA thread). É o registry que diz de
  QUAL motor o histórico está inflado — nenhum `agent === "codex"` no genérico.
- **Decisão 4 — dado corrompido: reconstruir, nunca apagar.** As 67 linhas
  antigas não são lixo, são acumulados: dentro de cada conversa, em ordem
  cronológica, o gasto do turno é a diferença para a linha anterior (e a
  primeira vale inteira, porque o acumulado dela inclui turnos anteriores ao
  ledger — dinheiro gasto de verdade, só concentrado). Custo é LINEAR nos
  tokens, então a diferença de custo entre duas linhas é o custo do delta: a
  reconstrução não precisa da tabela de preços. Fica atrás de ação EXPLÍCITA
  (Configurações ▸ Custo & histórico ▸ "Recalcular"), guarda os originais em
  `turn_costs_usage_raw`, carimba a linha (`turn_costs.usage_basis`, migração
  **v34** no lib.rs: `delta` = gasto do turno, `recomputed` = reconstruída,
  NULL = base antiga) e é idempotente. No banco do usuário isso leva o total de
  US$ 4.217,63 para ~US$ 190.
- **Limites conhecidos (nenhum corrigido, todos honestos):** (a) a reconstrução
  supõe que linhas seguidas da mesma conversa são da mesma thread — uma queda
  de valor é lida como thread nova (linha volta a valer inteira), mas linhas
  independentes que por acaso cresçam viram delta e SUBcontam; escolhi errar
  pra baixo, nunca pra cima. (b) O primeiro turno pós-atualização de uma thread
  antiga cobraria a thread inteira de novo; por isso o baseline é SEMEADO da
  última linha antiga da conversa (e a reconstrução re-baseia as threads vivas
  antes de reescrever). Se a conversa trocou de thread nesse meio-tempo, o
  baseline sai alto e um turno é subcontado. (c) Baseline perdido = um turno
  superestimado, não uma explosão: o próximo turno já corrige.

### ADR-034 — No ditado, streaming é FEEDBACK; a verdade é o arquivo ✅
- **Contexto:** o usuário relatou que ao soltar o botão o ditado "comeu boa
  parte da frase". Duas causas reais no sidecar (`stt/main.swift`): o STOP
  parava o engine e removia o tap ANTES do `endAudio()` (o áudio em voo morria
  no caminho) e o texto final do reconhecedor podia vir mais curto que o último
  parcial, com a guarda de encolhimento disparando só a partir de "menos da
  metade" do tamanho — perder 10-40% do fim passava reto.
- **Decisão 1 — ordem do STOP com drain:** 300ms com o mic AINDA aberto (os
  últimos buffers do tap entram no request), então `endAudio()`, então
  `engine.stop()`/`removeTap`. O drain vem antes do `endAudio` porque depois
  dele todo `append` é ignorado: drenar depois não recuperaria nada.
- **Decisão 2 — o final nunca encurta:** `moreComplete(candidate, best)` (pura)
  substitui a heurística de tamanho no desfecho: contém/estende vence, pedaço
  perde, divergência decide por número de palavras, empate normalizado
  (pontuação/acento/caixa) fica com o candidato. A heurística da metade
  sobrevive só como detector de reset silencioso do reconhecedor (e commita o
  melhor visto, não o último parcial).
- **Decisão 3 — o streaming não é a fonte do texto final:** a sessão inteira é
  gravada num CAF temporário e o STOP roda
  `SFSpeechURLRecognitionRequest` sobre o arquivo INTEIRO (on-device, mesma
  stack, zero dependência nova). É a lição da categoria (Wispr Flow e afins): é
  impossível "comer o fim" quando o fim está no arquivo. O streaming continua
  existindo para o feedback ao vivo, que é o que ele faz bem.
- **Decisão 4 — degradação sempre com fala e com aviso:** se a releitura falhar,
  estourar o prazo (5s) ou o arquivo não existir, entrega-se o melhor texto do
  streaming com `{"warn"}` (canal → `stt_stop` → toast). Nenhum caminho perde
  fala; o usuário sabe quando o texto veio do plano B. Uma releitura concluída
  com sucesso que divirja do streaming não dispara aviso: contagem de palavras
  não prova áudio truncado. `moreComplete` ainda preserva a versão mais completa,
  silenciosamente. O áudio é apagado em todo desfecho (inclusive `atexit`) e
  sobras de `kill -9` são varridas no boot: fala gravada não sobrevive à sessão
  que a gerou.
- **Prova, e o limite dela:** não há harness de teste Swift no repo (o sidecar é
  UM arquivo compilado pelo `build.rs` com `swiftc`, sem SwiftPM/XCTest). A
  suíte da regra vive dentro do binário (`--selftest`, sem mic nem permissão) e
  o `cargo test` a executa. Com binário velho (swiftc da máquina falhando) o
  teste PULA com aviso ruidoso, e o `build.rs` avisa que o sidecar ficou na
  versão anterior — em vez de fingir verde.

### ADR-035 — O Escritório sai do app: superfície precisa pagar seu custo; a ponte de dados fica ✅

- **Contexto (11/08/2026):** decisão de produto do usuário, nas palavras dele: o
  Escritório estava "ali só pra bonito, perfumaria" — ele vive na aba Trabalho.
  Rumo maior: produto de compra única, Mac/Linux, onde cada superfície mantida
  paga seu custo de manutenção. O episódio decisivo: o ticker do Pixi seguia
  desenhando a 60 FPS com o office ESCONDIDO e degradava a digitação — a
  superfície de espetáculo cobrando pedágio da superfície de trabalho.
- **Decisão 1 — a cena sai inteira, os docks não migram:** mandar tarefa, ver
  retry e estado vivo já existem no Trabalho; segunda porta para as mesmas
  ações é custo dobrado com metade do polimento. `app/src/office/` (65
  arquivos), aba/viewMode, OfficeRailContent, CommandMenu e `pixi.js`
  removidos (R2, commits `81f0934` + `161db5f`).
- **Decisão 2 — a ponte de dados NÃO é perfumaria e fica:** `derive`/`send`/
  `types`/`perf` migraram para `app/src/lib/fleet/` (R1, `935d020`) porque o
  Companion Web vive delas sem o office montado. É o contrato "o que a frota
  faz agora".
- **Decisão 3 — viewMode órfão nunca é tela branca:** persist v4 com
  `migratePersistedApp` (pura, testada): `"office"` e qualquer valor fora da
  união caem em `"linear"`.
- **Caminho de volta documentado:** se houver demanda, o Escritório renasce
  FORA do app como visão do Companion Web lendo o mesmo feed — nunca mais
  dentro do processo que hospeda o composer. Não investir antes da demanda.
- **Restos deliberados:** símbolos `OFFICE_AGENTS`/`OfficeAgentId`/
  `OfficeSnapshot` e a flag `mc.office.perf` em `lib/fleet/` mantêm o nome
  (renomear = mudança de comportamento/localStorage, fora do escopo do corte);
  comentários "Escritório" em 5 arquivos de missão aguardam a frente de missão
  liberar os arquivos. `docs/agent-office.md` vira doc histórico.

### ADR-036 — Tokens de aparelho do Companion: arquivo 0600, não Keychain ✅

- **Contexto (11/08/2026, C4 do companion-plan):** o pareamento v2 dá a cada
  celular uma credencial própria; era preciso decidir onde guardá-las. O
  mcp_auth usa Keychain — a dúvida era consistência.
- **Decisão:** `companion-devices.json` com permissão 0600 no app_data_dir,
  como o token único legado. Keychain fica pro mcp_auth.
- **Por quê:** o mcp_auth guarda credencial de serviço EXTERNO (vazar =
  acesso fora da máquina); os tokens do companion são emitidos pelo PRÓPRIO
  app para autenticar entrada na LAN — o valor deles é limitado ao que o
  companion serve, e quem lê o app_data_dir já lê o `mycockpit.db` com as
  conversas que o token protege (mesmo perímetro). O arquivo ainda é
  reescrito com frequência (parear, revogar, visto-por-último): Keychain via
  subprocess adicionaria latência e risco de prompt sem elevar o modelo de
  ameaça.
- **Limite honesto:** proteção = permissão de arquivo + conta do usuário.
  Quem quiser mais cifra o disco (FileVault) — o app não finge camada extra.

### ADR-037 — Despoluição do fio: recolhido por padrão (B) com tinta mínima (A) ✅

- **Contexto (12/08/2026):** prints dos builds 186/187 mostraram o fio poluído:
  rótulo e estado repetidos (cabeçalho do grupo + filho), explosão de cor num
  recorte só e altura crescendo com o passado. Três POCs visuais em
  `docs/mocks/fio-despoluicao-{a,b,c}.html` (trade-offs no README ao lado).
- **Decisão:** direção **B por padrão** — grupo concluído recolhe pra UMA
  linha ("2 verificações concluídas · 3s"); só o vivo fica aberto; falha não
  recolhe quieta (o resumo nomeia a culpada, "1 de 7 falhou · X", e expande
  mostrando só a linha falhada com stub "N concluídas · mostrar") — com a
  **paleta de A**: sucesso em cinza, metadados em sussurro mono, cor só em
  falha (vermelho), vivo (st-running) e ação sensível (brass).
- **Exceções deliberadas:** "Liberado" continua âmbar e "Parar" vermelho
  (estados de risco num app que executa comando na máquina não ficam
  discretos); as cores DENTRO do diff aberto ficam (é evidência); e os três
  `st-success` de marco de turno/plano/gesto (caption "concluído", "Regra
  salva", "Plano concluído") ficam verdes — fronteira explícita no README dos
  mocks, são no máximo um por turno e fora do diagnóstico.
- **Contra o mock, de propósito:** SEM relógio vivo no cabeçalho do grupo
  (anotação ⑤ do mock B mostra "12min 40s" ticando). Dois relógios vivos
  narrando o mesmo agora foi exatamente a confusão dos builds 181/182 que o
  B2.2 do background-status-plan matou: a linha viva do rodapé segue dona
  ÚNICA do presente; o grupo vivo mantém só o "atividade há Xs" que já tinha.
- **Não puxar o tapete:** regra exata do auto-recolhimento (toggle manual
  vence; falha nunca recolhe; leitor desancorado com o grupo visível segura o
  grupo aberto; recolhimento acima da viewport compensa o scrollTop no mesmo
  frame) documentada e testada em
  `app/src/components/chat/toolGroupDisclosure.ts`.
- **Onde:** `describeToolGroup` (lib/toolview), `toolGroupDisclosure.ts` e
  `MessageList.tsx`; espec visual e detalhes de implementação em
  `docs/mocks/fio-despoluicao-README.md`. Direção C (trilho) fica registrada
  como evolução futura de "mission control".
- **Correção de transição (29/08/2026):** “turno ainda rodando” não significa
  “há ferramenta ativa”. Entre um `tool_result` e o próximo `tool_use`, o grupo
  agora recolhe as concluídas; a próxima ação abre apenas o presente, com o
  passado resumido. Antes, esse intervalo reabria o leque inteiro.

### ADR-038 — Medidor de janela de uso: capability + poll do Orca como regra, statusline encadeada por gesto ✅
- **Contexto (12/08/2026):** "quanto da janela do meu plano já queimei" (a
  feature "9% used · 4h 22m" do Orca, `competitors-orca.md` achado 1) não
  existia no app. Verificação empírica ANTES de codar: claude 2.1.220 pipeia
  `rate_limits` no stdin da statusline a cada turno (payload real capturado);
  codex 0.146 responde `account/rateLimits/read` no app-server read-only (hoje
  SÓ `primary`/7d, `secondary: null` — a realidade venceu o estudo); agy
  1.1.12 só tem `/credits` (saldo, sem janela/reset).
- **Decisão 1 — capability, nunca nome:** `usage_window:
  Option<UsageWindowSource>` no registry (adapters.rs) com o dialeto no enum
  (`ClaudeStatusline` push / `CodexAppServer` poll), espelho TS `usageWindow:
  "statusline"|"rpc"|null` e testes-gêmeos
  (`matriz_usage_window_por_agent` ↔ `agents.usageWindow.test.ts`). agy =
  `None` honesto: saldo de créditos NÃO vira medidor — sem barra, sem toggle
  (4 camadas de esconder do Orca).
- **Decisão 2 — pipeline SEPARADO do custo:** janela de uso não toca
  `turn_costs`/ledger. Custo é o que o turno gastou; janela é % do PLANO +
  reset. Nenhuma quota é consumida pela medição (statusline é carona; RPC é
  probe local read-only).
- **Decisão 3 — política de poll do Orca copiada como REGRA (números):**
  cadência 15 min; piso 30 s (= o tick do vigia, que é o ticker ÚNICO da
  casa — a passada mora em `checkUsageWindowPoll`); backoff exponencial por
  streak de falha com expoente cap 8, teto na própria cadência; **stale-drop
  30 min, MAS 24 h se a última falha foi 429** ("quota é informativa;
  snapshot velho > 'Limited'"); dedupe de ingest 30 s no receptor (a
  statusline tica ~3×/s durante streaming). Metadados honestos em todo
  snapshot: `source` + `fetchedAt` ("de 2 min atrás"), falha classificada
  (spawn/timeout/protocol/rate-limited) com "falhando desde X" — provider
  configurado FALHANDO fica VISÍVEL; sem dado e sem falha, a pill some.
  Snapshots NÃO persistem entre boots: com stale-drop de 30 min, ressuscitar
  dado do disco seria teatro; o poll repõe em segundos e a statusline no
  próximo turno.
- **Decisão 4 — encadear, NUNCA substituir, e só por gesto:** o slot de
  statusline do usuário pode estar ocupado (nesta máquina: wrapper do Xirp,
  que preserva o do Troco). A instalação (botão em Configurações, nunca no
  boot) gera script com o comando anterior preservado no header E re-executado
  com o mesmo stdin; settings.json por parse→merge→write atômico com backup
  `.bak-mycockpit-<ts>`; desinstalação restaura o VALOR do comando (a
  re-serialização pode mudar formatação/ordem — `preserve_order` foi rejeitado
  porque é feature global do serde_json e invalidaria os fingerprints
  persistidos do mcp_control). Fail-closed onde o efeito é destrutivo: slot
  nosso com script sumido/sem header ⇒ instalar/desinstalar ABORTAM apontando
  o backup mais recente (perder o encadeado em silêncio era o bug). Fail-open
  do lado do script: curl 1 s em background, erro engolido, exit 0 — a
  statusline do usuário nunca quebra porque o app morreu.
- **Consequência:** o H0 do hooks-plan (receptor local) foi materializado por
  esta frente (`hook_gateway.rs`) como substrato reusável — H1/H2 plugam na
  mesma rota `/hook/<engine>` sem mudar o contrato do script. Re-checagem por
  versão registrada no agent-runner §7.1 (12/08/2026).

### ADR-039 — Onboarding: versão de fluxo volta ao começo, e "Pular" reverte o tema em qualquer saída ✅
- **Contexto (12/08/2026, R2 do roadmap):** o onboarding foi reescrito a partir
  da receita Orca/Xirp (`competitors-orca.md` §7, `competitors-xirp.md`). Duas
  regras nossas divergem do código do Orca de propósito; ficam aqui porque a
  casa exige ADR pra divergência deliberada.
- **Decisão 1 — versão de fluxo VOLTA AO COMEÇO, não remapeia.** O Orca mantém
  uma tabela de migração índice a índice por versão de fluxo (um `lastStep` de
  v1 é traduzido pro passo equivalente em v2). Com 3 passos visíveis, a tabela
  custa mais manutenção do que resolve, e um remapeamento errado pula
  capacidade NOVA em silêncio (que é exatamente o motivo de bumpar a versão).
  `resolveStartIndex` devolve 0 quando `record.flowVersion !== FLOW_VERSION`
  (`app/src/components/onboarding/flow.ts`). **O que NÃO divergimos:** versão
  de fluxo decide só ONDE retomar, nunca SE reabrir — quem já concluiu
  (`settings.onboarded`) segue concluído em qualquer versão, e a migração v1→v2
  do `mc.app` continua sendo o que impede o usuário existente de ver o wizard.
  Custo aceito: quem abandonou no passo 3 e atualiza o app refaz os 3 passos.
- **Decisão 2 — "Pular" reverte o tema em QUALQUER saída.** No Orca só o botão
  de rodapé reverte o tema; Escape/clique-fora sai sem reverter (assimetria
  deles). Aqui Escape e clique-fora não saem sozinhos: passam por um diálogo de
  confirmação com "Continuar" como default e "Pular" em ghost (§7 — caminho de
  saída nunca é destrutivo). Como o "Pular" desse diálogo é um gesto explícito,
  ele É o mesmo gesto do botão de rodapé, e tratá-los diferente seria
  arbitrário: os dois revertem. Regra pura em `themeAfterExit` (`skip` devolve
  o tema de entrada; `advance` e `back` confirmam o que o preview mostrou).
- **Consequência:** o passo de tema segue salvando NA SELEÇÃO (o preview ao
  vivo é o app inteiro virando junto), que é o ponto do passo; a reversão mora
  no wizard, único lugar que sabe COMO o passo foi deixado.

### ADR-040 — O Painel vira retrospectiva; a decisão pendente vira chrome; o Board sai ✅
- **Contexto (13/08/2026):** cinco POCs de redesenho do Painel
  (`docs/mocks/painel-a…e.html`, com o raciocínio em `painel-README.md`) foram
  desenhadas olhando pro CÓDIGO da tela. Depois disso o banco REAL do único
  usuário foi consultado, e ele conta outra história: **16 conversas, 5
  entregas, 2 disputas, 1 aprendizado, 0 card no Board, 0 agendado, e
  US$ 6.260 em 30 dias.** Lido de frente, a tela inicial de hoje é um Board
  vazio, um botão "Nova missão" nunca clicado e um "próxima agendada" que
  nunca teve o que dizer. O produto mora no Trabalho, onde estão as conversas
  e quase todo o dinheiro. A direção escolhida foi a **E (retrospectiva)**,
  com duas condições adicionadas na coordenação (decisões 3 e 4 abaixo).
- **Decisão 1 — o Painel vira AUDITORIA, não fila.** Hero do gasto da janela,
  três derivados em 20px, mapa de calor de **US$ por hora** (14 dias × hora),
  custo por agente cruzado com as entregas do mesmo agente, e as entregas
  listadas. Duas regras duras: (a) **só número medido** (nenhum tile de token
  absoluto, contagem de projetos ou streak; o app não mede sequência de dias e
  não vamos inventar uma); (b) **todo derivado imprime o denominador em 11px**
  ao lado, porque "US$ 1.252 por entrega" parece um veredito sobre os agents e
  é sobretudo um veredito sobre o REGISTRO de entregas. Onde o denominador é
  zero a função devolve `null` e a UI diz o que falta (`lib/retro.ts`).
  O mapa pinta dinheiro e não atividade de propósito: heatmap de atividade num
  app de uma pessoa é teatro (não há streak pra manter nem público pra
  impressionar); pintando US$/hora ele vira detector de vazamento, e segue a
  régua ÚNICA de medidor do STYLEGUIDE §2 (`lib/meter.ts`).
- **Decisão 2 — o Board de intenção SAI da tela, o dado FICA.** Zero card em 16
  conversas não é "feature nova esperando descoberta", é uma resposta; e a
  intenção de trabalho já existe em dois formatos que o usuário usa (abrir uma
  conversa e escrever um plano de voo).
  **Correção de 13/08/2026 (revisão):** a primeira redação desta decisão citava
  "marcar entrega" como um terceiro formato em uso. **Esse gesto não existe no
  desktop.** `deliveries` tem exatamente dois writers no código: missão
  concluída (`store/mission.ts`, e `missionEnabled` vem **false** por padrão em
  `lib/settings.ts`) e card indo pra Feito (`store/cards.ts`), cuja superfície
  de desktop é justamente a que esta decisão removeu. Ou seja: numa instalação
  default, **nada no desktop registra uma entrega** (sobra o Companion Web, que
  também vem desligado). A consequência prática está tratada na Consequência 4.
  Saíram as superfícies
  órfãs (`BoardLane`, `CardDetailDialog`, `cardActions`). **A tabela `cards`,
  o `store/cards` e as funções de banco continuam intocados**: remover DADO é
  outra decisão, e o store ainda alimenta o vigia, o Companion e a fila (um
  card em review/blocked continua virando decisão pendente se existir).
  Efeito colateral tratado na revisão: `openCardConversation` mandava o card
  SEM conversa ligada pro Painel (selecionando-o no board). Com o board fora
  dali isso virou **clique morto** — o usuário saía do Trabalho pra uma tela
  onde o card não existe, e a faixa seguia acesa cobrando a mesma decisão.
  Agora a função devolve `false` quando não há destino, e quem chamou decide:
  na própria fila, um toast explica que não há pra onde abrir; no sino e no
  toast do vigia, abre-se a **fila da faixa**, que é onde o card existe hoje.
  Navegar pra tela onde o alvo não existe é pior do que não navegar.
- **Decisão 3 (condição 1) — o app abre no Trabalho.** O default do store já
  era `linear`; o que faltava era a regra ser INTENCIONAL e ter teste
  (`store/app.boot.test.ts`), porque é o tipo de coisa que uma frente futura
  relaxa sem nada quebrar. Usuário existente **mantém a última aba que usou**,
  inclusive o Painel: a preferência persistida é dele, e a v4 do `mc.app` não a
  reescreve. Nada no app força `viewMode: "painel"` no boot (as duas navegações
  que faziam isso, no sino e no Painel, apontavam pra fila e sumiram com ela).
- **Decisão 4 (condição 2) — a faixa "precisa de você" é CHROME, não aba.**
  O argumento que decide: **visibilidade permanente só existe em elemento de
  moldura (faixa, sino, tray), nunca em aba.** Uma aba some no instante em que
  você troca de superfície, então uma fila que mora numa aba só é vista por
  quem já foi olhar; e a evidência diz que o usuário está no Trabalho. A faixa
  nasce entre a barra do topo e o conteúdo (`components/decisions/`), com
  quatro regras: (a) **só existe com conteúdo** — fila vazia renderiza `null`,
  sem placeholder e sem altura reservada (§5), que é o estado NORMAL pela
  evidência; (b) **âmbar**, nunca vermelho (nada falhou, alguém espera); (c)
  **não narra o agora** — "N em voo" ficou deliberadamente de fora, porque a
  linha viva do turno é a dona única do que roda (B2.2/ADR-037), e duas
  superfícies vivas narrando o mesmo agora foi o bug dos builds 181/182; (d)
  abrir a fila é sobreposição E2, nunca reflow do fio que você estava lendo, e
  ela vive em **z-30**: acima do conteúdo (que é `z-auto`) e ABAIXO dos portais
  de dialog (`z-50`) — o `.grain` da raiz não cria contexto de empilhamento (o
  `z-50` dele mora no `::after`), então a faixa compete na raiz e um `z-[105]`
  fazia o `confirm()` do Merge renderizar atrás da própria gaveta. Pelo mesmo
  motivo o Escape da fila cede quando há dialog Radix aberto.
  **O que NÃO entrou na faixa, e por quê:** rate limit de CLI, "sem login" e
  update disponível. São impedimentos reais, mas duram horas ou dias, e uma
  faixa permanentemente acesa cobra os 30px pra sempre — exatamente o preço que
  a direção E declara como seu maior custo. Onde eles ficam, com precisão
  (correção da revisão, a redação anterior dizia "no sino" pros três): **rate
  limit** aparece no sino E na Frota do Painel; **"sem login"** e **update
  disponível** aparecem SÓ na Frota do Painel. Nenhum dos três é regressão
  desta frente (era assim antes), mas fica registrado o furo que a revisão
  apontou: CLI deslogada é hoje uma coisa que se descobre quando um turno
  falha, a menos que você visite o Painel. Levar os dois pro sino é candidato a
  frente própria, não a remendo desta.
  **Fechamento (13/08/2026) — a frente própria rodou, e a frase acima virou
  histórica.** Hoje os TRÊS aparecem no sino, numa seção nova **"Ferramentas"**,
  e a Frota do Painel segue como o detalhe (nada foi movido de lá). A faixa
  continua sem os três, pelo motivo original: os 30px permanentes. O que ficou
  decidido, com as regras puras em `lib/toolHealth.ts` (`toolHealthItems`,
  `blockingToolCount`) e teste em `toolHealth.test.ts`:
  - **Hierarquia**: "sem login" é IMPEDIMENTO (bloqueia trabalho, é o mesmo
    veredito de `availability()` que já aborta o despacho em
    `dispatchBlockReason`) e vem sempre antes de "update disponível", que é
    CONVENIÊNCIA. Vira pixel além de ordem: o primeiro é âmbar (§2, "precisa de
    você"), o segundo é cinza (§2, "cinza é informação").
  - **Badge**: só "sem login" soma no contador (junto das decisões pendentes).
    Update **aparece na lista e não incrementa** — dura dias, não impede nada, e
    contá-lo deixaria o sino aceso pra sempre, que é exatamente o custo que esta
    ADR recusou pra faixa. Rate limit segue fora do badge pelo mesmo teste:
    nenhum gesto seu resolve, ele volta sozinho na hora que a linha já diz.
  - **Ação sem inventar capacidade**: as duas linhas abrem Configurações ▸
    Agentes na máquina, onde os gestos JÁ existem ("Verificar agora" depois de
    logar pelo terminal da CLI; o botão "Atualizar" que dispara o job). O botão
    de update NÃO foi duplicado no sino de propósito: ele carrega estado que a
    linha do dropdown não mostra (spinner do job vivo, trava enquanto outro job
    roda, aviso de N instalações no PATH). Um dono só pro gesto.
  - **4 camadas de esconder (§5)**: CLI não instalada não gera item (guarda
    real, não decorativa: o `detect.rs` reporta `auth: "missing"` também pra
    ferramenta AUSENTE); probe que não assentou não gera item, e `auth:
    "unknown"` entra no mesmo balde (o agy não tem subcomando de auth e degrada
    pra "unknown" sempre que `agy models` falha — promovê-lo a "sem login"
    acenderia o sino pra sempre por algo que o app não mediu; a Frota segue
    dizendo "auth desconhecida", que é o painel onde você foi olhar); e o update
    é dispensável com persistência (`settings.updateDismissed`), **por versão**,
    então dispensar a v2.1.220 não silencia a v2.1.230. "Sem login" NÃO é
    dispensável: dispensar impedimento é esconder falha (§5.2).
  - **Como se distingue da faixa**: a faixa decide TRABALHO (qual proposta
    adotar, qual disputa vence) e o item some quando VOCÊ decide; a seção
    Ferramentas é SAÚDE DE FERRAMENTA, não há trabalho pra escolher, e o item
    some quando o ESTADO DA MÁQUINA muda. Nada da seção entra na fila de
    decisões.
  - **Efeito colateral tratado**: com o badge podendo acender só por causa de
    uma CLI deslogada, o "Nada esperando você" do topo virava mentira. A seção
    "Precisam de você" agora some inteira quando não há decisão E há ferramenta
    bloqueando (Ferramentas lidera a lista), e o "Tudo em dia. Nada por aqui."
    passou a considerar a seção nova — antes ele já podia aparecer embaixo de um
    rate limit listado, que era o mesmo teatro em menor escala.
- **Consequência 1 — o que a retrospectiva NÃO herdou.** As 4 caixas de
  métrica se dissolveram (30 dias virou o hero, média/dia virou o derivado
  "por dia", 7 dias virou a janela; "Tokens 30d" desceu pra gaveta, porque
  token absoluto é incomparável entre motores com preços diferentes). A
  auditoria por turno **ficou no Painel** em vez de migrar pra Configurações ▸
  Uso e custo: ela consome o MESMO ledger que a tela já carregou, e mandá-la
  pra um modal de configuração custaria uma segunda leitura e o contexto.
  Configurações ▸ Uso e custo segue dona da janela do plano e da reconstrução
  do ledger.
- **Consequência 2 — desvios deliberados do mock E.** (a) A seção **Frota
  (detalhe)** ficou no Painel, fora do mock: é o único lugar onde o estado real
  das CLIs, das sessões observadas pelos hooks (H1) e das próximas agendadas
  (F6) aparece, e §1 diz que a UI mostra o estado real da frota; tirá-la seria
  apagar a superfície de outra frente. (b) O episódio destacado abaixo do mapa
  é **cinza, não um callout âmbar**: âmbar é "precisa de você", e um gasto do
  mês passado não é decisão pendente. (c) Os atalhos "Nova missão / Nova
  disputa / Nova feature" saíram da tela (evidência: nunca ou quase nunca
  clicados); os gestos seguem no composer (⚔️ e missão) e na sidebar. Isso
  deixa `requestMissionLaunch`/`requestFusionLaunch` sem chamador no app — o
  mecanismo foi mantido de propósito, porque quem decide o destino dele é a
  frente que está reconstruindo Missões.
- **Consequência 3 — o que mais saiu do Painel, dito com todas as letras.**
  (a) O bloco **"Em voo" cross-projeto** (turnos, missões e disputas rodando,
  com o expansor) saiu junto: o passado e o agora não dividem a mesma tela, e a
  linha viva do turno é a dona única do agora (B2.2). O que sobra pra saber "o
  que está rodando" sem entrar na conversa é o **dot de presença na sidebar**,
  que é presença, não identidade: ele diz que ALGO roda naquele projeto, não o
  quê. É uma perda real e está registrada como tal; a superfície que a repõe é
  a de trabalho em background, não a retrospectiva. (b) A varredura de
  decisões (SQL + `.claude/plans` de N projetos, a cada 30s) **deixou de ser
  montada com o Painel e virou ticker do chrome**, porque a faixa existe em
  toda superfície. Ganhou gate de `document.hidden` (janela escondida não
  varre, e voltar a ficar visível dispara um refresh na hora); ela ainda é um
  segundo intervalo além do vigia de `lib/watchdog.ts`, e unificar os dois
  tickers fica anotado como dívida.
- **Consequência 4 — o derivado "por entrega registrada" some quando não há
  quem registre.** Com o denominador congelado (Decisão 2) e o numerador
  crescendo todo dia, "US$ X por entrega" viraria ficção com cara de
  instrumento em poucas semanas, que é o oposto da tese desta tela. Regra
  (`showsPerDelivery` em `lib/retro.ts`, com teste): o derivado existe se
  **algum writer estiver ligado** (missão ou Companion, o denominador ainda
  pode crescer) **ou** se houver **entrega real na janela** (o número descreve
  algo que aconteceu). Fora isso ele não aparece, e o trio vira duo — §5 camada
  2, "não-configurado esconde". Quando aparece, a ressalva de 11px diz na cara
  de onde nasce uma entrega e avisa que número alto pode ser falta de registro,
  não ineficiência. O parágrafo do "N% atribuídos" segue a mesma regra.
  **Atualizado pelo ADR-041 (13/08/2026):** o Board saiu também do Companion,
  então "Companion ligado" deixou de ser writer e `hasDeliveryWriter` passou a
  olhar SÓ `missionEnabled`. A regra desta consequência não mudou; mudou quem
  a satisfaz, e numa instalação default o derivado agora fica escondido.
- **Consequência 5 — três bugs de tinta fechados junto** (auditoria dos mocks
  contra o STYLEGUIDE §2): o ícone de PR saudável era `st-success` e o dot de
  entrega era verde (verde é marco de turno, nunca estado ambiente que fica na
  tela — os dois viraram cinza); e o card `blocked` era `st-error` (vermelho é
  falha consumada; bloqueado é âmbar, e quem separa "bloqueado" de "em
  revisão" é o texto do badge, não a tinta). Na revisão entraram mais dois, do
  mesmo tipo: o TEXTO da faixa era âmbar sobre fundo âmbar (~2,9:1 no tema
  claro, abaixo de AA) e virou `foreground`, com o âmbar ficando no dot, na
  borda e no fundo (o padrão da Frota); e a fila empilhava um botão brass por
  card, quando a regra é **uma primária brass por superfície** — agora só o
  primeiro item da fila (o mais pronto, pelo `orderQueue`) é brass, e o resto
  usa o botão neutro com o mesmo rótulo. O quarto item da auditoria era o
  `EmptyLine` compartilhado entre o vazio da fila e o das entregas, com o mesmo
  peso — a causa literal do "inbox solto na tela inicial": a fila saiu do
  Painel e o vazio das entregas passou a dizer o que falta e por quê.

### ADR-041 — O Board sai também do Companion; entrega passa a nascer só de missão ✅
- **Contexto (13/08/2026):** o ADR-040 tirou o Board do Painel por uso zero (0
  card no banco real), mas deixou a seção de cards viva no **Companion Web**.
  A revisão apontou que a sobra não era só incoerência estética: **fechar um
  card é um dos dois writers de `deliveries`**, e o outro (missão concluída)
  vem desligado por padrão. Ou seja, o celular tinha virado o ÚNICO lugar do
  produto capaz de registrar uma entrega, alimentando um número que só o
  desktop mostra. Uma superfície de escrita que existe em um aparelho e não
  existe no app principal é um caminho que ninguém audita.
- **Decisão — o Board sai do celular; o dado FICA.** Saíram: a seção `cards`
  do snapshot (`lib/companion.ts`), o `CompanionCard`, o item de atenção
  `kind: "card"` (card estagnado), as ações `dispatch_card`/`close_card` no
  executor e na whitelist do Rust (`companion.rs`), a assinatura do `useCards`
  na ponte, e a seção Board inteira do cliente (`companion/index.html`:
  markup, `renderBoard`, `boardCardHtml`, os botões Iniciar/Concluir/Cancelar
  e o mock). **A tabela `cards`, o `store/cards` e as funções de banco seguem
  intocados**, mesma disciplina do ADR-040: remover DADO é outra decisão. O
  store continua alimentando o vigia e a fila da faixa no desktop, onde card
  em revisão/bloqueado ainda vira decisão pendente.
- **Consequência 1 — a métrica "por entrega" fica escondida numa instalação
  default.** `hasDeliveryWriter` perdeu o argumento `companionEnabled`: com o
  Board fora dos dois lados, ligar o Companion não engorda mais o denominador.
  Sobrou `missionEnabled`, que é `false` por padrão. Efeito prático no Painel:
  sem missão ligada e sem entrega real na janela, o trio de derivados vira duo
  e "US$ por entrega registrada" não aparece (`showsPerDelivery`, com teste).
  Quando aparece, a ressalva de 11px agora diz a verdade nova: entrega nasce
  só de missão concluída. Isso é a regra do ADR-040 continuando correta, não
  uma exceção: o derivado só existe enquanto alguém pode registrar.
- **Consequência 2 — o gesto canônico de entrega volta com Missões.** Até lá o
  app assume, na cara, que não registra entrega. A alternativa seria manter um
  botão escondido no celular só para o número do desktop não sumir, que é
  exatamente o "estado real, nunca teatro" ao contrário.
- **Consequência 3 — protocolo: nada quebra em aparelho pareado.** O cliente é
  servido pelo próprio binário (`include_str!` do `index.html`), então página
  e whitelist versionam JUNTAS: não existe cliente velho contra binário novo a
  não ser uma aba já aberta, e essa cai no fail-closed correto (a whitelist
  devolve 400 e o executor ignora com aviso, sem efeito). O campo `cards` era
  opcional no shape e sumiu sem tocar em mais nada do envelope.

### ADR-042 — O botão direito é do produto, nunca do motor ✅
- **Contexto (14/08/2026):** em boa parte do app o botão direito abria o menu
  do **WKWebView**, com "Reload" e "AutoFill". Isso é vazamento do motor por
  duas vias: denuncia que o Frota é um webview, e oferece ação perigosa
  ("Reload" recarrega o app inteiro no meio de um turno) ou sem sentido
  ("AutoFill"). A primitiva Radix (`ui/context-menu.tsx`) existia e servia
  só a sidebar e ao onboarding; no resto caía tudo no nativo. Medido nesta
  máquina com uma sonda em Swift que sobe um WKWebView real e loga
  `willOpenMenu` (só dispara quando o WebKit decidiu abrir menu nativo): sobre
  `body{user-select:none}` o menu vem com "Reload"; dentro de `textarea`
  focado vem com **28 itens**, incluindo "Search with Google", "Show Writing
  Tools", "Translate", "Paragraph Direction" e "Share…". O menu do sistema em
  campo de texto vaza MAIS do que o da área comum, não menos.
- **Decisão — o menu do motor é suprimido no app inteiro, e o nosso entra no
  lugar.** `preventDefault()` no evento `contextmenu` é suficiente e é o único
  caminho portátil: o wry só expõe interruptor nativo pro WebView2 do Windows
  (`with_default_context_menus`), e macOS e Linux rodam WebKit, onde o mesmo
  `ContextMenuController` do WebCore desiste quando o evento do DOM foi
  cancelado. Uma técnica só nas duas plataformas do produto.
- **Consequência 1 — a guarda ouve na BOLHA, não na captura.** Na captura ela
  rodaria antes do Radix, e o `composeEventHandlers` do Radix pula o próprio
  handler quando o evento já chega com `defaultPrevented`: capturar mataria os
  menus de contexto que já existem. Na bolha a precedência cai sozinha (quem é
  nosso assume primeiro; o que sobrou sem dono é o que o motor ia sequestrar).
  A exceção é o alvo **prioritário**: campo de texto assume na captura, com
  `stopPropagation`, porque senão o menu do container o sequestra. Isso não é
  teoria: o campo de renomear da sidebar mora dentro da linha da conversa, que
  é um trigger do Radix, e sem a prioridade o botão direito ali abria
  "Renomear · Duplicar · Excluir" em vez de Cortar/Copiar/Colar.
- **Consequência 2 — tirar o nativo obriga a devolver o que ele fazia.** Em
  campo de texto o botão direito tem função de sistema a cumprir, e é memória
  muscular. Daí o mapa alvo → itens, com a regra pura e testada em
  `lib/contextMenu.ts`. Campo de senha só oferece **Colar**: não se tira
  segredo do campo por um menu aberto sem querer.
- **Consequência 3 — "Colar" custou um plugin, e o custo estava certo.**
  Medido: no WKWebView, `navigator.clipboard.readText()` devolve
  `NotAllowedError` para conteúdo que a própria página não escreveu, e
  `document.execCommand("paste")` devolve `false`. Sem o
  `tauri-plugin-clipboard-manager` (que lê o NSPasteboard pelo Rust), "Colar"
  seria item morto, e item que não faz não existe (§7.1). A capability libera
  só `allow-read-text`; escrita continua pelo `navigator.clipboard`, que
  funciona. Onde a leitura não existe (fora do Tauri) o item **some**, não
  falha.
- **Consequência 4 — devtools continuam a um gesto de distância, só em dev.**
  Suprimir tudo tiraria o "Inspecionar elemento", que é como se abre o
  inspetor no WKWebView. Em build de desenvolvimento, **Shift + botão direito**
  devolve o menu do motor: medido que o `shiftKey` chega ao evento do DOM no
  WKWebView, e que sem `preventDefault` o menu nativo volta. Shift (e não
  Alt/Option) porque no Linux o Alt+clique costuma ser gesto do gerenciador de
  janelas. Fora de dev não existe escape: o usuário final nunca vê o motor.
- **Consequência 5 — o marcador do bloco de texto é o `data-selectable` que já
  existia.** "O usuário pode selecionar" e "o usuário pode copiar" são a mesma
  pergunta, então não entrou um segundo marcador dizendo o mesmo. Por isso o
  rótulo é "Copiar texto", e não "Copiar mensagem": o mesmo marcador serve o
  painel de contexto, onde não há mensagem nenhuma e o rótulo mentiria.
- **Consequência 6 — o que ficou de fora, e por quê.** "Salvar como…" não
  existe: não há implementação real (o app não tem `plugin-fs` nem diálogo de
  salvar), e item que não faz não entra. "Copiar como markdown" também não: o
  render não carrega a fonte markdown até o host. "Mostrar na pasta" ficou,
  mas como comando Rust contido (`reveal_conv_image`, espelho do
  `open_conv_image`) em vez de liberar `opener:allow-reveal-item-in-dir` pro
  JS, para o front seguir sem poder mandar path absoluto ao SO.
- **Prova:** a supressão só é demonstrável num navegador de verdade (teste
  unitário não tem evento `contextmenu` nativo pra cancelar), então ela é
  coberta por e2e (`e2e/menu-contexto.spec.ts`): um ouvinte de bolha na
  `window` (que no caminho de propagação vem depois do `document`) confirma
  `defaultPrevented` em toda superfície. A regra pura tem 27 casos em
  `lib/contextMenu.test.ts`.

### ADR-043 — Seleção não é cor: o âmbar volta a ter um dono só ✅
- **Contexto (15/08/2026):** o âmbar fazia dois trabalhos na mesma tela. Marcava
  **item selecionado** na sidebar (a barra de 2,5px, `Sidebar.tsx` em três
  sítios) e significava **perigo** (moldura do modo Liberado, badge de decisão
  pendente). O `index.css` tentava salvar a distinção num comentário
  ("âmbar da fila/atenção, NÃO é o brass"), e a medição derruba o comentário: em
  OKLCH, tema escuro, `--brass` `#e4a862` (seleção) está em L 77,4 · C 0,112 ·
  H 69,1 e `--st-queued` `#d99138` (perigo) em L 71,4 · C 0,134 · H 67,9, ou
  seja **1,2° de matiz** e 6,0 de luminosidade. No tema claro (`#a9742b` ×
  `#c1861f`) são **4,1°** e a relação **INVERTE** (no claro o perigo é o mais
  CLARO, ΔL +6,3; no escuro é o mais escuro): não existia nem uma regra
  consistente pro usuário aprender. Num app cuja doutrina inteira é aprovação
  humana, a tinta de "isto pode executar comando na sua máquina sem pedir" era
  prima da tinta de "esta linha está selecionada". Levantamento completo em
  `docs/mocks/linguagem-silenciosa-README.md` (proposta e mock).
- **Decisão 1 — a saída não é escurecer o âmbar, é TIRAR A COR DA SELEÇÃO.**
  Selecionado passa a ter uma receita única: preenchimento neutro `--sel`
  (`rgba(255,255,255,.065)` escuro / `rgba(0,0,0,.055)` claro) + peso 500 + pip
  neutro de 3px no gutter. As três barras brass saíram. A regra está escrita no
  §2 do STYLEGUIDE, com a medição e com a exceção fechada (controle segmentado
  não é lista).
- **Decisão 2 — a linha de conversa vira três zonas com três donos:**
  **gutter = seleção** (só muda quando você clica) · **marca do motor =
  identidade** (nunca muda sozinha) · **slot direito de 36px = estado e tempo**
  (muda sozinho, o tempo todo), em ordem fechada `pede > rodando > falhou >
  tempo relativo`. O ícone de motor FICA nos quatro estados: é o único lugar da
  árvore onde a identidade do motor aparece, e num app agnóstico de propósito,
  com conversas de motores diferentes lado a lado, é o que deixa varrer a frota
  sem abrir nada. O que saiu foi o **badge de estado grudado nele**.
- **Decisão 3 — "rodando" é ESTEIRA, não ponto azul. Aqui a decisão contraria a
  recomendação de quem escreveu a proposta, e a discordância dele fica
  registrada.** O autor recomendava a Opção 2 (ponto azul, mesmo desenho do
  ponto âmbar), com dois argumentos legítimos: o slot passa a ter dois idiomas
  (uma barra onde todo o resto é ponto ou texto), e 2px de movimento na
  periferia do olho passa perto de artefato de scrollbar. A escolha foi a
  esteira, pelo §6: **movimento é pra vivo**. A moldura do Liberado não pulsa
  porque é condição permanente; "rodando" é o oposto, é evento em curso e o
  **único estado da lista que termina sozinho**. Movimento ali é honesto, e
  ponto azul parado é indistinguível de ponto azul esquecido. As duas condições
  que endereçam a objeção do autor são inegociáveis e estão testadas:
  (1) `prefers-reduced-motion` degrada pra um traço azul **estático e visível**,
  com regra própria em `index.css` (o bloco global só encurta a duração, o que
  deixaria a esteira congelada num quadro transparente, ou seja, "rodando"
  mudo); (2) a esteira **para quando o turno acaba, sem exceção** — ela é
  animação de CSS presa à PRESENÇA do elemento, e o elemento só existe enquanto
  o store diz `running`, que nunca é persistido. Erro, cancelamento, `finish()`
  e app fechado-e-reaberto têm caso de teste em
  `ConversationSlot.test.tsx`, porque provar só o caminho feliz não prova nada.
- **REVISTO no build 205 — o autor estava certo, e o uso decidiu.** A esteira
  durou um build. Vendo na tela, o Vinícius: *"a esteira azul + um pontinho no
  lado esquerdo ficou excessivo, e o círculo rodando como era antes era
  melhor"*. É **exatamente** a objeção que o autor registrou e que a escolha
  original descartou: 2px se movendo na periferia não lê como "trabalhando", lê
  como artefato. Num mock estático a esteira parecia elegante; em uso, não se
  explicava. Fica a lição de método: mock estático não decide questão de
  MOVIMENTO — só o uso decide, e a decisão custou um build porque nós julgamos
  animação por uma imagem parada.
  A doutrina **não mudou**: §6 segue valendo, movimento é pra vivo, e círculo é
  movimento. Mudou o glifo, pra um que já se sabe ler e que o app já usa no
  composer. `.conv-wire` (22×2px, gradiente varrendo) → `.conv-spin` (anel de
  11px em CSS puro). As duas condições continuam de pé e testadas, e a
  degradação ficou **melhor**: sem movimento o anel vira o MESMO ponto sólido
  dos estados `pede` e `falhou` — vocabulário único na coluna — em vez de um
  traço de idioma próprio. Regra própria continua obrigatória porque o bloco
  global só encurta a duração, o que congelaria o anel num arco quebrado, que
  lê como falha de renderização. Guarda em `scripts/lints/rodandoMotion.mjs`,
  ligada no `bun run check`.
- **Consequência 1 — uma perda real, aceita de olhos abertos.** Some o "o último
  turno terminou bem" de relance na sidebar: o badge verde `done` era estado
  ambiente permanente, que o §9 item 4 já tinha condenado em todo o resto do
  app. Quem responde a pergunta prática ("isto andou recentemente?") passa a ser
  o **tempo relativo**, que é a régua que ficou daquele item: dot ambiente cinza
  é a lei, e quem precisa distinguir dois estados saudáveis usa texto.
- **Consequência 2 — tempo relativo custou zero de dado e um ticker.**
  `conversations.updated_at` já existia, já era selecionado e já chegava ao
  front como `updatedAt` (nenhuma migração). O custo é `lib/minuteTick.ts`: um
  ticker de 60s pro módulo inteiro (padrão do `watchdog.ts`), nunca um por
  linha. Precisão degrada (`agora · 9m · 1h · 3d`, data a partir de 7d) e nunca
  mostra segundos, porque a linha viva do rodapé é a dona única do agora.
- **Consequência 3 — divergência DATADA, não acidental.** A receita nova vale na
  árvore da sidebar. O painel direito e os ~16 sítios restantes de
  brass-como-ativo seguem na gramática velha até serem migrados por superfície
  tocada. Isso contraria o §0 (divergência é o que ele combate), e a defesa é
  que divergência escrita e datada não é a mesma coisa que divergência que
  ninguém sabe que existe: está registrada no §2, com a lista dos arquivos.
- **Consequência 4 — dois aliases viraram explícitos.** `--ring` era o hex do
  `--brass` repetido e `--st-idle` era o hex do `--faint` repetido. Os dois
  passaram a `var(...)`: alias documentado é aceitável (o foco É o gesto; o
  "ocioso" É o cinza de metadado), token duplicado por acidente não é, porque
  divergiria em silêncio na primeira passada de cor.
- **Consequência 5 — o `Sidebar.tsx` foi dividido.** Ele estava em 1437 linhas
  (baseline congelada em 1433) e a catraca do §10 não aceita crescer. A lista de
  conversas saiu para `ConversationList.tsx` e o submenu de cor para
  `ColorSubmenu.tsx`; o arquivo caiu para 924 linhas e a baseline desceu junto.
  Dividir, nunca subir o teto.
- **FASE 2 (build 206) — o painel direito virou CARTÃO, e os 7 divisores
  saíram.** O que entrou, e só isto:
  - **Cartão flutuante (E1).** O `ContextPanel` deixou de ser uma coluna dentro
    do cartão de conteúdo e virou superfície própria (`bg-card` + raio +
    `--shadow-sm`, **sem borda**), irmã do cartão do chat, com um vão de 8px
    entre as duas. A alça de resize perdeu o hairline e o brass do hover (brass
    é gesto, não borda de arrastar): o vão É o divisor, como na sidebar.
  - **A destravadora escrita no §4:** a proibição de cartão-em-cartão é de
    **borda** aninhada, não de raio. Sem essa distinção o painel não podia ser
    cartão. Em troca a regra ficou mais forte: nada dentro do painel tem borda
    própria, e é isso que mata os divisores. Foram junto os dois chips
    contornados ("Adicionar" pasta e "Escrever" doutrina), que viraram
    preenchimento e saíram do brass no hover (§2: brass é ação primária, e
    nenhum dos dois é).
  - **Seções por proximidade assimétrica 24/8**, não por traço. Efeito
    colateral que o divisor escondia: o cabeçalho "Arquivos das CLIs" estava
    fora do compasso (`px-1`, rótulo à mão) e, sem o traço acima, lia como
    continuação de "Missões". Entrou no `px-5` + `.label-mono` das seções, com
    o chevron à direita, que é onde `FileRow` e `ClaudeNode` já o põem.
  - **Aba ativa perdeu o sublinhado brass** (a terceira linguagem de "ativo" do
    app) e passou à receita da árvore: `bg-sel` + peso. O contador de arquivos
    alterados saiu do `bg-brass` e virou número mono, porque é metadado.
    **Aqui a receita do §2 anda com uma perna a menos, de propósito:** não há
    pip. Pip é marcador de GUTTER, e tira horizontal de abas não tem gutter.
  - **A barra sticky do `DiffPanel` passou a ocluir com `bg-card`.** Ela usava
    `bg-background`, que sobre a nova superfície seria uma faixa de outra cor
    deslizando por cima do conteúdo. O `border-b` dela FICA: separa zona de ação
    de lista de dados, que é a exceção que a regra do divisor preserva.
  - **Consequência de catraca:** o `ContextPanel.tsx` estava colado no teto
    congelado (928). A gramática visual dele (`Section`, `TabBtn`, `StageBadge`)
    saiu para `contextPanelChrome.tsx` — são as três peças que a Fase 2 mudou, e
    mudam juntas. O arquivo caiu para 858 e a baseline desceu junto.
- **FASE 3 (build 206) — a faixa de status virou o PISO da janela, e a
  identidade parou de ser cinza.** O que entrou:
  - **A faixa perdeu `border-t` e fundo próprio**, e o `px-3` virou `px-4`. A
    regra é mensurável, não estética: hairline de largura total só termina em
    aresta reta, e a janela do macOS tem raio **10px** (o mesmo que a moldura de
    risco já tinha aprendido na marra em `lib/climate.ts`, no `af57bfc`). Três
    coisas entravam na curva: o hairline, o retângulo de fundo e a `UsagePill`
    começando a 12px. Agora o conteúdo começa a 16px, e o arco só encontra fundo
    liso.
  - **Inset de 8px do conteúdo**, que é o que passou a separar a faixa do resto.
    Ele vale pras DUAS colunas: a sidebar encostava na faixa (o cartão já tinha
    o dele), e o vão entre sidebar e conteúdo, que eram 5px (1px de alça + 4px
    de padding), virou 8px, igual ao vão entre os dois cartões.
  - **Avatar do rodapé e nome do projeto saíram do cinza/brass.** O avatar era
    `bg-brass/15 text-brass`: brass é gesto, e avatar é identidade parada. O
    nome do projeto era `text-muted-foreground`: com a marca fora da barra
    (`af57bfc`), ele é a única identidade da janela, e a faixa horizontal mais
    cara abria com um cinza secundário. Virou `foreground` + peso 500, com
    hover por preenchimento, igual aos botões-ícone vizinhos.
  - **Furo do tema claro fechado onde ele apareceu.** O avatar neutro tinha ido
    pra `bg-secondary`, que no claro é `#f4f4f2` sobre um rail `#f6f6f4`: 1,02:1
    de contraste, ou seja, um disco invisível. Virou `bg-foreground/10`, que é
    simétrico por construção (≈1,21:1 nos dois temas). Token translúcido
    derivado do `foreground`, e não `--sel`, porque `--sel` significa SELEÇÃO e
    um avatar não está selecionado.
  - **O véu de rolagem do mock NÃO entrou.** O próprio autor da proposta
    recomendou cortá-lo (§7 item 2): troca um hairline de custo zero por
    listener de scroll, estado e um elemento que aparece e some, para um
    problema que os 48px de rodapé já resolvem. Se incomodar na tela real,
    entra depois.
  - **Consequência de catraca:** o `App.tsx` estava congelado em 841 e o inset
    não cabia. O ESQUELETO da janela (sidebar · conteúdo · painel, e as alças)
    saiu para `components/layout/AppShell.tsx`, que é exatamente o que esta fase
    mexeu; o `App.tsx` ficou com boot, efeitos globais e hosts, e caiu para 729.
    Sem prop drilling: o shell lê o próprio estado do store.
- **As Fases 4 e 5 continuam FORA, por decisão do dono.** A 4 (`--rail` medido
  nos dois temas) é a única mudança de token global da proposta, e o autor pediu
  que fosse isolada e reversível. A 5 (os ~16 sítios restantes de
  brass-como-ativo) só começa com dono e prazo, senão vira a divergência
  acidental que o §0 combate. Até lá vale a regra do §2: quem tocar numa
  daquelas telas migra ela, e ninguém adiciona brass-como-ativo novo.
- **CORREÇÃO no build 206 — a tira de abas estava vestida de rótulo, e cortava
  "PLANO" em "PL".** As três abas nasceram na Fase 2 com `uppercase` +
  `tracking-[0.08em]`, que é **o mesmo tratamento dos títulos de seção do
  próprio painel** (`.label-mono`: AJUSTES, DOUTRINA, APRENDIZADO, MISSÕES,
  ARQUIVOS DAS CLIS). Duas naturezas opostas com a mesma roupa: aba é
  **controle** (clica), título de seção é **rótulo** (lê) — a hierarquia do
  painel achatava e o corte era só o sintoma. Medido no browser, com a Geist
  real: a tira pede **353,6px** em caixa-alta e **298,9px** sem (−15%), e o
  painel na largura padrão tem **329,5px**. Saiu a caixa-alta das ABAS; o
  título de seção MANTÉM o tratamento, que ali é correto.
  - **Degradação por LARGURA, não por decreto.** Sem caixa-alta a tira cabe na
    largura padrão, mas o painel é redimensionável (`minSize` 240px), e no
    mínimo nem rótulo curto cabe. Então o rótulo cede pro ícone por container
    query (`@min-[274px]`, medido: 273,5px de content-box no pior caso, com
    contador de 3 dígitos), com `title`/`aria-label` no botão. O **contador
    continua visível nos dois modos**: esconder rótulo é economia de espaço,
    esconder dado é perda de informação.
  - **Considerado e recusado:** ícone-só sempre (o painel é de uso ocasional e
    "Contexto"/"Plano" não têm glifo universal, viram dois enigmas a decorar) e
    abas verticais (trocam espaço horizontal por uma coluna permanente e mantêm
    o mesmo problema de legibilidade).
  - **Guarda:** `e2e/painel-abas.spec.ts` mede no `dist/` buildado, em três
    larguras de janela (940 · 1280 · 1600), que nenhuma aba é cortada, que o
    rótulo aparece na largura padrão e que ele degrada pra ícone no painel
    mínimo com o contador de pé. Conferido que ele FALHA no markup anterior.
    A regra virou linha no §3 do STYLEGUIDE.
- **FASE 5 (build 206) — os dezesseis sítios restantes migraram, e a
  divergência datada ACABOU.** Era a fase que fechava o serviço: enquanto ela
  não rodava, o app falava duas línguas, sidebar e painel na gramática nova e
  dezesseis outros lugares na velha. O que entrou:
  - **A receita virou CÓDIGO** (`lib/selection.ts`: `SELECTED_FILL`,
    `UNSELECTED`, `SELECTED_ON_SURFACE`), pelo padrão do `lib/meter.ts` — "a
    régua é UMA e é código". A varredura achou **três** receitas de chip ativo
    que só divergiam na opacidade da borda (`border-brass/40`, `/50`, `/60`):
    divergência que ninguém decidiu, exatamente o que o §0 descreve, e que
    reapareceria de novo se a regra continuasse morando só no guia.
  - **Migraram** (seleção): chips de `Especialistas`, `SddView` (trilha),
    `ScheduledView` (tipo, recorrência, permissão), item da biblioteca do
    `FlightPlansView`, stepper de estágio do `SddView`, cartão e botão do
    `FusionBoard`, nó do `MissionPlanCanvas`, opção de pergunta do
    `InteractionHost` (linha E a marca, que é o pip), reações do `MessageList`,
    cartões do `ThemeStep`/`AgentStep` (com o miolo do radio virando pip
    neutro), pontinho de passo do `OnboardingWizard`, alvo de drop do
    `GateAnswerForm`. O segmento "Canvas" do `FlightPlansView` era o caso mais
    gritante: **o mesmo controle segmentado** tinha o irmão "Linear" em
    `text-foreground` e ele em `text-brass`.
  - **Não migrou porque não é seleção, e isso ficou escrito** (§2): o
    **interruptor binário de ajuste** (`Switch`, checkbox nativo com
    `accent-color`) segue brass — ligar/desligar UM comportamento não é
    escolher entre itens, e o preenchimento do trilho É a afordância; neutro
    ali deixaria ligado e desligado com o mesmo pixel. O **controle
    segmentado** segue na exceção já fechada, e o `planFirst` da linha de
    Execução mora nessa mesma superfície.
  - **Duas coisas viraram ÂMBAR, não neutro.** "Auto" de autonomia
    (`PhaseRow`, `MissionLauncher`) significa "esta fase roda sem pedir": é
    risco autorizado, o mesmo dono do "Liberado", e neutralizar ali seria
    esconder o que o §2 manda deixar visível. A lição "candidata" do
    `LearningSection` é decisão pendente (promover ou descartar), que também
    tem dono no §2.
  - **DECISÃO PEDIDA 1 — `StageBadge`: brass sai, e vira cinza nos DOIS
    estados.** Era brass-como-ESTADO, e o §2 dá ao brass um trabalho só
    (gesto). Estágio também não é nenhuma cor de status: não é decisão
    pendente, não roda agora, não falhou, e não é marco raro (verde, que o §9
    item 4 condenou como badge permanente). Sobra a regra do ambiente: cinza.
    E a distinção não se perde, porque ela nunca esteve na tinta — o badge
    IMPRIME o nome do estágio ("done" × "discovery"), que é a régua do §9 item
    4: quem precisa distinguir dois estados saudáveis usa TEXTO. A mesma
    decisão foi aplicada ao gêmeo do badge na `Sidebar`, senão a resposta
    dependeria de onde você estava olhando.
  - **DECISÃO PEDIDA 2 — próxima execução do Agendado.** A do painel já era
    neutra (`label-mono` + mono `foreground`); a que continuava tingida era a
    da **sidebar** (`bg-brass/10 text-brass/80`). Virou mono cinza, e o
    argumento é da Fase 1: "quando?" tem UM idioma na árvore da sidebar, o
    tempo relativo em mono no slot direito. Uma pílula tingida ali era a única
    resposta de "quando" que gritava.
  - **A regra geral que saiu dessas duas** (§2): **brass não pinta metadado**.
    Etiqueta que só informa é cinza; se ela precisa de você, não é metadado, é
    decisão pendente (âmbar). Foram junto o badge "lead" do `ScheduledView`, o
    escopo do `LearningSection`, o `OptBadge` do `RichSelect`, o badge de motor
    do `FusionBoard`, a `Tag` de modelo dos `Especialistas` (a prop `brass`
    virou `forte`, que distingue por contraste), a numeração do
    `GateAnswerForm` e o ícone de empty state dos `Especialistas` (que o §2 já
    listava na coluna "NÃO use para"). A barra corrente do sparkline do
    `CostAudit` também: o §2 já tinha fechado que **custo nunca é brass**, e
    ela passou a destacar por luminância.
  - **GUARDA (§10) — `scripts/check-barra-de-acento.mjs`, a quinta.** Reprova
    filete tingido de seleção: elemento `absolute` com dimensão ≤ 3px, colado
    numa aresta, com `bg-brass` ou `bg-st-*`. Pega as duas formas do vício, a
    barra vertical da sidebar (Fase 1) e o sublinhado horizontal da aba (Fase
    2), e lê as classes **por elemento** (inclusive as que vêm de ternário
    dentro do `cn`), senão a barra montada em pedaços passaria batida. Os casos
    de teste usam o markup REAL removido nas Fases 1 e 2
    (`git show d827fe9^` e `7f5475e^`), não fixture inventada. Sem mapa de
    exceção, de propósito: orçamento por arquivo faz sentido pra token já
    espalhado, não pra uma forma que o app decidiu que não volta.
    Aproveitando: a guarda do `rodandoMotion` **não estava na CI** (só no
    `bun run check` local). Entrou junto — guarda que não roda na CI é
    comentário.
- **FASE 6 (16/08/2026) — o brass estava fazendo o trabalho do âmbar no fluxo
  de aprovação, que é a alma do produto.** A Fase 5 varreu seleção e metadado e
  parou antes do caso mais caro: os três cartões do `InteractionHost` (pedido
  de permissão, teaser de pergunta, formulário de pergunta) e o cartão de
  missão interrompida da `MissionTimeline` desenhavam **"o turno está pausado
  aguardando você"** em `border-brass/40 bg-brass/[0.07]`. Pelo §2 isso é
  decisão pendente, que tem dono, e o dono é o âmbar.
  - **O argumento não é estético, é de TRILHA.** O ponto do slot da conversa
    (`ConversationSlot`, `bg-st-warning`) e os ícones do sino (`InboxBell`,
    kinds `approval`/`question`/`gate`, `text-st-warning`) já eram âmbar pros
    MESMOS pedidos. A cor trocava no último passo, bem onde se decide. E o
    cartão brass punha a tinta do BOTÃO no que estava ESPERANDO: num app cuja
    doutrina é aprovação humana, "isto vai executar na sua máquina" pedindo
    decisão na cor de quem a resolve.
  - **O botão primário DENTRO do cartão continua brass**, e é isso que fecha a
    separação: o cartão é o que espera, o botão é o gesto. Em tela os dois se
    separam por forma e luminância (sólido sobre véu de 10%), não por matiz —
    que é o que a medição do ADR-043 já dizia ser impossível.
  - **Receita ÚNICA e em código**: `PENDING_DECISION` em `lib/attention.ts`,
    pelo padrão do `selection.ts`/`meter.ts`. A varredura achou **quatro**
    superfícies de atenção divergindo só no número (`/40+/10`, `/45+/[0.07]`,
    `/30+/5`, e o brass do fluxo). Congelou no `/40+/10`, que já era o mais
    comum (`ComposerBanners` ×2, `CompanionSettings`, `ContextPanel`).
  - **DECISÃO CASO A CASO, e uma delas contra a leitura do brief.** O
    `MissionTimeline.tsx:254` não era o cartão de "pausado aguardando você" que
    o pedido descrevia: no HEAD é o **cartão de missão interrompida**, com
    receita própria (`border-[1.5px]` + halo `brass-soft`). Migrou mesmo assim,
    e o argumento é o §2 ("aviso que pede decisão"): a missão fica em limbo,
    com worktree e handoffs no disco e custo já gasto, até você retomar ou
    descartar. Foram junto a borda de 1,5px (fora da receita) e o halo
    `brass-soft`, que o §4 reserva pro FOCO e ali era decoração.
  - **O que NÃO migrou, e isso é a metade que importa**: o paredão de comando,
    o preview e a caixa de confirmação do lote são **contexto do pedido, não o
    pedido**. Continuam neutros. A confirmação do lote (que era
    `border-brass/50`) passou a destacar pelo **peso do hairline**
    (`border-border-strong`), não por uma segunda tinta: dentro de um cartão
    âmbar, âmbar sobre âmbar não é hierarquia.
  - **DECISÃO PEDIDA — o contador do sino (`InboxBell`) vira âmbar.** Ele conta
    o que BLOQUEIA você, e "precisa de você" é âmbar; um contador também não é
    gesto, e o §2 já tinha tirado do brass a "importância genérica". O comentário
    no código dizia `contador brass (alarme)`, o que era a regra certa com a
    tinta errada.
  - **Custo escondido que a migração cobrou: um token novo.** Trocar o
    preenchimento sem trocar a tinta teria BAIXADO o contraste do selo de 11px
    no tema claro, de 3,89:1 (branco sobre brass) para **3,03:1** (branco sobre
    âmbar, que no claro é o mais CLARO dos dois — a inversão que o ADR-043
    mediu). Entrou `--st-warning-fg`, o **único par de token que não inverte**
    entre os temas, de propósito: o âmbar é claro nos dois, então a tinta é
    escura nos dois (**6,28:1** claro / **7,55:1** escuro). Pela mesma medição a
    palavra "pausado" saiu do `text-brass` para **peso**, sem tinta: âmbar sobre
    o fundo claro é 3,03:1 contra 5,67:1 do `foreground`, e o cartão e o ícone
    já são o âmbar do recorte.
  - **BURACO DA GUARDA FECHADO.** O stepper do `SddView` pintava a etapa
    concluída com `bg-st-success` — verde ambiente permanente numa lista,
    exatamente o padrão que o §9 item 4 matou no resto do app — e **escapava**
    porque a regra `verde-ambiente` só olhava `text-st-success`. Duas coisas
    entraram: o dot virou `bg-foreground/40` (a distinção já estava no texto e
    no peso, que é a régua daquele item), e a regra passou a olhar **todas** as
    utilidades de cor mais o `var(--st-success)` cru. As contagens foram
    RECONTADAS contra o uso real, com o que entrou nomeado em cada motivo; a
    varredura larga não achou nenhum outro verde indefensável. Prova ao
    contrário rodada nas duas pontas: com o `bg-st-success` de volta a guarda
    reprova, e com a regra antiga os casos novos falham.
  - **Um teste pré-existente foi SUBSTITUÍDO, e o registro é este.** Havia um
    caso afirmando o buraco: *"não pega bg-st-success (a regra é sobre TEXTO
    verde)"*. Ele documentava o limite antigo, não um comportamento a preservar;
    saiu no lugar de casos com o markup REAL do stepper removido nesta passada.
  - **TRIAGEM PENDENTE, escrita pra não virar folclore**: o nó de fase concluída
    da `MissionTimeline` (`border-st-success bg-st-success`) tem a MESMA forma
    do stepper que esta passada despintou, e a defesa dele (é marco no fio, não
    badge ambiente) merece decisão escrita; e o `hover:text-st-success` do botão
    Promover do `LearningSection` não é marco nem probe, é verde de afordância.
    Os dois ficaram congelados na exceção, com o motivo dizendo isso.
  - **Consequência de catraca:** o `SddView.tsx` estava colado no teto congelado
    (1646) e o comentário da correção não cabia. O trilho de etapas saiu para
    `StagePipeline.tsx` (é a peça que a passada mexeu, e `Pipeline` só tinha um
    call site) com os três formatadores compartilhados em `sddFormat.ts`; o
    arquivo caiu para 1462 e a baseline desceu junto. Dividir, nunca subir o
    teto.

### ADR-044 — O `agy` ganha janela de uso: a fonte é o comando de CLIENTE em modo print, e o contrato é o bloco estruturado ✅
- **Contexto (16/08/2026):** o ADR-038 cravou `agy: usage_window = None` com um
  motivo escrito e correto **para o que se sabia então**: a única fonte
  auditada era o `/credits`, saldo absoluto, e saldo não é janela percentual.
  O motivo caiu. O `agy` 1.1.13 tem `/usage`, o print mode o EXPANDE, e
  `agy -p "/usage" --output-format json` devolve — medido nesta máquina, exit
  0, ~4,5s de parede — um bloco **estruturado** em `command.data`: grupos ×
  buckets, cada bucket com `id` estável, `window`, `remaining_fraction` e
  `reset_time`. É o contrato de `UsageWindow` inteiro.
- **Decisão 1 — a fonte nova é uma CAPABILITY, e o nome dela é o MECANISMO.**
  Entra `UsageWindowSource::AgyPrintCommand` no registry (espelho TS `"print"`:
  sonda headless pelo modo print do próprio CLI), com `usage_window` E
  `usage_window_poll` preenchidos — no `agy` as duas colunas são a mesma fonte,
  porque não há push nenhum a esperar. Teste-gêmeo
  `matriz_usage_window_por_agent` ↔ `agents.usageWindow.test.ts` atualizado com
  o motivo novo escrito nos dois lados; o contrato em loop
  (`contrato_capabilities_x_comportamento_por_agent`) pegou sozinho a
  incoerência quando a prova ao contrário mexeu só num dos campos.
- **Decisão 2 — custo ZERO, e isso é medição, não fé.** O mesmo payload volta
  com `num_turns: 0`, `duration_seconds: 0`, `usage` inteiro zerado e
  `conversation_id` **vazio** — contra um turno de verdade do mesmo CLI, que
  devolve um UUID. É comando de cliente: ele consulta o backend de quota e
  volta, sem abrir turno nem sujar o histórico do usuário. Por isso a sonda
  entra na cadência normal de poll (15 min, política do ADR-038) sem exceção
  nenhuma. **Limite da prova:** a evidência é o payload; não inspecionamos o
  armazenamento do `agy` (proibido, e é config de outro fornecedor).
- **Decisão 3 — parse do `command.data`, NUNCA do `response`.** O `response`
  traz o mesmo dado em TSV e é tentador. Ele é pior em duas coisas que não se
  recuperam: o percentual já vem arredondado a inteiro ("97%") e não há `id` de
  bucket, ou seja, nem precisão nem chave estável. Faltando `command.data`, a
  degradação é **sem snapshot** — não se reconstrói medidor a partir de texto.
  A conversão é `used = (1 - remaining_fraction) * 100`, sem arredondar em
  lugar nenhum do pipeline: o CLI manda float sujo (0.9691848158836365 → 3,08%,
  que o TSV mostraria como "97% restante"), o pipeline preserva e quem arredonda
  é a UI, exatamente como já era com o 28.999999999999996 do claude.
- **Decisão 4 — os dois pools aparecem, e o rótulo diz de quem é a janela.**
  `weekly` = 10.080 min, `5h` = 300 min; `window` desconhecido degrada pro
  próprio valor **sem** minutos inventados. Como Gemini e Claude/GPT são pools
  SEPARADOS, mostrar só um mentiria — e dois "7 dias" sem dono seriam
  indistinguíveis. O grupo entra no rótulo (`"7 dias · Gemini"`), que é a mesma
  receita que o `weekly_scoped` do claude já usa (`"7 dias · Fable"`). O nome do
  grupo é **dado do provider**, não copy nossa (mesmo tratamento do
  `planType: "plus"` e dos rótulos de `agy models`); nossa é a janela, em pt-BR
  e idêntica à dos outros motores. A coluna do rótulo no popover foi de 64px
  para 96px e o reset passou a ceder espaço em vez de transbordar o cartão —
  ele já vinha `shrink-0` num row de largura fixa e "reseta em 6d 12h (dia 22,
  21:50)" estourava a borda desde antes desta frente.
- **Decisão 5 — teto próprio e curto pra sonda.** `--print-timeout 15s` na
  consulta (é consulta, não turno) com o teto de PROCESSO em 20s, o número que
  as outras sondas da casa já usam. A ordem é deliberada: quem desiste primeiro
  é o `agy`, com o `status: ERROR` e o `error` **dele** na tela, em vez de um
  kill cego nosso sem explicação. Nada de `--disable-slash-commands` (é
  justamente a expansão do `/usage` que faz a sonda existir), nem `--add-dir`,
  `--dangerously-skip-permissions` ou `--sandbox`: consulta que não abre turno
  não pede permissão nenhuma.
- **Consequência 1 — um buraco de agnosticismo fechado de passagem.** O probe
  de onboarding decidia "não há nada a instalar" por `usageWindow === "rpc"`,
  enumerando dialeto em vez de perguntar a regra. Com a fonte nova o `agy`
  cairia no ramo da statusline e o app iria perguntar `usage_statusline_status`
  a um motor que nunca teve statusline. A regra passou a ser a verdadeira: só
  PUSH precisa de script no config do usuário.
- **Consequência 2 — um teste pré-existente trocou de cobaia, e o registro é
  este.** O caso "motor SEM fonte não exibe a janela de outro" usava o `agy`
  como exemplo de motor sem fonte. O comportamento travado não mudou uma
  vírgula; mudou o exemplo, que passou pro `opencode` (não integrado). Se a
  regra dependesse do nome do motor, o teste não teria sobrevivido à troca —
  ele sobreviveu, que é a prova de que ela não depende.

### ADR-046 — A fila do composer é do humano; retomada do app não vira mensagem sua ✅
- **Contexto (16/08/2026, incidente `docs/incidentes/2026-08-16-agy-fila-e-exit1.md`,
  Defeito 1):** conceder acesso a uma pasta bloqueada NO MEIO de um turno fez o
  mesmo prompt rodar **duas vezes por inteiro**. Não é ruído de render: os itens
  `#24` e `#48` da conversa `ec1642c1` têm texto byte a byte idêntico, ids
  diferentes, 20 chamadas de ferramenta cada e `result` próprio cada. ~2,4M de
  tokens a mais, num repositório onde o usuário tinha avisado no próprio prompt
  que havia outro dev mexendo nos arquivos. A cadeia, toda provada contra o
  banco: banner sem guarda de `running` → `allowBlockedDir` → `handleSend` com
  turno vivo → `enqueue` na **fila do humano** → drenagem no `finally` →
  segundo turno completo.
- **A nuance que decide o conserto: reenviar É o projeto correto.** O gate de
  diretório entra no `build_command` do **spawn** (`--add-dir`,
  `src-tauri/src/adapters.rs`), então nenhuma pasta é emendada num processo
  vivo. Resume nativo não resolve: o `agy` tem `sessionResume` e a usa, e
  retomar sessão não muda flag. Só um turno NOVO nasce com a pasta. O erro
  nunca foi reenviar; foi reenviar **com turno vivo** e **pela fila do
  usuário**. O mecanismo fica.
- **Decisão 1 — a superfície não oferece o gesto quando ele não cabe.** O
  `BlockedDirBanner` ganhou a MESMA guarda que o vizinho imediato dele, o
  `PlanPendingCard`, já tinha (`!running && !finalizing`): a assimetria entre os
  dois era o bug. Mas o banner não some: com turno em voo ele perde o **botão** e
  ganha uma linha de prazo ("o acesso às pastas é definido quando o turno começa,
  então liberar agora não alcança este; dá pra liberar assim que ele terminar").
  O bloqueio É real e está acontecendo agora, então esconder o aviso seria a
  outra desonestidade; o que sai é a promessa. O aviso volta a ser acionável
  sozinho no fim do turno, porque `blockedDir` só é zerado pelo `start` do turno
  seguinte.
- **Decisão 2 — retomada de sistema não é mensagem do humano, e a fronteira é o
  compilador.** `conv.queued` (os chips "Na fila · enviam juntas ao terminar") é
  lido por UMA superfície e ela é do usuário: o `×` dela chama `removeQueued`,
  que além de tirar da fila **apaga os blobs dos anexos do disco**. No incidente
  o usuário podia cancelar a engrenagem do app achando que cancelava algo dele,
  ou apagar anexo de outra mensagem. Agora existe `lib/sendOrigin.ts`:
  `OrigemDoEnvio = { autor: "humano" } | { autor: "sistema"; motivo }`, o
  `enqueue` do store pede um `OrigemHumana` (tipo `Enfileirar`), e
  `entraNaFilaDoHumano` é **type predicate**, de modo que o `enqueue` só é
  alcançável dentro do ramo já provado. O `handleSend` perdeu o
  `fromAutoResume` booleano e os defaults dos dois parâmetros anteriores: quem
  envia **declara quem é**, ou não compila. Retomada com turno vivo é
  descartada com aviso honesto (a pasta ESTÁ liberada, e vale no próximo envio).
- **Decisão 3 — o gate virou UM, e ele tinha quatro cópias.** `handleSend` e
  `sendFromDesk` (a mesa) tinham cada um dois ramos gêmeos de "turno em voo"
  (guarda de entrada + re-checagem de corrida pós-preflight, "D2"), todos com
  `enqueue` cru e nenhum com teste. Viraram `retidoPorTurnoEmVoo`
  (`lib/sendGate.ts`), com o store REAL sob teste. A superfície da mesa tinha o
  mesmo buraco latente no ramo D2 e fechou junto.
- **Decisão 4 — não oferecer `--add-dir` para bloqueio que o `--add-dir` não
  destrava.** O texto do incidente era `Permission denied for read_file(…).
  Matches hardcoded system protection boundary rule.`: regra INTERNA do `agy`
  protegendo o arquivo de configuração dele, que `--dangerously-skip-permissions`
  e `--add-dir` não contornam (e é bom que não contornem). O `ACCESS_RE` casou
  pelo genérico "permission denied" e o app gastou 5 minutos executando uma
  correção impossível. Entrou `HARD_RULE_RE` em `lib/blockedDir.ts`, casando a
  **frase** ("protection boundary", "system protection", "hard-coded …"), nunca
  o fornecedor: listar `~/.gemini`/`~/.claude` seria fixar comportamento no
  domínio de um CLI e envelheceria a cada motor novo. Falso negativo custa um
  banner a menos (a pasta segue liberável à mão em Configurações); falso
  positivo custava o turno inteiro de novo.
- **O que NÃO entrou, de propósito:** uma fila separada "de sistema". Não há
  retomada interna a enfileirar: o problema desaparece em vez de ganhar
  infraestrutura. E o `--print-timeout` do Defeito 2 é outra frente (contrato
  com o CLI, no Rust), não esta.
- **Prova ao contrário, rodada nas cinco pontas** (o método do §10): revertendo
  a guarda do resolvedor, 3 casos de `dirGate.test.ts` falham; revertendo só a
  fronteira da fila, 3 casos (`dirGate` + `sendGate`); revertendo **as duas**, o
  incidente reaparece inteiro e "o fim do turno não ressuscita o reenvio: o
  prompt não roda duas vezes" falha com um turno despachado pela drenagem;
  revertendo a guarda do banner, 1 caso; revertendo o `HARD_RULE_RE`, 2. O
  payload do `blockedDir.test.ts` é o do item `#31` do banco, não fixture
  inventada (ADR-016).
- **Consequência de catraca:** o `allowBlockedDir` saiu do `ChatPanel.tsx` para
  `lib/dirGate.ts` (é decisão com estado, prazo e caminho de falha, e no
  componente não tinha teste nenhum) e o arquivo encolheu. O `store/chat.ts`
  ficou no mesmo lugar: o `set` manual do `blockedDir` virou o `patch` que o
  próprio store já expõe, e o que sobrou pagou a assinatura nova.

### ADR-045 — O teto de 5 minutos do `agy` era nosso, por omissão; e o desfecho de erro dele tinha explicação que a gente jogava fora ✅
- **Contexto (16/08/2026, incidente `docs/incidentes/2026-08-16-agy-fila-e-exit1.md`):**
  o `agy -p` tem `--print-timeout`, com default `5m0s`, e o app **nunca passou
  a flag**. A única menção dela no repo era um comentário nosso em
  `adapters.rs` tratando a consequência cosmética ("EOF sem `result`"). A
  correlação na conversa do incidente, n=5: 113s ✅ · 158s ✅ · **305s ❌** ·
  **304s ❌** · 257s ✅. Tudo acima de 300.000 ms morreu com exit 1, stderr
  VAZIO e ~4,2M de tokens cobrados; nada abaixo morreu.
- **Decisão 1 — passar `--print-timeout 60m`, e dizer alto que isso NÃO é uma
  promessa de duração.** O app não promete teto de duração em lugar nenhum, e
  a régua de "travou" continua sendo o **watchdog de silêncio** (10 min sem
  item novo), que foi ensinado de propósito a não confundir trabalho longo com
  travamento — missões rodam fases de 15 min de rotina. O teto aqui é só rede
  anti-zumbi: alto o bastante pra nunca ser o gate normal, existente o
  bastante pra que um `agy` de fato pendurado não vire processo eterno.
- **Correção após incidente real (29/08/2026): presença não é heartbeat.** Um
  `run_command` do Agy ficou pendente enquanto o transcript interno avançava,
  mas a ponte não publicou mais nada. Portanto, somente evento ou progresso
  observável re-arma o limiar; ferramenta, processo gerenciado, diferido e fase
  de Missão estáticos continuam elegíveis ao aviso configurado.
- **Decisão 2 — a sintaxe foi TESTADA, não deduzida.** O relatório marcava
  `60m` como não verificado. Verificado: `--print-timeout 60m` é aceito (exit
  0), e `--print-timeout 60banana` é **recusado no parse** com exit 2 e
  `unknown unit "banana"` (é `time.Duration` do Go). Isso importa mais do que
  parece: valor torto aqui falha barulhento no ato, nunca degrada em silêncio
  de volta pros 5 minutos.
- **Decisão 3 — o `result` de erro passa a falar, e o campo certo não era o do
  relatório.** O `map_result` do agy descartava o `response` com um raciocínio
  válido só para `SUCCESS` (é a narração colada na resposta, e o fio já recebeu
  o texto pelos steps). Para `ERROR` isso jogava fora a última coisa que o CLI
  tinha a dizer. **O buraco de prova §5.1 do incidente está fechado, e o
  relatório errou o alvo por metade:** forçando `--print-timeout 2s` num turno
  real, o `response` do ERROR vem **vazio mesmo** — mas existe um campo irmão
  que o relatório não conhecia, `error: "timeout waiting for response"`. O
  extrator lê `error` primeiro e `response` como reserva; ERROR sem nenhum dos
  dois devolve `None` honesto em vez de frase fabricada.
- **Decisão 4 — nenhuma infra nova pro exit code genérico.** O relatório
  propunha marcar `Result { ok: false }` como incidente terminal no runner pra
  matar o "saiu com código 1" que vem por cima. Não foi preciso: o construtor
  de incidente do fio (`messageNodes.ts`, `isGenericExitError`) **já** absorve
  a frase de exit code quando o cluster tem uma causa real, e passa a mostrar a
  razão do CLI no lugar dela — o mecanismo existia e estava esperando alguém
  preencher o `text`. Fica registrado que o `agent.rs` não foi tocado, e por quê.
- **Decisão 5 — `--log-file` NÃO entra.** Era a outra coisa que "tínhamos e
  jogávamos fora". Com a Decisão 3, a explicação chega pelo canal estruturado
  que já lemos; um arquivo de log nosso adicionaria ciclo de vida (onde grava,
  quem limpa, quanto cresce) pra resolver um problema que deixou de existir.
  Se aparecer falha do `agy` sem `error` e sem stderr, aí ele vira a próxima
  peça — com um caso concreto na mão, não por precaução.
- **Consequência — a mesma classe de bug NÃO está em pé nos outros motores, e
  agora isso é teste.** `claude --help` (2.1.220) e `codex exec --help` (0.147)
  não expõem flag de timeout nenhuma (o único teto do claude é
  `--max-budget-usd`, que é dinheiro, não tempo). Conferido nesta máquina em
  16/08/2026 e travado em `so_o_agy_tem_teto_de_duracao_a_desarmar`: se um
  deles ganhar teto de duração amanhã, é esse teste que fica errado primeiro.
- **Nota de escopo:** este ADR fecha só o Defeito 2 do incidente. O Defeito 1
  (o botão "Liberar e reenviar" disparando envio de usuário com turno em voo,
  que DUPLICOU este mesmo erro) é de outra frente e segue aberto aqui.

### ADR-047 — Consumo sem preço vira LINHA no ledger; o silêncio era o pior dos dois erros ✅
- **Contexto (16/08/2026, achado lateral do incidente do `agy`, §6):** o banco
  real do usuário tinha **320 linhas de `claude-code`, 88 de `codex` e ZERO de
  `agy`** em `turn_costs`. Não era subcontagem: era ausência. A cadeia, conferida
  ponta a ponta: `pricing.rs` não tinha **nenhuma** linha google, então
  `estimate()` devolvia `(None, Unknown)`; o adapter do `agy` é honesto por
  design (`adapters.rs`, "sem tabela não inventa número") e mandava `cost_usd:
  None`; e os três writers do ledger (`store/chat.ts`, `store/fusion.ts`,
  `lib/mission.ts`) só gravavam `if (e.cost_usd != null)`. Resultado: a conversa
  `ec1642c1` queimou **7.350.378 tokens em 5 turnos** (2 deles mortos no timeout
  de 5 min do ADR-045) e não deixou UM registro. Painel, custo da sessão na
  faixa e ledger mentiam **por omissão**, que é pior que um zero errado: não
  havia sinal de que faltava algo.
- **Decisão 1 — o SEED do `pricing.rs` ganha a família Gemini, com fonte e
  data.** Sete linhas (`gemini-3.7-flash`, `3.6-flash`, `3.5-flash` e
  `-lite`, `3.1-flash-lite`, `3.1-pro`, `3-flash`) conferidas contra
  `models.dev/api.json` em 16/08/2026 — a MESMA fonte do catálogo dinâmico
  (`catalog.rs`), não um número de memória. O turno `#69` do incidente passa a
  custar **US$ 0,4229** (fixture real no teste). O SEED existe porque o catálogo
  vivo é cache: o `gemini-3.7-flash` saiu em 13/08 e o catálogo do usuário era
  de 12/08, ou seja, o modelo em uso era exatamente o que faltava. O sufixo de
  esforço do `agy` (`-high`/`-medium`/`-low`) é absorvido pelo `contains` da
  tabela: preço é por MODELO, e nenhum código genérico precisou saber que este
  motor embute esforço no id.
- **Decisão 2 — `cost_usd == None` deixa de significar "não houve consumo".**
  Era a escolha ruim que o brief mandou reavaliar, e ela cai: a linha entra com
  **`cost_usd` NULL e os tokens reais**. Quem decide o que vira linha passou a
  ser UM lugar, o `recordTurnCost` (`lib/db.ts`), e não os três call sites — a
  régua é `worthLedgerRow` (`lib/usage.ts`, puro e testado): tem preço OU tem
  token, entra; sem preço e sem token nenhum, não (linha que não descreve
  consumo só engordaria contagem). É a doutrina do ADR-040 aplicada ao ledger:
  "não sei o preço" e "US$ 0,00" são estados diferentes, e o app não pode
  escolher o segundo em silêncio.
- **Decisão 3 — a UI passa a dizer o que ficou de fora, em vez de somar zero.**
  `SUM(cost_usd)` ignora NULL, então nenhum total mudou de valor; o que muda é
  que agora existe consumo fora dele, e isso é DITO: (a) `UnpricedNote`
  (componente único, Painel + Auditoria) imprime "Fora do total: N turnos com X
  tokens e preço desconhecido"; (b) no ranking por agente, motor sem preço
  nenhum mostra **"sem preço"**, nunca "US$ 0,00" — senão o motor que o app não
  sabe cobrar apareceria como o mais barato de todos; (c) a faixa inferior, que
  simplesmente **não desenhava nada** numa sessão inteira sem preço, passa a
  mostrar `sessão · sem preço` (o `absoluteTone` mantém o cinza do §2: valor
  absoluto sem teto do usuário não sobe de tom); (d) `listCardCosts` devolve
  `total: null` (era `?? 0`) quando nenhuma linha da conversa tem preço, o que
  faz a entrega ser gravada com `costUsd: null` em vez de zero medido.
- **Decisão 4 — o catálogo para de sortear preço quando o pedido é mais CURTO
  que os ids publicados.** `catalog.rs` casava por prefixo nas duas direções com
  "o id mais longo vence"; no espaço de nomes do Google isso é uma roleta:
  `gemini-3.1-flash` tem `-lite` (US$ 1,50 out) e `-image` (US$ 60) publicados.
  Agora a direção "pedido estende o id" continua valendo (é ela que absorve o
  sufixo de esforço), e a direção inversa só responde se os candidatos NÃO
  discordarem de preço. Sem unanimidade é `None` → SEED → e, se nem ele souber,
  o turno entra como tokens sem preço. Na dúvida, nunca um dólar inventado.
- **Consequência 1 — nenhuma média nova mentindo.** Varri os consumidores: não
  existe `AVG` no repo, e nenhuma divisão usa CONTAGEM de linhas de `turn_costs`
  como denominador (`perDay` divide pela janela, `perDelivery` por
  `deliveries`). O único `COUNT(*)` sobre a tabela é o do `CostMaintenance`, e
  ele filtra `usage_basis IS NULL` (linhas legadas) — as linhas novas nascem
  carimbadas `delta` e ficam de fora. Nenhum caminho produz `NaN`: todos os
  divisores já eram guardados.
- **Consequência 2 — a reconstrução do ADR-033 fica correta com linha sem
  preço.** `planUsageRecompute` lia `(costUsd ?? 0) < prev` como "a thread
  reiniciou" e devolvia os tokens da linha INTEIROS ao turno; agora custo só
  depõe quando os dois lados têm preço, e quando a linha anterior não tem, o
  delta de custo sai `null` em vez de cobrar o acumulado de novo (mesma escolha
  do ADR-033: errar pra baixo, nunca pra cima). Caminho hoje inalcançável (só
  toca linhas legadas), corrigido porque estava errado.
- **Limites conhecidos, todos declarados:** (a) `models.dev` publica `cost.tiers`
  para o Gemini Pro (acima de ~200k de contexto o preço DOBRA) e nem o catálogo
  nem o SEED leem tiers — a estimativa erra **pra baixo** em turno de contexto
  longo; (b) `gemini-3.1-pro` usa o preço publicado sob o id
  `gemini-3.1-pro-preview`, o único com preço no catálogo; (c) modelos que o
  `agy` serve fora da família Gemini (`gpt-oss-120b-*`) seguem sem preço, e
  agora isso APARECE em vez de sumir; (d) `fmtCost` continua sem "~" para
  `cost_source: "unknown"` (com custo nulo ele devolve "" e nada é renderizado,
  então não há mentira em pé) — `fmtMissionCost` e a faixa já tratam `unknown`
  como estimado.

### ADR-048 — A moldura de risco sai da janela; "Liberado" volta a ser só texto ✅
- **Contexto (17/08/2026):** o `af57bfc` desta mesma semana tinha acabado de
  CONSERTAR a moldura âmbar do modo Liberado (`lib/climate.ts`,
  `<RiskClimate />`) para emoldurar a janela inteira em vez do painel, fechando
  a queixa "parece cortada". Na sessão seguinte o usuário editou o app à mão,
  tirou `<RiskClimate />` do render de `App.tsx` e, perguntado, foi direto:
  **"eu tirei, nao gostei, gosto de algo mais minimalista, profissional"**. Não
  foi acidente nem regressão do conserto — é reversão de gosto sobre uma
  feature que tinha acabado de funcionar certo. Mesma classe do ADR-043 (mock
  decide o quê, o usuário decide se): a moldura era tecnicamente correta e
  ainda assim não era o app que ele queria.
- **Decisão — a moldura sai, o SINAL não.** Removido por completo: `<RiskClimate
  />`, `lib/climate.ts` (`riskClimateOn`, `CLIMATE_FRAME_CLASS`) e os dois
  testes — nada ficou órfão. O que NÃO saiu: o segmented âmbar com o triângulo
  na linha de Execução (`ExecutionRow.tsx`) continua sendo a fonte autoritativa
  de que o modo é "Liberado" — só o reforço ambiente (a moldura ao redor da
  janela inteira) foi embora. Risco autorizado continua DITO; deixou de ser
  também emoldurado.
- **STYLEGUIDE.md corrigido, não só o código.** A doutrina "Modo de RISCO tem
  sinal ambiente; STATUS não" (§2) documentava a moldura como regra da casa;
  reescrita para "Modo de RISCO é DITO, não emoldurado", com a data e o motivo
  (minimalismo, não bug) — se um sinal ambiente voltar a fazer falta, é por ADR
  novo, não por reintroduzir a moldura como estava. As duas citações soltas de
  `lib/climate.ts` (raio de 10px da janela, animação) foram reescritas para o
  fato em si, sem apontar pra um arquivo que não existe mais.

### ADR-049 — O colapso do composer: permissão + planejar antes + identidade viram UM letreiro ✅
- **Contexto (17/08/2026):** `docs/mocks/composer-README.md` (15/08) tinha
  auditado três mocks (A/B/C) pro problema medido no banco real (406 turnos,
  30 dias): agent/modelo trocam em 1,2%/0,7% dos turnos, permissão parada em
  "liberado" em 5 de 5 projetos vivos, `/` com 0 usos reais — três controles
  sempre visíveis (segmented de permissão, toggle "Planeja antes", chevron de
  identidade) para decisões que travam no 1º envio ou nunca mudam. A
  recomendação (§4.4) era o colapso do mock C, com o anel de contexto FORA da
  faixa de status (é prospectivo, a faixa é ambiente — pergunta diferente) e o
  `⌘.` rebaixado a bônus.
- **Decisão — um letreiro só, revelado inline, sem portal.** `ExecutionRow.tsx`
  perdeu o segmented de 3 posições, o botão solto do "Planeja antes" e o
  chevron da identidade; no lugar, UM botão que mostra o modo de permissão
  SEMPRE (nunca trunca — é o único sinal de risco que a tela dá, ADR-048) e
  abre um painel com os três blocos, na ordem de consequência: permissão (lista
  vertical, rótulo canônico + a descrição que já era `title` de cada botão do
  segmented, agora visível), "Planejar primeiro" (`Switch` de verdade, brass
  quando ligado — `lib/selection.ts` já documentava esta exceção), e os
  seletores de agent/modelo/esforço de sempre. SEM portal, de propósito: o
  próprio `ExecutionRow.tsx` já registrava que Select do Radix dentro de
  dropdown/popover briga por foco (é por isso que a identidade nunca usou um);
  a mesma revelação inline que já funcionava pra ela agora serve às três.
- **A cor da seleção segue a régua do `lib/selection.ts`, não inventa uma
  terceira.** "Só lê" e "Pede" selecionados usam `SELECTED_FILL` (neutro, como
  qualquer linha de lista) — o que resolve de graça o bug que o audit do plano
  tinha achado (`ExecutionRow.tsx:124` pintava "Só lê" de VERDE quando
  selecionado, violação do §2 que ninguém tinha corrigido ainda). "Liberado"
  segue âmbar sempre, mesmo selecionado — risco autorizado não é seleção,
  exceção que o próprio `lib/selection.ts` já cravava antes desta passada só
  não se aplicava porque o controle não era uma lista ainda.
- **O furo §7.1 do plano (Planeja antes é por-turno, não persiste, e não tinha
  NENHUMA medição) ganhou uma rede sem esperar dado que não existe: o letreiro
  fechado mostra um ícone extra quando está ligado.** Não é o botão inteiro de
  volta — é o resto do sinal, pra não ligar e esquecer um modificador que só
  vale para o próximo envio.
- **O que NÃO entrou:** o `⌘.` (nunca foi requisito, só bônus, e não há
  registro central de atalhos no app — 7 arquivos usam `keydown` avulso); o
  modelo RESOLVIDO no letreiro em vez do pedido (§2.3 do plano — "Opus (alias)"
  continua mostrando o pedido, não o que a CLI de fato resolveu; é melhoria
  independente do colapso, não bloqueante); e o anel de contexto NÃO desceu pra
  faixa de status (a recomendação vencedora já dizia que não devia).
- **Cobertura, antes de cortar:** o "furo maior" que o plano apontava (zero
  teste de componente no composer) já tinha sido fechado num sprint anterior
  (16/08, `ExecutionRow.permissao.test.tsx` + `composerIdentity.test.ts` +
  `composer.spec.ts`) — o plano, escrito em 15/08, estava desatualizado nesse
  ponto. O gap real que sobrou, medido lendo os testes existentes: "Planeja
  antes" nunca tinha sido clicado em teste nenhum (`onTogglePlanFirst` sempre
  um no-op). Fechado em `e2e/composer.spec.ts` antes do corte começar. Depois
  do corte, `ExecutionRow.permissao.test.tsx` e `CommandConsole.permissao.test.tsx`
  precisaram de reescrita: os botões `role="radio"` só existem com o painel
  aberto, e SSR (`renderToStaticMarkup`, sem jsdom) não simula clique — a
  fronteira de prova é a mesma que a identidade já usava antes do colapso
  (repouso e marcação por SSR, gesto por Playwright em `e2e/composer.spec.ts`).
  Um caso não sobreviveu à mudança de forma ("sem projeto, os 3 radios ficam
  desabilitados" — inalcançável em SSR pós-colapso) e foi substituído por uma
  asserção equivalente ainda alcançável (o letreiro cai em "Pede" e não
  quebra); o guard de runtime (`pick()`: `if (!project) return`) continua no
  código, só deixou de ter prova própria em SSR.
- **Ratchets apertados como consequência, não como meta:** o arquivo perdeu o
  único uso de `st-success` que tinha (a mancha verde do "Só lê" que o próprio
  audit do plano tinha flagado) — a exceção em `scripts/lints/deadTokens.mjs`
  saiu do mapa em vez de ficar em `max: 1` sem uso. `ExecutionRow.tsx` foi de
  217 para ~290 linhas, folgado no teto de 700 — não precisou de arquivo
  próprio como o plano original cogitava (a pressão de tamanho era em
  `ComposerParts.tsx`, que não mudou de estrutura nesta passada).
- **Verificado nos dois temas** (captura de tela, claro e escuro, painel aberto
  e em "Liberado"): hierarquia legível, seleção neutra distinta do âmbar de
  risco, sem truncamento. `vitest` 2793/248, `cargo test` 450, 6 guardas,
  `build` 0, `e2e` 17/17.

### ADR-050 — O agnosticismo, auditado: dois lugares que ainda faziam `?? 0`, e o modelo que o Codex inventava ✅
- **Contexto (17/08/2026):** pedido de auditoria — "está funcional 100% pro
  Antigravity? o que difere de Claude/Codex? algo mapeado e não implementado?"
  — achou dois restos do ADR-047 que não tinham sido varridos (o ADR corrigiu
  os TRÊS writers do ledger, não os agregadores que leem dele) e um bug
  simétrico no Codex: falta de modelo virando um modelo INVENTADO, em vez de
  falta de preço. Time de duas frentes (uma delegada, uma direta) pra fechar
  os dois.
- **Decisão 1 — `lib/companion.ts` (digest do celular) e `lib/fleet/derive.ts`
  (custo por sala) paravam de tratar `costUsd == null` como US$ 0,00.** Mesma
  doutrina do ADR-047, aplicada aos AGREGADORES que ele não tinha alcançado: a
  soma conhecida (`totalUsd`/`room.costUsd`) continua ignorando NULL (é
  aritmética correta pra "quanto sei que gastei"), mas agora vem sempre
  acompanhada de um `unpriced` — turnos e tokens que ficaram de fora, nunca
  silenciosos. `CompanionCosts.unpriced` e `RoomSnapshot.unpriced` são campos
  NOVOS (aditivos — nada quebra em quem já lia o formato antigo).
- **Extraído pra arquivo próprio, não por preferência — por catraca.** Os
  quatro arquivos que a correção tocou (`companion.ts`, `companion.test.ts`,
  `fleet/derive.ts`, `fleet/derive.test.ts`) já estavam CONGELADOS acima do
  teto de tamanho (legado pré-ratchet) e a correção os empurrou mais pra cima.
  A régua da casa aqui é inequívoca — "DIVIDA O ARQUIVO. Não suba o teto, não
  edite a baseline à mão" — então a lógica PURA (ledger de entrada → total +
  não-precificado) saiu pra `lib/companionCosts.ts` e `lib/fleet/ledgerAgg.ts`,
  com teste dedicado em cada um. Os dois arquivos-mãe voltaram a bater
  exatamente na baseline congelada.
- **Decisão 2 — o Codex parou de inventar `"gpt-5.5"` quando não sabe o
  modelo.** `codex_config_model()` (lê `~/.codex/config.toml`) e
  `codex_cost_model()` (requisitado → config → nada) sempre devolveram uma
  `String`, com um `.unwrap_or_else(|| "gpt-5.5".to_string())` no fundo de
  tudo — sem CODEX_HOME, sem arquivo, sem a chave `model`, o adapter chutava
  um modelo e cobrava em cima dele. Agora as duas funções devolvem
  `Option<String>`, de ponta a ponta (os dois transportes, `exec` e
  app-server): sem fonte nenhuma, `self.model` fica `None`, a string pro
  `pricing::estimate` sai vazia, `price_for("")` não casa nada, e o turno
  entra no ledger com `cost_usd` NULL — a mesma degradação honesta do
  ADR-047, não um dólar preso a um modelo que ninguém escolheu.
- **Medido antes de decidir (não presumido):** rodado `codex exec --json`
  nesta máquina em 17/08/2026 sem `-m`, conferindo os quatro eventos do
  stream (`thread.started`, `turn.started`, `item.completed`,
  `turn.completed`) — nenhum carrega o modelo. Não existe fonte melhor que o
  `config.toml` pra recuperar; sem ele, `None` é a resposta certa, não um
  chute mais educado.
- **O que NÃO era o bug:** os testes que já cobriam o delta acumulado
  (ADR-033, `codex_segundo_turno_cobra_o_delta_e_nao_o_acumulado_da_thread` e
  vizinhos) dependiam do default fixo pra ter preço > 0 e testar a subtração
  de baseline. Corrigidos pra pedir modelo EXPLICITAMENTE (`r.model =
  Some("gpt-5.5")`), porque o que eles provam é a subtração, não a resolução
  de modelo — que ganhou teste próprio,
  `codex_cost_model_pedido_venceconfig_venceninguem_nao_inventa`, cobrindo as
  quatro camadas (nada → `None`; só config → usa; requisitado vence config;
  config sem a chave `model` → ainda `None`) contra um `CODEX_HOME` de
  scratch, nunca o do usuário. O `price_for("")` que a Decisão 2 se apoia
  virava composição de peças já testadas (`catalog::lookup("")` do ADR-047 +
  a cadeia SEED por `contains`, que nunca casa string vazia), sem prova
  DIRETA — fechado com `modelo_vazio_nao_casa_preco_nenhum` em `pricing.rs`.
- **Verificado:** `vitest` 2796/250, `cargo test` 452/452, 6 guardas, `tsc`
  limpo, `build` 0, `e2e` 17/17. Terceiro item da auditoria (a flag
  `--json-schema` do `agy`, vista em `docs/hooks-plan.md` mas nunca usada):
  testada de verdade nesta máquina (schema aceito, schema com retry,
  path/JSON inválidos) — é canal ORTOGONAL aos dois incidentes já resolvidos
  (abre `result.structured_output`, mas não limpa o `result.response` sujo).
  Achado com evidência real em `hooks-plan.md`, item 5 de "Achados que
  contradisseram expectativas"; não implementado — sem consumidor no app
  hoje.

### ADR-051 — O colapso da ADR-049 reverte: permissão/planejar/identidade voltam ao rodapé, sempre visíveis ✅
- **Contexto (17-18/08/2026):** a ADR-049 tinha colapsado permissão + "Planeja
  antes" + identidade atrás de UM letreiro clicável, com medição própria (406
  turnos: agent/modelo trocam em 1,2%/0,7%, permissão parada em "liberado" em
  5/5 projetos). Enquanto essa ADR ainda estava fresca, uma sessão do próprio
  Antigravity rodando DENTRO do app — pilotada pelo usuário, referência visual
  de outro produto (Paseo.sh) — reescreveu `ExecutionRow`, `CommandConsole` e
  `ComposerParts` pra tirar os três controles de trás do letreiro e devolvê-los
  ao rodapé, sempre visíveis: `PermissionSelect` (dropdown com ícone+cor por
  modo), `PlanFirstToggle` (botão com rótulo), `IdentityControls` (inalterado,
  só mudou de lugar). O letreiro e o painel inline da ADR-049 saíram por
  completo; `ExecutionRow` ficou reduzido a avisos contextuais (turno em voo,
  CLI que ignora o modo).
- **Não foi decisão minha, e não tenho a favor dela a mesma medição que
  sustentou a ADR-049.** É julgamento de produto do usuário, informado por
  referência visual externa — registro aqui é DOCUMENTAR a reversão, não
  justificá-la com dado que não existe. O oposto do que a ADR-049 fez (que
  tinha 30 dias de banco real por trás) é honesto de admitir: esta decisão
  pesou "o que combina com a referência" mais do que "o que o histórico deste
  usuário pede". Isso não a torna errada — só torna a base de evidência
  diferente, e vale saber disso ao revisitar.
- **O que a revisão pós-reversão achou, e corrigiu nesta mesma passada
  (17/08/2026, a review pedida pelo usuário: "faça um code review... me
  retorne se está tudo devidamente bem feito"):**
  1. **Ratchet de tamanho furado** — `ComposerParts.tsx` (774, teto 700) e
     `lib/agents.ts` (558, baseline 545). `PermissionSelect`/`PlanFirstToggle`
     saíram pra `ComposerExecutionControls.tsx`; `contextWindowFor` saiu pra
     `lib/contextWindow.ts`. Nenhum teto subiu, nenhuma baseline foi editada
     à mão — os dois arquivos-mãe voltaram a bater exatamente no limite.
  2. **`PermissionSelect` tinha zero teste próprio** — a cobertura específica
     de "Liberado acende âmbar, e só ele" (que a ADR-049 tinha) não tinha
     equivalente na nova localização. Fechado em
     `ComposerExecutionControls.test.tsx` (repouso, SSR) + uma linha nova no
     e2e (`composer.spec.ts`) verificando a descrição de cada modo dentro do
     dropdown ABERTO, que é conteúdo portalizado e SSR não alcança.
  3. **Acessibilidade: o dropdown de permissão forçava `role="radio"` numa
     `DropdownMenuItem` comum**, em vez de usar `DropdownMenuRadioGroup`/
     `DropdownMenuRadioItem` do Radix — que já existem no `dropdown-menu.tsx`
     da casa e implementam o comportamento de teclado certo. Trocado pelos
     primitives reais; o papel ARIA correto pra item-radio DENTRO de um menu é
     `menuitemradio`, não `radio` solto — o e2e (`modo()`) foi atualizado
     pro seletor certo.
  4. **`contextWindowFor` ganhou 4 famílias novas (Gemini/gpt-oss/GPT/Fable)
     sem fonte nem teste** — quebra do padrão "medido, não presumido" que
     sustentou a sessão inteira. Investigado ponto a ponto: `gemini-3.7-flash`
     é a ÚNICA cifra confirmada contra o catálogo desta casa (`catalog.rs`,
     `limit.context: 1_048_576`); as demais (Gemini Pro 2M, gpt-oss 200k, GPT-
     classe 272k) ficam como estimativa por conhecimento geral, agora
     DECLARADA como tal no comentário — honesto sobre o nível de confiança em
     vez de apresentar chute como fato. **E um bug de verdade**: o branch
     `fable` era código MORTO — todo id real de Fable (`claude-fable-5`) já
     contém "claude" e nunca alcançava o branch abaixo; removido, com teste
     provando que `claude-fable-5` cai no branch certo. `curatedModels.ts`
     documenta que Fable 5 tem 1M como DEFAULT (sem sufixo `[1m]`) — o branch
     `claude` genérico ainda não reflete isso; furo pré-existente, fora do
     escopo desta passada, deixado anotado no comentário da função.
  5. **Comentários explicativos tinham sumido sem substituto** (o "por quê"
     do `overlay="composer"` no `MicButton`, o `stopTitle` do Parar, o
     propósito do atalho ✦) — restaurados. Dois comentários de
     `ComposerParts.tsx` ficaram FACTUALMENTE ERRADOS pela reversão (diziam
     que identidade/permissão "subiram pra `ExecutionRow`" — o oposto do que
     o código agora faz) — corrigidos pra apontar pra esta ADR.
  6. **"Planejar primeiro" tinha perdido o rótulo visível** (virou ícone puro
     com tooltip só no hover) — é o único controle do rodapé com frequência
     de uso DESCONHECIDA (furo §7.1 do `composer-README.md`); reduzir a
     descoberta dele sem dado novo era o risco que o próprio plano da ADR-049
     já tinha avisado. `PlanFirstToggle` agora mostra o texto "Planejar"
     sempre, não só no hover.
- **Verificado depois de tudo:** `tsc` 0, `vitest` (com 15 testes novos), 6
  guardas, `build` 0, `e2e` 17/17 (a checagem inicial rodou 12 falsos-falhos
  por ruído de porta/processo concorrente — refeita limpa, confirmou 17/17
  reprodutível).

### ADR-052 — A identidade (agent/modelo/esforço) colapsa numa pílula de texto; sem ícone de fornecedor no composer ✅
- **Contexto (18/08/2026):** usuário comparou o app real com referências de
  mercado (Traycer, e uma terceira ferramenta com subagents) e com o próprio
  mock (`docs/mocks/cockpit-composer-limits-mock.html`, já ajustado nesta
  mesma conversa): "ainda não ficou legal". A ADR-051 tinha devolvido
  permissão/planejar/identidade ao rodapé, mas identidade continuou como
  QUATRO pílulas com chrome próprio cada (preset, agent, modelo, esforço) —
  nenhuma referência faz isso, todas comprimem em uma pílula de texto.
- **Decisão 1 — identidade vira UMA pílula, `IdentityDoor`
  (`ComposerExecutionControls.tsx`).** Mostra `resumoDaIdentidade()` — função
  que já existia (`composerIdentity.ts`, escrita junto com a ADR-049 e órfã
  desde a ADR-051 reverter quem a chamava) e já resolvia os dois problemas
  certos: usa o `pill` curto do modelo, não o `label` de menu (mata o
  vazamento "Opus **(alias)**" que estava solto na tela de maior frequência
  de leitura do app), e omite "default" (dizer o óbvio não informa nada).
  Clique revela os seletores crus (`IdentityControls`, inalterado) INLINE,
  sem portal — a mesma razão da ADR-049: `RichSelect` usa `Select` do Radix,
  e `Select` dentro de `DropdownMenu`/`Popover` briga por foco.
- **Decisão 2 — sem ícone de fornecedor na pílula, nem no popover de
  detalhe do mock.** Julgamento do usuário, e concordo com a razão: o ícone
  de agent tem valor ESCANEANDO uma lista (a árvore de conversas, onde ele
  fica — não mudou) porque o olho precisa diferenciar sem ler texto; dentro
  do composer você já ESTÁ na conversa, já sabe qual agent é — o ícone virava
  redundância decorativa competindo por atenção com o pixel que decide de
  verdade (a permissão). Removido do mock primeiro (iteração de baixo risco,
  o usuário aprovou), depois do código real.
- **O que NÃO colapsou, por decisão explícita, dos dois lados:**
  "Liberado" continua pílula própria com ícone+cor+palavra (é o único sinal
  de risco vivo da tela — ADR-048); "Planejar" continua com o texto
  "Planejar" visível, não só ícone (frequência de uso desconhecida, furo
  §7.1 do plano do colapso — esconder o que não tem dado é a aposta errada).
- **Verificado:** rodagem real do app (screenshot antes/depois) confirma o
  texto colapsado sem "(alias)" e sem quebra de linha na faixa; `tsc` 0,
  `vitest` 2801/252 (sem regressão), 6 guardas, `build` 0, `e2e` 17/17 (um
  teste reescrito pra provar o gesto novo: pílula fechada não expõe
  "Agent"/"Modelo" no DOM, abre no clique, nunca contém "alias").

### ADR-053 — Quem cria worktree sozinho, recolhe sozinho ✅
- **Contexto (20/08/2026):** o `comentarios-no-diff-plan.md` §F2 avaliou três
  saídas pro fork e recomendou a **C** (fork normal + "Isolar" no menu),
  registrando por escrito o custo da **B**: "`removeWorktree` recusa com
  mudança não-commitada → lixo que só sai na mão" e "nunca default silencioso
  que enche o repo de worktree órfão". A pedido do usuário ("quero que seja um
  fork de verdade assim como é no Orca ou Paseo"), o que entrou em `clone.ts`
  foi a **B**, silenciosa — e sem a contrapartida que a B exige. O vazamento
  não era teórico: o próprio repo do projeto tinha `mycockpit/05b6b458`
  apontando pra um commit de 13/08, com a pasta já removida e o branch vivo.
- **Diagnóstico:** `remove_worktree` tirava a pasta e deixava o branch (isso
  era deliberado, pra preservar trabalho), e `deleteConversation` não tocava em
  worktree nenhum. Enquanto isolar era gesto deliberado, o lixo era raro e
  consciente. Com o fork isolando sozinho, virou acúmulo invisível.
- **Decisão 1 — o branch morre junto com a pasta, e é o GIT que decide.**
  `remove_worktree` (git.rs) lê o branch DO worktree antes de remover (não
  reconstrói o nome a partir do caminho: adivinhar branch pra apagar é erro sem
  desfazer), remove a pasta, e só então roda `branch -d` — nunca `-D`, e só no
  prefixo `mycockpit/`. As duas recusas do git viram features: mudança
  não-commitada aborta tudo; commit que o HEAD não tem segura o branch. Devolve
  `{ branch, branchRemoved }` pro front poder CONTAR o desfecho.
- **Decisão 2 — worktree entra na lista do que morre com a conversa.**
  `removeConversation` saiu de `store/chat.ts` (2575→2507, no teto do ratchet)
  pra `store/chat/remove.ts`, junto de missão, disputa, card, persist pendente e
  anexos. A regra que rege a lista inteira: nada continua VIVO e INVISÍVEL
  depois que a conversa some — missão órfã, anexo órfão e worktree órfão são o
  mesmo defeito com roupas diferentes.
- **Decisão 3 — fala só quando SOBRA.** Branch apagado é o desfecho esperado e
  já anunciado no diálogo de confirmação (que agora avisa, quando a conversa
  está isolada, que o worktree e o branch vão junto): repetir no fim seria
  barulho. Branch que ficou, ou pasta que o git segurou, vira aviso com nome e
  caminho — senão volta a ser exatamente o lixo invisível que motivou tudo isto.
- **Decisão 4 — o que já vazou tem lugar durável: a faixa de status.**
  `statusWorktreeItem` entra na lista FECHADA de `lib/statusBar.ts` com o
  argumento escrito no módulo: é ambiente (verdade permanente sobre o projeto,
  sem cronômetro, não muda sozinho), não PEDE nada (constata; clicar abre
  detalhe, como a UsagePill), e sem ele o toast avisaria uma vez e sumiria.
  "Branch/alterações" continua FORA pelo motivo de sempre — dois donos pro mesmo
  número —, e worktree solto passa por essa régua em vez de furá-la: quem lê o
  git é UM (`store/worktrees.ts`, sob demanda, sem poll), e ninguém mais mostra
  esse dado. `WorktreesDialog` lista pasta+branch e só oferece "Recolher" pra
  quem não tem commit próprio; com trabalho, mostra o NÚMERO de commits (é o que
  faz o usuário ir buscar em vez de achar que travou) e nenhum botão.
- **Verificado:** semântica do git conferida em repo de teste nos três casos
  (nada commitado → branch apagado; agente commitou → `-d` recusa e o branch
  sobrevive; mudança não-commitada → `worktree remove` recusa e a pasta fica), e
  round-trip do caminho entre `create_worktree` e `worktree list --porcelain`
  batendo texto a texto (é dele que depende saber quem está solto). `tsc` 0,
  `cargo check` 0, `vitest` 2899/260, 6 guardas.

### ADR-054 — Abrir no editor: probe por BUNDLE, CLI de dentro do .app (M1) ✅
- **Contexto (20/08/2026):** `competitors-maestri.md` ranqueou "abrir no editor"
  como altíssimo valor / baixíssimo custo, e o grep confirmou: `vscode://`,
  `zed://`, `cursor://` não existiam em lugar NENHUM do repo. A matéria-prima já
  estava toda pronta (path do projeto, worktree por conversa, diff com arquivo e
  linha). Faltava só o gesto. Cockpit de decisão não é IDE — nem o Maestri,
  100% nativo, construiu editor embutido; fez o atalho.
- **Decisão 1 — probe por bundle `.app`, não por binário no PATH.** Medido nesta
  máquina: `zed` existia só como ALIAS do shell, e processo filho não vê alias —
  o editor instalado ficaria invisível. O que sempre existe é o `.app`. No Linux
  é o binário no PATH, aí sim.
- **Decisão 2 — CLI de DENTRO do bundle, não URL scheme.** O `code`/`cursor` do
  shell depende de o usuário ter instalado o comando; o scheme depende de
  registro no SO e não dá pra conferir antes de tentar. O binário dentro do
  `.app` (`Contents/Resources/app/bin/code`, `Contents/MacOS/cli`) está lá
  sempre que o app está, aceita linha documentada, e a falha vira mensagem.
- **Decisão 3 — contenção obrigatória.** O front manda `project_path` + caminho
  RELATIVO, e o Rust canonicaliza e exige `starts_with`. Sem isso um `rel` de
  `../../.ssh/id_rsa` abriria a chave do usuário no editor. Mesmo espírito do
  `contained` de evidence.rs, e coberto por teste.
- **Decisão 4 — o alvo é o PROJETO, e o botão é UM por painel.** A primeira
  versão pôs um ícone por LINHA de arquivo no diff (hover) que abria aquele
  arquivo na primeira linha alterada. Rodou, e o usuário reprovou as duas coisas
  no mesmo teste: o hover pipocando em cada linha polui a lista, e abrir o
  arquivo sozinho entrega uma **janela órfã** — sem árvore, sem language server,
  sem busca. Medido no Zed: `cli <dir> <arq>:<n>` abre o projeto E pula pra
  linha; `cli <arq>:<n>` não abre projeto nenhum. Então a raiz vai SEMPRE junto,
  o botão mora no cabeçalho de Alterações (ação sobre o conjunto, ao lado do
  refresh) e `firstChangedLine` saiu — código morto é pior que código ausente.
  O `rel`/`line` continuam no contrato do Rust porque focar um arquivo DENTRO do
  projeto aberto é grátis quando alguém precisar.
- **Decisão 5 — sem seção em Configurações.** Um editor: clicar abre. Vários:
  clique esquerdo abre no preferido e o botão DIREITO escolhe outro, virando a
  preferência. Um trigger de dropdown no mesmo botão roubaria o clique esquerdo,
  que precisa fazer a coisa óbvia. Sem editor detectado o botão não existe (§5,
  degradação honesta) — nada de item cinza prometendo o que a máquina não faz.
- **Custo estrutural pago:** `Sidebar.tsx` estava EXATAMENTE no teto (815). O
  item novo no menu do projeto exigiu dividir o arquivo, não subir o teto:
  `ProjectRow` (+ `ProjectFolder` e `PROJECT_DND`, que só existem pra ela) saiu
  pra `Sidebar/ProjectRow.tsx`, e o Sidebar caiu pra 586 e SAIU da baseline.
- **Verificado:** `cargo test` 459, `tsc` 0, `vitest` 2911/262, 6 guardas.

### ADR-055 — Recibo de turno: prazo, e só em background (M2) ✅
- **Contexto (20/08/2026):** `notify.ts` dizia literalmente `"turno concluído"` /
  `"turno falhou"`. O momento de maior atenção do dia — o agente terminou — não
  carregava conteúdo nenhum. O Ombro do Maestri prova que esse instante merece
  texto; a FORMA deles (janela flutuante) fica de fora, já são 3 canais e nenhum
  silencioso (ADR-013), um quarto seria ruído. O que faltava era a alma.
- **Decisão 1 — prazo, não espera (escolha do usuário entre 3 opções).** O
  resumo vem de uma chamada ao helper. Esperar sem limite fura "nenhum canal
  silencioso": helper travado = aviso que nunca sai. `turnReceipt` corre contra
  `RECEIPT_DEADLINE_MS` (3s) e o desfecho ruim é a frase de hoje, nunca o
  silêncio. Resposta vazia, curta demais ("Ok.") ou explodida também caem lá.
- **Decisão 2 — só em turno de BACKGROUND.** No primeiro plano você acabou de
  ver o turno acontecer no fio; resumir seria contar o que você leu. E a chamada
  custa — limitar ao turno que rodou longe dos seus olhos é onde ela se paga.
  Efeito colateral bom: turno em primeiro plano não espera nada.
- **Decisão 3 — com recibo, "turno concluído" SAI.** A linha do sistema é curta;
  gastar metade dela repetindo o óbvio (se veio recibo, concluiu) é desperdício.
  Com ERRO o desfecho fica, porque aí ele é a informação principal.
- **Decisão 4 — feed empilhado DEPOIS do recibo.** Empilhar cedo e remendar
  exigiria um patch no store e abriria a janela em que o sino diz uma coisa e a
  nativa diz outra. O feed é durável; o atraso de ≤3s ninguém percebe.
- **Mesmo knob de sempre:** `helperModel: null` (global ou no `config.toml` do
  projeto, com a MESMA precedência das sugestões) = recibo desligado, custo zero,
  e o código nem chega a montar prompt.
- **Fora do escopo, com motivo:** tray e Companion não consomem o feed de fim de
  turno (o Companion usa `nativeNotify` pra assunto próprio), então "todos os
  canais" do plano original virou os dois que de fato carregam turno: nativa e
  sino.
- **Custo estrutural pago:** `notify.ts` passou de 500 com o recibo. Dividido em
  TRANSPORTE (`notify/native.ts` — permissão, plugin, fallback por osascript) e
  EVENTOS (`notify.ts` — turno, gate, missão). `nativeNotify` é re-exportado pela
  porta antiga: extração não é motivo pra mexer em call site.
- **Verificado:** `tsc` 0, `vitest` 2924/263, 6 guardas.

### ADR-056 — O gate de plano é pedido pendente, não cartão solto ✅
- **Contexto (21/08/2026):** relato do usuário — pediu um plano ao agy, o cartão
  de aprovar/negar apareceu, e depois de reabrir o app não havia nem o pedido nem
  rastro de que ele existiu. A investigação achou DOIS defeitos, um por vez.
- **Defeito 1 — durabilidade.** `pendingPlan` era campo de `ConvState`, estado de
  RUNTIME: não há coluna `pending_plan` nem menção em `lib/db/conversations.ts`.
  Medi a hipótese óbvia antes de aceitar: trocar de conversa NÃO perde (o
  `ensureLoaded` não relê quem já está em `byId`, e não há eviction). Quem perdia
  era reiniciar o app. O banco da conversa real confirmou o pior: 31 `tool`, 2
  `user`, 2 `text`, 2 `result` — nada sobre o plano.
- **Decisão 1 — vira `kind: "planGate"` em `items`.** Zero migração (o `items` já
  é blob JSON gravado pelo `dbSave`, mesmo caminho das notas) e a decisão vira
  HISTÓRICO: aprovar/recusar carimba sem apagar. "Eu autorizei esse plano?" passa
  a ter resposta. O transcript emite a DECISÃO (não o texto do plano, que já está
  acima como fala do agente), então ela viaja no fork e no handoff.
- **Defeito 2 — o gate era invisível para a infraestrutura.** Busca por
  `planGate`/`pendingPlan` em `store/interactions`, `notify.ts`, `InboxBell` e
  `companion.ts`: ZERO ocorrências. Construímos ponto na sidebar, sino, tray,
  nativa, Companion e fail-closed para decisões pendentes — e deixamos de fora
  justamente a mais cara. Ela podia esperar em silêncio numa conversa fechada.
- **Decisão 2 — entra na fila como `kind: "plan"`.** O contrato em
  `lib/interaction.ts` já previa isso por escrito ("aprovar plano — futuro"), e o
  Paseo chegou ao mesmo desenho: lá plano é um `AgentPermissionRequestKind`,
  irmão de `tool` e `question`. Diferença que muda o código: o gate é **local** —
  não há run pausado do outro lado, então `answer` não fala com o backend.
- **Decisão 3 — recusar CONTINUA o planejamento.** "Descartar" era beco sem
  saída: carimbava e o agente nunca sabia que você rejeitou. Virou "Continuar
  planejando", que manda um turno novo enquadrado (`keepPlanningPrompt`) com o
  motivo — a opção 3 do `ExitPlanMode` do Claude Code. Aprovar SAI do modo plano
  (como autorizar a saída no CLI); recusar mantém, então a resposta é outro plano.
- **Decisão 4 — `superseded` como terceiro desfecho.** Mandar outra coisa em vez
  de decidir não é aprovar nem descartar: o `planFirst` segue ligado e o turno
  seguinte traz outro plano. O gate antigo é carimbado `superseded` (e a copy diz
  "substituído por outro", nunca "por você" — pôr seu nome numa decisão que você
  não tomou envenena o histórico).
- **Decisão 5 — o vigia NÃO expira gate de plano.** `checkUnattendedInteractions`
  existe pra destravar run pausado; o gate não pausa run nenhum (nasce com o
  turno já encerrado), e auto-negar seria descartar o plano em silêncio — o
  sumiço que tudo isto veio consertar. O filtro estreita o tipo pra que `notify`
  não precise fingir que sabe lidar com "plan".
- **O QUE NÃO DÁ PRA IGUALAR AOS CLIs, e é consciente:** o **bloqueio**. No
  Claude Code interativo o `ExitPlanMode` é modal — você responde antes de
  digitar. Em headless (`-p`) o turno de plano TERMINA antes de existir alguém
  pra perguntar, e o próprio `adapters.rs` já registrava que "ExitPlanMode não
  existe no headless". Então o nosso gate é assíncrono por construção. Quem
  tentar "tornar modal" vai bater nisto: não é preguiça, é o modo headless.
  A enforcement também varia por motor e isso é honesto: Codex tem sandbox de OS
  (`read-only`), Claude tem `--permission-mode plan`, agy tem só prefixo de
  prompt ("melhor esforço documentado" no adaptador).
- **Fica em aberto, maior que este conserto:** o ACP trata plano como MODO DE
  SESSÃO (`session-modes#plan`, que o Paseo implementa) e nós tratamos como flag
  por turno. Alinhar o modelo inteiro é outra frente.
- **Custo estrutural pago, cinco divisões e nenhum teto subido:** `AdviceCard`+
  `AdviceArrivalRow` → `AdviceInThread.tsx` (MessageList 2381→2275),
  `PlanGateCard` em arquivo próprio (ChatPanel 1516→1482), ações → `store/chat/
  planGate.ts` (chat.ts 2539→2505), o split de visibilidade → `store/interactions/
  split.ts` (705→640) e o vigia de pedido sem resposta → `lib/unattendedWatch.ts`
  (watchdog 607→500, saiu da baseline).
- **Verificado:** `tsc` 0, `vitest` 2956/268, 6 guardas, 20 e2e.

### ADR-057 — Modo é dado do motor, não constante nossa ✅
- **Contexto (21/08/2026):** a ADR-056 deixou registrado que o ACP trata plano
  como modo de sessão e nós como flag por turno. Ao planejar o alinhamento eu
  escrevi "estático é o certo, nenhuma CLI reporta os próprios modos". O usuário
  perguntou: *"por que estático? os modos podem mudar do dia pra noite"*. Fui
  verificar em vez de defender, e a resposta é que eu estava errado.
- **A prova, medida nos binários da máquina:** as três CLIs enumeram os próprios
  modos no `--help`, e a defasagem JÁ tinha acontecido nas três. `claude 2.1.220`
  tem `manual` e `dontAsk` — dois modos que o app nunca conheceu (o comentário do
  código dizia "validado 2.1.209"). `codex 0.147.0` contra "validado 0.144.4".
  E o `agy 1.1.17` **tem** `--mode plan`, que a gente decidiu não usar num teste
  de julho/2026, quando ele ainda não existia.
- **O defeito real não era a lista velha — era a defasagem MUDA.** Nenhuma das
  três deu sintoma. É isso que o trabalho conserta.
- **Decisão 1 — sonda, não constante** (`src-tauri/src/modes.rs`). Mesmo padrão
  do `model_list.rs`, pelo mesmo motivo: dado que muda do lado de fora não vive
  numa constante. Parser puro por motor (o do Claude precisa juntar três linhas),
  timeout curto, e falha vira `known: false` — "não sei" é diferente de "não tem
  modo", e confundir os dois faria a UI esconder o seletor.
- **Decisão 2 — descoberta dá o NOME, não o RISCO.** Este é o eixo de segurança:
  oferecer `dontAsk` porque o `--help` o cita, sem saber o quanto libera, é
  fail-open com nome bonito. Então a curadoria (`lib/agentModes.ts`) é separada
  da sonda, e vale a regra: `descoberto ∩ curado` vira opção; `descoberto \
  curado` e `curado \ descoberto` viram AVISO.
- **Decisão 3 — o aviso do modo que SUMIU é o mais urgente.** Id que saiu do
  `--help` continua sendo enviado até alguém reparar, e aí o erro chega como
  falha de turno em vez de aviso.
- **Decisão 4 — sem dispensar.** Diferente do aviso de update e do de modelo,
  este não tem "dispensar": dispensa é pra o que você já resolveu, e este só some
  quando a curadoria alcança o motor. Deixar dispensar reproduziria exatamente o
  silêncio que criou o problema.
- **Decisão 5 — a rede antes da refatoração** (`lib/sessionMode.ts`, M0). O app
  tem QUATRO vocabulários pro mesmo eixo (conversa, agendamento, Rust, e o
  `planFirst` ortogonal aos três). A tradução virou função pura com régua de
  permissividade, e a invariante "nenhuma migração pode ALARGAR" virou teste em
  vez de promessa. Zero mudança de comportamento nesta fase, de propósito.
- **Estado honesto do agy:** curadoria VAZIA com nota. Ele anuncia `--mode`, o
  app não manda a flag (emula planejamento por prefixo de prompt), e a decisão de
  não adotar precisa de revalidação. O aviso no sino é o que cobra isso.
- **Pendente (M2–M4):** o composer ainda tem permissão + toggle de planejar, e o
  `Auto` segue inalcançável da conversa. A rede está montada; a troca é a próxima
  frente, e ela é a que mexe no eixo de segurança de verdade.
- **Verificado:** `cargo test` 469 (+ prova real `--ignored` contra os três
  binários), `tsc` 0, `vitest` 2987/270, 6 guardas, 20 e2e.

### ADR-058 — Um controle de modo, e o que a interseção quase apagou ✅
- **Contexto (21/08/2026):** M2 do `modos-de-sessao-plan`. O composer tinha
  permissão + toggle "Planejar", fingindo dois eixos. Não são: o `adapters.rs`
  já substituía o `--permission-mode` no turno de plano, com um braço vazio no
  match só pra isso, e no ACP `plan` é um valor da lista de modos.
- **Decisão 1 — `ModeSelect` único**, com as opções do motor ATIVO e o
  `enforcement` visível. Essa última parte é o ganho menos óbvio e o mais
  honesto: "só lê" no Codex é sandbox do sistema operacional, no agy seria um
  pedido no prompt. Mesmo botão, garantias diferentes — e a diferença sumia.
- **Decisão 2 — `Auto` alcançável da conversa.** O Rust já aceitava (o
  `Permission::parse` tem o braço) e o agendamento já usava; só o seletor não
  oferecia. Acrescentar valor ao `PermissionMode` é compatível: `config.toml` e
  banco antigos seguem válidos.
- **Decisão 3 — a UI fala em id de motor, o fio continua o mesmo.** `wireDoModo`
  traduz pro contrato que o Rust já valida (`permission` + `plan_first`). O
  caminho de enforcement não mudou, então esta mudança não tinha COMO afrouxar —
  e há teste cobrando isso na tabela real (`naoAlarga`).
- **Dois defeitos que os testes pegaram, e que mudaram o modelo:**
  1. **A interseção com a sonda apagava o controle.** Sonda sem resposta ⇒ lista
     vazia ⇒ o seletor de permissão SUMIA da tela. Ficar sem controle é pior que
     ficar com lista velha; `modosOferecidos(agent, null)` passa a devolver a
     curadoria inteira, que é o que o app já mandava antes da sonda existir.
  2. **A interseção apagava o modo EMULADO.** "Só lê" no Claude é
     `--disallowedTools`, não `--permission-mode`; o agy não manda `--mode` pra
     nada. Entrou o `probeId`: só o que o app REPASSA precisa ser confirmado pelo
     motor. Sem isso, o agy teria ficado sem NENHUM controle de permissão.
- **O que morreu junto:** `PermissionSelect` e `PlanFirstToggle` foram apagados,
  não deixados "por via das dúvidas". Componente sem chamador é pior que
  componente ausente — alguém reusa achando que ainda vale.
- **Pendente (M3):** o escopo ainda é duplo por dentro — plano liga o
  `planFirst` da CONVERSA, os outros definem a permissão do PROJETO. São os
  mesmos dois destinos de antes, agora atrás de um gesto só.
- **Verificado:** `tsc` 0, `vitest` 2994, 6 guardas, `e2e` 21/21 (o spec do
  composer reescrito pro controle único, incluindo o caso de `Auto` existir).

### ADR-059 — Modo é da conversa; o projeto é default, não teto ✅
- **Contexto (21/08/2026):** M3. Depois do M2 o composer tinha UM controle, mas
  por dentro ainda escrevia em dois lugares: plano ligava o `planFirst` da
  CONVERSA, os outros modos mudavam a permissão do PROJETO.
- **Decisão 1 — `session_mode` na conversa (migração 37), nullable.** NULL =
  herda o projeto, e isso é diferente de "sem modo" — por isso a coluna nasce
  sem default. Aprovar o plano grava NULL (volta a herdar) em vez de chutar um
  valor: quem trabalha em "Só lê" não pode sair do planejamento em "Pede".
- **Decisão 2 — o projeto é DEFAULT, não TETO.** Uma conversa pode ficar mais
  liberada que o padrão do projeto. É o modelo dos CLIs (trocar de modo dentro
  da sessão) e a régua que o usuário pediu explicitamente. Quem quiser guardrail
  usa o `.mycockpit/config.toml`, que segue vencendo o cache do SQLite.
- **Decisão 3 — definir o default virou gesto próprio** ("Usar como padrão deste
  projeto", no mesmo menu). Sem isso haveria REGRESSÃO: o composer era o único
  lugar do app que escrevia a permissão do projeto. E o gesto separado deixa os
  dois escopos explícitos, que é o que faltava.
- **Bug achado no caminho:** o "Planejar primeiro" NÃO sobrevivia a restart —
  `planFirst` só vivia em memória, sem coluna. Terceira ocorrência da mesma
  classe nesta semana (worktree órfão, `pendingPlan`, agora este): decisão do
  humano morando em estado de runtime. A migração 37 fecha esta.
- **O clone NÃO leva o modo:** fork/duplicar nasce herdando o projeto. Carregar
  "Liberado" para um fio novo seria permissão que ninguém pediu.
- **Custo estrutural pago:** `store/chat/sessionMode.ts` (a ação) e
  `store/chat/suggestions.ts` (debounce + token + geração, recorte fechado com
  memória própria). `chat.ts` 2505 → 2448 — e desta vez parei de raspar
  comentário para caber, que é o antipadrão que a própria catraca existe pra
  impedir.
- **Verificado:** `cargo test` 469, `tsc` 0, `vitest` 3000, 6 guardas, e2e 21/21.

### ADR-060 — Um eixo só, e a rede que estava frouxa (M4) ✅
- **Contexto (21/08/2026):** último passo do `modos-de-sessao-plan`. Sobravam
  dois vocabulários fora do eixo: `SchedulePermission` (`leitura|padrao|auto`) e
  a autonomia por fase de missão (`auto|inherit`).
- **Decisão 1 — o teto do agendamento vira TIPO.** `SchedulePermission` passou a
  ser `Extract<SessionMode, "leitura"|"padrao"|"auto">` e mora no eixo (o
  `db.ts` reexporta pela porta de sempre). "liberado nunca existe aqui" era
  comentário; agora o compilador recusa.
- **Decisão 2 — uma tradução, não duas.** `phasePermission` tinha o clamp
  próprio e passou a delegar pro `modeFromAutonomy`.
- **O achado que justifica o passo inteiro:** as duas cópias DIVERGIAM, e a
  errada era a rede do M0. `phasePermission("leitura", auto)` devolvia
  `"leitura"` (clampa); `modeFromAutonomy("auto", "leitura")` devolvia `"auto"`.
  A rede escrita para impedir afrouxamento **afrouxava** — e o teste do M0
  codificava o erro por extenso. Migrar a produção pra ela sem comparar teria
  dado escrita sem pedir a missões de projeto read-only.
- **A invariante certa precisou de duas tentativas, e as duas ficam registradas:**
  (1) "nunca alarga em nenhuma combinação" é FORTE DEMAIS — subir de "Pede" pra
  "Auto" é o propósito do toggle; (2) a certa é `inherit` nunca alarga (não há
  gesto do usuário) e `auto` não solta escrita em projeto que não escreve.
- **Lição de processo:** rede de segurança precisa ser conferida CONTRA a
  produção, não só escrita antes dela. A minha passou três fases sem ninguém
  comparar, porque nada a usava ainda.
- **Verificado:** `cargo test` 469, `tsc` 0, `vitest` 3003, 6 guardas, e2e 21/21.

### ADR-061 — O `--mode plan` do agy segue consultivo, e agora a recusa VENCE ✅
- **Contexto (21/08/2026):** o aviso de modos (ADR-057) tornou visível um débito
  que estava mudo: o agy anuncia `--mode (accept-edits, plan)` e o app não usa,
  por uma decisão de julho/2026 tomada na versão 1.1.2. Instalada: 1.1.17.
- **Experimento, não opinião.** Dois diretórios descartáveis, o mesmo prompt
  pedindo explicitamente a criação de um arquivo:

  | condição | escreveu? |
  |---|---|
  | `agy --mode plan -p "crie o arquivo X"` | **SIM** |
  | prefixo de prompt + `--sandbox` + skip (o que o app faz) | **não** |

  O próprio agy explicou o primeiro: *"como você utilizou o comando /plan mas
  solicitou execução imediata sem confirmação, os artefatos de planejamento
  foram gerados retroativamente"* — executa e documenta depois.
- **Resultado contraintuitivo:** a emulação por prompt, que o registry marca
  como o enforcement mais fraco (`"prompt"`), segurou; o modo NATIVO do motor
  não. A decisão de julho continua certa, agora com prova nesta versão.
- **Armadilha do método, registrada:** a primeira rodada usou `timeout`, que não
  existe no macOS. `exit=127`, diretório vazio, e a leitura ingênua seria "o
  modo segurou" — um falso negativo que teria invertido a conclusão. Conferir o
  exit code antes de ler o resultado não é zelo, é o que separa medir de fingir.
- **O buraco que o débito revelou:** o aviso tinha só DOIS estados — curado
  (some) ou desconhecido (avisa pra sempre). Uma revalidação já feita continuaria
  sendo cobrada como descuido. Entrou o terceiro: `naoAdotado`, com motivo e
  **versão em que foi conferido**.
- **Decisão que impede o dogma:** a recusa vale PARA AQUELA versão. Quando o
  binário mudar, ela vence sozinha e o sino volta a pedir o teste ("`plan` foi
  recusado na versão 1.1.17 e o motor mudou de versão"). Sem a versão, o
  "não adotado" viraria verdade eterna — que é como este débito nasceu.
- **Verificado:** `cargo check` 0, `tsc` 0, `vitest` 3005, 6 guardas, e2e 21/21.

### ADR-062 — O Companion já eram dois arquivos; o recibo só mostrou onde ✅
- **Contexto (21/08/2026):** o R2 (turnos recentes no celular) precisava de ~26
  linhas em `lib/companion.ts`, que estava com 1288 — 788 acima do teto de 500
  e congelado na baseline. A catraca barrou, como devia.
- **A fronteira não foi escolhida, foi lida.** O arquivo já tinha banners de
  seção próprios, e o corte caiu inteiro em um deles: `companionAction.ts` levou
  o que o celular MANDA FAZER (lançar tarefa, responder interação, parar turno)
  + o veredito fail-closed de cada ação; `companion.ts` ficou com o que o
  celular LÊ (montar o snapshot). Nenhum símbolo atravessou o corte — sinal de
  que a divisão já existia e só não tinha nome.
- **Por que isso importa além do tamanho:** a metade de escrita é onde o §9
  precisa valer (ação vinda de fora da máquina não pode ser aceita em silêncio
  nem respondida com otimismo). Ela agora é um arquivo que se lê inteiro.
- **O único fio atravessado virou módulo sem dono.** As duas metades pingam
  "conversa mudou", e o throttle é estado de módulo (`Map` de timers). Colocá-lo
  em qualquer um dos dois fecharia um ciclo de import — a mesma armadilha que já
  custou um `window is not defined` em teste neste repo. Saiu `companionPing.ts`,
  que ninguém importa de volta.
- **A peneira do R2 ganhou um segundo furo:** além do `convId` do R1, exige
  `projectId`. Não é rigor gratuito — no celular não há como resolver o projeto
  de uma linha, e turno sem projeto entraria mudo. Melhor fora que ambíguo.
- **Verificado:** `tsc` 0, `vitest` 3019, 6 guardas (baseline APERTADA, não
  afrouxada), e2e 21/21.

### ADR-063 — Trabalho de fundo que ninguém consegue esperar não é assíncrono, é invisível ✅
- **Contexto (21/08/2026):** CI vermelho intermitente com
  `EnvironmentTeardownError: Cannot load react ... after the environment was
  torn down`. Duas runs falharam (M2 e R2) com runs VERDES no meio, enquanto a
  suíte passava 3019/3019 no Mac.
- **Não era o runner.** O convite era culpar máquina lenta — e a carga fantasma
  já ensinou que "flake sob carga" nunca é explicação. Era
  `void import("@/lib/planGate").then(...)` disparado de dentro de uma ação
  SÍNCRONA do store: ninguém segurava a promessa, o teste acabava, o vitest
  derrubava o ambiente, e a promessa acordava depois. No Mac o grafo de módulos
  estava quente e ela ganhava a corrida; no runner, às vezes, não.
- **O import dinâmico está CERTO onde está** — é o que quebra o ciclo
  `store/chat → lib/planGate → store/interactions → store/chat`, o mesmo que já
  custou um "window is not defined" na suíte de missão. O errado era o `void`
  puro.
- **`lib/deFundo.ts`:** a promessa passa a ser CONTÁVEL sem deixar de ser
  não-bloqueante (um `Set.add`/`Set.delete` em produção, semântica idêntica), e
  `src/test/setup.ts` drena no `afterEach` de TODOS os testes. A corrida deixa de
  existir por construção, não por sorte de timing.
- **Classe, não ocorrência.** Eram QUATRO sítios com a mesma forma (planGate ×2,
  cards no `start` e no transplante, cards no `remove`). Só um tinha mordido; os
  outros três eram a mesma bomba com pavio mais longo.
- **O gate ganhou voz:** o `.then` do planGate não tinha `.catch`. Falhar ali é o
  gate te esperando em silêncio — exatamente o bug que ADR-058 existe pra matar.
  Agora grita.
- **Erro meu no caminho, registrado:** a primeira versão do teste do laço
  realimentava com `Promise.resolve().then(...)` infinito e travou o processo.
  Não testava o guard — afogava o event loop em microtasks. O guard protege
  contra laço; contra bomba de microtask não protege nada, e não é papel dele.
- **Custo estrutural:** `store/chat.ts` estourou a catraca por 5 linhas. Saiu
  `store/chat/ordem.ts` — as duas ações de ordenação eram gêmeas linha a linha,
  diferindo só na função que calcula a lista nova, e o espelho duplo
  (`conversationsByProject` + `conversations` do projeto ativo) agora é escrito
  uma vez só. O compilador ainda apertou um tipo no caminho: `delta` é `1 | -1`,
  não `number`.
- **Verificado:** `tsc` 0, `vitest` 3027, 6 guardas (baseline APERTADA), e2e
  21/21, `cargo check` 0.

### ADR-064 — Uma frase, dois runtimes: o R3 que o plano não podia prever ✅
- **Contexto (21/08/2026):** o R3 era condicional — extrair um formatador de
  recibo SÓ se as quatro superfícies divergissem em copy. Com R1/R2 entregues,
  deu pra olhar em vez de supor.
- **Não eram quatro divergindo.** Eram DUAS iguais (bandeja e Companion, a mesma
  expressão escrita em dois lugares) e duas diferentes por MOTIVO: a nativa
  derruba o "turno concluído" quando há recibo, porque a linha do sistema é curta
  e cara; o sino não formata frase nenhuma (é estrutura). Unificar as quatro
  teria apagado uma decisão fingindo corrigir um descuido.
- **`fraseDoTurno` mora colada no `receiptBody`**, mesmo arquivo, com o
  comentário dizendo por que as duas NÃO são uma. Em arquivos distantes elas
  voltariam a convergir por acidente.
- **O plano era impossível como escrito, e o motivo importa:** o cliente do
  Companion é HTML estático com `<script>` puro servido pelo Rust — sem bundler,
  ele não importa `lib/`. A saída foi mandar a frase JÁ PRONTA no snapshot
  (`CompanionTurn.frase`): o aparelho renderiza em vez de reimplementar a regra.
  Sem risco de versão desencontrada, porque a página é servida pelo mesmo
  binário que monta o snapshot.
- **Custo:** `lib/companion.ts` estourou a catraca de novo; saiu
  `lib/companionTypes.ts` (só tipos, zero comportamento). Vale como fronteira
  além do tamanho: é o contrato que o celular precisa respeitar sem conseguir
  importar.

### ADR-065 — O teto do diff: o que a medição em Node quase me fez errar ✅
- **Contexto (21/08/2026):** não tínhamos teto de render nenhum. O Orca tem
  (`120_000` linhas, `6_000_000` caracteres), e o caminho fácil era copiar.
- **Medi primeiro, e o parser estava inocente.** `parsePatch` faz 120k linhas em
  16ms. A intuição apontava pro parser; o custo está no LAYOUT (2426ms nos 120k,
  contra 272ms de build de DOM).
- **O erro que quase entrou.** A primeira medição foi em Node com
  `renderToStaticMarkup`, e a tabela dizia que só o número de LINHAS custava: 10
  MB em 500 linhas saía em 3ms. Conclusão: um eixo só, linhas. **Errado.**
  Repetindo no navegador, as mesmas 500 linhas de 20 mil colunas custam 414ms de
  layout e mais scroll (91ms) que 20 MIL linhas normais (58ms) —
  `renderToStaticMarkup` não faz layout, e é no layout que linha larga dói. Um
  bundle minificado teria passado inteiro pelo teto de um eixo só.
- **A lição do método:** medir no runtime errado é pior que não medir, porque
  produz um número com aparência de evidência. O harness em Node não estava
  "aproximando" o navegador — estava medindo outra coisa.
- **Os números, nossos:** `MAX_LINHAS_POR_ARQUIVO = 20_000` (layout ~271ms,
  scroll p95 ~58ms) e `MAX_CHARS_POR_ARQUIVO = 2_000_000`. Dois eixos como o
  Orca, mas por razão medida aqui: os 120k deles travariam o nosso painel por 2,4
  segundos.
- **O corte FALA.** Arquivo cortado mostra motivo, tamanho real e a saída pro
  editor. Esconder mudança grande num painel que existe pra mostrar o que mudou é
  pior que travar, porque travar pelo menos é visível. E ele diz que não aceita
  comentário: sem linha desenhada não há `path@side:linha` pra ancorar, e deixar
  o gesto falhar calado seria fail-open.
- **Verificado:** `tsc` 0, `vitest` 3039, 6 guardas, e2e 21/21, `cargo check` 0.

### ADR-066 — Melhoria visual sem medida vira regressão: o review do agy ✅
- **Contexto (22/08/2026):** o agy entregou 5 ajustes visuais (24 linhas). `tsc`
  0, suíte verde, 6 guardas passando. Duas das cinco eram regressões — o que
  passa em guarda não é o que preocupa.
- **`DiffIndex`: a mudança cortava justamente o que vinha promover.** Trocar a
  ordem pra "nome primeiro, diretório depois" está certo (padrão VSCode/GitHub);
  perder o `shrink-0` do nome, não. Com os dois `truncate`, ambos encolhem.
  MEDIDO no navegador, coluna de 260px: nome cortado (`scrollWidth >
  clientWidth`) no layout novo, nunca cortado no antigo. Quem cede tem que ser o
  diretório.
- **`formatDisplayPath` colapsava caminhos distintos.** Guardando só o último
  segmento, `~/projetos/clientes/acme/apps/web` e `~/projetos/pessoal/blog/apps/web`
  viravam ambos `~/…/web` — numa lista cuja função é dizer QUAIS diretórios
  estão liberados. A cauda agora CRESCE enquanto couber: preserva o que
  distingue, não o que sobra.
- **E a regra estava ao contrário nos extremos:** se o candidato abreviado ainda
  passasse do limite, ela devolvia o caminho INTEIRO. Encurtava o caminho médio
  e não encurtava o longo. Agora devolve o elidido de qualquer jeito, e o
  `truncate` do CSS (que é width-aware, coisa que contagem de caractere nunca
  será) resolve o resto. Os dois trabalham juntos: um escolhe O QUE preservar, o
  outro resolve a largura real.
- **Latente, corrigido junto:** caminho relativo ganhava uma barra inventada na
  frente (`projetos/x` → `/projetos/…/x`), afirmando um caminho absoluto que não
  existe. Hoje `extraDirs` vem de seletor, então não mordia — mas era contrato
  não escrito.
- **A causa comum das duas:** função pura em `lib/` entregue SEM teste. É onde a
  casa testa tudo, e os três defeitos acima aparecem no primeiro caso escrito.
  `utils.test.ts` nasceu com eles nomeados pelo defeito, não pela feature.
- **`text-faint opacity-80` revertido.** O `index.css:59` diz que `--st-idle` é
  `var(--faint)` e "por definição não pode divergir". Empilhar opacity criava uma
  segunda resposta pra "quão apagado" que nenhuma guarda pega. Se o rótulo deve
  recuar mais, isso é token novo.
- **Commit sólido MANTIDO** (`bg-primary` é token, eleger a ação principal do
  painel faz sentido); só a transição voltou a ser de superfície
  (`transition-colors` + `hover:bg-primary/90`) em vez de apagar o botão inteiro,
  texto incluso.
- **Verificado:** `tsc` 0, `vitest` 3049, 6 guardas, e2e 21/21, `cargo check` 0.

### ADR-067 — A linha do arquivo errou TRÊS vezes; agora tem medida ✅
- **Contexto (22/08/2026):** o usuário mandou print do índice de Alterações com
  o contador verde (`+124`) pintado POR CIMA do nome do arquivo
  (`console-2026-08-06T18-49-27-114Z.log`). O defeito era do meu fix da ADR-066.
- **As três tentativas, cada uma criando a seguinte:**
  1. original: `dir` truncando, `base` com `shrink-0`. Nome nunca cortava, mas
     nome LONGO transbordava e colidia com o contador (o print).
  2. o agy: os dois truncando. Nada colidia, mas o NOME era cortado numa coluna
     de 260px — o dado que a linha existe pra mostrar.
  3. meu fix da ADR-066: voltei o `shrink-0` pro nome. Consertei (2) e
     reintroduzi (1). **Eu tinha medido só o caso do agy**, não o caso longo.
- **A correção certa é uma ESCADA, não uma escolha:** `shrink-[9999]` no
  diretório (cede tudo antes de o nome perder um pixel), `truncate` no nome
  (último recurso), `overflow-hidden` no meio (rede: nada pinta por cima do
  contador). Medido nos três casos × três larguras.
- **A lição do método:** medir UM caso e generalizar é o mesmo erro do
  `renderToStaticMarkup` na ADR-065 — número com aparência de evidência. Ali o
  runtime estava errado; aqui o conjunto de casos estava incompleto.
- **Virou peça e virou teste.** `FilePathLabel` em `DiffPanel/parts.tsx` (o
  arquivo já existia com o comentário prevendo exatamente isto: "duas cópias
  divergiriam em silêncio"), e o `DiffPanel` ainda tinha uma TERCEIRA cópia do
  `splitPath` inline. O `e2e/diff-linha-arquivo.spec.ts` IMPORTA as classes de
  `parts.tsx` em vez de reescrevê-las — reescrever testaria a cópia. Verificado
  que morde: reintroduzindo o `shrink-0`, falha com `longo @ 240px`.
- **Verificado:** `tsc` 0, `vitest` 3049, 6 guardas, e2e 22/22, `cargo check` 0.

### ADR-068 — O eixo de modo tinha tudo, menos o último metro ✅
- **Contexto (23/08/2026):** o usuário abriu uma conversa NOVA em "Liberado",
  sem trocar nada durante o turno, e o Claude pediu permissão a cada Bash.
- **Meu primeiro diagnóstico estava ERRADO.** Respondi que ele tinha trocado o
  modo com o turno em voo, e que a flag é fixa no spawn — explicação plausível,
  e o app até mostra "vale a partir do próximo envio". Ele corrigiu: conversa
  nova, do zero, nada trocado. Aí virou investigação de verdade.
- **O bug:** `ChatPanel` mandava `project.permissionMode ?? "padrao"` pro
  `runAgent`. O `conv.sessionMode` — o valor que o chip escreve e mostra — era
  lido em EXATAMENTE dois lugares: desenhar o chip e derivar o `planFirst`.
  Nenhum deles chegava ao processo.
- **O M0–M4 construiu o eixo inteiro e não ligou a ponta.** Teve rede de testes
  (M0), sonda do motor (M0.5), curadoria (M1), controle único (M2), persistência
  com migração (M3) e unificação (M4) — e nada disso perguntava *"o valor chega
  no processo?"*. Cada fase testou a sua metade; a costura entre a última e o
  spawn não era de ninguém.
- **E contaminava o sandbox (S1–S4).** O confinamento decide pelo
  `req.permission`, que vinha do projeto: escolher "Só lê" no chip NÃO confinava
  nada, a menos que o projeto inteiro já estivesse em leitura. Garantia de
  segurança pendurada num controle desconectado é pior que garantia nenhuma —
  porque ela é exibida.
- **Por que existe permissão no PROJETO:** ela é *default*, não teto (ADR-059).
  Serve pra conversa nova em projeto sensível nascer segura sem ninguém lembrar;
  a conversa manda em si mesma. O bug fazia parecer que o projeto governava.
- **A correção é uma função pura com nome:** `modoEfetivoDoSpawn` (conversa
  vence projeto, ausência dos dois cai em "padrao" — fail-closed) +
  `permissaoDoSpawn` (eixo → vocabulário do Rust). Nos dois sítios de spawn,
  incluindo o transplante de motor: trocar de CLI no meio não pode rebaixar o
  modo escolhido.
- **O compilador achou um resto do M0 no caminho:** `PermissionVocab` se
  descreve como "vocabulário da conversa/projeto" e lista TRÊS valores, enquanto
  o `PermissionMode` do `lib/types.ts` tem QUATRO — o `auto` do projeto não
  cabia. Quem cedeu foi o tipo estreito.
- **Verificado:** `tsc` 0, `vitest` 3070, 7 guardas, e2e 23/23, `cargo` 494.

### ADR-069 — O medidor do Codex caiu por uma flag removida, e o motivo estava no lixo ✅
- **Sintoma (23/08/2026):** "Codex — Falhando desde 23:41 (resposta inesperada)"
  no popover da janela de uso. Claude e Antigravity normais.
- **A causa:** o **codex 0.149.0 REMOVEU o valor `untrusted`** de
  `--ask-for-approval` (`possible values: on-request, never`). A sonda subia
  `codex -s read-only -a untrusted app-server`, a CLI recusava a flag e morria
  antes de falar protocolo.
- **O susto que não se confirmou, e valeu conferir:** `untrusted` aparece em
  DUAS superfícies — a flag da CLI e o `approvalPolicy` de cada `thread/start`.
  Se o protocolo também tivesse derrubado, o Codex teria **parado de perguntar**
  no modo "Pede", que é regressão silenciosa de segurança. Testado nesta versão:
  o `thread/start` com `"untrusted"` CONTINUA sendo aceito, inclusive com o
  processo subido em `-a never`. A flag da CLI é só o default do processo; quem
  manda no turno é o parâmetro.
- **O segundo defeito, e é o que doeu:** `stderr(Stdio::null())`. A CLI escreveu
  `invalid value 'untrusted' for '--ask-for-approval'` — a resposta exata — e a
  gente JOGOU FORA. O usuário recebeu "resposta inesperada", que não aponta pra
  lugar nenhum, e a investigação começou do zero.
  - Agora o stderr é capturado e a primeira linha ÚTIL vira sufixo do erro.
  - `primeira_linha_util` pula o `"For more information, try --help"` e corta em
    160: despejar o stderr inteiro trocaria um erro mudo por um ilegível.
  - **Mesma lição da ADR-045**, e o fato de repetir é o achado: descartar
    `stderr` "porque é ruído" tem custo que só aparece no dia da falha.
- **Terceiro drift em uma semana** (modos das CLIs, `--mode plan` do agy, agora
  esta flag). O M0.5 criou sonda pro eixo de MODOS; o medidor de uso e o
  transporte seguem com flags fixas no código. Fica anotado: dado que muda do
  lado de fora não pode viver numa constante — e ainda vive em dois lugares.
- **Verificado:** `cargo` 497, `tsc` 0, 7 guardas.

### ADR-070 — O azul vivo é do CHROME; no fio, vivo é movimento ✅
- **Contexto (23/08/2026):** um segundo dev, trabalhando no `MessageList` a
  pedido do usuário ("algo bem minimalista mesmo, sem cores, sem nada, igual o
  CLI dos agentes"), tirou o `st-running` do grupo de ferramenta vivo. A mudança
  estava certa e o GUIA não sabia: o §2 dizia `st-running` = "o que roda AGORA",
  sem distinguir superfície. Do jeito que estava, o próximo agente recolocaria o
  azul citando o §2 — com razão, do ponto de vista dele.
- **A regra que o usuário formulou, e é melhor que a anterior:** o azul vivo
  pertence onde você VARRE para saber, não onde você TRABALHA. *"Na conversa, no
  output não precisa de cores vivas — eu preciso interagir com os agentes,
  mandar prompts, chamar especialistas, aprovar planos. Agora dentro do sidebar,
  da interface em si, aí são outros 500."*
- **Chrome × conteúdo**, e a fronteira é física pra não virar julgamento: chrome
  é o que fica FORA do fio rolável; conteúdo é o que rola dentro dele.
- **O que muda não é a informação, é o CANAL.** No fio, "rodando" passa a ser
  dito por movimento em cinza — que é o que o CLI dos agentes faz, e que já
  obedece o §6 (movimento só pro que está vivo e termina sozinho). Sai a tinta,
  fica o sinal.
- **Por que a regra velha errava:** dentro do fio a tinta disputa atenção com o
  texto, que é o trabalho. Fora do fio ela não disputa com nada — é justamente o
  que faz uma linha saltar numa lista de dez projetos. A mesma cor tem valor
  oposto nas duas superfícies, e a regra antiga tratava as duas igual.
- **O caso que provou:** o ponto azul da pasta FICA (o usuário pediu
  explicitamente) e é o único sinal quando o projeto está retraído; o grupo de
  ferramenta no fio vai a cinza. Duas decisões opostas sobre a mesma cor, e
  agora as duas derivam de uma regra só.
- **Migração completada em 23/08/2026, quando o outro dev soltou o arquivo.**
  Os quatro sítios restantes do fio saíram do `st-running`: os dois spinners
  viraram `text-muted-foreground` (o GIRO já diz "rodando"), o ponto do ramo
  aceso virou `bg-foreground/45` — ele não gira de propósito (seria o terceiro
  spinner narrando o mesmo trabalho), então diz "aceso" por CONTRASTE contra os
  irmãos apagados — e o pulso do `WorkingIndicator` idem. O âmbar do `stalled`
  FICOU: travado não é "vivo", é aviso, e isso é outro eixo.
- **O teste da despoluição virou a guarda da regra.** Ele afirmava as cores
  (`animate-spin text-st-running`); agora afirma o comportamento
  (`animate-spin`, 2 ocorrências) MAIS um `expect(html).not.toContain("st-running")`.
  É esta última linha que impede a tinta de voltar: um agente futuro pode achar
  que o azul "ajuda a ver", e o guia sozinho não o impediria.
- **Um conserto de acessibilidade junto:** o outro dev tinha removido o
  `focus-visible:ring` do cabeçalho do grupo pra matar o anel dourado. Isso
  matava o anel PARA O TECLADO também. Devolvido — o §2.1 já apaga o anel no
  mouse sem custar navegação por Tab, e ele não sabia porque a sessão dele
  começou antes.

### ADR-071 — O anel que congela: o que foi DESCARTADO importa mais que o conserto ✅
- **Sintoma (23/08/2026):** *"o pill trava em alguma posição e só volta a se
  mexer quando eu ativo ou dou foco na conversa"*, com dois anéis parados na
  sidebar.
- **A pista que orientou tudo:** "trava em ALGUMA posição". Animação que
  REINICIA trava perto de 0°; travar num ângulo arbitrário é assinatura de
  SUSPENSÃO. Isso descartou metade das hipóteses antes de qualquer medida.
- **Descartado com medida** (fica registrado pra ninguém refazer):
  | hipótese | como caiu |
  |---|---|
  | CSS que suspende render (`content-visibility`, `contain`, `will-change`) | não existe nenhum no app |
  | ticker de minuto | snapshot estável, não remonta elemento |
  | reordenação da lista durante o turno | a ordem é MANUAL (`sort_order`), não muda no turno |
  | suspensão do WebKit em segundo plano | MEDIDO no motor: a animação continua com a página em background |
  | `prefers-reduced-motion` vencendo o override | MEDIDO com o CSS COMPILADO: o `.conv-spin` vence e degrada pra ponto sólido, que não é o que se vê |
  | `overflow: clip` que eu mesmo pus dias atrás | MEDIDO nos quatro modos de overflow: nenhum congela |
- **O que sobra e explica cada detalhe: oclusão de janela do macOS.** Janela
  coberta vira ocluída, o WKWebView suspende a renderização, e ao reaparecer
  repinta o último quadro sem necessariamente retomar a animação até que algo
  force recálculo de estilo — clicar numa conversa é exatamente esse "algo".
  Casa com o ângulo arbitrário, com a volta ao interagir, com o "às vezes"
  (depende de a janela ter sido coberta) e com não reproduzir em motor headless,
  que não tem janela pra ocluir.
- **Honestidade sobre o estado:** isto NÃO está provado. Não consigo instrumentar
  a janela real de dentro daqui. É a única hipótese que sobrou de pé depois de
  seis medições, o que é diferente de ser demonstrada.
- **O conserto é uma ÉPOCA, e o desenho recusa o atalho.** `lib/janelaViva.ts`
  incrementa um número quando a janela VOLTA (`focus`/`visibilitychange`), e o
  `key` do anel usa esse número: elemento novo, animação do zero. Em uso normal
  a época **nunca muda** — não é um `setInterval` remontando de tempos em tempos,
  que "resolveria" mascarando e faria o anel saltar pra zero periodicamente
  mesmo com tudo funcionando.
- **Escopo deliberadamente estreito:** os spinners do fio sofreriam da mesma
  causa, e NÃO foram tocados. Um remédio não provado espalhado por toda a UI é
  como se perde a chance de saber se ele funciona. Se o anel da sidebar parar de
  congelar, o mesmo tratamento se justifica no resto — aí com evidência.

### ADR-072 — Review geral: o que eu deixei pela metade e o que eu quebrei ✅
- **Contexto (23/08/2026):** varredura das 8 mudanças do dia (minhas e as do
  segundo dev), pedida antes de promover. Achou dois defeitos MEUS.
- **1. O pip saiu pela metade.** Removi de conversa e projeto (ADR-043 revisada)
  e esqueci as entradas GLOBAIS da sidebar — Frota, Agendamentos, Planos de voo
  — e mais um sítio no `Sidebar`. Quatro pips sobrando. A varredura por classe
  (`left-[5px] size-[3px]`) achou em segundos o que a leitura não achou: quando
  a receita é uma string, procure pela string.
- **2. O `border-color: inherit` da regra do §2.1 estava errado, e foi MEDIDO.**
  Num input com `focus-visible:border-brass`, clicar deixava a borda com a cor
  do PAI — medido: `rgb(255,0,0)` num pai vermelho — em vez da borda normal.
  - **A correção não é ajustar o `inherit`, é não tocar na borda.** A queixa era
    o ANEL. Campo de texto mostrando que está focado é comportamento desktop
    CERTO: você precisa saber onde vai digitar. Regra apaga só o anel agora,
    verificado nos dois eixos (borda correta no mouse E no teclado; anel some no
    mouse, acende no Tab).
  - **A lição é sobre a forma do remédio:** `border-color: inherit` é
    instrumento cego — ele não "restaura", ele impõe o valor do pai. Anular uma
    propriedade sem saber pra QUE valor voltar é como se conserta um sintoma
    criando outro em lugar mais escondido.
- **O que o review CONFIRMOU estar completo:** nenhum `st-running` restante no
  fio (§2.2 aplicada inteira), nenhum anel removido à mão fora do §2.1, e a
  época da janela cobrindo os cinco sítios de animação infinita.

### ADR-073 — Trocar de MODELO no meio é seguro; trocar de MOTOR é handoff ✅
- **Pergunta do usuário (23/08/2026):** *"por que não dá pra trocar o modelo e o
  agent no meio da conversa, só quando falha?"*
- **A razão que existia, e continua valendo pro AGENT:** cada CLI guarda a
  sessão dela por um id próprio e nenhuma retoma a da outra. Trocar de motor não
  é mudar parâmetro, é **handoff** — o `beginTransplant` abre sessão NOVA com
  recap + ponteiro. Um seletor sugere reversibilidade barata; handoff não é
  reversível.
- **A razão que NÃO existia pro MODELO.** Trocar de modelo dentro do mesmo agent
  preserva a sessão: o `--resume` segue valendo, o histórico continua no CLI.
  E é o que Claude Code, Codex e agy permitem no meio da conversa (`/model`) —
  nossa trava era mais rígida que a dos motores que orquestramos. Ela existia só
  por ter nascido colada à do agent, onde a razão é real.
- **O que mudou:** `modelUnlocked` deixou de ser "o último turno falhou" e passou
  a ser `!running && !finalizing`. O caso de emergência virou um SUBCASO de "pode
  trocar quando não está em voo", não uma regra própria. O `!running` fica porque
  o modelo é flag de SPAWN, igual à permissão: vale do próximo envio.
- **E a troca não pode ser MUDA.** `notaDeTrocaDeModelo` põe uma linha no fio
  ("opus → sonnet, vale deste turno em diante"). Sem ela o histórico passaria a
  mentir — a conversa pareceria ter rodado inteira num modelo só — e o custo por
  token mudaria sem aviso. Destravar sem marcar teria criado um problema pior
  que o que resolveu.
- **Verificado que persiste:** o `start` grava `reqModel`, então a escolha vale
  nos turnos seguintes; não é preciso re-escolher a cada envio.
- **Custo estrutural:** `ChatPanel` estourou a catraca; saiu
  `components/chat/autoResumeAgendar.ts`. O `handleSend` entra como PARÂMETRO em
  vez de import — o módulo de retomada não precisa conhecer o composer, e a
  dependência anda no sentido certo.

### ADR-074 — Os três motores auto-compactam; o que faltava era CONTAR ✅
- **Contexto (24/08/2026):** eu tinha escrito um plano com uma fase de "pressão
  preventiva" — o Frota compactaria a conversa antes de estourar, no trabalho
  desassistido. O usuário perguntou: *"mas os code agents sozinhos não fazem
  auto compact?"*
- **Fazem, os três. Medido nos binários:**
  | motor | evidência |
  |---|---|
  | claude-code | `autoCompactEnabled`, default LIGADO (2.1.219) |
  | codex | system prompt "the conversation is automatically summarized for you" + `auto_compact_token_limit` + `ContextCompactionItem` (0.149) |
  | agy | protobuf `CompactionInfo`, `json:"compaction_info"`, prompt `# Resuming from a compaction` (1.1.19) |
- **A fase morreu, e ainda bem.** Ela reimplementaria de fora, com dado PIOR, o
  que o motor faz por dentro: o CLI mede o contexto real; nós temos estimativa
  por catálogo. É o tipo de trabalho que parece progresso.
- **O buraco era outro, e melhor:** só o claude AVISAVA (`compact_boundary`,
  ADR-015). Nos outros dois a conversa perdia detalhe em silêncio, e o usuário só
  descobriria quando o agente "esquecesse" algo. Mesma família do `enforcement`
  antes do sandbox — um motor tem o sinal, os outros não, e a diferença não
  aparece.
- **Entregue:** o `contextCompaction` do codex saiu do `_ => vec![]`; o
  `compaction_info` do agy vira Notice UMA vez por run (o campo acompanha os
  steps seguintes; repetir viraria eco). As duas grafias do campo são aceitas —
  ele vem de protobuf (snake) mas o serializador pode emitir camel, e apostar
  numa só seria apostar na versão.
- **Convergência que vale registrar:** o system prompt do codex instrui o modelo
  que *"you will see all prior user requests"* — exatamente o princípio do G1
  (preservar toda a intenção humana), ao qual cheguei medindo bytes sem saber
  disso. Duas casas na mesma regra por caminhos independentes.
- **A lição de método:** eu ia construir sobre uma premissa não verificada. Uma
  pergunta do usuário — não um teste, não uma guarda — foi o que a derrubou.
  Verificar o que o motor JÁ FAZ tem que vir antes de decidir o que a gente faz.
- **Verificado:** `cargo` 506, `tsc` 0, `vitest` 3112, 8 guardas, e2e 23/23.

### ADR-075 — A máquina sabe, a tela não dizia (duas correções da mesma família) ✅
- **Contexto (24/08/2026):** comparando as telas de Configurações do Orca com as
  nossas, dois fatos que o Frota JÁ APURA não chegavam a quem decide com eles.
- **1. "N instalações no PATH" morava no lugar errado.** O aviso só era calculado
  dentro de `run_update_job` (`update.rs`), a partir de `which_all`. Consequência:
  ele aparecia **depois** de rodar um update pelo app — justamente quando não
  fazia falta — e sumia quando fazia, porque `UpdateJobs` vive em memória e morre
  no reinício. Numa máquina que nunca atualizou pelo app, o fato nunca existia.
  - **Correção:** `bin_path` + `other_paths` entram em `DetectedTool` e são
    preenchidos por `fill_paths` na DETECÇÃO (1×/dia, persistido em `detected`).
    Duas cópias no PATH é fato da MÁQUINA, verdadeiro antes de qualquer update.
  - **A copy também estava errada, e essa era a parte pior:** dizia *"o app
    gerencia X"*. A pergunta de quem lê é *"qual delas roda?"*, e a resposta
    exigia o leitor saber que gerenciar == rodar. Como `bin_path` sai do mesmo
    `command -v` que o spawn (`Command::new("claude")`) e que `resolve_bin`, a
    frase honesta é **"o app usa e atualiza X"**.
  - O caminho agora elide pela CAUDA (`formatDisplayPath`): o `truncate` do CSS
    cortava o fim, que é exatamente o que distingue `/opt/homebrew/...` de
    `~/.nvm/...`. Mesma lição do nome de arquivo no DiffPanel.
- **2. O agent padrão podia não existir.** `Configurações ▸ Novas conversas`
  montava a lista de `DESTINATIONS.filter(d => d.available)`. `available` é flag
  do CATÁLOGO ("não é 'em breve'"), não "existe aqui". Dava pra eleger como
  padrão um agent que a seção **Agentes na máquina**, dois cliques ao lado,
  sabe que não está instalado — e a falha só aparecia no primeiro envio da
  conversa seguinte, longe da causa. Mesma família do ADR-068: a decisão do
  humano descolada da verdade que a decide.
  - **Correção:** `estadoNaMaquina(id, detected)` cruza com o probe. Ausente
    desabilita a opção; e se o padrão JÁ SALVO ficou ausente, o aviso fica
    **fora** do dropdown — dentro, só quem abrisse a lista descobriria, e o
    trigger fechado seguiria exibindo um nome que não roda.
- **O terceiro estado é o que impede o defeito pior.** `estadoNaMaquina` devolve
  `desconhecido`, não `ausente`, quando não há probe. Numa instalação nova o
  mapa `detected` vem VAZIO, e tratar vazio como ausente desabilitaria os três
  agents de uma vez: o app afirmando que nada está instalado justamente antes de
  ter olhado. Ausência de prova não é prova de ausência.
- **A guarda de tamanho mordeu e estava certa:** `SettingsDialog.tsx` foi a 702
  de 700. A regra da casa é DIVIDIR — nasceu `NewChatDefaults.tsx`, e o corte foi
  natural porque essa era a única seção do arquivo com lógica própria.
- **O que NÃO copiamos do Orca, e por quê:** o `Agent Permissions · Yolo|Manual`
  deles é preferência GLOBAL do cliente. É exatamente o bug que o ADR-068
  removeu (permissão do PROJETO chegando no spawn no lugar da da CONVERSA).
  Permissão no Frota é por conversa, decidida no último metro. Não regredir.
- **Verificado:** `cargo` 506, `tsc` 0, `vitest` 3121 (9 novos), 8 guardas.

### ADR-076 — O modal borrado e o modal cortado eram a MESMA linha ✅
- **Contexto (24/08/2026):** o usuário relatou que o modal "Nova automação"
  *"parece que está com um bug de foco... bem embaçado"*. Fui medir a geometria
  num navegador de verdade (e2e), porque suspeita visual não vira diagnóstico.
- **A causa é uma só, e produz dois defeitos diferentes.** O `DialogContent`
  centralizava com `top-50% left-50%` + `translate: -50% -50%`, sem `max-h`:
  | medida (modal aberto, janela 720px) | valor |
  |---|---|
  | altura do dialog | **807,625px** |
  | translate vertical resultante | **-403,8125px** ← fracionário |
  | `top` final | **-43,8125px** ← cortado em cima |
  | `bottom` | além da janela ← cortado embaixo |
  | `scrollHeight > clientHeight` | **false** ← nem rolando alcançava |
- **1. O embaçado:** metade de uma altura ÍMPAR é offset fracionário; o elemento
  é rasterizado fora da grade de pixels e TODO o texto dentro dele borra. Como a
  altura vem do CONTEÚDO, o defeito ia e vinha conforme o formulário — por isso
  parecia intermitente, "bug de foco".
- **2. O corte:** 807px de formulário numa janela de 720px, centrado por
  translate e sem `max-h`, ficava com título e botão de confirmar FORA da vista
  e **sem scroll nenhum** para alcançá-los. Este era o defeito mais grave, e
  ninguém tinha reportado.
- **A pista que o `getComputedStyle` escondia:** `transform` lia **"none"**.
  Tailwind v4 usa a propriedade `translate`, separada de `transform` — quem
  procurasse pelo suspeito óbvio não acharia nada e concluiria que não era isso.
- **Correção:** centralização por FLEX (`wrapper que rola` + `min-h-full
  items-center`). Conteúdo baixo fica centrado; conteúdo alto empurra o wrapper e
  ROLA. Sem translate, sem meio-pixel. O scroll ficou no WRAPPER de propósito:
  `overflow` no próprio Content brigaria com o `overflow-hidden` que as
  Configurações declaram para ter scroll interno próprio.
- **Verificado depois:** `translate: none`, `top: 16` (inteiro), topo não
  cortado, wrapper com `scrollHeight 840 > clientHeight 720` — o que passa do
  fim virou alcançável.
- **Virou e2e (`dialog-centralizado`), não confiança:** a prova é geometria
  medida, porque string de classe passa em teste de unidade e ainda assim pode
  ser anulada por outra regra — e aqui o culpado nem aparecia no lugar óbvio.
- **Verificado:** `tsc` 0, `vitest` 3121, 8 guardas, e2e **25/25** (2 novos).

### ADR-077 — F1: o cartão do GitHub (o diagnóstico existia e morria no Rust) ✅
- **Contexto (24/08/2026):** primeira fase do `telas-de-configuracao-plan`. O app
  já usava o `gh` (cards de PR, checks, merge) e já sabia ler TODAS as contas
  logadas — `run_gh_any_account` tenta cada identidade via
  `gh auth token --user X` e **nunca** troca a conta ativa global do terminal.
  Isso é mais do que o cartão do concorrente sabe fazer, e não aparecia em tela
  nenhuma: `grep GitHub` nas Configurações não devolvia uma linha.
- **O custo já foi pago nesta máquina:** "repository not found" num repo que
  EXISTE, porque a conta ativa era a errada. O app tinha o diagnóstico dentro do
  Rust e não contava.
- **Quatro estados, não dois, porque cada um tem remédio DIFERENTE:**
  | estado | remédio |
  |---|---|
  | `sem-cli` | `brew install gh` |
  | `sem-conta` | `gh auth login` |
  | `sem-ativa` | nenhum: o app ADMITE que não sabe |
  | `ok` | a lista das contas, com a ativa marcada |
  Colapsar `sem-cli` e `sem-conta` num "não conectado" manda o usuário rodar o
  comando errado — é o que um selo booleano faz.
- **`sem-ativa` parece impossível e é o mais importante.** O `gh` sempre marca
  uma ativa; o estado existe pro dia em que o formato mudar sob nós (drift
  silencioso, 5ª ocorrência na casa). Aí a tela diz "não sei qual está ativa"
  em vez de eleger a primeira — chute silencioso reintroduziria o incidente que
  a tela existe pra evitar, agora com a autoridade da interface.
- **Leitura pura, sem efeito colateral:** `gh_status` NUNCA roda `auth login`
  nem `auth switch`. O card mostra e copia o comando; quem executa é o humano,
  num terminal. Mexer na conta ativa global a partir do app é efeito fora do
  nosso quintal, e `run_gh_any_account` existe justamente pra não precisar.
- **Parser único.** `parse_gh_status` virou a única leitura do
  `gh auth status`, e `parse_gh_accounts` passou a derivar dele. Dois leitores
  do mesmo formato foi exatamente como o seletor de modelos do agy apodreceu.
  A fixture do teste é o output REAL desta máquina (duas contas, a 1ª ativa) —
  parser de formato alheio que só vê exemplo sintético passa no teste e falha
  na máquina.
- **`gh auth status` sai com código != 0 quando não há conta logada**, e esse é
  um dos estados que a tela precisa exibir. Por isso a leitura tolera exit code:
  exigir sucesso transformaria "não logado" em "não sei".
- **A guarda de verde mordeu, e metade dela estava certa.** Dois `st-success`:
  o do probe (declarável, `gh --version` e `gh auth status` rodaram de verdade)
  e o de "copiei o comando" — que **virou cinza**, porque cópia de texto é o
  mais ambiente dos estados, nem marco nem probe. O ratchet ganhou entrada de 1,
  com o motivo escrito.
- **Fica para depois (no plano):** conta por PROJETO. Se entrar, entra com
  escopo explícito — projeto sem preferência diz "usando a conta ativa da
  máquina" por escrito, nunca herda em silêncio.
- **Verificado:** `cargo` 510 (4 novos), `tsc` 0, `vitest` 3127 (6 novos),
  8 guardas + os testes da própria guarda (27).

### ADR-078 — "Proposta do lead" sai: um no-op vestido de sucesso ✅
- **Contexto (24/08/2026):** o usuário viu o tipo no dialog de automação e
  perguntou se ele não referenciava uma feature de board que não existe mais.
  Referenciava. Verificado no código:
  - `proposePlan` lê os cards ABERTOS do board;
  - **nenhuma UI cria card** — `createCard` é importado no store e não é
    chamado de lugar nenhum, `BoardLane` não existe mais; só `InboxBell` e
    `DecisionStrip` ainda LEEM cards;
  - e o `scheduleEngine` dizia, por escrito: *"proposePlan devolve null com
    board vazio — a execução rodou bem mesmo assim: status **ok**"*.
- **O defeito não era "feature morta", era pior:** dava pra agendar uma
  automação diária que rodava todo dia, não produzia nada e **registrava
  sucesso**. Um no-op verde é pior que um erro — o erro pelo menos avisa.
- **O jeito preguiçoso de remover seria o desfecho mais perigoso.** Tratar
  `kind` antigo como "agent" faria uma automação que não fazia NADA passar a
  **despachar um agent de código**, com prompt vazio, no horário, sem ninguém
  ter pedido. A linha legada é **desligada uma vez**, com a causa escrita, e
  fica na lista (marcada "tipo removido") até você excluir — some da vista só
  por gesto seu. Cinco testes fixam isso, e o primeiro é o do desfecho perigoso.
- **Some o PRODUTOR, ficam os LEITORES.** `lib/lead.ts` foi removido (único
  chamador de produção era o branch do schedule). Mas `listOpenProposals` segue
  vivo no `inbox.ts`: quem já tem proposta gravada continua vendo na fila
  "Precisam de você". Apagar o leitor faria linhas existentes sumirem em
  silêncio — o oposto da regra da casa.
  - `insertProposal` fica: é o primitivo com que os testes exercitam o caminho
    de LEITURA que ainda roda (ordenação, dismiss, supersede). Remover o writer
    custaria cobertura de comportamento vivo.
- **A coluna `kind` e a tabela `lead_proposals` NÃO são derrubadas.** Migração
  destrutiva sem necessidade; e a linha legada precisa continuar legível pra
  poder ser desligada com a causa.
- **A catraca de tamanho apertou sozinha:** `ScheduledView.tsx` caiu de 1113 pra
  1071, e a baseline desceu junto (`--update`). Ela só aperta — foi a primeira
  vez nesta sessão que ela mordeu na direção boa.
- **Verificado:** `tsc` 0, `vitest` 3124, 8 guardas.

### ADR-079 — F2: o selo do sandbox sai do popover e vira quadro ✅
- **Contexto (24/08/2026):** o S4 entregou o selo de confinamento e ele aparecia
  em UM lugar — dentro do popover do chip de modo, no composer. Não havia tela
  onde você perguntasse *"esta máquina está protegida?"* e recebesse resposta.
  Conceito à frente, superfície atrás.
- **Meu próprio plano estava errado numa frase, e a leitura do código corrigiu.**
  Eu tinha escrito *"parcial: 2 de 3 motores"*. Falso: o selo é da MÁQUINA
  (`disponivel()` = macOS + `sandbox-exec` no disco), e "parcial" é sobre
  ESCOPO — o sistema barra escrita no projeto, não no resto do disco. Motor não
  entra na conta.
- **A informação que ninguém via é POR MODO.** Só `plan`, `leitura` e `fusionRo`
  passam pelo sandbox (`ganhaSelo`); os outros escrevem por definição, então não
  há escrita a barrar. Isso é derivável e não estava em lugar nenhum.
- **O mecanismo veio do Orca, e é o único das seis telas que eu realmente
  invejei:** no `ComputerUsePane` deles o resumo é `total - concedidas` —
  DERIVADO das linhas, nunca um estado à parte. Aqui `resumoDoConfinamento` conta
  as linhas. Não existe caminho em que o topo diga "protegido" e as linhas digam
  o contrário; um teste fixa exatamente essa impossibilidade.
- **`confinado` exige DUAS condições**, e separá-las é o ponto: a máquina ter o
  sandbox E o modo prometer escrita zero. Sem a primeira, um modo que "ganharia
  selo" apareceria confinado numa máquina que não confina nada — a promessa
  falsa que o módulo inteiro existe pra impedir.
- **Os dois "não confinado" têm causas diferentes, e a frase diz qual.** Modo de
  escrita zero em máquina sem sandbox é culpa da máquina; modo que escreve com
  sandbox presente é o desenho funcionando. Um traço mudo faria o leitor concluir
  a causa errada.
- **Traço cinza, não X, no não-confinado.** Vermelho no modo que escreve
  ensinaria o usuário a ignorar vermelho.
- **Seção própria, não bloco em "Agentes na máquina".** Aquela seção responde
  "quais CLIs existem aqui"; esta responde outra pergunta. Enfiar lá repetiria
  o defeito do build 191 que o próprio `sections.ts` documenta.
- **Verificado:** `tsc` 0, `vitest` 3132 (8 novos), 8 guardas.

### ADR-080 — F3: escolher o microfone (e o caso do headset que sumiu) ✅
- **Contexto (24/08/2026):** o `AVAudioEngine` do sidecar sempre abriu o device
  de ENTRADA PADRÃO DO SISTEMA. Não havia como escolher outro dentro do app.
- **A lista real desta máquina mostra por que isso importa mais do que parecia:**
  `BlackHole 2ch`, `Microfone (MacBook Pro)`, `Microsoft Teams Audio`, `Perssua`
  — **três dos quatro são virtuais/loopback**. Se o padrão do SO for um deles, o
  ditado grava silêncio e o usuário não tem pista do porquê. O problema não é
  só "gravei pelo mic errado", é "gravei por um device que não capta voz".
- **Não era um campo, era CoreAudio.** `AVAudioEngine` não expõe seleção: a
  lista vem do HAL (`kAudioHardwarePropertyDevices`, filtrando quem tem canal de
  ENTRADA — sem esse filtro a lista viria cheia de saídas, e escolher uma daria
  um ditado que não grava nada) e a escolha é
  `kAudioOutputUnitProperty_CurrentDevice` na audio unit do `inputNode`.
- **A ORDEM é o detalhe que faz funcionar.** A escolha do device vem ANTES de
  `input.outputFormat(forBus:)`. Aquele formato descreve o device aberto AGORA;
  trocar depois deixaria tap, arquivo da sessão e reconhecedor configurados com
  taxa e canais do microfone errado.
- **Guardamos o UID, nunca o nome.** Nome muda com o idioma do sistema e se
  repete entre dois headsets iguais — a preferência apontaria pro device errado.
- **O caso que decide se ficou honesto é o headset DESCONECTADO.** O sidecar cai
  no padrão do sistema e **avisa**, pelo mesmo canal `warn` da passada de
  arquivo ("nunca substitui o texto, só explica de onde ele veio"). Ficar mudo
  aqui seria a versão áudio da compactação silenciosa: você ditaria pelo mic
  errado sem nunca saber por quê.
  - E a validação NÃO é duplicada no Rust de propósito: quem sabe a verdade é o
    sidecar, no instante em que abre o microfone. Duas regras em dois lugares
    podem discordar.
  - Nas Configurações o device sumido vira opção própria, marcada
    "Microfone desconectado". Sumir com ele faria o seletor exibir "Padrão do
    sistema" enquanto a preferência gravada diz outra coisa.
- **O que NÃO copiamos do Orca:** `Speech Model` (não se aplica — o
  reconhecimento é do sistema, não escolhemos modelo) e
  `Dictation Mode: Toggle|Hold` (o nosso `HotkeyField` já resolve os dois no
  mesmo gesto: toque alterna, segurar é push-to-talk). Um ajuste a menos é
  vitória, não lacuna.
- **A guarda de tamanho mordeu de novo** (`SettingsDialog` 763/700) e o corte foi
  o mesmo critério da 1ª vez: nasceu `DictationSettings.tsx`, a seção que passou
  a ter lógica própria. Na 1ª tentativa eu cortei no `)}` errado e quebrei os
  dois arquivos; refiz com casamento de parênteses.
- **Verificado:** `swiftc` limpo + `--selftest` 10/10, `cargo` 510, `tsc` 0,
  `vitest` 3132, 8 guardas, e2e 25/25.
- **Correção (01/09/2026):** a seleção e o UID permanecem, mas o mecanismo de
  captura deste ADR foi substituído pela ADR-145. O `CurrentDevice` aceito pela
  audio unit não isolava de forma confiável a entrada da saída Bluetooth.

### ADR-081 — F4: segurar o sono, e a trava com relógio de morte próprio ✅
- **Contexto (24/08/2026):** missão de 4 fases às 3h da manhã que morre porque o
  Mac dormiu. É falha que o app pode evitar, e o trabalho perdido não volta —
  o turno já foi pago.
- **`caffeinate -i -w <nosso pid>`, e NÃO uma asserção IOKit.**
  `IOPMAssertionCreateWithName` daria o mesmo sem subprocesso, com um risco que
  esta casa já conhece: a asserção vive no `powerd` e só morre se ALGUÉM lembrar
  de liberá-la. App morto a `kill -9` deixaria o Mac sem dormir para sempre, e o
  usuário não teria como ligar isso ao Frota. Mesma família do processo órfão do
  incidente da carga fantasma. O `-w <pid>` é o **relógio de morte próprio**: o
  `caffeinate` observa o nosso processo e sai sozinho quando ele morre, de
  qualquer jeito que morra. **A trava não pode sobreviver a quem a pediu.**
- **A trava mora no `RunGuard`**, o RAII que já tira o run do registry em TODA
  saída — sucesso, erro, os `?` de early-return e o cancel. Foi o único ponto
  que eu procurei: trava de energia solta só no caminho feliz é trava vazada.
  Por isso o `Despertador` virou campo do `RunRegistry`, e não outra `State`
  para alguém lembrar de atualizar nos mesmos dois pontos.
- **O default é `agent`, e a escolha é discutível o suficiente pra ficar
  escrita.** `on` cobra bateria o tempo todo; `off` deixa o defeito de pé.
  `agent` só segura enquanto há run VIVO — exatamente quando dormir custa um
  turno pago. É a única das três que não cobra nada quando não há trabalho.
- **Valor corrompido cai em `agent`, nunca em `on`.** Gastar bateria do usuário
  é decisão dele, não de um parse que falhou.
- **A preferência é reaplicada no boot.** Ela mora no front (persistida) e quem
  segura é o Rust, que nasce no default a cada abertura: sem reaplicar, quem
  escolheu "Nunca" voltaria a segurar o sono no reinício seguinte sem ter
  mudado nada.
- **Fica na seção "Vigias e automação"**, cuja pergunta é literalmente "o que o
  app faz sozinho enquanto ninguém olha".
- **Honesto sobre o limite:** só impede sono por OCIOSIDADE; fechar a tampa
  continua dormindo, e a copy diz isso. Fora do macOS o spawn falha e a
  preferência fica sem efeito — degradação silenciosa de propósito, porque um
  toast por boot seria ruído sobre algo que ninguém conserta dali.
- **Verificado:** `cargo` 515 (5 novos), `tsc` 0, `vitest` 3132, 8 guardas.

### ADR-082 — Zoom do fio: a aritmética estava certa e a coluna mudava mesmo assim ✅
- **Contexto (24/08/2026):** revisão do trabalho de outro dev sobre o zoom de
  leitura da conversa. O refactor dele separou em duas caixas — a de fora com a
  coluna física de 760px, a de dentro com o `zoom` — e trouxe teste de unidade
  provando `widthPercent * scale === 100`.
- **A aritmética estava certa e a coluna mudava mesmo assim.** Medido no
  navegador com `elementFromPoint` (coordenada VISUAL), pai de 760px:
  | escala | pintado | efeito |
  |---|---|---|
  | 0,8 | **950px** | transborda o pai |
  | 1,0 | 760px | ok |
  | 1,3 | **585px** | coluna encolhe |
  Zoom para LER melhor entregando linha mais curta é o oposto do pedido.
- **A causa:** em Chrome moderno o `zoom` é padronizado, e porcentagem resolve
  contra o bloco contentor **já ajustado pelo zoom do próprio elemento**. Um pai
  de 760px vira contentor de 950px para um filho com `zoom: 0.8`. Logo
  `width: 100%` já pinta 760, e `100 / scale` compensa **duas vezes**.
- **Por que ninguém tinha visto:** a versão de uma div só tinha
  `max-width: 760 / scale`, e era o CLAMP que entregava os 760 — a largura
  percentual já estava errada, e invisível. Mover o teto pra um pai sem zoom
  tirou o clamp de cena e revelou o erro nos dois sentidos. **O refactor não
  introduziu o bug; ele o desenterrou.**
- **A ferramenta de medida era metade do problema.** `getBoundingClientRect`
  responde no espaço SEM zoom: dizia "950" com o elemento ocupando 760 na tela.
  Só `elementFromPoint` varrendo o eixo x responde onde a tinta caiu. Foi por
  isso que o defeito passou por unidade e por revisão.
- **Correção:** `conversationColumnStyle` devolve `width: "100%"` — sem
  compensação. A regra é contraintuitiva o bastante pra ter comentário longo e
  dois testes: o de unidade fixa `width: "100%"` (quebra se alguém reintroduzir
  o inverso) e o e2e mede a tinta.
- **O e2e tem um segundo caso que prova que ele MORDE:** reproduz a versão
  errada e exige que ela falhe. Sem isso, o primeiro teste passaria até se
  alguém removesse o zoom inteiro.
- **Escopo honesto:** o e2e cobre o CONTRATO DE CSS reproduzido, não a fiação do
  componente — o transcript só renderiza com conversa real, e semear isso
  custaria mais do que vale. Quem cobre a fiação é o teste de unidade. Está
  escrito no cabeçalho do arquivo.
- **O resto do trabalho do outro dev entra como está**, e um pedaço dele eu ia
  questionar e estava errado: remover o guard de "conversa visível" do atalho.
  **Com** o guard, ⌘+ numa tela sem conversa vazaria pro WebView e ampliaria o
  chrome inteiro — exatamente o que o desenho recusa. Sem ele, ⌘+ significa a
  mesma coisa em todo lugar. Ele estava certo.
- **Verificado:** `tsc` 0, `vitest` 3133, 8 guardas, e2e **27/27** (2 novos).

### ADR-083 — F6: o rail ganha busca, selo e estado (e a busca não é o ponto) ✅
- **Contexto (24/08/2026):** última fase do `telas-de-configuracao-plan`.
- **Não construímos caixa de busca própria.** O Orca tem uma, com pontuação em
  camadas — e **34 seções**. Nós temos 17: ali busca é necessidade, aqui é
  conforto. As seções viraram destino da paleta `⌘K` que já existe: quase todo
  o valor, sem tela nova e sem uma segunda caixa de busca no app.
- **O valor real é o efeito de SEGUNDA ORDEM.** O campo `busca` é obrigatório
  no tipo, então toda seção precisa **declarar o que tem dentro**. Isso
  transforma a regra editorial "cada seção responde UMA pergunta" em algo
  verificável: seção que não consegue listar o próprio conteúdo é seção que
  virou depósito — foi assim que "CLIs instaladas" acumulou medidor de uso,
  hooks de terminal e curador de modelos (build 191). Dois testes cobrem isso:
  mínimo de 3 palavras por seção, e nenhuma seção com a lista IDÊNTICA à de
  outra.
- **O caso que motivou o campo:** digitar "microfone" tem que achar **Ditado**,
  e "microfone" não aparece em lugar nenhum do rótulo nem da pergunta. Sem
  declaração, a busca só acharia sinônimos do título — inútil.
- **A regra de capability virou uma só.** `secoesDisponiveis()` saiu do dialog
  para o registro, porque agora tem DOIS consumidores. Seção escondida no rail
  e alcançável pela paleta seria um destino fantasma.
- **O `query` entra no `value` do item**, mesmo idioma do grupo de busca no
  histórico logo acima: quem filtrou foi o `casaBusca`, e sem o termo ali o
  filtro PRÓPRIO do cmdk derrubaria o item (ele não conhece as palavras
  declaradas).
- **Selo fora do título.** "Missões (beta)" carregava o estado dentro do nome,
  onde ele não podia ser lido nem estilizado como estado. Virou `badge`.
- **O ponto de atenção, e a regra é a decisão inteira:** atenção é **coisa
  meio-configurada que VOCÊ pode consertar**.
  | fato | ponto? | por quê |
  |---|---|---|
  | CLI instalada e deslogada | **sim** | você instalou, falta terminar |
  | CLI não instalada | não | talvez você não queira aquele motor |
  | `gh` instalado sem conta | **sim** | mesma lógica |
  | `gh` ausente | não | opcional; o resto do app funciona |
  | máquina sem sandbox | **nunca** | não há o que consertar |
  | auth `unknown` | não | não saber ≠ estar quebrado |
  | ainda não olhamos | não | o pior ponto é o que aparece antes de saber |
- **"Ponto que não apaga ensina a ignorar o ponto"** — é por isso que a máquina
  sem sandbox não pinta nada. Um alarme permanente queima o próximo, que
  importa.
- **Verificado:** `tsc` 0, `vitest` 3149 (16 novos), 8 guardas, e2e 27/27,
  `cargo` 515.

### ADR-084 — F5: o cronômetro morre, a reconstrução do cache aparece ✅
- **Contexto (24/08/2026):** última fase do `telas-de-configuracao-plan`. O Orca
  mostra um **cronômetro** até o cache do prompt expirar. O plano dizia, com
  todas as letras, que a fase **começava por medir** — e a medida derrubou o
  cronômetro e achou outra coisa.
- **O cronômetro morre.** O TTL do cache é **configuração do provedor** (5 min
  no padrão da Anthropic, 1h no modo estendido), não algo que a gente observe.
  Um relógio contando um prazo que nós chutamos **pareceria dado e seria
  invenção** — o mesmo erro do `3_000` herdado no orçamento da memória. Segunda
  vez nesta semana que "medir antes" mata uma fase inteira (a 1ª foi o C3).
- **O que a medida achou.** Nos transcripts reais desta máquina:
  | | tokens | % dos tokens de cache |
  |---|---|---|
  | cache **lido** | 5.542.749.751 | 96,5% |
  | cache **reconstruído** | 201.004.177 | **3,5%** |
  Pelo preço relativo (ler ≈ 0,1× o input, reconstruir ≈ 1,25× — doze vezes
  mais por token), a reconstrução é **~31% do custo de cache**. A fatia
  pequena em tokens é a cara em dinheiro.
- **E o recibo mostrava só a leitura.** `cacheCreation` chegava ao front, ficava
  no `usage` do item, e **não era exibido em lugar nenhum**. A parte cara era
  invisível. Mesma família do recibo mudo e do selo escondido: o dado existia e
  ninguém contava.
- **Uma medição minha foi CONFUNDIDA, e vale registrar.** Eu correlacionei
  "gap desde o turno anterior" com custo e vi o custo subir bonito com o gap.
  Só que `created_at` é o FIM do turno, então gap ≈ **duração**, não
  ociosidade: turno longo custa mais por ser longo. A tabela era convincente e
  não provava nada. Descartada.
- **A catraca de tamanho me fez recuar de um erro de escopo, e ela estava
  certa.** Eu tinha começado a persistir a divisão em `turn_costs` (migração 40
  + threading por 4 call sites). A guarda acusou 6 arquivos legados crescendo —
  e o custo real que ela expôs era outro: **eu estava construindo persistência
  para um leitor que não existe.** Não há tela de ledger que consuma a divisão.
  Revertido; fica no plano, para quando houver consumidor.
- **O que entrou:** a linha `+22k reconstruído` no recibo do turno, em âmbar,
  **só quando houve** — linha que aparece sempre ninguém lê. O bloco de tokens
  saiu do `MessageList` para `turnoTokens.tsx`, e o arquivo **encolheu** de 2224
  para 2207 linhas: a catraca apertou junto.
- **Campo ausente ≠ zero.** Item de transcript antigo pode não ter
  `cacheCreation`; ali 0 significa "não mostro nada", nunca "afirmo que foi
  zero". Coberto por teste, junto com valor negativo de motor confuso.
- **Verificado:** `tsc` 0, `vitest` 3153 (4 novos), 8 guardas, e2e 27/27,
  `cargo` 515.

### ADR-085 — Um vocabulário de superfície, e a catraca que faz a migração acontecer ✅
- **Contexto (24/08/2026):** o usuário gostou do padrão do mock de Serviços
  (cartões, separações, agrupamento) e perguntou o que importa: *"daria pra
  estudarmos se o nosso código fonte está bem escrito e componentizado?"*
- **A resposta é NÃO nesta camada, e ela é medível.** Em
  `components/settings`, para dois conceitos:
  | conceito | implementações distintas |
  |---|---|
  | cartão (raio + borda) | **19** |
  | selo / rótulo caixa-alta | **17** |
  Mais fragmentação de raio (`rounded-md`/`-lg`/`-xl`) e de borda (`/50`, `/60`,
  sem opacidade). **46 superfícies escritas à mão em 18 arquivos.**
- **A causa não é desleixo, é lacuna de vocabulário.** `parts.tsx` deu as peças
  de ESTRUTURA (`SectionHeader`, `BlockTitle`, `Field`, `Note`) e nunca as de
  SUPERFÍCIE. Sem lugar onde se ancorar, cada seção inventa a sua — e eu fiz
  exatamente isso hoje, escrevendo o selo do rail duplicando um que já existia
  dois arquivos ao lado.
- **`ui/badge.tsx` existia e NINGUÉM usava.** Um primitivo do shadcn parado
  enquanto 17 selos eram feitos à mão: o default dele (raio de pílula, escala de
  tamanho do Tailwind) não bate com a medida da casa (raio de canto, px do §3).
  Primitivo que não serve não é usado, e não ser usado não o remove.
- **Entrou:** `Card`, `CardHead`, `CardBody`, `Row`, `Selo`, `Consequencia`,
  `TomTexto` em `parts.tsx`.
- **O tom é PROPRIEDADE, não classe solta**, e isso tem consequência de guarda:
  o verde de probe passa a ser declarado UMA vez, no vocabulário, em vez de uma
  exceção por arquivo. `ConfinamentoCard` migrou e a exceção dele **apertou de
  2 para 1** na mesma passada — a guarda de verde chegou a avisar sozinha
  (*"usa 1 de 2 permitidos, aperte o número"*). A conta certa daquele mapa passa
  a ser a SOMA: cada seção que migra desce, e o total cai.
- **A peça que faz a migração acontecer é a CATRACA, não a boa intenção.**
  `check-superficies` congela as 46 e o número **só desce**; arquivo NOVO nasce
  em zero. Proibir de uma vez quebraria 15 seções e ninguém migra 15 seções numa
  tarde — o débito ficaria proibido e portanto ignorado. Mesma mecânica da
  catraca de tamanho, e pelo mesmo motivo.
- **Semear ≠ apertar.** O `--update` recusa subida, mas precisava saber criar a
  baseline na primeira vez; a distinção é explícita (`baseline vazia = nascendo`)
  em vez de um carimbo que aceitaria qualquer crescimento.
- **Provado que morde**, nos dois sentidos que importam: arquivo existente que
  cresce falha, e arquivo NOVO com superfície à mão falha com "limite 0".
- **Escopo é `components/settings` e só.** O fio e o painel têm superfícies com
  outras necessidades; arrastá-los pra cá imporia um vocabulário que não foi
  desenhado pra eles.
- **Verificado:** `tsc` 0, `vitest` 3153, **9 guardas** (a nova entrou na CI),
  e2e 27/27.

### ADR-086 — "GitHub" vira "Serviços", e a tela deixa de só ler ✅
- **Contexto (24/08/2026):** o usuário abriu o build #275 e desmontou a seção em
  duas frases. *"Esse item novo ficou exclusivo no menu GitHub, qual o sentido?
  Se amanhã eu quiser um novo app para integrar?"* e *"não consigo mudar, não
  faço nada? apenas leio?"*. As duas críticas eram certas.
- **Erro 1 — seção por FORNECEDOR.** O rail cresceria um item por vendor. O
  agravante: eu tinha escrito a crítica certa na análise do Orca (eles têm UM
  painel `Integrations` com cartão por provedor) e **construí o contrário**.
  Agora a seção é a PERGUNTA ("quais serviços externos o app usa, e com qual
  conta") e o fornecedor é o CARTÃO. Provedor novo entra do lado, sem item novo.
  - `github` entrou em `LEGACY_SECTION_IDS` → `services`: tray, paleta e estado
    salvo podem carregar o id velho por tempo indeterminado, e id órfão nunca
    vira tela branca.
- **Erro 2 — a tela só lia**, e o argumento que usei para isso não se sustenta.
  Eu escrevi que rodar `gh auth switch` seria "efeito fora do nosso quintal". A
  refutação estava no próprio repo: em *Agentes na máquina* o app **já roda**
  `npm i -g` e `brew upgrade` no clique do usuário. Instalar pacote global é
  muito mais invasivo que trocar de conta. Recusar ali era **incoerência
  disfarçada de princípio**.
  - O cuidado real não é recusar, é **dizer a consequência**: trocar aqui vale
    pro terminal também, porque a conta ativa é do `gh`. A frase fica na tela,
    ao lado do botão, não num tooltip.
  - Duas travas no Rust: forma de login válida (alfanumérico + hífen, ≤39, sem
    hífen nas pontas) **e** a conta precisa já estar logada. Trocar para um nome
    que o `gh` não conhece deixaria o usuário sem conta ativa nenhuma, no
    terminal dele, por causa de um clique aqui.
- **O incidente aconteceu AO VIVO enquanto isto era escrito.** Um `git push`
  falhou com "repository not found" porque a conta ativa havia mudado para a
  errada. Verificado que **não foi o app** (`grep auth switch` no código: zero
  na época). É exatamente o caso que a seção existe pra resolver, e ele apareceu
  15 minutos depois da entrega dela.
- **A guarda de superfícies pegou o MEU arquivo novo**, e ao olhar o que ela
  pegou descobri que **ela estava larga demais**: acusava um `<code>` copiável e
  dois botões. Medido: em `rounded-md` o que existe no repo é CONTROLE (input,
  chip, bloco de código, alerta de uma linha). A régua virou a do §4 — raio
  pequeno é controle, raio grande é superfície — e a baseline caiu de 46 para
  37 na mesma passada. Guarda que pede a coisa errada ensina a ignorar guarda.
- **A escala tipográfica pegou `12.5px` e `11.5px`** que vieram do mock. O mock
  é livre, o código é governado — e é bom que a fronteira tenha sintoma.
- **Verificado:** `cargo` 516 (1 novo), `tsc` 0, `vitest` 3154, **9 guardas**,
  e2e 27/27.

### ADR-087 — Modelos: a tela passa a responder a pergunta do próprio título ✅
- **Contexto (24/08/2026):** o usuário abriu a seção no build #275 e disse *"que
  confusão esse UX, difícil de entender"*. O diagnóstico não é estético.
- **A tela prometia uma coisa e mostrava outra.** O subtítulo dizia *"quais
  modelos entram no seletor dos agents"* e a tela **nunca listava os modelos do
  seletor** — mostrava só EVENTOS (aposentou, entrou sozinho, espera você, não
  passou), em três níveis de hierarquia com três estilos de rótulo. Era o
  **changelog, não o estado**: você abria pra saber o que tem e saía sabendo o
  que mudou.
- **Eu errei o número que sustentava a minha própria recomendação.** Escrevi no
  README dos mocks que eram "9 modelos, cabem sem abas". São **27** (8 Claude
  Code, 7 Codex, 12 Antigravity). Com 27, lista chapada é rolagem — e a
  recomendação caiu junto com o número. Contar antes de recomendar teria custado
  um comando.
- **Também errei o MÉTODO, e o usuário sentiu antes de mim.** Mandei duas telas
  (A e B) e perguntei "qual você prefere?", o que é empurrar a decisão de design
  pra ele. Ele voltou confuso, com razão. Refeito como **um mock só, hoje ×
  proposta lado a lado, com os dados REAIS do banco desta máquina**.
- **Como ficou:**
  1. **Precisam de você** primeiro, único bloco com peso, e **some quando
     vazio** — bloco que aparece sempre ninguém lê.
  2. **No seu seletor · 27** — um cartão por agent, fechado, contagem no
     cabeçalho. Mesmo vocabulário (`Card`/`CardHead`/`Selo`) da seção Serviços.
  3. **A aposentadoria mora na LINHA do modelo**, não num bloco no topo: é ao
     lado do modelo que você usaria que ela muda a decisão. O cabeçalho do
     cartão conta quantas há, pra ver sem abrir.
  4. **Histórico** num `<details>` fechado — "nada some daqui sem motivo
     escrito" continua valendo, agora sem ocupar a tela.
- **A decisão saiu do JSX** pra `lib/seletorDeModelos`, com 10 testes. Três
  regras que erram em silêncio:
  - **casar aposentadoria por `agent` + `value`, nunca só por `value`**:
    `default` existe nos três motores, e casar só pelo id marcaria o `default`
    do Claude como aposentado porque o do Codex está;
  - **só o modelo que entrou por PROPOSTA tem "tirar"**: o da lista curada não
    entrou por decisão sua, e o botão prometeria um gesto que não existe;
  - **`decidedAt` é 0 em linha antiga** e cai no `createdAt` — zero viraria
    "1970" no topo do histórico.
- **A catraca de superfícies apertou sozinha (3 → 1)**, que é exatamente o
  comportamento pelo qual ela existe: a seção migrou e o limite acompanhou.
- **Verificado:** `tsc` 0, `vitest` 3164 (10 novos), 9 guardas, e2e 27/27.

### ADR-088 — Missão concluída travava a conversa: um booleano com nome mentiroso ✅
- **Relato (25/08/2026):** *"tenho uma missão concluída na tela, consigo enviar
  mensagens no composer, porém não consigo ver nada dessas mensagens."*
- **A causa é um nome.** `missionActive` no `ChatPanel` era
  `!!byConv[convId]` — ou seja **"esta conversa TEM uma missão"**, não "a missão
  está ativa". O próprio store documenta que o registro fica em memória depois
  do fim (*"qualquer status: rodando OU timeline visível"*).
- **Por que o sintoma é justamente o pior:** o ENVIO olhava
  `status === "running"` (já `false` numa missão concluída) e liberava o
  composer; o FIO olhava `missionActive` (ainda `true`) e nunca voltava a
  renderizar. Duas perguntas diferentes respondidas por um booleano só, e as
  duas respostas discordando. A mensagem era enviada, gravada, cobrada — e
  invisível.
- **A regra que faltava, agora escrita e testada** (`vistaDaConversa`):
  | pergunta | efeito |
  |---|---|
  | tem missão nesta conversa? | a TIMELINE aparece (registro do episódio) |
  | a missão está RODANDO? | ela TOMA a tela, o fio recua |
  Terminal (`done`/`error`/`aborted`) mantém a timeline **e** devolve o fio: a
  missão virou história, e história não bloqueia conversa.
- **Não duplica o resumo**, e isso foi verificado antes de mudar: no fim normal
  a missão NÃO grava marco de conclusão no fio (o `patchConv({status:"done"})`
  não chama `recordHistory`), então o resumo existe num lugar só — a timeline.
  Era exatamente a preocupação que o comentário original citava para suprimir o
  fio, e ela só valia enquanto a missão rodava.
- **A regressão que a correção NÃO pode reintroduzir** está fixada em teste:
  missão SEM conversa não mostra o "Boa tarde" — o card flutuando sobre a
  timeline foi o defeito que a supressão original veio consertar.
- **O `missionActive` deixou de existir.** Manter o nome corrigido seria
  convidar o próximo leitor ao mesmo erro; quem decide agora é uma função com
  quatro saídas nomeadas.
- **A catraca de tamanho mordeu** (`ChatPanel` 1305 → 1313) e me obrigou a
  enxugar o que eu tinha escrito a mais, inclusive um comentário que descrevia a
  regra ANTIGA da barra de presença. Voltou a 1305.
- **Verificado:** `tsc` 0, `vitest` 3203 (7 novos), 9 guardas, e2e 27/27.

### ADR-089 — Review do motor de grafo v2, e uma perda de dados latente ✅
- **Contexto (25/08/2026):** o outro dev entregou o v2 do motor de missões como
  grafo (23 arquivos + 4 novos). Review pedido pelo usuário antes de commitar.
- **O que estava bom, e vale dizer:**
  - **A projeção visual não contamina o executável.** `missionGraphPresentation`
    deriva terminais de sucesso, rótulos e portas **para a UI**, e o snapshot que
    o motor roda continua com fases, nós e conexões. Separação certa.
  - **As duas guardas que ele tocou foram APERTADAS**, nunca afrouxadas:
    o verde da `MissionTimeline` caiu de 4 → 3 e o da `MissionPlanCanvas` foi
    **removido**; a baseline de tamanho do `store/mission.ts` desceu 1270 → 1264.
  - Ele **resolveu uma TRIAGEM PENDENTE** que estava pendurada na exceção de
    verde desde 15/08 ("o nó tem a mesma forma do stepper que despintamos, e a
    defesa dele merece decisão escrita antes de virar folclore") — removendo o
    nó. Débito conhecido fechado em vez de herdado.
  - O plano (`mission-graph-engine-v2.md`) foi atualizado junto com o código.
- **O defeito que o review achou: `reconcileMissionPresets` destruía a edição do
  usuário, em silêncio.** A função decide se um plano salvo é substituído pela
  versão de fábrica, e a base de comparação era inferida assim:
  ```
  baseRevision = plan.factoryRevision ?? plan.revision ?? 0
  customized   = (plan.revision ?? baseRevision) > baseRevision
  ```
  Num plano **legado** (salvo antes de `factoryRevision` existir) a base saía do
  PRÓPRIO `revision` — então `customized` dava `false` **para qualquer edição**.
  Reproduzido: plano legado editado (`revision: 2`, nome customizado) contra
  fábrica futura (`factoryRevision: 3`) → o nome do usuário virou o da fábrica.
- **Latente, não presente:** com `FACTORY_REVISION = 2` de hoje, um legado
  editado está em `revision ≥ 2` e escapa. O estrago dispara no PRÓXIMO bump.
  É o pior tipo de bug pra achar depois: some do radar até a versão seguinte.
- **A correção é uma linha, e a régua veio do código:** `patchPlan` sobe o
  `revision` em TODA edição, e plano de fábrica legado nasceu em 1. Logo
  `baseRevision = plan.factoryRevision ?? 1`, e `> 1` separa editado de intacto.
- **A trava NÃO podia ser "sem `factoryRevision`, nunca atualiza"**, que era a
  saída fail-closed óbvia: **todos** os planos que existem hoje são legados, e a
  feature inteira não faria nada. Os dois casos viraram teste — o que preserva a
  edição e o que ainda entrega a atualização.
- **Verificado:** `tsc` 0, `vitest` 3205 (2 novos no review), `cargo` 516,
  9 guardas, e2e 27/27.

### ADR-090 — O recibo mostrava o agente falando de si mesmo ✅
- **Contexto (25/08/2026):** auditoria forense de uma missão real, pedida pelo
  usuário. A orquestração estava **correta** — 5 visitas, todas as transições
  legais pelo grafo, o ciclo de revisão disparou e convergiu em 1 volta, e os
  custos das fases somam EXATAMENTE o `costTotal` (5,231816275).
- **O furo estava no que a tela conta.** Os 5 handoffs declararam 20 arquivos.
  O worktree tinha **três mudanças que nenhum deles citou**:
  | não declarado | o que era |
  |---|---|
  | `landing/package.json` + `bun.lock` | **`playwright ^1.62.1`**, dependência NOVA |
  | `landing/screenshots_v2/` | **3,8 MB** de PNG |
  E o revisor final escreveu *"não há mais nada bloqueante encontrado nesta
  revisão"* com tudo isso ao lado.
- **A entrega já estava certa**, e vale separar: `recordDelivery` usa o diff do
  git como fonte PRIMÁRIA e só cai no `files_touched` como fallback. O registro
  durável nunca mentiu. Quem lia a versão auto-declarada era o HUMANO, na tela.
- **`files_touched` é o agente falando de si mesmo.** A missão roda dentro de um
  worktree git: a verdade estava a um `git status` de distância e o recibo não
  perguntava.
- **A regra é "silêncio", não "acusação".** Instalar dependência e gerar
  artefato são efeitos colaterais honestos de fazer o trabalho — o defeito é
  ninguém contar. Por isso o rótulo é **"mudou sem constar"**, e por isso:
  - diff ausente (não perguntei ainda, ou não é repo) → lista **vazia**, nunca
    "você escondeu". Não saber jamais vira acusação.
  - `.mycockpit/` fica fora: o handoff da própria fase mora ali e apareceria em
    TODA missão. Aviso que aparece sempre ensina a ignorar o aviso.
- **Achados menores da mesma auditoria:** o aviso de abertura promete
  "N fases" usando a contagem de NÓS, e o grafo com ciclo rodou 5 visitas sobre
  4 nós; e não existe `startedAt` por fase no run-state (só `endedAt`), então as
  durações exibidas incluem o tempo ocioso entre fases. Nenhum dos dois foi
  corrigido aqui — ficam anotados.
- **Confirmado pelo ledger, de quebra:** a 6ª linha de `turn_costs` da conversa
  (US$ 0,5695, no dia seguinte) é o turno que o usuário mandou depois da missão
  e não viu. Recibo do defeito do ADR-088.
- **Verificado:** `tsc` 0, `vitest` 3213 (8 novos), 9 guardas.

### ADR-091 — O UI-first ganha olho: critérios de UI no preset, não persona nova ✅
- **Contexto (25/08/2026):** o usuário rodou uma missão de landing page e a v2
  saiu pior que a v1. A auditoria achou onde, e não foi no plano.
- **O plano estava CERTO.** O `planner` decidiu, com todas as letras, *"grande
  prova visual do produto"* e *"o revezamento visível é a assinatura da v2"* —
  61% do custo da missão (US$ 3,21 de 5,23) foi pensar, e pensou bem.
- **A entrega violou a decisão central do próprio plano e passou.** Medido
  abrindo as duas no navegador: a v1 tem duas colunas com um mock rico do
  produto funcionando; a v2 é coluna única centralizada **sem nenhuma imagem de
  produto na dobra**. E a headline da v1 (*"Troque o agente. Não recomece o
  trabalho."*) foi rebaixada a caixa de citação decorativa na v2 — o melhor
  ativo da página virou enfeite.
- **Por que passou:** os critérios que os dois revisores REGISTRARAM no handoff
  foram, literalmente, `bun run lint`, `bun run build`, `git diff --check` e
  vazamento de dados reais. **Ninguém abriu a página.** O gate tinha um
  compilador, não um olho.
- **A raiz está na persona**, e ela é honesta sobre o que é: *"rode `git diff`
  para ver o CÓDIGO real"*. Num fluxo de UI isso é metade do trabalho, e a
  outra metade não estava escrita em lugar nenhum.
- **Não criamos preset novo nem persona nova** (pedido explícito do usuário). O
  mecanismo já existia e estava vazio: `instructions` e `exitCriteria` POR FASE,
  que o `buildPhasePrompt` já injeta em "## Instruções desta fase" e
  "## Critérios de saída". O `ui-first` passou a preenchê-los:
  | fase | o que passou a exigir |
  |---|---|
  | Planejar | a versão atual é RÉGUA; nomear o que não pode piorar |
  | Executar UI | prova visual na dobra; a promessa é headline, não citação |
  | Revisar | ABRIR o resultado, comparar lado a lado, julgar contra as DECISÕES |
- **Por que no preset e não na persona:** "suba o servidor e compare a dobra" é
  instrução de fluxo de UI, não de revisão em geral. Na persona ela viraria
  ruído em toda missão de backend. Aqui é o lugar certo, não um meio-termo.
- **Os testes fixam a REGRA, nunca a redação** (texto é copy e muda): existe
  critério falando de dobra, o revisor é mandado abrir, a versão anterior
  aparece como régua, e nenhum critério é rótulo de uma palavra.
- **Efeito colateral do bump para `FACTORY_REVISION = 3`:** um teste do outro
  dev fixava `expect(revision).toBe(2)`, o literal do dia. Passou a DERIVAR do
  plano de fábrica — amarrar teste a um número que sobe por desenho é quebrá-lo
  por motivo nenhum.
- **O preset SALVO do usuário não recebe isto, e está correto:** o `ui-first`
  dele é customizado (planner trocado para `codex/gpt-5.6-sol` em `effort: max`)
  e a proteção do ADR-089 o preserva. É literalmente o plano que aquela correção
  salvou de ser sobrescrito, um dia antes.
- **Verificado:** `tsc` 0, `vitest` 3219 (6 novos), 9 guardas.

### ADR-092 — O botão Enviar nunca funcionou; o Enter escondeu isso ✅
- **Relato (25/08/2026):** *"montei um prompt grande com 5 imagens e não consigo
  enviar, clico no botão e nada acontece"* — e a frase que resolveu o caso veio
  logo depois: **"funcionou com o enter, mas o botão direto não"**.
- **Não era limite.** O usuário perguntou se havia teto de caracteres. Não há
  limite de texto no composer; o de anexos é 8 por mensagem e 10 MB por arquivo,
  ambos com toast quando estouram. Cinco imagens passam folgado.
- **A causa é uma assinatura que dois call sites leem diferente:**
  ```ts
  function submit(overrideText?: string) {
    const text = (overrideText ?? value).trim()
  ```
  O Enter chama `submit(textoDoEditor)` — string, funciona. O botão é
  `onClick={onSubmit}`, e aí **o React passa o MouseEvent como 1º argumento**. O
  `??` só cai no fallback em `null`/`undefined`, e evento é truthy: `.trim()`
  num MouseEvent lança `TypeError`, o handler do React engole, e o clique não
  faz nada. **Silenciosamente.**
- **Dois call sites, não um:** o botão primário e o item "Enviar" do dropdown
  ao lado dele. Os dois passavam evento.
- **Quebrado desde o ADR-051**, quando `onSubmit={submit}` entrou na linha de
  execução. Ninguém viu por um motivo que vale registrar: **Enter é o gesto
  natural de quem digita**, e o botão só é procurado quando o prompt fica grande
  demais pra confiar na tecla. O caminho menos usado escondeu o defeito por
  semanas.
- **A correção não é `() => submit()` no call site.** Isso conserta os dois de
  hoje e deixa o próximo cair no mesmo buraco. `submit` passou a aceitar
  `unknown` e delegar para `textoDoEnvio(override, value)`, cuja regra é: **só
  string vence o valor do composer**; evento, número, array ou `undefined` caem
  no `value`, e nada lança. O call site deixa de precisar lembrar.
- **String VAZIA é escolha, não ausência:** o editor mandar `""` significa "não
  há texto" e não pode ressuscitar um `value` que o composer ainda não limpou.
  Coberto por teste, junto com os tipos-lixo.
- **O que este defeito ensina sobre a suíte:** o harness do composer é SSR
  (`renderToStaticMarkup`), então ele confere MARCAÇÃO — que o botão acende e
  apaga — e nunca CLIQUE. Um botão que renderiza certo e não funciona passa
  inteiro por ele. A proteção aqui é estrutural (a função pura), não o teste de
  componente que a bancada não consegue escrever.
- **Verificado:** `tsc` 0, `vitest` 3225 (6 novos), 9 guardas.

### ADR-093 — MCP do Codex: comando relativo resolvido, e a costura pra testar ✅
- **Contexto (25/08/2026):** o outro dev entregou a descoberta de MCP do Codex
  resolvendo comando RELATIVO contra `$CODEX_HOME` (ou `~/.codex`) e expandindo
  `~`, `$HOME` e `${HOME}` em comando, args e cwd antes da sonda.
- **O problema real que isso resolve:** o `codex mcp list` devolve entradas com
  `command: "./run.sh"` e `cwd: "."`. Sondar isso a partir do diretório do
  PROJETO não acha binário nenhum, e o servidor aparecia indisponível sem motivo
  visível. Agora o caminho é resolvido contra a casa do Codex, e o `cwd` só é
  reescrito quando o usuário não escolheu um absoluto.
- **A revisão achou um buraco de cobertura, não um defeito.** `expand_home_path`
  veio com teste; `normalize_codex_launch` **não** — e é ela que REESCREVE o
  caminho do comando que vai ser executado.
- **A saída não foi mexer em variável de ambiente no teste.** A casa já tem esse
  padrão (`adapters.rs` salva/seta/restaura `CODEX_HOME`), mas teste que faz
  `set_var` divide processo com os outros na mesma pool e vira flake por
  construção. Abri uma costura: `normalize_codex_launch_in(codex_home, …)` com o
  HOME injetado, e o wrapper que lê o ambiente ficou de uma linha.
- **Os quatro casos que passaram a ter teste são os que erram calado:**
  | caso | o que se protege |
  |---|---|
  | relativo com arquivo na pasta do servidor | vira absoluto **e** o `cwd` acompanha |
  | comando ABSOLUTO | não é tocado: caminho explícito é decisão do usuário |
  | `npx` (não existe na casa do Codex) | fica como está — reescrever trocaria "funciona" por "command not found" |
  | `cwd` absoluto escolhido pelo usuário | preservado, mesmo com o comando resolvido |
- **Verificado:** `cargo` 522 (4 novos), `tsc` 0, `vitest` 3225, 9 guardas.

### ADR-094 — F1 do OpenCode: o motor aparece, e o plano errou duas vezes ✅
- **Contexto (25/08/2026):** primeira fase do `opencode-openrouter-plan`. A
  fase 0 mediu o binário instalado (1.17.9) e a documentação; esta entrega o
  reconhecimento na máquina.
- **Entregue:** `probe_opencode` no `detect.rs` e a linha em "Agentes na
  máquina", com versão e **quais provedores** estão conectados.
- **A auth do OpenCode não é booleana, e isso é o ponto.** Ele é um
  MULTIPLICADOR de credencial: faz OAuth com Copilot, SuperGrok, GitLab Duo,
  OpenAI e Anthropic. O que importa não é "logado sim/não", é QUANTOS provedores
  existem — é isso que decide quantos modelos o seletor terá. Zero credencial =
  instalado e inútil, e isso é `missing`, nunca `ok`.
  - Medido nesta máquina: **3 credenciais** (`OpenAI` oauth, `Google` oauth,
    `OpenCode Go` api) e **88 modelos**, que o Frota não enxergava.
  - O parser lê as LINHAS, não o rodapé "3 credentials": contar o que se leu é
    o que permite dizer QUAIS, não só quantos. E o corte nome/tipo é pela
    ÚLTIMA palavra — "OpenCode Go api" partido pela primeira daria nome
    "OpenCode" e tipo "Go api".
- **O plano estava errado em duas frases, e a SUÍTE foi quem apontou.**
  1. Ele mandava ligar `available: true` com as capabilities medidas — e a
     própria seção "o que NÃO fazer" do mesmo documento proibia isso. Liguei, e
     **22 testes quebraram**. O motivo é bom: `opencode` era o fixture de "motor
     do registry SEM capacidade nenhuma", e o código distingue isso de "motor
     FORA do registry, não sei o que ele reporta". São duas frases diferentes e
     as duas honestas.
     - A lição que fica: **flag do registro significa "o APP conta com isso"**,
       não "o fornecedor suporta". O CLI faz muito mais; o app ainda não usa.
  2. Ele pedia detectar o banco quebrado já no F1. Toda forma barata disso passa
     por fuçar o schema PRIVADO do opencode (`replacement_seq`), que muda quando
     eles quiserem. Medido: `db "SELECT 1"`, `stats` (469 sessões) e `models`
     passam; só o `run` falha. Foi pro F2, onde o erro existe e pode ser
     classificado — mesma disciplina do `sandbox.rs`.
- **Tentei trocar o fixture por um id falso e voltei atrás.** Um `agentDef`
  inexistente cai em "fora do registry", que é outra mensagem. O fixture PRECISA
  ser um motor do registry com tudo zerado — e `opencode` volta a sê-lo
  enquanto o adapter não existe. Reverti os 9 arquivos de teste.
- **A catraca de tamanho custou o comentário** que eu queria deixar no registro
  (`agents.ts` já está acima do teto, congelado em 533). O porquê vive no plano;
  o código fica com o dado.
- **Verificado:** `cargo` 527 (5 novos), `tsc` 0, `vitest` 3225, 9 guardas.

### ADR-095 — F2: o adapter do OpenCode, e o que a suíte cobrou ✅
- **Contexto (26/08/2026):** segunda fase do `opencode-openrouter-plan`. O motor
  passa a RODAR: `OpenCodeAdapter` + a linha no `SPECS`, e `available: true`.
- **Medi o stream real antes de escrever uma linha de mapeamento**, e o binário
  desta máquina não coopera: `opencode run` falha com o banco fora de sincronia.
  A saída foi um `XDG_DATA_HOME` isolado com o `auth.json` **por symlink** —
  banco novo migra limpo, e nenhuma credencial foi copiada pra lugar nenhum.
- **O stream é NDJSON, exatamente o transporte que o loop já lê:**
  `{type, timestamp, sessionID, part}`, com `step_start`, `text`, `step_finish`
  e `error`.
- **Três medidas que decidiram o mapeamento, e as três erram calado:**
  | medida | consequência |
  |---|---|
  | `total = input + cache.read + output + reasoning` (5499+36220+1+212 = 41932) | **`input` EXCLUI o cache** — convenção do agy, não do claude. O mapeamento soma, senão o ledger subestimaria o turno em 36k tokens |
  | dois turnos com `--continue`: `input` 5499 e 5515, custos independentes | **NÃO é cumulativo**. Sem baseline, sem a maquinaria do ADR-033 |
  | `opencode run` falhou com **exit code 0** | o desfecho vem do EVENTO `error`, nunca do processo. Se o `ok` viesse do exit, a falha passaria por sucesso com texto vazio |
- **`cache.write` chega preenchido**, e nenhum outro motor entrega isso: é o
  campo que alimenta o "+N reconstruído" do ADR-084.
- **A suíte cobrou o roster em SEIS lugares**, e cada cobrança era uma guarda
  fazendo o trabalho dela: matriz de anexo, matriz de canais, registry do Rust,
  roster do Companion (2×) e o recibo de missão. "Agent novo não passa batido"
  é literalmente o nome de uma delas.
- **O fixture de "motor sem capacidade" mudou de dono.** Onze arquivos de teste
  usavam `opencode` como espécime de motor zerado — o que sempre foi frágil:
  quebrou no dia em que ele virou produto. Passou a ser `model` ("Modelo
  direto"), que é placeholder de OUTRO conceito e continua zerado por desenho.
  - Tentei um id inventado e não serve: `agentDef` inexistente cai em "motor
    FORA do registry, não sei o que ele reporta", que é outra frase — e as duas
    são honestas, por isso o código as separa.
- **O que ficou `false` de propósito:** `caps.image` (o `-f` aceita arquivo, mas
  ida-e-volta de imagem não foi medida, e chip que promete e é descartado no
  spawn é o estrago que a matriz gêmea existe pra impedir) e `native_compact`
  (a doc anuncia o evento; o stream do `run` não foi visto emitindo).
- **Verificado:** `cargo` 533 (7 novos), `tsc` 0, `vitest` 3228, 9 guardas.

### ADR-096 — F4: a lista viva do OpenCode, e o OpenRouter por dentro ✅
- **Contexto (26/08/2026):** o pedido do usuário tinha duas metades — "aproveitar
  outras assinaturas" e "suporte ao OpenRouter". Esta fase entrega as duas com
  um mecanismo só.
- **O OpenRouter entra POR DENTRO do OpenCode, e essa é a decisão que economiza
  um subsistema.** O caminho ingênuo seria um cliente HTTP nosso, com chave,
  catálogo, preço e classificação de erro próprios. O OpenCode já fala
  OpenRouter (BYOK), então para o Frota **OpenRouter é um provedor do
  OpenCode**: mesma sonda, mesmo adapter, mesmo ledger. Um provedor a mais custa
  um `providers login`; um cliente novo custaria um subsistema.
  - O parser preserva isso por construção: `openrouter/anthropic/claude-4` corta
    na PRIMEIRA barra, então o `id` fica inteiro (é o que o `-m` aceita) e o
    rótulo mantém `anthropic/claude-4`. Coberto por teste.
- **`opencode models` virou fonte viva** (`OpenCodeModelsSubcommand`). Vale mais
  aqui que no agy: a lista depende de QUAIS credenciais existem, e isso muda sem
  o app saber — conectar o OpenRouter faz modelos aparecerem sem tocar em código.
  Lista vazia NÃO apaga a curada: sem provedor conectado o CLI devolve pouco, e
  zerar o seletor seria pior que a lista de casa.
- **A guarda "quem lista modelos precisa saber testá-los" mordeu, e estava
  certa.** Eu tinha ligado a listagem sem o dialeto de fumaça: o curador
  passaria a ver 88 modelos e não conseguiria verificar nenhum antes de
  oferecer.
- **O dialeto de fumaça precisou dos DOIS fluxos, e isso foi medido:**
  | sinal | onde sai | veredito |
  |---|---|---|
  | `step_finish` | stdout (NDJSON) | ok |
  | `Insufficient balance` (401) | stdout | **unreachable** — o slug existe, quem recusou foi o provedor |
  | `ProviderModelNotFoundError` | **stderr**, com stdout VAZIO | unknown-slug |
  O `run_capture` da casa só olha stderr quando o stdout está vazio e devolve
  `Unreachable`; com ele, "modelo que não existe" viraria "não sei" — que é
  justamente a pergunta que o curador faz. Por isso `smoke_opencode` tem captura
  própria.
  - As três frases foram CAPTURADAS na máquina, nenhuma inventada (ADR-016).
- **O cartão de Serviços ganhou o OpenCode**, e ali ele não é motor: é
  credencial. Lê o probe que a detecção já faz (nenhum comando novo) e mostra os
  provedores conectados, com o caminho pra somar outro. Como no `gh auth login`,
  o app MOSTRA o comando e não conduz o fluxo.
- **A guarda de travessão pegou um caso que ela mesma documenta:** o carve-out de
  `console.*` não alcança chamada quebrada em várias linhas com interpolação. A
  linha voltou a caber numa só, igual à do agy.
- **Verificado:** `cargo` 542 (9 novos), `tsc` 0, `vitest` 3228, 9 guardas.

### ADR-097 — F5: "outro agent" parou de significar "outra cota" ✅
- **Contexto (26/08/2026):** o usuário pediu para rever o aviso de limite "agora
  que teremos um novo candidato". A revisão achou que o 4º motor não só
  acrescenta uma saída — ele **quebra a premissa** do card de recuperação.
- **A premissa antiga era verdadeira por construção:** cada motor tinha um dono
  de cota (claude→anthropic, codex→openai, agy→google), então "escolha outro
  agent" ERA "escolha outra cota". O card podia dizer isso e estar certo.
- **O OpenCode quebra isso, e para melhor:** ele alcança vários provedores, e
  alguns são os MESMOS que os outros motores usam. `opencode` com modelo
  `openai/*` consome a assinatura do ChatGPT — **a mesma do Codex**. Trocar de
  um pro outro num rate limit manda o usuário bater na mesma porta, e o app
  teria oferecido isso de cara limpa.
- **A pergunta certa deixou de ser "qual agent?" e passou a ser "qual PROVEDOR
  paga?"** (`provedorDaCota`). No OpenCode a resposta vem do dialeto
  `provider/model`, não do motor.
- **O que a função NÃO sabe, e admite:** OpenCode sem modelo escolhido devolve
  `null` (quem decide é o config dele); e dois provedores distintos podem cobrar
  da mesma conta num BYOK, o que ninguém tem como ver daqui. Por isso
  `competemPelaMesmaCota` devolve `false` quando não sabe — **bloquear por
  ignorância deixaria o usuário sem saída num limite que talvez nem existisse do
  outro lado**.
- **O `opencode-go` é a primeira cota realmente separada** do roster: não divide
  com nenhum dos três. Coberto por teste, um por motor.
- **`usageWindow: null` foi CONFIRMADO por medida, não por preguiça.**
  `opencode stats` devolve histórico (US$ 111,50 em 198 dias, 471 sessões), não
  janela: sem cota, sem reset, sem percentual. Não há barra a mostrar. Era
  exatamente o "prometer barra sem medir" que o plano proibia.
- **`recoveryMessage` mudou de arquivo, e a catraca foi quem forçou o desenho
  certo:** `lib/mission.ts` está congelado acima do teto, então a função foi
  morar em `lib/cotaDoTurno`, junto da regra de que ela passou a depender. O
  `mission.ts` ENCOLHEU de 546 pra 537 e a baseline apertou junto.
- **O logo do OpenCode entrou** com a geometria do `opencode.ai/favicon.svg`
  adaptada a `currentColor`, seguindo a regra escrita no próprio `AgentLogo`:
  logo do PRODUTO, vendorizado, monocromático obedece ao tema. Sem ele o motor
  ficaria fora da trilha do composer, que filtra por quem tem logo — disponível
  e invisível.
- **Verificado:** `cargo` 542, `tsc` 0, `vitest` 3238 (10 novos), 9 guardas,
  e2e 27/27.

### ADR-098 — F3 parou no contrato, e o motivo foi medido ⏸
- **Contexto (26/08/2026):** F3 é o canal de permissão do OpenCode via
  `opencode serve` + SSE. O contrato foi lido inteiro do `/doc` do binário
  1.17.9 e está no plano (evento, corpo da resposta, endpoint, ruleset).
- **O plano dizia que o `serve` estava são, e não estava.** A seção F0 afirmava
  *"`opencode run` falha; `opencode serve` sobe normal e responde"* — e era
  ESSA frase que elegia o serve como transporte primário. Medido: o prompt do
  serve bate no MESMO `no such column: replacement_seq`
  (`createUserMessage → requestReplacement`, HTTP 500). O serve responde
  metadado (cria sessão, lista modelo, serve o `/doc`); ele não roda turno.
  Não são dois transportes, um são e um doente — é um banco doente sob os dois.
- **Não dá pra fechar o round-trip nesta máquina, e a tenaz tem dois lados:**
  com o data dir do usuário há credencial e o banco quebra; com data dir limpo
  o schema nasce são e `providers list` devolve **0 credentials**, então todo
  `-m` vira `Model not found` e não há turno. Juntar as metades exigiria copiar
  o `auth.json` dele pro meu diretório de teste — credencial não se move por
  conveniência de teste, e o plano já proibia tocar no `~/.local/share/opencode/`.
- **Terceiro achado, que muda o desenho:** o agente padrão vem com
  `permission: "*" → allow`. O canal existe e fica **MUDO** — nenhum
  `permission.v2.asked` sai sem alguém instalar regra `ask`. Logo "o OpenCode
  pergunta" não é fato herdado do CLI: é decisão de produto do Frota, que teria
  de mandar o ruleset ao criar a sessão. Ninguém tomou essa decisão ainda.
- **Por que parar é a escolha certa:** escrever o transporte agora é código
  contra contrato só LIDO. Esta sessão inverteu a leitura por medida três
  vezes (o `run` saindo 0 em falha, o token que não era cumulativo, o `input`
  que excluía cache). O que ficou registrado no plano é reaproveitável
  integralmente; o que falta é um banco são na máquina, e o reparo é gesto do
  usuário — apagar o `opencode.db` leva as sessões dele junto.
- **O que JÁ funciona sem o F3:** o OpenCode roda pelo `run --format json`
  (F2), com custo e cache separados, e o `--dangerously-skip-permissions`
  cobre o modo liberado. O que falta é o modo que PERGUNTA.

### ADR-099 — a máquina destravou, e o `run` revelou que MENTE sobre a recusa ✅
- **Contexto (26/08/2026):** com autorização do usuário, o opencode foi
  reinstalado. Binário 1.17.9 → **1.18.21**, plugin `oh-my-openagent` fora do
  config, `opencode.db` **movido** (não apagado) pra `opencode.db.quebrado-20260826`.
  O `auth.json` ficou intocado e as três credenciais seguem lá. O banco velho
  tinha a última migração de 07/06/2026: quase três meses sem migrar, e o
  binário novo não migra sozinho.
- **O F2 está validado de ponta a ponta:** turno real devolveu
  `text: "oi-frota"` e `cost: 0.000942`. O adapter que enviamos funciona.
- **A medição inverteu o desenho do F3.** A pergunta certa não era "como falar
  com o `serve`", era "o `run` já não resolve?". Com
  `{"permission":{"bash":"ask"}}` no projeto, o CLI respondeu:
  `! permission requested: bash (echo oi-frota); auto-rejecting`.
- **O `opencode run` não pergunta: ele AUTO-REJEITA**, e faz duas coisas piores
  que falhar. (1) O aviso sai no **stderr como texto humano com ANSI**, não como
  evento no stream JSON: quem lê o stdout estruturado não vê nada. (2) O turno
  grava `"The user rejected permission to use this specific tool call."`,
  **atribuindo ao humano uma recusa que a máquina tomou sozinha**.
- **O defeito que isso expôs no NOSSO código:** o `tool_use` caía no
  `_ => vazio` do `map_line`. Nenhum evento nascia, nenhum erro era marcado, e o
  `on_close` reportava `ok:true` sobre um turno com TODA ferramenta barrada.
  Sucesso falso, e por cima com a mentira do fornecedor no registro.
- **O conserto separa as duas coisas:** `rejeicao_sem_pergunta(bypass, status,
  erro)` só reescreve quando o bypass NÃO foi passado. Com
  `--dangerously-skip-permissions` ligado, uma recusa que chegue veio de regra
  do próprio opencode e a frase dele fica de pé. Guarda dos dois lados, um teste
  para cada, mais um terceiro provando que ferramenta bem-sucedida segue muda.
  Os dois caminhos foram medidos no binário real (com bypass:
  `status: completed`, `output: oi-frota`).
- **Isso confirma a arquitetura do plano por outro motivo:** o `serve` É
  necessário pro modo que pergunta, mas não porque o `run` esteja doente, e sim
  porque ele é **estruturalmente incapaz** de ter canal de permissão.
- **`brew install sst/tap/opencode` não existe.** Estava no `INSTALL_COMMANDS`,
  veio do repositório do fornecedor e nunca foi rodado: `brew info` devolve
  "No available formula or cask". Receita que ninguém executou é chute com cara
  de fato. Corrigido pro `homebrew/core` (`brew install opencode`).
- **Verificado:** `cargo` 545 (3 novos), `tsc` 0, `vitest` 3238, 9 guardas.

### ADR-100 — o login do MCP mentia dos DOIS lados ✅
- **Contexto (26/08/2026):** o usuário perguntou por que não conseguia ligar o
  `prime-mcp` no Antigravity. Fez o login do Frota, os TRÊS motores viraram
  "roteado pelo Frota"… e nenhum interruptor destravou.
- **O rótulo sabia do login; o interruptor, não.** `mcpAgentStatusLabel` recebia
  `autenticadoPeloApp` e dizia "roteado pelo Frota"; o `Switch` ao lado lia
  `disabled={!state.compatible}`, e `compatible` num MCP OAuth é **sempre
  false** por construção. A tela afirmava uma coisa e o controle vizinho fazia
  outra. Pior: se o interruptor fosse liberado, o binding morreria no backend,
  que também só olhava `compatible`.
- **A regra já existia, escrita em dois lugares com respostas diferentes.** O
  planejador do run usava `roteavel_por_proxy` (transporte HTTP, bloco OAuth,
  sem segredo literal, credencial no Keychain, capability `managed_mcp`); os
  portões do binding e o estado que chega na UI usavam só a via nativa. Agora
  há `utilizavel_por` = nativo **ou** proxy, nos três portões.
- **A segunda mentira era no sentido oposto, e é a da pergunta:** o rótulo
  prometia "roteado pelo Frota" **também pro Agy**, que não roteia MCP
  gerenciado de jeito nenhum. Não é falta de login: `AGY_CAPS.managed_mcp` é
  `false` porque o CLI configura MCP por arquivo **global**, sem flag por-run
  (documentado no próprio AGY_CAPS). Nenhum login conserta, e o app dizia que
  sim.
- **O conserto tira a regra do front.** `roteavelPeloApp` passa a vir do
  backend, por (servidor × agent), e vira o **único** gate da linha: rótulo,
  interruptor e botão de testar saem do MESMO fato. A regra que morava no front
  era mais grosseira (olhava só `nativeReason === "oauth"` + login) e por isso
  prometia SSE e segredo literal que o proxy recusa.
- **O campo é opcional no TS de propósito:** snapshot serializado antes desta
  versão não o tem, e ausência precisa significar "não sei, não libera", nunca
  `true` por descuido. Tem teste só pra isso.
- **Efeito na tela:** Claude e Codex destravam de verdade; o Agy volta a dizer
  "sem roteamento (nativo do CLI)", que é a verdade.
- **Verificado:** `cargo` 546, `tsc` 0, `vitest` 3241, 9 guardas.

### ADR-101 — "não suportado" era falso, e quem desmentiu foi o próprio agy ✅
- **Contexto (26/08/2026):** o usuário perguntou ao agy se ele tinha suporte a
  MCP. Resposta do CLI: *"Sim, o Antigravity tem suporte completo a MCP, tanto
  para servidores locais (Stdio) quanto remotos"*, e o motivo de não ter usado
  era só o `mcp_config.json` estar vazio. **O CLI está certo e o Frota estava
  escrevendo "não suportado" na tela.**
- **Medido no binário, não na conversa** (agy **1.1.21**, nossa evidência
  documentava a 1.1.13): existe `agy mcp add|remove|list|enable|disable`, com
  `--type stdio|http`, `--header` e `--env`. O `mcp_config.json` do usuário
  está vazio (0 bytes) e `agy mcp list` diz "No MCP servers configured",
  batendo com a resposta do CLI.
- **O que NÃO mudou, e é o que decide a capability:** `agy mcp add` não tem
  flag de escopo, então escreve no config GLOBAL, e o `agy --help` da 1.1.21
  segue sem opção de MCP por-run. Testado também config por PROJETO
  (`.gemini/config/mcp_config.json` no cwd): **ignorado**. Logo
  `managed_mcp: false` continua CORRETO; o que estava velho era a evidência.
- **A distinção que faltava, e que a copy atropelava:** `managed_mcp: false`
  quer dizer *"o Frota não roteia MCP para este motor"*, jamais *"este motor
  não fala MCP"*. A tela juntava as duas e escolhia a frase errada. Agora
  `roteiaMcpGerenciado` vem do backend e a linha diz **"sem roteamento do Frota
  (configure no CLI)"**: nomeia de quem é o limite e aponta o caminho que
  funciona.
- **A frase nova ganha do `nativeReason`** quando as duas valem: o limite do
  MOTOR é o fato dominante e o único acionável (logar no app não ajudaria em
  nada). Guarda dos dois lados: quem roteia mantém as frases antigas.
- **Sobre escopo por-run no agy** (pergunta do usuário: dá pra criar essa
  camada?): medido que `HOME` reposiciona o config (`agy mcp list` enxerga o
  `mcp_config.json` do HOME falso) e que `ANTIGRAVITY_EXECUTABLE_DATA_DIR`
  **não**. Mas o token OAuth mora em `~/.gemini/antigravity-cli/`, dentro da
  MESMA árvore: trocar `HOME` cru derruba o login, e `HOME` afeta todo o
  processo (git, ssh, npm), não só o agy. Registrado como opção com custo, não
  como caminho aberto.
- **Verificado:** `cargo` 546, `tsc` 0, `vitest` 3243, 9 guardas.

### ADR-102 — MCP em qualquer máquina: o bool virou escopo (F1) ✅
- **Contexto (26/08/2026):** o usuário fixou a restrição que manda no desenho:
  *"o Frota vai ser instalado em outras máquinas, então nada pode ser fixo
  aqui"*, e pediu o caminho certo pra MCP funcionar em qualquer code agent.
- **Auditoria antes de propor:** os `/Users/<nome>/...` do código estão TODOS em
  fixture de teste; caminho de produção sai de `$HOME` e binário de
  `command -v`. A base já era portátil, e o plano não podia sujá-la.
- **O erro de modelagem:** `managed_mcp: bool` colapsava QUATRO realidades em
  duas, e foi dessa perda que saíram os dois bugs de copy seguidos (ADR-100 e
  ADR-101). Agora é `McpEscopo`, e cada motor declara o que foi MEDIDO:
  claude e codex `PorRun` (config no spawn), **opencode `PorProjeto`**, **agy
  `Global`**.
- **As duas medições novas que fecham a tabela:** o `opencode` honra a chave
  `mcp` do `opencode.json` do DIRETÓRIO, provado dos dois lados (dentro do
  projeto o `opencode mcp list` mostra o servidor, fora diz "No MCP servers
  configured"). E o `agy mcp add` (1.1.21) não tem flag de escopo: config por
  projeto foi testada e é IGNORADA.
- **A decisão que resolve a portabilidade, e vai pro F2:** instalar pelo **CLI
  do próprio agent** (`agy mcp add`, `opencode mcp add`), nunca por caminho que
  o app adivinha. O caminho do config é conhecimento do fornecedor, muda com
  versão e sistema; guardá-lo é criar exatamente o "fixo aqui" que foi
  proibido. Rodar o comando deles é portátil por construção.
- **Comportamento não mudou:** os quatro portões do control plane passaram a
  perguntar `mcp_escopo.por_run()`, que devolve o mesmo que o bool devolvia. A
  suíte inteira passou sem tocar em nenhum teste de comportamento.
- **A tabela virou guarda:** um teste fixa o escopo de cada motor e cobra
  medição de quem mudar. E cobra, para TODO motor do registry, que
  `cli_fala_mcp()` seja verdadeiro: nenhum dos quatro pode ser chamado de "não
  suporta MCP", que é o erro que o ADR-101 consertou na copy.
- **Plano completo:** `docs/mcp-qualquer-agent-plan.md` (F2 instala pelo CLI,
  F3 o gesto humano pro escopo Global, F4 o por-projeto do opencode, F5 revisa
  o proxy do app nos escopos novos).
- **Verificado:** `cargo` 547, `tsc` 0, `vitest` 3243, 9 guardas.

### ADR-103 — F2: instalar MCP pelo CLI do agent, e a guarda que protege isso ✅
- **Contexto (26/08/2026):** F2 do `docs/mcp-qualquer-agent-plan.md`, sob a
  restrição do usuário de que nada pode ser fixo nesta máquina.
- **Medido no `agy 1.1.21`, rodando cada forma** (em `HOME` isolado, para não
  escrever na config real): `agy mcp add` funciona **sem interação**, stdio e
  http; `--header "Chave: Valor"` (dois pontos, não `=`); `--env K=v`; flags
  obrigatoriamente ANTES do nome; `--` antes do comando funciona sempre, então
  é emitido SEMPRE (uniformizar mata a classe de bug do comando com hífen);
  `agy mcp remove <nome>` desinstala. O CLI escreve o arquivo dele sozinho, que
  é exatamente o ponto: o app não sabe nem quer saber onde.
- **A exceção, descoberta por um acidente meu:** rodei `opencode mcp add` de
  dentro de um projeto e ele gravou no config **GLOBAL** do usuário. Ou seja,
  **o CLI do opencode não escreve no escopo que ele mesmo LÊ** (a leitura por
  projeto foi provada no ADR-102). Usar o CLI ali daria escopo global calado, o
  oposto do que a tela promete. Por isso `opencode` é `ArquivoDoProjeto`. A
  entrada que criei sem querer no `~/.config/opencode/opencode.json` foi
  removida na hora, e o arquivo voltou ao estado exato de antes.
- **A regra fina, que o acidente afiou:** config de USUÁRIO vai pelo CLI (o
  caminho é do fornecedor e varia por máquina); config de PROJETO é escrita
  pelo app pelo NOME do arquivo (`opencode.json`), que é relativo ao diretório
  escolhido e portanto portátil por definição. Tem teste cobrando que o nome
  guardado não contenha `/`.
- **`instalacao_de` decide pelo ESCOPO, não por `match` de nome** (G1.1): motor
  novo com escopo conhecido já entra certo. Só o `PorProjeto` precisa saber
  QUAL arquivo, e aí é dialeto de fornecedor como o resto do módulo.
- **A guarda `check-config-de-agent`** (a 10ª) barra caminho de config de agent
  virar STRING no código Rust de produção. Comentário segue permitido de
  propósito: explicar onde o fornecedor guarda é documentação legítima, e
  vários ADRs dependem disso; o que mata é o caminho ser executado. Fixture de
  teste é ignorada (captura saída real do CLI, que às vezes cita o caminho).
  **Testada nos dois sentidos:** com um caminho plantado ela falha com exit 1 e
  aponta arquivo e linha.
- **Verificado:** `cargo` 555 (8 novos), `tsc` 0, `vitest` 3243, 10 guardas.

### ADR-104 — F3: escopo global ganha AÇÃO, não interruptor ✅
- **Contexto (26/08/2026):** F3 do `docs/mcp-qualquer-agent-plan.md`, o gesto
  humano para instalar MCP num motor de escopo global (hoje o agy).
- **A decisão de desenho, e o motivo:** a linha do agy **não** ganha
  interruptor. Interruptor comunica *"eu sei como está e controlo"*, e o app
  **não sabe** o que já existe no `agy mcp list` do usuário. Mostrar um seria a
  mesma classe de mentira do ADR-100, só que na direção oposta: ali o rótulo
  prometia e o controle negava; aqui o controle prometeria um estado que
  ninguém consultou. Escopo global ganha **ação**, e `gestoDaLinha` é a função
  pura que decide isso (com teste dos três casos).
- **A consequência aparece ANTES do clique**, não depois: "vale para todos os
  projetos e continua depois da missão; quem escreve é o CLI do agent, no lugar
  que ele escolher nesta máquina". Escopo global não se desfaz no fim do run, e
  quem lê precisa saber alcance E duração. Teste cobra as três partes da frase.
- **Sem estado otimista, de propósito.** O padrão da casa é aplicar na hora e
  reverter no erro, mas aqui não há o que aplicar: a única verdade é a frase
  que o CLI devolver. O toast mostra **a voz do CLI** ("Added MCP server …"),
  e no erro mostra o stderr dele, nunca um "não deu certo" nosso.
- **A conversão recusa em vez de instalar quebrado.** Servidor descoberto
  costuma guardar REFERÊNCIA de segredo, não valor (`env_vars`,
  `bearerTokenEnvVar`, `envHttpHeaders`). Repassar isso instalaria um servidor
  que falha na primeira chamada, e a tela diria "instalado". `spec_de` recusa,
  NOMEIA o que falta e manda instalar pelo CLI, onde as variáveis existem.
- **`stdin` fechado no spawn:** o comando tem de ser não-interativo (medido que
  o `agy mcp add` é). Se um dia pedir input, é melhor falhar na hora que
  pendurar o app esperando alguém que não está lá.
- **Verificado:** `cargo` 558, `tsc` 0, `vitest` 3247, 10 guardas.

### ADR-105 — F4: escrever no opencode.json sem estragar o repositório ✅
- **Contexto (26/08/2026):** F4 do `docs/mcp-qualquer-agent-plan.md`. O opencode
  tem escopo `PorProjeto`, e o CLI dele grava no global (ADR-103), então aqui
  quem escreve é o app. O arquivo é do REPOSITÓRIO do usuário, e pode estar
  versionado: a régua é mais dura que a de um arquivo efêmero.
- **Formas lidas do `config.json` deles**, não inventadas: `McpLocalConfig`
  (`type:"local"`, `command:[]`, `environment`, `enabled`) e `McpRemoteConfig`
  (`type:"remote"`, `url`, `headers`). Os dois são `additionalProperties:
  false`, então campo a mais não é ignorado, é **config inválida**.
- **O achado que decidiu o desenho:** o schema declara `allowComments` e
  `allowTrailingCommas`. **O `opencode.json` é JSONC**, e nenhum serializador
  JSON preserva comentário. Reescrever apagaria texto que a pessoa escreveu num
  arquivo que ela versiona. Por isso o merge **recusa** quando acha comentário,
  e diz o que fazer à mão.
- **O detector respeita aspas, e isso não é detalhe:** toda URL `https://` tem
  duas barras. Um detector ingênuo acusaria comentário em praticamente todo
  arquivo real, e o app passaria a recusar escrever em quase tudo. Tem teste
  com URL e com aspas escapadas.
- **Três garantias no merge, e a terceira é a que importa:** (1) só a chave do
  app muda; (2) chave `mcp` que ficou vazia sai junto, sem deixar lixo nosso;
  (3) **conferência DEPOIS de serializar**, sobre o texto que seria gravado — se
  alguma chave do usuário sumiu ou algum MCP dele mudou, o resultado é
  descartado com erro em vez de gravado. É a diferença entre acreditar no merge
  e verificar.
- **JSON inválido não vira arquivo novo por cima.** Arquivo quebrado é do
  usuário e pode estar no meio de uma edição; sobrescrever seria destruir o
  trabalho dele. Só arquivo VAZIO nasce do zero.
- **A tela ganhou um gesto PRÓPRIO**, não o mesmo do escopo global: escrever na
  config do CLI e escrever num arquivo do repositório não são o mesmo risco, e
  juntar os dois faria a frase mentir num dos casos. "Instalar no projeto" avisa
  que o arquivo é versionado e que só a entrada do Frota é tocada, que é
  exatamente o que o merge cumpre.
- **Verificado:** `cargo` 564 (6 novos), `tsc` 0, `vitest` 3249, 10 guardas.

### ADR-106 — F5: o proxy do app não cabe fora do run, e isso é estrutural ✅
- **Contexto (26/08/2026):** última fase do
  `docs/mcp-qualquer-agent-plan.md`. A pergunta era se o login do Frota (o
  proxy da A2) alcança os escopos novos, agora que `PorProjeto` e `Global`
  existem no vocabulário.
- **A resposta é estrutural, e fecha em vez de adiar.** O proxy é endereçado
  por duas coisas: um **socket efêmero**, que morre com o run, e o **caminho do
  binário do Frota nesta máquina** (`std::env::current_exe`). Persistir isso num
  arquivo que sobrevive à missão gravaria um endereço morto E um caminho de
  máquina, que são exatamente as duas coisas que o plano proíbe. Não é falta de
  trabalho: é o desenho dizendo até onde vai.
- **A regra que saiu daí, e que faltava:** instalar um MCP OAuth num CLI que não
  sabe autenticar sozinho é armadilha, não ajuda. O servidor apareceria
  "instalado" e falharia na primeira chamada, que é a combinação que esta casa
  já recusou duas vezes hoje (ADR-104 e ADR-105).
- **Medido nos dois, e a diferença é real:** o `opencode mcp` tem
  `auth|logout|debug` e o `McpRemoteConfig` deles tem campo `oauth`, então lá
  existe onde a credencial morar. O `agy mcp` tem só
  `add|remove|list|enable|disable`, e a entrada que ele grava é
  `serverUrl` + `headers` + `disabled`: **não há campo de credencial nenhum**.
- **`spec_de` passou a recusar OAuth no agy**, com a frase que diz o motivo
  certo: *"o login do Frota não viaja: ele vale dentro da missão, não num config
  que sobrevive a ela"*. É o ADR-100 visto do outro lado — lá o login do CLI não
  chegava ao app; aqui o login do app não chega ao CLI. Guarda dos dois lados:
  servidor SEM oauth continua instalável nos dois motores.
- **O plano fechou.** F1 a F5 entregues, builds #286 a #290.
- **Verificado:** `cargo` 566 (2 novos), `tsc` 0, `vitest` 3249, 10 guardas.

### ADR-107 — o canal de permissão do OpenCode existe, e é ACP ✅
- **Contexto (26/08/2026):** o F3 do `docs/opencode-openrouter-plan.md` estava
  parado com o contrato lido e o round-trip impossível: o
  `POST /api/session/{id}/prompt` do `serve` admitia o prompt e **nunca
  executava**, mesmo com banco e credencial sãos.
- **A pista veio de um processo órfão.** Ao limpar os testes sobrou um
  `opencode acp` que não era meu: era do **Zed**. O editor não usa a API HTTP,
  usa **ACP** (Agent Client Protocol), JSON-RPC sobre stdio. Eu estava
  investigando o transporte errado.
- **Medido ponta a ponta, e funciona:** o turno PARA num
  `session/request_permission`, com `toolCall` (título já formatado, `kind`,
  `rawInput`) e as opções `allow_once | allow_always | reject_once`. Respondendo
  `{"outcome":{"outcome":"selected","optionId":"once"}}`, a ferramenta executou
  (`tool_call_update status=completed`, saída `oi-frota`), o texto streamou e o
  turno fechou em `stopReason: end_turn` com usage trazendo `cachedReadTokens`
  separado. **É exatamente o que a fase pedia, e o `serve` nunca entregou.**
- **O ACP ganha do `serve` em tudo que importa aqui** (permissão real, streaming,
  raciocínio, desfecho honesto, cache separado) e ainda **não é dialeto de um
  fornecedor**: é protocolo padrão, então quem falar ACP entra sem tradução
  nova. Por isso o módulo se chama `acp`, não `opencode_algo`.
- **A armadilha que virou teste:** `session/request_permission` tem `id`, logo é
  PEDIDO e exige resposta. Tratá-lo como notificação **pendura o turno para
  sempre**, esperando um humano que nunca foi chamado — foi o que aconteceu na
  primeira tentativa aqui, e o `session/prompt` voltou `null` depois de 120s.
- **`cancelled` não é `reject`.** O ACP tem palavra própria para "ninguém
  decidiu", e o app usa ela quando a missão aborta. Juntar as duas repetiria o
  defeito do ADR-099, onde o registro dizia que o humano recusou sem terem
  perguntado a ele.
- **Entregue a camada PURA, de propósito, antes do spawn.** A tradução é onde os
  erros de protocolo moram, e ela pode ser testada contra os payloads REAIS
  capturados sem subir processo nenhum. Também decidido ali: raciocínio não vira
  texto do assistente, e só o DESFECHO da ferramenta vira `ToolResult` (o
  `in_progress` chega várias vezes com a saída crescendo).
- **Falta** o transporte (spawn + stdio + fila de pedidos), que é a fase
  seguinte.
- **Verificado:** `cargo` 575 (9 novos), `tsc` 0, 10 guardas.

### ADR-108 — a decisão do humano cabe no que o agente ofereceu ✅
- **Contexto (26/08/2026):** completa a camada pura do ACP (ADR-107) com a peça
  que faltava: traduzir a resposta da UI (`{allow, message?}`, contrato que o
  `codex_appserver` já usa) numa escolha do protocolo.
- **A regra que faz a função existir: o app NÃO inventa `optionId`.** Os nomes
  `once`/`always`/`reject` são o que ESTE binário oferece hoje, não garantia do
  protocolo — o ACP manda a lista justamente porque ela varia. Mandar um id de
  fora dá erro do agente no meio do turno, com o humano já tendo decidido.
  Quando nada corresponde, o desfecho é `cancelled`, nunca um "allow" escolhido
  por conta própria.
- **"Permitir uma vez" é o default do sim.** Conceder PARA SEMPRE é decisão
  maior, e ninguém pediu isso ao clicar em permitir. O sim cai no menor escopo
  oferecido, e só desce pra família (`allow_*`) se o exato não estiver na lista.
- **Fail-closed no que não afirma sim:** resposta sem `allow`, com `null` ou com
  tipo errado nega. Vale inclusive pro shutdown do run, que responde sem o campo.
- **O caminho de NEGAR foi medido no binário, e fecha o círculo do ADR-099.**
  Respondendo `reject`, o opencode devolve `status: failed` com
  `"The user rejected permission to use this specific tool call."` — **a mesma
  frase** que no `run` era mentira. Lá o CLI auto-rejeitava sem perguntar e o
  adapter precisa desmentir; aqui o humano decidiu de verdade, então a frase é
  honesta e passa intacta.
- **Isso virou guarda**, porque a correção do ADR-099 é tentadora de
  generalizar: aplicá-la ao ACP faria o app desmentir uma recusa que o usuário
  realmente tomou, que é o erro simétrico.
- **Falta** o transporte (spawn + laço de stdio + fila de pedidos ligada ao
  `DirectInteractions`, que já espera humano sem timeout).
- **Verificado:** `cargo` 579 (4 novos), 10 guardas.

### ADR-109 — a tinta do post-it se separa do status pela SATURAÇÃO, não pela matiz ✅
- **Contexto (27/08/2026):** o bloco de notas nasceu com 5 cores em Tailwind cru
  (`amber-500/8`, `emerald-950/20`, `indigo-400`…) e o `check:paleta` reprovou
  com 39 ocorrências. O §2 é vocabulário fechado: cor nova entra por token com
  par claro/escuro e linha na tabela.
- **A tentativa óbvia falhou, e o motivo importa.** Dar hue livre pra cada uma
  das 5 não dá: a roda já está tomada. Âmbar tem dono só desde o ADR-043
  (decisão pendente / fila / risco autorizado), verde é marco raro, vermelho é
  falha, azul é o vivo do chrome, `id-violet` é identidade de agent. `sand`
  (âmbar) e `sage` (verde) — os dois nomes do desenho original — caíam
  exatamente em cima dos dois papéis mais protegidos do guia.
- **A regra que resolve: as tintas de papel são SURDAS.** O que separa
  `note-teal` (#5f8f92) de `st-success` (#1f9d6b) não é a matiz, é a
  saturação — um é tinta de papel, o outro é sinal. Nenhum `note-*` chega perto
  da vivacidade de um `st-*`, nos dois temas. Isso deixa o hue livre pra ser
  pista de categoria sem virar signo de estado.
- **A contenção que faz a regra valer: `note-*` só pinta SUPERFÍCIE.** Fundo
  (`/10`), borda (`/30`) e a bolinha do seletor. **Texto nunca** — letra
  colorida é o que faria a tinta disputar leitura com o vocabulário do §2. Tem
  teste segurando (`StickyNoteCard.test.tsx`: nenhuma variante emite
  `text-note-*`).
- **`sage` foi removida** em vez de reaproveitada: verde a 10% ainda é verde, e
  a nota não tem por que dizer "concluído". Entrou `teal` no lugar. Nota antiga
  com `color: "sage"` no localStorage cai no papel padrão pelo fallback que já
  existia — sem migração, porque a feature nunca saiu daqui.
- **A tinta não sinaliza urgência.** Quem quer destacar uma nota usa o PIN, que
  é `ring-brass` e já é o gesto do produto. Cor de papel é rótulo do humano.
- **Verificado:** `tsc` 0, `vitest` 3294, `bun run check` 10 guardas verdes.

### ADR-110 — a régua de turnos CABE; minimapa que rola não é mapa ✅
- **Contexto (27/08/2026):** em fio longo (~30 turnos) a régua do gutter
  aparecia cortada no topo, encostada na barra de abas, e lida como código de
  barras ao lado da barra de rolagem real. Três causas, todas no mesmo lugar:
  `max-h-[60vh]` mede a JANELA, e o container do fio perde a barra de abas em
  cima e o composer embaixo (o chute erra pra mais, e sobra por fora);
  `overflow-y-auto` dava à régua uma **segunda barra de rolagem**; e `top-1/2`
  em `sticky` resolve a porcentagem contra o bloco container, não contra o
  viewport de rolagem, então a origem também saía do lugar.
- **A régua agora mede o espaço real** (`clientHeight` do container +
  `ResizeObserver`) e o **passo** entre marcadores encolhe de 18px até um piso
  de 7px pra caber. Nada de rolagem interna: o valor de um minimapa é dizer
  "onde estou no TODO", e ele evapora no instante em que o mapa precisa ser
  rolado pra ser visto.
- **Quando nem o piso cabe, ela CONDENSA e diz que condensou.** Faixas
  contíguas de tamanho igual (a posição continua proporcional ao fio, senão
  deixa de ser mapa), representadas pelo **turno do usuário** da faixa quando
  existe — é o que a pessoa procura ao voltar no fio ("onde foi que eu pedi
  isso?"). O hover carrega "Faixa de N turnos · leva ao começo": marcador que
  engole 4 turnos e finge ser 1 mentiria sobre onde o clique leva.
- **O `IntersectionObserver` passou a olhar TODOS os turnos**, não só os
  marcadores pintados. Observando apenas os representantes, o marcador ativo
  congelaria enquanto a pessoa rola DENTRO de uma faixa condensada.
- **A superfície virou hover.** A pílula era `bg-card/60` + hairline sobre
  `bg-background`: invisível, e o que sobrava na tela era o traço solto. Agora
  em repouso ela é só o traço, e a superfície acende no hover — sem hairline,
  que é o que o §4 pede pra não fazer cartão-em-cartão.
- **Verificado:** `tsc` 0, `vitest` 3300 (6 novos em `TurnScrubber.test.ts`,
  incluindo a invariante "cabe na altura" varrida em 6 tamanhos de fio × 3
  alturas), `bun run check` 10 guardas verdes.
- **A seta do tooltip virou herdeira da superfície** (`components/ui/tooltip.tsx`).
  Ela era `bg-foreground` fixa, o que só casa com a receita escura padrão — e a
  régua é o único lugar do app que troca a superfície do balão, então o hover
  dela ganhava um losango preto grudado mordendo a primeira linha. Agora é
  `bg-inherit` (a seta pega o fundo do balão) + `fill-transparent` (o polígono
  do SVG some; quem desenha o losango é a caixa rotacionada, não o `fill`, e
  `inherit` ali cairia no preto inicial do SVG). O balão da régua ficou sem
  hairline pela mesma razão: com borda, a seta herdada vira aba saindo do
  cartão. Somou um atraso próprio de 280ms — com o passo apertado, o provider
  global de 0ms virava metralhadora de balão enquanto o ponteiro cruzava a
  régua.

### ADR-111 — a régua só existe quando o GUTTER existe (viewport ≠ contêiner) ✅
- **Contexto (28/08/2026):** o mock das Notas (`docs/mocks/notas-apple.html`,
  variantes `#c` e `#e`) expôs de lado um defeito que não era das notas: com o
  painel direito aberto numa janela larga, a régua de turnos pintava por cima do
  texto. Ela decidia por `lg:` — breakpoint de **VIEWPORT** — enquanto o espaço
  de que precisa é o do **CONTÊINER** de rolagem do fio.
- **A decisão virou container query** (`@container` no container de rolagem,
  `@min-[…]` na régua), o mesmo molde que o `TabBtn` do painel direito já usava.
  Ou seja: a régua não pergunta "que tamanho tem a janela", pergunta "sobra
  gutter aqui dentro".
- **O limiar é 848, e o 848 não é a conta óbvia.** `760` (coluna) + `38×2`
  (gutter dos DOIS lados, porque a coluna é `mx-auto`) + `12` de barra de
  rolagem. A folga da barra existe porque o container query resolve contra a
  caixa que **ainda conta a barra**; sem ela, no limiar exato o trilho entrava
  ~6px na caixa da coluna.
- **A premissa dos 12px estava documentada errada na primeira tentativa, e o
  erro é instrutivo:** o comentário culpava `::-webkit-scrollbar { width: 9px }`
  (`index.css:498`), mas quem manda é o `scrollbar-width: thin` declarado logo
  acima — o Chromium ignora a largura do `::-webkit-` quando ele existe, e
  `thin` são os 11px que a medição pegou. O número estava certo por acidente.
  Pior: o pior caso medido é o do DESENVOLVIMENTO. Em produção isto roda em
  WKWebView e WebKitGTK, onde a barra é overlay e não come largura — a folga
  sobra na plataforma real, que é o lado certo pra errar.
- **Mudança de comportamento, declarada:** o `lg:` era 1024px de janela, que com
  a sidebar dava ~816px de fio — gutter de 28px contra os 38px que a régua
  ocupa. Ou seja, ela aparecia e **já pintava dentro da coluna**. Agora só entra
  a partir de ~1047px de janela. Em janelas entre 1024 e 1047 a régua deixa de
  aparecer: isso é o defeito indo embora, não regressão.
- **Duas guardas, porque a decisão mora no CSS e CSS não tem tipo.**
  `cabeRegua` + `CLASSE_VISIBILIDADE_REGUA` amarram o número TS↔CSS; um teste lê
  o fonte do `ChatPanel.tsx` e exige o `@container` (sem ele, `@min-[…]` nunca
  casa e a régua sumiria **para sempre, em silêncio**); e um terceiro amarra
  `GUTTER_REGUA = 38` às três classes que o produzem (`left-2` + `px-1.5` +
  `w-4.5`) — trocar `w-4.5` por `w-6` deslocaria o gutter real com a suíte
  inteira verde.
- **O fonte entra por `import.meta.glob(?raw)`, nunca por `node:fs`.** A
  primeira versão da guarda usava `node:fs`, passou no `vitest` e no
  `tsc --noEmit`, e **quebrou o `tsc -b`** — que é o que a build roda. O
  tsconfig do `src/` não tem os tipos do node de propósito. Isso é regra, não
  acidente: teste que lê fonte usa o mecanismo do Vite (padrão de
  `janelaViva.test.ts`).
- **Armadilha registrada:** `container-type: inline-size` computa
  `contain: layout`, o que faz do container de rolagem o bloco contentor de
  qualquer `position: fixed` descendente. Hoje não quebra nada (varrido), mas o
  próximo `fixed` dentro do fio vai se ancorar ali, não no viewport.
- **Verificado:** `tsc -b` limpo, `vitest` 3366, `bun run check` 10 guardas,
  `test:e2e` 27.

### ADR-112 — a gaveta de notas cabe no que tem dentro, e diz de quem é cada nota ✅
- **Contexto (28/08/2026):** a gaveta nasceu `fixed right-4 top-14 bottom-16`:
  altura CHEIA sempre, ancorada em nada, e por ser `fixed` abria **por cima** do
  painel de contexto. Com 1 nota, uma lousa de 600px com um post-it no topo.
  Cinco desenhos foram ao mock (`docs/mocks/notas-README.md`); ganhou o **A**
  (lista + folha), com **B** (folha solta) como degradação.
- **O gatilho fica na barra de título, e isso é consequência do MODELO, não de
  gosto.** `selectNotesFor` aceita nota da conversa OU global do projeto —
  escopo misto. Pendurar na aba "Conversa" prometeria escopo de conversa e
  mentiria para as globais; e a gaveta existe em Painel e Features, onde aquela
  aba não existe. O escopo entra DENTRO, em seções ("Desta conversa" / "Do
  projeto"), que é a regra que Configurações já aplica: explícito, nunca
  herdado em silêncio. O `handleCreateNote` deixou de carimbar `convId` sozinho:
  o escopo vem do gesto.
- **≤2 notas: a lista SOME.** Painel de 1 nota tem tamanho de 1 nota (§5). O
  limiar é constante nomeada e testada, não número solto no JSX.
- **O host global do `App.tsx` saiu** e a gaveta virou popover na `TitleBar` —
  que é chrome incondicional, montada em toda superfície. O ⌘K continua
  alcançando (ele mexe em `dockOpen`, que controla o `Popover.Root`).
- **"Nunca cobre o painel direito" virou MECANISMO MEDIDO**, não constante: a
  fronteira de colisão é o cartão do centro (`data-notes-boundary`), porque o
  painel é redimensionável e nenhuma largura decorada serviria. E `sticky="always"`,
  não o `"partial"` padrão: o padrão instala um `limitShift` que parava a gaveta
  com a borda direita na borda ESQUERDA do chip, ainda dentro do painel. **A
  gaveta pode descolar do chip; cobrir o painel não pode** — é escolha de
  desenho, e está aqui pra ninguém "consertar" de volta.
- **A guarda que o gate cobrou:** `collisionBoundary` cai em `undefined` quando
  não acha o atributo, e `undefined` é a fronteira do VIEWPORT — o defeito
  original de volta, em silêncio. Um teste-contrato exige o atributo no
  `AppShell` E o seletor na gaveta. Mesma classe de falha que a ADR-111 fechou;
  as duas frentes correram em paralelo e só uma tinha aprendido a lição.
- **Um Esc, um efeito.** O editor da nota trata `Escape` pra descartar o
  rascunho, e o Radix escuta em CAPTURA no `document`: o mesmo toque descartava
  a edição **e** fechava a gaveta. Com editor aberto a gaveta se cala; o segundo
  Esc fecha.
- **O falso vazio, que é o defeito mais grave da leva porque a tela MENTIA:**
  buscar `zzz` com 20 notas fazia a folha dizer "Nenhuma nota ainda / Criar
  primeira nota" ao lado da coluna dizendo, certo, "Nenhuma nota com esse
  texto". Agora são três vazios com copy própria (`motivoDeVazio` +
  `COPY_DE_VAZIO`, puros e testados), e **o gesto segue o motivo**: criar só
  quando não existe nota; nos outros dois o que resolve é desfazer o recorte.
- **A causa de fundo do falso vazio era arquitetural:** `busca` e `escolhida`
  eram `useState` da View, então nenhum caminho de busca era renderizável em
  teste. Subiram pro container; a View seguiu pura (o `renderToStaticMarkup`
  congela estado inicial — é a armadilha do `getInitialState`), e os três casos
  que faltavam entraram.
- **Débito aceito, com nome:** (1) a fronteira é capturada quando a gaveta abre
  e **não** recalcula ao arrastar a alça do `ResizablePanelGroup` (não é resize
  de janela, nem scroll de ancestral, nem movimento do chip); (2) `w-[560px]` é
  largura fixa contra fronteira variável — com o painel no máximo numa janela de
  ~1200px a gaveta transborda, porque não há middleware de `size`.
- **A tinta continua surda (ADR-109).** A cor viva de post-it está decidida e
  medida, mas é a frente P do plano e não entrou aqui: cor viva só existirá na
  MESA, nunca na gaveta.
- **Verificado:** `tsc -b` limpo, `vitest` 3366, `bun run check` 10 guardas.
- **Adendo (28/08/2026, revisão na tela):** a folha estava vestindo a roupa do
  cartão. O reuso do `StickyNoteCard` foi decisão certa (não duplicar
  editor/pin/prompt/cor), mas o `flat` só tirava elevação — a nota seguia
  pintando **tinta de papel** dentro do popover branco (cartão-em-cartão de
  cor, §4), o conteúdo saía **cru** (a folha era a única superfície das notas
  onde a primeira linha não virava título) e o rodapé oferecia "Editar" ao lado
  de um corpo que já edita no clique. Os três caíram: `flat` agora tira também
  a tinta (a cor sobrevive onde ela é RÓTULO — a bolinha do seletor e o ponto da
  linha da lista), `folhaDaNota` sobe a primeira linha a título deixando o resto
  **cru** pro markdown (a lista colapsa o resto num preview; a folha não tem
  essa restrição, e colapsar ali seria destruir a nota pra caber num lugar que
  cabe), e "Editar" some na folha. `vitest` 3374.
- **Segundo adendo (28/08/2026), e ele corrige o adendo anterior.** Tirar a
  tinta do cartão resolveu o cartão-em-cartão e criou outro defeito: no desenho
  B (sem lista) a nota virou **branco no branco**, sem contraste nenhum, porque
  ali não há coluna de que a folha se separe. A saída não é devolver o cartão
  colorido: é a **gaveta VESTIR a tinta**. Sem lista, a superfície é uma só e
  ela é o papel; com a lista aberta a folha volta a ser neutra, porque ali quem
  separa é a coluna. Junto caiu o **anel do pin dentro da gaveta**: ele nascia
  no limite da área rolável e saía com as pontas cortadas, e era sinal repetido
  (o pin já está aceso no cabeçalho, e a lista tem seção "Fixadas") — sinal
  repetido que ainda por cima aparece quebrado é pior que sinal nenhum. No
  cartão solto o anel continua. `vitest` 3377.

### ADR-113 — a nota sabe de quem ela é, e o alvo dela vem do registry ✅
- **Contexto (28/08/2026):** revisão da arquitetura da gaveta, pedida depois da
  entrega do sprint 1. Quatro defeitos, todos de DADO — a camada de render
  estava boa, a de modelo não.
- **O alvo da nota comparava nome de agent, que é a regra mais dura da casa.**
  `StickyNoteTarget` era união fixa (`"claude" | "codex" | "agy" | "opencode"`)
  escrita à mão em DOIS arquivos de UI, e já estava errada: o registry chama de
  `claude-code` o que a nota chamava de `claude`, e o `model` não existia pra
  ela. Agent novo entrava no `adapters.rs` e no `agents.ts` e a gaveta seguia
  sem saber. Agora o alvo é **id do registry**, a lista sai de `DESTINATIONS`, e
  `noteTargets.ts` guarda a única exceção: um mapa de apelido antigo
  (`claude → claude-code`) que existe pra nota gravada ontem não perder o
  destino hoje. Ele **encolhe, nunca cresce**.
- **Alvo desconhecido cai em "Geral", não some.** Nota que desaparece porque o
  destino envelheceu é a pior falha possível aqui: ela não avisa.
- **"Do projeto" era mentira, e o campo que faltava era `projectId`.** A nota só
  tinha `convId`; a que não tinha conversa era rotulada "Do projeto" e aparecia
  em TODOS os projetos. Agora projeto é filtro de verdade, e o escopo tem TRÊS
  valores porque três é o que existe: "Desta conversa", "Deste projeto" e
  **"De todos os projetos"** — que é o que as notas antigas SÃO. Elas não somem
  (o escopo é legítimo e vira feature); elas passam a se chamar pelo que são.
  Zero migração: campo ausente já significa o terceiro escopo.
- **`selectNotesFor` virou objeto em vez de posicional.** São três dimensões, e
  `selectNotesFor(notes, undefined, "c1")` seria um convite a trocar projeto por
  conversa sem o tipo reclamar. A troca de assinatura pegou os 7 pontos de
  chamada em `tsc`, que é o comportamento desejado de uma mudança de semântica.
- **Nota órfã por construção.** `clearConversationNotes` existia na store e
  **ninguém chamava**: apagar uma conversa deixava as notas dela com um `convId`
  que não casa com nada — invisíveis em todo escopo e sem gesto que as apague.
  Ligado ao `store/chat/remove.ts`, cuja doutrina no topo do arquivo já dizia
  isto: *nada pode continuar vivo e INVISÍVEL depois que a conversa some*.
- **A catraca cobrou e o arquivo foi DIVIDIDO** (702 > 700): o gatilho saiu para
  `StickyNotesTrigger.tsx`. É recorte fechado — ancoragem, fronteira de colisão
  e gesto de abrir de um lado; conteúdo da gaveta do outro. E a guarda do
  `data-notes-boundary` **pagou por si na hora**: foi ela que apontou o seletor
  mudando de casa.
- **O que este ADR NÃO faz, e é o buraco que sobra:** o alvo agora é um dado
  correto, mas continua sendo só um filtro de lista — nenhuma nota alcança o
  agente sozinha. A única ponte é o botão "Prompt", que cola no rascunho. A
  entrega de verdade está desenhada na frente **N5** do plano e depende de
  decisão de produto, porque muda o que sai da máquina.
- **Verificado:** `tsc -b` limpo, `vitest` 3384, `bun run check` 10 guardas.

### ADR-114 — a nota chega no agente por ENDEREÇO, não por gatilho ✅
- **Contexto (28/08/2026):** a ADR-113 deixou o alvo da nota correto como dado e
  inútil como contrato — nenhuma nota alcançava o agente sozinha. Três gatilhos
  foram postos na mesa (automático pelo pin · botão explícito · assumir que é
  rótulo). O humano recusou o automático e pediu **o `@`**: mencionar a nota
  como se menciona um arquivo.
- **`@nota/<slug>`, no idioma que o composer já fala.** O `@` já tinha
  Especialistas e Arquivos com pill atômico e serialização estável; notas viram
  a terceira seção. Nada de mecanismo novo — uma seção a mais no que existe.
- **Slug, e não título cru, por uma razão técnica que morde:** o matcher do `@`
  quebra o token em espaço e em `:` (`AT_PUNCTUATION`), então "Runbook da
  migração" viraria três menções quebradas. O `/` sobrevive de propósito (é o
  que permite `@src/lib/…`) e é o separador. Título repetido ganha sufixo do id:
  endereço ambíguo mandaria a nota errada **sem erro e sem aviso**.
- **O conteúdo é resolvido no ENVIO, não na inserção.** Você endereça, edita a
  nota, manda: vai a versão nova. O botão da nota passou a inserir o mesmo
  endereço em vez de colar o texto — colar congelava uma cópia que envelhecia em
  silêncio. Um mecanismo, duas portas.
- **Menção que não resolve NÃO some.** Nota apagada ou renomeada deixa o
  `@nota/slug` visível no prompt: o agente lê um endereço que não achou, que é a
  verdade, em vez de receber um texto a menos sem ninguém notar.
- **Sem carimbo de "entregue", ao contrário da nota do FIO.** Aquela se acumula
  sozinha e precisa do `sent` pra não voltar todo turno; esta só vai quando você
  a endereça, e mencionar duas vezes é decisão, não bug.
- **Custo zero pra quem não usa:** sem `@nota/` no texto, o envio nem lê a lista
  de notas.
- **Camada:** a composição mora na store e não em `lib/fleet/send.ts` porque
  **nenhum arquivo de `lib/` importa de `components/` neste repo** — e o núcleo
  da menção vive com o resto das notas. A store já é a ponte (ela também importa
  de `components/notes`), e o envio importa store desde sempre.
- **Perf, junto:** a store ganhou `partialize`. Sem ele o zustand serializava o
  estado INTEIRO a cada `set`, então abrir e fechar a gaveta reescrevia o array
  de notas todo no `localStorage` — trabalho síncrono na thread principal por um
  bool que nem faz falta entre sessões.
- **A catraca cobrou DOIS arquivos e os dois foram divididos**, não afrouxados:
  o menu do `@` saiu do `LexicalComposer` (907 → **739**) para
  `ComposerMentionsMenu.tsx`, e a cascata do prompt saiu do `send.ts`
  (853 → **849**) para `promptCascade.ts` — que agora é o único lugar onde a
  ORDEM das camadas (notas → lições → doutrina, do mais específico ao mais
  durável) está escrita, junto da re-expansão do comando nativo que depende
  dela. A baseline só desceu.
- **Verificado:** `tsc -b` limpo, `vitest` 3402 (18 novos no núcleo da menção),
  `bun run check` 10 guardas.

### ADR-115 — o "@" ranqueia por RELEVÂNCIA, e o índice deixa de ser refeito a cada tecla ✅
- **Contexto (28/08/2026):** o menu do `@` filtrava a lista CRUA por substring,
  na ordem do disco. `@send` devolvia `docs/legacy/sender/README.md` antes de
  `lib/fleet/send.ts`, e a listagem inteira (teto de **8000** arquivos no
  `list_project_files`) era varrida a cada tecla — refazendo `split("/")` e
  `toLowerCase()` de cada caminho.
- **A costura era da própria lib:** o `lexical-beautiful-mentions` aceita
  `onSearch` no lugar de `items`. Com ele, quem filtra E ordena é código nosso.
- **Ordem por COMPARADOR EXPLÍCITO, não por peso mágico.** Cinco perguntas, cada
  uma testável: (1) casou no NOME ou só no caminho — você digita o que quer
  abrir, não a pasta onde ele mora; (2) a conversa TOCOU este arquivo; (3) que
  tipo é (Especialista e Nota antes de Arquivo: são poucos e são seus); (4) qual
  o caminho mais curto; (5) quem veio antes — desempate **estável**, sem o qual
  a lista embaralha entre teclas.
- **O tocado NÃO atravessa classe de casamento.** Relevância recente não compra
  qualidade de casamento: arquivo tocado que só casa no caminho continua atrás
  de um que casa no nome. Tem teste, porque é a tentação óbvia de quem for
  "melhorar" o rank depois.
- **O sinal de "tocado" vem das TOOL CALLS, não da prosa** (`arquivosTocados`):
  varrer texto atrás de caminho traria falso positivo de qualquer menção casual
  e empurraria o arquivo errado pro topo. Caminho de fora do projeto sai — o
  `@` nem o oferece.
- **O índice é montado uma vez por LISTA, nunca por consulta** (`useMentionSearch`),
  e os tocados entram por ref: recriar a função de busca no meio da digitação
  faria a lib refazer a consulta e piscar o menu. `searchDelay={0}` porque o
  trabalho é síncrono sobre índice pronto — atrasar só somaria latência.
- **A catraca cobrou e o resultado é o melhor tipo:** o `LexicalComposer.tsx`
  **saiu da baseline** (907 → **695**, abaixo do teto de 700). Saíram o pill e o
  menu de menção pra `ComposerMentionsMenu.tsx` — ficam juntos porque respondem
  a mesma pergunta, como uma menção se PARECE — e a ponte pro ranqueamento
  virou `hooks/useMentionSearch.ts`. Uma exceção a menos no arquivo de catraca.
- **Verificado:** `tsc -b` limpo, `vitest` 3423 (21 novos), `bun run check` 10
  guardas, `test:e2e` 27.

### ADR-116 — anexo na nota: o byte no disco, o metadado na nota, e a pasta que o GC não varre ✅
- **Contexto (28/08/2026):** pedido direto — colar imagem na nota. O app já
  sabia guardar blob (`saveAttachment` grava em `attachments/<convId>/` e só o
  metadado trafega no JS), mas a nota não é da conversa: ela pode ser do
  projeto ou de todos, e sobrevive à conversa que estava aberta quando nasceu.
- **A armadilha, e ela apaga DADO em silêncio:** o `gc_attachments` remove toda
  pasta sob a raiz de anexos cujo nome não seja de uma conversa viva. Anexo de
  nota guardado como `attachments/<noteId>/` sumiria no próximo boot, sem erro
  e sem aviso.
- **A saída aproveita uma propriedade que já existia:** `is_conv_dir_name` exige
  nome de 32 ou 36 chars hex. A pasta `attachments/notes/` **não passa nessa
  régua**, então o GC por-conversa a ignora por CONSTRUÇÃO — e, por morar dentro
  da raiz de anexos, `delete_attachment`, `read_attachment` e o object URL do
  front funcionam sem uma linha nova. Tem teste em Rust fixando exatamente
  isso: se alguém afrouxar o `is_conv_dir_name`, os anexos de todas as notas
  somem no boot seguinte.
- **Régua PRÓPRIA pra nota, e só a de órfã** (`gc_notas`): nota não tem
  `updated_at` autoritativo no banco (vive no front) nem run ativo, então TTL e
  LRU não se aplicam. O que se aplica é "a nota não existe mais". Lista vazia
  não apaga nada — mesma guarda F1 das conversas: "não recebi a lista" e "não
  há nota nenhuma" são indistinguíveis, e apagar no primeiro caso destruiria
  dado por causa de um front que ainda não montou.
- **Uma gravação só.** `gravar_em` foi extraído do `save_to_disk`: validação de
  tamanho, sniff de MIME, allowlist, dedup por hash, escrita atômica e teto do
  cache são os MESMOS da conversa — só a pasta muda. Duplicar isso duplicaria a
  allowlist, que é justamente o que não pode divergir.
- **O byte nunca entra na store.** A gaveta persiste em `localStorage`, que
  guarda string e tem cota de ~5 MB: base64 ali estouraria a cota e
  serializaria megabytes de forma síncrona na thread principal a cada mudança.
  A nota guarda `{path, name, kind, mime, bytes}` — tem teste afirmando o
  conjunto de chaves, porque a tentação de "só encostar o base64" é real.
- **Object URL só da nota ABERTA**, revogado no cleanup; a LISTA diz "1 anexo"
  em texto e nunca resolve URL — seriam N blobs presos na memória, um por linha
  visível.
- **Blob morre com a nota, na hora** (`wipeNoteAttachments` no `deleteNote` e no
  `clearConversationNotes`), sem depender do GC throttled — mesmo contrato do
  wipe da conversa.
- **A catraca cobrou o `ChatPanel` e o resultado foi bom:** o GC do boot virou
  `hooks/useAttachmentGc.ts` (1257 → **1239**). É tarefa de manutenção que não
  tinha nada a ver com a conversa na tela; só precisava de um lugar que monta
  uma vez.
- **Verificado:** `cargo` 582 (3 novos), `tsc -b` limpo, `vitest` 3428,
  `bun run check` 10 guardas.

### ADR-117 — o papel do post-it vira VIVO, e o pin sai ✅
- **Contexto (28/08/2026):** três incômodos do usuário na mesma frase — "não
  vejo sentido em fixar", "a posição é estranha", "as cores". A posição virou
  outra conversa (a gaveta ficou onde estava, ver o adendo); estas duas aqui
  fecharam.
- **O pin SAIU, e o argumento é medido no próprio desenho:** com ≤2 notas ele
  não fazia efeito NENHUM (o anel tinha saído da gaveta no ADR-112, por ser
  cortado pelo `overflow` e redundante com o cabeçalho); com lista, ele só criava
  uma terceira seção pra ordenar o que a data já ordena. Saíram o botão, a faixa
  "Fixadas" e o campo. A régua de ordem passou a ser só recência.
- **O papel virou VIVO, e isso REVISA o ADR-109.** A tinta surda a 10% foi
  escolhida pra não disputar com o vocabulário de estado do §2 — e o efeito
  colateral foi que cinco cores viraram cinco cinzas: a nota é o único lugar do
  app onde a cor é ESCOLHA do humano, e sussurrada ela não escolhia nada.
- **Três regras que a paleta cobra, e duas delas só apareceram no mock:**
  1. **Papel vivo carrega tinta própria** (`--note-fg`, molde de
     `--brass`/`--brass-fg`): a letra é quase-preta nos DOIS temas. Letra que
     segue o tema some no papel claro do modo escuro. A nota deixa de herdar o
     tema e vira ilha invertida.
  2. **O papel do tema escuro NÃO é o claro escurecido — é o claro com menos
     CROMA** (−28%, luz quase intacta). Escurecer parecia óbvio (neon em tela
     preta cega) e REPROVA na medida: o rosa escurecido cai a **3,61:1** contra
     a tinta, abaixo do mínimo pra corpo de texto.
  3. **Contraste é medido, não julgado no olho.** Metadado e ícone a 62% do
     preto reprovam (3,10:1 no rosa); a 82% o pior papel dá 4,79:1. O botão do
     rodapé deixou de ser preto translúcido (que comia o papel) e virou etiqueta
     clara, 11,76:1 no pior caso.

| | claro | corpo | meta | escuro | corpo | meta |
|---|---|---|---|---|---|---|
| sol | `#ffb020` | 9,51 | 6,47 | `#daa23a` | 7,63 | 5,49 |
| limão | `#d8df2a` | 12,02 | 7,69 | `#bec341` | 9,17 | 6,30 |
| verde | `#93c523` | 8,49 | 5,93 | `#8db03c` | 6,96 | 5,09 |
| rosa | `#ff63a6` | 6,28 | 4,79 | `#da6c98` | 5,45 | 4,22 |
| coral | `#ff7a59` | 6,78 | 5,05 | `#da7b62` | 5,79 | 4,44 |

- **A contenção que mantém o §2 de pé:** papel vivo só existe DENTRO da gaveta,
  que é superfície convocada. O chrome do app segue quieto, e `text-note-<matiz>`
  continua proibido — a tinta é UMA, com contraste medido. O teste que antes
  dizia "nenhuma variante emite `text-note-*`" foi reescrito pra afirmar a regra
  nova sem afrouxar a antiga.
- **Quem veste o papel é a FOLHA, não o cartão.** Papel colorido dentro de
  superfície branca seria cartão-em-cartão de cor (§4). E a coluna redefine
  `--foreground`/`--muted-foreground`/`--background` dentro dela: em vez de
  trocar `text-muted-foreground` em catorze lugares do cartão, todo filho passa
  a escrever com a tinta do papel sem saber que mudou de fundo — e o mesmo
  cartão continua servindo fora da gaveta.
- **Adendo do mesmo dia — apagar deixou de parecer fechar.** O gesto de excluir
  usava um ✕ IDÊNTICO ao ✕ que fecha a gaveta, a dois centímetros dele: mesma
  forma, mesmo peso, um fecha e o outro DESTRÓI. Virou lixeira, com confirmação
  destrutiva que nomeia a nota e avisa dos anexos. Nota é texto que você
  escreveu e o app não tem desfazer.
- **Verificado:** `tsc -b` limpo, `vitest` 3426, `bun run check` 10 guardas.

### ADR-118 — o cockpit passa a ver o que não é dele (e o fio passa a SEGUIR) ✅
- **Contexto (28/08/2026):** medido na máquina do autor — **~500 MB parados** em
  três sessões de CLI esquecidas: uma de 11 dias, uma de 7, e uma pilha do Xirp
  de 17 dias com `tmux` **órfão** (`ppid=1`) segurando um worktree. Nenhuma
  queimava CPU, e uma delas **reverteu um arquivo no meio do trabalho**. O
  cockpit, que existe pra dizer o que está acontecendo, não dizia nada disso.
- **O app já cuida bem do que É dele:** `RunRegistry` mapeia `run_id → pid`,
  `kill_all` roda na saída (Cmd-Q no meio de um run deixaria claude/codex
  editando o repo headless) e o `RunGuard` é `Drop`, então limpa em erro e
  panic. O buraco não era de gestão, era de **visão**.
- **A faixa inferior é a casa certa, pela régua dela mesma.** `statusBar.ts`
  aceita AMBIENTE — "o que é verdade enquanto você trabalha" — e já hospeda
  `worktree`. Sessão esquecida é o mesmo gênero: **recurso deixado para trás**.
  A lista é FECHADA e o teste tem tripwire de tamanho; mexer nele é assinar
  embaixo, e esta ADR é a assinatura.
- **Só se OLHA aqui; matar é gesto humano, um a um**, com confirmação e com o
  alvo dito na cara (`pid`, idade, memória). Nada de "limpar tudo": um botão que
  mata cinco coisas transforma um engano em cinco. E **nada de limpeza no boot**
  — app que mata processo sozinho ao abrir é pior que o problema.
- **O `kill` revarre antes de matar.** Entre a tela e o clique o pid pode ter
  morrido e sido reciclado pelo sistema; sem revarrer, um clique atrasado
  mataria um processo QUALQUER que herdou o número.
- **O run do próprio app não aparece na lista.** Ele tem dono na tela e morre
  junto; listá-lo seria o cockpit denunciando a si mesmo, e a primeira reação
  de quem lesse seria matar o próprio turno.
- **"Motor" é o EXECUTÁVEL, não substring:** `grep claude` não é sessão do
  Claude. Sem isso a própria varredura entraria na lista que ela produz.
- **Órfã conta sempre; parada conta por idade** (24h). E órfã antiga conta UMA
  vez — senão o número da faixa ficaria maior que a lista do painel.
- **O IDIOMA da faixa virou UM, e isso saiu de duas correções do usuário.**
  Primeiro ele apontou que o painel novo abria dialog enquanto o medidor de uso
  subia um painel ancorado; depois perguntou por que não refatorar o vizinho e
  criar o padrão. Ele estava certo nas duas: a diferença não tinha decisão por
  trás, era só quem copiou qual vizinho. Nasceu o `PainelDaFaixa`
  (`statusBarChrome.tsx`, no molde do `contextPanelChrome`), e os três itens
  clicáveis da faixa passaram a falar a mesma língua — o `WorktreesDialog`
  virou `WorktreesPainel`. Um teste segura: nenhum painel da faixa importa
  `ui/dialog`, e quem não usa o componente (o `UsagePill`, cujo gatilho é a
  própria pill) tem que repetir a MESMA geometria.
- **O painel é POPOVER, não dialog — e isso saiu de uma correção do usuário.**
  A primeira versão copiou o `WorktreesDialog` e abriu um dialog centrado, que
  escurece o app inteiro pra mostrar telemetria de ambiente. O idioma certo da
  faixa é o do `UsagePill`: um painel que SOBE do item clicado, sem tirar você
  da conversa. E o achado maior é que a faixa tinha **dois idiomas pro mesmo
  gesto** — o dialog dos worktrees é o que ficou fora do padrão, e alinha
  quando for tocado. O confirm de encerrar FECHA o painel antes de perguntar:
  modal disputando foco com popover aberto é briga que ninguém ganha, e a
  pergunta destrutiva merece a tela inteira.

**No mesmo commit, o fio passou a SEGUIR de verdade.** O conserto anterior
(ADR-110 desta leva) trocou "cancelar por posição" por "cancelar por gesto", mas
manteve uma janela de ancoragem com prazo — e o prazo era o defeito seguinte: as
linhas de FERRAMENTA crescem depois de chegar (o resultado volta, o bloco mede,
o diff abre), e nenhuma delas é item novo. Passados os 800ms, cada crescimento
empurrava o fim pra fora da tela e o fio parava sozinho no meio do turno.
Agora: um `ResizeObserver` **permanente** segura o fim enquanto você estiver
seguindo, o gesto de leitura solta, e **voltar ao fim volta a seguir** — o par
simétrico, sem o qual quem subisse uma vez teria que reabrir a conversa.

**Verificado:** `cargo` 592 (6 novos), `tsc -b` limpo, `vitest` 3450,
`bun run check` 10 guardas.

### ADR-119 — review do "Adicionar projeto": dois defeitos que só apareciam quando dava errado ✅
- **Contexto (28/08/2026):** revisão pedida sobre a feature de outro dev (o
  diálogo de adicionar projeto). O grosso está bom — separar
  `pickProjectDirectory` de `createProject` foi o que permitiu o diálogo
  existir, o `INSERT OR IGNORE` + restauração de arquivado está correto, a
  paleta é a canônica que já existia e o nome derivado da pasta só sobrescreve
  enquanto o humano não digitou. Os dois defeitos moravam nos caminhos que
  ninguém exercita à mão.
- **Projeto fantasma quando o banco não grava.** `insertProject` devolve
  `false` também quando NÃO HÁ banco; aí `findProjectByPath` devolve `null`, e o
  código seguia pro caminho feliz: metia o projeto na store e dizia "Projeto
  adicionado". Ele evaporava no restart — exatamente o id fantasma que o
  `findProjectByPath` foi escrito pra evitar, reintroduzido pelo fallthrough.
  Agora falha alto e devolve `null`.
- **Re-adicionar apagava a cor do projeto.** `const color = opts.color ?? null`
  fazia a guarda seguinte (`if (color !== undefined)`) ser SEMPRE verdadeira, e
  o diálogo nasce sem cor escolhida: abrir e confirmar uma pasta já cadastrada
  chamava `setProjectColor(id, null)`. O que provou ser descuido e não decisão é
  a linha logo abaixo, do nome, que tinha a guarda certa (`if
  (opts.name.trim())`). A correção deu significado ao tipo: **`undefined` = não
  mexi; `null` = escolhi sem cor** — e o diálogo passou a nascer em `undefined`.
  Escolher "sem cor" explicitamente continua limpando, e tem teste dizendo isso.
- **Os dois entraram como TESTE antes da correção**, e falhavam contra o código
  velho. Defeito de caminho de erro que ninguém reproduz à mão só existe de
  verdade quando a suíte o segura.
- **§4, cartão dentro de cartão:** a pré-visualização era um cartão com borda
  dentro de outro cartão com borda, dentro do diálogo — três hairlines
  aninhadas. Virou uma superfície só; e a linha de dentro perdeu a borda também
  por FIDELIDADE, porque ela imita uma linha da sidebar, e linha de sidebar não
  tem contorno. Saiu junto o `shadow-xs`, que não é do vocabulário do §4.
- **Uma correção de produto, não de código:** re-adicionar uma pasta já
  cadastrada caía em "Projeto atualizado" — eu clico em ADICIONAR e o app EDITA
  um projeto existente em silêncio. Agora o diálogo avisa ANTES ("essa pasta já
  é o projeto X; confirmar atualiza o nome e a cor dele, não cria um segundo") e
  o botão passa a dizer **Atualizar projeto**. A ação é a mesma; o que mudou é
  ela não mentir sobre o que vai fazer.
- **Verificado:** `tsc -b` limpo, `vitest` 3461 (3 novos), `bun run check` 10
  guardas.

### ADR-120 — a pasta do projeto pode sumir, e o app passa a dizer isso ✅
- **Contexto (29/08/2026):** o projeto aponta pra uma pasta que o usuário move,
  renomeia ou apaga pelo Finder, sem o app saber. Ele seguia na lista como se
  estivesse tudo bem, e o erro só aparecia quando alguém tentava RODAR algo: o
  agent nascia num `cwd` inexistente e morria com uma mensagem do CLI, longe da
  causa. Diagnóstico caro pra uma verdade que um `stat` responde.
- **A régua é a do §5: não-configurado esconde; configurado com ERRO fica.** O
  projeto continua na lista, clicável (você pode querer ver as conversas dele),
  com o nome esmaecido e um selo **"pasta sumiu"** — e o motivo no tooltip.
  Sumir da lista seria pior: quem cadastrou aquilo merece saber por que parou de
  funcionar.
- **Dois problemas, duas frases.** "Não existe mais neste caminho" manda
  procurar; "existe, mas não é uma pasta" manda olhar o que está bem ali. Uma
  frase só faria o usuário caçar o que não sumiu. Tem teste exigindo que as duas
  sejam diferentes.
- **Confere em LOTE e só devolve o que está errado.** São `stat`s baratos; uma
  ida ao backend por projeto responderia N vezes a mesma pergunta, e o caso
  normal (nada quebrado) não custa tráfego nenhum.
- **Quando confere:** no boot e quando a lista de CAMINHOS muda. Não a cada
  render, e nunca em laço — pasta não some sozinha enquanto você olha pra tela.
  Quem move pelo Finder vê na próxima abertura, que é quando ele ia usar o
  projeto de novo.
- **"Não sei" não vira "quebrado".** Sem backend (ou com a chamada falhando), a
  resposta é lista vazia: marcar projeto bom como quebrado por falha NOSSA seria
  pior que o silêncio. Tem teste segurando isso, senão o app não cadastraria
  projeto nenhum em dev web.
- **O diálogo confere ANTES de criar.** O picker garante a pasta no instante do
  clique, mas entre escolher e confirmar cabe um `mv` — cadastrar um projeto que
  já nasce apontando pro vazio é criar o defeito em vez de evitá-lo.
- **Verificado:** `cargo` 593 (1 novo), `tsc -b` limpo, `vitest` 3464 (4 novos),
  `bun run check` 10 guardas.

### ADR-121 — posição do prompt é contrato do adapter, não comentário ✅
- **Contexto (29/08/2026):** os quatro transports CLI precisam de duas formas
  de posição. Claude, Codex e OpenCode deixam o prompt por último atrás de `--`;
  Agy põe `-p <prompt>` no meio, antes das demais flags. A ordem já falhou
  silenciosamente no Claude, quando flags posteriores ao separador viraram
  texto, e continua delicada no Agy, onde anexos precisam ser incorporados antes
  de o valor de `-p` entrar no `Command`.
- **A auditoria corrigiu o próprio OpenCode.** O adapter o tratava como último
  posicional sem separador, e pedido iniciado por hífen virava opção desconhecida.
  O fonte oficial 1.18.21 incorpora `args["--"]` ao pedido; probe local, travado
  antes de qualquer chamada por um diretório inexistente, confirmou que `--`
  entra no handler e que a forma antiga cai na ajuda. O fallback ganhou o
  separador em vez de eternizar o defeito na declaração.
- **Todo adapter CLI passa a declarar um `CliPromptContract`, sem default.** A
  declaração é interna ao Rust porque a UI não monta `argv` nem decide produto
  com esse dado. Adapter novo não compila sem escolher a convenção, e um teste
  único percorre o registry para cobrar prompt exato, ocorrência única e ordem.
  O runner ainda valida a forma antes de cada spawn desse fallback e falha
  fechado sem incluir o texto do pedido no erro.
- **A montagem continua local ao fornecedor.** Foi recusado o helper que sempre
  adicionaria o prompt no fim: ele quebraria o Agy, que ainda precisa acrescentar
  output format, timeout, diretórios, sessão, modelo e sandbox depois do pedido.
  O contrato torna a diferença executável pela CI sem fingir que as sintaxes são
  iguais.
- **Anexo é uma dimensão independente.** Claude e Agy citam o path no prompt e
  liberam a pasta; Codex usa `-i <path>` e preserva o texto. Cada transporte tem
  teste próprio. Inferir anexo da posição do prompt codificaria uma regra falsa.
- **Vazio é medido depois do filtro de anexos.** A Frota aceita turno só com
  imagem ou PDF, então texto vazio com arquivo vivo e suportado continua válido.
  Sem texto e sem anexo utilizável, o runner aborta antes do spawn. O carrier não
  é omitido: com stdin fechado, isso poderia selecionar modo interativo.
- **PA4 continua independente.** ACP/app-server envia o prompt em payload
  estruturado, não em posição de linha de comando. A X2 endurece o fallback CLI;
  não torna provider configurável e não cria espelho TypeScript sem consumidor.
- **Verificado:** `cargo` 599 (6 novos; 7 provas reais ignoradas por desenho),
  `vitest` 3496, `tsc -b` limpo, `bun run check` 13 guardas. No OpenCode
  1.18.21 com `opencode/mimo-v2.5-free`, o fallback completou dois turnos reais,
  inclusive um prompt iniciado por `--`, com resposta exata, exit 0 e custo
  reportado como zero.

### ADR-122 — rascunho é entidade durável, e a âncora observa o fio real ✅
- **Contexto (29/08/2026):** trocar de conversa apagava anexos ainda não
  enviados; o texto sobrevivia só na memória da sessão e não havia sinal na
  árvore. Na mesma superfície, uma conversa longa ainda podia abrir no meio
  mesmo depois do conserto de ancoragem.
- **A causa do scroll era identidade de nó, não posição.** O observador seguia
  `firstElementChild`, mas a régua de turnos ou a timeline podem vir antes do
  transcript. Além disso, o wrapper com `key={activeId}` é substituído na troca.
  Agora o wrapper entrega uma ref explícita ao hook; nó novo religa o
  `ResizeObserver`, e callback atrasado confere a conversa ativa antes de rolar.
- **Correção do gesto de envio (29/08/2026):** enviar uma mensagem humana
  também significa voltar ao presente. O gesto religa a âncora e aterrissa no
  fim antes de o novo turno crescer; scroll posterior continua sendo respeitado
  como intenção de leitura.
- **Correção da ordem terminal (29/08/2026):** `result` já persiste custo e
  resposta, mas o recibo só aparece depois de `done`. Durante o flush, o fio
  termina em “finalizando…”; depois ele troca esse estado pelo recibo. Assim a
  linha do tempo não declara conclusão antes do processo realmente assentar.
- **Rascunho virou entidade própria:** `conversation_drafts` guarda texto,
  metadados dos anexos e `updated_at`, separado de `items`. Nada entra no fio ou
  no prompt antes do gesto de enviar. A store do composer isola digitação do
  estado operacional do chat, grava com debounce e mantém cada conversa viva
  na troca; limpar ou enviar remove a linha.
- **Anexo pendente participa do ciclo de vida.** O blob já morava por conversa;
  agora a referência também persiste. O GC usa o maior timestamp entre a
  conversa e seu rascunho, portanto não apaga o anexo de um rascunho recente
  só porque o último turno da conversa é antigo.
- **A árvore diz “Rascunho” em cinza.** É metadado antes do slot de 36px, nunca
  uma nova cor nem concorrente da ordem `pede > rodando > falhou > quando`.
  Texto e anexo sem texto acendem o mesmo sinal; limpar apaga na hora.
- **Migração:** v40, um statement, mais `ensureComposerDraftTables` com
  `addColumn` idempotente para banco de teste/dev e upgrade interrompido.
- **Verificado:** testes focados de scroll, persistência e composer, além das
  suítes completas listadas na entrega desta frente.

### ADR-123 — o fio vira diário de bordo e a nota devolve espaço ao texto ✅
- **Contexto (29/08/2026):** a comparação visual com o Paseo mostrou que o
  Frota repetia atividade com cartão, fundo, filete, dois ícones, cor e recuo.
  O plano vivo repetia a elevação do composer; na gaveta, data, dois cabeçalhos
  e papel inteiro saturado comprimiam a área de escrita.
- **A atividade vira E0.** Grupo e plano vivo perdem cartão, sombra, fundo
  permanente e filete de estado. Um trilho neutro organiza o detalhe aberto.
  Linha técnica passa a ter um único glifo: movimento ocupa o slot enquanto há
  execução; depois, o ícone do tipo ocupa o mesmo lugar. A falha continua
  impossível de esconder, mas vermelho fica no glifo e no resumo, não pinta a
  linha inteira.
- **O plano continua junto ao composer, sem competir com ele.** A checklist
  preserva disclosure, teclado e verdade dos `TaskUpdate`, porém usa checks e
  spinner cinza. Não há novo dono do agora nem atividade inferida.
- **A cor da nota vira categoria, e isto revisa o ADR-117.** Os tokens continuam
  no ponto da lista e no seletor, onde distinguem notas; saem do fundo e da
  tipografia. O papel vivo era memorável no lugar errado: ocupava mais pixels
  que qualquer estado operacional da janela.
- **A gaveta de uma nota cresce para 440px, limitada pelo viewport.** Data vira
  carimbo curto de 11px mono, escopo perde ícone decorativo, controles seguem a
  escada canônica e o editor ganha mínimo de 160px. A ação diz `Usar no prompt`
  e não precisa de brilho para explicar o resultado.
- **Identidade:** a referência não foi copiada. O Frota preserva sua assinatura
  de cockpit no trilho operacional contínuo; Geist carrega prosa, Geist Mono
  carrega telemetria, e canvas/ink/muted/hairline formam a base. Cor fica para
  falha, decisão e categorias escolhidas pela pessoa.
- **Verificação:** testes de apresentação seguram seleção neutra, categoria sem
  fundo e tipografia do tema. Suítes completas e inspeção renderizada constam na
  entrega do commit.
- **Correção após uso real (29/08/2026): o plano vivo volta a E1.** Remover ao
  mesmo tempo fundo, borda e sombra fez o plano se fundir ao canvas e parecer
  texto solto acima do composer. A despoluição continua válida para a atividade
  dentro do fio, mas não para este instrumento operacional: ele recupera
  `bg-card`, aresta e `--shadow-sm`, abaixo do composer E2. Glifos e checks
  seguem neutros; não volta a cor ambiente nem a sombra de popover anterior.

### ADR-124 — compactar renova com memória recuperável e mostra a redução observada ✅
- **Contexto (29/08/2026):** uma renovação real do Codex abriu thread nova e
  reduziu o contexto, mas parecia não ter feito nada. A auditoria achou dois
  problemas independentes: a copy dizia apenas “não é mensurável”, e o caminho
  ainda usava `serializeContext` (30% do início + 70% do fim) mesmo depois do G1
  promover seleção por significado. Na conversa do incidente, 105 itens foram
  omitidos e só 4 de 7 pedidos humanos viajaram, embora os 7 somassem 1.630
  caracteres e coubessem com folga.
- **A renovação passa pelo G1.** `memoriaDaConversa` preserva primeiro intenção
  humana, decisões, falhas e estado atual; `orcamentoDaMemoria(...,
  "transplante")` deriva o teto da janela observada. O `/compactar` deixa de
  chamar o serializador posicional antigo.
- **O ponteiro pleno é pré-condição, não best-effort.** Antes do run, o Frota
  exporta o transcript para `.mycockpit/context/<convId>.md` e injeta o caminho
  na memória. Se a gravação falhar, não abre sessão nova: o transplante pendente
  é descartado e a sessão original permanece retomável.
- **Antes/depois só usa snapshot de contexto.** Quando os dois lados publicam
  `context_usage`, o marco mostra percentual e tokens observados (`65% → 10%`,
  por exemplo). Sem snapshot novo, diz que a medição não veio; custo, cache e
  uso acumulado nunca viram contexto por inferência.
- **Cobertura:** memória preserva pedidos do miolo e inclui o ponteiro; falha de
  export impede `runAgent`; copy cobre comparação completa e degradação sem
  número; matrizes de capability e transplante permanecem inalteradas.

### ADR-125 — o terminal do run não depende de EOF, e cancelamento reconcilia o estado real ✅
- **Incidente (29/08/2026):** o Agy parou de publicar no step 94, mas seu
  transcript interno avançou até o step 210 e gravou a resposta final. Um
  `python -m http.server` reparentado para PID 1 conservou os pipes e
  `MYCOCKPIT_RUN_ID`; o botão Parar fechou o navegador, mas não a árvore nem o
  turno no Frota.
- **Propriedade comum aos adapters:** CLI direto, Codex app-server e OpenCode
  ACP nascem em grupo próprio. O término observa também a saída do filho direto
  e limpa grupos/PIDs que carregam o id exato do run, inclusive backgrounds
  reparentados. A regra não compara fornecedor.
- **Reconciliação explícita:** `cancel_agent` informa se encontrou runner vivo.
  Se não encontrou, o frontend encerra o snapshot local com `cancelled` e
  `done`, persiste e fecha qualquer ferramenta sem resultado. Se encontrou, os
  eventos continuam vindo do runner. Na hidratação, ferramenta histórica sem
  desfecho também vira interrompida; restart nunca ressuscita um spinner que a
  nova instância não controla.
- **Recuperação específica, sem teatro:** somente o Agy tem transcript local
  autoritativo conhecido. Uma resposta `PLANNER_RESPONSE/DONE`, sem tool call e
  posterior ao último step recebido, pode voltar ao fio; o aviso deixa claro
  que as métricas não atravessaram a ponte. Ausência dessa prova continua sendo
  interrupção, nunca sucesso sintético.

### ADR-126 — tools são o domínio; MCP é materializador e todo run publica o manifesto efetivo ✅
- **Contexto (30/08/2026):** Integrações MCP misturava descoberta, binding,
  instalação permanente em CLI e posse de browser. Em uso real, Agy abriu um
  arquivo pelo app padrão do macOS (Firefox) e um Playwright global pôde abrir
  seu próprio browser, enquanto o Chromium da Frota era outro recurso. A UI
  mostrava toggles, não o conjunto efetivo recebido pelo run.
- **Comparação local:** Paseo mantém `PaseoToolCatalog` independente e o adapta
  tanto para MCP quanto para host tools nativas. Orca separa Browser de Computer
  Use, exige alvo estável e põe plugins atrás de manifest, capability,
  consentimento e processo supervisionado. A Frota preserva sua vantagem de
  adapters/eventos normalizados e o gesto humano como gate.
- **Decisão:** capability, tool, materializador, recurso e extensão são entidades
  distintas. O registry declara materializadores sem comparar ids de provider:
  nativo do provider, gateway da Frota e MCP externo, com transporte, escopo
  (`run/project/user/global`), força (`hard/advisory`) e evidência de inventário
  (`declared/runtime-count/probe/opaque`). Rust e TypeScript têm contrato-gêmeo.
- **Estado efetivo:** depois de subir gateways e aplicar a policy, mas antes do
  spawn, `run_manifest.rs` emite `AgentEvent::RunManifest`. O payload só contém
  identidade pública, tools observadas e força de controle. Launch, env,
  headers e credenciais não atravessam o Channel. O frontend mantém o snapshot
  efêmero e completa a contagem nativa pelo evento `session` quando disponível.
- **UI:** a faixa `Capacidades deste run` fica junto ao composer, soma apenas
  inventário observado e diz quais fontes dependem do provider. Assim
  Configurações descreve intenção durável, enquanto a conversa prova o resultado
  daquele run.
- **Recursos fail-closed:** marcar um binding como navegador significa exigir o
  Chromium possuído pela Frota. Sem endpoint vivo, o run bloqueia antes do
  spawn. Endpoint, `--browser` e `--headless` da origem saem da cópia efêmera;
  nenhum browser alternativo aparece silenciosamente.
- **Extensões:** skill, plugin, app e MCP não viram sinônimos. Plugin futuro terá
  manifest, capabilities mínimas, consentimento renovável e processo separado;
  Resource Broker tratará browser e Computer Use como recursos diferentes.
- **Migração:** o manifesto e a policy estrita entram primeiro. Inventário
  nativo, catálogo interno único, nova IA de Configurações, plugin host e broker
  completo seguem o plano em `capability-tooling-architecture.md`.

### ADR-127 — recursos e extensões têm posse explícita; descobrir plugin não autoriza execução ✅
- **Contexto (30/08/2026):** mesmo com o manifesto de tools, Configurações ainda
  colocava o ciclo de vida do Chromium dentro de MCP e não distinguia um
  Playwright global, capaz de abrir outra janela, do navegador possuído pela
  Frota. Skills compartilhadas e convenções nativas também não tinham uma visão
  única; “plugin” seguia sendo uma intenção sem fronteira de segurança.
- **Resource Broker v1:** `project-browser`, `external-browser` e
  `desktop-control` são recursos diferentes. O primeiro tem owner Frota,
  binding como evidência e enforcement forte. Os demais podem ser observados
  em configurações do provider por uma allowlist de identidade independente do
  adapter, mas permanecem advisory. Alias desconhecido não ganha claim por
  substring, e inventário opaco não vira promessa de ausência.
- **Manifesto v2:** recursos resolvidos entram no `run_manifest` fora da lista
  de MCPs, inclusive o claim bloqueado quando falta endpoint. Runs que preservam
  a configuração externa do provider carregam `unobservedResources=true`; uma
  lista vazia nunca comunica isolamento que não foi medido.
- **Configurações:** o rail expande apenas o domínio ativo. `MCPs` cuida de
  descoberta, health, autenticação e binding; `Navegador e desktop` mostra
  posse, processo e força de controle; `Skills e plugins` une o inventário
  efetivo por adapter sem chamar convenção nativa de agnóstica.
- **Plugin v1, fase segura:** `frota-plugin.json` usa schema fechado, engine/API
  gate, ids e paths contidos, capability allowlist e contribuição MCP gated por
  `mcp:provide`. Todo arquivo regular do pacote forma um fingerprint; symlink é
  recusado e limites de quantidade e bytes impedem varredura sem teto.
  O inventário lê pacotes em `app_data/plugins`, mas `executionSupported=false`
  é contrato: nenhum `main` roda antes de host fora do processo, env em allowlist,
  timeout/kill, host API gated e consentimento persistido pelo fingerprint.
- **Sem teatro de permissão:** a Frota não publica estado TCC de Accessibility
  ou Screen Recording enquanto não houver sonda nativa real. Um `computer-use`
  global fica visível como dependente do provider; visibilidade não é revogação.

### ADR-128 — grant renovável publica Tool Catalog; worker só existe durante a chamada ✅
- **Contexto (30/08/2026):** o inventário seguro da ADR-127 ainda parava antes
  da decisão útil. “Plugin validado” não dizia se havia consentimento, se o
  pacote mudara, se algum processo estava vivo ou o que um run receberia. Um
  toggle simples repetiria o defeito da antiga tela de MCP: intenção parecendo
  estado efetivo.
- **Grant exato e renovável:** a decisão persiste a combinação
  `(plugin_key, fingerprint, capabilities)`. Mudou qualquer arquivo regular do
  pacote, o estado vira `stale` e nada é publicado. Symlink e pacote acima dos
  limites falham fechados. Erro de leitura e identidade duplicada também não
  viram escolha implícita. Desativar preserva a revisão; revogar apaga o grant.
  Grant e auditoria são transacionais. As migrações 41 e 42 guardam grants e uma
  trilha recente limitada de eventos, sem credenciais ou payload de tool.
- **Discovery continua sem efeito:** abrir Configurações, redescobrir, revisar,
  habilitar e montar catálogo não executam `main` nem iniciam navegador. Plugin
  habilitado significa elegível sob demanda, não processo residente.
- **Um processo por chamada:** o worker nasce sem shell, em grupo próprio, com
  ambiente reconstruído por allowlist, protocolo JSON Lines fechado, frame de
  1 MiB, handshake e chamada com timeout, stderr drenado e encerramento
  TERM/KILL. A lista `ready.tools` precisa ser exatamente a do manifesto
  revisado. Uma segunda chamada concorrente ao mesmo plugin falha fechado.
- **Catálogo é domínio; MCP é transporte:** tools válidas ganham nome estável e
  namespaced no Tool Catalog. `agent.rs` consulta `McpEscopo::por_run`, não id de
  provider, e injeta `mc-tools` apenas onde a configuração pode nascer e morrer
  com o run. Claude não ganha auto-allow; Codex recebe todos os overrides antes
  de `exec` ou `app-server`.
- **Lease em vez de browser surpresa:** recurso é revalidado ao criar o catálogo
  e ao chamar. O Chromium do projeto precisa estar ligado e só seu endpoint CDP
  entra no ambiente efêmero. Outro browser é recusado e desktop aguarda broker
  nativo. Desabilitar, revogar, parar e sair do app liberam leases e encerram o
  runtime.
- **Fronteira de confiança honesta:** processo separado contém crash, timeout e
  órfão, mas não é sandbox completo do SO. Capabilities controlam o que a Frota
  publica e entrega; não prometem bloquear syscalls arbitrárias de código local.
  A revisão na UI diz isso antes de confirmar o fingerprint. Skills e MCPs de
  plugin permanecem apenas inventariados nesta versão; só tools estão efetivas.
- **Evolução posterior:** a ADR-130 materializa skills e MCPs sem alterar a
  fronteira de confiança desta decisão. Este parágrafo registra o estado da
  ADR-128 no momento em que ela foi fechada, não o estado atual do produto.
- **Verificação:** contratos Rust/TS, grants, protocolo, catálogo, adapters,
  manifesto efetivo e apresentação da revisão passaram nos testes focados;
  vitest completo passou em 335 arquivos e 3.549 testes, Rust passou 646 testes
  com 7 provas reais ignoradas por desenho, `tsc -b`, as 13 guardas do guia,
  `git diff --check` e rustfmt isolado dos módulos novos passaram. A inspeção
  visual não foi registrada porque os runtimes de controle de UI não estavam
  expostos nesta sessão; nenhum navegador alternativo foi aberto para contornar.

### ADR-129 - Dynamic Notch permanece protótipo até provar integração nativa ⚠️
- **Contexto (30/08/2026):** foi criado um protótipo React com janela
  transparente, preferências persistidas e uma aproximação de geometria do
  notch. A revisão independente encontrou uma divergência crítica entre o que
  Configurações prometia e o que o app fazia: o entrypoint fixava a posição no
  frontend, nenhuma preferência reposicionava a janela e a geometria Rust não
  consumia `NSScreen.safeAreaInsets` nem mudanças de monitor.
- **Decisão de produto:** o popover clássico de 360×430px continua sendo a
  superfície de produção. O protótipo e seus testes permanecem no repositório,
  mas não são carregados pelo entrypoint e seus controles experimentais não
  aparecem em Configurações. Persistir intenção sem efeito seria estado falso.
- **Gate nativo:** uma futura ativação exige presenter real por plataforma,
  geometria baseada em safe area, hotplug e DPI misto, janela compatível com o
  ciclo do macOS, fallback alcançável no Linux e teste no hardware suportado.
  O tamanho clicável da janela também precisa acompanhar o estado compacto.
- **Gate de dados e acesso:** o HUD deve consumir somente `TraySnapshot` real,
  preservar as informações e ações já disponíveis no `TrayPopover`, representar
  falhas de snapshot sem inventar “Frota pronta”, expor controles por teclado e
  respeitar movimento reduzido. Streak e matriz simulados não podem chegar à UI.
- **Verificação desta correção:** o entrypoint, o tamanho e a sombra da janela
  voltaram ao popover comprovado e os controles sem efeito saíram da seção
  Bandeja. A homologação visual do protótipo continua pendente porque o runtime
  de controle de UI não estava disponível; nenhum segundo navegador foi aberto
  para contornar essa ausência.
- **Evolução posterior:** a ADR-132 fecha os gates nativos, substitui o
  protótipo e reativa o instrumento como opt-in. Este texto preserva o estado e
  a decisão corretiva no momento da ADR-129, não o estado atual do produto.

### ADR-130 - plugins publicam skills e MCPs por run com proveniência verificável ✅
- **Contexto (30/08/2026):** o Tool Catalog da ADR-128 tornava tools efetivas,
  mas skills e definições MCP paravam no inventário. Instalar arquivos em cada
  CLI repetiria configuração, criaria precedência diferente por provider e
  faria um toggle parecer controle que a Frota não possuía.
- **Skills sem instalação:** um `SKILL.md` aprovado ganha o namespace
  `/publisher.plugin:skill` e é expandido pelo app para qualquer adapter. O
  claim viaja separado do texto; antes do spawn, Rust reabre o pacote e confirma
  grant, fingerprint, contribuição e nome. O manifesto v4 registra a instrução
  efetiva com escopo e força, sem persistir o corpo do prompt.
- **MCP por capability:** o código genérico pergunta `McpEscopo::por_run`, nunca
  compara fornecedor. Definições passam por schema fechado e health depois do
  gesto humano. Adapter incompatível recebe notice e não ganha instalação
  global. MCP stdio é inventariado por `tools/list`; HTTP continua opaco quando
  seu health não produz catálogo auditável.
- **Launcher supervisionado:** o provider recebe o binário da Frota e um
  descriptor 0600, não o executável do plugin. O launcher revalida pacote,
  fingerprint e grant, limpa o ambiente e limita frames antes de iniciar o
  servidor. Desabilitar impede runs novos; o MCP já entregue termina com o run
  atual, sem alegação de revogação instantânea.
- **Conformance antes do consentimento:** skill, definição MCP, capability,
  path e executabilidade são validados durante discovery. O `plugin-sdk` traz
  schemas v1 e um pacote executável que passa pelo parser e pelo probe MCP reais.
  O campo `$schema` é metadado conhecido pelo contrato fechado.
- **UI efetiva:** revisão explica o momento de cada efeito; a faixa do run
  separa instruções, tools, MCPs, recursos, inventário opaco e dependência do
  provider. Configurações continua sendo intenção durável; o run é a evidência.

### ADR-131 - um navegador por projeto admite um único piloto, observadores são livres ✅
- **Incidente:** uma integração global abriu outro Chrome e uma automação abriu
  conteúdo no Firefox, enquanto o Chromium possuído pela Frota existia em
  paralelo. Ter endpoint CDP não impedia dois atores de clicar na mesma página,
  e "ligado" não dizia quem tinha o controle.
- **Decisão agnóstica:** o Experience Broker arbitra `project-browser` por
  projeto, sem comparar provider. O owner pode ser um run, uma chamada de
  plugin ou a pessoa. Run e plugin seguram uma lease RAII pelo lifetime real;
  a pessoa recebe token com heartbeat e expiração de 15 segundos. Uma segunda
  tentativa falha antes do efeito e informa o owner por papel, sem expor ids.
- **Observação separada de pilotagem:** inventário de abas e screencast não
  exigem posse. Clique, scroll, teclado, texto, histórico e navegação validam o
  token humano em cada comando. Assim o painel pode acompanhar um agent sem
  disputar input e só oferece "Assumir controle" quando o broker está livre.
- **Fronteira CDP:** WebSocket de target nunca atravessa o backend. A Frota
  mantém apenas o último JPEG em memória; `browser-preview://frame` carrega a
  revisão, nunca base64. O inventário público nunca recebe a URL bruta e remove
  userinfo, query, fragmento e paths locais. Avisos de frame são coalescidos e
  pulls concorrentes são impedidos. Fechar painel interrompe screencast;
  desligar browser em uso por run/plugin é recusado.
- **Apresentação:** ligar cria Chromium isolado com `--headless=new` por padrão,
  portanto não nasce uma janela externa. O painel próprio mostra a mesma aba e
  o perfil continua persistente por projeto. Ciclo de vida é serializado por
  projeto e CDP escuta explicitamente em loopback. Não há iframe, child webview
  ou segundo browser como fallback.
- **Desktop:** o broker mede Screen Recording e Accessibility no macOS e só
  abre Ajustes após gesto humano. Permissão do SO não vira capability: enquanto
  não existir controller próprio por run, `controllerAvailable=false` e
  `desktop-control` permanece bloqueado. Linux declara o portal ainda ausente.

### ADR-132 - tray e HUD compartilham snapshot, mas geometria pertence ao backend ✅
- **Contexto:** o Dynamic HUD anterior fixava notch no React, inferia hardware
  por resolução, persistia controles sem efeito e mostrava uma matriz/streak
  inventada. A ADR-129 recolocou o popover clássico até existirem presenter e
  provas nativas.
- **Geometria real:** `notch.rs` lê frame, visible frame, escala,
  `safeAreaInsets` e áreas auxiliares de `NSScreen`. O intervalo entre as áreas
  auxiliares é o notch; sem ambas, não há notch. A conversão usa o topo do
  `CGMainDisplayID`, como o Tao, e preserva Y negativo para monitor acima da
  principal. Mudança de configuração de telas dispara recálculo. Linux usa
  monitores Tauri e nunca infere recorte.
- **Presenter:** `hud.rs` resolve posição pedida/efetiva e controla tamanho,
  posição, nível, Spaces, foco, sombra, vibrancy e visibilidade da janela. A
  área compacta é o hit target real; expandir muda a janela para até 540 × 320
  e a torna focável. Ler `hud_status` é sem efeito para não esconder o próprio
  popover clássico.
- **Opt-in e fonte única:** `hudEnabled=false` é o default. Preferências
  persistem somente no store global; o backend nasce desligado e recebe a
  intenção após hidratação. `notch` em tela sem recorte degrada para `island`
  com motivo visível. Desligado preserva o `TrayPopover` 360 × 430.
- **Paridade e acesso:** `TraySurface` escolhe o presenter pelo runtime nativo.
  O HUD usa somente `TraySnapshot`, incluindo todas as atividades visíveis,
  decisões, última conclusão, automações e sessões externas. Não há telemetria
  sintética. Botões, nomes acessíveis, `Escape` e movimento reduzido fazem parte
  do contrato.

### ADR-133 - retenção tem orçamento, mas o trabalho do usuário não ganha teto ✅
- **Incidente (30/08/2026):** durante `codex exec resume`, o macOS abriu o
  painel de pressão de memória com mais de 40 GB atribuídos à árvore do Frota.
  O rollout tinha 85.223.130 bytes, 1.207 tool calls e 15 compactações. Os dois
  WebViews ficaram abaixo de 400 MB e 26 MB; o processo foi encerrado pelo gesto
  humano, portanto não sobrou `vmmap` que separasse heap do filho e buffer do
  pai. A causa exata dessa divisão permanece não afirmada.
- **Fronteira limitada:** stdout usa frames de no máximo 64 MiB antes do parse.
  stderr é drenado em chunks crus e conserva somente a cauda de 64 KiB, sem a
  alocação ilimitada de `lines()` nem uma `String` cumulativa. O contrato vale
  para CLI direto, Codex app-server e OpenCode ACP.
- **Watchdog agnóstico sem nerf:** cada transporte mede a cada cinco segundos o
  RSS somado do backend e do filho direto. Publica avisos ao cruzar 2, 4, 8, 16
  e 32 GiB, mas não pausa, mata, troca motor, reduz contexto nem remove tools.
  `Parar` continua sendo gesto humano; o app não promete RAM física infinita.
- **Preflight por capability:** quando `ContextUsageSource::CodexRollout`
  declara que o histórico nativo é observável, o Frota procura apenas nome e
  metadata no `CODEX_HOME`. Acima de 64 MiB, avisa e oferece o gesto
  `/compactar`, mas inicia normalmente; não lê, corta, move nem apaga o rollout.
  Inventário ausente degrada para o watchdog, sem declarar a sessão segura.
- **Comparação local:** Paseo limita retenção e backpressure, não o volume de
  trabalho: logs de plugin têm cauda por bytes/linhas e sockets abandonados têm
  fila de 64 MiB, enquanto um cliente que drena continua recebendo output sem
  snapshot forçado. Orca mede RSS por árvore, coalesce a varredura e expõe a
  ação de encerrar à pessoa; seus relays limitam filas e reconectam para replay,
  não impõem um teto de memória ao agent. O Frota adota essa mesma separação:
  memória interna é limitada, capacidade do motor é observada.
- **Correção correlata do HUD:** a auditoria também provou que o plano dizia
  “coalescido”, mas cada notificação de tela criava uma task. O presenter agora
  usa um worker único, debounce de 75 ms e geração; evento durante o recálculo
  produz no máximo uma passada final. O HUD continua opt-in e não participou do
  episódio de memória.

### ADR-134 - o notch é parte da forma, não um popover sobre a tela ✅
- **Evidência visual (30/08/2026):** o primeiro build nativo provou geometria e
  conteúdo reais, mas mostrou um cartão branco com quatro cantos arredondados,
  o nome técnico `Built-in Retina Display`, uma automação truncada e um botão
  `Recolher`. A janela estava no lugar certo e ainda parecia solta do recorte.
- **Casco físico:** no modo notch, o instrumento usa preto absoluto em qualquer
  tema. O topo encosta em `y=0`, sem raio, margem ou filete; somente a saída
  inferior curva. Ilha e posições laterais continuam temáticas porque não há
  hardware preto a prolongar.
- **Faixa visível:** o compacto tem a própria altura do `safeTop`, com mínimo
  de 28 px, sem empilhar outra faixa abaixo do recorte. A largura medida ganha
  64 px de respiro lateral; a área nativa continua igual à área visível e não
  cria hit target fantasma. Uma coluna central com `notchWidth` fica sem
  conteúdo; as asas mostram somente marca e estado por glifos, enquanto texto
  completo permanece no nome acessível e no painel expandido.
- **Gesto:** sair com o ponteiro recolhe o expandido. Clique ainda pede foco
  para teclado e `Escape`, mas não fixa o painel nem exige um controle de
  `Recolher`. Apontar expande em 90 ms. O cabeçalho mostra estado da frota, não
  o nome interno do monitor.
- **Transição nativa:** o QA provou que `acceptsMouseMovedEvents` não basta no
  `WKWebView` compacto sem foco. Um único worker dentro do app, dormente quando
  o HUD não está elegível, lê o ponteiro a cada 50 ms e pede expansão após 90
  ms dentro do frame. O frame muda com a animação do AppKit e o conteúdo usa
  fade curto; `Escape` exige uma saída e nova entrada antes de reabrir. O
  movimento do conteúdo continua governado por `MotionConfig`.
- **Conteúdo:** nomes de automação quebram em linha em vez de truncar. Nenhuma
  telemetria, limite ou ação do motor muda; esta decisão é somente forma,
  legibilidade e gesto do presenter.

### ADR-135 - HUD flutuante e ícone da barra de menus são portas exclusivas ✅
- **Contexto (30/08/2026):** o QA no hardware mostrou o casco do notch ao lado
  do ícone da Frota na barra de menus. Ambos abriam o mesmo `TraySnapshot` e as
  mesmas ações, portanto a duplicação não acrescentava alcance nem informação.
- **Decisão:** depois que o presenter flutuante é mostrado com sucesso, o
  backend oculta o ícone da barra de menus. Ao desligar o HUD ou resolver para
  `menubar`, esconde a janela e restaura o ícone clássico. A transição preserva
  primeiro a porta de destino, para uma falha não deixar a pessoa sem acesso.
- **Escopo:** a exclusividade vale para notch, ilha, laterais e base. Snapshot,
  menu, keep-alive ao fechar, automações, agents, modelos, contexto, tools e
  limites permanecem iguais; muda apenas qual porta visual apresenta o estado.

### ADR-136 - posições de borda pertencem ao frame físico da tela ✅
- **Incidente visual (31/08/2026):** num monitor externo sem notch, “Ilha no
  topo” aparecia em `visibleY + 8`, abaixo da barra de menus, como um cartão
  solto. Na direita, uma janela de 28 × 128 px tentava acomodar texto em escrita
  vertical e mostrava apenas uma lâmina cortada.
- **Geometria:** ilha, laterais e base usam o `frame` físico medido, não o
  `visibleFrame` reservado por barra e Dock. A ilha encosta no topo; esquerda e
  direita encostam na respectiva aresta e centralizam no frame; a base encosta
  embaixo. Ao expandir, a janela preserva a mesma aresta, sem margem interna que
  desfaça o acoplamento.
- **Forma:** a aresta contra a tela é reta e não recebe filete. Só os cantos
  voltados para dentro arredondam. Nas laterais, o compacto mede 36 × 64 px e
  mostra marca + glifo de estado; o texto completo continua no nome acessível e
  aparece depois do hover ou clique. Não se gira nem se trunca copy em 36 px.
- **Comparação local:** Orca e Paseo não trazem um presenter equivalente para
  copiar. A regra aproveitável do Paseo é tratar obstrução e chrome pela região
  física realmente ocupada, em vez de inferir um layout compacto global.
- **Escopo:** posição, forma e hit target mudam juntos. Snapshot, hover nativo,
  ações, foco, automações, execução, contexto, tools e limites não mudam.

### ADR-137 - o instrumento flutuante é preto absoluto em qualquer tela ✅
- **Correção de linguagem (31/08/2026):** a ADR-134 restringia o `hud-shell`
  ao notch físico e deixava ilha, laterais e base seguirem o tema do app. No
  tema claro, o mesmo instrumento virava uma peça branca ao mudar de monitor e
  deixava de pertencer visualmente à integração com o notch.
- **Decisão:** todo presenter flutuante usa `hud-shell` (`#000000`) e força o
  vocabulário escuro, independentemente do tema da janela principal ou de a
  tela informar um recorte físico. Ilha, esquerda, direita e base variam forma
  e conteúdo compacto, não a cor do casco.
- **Fronteira:** o preto pertence somente ao instrumento flutuante. Popover da
  barra de menus, dialogs, cartões e o restante do app continuam obedecendo ao
  tema escolhido pela pessoa. Nenhuma ação, execução ou capacidade muda.

### ADR-138 - altura e hover seguem a geometria efetiva de qualquer tela ✅
- **Incidente visual (31/08/2026):** numa tela sem notch, a ilha recolhida de
  36 px ultrapassava a faixa realmente reservada pelo macOS. O hover expandia,
  mas o observador nativo parava de acompanhar o ponteiro assim que o runtime
  virava `expanded`; se o WebView não publicasse `pointerleave`, o painel só
  recolhia depois de novos cliques.
- **Geometria sem identidade de monitor:** a ilha mede a diferença entre o topo
  do `frame` e o topo do `visibleFrame` da tela efetiva e nunca passa de 32 px.
  Se o sistema não reservar faixa superior, mantém 32 px como alvo compacto.
  Nome, fabricante, resolução, escala e a distinção entre tela interna ou
  externa não participam da decisão. Troca de tela, rotação, DPI e arranjo
  continuam recalculando a mesma função.
- **Origem da expansão:** hover e clique no próprio instrumento são expansões
  transitórias; a abertura explícita em Configurações não é. O worker nativo
  continua medindo o frame expandido somente no caso transitório, pede o fade
  depois de 260 ms fora e, iniciado o fechamento, só rearma depois de observar
  o ponteiro realmente fora do compacto. O resize ocorre após a transição curta
  já existente no frontend, sem interpretar o frame em animação como entrada.
- **Escopo:** a regra vale para notch, ilha, laterais e base porque o worker usa
  o `layout_for` da posição efetiva. Estado da frota, ações, foco de teclado,
  agents, contexto, tools, desempenho e limites do motor não mudam.

### ADR-139 - o destino do instrumento é uma escolha nominal e restaurável ✅
- **Problema:** o booleano "Seguir a tela ativa" só permitia alternar entre a
  tela sob o ponteiro e a primeira tela enumerada. Em setups com dois ou mais
  monitores, não existia um gesto que dissesse em qual tela o instrumento deve
  permanecer, e a ordem de enumeração não é uma identidade de produto.
- **Decisão:** Configurações oferece uma única escolha `Tela do instrumento`:
  modo automático ou cada tela medida pelo presenter nativo. A intenção fixa é
  persistida em `hudScreenId`; no macOS, o valor vem do UUID do display, nunca
  do `CGDirectDisplayID` efêmero. O runtime publica também a lista completa de
  telas e continua sendo a fonte da tela e posição efetivas.
- **Hotplug:** se o identificador escolhido não estiver disponível, o presenter
  usa temporariamente a tela ativa (ou a primeira disponível), mostra o motivo
  e não apaga a preferência. Quando o display volta, o mesmo recálculo por
  mudança de configuração restaura a escolha sem novo gesto.
- **Modo automático no macOS:** enquanto o instrumento está compacto, o mesmo
  worker que lê o ponteiro para hover compara o ponto com os frames já medidos.
  Ao atravessar para outra tela, recalcula uma vez e move o presenter; não
  enumera monitores a cada tick. Painel expandido não salta durante interação,
  e uma escolha nominal desarma completamente esse acompanhamento.
- **Compatibilidade:** o booleano anterior continua no contrato durante a
  transição para preservar quem já havia desligado o acompanhamento. Uma nova
  escolha escreve os dois campos de forma coerente; não há migração de banco.
- **Escopo:** muda somente a resolução de geometria do presenter. Snapshot,
  hover, foco, tarefas, automações, agents, contexto, tools, desempenho e
  limites continuam intactos.

### ADR-140 - horário autoritativo de reset nunca recebe teto de backoff ✅
- **Incidente real (31/08/2026):** o SQLite registrou o limite da Claude às
  11:29:04 com `reset_hint` `2:30pm (America/Sao_Paulo)`, seguido de um
  auto-resume às 11:30:05. O parser aceitava duração, ISO e epoch, mas não o
  relógio civil com fuso que o adapter já preservava. A ausência virava
  backoff de 60 segundos e consumia tentativa antes das 14:30.
- **Segunda causa:** mesmo um horário entendido era truncado em 15 minutos.
  Esse teto pertence somente ao backoff estimado, quando nenhum prazo
  confiável existe. Relógio, duração, ISO ou epoch reconhecidos mantêm o
  prazo integral, com dois segundos de folga depois do reset. Em nova recusa,
  o backoff da tentativa é um piso, nunca um teto, para não criar loop rápido
  na borda do minuto anunciado.
- **Contrato temporal:** relógio de 12 horas com fuso IANA resolve a próxima
  ocorrência civil no fuso informado, inclusive mudança de offset. Até cinco
  minutos depois do minuto declarado ainda pertence à mesma janela e espera
  pelo menos o backoff; fuso ou forma inválida degrada sem derrubar o turno.
- **Despoluição:** o limite continua sendo o único incidente âmbar no fio.
  A faixa ativa junto ao composer ficou neutra porque auto-resume não espera
  decisão humana; ela informa horário e próxima tentativa. Revezamentos são
  ações secundárias neutras, sem três pílulas brass competindo entre si.

### ADR-141 - o centro do instrumento segue a próxima decisão humana ✅
- **Direção aprovada (31/08/2026):** a variação D, Instrumento vivo, substitui
  o conteúdo expandido do HUD. Ela combina o tempo e o trilho da Pista de voo
  com a composição silenciosa do Foco adaptativo. Compacto, popover clássico,
  presenter, geometria e escolha de tela não mudam.
- **Prioridade:** leitura indisponível nunca vira prontidão; confirmação local
  vence decisão pendente, que vence atividade, último turno e vazio. A regra é
  função pura sobre `TraySnapshot` e intenção local, sem nome de provider.
- **Decisão honesta:** o HUD confirma localmente `Parar`, mas não inventa o
  conteúdo de pedidos dos agents. O snapshot atual só autoriza mostrar
  contagem, natureza e destino; responder continua na conversa aberta por
  gesto humano.
- **Estado real:** `Parar tarefa` não produz efeito. `Parar agora` emite a ação,
  e somente a ausência posterior da atividade confirma a interrupção. Falha ou
  ausência de confirmação permanece visível.
- **Assinatura visual:** o trilho comunica presença viva, nunca progresso. Seu
  movimento pertence ao CSS e some em movimento reduzido; não nasce intervalo
  periódico, store subscription, worker, migração ou limite operacional novo.
- **Implementação (31/08/2026):** N6 de `docs/dynamic-notch-plan.md`. O seletor
  e o reducer puros cobrem prioridade, foco estável e reconciliação da parada;
  compacto e expandido foram separados; a composição D usa a pista viva em
  CSS e conserva os `TrayAction` existentes. As suítes completas, o build
  Tauri e o QA visual do estado assentado no notch físico foram registrados.
  Os demais estados visuais permanecem discriminados no plano entre prova de
  render e observação no hardware.

### ADR-142 - recibo é histórico, título de conversa é estado vigente ✅
- **Incidente real (31/08/2026):** o título da conversa foi corrigido para
  `Revisão de branches` no SQLite, mas o HUD continuou mostrando a cópia antiga
  `revisao de branches` guardada no feed de notificações. A build e o processo
  instalados estavam corretos; duas fontes legítimas respondiam perguntas
  diferentes com o mesmo campo.
- **Decisão:** horário, desfecho e recibo continuam congelados no evento. HUD e
  Companion resolvem o título atual pelo `convId` e `projectId`, com fallback
  para a cópia do feed quando a conversa não está carregada. Nenhum histórico é
  reescrito e nenhum texto escrito pela pessoa é autocorrigido.
- **Reatividade:** a assinatura da tray observa tanto o último evento quanto a
  meta vigente da conversa. Carregamento e renomeação atualizam o instrumento
  imediatamente, sem criar ticker, worker ou consulta extra ao SQLite.

### ADR-143 - incidente terminal é uma sequência factual no fio ✅
- **Problema:** limite e erro terminal eram cartões tingidos que repetiam a
  urgência em fundo, borda, ícone, título, telemetria e várias ações. A
  superfície parecia um alerta genérico e escondia a causalidade que a pessoa
  precisa ler: o turno encerrou, a conversa foi preservada e há ou não uma
  informação de retorno.
- **Decisão:** o incidente vira uma sequência E0 de três fatos, com trilho
  neutro, estático e sem semântica de progresso. Somente o primeiro marcador
  recebe a cor do estado, âmbar para limite esperado e vermelho para falha
  real. O horário do grupo continua sendo o único carimbo do incidente;
  retorno informado usa somente o `resetHint` recebido, nunca disponibilidade
  inferida, contagem ou `agora`.
- **Disclosure:** causa crua, telemetria e feedback permanecem auditáveis em
  `Detalhes técnicos`. Os destinos de revezamento saem das pílulas simultâneas
  e entram num único menu neutro, preservando os mesmos IDs e o mesmo gesto
  humano que inicia o handoff transacional.
- **Consequência:** eventos, `IncidentNode`, auto-resume, custo, limites,
  contexto e liberdade de uso não mudam. A implementação divide
  `MessageList.tsx`; a catraca de tamanho só pode descer.

### ADR-144 - o Dock restaura a janela principal, não o instrumento ✅
- **Incidente real (31/08/2026):** com o instrumento flutuante ativo, clicar no
  ícone do Frota no Dock apenas focava o HUD. A janela principal só voltava
  pelo controle `Abrir Frota` dentro do instrumento. O fechamento colocava o
  processo em `ActivationPolicy::Accessory`, enquanto `App::run` não tratava
  `RunEvent::Reopen`.
- **Decisão:** Dock e `Abrir Frota` convergem para uma única restauração de
  `main`: preparar o instrumento, restaurar `Regular`, mostrar, desminimizar e
  focar a janela principal. No evento `Reopen`, `has_visible_windows` não
  bloqueia o gesto, porque o AppKit também conta o HUD auxiliar como janela
  visível.
- **Ciclo de vida:** fechar com `Continuar ao fechar` mantém `hide + Accessory`;
  minimizar continua sendo a minimização nativa e nunca vira fechamento;
  sair continua passando por `ExitRequested` e pela limpeza dos processos. O
  popover clássico fecha ao abrir `main`; o HUD flutuante apenas recolhe, fica
  visível e deixa de ser focável.
- **Consequência:** a correção é específica do ciclo nativo do macOS e não cria
  listener React, plugin de instância, daemon ou regra por monitor. Atividade,
  escolha de tela, snapshot, agents, limites e comportamento Linux não mudam.
- **Correção do gate (01/09/2026):** o snapshot já tratava candidaturas de
  disputa em `finalizing` como atividade, mas omitia esse mesmo estado no turno
  linear. A tray passa a contar `running || finalizing`; assim, “Frota pronta”
  e o gate de build só aparecem depois que recibo e persistência assentarem.

### ADR-145 - a captura do ditado pertence ao microfone, não à saída de som ✅
- **Incidente real (01/09/2026):** com `Microfone (MacBook Pro)` selecionado na
  Frota e um fone Bluetooth na saída do macOS, o ditado não recebia voz. Ele só
  voltou depois que a pessoa trocou a saída para `Alto-falantes (MacBook Pro)`.
  A segunda imagem era o seletor de **saída**, prova de que uma decisão externa
  ainda alterava uma entrada que a UI mostrava como explícita.
- **Causa:** `AVAudioEngine.inputNode` nasce sobre o
  `CADefaultDeviceAggregate`, que combina a rota padrão de entrada e saída. O
  `AudioUnitSetProperty(CurrentDevice)` retornava `noErr`, mas isso só provava a
  propriedade aceita, não que os buffers seguintes estavam isolados da rota
  Bluetooth. A entrega de 24/08 validou enumeração, compilação e suítes, não um
  buffer real com entrada e saída divergentes.
- **Decisão:** o sidecar usa `AVCaptureSession` + `AVCaptureDeviceInput` para
  capturar. Essa sessão só tem entrada: o `uniqueID` escolhido abre o device
  nominal diretamente e a saída do macOS não participa do grafo. O discovery
  do AVFoundation expõe nesta máquina os mesmos UIDs estáveis já persistidos,
  portanto não há migração nem perda da preferência.
- **Prova antes de prontidão:** `ready` só sai depois do primeiro
  `CMSampleBuffer`, e carrega `deviceUid` e `deviceName` do input realmente
  adicionado. O Rust continua compatível ao ler `ready`, mas o protocolo passa
  a ter evidência suficiente para diagnóstico sem confiar na tela ou em
  `noErr`. Device ausente ou impossível de abrir continua caindo no padrão com
  `warn`, sem apagar a escolha. Aviso emitido antes do primeiro buffer é
  preservado pelo Rust até o `stop`, em vez de sumir durante a espera do ready.
- **D1/D2 preservados:** cada sample buffer alimenta o streaming e é copiado
  para o mesmo CAF temporário, normalizado em Float32 porque Bluetooth HFP
  entrega Int16/16 kHz e o `ExtAudioFile` abortou ao receber esse formato
  diretamente. No STOP, o drain ainda ocorre com o microfone aberto; depois vêm
  `endAudio`, parada da sessão, flush do arquivo e releitura completa. A mudança
  é a fonte dos buffers, não o contrato de texto.

### ADR-146 - prontidão do ditado exige identidade, sinal e linha de vida ✅
- **Problema:** depois de isolar entrada e saída, `ready` já carregava o device
  real, mas o Rust descartava essa evidência. A interface repetia apenas a
  intenção das Configurações, não mostrava nível de entrada, não reagia à perda
  do device durante a sessão e não permitia cancelar os até 90 segundos de
  abertura. Além disso, a promessa "100% local" ainda aceitava criar requests
  sem `requiresOnDeviceRecognition` quando o locale não declarava suporte.
- **Contrato de início:** a sessão Rust passa por `Starting(id)` antes de esperar
  permissões e primeiro buffer. `stt_cancel` alcança tanto essa fase quanto
  `Active`; o identificador impede que a conclusão atrasada de uma tentativa
  cancelada mate uma nova. O resultado de `stt_start` contém `deviceUid`,
  `deviceName` e eventual fallback, todos produzidos pelo sidecar que abriu a
  entrada. `ready` sem identidade não conta como sucesso.
- **Correção concorrente (02/09/2026):** a identidade da tentativa passa da
  superfície ao Rust e volta em todo evento (`level`, `partial`, perda e fim).
  Assim, os vários botões montados não consomem eventos da sessão global que
  pertence a outro. `Stopping(id)` mantém essa sessão reservada durante drain,
  releitura e cancelamento. O rascunho de destino é fixado no início para uma
  navegação não deslocar a transcrição para outra conversa. O atalho também
  conserva o botão escolhido no `keydown`; o `keyup` nunca para uma superfície
  que apareceu depois.
- **Sinal real:** o sidecar calcula RMS dos buffers Float32, Float64, Int16 ou
  Int32, converte a escala de -60 dB a 0 dB em `0...1` e publica no máximo dez
  amostras por segundo. O pill mostra medidor neutro e nome efetivo; não há
  movimento inventado no medidor sem áudio. Sessão vazia com pico abaixo de -66 dB
  devolve aviso acionável sobre a entrada do macOS.
- **Perda de captura:** desconexão do device, interrupção ou erro do
  `AVCaptureSession` iniciam uma única finalização pelo mesmo pipeline do STOP.
  A UI avisa imediatamente, aproveita o texto acumulado e sai do falso estado
  de escuta quando o sidecar encerra.
- **Privacidade fail-closed:** streaming e releitura de arquivo sempre exigem
  reconhecimento on-device. Se Português (Brasil) não o suportar, o início
  falha com o caminho de Ajustes em vez de permitir fallback de rede. A
  enumeração, a preferência estável e D1/D2 não mudam.
- **Prova de ponta (02/09/2026):** um bundle isolado da Frota enumerou cinco
  entradas reais, abriu `BuiltInMicrophoneDevice`, publicou o nome
  `Microfone (MacBook Pro)`, RMS e parcial reais, concluiu por STOP, reabriu e
  cancelou por Esc. O app principal e seu banco permaneceram intocados. A
  comparação com Paseo confirmou a mesma fronteira: identidade por ditado em
  todo evento e finalização aceita antes de liberar a próxima captura.

### ADR-147 - preflight de capability não é execução do agent ✅
- **Incidente real (01/09/2026):** um binding Playwright opcional, configurado
  para usar o navegador da Frota, impediu uma conversa que não exigia browser.
  Nenhum processo do provider nasceu, mas `Error + Done` fabricou “Execução
  interrompida” e encerrou um turno inexistente.
- **Policy:** `browser` escolhe o transporte possuído pela Frota; somente
  `required` torna a capability pré-condição. Ausência opcional omite o MCP do
  run, nunca abre o navegador original e fica auditável no manifesto. Ausência
  exigida vira gate tipado antes do turno; `ask`, `deny` e consentimento de
  leitura mantêm consequências distintas e qualquer override vale por um envio,
  revalidado por fingerprint e origem.
- **Aceite:** `run_manifest` é a fronteira transacional. Antes dele, o pedido e
  anexos continuam no composer e não há mensagem, transplante, sessão, custo,
  conclusão, sugestão, notificação ou auto-resume. Chat, mesa, agenda, Fusion,
  SDD, compactação e conselheiro obedecem à mesma fronteira.
- **Evidência de início:** `started` prova que o transporte recebeu o pedido.
  Falha entre manifesto e spawn vira `startup_failed` e o fio mostra o marco
  neutro “Turno não iniciado”, nunca incidente terminal. `Error` e
  `LimitReached` permanecem reservados à execução que nasceu.
- **Decisão humana:** recuperações são uma união fechada publicada pelo backend.
  A interface oferece no máximo uma ação primária e não habilita navegador,
  reduz permissão ou ignora requisito sem gesto explícito. O mecanismo não muda
  modelos, contexto, limites, custo ou liberdade operacional.

### ADR-148 - identidade do usuário, avatar local-first e preferências de interação ✅
- **Contexto:** o rodapé da barra lateral e o cabeçalho de boas-vindas do chat
  mantinham o nome "Vinícius" e a inicial "V" fixados no código. O gutter de
  mensagens do usuário no chat exibia um ícone estático genérico e o rótulo "Você",
  sem mecanismo de personalização visual ou preferências de interação no composer.
- **Decisão:** introduzir a seção canônica "Perfil" (`profile`) nas Configurações
  do app, sob o grupo Interface. A identidade suporta quatro modalidades
  estritamente locais e sem chamadas externas de rede: (1) foto do usuário
  recortada e otimizada via canvas para Data URI compacta (~20 KB), (2) avatares
  procedurais DiceBear offline com estilos e sementes personalizáveis,
  (3) iniciais com paleta do app e (4) ícone minimalista. O rodapé da barra lateral
  torna-se um ponto de acesso acessível por clique e teclado, abrindo diretamente a
  seção de perfil. O composer ganha suporte à alternância de atalho de envio
  (Enter envia vs ⌘+Enter envia) e opção de alerta sonoro sutil sintetizado via Web
  Audio API ao concluir turnos.
- **Correção de auditoria (02/09/2026):** instalação nova não recebe nome ou
  inicial de uma pessoa específica; começa com ícone neutro. Foto persistida só
  chega ao WebView quando é uma Data URI raster permitida, nunca uma URL ou SVG;
  estado legado adulterado degrada para o avatar local. Os seletores expõem o
  estado pressionado, a foto é decorativa quando o nome já está ao lado e a
  demonstração do alerta informa quando o áudio não pôde ser reproduzido.
- **Consequência:** identidade local-first e sincronizada no store persistido;
  retrocompatibilidade garantida por merge profundo dos campos do perfil e das
  preferências; zero dependência de rede ou serviços externos; conformidade com
  as escalas de controle e tipografia do STYLEGUIDE.

### ADR-149 - superfícies de mensagem no chat: cartão neutro E1 do agent e ações de hover no prompt do usuário ✅
- **Contexto:** a resposta do agent no fio da conversa era renderizada como prosa solta
  diretamente no canvas da página, gerando assimetria visual em relação ao balão do
  usuário e sensação de "texto solto na parede". Paralelamente, o balão de prompt do
  usuário não possuía ações de turno no hover, exigindo redigitar comandos ou buscar
  itens na árvore para reenvios e bifurcações rápidas. Uma exploração inicial com
  filete colorido no canto esquerdo foi analisada e descartada por violar as guardas de
  barra de acento (§2, §4 e ADR-043), que proíbem tinta decorativa no conteúdo do fio.
- **Decisão:** (1) Padronizar a resposta do agent no cartão de superfície neutra E1
  (`AgentMessageCard`), utilizando fundo de cartão (`bg-card`), aresta estrutural
  canônica de hairline neutro (`border border-border/40`), cantos orgânicos espelhados
  (`rounded-2xl rounded-tl-md`) e zero filetes coloridos. (2) Implementar ações rápidas
  no hover da mensagem do usuário (`UserMessageBubble`): botão de editar e reenviar
  (carrega o texto no composer via `useComposerDrafts.setText` com foco imediato), botão
  de bifurcar conversa (via `useChat.forkConversationAt`) e botão de cópia de texto com
  feedback de confirmação. (3) Extrair `UserMessageBubble` e `AgentMessageCard` de
  `MessageList.tsx`, reduzindo 36 linhas do arquivo principal e apertando a catraca da
  baseline de tamanho de arquivo (`check-file-size-ratchet`).
- **Consequência:** coerência visual total entre emissor e receptor no chat; aumento da
  ergonomia de refinamento e edição de prompts; respeito absoluto à austeridade do
  cockpit e ao vocabulário de cores funcionais (cinza para o caso comum saudável, tinta
  apenas em decisões pendentes ou falhas).
- **Correção de auditoria (02/09/2026):** `forkConversationAt` devolve se a
  bifurcação realmente foi criada. A ação no balão aguarda essa aceitação e só
  acusa falha real; nunca anuncia sucesso antes da gravação no banco.

### ADR-150 · coalescimento do cabeçalho de autor no turno vivo e correção do defeito B4 ✅
- **Contexto:** quando o executor (Antigravity/AGY, Claude Code, Codex) iniciava um turno
  executando diretamente ferramentas antes de emitir prosa, o nó de ferramentas (`type: "tools"`)
  era agrupado com o cabeçalho completo do executor (avatar e nome). Simultaneamente,
  `WorkingIndicator` no rodapé desenhava seu próprio gutter, avatar e nome, gerando dois
  avatares empilhados a ~40px de distância para o mesmo agente no mesmo turno (defeito B4
  de `fio-poluicao-2.md`). No CLI do AGY, que opera por chamadas silenciosas de ferramentas sem
  `text_delta` prévio nem thinking no chat, esse sintoma era sistemático e gerava a ilusão de
  uma "mensagem falada vazia contendo apenas ferramentas".
- **Decisão:** (1) As ferramentas pertencem legitimamente ao agente executor e não devem ser
  desatribuídas; o erro era a fragmentação em dois blocos de identidade concorrentes. (2) Dotar
  o `WorkingIndicator` de modo `inline`, renderizando apenas a linha viva (rótulo, pulso de
  pontos e cronômetro de tempo decorrido) sem duplicar gutter, avatar nem nome. (3) No
  `MessageList`, quando o turno estiver ativo (`running || finalizing`) e o último grupo da lista
  pertencer ao executor, a linha viva de `WorkingIndicator` é coalescida como cauda dos corpos
  do grupo (`workingTail`), morando sob o mesmo recuo e sob o mesmo e único avatar do executor.
  (4) Quando o último grupo não for do executor (ex.: início imediato após mensagem do usuário),
  o `WorkingIndicator` preserva a renderização standalone, apresentando o agente que iniciou o
  trabalho. (5) Extrair o componente `GroupRow` de `MessageList.tsx` para `GroupRow.tsx`,
  encolhendo `MessageList.tsx` em 67 linhas e apertando a catraca da baseline de tamanho.
- **Consequência:** eliminação completa da duplicação de avatares no fio vivo; representação
  fiel da hierarquia de execução (ferramentas e indicador de progresso sob a mesma identidade
  de turno); conformidade estrita com o STYLEGUIDE §6 ("dono único do agora") e §10 (divisão de
  arquivos). Quando a chegada de um conselheiro também está viva, ela interrompe o
  coalescimento e o indicador do executor permanece no fim cronológico do fio.

### ADR-151 · restauração da prosa sóbria e contínua do agent (reversão do AgentMessageCard) ✅
- **Contexto:** o experimento do ADR-149 introduziu `AgentMessageCard` encapsulando cada trecho
  de texto do agent em um contêiner com fundo de cartão (`bg-card`), borda (`border-border/40`),
  cantos arredondados (`rounded-2xl`) e sombra (`shadow-xs`). Em turnos com execução de
  ferramentas intercaladas (como no AGY ou Claude Code ao rodar comandos, testes e lint),
  cada atualização curta de status virava uma caixa individual fechada. O histórico ficava
  fragmentado em uma pilha de caixas brancas alternadas com disclosures de ferramentas,
  pesando visualmente o transcript e violando o princípio de austeridade do cockpit.
- **Decisão:** (1) Remover `AgentMessageCard` e reverter a renderização de texto e nós de prosa
  do assistente em `MessageList.tsx` diretamente para `<Markdown text={...} />`. (2) A prosa do
  agente volta a respirar com leveza e continuidade no canvas, sob o cabeçalho do grupo e sem
  bordas, sombras ou paddings artificiais em torno de cada parágrafo. (3) Manter o balão do
  usuário (`UserMessageBubble`) que delimita com sobriedade os prompts enviados e acomoda as
  ações rápidas de hover (editar, bifurcar e copiar).
- **Consequência:** retorno à sobriedade visual e à fluidez editorial do chat da Frota;
  eliminação do ruído de caixas repetitivas durante execuções com ferramentas; respeito ao
  STYLEGUIDE §3 e §4.

### ADR-152 · seleção nativa, realce de sintaxe e ações no visualizador de diff (DiffPanel) ✅
- **Contexto:** ao inspecionar arquivos alterados na aba "Alterações" (`DiffTab` / `DiffPanel`),
  três fricções graves limitavam a usabilidade do código: (1) O texto do diff era inelegível
  para seleção com o mouse devido ao `body { user-select: none; }` do `index.html`, impedindo
  copiar trechos de código com `⌘C`. (2) A renderização das linhas era monocromática e sem
  realce de sintaxe, prejudicando a leitura rápida de código em TypeScript, Rust, Python, HTML
  e CSS. (3) O cabeçalho dos arquivos não oferecia ações rápidas para copiar o caminho nem para
  citar o arquivo no composer do chat.
- **Decisão:** (1) Habilitar seleção nativa de texto no contêiner do diff (`DiffPanel`) e em cada
  linha (`DiffLineRow`) com `data-selectable` e `select-text`, enquanto números de linha e sinais
  `+`/`−` permanecem estritamente com `select-none` para garantir que a seleção copie apenas código
  limpo. (2) Implementar módulo utilitário `src/lib/syntaxHighlight.ts` apoiado no `highlight.js`
  já existente no bundle do frontend, com detecção automática de linguagem por extensão de arquivo
  e cache LRU, aplicando as classes canônicas `.hljs-*` já estilizadas no `index.css` sem interferir
  no fundo colorido do Git (`bg-st-success` / `bg-st-error`). (3) Adicionar botões de ação rápida no
  hover de cada arquivo no cabeçalho de `FileBlock` (copiar caminho do arquivo e citar arquivo no
  chat para instruir o modelo) e botão de copiar linha no hover de cada linha do diff.
- **Consequência:** ergonomia completa no visualizador de alterações: seleção de texto rápida e
  limpa com `⌘C`, realce de sintaxe fiel ao tema nos modos claro e escuro, e ações contextuais
  diretas para citação e cópia sem sair do fluxo da conversa.

### ADR-153 · diretrizes de escopo (Tiered Discovery) e visualizador nativo de markdown (.md) ✅
- **Contexto:** (1) Em turnos onde projetos ou dependências locais foram citados nominalmente pelo
  usuário, o agente invocou `find_by_name` apontando para a raiz da home (`SearchDirectory: "/Users/<user>"`).
  A varredura desceu para pastas privadas do macOS (`Desktop`, `Documents`, `Downloads`), acionando o
  subsistema TCC do kernel e interrompendo o turno com diálogos de autorização do sistema. (2) Ao
  gerar links de artefatos markdown no chat (`file:///Users/.../.gemini/antigravity-cli/brain/.../plano.md`),
  `parseFileTarget` rejeitava qualquer caminho fora de `projectPath`, resultando em links inertes sem ação;
  além disso, arquivos `.md` do projeto forçavam abertura em editores externos em vez de permitirem
  leitura imediata no cockpit.
- **Decisão:** (1) Implementar módulo puro `scope_guidance.rs` no backend Rust injetando diretrizes de
  escopo e higiene de navegação (Tiered Discovery) durante a preparação do run em `agent.rs`: instrui
  o modelo a priorizar `cwd` e `extra_dirs`, proíbe varreduras abertas a partir da raiz da Home no macOS
  e orienta o uso da ferramenta `ask_user` quando a localização de um recurso for incerta. O bloco é
  roteado pelo `system_channel` quando suportado ou dobrado no corpo de forma transparente (H1). (2) Expandir
  caminhos autorizados em `read_text_file` no Rust (`sources.rs`) para cobrir `extra_dirs`, artefatos do
  brain de agentes e anexos do app. (3) Atualizar `fileLink.ts` para resolver caminhos absolutos de
  arquivos markdown externos seguros. (4) Implementar o componente canônico `MarkdownViewerDialog`
  (`AppDialog size="xl"`) e a store `useMarkdownViewer`, interceptando cliques em links `.md` no
  `MarkdownLink` e `MarkdownInlineCode` para abrir visualização in-app com renderização markdown completa,
  syntax highlighting, cópia de texto e botão secundário para abrir no editor.
- **Consequência:** redução dos pop-ups do TCC no macOS causados por varredura cega, sem bloquear acesso
  a caminhos específicos conhecidos; experiência fluida de leitura de planos, especificações e documentação dentro da Frota sem
  troca de janela e com conformidade estrita ao STYLEGUIDE.

### ADR-154 · forks agrupados na sidebar, abas de ramos no palco e split view opcional ✅
- **Contexto:** na arquitetura anterior, bifurcar uma conversa ("Fork do último turno") ou duplicá-la
  gerava uma conversa solta inserida no fim da lista plana do projeto na sidebar. Além disso, a barra
  de abas do palco exibia um solitário e estático rótulo "Conversa", desconectado da ramificação. O parentesco
  não era registrado no SQLite, dificultando rastrear ramos concorrentes e incentivando o acúmulo de
  git worktrees órfãos no disco.
- **Decisão:** (1) Persistência de parentesco via Migration 43 no Tauri (`src-tauri/src/lib.rs`) e espelho
  fail-safe em `src/lib/db/schema.ts`, adicionando a coluna `parent_id REFERENCES conversations(id)` na tabela
  `conversations`. `forkConversationAtImpl` e `duplicateConversationImpl` passam a persistir o vínculo da linhagem
  familiar. (2) Na Sidebar, `ConversationList` utiliza o helper puro `groupConversationTree` para renderizar
  conversas raiz com seus forks aninhados (`ConversationRow`) com recuo sutil, conector visual `↳`, contagem de
  ramos (`N ramos`) e suporte a colapso sanfonado. (3) No Palco, `MainTabs` comuta dinamicamente as abas da família
  ativa (`Original`, `Fork 1`, etc.), permitindo alternância instantânea entre hipóteses de trabalho sem remount
  de componentes. (4) Disponibilizar a comparação sob demanda através do botão `Comparar ramos`, renderizando
  `BranchSplitView` lado a lado com histórico comparativo, troca explícita do ramo ativo e descarte com limpeza
  do worktree isolado no Git. Uma ação de promoção só poderá entrar quando houver integração real com o Git;
  trocar a conversa ativa não recebe esse nome. O `ChatPanel` permanece montado no DOM
  (ocultado via CSS) para garantir zero perda de rolagem e rascunhos de composer.
- **Consequência:** eliminação da dissonância espacial na navegação de tarefas; preservação do foco linear
  no estilo ChatGPT com poder de cockpit agêntico quando bifurcado; gestão limpa e explícita do ciclo de vida
  de git worktrees; conformidade com as catracas e o STYLEGUIDE.

### ADR-155 · o visualizador imersivo fica acima dos painéis ancorados ✅
- **Contexto:** a gaveta de Notas foi elevada para `z-120` para ultrapassar a
  barra de título nativa (`z-110`), e seus menus internos usam `z-130`. O
  lightbox global continuou no nível genérico `z-50`. Clicar numa miniatura
  carregava a imagem e escurecia o palco, mas o painel que originou o gesto
  permanecia por cima, ocultando o visualizador.
- **Decisão:** reservar `z-140` para o lightbox imersivo. A ordem efetiva passa
  a ser barra de título (`110`), painel ancorado (`120`), menu pertencente ao
  painel (`130`) e visualizador modal (`140`). O painel permanece montado atrás
  do visualizador, preservando a nota e a posição de leitura quando a imagem é
  fechada.
- **Consequência:** anexos de notas e imagens do fio usam o mesmo lightbox e
  sempre aparecem acima da superfície que iniciou o gesto, sem fechar a gaveta,
  duplicar estado ou introduzir outra primitiva de diálogo.

### ADR-156 · o painel direito separa projeto, conversa e evidência ✅
- **Contexto:** o mock `sidebar-cockpit-mock.html` propôs Arquivos e uma meta da
  conversa, mas o app real conservou apenas Contexto, Alterações e a checklist.
  Em fios longos, Contexto descrevia o projeto e Plano descrevia as tarefas, sem
  preservar na superfície o pedido que abriu a conversa nem a última entrega
  concluída. Chamar qualquer recorte de “resumo de IA” também criaria uma nova
  fonte de verdade sem proveniência.
- **Decisão:** ordenar o painel como Arquivos, Plano, Alterações e Contexto.
  Arquivos usa o inventário real de `list_project_files`. Plano mostra título,
  trecho do primeiro pedido humano, última resposta terminada por `result.ok`,
  checklist derivada de `TaskCreate`/`TaskUpdate` e trabalho diferido ainda vivo.
  Streaming, falha e replay interrompido não viram entrega. Uma meta editável
  fica fora até existir persistência própria e confirmação humana.
- **Consequência:** a conversa ganha memória operacional sem geração automática,
  o projeto ganha navegação local sem duplicar o diff, e cada afirmação do painel
  continua ligada a uma fonte observável. O arquivo principal encolhe porque as
  novas superfícies e a tira de abas vivem em módulos próprios.

### ADR-157 · o explorador indexa na coluna e lê no palco principal ✅
- **Contexto:** a primeira entrega de Arquivos agrupava caminhos somente pela
  primeira pasta e substituía a própria lista por uma leitura inline. Ela não
  preservava a hierarquia do projeto, perdia o contexto de navegação ao abrir um
  item e oferecia apenas texto ou Markdown numa largura inadequada. Alterações já
  havia provado a fronteira correta: a coluna decide e o palco largo lê.
- **Decisão:** Arquivos passa a construir uma árvore real a partir do inventário
  de `list_project_files`, com pastas expansíveis, ordenação natural, busca que
  preserva ancestrais e navegação por teclado. Clicar num arquivo abre a variante
  transitória `arquivo` de `MainTab`; a conversa permanece montada, como ocorre
  com o diff. O visualizador principal escolhe o renderer por formato: Markdown
  canônico, código e texto com `highlight.js`, ou imagem raster. Imagens são
  transferidas em resposta IPC binária com teto de 32 MiB e têm cabeçalho,
  dimensões e total de pixels validados antes de chegar ao decoder. Texto também
  passa a ser lido de forma limitada, sem carregar o arquivo inteiro antes do
  truncamento.
- **Consequência:** a coluna volta a funcionar como navegação densa de IDE, o
  arquivo recebe largura e ferramentas próprias sem competir com o contexto, e
  arquivos grandes ou imagens hostis não transformam uma ação de consulta em
  crescimento de memória sem limite. A aba é efêmera e somente leitura; edição
  continua no editor escolhido pela pessoa.

### ADR-158 · correção imediata e fila são gestos diferentes ✅
- **Contexto:** o primeiro fluxo de fila fazia Enter enfileirar e reservava
  `Cmd+Enter` para “Enviar agora”. A ação só chamava o cancelamento e dependia
  implicitamente do `finally` do turno para despachar. Quando `cancelled`
  chegava antes de `done`, a store já mostrava repouso e “interrompido”, mas a
  faixa ainda prometia que a fila seria enviada “ao terminar”. Codex e Claude
  atuais tratam Enter durante execução como correção do trabalho em voo; Codex
  reserva Tab para o próximo turno.
- **Decisão:** Enter mantém o significado de envio e, durante um turno ativo,
  pede correção imediata. Enquanto os adapters da Frota não oferecem steering
  nativo por capability, a UI nomeia o mecanismo real: “Interromper e enviar”.
  Tab é o gesto explícito de fila. `cancelled` e `error` mantêm `finalizing` até
  `done`; nesse intervalo não existe um segundo botão Parar nem uma ação de
  envio sem efeito. O despacho forçado recebe o `convId` explícito, cancela
  quando necessário e drena diretamente se a conversa já estiver ociosa. A
  remoção atômica da fila impede duplicação com o `finally` canônico.
- **Consequência:** a pessoa não confunde fila com correção, o estado
  “interrompido + esperando terminar” desaparece e “Interromper e enviar” tem
  efeito mesmo se o turno já tiver encerrado. Steering nativo continua sendo
  evolução de transporte e capability, não uma ficção da interface genérica.

### ADR-159 · mapa vivo é leitura derivada, com inferência utilitária contida ✅
- **Contexto:** a projeção do ADR-156 preservava o primeiro pedido, a checklist
  e o último checkpoint, mas não explicava uma conversa longa que mudou de
  direção. Reaproveitar o helper remoto de sugestões daria ao mapa uma
  autorização que a pessoa nunca concedeu e misturaria conveniência semântica
  com o run principal. O Foundation Models oferece uma rota on-device, mas sua
  disponibilidade e sua saída não são fonte canônica de execução.
- **Decisão:** (1) Substituir a aba `Plano` por `Conversa`, compondo fatos
  determinísticos, mapa semântico versionado e pins humanos separados. Pin
  vence geração; estado de run, tarefa, interação e trabalho diferido continua
  nos donos existentes. (2) Persistir mapas, pins e métricas nas migrações 44,
  45 e 46, com CAS por digest ou revisão. (3) Criar um gateway utilitário com
  perfis, duas filas limitadas, deduplicação, cancelamento, prazo e política por
  finalidade. A configuração legada só autoriza os consumidores que já a
  usavam; `conversation_map` não herda acesso remoto. (4) No Mac compatível,
  executar Foundation Models num sidecar Swift one-shot separado do ditado,
  com schema guiado, processo sem tools ou sessão, pipes limitados a 64 KiB e
  grupo encerrado no cancelamento. Ausência ou resposta inválida preserva fatos
  e o último mapa válido. (5) Foco precisa citar o pedido humano mais recente,
  desfecho precisa citar o terminal canônico e trajetória exige duas falas
  humanas distintas. (6) A leitura não entra no prompt, handoff, memória ou
  despacho de trabalho nesta versão.
- **Consequência:** conversas livres ganham orientação sem exigir objetivo
  inicial nem promover interpretação a verdade operacional. O mapa funciona
  sem Apple Intelligence em modo factual, não aciona rota paga implicitamente
  e pode ser corrigido pela pessoa. O gateway centraliza recibo, sugestões,
  curadoria e mensagem de commit sem mudar os fallbacks de cada domínio. Esta
  ADR substitui a semântica da aba `Plano` do ADR-156; a arquitetura de Arquivos
  dos ADRs 156 e 157 permanece válida.

### ADR-160 · Alterações separa índice, leitura e efeitos destrutivos ✅
- **Contexto:** a evolução da aba Alterações transformou a coluna num controle
  de versão completo, com preparação, descarte, commit e pull request. A
  primeira integração confundia erro de consulta com “não é repositório”,
  montava confirmações e o diálogo de pull request fora das primitivas
  canônicas e, no backend, restaurava arquivos a partir de `HEAD`. Esse último
  comportamento podia apagar uma mudança já preparada quando a pessoa queria
  descartar apenas a parte ainda não preparada. Caminhos absolutos ou com `..`
  também chegavam aos comandos destrutivos sem uma fronteira própria.
- **Decisão:** a coluna continua sendo o índice e abre o diff no palco
  principal. Preparado e não preparado permanecem conjuntos distintos. O
  descarte restaura o diretório de trabalho a partir do índice, nunca de
  `HEAD`; o descarte global preserva o índice e remove apenas alterações não
  preparadas e arquivos não rastreados. Antes de qualquer efeito, o Rust valida
  o diretório como repositório Git real e aceita somente caminho relativo
  normal, sem seguir symlink ao ler conteúdo não rastreado. Erros atravessam o
  IPC e recebem estado com nova tentativa. Confirmações destrutivas e o
  compositor de pull request usam as primitivas compartilhadas. Sugestão de
  mensagem só aparece quando o modelo auxiliar está explicitamente habilitado.
- **Consequência:** preparar passa a ser uma proteção que o descarte respeita,
  falhas deixam de se disfarçar como estado vazio e a aba oferece os mesmos
  gestos no Mac e no Linux. O Git continua sendo a fonte de verdade; a UI não
  mantém uma cópia otimista de stage, commit ou pull request.

### ADR-161 · o agendamento é um contrato: o que a tela oferece, o processo recebe ✅
- **Contexto:** o primeiro agendamento real do usuário (04/09/2026, `Pendencias
  na Prime`, Codex) falhou sem ter nada a ver com o pedido: shell negado com
  `sandbox_apply: Operation not permitted`, filesystem somente leitura, MCPs
  recusados. A automação estava rodando confinada em `read-only`. O ADR-023
  tinha aberto `auto` para automações, mexendo no tipo, no seletor e no braço
  do motor, mas os DOIS clamps do meio do caminho continuaram escritos à mão
  como `=== "padrao" ? "padrao" : "leitura"` — um no `store/schedules.create`,
  outro no `toSchedule` do banco. Escolher "Auto" gravava `leitura`, e mesmo um
  valor correto no SQLite era rebaixado na leitura. É literalmente a lição do
  `modoEfetivoDoSpawn` (ADR de 23/08) se repetindo: construir o eixo não é
  ligá-lo, e uma garantia pendurada num controle desconectado é pior que
  nenhuma, porque ela é exibida. Somava-se a isso um histórico que só dizia
  "falhou", um `blocked` desenhado como cinza saudável com rótulo de erro, e
  nenhum caminho de edição: consertar uma automação exigia excluir e redigitar
  o prompt inteiro.
- **Decisão:** o vocabulário de automação passa a ter UM clamp
  (`normalizeSchedulePermission`, em `lib/sessionMode`, ao lado da régua de
  permissividade), consumido pela escrita, pela leitura do banco e pelo
  disparo. O registro ganha `effort` (o esforço do modelo, que só existia na
  conversa) e `plan_id`; `schedule_runs` ganha `error`, e o desfecho de um
  disparo vira um contrato único (`lib/scheduleOutcome`) que grava o motivo
  REAL colhido do turno e o repete no sino. `blocked` deixa de ser desenhado
  como falha. O form vira criar-e-editar sobre uma régua pura e única
  (`lib/scheduleForm.draftInput`): o mesmo `null` que desabilita o botão é o
  que faria o store recusar. E a automação passa a poder disparar um **Plano de
  voo** (`kind: "mission"`): o disparador — nunca o `store/mission` — fecha as
  três portas que pendurariam uma missão desassistida para sempre: política de
  gate forçada em `nunca`, recuperação abortada fail-closed por observador, e
  worktree resolvido antes do launch com o modal respondido `não` por
  construção (automação não escreve no repositório real por uma confirmação que
  ninguém viu).
- **Consequência:** "Auto" numa automação passa a significar o que a tela
  promete, e o esforço do modelo deixa de ser privilégio da conversa. Uma
  execução que falha diz por quê na própria lista. Um agendamento pode ser um
  loop agêntico completo, com o teto de custo do plano valendo, e uma missão
  agendada termina — bem ou mal — em vez de ficar viva em memória esperando
  alguém que não está lá. A régua de segurança não afrouxou: `liberado` segue
  barrado no tipo, na escrita, na leitura e no disparo. Fica FORA desta ADR, e
  segue como limitação honesta do F6, o retry automático e a execução com o app
  fechado (`docs/automation-evolution.md`).

### ADR-162 · o painel não ressuscita rejeições nem empresta desfechos ✅
- **Contexto:** a aba Conversa mostrava o último terminal existente mesmo depois
  de um novo pedido iniciar outro turno. Durante o trabalho seguinte, o rótulo
  genérico “Turno concluído” parecia afirmar que o turno atual já havia acabado.
  No aprendizado, “remover” apagava a linha da lição; sem esse registro, uma
  destilação posterior podia considerar a mesma regra inédita e propô-la de
  novo. O painel de Contexto também deixava sua área rolável com o mínimo
  intrínseco do conteúdo, ocultando as últimas linhas sob o piso da aplicação.
- **Decisão:** o desfecho canônico só aparece quando pertence ao pedido humano
  mais recente. Enquanto não existe mapa semântico persistido, o cabeçalho nomeia
  a projeção disponível como `Fatos do fio`, sem anunciar atualização invisível
  nem contar todo o histórico como novo. Descartar uma memória grava o estado
  `archived` e a oculta da lista cotidiana; esse tombstone continua participando
  da deduplicação e impede a ressurreição automática. Falha ao persistir reverte
  a atualização otimista e fica visível. A área rolável recebe `min-h-0` na
  fronteira flexível.
- **Consequência:** estado anterior deixa de se passar pelo turno atual, a
  inferência opcional degrada para fatos nomeados, uma rejeição humana permanece
  respeitada e todo o conteúdo do painel volta a ser alcançável pela rolagem.

### ADR-163 · qualidade de feature usa verificador e juiz independentes em loop ✅
- **Contexto:** os Planos de voo de fábrica tinham um reviewer genérico e só
  duas rodadas de correção. O plano salvo de Feature completa não exigia testes
  nem screenshots, e um teto gravado como `0` impedia até a primeira fase. Um
  único modelo podia, na prática, validar o próprio relato.
- **Decisão:** os três modelos de fábrica passam a desenhar explicitamente
  `planejar → implementar → verificar → julgar`, com reprovação de qualquer
  reviewer retornando a `corrigir → verificar`. O verificador roda evidência
  objetiva e captura a superfície visível; o juiz usa outro agent/modelo, abre
  a evidência e só emite `APROVADO` sem ressalvas. O ciclo permite 30
  travessias por conexão e continua sob a barreira global de 100 visitas.
  Teto nulo significa sem teto; zero deixa de ser um plano válido.
- **Consequência:** build verde não se confunde com fidelidade visual, feedback
  reprovado alimenta a rodada seguinte, e a missão só percorre o término feliz
  depois de verificação objetiva e juízo independente. O plano Econômico
  conserva seu teto explícito de US$ 5; os demais não prometem custo limitado.

### ADR-164 · sair é uma transação nativa de duas passagens ✅
- **Contexto:** fechar a janela e sair de verdade tinham efeitos diferentes,
  mas `Cmd+Q`, menu nativo, barra de menus e botão vermelho não atravessavam a
  mesma política. A confirmação dependia do snapshot do frontend e a limpeza
  explícita alcançava runs, processos e plugins, enquanto ditado, inferências,
  updates e Companion dependiam em parte da morte do processo. Um webview
  travado também não pode ser a autoridade para liberar a própria saída.
- **Decisão:** `quit.rs` passa a ser a única fronteira de saída definitiva. A
  primeira `ExitRequested` é impedida e abre no máximo uma decisão. No macOS,
  o mesmo módulo acrescenta `applicationShouldTerminate:` ao delegate do Tao e
  responde ao AppKit só depois da decisão, porque o Quit padrão chama
  `terminate:` sem produzir `ExitRequested`. O
  inventário combina registries nativos, a contagem persistida de automações e
  a projeção de trabalho diferido e sessões externas do instrumento. A confirmação só aparece quando
  há trabalho que será interrompido ou automação que ficará indisponível; no
  macOS, `Continuar no Frota` é o primeiro botão do `NSAlert`. Após o aceite,
  um latch fecha novas admissões, o teardown sinaliza e aguarda cada recurso
  próprio com prazo, grava um recibo sem conteúdo sensível e só então autoriza
  a segunda passagem. O instrumento é uma janela, não um sidecar, e sessões
  externas observadas nunca recebem sinal. Fechar com continuidade ativa
  continua sendo apenas ocultação.
- **Consequência:** todas as portas expressam a mesma decisão humana, cancelar
  não altera trabalho vivo e nenhum IPC público pode forçar a saída. O app
  reduz a chance de filhos órfãos sem prometer limpeza impossível em crash ou
  `SIGKILL`; update de gerenciador de pacotes conserva um prazo próprio antes
  de escalada.

### ADR-165 · revezamento proativo de motor e aviso de cota esgotada no composer ✅
- **Contexto:** quando uma conversa atinge 100% de limite de uso da assinatura
  do motor (como Codex com taxa esgotada e reset distante), o composer
  permanecia travado com o cadeado no motor original (ex: Codex 🔒). O
  mecanismo de revezamento ("Continuar com outro agente") só existia em incidentes
  de falha durante a execução (`IncidentSequence.tsx`), sem permitir transplante
  preventivo ou proativo em turnos já concluídos.
- **Decisão:** o seletor de identidade do composer (`IdentityPicker`) destrava o
  trilho de seleção de motor para conversas estabelecidas (`locked`), permitindo
  marcar a intenção de revezamento (`stageAgent`) para o próximo envio. Quando a
  cota do motor ativo está esgotada (via `limitedAgents` ou janelas de uso com
  100%), o composer renderiza aviso contextual (`CotaEsgotadaBanner`) com botões para
  os motores alternativos disponíveis na máquina. A escolha exibe o banner de
  preparação (`RevezamentoStagedBanner`) com botão de desfazer e ícone de
  revezamento (`ArrowRightLeft`) na porta de identidade. No disparo, o turno
  utiliza a infraestrutura existente de transplante híbrido (`prepareTurnTransplant`),
  inicia sessão fresca com o novo motor transferindo o contexto do fio, emite
  aviso auditável no histórico (`notaDeRevezamentoDeMotor`) somente quando o
  destino confirma a nova sessão e limpa a intenção preparada.
- **Consequência:** conversas bloqueadas por limite de cota podem continuar com
  outro motor sem perda de histórico. A interface não promete que motores
  diferentes sempre consomem provedores diferentes; o gesto permanece deliberado
  e humano, nenhuma sessão é bifurcada sem consentimento e o histórico só registra
  a troca que realmente abriu sessão.


### ADR-166 · a persona no composer vira cara viva, e o olhar é gesto (não animação) ✅
- **Contexto:** o gatilho dos Especialistas no rodapé era um `<Sparkles>`, o
  glifo universal de "IA mágica". Não dizia quem estava disponível, quantos
  existiam nem se o time tinha sido instalado: um clique cego num rodapé com
  seis controles. As caras já existiam (`lib/avatar.ts`, DiceBear determinístico
  e offline) e já apareciam no marketplace, no menu de `@` e na faixa de
  presença; o composer era a única superfície que fingia que elas não existiam.
  A ideia de um avatar que segue o ponteiro esbarrava em duas paredes: o
  DiceBear entrega um PÔSTER (olhos assados no SVG, sem alça pra mexer), e o §6
  do STYLEGUIDE proíbe movimento ambiente.
- **Decisão:** o botão passa a mostrar a pilha das caras reais do escopo mais a
  contagem (`EspecialistasTrigger`), degradando pro glifo neutro quando não há
  persona nenhuma (não se inventa cara). Para o olhar existe um SEGUNDO
  renderizador, `AgentFace` + `lib/avatarRig.ts`, que consome o MESMO spec de
  `avatarFor` (seed e cor da categoria): identidade continua com fonte única, só
  o desenho é nosso. O olhar não é animação e sim resposta a gesto, da família
  do `:hover`: acorda dentro de um raio de 180px, a intensidade cai com a
  distância, volta ao neutro quando o cursor sai da janela, e
  `prefers-reduced-motion` ou tela sem apontador fino degradam pra cara
  ESTÁTICA, nunca pra ausência de cara. O rastreador de ponteiro é ÚNICO e de
  módulo (`lib/olhar.ts`, padrão do `lib/minuteTick.ts`), coalescido por quadro,
  ligado no primeiro assinante e desligado no último, com o ambiente injetável
  para a suíte provar isso sem DOM.
- **Consequência:** o rodapé passa a informar quem e quantos, sem nova fonte de
  identidade e sem um `pointermove` por avatar. Fica um seam declarado: a mesma
  persona tem um renderizador vivo (composer) e um pôster (demais superfícies).
  Eles compartilham cor, seed e raio, então lêem como a mesma família; unificar
  (o rig virando o renderizador padrão do registry de estilos) é mudança de
  produto e entra por ADR própria, não de carona.

### ADR-167 · o aviso de "Liberado" mora no ícone, não no botão inteiro ✅
- **Contexto:** o `ModeSelect` pintava o controle inteiro de âmbar no modo
  Liberado. Três problemas somados: a área grande punha o aviso no mesmo degrau
  hierárquico do Enviar, dando dois primários ao rodapé; o âmbar ficava aceso
  permanentemente, e sinal permanente vira papel de parede; e o token é o MESMO
  de "precisa de você" (`--color-st-warning` é `--st-queued`), então o mesmo
  pigmento passou a dizer duas coisas diferentes na mesma tela.
- **Decisão:** o gatilho volta a ser ghost neutro e só o ÍCONE recebe
  `text-st-warning`. O glifo já muda sozinho por modo (escudo-check →
  escudo-alerta), então a cor apenas CONFIRMA o que a forma disse, o que mantém
  o sinal legível sob daltonismo. As linhas do menu aberto seguem com o realce
  de fundo: ali a comparação entre modos é o trabalho, e o âmbar é transitório.
- **Consequência:** um primário só no rodapé e um âmbar que volta a significar
  alguma coisa. O teste que exigia "só Liberado acende âmbar" continua valendo
  sem mudança, porque ele fixa o significado e não a área pintada. Marcar o
  próprio botão de Enviar no instante do despacho (o risco só se realiza ali)
  fica registrado como alternativa avaliada e não adotada nesta rodada.

### ADR-168 · o preflight sai do caminho crítico do envio ✅
- **Contexto:** medição de 07/09/2026 no envio deste projeto. `run_agent`
  chamava `plan_for_run`, que enumerava TODAS as fontes de inventário MCP a cada
  envio: `codex mcp list --json` custava 1,3s medidos (1,27s / 1,41s / 1,28s) e
  rodava inclusive nos turnos de claude-code, que aqui não referenciam nenhum
  servidor de origem Codex. Depois vinham as sondas dos MCPs vinculados, em
  FILA, com teto de 6s cada e cache de 5 minutos: os carimbos do próprio app em
  `mcp_health` mostram 1,93s e 2,12s de intervalo entre duas sondas
  consecutivas. Nada disso dependia do texto digitado. `proc::run` não tinha
  timeout nenhum, então uma CLI pendurada travaria o envio para sempre, sem
  mensagem.
- **Decisão:** três cortes, todos agnósticos por construção. (1) O preflight
  enumera só as fontes que ESTE run referencia, derivadas do prefixo do
  `server_id` dos vínculos, mais a fonte própria do motor, que entra pela tabela
  `FONTES_DE_INVENTARIO` (um registry, consultado por código genérico, nunca um
  `if agent == "codex"`). A fonte própria entra mesmo sem vínculo porque é ela
  que prova a política efetiva, e o gate de preflight é fail-closed. As
  superfícies de Configurações seguem enumerando tudo: lá a pergunta é "o que
  existe nesta máquina?". (2) As sondas dos vínculos passam a rodar em paralelo,
  em três tempos (lê cache no banco, sonda sem banco, grava), divisão que também
  é o que mantém o future do comando Tauri `Send` — `Connection` do rusqlite não
  é `Sync` e não pode atravessar um `await`. Servidor repetido em dois vínculos
  sonda uma vez. (3) O inventário por CLI ganha teto próprio
  (`INVENTARIO_TIMEOUT`, 4s), e estourar o teto é ERRO de inventário, não lista
  vazia: vazio diria "não tem MCP", que é outra afirmação.
- **Consequência:** um envio de claude-code neste projeto deixa de pagar o
  inventário do Codex, e o custo das sondas passa da soma para o mais lento.
  Motor sem config nativo enumerável (o agy hoje, e o próximo motor amanhã) não
  paga por um. O comportamento observável do plano não muda: as mesmas fontes
  relevantes são consultadas, com os mesmos gates.

### ADR-169 · o envio se declara antes de preparar, e o preparo tem rede ✅
- **Contexto:** `ChatPanel.handleSend` fazia cerca de dez `await` (persona,
  doutrina, lições, expansão de "/", export do transcript) ANTES de chamar
  `beginPreparation`. Durante essa fase a conversa não sabia que existia um
  envio, então não havia de onde derivar sinal nenhum. Depois vinha o preflight
  do backend, e o único feedback do conjunto era o primário ficando cinza mais
  um placeholder que ninguém via, porque o composer seguia cheio do texto da
  pessoa. O §6 já mandava spinner a partir de 1s. Espera de segundos com a tela
  imóvel não lê como lentidão, lê como travamento.
- **Decisão:** o `runId` e o `beginPreparation` sobem para logo depois das
  guardas que decidem se este texto é parecer, fila ou comando builtin, que são
  os únicos casos em que o envio não vira turno desta conversa. O botão de
  enviar ganha estado de preparo: troca a seta pelo círculo, mantém o mesmo
  degrau de controle para a fileira não dançar, e muda o `aria-label` junto,
  porque anunciar "Enviar" enquanto já se prepara mente para quem não vê a tela.
  O spinner tem atraso de 700ms no CSS, preso à presença do elemento e nunca a
  um timer, para não piscar num preflight quente. `prefers-reduced-motion`
  degrada para ponto sólido visível, com `opacity` explícita porque o bloco
  global desliga a revelação e sem isso o indicador sumiria. Como o carimbo
  agora precede os `await`, um estouro no meio deixaria a conversa presa para
  sempre: `handleSend` vira um invólucro que cria o `runId`, chama
  `despacharEnvio` e, em qualquer exceção, apaga o carimbo e avisa a pessoa. A
  limpeza varre as conversas porque `clearPreparation` já ignora quem não está
  preparando aquele run, o que evita uma segunda API na store.
- **Consequência:** a espera passa a ter dono visível desde o primeiro quadro, e
  um segundo Enter durante o preparo encontra a guarda em vez de correr para um
  run concorrente. A fronteira de aceite NÃO muda: a bolha continua nascendo do
  `run_manifest`, porque o app não mostra como enviado o que o backend não
  aceitou. Mostrar um item provisório reconciliado por id, no estilo do Paseo,
  fica registrado como próximo passo possível e depende de ADR própria.

### ADR-170 · comando Tauri que faz I/O não roda na thread principal ✅
- **Contexto:** `export_conv_context` e `export_context_bundle` eram
  `#[tauri::command]` SEM `async`, e comando sem `async` executa na thread
  principal, que no macOS é a thread da UI. Os dois escrevem o transcript
  inteiro da conversa (1,66 MB na maior conversa medida em 07/09/2026, com 1907
  itens) e ainda varrem o diretório no `trim_old_exports`. Isso acontecia a cada
  envio de conversa com resume nativo. Não era lentidão: era a janela
  congelando.
- **Decisão:** os dois passam a `#[tauri::command(async)]`. O corpo continua
  síncrono de propósito, porque é I/O de bloqueio, e é exatamente por isso que
  ele não pode morar na thread da UI. A regra vira lei da camada em
  `app/src-tauri/src/AGENTS.md`: comando que toca disco, rede ou processo não é
  síncrono.
- **Consequência:** o congelamento sai. O custo de atravessar a ponte com o
  payload continua, e fica declarado como dívida conhecida: reexportar só quando
  o fio muda foi avaliado e recusado nesta rodada, porque um ponteiro de memória
  desatualizado por um turno é problema de honestidade, não de performance.

### ADR-171 · etapas incompletas não sobrevivem como atividade ao fim do turno
- **Contexto (08/09/2026):** no incidente `e78edeef-2ace-4ad7-b158-27bd77d16465`,
  o agente concluiu quatro de sete etapas, deixou uma em andamento e duas
  pendentes, e encerrou o turno com sucesso. A sidebar continuava animando a
  etapa antiga. O parâmetro `live` já presente no checklist impedia animação
  em repouso, mas a execução de outro turno poderia reanimar o plano anterior.
- **Decisão:** `deriveTaskPlans` projeta as etapas incompletas como `unsettled`
  quando existe terminal ou um pedido posterior. A projeção não altera os
  eventos persistidos nem acrescenta conclusões. `taskStatusForDisplay` aplica
  a mesma apresentação estática quando o runtime está parado, inclusive no
  replay sem evento terminal. O texto é "Sem conclusão registrada".
- **Superfícies:** card vivo, marco do transcript e sidebar consomem o mesmo
  plano derivado. A contagem permanece 4/7; nenhum consumidor pode mutar a
  leitura compartilhada de `taskPlansOf`. O contrato fica em
  `app/src/lib/tasks.AGENTS.md`.
- **Verificação:** fixture extraída dos eventos reais do incidente, com prosa
  não relacionada omitida; regressões de sucesso, erro, limite, cancelamento,
  novo pedido, finalização e replay. Nenhuma capability de provider é alterada.

### ADR-172 · a linha global de MCP usa o inventário do CLI
- **Contexto (08/09/2026):** `agy mcp list` informa `computer-use` e `playwright`
  como `stdio enabled`, mas a linha ainda oferecia instalar e mostrava o
  interruptor do binding desligado. O toast de instalação não atualizava a
  descoberta. Esta decisão evolui a leitura e o gesto descritos na ADR-104.
- **Decisão:** `McpAgentState.cliInstallation` distingue `enabled`, `disabled`,
  `absent` e `unknown`, pelo motor, nome exato e transporte no inventário
  global. O binding e a saúde continuam separados. Resumo do CLI confirma uma
  entrada de mesmo nome/transporte; não comprova comando equivalente, tools
  disponíveis nem conexão. Por isso a linha usa um glifo neutro de CLI.
- **Gesto:** entrada observada oferece "Remover do CLI", com alcance global
  visível antes do clique. Ausência confirmada oferece instalar. Inventário
  indisponível, incompleto ou ambíguo não libera escrita. O backend reconsulta
  somente o destino antes do efeito; instalar exige ausência e remover exige
  presença. O resumo não permite sobrescrever um homônimo por inferência.
- **Reconciliação:** sucesso ou erro de alteração provoca nova descoberta,
  pois timeout pode ocorrer depois de uma escrita. Resposta de projeto antigo
  não entra no painel atual. Falha de atualização marca o inventário como
  desconhecido e expõe o erro. Consulta tem teto de 4s, alteração de 10s e
  encerramento do filho por `kill_on_drop`.
- **Fronteiras e verificação:** tudo ocorre na descoberta de Configurações e
  no gesto de instalar/remover, sem adicionar inventário ao envio. Testes usam
  as colunas públicas capturadas do CLI e verificam estados, ambiguidade e
  apresentação. `mcpAgentActions.ts` concentra a política visual extraída de
  `mcp.ts` para respeitar o teto de arquivo. A ponte de `mc-work` para motores
  de escopo global continua fora desta alteração; identidade apenas por CWD
  não distinguiria duas conversas simultâneas no mesmo projeto.
- **Caminhos que alteram estado:** `McpSettings.instalarNoCli` chama
  `mcp_control::install_mcp_in_agent` para alterar a entrada pelo CLI e depois
  `discover_mcp_servers` para atualizar `servers`/`providerInventories` no
  painel. A descoberta mantém o `persist_registry` já existente; este trabalho
  não cria bindings ou migrações. A mudança de planos altera apenas a projeção
  em `deriveTaskPlans`, preservando os eventos no banco.
- **Validação conjunta das ADRs 171/172:** `bun run test` passou em 398 arquivos
  (3.940 testes); `cargo test` passou com 731 testes e 7 ignorados; build de
  tipos por `bunx tsc -b --force` e `bun run check` passaram. A listagem real do
  Agy foi consultada somente para leitura. Instalação/remoção real e inspeção
  visual no app instalado não foram executadas nesta rodada.

### ADR-173 · mc-work global com identidade de turno herdada pelo processo
- **Contexto (08/09/2026):** Agy 1.1.27 mantém cadastro MCP global e não oferece
  a injeção efêmera dos outros adapters. A sonda local confirmou que os filhos
  MCP herdam o ambiente do processo Agy. Isso permite usar o listener existente
  por run; CWD sozinho não distinguiria conversas simultâneas na mesma pasta.
- **Decisão:** `work_mcp` e `work_mcp_global_env` no registry Rust, espelhadas
  como `workMcp` e `workMcpGlobalEnv` em TS. Agy declara ambas; Claude/Codex
  mantêm o canal efêmero; motores sem evidência conservam `false`.
  `AgentDef` foi extraído para manter o registry abaixo do teto de arquivo.
- **Gesto explícito:** Configurações > MCPs > Acompanhamento no Frota cadastra
  `mc-work` pelo CLI, com o executável do app e o argumento `work-server`.
  O alcance global aparece antes de conectar. Reativação usa `mcp enable`;
  desconectar usa `mcp remove`. Uma entrada com mesmo nome e outra receita
  bloqueia esses efeitos, sem sobrescrever configuração desconhecida.
- **Pré-condição e cache:** versão mínima 1.1.27 e entrada habilitada com nome,
  transporte e comando esperados. `work_mcp_setup` aquece no boot e reconsulta
  por gesto em Configurações. Operações são serializadas; a cache de snapshot
  tem lock curto, invalidado antes de instalar/reativar/remover e no instalador
  genérico ao alterar `mc-work`. Consulta expira em 4s, escrita em 10s, com
  `kill_on_drop`. O envio só lê a cache e informa sua idade no manifesto.
  Mudança externa no CLI exige reverificação; o cadastro confirmado não é uma
  sonda de conexão. Nenhuma descoberta nova entra no caminho do Enter.
- **Identidade e vida:** cada spawn recebe seu próprio `MYCOCKPIT_WORK_SOCK`.
  O endereço nunca é gravado na configuração global. O listener possui
  `run_id`, `conv_id` e CWD definidos pelo app; não aceita esses campos do MCP.
  Socket com permissão 0600, leitura limitada a 1 MiB e timeout de 6s.
  Encerrar o listener revoga conexões pendentes e remove o socket. Consultar
  ou interromper processo exige que ele pertença à conversa do listener.
- **Disponibilidade:** `tools/list` consulta o listener vivo. Sem ele, o
  helper declara zero tools, inclusive quando o Agy é aberto fora do Frota.
  O adapter remove endereço ambiental herdado se este run não possui gateway.
  Na retomada, ativar/desativar o canal reanuncia sua disponibilidade pelo
  ledger existente; não anuncia mudanças nos MCPs externos do usuário.
- **Permissões:** o shell do registry roda no app, fora do sandbox nativo.
  Em Leitura, Auto e planejamento inicial, o listener expõe somente
  `work_plan`/`work_update` e recusa as três tools de processos mesmo se
  chamadas diretamente. Padrão/Liberado expõem cinco tools. FusionRo continua
  sem canal. Essa fronteira vale para todos os adapters e o manifesto declara
  a lista efetivamente permitida.
- **Caminhos que alteram estado:** `WorkMcpSettings.change` →
  `set_work_mcp_enabled` → CLI/cache → atualização dos inventários;
  `work_mcp_status`/`warm` atualizam somente a cache;
  `run_agent` cria o listener e o adapter materializa o ambiente do filho;
  `handle_request` publica `work://event` ou altera o `ProcessRegistry`.
  A derivação e terminalidade de etapas seguem a ADR-171, sem migração.
- **Validação:** 3.946 testes frontend, 745 testes Rust (7 ignorados),
  `bunx tsc -b --force` e `bun run check` passaram. Agy real iniciou o helper
  compilado em dois processos simultâneos na mesma pasta, cada um consultando
  seu próprio socket. O binário declarou 5/2/0 tools conforme acesso
  completo/restrito/ausente. Testes com sockets reais e runtime Tauri de teste
  cobrem entrega de eventos, encerramento e isolamento entre conversas.
  [Evidência e limites](evidence/agy-work-mcp-1.1.27.md): cadastro global real,
  inferência do modelo e inspeção visual do app instalado não foram executados.

### ADR-174 · Planos de voo separam biblioteca, prancheta e contrato executável
- **Contexto (08/09/2026):** a autoria misturava biblioteca, canvas e toda a
  configuração de fase em três colunas permanentes dentro do cartão central.
  O grafo era executável, mas a tela parecia um formulário de settings e ficava
  estreita junto da sidebar do projeto. A referência de workflow builder também
  sugeria hooks, triggers e checks que o runtime atual não possui como tipos de
  nó; expô-los agora criaria controles sem efeito.
- **Decisão:** biblioteca e prancheta viram estados distintos da mesma feature.
  A prancheta usa Construir, canvas/Rota e inspetor contextual com abas Fase,
  Segurança e Rotas. A paleta oferece somente fases que o runtime executa;
  conexões continuam sendo `success`, `failure` ou `always`, com limite real de
  travessias. Checks são fases Revisor com critérios, não um segundo mecanismo.
  A validação inferior usa `validateMissionPlan` e o salvamento continua
  automático, sem inventar um ciclo de publicação.
- **Tela cheia:** uma camada fixa cobre a área útil abaixo da barra superior do Frota,
  acima do esqueleto redimensionável e abaixo dos dialogs. `Esc`, o botão da
  prancheta ou voltar à biblioteca encerram o modo. É estado visual local e não
  entra no preset, nas Settings ou no snapshot de uma Missão.
- **Segurança:** a prancheta torna visíveis a permissão do projeto, a autonomia
  e a permissão efetiva da fase, o gate humano e o teto de custo. O projeto é o
  teto. A troca usa `setProjectPermissionEverywhere`; Liberado exige o mesmo
  gesto humano explícito antes de escrever store, SQLite e
  `.mycockpit/config.toml`. Nenhuma fase pode elevar Leitura para escrita.
- **Consequência:** não há migração nem mudança no interpretador. Hooks,
  gatilhos e gate como nó continuam fora até ganharem contrato de domínio,
  persistência, validação e runtime. O nome de arquivo exportado passa a usar
  `.frota-plan.json`; o envelope interno permanece compatível com importações
  anteriores.
- **Caminhos que alteram estado:** edição, criação, duplicação, importação,
  exclusão e restauração chamam `setSettings({ missionPresets })`; a permissão
  chama `setProjectPermissionEverywhere`. Seleção, validação expandida,
  biblioteca/prancheta e Tela cheia são estado local de apresentação.
- **Verificação:** 400 arquivos e 3.949 testes frontend passaram; o Rust passou
  com 745 testes e 7 ignorados; `bunx tsc -b --force` e `bun run check`
  passaram. Os 29 testes E2E incluem o novo contrato de fullscreen, preservação
  de seleção, inspetor, conexão e erro de nó inalcançável. Biblioteca,
  prancheta, Tela cheia e Segurança foram abertas e inspecionadas em 1440×900.

### ADR-175 · Faixa operacional é lazy, observável e persistida por mudança
- **Contexto (09/09/2026):** trocar projeto, abrir Arquivos e apertar Enviar
  compartilhavam trabalho síncrono ou repetido com a thread da interface. O
  explorador enumerava o projeto inteiro, o autocomplete de `@` herdava essa
  enumeração, inventários nativos podiam subir subprocessos repetidos e o fio
  serializava todo o JSON a cada janela de streaming. Ao mesmo tempo, o estado
  genérico "está trabalhando" não distinguia um processo vivo de uma ponte sem
  eventos.
- **Decisão de navegação e arquivos:** projeto e conversa usam cache,
  single-flight e token de geração. A troca aplica o shell no primeiro quadro e
  nunca apresenta o transcript anterior sob o projeto novo. Arquivos lista um
  nível por pedido; busca é paginada, limitada, ignore-aware e executada fora da
  thread Tauri. Symlink aparece, mas não é seguido. Busca recursiva da Home é
  recusada. Menções usam um hot set local e só consultam o backend com query;
  os valores efetivamente usados persistem no rascunho.
- **Decisão de trabalho oculto e envio:** mapa, contexto e painel só atualizam
  quando possuem consumidor visível. Saída de processo gerenciado cruza a
  ponte como delta numerado e limitado. As duas superfícies de envio entram em
  preparação antes do primeiro `await`. O inventário nativo do Codex tem cache
  de vida do processo, single-flight, invalidação após alteração e bypass
  somente no gesto explícito de redescoberta. O manifesto registra se a fonte
  foi cache, miss, compartilhada ou bypass.
- **Decisão de vida do run:** `item.started` e `item.updated` do stream JSONL do
  Codex renovam a mesma Tool por id; payload desconhecido degrada para Unknown.
  A sonda de recursos percorre somente a árvore enraizada no processo do run e
  publica processo principal, descendentes, RSS e último byte. Essas métricas
  nunca contam como progresso. Depois do limiar, a linha informa processo
  ativo, morto ou não confirmável em vez de manter atividade genérica.
- **Decisão de persistência:** as migrations 48 e 49 criam
  `conversation_items` e `conversation_item_state`. Um comando Rust aplica o
  change-set e o marcador em uma transação SQLite. O primeiro write faz
  bootstrap; os seguintes enviam somente posições alteradas. A leitura prefere
  a revisão itemizada quando contagem, ordem, id e JSON fecham; qualquer
  inconsistência volta ao snapshot integral. O snapshot legado continua sendo
  gravado em repouso/terminal como rollback. Antes de novo envio, a cauda
  incremental pendente é confirmada.
- **Consequência:** não há daemon, indexador permanente, cancelamento
  automático nem heartbeat teatral. Cache guarda somente sucesso; falha
  continua visível e retentável. A frente de render do fio permanece sob
  `docs/fluidez-do-fio-plan.md`, sem duplicar F3/F4 nesta decisão. A guarda
  `check:tauri-hot-paths` impede que os seis comandos nativos desta faixa
  voltem a bloquear a thread principal por regressão acidental.

### ADR-176 · Continuidade entre agentes tem uma superfície e duas semânticas
- **Contexto (09/09/2026):** o incidente terminal oferecia continuação
  imediata dentro do fio, enquanto a cota preventiva preparava outro agente no
  composer. As duas superfícies usavam o mesmo handoff híbrido, mas tinham
  seletores, filtros e verbos diferentes. Em limite com retomada automática,
  um terceiro aviso podia aparecer ao mesmo tempo. Essa duplicação tornava
  incerto se o clique enviaria agora ou apenas mudaria o próximo envio.
- **Decisão visual:** `ContinuityBanner` é a única porta dessa escolha acima do
  composer. O fio registra somente o fato terminal. A faixa usa um único
  marcador âmbar de estado, seleção neutra e um CTA. “Continuar agora no X”
  retoma o pedido interrompido; “Usar X no próximo envio” apenas grava a
  intenção. Claude Code, Antigravity e OpenCode aparecem pela mesma régua de
  elegibilidade, nunca por decoração, ponto de presença ou comparação local de
  fornecedor. Retomada automática coexistente é resumida dentro da faixa, com
  cancelamento próprio, em vez de gerar outro cartão.
- **Elegibilidade:** `eligibleHandoffTargets` consulta registry, detecção,
  autenticação, cota e capabilities de anexo. Destino ausente, sem login,
  esgotado, não agente ou incompatível falha fechado; estado ainda desconhecido
  segue a política canônica de `dispatchBlockReason`.
  `deriveComposerContinuity` dá prioridade à falha do último turno de executor
  sobre o aviso preventivo de cota.
- **Transação:** `continueConversationWith` marca `beginPreparation` antes do
  primeiro `await`, localiza o último pedido dirigido ao executor, preserva os
  anexos e só registra lições ou inicia o transplante após `run_manifest`.
  Perguntas a Especialistas não substituem o pedido pendente. Falha pré-aceite
  limpa o preparo e mantém agente e sessão de origem; a troca continua sendo
  confirmada apenas pelo primeiro `session` do destino.
- **Caminhos que alteram estado:** no modo futuro, `stageAgent` grava ou desfaz
  a intenção e o envio normal a consome. No modo imediato, o gesto chama
  `continueConversationWith`, cancela retomada automática e sugestões, prepara
  o handoff e inicia `runAgent`; `run_manifest` abre o transplante e `session`
  o confirma. Abrir detalhes, selecionar localmente, aguardar ou ocultar a
  faixa não despacha trabalho.
- **Verificação:** testes puros fixam terminalidade, prioridade, os três
  destinos reais, filtros de autenticação/cota/anexos e copy dos dois modos.
  O teste da orquestração fixa a resposta visível antes do primeiro `await`, o
  pedido correto e seus anexos. A sequência de incidente prova que nenhuma
  decisão permanece duplicada no transcript.

### ADR-177 · Seletor de modelo é derivado do CLI, não escrito no bundle
- **Contexto (09/09/2026):** o Codex passou a listar `gpt-6-astra` como modelo
  default dele e a responder "sou o Codex, baseado em GPT-6". O seletor da
  Frota seguiu abrindo em "Sol", com `gpt-5.4` e `gpt-5.4-mini` na oferta,
  ambos fora do `model/list` daquela versão, e com `gpt-5.6` e
  `gpt-realtime-2.1` que o CLI nunca conheceu (vieram do catálogo de API pelo
  curador e foram aprovados no gate). O M1 já tinha a lista viva e o registry
  já declarava `listsModels: "codex-app-server"` desde 14/08/2026, mas a
  ligação existia só como função POR FORNECEDOR: havia `refreshAgyModels` e
  `refreshOpenCodeModels`, e a terceira nunca foi escrita. Uma capability
  declarada e não consumida não falha, envelhece em silêncio.
- **Decisão:** o seletor de modelo e a régua de esforço de todo motor que
  declara `listsModels` são DERIVADOS da lista viva do próprio CLI.
  `refreshModelLists` varre `modelListingAgents()` do registry, `liveModelsFrom`
  é a única tradução de payload para opção, e nenhum modelo de motor com fonte
  viva mora no bundle. `CODEX_MODELS` encolheu para a sentinela "Padrão",
  seguindo o precedente de `OPENCODE_MODELS`.
- **Ordem, default e esforço vêm do CLI:** a ordem das opções é a que o CLI
  entrega (ele ordena por prioridade dele, frontier primeiro), a descrição da
  sentinela cita o slug com `isDefault` em vez de um nome escrito à mão, e a
  régua de esforço sai de `supportedReasoningEfforts` POR MODELO. As três
  divergiam do código no mesmo dia: o astra aceita `ultra`, o `gpt-5.5` para em
  `xhigh`, e nenhuma lista única podia estar certa nos dois.
- **Cache no banco:** `model_listings` guarda uma linha por motor com a última
  resposta boa (source, versão de CLI, carimbo, payload). O boot hidrata dali
  ANTES da sonda, então o seletor abre certo no primeiro frame, e o pior caso
  de uma sonda falha deixa de ser "a lista de quando a versão foi compilada" e
  passa a ser "a última lista que o SEU CLI deu". Sonda que falha não grava e
  não apaga.
- **Sumiço mudo vira aviso:** `retirementNotices` passou a cobrir o slug que
  simplesmente saiu da lista, além do que o fornecedor anuncia com `upgrade`.
  `agentModels` deixa de oferecer opção aprovada que a lista viva não conhece,
  e a decisão humana NÃO é apagada: a linha segue no ledger com o motivo, e o
  aviso sai com a versão do CLI como evidência. Sem lista viva nada é
  filtrado, mantendo a assimetria do M3: "não sei" não rebaixa.
- **Trocar de modelo solta o esforço órfão:** com a régua por modelo, mudar de
  modelo podia deixar escolhido um esforço que o novo não aceita. A régua abria
  sem nenhum degrau aceso e o envio ia falhar por um valor que a pessoa não
  escolheu para aquele modelo. `effortFitsModel` é a régua pura, e o gesto no
  seletor volta para a sentinela quando ela não passa. Régua vazia não derruba
  escolha nenhuma: sem lista declarada não há o que contestar.
- **Caminhos que alteram estado:** `refreshModelLists` (boot, "Verificar
  agora" em Configurações ▸ Agents e em Serviços) escreve o cache de módulo e
  a tabela `model_listings`; `hydrateModelListings` (boot) escreve só o cache
  de módulo; a rodada de `modelRound` grava `model_retirements` e
  `model_proposals` como antes. Nenhum deles escolhe default de conversa,
  projeto ou agent: entrar como opção é reversível, trocar o motor do seu
  trabalho não é.
- **Verificação:** fixture REAL do `model/list` do codex-cli 0.153.4 em
  `app/src-tauri/fixtures/` (ADR-016), com o dia em que o `isDefault` mudou de
  mão. Testes fixam ordem do CLI, sentinela derivada, esforço divergente entre
  dois modelos do mesmo motor, slug sujo descartado, escondido fora da oferta,
  aposentado explicado, sumiço com evidência e o filtro que não roda sem lista.

### ADR-178 · Medição de contexto e de cota deriva da fonte, não de tabela escrita à mão
- **Contexto (09/09/2026):** três sintomas, uma doença. (1) A faixa de
  continuidade dizia "sem cota para o próximo turno" logo depois de um turno
  que o auto-resume rodou inteiro e concluiu. (2) O anel de contexto escondeu
  o percentual de uma chamada real de `claude-opus-5`: 320.702 tokens medidos
  contra uma "janela" de 200.000. (3) O explorador dizia "leitura parcial" em
  todo repositório git. Nos três, o app tinha o dado certo à mão e consultava
  um palpite ou um sinal que ninguém religava.
- **Cota, a contraprova:** `checkAgentQuota` combinava o `limit_reached` do CLI
  (que já era curado por `result.ok`) com o snapshot da janela de uso (que não
  era curado por nada). O poll é de 15 min e o snapshot vale 30, então um
  "100%" lido ANTES do turno seguia de pé DEPOIS dele. Agora `result.ok`
  carimba `lastSuccessAt` por agent, e uma leitura de 100% ANTERIOR ao carimbo
  não conclui "esgotado". A contraprova derruba a CONCLUSÃO, nunca o número:
  quem diz quanto sobrou continua sendo o provider. Empate fica com a leitura.
  Os efeitos globais de cota saíram de `handleEvent` para
  `store/chat/quotaSignals`.
- **Janela de contexto, a fonte:** `contextWindowFor` decidia por
  `m.includes("1m") ? 1_000_000 : 200_000`, e errava justamente nos modelos de
  topo (Opus 5, Sonnet 5 e Fable 5 já vêm com 1M sem o sufixo). O catálogo
  models.dev, que o app já baixa e guarda, tinha `claude-opus-5 → context:
  1_000_000` em disco e era lido em UM lugar: uma string de prompt do curador.
  O catálogo passou a ser a primeira fonte, hidratado no boot por leitura local
  (fora do portão de 24h da manutenção, senão o anel passa o dia no palpite). A
  tabela de casa fica como fallback declarado, porque os slugs do agy e do
  Codex não são ids de models.dev, e `context: null` é "não informou", nunca
  "não tem janela". O sufixo `[1m]` é dialeto de flag e sai antes do casamento.
- **Cadência escolhível:** o poll da janela de uso virou setting
  (`usagePollMinutes`), com conjunto FECHADO de 5 · 10 · 15 min. Fechado e não
  campo livre porque o poll spawna processo ou bate na conta do provider, e um
  "1" digitado ali seria martelada silenciosa. `pollCadenceMs` valida na
  leitura (valor de fora vira o padrão), e a escolha encurta o caminho feliz e
  o teto do backoff SEM mover o piso de 30s nem a espera de 429/auth. O rodapé
  do medidor anuncia a cadência real em vez do "~15 min" escrito à mão.
- **Leitura parcial:** `entry_from_path` devolvia o mesmo `None` para "excluí
  de propósito" (`.git`, `.DS_Store`) e para "não consegui ler", e o segundo
  acendia o aviso. Como o `.git` está sempre na raiz, TODO repositório dizia
  leitura parcial. A exclusão virou filtro explícito de quem varre
  (`structurally_excluded`) e o `None` voltou a significar uma coisa só.
- **Caminhos que alteram estado:** `recordTurnSuccess` (em `result.ok`),
  `setSettings({ usagePollMinutes })`, e a hidratação de janelas por
  `getModelsCatalog` no boot. Nenhum deles despacha trabalho nem escolhe motor.
- **Verificação:** fixtures reais (o catálogo desta máquina, a chamada de
  320.702 tokens, `.git` + `.DS_Store` em fixture de disco). Testes fixam a
  contraprova nos dois sentidos, o empate, o catálogo ganhando do palpite, o
  fallback preservado para slug fora do catálogo, os três degraus de cadência e
  o piso que eles não movem.

### ADR-179 · Movimento no fio conta um evento que acabou de nascer
- **Contexto (10/09/2026):** a pessoa pediu transições sutis no fio, "para não
  ser algo sempre brusco". Dois achados tornavam isso arriscado. (1) O §6 do
  STYLEGUIDE dizia que as durações vêm de `--dur-fast`, `--dur` e `--dur-slow`,
  e esses tokens não existiam: os três usos (`AgentFace`, `SetupGuide`) caíam em
  transição instantânea, sem erro. (2) O `PlanMilestone` animava na montagem, e
  por isso reencenava a chegada toda vez que a conversa era reaberta: o fio frio
  fingindo que algo acabou de acontecer.
- **Decisão:** (1) Os três tempos passam a existir no `index.css`, com
  `--dur-brasa` (900ms) como única exceção declarada. (2) Entrada no fio só para
  o que NASCEU agora, decidido por `lib/nascimento.ts`: `nasceuAgora(ts, now)`
  compara o carimbo de nascimento do item com uma janela de 1,5s, e
  `useNasceuAgora` decide uma vez, na montagem. Abrir, rolar, trocar de conversa
  e a janela voltar de oclusão chegam prontos. (3) Estado que troca num elemento
  que já existe usa `useTrocou`: montar não anima, trocar sim. (4) Carimbo e não
  Set de ids já mostrados: o Set animaria em cascata, na primeira visita, tudo
  que nasceu enquanto a pessoa estava em outra conversa. (5) Com movimento
  reduzido o bloco global leva cada entrada ao estado final; nenhuma informação
  mora só na animação.
- **Consequência:** as classes `fio-*` só entram por essas duas portas. Item
  legado sem `ts` não anima. `AgentFace` e `SetupGuide` passam a ter as
  transições que já declaravam.
- **Verificação:** `lib/nascimento.test.ts` (carimbo real de um corte colhido do
  SQLite, limites da janela, legado sem carimbo, relógio que andou para trás,
  troca) e `PlanMilestone.nascimento.test.tsx` (plano publicado agora entra;
  reaberto no dia seguinte chega pronto).
- **Onde a regra entrou:** a mensagem sua sobe (`GroupRow`), o grupo do agente
  acende, cada nó novo acende sem empurrar o lido (`NoDoFio`, com os carimbos
  só da CAUDA do fio para o custo por token não crescer com o histórico), a
  linha de ação desliza e o ícone assenta quando o estado troca, o ✓ da
  legenda assenta no fim do turno, a linha viva faz crossfade só quando a FASE
  da frase muda, o slot da sidebar re-entra a cada troca de estado, e o
  divisor "novas mensagens" (`DivisorNovasMensagens`) risca do centro, a
  exceção declarada por ser a notícia da visita. A troca de conversa já tinha
  crossfade (`key` no `activeId`); é justamente essa remontagem que a régua de
  nascimento impede de virar cascata. Fica fora, de propósito: acender a
  prosa trecho a trecho no streaming, que brigaria com o Markdown renderizado.

### ADR-180 · A interrupção tem causa, marco e emenda, e o turno cortado presta contas
- **Contexto (10/09/2026):** interromper um turno deixava no fio uma palavra
  cinza, "interrompido", sem autor, antes da mensagem que causou o corte e sem
  ligação com ela. O único lugar que sabia o porquê era um toast que sumia em
  segundos. A ação em voo virava "erro" vermelho e o grupo dizia "1 de N
  falhou". A disputa abortada não deixava rastro nenhum no fio. E o turno
  cortado não prestava contas: na conversa "[feat] cliente coleta" foram 14
  ações e 5min21s sem uma linha em `turn_costs`, porque o ledger só grava no
  `result` e o SIGINT mata o turno antes.
- **Decisão:**
  1. **O gesto dá a causa, o evento dá o fato.** `lib/corte.ts` guarda a causa
     (`correcao` no envio forçado, `parada` no Parar do composer, na bandeja,
     na Mesa e no toast do turno mudo, `disputa` no abort da disputa) até o
     `cancelled` do runner chegar; `handleEvent` a consome e ela é gravada no
     item. Sem `cancelled` não há marco, então um motor com steering nativo,
     que corrige sem parar, nunca exibiria "você interrompeu". É agnóstico por
     construção: o `cancelled` sai do runner genérico nos três transportes, e
     nada aqui compara nome de motor.
  2. **O marco diz quem cortou** (`MarcoDeCorte`), no verbo canônico do §7:
     "você interrompeu para corrigir", "você interrompeu o turno", "você
     interrompeu a disputa". Sem causa (reconciliação, histórico), só
     "interrompido".
  3. **O que parou não é falha.** `settleTerminalTools` marca
     `result.interrupted`; o grupo ganha o estado `stopped` com a gramática da
     falha ("1 de 7 parou · X"), o passo ganha anel vazado e a meta "parou".
     Falha de verdade continua vencendo.
  4. **Chegada, sem ficar:** a brasa (`fio-brasa`, a exceção de 900ms do §6)
     no bloco do executor, decidida no render por `corteNasceu`, porque o bloco
     já existia quando o corte chegou; o marco acende com `fio-nasce`. A régua
     desenha a emenda (`grupoDeCorte`), que é permanente e também é navegação.
  5. **Disputa:** `abortarDisputa` fecha o turno pela mesma sequência local da
     reconciliação (`fecharTurnoLocalmente`: `cancelled` + `done`), porque
     `cancelled` sozinho deixa a conversa em `finalizing`.
  6. **Toast:** sai do caminho feliz onde a pessoa está olhando o fio (Parar do
     composer, envio forçado). Fica onde o fio não está na tela (Mesa, dock,
     Companion, bandeja) e em toda falha.
  7. **Ledger:** `registrarTurnoCortado` grava a linha do turno cortado com
     custo NULL, via `INSERT OR IGNORE` (o `result` que chegou antes vence; um
     `result` tardio sobrescreve pelo mesmo `run_id`). O usage parcial de cada
     motor é frente própria, por capability e com fixture real de
     cancelamento.
- **Consequência:** conversa com turno cortado passa a declarar o total como
  estimado; o valor em dólar só muda com a frente de usage parcial. Cortes
  gravados antes desta ADR seguem como "interrompido", e a ação que estava em
  voo neles continua como erro: histórico não é reescrito por casamento de
  texto.
- **Caminhos que alteram estado:** `marcarCausaDoCorte` (`dispatchNotice`,
  `cancelLinearTurn`), `tomarCausaDoCorte` (`handleEvent`, `cancelLinearTurn`
  sem turno, `abortarDisputa`), `registrarTurnoCortado` (`cancelLinearTurn` com
  processo no ar), `fecharTurnoLocalmente` (reconciliação e disputa).
- **Verificação:** `lib/corte.test.ts`, `cancelLinearTurn.test.ts`,
  `cancelConversationTurn.test.ts`, `store/chat.corte.test.ts`,
  `terminalTools.test.ts`, `toolGroup.corte.test.ts`,
  `messageGroups.corte.test.ts` e `MarcoDeCorte.test.tsx`, com os carimbos e a
  sequência reais do corte de 09/09/2026 colhidos do SQLite do app.

### ADR-181 · O esforço troca no meio da conversa pela mesma regra do modelo

- **Contexto:** a ADR-073 e o destrave de 23/08/2026 liberaram a troca de
  MODELO numa conversa estabelecida (flag de spawn do próximo turno, sessão do
  CLI preservada), mas o ESFORÇO ficou na trava antiga em três lugares: a régua
  do `IdentityPicker` usava `disabled={locked}`, `identidadeEfetiva` sempre
  devolvia o esforço carimbado e o `ChatPanel` ignorava o pedido. Na tela, a
  lista de modelos trocava e a régua ao lado ficava apagada, sem motivo técnico:
  nos motores que orquestramos o esforço também é flag do próximo spawn.
- **Decisão:** o esforço segue o modelo. Trava só com turno em voo
  (`effortLocked = locked && !modelUnlocked`); fora disso a escolha fica em
  estado próprio (`retryEffort`, zerado nos mesmos gatilhos do `retryModel`),
  sai do composer como `effortSwitched` e o despacho a obedece. A troca escreve
  uma linha no fio (`notaDeTrocaDeEsforco`), pelo mesmo motivo da troca de
  modelo: sem ela o histórico mente sobre como o trecho rodou. O AGENT continua
  sendo handoff (ADR-165).
- **Consequência:** a regra do despacho saiu do `ChatPanel` para
  `identidadeDoDespacho` (pura, em `composerIdentity.ts`), que decide
  agent/modelo/esforço e as três linhas de troca. ⌘K, fila e todo caller que não
  manda `effortSwitched` seguem com o esforço carimbado. O reset para a
  sentinela quando o modelo novo não aceita o degrau (ADR-177) continua valendo
  e, numa conversa travada, conta como troca deliberada para `default`.
- **Caminhos que alteram estado:** `CommandConsole.onEffortChange`
  (`setRetryEffort` na conversa travada), `IdentityPicker.selectModel` (reset
  para sentinela), `ChatPanel.despacharEnvio` via `identidadeDoDespacho`,
  `acceptChatTurn` (notice no fio) e `useChat.start` (recarimba `effort`).
- **Verificação:** `composerIdentity.test.ts` (esforço em voo e fora de voo,
  troca para `default`, só esforço, só modelo, revezamento, conversa nova).

### ADR-182 · Desfecho honesto de trabalho em background e separação entre disparo e execução

- **Contexto (11/09/2026):** no incidente do build de teste (`b3pbaal2v`, sessão
  `c03399e2-...`), um comando shell longo foi desanexado com sucesso via
  `run_in_background: true` da tool `Bash` (`is_error: false`). Ao encerrar o run
  do subprocesso e emitir `Done`, `settleTerminalTools` marcou o nó sintético de
  trabalho diferido como interrompido com `result: { ok: false }`, mas sem a flag
  `interrupted: true` da ADR-180. Isso fez o agrupador (`toolGroup.ts`)
  classificar a interrupção como erro fatal do build (`1 de 3 falhou`) e a UI
  apresentar `interrompido · erro` com o botão `[Repetir etapa]`, induzindo
  duplicação de tarefas pesadas. Além disso, `deferredResumePrompt` prometia
  retomada via `Workflow` e cache (`resumeFromRunId`) para um comando que era `Bash`.
- **Decisão:**
  1. **Disparo separado do trabalho:** a tool de origem (ex.: `Bash`) que
     despachou a tarefa em background preserva seu desfecho factual (`ok: true`),
     sem ser contaminada pelo ciclo do trabalho filho.
  2. **Interrupção não é falha técnica:** quando o processo do run encerra sem que
     a tarefa em background tenha publicado seu desfecho, o `DeferredWork`
     assentado recebe `result: { ok: false, interrupted: true }` com texto honesto
     de encerramento/perda de acompanhamento. No agrupador, o nó ganha o estado
     `stopped` ("parou" em cinza) em vez de `error` ("falhou" em vermelho).
  3. **Repetição bloqueada:** `[Repetir etapa]` fica oculto tanto no nó filho
     quanto na tool pai enquanto houver trabalho associado vivo ou em estado
     interrompido/não reconciliado, prevenindo concorrência desgovernada.
  4. **Retomada honesta por tipo:** `deferredResumePrompt` só orienta `Workflow` e
     `resumeFromRunId` quando `d.kind` for `workflow`/`local_workflow`. Para `Bash`
     e demais tipos sem suporte a checkpoint, orienta o modelo a inspecionar o
     estado atual antes de decidir os próximos passos.
- **Consequência:** o Frota não mente mais que o build "falhou" quando o canal foi
  encerrado, e não induz re-execuções perigosas de comandos pesados. O histórico
  preserva a distinção entre erro real de execução e perda de acompanhamento do
  subprocesso.
- **Caminhos que alteram estado:** `settleTerminalTools` (marcação de `interrupted: true`
  no `Done` para `DeferredWork`), `describeToolGroup` / `summarizeToolGroup`
  (tratamento de diferido interrompido como `stopped`), `deferredResumePrompt`
  (prompt condicional por tipo), `MessageList.tsx` (bloqueio de repetição na tool pai).
- **Verificação:** `store/chat/terminalTools.test.ts`, `store/chat.deferred.test.ts`,
  `lib/toolGroup.test.ts`, `components/chat/MessageList.background.test.ts`.

### ADR-183 · Blindagem de telemetria, governança de processos em árvore e execução direta em disco

- **Contexto (11/09/2026):** durante a execução de suítes de teste pesadas sob o
  motor Agy (`cargo test` e `bun run test`), o Frota emitiu aviso alarmista de
  memória (>2000 MB) e a interface sofreu lentidão severa próxima do
  congelamento. A investigação e o benchmarking de engenharia (OpenClaude)
  revelaram três fragilidades de governança:
  1. A medição em `run_resources.rs` somava recursivamente o RSS de toda a árvore
     de processos e atribuía o montante ao harness do agente, sem distinguir a
     memória do CLI daquela consumida legitimamente por processos filhos (como o
     compilador `rustc` e workers de teste).
  2. A cada 5 segundos, o evento de telemetria `RunStatus` reconstruía o objeto
     `ConvState` da conversa ativa dentro de `byId[convId]` no Zustand. Isso
     invalidava a referência da conversa e disparava um re-render completo de
     `ChatPanel` e `MessageList` (com mais de 300 itens montados no DOM), gerando
     múltiplos recálculos forçados de autoscroll e layout no WebKit.
  3. No encerramento e cancelamento, processos descendentes podiam sobreviver se
     não herdassem o marcador de ambiente do run; comandos longos acumulavam logs
     em memória no gateway, e não havia teto de segurança contra loops infinitos
     de gravação em disco.
- **Decisão:**
  1. **Decomposição do RSS no backend:** a observação de processos passa a
     distinguir explicitamente o RSS do processo raiz (`root_rss_mb`) do RSS total
     da árvore (`rss_mb`). O aviso de memória alta (>2048 MB) só é emitido com tom
     de atenção se o próprio harness estiver inchado; quando a maior parte do
     consumo decorre de processos filhos (diferença > 512 MB), a mensagem explica
     com clareza técnica que a memória pertence a ferramentas e testes em execução.
  2. **Isolamento de telemetria no frontend:** o estado efêmero de processo
     (`RunLiveness`) foi retirado de `byId[convId]` e isolado em um slice próprio
     `runLivenessByConv: Record<string, RunLiveness>` em `ChatState`. A recepção
     do evento `run_status` a cada 5 segundos atualiza exclusivamente esse mapa e
     retorna de imediato, preservando a identidade estrita de `byId[convId]`.
  3. **Consumo granular por componente:** a tela principal do chat (`ChatPanel` e
     `MessageList`) não assina mais a telemetria do processo. O consumo foi
     confinado ao componente de rodapé `WorkingIndicator` através do hook seletor
     dedicado `useRunLiveness(convId)`, eliminando mais de 12 re-renders globais
     por minuto durante tarefas de longa duração.
  4. **Matança em árvore (`tree-kill`) por PPID e PGID:** `run_processes.rs` varre
     recursivamente todos os descendentes a partir do processo direto e de processos
     marcados. O encerramento sinaliza os grupos de processo (`-pgid`) e envia
     sinal para cada PID descendente individualmente, garantindo que nenhum
     processo filho ou neto fique rodando como órfão (`PPID=1`).
  5. **Watchdog de quota de disco (5 GB max):** `run_resources.rs` e `agent.rs`
     estabelecem o teto de 5 GB para arquivos de saída em background. A cada
     tick de recursos, arquivos monitorados são avaliados; exceder a quota encerra
     o processo e emite erro explicativo, protegendo o SSD contra loops infinitos.
  6. **Pipeline Direct-to-Disk no gateway:** `work_gateway.rs` grava a saída de
     processos gerenciados diretamente em arquivo `.output` em disco, mantendo na
     memória apenas um buffer circular de 64 KiB e expondo o caminho `outputFile`
     no `ManagedProcessView` para interação no frontend via `DeferredOutputFile`.
  7. **Interrupção de processos gerenciados no cancelamento:** `work_gateway.rs` e
     `lib/work.ts` introduzem `stop_by_conv` e `managed_process_stop_by_conv`. No
     cancelamento de turno (`cancelLinearTurn`) ou de disputa (`abortarDisputa`),
     todos os subprocessos gerenciados vinculados àquela conversa são interrompidos
     imediatamente, impedindo que processos em background continuem rodando após o
     gesto de corte.
  8. **Notificações reativas de background tasks sem polling:** `AgyAdapter` unifica
     o reconhecimento de comandos em segundo plano e `<task-notification>` injetadas,
     emitindo `AgentEvent::DeferredWork` com status e arquivo de saída em disco
     sem exigir loops ativos de polling ou sleep.
- **Consequência:** fim dos congelamentos e lentidão na interface durante
  compilações e testes longos, diagnósticos de consumo de memória factuais
  e honestos, eliminação garantida de processos órfãos no cancelamento e proteção
  robusta contra saturação de disco.
- **Caminhos que alteram estado:** `run_resources.rs` (`ProcessObservation`,
  `format_memory_warning_message`, `check_disk_quota`), `run_processes.rs`
  (`find_termination_targets`, `terminate_run`), `agent.rs` (monitoramento de
  quota e aviso de memória), `opencode_acp.rs`, `codex_appserver.rs`, `work_gateway.rs`
  (`append_output` direto em disco, quota, `stop_by_conv`, `managed_process_stop_by_conv`),
  `adapters.rs` (`AgyAdapter` tarefas em background e task-notifications),
  `lib/work.ts` (`stopManagedProcessesByConv`), `lib/cancelLinearTurn.ts`,
  `lib/cancelConversationTurn.ts`, `store/chat.ts` (`handleEvent` no ramo
  `run_status`, `start`, `revezar`), `store/chat/runLiveness.ts`
  (`applyRunStatusToLiveness`, `selectRunLiveness`), `components/chat/WorkingIndicator.tsx`.
- **Verificação:** `run_resources.rs` (testes de árvore, memória e quota de disco),
  `run_processes.rs` (árvore recursiva de descendentes e isolamento de PID do app),
  `work_gateway_tests.rs` (gravação direta em disco e `stop_by_conv`),
  `adapters.rs` (reconhecimento reativo de background tasks no Agy),
  `cancelLinearTurn.test.ts` e `cancelConversationTurn.test.ts` (interrupção no cancelamento),
  `store/chat.liveness.test.ts` (preservação de identidade da conversa),
  `cargo test`, `bunx tsc -b --force`, `bun run test`, `bun run check`.


### ADR-184 · Limite de trabalho por mensagem antes do parser Markdown

- **Contexto (12/09/2026):** uma conversa do Maclan contém um item real de
  143.638 caracteres com uma linha de 142.976 pontos da saída de Vitest.
  `remark-parse` + `remark-gfm` levou 32,46 s no item completo. O tokenizer de
  autolink tenta reconhecer email a partir dos pontos e refaz a varredura do
  sufixo; a medição cresceu aproximadamente com o quadrado do tamanho. A janela
  de 40/150 nós não limita trabalho dentro de um nó. O problema precede
  highlight e layout e pode bloquear a interface mesmo com turno encerrado.
- **Superada em parte pela ADR-210 (17/09/2026):** o teto por mensagem virou
  último recurso e a paginação saiu; a degradação passou a ser por trecho.
- **Decisão (histórica):** `Markdown` aplica `needsPlainText` ANTES de construir o parser.
  Acima de 16.384 unidades UTF-16 por mensagem ou 2.048 por linha, usa
  `PlainTextPages`: texto literal em partes de 4.096 unidades (mais uma quando
  necessário para preservar um par UTF-16), sem GFM nem highlight. A tela
  informa a forma de leitura, permite navegar e copiar a mensagem completa.
  Não existe botão que recoloque o payload integral no parser síncrono.
- **Integridade:** o transcript persistido, o texto enviado aos motores e os
  eventos normalizados permanecem integrais. A proteção fica na superfície
  compartilhada por todos os adapters e também protege históricos antigos.
  Não se classifica nem remove conteúdo por conter `SYSTEM_MESSAGE`.
- **Limites:** os números limitam entrada e DOM, não prometem um timeout para
  todo Markdown possível. Retenção de históricos na store, filas de IPC e
  memória de processos filhos são problemas diferentes. Este incidente não
  comprova vazamento, nem a correção comprova que a memória de todo o app foi
  resolvida. Os ganhos descritos na ADR-183 não dispensam essa verificação.
- **Estado alterado:** somente a parte selecionada no componente de leitura.
  Nenhuma migração, alteração do runner ou mudança no estado operacional.
- **Verificação:** fixture real `maclan-test-output.txt`, regressões de
  `Markdown.test.tsx` e `markdownBudget.test.ts`, leitura e cópia integrais em
  Chromium; primeira montagem 12,9 ms e 100 remontagens com máximo de 0,7 ms.
  WKWebView nativo: primeira montagem 11 ms, máximo de 1 ms em 100 remontagens.
  Essas medições são do componente com o item completo, não do app instalado.
  Detalhes e limites em `docs/incidente-maclan-2026-09-12.md`.

### ADR-185 · A aba Features (SDD) sai do app; o custo histórico dela fica no Painel ✅

- **Contexto (13/09/2026):** decisão de produto do usuário: "remover por
  COMPLETO essa aba Features, manter apenas Painel e Trabalho". Mesma régua do
  ADR-035: toda superfície mantida paga seu custo. O modo SDD custava ~4 mil
  linhas (view, `lib/sdd.ts`, `sdd.rs` com 7 comandos e escrita em
  `.claude/plans`), uma tabela de marcas e três conceitos de UI que só existiam
  por ele (lista de features na sidebar, gates "encontrados no projeto",
  ignorados). Dependia ainda de um fluxo de skills externo com default pessoal
  (`SEED_REPO`). Frente em `docs/remocao-features-prd.md`.
- **Decisão 1 (superfície):** saem `components/sdd/`, `lib/sdd.ts`, `sdd.rs`,
  a entrada `sdd` de `MODES`, a `SddFeatureList` da sidebar e o estado
  `sddFocusSlug`/`sddCreateRequested`/`sddDataVersion` do store. O tipo
  `ViewMode` passou a nascer de `VIEW_MODES` em `store/app.ts`, fonte única
  para a barra e para a migração.
- **Decisão 2 (caixa de decisões, D1):** os kinds `prd` e `pr` saem de
  `Decision`. Eles só nasciam de manifest SDD; sem a aba não têm fonte nem
  destino. Junto saem o card de PR com merge, o enriquecimento via `gh`
  (`gh_pr_view`, `gh_pr_merge`, `validate_pr_url`, `run_gh_any_account`), a
  procedência descoberto/ignorado e a tabela `sdd_plan_marks` deixa de ser
  criada. A fila ordena disputa (0) antes de card e proposta (1), estável
  dentro do rank. Consequência visível: quem via "PR aberto" ou "PRD por
  aprovar" no sino, na faixa e no Painel deixa de ver.
- **Decisão 3 (custo, D2):** `stage_runs` vira histórico somente-leitura e
  continua no `UNION ALL` do `loadLedger`. Esse dinheiro foi gasto; tirá-lo
  derrubaria os totais do Painel sem aviso. `db.ledgerHistorico.test.ts`
  trava as duas metades: a leitura fica, e nenhum código volta a gravar.
- **Decisão 4 (painel de contexto, D3):** sai a seção "Specs" (lia os mesmos
  `manifest.json`), com `read_specs`, `Spec` e `StageBadge`. A contagem
  "Planos" do inventário de `.claude/` fica: é inventário neutro da pasta,
  como agents e commands.
- **Decisão 5 (persist, D4):** `mc.app` v5. `fromVersion < 5` com `viewMode`
  fora de `VIEW_MODES` cai em `"linear"`, e a regra do v4 foi absorvida por
  ela. Nunca tela branca.
- **Sem migração destrutiva:** nenhum `DROP TABLE`. As migrações v20/v21 de
  `stage_runs` ficam (migração não se apaga); `sdd_plan_marks` fica inerte em
  bancos antigos e não existe em bancos novos. Arquivos do usuário em
  `.claude/plans` e `.claude/skills` não são tocados.
- **Ajustes que entraram de carona:** o comutador da barra acendia a aba ativa
  por baixo da view Frota (o check olhava só Agendado e Planos de voo); o sino
  não tratava falha da varredura (promise sem `catch`) e congelava a lista
  quando o último projeto era arquivado.
- **Testes que sobreviveram ao corte:** disputa e proposta na varredura
  (`inbox.scan.test.ts`, vindos de `inbox.sdd.test.ts`), o contrato do
  `hardDeleteProject` (`db.hardDeleteProject.test.ts`, vindo de
  `db.sddMarks.test.ts`), ordenação estável e agregação da faixa reescritas
  sobre disputa, card e proposta.
- **Caminho de volta:** se entrega spec-driven voltar a importar, ela nasce
  como Plano de voo (missões já têm fases, gates e custo por fase em
  `turn_costs`), não como terceira superfície lendo manifest de outro fluxo.
- **Restos deliberados:** comentários históricos citando `SddView` em
  `scripts/lints/deadTokens.mjs`/`.test.mjs` e no STYLEGUIDE (registro de
  passadas antigas); `mode: "sdd"` em `permission.test.ts` como valor opaco;
  `docs/missions/sdd-mode.md` e `docs/sdd-evolution.md` viram histórico.

### ADR-186 · Drenar a cauda do stdout antes de encerrar o turno

- **Contexto (13/09/2026):** no incidente da resposta cortada, a sessão do
  Claude guardou 2030 caracteres e o transcript da Frota apenas 406. O runner
  disputava a próxima linha com `child.wait()` e encerrava a leitura quando o
  processo saía, mesmo havendo bytes no pipe. O replay local reproduziu a perda
  com esse comportamento. Isso demonstra a corrida, embora não exista captura
  bruta do stdout do turno original para provar sua trajetória exata.
- **Decisão:** `run_once` preserva o status de saída e continua consumindo pelo
  mesmo reader e adapter até EOF, 300 ms sem linha nova ou 3 s de drenagem total.
  O limite total impede que descendentes escrevendo continuamente prolonguem o
  turno; cancelamento e monitoramento continuam ativos. A regra é genérica,
  inclusive na segunda tentativa de um resume degradado.
- **Proteção do adapter Claude:** durante um bloco de texto aberto, acumula os
  deltas recebidos. Se o consolidado principal contém esse prefixo exato e mais
  texto, emite apenas o sufixo como `TextDelta`, antes de `TextStop`. Divergência,
  bloco fechado e consolidado repetido não reescrevem nem duplicam a resposta.
  O texto vem do CLI, nunca é sintetizado pela Frota. Subagentes mantêm seu
  caminho próprio. O contrato de ordenação está na captura de Claude 2.1.266.
- **Estado alterado e call sites:** `agent.rs::run_once` muda a leitura e o
  encerramento nas chamadas inicial e de retry de `run_agent`;
  `adapters.rs::ClaudeAdapter` mantém o texto do bloco e emite a cauda.
  `store/chat.ts` já acumula `text_delta` e fecha a bolha em `text_stop`, sem
  mudança no frontend, protocolo ou esquema do banco.
- **Evidência:** `agent_stream_tail_tests.rs` reproduz stdout cheio seguido de
  saída imediata em oito rodadas; cobre também pipe herdado silencioso, escrita
  contínua e cancelamento. `adapters_claude_tail_tests.rs` usa a captura real em
  `testdata/claude-2.1.266/texto-tool-texto.jsonl`, removendo deltas para testar
  recuperação, deduplicação e divergência. Na cópia isolada com saída imediata
  do loop e recomposição desativada, os dois testes de regressão falharam.
- **Limites:** os prazos são de drenagem, não de execução do modelo. Consolidado
  ausente, divergente ou recebido após o fechamento do bloco não recupera texto.
  Esta alteração não repara automaticamente respostas antigas no banco e não
  comprova o comportamento de um binário instalado sem rebuild e teste nativo.
- **Correção (14/09/2026, ADR-190):** o sintoma voltou com esta ADR já no
  binário instalado. A causa dominante estava no frontend: um `React error #185`
  dentro do handler do `Channel` congelava o turno. A drenagem continua correta
  e fica; ela só não era o que cortava a resposta.

### ADR-187 · Centro de comando, navegação global e menu da conta

- **Contexto (14/09/2026):** proposta B de `docs/mocks/chrome-botoes.html`
  aprovada: a busca ganha o centro da barra, o Painel pertence a Geral e Notas
  mantém uma porta visível no Trabalho. A engrenagem e o tema isolados saem do
  chrome permanente.
- **Navegação:** Geral reúne Painel, Frota, Agendamentos e Planos de voo.
  Selecionar projeto, inclusive o atual, retorna ao Trabalho; selecionar uma
  conversa conserva seu fluxo existente. A seleção do projeto e da conversa
  recua quando uma visão global cobre o centro. O antigo teste do comutador
  passa a verificar a ordem dos destinos de Geral, e o e2e mede o campo de
  busca no mesmo vão, inclusive a 940px com nome de projeto longo.
- **Persistência:** preservamos `viewMode: painel|linear` como contrato interno
  de restauração. Diferentemente da sugestão de migração no mock, não é preciso
  trocar a representação para mover a porta de navegação. Não há novo booleano
  concorrente nem migração de banco. O Painel e o chat continuam montados para
  preservar o custo e o estado do transcript.
- **Notas:** `StickyNotesToggle` ancora a mesma gaveta, agora no extremo direito
  de `MainTabs`, em degrau compacto. Escopos, menções, contador e fronteira de
  colisão continuam os existentes. A paleta abre o Trabalho antes de abrir a
  gaveta, garantindo acesso também a partir das visões globais.
- **Conta:** o rodapé abre um `DropdownMenu` com Perfil, Configurações, Atalhos,
  Tema e Sobre. Configurações mantém acesso pela paleta e por ⌘/Ctrl + vírgula
  mesmo com a sidebar fechada. O sino conserva contador de bloqueios e ponto
  de atividade; só o glifo muda.
- **Tema:** `themePreference` guarda Claro, Escuro ou Sistema; `theme` continua
  sendo a cor resolvida para todos os consumidores e para o evento da bandeja.
  Instalações antigas herdam a preferência da cor salva. O listener de sistema
  só altera a cor quando Sistema está selecionado, com limpeza ao desmontar.
  Os entries principal e da bandeja resolvem Sistema antes do primeiro render.
- **Caminhos de estado:** `setActiveProject`/`addProject` retornam ao Trabalho;
  `setViewMode` e os setters globais mantêm a exclusividade existente;
  `CommandMenu` abre Trabalho + `setDockOpen(true)`; `AccountMenu` usa
  `setSettingsOpen` e `setTheme`. `computeContextualSplit` considera todas as
  coberturas globais para não esconder uma aprovação numa conversa invisível.
- **Validação:** testes de restauração existentes mantidos; cobertura de tema,
  retorno ao Trabalho, navegação e acesso a Notas. Playwright verifica cliques,
  atalhos, Sistema em tempo real e geometria em 940/1024/1280/1600px. Isso valida
  o frontend no navegador; arraste nativo da janela e binário instalado exigem
  a etapa de build e teste nativo.

### ADR-188 · Leitura inline de duração e geometria no instrumento expandido

- **Contexto (14/09/2026):** no HUD flutuante expandido (`FlightScene`), durações
  acima de uma hora exibiam o tempo particionado verticalmente em dois blocos
  (`4:19` em 30px e `H` em 11px abaixo). O "H" isolado dava a impressão visual de
  quebra de linha acidental de texto, além da ambiguidade de `4:19` com horário de
  parede. Além disso, a cena de voo usava `pb-2` enquanto o rodapé absoluto de 48px
  exigia `pb-12`, descompensando o respiro vertical do miolo.
- **Decisão:** a leitura de tempo decorrido no instrumento passa a ser em linha
  única, alinhada pelo baseline tipográfico (§14). Para minutos, exibe `16 min`;
  para horas e minutos, decompõe em notação canônica de duração (`4h 19m`), com
  dígitos em 30px mono e unidades em 13px mono coladas à base. A coluna esquerda
  passa de 82px para 116px, acomodando dois dígitos de hora com folga, e o trilho
  vivo (`hud-live-rail`) alinha seu início em `ml-[136px]` com o início do bloco
  de texto da tarefa.
- **Respiro:** `FlightScene` ganha `pb-12` consistente com as demais cenas
  (`DecisionScene`, `StopScene`, `SettledScene`), descontando a altura do rodapé
  fixo.
- **Validação:** mock interativo em `docs/mocks/hud-tempo-variacoes.html`; testes
  unitários em `hudPresentation.test.ts` e `DynamicHudExpanded.test.tsx` cobrindo
  tempo sem início, minutos, horas e minutos compostos e regressão contra `>H<`.


### ADR-189 · O "/" pergunta ao motor o que ele tem, e diz de onde veio a lista

- **Contexto (14/09/2026):** com Claude Code no mycockpit, o popover do "/"
  oferecia dois itens (`/compactar` e `/build`) enquanto o `system/init` do
  claude 2.1.270 anunciava 57 comandos, 22 skills e 7 plugins, e o
  `codex app-server` 0.154.0 respondia 18 skills em `skills/list`. A descoberta
  era só por pasta: não lia plugins de provider, lia `~/.codex/prompts` (o
  formato antigo) e descartava em silêncio seis skills globais que eram links
  quebrados. Estudo, sondas e payloads em `docs/composer-extensoes-plan.md` e
  `docs/evidence/composer-inventario/`.
- **Capability `command_inventory`** (Rust `adapters.rs`, espelho TS
  `lib/agentCommands.ts`, gêmeos `matriz_native_slash_e_fontes_por_agent` e
  `agents.commands.test.ts`): `ClaudeRunInit`, `CodexSkillsList` ou nenhum.
  O código genérico pergunta a capability; o dialeto mora no enum.
  - **Claude:** o adapter emite `AgentEvent::EngineInventory` no `init`; o
    runner guarda por (agent, cwd) com horário em `command-inventory.json` e
    não repassa ao fio. Regrava só quando o conteúdo muda ou a evidência
    envelhece: custo por run, nunca por mensagem.
  - **Codex:** `skills/list` pelo `probe_once` do app-server, sem turno de
    modelo, cache de 2 minutos. Só o popover consulta; o envio usa cache ou disco.
  - **agy e opencode:** sem canal (o `init` do agy 1.2.2 só traz cwd,
    permission_mode e tools). O rodapé diz isso em vez de parecer vazio.
- **Disco continua como fallback declarado:** `CommandSource::ClaudePlugins`
  (`installed_plugins.json` cruzado com `enabledPlugins` de usuário, projeto e
  local) e `CommandSource::CodexSkills` (`~/.codex/skills` e `.system`). Com
  evidência do motor, as pastas de plugin vêm do `init` e as skills do Codex vêm
  da consulta. Link de skill quebrado vira diagnóstico visível no popover.
- **Builtins do CLI, fail-closed:** só entra o que foi auditado no headless com
  `num_turns=0` e custo zero, declarado em `builtin_commands`. Claude:
  `/context`, `/usage`, `/skill-doctor`, `/list-agents`. `/model`, `/effort`,
  `/mcp` e `/config` ficam fora porque a Frota já tem esses controles; comandos
  de terminal (`terminal_slash_commands`) nunca aparecem. Com evidência do
  motor, builtin que a versão deixou de anunciar some.
- **Invocação não muda de contrato:** fonte nativa com `nativeSlash` viaja crua
  (plugin, skill embutida e builtin do Claude); skill do Codex expande o
  `SKILL.md` app-side, como os prompts já expandiam. O uso de `$nome` ou do item
  `skill` do `turn/start` fica pendente de sonda (a conta bateu no limite em
  14/09). Item sem corpo em contexto embutido segue fail-open como texto.
- **Resposta de builtin no fio:** a sonda mostrou que builtin não streama
  (`assistant` com modelo `<synthetic>`, sem `message_start`), e o adapter só
  usava o consolidado para completar cauda de delta, então a resposta sumia. O
  adapter agora emite `Text` para mensagem do executor cujo id nunca teve
  `message_start`. Fixture real `testdata/claude-2.1.270/builtin-usage.jsonl`.
- **Popover:** seções na ordem do dedup (Frota · Projeto · Plugins · motor),
  busca por nome, plugin e descrição, um chip por item e rodapé com a
  procedência ("anunciado pelo Claude Code no último turno, às 17:02" ou "lido
  das pastas"). O teto passou de 8 para 60 itens com rolagem; o `@` segue com 8.
- **Fora desta decisão:** instalar plugin da Frota (`frota-plugin.json`) pela
  interface é frente separada. MCP de plugin do provider continua cortado quando
  o plano MCP do run é gerenciado (`--strict-mcp-config`); marcar isso no item
  do plugin é a próxima dívida.

### ADR-190 · Resposta cortada: o composer não re-renderiza por token e o canal do run não trava

- **Contexto (14/09/2026):** duas respostas seguidas pararam no fio com 465 e
  455 caracteres, enquanto a sessão do Claude gravou 3046 e 3268
  (`stop_reason: end_turn`). Nenhum `result` chegou: a conversa não tinha linha
  em `turn_costs`. O binário instalado (t376) já trazia a drenagem da ADR-186.
  O `Frota.log` registrou `React error #185` no mesmo segundo em que cada bolha
  de texto nasceu, e o erro aparece no log desde 04/09.
- **Mecanismo, provado:** a pilha resolvida pelo sourcemap do bundle instalado
  (mesmo hash) mostra o erro nascendo em `store/chat.ts` (`handleEvent`), chamado
  pelo `onmessage` do `Channel`. O `Channel` do Tauri 2 só entrega a mensagem N
  depois da N-1 e avança o índice depois que o handler retorna. A exceção
  deixou todo evento seguinte do turno na fila para sempre, sem erro visível.
  O `#185` não era um loop infinito: o React 19.2 conta commits que deixam
  atualização síncrona pendente. A cada delta, o `CommandConsole` (que lia a
  conversa inteira) re-renderizava. `mentionNames={presets.map(...)}` recriava
  o `onSearch` do `lexical-beautiful-mentions`, cujo efeito chamava
  `setResults([])` e gerava mais um commit. Com os deltas enfileirados, o
  51º estourava. Reprodução no navegador com os 175 itens reais da conversa
  e o texto real: sem correção, o contador chega a 51 e o `handleEvent` lança
  no delta nº 52 (52 × 9 caracteres ≈ o corte gravado). Com correção, o
  máximo foi 1 e nada lançou, com CPU normal e 6× mais lenta.
- **Decisão, em três camadas:**
  - `LexicalComposer` compara `mentionNames` por conteúdo, não por identidade.
  - `useConvDoComposer` (`components/chat/convDoComposer.ts`) dá ao composer a
    mesma referência da conversa enquanto só crescer o texto da bolha em
    streaming ou mudar `runLiveness`. Item novo, ferramenta ou diferido mudando
    e qualquer outro campo da conversa trocam a referência.
  - `entregarSemTravar` (`lib/entregaDeEvento.ts`) envolve o `onmessage` do
    canal: a falha ao aplicar um evento vai para o log com o tipo, e os
    próximos continuam chegando. Fail-open no render; nada é re-tentado nem
    sintetizado.
  - `relatoVisivel` põe UM aviso por run no fio ("Um evento deste turno falhou
    ao ser exibido, e pode faltar conteúdo acima…"), numa task nova, fora da
    pilha que acabou de lançar. Só log não bastava: o `#185` estava no log
    desde 04/09 e ninguém soube.
- **Evidência:** `entregaDeEvento.test.ts` replica a regra de índice do
  `Channel` e mostra o turno congelando sem a proteção e chegando ao `result`
  com ela. `convDoComposer.test.ts` usa o fio real de `src/test/fio-real.json`
  e passa pelo `handleEvent` de verdade (foi assim que `runLiveness` apareceu).
- **Limites:** respostas já gravadas cortadas não se reparam. O `Popper` do
  menu de modo ainda atualiza por delta, por callback assíncrono fora da fase de
  commit, e não alimenta o contador. `SessionCostItem` e `WorkingIndicator`
  continuam re-renderizando por token. O reprodutor de navegador foi uma sonda
  descartável, não virou teste e2e.

### ADR-191 · Retomada por limite só promete reset quando leu o horário, e a nota endereçada chega pelo composer

- **Contexto (14/09/2026):** uma conversa do Codex bateu o limite semanal com
  a mensagem real *"try again at Sep 19th, 2026 10:12 AM"*. O `reset_hint` veio
  vazio, porque `extract_reset_hint` só reconhecia `resets …` (formato do
  Claude). A retomada caiu no backoff cego (13:51, 13:53, 13:57, 14:05) e o
  banner dizia "após o reset do limite", enquanto o incidente dizia "retorno
  não informado" e a janela de uso mostrava 4d 20h. Não houve mistura com a
  sessão do Claude: a conversa do Claude tinha o próprio limite, lido certo, e
  retomou às 14:10. Na mesma hora, uma pergunta enviada só como `@nota/…` pelo
  composer chegou ao agente como endereço cru.
- **Decisão:**
  - `extract_reset_hint` aceita também `try again at …`; `parseResetHint` lê
    `Mês dia(st|nd|rd|th), ano hh:mm AM/PM` no relógio local.
  - Limite sem horário legível tem motivo próprio
    (`RESUME_REASON_LIMIT_SEM_RESET`). O banner diz "nova tentativa, sem
    horário de reset informado", e o reenvio não afirma que o limite resetou.
    O backoff não muda.
  - `withNotasDoTurno` (`lib/fleet/promptCascade.ts`) resolve as duas portas
    de nota e é chamado pelos dois envios. O `ChatPanel` chamava só `withNotes`.
- **Evidência:** teste Rust e TS com a mensagem real do Codex; teste da nota com
  o conteúdo e o escopo reais da nota do incidente, mais uma guarda que lê o
  `ChatPanel` e exige a mesma porta da mesa.
- **Limites:** os anexos da nota ficaram de fora nesta decisão e foram
  resolvidos na ADR-192. A retomada de dias continua sendo um `setTimeout` em memória, que não
  sobrevive a reiniciar o app.

### ADR-192 · A nota endereçada chega com os anexos, como anexo de verdade do run

- **Contexto (14/09/2026):** a nota do incidente da ADR-191 tinha dois prints,
  e eram eles o assunto da pergunta. O bloco `<notas-do-usuario>` levava só o
  texto; o agente só viu as imagens porque abriu os arquivos do disco por conta
  própria. Havia um segundo buraco no caminho: Claude e agy liberavam leitura
  (`--add-dir`) só na pasta do PRIMEIRO anexo, e o anexo da nota mora em
  `attachments/notes/<id>/`, não em `attachments/<conv>/`.
- **Decisão:**
  - `comporNotasNoPrompt` devolve também os anexos das notas entregues, e o bloco
    cita os nomes dentro da moldura ("Anexos desta nota (enviados com este
    turno): …"), para o agente amarrar arquivo e nota.
  - `withNotasDoTurno(…, attachments)` devolve prompt e a lista do run: os
    anexos do composer primeiro, depois os das notas, sem repetir caminho.
    Composer (`ChatPanel`) e mesa (`send.ts`, via `comporCascata`) usam a mesma
    função; os anexos entram no run e na bolha do fio, que mostra o que foi
    de fato enviado.
  - `pastas_dos_anexos` (Rust) emite um `--add-dir` por pasta distinta, no
    Claude e no agy. O Codex já passava `-i` por arquivo.
  - Nada muda na fronteira de segurança: `resolve_live` continua exigindo
    caminho sob a raiz de anexos (a pasta de notas está sob ela) e a
    capability por motor continua filtrando o que não é suportado, com aviso.
- **Evidência:** teste com a nota real e os dois prints dela; teste do
  `resolve_live` com o caminho real da nota e uma travessia barrada; teste de
  argv do Claude e do agy com anexo de conversa mais anexo de nota.
- **Limites:** apagar a nota apaga os arquivos, e a bolha antiga passa a mostrar
  o anexo como expirado. O limite de 8 anexos vale só na hora de anexar no
  composer; a soma com os da nota não é cortada, porque cortar em silêncio
  seria pior.

### ADR-193 · Arquivo citado no fio abre na mesma aba do explorador

- **Contexto (14/09/2026):** clicar em `dialog-centralizado.spec.ts` numa
  resposta deu "não achei … no projeto". Dois defeitos somados: o nome solto
  era tratado como arquivo da raiz (o real está em `app/e2e/`), e o clique no
  fio mandava para o editor externo, enquanto o explorador abre no palco
  (ADR-157). O mesmo gesto tinha dois idiomas.
- **Decisão:** link e código inline de arquivo no fio chamam
  `abrirMencaoDeArquivo`, que usa `openFileTab`, a mesma aba do explorador.
  "Abrir no editor" continua como ação secundária do visualizador e no menu de
  clique direito. Markdown fora do projeto, nas raízes autorizadas, segue no
  visualizador de Markdown. Nome solto é resolvido pelos arquivos que a
  conversa tocou e, depois, pela busca do índice do projeto; com mais de um
  candidato, o aviso lista quais são, sem abrir um no chute. O tooltip passa a
  dizer "Abrir X numa aba".
- **Limites:** o visualizador ainda não posiciona na linha citada (`:42`), por
  isso a linha saiu do tooltip. O "Abrir no editor" do menu de clique direito
  ainda não resolve nome solto.

### ADR-194 · O helper utilitário cabe no prazo: sem hooks, sem raciocínio, e o erro diz o motivo

- **Contexto (15/09/2026):** "Sugerir mensagem" do painel de Alterações falhava
  com "Falha ao sugerir a mensagem". `utility_usage_daily` mostrou o quadro
  maior: o helper (`claude -p` com haiku) tinha 0 sucessos em semanas, em
  `composer_suggestions` (48 chamadas num dia), `turn_receipt` e
  `commit_message`. Estouro de prazo não gerava log. Medido: cada one-shot
  pagava os hooks globais do usuário (quatro apps, um tocando som no `Stop`;
  "ok" em 4,97s com hooks e 3,0s sem) e, no commit, o haiku raciocinava: 1902
  dos 2035 tokens de saída eram thinking e o diff real de 17 mil caracteres
  levou 19,6s a 43,7s, contra um prazo de 8s. `--effort low` não reduziu.
- **Decisão:**
  - Todo one-shot de meta-tarefa passa `--settings {"disableAllHooks":true}`.
    `--setting-sources ""` foi descartado: ganharia 0,4s, mas descartaria o
    `env` do settings do usuário, de que a autenticação pode depender.
  - `utility_helper_command` roda com `MAX_THINKING_TOKENS=0`. O juiz do
    Fusion não passa por ele e mantém o raciocínio.
  - `commit_message` ganha 30s de prazo (gesto com spinner) e o prompt limita o
    corpo a 5 tópicos. Três rodadas com o diff real: 4,7s, 12,3s e 11,3s.
  - Estouro de prazo vai para o log. `mensagemDaFalhaUtilitaria` traduz o
    código do gateway ("O modelo auxiliar não respondeu a tempo.").
- **Limites:** com prompt curto o helper fica em 3,6 a 4s. `turn_receipt` (3s)
  segue sem chance e `composer_suggestions` (4s) fica no limite; mudar esses
  prazos é decisão de produto pendente. O diff enviado ao helper não inclui
  arquivos novos ainda não rastreados pelo git.

### ADR-195 · Imagem citada por link no fio abre na aba e ganha miniatura

- **Contexto (15/09/2026):** numa conversa com o agy, o motor salvou a captura
  do Playwright em `~/.gemini/antigravity-cli/brain/<id>/` e escreveu o link
  `file://` na resposta. O link parecia clicável e o clique não fazia nada:
  `parseFileTarget` só aceitava arquivo externo terminado em `.md`, e o
  `MarkdownLink` cancelava a navegação sem ter o que abrir. A leitura já estava
  autorizada no Rust (`scoped_file_path` libera o brain do agy, `~/.claude` e os
  anexos) e o `ProjectFileViewer` já mostrava imagem. Faltava ligar os dois.
- **Decisão:**
  - Arquivo externo, nas mesmas raízes autorizadas, passa a valer como alvo
    quando é Markdown ou imagem. A lista de imagem é a do visualizador
    (`imageMimeType`), para o link não prometer o que a aba não mostra.
  - O clique numa imagem externa abre a aba de arquivo (ADR-193) pelo caminho
    absoluto. O visualizador lê o absoluto como veio e esconde "Abrir no
    editor", que só funciona com caminho relativo ao projeto.
  - Link de imagem com caminho concreto ganha miniatura logo abaixo, com a
    moldura da evidência de tool, e abre no mesmo Lightbox, que ganha a origem
    `arquivo`. Nome solto não ganha miniatura, porque seria chute.
  - Essa origem é a primeira do Lightbox que vem de texto do modelo. Por isso a
    leitura passa só pelo `read_project_file_bytes`, com contenção no Rust e
    `assertSafeRasterImage` antes de virar URL. Os gestos "Abrir no app padrão"
    e "Mostrar na pasta" do Lightbox resolvem caminho relativo ao app_data_dir,
    então não aparecem para essa origem. A pasta continua no clique direito do
    link.
- **Limites:** caminho relativo ao cwd do motor (`.playwright-mcp/x.png`) só
  resolve se estiver dentro do projeto. Captura fora das raízes autorizadas
  segue sem link, e alargar essas raízes é decisão do Rust, não do fio.

### ADR-196 · O anel mede até onde o motor compacta, e a compactação se prova em números

- **Contexto (16/09/2026):** a pessoa perguntou se o `/compactar` compactava
  de verdade. Compactava: o `compact_boundary` do turno de 15/09 registrou
  882.525 → 8.090 tokens em 2min38. Mas o app não mostrava a prova. O turno de
  compactação devolve `result` sem `usage`, a medida morre, e o anel ficava sem
  número. Ao mesmo tempo, a régua era nossa: o anel media contra a janela do
  modelo e oferecia compactar a 70% dela, enquanto o limiar real depende de
  modelo, `autoCompactEnabled`, ambiente e `/autocompact`. Com
  `CLAUDE_CODE_AUTO_COMPACT_WINDOW=400000` num modelo de 1 milhão, o anel
  marcava 37% no ponto em que o Claude Code resume a conversa.
- **Evidência (claude 2.1.270, medido):** `get_context_usage` por
  `control_request`, `detail: "summary"`, num processo
  `-p --input-format stream-json --resume <sid>` sem mensagem de usuário.
  Responde em 0,7s sem hooks nem MCP, custa zero, deixa a sessão com o mesmo
  md5 e devolve `totalTokens`, `maxTokens`, `autoCompactThreshold` (967.000 no
  padrão, 367.000 com a variável acima, ausente com `autoCompactEnabled:
  false`) e `autocompactSource`. Numa cópia de sessão terminando logo após uma
  compactação, `totalTokens` foi 34.995, não o milhão velho. `/context` e
  `/autocompact` em texto também funcionam no headless, mas são Markdown para
  pessoas; a fonte é o controle estruturado. Fixtures em
  `testdata/claude-2.1.270/context-usage*.jsonl`.
- **Decisão:**
  - Capability nova nos dois lados: `context_ceiling:
    Option<ContextCeilingProbe>` no Rust, `contextCeilingProbe` em
    `lib/agentContext.ts`, com teste-gêmeo e a coerência "exige
    `session_resume`". Só o Claude Code declara.
  - A sonda (`context_probe.rs`, comando `read_engine_context`) roda fora do
    turno, com prazo de 8s e `kill_on_drop`. A gramática do CLI mora em
    `agent::claude_context_probe_command`, ao lado do one-shot. Falha é erro
    com motivo, nunca leitura vazia.
  - Quem pergunta (`lib/engineContext.ts`): o anel visível com medida e sem
    leitura para aquela sessão e modelo, o gesto de abrir o popover e o fim de
    uma compactação nativa. Nunca no envio e nunca com turno da sessão rodando.
    A leitura vale só para a sessão e o modelo em que foi feita; falha preserva
    a última leitura boa e mostra o motivo no popover.
  - Com leitura, o percentual do anel é contra o limiar do motor ("até a
    compactação automática"), o popover diz onde ela dispara e quanto falta.
    Compactação desligada mostra a janela como teto e avisa que encher derruba
    o turno. Sem leitura, nada muda e nada se afirma.
  - O `COMPACT_OFFER_THRESHOLD` (0,70) continua como decisão de produto, mas
    agora sobre o teto que o motor aplica: oferecer antes do motor agir, numa
    pausa natural, em vez de no meio da tarefa.
  - No fim de `/compactar` nativo, a sonda mede o contexto resumido, o número
    entra no anel e o marco do fio vira "Contexto compactado · 882.525 →
    34.995 tokens, medido pelo Claude Code.".
- **Limites:** Codex e agy seguem sem limiar lido (nenhum canal auditado). O
  custo da compactação (US$ 4,67 no caso de 15/09) ainda aparece como turno
  comum em `turn_costs`; etiquetar é outra frente. A leitura não se renova
  sozinha se a pessoa mudar `/autocompact` fora do app; o gesto de abrir o
  popover relê.

### ADR-197 · A compactação do agy é detectada pelo que o stream real manda

- **Contexto (16/09/2026):** a Frota nunca registrou aviso de compactação do
  agy, embora conversas rodadas por ela tenham compactado ("Olist
  implementações", "Sobre a meta", uma do sicredi). O adapter procurava
  `compaction_info` num step, com base num fixture escrito à mão
  (`conversation_id: "a1"`). Esse campo existe no binário, mas nunca apareceu
  no stream-json.
- **Evidência (agy 1.2.4, capturada):** duas compactações provocadas em forks
  da conversa "nuvem" (a original intacta). A compactação chega como step
  `checkpoint` DONE **sem `usage`**, com 12 a 15 s; a resposta seguinte cai de
  ~255 mil para ~22 mil. O checkpoint auxiliar já registrado em fixture real de
  versão anterior traz `usage` de 121 tokens e dura 0,57 s. Um segundo turno
  numa conversa pequena na 1.2.4 não emite checkpoint. O agy decide pela
  estimativa própria contra 256.000 (estudo em
  `docs/contexto-dos-motores-estudo.md`, §3.1).
- **Decisão:** `checkpoint` DONE sem `usage` abre uma compactação pendente com
  o nível conhecido antes dele. A próxima resposta com `usage` confirma: se o
  contexto não caiu, nada se afirma; se caiu, o fio recebe "Contexto cheio: o
  Antigravity resumiu a conversa sozinho · antes → depois tokens.", só com o
  depois quando o run começou pela compactação. Sem resposta até o `result`,
  o aviso sai sem número. Um aviso por run. O caminho de `compaction_info`
  continua, deduplicado pelo mesmo marcador.
- **Limites:** o anel do agy ainda mede contra ≈1.000.000. O teto de 256.000 só
  existe no banco interno do agy (`gen_metadata`); ler esse dado é decisão
  pendente, registrada no estudo.

### ADR-198 · O anel do Codex e do agy mede até onde cada um compacta de verdade

- **Contexto (16/09/2026):** a ADR-196 levou o anel do Claude Code ao limiar do
  próprio motor. Codex e agy seguiam contra a janela: o Codex contra 258.400
  quando compacta em 244.800, e o agy contra ≈1.000.000 quando compacta perto
  de 256.000. A conversa "nuvem" do agy aparecia com 25% e estava a 97%.
- **Evidência (estudo em `docs/contexto-dos-motores-estudo.md`):**
  - Codex 0.154.0: fórmula do código (`openai_models.rs`, `context_window.rs`)
    validada ao token no binário real contra uma Responses API local, inclusive
    overrides e cortes (244.800 · 100.000 · 500.000→244.800 · janela 400.000 no
    gpt-6-astra→360.000 com 380.000 reportados). `config/read` do app-server
    devolve a config efetiva sem turno e sem cota; o catálogo local traz janela,
    máximo e percentual efetivo. O Codex compara o `total_tokens` da última
    chamada (entrada e saída), não só a entrada.
  - agy 1.2.4: cada geração grava a estimativa do agy e o limite (256.000 nos
    Gemini Flash) no `gen_metadata` da conversa, caminho protobuf 1→9→10 medido
    em 8.514 de 8.548 gerações. Experimento controlado: estimativa 255.444 com
    257.274 reais não compactou; cruzar 256.000 compactou. A estimativa é a
    mesma do `/context` do agy.
- **Decisão:**
  - `ContextCeilingProbe` ganha `CodexConfigCatalog` e `AgyGenerationRecord`,
    nos dois lados, com teste-gêmeo.
  - `EngineContext` passa a declarar a origem do limiar (`engine-report`,
    `engine-config`, `engine-record`) e, quando existe, a contagem própria do
    motor (`engineEstimate`). O anel mede essa contagem contra o limiar; o
    popover mostra a estimativa ao lado da última chamada da API e explica a
    origem com palavras diferentes, porque a confiança não é a mesma.
  - Leitura com contagem própria vale só para o nível de contexto em que foi
    feita: a cada turno o anel relê (leitura local, sem processo). Codex relê
    por sessão e modelo, usando o modelo resolvido da conversa.
  - O rollout do Codex passa a medir `last_token_usage.total_tokens`, com a
    entrada como fallback.
- **Limites:** o registro do agy não é contrato; campo ausente vira nenhuma
  afirmação e o anel volta à janela. Escopo `body_after_prefix` do Codex não
  afirma limiar. O catálogo do Codex é cache interno dele; modelo fora dele é
  erro com motivo no popover. A validação do Codex com turno da OpenAI fica
  para depois de 19/09 (cota esgotada).

### ADR-199 · O recibo do turno fala só do que muda decisão, e a régua de ações aparece onde decide

- **Contexto (16/09/2026):** o dono do produto achou a barra de fim de turno
  confusa ("concluído sem nada", "preciso ver o total de cache?", "o que é
  reconstruído?") e pediu ações sob hover. Um especialista de UI/UX revisou a
  peça contra o STYLEGUIDE e o código (mock em `docs/mocks/recibo-do-turno.html`,
  alternativas A/B/C). Escolhida a **A**. Esta ADR revisa a escolha "tudo
  visível" (mock B) de 17/08, que já previa o hover "se a densidade incomodar".
- **Achados:** de sete peças por turno, só o custo e as ações do último turno
  mudam decisão. Entrada/saída não ajudam e "10↓" enganava (exclui o cache
  lido). "+N reconstruído" em âmbar gritava em todo turno sem pedir nada (§2).
  A barra tinha borda de linha única (§4) e botões de 22px fora da escada
  (§13). O diff de um turno antigo abria o diff ATUAL do worktree. E um
  `result` de bastidor sem texto, custo nem token virava "concluído · 7s · US$
  0,000" no topo da resposta (reproduzido com o Claude Code 2.1.270: ao retomar
  depois de uma tarefa em segundo plano que parou, o CLI fecha esse envelope
  antes do turno pedido).
- **Decisão:**
  - Legenda sem borda: desfecho, duração e custo (ou modelo, quando não há
    custo). Em sucesso, o ✓ sem a palavra (que fica para leitor de tela), verde
    só no turno que acabou de fechar. Erro e limite mantêm o rótulo.
  - Entrada, saída, contexto reaproveitado e contexto reenviado saem da linha e
    viram a quebra no tooltip da ponta (`resumoDosTokens`).
  - Régua de ações à vista no turno mais recente. Nos anteriores, aparece no
    hover ou no foco do turno (`group/turno` no `GroupRow`, mesmo gesto do
    balão do usuário), fica à vista com reação dada ou formulário aberto, e
    aparece sempre em tela sem hover. O diff só no turno mais recente.
  - Botões da régua no degrau `icone-chip` (§13).
  - O adapter do Claude descarta o `result` de bastidor (`num_turns` 0, custo
    zero, sem texto nem token); builtin com texto e compactação com custo
    continuam fechando turno. Na tela e no Companion, `result` parcial sem
    conteúdo não vira recibo; parcial com custo real continua aparecendo.
- **Limites:** "custo acima do seu limite em âmbar, com o motivo e o botão
  Compactar" depende de um teto de custo por turno que ainda não existe nas
  Configurações; sem ele, nenhum limiar inventado pinta o custo. Os 2 recibos
  vazios já gravados antes da correção do adapter somem pela regra da tela.

### ADR-200 · Bastidores: acompanhar trabalho em segundo plano ao lado da conversa, em uma vista ou em mosaico

- **Contexto (16/09/2026):** a conversa só dizia "2 trabalhos em background ·
  bash", sem dizer quais nem mostrar saída. O pedido: acompanhar subprocessos,
  shells e subagentes como no CLI, abrindo uma vista ao lado ou N vistas em
  mosaico sem tirar o foco da conversa, "sem problema de desempenho nem de
  processo órfão". Plano em `docs/bastidores-plan.md`, mock em
  `docs/mocks/bastidores.html` (alternativa escolhida: vista ao lado e mosaico).
- **Evidência (B0, capturas reais de 16/09/2026, fixtures em `testdata/`):**
  - Claude 2.1.270, shell em segundo plano: `task_started` e o `tool_result`
    trazem o `output_file` desde o início; o arquivo é texto puro e cresce ao
    vivo. No modo headless ele MORRE ~5 s depois do `result` (`task_updated`
    com status `killed`, que o adapter não reconhecia), mesmo com o teto de
    espera de 4 h, que só segura workflow e subagente.
  - Claude 2.1.270, subagente em segundo plano: fica vivo, cada mensagem e tool
    dele chega com `parent_tool_use_id`, `task_progress` traz tokens, tools e
    duração, e o fim reinvoca o modelo com um segundo `result`.
  - Codex 0.154.0 (binário real contra Responses API local): `exec_command` que
    passa do `yield_time_ms` continua depois do `turn/completed`, com
    `item/commandExecution/outputDelta` por linha e `processId`. A Frota
    ignorava os deltas. Como o app-server da Frota é por turno e morre no fim
    dele, o terminal também só vive durante o turno.
  - agy 1.2.4: `run_command` entrega a saída só no fim do passo.
- **Decisão:**
  - Nenhum processo novo. O Rust só LÊ: tail por polling com offset (arquivo
    validado: `.output` dentro de `tasks/` sob `/tmp/claude-*`), teto de bytes
    por leitura e de linhas por vista, limpeza de ANSI e `\r`, recuo do
    intervalo quando o arquivo para, fim quando a vista fecha, o canal cai ou o
    arquivo some. Polling e não FSEvents: poucos arquivos, sem crate nova e sem
    as pegadinhas de permissão do FSEvents.
  - Saída ao vivo do Codex (`ToolOutput`) desviada em `lib/agent.ts` para o
    store `bastidores`, com buffer circular e flush agrupado: não entra no fio,
    não persiste e não re-renderiza a conversa a cada linha.
  - Lista derivada dos itens da conversa: tarefa (arquivo de saída), subagente
    (passos pelo pai), comando com saída ao vivo, processo do `mc-work`, e
    comando sem saída ao vivo dito com honestidade.
  - Índice na aba "Bastidores" do painel direito (entre Alterações e
    Contexto), navegável por teclado (↑/↓, Enter abre, F fixa, Esc fecha), com
    contador dos vivos na aba. As vistas abrem à direita da conversa, dentro do
    cartão central, até 3: uma ao lado, duas empilhadas, três com uma em cima e
    duas embaixo. `react-resizable-panels` (já no app); o `ChatPanel` nunca
    remonta.
  - A primeira versão pôs o índice dentro do painel das vistas porque o
    `ContextPanel` estava no teto da guarda de tamanho. O teto não decide
    produto: o `ContextPanel` foi dividido (roteamento das abas fica nele; a aba
    Contexto virou `ContextoDoProjeto` + `contextoDoProjetoPecas`), e os
    controles migrados entraram na escada §13 e no filete de dois papéis em vez
    de levar a dívida para as baselines.
  - Cinco abas mudaram a receita da tira: com largura igual os rótulos
    truncavam ("Alteraç…") em qualquer janela até 2300px com o pior contador.
    As abas passam a crescer pelo conteúdo (`flex-auto`) e o rótulo aparece a
    partir de 492px de tira (medido: 491px com "999" em Alterações e "12" em
    Bastidores); abaixo disso, só ícone com nome em `title`/`aria-label`. O e2e
    `painel-abas` passou a verificar truncamento em cada largura.
  - `task_updated` com `killed` passa a encerrar o trabalho como interrompido.
  - **Correção (build #386):** o Claude 2.1.270 abre task até para o Bash comum
    que demora (`is_backgrounded: false`, `output_file: ""`, captura real em
    `testdata/claude-2.1.270/comando-em-primeiro-plano.jsonl`). A Frota ignorava
    o campo: cada comando longo virava "trabalho em background" na linha viva e
    enchia o índice de itens concluídos sem nada para abrir. O adapter agora
    segura essas tasks e só as emite se um `task_updated` trouxer
    `is_backgrounded: true` (o binário emite esse patch); sem o campo, segue como
    antes. O índice deixa de listar terminado sem saída, o que também limpa o
    que já estava gravado, e a vista de um trabalho terminado sem saída não diz
    mais que "a saída vem no fim".
  - **Comandos do turno (build #387, pedido do usuário):** comando longo (`bun
    run test`, build) é o que mais se quer acompanhar, mesmo sem ser segundo
    plano. Entra no índice como "comando" o Bash (nome canônico do contrato)
    que manda saída ao vivo ou passa de 3 s; o rápido fica só no fio, e o de
    subagente fica nos passos dele. A vista mostra a linha de comando e, no
    fim, o resultado guardado no item (com "N de M linhas" quando a conversa
    guardou só um trecho). Um timeout único, só para o comando vivo mais novo,
    faz ele entrar ao completar 3 s; sem comando novo, nenhum relógio.
  - Terminado mostra a duração em vez da palavra "concluído": o estado já está
    no ícone, e a palavra fica no `title` e no leitor de tela. O painel ganha
    superfície própria (`bg-card`, a mesma do painel direito) para não se
    confundir com o fundo da conversa.
  - O rodapé do composer mede a própria largura (`@container/composer`):
    abaixo de 560px, Interromper e Enfileirar ficam só com o ícone, e o rodapé
    quebra linha em vez de vazar do cartão, que foi o que se viu com a conversa
    estreitada pelos Bastidores.
  - **Terminal no painel direito (build #390, mock
    `docs/mocks/bastidores-terminal.html`, A2 + C1):** mesmo com o rodapé
    responsivo, dividir o cartão central espremia o composer em três linhas e
    empilhava dois X (o do painel e o da vista). As vistas saem do cartão e
    abrem na própria aba Bastidores: com vistas abertas a aba mostra o
    terminal, e um botão volta à lista sem fechá-las. O painel direito alarga
    para 46% (teto de arrasto 58%) enquanto o terminal está à vista e volta à
    largura anterior quando a última vista fecha; a conversa e o composer não
    mudam de tamanho. Uma vista por aba, cada aba com o próprio X; "lado a
    lado" empilha até 3, cada uma com cabeçalho e X. ←/→ trocam de aba, Esc
    fecha todas. Visual de terminal com tokens próprios (`terminal-*`, §2),
    escuros nos dois temas como o `hud-shell`; seleção por superfície e peso,
    sem tinta. O terminal é só leitura: a Frota traduz o que o motor já
    entrega (sem PTY nem emulador; as capturas reais não trazem ANSI porque
    os motores rodam comandos sem TTY).
- **Limites:** parar um item pelo motor fica para a fase B4 (Claude exige
  transporte bidirecional; Codex exige manter o app-server vivo). Shell do
  Claude e terminal do Codex só vivem durante o turno no modo headless, e a
  vista diz isso quando eles morrem. Subagente mostra as tools, não o texto de
  raciocínio.


### ADR-201 · MCP com login: assinatura estável, uma leitura do Keychain, registro dinâmico e a tela que responde "quem autentica"

- **Contexto (16/09/2026):** três queixas do usuário na mesma tela. (1) Toda
  abertura de Configurações → MCPs pedia a senha do Keychain, várias vezes em
  fila. (2) O `vercel`, adicionado por `claude mcp add --transport http`,
  mostrava "requer autenticação · 0 tools" com o interruptor ligado e nenhum
  botão de login. (3) A tela em si: cabeçalho que rola, X translúcido, três
  painéis de contexto antes do primeiro MCP, cada MCP um cartão de ~250px com
  quatro linhas de agent abertas e a mesma prosa repetida, "roteado pelo
  Frota" quatro vezes por cartão. Mock aprovado em `docs/mocks/config-mcps.html`.
- **Achado 1, medido na máquina, não deduzido:** a ACL do item
  `dev.vinicius.mycockpit.mcp-oauth` no login.keychain tinha **nove cdhashes**,
  um por build em que o usuário clicou "Permitir sempre". O app era assinado
  ad hoc (`--sign -`), e o requisito designado de um binário ad hoc é o
  próprio cdhash, que muda a cada compilação. Para o Keychain cada build era um
  app estranho. A correção de terreno do `mcp-auth-plan.md` (item 5) dizia que
  "sobrevive a rebuild sem prompt": **estava errada**, e a ACL prova.
- **Achado 2:** o Frota lia o Keychain muitas vezes por abertura: a descoberta
  chamava `tem_credencial` por servidor × agent, o painel pedia o status por
  servidor, e o plano do turno lia de novo. Por isso os prompts vinham em fila.
- **Achado 3:** o login do app exigia `oauth.clientId` pré-registrado no
  `.mcp.json` (o plano tirou o registro dinâmico porque o AS do prime não o
  expõe). MCPs adicionados pelo CLI não têm o bloco. O AS do Vercel
  (`vercel.com`) **expõe `registration_endpoint`**, e o Claude logou exatamente
  por registro dinâmico: o Keychain dele tem `mcpOAuth` com `clientId` próprio
  para vercel, prime-mcp e supabase. A sonda do Frota bate sem token, leva 401
  e chamava de "requer autenticação" algo que funciona no turno do Claude.
- **Decisão 1, assinatura:** `scripts/build.sh` assina com a identidade
  `Frota Dev Signing` (certificado de code signing auto-assinado, criado nesta
  máquina; `FROTA_SIGN_IDENTITY` troca o nome) e só cai no ad hoc, avisando,
  quando ela não existe. Verificado: dois binários diferentes assinados com
  ela têm o mesmo requisito designado, `identifier "dev.vinicius.mycockpit"
  and certificate root = H"28d4…"`. O Keychain vai pedir **uma** última vez
  ("Permitir sempre") e depois nunca mais entre builds. Developer ID continua
  sendo o conserto para distribuição (mesma causa raiz do ADR-013).
- **Decisão 2, uma leitura por processo:** `mcp_auth` guarda em memória a cópia
  do que está no Keychain, por `server_id`; gravar e apagar passam por lá.
  Erro de leitura não entra no cache (é tentado de novo). O plano já admitia
  "Keychain + memória do processo" como os dois únicos lugares da credencial.
- **Decisão 3, registro dinâmico volta (revoga o item 2 da correção do plano):**
  `OauthConfig.client_id` e `callback_port` viram opcionais. Sem bloco `oauth`,
  um MCP HTTP sem credencial nenhuma na configuração é **elegível ao login do
  app** (`login_pelo_app_possivel`): descoberta pela cadeia normativa a partir
  do 401, porta de callback livre escolhida na hora, cliente público registrado
  (RFC 7591, `token_endpoint_auth_method: none`), `client_id` guardado junto
  do token para refresh e logout. AS sem `registration_endpoint` e config sem
  `clientId` recusa com motivo legível. Cliente pré-registrado no arquivo
  continua vencendo. Header ou bearer por env NÃO é elegível (quem autentica é
  a variável), segredo literal barra sempre, stdio não tem endpoint.
  `native_reason` não muda: o `vercel` segue portável nativamente, e passa a
  ir pelo proxy do app assim que o app tem token. `mcp_instalacao` segue
  olhando só o bloco declarado.
- **Decisão 4, a tela:** cabeçalho opaco e fixo (título, escopo do projeto,
  Redescobrir) dentro do painel; uma linha de resumo (total, ativos, pedem
  login, só no CLI); **uma linha por MCP**, fechada por padrão, com chips por
  motor; o cartão aberto começa por "Quem autentica" com três respostas
  honestas (o Frota; o CLI de origem; "no próprio CLI, não verificado", porque
  o login do CLI não é observado) e a ação ao lado; prosa dos gestos vai para
  o `title`; contexto (acompanhamento, inventário, garantia do Keychain) vem
  DEPOIS da lista. Copy: **"pelo Frota" sai** de todos os rótulos (dentro do
  app é implícito; o ponto de estado já diz).
- **Verificado:** `cargo test` 839, `vitest` 4249, `tsc -b` 0, guardas do guia
  verdes. Fixture nova: metadata real do AS do Vercel (16/09/2026).
- **Segue fora:** SSE/WS pelo proxy (A3), Client ID Metadata Document (quando
  algum servidor real exigir), e ler o inventário de login dos CLIs para
  afirmar "conectado" em vez de "não verificado".

### ADR-202 · Imagem na aba Alterações mostra a versão do disco e abre no Lightbox

- **Contexto (16/09/2026):** o estudo do Maestri deixou 22 quadros `.jpg` e um
  `.mp4` na working tree. Expandir qualquer um na aba Alterações dizia só
  "Arquivo binário, sem diff de texto.", e o clique na coluna levava à mesma
  frase. O visualizador de arquivo (ADR-193), o Lightbox com origem `arquivo` e
  a leitura contida `read_project_file_bytes` (ADR-195) já existiam.
- **Decisão:**
  - Binário cuja extensão está na lista do visualizador (`imageMimeType`) e que
    não foi removido ganha, ao expandir, a miniatura da versão do disco e o
    botão "Abrir na aba". A leitura usa o mesmo cache e a mesma porta da
    imagem citada no fio, pela raiz do diff (worktree quando a conversa está
    isolada).
  - O clique na miniatura abre o Lightbox com a galeria de TODAS as imagens
    visíveis do diff, na ordem da lista: quadros de uma sequência se percorrem
    com ←/→.
  - Imagem modificada diz "Versão atual. A anterior ainda não aparece aqui."
    Mostrar só a atual sem dizer seria teatro de comparação.
  - Cada recarga do diff esquece as URLs lidas sob aquela raiz
    (`esquecerImagensCitadas`) e relê o disco. No fio a captura não muda; no
    diff o agente regrava o arquivo, e o cache eterno mostraria pixels velhos.
- **Limites:** imagem removida e vídeo seguem com a frase de binário. Antes e
  depois lado a lado pede um comando Rust que leia o blob do `HEAD`, com o
  mesmo teto de 32 MB, e fica para quando houver imagem modificada a comparar.

### ADR-202 · Configurações: um chrome só, e a seção entrega apenas o conteúdo

- **Contexto (16/09/2026):** depois da ADR-201 a aba de MCPs ganhou uma barra
  fixa própria e ficou "num padrão diferente das demais": as outras seções
  desenhavam o título dentro do conteúdo, cada uma com a sua margem, a sua
  ação (três delas com `<button>` cru, duas com `<Button compacto>`), o seu
  seletor de projeto ("Projeto:" solto em Extensões, pílula no MCP), e o X do
  dialog flutuava num chip translúcido por cima do scroll. Pedido do usuário:
  *"o modal de configurações seja algo genérico, componentizado: o top bar, os
  botões de ações, para que tudo tenha os mesmos espaços, as mesmas margens.
  Só o conteúdo efetivamente muda."*
- **Decisão:** o chrome pertence ao `SettingsDialog`. Uma barra fixa de 48px
  no topo do painel, com título à esquerda, seletor de escopo ao lado, ações à
  direita e o X no fim do mesmo trilho. Abaixo, uma área de rolagem com as
  mesmas margens para toda seção. A seção só entrega o conteúdo; o que vai na
  barra ela declara pelo `SectionHeader` (mesmo componente de antes, mais o
  prop `escopo`), que monta na barra por **portal** (`settingsChrome.tsx`).
  Portal, não store: os botões continuam com as closures da própria seção e
  não há estado a sincronizar. Seção que não desenha cabeçalho (Especialistas
  antes desta ADR) recebe o título do registro na barra. Fora do dialog
  (teste com `renderToStaticMarkup`) o `SectionHeader` renderiza inline.
- **Consequências:** o X deixa de ser chip translúcido e vira um ícone no
  trilho; `pr-9` deixa de ser necessário no conteúdo. As três ações cruas
  (Modelos, Máquina, Serviços) viraram `<Button size="compacto"
  variant="ghost">`, o único idioma de ação de barra. O seletor de projeto de
  Extensões saiu do corpo e foi para o escopo da barra, como o do MCP. A
  descrição da seção fica como primeira linha do conteúdo, com margem fixa.
- **Verificado:** `vitest` 4257, `tsc -b` 0, guardas do guia verdes.

### ADR-203 · Agy esperando tarefa em segundo plano: a resposta aparece na hora e a espera se explica

- **Contexto (17/09/2026):** num projeto com o Agy, o agente subiu `npx next
  dev` em segundo plano, respondeu, e o turno ficou "trabalhando" por 25 min
  até a interrupção manual; só então a resposta apareceu (recuperada do
  histórico). Medido com o Agy 1.2.5 (`testdata/agy-1.2.5/`): o `-p` espera as
  tarefas em background terminarem, com teto no `--print-timeout` (60 min na
  Frota), e **a ponte `stream-json` segura os steps** durante a espera. O único
  sinal ao vivo é uma linha de stderr: `root agent idle; waiting for N
  background task(s)`. O stderr só era lido no fim do processo. Quando a tarefa
  termina, os steps saem de uma vez e o agente ainda comenta o resultado, então
  esperar faz sentido para tarefa que acaba; o servidor é que nunca acaba.
- **Decisão:** o runner repassa as linhas do stderr AO VIVO ao adapter
  (`collect_stderr_tail_live`, fila limitada, linha até 4 KiB; a cauda do
  relatório continua igual) e ganha dois ganchos genéricos no contrato,
  `on_stderr_line` e `on_heartbeat` (a batida de 5 s da amostra de memória),
  ambos vazios por padrão. O `AgyAdapter` reconhece a frase literal, mostra a
  resposta final que já está no transcript do próprio Agy (mesma fonte da
  recuperação no parar, ADR do incidente de 29/08) e explica a espera numa
  linha: o turno fica aberto enquanto a tarefa roda e parar encerra a tarefa
  junto. Se o transcript ainda não tiver a resposta, a batida tenta de novo.
  Quando a ponte libera os steps, o texto do step já mostrado é pulado pelo
  `step_index`; ferramentas e o comentário novo do agente chegam normalmente.
- **Não fizemos:** encerrar o turno sozinho. Encerrar mata a árvore do run
  (`run_processes::terminate_run`), inclusive o servidor que o agente acabou de
  dizer que está no ar; manter processo vivo depois do turno criaria órfão fora
  do app. Quem decide parar é a pessoa, e o vigia de silêncio (10 min) segue
  lembrando.
- **Verificado:** captura real reproduzida em replay (resposta sem duplicar,
  aviso uma vez, batida quando o transcript atrasa, parar sem repetir),
  `collect_stderr_tail_live` com a linha real em pedaços, `cargo test` 864.

### ADR-204 · O navegador do projeto mora dentro do app: aba principal e janela flutuante

- **Contexto (17/09/2026):** o Chromium do projeto já era da Frota e já chegava
  como screencast, mas só se via numa janela separada do sistema, aberta por
  Configurações. Pedido do usuário: "um navegador DENTRO do Frota, não uma janela
  separada", ou um stream ao vivo estilo pop-up. PRD em
  `docs/navegador-na-frota-prd.md`.
- **Decisão:** o mesmo stream ganha duas apresentações dentro do app: a aba
  principal "Navegador" e uma janela flutuante presa ao cartão central. A lógica
  sai do `BrowserPanel` para `useNavegadorDoProjeto`, a cara para
  `NavegadorVista` (só props), e cada lugar (aba, flutuante, janela separada) é
  um contêiner. Nada de webview nativo ou iframe (o racional de
  `browser-plan.md` segue valendo).
- **Um stream por projeto:** o preview do backend é indexado por projeto, então
  aba e flutuante nunca montam juntas, e parar o preview espera 400 ms para a
  troca de vista não cortar a vista nova.
- **Captura é observação:** `browser_capture.rs` pede `Page.captureScreenshot`
  em PNG e manda os bytes direto para o anexo (mesmo núcleo do colar) ou para o
  clipboard pelo Rust, sem base64 no Channel e sem exigir o piloto.
- **Consequências:** "Observar e pilotar" em Configurações leva à aba. A janela
  separada continua compilando, sem entrada na UI; sai quando nada mais depender
  dela. Marcar e enviar (R4), qualquer MCP de navegador (R5) e vigia (R6) ficam
  para a próxima sprint.
- **Verificado:** vitest 4296, `tsc -b` 0, guardas verdes, `cargo test` 869;
  vista e flutuante num harness com Tauri simulado. Falta a verificação no app.

### ADR-205 · Capricho no fio e no composer: tabela em dois formatos, citação que viaja no texto e arquivos soltos pelo Tauri

- **Contexto (17/09/2026):** o usuário pediu o cuidado de detalhe que viu no
  Maestri: copiar tabela como tabela, citar um trecho selecionado, arrastar
  arquivos para o composer. PRD em `docs/capricho-fio-composer-prd.md`.
- **Tabela:** a mesma matriz vira TSV + HTML ("Para planilha") ou GFM ("Como
  Markdown"), pelo botão da tabela e pelo menu de contexto. `copyRich` grava os
  dois formatos por `ClipboardItem` e cai para o evento `copy`; sem permissão
  nova de escrita no front.
- **Citação, a decisão estrutural:** no rascunho ela é bloco persistido (coluna
  `blocos`), mas no envio vira texto num formato curto (`❝ autor · hora` + `> `).
  Recusado o campo `quote` no `ChatItem` agora: ele teria de atravessar fila,
  reenvio, envio forçado, revezamento e Companion, passando por `ChatPanel`,
  `CommandConsole` e `store/chat.ts`, todos no teto da catraca de tamanho. O
  formato em texto atravessa tudo isso sem mudança, e a apresentação e o prompt
  o traduzem: a bolha mostra ↳, a porta do prompt emoldura como dado. Custo
  aceito: o texto guardado no fio contém o formato, e o id do item citado não
  viaja (o R5, rolar até a original, vai procurar pelo trecho).
- **Pílula:** primitiva própria (`barra-de-selecao.tsx`) porque Popover e
  DropdownMenu desfazem a seleção ao abrir.
- **Arquivos soltos:** pelo `onDragDropEvent` do Tauri com caminho real, e um
  comando só de metadados (`caminhos_soltos`) para separar pasta de arquivo;
  `dragDropEnabled` não se desliga.
- **Verificado:** vitest 4332, `tsc -b` 0, guardas verdes (catraca de filete
  apertada), `cargo test` 871; harness no Chromium para pílula, chip, bolha,
  prompt, menu da tabela, clipboard e arrasto simulado. Falta WebKit e arrasto
  real no app.

### ADR-206 · Revezamento de motor leva a memória do /compactar e diz o custo antes

- **Contexto (17/09/2026):** trocar de motor numa conversa já existia
  (revezamento, ADR-165), mas levava só os últimos 6.000 caracteres do fio, o
  gesto não dizia o custo e o trilho oferecia motores que não podiam receber.
  PRD em `docs/revezamento-de-motor-prd.md`.
- **Decisão:** o envelope de handoff passa ao contrato v2. A conversa viaja pela
  mesma memória por significado do `/compactar` (`memoriaDaConversa`), orçada
  pela janela do motor de destino com a régua `transplante`, mais as últimas
  mensagens literais com 25% do orçamento. O piso é o orçamento inteiro do v1
  (6.000), para janela desconhecida nunca levar menos do que já levava. O prompt
  fala o rótulo do motor. Memória e últimas mensagens dividem uma moldura H3.
- **Gesto:** a faixa do revezamento preparado mostra o custo estimado pela mesma
  montagem do envelope e a régua de caracteres por token do orçamento, rotulado
  como estimativa. O seletor separa "mesmo motor, mantém a sessão" de "outro
  motor, sessão nova" e só oferece destino elegível.
- **Não fizemos agora:** ramo com outro motor (depende do spike S4) e voltar ao
  motor anterior retomando a sessão.
- **Verificado:** vitest 4342, `tsc -b` 0, guardas verdes; golden test de 100
  itens; H3 (`trust.test.ts`) e os testes v1 do handoff sem alteração.

### ADR-207 · Navegador do projeto: queda avisada pelo evento de saída e órfão encerrado, nunca adotado

- **Contexto (17/09/2026):** o navegador morria em silêncio (a UI só descobria na
  próxima consulta) e, se o app caísse, o Chromium do projeto ficava vivo
  segurando o perfil, e o próximo "Ligar" falhava sem explicar.
- **Decisão:** a queda é detectada pelo `process_exited` que o `ProcessRegistry`
  já emite, não por sondagem no ticker: um aviso por processo, com "Ligar de
  novo", e parada pedida (`stopped`) não avisa. No boot, `browser_orfaos` acha
  Chromium com perfil da Frota sem sessão viva (pid ou grupo de processos) e o app
  oferece encerrar; o encerramento confere de novo antes do sinal.
- **Recusado:** adotar o órfão na sessão. O ciclo de vida do navegador (TERM no
  grupo, tail, kill_all no quit) mora no `ProcessRegistry`, que não tem o handle de
  um processo que ele não lançou; adotar criaria uma sessão que o app não consegue
  desligar direito.
- **Verificado:** fixture real de `ps` (Chrome for Testing 151 lançado por `zsh
  -lc` com as flags do app), testes do vigia; vitest 4351, `cargo test` 874.

### ADR-208 · MCP de navegador escolhe a forma de conexão no binding

- **Contexto (17/09/2026):** o plano do run injetava sempre `--cdp-endpoint`, que
  só o Playwright MCP entende; o Chrome DevTools MCP ficava de fora do navegador do
  projeto (K5).
- **Decisão:** a forma de conexão vira coluna do binding (`browser_conexao`,
  migração 50, padrão `cdp-endpoint`): `browser-url` passa `--browserUrl` com o
  endpoint http e `ws-endpoint` passa `--wsEndpoint` com o WebSocket lido do
  `/json/version` (recusado fora de loopback). As flags que abririam outro
  navegador saem do plano efêmero, com aviso no fio. Nada compara nome de MCP; a
  pessoa escolhe a forma em Configurações.
- **Verificado:** flags conferidas no `--help` do chrome-devtools-mcp 1.9.0
  (fixture), testes das formas e do parse do WebSocket, testes do Playwright
  intactos; prova real com o MCP conectado pelas duas formas a um Chromium lançado
  com as flags da Frota, listando a página dele. `cargo test` 878, vitest 4361.

### ADR-209 · Marcar região no navegador: elementos reais por CDP e traço desenhado na própria página

- **Contexto (17/09/2026):** para apontar algo da página ao agente, a pessoa
  anexava a página inteira e descrevia em texto. PRD R4 do navegador.
- **Decisão:** a marcação acontece sobre o quadro congelado; o Rust converte a
  região para pixels CSS e pergunta ao Chromium quem está ali
  (`DOM.getNodeForLocation` em amostras + uma função em página que devolve papel,
  nome, seletor e caixa). O traço é desenhado na própria página e recortado pelo
  `Page.captureScreenshot`: o app não decodifica nem desenha PNG. A imagem só vai a
  motor que lê imagem (capability); a descrição vai sempre.
- **Recusado agora:** domínio `Accessibility` (experimental) e
  `DOM.describeNode`/`getBoxModel` por elemento; a função em página dá o mesmo em
  uma chamada e é testada contra Chromium real.
- **Riscos aceitos:** o traço aparece por um instante na página que o agente pode
  estar vendo; a página que muda no meio (URL) cancela, mas mudança sem trocar de
  URL não é detectada.
- **Verificado:** fixtures reais de CDP, ordenação (contêiner grande não passa na
  frente do botão, defeito pego pelo teste), teste real contra Chromium, harness da
  vista; vitest 4364, `cargo test` 883.

### ADR-210 · A mensagem sai inteira; só o trecho pesado perde a formatação

- **Contexto (17/09/2026):** a ADR-184 mandou a mensagem INTEIRA para texto cru
  paginado acima de 16.384 caracteres. Na prática isso pegou resposta normal: a
  mensagem real de `conversation_items` (conversa `aa416ab9`, item 169) tem
  18.130 caracteres, 555 linhas e maior linha de 300, nada de patológico, e
  mesmo assim virou "1 de 5" sem realce. Pior: as 4 fronteiras de 4.096 caíram
  todas DENTRO de blocos de código, então a leitura em ordem quebrava no meio do
  código, e o `<pre>` com `max-h-80` escondia o resto atrás de uma rolagem
  interna. O relato do usuário: "preciso ler o output completo em ordem até pra
  entender o que o code agent fez".
- **Medição nesta máquina (parse + GFM + highlight + render):** conteúdo normal é
  LINEAR, 18 KB = 72 ms, 145 KB = 146 ms, 290 KB = 234 ms. A patologia é a LINHA:
  2.048 pontos = 11 ms, 8.192 = 108 ms, 16.384 = 427 ms, 65.536 = 6,8 s, contra
  10 ms para 65.536 letras. Montar a linha inteira num `<pre>` custa layout, não
  parse: 143 KB numa linha = 29 ms no Chromium. Ou seja, paginar nunca foi o que
  protegia; o teto por caractere de mensagem é que estava no lugar errado.
- **Decisão:** `fatiasDaMensagem` divide a mensagem em fatias NA ORDEM, cada uma
  inteira, e `Markdown` renderiza todas em sequência. Fatia `rico` passa pelo
  parser; fatia `cru` (bloco com linha acima de `MAX_RICH_LINE`) sai como texto
  literal no lugar onde estava, com aviso. A unidade da fatia é o bloco de cerca
  inteiro quando a linha pesada está dentro de ``` (senão a abertura ficaria numa
  fatia e o fecho em outra). Nada de paginação: `fatias.join("\n")` reconstrói o
  texto recebido, e isso é teste. `MAX_RICH_TEXT` vira teto de ÚLTIMO recurso
  (262.144), e acima dele a mensagem sai crua, mas de uma vez só, sem cortar.
- **Integridade:** continua valendo o que a ADR-184 diz (transcript, texto
  enviado aos motores e eventos normalizados são integrais). O que muda é só a
  leitura: agora o corpo inteiro está no DOM, selecionável e em ordem.
- **Limites:** o pior caso que sobra é uma mensagem no teto toda feita de linhas
  de 2.040 pontos (261 KB = 893 ms medidos), duas ordens de grandeza abaixo dos
  32 s do incidente Maclan. Fatia pesada no meio de uma lista ou tabela separa o
  que vem antes do que vem depois (a lista reinicia a numeração); é degradação
  local e visível, não perda de conteúdo.
- **Estado alterado:** nenhum. Só render.
- **Verificação:** fixture real do Maclan (a linha de 142.976 pontos agora sai
  inteira, com o Markdown em volta ainda formatado), a mensagem real de 18 KB
  renderizada pelo componente (8 blocos de código, 9 títulos, 95,6 ms, sem texto
  cru), invariante de reconstrução em cinco formas de entrada, `bun run test`
  4.367, `tsc -b --force`, `bun run check`.

### ADR-211 · Voltar ao motor anterior retoma a sessão dele

- **Contexto (17/09/2026):** revezar já funcionava num sentido: sai do motor A,
  entra no B com a memória transplantada e sessão nova. Voltar para A pagava o
  envelope inteiro de novo, embora o CLI do A ainda tivesse a sessão daquela
  conversa, com o contexto que ele mesmo construiu. O R5 do PRD do revezamento
  pedia a volta barata; faltava onde guardar a sessão de quem sai.
- **Decisão:** `ConvState.sessoesAnteriores` guarda, por motor, a sessão que ele
  deixou (`sessionId`, modelo resolvido, último item que ele viu, quando saiu).
  `commitTransplantState` grava na saída. Ao voltar, `planoDeVolta` (puro, em
  `lib/retomadaDeMotor.ts`) decide entre **retomar** e **transplantar**, e só
  retoma quando as três coisas são verdade: o motor declara `sessionResume` no
  registry (capability, nunca nome), existe sessão guardada e o item onde ele
  parou ainda está no fio. Retomando, o prompt não leva envelope: leva a
  AUSÊNCIA, o que o outro motor fez desde aquele item, no mesmo orçamento do
  revezamento. A mesma função decide a sessão do run e o prompt do turno.
- **Persistência:** coluna, não blob. Migração **51**
  (`conversations.sessoes_anteriores TEXT`, conferida contra a máxima real do
  `lib.rs`, que era 50). JSON quebrado na leitura vira "sem sessão guardada":
  perder a chance de retomar é degradação, derrubar a conversa não é.
- **Honestidade:** a linha do fio diz qual das duas aconteceu ("retomou a sessão
  que já tinha aqui" x "o contexto recente foi transferido"). Se o resume falha,
  o backend já cai no fallback de memória e avisa por `resume://fallback`; aí o
  front esquece a sessão morta daquele motor E escreve no fio que a volta virou
  transplante, senão a linha anterior ficaria mentindo no histórico.
- **Estado alterado:** `sessoesAnteriores` na conversa (memória e coluna nova) e
  a sessão usada no run que reveza. Nada no runner.
- **Limites:** a sessão pode ter morrido no CLI sem ninguém avisar; quem
  descobre é o run, e a queda é o caminho do fallback acima. O texto da ausência
  não reconstrói o que o outro motor fez em disco: cita o fio e os arquivos que
  o chamador souber informar.
- **Divisão:** a união `ChatItemBody` saiu de `store/chat.ts` para
  `store/chat/itens.ts` (a catraca disparou; a porta `@/store/chat` re-exporta
  `ChatItem`), e a baseline do `store/chat.ts` desceu de 2.236 para 2.150.
- **Verificação:** 13 testes novos (guardar, esquecer, plano de volta com
  capability falhando fechado, corte que sumiu do fio, texto da ausência, ida e
  volta guardando as duas sessões, resume falhado com nota honesta);
  `bun run test` 4.397, `tsc -b --force`, `cargo test` 883, `bun run check`.

### ADR-212 · Arrastar dentro da janela não pode depender do `dataTransfer`

- **Contexto (18/09/2026):** a reordenação de projetos e de conversas na barra
  lateral usava HTML5 puro: `setData` com um tipo próprio
  (`application/x-mycockpit-project`, `…-conv-<projeto>`), `dragover` que só
  chamava `preventDefault` quando `dataTransfer.types` continha esse tipo, e
  `drop` que lia o id de volta. No app instalado o usuário relatou: "consigo ver
  o efeito do arrastar, mas não funciona a função em si". Era o spike S2 da
  sprint, respondido pelo relato: o `dragstart` acontece, o gesto não se
  conclui. O tipo próprio não sobrevive à travessia pelo pasteboard do sistema,
  então o `dragover` nunca liberava o alvo e o `drop` nunca era entregue.
- **Decisão:** `lib/arrastoInterno.ts` guarda EM MEMÓRIA o que está sendo
  arrastado, entre o `dragstart` e o fim do gesto. O `dragover` decide pela
  carga guardada (não por `types`) e registra o alvo por onde passou; a
  conclusão acontece no `drop` **ou** no `dragend`, que é do elemento de origem
  e chega mesmo quando o `drop` se perde. O `dataTransfer` fica só com o visual
  (`text/plain` para o fantasma). Concluir é idempotente: o gesto se limpa ao
  fechar, então `drop` seguido de `dragend` não reordena duas vezes.
- **Alcance:** vale para todo arrasto DENTRO da janela, e é a mecânica que o
  C-D3 (arrastar arquivo da árvore, trecho do diff, imagem do fio) vai usar.
  Soltar arquivo VINDO DE FORA continua sendo o evento do Tauri
  (`onDragDropEvent`), que é o único caminho com caminho real de arquivo.
- **Estado alterado:** nenhum novo; só o caminho que aciona `reorderProjects` e
  `reorderConversations`. A prop `convDnd` deixou de existir.
- **Limites:** o módulo não desenha onde a linha vai cair (sem indicador de
  posição); o gesto continua tendo o teclado como equivalente pelo menu de
  contexto. Não testamos webview por webview: a mecânica foi escolhida para não
  depender de qual entrega o `drop`.
- **Verificação:** 6 testes do módulo (alvo do `dragover` concluindo sem `drop`,
  `drop` vencendo o último alvo, dupla conclusão sem efeito duplo, soltar em si
  mesmo, pairar sem arrasto, carga legível durante o gesto); `bun run test`
  4.407, `tsc -b`, `bun run check`. Falta a confirmação no app instalado, que
  depende do próximo build.
