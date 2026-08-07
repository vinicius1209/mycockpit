# MCP com autenticação — plano (o app faz o login, não o arquivo)

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
