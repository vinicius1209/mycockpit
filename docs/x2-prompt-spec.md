# X2: contrato do prompt nos transports CLI

> Implementada e verificada em 29/08/2026 depois da leitura dos adapters da
> Frota e dos padrões usados por Paseo, Orca e Buzz. Esta versão substitui a
> proposta original do helper que anexaria todo prompt no fim do comando.

## Resultado esperado

Cada adapter CLI declara como transporta o prompt, e um teste único percorre o
registry para provar que o `argv` montado obedece à declaração. A regra deixa de
existir apenas dentro de `build_command` longos e de comentários que a CI não
consegue cobrar.

O caminho de produção também valida a forma declarada antes de cada spawn do
fallback CLI. Se um ramo futuro divergir, o efeito é bloqueado sem incluir o
texto do prompt no erro.

A X2 endurece o fallback CLI atual. Ela não cria provider configurável e não é
pré-requisito da PA4, cujo transporte principal é ACP/JSON-RPC.

## O problema real

| motor | transporte do prompt | posição no `argv` |
|---|---|---|
| Claude | `-p` ativa print mode; `-- <texto>` carrega o pedido | último |
| Codex | `-- <texto>` | último |
| OpenCode | `-- <texto>` | último |
| Agy | `-p <texto>` | no meio, antes das demais flags |

Essa ordem já causou falha silenciosa. No Claude, flags colocadas depois de
`-- <prompt>` viraram parte do pedido e o stream estruturado desapareceu. No
Agy, renderizar os anexos depois de adicionar o valor de `-p` produz um comando
válido, mas o path não chega ao motor.

