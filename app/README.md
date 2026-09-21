# Frota — app (M1)

App desktop **Tauri 2 + React 19 + TypeScript + Vite 8 + Tailwind v4 + shadcn/ui**.
Este é o **esqueleto do M1**: shell de três painéis, design system "cockpit", console
de comando (blocks.so `ai-02`) e persistência de projetos em SQLite. **Ainda não há
runner de agent** (chega no M3) — o console confirma o caminho da UI.

## Pré-requisitos

- **Rust** ≥ 1.87 (a `rust-version` do `src-tauri` está em 1.87; o resolver é MSRV-aware).
- **Bun** (gerenciador usado aqui) ou npm/pnpm.
- **macOS**: Xcode Command Line Tools (`xcode-select --install`) para compilar o `src-tauri`.

## Rodar

```bash
bun install
bun run tauri dev     # app desktop (Tauri) — com SQLite + seleção de pasta reais
# ou só o frontend no browser (sem Tauri → usa dados-semente em memória):
bun run dev           # http://localhost:1420
```

> No browser (`bun run dev`) não há runtime Tauri: o app detecta isso (`isTauri()`) e cai
> para projetos-semente em memória. SQLite e seleção de pasta só funcionam no `tauri dev`.

## Build / verificação

```bash
bun run build                                    # tsc -b && vite build (frontend)
cargo check --manifest-path src-tauri/Cargo.toml # checa o backend Rust
```

## Estrutura

```
app/
├── index.html                 # dark-first + anti-flash
├── src/
│   ├── main.tsx               # importa fontes (Fontsource) + index.css; aplica .dark
│   ├── index.css              # design system (tokens, grain, animações) — ver docs/design-system.md
│   ├── App.tsx                # providers + shell de 3 painéis + carga do SQLite
│   ├── lib/
│   │   ├── utils.ts           # cn(), shortPath()
│   │   ├── types.ts           # Project, AgentStatus, Destination
│   │   └── db.ts              # camada SQLite (guarda isTauri; fallback p/ browser)
│   ├── store/app.ts           # estado global (Zustand): projetos, tema, painéis
│   └── components/
│       ├── common/            # StatusDot, Wordmark (retículo)
│       ├── layout/            # TitleBar, Sidebar, ContextPanel
│       ├── chat/              # ChatPanel, CommandConsole
│       └── ui/                # componentes shadcn (new-york)
└── src-tauri/
    ├── src/lib.rs             # registra plugins sql (migração `projects`) + dialog
    ├── capabilities/default.json  # permissões sql:* e dialog:*
    └── Cargo.toml             # resolver = "3" (MSRV-aware), rust-version 1.87
```

## Decisões técnicas do M1

- **shadcn**: estilo `new-york`, Tailwind v4 (CSS-first, sem `tailwind.config`), registry
  do blocks.so em `components.json` (`@blocks-so → https://blocks.so/r/{name}.json`).
- **Fontes offline** via Fontsource (Geist / Geist Mono / Instrument Serif) — sem CDN.
- **SQLite**: `tauri-plugin-sql` com migração que cria a tabela `projects`; a string
  `sqlite:mycockpit.db` é a MESMA no `lib.rs` e no `db.ts`.
- **MSRV**: `resolver = "3"` + `rust-version = "1.87"` no `src-tauri/Cargo.toml` fazem o
  cargo escolher deps compatíveis com rustc 1.87 (senão `time`/`darling`/`plist`/
  `serde_with` puxam versões que exigem 1.88).

Design system completo em [`../docs/design-system.md`](../docs/design-system.md).
