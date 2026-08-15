# Linguagem silenciosa — proposta de emenda ao STYLEGUIDE

Companion de `docs/mocks/linguagem-silenciosa.html`. O mock mostra; este arquivo
propõe as regras, lista o estrago e dá a recomendação, com as discordâncias que
eu tenho, inclusive com partes do meu próprio mock.

> Nada do app foi tocado. Os dois arquivos em `docs/mocks/` são o entregável
> inteiro. Toda contagem abaixo foi levantada do código real (`app/src`) e está
> com `file:line` para ser conferida, não acreditada.

> **A árvore andou enquanto eu escrevia.** A sessão começou em `9abce84` e
> terminou em `73f1912`: outra frente commitou, e um dos commits (`af57bfc`,
> *"moldura do clima emoldura a JANELA; sai a marca do topo e o divisor do
> rodape"*) **já executou parte desta proposta**. Reconferi todos os `file:line`
> contra o HEAD novo; os que mudaram estão corrigidos abaixo e marcados
> **[já feito]**. A mensagem daquele commit chega ao mesmo diagnóstico com
> outras palavras, o que eu trato como corroboração e não como coincidência:
>
> > "Tres relatos do build 201, uma causa comum — a gramatica visual e feita de
> > bordas onde deveria ser feita de espaco."

---

## 1. A tese

O zcode constrói hierarquia com **peso, espaço e superfície flutuante**. O Frota
constrói com **bordas, divisores e barras de destaque**. A proposta troca a
gramática, não a pele: o brass continua primária, o vocabulário de status do §2
continua o mesmo, a escala do §3 não ganha degrau nenhum (o mock inteiro usa só
11/12/13/14 + 20/30). O que muda é o **mecanismo** que responde "onde eu estou"
e "o que é uma seção".

## 2. O achado, medido

Hoje o âmbar faz dois trabalhos: marca item selecionado na sidebar e significa
perigo. O `index.css:96` tenta salvar a distinção num comentário:

```
--st-queued: #d99138; /* âmbar da fila/atenção — NÃO é o brass (#e4a862=seleção) */
```

O comentário não se sustenta na medida. Em OKLCH, tema escuro:

| token | L | C | H |
|---|---|---|---|
| `--brass` `#e4a862` (seleção) | 77,4 | 0,112 | **69,1°** |
| `--st-queued` `#d99138` (perigo) | 71,4 | 0,134 | **67,9°** |

**1,2° de matiz.** A distinção inteira repousa em 6 pontos de luminosidade, num
traço de 2,5px de largura (`Sidebar.tsx:270`).

E tem um agravante que eu não esperava encontrar: **a relação inverte entre os
temas.** No escuro o âmbar de perigo é mais ESCURO que o brass de seleção
(ΔL −6,0); no claro (`#c1861f` vs `#a9742b`) ele é mais CLARO (ΔL +6,2), com
ΔH 4,2°. Ou seja, não existe nem uma regra consistente a ser aprendida pelo
usuário: a mesma dupla troca de posição quando ele troca de tema.

Dois achados de token que saem de brinde e reforçam o mesmo ponto:

- `--ring` **é exatamente** `--brass` (`index.css:89` e `:91`). O anel de foco e
  o marcador de seleção são o mesmo pixel de tinta.
- `--st-idle` **é exatamente** `--faint` (`#687078`). Estado ocioso e metadado
  já são indistinguíveis, o que mostra que colapsar sinais em tinta não é um
  acidente isolado.

E o tamanho do problema do lado do âmbar: ele está em **38 arquivos** carregando
**7 significados distintos**. O maior grupo (11 arquivos) é "config faltando /
sem login", que não é fila nem risco.

**Conclusão que vira requisito:** a saída não é escurecer o âmbar, é tirar a cor
da seleção. Selecionado vira preenchimento neutro + pip, e o âmbar fica com um
dono só.

---

## 3. A emenda, seção por seção

### §2 — Papéis de cor

**Linha do Brass.**

- **Morre:** `Use para: Ação primária/sensível, foco (--ring), item ativo, marca`.
- **Nasce:** `Use para: Ação primária/sensível, foco (--ring), marca`, e na
  coluna NÃO use para entra: *"marcar item selecionado em lista, árvore ou aba
  (isso é preenchimento neutro + peso, sem tinta)"*.

**Linha do Âmbar.**

- **Morre:** `NÃO use para: Seleção ou item ativo (isso é brass)`. A regra dizia
  a coisa certa pelo motivo errado, mandando a seleção pra uma cor da mesma
  família de matiz.
- **Nasce:** `NÃO use para: qualquer coisa que não seja decisão pendente, fila,
  gate ou risco autorizado`. Seleção não é âmbar nem brass: **seleção não é
  cor**.

**Regra nova (a receita única).**

> **Selecionado tem UMA receita no app inteiro: preenchimento neutro
> (`--sel`) + peso 500 + pip neutro de 3px no gutter. Nenhuma tinta de status,
> nenhuma barra de acento, nenhum sublinhado colorido.**
>
> Tokens novos: `--sel: rgba(255,255,255,.065)` (escuro) /
> `rgba(0,0,0,.055)` (claro) e `--sel-hover` com ~metade da opacidade.
> Texto do item selecionado é `foreground` (mantém a correção S3.6 de
> `Sidebar.tsx:990`, que já tinha reprovado brass 12px sobre hover no claro por
> 3,56:1).
>
> Exceção fechada: **controle segmentado** (o comutador da barra superior e a
> linha de Execução) não é lista; segue como já é hoje. E o "Liberado" âmbar do
> segmentado de Execução continua exatamente onde está, porque é risco, não
> seleção.

**Regra nova (identidade de motor).**

> **Identidade de agent na árvore distingue por SILHUETA, nunca por cor.** A
> marca do motor é monocromática (`muted-foreground`), permanente, e não recebe
> badge de estado. Cor categórica por agent (`brass`/`st-running`/`id-violet`)
> continua restrita a série de gráfico e legenda, como o §2 já manda.

### §3 — Tipografia

**Sem emenda.** Nenhum degrau novo, nenhuma exceção pedida. O mock inteiro
(inclusive o próprio chrome de documentação) fecha em 11/12/13/14 + 20/30,
conferido por varredura. Isto é deliberado: se a gramática nova precisasse de um
tamanho novo pra funcionar, ela estaria compensando com tipo o que perdeu em
borda, e seria uma troca ruim.

### §4 — Elevação

**Esclarecimento (a regra que destrava tudo).**

- **Morre:** ler *"cartão dentro de cartão com borda própria e raio próprio é
  proibido"* como "raio dentro de raio é proibido".
- **Nasce:** *"A proibição é de **borda** aninhada. Superfície que se separa por
  **cor + raio, sem hairline**, não conta como cartão para esta regra."*

Sem isso, o painel direito não pode virar cartão (E1) e o composer não pode
seguir E2 lá dentro. Com isso, a proibição fica **mais** forte, não menos: como
o painel virou superfície, nada dentro dele pode ter borda própria, e é
exatamente isso que mata os divisores.

**Regra nova (divisor).**

> **Divisor é último recurso.** Seções de um mesmo painel se separam por
> proximidade assimétrica: **24px acima do título, 8px abaixo** (razão 3:1).
> Hairline entre seções só sobrevive onde muda a **propriedade** do conteúdo
> (uma lista de dados → uma zona de ação), nunca onde muda só o assunto.

**Regra nova (canto).**

> **Hairline de largura total só termina em aresta reta.** Superfície com raio R
> tem `padding-inline ≥ R`. Numa janela com canto arredondado, faixa full-bleed
> com `border-t` e fundo próprio é proibida: quem separa é o inset do conteúdo.

Esta é a regra que resolve a faixa de status "cortada", e ela é mensurável, não
estética: hoje são três coisas entrando na curva do macOS (o hairline, o
retângulo de fundo, e o `UsagePill` que começa a 12px, por cima do raio).

**O app já pagou por esta regra uma vez, em outro lugar.** O `af57bfc` corrigiu
exatamente este bug na moldura de risco, e o comentário que ficou
(`lib/climate.ts:70-75`) diz a mesma coisa que a regra acima:

```
/* rounded-[10px]: a janela do macOS é arredondada (titleBarStyle Overlay, com
   os cantos comidos pelo raio do sistema) */
```

Ou seja: o raio real da janela é **10px** (não 12), a regra já foi descoberta na
marra, e a faixa de status é a próxima superfície com o mesmo defeito, ainda em
pé (`StatusBar.tsx:69`). Escrever isso no §4 é o que impede a terceira
descoberta.

### §6 — Movimento e tempo

**Regra nova (slot da linha de conversa).**

> A linha de conversa da sidebar tem um **slot direito de 36px com dono único**,
> que responde uma pergunta só ("quando?"), em ordem fechada:
> **`pede > rodando > falhou > tempo relativo`**.
> O tempo é relativo, por **um ticker único de 60s** para a lista inteira (o
> padrão de `lib/watchdog.ts`), com precisão que degrada
> (`agora · 9m · 1h · 3d`, e data a partir de 7d). **Nunca segundos**: a linha
> viva do composer segue dona do agora (§6, "dono único do agora").

### §10 — Guarda automática

Duas guardas novas, ambas triviais de escrever no modelo de
`scripts/lints/deadTokens.mjs`, e sem as quais isto re-fragmenta em dois
sprints (a lição do Buzz que o próprio §10 cita):

1. **Barra de acento**: falha se aparecer elemento absoluto de largura ≤ 3px com
   `bg-brass`/`bg-st-*` ancorado em `left-0`/`inset-y` (o padrão de
   `Sidebar.tsx:270`).
2. **Divisor full-bleed em painel**: falha se `<Separator />` aparecer como irmão
   direto de `<Section>` no `ContextPanel` e afins.

---

## 4. O que isso QUEBRA ou CUSTA

Inventário real, contado no código, não estimado.

### 4.1 Barra de acento — 3 ocorrências, 1 arquivo

| file:line | marca | forma |
|---|---|---|
| `Sidebar.tsx:270` | projeto ativo | `w-[2.5px] h-5 bg-brass` + `bg-accent` |
| `Sidebar.tsx:696` | conversa ativa | `w-[2.5px] h-4 bg-brass` + `bg-accent` |
| `Sidebar.tsx:982` | feature SDD focada | `w-[2.5px] h-4 bg-brass` + `bg-accent` |

Custo real: **baixo**. Marcação idêntica nas três, um arquivo só, e
**nenhum teste prende esse estilo** (varri `*.test.ts(x)` por `bg-brass`: zero
ocorrências). É o item mais barato da lista e o de maior efeito.

### 4.2 Brass como "ativo" — ~21 sítios, 20 arquivos

Aqui está o custo de verdade. Hoje o app tem **três linguagens diferentes de
"ativo"** convivendo:

1. barra brass + `bg-accent` (`Sidebar.tsx:270,696,982`);
2. sublinhado brass + badge brass (`ContextPanel.tsx:327` e `:319`);
3. `bg-accent` puro / `bg-card`+shadow, **sem brass nenhum**
   (`SettingsDialog.tsx:256-257`, `TitleBar.tsx:49`).

A proposta promove a terceira a padrão. Os outros ~16 sítios (FlightPlansView,
SddView, ScheduledView ×3, LearningSection, Especialistas, FusionBoard,
MissionPlanCanvas, InteractionHost, RichSelect…) ficam divergentes até serem
migrados.

**Este é o maior risco da proposta, e ele bate de frente com o §0 do guia.** O
§0 diz que divergência aparece semanas depois, junta, sem autor. Uma migração em
fases produz divergência **de propósito**. Minha defesa é que há uma diferença
entre divergência acidental e divergência datada e escrita, mas ela só vale se a
Fase 2 tiver dono e prazo. Se não tiver, é melhor não começar.

### 4.3 Divisores do painel — 7 `<Separator />`, 1 arquivo

`ContextPanel.tsx` linhas **660, 669, 677, 690, 837, 870, 894**, entre 8
`<Section>`. Correção à premissa original: **não é `border-b`**, é o componente
`<Separator />` (`ui/separator.tsx:18` = `h-px w-full bg-border`), que **ignora o
`px-5` das seções** e corre de parede a parede enquanto o conteúdo respira 20px.
O sintoma percebido está certo; o mecanismo é outro, e isso importa porque a
correção é deletar 7 linhas, não caçar classes.

Custo: **baixo**. O `Section` (`:61-70`) já é `px-5 py-3` sem borda; muda para
`pt-6 pb-0` e o `mb-2` do título vira `mb-2` mesmo (8px). Nada mais.

### 4.4 Rodapé da sidebar e faixa de status

- **[já feito]** O `border-t` do rodapé da sidebar **saiu** no `af57bfc`. O
  `<footer>` agora é `flex h-12 shrink-0 items-center gap-2.5 px-3`
  (`Sidebar.tsx:1409`), sem borda nenhuma, e é hoje o arquivo inteiro sem
  `border-t/b`. Sobra só o avatar em `bg-brass/15 text-brass`, que a proposta
  leva pra neutro (brass não é identidade, é gesto).
- **em pé:** `StatusBar.tsx:69` continua com `border-t border-border/60 bg-rail
  px-3`. Sai a borda, sai o fundo próprio (a faixa passa a ser o piso da
  janela), e `px-3` vira `px-4` (16px ≥ raio 10px).
- Consequência de layout: o conteúdo precisa de inset de 8px, o que mexe em
  `App.tsx` e no `ResizablePanelGroup` em volta. **É a mudança estrutural mais
  invasiva da proposta** e a única que toca layout de verdade.

### 4.5 Barra superior — **[já feito]**

`FrotaMark` + wordmark + o `BarDivider` da esquerda **já saíram** no `af57bfc`.
Restou um `BarDivider` só, o da direita entre ícones e o toggle do painel
(`TitleBar.tsx:180`), que é legítimo e fica.

Continua em aberto **um detalhe**: o nome do projeto (`TitleBar.tsx:152`) ainda é
`text-[13px] text-muted-foreground`. Com a marca fora, ele é a única identidade
da janela e deveria subir para `text-foreground font-medium`. Hoje a faixa mais
cara da janela abre com um texto em cinza secundário.

**Custo aceito, não escondido:** sem marca e sem wordmark, nada identifica o app
em screenshot ou gravação de tela. É custo de marketing, não de uso, e a decisão
já foi tomada e executada. Só não quero que apareça como surpresa depois.

### 4.6 O badge de estado sai da marca do motor — e isto precisa ser decidido

**O ícone de motor NÃO sai. Ele está presente nos quatro estados do mock, é
zona própria na anatomia da linha, e ganhou silhuetas distintas por motor
(asterisco = Claude Code, hexágono = Codex, losango = Antigravity), porque a
frota é mista de propósito e uma sidebar de motor único não provaria nada.**

O que sai é o **badge de estado grudado nele** (`AgentMark.tsx:31-41`), que se
muda para o slot direito. Isso é uma perda deliberada e ela precisa ser vista:

- `AgentMark` só é consumido em `Sidebar.tsx:749`. Sem o badge, a prop `status`
  (`AgentMark.tsx:17,21`) fica **morta** e deve ser deletada, não mantida "por
  via das dúvidas".
- O badge `done` usa `bg-st-success` (`AgentMark.tsx:36`): verde de estado
  ambiente permanente numa lista. Removê-lo **fecha um resto do §9 item 4**, que
  matou exatamente esse padrão em todo o resto do app, e faz a baseline de
  `check-dead-tokens.mjs` **encolher** (direção permitida pelo §10).
- A perda real: hoje dá pra ver "o último turno terminou bem" sem abrir. Depois,
  não. Mitigação honesta: o §9 item 4 já registrou que `idle` e `success` viraram
  o mesmo pixel no `StatusDot`, e a régua que ficou é *"dot ambiente cinza é a
  lei; quem precisa distinguir dois estados saudáveis usa texto"*. O tempo
  relativo no slot é esse texto.

Se a decisão for manter o badge no logo, a proposta **não desaba**: o gutter e o
slot continuam válidos, e o custo é o item voltar a ter dois donos de estado
(badge + slot) e o verde ambiente continuar na lista. Eu não recomendo, mas é uma
decisão de produto, não de guia.

### 4.7 Token `--rail` — a mudança que eu menos gosto

Pra sidebar e faixa perderem a borda, o degrau de cor precisa carregar o que a
borda carregava. Hoje `--rail` `#0c0d10` e `--background` `#0a0b0d` diferem por
~2 níveis por canal: **praticamente imperceptível**. O mock usa `#101216`.

Custo: toca **toda** superfície que usa `bg-rail` (TitleBar, StatusBar, Sidebar,
ContextPanel) e exige par claro equivalente, com o risco de assimetria entre
temas. É a única mudança de token da proposta e a que eu mais quero ver medida
antes de entrar.

### 4.8 O que NÃO custa nada (verificado)

- **Migração de banco: nenhuma.** `conversations` já tem `updated_at`, o
  `listConversations` já o seleciona e já o entrega como `updatedAt`
  (`lib/db.ts:245` e `:251`). O tempo relativo é gratuito do lado do dado; o
  único custo é o ticker.
- **Escala tipográfica:** zero degraus novos.
- **Testes existentes:** nenhum prende o estilo de seleção.

---

## 5. O que fica ambíguo sem divisor (a parte honesta)

Duas transições ficam mais fracas do que estão hoje. Não são hipóteses, são as
duas que eu consigo apontar no próprio mock:

1. **Seção do painel que termina em parágrafo.** `Ajustes` acaba com uma frase
   de ajuda em 11px `leading-snug` (`ContextPanel.tsx:616-619`), e logo abaixo
   vem o título `Doutrina`. O respiro de 24px compete com o espaçamento entre
   linhas do próprio parágrafo (~17px): sobra pouco mais de meia linha de
   diferença. O que segura ali não é o espaço, é o título ser **mono, caixa alta,
   tracking e `faint`**, ou seja, um tipo que não existe em nenhum outro lugar do
   painel. Funciona, mas é a transição mais frágil, e é a primeira candidata a
   ganhar um hairline de volta se na tela real ela falhar.

2. **Última conversa de um projeto → próximo projeto.** Sem divisor, a fronteira
   fica por conta de altura (34 vs 30px), peso, indentação e ícone. No mock eu
   precisei adicionar **6px de margem acima de cada linha de projeto** pra isso
   fechar; sem esses 6px, uma conversa de título longo seguida de um projeto de
   nome curto realmente escorrega. Registro o número porque ele é a regra, não
   um ajuste de olho.

Onde a ambiguidade **não** aparece, e eu esperava que aparecesse: a árvore
projeto→conversa se lê sem barra e sem borda com folga. A seção 3 do mock mostra
ela com **toda** a cor removida, inclusive o pip, e os seis canais que sustentam
a hierarquia (tamanho, peso, cor, indentação, espaço, caixa) já existiam. A barra
brass nunca foi o que fazia a árvore funcionar; ela era redundante com cinco
outros sinais e gastava a única tinta que a UI tinha pra dizer "perigo".

---

## 6. Ordem de aplicação sugerida

| Fase | Escopo | Arquivos | Risco |
|---|---|---|---|
| 1 | Barra de acento sai, `--sel` entra, slot direito com tempo relativo | `Sidebar.tsx`, `index.css`, `AgentMark.tsx` | baixo |
| 2 | Painel direito vira cartão, 7 `<Separator />` saem, aba sem sublinhado | `ContextPanel.tsx`, `App.tsx` | médio (layout) |
| 3 | Faixa de status sem borda + inset de 8px; avatar e nome do projeto fora do cinza (o resto da fase **já foi feito** no `af57bfc`) | `StatusBar.tsx`, `App.tsx`, `Sidebar.tsx`, `TitleBar.tsx` | médio |
| 4 | `--rail` medido e ajustado nos dois temas | `index.css` | médio, reversível |
| 5 | Os ~16 sítios restantes de brass-como-ativo, por superfície tocada | 16 arquivos | baixo por arquivo, alto se abandonado no meio |

Fase 1 sozinha já entrega o ganho central (o âmbar volta a ter um dono) e é
reversível num commit. **Se for pra fazer só uma, é essa.**

---

## 7. Recomendação, com as discordâncias

**Recomendo aprovar as Fases 1 a 3, e tratar a 4 e a 5 como condicionais.**

O ganho não é de gosto. Hoje a tinta que significa "isto pode executar comando
na sua máquina sem pedir" é a mesma família de matiz da tinta que significa "esta
linha está selecionada", num app cuja doutrina inteira é aprovação humana. Isso
não é um detalhe estético que o zcode inspirou; é o §2 do próprio guia sendo
contrariado por um token que ninguém mediu.

E a direção já está em movimento sem este documento: o `af57bfc` tirou a marca do
topo, tirou o divisor do rodapé e consertou a moldura pelo raio da janela, tudo
sob o diagnóstico de que *"a gramatica visual e feita de bordas onde deveria ser
feita de espaco"*. O que falta não é convencimento, é **escrever a regra no
guia** antes que as próximas vinte sessões cheguem a vinte leituras razoáveis da
mesma intuição, que é literalmente o cenário que o §0 descreve.

Agora onde eu discordo, incluindo do meu próprio mock:

**1. A esteira azul de "rodando" é pior que um ponto azul. Eu não a
recomendaria.** Ela está no mock (bloco A2) porque é a leitura mais zcode e
porque você pediu pra comparar vendo, mas eu ficaria com a **Opção 2**: ponto
azul, mesmo desenho do ponto âmbar. Motivo: com a esteira, o slot passa a ter
dois idiomas (uma barra e um ponto) para o mesmo papel; com o ponto, a coluna
inteira lê como um vocabulário só (*âmbar = pede · azul = roda · vermelho =
falhou · texto = tempo*), usando cores que o §2 já definiu. Além disso, 2px de
altura de movimento na periferia do olho passa perto demais de artefato de
scrollbar. A esteira é mais bonita; o ponto é mais legível e mais fácil de
cobrar numa guarda.

**2. O véu de rolagem no rodapé da sidebar eu cortaria.** Está no mock, e eu o
tiraria. Ele troca um hairline de custo zero por um listener de scroll, estado, e
um elemento que aparece e some. O §5 do guia gosta de sinal que reflete estado
real, e o véu passa nesse teste, mas a pergunta anterior é se o problema existe:
48px de altura fixa e uma faixa de fundo já separam o rodapé da lista. Eu
entregaria **sem borda e sem véu**, e só adicionaria o véu se na tela real
incomodar.

**3. A mudança de `--rail` é a que eu mais quero ver medida, não argumentada.**
É o único item da proposta que mexe em token global e afeta os dois temas. Eu
não a mandaria junto com a Fase 3; mandaria depois, isolada, pra poder ser
revertida sem desfazer o resto.

**4. Sobre o tempo relativo: sim, serve, e por motivo melhor que estética.** Dá
âncora à direita pro título truncar contra alguma coisa, torna a lista escaneável
por recência sem ordenar nada, e o dado **já está no banco e já chega ao front**.
As duas condições são inegociáveis: ticker único de 60s (nunca um por linha) e
precisão que degrada. Sem a segunda, "34d" vira ruído fingindo precisão.

**5. Onde eu acho que a proposta fica pior que hoje:** perde-se ver "o último
turno terminou bem" de relance na sidebar (§4.6). Eu aceito a perda porque o
verde ambiente já foi julgado e condenado no §9 item 4 e porque o tempo relativo
cobre a pergunta prática ("isto andou recentemente?"). Mas é uma perda real, não
um empate, e quem aprovar isto deve aprovar sabendo.

---

## 8. Furos que eu não fechei

- **Tema claro.** O mock é só escuro. `--sel` no claro (`rgba(0,0,0,.055)`) e o
  novo `--rail` claro estão **propostos no papel e não verificados na tela**. O
  §8 do guia manda revisar nos dois temas; esta proposta ainda não foi.
- **Densidade mínima da sidebar.** O §8 cita 190px de largura mínima. Com o slot
  de 36px reservado à direita, o título perde 36px justamente onde ele já era
  apertado. Não testei nessa largura, e é o cenário mais provável de quebrar.
- **A faixa de status no Linux.** A regra do canto assume o raio do macOS. No
  WebKitGTK o raio da janela é outro (ou nenhum), e `padding-inline ≥ R` precisa
  ler o raio real, não um 16 fixo.
- **`--sel` sobre a cor-rótulo da conversa.** As linhas com cor de projeto
  aplicam `color-mix(… 12%, var(--accent))` (`Sidebar.tsx:681-693`). Troquei
  mentalmente `--accent` por `--sel`, mas não conferi como a lavagem de cor se
  comporta sobre um branco a 6,5% em vez de uma cor sólida.
- **A moldura de risco no mock.** Ela emoldura a janela inteira com o raio de
  10px, que é o comportamento novo do app (`af57bfc`). Não testei como esse anel
  convive com o inset de 8px do conteúdo que a Fase 3 propõe: são dois desenhos
  de borda arredondada aninhados, e pode ser que um dos dois tenha que ceder.
- **Silhueta de motor além de três.** As marcas do mock distinguem bem com três
  motores. Com seis, silhueta monocromática a 13px provavelmente não escala, e
  a saída **não** pode ser cor (voltaria a colisão). Não resolvi isso.
