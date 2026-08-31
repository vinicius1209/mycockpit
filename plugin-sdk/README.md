# SDK de plugins da Frota

Este diretório é o contrato versionado para quem cria plugins. Os schemas ajudam
o editor, mas a autoridade continua sendo o mesmo parser Rust usado na descoberta
e antes de cada execução. O exemplo em `examples/quality-kit` passa por esse
parser e por um probe MCP real na suíte do app.

## Superfícies v1

| Contribuição | Entrega | Quando há processo |
|---|---|---|
| skill | instrução invocável como `/publisher.plugin:skill` | nunca; o Markdown é expandido pelo Frota |
| MCP HTTP | configuração efêmera por run | o endpoint já precisa existir e passar no health check |
| MCP stdio | launcher supervisionado por run | depois do gesto de enviar, durante probe e run |
| tool | Tool Catalog interno via `mc-tools` | um worker por chamada concreta |

Descobrir, revisar ou habilitar um plugin não inicia browser, servidor ou worker.
O grant é vinculado ao fingerprint de todos os arquivos regulares do pacote e às
capabilities declaradas. Qualquer mudança exige nova revisão.

## Estrutura mínima

```text
quality-kit/
├── frota-plugin.json
├── bin/server.mjs
├── mcp/quality.json
└── skills/review/SKILL.md
```

Use os schemas no editor por meio do campo `$schema`. Paths declarados são
relativos à raiz do pacote, não aceitam `..` e não podem atravessar symlinks.

```json
{
  "$schema": "../../schemas/frota-plugin.schema.json",
  "manifestVersion": 1,
  "pluginApi": 1,
  "publisher": "acme",
  "id": "quality-kit",
  "name": "Quality Kit",
  "version": "1.0.0",
  "engines": { "frota": ">=0.1.0" },
  "capabilities": ["mcp:provide", "process:spawn"],
  "contributes": {
    "skills": [
      { "id": "review", "path": "skills/review/SKILL.md" }
    ],
    "mcpServers": [
      { "id": "quality", "path": "mcp/quality.json" }
    ]
  }
}
```

## Skill

O arquivo precisa se chamar `SKILL.md`, estar em UTF-8, ter no máximo 256 KiB
e declarar `description` no frontmatter. O corpo pode usar `$ARGUMENTS`.

```markdown
---
description: Revise uma mudança com evidências verificáveis
---

Revise $ARGUMENTS. Separe fatos, riscos e sugestões.
```

A skill não ganha permissões implícitas. Ela só aparece depois de um grant atual
e é revalidada pelo fingerprint no envio. O manifesto efetivo do run registra a
origem, o escopo e a força de controle sem persistir o texto do prompt.

## MCP

Cada item de `mcpServers` aponta para um JSON conforme
`schemas/frota-mcp.schema.json`.

MCP stdio exige `mcp:provide` e `process:spawn`. `command` é um arquivo
executável dentro do pacote. `cwd: "project"` exige também `workspace:read` ou
`workspace:write`.

```json
{
  "$schema": "../../../schemas/frota-mcp.schema.json",
  "schemaVersion": 1,
  "name": "Quality tools",
  "transport": {
    "type": "stdio",
    "command": "bin/server.mjs",
    "args": [],
    "cwd": "plugin"
  }
}
```

O provider recebe o binário da Frota e um descriptor efêmero 0600, nunca o
executável contribuído diretamente. O launcher reabre o pacote, confere
fingerprint e grant, limpa o ambiente e supervisiona o processo. Frames stdio
são limitados a 4 MiB.

MCP HTTP exige `mcp:provide` e `network:connect`. A URL precisa usar HTTPS;
HTTP é aceito apenas em loopback. Usuário, senha, query e fragmento são
recusados, portanto credenciais literais não pertencem à definição v1.

## Tool worker

Tools declaradas em `contributes.tools` exigem `tools:provide` e um `main`
executável. O protocolo JSON Lines, os timeouts, os recursos e o ciclo de vida
do worker estão documentados em [`../docs/plugin-runtime.md`](../docs/plugin-runtime.md).
O provider não autoaprova uma tool só porque ela entrou no catálogo.

## Capabilities

O conjunto v1 é fechado:

- `workspace:read`, `workspace:write`;
- `process:spawn`, `network:connect`;
- `mcp:provide`, `tools:provide`;
- `browser:control`, `desktop:control`;
- `secrets:read`, `notifications:show`.

Capability é uma solicitação revisada e um gate para o que o host entrega. Ela
não transforma o processo local em sandbox do sistema operacional. Recursos de
desktop permanecem bloqueados até existir broker nativo com estado real de
permissão.

## Conformidade

Na raiz do repositório:

```sh
cd app/src-tauri
cargo test sdk_
```

As provas cobrem o manifesto, o conteúdo da skill, a definição MCP e o handshake
`initialize` + `tools/list` do servidor de exemplo. Para experimentar no app,
copie a pasta inteira do exemplo para `app_data/plugins`, use Redescobrir, revise
o fingerprint e habilite o pacote. A localização de `app_data` depende do
sistema e da instalação; o app é a fonte correta desse caminho.

Empacotamento, assinatura, marketplace e atualização automática não fazem parte
da API v1. Até essas fases existirem, instalação é local e explícita.
