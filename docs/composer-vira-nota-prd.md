# PRD, guardar para depois: a mensagem do composer vira nota

> Status: **implementado** (ADR-270). Mock em
> `docs/mocks/composer-vira-nota.html`.
> Origem: nota de 27/09/2026 ("às vezes não quero enviar para a fila").
> As três perguntas do mock foram fechadas pela pessoa em 27/09 seguindo as
> recomendações (seção 4, D6 a D8).
> **Correção (27/09, SPEC §0):** o E11 estava errado, `⌥↵` hoje age como
> Enter e envia; a D6 muda esse comportamento de propósito. O toast fica só
> com "Desfazer" (D5): o "feito" tem uma ação só. Implementado na ADR-270.
> ADR: abre na implementação. **Confira o máximo real** em `docs/decisions.md`
> na hora de numerar.

## 1. O pedido, nas palavras de quem usa

> "O que acha da ideia de uma mensagem pronta no composer virar uma nota no
> projeto/conversa? pois as vezes nao quero enviar para a fila"

O print que veio junto mostra o caso: o agente trabalhando há dois minutos,
texto e dois anexos prontos no composer, e só três saídas na tela
(Enfileirar, ⚡, Parar).

## 2. Evidência

| # | achado | onde |
|---|---|---|
| E1 | Com turno rodando, o texto pronto tem duas saídas: "Enfileirar" (Tab) e ⚡, corrigir agora (Enter). Nenhuma delas é "depois, quando eu decidir". | `app/src/components/chat/ComposerDispatch.tsx:73`, `composerSubmitKeys.tsx:25` |
| E2 | O despacho já trata Enviar, Disputa e Missão como **o mesmo rascunho com três destinos**, pendurados num menu do primário. | `ComposerDispatch.tsx:18-27`, `:134-167` |
| E3 | A fila é compromisso: o que entra nela vai "juntas, num envio só, quando este turno terminar". O item só pode ser editado ou tirado, e tirar joga fora. | `FilaDoComposer.tsx:1-10`, `:174`, `:181-184` |
| E4 | O rascunho é uma vaga por conversa: `text`, `attachments`, `mentionValues` e `blocos` (citação, colagem, marcação, parecer). Enquanto ele ocupa o composer, não há outra mensagem. | `app/src/store/composerDrafts.ts:13-20` |
| E5 | A nota já tem tudo o que a mensagem precisa: conteúdo, dono (projeto e/ou conversa) e anexos em disco (`attachments/notes/<id>/`). | `app/src/components/notes/types.ts:11-30` |
| E6 | Mas o `addNote` monta a nota campo a campo e **não copia `attachments`**: hoje não há como criar nota já com anexo. | `app/src/store/stickyNotes.ts:34-49` |
| E7 | Anexo da nota só nasce de bytes (`saveNoteAttachment`). Não há comando que copie um anexo da conversa para a nota, e passar os bytes pela ponte custa (`Array.from(bytes)`, até 10 MB por anexo). `attachments.rs` tem 932 linhas, perto do teto de 1000. | `app/src/lib/attachments.ts:80-92`, `app/src-tauri/src/attachments.rs` |
| E8 | "Usar no prompt" **não** devolve o texto: insere a menção `@nota/slug`, e no envio a nota chega como anotação ("direção, não fala a responder"). Serve para citar uma nota; não serve para mandar uma mensagem que você guardou. | `StickyNotesDock.tsx:543-552`, `noteMention.ts:1-30` |
| E9 | O escopo da nota vem do gesto que a cria ("conversa", "projeto", "todos") e **não muda depois**: o cartão não tem esse gesto. | `StickyNotesDock.tsx:524-533`, `noteGroups.ts:39` |
| E10 | "Tarefa" e "regra" no cartão não aparecem hoje: os handlers não são passados, de propósito. | `StickyNotesDock.tsx:554-558` |
| E11 | `⌥↵` não tem uso no composer. | `composerSubmitKeys.tsx` |

## 3. Princípio

**Fila é compromisso, nota é lembrete.** O que vai para a fila sai sem você;
o que vai para a nota não sai sem você. Guardar não aciona motor nenhum, não
é despacho, e por isso é agnóstico por construção.

## 4. Decisões

- **D1. "Guardar para depois" é um destino do rascunho**, no mesmo menu dos
  outros (E2): "Nota desta conversa" e "Nota do projeto". Com turno rodando,
  o par Enfileirar | ⚡ ganha um chevron que abre esse menu, junto das duas
  ações dele. Sem turno, as duas entram no menu do Enviar, abaixo de Disputa e
  Missão, sob o grupo "Guardar para depois".
- **D2. O escopo vai escrito no rótulo**, nunca herdado. "desta conversa" é a
  conversa onde a mensagem nasceu; "do projeto" mostra o nome do projeto. Não
  há "de todos os projetos" aqui (E9: escolha da gaveta, não do composer).
- **D3. Guarda o rascunho INTEIRO**: o texto, os blocos convertidos em texto
  com a mesma moldura que teriam no envio, e os anexos. Nada do rascunho se
  perde no caminho, e o composer fica vazio.
- **D4. Anexos copiados no disco, pelo Rust.** Um comando copia o arquivo da
  pasta da conversa para a da nota, sem trafegar bytes pela ponte (E7). Os
  anexos do rascunho saem dele; os arquivos da conversa ficam para o GC de
  sempre.
