# As telas de configuração, depois de olhar o Orca (plano)

> Status: **F1–F4 e F6 ENTREGUES (24/08/2026)**. Falta só o F5, que começa por
> medir. Ver ADR-075 (as duas primeiras correções), 077 (F1), 079 (F2),
> 080 (F3), 081 (F4) e 083 (F6).
>
> **Uma frase deste plano estava errada e o código corrigiu:** eu escrevi
> "parcial: 2 de 3 motores" no F2. O selo é da MÁQUINA e "parcial" é sobre
> ESCOPO. Registrado no ADR-079 porque errar por não ter lido é o tipo de coisa
> que vale ficar escrita.
>
> Referências apontam **arquivo e símbolo**, nunca `arquivo:linha` — a catraca
> do §10 obriga a dividir arquivo, então número de linha apodrece por desenho.

## A régua que decide o que entra

O Orca tem **538 arquivos** em `components/settings`; nós temos 15. Isso **não**
é déficit: metade do rail deles é escopo que decidimos não ter (SSH, VMs
efêmeras, marketplace de plugins, Bitbucket, Azure DevOps, emulador mobile).

O que se importa é **mecanismo**, nunca item de menu. Toda linha deste plano
passa por uma pergunta: *isso responde a uma pergunta que o usuário do Frota
faz, e que hoje fica sem resposta?* Se a resposta for "não, mas o concorrente
tem", não entra.

## Já entregue (ADR-075)

- **Cópias no PATH viraram fato da detecção**, não subproduto do updater. E a
  frase responde "qual roda?" em vez de "qual eu gerencio".
- **O agent padrão cruza com o probe** (`estadoNaMaquina`), com "desconhecido"
  como terceiro estado pra mapa vazio nunca virar "nada instalado".

---

## F1 — Cartão do GitHub em Conexões

**Por que é o primeiro:** temos a metade DIFÍCIL pronta e invisível.
`github.rs` já tem `parse_gh_accounts` (lê TODAS as contas logadas do
`gh auth status`) e `run_gh_any_account`, que tenta cada conta via
`gh auth token --user X` e — o detalhe que importa — **nunca troca a conta ativa
global** do seu terminal. Isso é melhor que o cartão do Orca, que só sabe dizer
"Connected".

E nada disso aparece em lugar nenhum: `grep GitHub app/src/components/settings`
não devolve uma linha.

O custo disso é conhecido e já foi pago nesta máquina: *"repository not found"*
por conta ativa errada, resolvido à mão com `gh auth switch`. Uma falha que o
app **já sabe diagnosticar internamente** e não conta.

### O que entra

Um cartão em `Conexões`, no molde do Orca, com os três estados **distintos** —
a distinção é o valor, porque cada um tem um remédio diferente:

| estado | o que significa | o que o cartão oferece |
|---|---|---|
| `gh` ausente | a CLI não existe | comando de instalação (copiável, como em `MachineAgents`) |
| `gh` sem conta | existe, nenhuma logada | o comando de login, sem executá-lo por você |
| logado | N contas, uma ativa | a LISTA das contas + qual está ativa |

**A lista, não "Connected".** Com uma conta só, "conectado como X" basta. Com
duas, o nome da ativa é a informação inteira — é a diferença entre o PR abrir e
o "repository not found".

### O que NÃO entra

- **Não** executar `gh auth login` nem `gh auth switch` pelo app. Login é gesto
  do humano no terminal dele; e trocar a conta ativa global do usuário a partir
  de um app é efeito colateral fora do nosso quintal — o `run_gh_any_account`
  foi escrito justamente pra não precisar disso.
- **Não** GitLab/Bitbucket/Azure. Escopo, não mecanismo.

### Escopo por projeto (pedido do usuário) — e o cuidado

O usuário pediu *"talvez até permitir configurar por projeto"*. Faz sentido:
projeto pessoal e projeto do trabalho podem querer contas diferentes.

