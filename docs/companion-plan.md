# Companion Web profissional — plano (visão registrada, execução futura)

> **Status C1 (11/08/2026): ENTREGUE.** Fundação de app no cliente existente
> (página única vanilla, sem framework novo): rotas com history real via hash
> (`#/`, `#/agents/<pid>`, `#/chat/<pid>/<agent>[/<conv>]` — voltar/avançar/F5
> funcionam), PWA (manifest + ícones + service worker que cacheia SÓ o shell,
> `/api` nunca), offline honesto (banner "Sem conexão com o Mac" + carimbo
> "visto há…" do último snapshot restaurado do localStorage, nunca tela branca)
> e reconexão automática com backoff (máquina de estados em
> `app/src-tauri/companion/core.js`, o MESMO arquivo servido ao celular e
> coberto por vitest em `app/src/lib/companionWeb.test.ts`). Canal de dados,
> bind e pareamento intactos. **Limitação registrada**: em `http://` de LAN
> (contexto inseguro) o browser não dá service worker nem install prompt do
> Android — o SW/instalação plena valem em contexto seguro; no iOS o
> Adicionar à Tela de Início + standalone (metas apple) funcionam mesmo em
> http. HTTPS local é conversa do C2 junto com o modelo de pareamento.

> Status: visão registrada em 11/08/2026, palavras do usuário: o companion
> "devia ser muito mais profissional… lançar tarefa, falar com os agentes, ter
> comportamento de um aplicativo mesmo — botão de voltar que volta. Tem que ser
> uma coisa que me ajude a falar com o MyCockpit em qualquer cômodo da casa."
> Este arquivo guarda a visão e o esqueleto; NÃO está em execução — a frente
> ativa é `office-removal-plan.md` (que preserva a ponte de dados de que o
> companion depende).

## O que "profissional" significa aqui (critérios, não adjetivos)

1. **Comportamento de app**: histórico de navegação real (botão voltar do
   browser/gesto do celular funciona), estado sobrevive a refresh, instalável
   como PWA (ícone na home screen, standalone, offline honesto = "sem conexão
   com o Mac", nunca tela branca).
2. **Agir, não só ver**: lançar tarefa num projeto, responder a um agent
   (aprovações/perguntas pendentes), parar um turno. Tudo que hoje exige ir
   até o Mac.
3. **Qualquer cômodo da casa**: mobile-first de verdade (o uso é celular no
   sofá/cozinha), reconexão automática, e o pareamento continua simples.
4. **Honestidade de estado** (doutrina da casa): o que o companion mostra vem
   do mesmo snapshot do app; quando o Mac está inacessível, dizer isso — nunca
   fingir dado vivo.

## Pré-requisitos já verdadeiros

- A ponte de dados (pós `office-removal-plan.md` R1: `lib/fleet/`) é o
  contrato do snapshot — companion já consome.
- O servidor do companion no Rust já serve a web local; falta o canal de
  AÇÕES (hoje o fluxo é majoritariamente leitura + interações pontuais).

## Fases (rascunho — detalhar quando a frente abrir)

- **C1 — Fundação de app**: roteamento com histórico (hash/router), PWA
  manifest + service worker, reconexão com backoff, estados de erro honestos.
- **C2 — Ações**: lançar tarefa (projeto + prompt + preset), responder
  pendências (aprovar/negar/texto), parar turno. Mesmas guardas do app
  (aprovação é gesto humano; nada de auto-despacho).
- **C3 — Conversa**: ver o fio de uma conversa e mandar mensagem nela (o
  "falar com os agentes" completo), com o mesmo render de markdown do app
  onde couber.
- **C4 — Polimento de casa**: dark mode, notificações web push (se o canal
  local permitir), atalhos de tela inicial por projeto.

## Guardas

- Pareamento/autenticação antes de qualquer ação remota (hoje já existe token;
  ações elevam o risco — revisar o modelo antes do C2).
- Nada de expor a web fora da rede local por padrão.
- O companion nunca vira segunda fonte de verdade: toda ação passa pelo mesmo
  caminho do app (stores/commands), nunca atalho próprio.
