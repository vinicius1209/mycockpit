# Evolução do produto — modelo mental alvo e rota contínua

> Gatilho: "por que a conversa continua ativa na sidebar quando troco de modo?"
> Pedido: não pensar em remendo — pensar em EVOLUÇÃO CONSTANTE rumo ao melhor
> cenário. Pesquisa de padrões (VS Code, Linear, Slack, Xcode/JetBrains, Warp,
> Cursor, ChatGPT desktop, vibe-kanban) + análise do código. Data: 2026-07-13.

## 1. O diagnóstico (3 incoerências, 1 causa)

| Sintoma | Evidência |
|---|---|
| Seleção órfã | conversa destacada na sidebar em modos que não a mostram; HIG: destaque persistente só quando a seleção DIRIGE o detalhe — no SDD o destaque **mente** |
| Acoplamento invisível | a disputa do Fusion ancora na conversa ativa e o vencedor é promovido pra ela (`launch(activeId,…)`) — a UI não conta em lugar nenhum |
| Lista duplicada | o SDD tem a lista de features DENTRO da view enquanto a sidebar mostra conversas irrelevantes — o objeto primário está no lugar errado |

**Causa única:** o switcher organiza por *como o trabalho executa* (superfície),
mas a navegação e o dia do usuário são organizados por *que trabalho existe e em
que estado está* (objeto). Os modos são um acidente da história de implementação.

## 2. O que a comunidade converge (pesquisa)
- **Regra híbrida dominante:** navegação de *lugares* é global e estável
  (Linear: sidebar = "global chrome", contém lugares, nunca objetos de
  trabalho); listas de *objetos* mudam com a superfície (VS Code Activity Bar ↔
  view containers; Xcode: 9 navigators; Slack 2023: sidebar muda por tab;
  ChatGPT desktop: Codex mostra tasks, Chat mostra conversas). **Nenhum produto
  maduro encontrado mantém uma lista de conversas fixa e destacada enquanto o
  modo ativo trabalha com outro objeto.**
- **Seleção órfã:** memória POR SUPERFÍCIE (VS Code preserva estado de cada view
  container); destaque pleno só na superfície dona do objeto; **nunca limpar
  silenciosamente**.
- **Acoplamento invisível:** o antídoto documentado é o "Also send to #channel"
  do Slack — no ponto da ação, um controle explícito e EDITÁVEL nomeia o efeito
  ("vencedor → conversa X"). Breadcrumb comunica localização, não consequência.
- **Sinal de modo:** NN/g pede ≥2 indicadores redundantes do modo ativo.
- **Auto-troca por evento** (Xcode/JetBrains): a atividade puxa o painel certo
  sozinha (rodar → debug navigator). O usuário não "lembra de trocar".

## 3. O modelo mental ALVO (o melhor cenário)

**Linear/Fusion/Mission/SDD não são lugares — são ESTRATÉGIAS de execução de
uma mesma unidade: o TRABALHO.** O produto já "sabe" disso: o Mission nunca
virou modo (decisão deliberada); o Fusion já tem entrada no composer (⚔️) e o
board dele renderiza DENTRO da conversa; o Inbox já atravessa modos ("precisam
de você"); a disputa desagua numa conversa.

No estado maduro:

```
┌ Home: PAINEL (mission control) ─────────────────────────────┐
│ rodando agora (todos os projetos) · precisam de você · custo │
└──────────────────────────────────────────────────────────────┘
Superfícies:  TRABALHO            FEATURES (SDD)
sidebar:      grafo de trabalho   features do projeto
              do projeto:         (pipeline/evidência)
              tarefas, missões,
              disputas — com
              estado e custo
composer:     estratégia: 1 agent | disputa ⚔️ | pipeline 🚀
```

- **Sidebar = objetos da superfície ativa** (+ projetos como lugares, sempre).
  Tarefas/missões/disputas viram cidadãos de primeira classe com estado
  (rodando / precisa de você / concluído) e custo — não só "conversas".
- **O composer escolhe a estratégia** (como já faz com ⚔️ e 🚀). O Fusion
  Arena standalone se dissolve — a pesquisa validou: "Fusion não tem objeto
  primário próprio; é um modo de responder" (a disputa nasce DA conversa, então
  a relação fica óbvia por construção).
