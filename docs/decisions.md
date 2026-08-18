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
