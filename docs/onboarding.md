# Onboarding de primeira instalação

Status: design (não implementado) · Escopo: macOS, Tauri 2 + React

## Problema

Na primeira abertura o app assume que `claude`, `codex` e `agy` existem e estão
autenticados. Se não estiverem, o usuário só descobre no primeiro run, com um
erro genérico ("não consegui executar o agent"). Não há wizard nem detecção; o
registry `agents.ts` marca `available: true` hardcoded.

## 1. Detecção de agents — comando Rust `detect_agents`

Novo módulo `app/src-tauri/src/detect.rs`, comando `detect_agents` registrado em
`lib.rs`. Roda TODOS os probes em paralelo (`tokio::join!`), cada um com timeout
de 5s (probe pendurado vira `unknown`, nunca trava o wizard). Nenhum probe
dispara um run pago — só flags de metadata.

### Contrato

```ts
// resposta do invoke("detect_agents")
interface DetectedTool {
  id: "claude-code" | "codex" | "agy" | "swiftc" | "git"
  installed: boolean          // binário resolvido e executável
  version: string | null      // saída do --version (trimada)
  auth: "ok" | "missing" | "unknown"  // "unknown" = instalado, auth desconhecida
  detail: string | null       // ex.: e-mail logado, path do binário, erro curto
}
```

### Probes por ferramenta (verificados na máquina, 2026-07)

| Ferramenta | Existe/versão | Auth (probe barato) |
|---|---|---|
| claude | `claude --version` → `2.1.187 (Claude Code)` | `claude auth status` → JSON `{"loggedIn": true, "email": …}`, exit 0. Parseia `loggedIn`; `detail` = email. Sem custo de LLM. |
| codex | `codex --version` → `codex-cli 0.141.0` | `codex login status` → "Logged in using ChatGPT", exit 0; deslogado = exit ≠ 0. Sem JSON: decide pelo exit code. |
| agy | `agy --version` → `1.1.1` | **Não tem** subcomando auth/login (verificado no help da 1.1.1). Degradação: `agy models` (rápido, lista modelos do servidor). Lista não-vazia → `auth: "ok"`; erro/vazio/timeout → `auth: "unknown"` ("instalado, auth desconhecida"). NEEDS-VERIFY: comportamento do `agy models` deslogado — se não distinguir, cai sempre em `unknown`, que é honesto. |
| swiftc (ditado) | `swiftc --version` (ou `xcrun --find swiftc`) | n/a → sempre `unknown`. Espelha o `--selfcheck` do sidecar stt: se o binário do sidecar já existe, pode rodar `mycockpit-stt --selfcheck` como bônus. |
| git | `git --version` | n/a |

### Resolução de PATH (gotcha crítico)

App .app aberto pelo Finder herda PATH mínimo (`/usr/bin:/bin:…`) — `claude`
vive em `~/.nvm/...`, `agy` em `~/.local/bin`, `codex` em `/opt/homebrew/bin`.
O probe (e futuramente os adapters) deve resolver o binário via login shell:
`/bin/zsh -lc 'command -v claude'`, cacheando o path absoluto no resultado
(`detail`). Isso também explica/previne o erro "não consegui executar" em
builds empacotados. O `detect_agents` devolve o path resolvido; fase 2 (fora
deste escopo) é os adapters usarem esse path.

## 2. Fluxo do wizard

Gatilho: no boot do `App.tsx`, se `settings.onboarded !== true` (cobre tanto
`mc.app` ausente no localStorage quanto flag falsa), renderiza o
`OnboardingWizard` como overlay full-screen POR CIMA do layout (o boot de
projetos segue rodando por baixo). Enquanto o wizard está ativo, o seed de
projetos de exemplo é PULADO — o passo 5 adiciona o primeiro projeto real.

### Passo 1 — Boas-vindas

```
┌──────────────────────────────────────────────┐
│                                              │
│                 ◉  MyCockpit                 │
│      Seu cockpit de code agents no macOS     │
│                                              │
│   Vamos verificar suas ferramentas e         │
│   configurar o essencial em ~1 minuto.       │
│                                              │
│                       [ Começar → ]          │
└──────────────────────────────────────────────┘
```

### Passo 2 — Detecção (checklist ao vivo)

Chama `detect_agents` ao entrar; cada linha sai de spinner → ✅/⚠️/❌ conforme
os probes resolvem. "Como instalar" abre popover com comando copiável + link.

