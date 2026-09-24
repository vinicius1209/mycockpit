# Concorrente: Zeron (zeronsh/zeron): o fio de trabalho do agente

> Estudo de 23/09/2026, com olhar de front sênior, sobre a superfície onde a
> gente VÊ o agente trabalhando. Fontes: vídeo do @winglee (frames em
> `docs/visual-reference/winglee-agent-ui/`, foco nos 007, 011–014) e o
> CÓDIGO (MIT, clone raso em `~/projetos/zeron`, commit `c914b31`).
> Nada foi copiado. O que se absorve são REGRAS e números.

## O que o Zeron é, em uma linha

Control plane nativo para Claude Code, Codex, Cursor, Devin, Grok, Antigravity
e outros. Tudo em **Rust + GPUI** (o framework do Zed), sem webview na UI.
Engine local por dispositivo e sync opcional. Fontes: Geist e Geist Mono,
as mesmas da Frota. **Então a diferença de polimento não vem da fonte.**

## O diagnóstico em uma frase

O Zeron trata cada coisa do fio como **tipografia com um objeto**, e a
Frota trata cada coisa como **uma linha de controle com metadados**. Lá, o
olho encontra o verbo, o arquivo e mais nada. Aqui, cada ação carrega ícone de
estado, verbo e arquivo colados, diretório em mono, contagem de diff e
chevron. Tudo isso é correto, mas tudo aparece ao mesmo tempo.

## Anatomia do frame 007 (o fio vivo)

```
I'll give the hero a fresh look…                      ← prosa 14px, text pleno
⌄ Read 2 files · searched 1 time                      ← resumo 12px, muted, com shimmer
  ├─ ▭ Read  [⚛ Hero.tsx]                             ← verbo muted + PÍLULA do arquivo
  ├─ ▭ Read  [{} theme.css]
  ╰─ ○ Search hero|button|accent in /Users/…/src      ← sem arquivo: detalhe em texto
⁘ Puzzling…  3s                                       ← spinner 3×3 colorido + palavra + tempo
```

Cada escolha, com o número no código:

| elemento | como é feito | onde |
|---|---|---|
| Resumo do grupo | gramática por verbo, contada e deduplicada: "ran 3 commands · edited 2 files · read 2 files · searched 1 time". Só a 1ª letra sobe. | `crates/proto/src/view.rs:446` |
| Resumo vivo | um **shimmer** de luz varre o título (3,4 s por volta, faixa de 36% do título), pintado sobre o texto sem quebrar o kerning. Com reduced motion, ele some. | `crates/ui/src/transcript.rs:1967`, `:2719` |
| Resumo concluído | faz crossfade do resumo para "Worked for 1m 3s" (4 px de subida + opacidade) | `transcript.rs:2229` |
| Trilho da árvore | tronco em x=12,5, **cotovelo arredondado** (raio 6) até x=28, filete de 1 px em `hairline(0.12)`. O ícone só aparece quando o galho chega. | `transcript.rs:102-108`, `:8325` |
| Chegada de linha | a linha surge em 360 ms `ease-out-expo`, com 65 ms de escalonamento. O conector se **desenha** em 480 ms `ease-out-quint`: primeiro estende o tronco da linha anterior e depois faz a curva. | `transcript.rs:122-128`, `:2590` |
| Linha de ação | ícone de 16 px em `text_muted` (vira `danger` na falha), rótulo 12/18 px, linha de 32 px e **sem gap entre linhas** (o trilho fica contínuo) | `transcript.rs:109-114` |
| Pílula de arquivo | altura 22 px, raio 5 e fundo `ink(0.06)`. Dentro, um **poço** de 20 px (raio 4) com o ícone **policromático** de 14 px e depois o basename. Só o nome, nunca o caminho. | `transcript.rs:~8085-8130` |
| Ícones de arquivo | VS Code **Symbols** (miguelsolorio, MIT), 250 SVGs, resolução exata por nome, depois extensão composta e depois linguagem. No escuro, as cores clareiam por substituição de hex (`#2563EB→#60A5FA`…), sem virar monocromático. | `crates/ui/src/file_icons.rs:1-50`, `assets/file-icons/` |
| Indicador de trabalho | matriz 3×3 de pontos com uma cor por linha (`#B6D3EF` céu, `#EDB185` pêssego, `#F888A0` rosa). A onda sobe de baixo para o centro-topo a cada 750 ms e o descanso fica em opacidade 0,1. | `crates/ui/src/loaders.rs:108`, `crates/proto/src/motion.rs:32` |
| Palavra do indicador | 21 palavras ("Puzzling", "Tinkering", "Marinating"…) que trocam a cada 7 s, com semente por chat | `transcript.rs:2158` |

