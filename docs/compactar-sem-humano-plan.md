# Compactar quando não há ninguém pra clicar (plano)

> Status: proposto em 24/08/2026. Nasceu da pergunta: *"como estamos hoje
> trabalhando com janela de contexto? isso é calculado corretamente? estamos
> compactando?"*

## O que a auditoria achou

### O cálculo está certo, e é honesto (não mexer)

`lib/contextMeter.ts` é a parte boa e não precisa de conserto:

- a janela **reportada pelo CLI em runtime** vence a do catálogo (o CLI sabe
  melhor que a nossa tabela);
- **não clampa** contradição pra 100%;
- **nunca deduz** a janela pelo consumo;
- tem `unavailable` explícito — diz "não sei" em vez de fabricar porcentagem.

E o limiar bate com o consenso pesquisado: `COMPACT_OFFER_THRESHOLD = 0.7`,
contra 0,70–0,75 do Claude Code e 0,80 do DeepSeek Harness.

### O buraco: nós OFERECEMOS, nunca AGIMOS

`offersCompactAction(pct)` acende um botão no popover do anel. Só isso. Quem
compacta é o humano.

Na conversa interativa **isso está certo** — compactar é ato lossy e
irreversível sobre a sua conversa, e a doutrina da casa é aprovação humana.

Onde cai por terra:

| superfície | quem clica? |
|---|---|
| conversa com você olhando | você ✓ |
| **missão de 4 fases** | **ninguém** |
| **agendamento às 3h** | **ninguém** |
| **turno de background** | **ninguém** |

Verificado: `missionEngine`/`scheduleEngine` não consultam `offersCompactAction`
nem `planCompact`. Uma missão longa chega a 100% e **morre**, em vez de
compactar a 70% e continuar.

### E o estouro não é sequer reconhecido

`isRecoverableFailure` (`lib/mission.ts`) cobre **rate limit** — item `limit` ou
`matchesResumePattern` — e recupera trocando de agent/modelo. **Estouro de
contexto não casa com nenhum dos dois**, então cai em `kind: "falha"` e a missão
morre com o erro cru do provedor.

O DSH separa os dois gatilhos explicitamente: `compactIfNeeded(trigger)` com
`'pressure'` (preventivo) e `'context-overflow'` (recuperação depois do provedor
recusar). Nós não temos nenhum dos dois.

## O princípio que decide o desenho

**A régua já existe.** `ehDesassistido()` (`lib/sessionMode.ts`, ADR-060) é a
função que responde "tem alguém na frente?". Ela nasceu pro eixo de permissão e
serve exatamente igual aqui.

Isso mantém a doutrina intacta: **compactação automática NÃO é uma mudança de
política, é o reconhecimento de que a política atual (perguntar ao humano) não
tem a quem perguntar.** Onde há humano, nada muda.

## Fases

### C1 — Reconhecer o estouro (sem agir ainda)

Um classificador puro `ehEstouroDeContexto(texto)` sobre a mensagem de erro.

- **Assinaturas de PROVEDOR, curadas** — a fonte é o `isContextWindowExceededError`
  do DSH, que tem o caso já resolvido em produção. As formas reais capturadas
  lá: `context_length_exceeded`, `maximum context length is N tokens`,
  `prompt is too long: 213462 tokens > 200000 maximum`.
- **Cuidado que o DSH documenta e vale copiar:** "exceeds" sozinho é ambíguo —
  só conta quando o objeto é explicitamente o contexto do modelo. Reconhecimento
  frouxo aqui classificaria erro de quota como estouro, e a recuperação seria a
  errada.
- Entrega: a função + testes com as frases reais. **Nada muda de comportamento
  nesta fase** — é a rede antes do trapézio.

### C2 — O estouro vira falha RECUPERÁVEL

`isRecoverableFailure` passa a incluir estouro, e a recuperação dele é
**diferente** da de rate limit:

| causa | hoje | recuperação certa |
|---|---|---|
| rate limit | troca agent/modelo | continua certo |
| **estouro de contexto** | mata a missão | **compactar e retomar** |

Trocar de modelo num estouro não resolve — o contexto continua grande. E
compactar num rate limit não resolve — a janela não era o problema. Os dois
precisam de caminhos distintos, e hoje só existe um.

- O card de recuperação ganha a variante com a frase certa.
- **Uma tentativa só.** Se compactar e ainda estourar, é falha de verdade: o
  problema não era acúmulo, e insistir vira laço caro.

### C3 — Pressão preventiva no trabalho desassistido

Antes de despachar um turno, se `ehDesassistido(modo)` e o medidor passar do
limiar, compacta primeiro.

- **Reusa `planCompact`**, que já decide `native` (`/compact` do CLI) vs `renew`
  (sessão fresca) **por capability**. Não se inventa mecanismo novo.
- **Limiar próprio, e mais baixo que o da oferta.** O 0,7 da oferta é pra você
  decidir com folga. O automático precisa de espaço pra ESCREVER o resumo — é
  exatamente a razão que o Claude Code dá pra recomendar 0,70–0,75 em vez de
  0,90. Proposta: **0,75**, entre o nosso 0,7 e o 0,8 do DSH.
- **Nunca na conversa interativa.** Lá continua oferta.

### C4 — Dizer que compactou

Compactação silenciosa numa missão é a mesma classe de defeito do recibo mudo:
o custo muda, o contexto muda, e o histórico não registra.

- Item no fio + linha no recibo de fase.
- No Painel, a missão mostra que houve compactação — é dado de auditoria quando
  a fase seguinte sair pior.

## O que NÃO fazer

- **Não** ligar automático na conversa interativa. Ali a oferta está certa, e
  trocar isso seria mudar doutrina sem necessidade.
- **Não** compactar em resposta a rate limit, nem trocar de modelo em resposta a
  estouro. São causas diferentes com remédios diferentes; misturar dá o remédio
  errado nos dois.
- **Não** reconhecer estouro por heurística frouxa. "exceeds" cru pega quota,
  e o DSH já documentou esse cuidado.
- **Não** repetir a compactação em laço. Uma tentativa; depois é falha honesta.
- **Não** inventar limiar novo sem escrever de onde veio. Todo número deste
  plano tem fonte citada — foi o erro do `3_000` herdado (ADR do G1).

## Definition of done

- Missão longa que hoje morre por estouro passa a compactar e continuar,
  provado com uma conversa real grande.
- Rate limit continua indo pra troca de agent/modelo, sem regressão.
- Conversa interativa segue **sem** compactação automática.
- A compactação aparece no fio, no recibo e no Painel.
- `tsc` 0, suíte verde, 8 guardas, e2e, `cargo`.

## Medida de sucesso (a mesma régua do G1)

Pegar a conversa de 1885 itens medida no G1, rodá-la como fase de missão até
estourar, e verificar que: (a) o estouro é reconhecido, (b) compacta uma vez,
(c) a fase termina, (d) o fio diz que compactou. Sem os quatro, a fase não valeu.
