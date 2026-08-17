# Composer colapsado — A, B e C

Fecha o trabalho que ficou pela metade em `73f1912` (os três mocks entraram, o
README não). Contém: a medição de frequência que decide o que colapsa, a
auditoria dos três mocks contra a linguagem silenciosa (ADR-043 + STYLEGUIDE §2
e §6), a recomendação, o ataque à própria recomendação, o custo de
implementação em `file:line`, e os furos que ficaram abertos.

Escrito em 15/08/2026. **Nada de código de app foi tocado**: as únicas edições
fora deste arquivo estão nos três HTML de `docs/mocks/`, listadas na seção 4.

---

## 0. Antes de tudo: a premissa do briefing está desatualizada

O briefing (e os três mocks) descrevem um composer de **quatro/cinco linhas**,
com `Sem preset · Claude Code · Opus (alias) · medium` ocupando uma linha
própria. Conferido contra o disco, **isso não é mais verdade**:

| Linha | O briefing diz | O que o código faz hoje |
|---|---|---|
| 1 | `EXECUÇÃO · Só lê · Pede · Liberado · Planeja antes` + cadeado + chevron | Confere, mais o anel de contexto e o chip colapsado da identidade (`ExecutionRow.tsx:87-177`) |
| 2 | `Sem preset · Claude Code · Opus (alias) · medium` | **Não renderiza por padrão.** É a prop `identity`, montada só com o chevron aberto: `identityOpen` nasce `false` em `ExecutionRow.tsx:55` e o bloco é condicional em `ExecutionRow.tsx:202` |
| 2b | `Sem preset` | **Nunca renderiza.** O seletor de preset tem guarda de lista vazia (`ComposerParts.tsx:350`) e o banco tem **0 presets cadastrados** |
| 3 | campo de texto | Confere (`CommandConsole.tsx:438`) |
| 4 | `/ comandos` + mic + ✦ + clipe + chevron + enviar | Confere (`ComposerParts.tsx:466-508`) |

Ou seja: **o composer em repouso já são 3 linhas, não 4**, e a linha 2 já está
colapsada atrás de um chevron desde que a `ExecutionRow` nasceu. Isso muda o
tamanho do prêmio: A, B e C não economizam duas linhas, economizam **uma** (a
faixa `EXECUÇÃO`, fundindo-a no rodapé).

Isso não invalida os mocks. O problema que eles atacam continua de pé, só que
ele não é "quatro linhas", é **densidade de alvos com peso igual**: hoje há
**11 alvos** de clique em duas faixas (6 na de execução: 3 do segmented, o
"Planeja antes", o anel, que clica em `ContextRing.tsx:62`, e o chevron da
identidade; 5 no rodapé: mic, ✦, clipe, enviar e o chevron do split), mais
**duas etiquetas mortas** que
ocupam o canto onde o olho entra em cada linha (`EXECUÇÃO`, em caixa-alta,
`ExecutionRow.tsx:92`; e `/ comandos`, `ComposerParts.tsx:466`). É esse o alvo
real.

Duas observações de auditoria no HEAD, fora do escopo dos mocks mas relevantes
pra qualquer implementação:

- **`ExecutionRow.tsx:124` pinta "Só lê" de VERDE** quando selecionado
  (`bg-card text-st-success`). O §2 proíbe verde em estado ambiente permanente
  ("badge/dot 'ok' que fica na tela"), e um modo de permissão selecionado é
  exatamente isso. Os três mocks já corrigem isso por acidente (nenhum tinge o
  "Só lê").
- **`ExecutionRow.tsx:143` pinta "Planeja antes" de brass** quando ligado
  (`bg-brass/15 text-brass ring-1 ring-brass/40`). Está na fronteira do §2
  ("interruptor binário de ajuste segue brass") mas é um `button` com
  `aria-pressed`, não um `Switch`. Os três mocks resolvem isso melhor: descem
  o "Plano antes de executar" pro menu como interruptor de verdade.

---

## 1. A medição de frequência

### 1.1 Fonte e método

**Não existe telemetria neste app.** Verificado: nenhum SDK de analytics,
nenhuma tabela de eventos no SQLite (migrações v1–v35 em `src-tauri/src/lib.rs`
+ as tabelas criadas pelo front em `lib/db.ts`), e nenhuma das ações que troca
esses controles emite log (`setProjectPermissionEverywhere` em
`lib/permission.ts:34`, `setPlanFirst` em `store/chat.ts:2343`, os `onXChange`
de `CommandConsole.tsx:466-489`). Então não dá pra medir **toque** diretamente.

O que dá pra medir é o **rastro**: o banco real do autor,
`~/Library/Application Support/dev.vinicius.mycockpit/mycockpit.db`, lido em
15/08/2026 às 18h. Janela dos dados: **17/07 a 15/08/2026 (30 dias)**.
Universo: **406 turnos** em `turn_costs` (34 conversas, das quais 14 já foram
apagadas), **20 conversas** vivas com **184 mensagens de usuário**, **10
projetos** (5 vivos).