Durante a execução da X2 apareceu um terceiro caso. O adapter do OpenCode
enviava o posicional sem separador, então um pedido iniciado por hífen era
interpretado como opção e recusado antes do turno. No OpenCode 1.18.21, o
[parser oficial](https://github.com/anomalyco/opencode/blob/v1.18.21/packages/opencode/src/cli/cmd/run.ts#L119-L135)
aceita `--` e o
[handler](https://github.com/anomalyco/opencode/blob/v1.18.21/packages/opencode/src/cli/cmd/run.ts#L264-L282)
incorpora explicitamente `args["--"]` ao pedido. Um
probe local com diretório inexistente confirmou os dois lados sem chamar modelo:
com separador chegou à validação do diretório; sem ele mostrou ajuda por opção
desconhecida. A X2 corrige esse `argv` em vez de declarar a fragilidade como
contrato.

## O que a comparação externa ensinou

- O sentinela de prompt do Paseo é adequado a perfis escritos pelo usuário. Na
  Frota, o registry é Rust compilado e os adapters também montam sessão, MCP,
  permissões, anexos e canais de sistema; trocar isso por template de string
  reduziria a segurança de tipos.
- O Orca declara modos de invocação distintos. Isso reforça que a semântica do
  fornecedor deve ser tipada, não inferida de comentários.
- O Buzz separa transports CLI e ACP. Em ACP, o prompt viaja no payload de
  `session/prompt`, não numa posição de `argv`; portanto, o contrato desta X2
  não deve ser estendido artificialmente à PA4.

## Decisão

### 1. Contrato interno e obrigatório no Rust

O trait `AgentAdapter` passa a exigir:

```rust
fn cli_prompt_contract(&self) -> CliPromptContract;
```

Sem implementação default. Um adapter novo não compila enquanto não declarar
uma destas formas:

```rust
enum CliPromptContract {
    TrailingAfterSeparator(&'static str),
    AfterFlagBeforeTrailingArgs(&'static str),
}
```

Mapeamento atual:

| motor | declaração |
|---|---|
| Claude | `TrailingAfterSeparator("--")` |
| Codex | `TrailingAfterSeparator("--")` |
| OpenCode | `TrailingAfterSeparator("--")` |
| Agy | `AfterFlagBeforeTrailingArgs("-p")` |

O dado fica apenas no Rust. A UI não monta comandos nem decide o que oferecer
com base nessa informação, então um espelho TypeScript criaria teste-gêmeo sem
consumidor.

### 2. A montagem continua no adapter

Não haverá helper que sempre adiciona o prompt ao fim. Ele mudaria o comando do
Agy, onde `-p <prompt>` precisa vir antes de `--output-format`, timeout, diretório,
sessão, modelo e sandbox.

O contrato é uma declaração verificável, não um compositor universal. Cada
adapter continua dono da sintaxe do fornecedor e o teste acusa divergência
entre a declaração e o comando real.

### 3. O teste trabalha com `argv`, não com uma linha achatada

Para cada item de `registered_agents()` o teste monta um pedido marcador e
confere:

- o prompt é um argumento exato e aparece uma única vez;
- contratos `Trailing*` deixam o prompt como último argumento;
- `TrailingAfterSeparator` põe o separador imediatamente antes do prompt;
- `AfterFlagBeforeTrailingArgs` põe a flag imediatamente antes e conserva
  argumentos posteriores.

O marcador contém espaço, quebra de linha e texto parecido com flag. Assim o
teste não pode passar por acidente usando `args.join(" ")`.

No runner, `build_validated_command` aplica uma guarda estrutural mais curta
antes de cada spawn do fallback CLI, inclusive no restart após resume ausente.
A CI continua sendo a prova forte de valor exato e ocorrência única; a guarda
de produção impede executar um comando cuja forma contradiz a declaração.

### 4. Anexos têm contrato separado

Posição do prompt não determina transporte do anexo:

| motor | transporte do anexo |
|---|---|
| Claude | path dentro do prompt + `--add-dir <pasta>` |
| Codex | `-i <path>`; o texto do prompt fica intacto |
| Agy | path dentro do valor de `-p` + `--add-dir <pasta>` |
| OpenCode | capability continua desligada até o suporte ser medido ponta a ponta |

Há testes específicos para cada transporte suportado. No Codex, eles também
seguram o `--` entre o `-i` variádico e o prompt. No Agy, seguram a renderização
do path antes de o valor de `-p` ser adicionado.

### 5. Vazio significa ausência de conteúdo efetivo

A Frota permite que uma imagem ou PDF seja a mensagem inteira. Por isso,
`prompt.trim().is_empty()` não é erro sozinho.

Na fronteira do runner:

- texto não vazio é válido;
- texto vazio com ao menos um anexo vivo e suportado é válido;
- texto vazio sem anexo utilizável é recusado antes do spawn.

O argumento do prompt não é omitido em turnos só com anexo. O runner fecha o
stdin; remover o carrier poderia selecionar modo interativo ou deixar uma CLI
esperando entrada.

## Fora de escopo

- transformar `build_command` em templates de string;
- expor este detalhe como capability de UI;
- provar parsing interno de cada binário apenas inspecionando `Command`;
- tornar providers instaláveis sem release;
- modelar prompts de ACP/app-server como posição de CLI.

## Critérios de aceite

1. Os quatro adapters implementam o método obrigatório.
2. O teste de contrato percorre o registry e valida os argumentos em ordem; a
   guarda de produção recusa forma divergente antes do spawn.
3. Testes separados cobrem anexos de Claude, Codex e Agy.
4. O backend recusa pedido sem texto e sem anexo utilizável, preservando envio
   só com anexo.
5. Claude, Codex e Agy conservam a ordem existente; OpenCode ganha apenas o
   separador que protege prompts iniciados por hífen.
6. `bun run check`, `bun run test`, `bunx tsc -b --force` e `cargo test` passam.

## Risco residual

O teste prova a estrutura produzida pela Frota, não que uma versão futura do
binário continue aceitando a mesma sintaxe. Mudança de parser do fornecedor
continua exigindo fixture ou probe real da versão correspondente. A vantagem é
que qualquer alteração nossa de ordem passa a falhar localmente na CI.

## Verificação da entrega

- `cargo test`: 599 aprovados, 7 provas reais ignoradas por desenho;
- `bun run test`: 3.496 aprovados;
- `bunx tsc -b --force`: limpo;
- `bun run check`: 13 guardas aprovadas;
- OpenCode 1.18.21 com `opencode/mimo-v2.5-free`: duas execuções reais no
  fallback, uma com prompt comum e outra com o próprio prompt iniciado por
  `--`; ambas devolveram o marcador exato, stream JSON completo, exit 0 e custo
  reportado como zero.
