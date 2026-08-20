# Nota no fio — plano

> Status: **N1 ✅ · N2 ✅ · N3 ✅** (19/08/2026). Modelo **A** escolhido: toda
> nota viaja pro agente, sempre enquadrada como direção do humano. Nasceu da pergunta certa: "como isso será
> feito para o code agent interpretar e isso ser de fato útil?" — que é a
> pergunta que separa uma feature de uma decoração.

## A restrição que manda em tudo

O app **não reenvia o histórico a cada turno**. Ele usa o `--resume` da sessão
nativa do CLI. Existem exatamente cinco portas pelas quais texto nosso chega
ao agente (mapeadas em 19/08/2026):

| Porta | O quê | Quando |
|---|---|---|
| Canal system | persona + doutrina | todo spawn, motor com `systemChannel` |
| Bloco no corpo | lições, doutrina | prependido ao prompt do turno |
| Envelope de memória | recap + ponteiro | só sem sessão pra retomar (`shouldInlineMemory`) |
| `memoryFallback` | recap curto | o motor só usa se o resume nativo falhar |
| Arquivo (pull) | transcript pleno em `.mycockpit/context/<id>.md` | o agente lê se quiser |

**Consequência dura, e é o coração deste plano:** uma nota colada no turno #3
**não entra retroativamente** na sessão do agente. A sessão dele já passou por
ali. A nota só alcança o agente:

- **push** — como bloco no prompt do PRÓXIMO envio; ou
- **pull** — pelo transcript pleno, que é regerado no export (e é o que viaja
  no fork, no handoff e no revezamento).

Qualquer desenho que ignore isso produz exatamente o que você temeu: um
comentário bonito na tela que o agente nunca lê.

## A pergunta que decide o resto

Duas intenções bem diferentes se escondem na palavra "comentário":

- **(a) Nota pra mim** — marcador de leitura, "revisitar isso". O agente **não
  deve** ver: é rascunho, e rascunho virando instrução é ruído no prompt.
- **(b) Direção pro agente** — "aqui você ignorou o caso vazio". Existe pra
  ser lida.

Se a mesma peça tentar servir às duas, falha nas duas — e o modo de falhar de
(b) é o pior: silenciosamente não chegar.

**Não vou escolher isso sozinho.** As duas saídas honestas:

| | Modelo | Ganha | Perde |
|---|---|---|---|
| **A** | Toda nota é do fio e SEMPRE viaja | uma verdade só; nota nunca "some" do contexto | não existe rascunho privado |
| **B** | Nota nasce privada; "Mandar pro agente" promove | cobre (a) e (b) | dois estados por nota; o fio passa a ter conteúdo que o transcript esconde |

**Recomendo A**, e o motivo é o mesmo que esta casa já aplicou várias vezes: o
transcript é a memória da conversa, e esconder parte dele cria uma **segunda
verdade** que diverge em silêncio (foi o que motivou o `shouldInlineMemory`
extraído hoje, e o que motivou tirar predicados reimplementados dos mocks).
Se você quiser rascunho privado, ele merece um lugar próprio (um bloco de
notas do projeto), não um estado escondido dentro do fio.

## O desenho (assumindo A)

**Reusa a forma que já provamos hoje no diff**: âncora + acúmulo + gate humano
+ citação auto-suficiente. É a mesma feature com outra âncora (turno em vez de
linha de diff).

1. **`kind: "note"` no `ChatItem`** — `{ kind, id, text, anchorId, ts }`, onde
   `anchorId` é o item comentado. Persiste no JSON de `items` que o `dbSave` já
   grava: **zero migração de banco**.

2. **Entrada pela `TurnActions`** — mais um ícone ao lado de fork/diff/reação,
   mesma régua. A nota aparece como bloco discreto ancorado sob o turno.

3. **Como o agente LÊ (o ponto que decide a utilidade).** Duas coisas, não uma:
   - No `renderTranscript`, a nota vira bloco **atribuído e enquadrado**, no
     mesmo espírito do parecer de conselheiro que já existe lá:
     ```
     ## Nota do usuário (sobre o turno acima)
     ```
     Assim ela viaja no fork, no handoff e no arquivo de memória — sem
     código novo nessas rotas.
   - No **push**, ao mandar, compõe igual aos comentários do diff: **cita o
     turno** ("sobre: 'Refatorei o parser…'") e depois a nota. A citação é o
     que a torna auto-suficiente — mesma lição dos órfãos do diff.