O mock C já trazia uma tabela dessas, medida em 14/08. **Refiz a medição do
zero** e ela se confirma em quase tudo, com duas correções e um dado novo
(marcados abaixo).

### 1.2 A tabela

| Controle | Evidência | Frequência | Qualidade do dado |
|---|---|---|---|
| **campo de texto** | 184 mensagens de usuário em 20 conversas | **1,00 / envio** | medido |
| **enviar / parar** | 406 turnos em `turn_costs` | **1,00 / envio** | medido |
| **anexar** | 33 de 184 mensagens têm `attachments` | **0,18 / envio** (1 a cada 5,6) | medido |
| **modelo** | 5 trocas entre turnos consecutivos, em 406 | **0,012 / turno** | medido (proxy: `turn_costs.model`) |
| **agent** | 3 trocas entre turnos consecutivos, em 406 | **0,007 / turno** | medido (proxy: `turn_costs.agent`) |
| **esforço** | 11 de 20 conversas com `effort` ≠ nulo | ≤ 1 / conversa, e trava no 1º envio | proxy fraco (só o valor final) |
| **preset / persona** | 0 presets cadastrados, 0 conversas com `preset_id` | **0,00** | medido |
| **permissão** | 5 de 5 projetos vivos em `liberado` | **~0 / mês** | medido (ver 1.3) |
| **"Planeja antes"** | nenhum registro em lugar nenhum | ? | **suposição** (ver 1.4) |
| **microfone** | nenhum registro | ? | **suposição** (ver 1.4) |
| **`/` comandos** | 0 de 184 mensagens | **0,00** | medido (ver 1.5) |
| **✦ Especialistas** | 0 presets, 0 uso registrado | ? | **suposição** |

### 1.3 As correções à tabela do mock C

**(a) A troca de modelo é ainda mais rara do que o mock disse, e metade dela
nem é escolha.** O mock C usou "10 de 19 conversas com modelo ≠ padrão" como
proxy — isso mede *distribuição*, não *troca*. A medida certa está em
`turn_costs`, que grava **uma linha por run** com `agent` e `model`
(migração v22, `src-tauri/src/lib.rs:296`; escrita em `lib/db.ts` `recordTurnCost`).
Ordenando por conversa e por tempo:

- **5 trocas de modelo** em 406 turnos consecutivos (1,2%), em 5 de 34 conversas.
- **3 trocas de agent** em 406 (0,7%) — e trocar de agent é handoff com sessão
  nova, não um seletor sendo usado como seletor.
- Das 5 trocas de modelo, **2 são a linha do fornecedor andando**, não
  comparação: `claude-opus-4-8` → `claude-opus-5` com **dias** de intervalo
  (conv `729571c6`: último 4.8 em 31/07, primeiro Opus 5 em 04/08; conv
  `cc3fe875`: 31/07 → 02/08). Isso é o Opus 5 ter saído, não alguém testando
  dois modelos na mesma tarefa.

Ou seja: o argumento de B ("quem abre o menu quer comparar dois eixos") **não
tem nenhum caso no banco**. Zero trocas de modelo dentro de uma mesma sessão de
trabalho.

**(b) O `/` não tem 1 uso, tem 0.** O mock A (nota 2) diz "1 das 181 mensagens
começa com `/` (0,6%)". A mensagem existe, mas é
`/Users/viniciusmachado/Downloads/nu-tali…` — um **caminho colado**, não um
comando. Contando de verdade: **0 de 184**. Isso fortalece a remoção da dica, e
ao mesmo tempo é o dado mais suspeito da tabela (ver §5, furo 2).

**(c) Dado novo: a permissão não está "parada há semanas", está parada em
`liberado`.** Fui à fonte de verdade, não ao cache do SQLite: os
`.mycockpit/config.toml` dos projetos (`lib/permission.ts:34-59` grava nas três
camadas, e o arquivo é o que o Rust lê no spawn). Todos os **5 projetos vivos**
estão em `permission = "liberado"`. Isso tem consequência direta pra
recomendação, e está na §3.2.

### 1.4 O que é suposição, e assumido como tal

- **"Planeja antes"**: não é gravado em lugar nenhum. Vive só em
  `useChat.byId[id].planFirst` (`store/chat.ts:2343`), o store **não tem
  `persist`** e não há coluna pra ele — some no restart. Suponho uso raro pela
  natureza (é modificador de UM envio), mas não tenho dado. **Se ele for muito
  usado, o desenho abaixo erra**, porque ele é o único controle da faixa que é
  por-turno em vez de por-conversa.
- **Microfone**: `settings.dictationEnabled` é `true` por padrão
  (`lib/settings.ts:122`) e tem hotkey global configurável (`alt+Space`,
  `lib/dictationHotkey.ts:72`). Ter atalho global dedicado é o sinal mais forte
  que o repo dá de "isto se usa a sério" — nenhum outro controle do composer
  tem um. Mantido na barra por esse indício, não por medição.