**Mas isto tem precedente ruim na casa.** Config por-projeto morando em modal
global foi exatamente o que gerou a regra do escopo explícito: seletor na cara e
escopo declarado, **nunca herança silenciosa**. Se entrar, entra assim:

- o cartão global mostra as contas da MÁQUINA (fato, não preferência);
- a preferência de conta POR PROJETO vive no `.mycockpit/config.toml`, junto do
  resto do config de projeto, e aparece com o nome do projeto do lado;
- projeto sem preferência diz **"usando a conta ativa da máquina"**, escrito —
  não em branco.

**Sugestão de sequência:** o cartão global primeiro, sozinho. Ele já paga o
custo do incidente conhecido. O por-projeto depois, com o escopo explícito, e
só se o global provar que o dado é confiável.

---

## F2 — Bloco de Confinamento em Agentes na máquina

**Estado:** proposto por mim, **ainda não confirmado pelo usuário.**

O S4 entregou o selo (`Selo::{Ausente, Parcial}`, `notaDeQuemSegura`) e ele
aparece em UM lugar: dentro do popover do chip de modo. Não existe tela onde
você pergunte "esta máquina está protegida?" e receba resposta.

Conceito à frente, superfície atrás: o Orca tem duas permissões booleanas com
uma tela inteira; nós temos três estados escondidos atrás de um clique.

**O mecanismo a copiar é um só, e é o melhor das seis telas:** no
`ComputerUsePane` deles, `missingCount = PERMISSIONS.length - grantedCount`. O
resumo é **derivado das linhas** — não existe um "setup incompleto" separado
que alguém precise lembrar de atualizar. Se as linhas ficam boas, o título vira
"pronto" por construção.

Entrega: resumo derivado (`ausente` / `parcial: 2 de 3 motores` / `ativo`), uma
linha por motor, a nota de quem segura. Zero mecanismo novo — `lerConfinamento`
já devolve tudo.

---

## F3 — Seletor de microfone no Ditado

Aprovado pelo usuário. **É a maior das três em custo, e vale saber antes.**

Hoje o sidecar Swift usa `AVAudioEngine().inputNode`, que pega o **default do
sistema**. Quem tem headset e a webcam como default do SO dita com o microfone
errado e não tem onde consertar dentro do app.

Não é um campo novo na tela: é CoreAudio.

- **Listar**: `AudioObjectGetPropertyData` com `kAudioHardwarePropertyDevices`,
  filtrando os que têm canais de ENTRADA, e o nome de cada um. Vira um comando
  novo do sidecar (ou um segundo modo do binário) e um `#[tauri::command]`.
- **Escolher**: setar `kAudioOutputUnitProperty_CurrentDevice` na audio unit do
  `inputNode` **antes** de dar `start` no engine. Ordem importa.
- **O caso que decide se ficou honesto**: o device salvo **sumiu** (headset
  desconectado). A regra tem que ser explícita e testada: cai no default do
  sistema **e diz que caiu**, no mesmo canal do `SttOutcome.warn`, que já existe
  exatamente pra isto ("nunca substitui o texto; só explica de onde ele veio").
  Ficar mudo aqui é a versão áudio da compactação silenciosa.

O que **não** copiar: `Speech Model` e `Dictation Mode: Toggle|Hold`. O primeiro
não se aplica (reconhecimento é do sistema, não escolhemos modelo). O segundo é
ajuste que existe porque o desenho deles não resolveu — o nosso `HotkeyField`
resolve os dois no mesmo gesto (toque alterna, segurar é push-to-talk). Um
ajuste a menos é vitória, não lacuna.

---

## F4 — Manter o computador acordado enquanto um agent trabalha

Aprovado. `On | Agent | Off`, e **o valor do meio é o único que interessa**:
acordado enquanto há trabalho, dormindo quando não há.