- **Painel (mission control)** é a home que o trabalho autônomo noturno EXIGE
  (autonomy.md): você acorda e revisa, não caça abas. Features do SDD podem
  gerar trabalho que aparece no Trabalho — um só grafo.
- Nesse mundo a pergunta original se dissolve: não há "conversa órfã em outro
  modo" porque cada superfície é dona da sua lista, com memória própria.

## 4. Princípios permanentes (a bússola de toda decisão de UI futura)
1. **Sidebar contém lugares (global) + objetos DA superfície ativa** — nunca
   objetos de outra superfície.
2. **Toda ação que afeta um objeto fora da tela NOMEIA o efeito no ponto da
   ação**, editável ("vencedor → conversa X [trocar]").
3. **Seleção tem memória por superfície; destaque pleno só onde ela dirige o
   detalhe.** Nunca limpar silenciosamente.
4. **Modo/superfície sinalizado por ≥2 indicadores redundantes.**
5. **Capacidade nova nasce como ESTRATÉGIA no composer, não como modo**
   (precedente: Mission).
6. **A atividade puxa o painel certo por evento** (lançar disputa → superfície
   de trabalho; abrir feature → Features).

## 5. Rota de evolução (fases contínuas; cada uma útil sozinha; nada vira dívida)

**F1 — Verdade na seleção** *(fundação, não remendo — tudo daqui sobrevive no alvo)*
- Memória de seleção POR SUPERFÍCIE (exigida pelo alvo).
- Destaque pleno da conversa só na superfície Trabalho; nas demais, dim
  (estado "última", sem accent).
- Chip explícito de âncora no Fusion: "vencedor → *conversa X* [trocar]"
  (o padrão Slack; permanece no alvo como rótulo de consequência).

**F2 — Sidebar work-centric**
- A lista de conversas vira lista de TRABALHO: missões e disputas como linhas
  de primeira classe (estado + custo), não efeitos escondidos.
- No SDD, a lista de features MIGRA pra sidebar (mata a segunda lista do meio;
  o padrão sidebar-por-superfície validado pela pesquisa).

**F3 — Estratégias no composer, superfícies enxutas**
- Fusion Arena se dissolve: ⚔️ no composer vira a única entrada (a liga vira um
  popover, como o MissionLauncher). O acoplamento invisível desaparece por
  construção.
- Switcher passa a 2 superfícies + home: **Painel | Trabalho | Features**.

**F4 — Painel (mission control)**
- Home cross-projeto: rodando agora, precisam de você (Inbox promovido),
  custo do dia/entregas. App abre nela quando há trabalho ativo/noturno.
- É a superfície da autonomia (auto-revive + aprovação granular + missões
  longas já existem; falta o lugar de comandá-las).

**F5 — Horizonte**
- Workspaces (docs/workspaces — quando cross-repo virar rotina) e o grafo de
  trabalho unificado (entregas/lições/custos visíveis por item de trabalho).

## 6. Anti-metas (o que NÃO fazer)
- Não adicionar um 4º modo pra nada (estratégias, não modos).
- Não limpar seleção ao trocar de superfície (perder estado ≠ coerência).
- Não manter duas listas do mesmo objeto em superfícies diferentes.
- Não esconder consequência cross-superfície atrás de tooltip — é rótulo no
  ponto da ação.

Fontes: VS Code Activity Bar/Sidebars UX guidelines · Linear "How we redesigned
the Linear UI II" · Slack new design (2023) + "Also send to #channel" · Apple
HIG Split Views · NN/g Modes/Visibility of System Status · Xcode Navigators ·
IntelliJ Tool Windows · Warp Vertical Tabs · Cursor 3 Agents Window · ChatGPT
desktop (Work/Codex) · vibe-kanban.
