# Spike M0 — `stream-json` do Claude Code

> **Por que este spike existe:** é o **único ponto que pode mudar o plano** do v0.1.
> Antes de investir em UI, precisamos provar que dá para dirigir o `claude` em modo
> headless e parsear o stream de eventos de forma confiável. Se isto roda, o coração
> do MyCockpit está provado.

## O que ele faz

1. Executa `claude -p "<prompt>" --output-format stream-json --verbose --allowedTools "Read,Glob,Grep"`.
2. Lê o stdout **linha a linha** (cada linha é um JSON).
3. Classifica cada evento (`system`, `assistant`, `stream_event`, `user`, `result`, e **desconhecidos**)
   e imprime uma renderização legível — simulando os cartões do chat.
4. Captura o `session_id` (prova que dá pra dar `--resume`).
5. No fim, imprime a contagem de cada tipo de evento e qualquer `stderr`.

Tudo de forma **defensiva**: nada de `unwrap` em dado externo; eventos desconhecidos
são logados, nunca derrubam o programa. Esse é o mesmo princípio do adapter real.

## Pré-requisitos

- `claude` CLI instalado e **autenticado** (`claude --version` deve funcionar).
- Rust toolchain (`cargo`).
- (opcional) `jq` para o `smoke.sh`.

## Como rodar

### Opção A — smoke test (10s, sem compilar)
```bash
chmod +x smoke.sh
./smoke.sh "summarize this project"
```
Mostra os tipos de evento crus e salva o stream em `/tmp/mycockpit-stream.jsonl`.

### Opção B — o spike Rust (o que importa)
```bash
cargo run -- "summarize this project" --cwd /Users/viniciusmachado/projetos/prime/prime-sales-hub
# follow-up na mesma sessão:
cargo run -- --resume <session_id_impresso_acima> "agora liste os TODOs"
```

## ✅ Critério de sucesso (o que provar)

- [ ] O processo executa e termina com `exit = Some(0)`.
- [ ] Aparece um evento `system/init` com `model` e `tools`.
- [ ] Aparecem eventos de **texto** do assistant (como `assistant` completo **ou** `stream_event` deltas).
- [ ] Aparecem eventos de **tool_use** (Read/Glob/Grep) — prova que renderizamos a ação do agent.
- [ ] Um `session_id` é capturado.
- [ ] O `--resume <id>` continua a conversa anterior.
- [ ] Nenhuma linha derruba o parser (eventos `[tipo desconhecido]` apenas logam).

## ⚠️ Known-unknowns que este spike resolve

Estes detalhes **variam por versão** do CLI — o spike serve justamente para descobrir
o comportamento real na sua máquina. Anote os achados em `../../docs/stream-json-notes.md`:

1. **Texto vem como `assistant` completo ou como `stream_event` deltas?**
   (Deltas só aparecem com `--include-partial-messages` — teste adicionando essa flag.)
2. **Nome/sintaxe exata de `--allowedTools`** (vírgula vs espaço) e dos `--permission-mode`.
3. **Onde aparece o `session_id`** (no `system/init`? no `result`? em ambos?).
4. **O que acontece quando uma tool NÃO permitida é pedida** em `-p` (deny silencioso? erro? trava?).
5. **Formato dos `tool_use` aninhados** e dos `tool_result` (evento `user`).

> Se algum nome de flag estiver errado para a sua versão, o spike ainda roda — só
> ajuste a construção do comando em `src/main.rs` e re-rode. Esse é o ponto do spike.
