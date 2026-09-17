# AGENTS.md — o backend do turno

Escopo: `app/src-tauri/src/`. Leia antes de mexer em `agent.rs`, `mcp_control.rs`,
`tool_gateway.rs`, `plugin_mcp.rs` ou em qualquer `#[tauri::command]`.

Regra de repositório mora no `AGENTS.md` da raiz. Aqui só entra o que é desta
camada. Se a regra vale também no TypeScript, ela sobe pra raiz, não se duplica.

## A lei desta camada

> **Entre o Enter da pessoa e o primeiro byte no CLI não pode existir trabalho
> que não seja deste turno.**

Preflight não é do turno: o plano de MCP, o inventário de motores e a saúde dos
servidores respondem "como está a máquina", não "o que você pediu". Trabalho que
responde a essa pergunta é **quente antes**, nunca no caminho crítico.

**Por que existe.** Medido em 07/09/2026, no `run_agent`: `codex mcp list --json`
custava 1,3s em TODO envio, inclusive quando o motor do turno era claude-code, e
as sondas de MCP custavam mais 2 a 4s a cada 5 minutos (TTL de `mcp_health`),
sequenciais. O envio "travava" de 3 a 5 segundos com a tela imóvel. Nenhuma
dessas chamadas dependia do texto digitado.

## Subprocesso

1. **Nada de subprocesso síncrono no caminho de envio.** Se você precisa
   perguntar algo ao disco ou a uma CLI para montar o run, a resposta já tem que
   estar em cache. Sonda nova entra no aquecimento (abertura de projeto,
   watchdog, gesto explícito), não no `run_agent`.
2. **Todo `Command` tem timeout.** `proc::run` (`proc.rs`) **não tem** — é a
   camada crua, e usá-la direto no caminho de um turno é bug. Quem chama de
   dentro de `spawn_blocking` envolve em `tokio::time::timeout`
   (`INVENTARIO_TIMEOUT`, em `mcp_control.rs`). Sem teto, uma CLI pendurada
   trava o envio pra sempre, sem mensagem. E estourar o teto é **erro de
   inventário**, nunca lista vazia: vazio afirma "não tem MCP", que é outra
   coisa.
3. **Não levante inventário de motor que não é o do turno.** O preflight
   enumera só as fontes que os VÍNCULOS deste run referenciam (o prefixo do
   `server_id`) mais a fonte própria do motor, que sai da tabela
   `FONTES_DE_INVENTARIO`. Essa tabela é um registry: código genérico consulta,
   nunca escreve `if agent == "codex"`. A fonte própria entra mesmo sem vínculo
   porque é ela que prova a política efetiva, e esse gate é fail-closed.
   As superfícies de Configurações seguem com `FontesDoInventario::Todas` — lá a
   pergunta é "o que existe nesta máquina?", e omitir fonte esconderia servidor.
4. **Sondas independentes rodam em paralelo.** Fila de sondas faz cada MCP novo
   somar direto no tempo do Enter. `saude_em_cache` + `sondar_pendentes` fazem
   isso em três tempos (lê banco · sonda sem banco · grava banco), e a divisão
   **não é estética**: `Connection` do rusqlite não é `Sync`, e segurá-la por
   cima de um `await` torna o future do comando Tauri não-`Send`. Servidor
   repetido em dois vínculos sonda uma vez só.

## Cache

5. **Cache tem dono e tem gesto de invalidação.** TTL sozinho é o pior dos
   mundos: some quando você não quer e persiste quando você precisa que suma. O
   padrão bom é cache de vida do processo mais uma função de invalidação
   nomeada, chamada por um gesto real (instalou uma CLI, ligou um MCP, clicou
   "reverificar"). Referência absorvida: `login_shell_path` /
   `refresh_login_shell_path` do Buzz.
   **Ainda não existe** para o inventário nativo por CLI: o item 3 tirou o custo
   dos runs que não usam aquela fonte, mas um run do PRÓPRIO motor daquela fonte
   continua pagando o processo a cada envio. É a próxima dívida deste arquivo, e
   quando for paga, o item 10 passa a valer para ela.
6. **Nunca segure o lock enquanto o processo sobe.** Leia o cache, solte o lock,
   sonde, re-trave para escrever. Dois chamadores sondando junto é aceitável
   (último escritor vence, o resultado é o mesmo); um chamador bloqueando o
   spawn de outro turno não é.
