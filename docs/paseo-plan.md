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
| **D1** | Tabela de superfícies + primitiva `ui/popover.tsx` | PA2 | **em andamento** |
| **D2** | Geometria de controle fechada, com guarda | PA3 | a fazer |
| **D3** | Alinhamento óptico e a regra de borda afiada | lacunas 3 e 4 | a fazer |
| **X1** | `isAvailable()` antes de oferecer motor | PA9 | a fazer |
| **X2** | Sentinela `{{{prompt}}}` no registry | PA7 | a fazer |
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

### Definição de pronto

- `§12` escrito, com a tabela e o critério, e citado na rubrica do `§8`.
- `ui/popover.tsx` existe e é a única porta para painel ancorado.
- `StickyNotesTrigger` e `PainelDaFaixa` usam a mesma primitiva; o
  `onCloseAutoFocus` some ou fica com motivo novo escrito.
- Guarda no `bun run check`, com teste vitest ao lado (padrão do §10).
- ADR registrando a régua, porque ela muda decisão futura.
- `bun run check` 11/11, `tsc -b` limpo, vitest verde, sem regressão visual nas
  duas superfícies tocadas.

---

## D2 — Geometria de controle (esboço)

Fechar altura/padding/fonte de controle como o §3 fechou tipografia: níveis
nomeados, nada de `h-6 px-2 text-[11px]` à mão. A regra que fecha, deles:
*"never shrink a control's font or padding locally to fit a context"*. Guarda
no mesmo molde do `check-type-scale.mjs`. Especificado quando D1 fechar.

## D3 — Alinhamento e borda (esboço)

Duas regras curtas, sem guarda automática (não são literais a procurar):
alinhar por glifo e não por caixa, com o ajuste óptico comentado como óptico; e
o teste de borda afiado (*"single-thing borders are wrong"*). Entram no §4 e na
rubrica do §8.

## X1 — `isAvailable()` antes de oferecer (esboço)

O Paseo lista perfil de terminal sem checar instalação e entrega
"command not found". Nós temos quatro motores; o registry precisa responder
"está instalado?" antes de a UI oferecer. Encosta na camada 1 do §5
(capability ausente some).

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
