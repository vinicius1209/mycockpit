# Sidebar — plano (comportamento, sinais e polimento)

> Status: proposto em 03/08/2026, a partir da auditoria de UI/UX + feedbacks
> diretos do usuário (abrir no fim, reordenar, repensar sinais à la Warp,
> desarquivar, miudezas do item 6). Mock de validação da fase S2:
> `docs/mocks/sidebar-status.html`.

## A tese dos sinais (o "evento primário")

Hierarquia do que o usuário precisa SENTIR, em ordem:

1. **Esperando VOCÊ** (permissão/pergunta/decisão) — o único evento que
   interrompe o humano. Só ele merece pulso e âmbar.
2. **Terminou e você não viu** (ok/erro) — persistente e quieto até abrir.
3. **Rodando** — presença calma (ciano estático). Rodando não é alarme.
4. **Identidade** (agent, cor de projeto/conversa) — constante, nunca compete
   com evento.

Referência Warp (tab): avatar do agent com UM dot de status sobreposto +
título + sublinha de contexto (branch). Um lócus de status; contexto vira
sublinha; zero ícones soltos na borda direita.

## S1 — Comportamento (inambíguo, direto pra implementação)

- **S1.1 — Abrir no fim.** Trocar de conversa SEMPRE aterrissa na última
  mensagem. Se havia não-visto (doneUnseen), divisor discreto "novas
  mensagens" na fronteira. Scroll manual do usuário só é respeitado DENTRO da
  mesma visita (o auto-follow existente durante stream não muda).
- **S1.2 — Reordenação manual.** Drag & drop de projetos E de conversas
  (verificar lib de dnd já presente no repo — o board de cards — e reusar;
  senão, HTML5 drag). Persistência: coluna `sort_order` (migração SQLite),
  default preservando a ordem atual. Sem modos de ordenação automática —
  ordem é do usuário.
- **S1.3 — Arquivados existem.** Hoje "arquivar projeto" é um buraco negro:
  sem lista, sem desarquivar. Entrar: seção "Arquivados (N)" colapsada no fim
  da lista de projetos (só aparece quando N>0), com linha discreta por
  projeto e ação "Desarquivar" (+ "Excluir de vez" no context menu, com
  confirm). 
- **S1.4 — Ícones honestos + destrutivo longe do caminho.** `Archive` para
  arquivar (nunca lixeira), `Trash2` para excluir conversa (nunca X). Ações
  destrutivas/arquivamento saem da linha (ficam SÓ no context menu) — hoje a
  lixeira materializa no hover colada no chevron de expandir, e o caminho do
  cursor cruza a zona de arquivar.

## S2 — Sinais (Warp-like; mock ANTES de código)

Proposta A no mock (`sidebar-status.html`):

- Conversa vira grade de **duas linhas** quando houver contexto (à la Warp):
  linha 1 = marca do agent (com o ÚNICO dot de status) + título; linha 2 =
  sublinha muted 10.5px com worktree/branch, missão, disputa — texto, não
  ícone-sopa na borda direita.
- **Um lócus de status**: o dot sobre a marca do agent (conversa) e sobre a
  pasta (projeto). Acabam os canais paralelos: foguete/espadas viram sublinha;
  worktree vira sublinha; barra brass fica (é seleção, não status).
- **Pulso só no "esperando você"**; rodando = ciano estático; done-unseen =
  dot esmeralda/rosa persistente até abrir.
- **Cor-rótulo sem colisão semântica**: paleta restrita (sem vermelho/verde/
  ciano/âmbar dos `--st-*`). **Decisão do usuário (03/08, já implementada):**
  a cor tinge a LINHA INTEIRA (lavagem `color-mix` 10%), não um dot/anel;
  na linha ativa a seleção vence o fundo e a cor degrada pra dot. O anel do
  mock fica descartado pra conversas; a restrição de paleta segue valendo.
- Projeto agrega o pior estado dos filhos (esperando > erro-não-visto >
  rodando), no MESMO lócus (dot da pasta).
- Galeria de estados no mock: rodando, esperando, done/erro não-visto,
  missão, disputa, worktree, cor-rótulo, dim (ativa noutra superfície),
  duas conversas rodando no mesmo projeto.

Gate: validar o mock com o usuário → implementar como S2.x.

## S3 — Miudezas aprovadas (item 6 da auditoria)

- **S3.1** — versão do rodapé NUNCA trunca ("v0.1.0-t177" ou quebra/tooltip).
- **S3.2** — economia de pulso e de brass: pulse só em "esperando você";
  worktree/foguete saem do brass (viram muted) — brass é ativo + marca.
- **S3.3** — "PROJETOS 5": contador em `text-faint` + `tabular-nums`.
- **S3.4** — "Agendado" ganha separação de categoria (label-mono "GERAL"
  acima, sem barra brass de seleção — barra é de conteúdo).
- **S3.5** — DS ↔ código: altura real da linha (~40px) vs 34px declarado —
  atualizar o design-system.md pra régua real (mentira de doc é mentira).
- **S3.6** — contraste AA do texto brass 12px sobre bg-accent no tema claro:
  medir; se falhar, texto ativo volta a `foreground` (barra+fundo carregam o
  "ativo").

## Registro de implementação (03/08/2026 — S1 e S3)

- **S1.2 — migrações registradas**: `sort_order` entrou via migrações
  **v30–v33** no `lib.rs` (v30 coluna em projects, v31 backfill preservando
  created_at DESC, v32 coluna em conversations, v33 backfill preservando
  created_at ASC por projeto; desempate por id). Máxima anterior era v29
  (mcp_health). Sem lib de dnd no repo (board não arrasta) → HTML5 drag,
  com "Mover para cima/baixo" no context menu cobrindo teclado.
- **S1.3**: arquivar já era soft (projects.deleted_at, migração v16) — entrou
  a seção "Arquivados (N)", Desarquivar (linha + menu) e "Excluir de vez"
  (menu, com confirm; apaga projeto + conversas + schedules + cards; métricas
  históricas ficam; blobs órfãos caem no GC de anexos).
- **S3.6 — medido**: brass `#A9742B` sobre `--accent` claro `#F1F1EF` =
  **3.56:1** (< 4.5:1, reprova AA p/ 12px) → texto ativo virou `foreground`
  (15.73:1); barra brass + bg-accent seguem donos do "ativo". No escuro o
  brass passava (7.75:1), mas a regra vale nos dois temas por consistência.
- **S1.1**: divisor "novas mensagens" deriva a fronteira dos items
  (`unseenBoundary` em `lib/unseen.ts`) capturada no switch ANTES do markSeen;
  vive na visita (`ConvState.unseenDividerId`, efêmero).

## Fora de escopo (registrado)

- Unificação da gramática de cor-rótulo projeto (pasta tingida) × conversa —
  decidir DENTRO do mock S2 (o anel proposto pode servir aos dois).
- Busca/filtro na sidebar (o ⌘K já cobre; reavaliar se a lista crescer).