7. **Estado morto preserva o que sabia.** Servidor que caiu continua declarando
   a lista de tools da última vez que esteve vivo, com backoff e tentativa
   preguiçosa na próxima chamada; só depois de esgotar as tentativas ele some do
   catálogo. Retirar tools na primeira falha muda o contrato do turno no meio.

## Comandos Tauri

8. **`#[tauri::command]` sem `async` roda na THREAD PRINCIPAL.** É a thread da
   UI: I/O ali congela a janela de verdade, não só faz esperar. Comando que toca
   disco, rede ou processo é `async fn` (ou `#[tauri::command(async)]`).
   Foi o caso de `mycockpit.rs::export_conv_context` e `export_context_bundle`,
   que escrevem o transcript inteiro (1,66 MB na maior conversa medida) mais
   varredura de diretório, a cada envio: hoje os dois são
   `#[tauri::command(async)]` (ADR-170). O corpo continua síncrono de propósito
   — é I/O de bloqueio, e é por isso mesmo que ele não pode morar na thread da
   UI.
9. **Payload grande no `invoke` é custo, não é grátis.** Argumento de comando
   atravessa a ponte serializado. Antes de mandar megabyte, pergunte se o
   backend não podia ler a fonte sozinho, ou se o payload não podia ser
   incremental.

## O que o run_manifest promete

10. **O manifesto declara o que foi CONFIRMADO, e o preflight é quem confirma.**
    Se um dia o plano passar a ser servido de cache quente, o manifesto tem que
    dizer que é de cache e quando foi verificado. Degradar é permitido; mentir a
    idade do dado não é, e é o mesmo princípio de "estado real, nunca teatro" da
    raiz.

## Inventário global na tela de MCPs

`provider_mcp_inventory::cli_installation` cruza motor, nome exato e transporte
na descoberta de Configurações. `cli_installation` na linha é configuração
observada, não binding nem health; inventário opaco, falho ou ambíguo é
`unknown`. Nunca converta isso em ausência ou sucesso de conexão (ADR-172).

O gesto `install_mcp_in_agent` reconsulta apenas o CLI de destino antes da
escrita global. Só ausência confirmada permite instalar; só entrada observada
permite remover. Inventário tem timeout de 4s e alteração de 10s, com
`kill_on_drop`. Isso não acrescenta inventário ao caminho de envio do turno.

## Canal de trabalho com cadastro global (ADR-173)

`work_mcp_setup` é dono da cache de cadastro: aquece no boot, reconsulta pelo
gesto de Configurações e invalida antes da alteração pelo CLI. O instalador
genérico também invalida ao alterar `mc-work`. O run só consome o snapshot e
registra a idade; alteração externa exige "Reverificar". Cadastro não é saúde.

O endereço do listener é exclusivo do run e herdado pelo filho MCP via ambiente,
nunca persistido no cadastro global nem descoberto apenas por CWD. Sem listener
vivo o helper declara zero tools. No fechamento, revogue conexões aceitas e
remova o socket. Processos de outra conversa nunca são acessíveis por ele.

O shell do registry está fora do sandbox do provider. Leitura, Auto e
planejamento inicial recebem só plano/update; bloqueie as tools de processos
também no efeito. FusionRo não recebe canal. O manifesto e `tools/list` devem
declarar a mesma lista permitida. Contratos: `work_gateway_tests.rs`,
`work_mcp_setup_tests.rs` e matriz gêmea Rust/TS de capabilities.

## Os testes que seguram isto

- `mcp_control.rs` (`mod tests`) — plano por binding, disposição de servidor
  indisponível, nomes de runtime.
- `mcp_control::tests::run_de_claude_nao_levanta_o_inventario_do_codex` e os
  três vizinhos — fixam o item 3, inclusive o caso do vínculo PORTADO (a fonte
  vem do dado, não do nome do motor) e o do motor sem fonte própria (agy hoje, o
  próximo motor amanhã).
- `mcp_control::tests::saude_em_cache_nao_repete_o_mesmo_servidor` e
  `saude_fresca_dispensa_a_sonda` — fixam o item 4.
- `agent.rs` (`mod tests`) — validação de conteúdo do run e fronteira de
  aceite.
- `cargo test` a partir de `app/src-tauri` é gate de entrega, não opcional.

