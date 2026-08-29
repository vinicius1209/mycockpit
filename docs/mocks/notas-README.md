# Notas — cinco desenhos, e a pergunta que cada um responde

Mock único com switcher: `docs/mocks/notas-apple.html` (variantes por hash —
`#a`, `#b`, `#c`, `#d`, `#e`; some `#d,forte` e `#c,dark`). Fugiu da convenção
de um arquivo por variante (`composer-a/b/c.html`) de propósito: as cinco
dividem a MESMA moldura de app, e o que se julga aqui é a comparação. Tokens
copiados de `app/src/index.css`, nenhum hex fora do bloco `:root`.

Escrito em 27/08/2026. **Nada de código de app foi tocado por este arquivo.**

## O ponto de partida (medido, não lembrado)

A gaveta de hoje é `fixed right-4 top-14 bottom-16` (`StickyNotesDock.tsx:68`):
altura CHEIA sempre, ancorada em nada, `fixed` — ou seja, ignora o layout e
abre por cima do painel de contexto quando os dois estão abertos. Com 1 nota,
pinta uma lousa de ~600px com um post-it no topo.

## As cinco

| | Desenho | Responde | Custo |
|---|---|---|---|
| **A** | Gaveta lista + folha, ancorada no chip | "tenho 20 notas e preciso achar uma" | 560×430 flutuando sobre o fio |
| **B** | Folha solta (Quick Note), altura do conteúdo | "tenho 3 notas e quero escrever uma" | não escala: `‹ 1/3 ›` vira folhear cego |
| **C** | Trilho no layout, à direita | "quero as notas VIVAS enquanto trabalho" | 288px permanentes + 2º trilho pra gerenciar |
| **D** | Post-its soltos, coloridos, por cima do fio | "quero papel, cor e espaço" | tapam o fio; sem ordem nem busca |
| **E** | Trilho = **histórico** da conversa | "o que aconteceu nesta conversa?" | é outra feature, não é a gaveta |

## O que o mock revelou (e não estava no briefing)

1. **A régua de turnos colide com o trilho.** Com C (ou E) aberto, o fio perde
   largura mas a régua continua pintando: ela decide por `lg:` — breakpoint de
   VIEWPORT — enquanto o espaço que ela precisa é o do CONTÊINER. Tela larga com
   trilho aberto passa no `lg` e mesmo assim não tem gutter. Conserto do mesmo
   tipo que o `TabBtn` do painel direito já usa: container query.
2. **Cor de papel a 22% (a régua do ADR-109) não lê como post-it.** O toggle
   "Tinta sóbria / Tinta post-it" existe pra decidir isso olhando: 22% é
   sussurro, 48% é papel de verdade. A 48% a nota vira o elemento mais colorido
   da tela — que é exatamente o que o §2 reserva pro vocabulário de estado.
   Se D andar, a decisão é do §2, não de gosto.
3. **D só é honesto com poucas notas.** Quatro post-its já cobrem duas frases do
   fio. É o mesmo defeito da gaveta de hoje, com outra roupa: o desenho não tem
   como degradar.

## Recomendação

**A para a gaveta** (é onde a lista, a busca e o "primeira linha vira título"
cabem sem inventar nada), com **B como estado degradado**: com ≤2 notas, a
lista some e sobra a folha — painel de 1 nota tem tamanho de 1 nota (§5).
D entra como **modo**, não como desenho principal, e só depois de o §2 decidir
a saturação.

## E — o trilho como histórico (a ideia nova, 27/08/2026)

Não é variação da gaveta: é outra feature ocupando o mesmo espaço. A coluna da
direita deixa de guardar o que VOCÊ escreveu e passa a guardar **o que
aconteceu**: uma frase de "onde estamos", a linha do tempo dos marcos (pedido,
decisão, falha revertida, pendência de terceiro, turno concluído com custo), e
o rodapé dizendo QUEM escreveu o resumo.

Isso já tem precedente estudado e ranqueado: é o **M2** de
`docs/competitors-maestri.md` ("o fim de turno diz o que fez"), que nasceu da
comparação com o "Ombro" do Maestri. O caminho lá descrito continua valendo:

- **Primário:** `helperModel` (one-shot barato) estendendo o pipeline de
  sugestões que já existe — funciona em Mac e Linux.
- **Otimização depois, com fallback:** sidecar Swift com Apple Foundation
  Models, no molde do que o ditado já faz (`src-tauri/stt/main.swift`).
  On-device é ganho de custo e privacidade, nunca o ponto de partida — miramos
  Linux também.
- **Knob honesto:** `helperModel: null` = desligado, custo zero pra quem não
  quer. O rodapé do trilho DIZ qual modelo escreveu; resumo sem autor declarado
  é a UI falando pelo agente.

Furo aberto: histórico gerado por modelo é interpretação, e o fio é a verdade.
Se os dois divergirem, quem manda é o fio — o trilho precisa levar ao turno
(clique rola até lá), nunca substituí-lo.
