# Fixtures reais do `prime-mcp` (07/08/2026)

Coletadas do endpoint real para lastrear os testes de `mcp_auth.rs`. Fixture
inventada esconde bug (ADR-016) — foi coletando estas que apareceu o achado do
`token-error`: o MESMO token endpoint devolve duas formas de erro diferentes.

- `as-metadata.prime.json` — metadata do authorization server. Note a ausência
  de `registration_endpoint` (sem registro dinâmico) e de `revocation_endpoint`
  (o "Sair" não consegue revogar no servidor).
- `prm.prime.json` — Protected Resource Metadata (RFC 9728).
- `www-authenticate.prime.txt` — headers do 401 do MCP sem token (cookie de
  bot do Cloudflare removido). É a origem da descoberta.
- `unauth-body.prime.json` — corpo JSON-RPC do 401.
- `token-error.prime.json` — erro da troca do code: forma do RFC 6749.
- `refresh-error.prime.json` — erro do refresh: forma proprietária do GoTrue.

Nada aqui é segredo: é tudo resposta pública de endpoint não autenticado.