## Anatomia dos frames 011–014 (arquivo aberto ao lado)

- **O fio encolhe, não some** (013 → 014). Com o editor aberto, o chat vira
  uma coluna estreita com a mesma tipografia. Os grupos de ferramenta ficam
  **recolhidos** ("› Edited 1 file · read 2 files · searched 1 time") e a
  prosa fica como protagonista.
- **O streaming dissolve** ("needs a clear ~~focus rin~~" no 014). É o *veil*:
  cada trecho que chega nasce transparente e ganha opacidade. A duração se
  adapta à cadência do stream (EMA dos intervalos ×3, limitada entre 120 e
  400 ms), com curva `1 − (1 − p)^1,6`. **Não há translação**: o layout é
  aplicado na hora e só a cor anima. (`crates/ui/src/markdown/veil.rs:1-60`)
- **Editor**: aba com o ícone do arquivo e breadcrumb que também leva ícone
  (`⚛ src › components › Hero.tsx`). Tem números de linha em muted, **guias de
  indentação** finas, Geist Mono e uma paleta de sintaxe de 5 ou 6 matizes
  pastéis (rosa nas tags, verde nos atributos, âmbar nas strings, azul-lavanda
  nas palavras-chave).
- **Árvore de arquivos**: os mesmos ícones Symbols do fio. `src` e
  `components` usam pasta com selo de código, `package.json` usa o hexágono
  verde e `README.md` usa o "M↓" azul. A linha ativa ganha fundo cheio de
  ponta a ponta, e as guias verticais de indentação ficam finas.
- **Um só vocabulário visual**: o arquivo que aparece na pílula do fio, na aba,
  no breadcrumb e na árvore tem **o mesmo ícone**. É isso que dá a sensação
  de "produto único".

## A Frota, lado a lado (o que o código mostra hoje)

| superfície | Frota hoje | onde |
|---|---|---|
| Ícone de ação | Lucide monocromático por tipo (`FileText`, `FilePen`, `Search`…), 14 px, em `muted-foreground/55–70` | `app/src/components/chat/MessageList.tsx:114`, `:302` |
| Rótulo | verbo e objeto **fundidos numa string**: "Ler Hero.tsx", "Editar Hero.tsx" | `app/src/lib/toolview.ts:300-330` |
| Metadado | diretório em mono 11 px à direita, mais contagem de diff e chevron no FIM da linha | `MessageList.tsx:334-360` |
| Árvore | só indentação por `aria-level`, com uma `border-l` reta apenas no histórico recolhido. Não tem cotovelo e não tem trilho contínuo. | `MessageList.tsx:~700` |
| Arquivo como objeto | não existe. O arquivo é texto dentro do rótulo e a árvore de projeto usa `Folder`/`FolderOpen` mono. | `app/src/components/layout/ProjectFilesPanel.tsx:449` |
| Indicador vivo | avatar do executor, "está trabalhando…" com dots e cronômetro | `app/src/components/chat/WorkingIndicator.tsx` |
| Streaming | o texto entra sem dissolver (os keyframes `fio-*` são de chegada de BLOCO, não de trecho) | `app/src/index.css:673-722` |
| Autoria | gutter estilo Slack com avatar de 28 px, nome, selo do motor e hora em cada grupo | `app/src/components/chat/GroupRow.tsx` |

## Evidência do fio hoje (prints e transcript de 23/09)

Turno real do protocolo de arquivos no Rust (sessão `b6cd7444`), cruzado com
uma sonda em `presentTool`/`describeToolGroup`. Mock:
`docs/mocks/fio-de-trabalho-zeron.html`.

- **A Frota não reconhece as próprias tools.** Os quatro "Executar
  ferramenta" do print são `mcp__frota-work__work_update`, `work_plan` e
  `mcp__frota-approval__ask_user`: 85 chamadas nessa sessão. Caem no
  `default` de `app/src/lib/toolview.ts:430` e o nome real fica em `meta`, que
  o grupo de uma ação só não mostra.
- **Edição classificada como verificação.** `sed -i '' 's/…/' src/lib.rs`
  ("Fix the remaining test import and rerun") sai como `category: "inspect"`.
  Uma edição real entra na contagem de "verificações".
