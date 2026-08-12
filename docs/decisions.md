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
  fala; o usuário sabe quando o texto veio do plano B. O áudio é apagado em todo
  desfecho (inclusive `atexit`) e sobras de `kill -9` são varridas no boot: fala
  gravada não sobrevive à sessão que a gerou.
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
