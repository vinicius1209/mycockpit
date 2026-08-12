# Roadmap — o que os estudos deixaram mapeado

> Consolidado em 12/08/2026, das lições de `competitors-orca.md`,
> `competitors-xirp.md`, `background-status-plan.md` (Warp), `hooks-plan.md`
> e da auditoria §9 do `STYLEGUIDE.md`. Ordem = recomendação, não obrigação.

## Entregue (para memória)
Fio despoluído (ADR-037) · STYLEGUIDE canônico · medidor de janela de uso
(statusline + conta Claude + RPC Codex) · hooks H0-H2 (frota da máquina +
permissão remota) · Companion C1-C4 · remoção do Escritório (ADR-035).

## Fila curta (alto valor / custo baixo-médio)

### R1 — Passada do top-10 do STYLEGUIDE
O §9 do guide já lista os desvios com file:line. Os mais visíveis: anel de
contexto pinta saudável de brass (regra: cinza <60); "Parar" com duas tintas
(`ComposerParts:538` primary × `MessageList:514` vermelho); verde como estado
ambiente em 26 arquivos (ADR-037 só cobriu o fio); escala tipográfica
estilhaçada (24 tamanhos → 4). Bônus achado depois: **clipping do popover do
InboxBell** (mesmo z-index que consertamos na pill).

### R2 — Onboarding ✅ ENTREGUE (12/08/2026)

Wizard de 3 passos + guia de setup na sidebar, nos termos abaixo. Revisão e
arquivos em `docs/onboarding.md` (bloco no topo). Pendência registrada: item
opcional do guia (medidor/hooks/companion) só some quando instalado; quem não
quer nenhum usa o botão direito. O texto original segue como referência:


Xirp e Orca convergiram na receita: passos que INSTALAM CAPACIDADES, não tour.
3 passos visíveis (condicionais somem do contador, sem bolinha morta):
(1) detectar agentes + escolher padrão; (2) escolher tema (salva na seleção,
reverte se skip); (3) notificações com botão de teste que É a sonda de
permissão. Termina em ação ("Adicionar seu primeiro projeto"), não em
"Concluir". Depois: Setup Guide na sidebar com anel de progresso, itens
marcados por PROBE de estado real (com timeout), some sozinho ao completar.

### R3 — Hardening do Companion (importações do Orca)
(a) E2EE de aplicação com **transcript binding** (hello/ready com nonces,
shape exato, auth carregando o hash da transcrição) — mata MITM/downgrade sem
TLS, que é o dilema que aceitamos na LAN; (b) listener nasce em **loopback** e
alarga só no ato de gerar o QR; (c) **reach** (`this-computer|network`) gravado
NA credencial; (d) TTL no convite direto (falha do Orca: só o relay tem);
(e) durabilidade antes da validade. NÃO regredir nosso aceite-no-desktop (o QR
deles é bearer puro — somos melhores nesse eixo).

## Fila média

### R4 — Worktree por sessão/tarefa (Xirp + Orca convergem)
Worktree irmão do repo, branch `session/<nome-memorável>`, config git por
projeto (branch base, carregar dirs ignorados), delete pareado sessão↔worktree,
lineage com origem e confiança da captura. Encaixa no deferred-work: trabalho
paralelo sem agentes pisando no mesmo checkout.

### R5 — Eixos novos no registry (Orca)
`promptInjectionMode` (enum fechado: argv/flag-prompt/flag-interactive/
stdin-after-start) + `argvPromptSeparator`; `draftPromptFlag`/`draftPromptEnvVar`
(pré-preencher ≠ enviar); `draftPasteReadySignal`; `preflightTrust` (pré-gravar
o artefato de "trust this folder" de cursor/copilot/codex — sem isso o primeiro
prompt de cada workspace novo se perde); **tabela negativa** de args não
suportados. Yolo tri-valorado (`yolo|manual|mixed`) preservando customização.

### R6 — Processo: ratchet + reliability gates + root guard (Orca)
Ratchet: baseline de arquivos com `eslint-disable` congelada, CI falha em
bypass NOVO, baseline só encolhe. `reliability-gates`: cada invariante com
`invariant` (1 frase), `oracle` (como provar), `platforms` vs
`coveredPlatforms` (**lacuna é campo obrigatório**), links da issue. Root
guard: job que rejeita arquivo novo na raiz. Comece com 5 gates.

## Fila longa / condicional

- **Barra de status inferior (24px, largura total)**: só quando houver ≥3
  indicadores ambientes permanentes (hoje ~1,5: uso + sessões externas).
  Absorveria o rodapé da sidebar. Critério registrado para não virar chrome
  gratuito. Trade-off: nosso rodapé é o composer (a decisão), diferente do
  Orca que é app de terminal.
- **H3 dos hooks**: alertas ricos (Stop com motivo, falhas nomeadas).
- **Browser B2.3**: painel/screencast — só se a demanda provar (o Orca e o
  Xirp lançaram SEM browser embutido; validou nosso corte).
- **Ditado D3**: polimento opcional do texto pelo modelo helper (opt-in).
- **Handoff canônico** (Xirp): regras do formato deles (linkage preservado,
  handoff propaga permissionMode, erros nomeados) para `context-handoff.md`.
- **Daemon separado da UI** (Orca/Xirp): sessões sobrevivem à UI. Direcional e
  caro; nosso headless não paga esse preço hoje.

## O que decidimos NÃO fazer (com motivo)
Daemon-tmux-em-TS (Orca reimplementou tmux: 200 arquivos, 23 defeitos da mesma
corrida) · yolo como default de fábrica (conflita com aprovação humana) ·
persistência em JSON gigante · PTY oculto para telemetria · QR bearer sem
aceite · servidor de push próprio (local-first: catch-up é mais barato).
