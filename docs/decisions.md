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
