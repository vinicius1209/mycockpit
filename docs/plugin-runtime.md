# Runtime de plugins v1

Este documento é o contrato de autoria e execução de plugins da Frota. O
runtime v1 materializa skills invocadas, MCPs por run e tools do catálogo sem
instalar configuração permanente em diretórios de provider. Schemas, exemplo
executável e provas de conformidade ficam em [`../plugin-sdk`](../plugin-sdk/README.md).

## Pacote

Cada plugin é uma pasta em `app_data/plugins`:

```text
acme-quality/
├── frota-plugin.json
├── bin/plugin-worker
├── skills/review/SKILL.md
└── mcp/docs.json
```

`main` precisa ser arquivo executável contido no pacote. Em scripts, use shebang
e bit executável; a Frota chama o arquivo diretamente, sem shell.

```json
{
  "manifestVersion": 1,
  "pluginApi": 1,
  "publisher": "acme",
  "id": "quality",
  "name": "Quality",
  "version": "1.0.0",
  "description": "Revisa páginas do projeto",
  "engines": { "frota": ">=0.1.0" },
  "main": "bin/plugin-worker",
  "capabilities": ["tools:provide", "browser:control"],
  "contributes": {
    "tools": [
      {
        "id": "review-page",
        "title": "Revisar página",
        "description": "Revisa a página ativa do navegador do projeto",
        "inputSchema": {
          "type": "object",
          "properties": { "focus": { "type": "string" } },
          "additionalProperties": false
        },
        "resources": ["project-browser"]
      }
    ]
  }
}
```

Todo arquivo regular do pacote, inclusive módulos auxiliares não declarados,
forma o fingerprint em ordem estável. Paths absolutos, `..`, qualquer symlink,
ids desconhecidos, campo extra e capability fora da allowlist invalidam o pacote
antes de qualquer execução. O manifesto aceita até 128 KiB; o pacote, até 4.096
entradas, 2.048 arquivos, 32 MiB por arquivo e 128 MiB no total.
Erro ao ler a pasta ou duas pastas declarando a mesma identidade interrompem o
inventário; a Frota não escolhe um pacote pela ordem devolvida pelo disco.

## Consentimento

Discovery só lê. Um plugin entra em runs depois de revisão explícita da chave,
fingerprint e capabilities atuais. O grant possui quatro estados:

- `pending`: nunca revisado;
- `approved`: fingerprint atual e habilitado;
- `disabled`: fingerprint atual, revisão preservada, publicação desligada;
- `stale`: conteúdo ou capabilities mudaram, revisão anterior inválida.

Habilitar não cria processo residente. Revogar ou desabilitar encerra workers
de tools e suas leases e impede publicação em novos runs. Um MCP já entregue a
um provider termina junto com o run atual; o app não finge revogação instantânea
de um processo que passou a ser filho do provider. Mudança de grant e seu evento
de auditoria pertencem à mesma transação: a UI nunca recebe falha depois de uma
decisão ter sido aplicada pela metade.

## Skills

Cada item de `contributes.skills` aponta para um `SKILL.md` UTF-8 de até 256
KiB, com `description` no frontmatter. Depois do grant, a invocação estável é
`/publisher.plugin:skill`. A Frota expande o Markdown no app para qualquer
adapter, sem copiar o arquivo para `~/.claude`, `~/.codex` ou outra convenção de
provider.

O frontend devolve um claim com plugin, contribuição e fingerprint. Antes do
spawn, o runner reabre o pacote e revalida grant, bytes e nome invocado. Falha
encerra o envio antes do provider; sucesso entra como `instructions` no
manifesto efetivo v4. Assim a UI mostra a origem da instrução sem persistir o
corpo do prompt.

## MCPs contribuídos

Cada item de `contributes.mcpServers` aponta para um JSON fechado v1. O formato
é validado antes de o pacote poder ser revisado, mas disponibilidade continua
sendo fato do run e passa por health check depois do gesto de enviar.

- stdio exige `mcp:provide` e `process:spawn`; o comando precisa ser executável
  e contido no pacote;
- `cwd: project` exige leitura ou escrita do workspace;
- HTTP exige `mcp:provide` e `network:connect`, HTTPS fora de loopback e URL sem
  usuário, senha, query ou fragmento;
- adapter sem materialização MCP forte por run recebe notice e não ganha uma
  instalação global como fallback.