- **✦ Especialistas**: 0 presets, mas o recurso é recente e o mock dele
  (`especialistas.html`) é de 27/07. Uso zero aqui não separa "ninguém quer" de
  "acabou de nascer".

### 1.5 A classificação que decide o colapso

- **A cada envio** (fica na barra, sempre): campo de texto, enviar/parar.
- **1 a cada ~6 envios** (fica): anexar.
- **Sem número, mantido por indício** (fica): microfone.
- **No máximo 1 vez por conversa, e trava depois disso** (colapsa): agent,
  modelo, esforço. A trava não é suposição, é código: `locked =
  hasExecutorTurn(conv.items)` (`CommandConsole.tsx:152`), com uma única saída
  de emergência (o modelo destrava depois de um turno que falhou,
  `CommandConsole.tsx:156-157`).
- **~0 vezes por mês** (colapsa): permissão.
- **Zero** (sai): preset (nem renderiza), dica `/ comandos`, etiqueta
  `EXECUÇÃO`.

---

## 2. O seletor de modelo: quatro seletores e uma palavra que vazou

Ponto levantado pelo Vinícius, e ele tem razão nos dois lados.

### 2.1 Não são quatro, são três — e um deles é invisível

`Sem preset` **não renderiza** (guarda de lista vazia, `ComposerParts.tsx:350`,
+ 0 presets no banco). Restam agent, modelo e esforço. Os três travam juntos no
1º envio e não mudam durante a conversa (medido: 1,2% e 0,7% de troca entre
turnos). São **estado exibido**, não controle usado, e estão ocupando espaço de
controle.

### 2.2 "Opus (alias)"

Vem de `lib/curatedModels.ts:36`:

```ts
{ value: "opus", label: "Opus (alias)", description: "O CLI decide a versão (hoje → Opus 5), pode divergir" }
```

O texto entra na tela por dois caminhos: no gatilho do seletor
(`RichSelect.tsx:80` imprime `pill ?? label`, e as opções alias não têm `pill`)
e no chip colapsado da identidade (`CommandConsole.tsx:262-272`, mesmo
`pill ?? label`).

**A distinção que ele codifica é real e importante**, não é jargão gratuito:
`opus` é um ponteiro que o servidor resolve e que **muda sozinho**
(`curatedModels.ts:23-29` documenta: já resolveu pra 4.7, depois 4.8, hoje Opus
5), enquanto `claude-opus-5[1m]` é um pin. O app leva isso a sério a ponto de
ter `aliasShiftNotice` (`lib/modelResolution.ts:99`) pra avisar quando o alias
escorregou entre sessões. Apagar a palavra apagaria uma verdade.

**O erro não é dizer, é onde se diz.** "(alias)" é vocabulário de quem
construiu o resolvedor, impresso no lugar de menor espaço e maior frequência de
leitura da tela: o letreiro em repouso. E não é hipotético — **5 das 20
conversas do banco têm `req_model = "opus"`**, então 25% das conversas exibem
"Opus (alias)" permanentemente. O default de fábrica é o **pin**
(`settings.ts:118` = `claude-opus-5[1m]`), então quem vê isso escolheu, mas
escolheu num menu que só explica a diferença na descrição.

**Proposta** (cabe em qualquer uma das três direções):

1. O **letreiro em repouso mostra o modelo RESOLVIDO**, não o pedido. O dado já
   existe e já é persistido: `conversations.model` (migração v24,
   `src-tauri/src/lib.rs:312`) é o que a CLI reportou. Quem escolheu "opus" lê
   "Opus 5", que é o que de fato rodou. Antes do 1º turno não há resolvido, e
   aí o letreiro mostra o pedido — degradação honesta, sem inventar.