```
┌──────────────────────────────────────────────┐
│  Verificando suas ferramentas…    [↻ Rodar]  │
│                                              │
│  ✅ Claude Code  2.1.187 · logado (vinicius…)│
│  ✅ Codex        0.141.0 · logado (ChatGPT)  │
│  ⚠️ Antigravity  1.1.1 · auth desconhecida   │
│  ❌ OpenCode     — em breve (não integrado)  │
│  ✅ git          2.49                        │
│  ⚠️ swiftc       ausente → ditado desativado │
│                                              │
│  ❌/⚠️ → [ Como instalar ▾ ]                 │
│     claude:  npm i -g @anthropic-ai/claude-code
│     codex:   brew install codex              │
│     agy:     https://antigravity.google/cli  │
│                                              │
│  Nenhum agent? Instale um e clique Rodar.    │
│                  [ ← ]      [ Continuar → ]  │
└──────────────────────────────────────────────┘
```

Regras: ✅ = instalado + auth ok · ⚠️ = instalado + auth unknown/missing (pode
continuar; o card explica) · ❌ = não instalado. "Continuar" habilita com ≥1
agent instalado; senão o botão vira "Continuar mesmo assim" (secundário).

### Passo 3 — Agent default

Só os detectados como instalados aparecem selecionáveis (⚠️ entra com badge).
Pré-seleção: claude-code > codex > agy, o primeiro com ✅.

```
┌──────────────────────────────────────────────┐
│  Qual agent abre por padrão?                 │
│                                              │
│  (•) Claude Code   CLI da Anthropic     ✅   │
│  ( ) Codex         CLI da OpenAI        ✅   │
│  ( ) Antigravity   CLI do Google        ⚠️   │
│                                              │
│  Dá pra trocar por conversa, e nas           │
│  Configurações depois.                       │
│                  [ ← ]      [ Continuar → ]  │
└──────────────────────────────────────────────┘
```

### Passo 4 — Tema

```
┌──────────────────────────────────────────────┐
│  Como você prefere o cockpit?                │
│                                              │
│   ┌─────────────┐      ┌─────────────┐       │
│   │ ▓▓ Escuro ▓▓│      │   Claro     │       │
│   │  (preview)  │      │  (preview)  │       │
│   └─────────────┘      └─────────────┘       │
│                                              │
│                  [ ← ]      [ Continuar → ]  │
└──────────────────────────────────────────────┘
```

Aplica na hora (`toggleTheme`/`applyTheme` já existentes).

### Passo 5 — Primeiro projeto

Reusa o fluxo existente: extrai o `handleAddProject` do `App.tsx` para
`lib/projects.ts` (`addProjectViaDialog()`), chamado pelo wizard E pelo botão
da Sidebar (mesma lógica de dedupe/restauração).

```
┌──────────────────────────────────────────────┐
│  Adicione seu primeiro projeto               │
│                                              │
│        [ 📁 Escolher pasta do projeto ]      │
│                                              │
│  ✅ prime-sales-hub adicionado               │
│                                              │
│  [ Pular por agora ]        [ Continuar → ]  │
└──────────────────────────────────────────────┘
```

### Passo 6 — Pronto

```
┌──────────────────────────────────────────────┐
│  🎉 Tudo pronto                              │
│                                              │
│  Agent default: Claude Code · Tema: escuro   │
│  ⚠️ Antigravity: auth não confirmada — se o  │
│     primeiro run falhar, rode `agy` no       │
│     terminal para logar.                     │
│                                              │
│                    [ Abrir o cockpit ]       │
└──────────────────────────────────────────────┘
```

"Abrir o cockpit" grava `onboarded: true` + snapshot da detecção e desmonta o
wizard. Fechar a janela no meio NÃO grava a flag → wizard volta no próximo boot
(idempotente; escolhas de tema/default já aplicadas persistem, sem dano).

## 3. Re-entrada

- **Refazer onboarding**: botão na seção "Sobre" do `SettingsDialog` →
  `setSettings({ onboarded: false })` + abre o wizard imediatamente (estado
  local `wizardOpen`, não exige restart). Wizard reusado 1:1.
- **Re-detecção avulsa**: na seção "Padrões" do Settings, bloco "Agents na
  máquina" com o MESMO componente checklist do passo 2 (`DetectChecklist`) e um
  botão "Verificar de novo". Atualiza o snapshot sem passar pelo wizard.

