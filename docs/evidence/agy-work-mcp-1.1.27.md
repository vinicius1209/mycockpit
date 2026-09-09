# Canal de trabalho do Agy 1.1.27

Data: 08/09/2026, macOS. Decisão: ADR-173.

## Evidência de execução

O CLI instalado respondeu como versão 1.1.27. `agy mcp enable --help`
confirmou `agy mcp enable <name>`. O inventário real continha as entradas
stdio habilitadas `computer-use` e `playwright`.

Para medir a herança sem escrever na configuração global, a sonda acrescentou
um diretório temporário ao PATH somente do filho Agy. Seu `npx` substituto
recebeu a inicialização da entrada Playwright já existente. Primeiro, um
servidor mínimo registrou apenas `MYCOCKPIT_WORK_SOCK` e `MYCOCKPIT_RUN_ID`;
ambos chegaram com os valores definidos para aquele filho.

Na segunda sonda, o substituto executou o binário Rust compilado deste checkout
com `work-server`. Dois Agy rodaram simultaneamente, no mesmo CWD, cada um com
um socket de teste diferente. O comando foi:

```text
agy -p /credits --output-format stream-json --print-timeout 10s --sandbox
```

`/credits` é comando nativo, sem pedido de inferência. Ambos encerraram com
código 0 e eventos `command_result`/`result`. Cada listener recebeu
`work_ready` do helper correspondente. Os listeners desta sonda eram pequenos
servidores de teste que respondiam ao handshake, não o app instalado.

O mesmo binário, exercitado diretamente pelo protocolo JSON-RPC, declarou:

| Listener | Tools |
|---|---|
| Vivo com processos permitidos | `process_start`, `process_poll`, `process_stop`, `work_plan`, `work_update` |
| Vivo com acesso restrito | `work_plan`, `work_update` |
| Endereço ausente | lista vazia |

Os scripts e resultados locais ficaram em:

```text
/var/folders/vb/qkxcswn95js9q2jfpb1pj5h80000gn/T/frota-agy-heranca-if8p4uoq
/var/folders/vb/qkxcswn95js9q2jfpb1pj5h80000gn/T/frota-agy-helper-lnkovq5e
```

## Contrato do backend e validação

`work_gateway_tests.rs` usa sockets Unix reais e runtime Tauri de teste para
verificar entrega de plano/update à conversa e ao run corretos, inclusive
mesma pasta, revogação no encerramento, modo restrito e isolamento de
processos. O payload de plano vem da publicação real deste fio.

`work_mcp_setup_tests.rs` cobre identidade da entrada, caminho com espaços,
conflito, reativação e versão mínima. Os testes-gêmeos de capabilities e o
contrato de materialização verificam argv/ambiente do adapter.

Passaram `bun run test` (3.946 testes), `cargo test` (745, com 7 ignorados),
`bunx tsc -b --force` e `bun run check`. O helper foi compilado por
`cargo build --bin app`.

## Limites

Não foi alterado o cadastro global real, não foi pedida inferência ao modelo
e não foi validada a nova tela no app instalado. A sonda prova inicialização
real do CLI/helper e herança de ambiente. A entrega até `work://event` foi
verificada no runtime Tauri de teste; a adoção espontânea das tools pelo modelo
e o fluxo visual completo ainda exigem um turno no app atualizado e conectado.