4. **Enquadramento explícito.** A nota precisa chegar marcada como
   **direção do humano**, não como mais uma fala. Sem isso ela se dilui no
   meio do recap. A doutrina e as lições já resolvem isso com moldura própria;
   a nota segue o mesmo padrão.

5. **Gate humano.** A nota **não** dispara envio. Ela se acumula e vai no
   próximo prompt (ou você manda explicitamente), exatamente como o
   "Enviar ao agente" do diff. Nada sai da máquina sem um clique seu.

## O que NÃO fazer

- **Não** reenviar o fio inteiro só pra "atualizar" a nota: o resume existe
  justamente pra não pagar isso, e furaria a janela de contexto.
- **Não** injetar toda nota em todo turno seguinte. Nota é pontual; lição é
  durável — quem quer permanência já tem o 🎓 (destila em regra e é injetada
  sempre). Confundir os dois transforma o prompt num acumulador.
- **Não** deixar a nota sem citação do turno: sem âncora textual ela chega
  como um bilhete sem endereço.

## Fases

- **N1 ✅** — `kind: "note"` + render no fio + entrada na `TurnActions`. Sem
  nenhuma rota de agente ainda: a nota existe, persiste e sobrevive a
  restart. Testável de ponta a ponta sem tocar em envio.
- **N2 ✅** — `renderTranscript` passa a emitir a nota (pull). A partir daqui ela
  **já viaja no fork e no handoff** de graça, porque essas rotas usam o
  transcript.
- **N3 ✅** — push: compor as notas pendentes no próximo envio, com citação do
  turno e moldura de "direção do humano". É aqui que entra a única mudança em
  `lib/fleet/send` + `ChatPanel` — e como a regra vive duplicada nas duas
  superfícies, ela nasce como predicado puro em `lib/transcript`, igual ao
  `shouldInlineMemory`.

N1 e N2 já entregam a nota útil (ela alcança o agente em todo fork/handoff e
em toda reconstrução de memória). N3 é o que a torna útil **na conversa
corrente** — e é a fase que merece mais cuidado, porque é a que mexe no
prompt de todo mundo.

## Como ficou (19/08/2026)

- Núcleo puro em `lib/notes.ts`: `pendingNotes`, `notesBlock`, `placeNotes`
  (+14 testes). A coreografia impura ("monta → prepende → carimba") é UMA só,
  em `withNotes`, usada pelas duas superfícies de envio — duplicada, um lado
  carimbaria e o outro não, e a nota voltaria todo turno.
- `sent` é FLAG, não ordem derivada do fio: o auto-resume (ADR-046) reenvia sem
  virar mensagem do usuário, então "pendente = depois do último envio"
  duplicaria a nota.
- `placeNotes` conserta um defeito do N1: o armazenamento é append-only (a nota
  nasce no fim do fio), então sem reposicionar no RENDER a nota sobre o turno 3
  aparecia lá embaixo e a âncora virava promessa não cumprida.
- Extrações forçadas pela catraca, todas com recorte real: `TurnActions.tsx`
  (MessageList 2649 → 2381), `store/chat/notes.ts`, `TurnNote.tsx`.

## N4 — a nota diz em que pé está ✅ (20/08/2026)

O que faltava depois do N3: a caixa de escrever promete "o agente vai ler", mas
a entrega só acontece no PRÓXIMO envio. Uma nota escrita e nunca seguida de
envio nunca chega — e, até aqui, ela era pixel-a-pixel idêntica a uma que já
tinha chegado. Promessa sem estado é promessa que o usuário não tem como
cobrar.

`TurnNoteBlock` passou a receber `sent` e a dizer, no lugar do rótulo fixo
"Sua nota": **"vai no próximo envio"** ou **"entregue ao agente"** (com ✓).

**Por que a diferença é MATIZ e não animação**, mesmo com o pedido explícito de
"algo mais dinâmico": o §6 do STYLEGUIDE reserva movimento pro que está vivo **e
termina sozinho**. Nota pendente não termina sozinha — ela espera VOCÊ mandar a
próxima mensagem. É exatamente o caso da falha, que já pulsou uma vez e o §6
resolveu com "matiz próprio, não animação". A transição de cor (`transition-colors`)
fica, porque cor que muda não é esteira que finge vida.
