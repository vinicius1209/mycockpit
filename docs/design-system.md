# Frota — Design System

> Direção visual do app. Os tokens abaixo são a fonte de verdade para `globals.css`.
> Princípio: **refinamento por precisão**, não por intensidade.
> Regras de USO (papéis de cor, escala fechada, elevação, movimento, copy)
> moram em `docs/STYLEGUIDE.md` — em conflito, o STYLEGUIDE manda.

## Conceito

**"Cockpit / painel de instrumentos."** Calmo, preciso, técnico. Base monocromática
grafite (dark-first), onde **cor = significado** (status dos agents). Um único acento
**brass/âmbar**, usado cirurgicamente (foco, item ativo, marca). Referência de altura de
barra: Linear/Vercel — mas com momentos editoriais (serif) que dão alma.

A "coisa memorável": o **console de comando** (input ai-02) tratado como instrumento —
flutuante, com glow brass sutil no foco e uma *status strip* viva.

## Tema (dark-first)

```css
/* DARK (padrão) */
--bg:            #0A0B0D;  /* tinta grafite, quase preto azulado */
--bg-subtle:     #0E1013;  /* fundo de painel */
--surface:       #141619;  /* card elevado */
--surface-2:     #191C20;  /* card hover / popover */
--border:        rgba(255,255,255,0.07);   /* hairline */
--border-strong: rgba(255,255,255,0.12);
--text:          #E7E8EA;  /* near-white, nunca #fff puro */
--text-muted:    #9AA0A7;
--text-faint:    #687078;
--primary:       #ECEDEE;  /* botões sólidos: claro */
--primary-fg:    #0A0B0D;
--accent:        #E4A862;  /* brass/honey — foco, ativo, marca */
--accent-soft:   rgba(228,168,98,0.14);
--accent-fg:     #1A1306;

/* Status dos agents (cor = significado) */
--st-idle:    #687078;
--st-running: #5BB8E8;  /* cyan, com pulse */
--st-queued:  #E4A862;  /* âmbar */
--st-success: #5BD6A0;  /* esmeralda */
--st-error:   #F2766B;  /* rosa */
```

```css
/* LIGHT */
--bg:            #FBFBFA;  /* paper branco-quente */
--bg-subtle:     #F4F4F2;
--surface:       #FFFFFF;
--surface-2:     #F7F7F5;
--border:        rgba(0,0,0,0.08);
--border-strong: rgba(0,0,0,0.14);
--text:          #16181B;
--text-muted:    #5C6166;
--text-faint:    #8A9099;
--primary:       #16181B;
--primary-fg:    #FBFBFA;
--accent:        #A9742B;  /* brass mais profundo p/ contraste no claro */
--accent-soft:   rgba(169,116,43,0.12);
```

## Tipografia

| Papel | Fonte | Uso |
|---|---|---|
| UI / corpo | **Geist** | toda a interface, texto de chat |
| Mono | **Geist Mono** | código, caminhos, labels técnicos, números (tabular) |
| Display | **Instrument Serif** | wordmark, saudação de empty state, títulos grandes |

```css
--font-sans:    "Geist", ui-sans-serif, system-ui, sans-serif;
--font-mono:    "Geist Mono", ui-monospace, "SF Mono", monospace;
--font-display: "Instrument Serif", Georgia, serif;
```

- Escala (rem): 11/12/13/14(base)/16/18/22/30/44. UI densa fica em 12–14.
- Tracking: títulos display levemente negativos (-0.01em a -0.02em). Labels mono em
  uppercase com tracking +0.06em para virar "etiqueta de instrumento".
- `font-variant-numeric: tabular-nums` em métricas/contadores.

## Espaçamento & densidade

- Grid base **4px**; ritmo principal em múltiplos de 8.
- Linha de projeto na sidebar: **~40px** (py 10px + texto 13px/1.5 — régua real
  do código, medida em jul/2026; o valor antigo de 34px era mentira de doc).
  Linha de conversa: **~34px** (py 8px + texto 12px/1.5). Padding de chat:
  24–28px. Gutter de painel: 16px.
- IDE-like: denso nas laterais, respirável no centro.

## Raios & elevação

```css
--radius-sm: 6px;  --radius: 9px;  --radius-lg: 13px;  --radius-full: 9999px;
--shadow-sm:  0 1px 2px rgba(0,0,0,.35);
--shadow-pop: 0 12px 40px -8px rgba(0,0,0,.55);
--ring:       0 0 0 1px var(--accent), 0 0 0 4px var(--accent-soft);
--lift:       inset 0 1px 0 rgba(255,255,255,.05);  /* highlight de borda no topo */
```

Superfícies elevadas usam `--lift` (1px highlight) para sensação de "vidro/instrumento".

## Motion

```css
--ease: cubic-bezier(0.2, 0.8, 0.2, 1);
--dur-fast: 120ms;  --dur: 200ms;  --dur-slow: 320ms;
```

- **Load:** reveal escalonado dos três painéis (slide+fade, `animation-delay` 60/120/180ms).
- **Status dot "running":** pulse suave (scale+opacity, 1.6s loop).
- **Mensagens/cards:** entram com fade+rise de 4px.
- Hover/focus: transições de 120ms. Respeitar `prefers-reduced-motion`.
- React: usar **Motion** (framer-motion) para orquestração.

## Atmosfera (não usar cor chapada)

- **Grain overlay** global sutil (noise SVG, opacidade ~3%) sobre o `--bg`.
- Empty state do chat: leve **vignette radial** + um halo brass quase imperceptível atrás do console.
- Bordas hairline em vez de sombras pesadas; sombra só no console flutuante e popovers.

## Elementos-assinatura

1. **Console de comando** (ai-02): barra flutuante, seletor destino+modelo à esquerda,
   anexo + enviar à direita, chips de ação abaixo; foco = glow brass (`--ring`).
2. **Instrument strip:** faixa fina no topo/rodapé com status do agent, modelo, projeto
   ativo, em Geist Mono uppercase.
3. **Saudação serif** no empty state (Instrument Serif), ex.: *"Bom dia, Vinícius."*
4. **Status dot** com a paleta semântica + pulse.

## Acessibilidade

- Contraste mínimo AA no texto (`--text` sobre `--bg` ✓). `--text-muted` só em rótulos.
- Brass como TEXTO pequeno reprova AA no tema claro sobre superfícies de hover
  (medido: `#A9742B` sobre `--accent` claro = **3.56:1** < 4.5:1). Item ativo usa
  texto `foreground`; brass fica na barra/fundo/ícone (o "ativo" não depende do
  texto tingido).
- Foco sempre visível (`--ring`). Navegação por teclado nos painéis e na lista.
- `prefers-reduced-motion` desliga pulse/reveal.
