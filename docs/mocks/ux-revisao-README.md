# UX revisão — Frota: como fazer diferente

> **Mock estático de revisão de UI/UX** — mesma base (tokens, HTML, dados) do app, com
> **decisões de UX alteradas**. 6 telas navegáveis no topo, anotações ①…⑨ no rodapé
> de cada frame. Abra no browser: `ux-revisao.html`.

## O que este mock mostra

Cada tela é uma **variação independente** sobre um problema real da interface atual,
extraído da avaliação como especialista em ADE (Agentic Development Environment).
Os três agents mantêm suas cores do STYLEGUIDE: **Codex** (`#5bb8e8`), **Claude Code**
(`#e4a862`), **Antigravity** (`#a48af0`).

| Tela | Feature | Problema atacado |
|---|---|---|
| **Trabalho** | Conversa + Fusion | Plano duplicado, permissão como microcopy, resposta em parede de texto, espaço morto na grid |
| **Fusion** | Disputa multi-agent | Veredito sem explicação, custo da disputa invisível, comparação por texto corrido |
| **Inbox** | Decisões do agente | Pergunta sem contexto, decisão obriga a abrir conversa, SLA invisível |
| **Painel** | Retrospectiva | Nome inconsistente, sem comparativo temporal, métricas sem proveniência, insight sem ação |
| **Frota** | Visão de agents | Plano/assinatura invisível, estado operacional não é escaneável |
| **Notas** | Overlay sobre a conversa | Largura desproporcional, CTA duplicado, nota sem caminho de inserção |

## Como navegar

- **Barra superior**: tabs entre as 6 telas (funciona como `data-go` com JavaScript).
- **Botão "tema"**: alterna claro/escuro para verificar contraste em ambos temas.
- **Rodapé de cada frame**: notas numeradas ①…⑨ explicando o que mudou e por quê.
- **Tooltips**: elementos com `data-tip` mostram explicações ao passar o mouse.

## Decisões de UX resumidas

1. **Permissão como ação, não como log.** O banner oferece "Permitir uma vez / Sempre neste projeto / Ver comandos" em vez de microcopy técnico.
2. **Plano sem duplicação.** Título do card ≠ primeira etapa; fases futuras em lista checável compacta.
3. **Resposta do agente em decisões.** Headings → bullets → bloco de escolha numerado → próximos passos numerados.
4. **Inspector no espaço morto.** Coluna direita com contexto da sessão (agente, worktree, custo, arquivos, decisões, outline).
5. **Vereditto explicável.** O juiz diz qual critério pesou (simplicidade, correção, alinhamento vs SPEC.md).
6. **Insight → ação.** Cada gráfico do Painel tem um botão "Ver ▸" / "Ativar ▸".
7. **Comparativo temporal.** Hero com "▲ 12% vs período anterior".
8. **Métricas com proveniência.** Tooltip explica o que mede e o que não mede.
9. **Honestidade compactada.** "O app não inventa" vira tooltip, não ocupa largura.
10. **Heatmap interativo.** Células com tooltip por hora e ação "ver conversas".
11. **Custo por entrega com caminho.** CTA "Ativar detecção por merge" onde o dado é frágil.
12. **Inbox com contexto e SLA.** Pergunta + trecho do SPEC + tempo decorrido; decisões de 1 clique.

## Tokens

Copiados de `app/src/index.css` via `docs/STYLEGUIDE.md`:
- Fontes: `"Geist Variable"` / `"Geist Mono Variable"` (fallbacks `ui-sans-serif` / `ui-monospace`).
- Escala: 11 / 12 / 13 / 14 + paradas hero 20 / 30 (§3 do STYLEGUIDE).
- Papéis de cor: cinza (saudável), âmbar (`st-queued` = decisão pendente/fila), vermelho (`st-error` = falha/destruição), azul (`st-running` = chrome/vivo), brass (ação primária/foco), violeta (`id-violet` = Antigravity).
- Regra: `st-running` vive no chrome; no conteúdo, "rodando" é movimento cinza (spinner), nunca tinta.

## Não é o app

Arquivo 100% estático (HTML + CSS + JS inline). Nenhum dado é enviado; não há fetch,
sem backend, sem SQLite. Serve apenas para revisão visual e discussão de UX.