No stdio, o provider inicia o binário da Frota com um descriptor efêmero 0600.
O launcher confere novamente pacote, fingerprint e grant, recompõe o ambiente
por allowlist e só então inicia o servidor contribuído. Descriptor e processo
vivem no máximo até o fim do run. O probe stdio registra nomes reais de tools;
HTTP permanece `opaque` enquanto o health não publicar `tools/list` auditável.

## Tool Catalog

O nome visível ao agent é estável e namespaced:

```text
plugin__acme_quality__review_page
```

O snapshot do catálogo nasce por run e contém somente pacote válido, grant atual
e tool cujo preflight de recursos passou. MCP é o transporte v1 do catálogo,
por meio do servidor interno `mc-tools`; não é a identidade da tool. Adapters
sem MCP forte por run não recebem o catálogo e degradam de forma explícita.

O provider continua aplicando sua própria política de tool. Registrar
`mc-tools` não coloca suas tools em auto-allow.

## Protocolo do worker

Stdin e stdout usam um objeto JSON por linha. Stdout é exclusivamente protocolo;
logs estruturados usam a mensagem `log`, e stderr é drenado separadamente.

A Frota inicia a conversa:

```json
{"type":"initialize","protocolVersion":1,"pluginKey":"acme.quality","fingerprint":"...","grantedCapabilities":["browser:control","tools:provide"],"tools":["review-page"],"resourceClaims":[]}
```

O worker precisa responder em até 4 segundos, listando exatamente os ids do
manifesto:

```json
{"type":"ready","protocolVersion":1,"tools":["review-page"]}
```

Uma chamada segue no mesmo processo:

```json
{"type":"invoke","requestId":"plugin-call-123-1","tool":"review-page","input":{"focus":"acessibilidade"},"context":{}}
```

O worker termina com um resultado ou erro de mesmo `requestId`:

```json
{"type":"result","requestId":"plugin-call-123-1","output":{"score":9}}
```

```json
{"type":"error","requestId":"plugin-call-123-1","error":"página indisponível"}
```

Mensagens auxiliares permitidas:

```json
{"type":"log","level":"info","message":"analisando a página"}
{"type":"fatal","error":"versão incompatível"}
```

Depois do resultado, a Frota envia `{"type":"shutdown"}` e espera até 2
segundos antes de matar o grupo. Cada processo atende uma chamada. O mesmo
plugin não atende duas chamadas simultâneas nesta versão.

Limites do protocolo:

- 1 MiB por frame, verificado antes da desserialização;
- no máximo 128 mensagens antes de `ready` e 128 durante a chamada;
- 120 segundos por chamada;
- até 64 KiB recentes de stderr drenados, sem persistir o conteúdo bruto;
- erro textual do worker limitado antes de chegar ao host.

## Ambiente e recursos

O host limpa o ambiente herdado e recompõe uma allowlist operacional. Sempre
entrega `FROTA_PLUGIN_PROTOCOL`, `FROTA_PLUGIN_KEY` e
`FROTA_PLUGIN_CAPABILITIES`. `FROTA_PROJECT_ROOT` e `context.projectRoot` só
existem quando o pacote declara leitura ou escrita do workspace.

Recursos usam lease por chamada:

- `project-browser`: exige o Chromium do projeto já ligado e entrega
  `FROTA_PROJECT_BROWSER_CDP` somente ao worker daquela chamada;
- `external-browser`: recusado, sem fallback que abra Chrome ou Firefox;
- `desktop-control`: recusado até existir broker nativo com estado real de
  permissão do sistema.

Discovery, aprovação, habilitação e montagem do catálogo nunca iniciam um
recurso.

## Fronteira de segurança

O processo separado permite timeout, cancelamento, contenção de crash, limite de
protocolo e limpeza de órfãos. Ele **não é um sandbox completo do sistema
operacional**. Código executável ainda roda com as permissões do usuário da
Frota e deve ser tratado como código local confiável.

Capabilities são declarações revisadas e gates do que o host entrega. Elas não
prometem bloquear acesso direto que um executável consiga fazer por syscall.
Em particular, o runtime atual não entrega segredos por host API, mas também não
afirma que `secrets:read` isolaria o processo do restante do disco. Um sandbox
de SO portável é uma fase separada e só poderá aparecer na UI com enforcement
medido.
