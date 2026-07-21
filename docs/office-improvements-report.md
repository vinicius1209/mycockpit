# Relatório de oportunidades — Agent Office

> Pesquisa e recomendação em 20 de julho de 2026. Escopo: ambiente, features,
> rituais, personagens, feedback, sociabilidade, experiência do Boss, whimsy e
> acessibilidade. Este documento é exploratório; não altera a especificação
> vigente em `docs/agent-office.md`.

## Resumo executivo

O Office já cruzou a fronteira entre “dashboard com skin de jogo” e lugar vivo:
estado dos agents, missões, gates, entregas, movimentos, dia/noite, custos e
objetos da cena têm origem real. Por isso, o próximo salto não deveria ser
**mais movimento**, mas **mais consequência, explicabilidade e poder de ação**.

A tese deste relatório é:

1. **Evidência antes de espetáculo** — toda entrega deve permitir responder “o
   que mudou, como foi verificado e quanto custou?”.
2. **Informação vira lugar e lugar vira comando** — painel, corda, biblioteca,
   museu e quadro precisam abrir ou executar o fluxo real correspondente.
3. **Encanto como consequência** — salas evoluem, constelações aparecem e o
   acervo cresce somente quando fatos verificáveis acontecem.

Se houver espaço para apenas um pacote, a recomendação é o **Cockpit Confiável**:
**Painel Master Caution (#01) + Raio-X da entrega (#03) + Briefing desde a última
visita (#05)**. É o maior ganho de utilidade com o menor risco arquitetural e
faz o Office responder, num relance: **quem precisa de mim, o que realmente
aconteceu e qual é a próxima ação segura?**

## Base considerada: o que o Office já tem

Além de ler integralmente `docs/agent-office.md`, a análise conferiu os módulos
em `app/src/office/{engine,scene,bridge,ui}`. O disco foi tratado como fonte da
verdade quando já estava à frente do roadmap textual.

- Estado vivo por mesa e sala, conversa real, voz, gates, approvals, custo,
  câmera, LOD, rail espacial e Central do Boss.
- Mesa de reunião para lançar missões, quadro físico de agendamentos e posto de
  comando físico do Boss.
- Dez famílias de movimento ligadas ao runtime: kickoff, celebração, bastão,
  chegada, entrega ao Boss, handoff, café, descanso por auto-resume, guerra do
  Fusion e microvida determinística; também há pensamento andando e aceno por
  proximidade.
- Dia/noite local, TV de custos, whiteboard-kanban, caixas de projeto novo,
  cadeira vazia, pilha de entregas e sons discretos opt-in.
- Gato do escritório já implementado; sua rota é derivada de atividade real,
  não de aleatoriedade narrativa.
- Harness semântico de mobiliário, simulação fixa a 60 Hz e suporte a
  `prefers-reduced-motion`.

Consequência: nenhuma proposta abaixo conta novamente “pets”, “clima”, “TV”,
“kanban”, “missões na sala”, “sons”, “agents andando” ou “sala do Boss” como
novidade.

## Leitura dos concorrentes e referências

A pesquisa não buscou copiar layouts; buscou mecânicas transferíveis. Em julho
de 2026, as páginas oficiais consultadas mostram Gather, Kumospace, Teamflow e
SpatialChat ainda ativos. O [Gather 2.0](https://support.gather.town/articles/3950877146-overview-of-gather-1-0-features)
já havia sido lançado; “webhook objects” e presença de IA ainda aparecem como
itens futuros no [roadmap oficial](https://www.gather.town/roadmap), portanto
foram tratados como direção de produto, não como feature entregue.

| Vetor | Mecânicas observadas | Tradução útil para o Office |
|---|---|---|
| Escritórios virtuais | Gather oferece visão simplificada, disponibilidade e interações espaciais; [Kumospace](https://www.kumospace.com/help/status) explicita Available/Away/Focusing e usa portas, knock e [tablets com links persistentes](https://www.kumospace.com/virtual-office-guide/onboarding-for-employees); [Teamflow](https://www.teamflowhq.com/) enfatiza documentos/apps persistentes e cursores compartilhados; [SpatialChat](https://spatial.chat/product/virtual-office) trabalha presença e áreas de proximidade. | Limites de atenção explícitos, superfícies físicas que abrem contexto real, modo simplificado e presença humana somente quando houver sessão humana real. |
| Life/cozy sims | Stardew Valley transforma conclusão de conjuntos em restauração visível do espaço; Animal Crossing torna coleção e curadoria um motivo para retornar. | Evolução ambiental e acervo devem nascer de entregas verificadas, não de XP abstrato ou decoração aleatória. |
| Management sims | [Two Point Museum](https://www.twopointstudios.com/en/games/two-point-museum) combina layout, staff, expedições e acervo; [Software Inc.](https://softwareinc.coredumping.com/about/) torna equipes, papéis e capacidade legíveis; Prison Architect explicita filas, zonas e logística. | Expor fila, capacidade, gargalo, dependência, custo e resultado no próprio espaço; o Boss deve conseguir intervir no ponto do problema. |
| Produtividade lúdica | [Habitica](https://habitica.com/static/features) converte tarefas reais em progresso; o [GitHub](https://docs.github.com/en/account-and-profile/reference/profile-reference) liga achievements aos eventos que os originaram e mantém uma linha do tempo de contribuições. | Reconhecimento só com critério transparente e link para evidência; evitar recompensar volume de mensagens, tokens ou presença. |
| Mundos de agents | [Generative Agents](https://arxiv.org/abs/2304.03442) explora memória, reflexão e planejamento; [Voyager](https://arxiv.org/abs/2305.16291) usa biblioteca crescente de skills e feedback de execução; [AutoGen](https://microsoft.github.io/autogen/stable/user-guide/agentchat-user-guide/tracing.html) enfatiza tracing do runtime. | Materializar memória, skills e traces reais. A parte “vida social autônoma” fica de fora porque produziria teatro e custo sem melhorar o comando. |

## Critérios de seleção

Cada ideia foi filtrada por quatro perguntas:

- Há um evento, configuração ou dado real que sustente o estado visual?
- A ideia ajuda a compreender, decidir ou agir — ou só ocupa pixels?
- O valor permanece com animação reduzida e sem áudio?
- É viável no renderer WebGL do WKWebView sem empurrar estado por frame ao React?

**Esforço relativo:** **P** = extensão localizada sobre sinais existentes;
**M** = novo contrato ou superfície com integração moderada; **G** = nova
infraestrutura, persistência ou colaboração. Não são estimativas em dias.

**Ondas:** **O-2** = extensão direta da base atual; **O-3** = depende de novo
contrato/histórico; **backlog** = aposta maior que deve ser validada primeiro.

## 20 oportunidades

### A. Comando e observabilidade

| Nome curto | Inspiração | O que muda no Office | Sinal REAL — por que não é teatro | Esforço | Onda sugerida |
|---|---|---|---|---|---|
| **#01 Painel Master Caution** | Hierarquia de alertas de cockpit + Andon | Um painel físico na Diretoria e um espelho semântico na rail mostram **uma prioridade acionável por vez**. Expandir revela origem, consequência e ação exata; reconhecer não resolve o evento. | Gates, approvals, erro/recovery de missão, `blockedDir`, rate limit/auto-resume e CLI ausente. A prioridade é uma função determinística no `bridge`; sem evento, painel neutro. | P | O-2 |
| **#02 Caixa-preta do turno** | Flight recorder + tracing do AutoGen | Uma timeline por conversa/missão permite percorrer tool calls, handoffs, approvals, custo, erros e resultado. Um replay opcional reencena apenas eventos gravados, com faixa visual **REPLAY** e live pausado. | `AgentEvent`, itens do chat, stage runs e ledger, todos com timestamp/correlation id. O que não foi capturado aparece como lacuna; nunca é reconstruído por LLM. | M | O-2 |
| **#03 Raio-X da entrega** | Apps persistentes do Teamflow + links de evidência do GitHub | Clicar num papel da pilha ou balão de entrega abre uma ficha: resumo, arquivos tocados, diff, comandos, testes, citações, custo e conversa de origem. | Resultado do turno + eventos estruturados de ferramentas + estado real de git/teste. Campo não observado fica “não capturado”, nunca “aprovado” por inferência. | M | O-2 |
| **#04 Mapa térmico operacional** | Heatmaps de management sims + mapa de atividade do Bloomberg Launchpad | Toggle de piso para custo, latência, tempo esperando humano, falhas de ferramenta ou carga por sala/mesa; sempre uma métrica por vez e com legenda. | Ledger, timestamps de gate/turno e contadores discretos em janela móvel. Exige histórico limitado; até haver amostra real, a camada fica indisponível. | M | O-3 |

### B. Rituais e coordenação

| Nome curto | Inspiração | O que muda no Office | Sinal REAL — por que não é teatro | Esforço | Onda sugerida |
|---|---|---|---|---|---|
| **#05 Briefing desde a última visita** | Timeline do GitHub + common operating picture de salas de situação | Uma caixa de entrada na mesa do Boss resume somente deltas desde a última abertura: novas entregas, gates, falhas, retomadas e mudanças de custo, com deep link para a origem. | Log discreto existente/persistido + `lastSeenAt` local. É agregação determinística, sem nova chamada a agent e sem texto inventado. | P | O-2 |
| **#06 Corda Andon** | Sistema Toyota de Produção | Cada sala ganha um controle físico de interrupção segura. Com confirmação, ele cancela o turno/missão real, impede auto-resume daquele run e registra quem parou e por quê. | APIs reais de cancelamento e estado do run. A corda só fica ativa quando existe algo cancelável; se o runtime não suporta pause, a UI diz **Parar**, não finge pausar. | M | O-2 |
| **#07 Quadro de despacho** | Filas e zonas de Two Point/Prison Architect | Um quadro na sala comum mostra mensagens enfileiradas, missões e capacidade das mesas. O Boss pode reordenar ou reatribuir agent/model/effort dentro das guardas existentes. | Filas do chat, fases queued, probes de CLI e configurações reais. Toda mudança grava a mutação correspondente; itens não mapeáveis ficam somente na fila global. | G | O-3 |
| **#08 Trilhos de dependência** | Redes logísticas de management sims + handoffs multiagent | Linhas discretas entre salas mostram que um projeto aguarda artefato de outro; o trilho acende somente durante transferência e abre o contrato da dependência. | Novo metadata estruturado `dependsOn`/`providesArtifact` na missão ou entrega. Sem dependência declarada, não há linha; não inferir relações pelo texto. | G | backlog |

### C. Decisão e segurança antes da execução

| Nome curto | Inspiração | O que muda no Office | Sinal REAL — por que não é teatro | Esforço | Onda sugerida |
|---|---|---|---|---|---|
| **#09 Ensaio de missão em holograma** | Builder visual do AutoGen Studio + checklist de cockpit | Antes do launch, a mesa projeta fases, agents, modelos, effort, permissões e limites configurados. O Boss inspeciona o fluxo e confirma; o ensaio é visualmente distinto do escritório ao vivo. | É a configuração ainda não executada da missão. Nenhum avatar se move e nenhum estado vira “running” antes da confirmação real. Estimativa ausente não é fabricada. | M | O-3 |
| **#10 Mesa de decisão do Fusion** | War room + common operating picture | Durante uma disputa, os candidatos aparecem lado a lado com resposta, evidências, custo, latência, falhas e critério do vencedor; o Boss pode abrir cada trilha antes de aceitar. | Candidatos e resultado reais do `FusionRun`, ledger e traces. A mesa não prevê vencedor nem cria consenso; mostra o que cada run de fato produziu. | M | O-3 |
| **#11 Biblioteca de capacidades** | Skill library do Voyager + tablets persistentes do Kumospace | Estantes representam skills, tools e integrações instaladas. Livro aceso = uso recente bem-sucedido; marcador âmbar = permissão/health; clicar abre origem, versão, últimos usos e falhas. | Registry/probes e tool events. Capacidade não instalada não aparece; campos de health ausentes ficam desconhecidos, não verdes. | M | O-3 |
| **#12 Museu de entregas** | Museu de Animal Crossing + curadoria de Two Point Museum | O Boss fixa entregas importantes numa galeria persistente: preview, autoria do agent, projeto, data e botão “abrir evidências”. É acervo de trabalho, não inventário cosmético. | Somente delivery real explicitamente fixada pelo usuário, preferencialmente com teste/review associado. Remover da galeria não apaga o artefato original. | M | O-3 |

### D. Memória, progresso e whimsy verificável

| Nome curto | Inspiração | O que muda no Office | Sinal REAL — por que não é teatro | Esforço | Onda sugerida |
|---|---|---|---|---|---|
| **#13 Jardim de conhecimento** | Memória/reflexão de Generative Agents + restauração de Stardew Valley | Lições viram plantas ou livros: crescem quando reutilizadas, recebem etiqueta de origem e murcham visualmente quando vencidas ou marcadas como falhas. Clicar abre a lição e seu histórico. | `buildLearningBlocks`, `markLessonsUsed`, origem e resultado posterior. Crescimento exige uso observado; sem vínculo de resultado, apenas registra uso, nunca “sucesso”. | M | O-3 |
| **#14 Salas que evoluem organicamente** | Community Center de Stardew Valley + custom objects do Gather | Regras opt-in adicionam melhorias funcionais/visuais por marco: primeiro CI verde, documentação indexada, missão concluída ou integração saudável. Cada objeto traz uma placa “por que existe”. | Eventos versionados de CI/teste, entregas e health. Nada por tempo de uso, gasto ou nível genérico; ao perder health, o objeto sinaliza manutenção em vez de desaparecer. | M | O-3 |
| **#15 Constelação de evidências** | Contribution graph/achievements do GitHub | À noite, pontos discretos no teto da Diretoria formam uma constelação por eventos significativos; clicar numa estrela abre o evento. No reduced motion, vira painel estático. | Critérios públicos e links para missão concluída, teste verificado, revisão aceita ou gate resolvido. Sem streak, ranking, loot ou recompensa por tokens. | P | O-2 |
| **#16 Bolha de foco do Boss** | Estado Focusing do Kumospace + apps de foco | O usuário escolhe sala/missão e duração. O resto do prédio reduz labels, partículas e sons; notificações de baixa severidade aguardam, mas gates e falhas continuam visíveis. | Ação explícita do usuário + timer real + severidade determinística dos eventos. O modo nunca muda o estado dos agents nem declara que eles estão focados. | P | O-2 |

### E. Transparência, sociabilidade e plataforma

| Nome curto | Inspiração | O que muda no Office | Sinal REAL — por que não é teatro | Esforço | Onda sugerida |
|---|---|---|---|---|---|
| **#17 Crachá de capacidade e limites** | Disponibilidade de Kumospace + Team Builder do AutoGen | Clicar no agent mostra model, effort, permission mode, CLI, sessão/contexto, ferramentas autorizadas e motivo de indisponibilidade. É a “ficha técnica” do trabalhador digital. | Configurações, probes e sessão reais. Dados ausentes são omitidos/“desconhecidos”; mesa continua apagada se a CLI não existir. | P | O-2 |
| **#18 Presença multi-viewer real** | Gather, SpatialChat e cursores compartilhados do Teamflow | Um convidado autenticado entra como avatar próprio em modo leitura ou controle aprovado, pode seguir o Boss, apontar e inspecionar a mesma evidência. | Sessão autenticada + heartbeat; avatar some ao desconectar. Permissões por ação e projeto; jamais criar “colegas” NPC para preencher o espaço. | G | backlog |
| **#19 Gêmeo semântico do escritório** | Simplified View do Gather + human factors de cockpit | Uma visão DOM completa oferece headings por sala, lista de desks, estados anunciáveis, jump-to-target, alto contraste e todas as ações essenciais por teclado. | O mesmo `OfficeSnapshot` e as mesmas actions do bridge alimentam cena e visão semântica; não há segundo store ou estado divergente. | M | O-2 |
| **#20 Kit de objetos reativos** | Webhook objects do roadmap do Gather + apps embutidos do Teamflow | Manifesto declarativo cria objetos como lâmpada de CI, impressora de issues ou monitor de deploy, com schema, TTL, severidade e ação segura. É uma plataforma para integrações futuras. | Evento externo validado por adapter no `bridge`, com allowlist e timestamp. Sem evento válido, objeto fica neutro/off; a `scene` nunca acessa store ou rede diretamente. | G | backlog |

## Top 8 priorizado

Priorização por impacto no uso diário, esforço relativo, aproveitamento dos
sinais atuais e aderência à identidade “runtime real”.

| Prioridade | Ideia | Impacto | Esforço | Recorte inicial recomendado |
|---|---|---|---|---|
| **1** | **#03 Raio-X da entrega** | Transforma entrega bonita em resultado auditável e acionável. | M | Arquivos, comandos/testes observados, custo e link para conversa; diff avançado depois. |
| **2** | **#01 Painel Master Caution** | Reduz caça a gates/erros e torna a Diretoria um cockpit de verdade. | P | Priorizar apenas estados já existentes; uma atenção por vez e espelho na rail. |
| **3** | **#05 Briefing desde a última visita** | Dá motivo recorrente para abrir o Office sem gerar mais trabalho de agent. | P | Deltas da sessão e `lastSeenAt`; persistência longa pode vir depois. |
| **4** | **#02 Caixa-preta do turno** | Cria confiança, debugging e compreensão de custo/handoffs. | M | Timeline textual primeiro; replay animado somente após validar utilidade. |
| **5** | **#06 Corda Andon** | Converte o mundo em superfície de controle segura, não só observação. | M | Cancelar run + bloquear auto-resume + registrar motivo. |
| **6** | **#16 Bolha de foco do Boss** | Melhora uso prolongado e acessibilidade sensorial com pouco estado novo. | P | Filtro visual/sonoro e timer; sem integração de calendário no primeiro corte. |
| **7** | **#11 Biblioteca de capacidades** | Torna legíveis skills, ferramentas, permissões e saúde do ecossistema de agents. | M | Registry/probes + uso recente; sem marketplace ou instalação dentro da cena. |
| **8** | **#19 Gêmeo semântico** | Faz a interface espacial funcionar para teclado, leitor de tela e baixa estimulação. | M | Navegação/ações sobre o snapshot atual; manter paridade por testes de contrato. |

## Inspirações não óbvias

| Referência | Princípio extraído | Aplicação recomendada |
|---|---|---|
| [Bloomberg Launchpad](https://www.bloomberg.com/latam/producto/launchpad/) | Um bom cockpit deixa cada pessoa organizar monitores vivos, alertas e lentes sem perder a fonte dos dados. | Evoluir #04 e #20 para “lentes” configuráveis, mantendo um preset seguro e pouco ruidoso. |
| [Flight deck human factors da FAA](https://www.faa.gov/aircraft/air_cert/step/disciplines/flight_deck_human_factors) | Alertas precisam considerar prioridade, carga humana e ação corretiva; mostrar tudo com a mesma força é falhar. | #01 deve consolidar, inibir duplicatas e indicar ação — nunca virar árvore de Natal. A mesma disciplina sustenta o modo replay de #02. |
| [Andon da Toyota](https://www.toyota-global.com/company/history_of_toyota/75years/text/entering_the_automotive_business/chapter1/section4/item4.html) | O problema deve ficar visível no ponto de origem e o operador precisa conseguir parar a linha para evitar defeito em cascata. | #06 coloca o controle na sala afetada e registra a intervenção; o alerta leva o Boss ao lugar real. |
| [Emergency Operations Centers da FEMA](https://www.fema.gov/sites/default/files/documents/fema_eoc-quick-reference-guide.pdf) | Uma common operating picture alinha decisão, recursos e status entre participantes; layout e sightlines importam. | #10 apresenta candidatos do Fusion com a mesma base factual e #18 permite colaboração sem visões divergentes. |

## Não vale repropor / já existe ou já está contratado

| Tema | Situação encontrada | Decisão para este relatório |
|---|---|---|
| Dia/noite, luzes e ambientação temporal | Implementado em `scene/environment.ts` e aplicado sem retesselar. | Não propor clima/iluminação genérica. |
| TV, kanban, caixa de mudança, cadeira vazia e pilha do Boss | Implementados nas camadas de ambiente/rooms/props e alimentados pelo snapshot. | Não contar “mais objetos vivos” sem novo valor operacional. |
| Caminhadas, café, descanso, kickoff, handoff, Fusion, chegada e celebração | Packs de comportamento e walkers já cobrem os eventos reais. | Não propor NPCs andando ou reuniões decorativas. |
| Missões pelo Office | Mesa de reunião, dock e bridge de launch já existem. | Melhorar pré-voo (#09), fila (#07) e evidência (#03), não criar outro launcher. |
| Diretoria/Central do Boss | Sala, posto físico, briefing, atenção, custos e delegação já existem. | Evoluir a confiabilidade do cockpit, não criar outro dashboard. |
| Schedules, sons e rail espacial | Quadro de avisos, áudio opt-in e índice de salas/agents já estão no worktree. | Não usar como “novas ideias”. |
| Pet | Gato, sprite e comportamento ambiental já existem e refletem atividade. | Não adicionar mascotes sem papel informacional novo. |
| Minimap, segunda janela e presença visual do Fusion | Já constam no roadmap do design doc, ainda que nem tudo esteja entregue. | Não contabilizar como descoberta. #18 é diferente: colaboração multiusuário autenticada. |

## Ideias descartadas por violarem a invariante

| Ideia descartada | Por que não entra no roadmap |
|---|---|
| NPCs “funcionários” passeando para o prédio parecer cheio | Inventam presença e atividade. Um escritório vazio deve comunicar runtime vazio. |
| Conversas espontâneas fictícias entre agents | Gastam tokens, poluem memória e fazem parecer que houve coordenação real sem tarefa ou autorização. |
| Clima emocional inventado por heurística (“sala chuvosa porque o projeto está triste”) | Mistura metáfora com telemetria. Dia/noite real já é legível; estado crítico deve usar semântica explícita. |
| XP, streak ou ranking por mensagens, tokens e horas online | Recompensa volume e custo, não resultado. Incentiva comportamento contrário ao produto. |
| Loot boxes e cosméticos aleatórios por uso de agent | Não têm causalidade operacional e transformam gasto em caça-níquel visual. |
| Agents iniciarem missões surpresa ou aceitarem approvals sozinhos | Viola controle humano e pode causar efeitos externos. Ação relevante exige gesto/autorização real. |
| Replay sem rótulo, misturado ao live | Mesmo composto só de fatos passados, induz leitura errada do presente. Replay só é aceitável em modo explicitamente isolado. |

## Guardrails de implementação para qualquer escolhida

1. **Bridge continua sendo a fronteira:** stores, ledger, git, CI, integrações e
   rede entram somente por adapters do `bridge`; o `engine` recebe contratos
   puros e serializáveis.
2. **Scene continua imperativa:** Pixi consome deltas discretos; nada de React ou
   store por frame. Históricos devem ser limitados e agregados fora do ticker.
3. **Verdade incompleta é melhor que falsa certeza:** campo sem telemetria vira
   “não capturado” ou some; nunca inferir sucesso, health ou dependência a partir
   de texto livre.
4. **Live e replay não se misturam:** playback, dry-run e simulação usam moldura,
   paleta e label inequívocos e não podem emitir ações no runtime.
5. **Acessibilidade é paridade funcional:** `prefers-reduced-motion`, alto
   contraste, teclado e visão semântica devem preservar a mesma prioridade e as
   mesmas ações, não apenas desligar animações.
6. **Orçamento visual permanece conservador:** WebGL no WKWebView, no máximo 60
   fps, efeitos por transform/alpha e recomputação somente em transições. Nenhuma
   proposta depende de WebGPU.
7. **CLI ausente continua sendo ausência:** mesa apagada, ação bloqueada e motivo
   explícito; decoração, replay ou badge nunca podem mascarar indisponibilidade.

## Decisão sugerida

Antes de abrir uma onda grande de mundo/multiplayer, validar o Office como
instrumento de confiança com o pacote **#01 + #03 + #05**. Se ele aumentar a
frequência de uso e reduzir o tempo entre “algo aconteceu” e “sei o que fazer”,
o segundo investimento natural é **#02 + #06 + #11**. As apostas mais caras —
quadro de despacho, dependências, multi-viewer e kit de objetos — ficam melhor
quando essa camada de eventos/evidências já existir.

O critério de sucesso não deve ser “o escritório parece mais vivo”. Deve ser:
**o Office tornou mais rápido perceber, compreender e agir sobre trabalho real,
sem exigir que o usuário abra outra superfície para confiar no que viu.**

## Fontes consultadas

- Escritórios virtuais: [Gather Features](https://www.gather.town/features),
  [Gather Roadmap](https://www.gather.town/roadmap),
  [Kumospace — status e disponibilidade](https://www.kumospace.com/help/status),
  [Kumospace — áudio e salas](https://www.kumospace.com/help/spatial-and-room-audio),
  [Teamflow](https://www.teamflowhq.com/),
  [status oficial do Teamflow](https://teamflow.statuspage.io/) e
  [SpatialChat Virtual Office](https://spatial.chat/product/virtual-office).
- Jogos e gestão: [Stardew Valley — Community Center](https://www.stardewvalley.net/dev-update-20/),
  [Two Point Museum](https://www.twopointstudios.com/en/games/two-point-museum),
  [Software Inc.](https://softwareinc.coredumping.com/about/) e
  [Prison Architect](https://www.paradoxinteractive.com/games/prison-architect).
- Produtividade: [Habitica Features](https://habitica.com/static/features),
  [GitHub Contributions](https://docs.github.com/en/account-and-profile/reference/profile-contributions-reference)
  e [GitHub Achievements](https://docs.github.com/en/account-and-profile/reference/profile-reference).
- Agents: [Generative Agents](https://arxiv.org/abs/2304.03442),
  [Voyager](https://arxiv.org/abs/2305.16291),
  [AutoGen tracing](https://microsoft.github.io/autogen/stable/user-guide/agentchat-user-guide/tracing.html)
  e [AutoGen Studio](https://microsoft.github.io/autogen/stable/user-guide/autogenstudio-user-guide/usage.html).
- Referências operacionais: [Bloomberg Launchpad](https://www.bloomberg.com/latam/producto/launchpad/),
  [FAA Flight Deck Human Factors](https://www.faa.gov/aircraft/air_cert/step/disciplines/flight_deck_human_factors),
  [Toyota Andon](https://www.toyota-global.com/company/history_of_toyota/75years/text/entering_the_automotive_business/chapter1/section4/item4.html)
  e [FEMA EOC Quick Reference](https://www.fema.gov/sites/default/files/documents/fema_eoc-quick-reference-guide.pdf).