2. A palavra "alias" **desce pro menu**, onde a escolha acontece, como badge de
   opção em vez de sufixo do nome: `Opus` + badge `acompanha o CLI` × `Opus 5` +
   badge `versão fixa`. Badge de opção é cinza (§2: "brass não pinta
   METADADO").
3. **Segundo vazamento, no mesmo lugar**: o esforço não escolhido imprime a
   palavra **"effort"** no gatilho (`curatedModels.ts:55`, `pill: "effort"`,
   renderizado por `RichSelect.tsx:80`). Numa UI pt-BR, dentro do composer, é
   inglês solto. O chip colapsado escapa disso porque filtra `"default"`
   (`CommandConsole.tsx:262-272`), mas o seletor expandido não. Deveria ser
   "Padrão", como o do modelo.

---

## 3. Auditoria: os mocks contra a linguagem silenciosa

Os três são de **14/08**, escritos com os tokens de `index.css` copiados à mão
("cópia fiel", diz o comentário no topo de cada um). A cópia é de antes das
Fases 4–6 do ADR-043. Verificado no navegador (servidor local, Chromium,
1440×1000), **nos dois temas e nos cinco estados** de cada mock.

### 3.1 O que estava obsoleto (nos TRÊS, idêntico)

| # | Achado | Regra violada |
|---|---|---|
| 1 | Os tokens `--sel` e `--sel-hover` **não existiam** nos mocks. Sem eles, não havia como escrever a receita de seleção. | §2 ("a receita é CÓDIGO"): `index.css:39-40` e `:110-111` |
| 2 | **O ✓ que marca o modo de permissão vigente era brass** (`.pmenu .mk` / `.panel .mk` = `color:var(--brass)`). É literalmente "brass marcando item escolhido em lista". | §2, coluna "NÃO use para" do brass; ADR-043 decisão 1 |
| 3 | `.rail .it.on{background:var(--accent)}` — a conversa selecionada usava o token de **hover** como token de **seleção**, sem peso 500 e sem pip. | ADR-043 decisão 1 (`--sel` + peso + pip); `ConversationList.tsx:297-332` |
| 4 | `.menu .row:hover` e `.menu .row.sel` eram **o mesmo `--accent`** — hover e seleção com o mesmo pixel, exatamente o que as duas opacidades existem pra evitar. | §2 ("hover é convite, seleção é fato") |
| 5 | O "rodando" na sidebar era um **ponto azul estático de 5px no gutter**. Duas coisas erradas: o gutter é da seleção (o estado mora no slot direito) e o ponto azul parado foi a opção que a decisão 3 rejeitou e que o build 205 substituiu pelo `.conv-spin`. | ADR-043 decisões 2 e 3 + revisão do build 205; §6 |
| 6 | `.rail{border-right:1px solid var(--border)}` — a sidebar do app não tem borda (`Sidebar.tsx:812` é só `bg-rail`); o vão é o divisor. | ADR-043 Fase 2 ("sem divisor gratuito") |
| 7 | A prosa dos três dizia: *"o fundo é hover, e só hover, então 'onde está meu ponteiro' e 'qual está valendo' nunca disputam o mesmo pixel"*. Era uma solução legítima **antes** do ADR-043; hoje contradiz a receita, que resolve o mesmo problema com duas opacidades do mesmo neutro. | §2 |

**Nenhum dos três mocks fica inviável sob a linguagem nova.** Os sete achados
são cosméticos ou de cromo lateral (sidebar, menus), e nenhum toca a tese de
nenhuma das direções. O que muda de fato é o argumento de C (abaixo).

### 3.2 O que a linguagem nova quebra no ARGUMENTO, não no pixel

Este é o achado que importa, e não se corrige editando CSS.

O mock **C, nota 4**, e o mock **A, nota 5**, apoiam o colapso da permissão no
clima ambiente: *"colapsar a permissão a um letreiro só é aceitável porque o
modo perigoso agora acende a tela inteira. Sem o clima, esta direção seria
irresponsável."*

Medido: **os 5 projetos vivos estão em `liberado`** (confirmado no
`.mycockpit/config.toml` de cada um, que é a verdade que o Rust lê, não o cache
do SQLite). Logo a moldura âmbar está **sempre acesa** neste uso. E o §2 diz,
sobre o próprio clima:

> **Autolimitado**: só o modo perigoso acende. Não existe clima de "Só lê" nem
> de "Pede" — **sinal que acende sempre não é sinal.**

O clima foi desenhado autolimitado supondo que o modo perigoso é a exceção. No
único uso real que existe, ele é a regra. **Então o clima não pode ser o
fiador do colapso da permissão.** Isso não mata as direções: A e C mantêm o
âmbar no próprio chip/letreiro do composer, que continua dizendo o modo na
faixa onde você despacha. O que morre é o argumento "pode esconder porque a
tela inteira avisa" — a tela inteira avisa o tempo todo, e por isso não avisa.

Consequência prática pra implementação: **o letreiro/chip do modo perigoso é
obrigatório e não pode truncar**, o que os três mocks já dizem (A nota 5, C
nota 2). Ele deixa de ser redundância elegante e passa a ser o sinal primário.

### 3.3 O que auditei e decidi NÃO mexer

- **O brass do cromo do próprio mock** (`.mockbar .tag`, `nav a.on`): é a
  navegação A/B/C da página de mock, não é UI do app. Os mocks irmãos fazem
  igual.
- **O brass do chip de identidade no estado de erro** (`.chip.hot` /
  `.ctrl.hot` / `.state.hot`): aqui brass está certo. É o **gesto** que resolve
  a decisão pendente, e o ADR-043 (bloco de 16/08) diz explicitamente que
  dentro de uma superfície de atenção "o botão primário continua brass: é isso
  que separa o que está esperando do que você clica". A superfície âmbar em
  volta é a nota de 11px (`.note.warnt`), que já está âmbar nos três.
- **O anel brass de foco no cartão** (`.st-digitando .card`): `--ring` **é**
  `--brass` por alias explícito (`index.css`), foco é gesto. Correto.
- **Os divisores dentro dos menus** (`.pmenu .sep`, `.panel .sp`): separam
  escolha exclusiva de modificador, é semântico, não gratuito. O §4/ADR-043
  Fase 2 mata divisor de layout, não separador de grupo em menu.
- **O orçamento de tinta no estado de erro** está no teto, não acima: âmbar (a
  nota) + vermelho (contexto 86%) = 2 cores de status, com brass e cinza fora
  da conta. Passa no §2, mas sem folga: qualquer terceira cor ali reprova.

### 3.4 Correções aplicadas (nos três arquivos)

Aplicadas com substituição exata e contagem conferida (o script aborta se o
alvo não bater), depois re-verificadas no navegador nos dois temas:

1. Adicionados `--sel` / `--sel-hover` nos dois blocos de tema, com os valores
   de `index.css:39-40` e `:110-111`.
2. `.pmenu .mk` / `.panel .mk`: brass → `var(--foreground)`. **A forma (✓) diz
   "escolha exclusiva"; a cor não diz nada.**
3. `.pmenu .row.sel` / `.panel .row.sel` (classe nova, aplicada na linha "Pede
   antes de mudar"): `background:var(--sel)` + peso 500. Os títulos das outras
   linhas caíram de 500 pra 400, pra que o peso volte a ser diferença.
4. `.pmenu .row:hover` / `.panel .row:hover` / `.panel .pick:hover`: `--accent`
   → `--sel-hover`.
5. `.menu .row` (o dropdown de modelo): hover → `--sel-hover`, selecionado →
   `--sel` + peso 500. Eram o mesmo token.
6. `.rail .it.on`: `--accent` → `--sel` + peso 500 + **pip neutro de 3px em
   x=5** (`::before`), a receita do `ConversationList.tsx:330-332`.
7. `.rail .it .d` (ponto azul no gutter) → `.rail .it .spin`: anel de 11px no
   **slot direito**, com `@keyframes conv-spin` e a degradação obrigatória de
   `prefers-reduced-motion` copiada de `index.css:376-385` (vira o mesmo ponto
   sólido, não some).
8. `.rail`: removido o `border-right`.
9. **Prosa**: as três legendas que explicavam "fundo é hover e só hover" foram
   reescritas pra receita atual, e os comentários de CSS junto.
10. Só no A: `<span style="color:var(--brass)">Opus 5</span>` dentro do chip de
    erro → `font-weight:500` (o chip já é brass inteiro; a tinta extra estava
    pintando o nome do modelo, que é metadado — §2). Alinha com o C, que já
    usava peso.

Verificação final: A, B e C renderizados nos dois temas, `computed style`
conferido (`--sel` chegando como `rgba(255,255,255,.067)` no escuro, ✓ em
`rgb(231,232,234)`, `border-right: 0px`, pip de 3px, `.spin` presente).

---

## 4. Recomendação

**Nenhuma das três, como está. Recomendo uma composição: o colapso do C, o anel
do A, e o ⌘. do C rebaixado de requisito a atalho opcional.**

### 4.1 Por que não A

A junta os controles em **dois** chips (permissão · identidade). A medição diz
que esses dois assuntos têm frequências parecidas e igualmente próximas de
zero (~0/mês e ≤1/conversa). Dois chips pra duas coisas que ninguém toca é um
chip a mais: são dois alvos permanentes, dois menus pra manter e duas gramáticas
pra decidir (o de permissão é radiogroup de 3, o de identidade é 3 seletores
encadeados), quando a pergunta que os dois respondem é uma só, "como o próximo
turno vai rodar". C junta isso numa superfície e num gesto.

Correção a um argumento que eu ia usar e não se sustenta: **a permissão não
mora em dois lugares.** Ela já saiu do painel de contexto, e o
`ContextPanel.tsx:527-530` documenta a mudança ("Permissões MUDARAM DE CASA…
Ficavam aqui"). Não há divergência de casa a matar; A não paga esse preço.

A é, porém, **a mais barata** e a que menos aposta. Se a escolha for "menor
risco", é ela.

### 4.2 Por que não B — e este é um veto medido, não uma preferência

B é a mais elegante das três no papel: nada some, só muda o peso. O repouso é
uma frase cinza; o foco no campo acorda os quatro seletores.

**O estado calmo do B é inalcançável no app real.** O `submit()` do composer
chama `focusComposer()` nos dois caminhos de envio —
`CommandConsole.tsx:329` (enfileirar com turno rodando) e
`CommandConsole.tsx:337` (envio normal). O campo **mantém o foco depois de cada
mensagem**. Como o traje "acordado" do B é disparado por foco no campo, na
prática ele fica acordado desde o primeiro envio até você clicar em outro
lugar. B degenera na UI de hoje, mais uma máquina de estados nova pra manter.

Sair disso exige tirar o refoco do envio, o que quebra o fluxo "digita, envia,
digita" que é o modo dominante de uso (184 mensagens em 20 conversas). Não vale.

Vale registrar o que B tem de melhor e que eu roubo: **a exceção da decisão
pendente** (nota 6) — o que quebrou não se esconde, e o modelo acorda sozinho
depois de um turno falhado, sem depender de foco. Isso é o §5 camada 2 do
STYLEGUIDE e deve valer na direção vencedora também. O código pra isso já
existe (`lastExecutorTurnFailed`, `CommandConsole.tsx:156`).

### 4.3 Por que não C inteiro

C acerta o colapso: quatro alvos permanentes, um letreiro que é leitura e
porta, um painel só pros dois assuntos. A medição sustenta cada linha do
veredito dele.

Dois problemas.

**(a) O anel de contexto não devia descer pra faixa de status.** O próprio mock
chama isso de "a decisão mais discutível das três" (nota 7) e dá o motivo:
custo e uso são **passado acumulado** (ambiente), contexto é **prospectivo**
(quanto cabe no próximo turno). A faixa de status responde "como está o
ambiente"; o composer responde "o que vai acontecer quando eu apertar enviar".
São perguntas diferentes. Além disso `STATUS_BAR_KINDS` é uma lista fechada de
três (`lib/statusBar.ts:25`), fechada de propósito, e abri-la por um medidor
que fala do futuro é o tipo de exceção que vira precedente.

**(b) O argumento de segurança dele caiu** (§3.2): o clima está sempre aceso,
então não é ele que autoriza esconder a permissão. C sobrevive porque o
letreiro âmbar fica na barra de qualquer jeito, mas a nota 4 precisa ser
reescrita antes de virar plano.

### 4.4 A composição

Em repouso, uma faixa só sob o campo, com **cinco alvos**:

```
[clipe] [mic]  ································  [Pede antes de mudar ⌘.] [anel] [⌄] [↑]
```

- **Fica na barra**: clipe (0,18/envio), mic (indício do hotkey global),
  letreiro de estado (leitura + porta), anel de contexto, chevron de destino,
  enviar/parar.
- **Colapsa no painel** (um gesto, uma superfície): permissão, "Plano antes de
  executar" (como interruptor), agent, modelo, esforço. É o painel do C,
  literalmente — ele já está desenhado e já separa "o próximo turno" de "quem
  roda".
- **Sai**: a etiqueta `EXECUÇÃO` (nomeia a faixa em que ela mesma está), a dica
  `/ comandos` (0 usos medidos), e o seletor de preset (já não renderiza).
- **Sobe de volta pro composer quando vira decisão**, e só nesses dois casos:
  o modelo depois de um turno falhado (`lib/turnOutcome.ts`, já existe) e o
  anel quando passa de 80% (a régua do `lib/meter.ts`, já existe).
- **O letreiro nunca trunca** e mantém o âmbar + triângulo em "Muda sem pedir".
  Sob pressão de largura quem cede é qualquer outra coisa.
- **O ⌘. é bem-vindo mas não é requisito**: o letreiro clica, essa é a porta.
  Ver o custo real em §6.

Custo em cliques, honesto:

| Gesto | Hoje | Depois |
|---|---|---|
| trocar a permissão | 1 clique (segmented) | 2 (letreiro → linha) |
| trocar modelo/agent/esforço | 2 (chevron → seletor → opção = 3, na real) | 2 (letreiro → seletor → opção = 3) |
| ligar "Planeja antes" | 1 | 2 |
| enviar, anexar, ditar | igual | igual |

O único gesto que fica mais caro de verdade é a permissão (+1 clique, ~0 vezes
por mês medido) e o "Planeja antes" (+1 clique, **frequência desconhecida** —
é o risco assumido, e está listado como furo).

---

## 5. Segunda opinião: o ataque à recomendação acima

Escrito contra mim mesmo. Se algum destes cinco pontos convencer, a
recomendação cai.

**1. A medição inteira é de um usuário, e é o pior usuário possível pra esta
pergunta.** É o autor do app, em 5 projetos todos em `liberado`, com 0 presets
e 0 comandos de barra. Ele não toca a permissão porque **já decidiu confiar** —
o que é o oposto do comprador no primeiro dia, que abre o app, não confia em
nada, e vai querer "Só lê" à mão antes da primeira auditoria. Colapsar a
permissão encarece exatamente o gesto do usuário que mais precisa se sentir no
controle, medindo em cima de quem já passou dessa fase. Num app de compra única
sem onboarding contínuo, a primeira hora é desproporcionalmente cara.

**2. Eu medi ESCRITA e concluí sobre LEITURA. É o buraco do método.** O banco
registra troca; não registra olhada. Toda linha "colapsa" da tabela é um
veredito sobre quantas vezes o controle é **mexido**, aplicado a controles cujo
trabalho principal pode ser **ser lido**. O segmented de três posições se lê
pela posição, sem ler a palavra; o letreiro exige leitura. Se o valor da faixa
`EXECUÇÃO` é "eu passo o olho e sei em que modo estou", minha medição não
enxerga nada disso e minha recomendação destrói justamente isso. E não há como
medir sem instrumentar (§6).

**3. Tirar a dica `/ comandos` porque ela tem 0 usos é raciocínio circular.**
Zero uso com a dica na tela pode significar "o recurso não serve" ou "a dica
não funciona". Removendo, garanto zero pra sempre e nunca saberei qual das duas
era. O mesmo vale, com mais força, pro ✦ de Especialistas: o recurso tem duas
semanas de vida e eu estou usando "ninguém usou" como evidência contra ele.

**4. O anel que eu insisto em manter é invisível.** Nos dois temas, nos
screenshots, ele é um arco cinza de 17px que ninguém lê abaixo de 60% — que é
onde ele passa a maior parte do tempo (43% na cena de repouso dos mocks). Eu
defendo mantê-lo no composer por um princípio bonito ("prospectivo mora onde se
decide") enquanto ele renderiza como uma mancha. A posição intelectualmente
consistente com minha própria tabela é a do C: se não é lido, desce; e se subir
de 80% ele volta gritando, que é a regra do `meter.ts` que eu mesmo citei.
Mantenho a recomendação, mas **este é o ponto em que eu estou mais perto de
estar errado do que certo**.

**5. Rebaixar o ⌘. de requisito a "bem-vindo" enfraquece a própria promessa.**
O trunfo do C é "sete controles viram **um gesto**". Sem atalho, o gesto é um
clique num alvo de 13px na barra — melhor que hoje, mas não é o salto que
justifica o custo de reescrever a faixa. E a razão de eu rebaixar é fraca: não
existe registro central de atalhos no app pra checar colisão (o único
`metaKey` global é o ⌘K do `CommandMenu.tsx:89`; o resto são
`window.addEventListener("keydown")` avulsos em 7 arquivos). "É difícil
auditar" não é motivo pra não fazer, é motivo pra fazer o registro.

**Um sexto, contra o colapso como um todo:** se o número real de linhas hoje é
3 e não 4 (§0), o prêmio inteiro desta frente é **uma linha** e a remoção de
duas etiquetas mortas. Um refactor que toca 5 arquivos, mexe na faixa de maior
risco do app (a que diz se o agente pode executar comando na sua máquina) e
paga uma linha de altura — é defensável, mas não é óbvio. **Se alguém quiser
apenas o ganho barato**: apagar `EXECUÇÃO` (`ExecutionRow.tsx:92`) e
`/ comandos` (`ComposerParts.tsx:466`) recupera os dois cantos onde o olho
entra, custa duas linhas de diff e zero risco. Isso é ~40% do valor percebido
por ~2% do custo.

---

## 6. O que quebra: arquivos e sítios

Conferido contra o disco em 15/08/2026. **Aviso**: `CommandConsole.tsx`,
`ComposerParts.tsx` e `LexicalComposer.tsx` têm mudanças não commitadas de
outra frente na árvore; os números abaixo são do disco, não do commit.

### Toca com certeza

| Arquivo | Sítios | O que acontece |
|---|---|---|
| `app/src/components/chat/ExecutionRow.tsx` (209 linhas) | o componente inteiro | Deixa de ser uma faixa e vira o letreiro + o painel. Some o `EXECUÇÃO` (`:92`), some o segmented de 3 (`:96-133`), o "Planeja antes" vira interruptor de menu (`:135-148`), o `identityOpen` local (`:55`) e o bloco condicional (`:202-206`) deixam de existir |
| `app/src/components/chat/ComposerParts.tsx` (683 linhas) | `IdentityControls` (`:260-423`), `ComposerActions` (`:433-511`) | Os seletores migram pro painel; sai a dica `/ comandos` (`:466-469`). **Atenção à catraca**: o teto de `.tsx` é 700 (`scripts/lints/file-size-baseline.json`) e o arquivo está em 683. **Sobram 17 linhas.** O painel novo tem que nascer em arquivo próprio |
| `app/src/components/chat/CommandConsole.tsx` (551 linhas) | `:436-516` (a montagem), `:262-272` (`identityLabel`), `:152-167` (`locked` / `modelUnlocked` / `effective*`) | A fiação. O `identityLabel` muda pra usar o modelo resolvido (§2.3) |
| `app/src/components/chat/ComposerShell.tsx` (77 linhas) | `:64-75` | O slot `header` pode ficar vazio. Ou some, ou passa a ser opcional de verdade |
| `app/src/lib/permission.ts` | `:7-11` (`PERMISSION_LABEL`) | Os rótulos curtos ("Só lê" / "Pede" / "Liberado") ganham as formas longas do menu ("Pede antes de mudar", "Muda sem pedir"). **Cuidado**: "Liberado" é vocabulário canônico do §7 do STYLEGUIDE e não pode virar outra coisa sem ADR. O menu pode ter título longo com o canônico curto no letreiro |
| `app/src/lib/selection.ts` | import novo | O painel novo **importa** `SELECTED_FILL`/`UNSELECTED`; não recalcula (§2: "superfície nova IMPORTA") |
| `app/src/lib/attention.ts` | import novo | A superfície de decisão pendente (turno falhado) usa `PENDING_DECISION`, não uma quarta receita |

### Toca dependendo da variante escolhida

| Arquivo | Sítios | Quando |
|---|---|---|
| `app/src/components/chat/ContextRing.tsx` (169 linhas) + `app/src/lib/statusBar.ts:25` | 1 + 1 | Só se o anel descer pra faixa de status (a variante do C que eu **não** recomendo). `STATUS_BAR_KINDS` é fechada em 3 |
| um handler de teclado novo | 1 | Se o ⌘. entrar. Não há registro central: o único `metaKey` global é `components/common/CommandMenu.tsx:89`; os demais são `window.addEventListener("keydown")` avulsos em `SettingsDialog.tsx:101`, `MicButton.tsx:141`, `Lightbox.tsx:63`, `TrayPopover.tsx:201`, `DecisionStrip.tsx:180`, `OnboardingWizard.tsx:208`, `lib/dictationHotkey.ts:345`. Colisão só se descobre lendo os sete |
| `app/src/lib/curatedModels.ts` | `:36`, `:37`, `:55` | Se a proposta do §2.3 entrar (tirar "(alias)" do `label` e "effort" do `pill`) |

### Testes que sentem

- `app/src/lib/permission.test.ts` — se `PERMISSION_LABEL` mudar.
- `app/src/lib/fleet/send.test.ts` — toca `planFirst` no caminho da mesa.
- **Não há teste de componente pro composer.** Nem `ExecutionRow`, nem
  `ComposerParts`, nem `CommandConsole` têm arquivo `.test.tsx`, e nenhum dos 6
  specs de `app/e2e/` abre o composer. Um refactor desse tamanho na faixa que
  decide permissão de execução, sem rede: **isso é o furo maior desta frente**,
  e vale mais que o redesenho.

### O que NÃO muda (e é bom que não mude)

Nenhuma migração de banco. Nenhum dado novo. O escopo de cada controle
(permissão = projeto, em 3 camadas, `lib/permission.ts:34-59`; identidade =
conversa, colunas v10/v11/v12/v24/v25/v26) continua exatamente igual. A trava
no 1º envio continua derivada do histórico (`hasExecutorTurn`), não persistida.
É um refactor de superfície, e essa é a melhor notícia do orçamento.

---

## 7. Furos que eu não fechei

1. **"Planeja antes" não tem nenhuma medição, e é o único controle da faixa que
   é por-turno.** Ele nem persiste (`store/chat.ts:2343`, store sem `persist`,
   sem coluna). Se ele for muito usado, colocá-lo dentro do painel é o erro
   mais caro do desenho, porque um modificador por-turno atrás de dois cliques
   é pior que hoje. Não sei, e chutei que é raro.
2. **`/` com 0 usos pode ser efeito da dica, não causa.** Não consigo separar
   "recurso inútil" de "descoberta quebrada" sem instrumentar (§5, ponto 3).
3. **Não medi leitura, só escrita.** É o furo estrutural (§5, ponto 2). Fechar
   exige um estudo com o usuário na frente da tela, não SQL.
4. **A comparação com o zcode.z.ai não foi verificada.** Os mocks A e C afirmam
   "quatro alvos contra os seis deles" e "comparável item a item"; não há nada
   no repo que documente a anatomia do composer do zcode
   (`docs/competitors-maestri.md` é sobre outro produto e não fala de composer).
   Não confirmei nem desmenti — **repeti nada dessas afirmações na
   recomendação**, e elas seguem sem fonte nos mocks.
5. **O clima ambiente ficou com um problema aberto que não é meu.** §3.2 mostra
   que a moldura do "Liberado" está permanentemente acesa no único uso real, o
   que contradiz o "autolimitado" do §2. Isso é uma frente própria (ou um bloco
   novo no ADR do clima), não um ajuste de composer. Deixei registrado, não
   resolvi.
6. **Medi largura pela metade.** A 900px de janela, a barra do A tem 611px e os
   dois chips medem 153px ("⚠ Muda sem pedir") + 213px ("Claude Code · Opus 5 ·
   xhigh") = 366px: **não trunca**, e a preocupação da nota "−3" do mock A não
   se confirma nessa largura. O que eu **não** testei é o caso que a nota
   descreve de verdade, o painel de contexto aberto ao mesmo tempo, que os
   mocks não modelam. Também não testei o B nem o C em estreito.
7. **O verde do "Só lê"** (`ExecutionRow.tsx:124`) e o **brass do "Planeja
   antes"** (`:143`) são desvios do §2 que existem no HEAD hoje. Apontei; não
   toquei, porque o briefing proíbe mexer no app e porque os dois somem se o
   redesenho acontecer.
8. **A degradação de `prefers-reduced-motion` foi verificada pelo CSSOM, não
   pelos olhos.** Confirmei no navegador que a regra existe, casa e resolve
   (`(prefers-reduced-motion: reduce)` → `.rail .it .spin` com `animation:none`,
   6px, `background:var(--st-running)`), o que prova que ela parseou e vale.
   Não vi o resultado com a preferência ligada de verdade no sistema.