O caso real: missão de 4 fases às 3h da manhã que morre porque o Mac dormiu. É
falha que o app pode evitar e hoje não evita — e conversa direto com o eixo
`ehDesassistido`, que já existe e já sabe responder "tem alguém na frente?".

Cuidado de desenho: o que segura o sono precisa ser **liberado no mesmo lugar
onde o trabalho termina**, incluindo falha e cancelamento. Trava de energia
vazada é o mesmo defeito do processo órfão — e essa casa já teve o incidente da
carga fantasma pra saber como ele se parece.

---

## F5 — Cronômetro de cache do prompt

Aprovado, e é o de **maior potencial com maior incerteza**. Por isso vem depois
e começa por medir.

O Orca expõe: o Claude cacheia a conversa; ocioso demais, o cache expira e a
próxima mensagem reenvia o contexto inteiro **mais caro**. Isso é fato de custo
que o nosso ledger **não sabe** — uma conversa parada 20 minutos custa mais no
turno seguinte, e o recibo não explica por quê. Mesma família do recibo mudo.

**Fase 0 obrigatória, sem UI nenhuma:** provar que dá pra observar. O turno
reporta tokens de cache (`cache_read` / `cache_creation`)? O TTL é derivável do
que vemos, ou seria constante chutada?

Se for chute, **não entra**. Foi exatamente o erro do `3_000` herdado: número
sem fonte, sustentado por nada. Um cronômetro que conta um TTL que a gente
inventou é pior que não ter cronômetro, porque parece dado.

---

## F6 — O rail: buscar, badges, e o estado no menu

### Buscar

Eles indexam título, descrição e keywords por seção, com pontuação em camadas.
Com **34 seções**, busca é necessidade; com **15**, é conforto.

**O caminho barato não é busca própria: é jogar as seções na paleta `⌘K` que já
existe.** Digitar "ditado" e cair na seção resolve quase todo o valor sem tela
nova, sem índice novo, sem uma segunda caixa de busca no app.

E tem um efeito de segunda ordem que interessa mais que a busca: obrigar cada
seção a **declarar o que contém** transforma o nosso `question` (hoje editorial)
em algo verificável — *bloco que não aparece na declaração da seção onde mora
está na seção errada*. Isso é candidato a guarda de verdade.

### Badges no rail

`BETA` / `OPCIONAL` ao lado do rótulo, não dentro do título. Hoje "Missões
(beta)" carrega o estado no texto; o rail não mostra nada. Barato: um campo
opcional no registro de seções, que já é dado puro.

### Estado no rail

O mais forte dos três: o rail deles marca a seção que **precisa de atenção**
(`installStatus: needs-attention`). Depende de F1 e F2 existirem primeiro — sem
fato apurado, um ponto de atenção no menu é decoração.

---

## O que NÃO fazer (a lista importa tanto quanto a de cima)

- **Não** copiar `Agent Permissions · Yolo|Manual` como preferência global. É o
  bug que o ADR-068 removeu. Permissão é por CONVERSA, decidida no último metro.
- **Não** construir Relay próprio pro Companion. Servidor deles, conta deles,
  assinatura deles. Somos compra única e local-first: LAN-only é coerência, não
  limitação. Se um dia houver alcance remoto, o caminho honesto é Tailscale —
  que eles próprios citam — e não infra nossa.
- **Não** trocar a pill de uso por três janelas soltas. A regra do ADR do build
  201 (*vizinho não empresta número*) nasceu de um incidente real. O que vale
  perguntar é se a janela que mais aperta está a um clique; não é diluir a regra.
- **Não** adicionar item de menu porque o concorrente tem.

## Definition of done (por fase, a mesma forma)

Cada fase entrega junto **a pergunta que ela passou a responder** e a prova de
que responde: teste da função pura que decide o estado, e o caso do estado
degradado (conta ausente, motor não confinado, device sumido) coberto —
porque é sempre o caminho feliz que ganha teste e o degradado que quebra.
