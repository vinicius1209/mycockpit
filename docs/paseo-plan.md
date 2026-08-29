# A fila do Paseo — doutrina, mecanismo, feature

> Plano de execução do que `docs/competitors-paseo.md` abriu. Uma frente por
> vez, especificada antes de codificada.
>
> **A ordem não é por custo, é por dependência.** Doutrina primeiro, porque ela
> é a régua com que as próximas são medidas; mecanismo depois, porque feature
> construída sem mecanismo vira caso especial; feature por último.

## Por que esta ordem

Ontem o painel de processos nasceu `dialog` porque copiou o `WorktreesDialog`,
enquanto o `UsagePill` subia painel ancorado. Não foi desatenção: **não havia
régua para consultar**. Fazer PA1 (adotar sessão) antes de PA2 (tabela de
superfícies) repetiria o mesmo erro num lugar novo.

| Camada | Frentes | O que ela entrega |
|---|---|---|
| **Doutrina** | D1 · D2 · D3 | a régua, e a guarda que a mantém |
| **Mecanismo** | X1 · X2 | o que faz feature nova não virar caso especial |
| **Feature** | F1 · F2 | tela nova, medida pelas duas camadas acima |

## A fila

| # | frente | origem | estado |
|---|---|---|---|
| **D1** | Tabela de superfícies + primitiva `ui/popover.tsx` | PA2 | **feito** (§12, build 311) |
| **D2** | Geometria de controle fechada, com guarda | PA3 | **feito** (§13, build 314) |
| **D3** | Alinhamento óptico e a regra de borda afiada | lacunas 3 e 4 | **feito** (§14 + §4, build 315) |
| **X1** | `isAvailable()` antes de oferecer motor | PA9 | **feito** (build 316) |
| **X2** | Sentinela `{{{prompt}}}` no registry | PA7 | **próxima** |
| **F1** | Adotar sessão externa | PA1 | a fazer |
| **F2** | Espelho headless do terminal (destrava o M1 da margem) | PA8 | a fazer |

Depois da fila, e só depois: PA4 (provider ACP por config), PA5 (capacidades do
app como skill), PA6 (os presentes do B2.3, que dependem do B2.3 existir).

---

## D1 — A tabela de superfícies

### O defeito, medido

Não é importado do Paseo. Está no nosso código:

| superfície | gesto | primitiva usada | de onde vem |
|---|---|---|---|
| gaveta de notas | painel ancorado no chip | **`radix-ui` cru** (`StickyNotesTrigger.tsx:13`) | não existe `ui/popover` |
| painel da faixa | painel ancorado no item | **`ui/dropdown-menu`** (`statusBarChrome.tsx:60`) | copiou o menu por proximidade |

Mesmo gesto, duas gramáticas, e uma delas **fura a camada de primitivas** — que
é justamente o que o §11 proíbe para menu de contexto ("uma primitiva só") e
nunca foi escrito para o resto.

O custo não é estético. O `PainelDaFaixa` precisa desarmar o foco de menu
(`onCloseAutoFocus` prevenido, `statusBarChrome.tsx:70`) porque um painel de
dados está vestido de lista de comandos: `DropdownMenu` traz roving tabindex e
typeahead, que um painel com linhas de dados e botões não quer. É contorno de
sintoma; a causa é a primitiva errada.

Inventário do que existe hoje (arquivos que importam cada primitiva):

`ui/dialog` 12 · `ui/dropdown-menu` 10 · `ui/RichSelect` 9 · `ui/app-dialog` 6 ·
`ui/context-menu` 6 · `ui/select` 3 · `ui/tooltip` 3 · `ui/command` 2 ·
`ui/PillSelect` 2 · `common/confirm` 1 · **`ui/popover` 0 (não existe)**

### O alvo

1. **§12 novo no STYLEGUIDE: "Qual superfície usar".** Uma tabela com critério
   decidível (interrompe ou não? quantas opções? precisa buscar? ancora em quê?)
   e uma linha de exemplos, no idioma do guia.
2. **`components/ui/popover.tsx`**, a primitiva que falta: E2, constantes
   compartilhadas, sem semântica de menu.
3. **Convergir as duas superfícies divergentes** para ela.
4. **Guarda** `scripts/check-superficies.mjs`: `radix-ui` cru fora de
   `components/ui/` é erro, e menu-como-painel é erro nomeado.

### Definição de pronto — cumprida em 29/08/2026

