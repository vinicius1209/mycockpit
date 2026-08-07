# MCP com autenticação — plano (o app faz o login, não o arquivo)

> ## Correção de terreno (07/08/2026, validada contra o endpoint real)
>
> Verificação empírica contra o `prime-mcp`
> (`https://tsxtyuyjmouuyzkzwdtz.supabase.co/functions/v1/mcp`) e contra a spec
> vigente. **Estes achados mandam sobre o texto original abaixo.** Fixtures em
> `spikes/mcp-auth/`.
>
> 1. **A spec vigente é a `2026-07-28`, não a `2025-06-18`.** Três mudanças que
>    entram como obrigação, todas implementadas em A1:
>    - **`iss` da resposta de autorização (RFC 9207) MUST ser validado** antes
>      de trocar o code. PKCE sozinho não protege de mix-up de AS: o cliente
>      entregaria o `code_verifier` ao token endpoint do atacante.
>    - **`code_challenge_methods_supported` MUST ser verificado**; ausente ou
>      sem `S256`, o cliente **recusa** o login.
>    - **`resource` (RFC 8707) MUST ir no authorize E no token**, sempre, mesmo
>      que o AS não declare suporte.
> 2. **Registro dinâmico de cliente saiu do plano.** Na spec vigente o DCR está
>    **deprecado** (o substituto é Client ID Metadata Document), e o AS do prime
>    **não expõe `registration_endpoint`**. A ordem normativa põe credencial
>    pré-registrada em primeiro lugar — que é exatamente o `clientId` do
>    `.mcp.json`. A1 usa só ele; nada de registro dinâmico.
> 3. **"Sair … que revoga" nem sempre revoga.** O AS do prime **não expõe
>    `revocation_endpoint`**. O comando apaga do Keychain sempre e só afirma
>    revogação quando ela de fato ocorreu; senão devolve a frase honesta
>    ("removida deste Mac, não revogada no servidor").
> 4. **O token endpoint real devolve DUAS formas de erro diferentes** — RFC 6749
>    (`error`/`error_description`) na troca do code e proprietária do GoTrue
>    (`error_code`/`msg`) no refresh. Um parser que só lesse a primeira daria
>    mensagem VAZIA justo no caminho de refresh, que é o mais visto. Fixture
>    real dos dois casos no teste.
> 5. **Limite honesto do Keychain com build ad-hoc** (verificado nesta máquina,
>    não deduzido): o app é `adhoc, linker-signed`, sem Team ID. Testado com o
>    crate `keyring` 4.1 — gravar e ler **funciona**, sobrevive a rebuild com
>    cdhash diferente, **sem prompt e sem entitlement**. Mas o item **não fica
>    isolado por aplicativo**: um binário qualquer do mesmo usuário lê o
>    segredo. Então o Keychain entrega aqui *token fora do SQLite, fora de
>    arquivo de config, fora de argv, cifrado em repouso e apagável num gesto* —
>    e **não** entrega isolamento entre apps. A garantia central do plano (o
>    agent nunca recebe credencial) continua de pé; a que **não** se pode
>    afirmar é "só o MyCockpit lê". Mesma causa raiz do **ADR-013**, mesmo
>    conserto: Developer ID.
> 6. **Nenhum HTTP client no grafo.** O app fala HTTP por `curl` (`catalog.rs`,
>    `browser.rs`, `detect.rs`, `mcp_control.rs`). Como token em argv é
>    proibido, A1 usa **`curl --config -`**: URL, headers e corpo vão pelo
>    STDIN. Verificado que `ps` mostra apenas `curl --config -`. Sem
>    dependência HTTP nova.
>
> 7. **A2 — o socket do proxy quase não chegou ao Codex.** O
>    `McpLaunchConfig::configure_codex` genérico **não** copia o mapa `env`
>    literal (e com razão: ali moram valores de config alheia que não podem ir
>    pra argv). Como o proxy carrega o caminho do socket justamente no `env`, o
>    server subiria no Codex sem saber com quem falar — falha silenciosa no
>    motor que a A2 existe pra atender. Resolvido com caminho próprio
>    (`mcp_proxy::configure_codex_launch`), com teste cobrindo os DOIS motores.
> 8. **A2 fala Streamable HTTP, não só JSON.** Servidor real responde
>    `text/event-stream` mesmo para uma resposta única, e pode abrir sessão
>    (`Mcp-Session-Id`) no `initialize` exigindo eco nas chamadas seguintes. O
>    proxy lê as duas formas e ecoa a sessão. SSE como *stream contínuo* segue
>    fora (é a A3).
>
> Migrações: **nenhuma** (A1 e A2 não tocam SQLite — de propósito: o registry
> segue sem credencial).