## 4. Persistência

Em `GlobalSettings` (`lib/settings.ts`, persiste via `mc.app`):

```ts
interface AgentProbe { installed: boolean; version: string | null;
  auth: "ok" | "missing" | "unknown"; checkedAt: number }

// novos campos (defaults: onboarded=false, detected={})
onboarded: boolean
detected: Record<string, AgentProbe>   // por id: claude-code, codex, agy, swiftc, git
```

O `merge` deep do persist já garante default para quem atualiza de versão
antiga — MAS usuários existentes não devem ver o wizard: bump da `version` do
persist (1→2) com `migrate` que seta `onboarded: true` quando já existe estado
persistido anterior (mc.app presente = não é primeira instalação).

### Detecção alimenta o seletor SEM quebrar o registry estático

O registry `AGENTS` continua a fonte de verdade ESTÁTICA de identidade e
capacidade ("o app integra este agent": ids, modelos, efforts, caps). A
detecção responde outra pergunta: "este agent existe NESTA máquina". Composição
em vez de mutação:

```ts
// agents.ts — novo helper puro (não muda AGENTS nem DESTINATIONS)
type Availability = "ready" | "installed-auth-unknown" | "missing" | "not-integrated"
function availability(id: string, detected: Record<string, AgentProbe>): Availability
// regra: !def.available → not-integrated
//        sem snapshot (nunca detectou) → ready   ← degradação = comportamento atual
//        snapshot.installed && auth ok → ready
//        snapshot.installed → installed-auth-unknown (selecionável, com badge ⚠️)
//        senão → missing (aparece desabilitado com hint "não encontrado — instalar")
```

Consumidores (seletor de destino, liga do Fusion, Settings) trocam o filtro
`d.available` por `availability(...) !== "missing" && !== "not-integrated"`,
lendo `detected` do store. Sem snapshot, tudo se comporta como hoje — zero
quebra. O ditado: `MicButton` passa a considerar `detected["swiftc"]` além de
`dictationEnabled` (esconde o mic com hint quando swiftc falta).

## 5. Plano de implementação

Ordem de ataque (cada item vira uma tarefa):

| # | Arquivo | Mudança | Tam. |
|---|---|---|---|
| 1 | `app/src-tauri/src/detect.rs` (novo) | comando `detect_agents`: resolução via login shell, probes paralelos com timeout, structs serde | M |
| 2 | `app/src-tauri/src/lib.rs` | `mod detect` + registrar no `invoke_handler` | S |
| 3 | `app/src/lib/detect.ts` (novo) | tipos `DetectedTool`/`AgentProbe` + wrapper `invoke("detect_agents")` + fallback fora do Tauri (browser dev → tudo `ready`) | S |
| 4 | `app/src/lib/settings.ts` | campos `onboarded` + `detected` em `GlobalSettings` e defaults | S |
| 5 | `app/src/store/app.ts` | bump persist version 1→2 + `migrate` (usuário existente → `onboarded: true`) | S |
| 6 | `app/src/lib/agents.ts` | helper `availability()` + selectors derivados que aceitam snapshot | S |
| 7 | `app/src/lib/projects.ts` (novo) | extrair `addProjectViaDialog` do App.tsx (reuso wizard/Sidebar) | S |
| 8 | `app/src/components/onboarding/DetectChecklist.tsx` (novo) | checklist ao vivo ✅/⚠️/❌ + popover "como instalar" (reusado no Settings) | M |
| 9 | `app/src/components/onboarding/OnboardingWizard.tsx` (novo) | overlay com os 6 passos, stepper, grava flag+snapshot no fim | L |
| 10 | `app/src/App.tsx` | montar wizard quando `!onboarded`; pular seed durante onboarding; usar `lib/projects.ts` | S |
| 11 | `app/src/components/settings/SettingsDialog.tsx` | "Refazer onboarding" (Sobre) + bloco re-detecção com `DetectChecklist` (Padrões); filtro do agent default por `availability` | M |
| 12 | Seletores de destino (CommandConsole/Fusion) | trocar filtro `available` pelo `availability()` com badge ⚠️ | M |

Dependências: 1–2 destravam 3; 4–5 destravam 9–11; 8 antes de 9 e 11.
Risco maior: resolução de PATH em build empacotado (item 1) — validar com o
canal de builds (`/build` teste) antes de promover.