- `§12` escrito, com a tabela e o critério, e citado na rubrica do `§8`. ✓
- `ui/popover.tsx` existe e é a única porta para painel ancorado. ✓
- `StickyNotesTrigger`, `PainelDaFaixa` e `UsagePill` usam a mesma primitiva. ✓
- O `onCloseAutoFocus` saiu dos dois lugares, com o motivo escrito: o anel já é
  resolvido no app inteiro por `lib/modalidade.ts` (§2.1), então era remédio
  local para doença curada, e custava a devolução de foco que o teclado precisa. ✓
- Guarda `scripts/check-primitivas.mjs` no `bun run check`, com teste vitest ao
  lado usando o código REAL removido como fixture. ✓
- `bun run check` 11/11 · `tsc -b` limpo · 3472 testes (+7) · build 311. ✓

### O que a frente achou de quebra

1. **A guarda da faixa tinha um escape que legitimava a divergência.** Ela
   aceitava "usa o chrome OU repete a geometria dele", e o `UsagePill` morava
   nessa fresta, recriando cabeçalho, geometria e rodapé por fora. A diferença
   real era só `side`/`align`; virou parâmetro, e a guarda perdeu o "ou".
2. **A CI rodava `tsc --noEmit` enquanto o build roda `tsc -b`.** É a fresta por
   onde já passou um erro (`node:fs` num teste). Corrigida para `tsc -b --force`.
3. **O §10 do guia dizia "sete scripts" e listava seis, com onze no
   `package.json`.** A tabela agora tem as onze linhas.

---

## D2 — Geometria de controle

### O defeito, medido
**43 combinações distintas** de altura/padding/fonte em 75 arquivos. E a
surpresa: o app já havia convergido numa escada de 4px sem saber. `px-2.5 py-1`
(39×), `px-2 py-1.5` (17×), `px-3 py-1.5` (16×) e `px-2 py-1` (13×) dão 24, 28 e
32px de altura final. Faltava o nome, não a régua.

Do lado do `<Button>`: 3 degraus mortos (`lg` 4 usos, `icon` e `icon-lg` zero) e
o de 28px, o mais escrito à mão, não existia. **89 arquivos escrevem `<button>`
à mão; 34 importam `<Button>`** — daí a escada precisar de duas portas.

### Definição de pronto — cumprida em 29/08/2026
- §13 com quatro degraus nomeados por PAPEL, não por camiseta. ✓
- `components/ui/controle.ts` como fonte única, e `button.tsx` derivando dela. ✓
- 99 call sites migrados; o tipo-união do `size` cobrou cada um. ✓
- `controle()` como segunda porta, pro botão à mão. ✓
- Catraca `check-geometria-de-controle.mjs`: 182 controles em 70 arquivos
  congelados, só desce, arquivo novo nasce em zero. ✓
- `check` 12/12 · `tsc -b` limpo · 3481 testes · build 314. ✓

### O que a frente achou de quebra
1. **A base do `<Button>` tinha `text-sm` (14px)**, e o §3 diz que botão é corpo
   de UI, 13px. Os 143 botões do app estavam 1px acima da escala, e ninguém via
   porque a violação morava dentro de `components/ui/`, fora do alcance da
   guarda de tipografia. Agora a fonte vem do degrau.
2. **`gap`, `rounded` e `text-` viviam na base E no degrau**, sobrevivendo só
   pela ordem do twMerge. Classe que só existe por ordem de merge é classe que
   ninguém consegue ler; saíram da base.
3. **O codemod foi ganancioso** e renomeou o `size` de `AppDialog` e
   `SelectTrigger` junto. O `tsc -b` cobrou os oito, um por um. Escala com tipo
   fechado é o que torna renomear em massa seguro.

## D3 — Alinhamento e borda

### O defeito, medido
A metade da BORDA acabou sendo mensurável, ao contrário do que este esboço
previa: **14 cores de borda distintas** em `app/src`, sendo **oito opacidades da
mesma cor** (/30 /40 /45 /50 /55 /60 /70 /80). Ninguém escolheu oito degraus,
cada um escolheu o que estava perto.

Separando por USO, os oito viram dois papéis limpos: `border-t`/`border-l`
(divisor interno) usa /30 /40 /45, e o contorno de superfície usa /50 a /80. E o
app já tinha um vencedor por larga margem no segundo, `border` cheia com 327
usos, que é exatamente a receita que o §4 escreveu. **É a terceira vez seguida
que o app convergiu e a doutrina não percebeu** (a escada de 4px na D2, a
primitiva ausente na D1).

### Definição de pronto — cumprida em 29/08/2026
- §4 ganhou o set fechado do filete (aresta e divisor, só) e o teste de borda
  afiado: *"borda de coisa única está errada"*. ✓