> Status: proposto em 07/08/2026. Gatilho: o `prime-mcp` (OAuth no `.mcp.json`
> do prime-sales-hub) fica bloqueado pro roteamento, e o usuário cravou a
> direção certa: **"se precisa de auth, nosso projeto precisa conseguir fazer
> todo o processo, não depender apenas de arquivo json local"**.

## O impasse de hoje

O control plane lê config de disco e **nunca persiste credencial** (garantia
registrada em `mcp-control-plane.md`). Servidor com OAuth vira `native_only`:
funciona no CLI que autenticou (o token está no keychain DELE) e não pode ser
roteado pra outro agent. Consequência prática: o mesmo MCP existe pro Claude e
não existe pro Codex, e o app não tem como consertar — ele não é dono de nada.

## A virada: o app deixa de ser leitor e passa a ser DONO da credencial

O MCP tem especificação de autorização própria (OAuth 2.1 com PKCE, descoberta
por metadata, registro dinâmico de cliente). Nada impede o app de rodar o fluxo
inteiro. O que muda é a responsabilidade: quem guarda token, renova e revoga
passa a ser o MyCockpit.

## O problema que decide o desenho: como entregar o token ao agent

Injetar `Authorization: Bearer …` num config efêmero ou em argv **vaza**: o
token aparece em `ps`, em arquivo temporário e em qualquer log de spawn. Isso
destruiria a garantia atual, que é boa.

**Solução: o app vira PROXY MCP local autenticado.** Ele já roda servers MCP
internos por socket unix (`mc-work`, `mc-context`, `mc-approval`) — o mesmo
substrato serve aqui:

```
agent (claude/codex)  ──MCP local──►  mycockpit (proxy)  ──HTTPS + Bearer──►  MCP remoto
```

O agent recebe um server local sem credencial nenhuma; o token **nunca sai do
processo do app**. Ganhos que caem de bônus:
- funciona igual pros dois motores (o agent nem sabe que é remoto);
- um login só serve todos os agents do projeto;
- revogar é apagar do Keychain, sem caçar config espalhada;
- o app pode registrar/auditar o que passou (e negar o que não deve).

## Fases

### A1 — Fluxo de login no app
- Descoberta de metadata do servidor de autorização (o `.mcp.json` do
  prime-mcp já traz `authServerMetadataUrl`), PKCE, callback em
  `127.0.0.1:<porta>` (o próprio config já declara `callbackPort`).
- Registro dinâmico de cliente quando o servidor suportar; senão usa o
  `clientId` do config.
- Token no **Keychain do macOS** (nunca em SQLite, nunca em arquivo). O
  registry continua sem credencial — a garantia atual sobrevive.
- UI: botão "Entrar" no card do MCP, estado honesto (conectado / expirado /
  sem login), e "Sair" que revoga e apaga.

### A2 — Proxy MCP autenticado
- Server local por-run (padrão dos internos) que repassa JSON-RPC pro endpoint
  remoto acrescentando o header de autorização.
- Renovação transparente (refresh token) com retry único no 401; falha de
  refresh → estado "expirado, faça login de novo", nunca erro cru pro modelo.
- O roteamento passa a ser possível pros DOIS motores: o `native_only` deixa
  de bloquear quando existe login do app (a capability vira "autenticado por
  nós", não "nativo-apenas").

### A3 — Honestidade e limites
- Card mostra QUEM autenticou: "login do MyCockpit" vs "login nativo do CLI"
  (hoje só existe o segundo, e a mensagem nem diz isso direito).
- Servidor com SSE/WS segue fora até o proxy falar streaming (registrar).
- Sem login, comportamento de hoje, intacto.

## Guardas

- **Token nunca em argv, nunca em arquivo de config, nunca no SQLite.**
  Keychain + memória do processo, só.
- O proxy não guarda conteúdo: repassa e esquece (o que for auditado é
  metadado, não payload).
- Fail-closed: proxy sem token válido recusa a chamada com motivo legível, em
  vez de deixar o agent achar que a tool existe e falhar no meio da tarefa.
- Nada de embutir segredo em `.mcp.json` do usuário — o arquivo dele é dele.
