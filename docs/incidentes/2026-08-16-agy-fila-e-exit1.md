# Incidente 2026-08-16 — `agy`: prompt duplicado na fila + exit 1

**Build:** 209 · **Conversa:** `ec1642c1-5328-409e-afc8-58e79a3cdca1` ("como voce melhoraria essa
janela inferior…") · **Projeto:** `mycockpit` · **Motor:** `agy` 1.1.13 · **Modelo:**
`gemini-3.7-flash-high`

Diagnóstico. Nenhum arquivo do app foi alterado; os patches abaixo estão propostos, não
aplicados. Toda referência `file:line` foi conferida contra o HEAD `6a76b86`.

Cada conclusão está marcada **[PROVADO]** ou **[SUPOSIÇÃO]**.

---

## 0. Fonte da evidência

Tudo que segue saiu de leitura do banco (`~/Library/Application Support/dev.vinicius.mycockpit/mycockpit.db`,
somente `SELECT`), do `.mycockpit/config.toml` **deste repositório**, e de `agy --help` /
`agy changelog`. **Nada em `~/.gemini/`, `~/.claude/` ou `~/.codex/` foi lido, escrito ou
inspecionado.**

Os 88 itens da conversa foram extraídos da coluna `conversations.items`. A linha do tempo abaixo
é a dos `ts` gravados nos próprios itens.

---

## 1. Linha do tempo reconstruída [PROVADO]

| Hora | Item | O que é |
|---|---|---|
| 17:45:37 | `#24` `user` | O prompt: *"ok, eu uso o plano AI pro da google, e então faça as melhorias…"* (242 chars) |
| 17:47:26 | `#31` `tool` | `view_file(/Users/viniciusmachado/.gemini/antigravity-cli/settings.json)` → `ok:false`, texto: `Permission denied for read_file(…). Matches hardcoded system protection boundary rule.` |
| ~17:47 | — | `.mycockpit/config.toml` reescrito (mtime 16 Ago 17:47) com `extra_dirs = ["/Users/viniciusmachado/.gemini/antigravity-cli"]` ← **o clique do usuário em "Liberar e reenviar"** |
| 17:50:42.877 | `#46` `result` | `ok:false`, `durationMs: 305477` (5min 05,5s) |
| 17:50:42.958 | `#47` `error` | `o agent \`agy\` saiu com código 1` |
| 17:50:42.980 | `#48` `user` | **O MESMO prompt de novo**, byte a byte idêntico ao `#24` |
| 17:55:47.113 | `#69` `result` | `ok:false`, `durationMs: 304133` (5min 04,1s), `input 2.399.909 / output 11.098 / cacheRead 2.101.766` |
| — | `#70` `error` | `o agent \`agy\` saiu com código 1` |

O `#69` é **exatamente** o cartão do print: *5min 04s · 2,4M ↓ · 11k ↑ · cache 2,1M ·
gemini-3.7-flash-high*.

Verificação de identidade dos dois `user`: `d[24]["text"] == d[48]["text"]` → `True`. Ids
diferentes (`0757e8f6…` vs `477281e5…`), ou seja **dois turnos reais**, não um item duplicado
na render.

---

## 2. Defeito 1 — "enviada E na fila ao mesmo tempo"

### Veredito: **BUG NOSSO.** Não é ilusão de UI. O prompt rodou **duas vezes de verdade**.

### 2.1 O que aconteceu

O gatilho não é o erro. É o **caminho de conceder permissão**, exatamente como o usuário
descreveu.

Cadeia completa, toda conferida:

1. **Mid-turn**, um `tool_result` falho chega. `handleEvent` roda o detector heurístico de pasta
   bloqueada — `app/src/store/chat.ts:2094-2110`:

   ```ts
   if (e.type === "tool_result" && !e.ok) {
     …
     const dir = detectBlockedDir(e.text, proj.path, allowed)
     if (dir) { … blockedDir: dir … }
   }
   ```

   `detectBlockedDir` (`app/src/lib/blockedDir.ts:37-56`) casa porque o `ACCESS_RE`
   (`blockedDir.ts:9-10`) contém `permission denied`, extrai o path absoluto, sobe pro diretório-pai
   (`toDir`, `blockedDir.ts:20-26`) e chega em `/Users/viniciusmachado/.gemini/antigravity-cli` —
   fora da raiz do projeto, não é path de sistema. → `conv.blockedDir` setado. **[PROVADO]** (o
   `config.toml` gravou exatamente essa string).

2. O banner renderiza **sem nenhuma guarda de `running`** — `app/src/components/chat/ChatPanel.tsx:1459-1467`:

   ```tsx
   {conv?.blockedDir && project && (
     <BlockedDirBanner dir={conv.blockedDir} onAllow={() => void allowBlockedDir(conv.blockedDir!)} … />
   )}
   ```

   Compare com o vizinho imediato, `PlanPendingCard` (`ChatPanel.tsx:1426`), que *tem*
   `&& !running && !finalizing`. O banner de pasta não tem.

3. O usuário clica em **"Liberar e reenviar"** (`app/src/components/chat/ComposerBanners.tsx:94-99`).
   Cai em `allowBlockedDir` — `app/src/components/chat/ChatPanel.tsx:319-355`. Ele persiste o
   `extra_dirs`, limpa o aviso, e no fim:

   ```ts
   // ChatPanel.tsx:343-354
   // reenvia o último pedido do usuário (novo turno, agora com acesso à pasta).
   const items = useChat.getState().byId[activeId ?? ""]?.items ?? []
   let lastUser = ""
   for (let i = items.length - 1; i >= 0; i--) { if (items[i].kind === "user") { lastUser = items[i].text; break } }
   toast.success("Pasta liberada. Reenviando o pedido…")
   if (lastUser) void handleSend(lastUser)
   ```

   O comentário do cabeçalho da função diz literalmente *"Só resolve entre turnos"*
   (`ChatPanel.tsx:318`) — **é aspiração, nada a impõe.**

4. `handleSend` bate na guarda de turno em voo — `app/src/components/chat/ChatPanel.tsx:436-439`:

   ```ts
   if (conv.running || conv.finalizing) {
     useChat.getState().enqueue(convId, text, attachments)
     return
   }
   ```

   → `enqueue` (`app/src/store/chat.ts:2525-2538`) empilha em `conv.queued`, que é **a fila
   visível do humano**: `QueuedChips` (`app/src/components/chat/ComposerParts.tsx:155-176`,
   rótulo `Na fila · enviam juntas ao terminar` na linha 166), montada em
   `CommandConsole.tsx:437-442`. **Isso é o print.**

5. O turno morre (exit 1). O `finally` do `handleSend` — `ChatPanel.tsx:791-820` — chama
   `drainQueued(convId, agent, project.path)` (linha 809). O `drainQueued`
   (`ChatPanel.tsx:830-865`) esvazia a fila e faz `void handleSend(texts.join("\n\n"), …)`
   na linha 863. → **segundo turno real, mesmo prompt.**

### 2.2 As quatro hipóteses do brief

| # | Hipótese | Veredito |
|---|---|---|
| 1 | Caminho duplo em `handleSend`/`submit` | **Refutada.** O `submit` foi unificado num caminho só (`CommandConsole.tsx:333-345` + `composerSend.ts:59-65`). O composer não tem ramo gêmeo. |
| 2 | Enfileirou porque estava running; o "enviado" é eco otimista | **Parcialmente certa, e pior.** Enfileirou porque estava running — mas o "enviado" no fio é o `#24` legítimo do usuário, e o enfileirado é uma **cópia que o app fabricou**. Não é eco: virou turno. |
| 3 | Caminho de ERRO reenfileira para retentativa | **Refutada.** Nenhum caminho de erro enfileira. `finish` e o tratamento de `error` não escrevem em `queued`. |
| 4 | Fila órfã não limpa quando o turno morre | **Refutada.** `dequeueQueued` (`chat.ts:2540-2550`) esvazia no `finally`, que roda em erro também. A fila não fica órfã — ela **drena**, e é aí que dói. |

**A raiz é uma quinta, que o brief não listou:** o botão de conceder permissão dispara um envio
de usuário no meio de um turno em voo.

### 2.3 Respostas às perguntas do coordenador

**1. Conceder permissão reenvia o texto do usuário? Por qual caminho?**
Sim. `ChatPanel.tsx:354` → `handleSend(lastUser)`. É o mesmo `handleSend` do Enter do composer,
sem nenhuma marca de "isto é mecanismo, não é humano". **[PROVADO]**

**2. É projeto ou acidente?**
**Metade e metade.** *Reenviar é projeto e é correto para o caso que o banner foi feito para
cobrir*: o gate de diretório do CLI é fixo no spawn — `--add-dir` entra em `build_command`
(`app/src-tauri/src/adapters.rs:2289-2292`, alimentado por `resolve_extra_dirs` em
`agent.rs:361`), então não há como emendar a pasta num processo já rodando. Resume nativo não
resolve isso: o `agy` **tem** `sessionResume` no registry (`adapters.rs:495`, usada em
`adapters.rs:2282-2285` como `--conversation <ID>`), e o reenvio inclusive a usa — mas retomar a
sessão não muda as flags do processo. Um novo turno com `--add-dir` é a única forma.

*Acidente é fazer isso com o turno vivo.* Nada em `allowBlockedDir` nem no banner checa
`running`/`finalizing`, apesar do comentário afirmar que só resolve entre turnos. **[PROVADO]**

**3. A fila visível deveria receber uma retomada interna?**
**Não. Sua leitura está certa, e o código confirma.** `conv.queued` é lido por exatamente uma
superfície, o `QueuedChips`, e ela é do humano: o `×` chama `removeQueued`
(`CommandConsole.tsx:440`), que além de tirar da fila **apaga os blobs dos anexos do disco**
(`chat.ts:2564-2577`). Ou seja, o usuário podia ter clicado no `×` achando que removia algo que
ele digitou e estaria cancelando o mecanismo de retomada do app — sem nenhum aviso de que aquilo
não era dele. O rótulo *"Na fila · enviam juntas ao terminar"* mente duas vezes nesse estado:
não foi ele que pôs, e "ao terminar" virou "logo depois do erro". **[PROVADO]**

**4. Houve execução dupla ou o reenvio foi consumido como continuação?**
**Execução dupla, completa.** Item `#48` é um turno de verdade: 20 tool calls (`#49-#68`), 5min
04s de parede, `result` próprio (`#69`). Não foi continuação, não foi no-op. O modelo repetiu o
trabalho inteiro do zero, com escrita em disco. Gravidade alta: custo dobrado e um segundo
agente reescrevendo os mesmos arquivos num repo onde o usuário avisou no próprio prompt que
*"tem outro dev trabalhando em outros arquivos"*. **[PROVADO]**

### 2.4 Agravante: o banner não podia funcionar neste caso

O texto do bloqueio é `Matches hardcoded system protection boundary rule.` Isso **não é** o gate
de diretório do `agy` — é uma regra interna dele protegendo o próprio arquivo de configuração
(detalhes na §3.1). Liberar a pasta via `--add-dir` **não destrava nada**. O
`detectBlockedDir` casou pelo termo genérico `permission denied` do `ACCESS_RE`
(`blockedDir.ts:10`) e ofereceu uma correção que era impossível — e depois gastou 5 minutos e
2,4M de tokens executando essa correção impossível. **[PROVADO]** (o `#69` prova que o segundo
turno não passou a ler o arquivo; morreu igual.)

O `config.toml` do repo agora carrega `extra_dirs = ["/Users/viniciusmachado/.gemini/antigravity-cli"]`
— uma pasta de configuração de outro agente, liberada permanentemente para todos os turnos
futuros de todos os motores neste projeto, por um clique que não ia resolver o problema. Vale
revisar essa linha à mão.

### 2.5 Patch mínimo proposto (não aplicado)

Três correções independentes, em ordem de importância.

**(a) `allowBlockedDir` nunca envia com turno em voo** — `app/src/components/chat/ChatPanel.tsx:342-354`

```diff
     if (activeId) useChat.getState().clearBlockedDir(activeId)
-    // reenvia o último pedido do usuário (novo turno, agora com acesso à pasta).
-    const items = useChat.getState().byId[activeId ?? ""]?.items ?? []
+    // O gate de diretório é FIXO no spawn: só um turno NOVO nasce com --add-dir.
+    // Mas o reenvio é MECANISMO, não fala do humano — e a fila do composer é do
+    // humano. Com turno em voo, a pasta fica liberada para o próximo envio e
+    // ponto: nada entra na fila às escondidas. (Incidente 2026-08-16: o clique
+    // mid-turn empilhou o prompt em `queued`, a drenagem do `finally` o
+    // despachou e o mesmo trabalho rodou duas vezes.)
+    const fresh = useChat.getState().byId[activeId ?? ""]
+    if (fresh?.running || fresh?.finalizing) {
+      toast.success("Pasta liberada. Vale a partir do próximo envio.")
+      return
+    }
+    const items = fresh?.items ?? []
     let lastUser = ""
```

**(b) O banner não oferece "reenviar" durante o turno** — `app/src/components/chat/ChatPanel.tsx:1459`

```diff
-          {conv?.blockedDir && project && (
+          {conv?.blockedDir && project && !running && !finalizing && (
```

Mesma guarda que o `PlanPendingCard` da linha 1426 já usa. Com (a) no lugar, (b) é a metade
honesta: some o botão que promete algo que não vai acontecer agora. Se preferir manter o aviso
visível durante o turno, a alternativa é passar um `busy` ao `BlockedDirBanner` e trocar o rótulo
para "Liberar (vale no próximo envio)".

**(c) Não oferecer `--add-dir` para bloqueio que não é do gate de diretório** —
`app/src/lib/blockedDir.ts`

```diff
 const ACCESS_RE =
   /(allowed director|outside (the )?(allowed|working|permitted)|not permitted|permission denied|--add-dir|add-dir|fora do diret[óo]rio|n[ãa]o permit|eacces|cannot access|not allowed to (access|read|write)|no access to|access denied)/i

+/** Bloqueios que o `--add-dir` NÃO destrava: regra interna do próprio CLI
+ *  protegendo arquivos dele. O `agy` 1.1.13 recusa
+ *  `~/.gemini/antigravity-cli/settings.json` com "Matches hardcoded system
+ *  protection boundary rule" — liberar a pasta não muda nada, e o reenvio só
+ *  repete o turno inteiro (incidente 2026-08-16). */
+const HARD_RULE_RE = /(protection boundary|hardcoded|hard-coded|system protection)/i
+
 …
 export function detectBlockedDir(…): string | null {
   if (!text || !projectRoot) return null
   if (!ACCESS_RE.test(text)) return null
+  if (HARD_RULE_RE.test(text)) return null
```

**Não proposto de propósito:** uma fila separada "de sistema". Enquanto (a) existir, não há
retomada interna alguma para enfileirar — o problema desaparece em vez de ganhar
infraestrutura.

---

## 3. Defeito 2 — `agy` saiu com código 1

### Veredito: **NOSSO.** O `agy` fez exatamente o que documenta. Nós aceitamos um teto de 5 minutos em todo turno headless.

### 3.1 De quem é a regra que bloqueou o `read_file` — **do próprio Antigravity** [PROVADO]

O texto literal gravado no item `#31`:

```
Permission denied for read_file(/Users/viniciusmachado/.gemini/antigravity-cli/settings.json).
Matches hardcoded system protection boundary rule.
```

Evidências de que é dele, não nosso:

- A frase é em inglês e vem **dentro do `tool_result`** do stream do `agy` (o app traduz e
  formata os erros dele em pt-BR; nada em nosso código gera essa string — `grep` por
  `protection boundary` no repo: zero ocorrências).
- O nome da ferramenta no nosso item é `view_file` (a ferramenta interna do `agy`), mas a
  mensagem fala de `read_file` — nomenclatura interna do CLI, não nossa.
- O caminho protegido é o **arquivo de configuração do próprio `agy`**
  (`~/.gemini/antigravity-cli/settings.json`).
- Nós não implementamos gate de leitura nenhum para o `agy`: o `build_command`
  (`adapters.rs:2247-2319`) passa `--dangerously-skip-permissions` (linha 2306) e só restringe
  via `--sandbox` em modo Leitura/Fusion/Auto/plan (linhas 2311-2318). Nesta conversa a permissão
  do projeto era `liberado` (`.mycockpit/config.toml`), então nem `--sandbox` entrou.

**Informação de produto que vale registrar:** o `agy` **se protege sozinho** — há uma lista
hardcoded de caminhos que ele recusa ler mesmo com `--dangerously-skip-permissions`, e
`--add-dir` não a contorna. Isso é bom (é ele defendendo as credenciais dele) e explica por que
o segundo turno morreu do mesmo jeito.

### 3.2 Por que o processo saiu com 1 — **`--print-timeout`, default 5m0s** [PROVADO]

`agy --help` (1.1.13, rodado nesta máquina):

```
--print-timeout   Timeout for print mode wait (default 5m0s)
```

Nós spawnamos em modo print (`adapters.rs:2267`: `cmd.arg("-p").arg(&prompt)`) e **nunca
passamos `--print-timeout`**. A única menção da flag no repo inteiro é um comentário nosso —
`app/src-tauri/src/adapters.rs:2419`:

> *"EOF sem `result` (processo morto, timeout do `--print-timeout`): fecha o bloco de texto
> aberto pra bolha não ficar pendurada."*

Ou seja: já sabíamos que isso mata o processo, tratamos a consequência cosmética e nunca
tocamos na causa.

**A correlação, com n=5 nesta conversa** (`durationMs` do item `result`):

| item | duração | resultado |
|---|---|---|
| `#10` | 113.637 ms (1min 54s) | `ok: true` |
| `#23` | 158.262 ms (2min 38s) | `ok: true` |
| `#46` | **305.477 ms (5min 05s)** | **`ok: false` + exit 1** |
| `#69` | **304.133 ms (5min 04s)** | **`ok: false` + exit 1** |
| `#87` | 257.302 ms (4min 17s) | `ok: true` |

Toda execução que cruzou 300.000 ms falhou; nenhuma abaixo falhou. As duas falhas caíram em
305,5s e 304,1s — o teto de 300s mais o teardown. **Confirmado.**

### 3.3 A hipótese de estouro de janela de contexto — **REFUTADA** [PROVADO]

Os "2,4M ↓ · cache 2,1M" do cartão não são o contexto de uma requisição. O `usage` do `agy` é
**acumulado da conversa**, não do turno — está documentado no nosso próprio adapter,
`app/src-tauri/src/adapters.rs:2182-2184`:

> *"`usage` é o ACUMULADO DA CONVERSA (ADR-033) — o que sai daqui é o DELTA."*

E o delta só é calculado se houver `usage_baseline` (`adapters.rs:2195`,
`delta_from(self.usage_seen.unwrap_or_default())`); sem baseline, o acumulado sai inteiro como
se fosse o turno. Confere com os números: 223k → 591k → 1,8M → 2,4M subindo monotonicamente
dentro da mesma sessão, e caindo para 2,29M no `#87` (sessão nova depois das duas falhas).
Somar as respostas de todos os turnos (5.270 + 5.427 + 8.770 + 11.098 + 12.373 ≈ 43k de output)
também não é compatível com uma requisição única de 2,4M.

Um estouro de janela também não se manifestaria assim: o `agy` devolveria erro do provedor no
stream ou no stderr (o changelog 1.1.x registra explicitamente o conserto *"print mode silently
exiting with a success code and empty output when a request failed server-side, now writing the
error to stderr and returning a non-zero exit code"*). Aqui o stderr veio **vazio** — ver §3.4.

**[SUPOSIÇÃO]** — não medi a janela real do `gemini-3.7-flash-high` nem tenho como; só afirmo
que **este número não é evidência de estouro**.

### 3.4 Capturamos stderr? Sim. E ele veio vazio. [PROVADO]

O runner coleta stderr em paralelo — `app/src-tauri/src/agent.rs:866-876`, colhido em
`agent.rs:928` e guardado em `Outcome.stderr` (`agent.rs:944`). E ele **tem precedência sobre o
exit code** — `app/src-tauri/src/agent.rs:799-806`:

```rust
let msg = if outcome.stderr.trim().is_empty() {
    format!("o agent `{agent}` saiu com código {}", outcome.code.unwrap_or(-1))
} else {
    outcome.stderr.trim().to_string()
};
```

Como o usuário viu `o agent \`agy\` saiu com código 1`, **está provado que o stderr do `agy`
estava vazio**. Não é defeito de honestidade nosso nesse ponto: não havia o que mostrar. O
`agy` estoura o `--print-timeout` e morre em silêncio no stderr.

Mas há **duas coisas que tínhamos e jogamos fora**:

**(a) O `result` com `status: ERROR`.** O `agy` *emitiu* um `result` antes de morrer (itens
`#46` e `#69` existem, com `ok:false`). Nosso `map_result` lê o `status`
(`adapters.rs:2209`) mas **descarta o `response`** — `adapters.rs:2220-2225`:

```rust
out.push(AgentEvent::Result {
    ok,
    // text: None de propósito. O `result.response` é o blob do
    // incidente (narração colada na resposta); o fio já recebeu o
    // texto pelos steps, separado.
    text: None,
```

O raciocínio (evitar narração duplicada) vale para `status: SUCCESS`. Para `status: ERROR`, o
`response` é a última coisa que o CLI tinha a dizer, e a estamos jogando no lixo. **[SUPOSIÇÃO]**
— não capturei o payload cru do `result` de erro, então não sei se ele traz a razão ou vem
vazio. É o buraco de prova mais relevante deste relatório (ver §5).

**(b) O log file do CLI.** `agy --help` tem `--log-file  Override CLI log file path`, e o
changelog 1.1.12 registra *"Fixed startup diagnostics being swallowed into the log file instead
of reaching the terminal"* — ou seja, o `agy` escreve diagnóstico em arquivo, não no terminal.
Nós não passamos `--log-file`, então esse arquivo cai no diretório dele (que estou proibido de
inspecionar, e nem precisei). Passando um caminho nosso, teríamos a explicação de graça.

### 3.5 O teto é do turno inteiro ou só da espera do print? [SUPOSIÇÃO]

`agy --help` diz *"Timeout for print mode wait"* e o `changelog` não menciona `--print-timeout`
em nenhuma linha (grep por `print-timeout`, `5m0s`, `print mode wait`: zero ocorrências em toda
a saída de `agy changelog`). Não há doc além do `--help`.

O que os dados sugerem: as duas falhas ficaram a 5,5s e 4,1s **acima** de 300s de parede medida
por nós, e os `step_update` continuaram chegando até perto do fim — o que é consistente com um
teto de **duração total do run**, não com uma espera ociosa. Mas isso é inferência a partir de
n=2, não prova. Não rodei um turno real do `agy` para medir (proibido pelo brief).

### 3.6 O `on_close` transforma isso em algo legível? **Não.** [PROVADO]

`app/src-tauri/src/adapters.rs:2421-2427`:

```rust
fn on_close(&mut self) -> Vec<AgentEvent> {
    if self.text_open { self.text_open = false; return vec![AgentEvent::TextStop]; }
    Vec::new()
}
```

Emite no máximo um `TextStop` — puramente cosmético, fecha a bolha. Não gera evento de erro, não
diz nada ao usuário. E não é ele quem cria o incidente: quem cria é
`process_failure_fallback` (`agent.rs:791-815`), acionado porque `Result { ok: false }` **não
conta como incidente terminal** — `agent.rs:817-822`:

```rust
fn is_terminal_incident(event: &AgentEvent) -> bool {
    matches!(event, AgentEvent::LimitReached { .. } | AgentEvent::Error { .. })
}
```

`Result { ok: false }` não está na lista, então `terminal_incident` fica `false`, o fallback
roda, e o usuário recebe a frase genérica do exit code — **por cima** de um `result` que já
tinha dito `ok: false`. É por isso que o fio tem os dois itens (`#46` + `#47`, `#69` + `#70`).

### 3.7 Os outros motores têm teto equivalente? **Não.** [PROVADO]

`claude --help` e `codex --help` / `codex exec --help` (rodados nesta máquina): **nenhuma flag
de timeout**. O único teto declarado do `claude` é `--max-budget-usd`, que é dinheiro, não
tempo. **Não é a mesma classe de bug em mais lugares** — é específico do `agy`.

### 3.8 Que valor deveríamos passar?

Não invento um número. O que o app já promete:

- O app **não tem** nenhuma promessa de duração máxima de turno. A única promessa de vivacidade é
  o **watchdog de silêncio**, que dispara quando o turno passa N minutos sem produzir *nenhum item
  novo* (`app/src/lib/watchdog.ts:249-253`, `silentMs < afterMin * 60_000`, default 10 min) — e
  ele foi explicitamente ensinado a **não** confundir trabalho longo com travamento
  (`watchdog.ts:144`: *"uma pesquisa em background de 15 min viraria falso 'turno mudo'"*).
- Missões rodam fases de 15-16 minutos rotineiramente.

Ou seja: **o app já decidiu que a régua certa é silêncio, não duração**, e o `agy` é o único
motor que impõe uma régua de duração — 5 minutos, três vezes menor que o que o próprio watchdog
considera normal.

O trade-off:

- **Teto baixo demais** (hoje, 5 min): mata trabalho legítimo, cobra os tokens todos e devolve
  "código 1". Foi o que aconteceu — duas vezes, ~2,4M de tokens.
- **Teto alto demais / desligado**: processo zumbi. Se o `agy` travar de fato (socket morto,
  MCP pendurado), ninguém mata o processo — e o `kill_on_drop(true)` (`agent.rs:843`) só cobre o
  drop do future, não um processo vivo e mudo.

A saída coerente com a arquitetura: **teto alto o bastante para nunca ser o gate normal, com o
watchdog de silêncio continuando a ser o guarda real.** Um valor na ordem de `60m` deixa o
`agy` no mesmo regime dos outros dois motores (que não têm teto nenhum) sem abrir mão de um
limite duro contra zumbi. Se quiser algo configurável, o lugar natural é o mesmo campo de
settings do watchdog, para as duas réguas ficarem visíveis lado a lado — mas isso é maturação,
não o patch mínimo.

### 3.9 Patches mínimos propostos (não aplicados)

**(a) Passar `--print-timeout`** — `app/src-tauri/src/adapters.rs:2267-2277`

```diff
         cmd.arg("-p")
             .arg(&prompt)
             // O canal estruturado (agy ≥1.1.12). Sem ele o stdout é a
             // concatenação de toda fala do modelo — narração de ação colada na
             // resposta, que é o bug do inglês misturado descrito no topo.
             .arg("--output-format")
             .arg("stream-json")
+            // O `agy -p` tem teto PRÓPRIO de 5m0s (`--print-timeout`, default do
+            // --help da 1.1.13). Estourado, o processo morre com exit 1, stderr
+            // VAZIO e um `result` com status ERROR — indistinguível de uma falha
+            // real. Incidente 2026-08-16: dois turnos de 5min04s mortos assim,
+            // ~2,4M de tokens cobrados, "saiu com código 1" na tela. O app não
+            // promete teto de DURAÇÃO em lugar nenhum (a régua é o watchdog de
+            // SILÊNCIO, lib/watchdog.ts, default 10 min); claude e codex não têm
+            // flag equivalente. Aqui o teto existe só como rede anti-zumbi.
+            .arg("--print-timeout")
+            .arg("60m")
             // amarra o cwd real (senão o print mode edita o scratch, não o repo).
             .arg("--add-dir")
             .arg(&req.cwd)
```

⚠️ **Verificar antes de aplicar** o formato aceito pelo valor. O `--help` imprime o default como
`5m0s` (formato `time.Duration` do Go), então `60m` deve ser aceito — mas isso **não foi testado**
(rodar `agy` num turno real está fora do escopo permitido). Um smoke barato e legítimo:
`agy -p "/credits" --print-timeout 60m` (comando read-only que o print mode responde sem gastar
turno, conforme changelog 1.1.11) e conferir o exit code.

**(b) Não descartar o `response` quando o `status` é ERROR** — `app/src-tauri/src/adapters.rs:2209-2233`

```diff
         let ok = result.get("status").and_then(|x| x.as_str()) != Some("ERROR");
         …
         out.push(AgentEvent::Result {
             ok,
-            // text: None de propósito. O `result.response` é o blob do
-            // incidente (narração colada na resposta); o fio já recebeu o
-            // texto pelos steps, separado.
-            text: None,
+            // SUCCESS: `response` é a narração colada na resposta e o fio já
+            // recebeu o texto pelos steps → descarta. ERROR: é a última coisa
+            // que o CLI tem a dizer, e descartá-la deixa o usuário só com o
+            // exit code (incidente 2026-08-16).
+            text: if ok {
+                None
+            } else {
+                result.get("response").and_then(|x| x.as_str())
+                    .map(str::trim).filter(|s| !s.is_empty()).map(str::to_string)
+            },
```

**(c) Um erro terminal honesto no lugar do exit code genérico.** Com (b), `Result { ok:false }`
passa a carregar texto; falta ele vencer o fallback. Duas opções, em ordem de invasividade:

- *Mínima:* no `run_once`, marcar `terminal_incident` também para `Result { ok: false }` **que
  traga texto** — evita o segundo item genérico por cima de uma causa já dita.
- *Melhor:* mapear o timeout para uma mensagem própria. Como o `agy` não diz nada no stderr, a
  única fonte confiável é a duração. Um `Error` com *"o `agy` foi interrompido pelo timeout de
  print mode (`--print-timeout`) depois de 5min04s"* é infinitamente mais útil que "código 1" —
  e depois do patch (a) essa mensagem só apareceria se o teto novo fosse atingido.

**(d) `--log-file` num caminho nosso** — `adapters.rs:2247-2319`. Passar
`--log-file <dir-do-app>/agy-<run_id>.log` e, em falha sem stderr, anexar as últimas linhas ao
"Detalhes técnicos". Barato, e transforma toda falha silenciosa futura do `agy` em algo
diagnosticável sem precisar entrar em `~/.gemini/`.

---

## 4. Os dois defeitos têm a mesma raiz?

**Não, e não force a ligação.** São bugs independentes que se encontraram numa conversa só:

- Defeito 1 é de **fluxo do frontend**: um botão de UI dispara um envio de usuário durante um
  turno em voo, e a fila do humano vira caixa de mecanismo.
- Defeito 2 é de **contrato com o CLI**: não passamos uma flag que o `agy` documenta e cujo
  default nos impõe um teto de 5 minutos.

O que **é** comum aos dois: **uma mensagem de erro do `agy` que o app não entendeu.** No Defeito
1 lemos "permission denied" e concluímos "gate de diretório" quando era regra interna do CLI. No
Defeito 2 recebemos exit 1 sem stderr e concluímos nada. **Nos dois casos o app supôs em vez de
verificar, e o usuário pagou.** Isso é um padrão, não uma raiz compartilhada.

E há um efeito multiplicador: **o Defeito 1 duplicou o Defeito 2.** Sem o reenvio, teria havido
um exit 1 e ~1,8M de tokens. Com ele, dois exits e ~4,2M.

---

## 5. O que ficou sem prova

1. **O conteúdo do `result.response` nos turnos que falharam.** Só temos o item já mapeado
   (`text` descartado por `adapters.rs:2225`). Se o `agy` explicou o timeout ali, a explicação
   existiu e nós a apagamos — o que muda o veredito da §3.4 de "não havia o que mostrar" para
   "havia e jogamos fora". **Como fechar:** rodar um `agy -p` com prompt trivial e
   `--print-timeout 5s` capturando o NDJSON cru, e olhar o `result`. Fora do escopo permitido
   nesta sessão (é turno real).

2. **Se o teto do `--print-timeout` é de duração total ou de espera ociosa.** Inferido de n=2.
   Mesmo experimento acima resolve.

3. **Se `60m` é sintaxe válida para a flag.** Deduzido do formato `5m0s` do default. Não testado.

4. **O momento exato do clique em "Liberar e reenviar".** Sei que foi entre 17:47:26 (o
   `tool_result` que criou o banner) e 17:50:42 (a drenagem), e o mtime do `config.toml` marca
   17:47. Não há `ts` do enfileiramento porque `enqueue` (`chat.ts:2525-2538`) não grava
   timestamp — o que, aliás, é parte do problema: a fila não registra **quem** enfileirou nem
   **quando**.

5. **A janela de contexto real do `gemini-3.7-flash-high`.** Não medida. Afirmo apenas que os
   números do cartão não são evidência de estouro (§3.3), não que estouro seja impossível.

---

## 6. Achado lateral (fora do escopo, mas relevante)

**Nenhum turno do `agy` aparece em `turn_costs`.** A tabela tem 320 linhas de `claude-code` e 88
de `codex`, zero de `agy`. Causa: `app/src/store/chat.ts:2007` grava só
`if (e.type === "result" && e.cost_usd != null)`; o `cost_usd` do `agy` sai `None` porque
`app/src-tauri/src/pricing.rs` não tem **nenhuma** entrada `gemini` (`grep -n "gemini"`: zero
ocorrências), então `estimate` cai no `None => (None, CostSource::Unknown)` da linha 134. O
adapter é honesto por design (`adapters.rs:2202-2208`, "sem tabela não inventa número"), mas o
efeito é que **todo o consumo do Antigravity é invisível no ledger de custo** — inclusive os
~4,2M de tokens deste incidente. Não é o defeito reportado; merece issue própria.