- §14 novo: alinhamento pelo glifo, trilhos vindos do conteúdo, área de clique
  crescendo pra fora, ajuste óptico declarado como óptico. ✓
- Catraca `check-filete.mjs`: 132 filetes fora do set em 50 arquivos, e a saída
  NOMEIA cada token a migrar, não só a contagem. ✓
- Seis arquivos desta sessão já migrados, apertando a catraca de saída. ✓
- `check` 13/13 · `tsc -b` limpo · 3488 testes · build 315. ✓

### A parte que NÃO ganhou guarda, e por quê
O §14 é doutrina de review, sem lint. Alinhamento óptico não é um literal a
procurar: é uma relação entre duas caixas que só o olho fecha. Escrevi isso no
próprio §14 porque guarda inventada pra parecer rigorosa é pior que ausência de
guarda, dá sensação de cobertura onde não há.

## X1 — Dizer antes, não depois

### O que a medição mudou no plano
O esboço supunha que copiaríamos o defeito do Paseo. **Não copiamos**: o nosso
falha honesto (`"não consegui executar o agent X. Ele está instalado e no
PATH?"`, em `agent.rs`), enquanto o deles entrega um "command not found" cru.

O defeito nosso é outro, e é de MOMENTO: a resposta honesta chega **depois** de
você escolher o motor, escrever o prompt inteiro e mandar. E o app já tinha as
duas metades desde o boot, sem nunca juntá-las:

- `detectAgents()` roda no boot e guarda o retrato em `settings.detected`
- `INSTALL_COMMANDS` guarda a receita de instalação de cada CLI
- `estadoNaMaquina()` já devolve `instalado | ausente | desconhecido`

Faltava o elo. **É a quarta vez seguida que a peça já existia** (a primitiva na
D1, a escada na D2, os dois papéis do filete na D3).

### O que foi feito
- `avisoDeMotorAusente()` em `lib/detect.ts`: o elo, com as duas honestidades
  como REGRA e não como copy.
- `MotorAusenteBanner`: diz o motor, mostra a receita e copia o comando.
- O trilho do `IdentityPicker` esmaece o motor ausente e explica no `title`.
- `BannersDoComposer`: os três avisos acima do composer num lugar só.

### As decisões que valem mais que o código
1. **Não bloqueia o envio.** O probe é um retrato do boot; o spawn é a verdade.
   Recusar-se a tentar seria o app mentindo com mais confiança do que o probe
   tem. Se você acabou de instalar o motor, ele funciona e o banner some no
   próximo boot.
2. **`desconhecido` não avisa.** Sem probe (boot antes da detecção, fora do
   Tauri), devolve `null`. É o §5 camada 3: senão o banner apareceria no boot e
   sumiria um segundo depois, tendo mentido pra quem tem o motor instalado.
3. **Sem receita, sem chute.** Motor fora do `INSTALL_COMMANDS` diz que não
   conhece a receita. Foi assim que `sst/tap/opencode`, uma fórmula que não
   existe, viveu no código.
4. **Sem "dispensar".** Dispensar um aviso que descreve o estado atual da
   máquina só o traria de volta no render seguinte.

### O que a frente achou de quebra
A catraca de tamanho disparou no `ChatPanel` (1261 contra 1239). Dividi, como
manda o §10 — e a divisão achou um motivo melhor que o número: os três banners
disputam o mesmo espaço, e quem escrever o quarto precisa vê-los juntos pra
saber onde ele entra na ordem (agendado → vai falhar → está falhando).

`check` 13/13 · `tsc -b` limpo · 3496 testes · build 316.

## X2 — Sentinela `{{{prompt}}}` (esboço)

O perfil declara ONDE o prompt entra, e argumento que só existe para carregar
prompt é descartado quando não há prompt. Tira a matriz de casos especiais por
motor do `adapters.rs`.

## F1 — Adotar sessão externa (esboço)

O painel da ADR-118 hoje só encerra. Ganha **adotar**, visível só para motor com
`sessionResume`. O `session_id` já chega pelos hooks
(`hook_sessions.rs:54-66`) — não precisamos do trabalho de arqueologia que o
Paseo fez para descobrir o diretório de persistência.

## F2 — Espelho headless do terminal (esboço)

O que falta para o **M1** de `docs/margem-do-fio-plan.md` existir: emulador no
backend, e não um tail de 240 linhas. Paga reconexão, snapshot, captura para o
agente e detecção de atividade de uma vez só. Herda três números medidos por
eles: scrollback 1000, teto de 4 MB bufferados, degradação para snapshot de 200
linhas.
