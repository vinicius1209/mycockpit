# Tailscale 1.102.4 (macOS 26.6.2), colhido em 17/09/2026

- `status-https-ligado.json`: `tailscale status --json` real, recortado aos campos
  que a Frota lê; e-mail da tailnet anonimizado. HTTPS habilitado no painel.
- `status-sem-https.json`: o mesmo payload sem `CertDomains`. No mesmo Mac, antes
  de habilitar HTTPS, o comando veio sem domínio de certificado (a leitura não
  distinguiu chave ausente de `null`; a Frota trata os dois como "sem HTTPS").
- `serve-status-proxy-14200.json`: `tailscale serve status --json` real depois de
  `tailscale serve --bg 14200`. Sem configuração, o comando responde texto
  ("No serve config"), não JSON.