- **Três substantivos para o mesmo grupo.** "ações", "verificações",
  "validações" (`app/src/lib/toolGroup.ts:94-102`). No vivo, o cabeçalho vira
  a descrição da ação corrente e, dentro dele, aparece um órfão "em execução".
- **Língua misturada.** A `description` do modelo vem em inglês e tem
  precedência sobre a leitura do comando (`toolview.ts`, caso `Bash`). A prosa
  está em pt-BR e a linha da ação está em inglês.
- **Plano.** A etapa "Aprovação da pessoa" segue pendente, antes da etapa
  corrente, e nada diz isso. A lista aberta tem rolagem interna para 9 itens.

## O que absorver, em ordem de retorno

1. **Separar verbo de objeto e dar corpo ao objeto.** O `presentTool` passa a
   devolver `{ verbo: "Ler", objeto: { tipo: "arquivo", caminho } }`, e a linha
   renderiza "Ler" em muted + uma `PilulaDeArquivo` (22 px, poço de 20 px,
   ícone de 14 px, só o basename, caminho completo no title). O diretório sai da
   linha, porque ele já está no hover e no expandido. **É a mudança de maior
   efeito sozinha**: o frame 007 é quase só isso.
2. **Ícones de arquivo policromáticos, um conjunto só, em todas as
   superfícies** (pílula, aba, breadcrumb, `ProjectFilesPanel`, diff). O
   Symbols é MIT e tem manifest VS Code, então dá pra usá-lo direto na web. A
   primitiva nasce em `components/ui/` (regra 1 do guia), e o clareamento do
   escuro fica em tabela de hex, como no Zeron.
3. **Gramática do resumo de grupo por verbo contado**: "Leu 2 arquivos ·
   buscou 1 vez · editou 1 arquivo". Isso substitui o "Atividade técnica"
   genérico quando não há rótulo melhor (`app/src/lib/toolGroup.ts:189`).
   Concluído, o grupo nasce **recolhido** nessa única linha. Isso já é quase o
   nosso `bornOpen`, falta a frase.
4. **Trilho com cotovelo arredondado.** Um SVG por linha: tronco + curva de
   raio 6 + perna curta, com o filete em `border-border/40` (o divisor interno
   do guia §4, nada de opacidade nova). Linhas sem gap para o trilho ficar
   contínuo. O desenho animado entra só para a linha que **nasceu agora**
   (ADR-179/180), usando `stroke-dashoffset` em ~480 ms.
5. **Veil no streaming.** É opacidade por trecho recém-chegado, sem
   translação, com duração adaptada à cadência. Isso casa com
   [movimento sutil no fio] e é paint-only. Cuidado de implementação: por
   `span` com animação CSS no trecho novo, nunca re-renderizando o texto já
   assentado.
6. **Shimmer no resumo do grupo vivo**, em vez de um segundo indicador.
   Resolve a regra "um único ponto vivo por linhagem" com menos ruído. Na web
   é `background-clip: text` com um gradiente andando, desligado em
   `prefers-reduced-motion`.
7. **Paleta de sintaxe e guias de indentação** no viewer de arquivo e no diff.
   É barato e muda a percepção inteira da lateral.

## O que NÃO absorver

- **Palavras de sabor rotativas** ("Puzzling…", "Marinating…"). Elas trocam a
  cada 7 s sem relação com o que o motor faz. Pela lei "estado real, nunca
  teatro", o rótulo vivo da Frota continua dizendo o que acontece. O que vale
  pegar é o **glifo** (matriz de pontos colorida), não a palavra.
- **Tirar a autoria do fio.** O Zeron tem um agente por conversa e por isso
  pode omitir quem fala. A Frota tem Especialistas e troca de motor na mesma
  conversa, então a autoria é informação. Dá pra **aliviar** (avatar menor,
  hora só no hover, selo só quando muda), mas não remover.
- **GPUI.** O ganho deles é de desenho, não de engine. Tudo acima cabe no
  nosso React.

## Tensões com o guia (decidir antes de codar)

- A pílula de arquivo precisa de altura 22. Ela não é controle (§13), é objeto
  inline, mas **declare isso** no STYLEGUIDE para ninguém "corrigir" para 24.
- Ícones coloridos quebram o "monocromático e quieto" do fio? Proposta:
  **cor só no ícone de arquivo**, porque ele é identidade e não estado. Estado
  continua neutro, com a única exceção da falha. Isso vale uma ADR.
- As três cores do indicador vivo (céu/pêssego/rosa) são as primeiras cores
  decorativas no fio. Se entrarem, entram como token, não como hex solto.
