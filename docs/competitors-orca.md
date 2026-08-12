# Concorrente: Orca (stably.ai) — anatomia e lições

> Estudo de 12/08/2026, por leitura do CÓDIGO (open source, clone em
> `~/projetos/orca`, v1.4.178-rc.2, Electron + React, ~264k linhas TS,
> 4.623 arquivos de teste). Três frentes: arquitetura/processos, integração
> de agents, UX/produto. Relatórios completos nos transcripts da sessão;
> aqui, o destilado com file:line dos pontos-chave. Nada foi copiado — o que
> se absorve são REGRAS.

## O que o Orca é

Wrapper de terminal (node-pty) com **daemon destacado** próprio que mantém um
emulador headless (@xterm/headless) e checkpoints em disco — sessões
sobrevivem à UI e a restart. 36 agents suportados via **registry TypeScript
tipado** (não yaml). Mobile em React Native/Expo com E2EE de aplicação. UI
"monocromática e quieta" regida por um `docs/STYLEGUIDE.md` de 314 linhas
versionado no repo. Telemetria com double-gate de compile-time (build de
terceiro não consegue transmitir nem com env var). Local-first de verdade:
**sem servidor de push por escolha** (app fechado = sem notificação,
compensado por catch-up com watermark+epoch).

## Os achados que mudam decisões nossas

### 1. Rate limits de graça: a statusline do Claude e o RPC do Codex
O Claude Code ≥2.1.80 pipeia `rate_limits` (janela 5h/7d, % usado, reset) no
stdin do comando de statusline A CADA TURNO. O Orca instala uma statusline
que não imprime nada e POSTa o JSON pro app (`src/main/claude/
statusline-script.ts:14`). Codex: `codex -s read-only -a untrusted
app-server` → JSON-RPC `account/rateLimits/read` (`codex-fetcher.ts:630`).
Fallback final: PTY oculto digitando `/usage` e regex no TUI. Política de
poll madura: 15min, floor 30s, backoff por streak, stale-drop 30min MAS 24h
se a falha foi 429 ("quota é informativa; snapshot velho > 'Limited'").
**Custo em $ e rate-limit são pipelines separados** — não misturar.
→ Candidato a frente própria no MyCockpit: barata, provada, e custo é nossa
feature central. "Quanto da janela do plano queimei" hoje não existe aqui.

### 2. Eixos de registry que o nosso não tem
`tui-agent-config.ts`: além de binário/flags — `promptInjectionMode` (6 modos
fechados: argv/flag-prompt/flag-prompt-interactive/flag-interactive/
stdin-after-start/especial), `argvPromptSeparator` (`--`), `draftPromptFlag`/
`draftPromptEnvVar` (PRÉ-PREENCHER ≠ enviar), `draftPasteReadySignal`
("composer pronto" tem assinatura diferente por agent), `preflightTrust`
(pré-gravam o artefato de "trust this folder" de cursor/copilot/codex porque
o menu de trust engolia o prompt inicial), `detectCmd ≠ launchCmd ≠
expectedProcess`, e a **tabela negativa** `UNSUPPORTED_TUI_AGENT_ARGS`
(registry que sabe o que NÃO fazer). Yolo é operação sobre o registry
(`applyAgentPermissionMode`): só toca entradas vazias/default, devolve
`yolo|manual|mixed` — nunca booleano global.

### 3. Status multi-fonte com precedência declarada
`hook > OSC 9999 > título OSC > process-exit`. O **OSC 9999** é protocolo
aberto deles (`\x1b]9999;{json}\x07`, `agent-status-osc.ts:4`): qualquer
agent que emita a sequência ganha status estruturado sem adapter — é assim
que "any CLI agent" deixa de ser marketing. Debounces caros de redescobrir:
1,5s de quiet pós-done, poll adaptativo 750ms/2s/3s/15s. Hooks instaláveis
em 14 agents (relay em 18); permissão vira estado sticky na UI
(correlacionada por tool_use_id), mas **não respondem permissão** — o hook
deles é fire-and-forget. (O Xirp responde; nosso hooks-plan H2 segue o Xirp.)

### 4. Segurança do mobile: nosso aceite vence; importar 3 coisas deles
QR deles é **bearer puro** (quem fotografa, pareia — `runtime-rpc.ts:705`);
nosso aceite-no-desktop fecha exatamente esse buraco. Não regredir. Importar:
(a) **E2EE de aplicação com transcript binding** (NaCl ECDH + hello/ready com
nonces + shape exato + auth carregando transcriptHash — mata MITM/downgrade
sem TLS, o que importa em LAN); (b) **listener nasce em loopback e alarga só
no ato de gerar o QR** + `reach` (`this-computer|network`) gravado NA
credencial; (c) **rotação explícita do convite pendente** ("Regenerate QR",
ameaça nomeada: screenshot/clipboard/screen-share) + durabilidade antes da
validade (credencial só vale após persistir). E: TTL no convite direto —
falha DELES (só relay tem 10min), não padrão a copiar.