- **D5. O gesto se confirma com toast e Desfazer.** O texto sumiu da frente da
  pessoa, então é o caso do "feito com toast" (STYLEGUIDE §12):
  "Guardado nas notas desta conversa." com **Desfazer** (o rascunho volta
  inteiro e a nota some) e **Abrir** (abre a gaveta na nota). O contador de
  notas sobe junto.
- **D6. Atalho `⌥↵`** guarda direto como nota desta conversa, sem menu (E11).
  Aparece no menu, ao lado do item.
- **D7. Anexo sem texto também vira nota.** O título deriva do que há: "2
  imagens", "relatorio.pdf".
- **D8. A nota não se apaga sozinha.** Nem ao ser usada, nem ao ser enviada.
  Apagar é gesto seu; o app decidir isso seria agir por você.
- **D9. A volta tem dois gestos, e eles são diferentes** (E8):
  - **"Levar ao composer"** (novo): põe o texto e os anexos de volta no
    rascunho, como fala sua. É o caminho da mensagem guardada. Se o composer
    já tem texto, acrescenta no fim, sem apagar nada.
  - **"Usar no prompt"** (existe): cita a nota com `@nota/slug`, e ela chega
    como anotação. Serve para levar a ideia a outra conversa ou outro motor.
- **D10. A fila ganha a mesma saída.** O item da fila tem, no hover, o ícone
  de nota ao lado do ✕: abre o mesmo menu de duas linhas (conversa, projeto),
  tira o item da fila e guarda. Desfazer devolve o item à mesma posição.
- **D11. A nota sabe de onde veio.** Campo `origem: "composer" | "fila"`,
  mostrado no carimbo ("do composer · agora · 2 anexos"), no idioma do "do
  fio" que o app já usa.
- **D12. Nada de âmbar.** Âmbar é a cor da fila ("precisa de você", §2); nota
  guardada não precisa de nada. O ícone é o da nota, nunca o da fila.

## 5. Requisitos com aceite

### R1. Guardar do composer
- *Aceite:* com turno rodando e texto no composer, o chevron do par abre
  Enfileirar, Corrigir agora, e "Guardar para depois" com as duas notas; sem
  turno, as duas notas aparecem no menu do Enviar. Escolher uma cria a nota no
  escopo do rótulo, com o texto do rascunho, e esvazia o composer.
- *Double check:* no app, com o agente rodando, guardar o texto do print e
  ver a nota no topo da gaveta da conversa.

### R2. Blocos e anexos vão junto
- *Aceite:* rascunho com citação, colagem grande e dois anexos vira nota com o
  texto e as molduras como iriam no envio, e os dois anexos abrem na nota. Os
  anexos são copiados no disco (nenhum `number[]` de bytes na ponte). Anexo
  sem texto vira nota com título derivado.
- *Double check:* teste Rust do comando de cópia (caminho fora de
  `attachments/` recusado, nome preservado); teste TS da conversão dos blocos
  com fixture de rascunho real.

### R3. Toast, Desfazer e Abrir
- *Aceite:* o toast diz o escopo ("desta conversa" ou "do projeto frota").
  Desfazer devolve texto, blocos e anexos ao composer e apaga a nota e os
  arquivos dela. Abrir mostra a gaveta com a nota à vista.
- *Double check:* vitest do ciclo guardar → desfazer, com o rascunho
  comparado antes e depois.

### R4. `⌥↵`
- *Aceite:* `⌥↵` no composer com conteúdo guarda como nota desta conversa; sem
  conteúdo não faz nada; Enter e Tab seguem como hoje.
- *Double check:* teste do mapa de teclas, no padrão de `composerSubmitKeys`.

### R5. A fila
- *Aceite:* o ícone de nota aparece no hover do item, abre as duas opções, e
  tirar e guardar é um passo só, com o mesmo toast; Desfazer devolve o item à
  mesma posição da fila.
- *Double check:* vitest da operação sobre a fila (índice preservado).

### R6. A volta
- *Aceite:* nota com `origem` tem "Levar ao composer", que põe texto e anexos
  no rascunho da conversa ativa e mantém a nota; "Usar no prompt" continua
  igual. Com o composer ocupado, o texto é acrescentado.
- *Double check:* no app, guardar, levar de volta, enviar: o agente recebe a
  mensagem como sua, não como anotação.

### R7. A nota sabe de onde veio
- *Aceite:* `origem` persiste; o carimbo mostra "do composer" ou "da fila";
  nota antiga (sem o campo) segue como hoje.

## 6. Fora do escopo

- Mudar o escopo de uma nota já criada (E9). Se fizer falta, é gesto da
  gaveta, com PRD próprio.
- Ligar "Tarefa" e "regra" no cartão (E10).
- Lembrete com hora ("me lembre disso às 15h").
- Guardar resposta do agente como nota (é outro gesto, no fio).

## 7. Double check contra as leis

- **Agnosticismo:** nada olha motor; guardar não despacha.
- **A decisão é humana:** a nota não sai sozinha, não se apaga sozinha (D8), e
  a volta é sempre um gesto.
- **Estado real:** o toast diz para onde foi; Desfazer desfaz de verdade,
  arquivos incluídos.
- **Guardas:** `attachments.rs` está a 68 linhas do teto; o comando de cópia
  vai para módulo próprio se não couber. Nenhuma cor nova, nenhum degrau novo.

## 8. Fatiamento

1. **F1:** comando de cópia de anexo (Rust) e `addNote` aceitando anexos e
   `origem`.
2. **F2:** guardar do composer (menu, `⌥↵`, toast, Desfazer).
3. **F3:** a fila e "Levar ao composer".