Falta ainda um guarda que fixe o item 1 no geral (nenhum subprocesso inesperado
entre o `invoke` e o `RunManifest`). Os testes acima cobrem a fonte que já
custou; o genérico não existe.

## Sonda do limiar de contexto (ADR-196)

`context_probe::read_engine_context` lê onde o motor compacta sozinho, por
capability (`context_ceiling`). Claude: retoma a sessão só para um
`control_request` (`get_context_usage`), sem mensagem de usuário, sem hooks e
sem MCP. Codex (ADR-198): `config/read` no app-server mais o catálogo
`models_cache.json`. agy (ADR-198): lê só-leitura o `gen_metadata` da conversa;
o id passa pelo alfabeto de UUID antes de virar caminho, e protobuf cru nunca
lê além do buffer. Nada disso é preflight nem entra no `run_agent`. Quem chama
é o TS (`lib/engineContext.ts`), que garante que não há turno da mesma sessão
rodando. Prazo de 8s, `kill_on_drop`, erro com motivo.

## Tail dos Bastidores (ADR-200)

`bastidores::bastidor_seguir` só LÊ o arquivo de saída que o motor escreve
(`.output` em `tasks/` sob `/tmp/claude-*`, validado depois de canônico). Não
sobe processo, então não há órfão possível. Polling com offset, teto de 256 KB
por leitura, linha cortada em 4.000 caracteres, recuo para 2 s depois de 60 s
parado, no máximo 6 seguidores. Acaba em `bastidor_parar`, quando o `Channel`
falha (janela fechou) ou quando o arquivo some. Saída ao vivo de tool pelo
stream (`AgentEvent::ToolOutput`) nunca vira item do fio.

## Navegador do projeto (ADR-131, ADR-147)

O Chromium é da Frota (`browser.rs`): um por projeto, perfil persistente,
headless por padrão, controlado por CDP na loopback. O que a pessoa vê é
screencast (`browser_cdp.rs`), guardado como último quadro e buscado pelo front;
frames e WebSockets nunca entram no banco nem no manifesto. Um piloto por
navegador (`experience_broker.rs`): run, plugin ou pessoa; observar é livre.

- **Não troque por webview nativo nem iframe.** WKWebView não fala CDP (o agente
  não pilotaria) e a view nativa cobre menus e modais. O racional está em
  `docs/browser-plan.md`; aba e janela flutuante dentro do app estão em
  `docs/navegador-na-frota-prd.md` (ADR-204).
- A pessoa vê o navegador na aba principal "Navegador" ou flutuando sobre a
  conversa (`components/browser/`): a lógica é `useNavegadorDoProjeto`, a cara é
  `NavegadorVista` (só props), e cada lugar é um contêiner. Vista nova usa os
  dois; não copie o `BrowserPanel`.
- O preview é indexado por projeto (`BrowserPreviewRegistry`): duas vistas do
  mesmo projeto disputam a mesma sessão. O AppShell nunca monta aba e flutuante
  juntas, e a parada do preview espera um instante (`sairDaVista`) para a troca
  de vista não cortar o stream da vista nova.
- Ligar o navegador por gate ou por Configurações é headless; janela visível só
  por gesto explícito.
- Navegador que sobrou de sessão anterior (`browser_orfaos.rs`) é encontrado e,
  por gesto, encerrado; nunca adotado. Sessão viva se reconhece pelo pid OU pelo
  grupo de processos (o `ProcessRegistry` lança por `zsh -lc`).
- Capturar a página (`browser_capture.rs`) é observação, não pilotagem: PNG real
  por `Page.captureScreenshot`, bytes direto para anexo ou clipboard, URL limpa
  por `sanitize_page_url`. Nunca base64 no Channel.
- A injeção do endpoint segue a forma de conexão do binding (`browser_conexao`,
  migração 50): `cdp-endpoint`, `browser-url` ou `ws-endpoint`
  (`browser_conexao.rs`). MCP de navegador novo ganha forma nova ali, nunca `if`
  por nome; as flags saem do `--help` real do MCP, guardado em `testdata/`.

## Mantenha este arquivo verdadeiro

Mudou como o turno nasce, como o plano de MCP é montado, o que é sondado ou
quando um cache expira? Atualize este arquivo no MESMO commit. Regra que não
bate mais com o código é pior que regra nenhuma: o próximo agente aprende a
errada e defende ela na review.