### 5. A estética "nativa" é subtração
Eles REMOVERAM vibrancy (custava composição por frame — issue #8482);
traffic lights nativos (`hiddenInset`) re-sincronizados no zoom;
`acceptFirstMouse`; `backgroundColor` casado com o tema (mata flash). Bundle:
21 dependencies de runtime; tudo mais é devDependency tree-shaken. 15 entry
points no main — cada subsistema que pode travar/crashar o processo
principal foi extraído para worker/fork COM O INCIDENTE NUMERADO no
comentário (@parcel/watcher derrubava o main #7547; port-scan bloqueava o
loop; hang-watchdog em worker sobrevive a deadlock de AppKit).

### 6. UI quieta é sistema, não gosto
`docs/STYLEGUIDE.md` deles: tese em 1 frase ("a UI recua e emoldura"),
`--primary` é CINZA claro (#e5e5e5 — não há cor de marca no chrome), 4
tamanhos de fonte, 3 níveis de elevação ("não adicione um quarto"), barras
de uso CINZA até 60% (`tooltip.tsx:190`), status bar de 24px com 3 níveis de
degradação por largura (conteúdo degrada, layout nunca quebra), e **4
camadas de esconder**: capacidade ausente (some item E toggle), não-
configurado (esconde) vs configurado-com-erro (VISÍVEL de propósito, senão a
UI tremula), CTA só após snapshots assentarem, dismissal persistido.
Copy: "UI copy must not overclaim"; feedback proporcional à duração
(0-100ms: NADA; até 1s: só disabled; pré-reservar largura do controle).

### 7. Onboarding e checklist orientados a evidência
5 passos declarados, usuário vê 3 (condicionais SOMEM do contador, sem
bolinha morta); tema salva na seleção mas REVERTE se skip; "Send Test
Notification" é secretamente a sonda de permissão do macOS; último passo
termina em ação ("Add your first project"); Escape → dialog 360px com "keep
going" como default. Setup Guide na sidebar: anel de progresso 13px, some
sozinho ao completar, cada item marcado por PROBE de estado real (com
timeout de 15s pra leitura travada não esconder o checklist pra sempre),
clicar abre no primeiro incompleto.

### 8. Processo de engenharia (o mais transferível)
- `CLAUDE.md` = `@AGENTS.md` (1 linha; fonte única). AGENTS.md de 69 linhas,
  quase todo restrições: comentários "WHY not HOW, 1 linha"; nomes de
  arquivo nunca `helpers/utils/common`; checklist de TODA mudança
  (cross-platform, SSH, folder-workspace, wire-compat).
- **Ratchet**: baseline de arquivos com `eslint-disable` congelada — CI
  falha se aparecer bypass NOVO; baseline só encolhe.
- **`config/reliability-gates.jsonc`** (11k linhas, schema-validado): cada
  invariante com `invariant` (1 frase), `oracle` (como provar),
  `platforms` vs `coveredPlatforms` (A LACUNA É CAMPO OBRIGATÓRIO),
  issue+PR motivadores, asserções por nome. Promoção a blocking: 100 runs,
  14 dias, 0 flakes.
- **Root directory guard**: job de CI que rejeita arquivo novo na raiz.
- Benchmarks como GATES com budgets numéricos (tecla ≤75ms mediana,
  restore ≤1s, selector-fanout ≤5ms/write).
- `src/main/daemon/AGENTS.md`: invariantes de posse de socket com
  estatística medida ("rename gapeou em 0 de ~14.500 sondagens;
  unlink-then-link em quase todas") e seção "Residual risk" declarada.

## O que NÃO copiar

- **O daemon/emulador headless**: reimplementaram tmux em TS (~200 arquivos,
  7 rodadas de review, 23 defeitos da mesma interleaving). Nosso headless
  stream-json troca fidelidade TUI por simplicidade — troca boa para agents
  com JSON estruturado. Se um dia precisarmos reexibir sessão morta, copiar
  só o padrão de checkpoint serializado.
- **QR bearer sem aceite** (regressão vs nosso v2).
- **Persistência em JSON gigante** (7.7k linhas de persistence.ts) — nosso
  SQLite com migrações versionadas é superior para o nosso caso.
- **Yolo como default de fábrica** — conflita com nossa doutrina de
  aprovação humana; registrar como decisão deles, não adotar.

## Top 6 lições ranqueadas (valor/custo)

1. **Medidor de janela de uso** via statusline (Claude) + app-server RPC
   (Codex), com a política de poll deles. (altíssimo/baixo)
2. **STYLEGUIDE.md nosso** antes de mais despoluição — tese, papéis de cor
   com "não use para", 4 fontes, 3 elevações, 4 camadas de esconder, rubrica
   de review. (altíssimo/baixo)
3. **Hardening do Companion**: transcript binding E2EE, loopback-lazy,
   `reach` na credencial, rotação do convite, TTL, durabilidade antes da
   validade. (alto/médio)
4. **Eixos novos no registry**: promptInjectionMode, draft vs send,
   preflightTrust, tabela negativa, yolo tri-valorado. (alto/médio)
5. **Ratchet + reliability-gates + root guard + "Why:" com issue** —
   processo que impede apodrecimento. (alto/baixo, incremental)
6. **Onboarding 3-passos + Setup Guide por evidência** (junto com as regras
   do Xirp — os dois convergem). (alto/médio)
