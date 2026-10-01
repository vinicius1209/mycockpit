# Estudo de Concorrentes, Diagnóstico e Rumos do Frota (Outubro/2026)

> **Data:** 01 de outubro de 2026  
> **Objetivo:** Confrontar o estado da arte do Frota com o mercado recente (Maestri Chat, Orca, Paseo, Xirp, Zeron e ferramentas correlatas), avaliar a direção estratégica e definir a matriz de prioridades (Fazer, Melhorar, Refazer, Deletar).  
> **Fontes e estudos antecedentes:**  
> - `docs/competitors-maestri-chat.md` (lançamento do Maestri Chat em 16/09/2026)  
> - `docs/competitors-maestri.md` (canvas infinito e assistente Ombro)  
> - `docs/competitors-orca.md` (daemon headless, rate limits e Styleguide monocromático)  
> - `docs/competitors-paseo.md` (provocações de design, superfícies e ACP por config)  
> - `docs/competitors-xirp.md` (hooks de status fail-open e worktree por sessão)  
> - `docs/estudo-produto-2026-09.md` (mercado de agentes, tese de custos e I1 a I8)  
> - `docs/remocao-features-prd.md` (poda cirúrgica da aba SDD/Features)  
> - `docs/decisions.md` (ADR-037 a ADR-292)  

---

## 1. Panorama dos Concorrentes em 2026

O ecossistema de orquestração de agentes de código amadureceu e se polarizou em três arquétipos principais:

```
                      ARQUÉTIPOS DO MERCADO (2026)
                      
   [ Canvas Espacial ]              [ Daemon / Terminal ]           [ Cockpit de Decisão ]
        Maestri                            Orca / Xirp                      FROTA
  ────────────────────             ─────────────────────           ──────────────────────
  • Espaço visual infinito         • Wrapper de terminal/tmux      • Fio cronológico único
  • Nós com chat/terminal          • Foco em TUI e streaming raw   • Alta densidade sem ruído
  • Anexos arrastáveis             • Sem abstração de produto      • Foco em decisão humana
  • Demos espetaculares            • Complexidade de sincronismo   • Governança de custo
  • Risco: dispersão mental        • Risco: terminal glorificado   • Vence na concentração
```

### 1.1 Maestri e Maestri Chat (themaestri.app)
- **Tese:** Canvas infinito nativo em Swift/Metal ("Liquid Glass") para macOS.
- **O que lançou em setembro/2026:** O **Maestri Chat**, uma camada de chat conversacional desenhada sobre os nós de terminal no canvas. Ao teclar `/` ou `CMD-J`, o card vira e revela o terminal real.
- **Destaques:**
  - *Multi-threading cromático:* Até 7 slots de conversa por card, identificados por cores, com o comando CLI `maestri recall` (recupera histórico por data/hora e permite hot-swap de agentes no meio do caminho).
  - *Anexos ricos no chat:* Gera vídeos, modelos 3D e arquivos Markdown que podem ser arrastados para a tela infinita.
  - *Medidor de assinaturas no dock:* Painel que exibe limites de planos por assinatura flat (Claude Code Max sessão 5h e semanal, Codex Pro Lite, Antigravity) com contagem regressiva para reset.
  - *Quote-reply no feed:* Tooltip flutuante `❝ Citar` ao selecionar qualquer trecho de texto.
  - *Modo Maestro:* Agentes orquestradores criando subagentes em múltiplos workspaces.
  - *Maestri Remote:* Companion para iPhone que espelha os 7 slots e o estado recolhido do terminal.
- **Onde falha:** O canvas infinito é sedutor em demonstrações, mas no trabalho diário vira um sumidouro de tempo com janelas flutuando desordenadas.

### 1.2 Orca (stably.ai)
- **Tese:** Wrapper de terminal em Electron + React com daemon Node e emulador headless `@xterm/headless`.
- **Destaques:**
  - *Medição de rate-limits sem custo:* Pipeia JSON da statusline do Claude Code e faz RPC de leitura no Codex. Separa cota de janela de uso do custo financeiro em dólares.
  - *Registry tipado com 6 modos de injeção:* Trata o pré-preenchimento de composer diferentemente do envio e grava previamente o trust da pasta (`preflightTrust`).
  - *Confiabilidade obsessiva:* `reliability-gates.jsonc` com 11k linhas e baselines de ratcheting (só descem).
- **Onde falha:** Reimplementou o tmux em TypeScript (~200 arquivos) e sofreu dezenas de incidentes com corrida de PTY e estouro de memória.

### 1.3 Paseo (getpaseo)
- **Tese:** Monorepo AGPL com daemon local e cliente único em Expo/React Native rodando em Desktop (Electron), Web e Mobile.
- **Destaques:**
  - *Doutrina de design afiada:* Distinção clara entre superfície de Leitura (largura máxima de 720px) e superfície de Trabalho (largura total). Alinhamento por glifos, não por caixas delimitadoras.
  - *Provedores ACP por configuração:* Adição de agentes compatíveis com o protocolo ACP via arquivo JSON, sem recompilar o app.
  - *Adoção de sessões externas:* Não tenta capturar processos em execução; lê o histórico nativo (JSONL) após o término e o importa.
- **Onde falha:** Paga um imposto técnico gigantesco pela arquitetura de cliente único em React Native (webview reparentada à mão, emulador de terminal fragmentado em 3 plataformas).

### 1.4 Xirp (Spotify)
- **Tese:** App interno em Electron com PGlite (Postgres in-process) e daemon de suporte.
- **Destaques:**
  - *Hooks fail-open:* Scripts leves injetados no Claude/Codex para push de status sem polling pesado, com aprovação de permissões síncrona na UI (`permissionRequest`).
  - *Worktrees por tarefa:* Isolamento total em branches temporárias com limpeza pareada ao término da sessão.
  - *Sem navegador embutido:* O Spotify lançou sem webview de navegador, validando que inspecionar código não exige um Chrome completo dentro da ferramenta.

---

## 2. Diagnóstico do Estado Atual do Frota

O Frota passou por uma série de consolidações maduras nos últimos 60 dias:

1. **Arquitetura Enxuta e Fiel (ADR-037 e ADR-185):**
   - O produto foi deliberadamente encolhido para duas superfícies essenciais: **Painel** (visão geral, auditoria de custos, mapa de sessões) e **Trabalho** (o fio conversacional e a aba de Alterações).
   - A remoção cirúrgica da aba SDD/Features eliminou mais de 4.000 linhas de código complexo e escrita no disco do usuário, aliviando o cognitive load.
2. **Fluidez Extrema no Fio (ADR-290 e ADR-291):**
   - A física de scroll com mola e pista de ancoragem elimina trepidações e saltos de tela durante o streaming.
   - O reparse memoizado por blocos (F3) garante que turnos gigantescos não degradem a performance em O(n²).
3. **Integração Real com Git e PRs (ADR-292):**
   - A aba Alterações agora identifica o PR aberto da branch ativa, exibe o status dos checks de CI e oferece botão rápido de retorno à main pós-merge.
4. **Verdade na Compactação (ADR-196):**
   - A prova da compactação de contexto agora lê os limites reais do CLI e mostra com honestidade o antes e o depois no fio.
5. **Agnosticismo por Mecanismo:**
   - 5 motores suportados via registry de Capabilities tipado, sem checagem de string de fornecedor no código genérico.

---

## 3. Avaliação Estratégica: Os Rumos do Frota Estão Bons?

**Sim, os rumos são extremamente sólidos.** O posicionamento como **cockpit de decisão local-first** (compra única, Mac/Linux, sem telemetria, priorizando foco e clareza sobre teatro visual) é exatamente o oposto da armadilha de commodity em que o mercado caiu.

### Por que nossa tese vence:
- **Fio Único vs. Canvas Infinito:** O desenvolvedor que está resolvendo um bug complexo ou refatorando um subsistema precisa de uma linha do tempo vertical límpida, com histórico que recolhe e nós de pensamento recolhidos. O canvas do Maestri funciona bem para olhar; o fio do Frota funciona para trabalhar e decidir.
- **Decisão Humana vs. Autonomia Cega:** Enquanto concorrentes promovem "agentes orquestrando agentes sem você mover um dedo", a realidade das empresas em 2026 é o pânico com contas de milhares de dólares geradas por loops autônomos fora de controle. O modelo do Frota (fail-closed, gates explícitos, aprovação humana prévia) é a resposta certa para ambientes profissionais.
- **Eficiência Nativa (Rust + Tauri + SQLite):** Consome dezenas de megabytes de RAM em vez dos 500 MB a 1 GB dos concorrentes em Electron com tmux embutido.

No entanto, há **lacunas evidentes e oportunidades urgentes** onde os concorrentes avançaram e o Frota ainda não colheu o fruto.

---

## 4. Matriz de Ações para o Frota

Abaixo está o direcionamento detalhado e categorizado:

```
┌────────────────────────────────────────────────────────────────────────┐
│                   MATRIZ DE PRIORIDADES DO FROTA                       │
├───────────────────────────┬────────────────────────────────────────────┤
│ FAZER (Gaps Críticos)     │ MELHORAR (Refinamento de Valor)            │
│ • Governança Ativa ($)    │ • Decisões no Painel no topo (R11)         │
│ • Medidor de Tempo Reset  │ • Agendamentos com precheck (R7)           │
│ • Quote-Reply ("Citar")   │ • Companion com ações de aprovação         │
│ • Cards de Artefatos      │ • Worktree por sessão paralela (R4)        │
│ • Compactar sem humano    │ • Escala geométrica de botões              │
├───────────────────────────┼────────────────────────────────────────────┤
│ REFAZER (Substituições)   │ DELETAR / EVITAR (Anti-Padrões)            │
│ • Sugestões de fim de     │ • Não criar Canvas Infinito espacial       │
│   turno (resumo 1 frase)  │ • Não reimplementar tmux / daemon pesado   │
│ • Sentinelas {{{prompt}}} │ • Não permitir delegação autônoma cega     │
│   no adapters.rs          │ • Não fazer app mobile nativo prematuro    │
└───────────────────────────┴────────────────────────────────────────────┘
```

---

### A. O que precisa ser FEITO (Novas Features)

#### 1. Governança Ativa de Gastos (Budget Guard) — Prioridade Máxima
- **O Problema:** O Painel do Frota hoje é uma retrospectiva ("você gastou US$ 42 hoje"). Em 2026, a maior dor do mercado é o pânico com custos descontrolados.
- **A Solução:** Sair da retrospectiva para o governo ativo.
  - Teto configurável por projeto/dia e por missão (ex.: US$ 10/dia ou US$ 25/missão).
  - Três reações escolhidas pelo usuário: (1) avisar com destaque; (2) exigir confirmação manual para continuar o turno; (3) interromper imediatamente.
  - Projeção viva: *"No ritmo desta sessão, o dia fechará em ~US$ X"*.

#### 2. Medidor de Quotas por Tempo de Reset no Dock/Rodapé
- **A Lição do Maestri e Orca:** Quem assina Claude Code Max, Antigravity ou Codex paga mensalidade fixa e não se importa primariamente com centavos de dólar. A dor diária é saber quando a cota do plano volta a ficar disponível.
- **A Solução:** Exibir no indicador de status o tempo de reset (ex.: *"Sessão: 14% · Redefine em 2h"* e *"Semanal: 65% · Redefine em 4 dias"*), permitindo planejar tarefas pesadas sem interrupções surpresas.

#### 3. Citação Contextual no Fio (`❝ Citar`)
- **A Lição do Maestri:** Ao selecionar qualquer trecho de texto no feed com o cursor, surge um tooltip flutuante discreto com o botão `❝ Citar`.
- **A Solução:** Clicar no botão insere o bloco no composer com referência à mensagem de origem. Uma resposta cirúrgica sem a complicação de sub-threads aninhadas estilo Slack (M3 do `docs/competitors-maestri.md`).

#### 4. Cards de Artefatos Gerados no Fio
- **O Problema:** Quando o agente gera uma entrega (vídeo de teste do Playwright, especificação Markdown, diagrama, arquivo de migração), a saída fica enterrada em texto de terminal ou no meio do transcript.
- **A Solução:** Renderizar um card visual limpo no fim da mensagem com ícone do tipo de arquivo, nome, tamanho em disco e botão rápido para abrir direto no VS Code, Zed ou pasta (`vscode://file/...`, `open -a`).

#### 5. Compactação Automática em Modo Desassistido (I3)
- **O Problema:** Em missões longas, tarefas agendadas ou execuções em segundo plano (`ehDesassistido()`), o contexto bate em 100% e o processo morre esperando um Enter que o humano ausente não dará.
- **A Solução:** O pipeline de compactação com prova do ADR-196 deve ser acionado automaticamente quando não houver humano presente, emitindo a medição e continuando o trabalho de forma autônoma e segura.

#### 6. Adotar Sessão Externa do Terminal
- **A Lição do Paseo:** O painel "Sessões fora do app" (ADR-118) hoje só consegue monitorar e matar processos externos.
- **A Solução:** Se o agente possuir a capability `sessionResume` (como o Claude Code com `--resume`), permitir o botão "Adotar", trazendo a conversa do terminal para o Frota sem quebrar o histórico.

---

### B. O que precisa ser MELHORADO

#### 1. Frota Companion: De Espectador a Decisor Remoto
- **Onde está:** O Companion web pareado via LAN permite ler o transcript e ver o andamento do Mac pelo celular.
- **O que precisa:** Trazer os **três botões de decisão essenciais**:
  1. Aprovar ou recusar solicitação de permissão bloqueante (`allow`/`deny`).
  2. Responder às perguntas do agente (`ask_question`).
  3. Ver o diff de arquivos alterados e tocar para pausar o agente em caso de deriva.
- **Arquitetura:** Manter como PWA local via LAN (com opção de Tailscale). Nada de abrir mão do pareamento com aceite local nem criar servidores de push na nuvem.

#### 2. Rebalanceamento do Painel de Decisões (R11)
- **Onde está:** O Painel abre dando destaque gigantesco para "GASTO HOJE" em tipografia dominante, enquanto a caixa de decisões pendentes fica encolhida em segundo plano.
- **O que precisa:** O Frota é um cockpit de decisão: se há disputas, propostas ou revisões esperando o humano, elas devem ocupar a primeira dobra visual. O custo é informação de apoio, não a estrela principal.

#### 3. Automações e Agendamentos com Tratamento de Falhas (R7)
- Adicionar comando de **precheck** (executa um script rápido antes para conferir se vale acordar o agente, ex.: `git status --porcelain`).
- Adicionar política de **execução perdida** (se o Mac estava em repouso no momento exato do cron, executar uma única vez ao despertar, dentro de uma janela de tolerância configurável).

#### 4. Worktree por Tarefa / Sessão (R4)
- Integrar a criação de worktrees git descartáveis vinculadas à conversa ou missão, evitando que agentes paralelos poluam o branch de trabalho principal em que o desenvolvedor está digitando.

---

### C. O que precisa ser REFEITO

#### 1. Sugestões de Fim de Turno e Resumo Operacional
- **Onde está:** Hoje exibimos 3 chips de texto com sugestões curtas de até 6 palavras baseadas em um contexto raso de 6 mensagens.
- **O que refazer:** Adotar o conceito fundamental do "Ombro" do Maestri: gerar 1 frase síntese de alta fidelidade dizendo exatamente o que o agente fez (ex.: *"Refatorou o módulo de checkout adicionando chave de idempotência e 4 testes unitários"*). Essa frase deve ser o corpo das notificações no macOS, no sino da bandeja e no Companion.

#### 2. Normalização do Despacho de Comandos nos Adapters
- **Onde está:** `adapters.rs` acumula matrizes manuais e casos especiais para montar a linha de comando de cada CLI.
- **O que refazer:** Adotar a convenção da sentinela `{{{prompt}}}` (lição do Paseo). O registro de cada motor declara exatamente a posição do prompt e descarta argumentos vazios quando não há injeção de texto, limpando centenas de linhas de código frágil.

---

### D. O que precisa ser DELETADO / EVITADO

#### 1. EVITAR: Canvas Infinito e Gestão Espacial
- **Por quê:** O modelo do Maestri é chamativo para marketing, mas é o oposto do que um desenvolvedor sênior necessita em sessões de refatoração ou depuração. Não divida a atenção do produto tentando virar um Figma de agentes.

#### 2. EVITAR: Reimplementação de Daemon de Terminal / tmux em TypeScript
- **Por quê:** O custo de manutenção pago pelo Orca foi brutal. O modelo do Frota (processos controlados diretamente pelo backend Rust com adapters que consomem stream JSON estruturado) é infinitamente mais limpo, previsível e leve.

#### 3. EVITAR: Delegação Livre Agente-a-Agente sem Freio Humano
- **Por quê:** O "Modo Maestro" do Maestri permite que agentes criem recrutas e deleguem tarefas uns aos outros livremente. Isso viola a regra de ouro do Frota ("A decisão é humana"). Não adote despacho cego entre agentes.

#### 4. EVITAR: Aplicativo Nativo de Celular (React Native/Expo) na App Store
- **Por quê:** O Paseo provou a armadilha de tentar rodar a mesma base em desktop e mobile. Nosso Companion em PWA atende a totalidade dos casos de uso reais (monitorar da cozinha ou da sala enquanto o Mac compila no escritório), sem a burocracia e custos de manutenção da App Store.

#### 5. DELETAR: Resíduos Textuais e Órfãos do SDD e do Escritório
- Varrer periodicamente arquivos de documentação antigos e comentários de código que ainda citem as superfícies podadas, mantendo o vocabulário restrito a **Painel** e **Trabalho**.

---

## 5. Resumo Executivo e Próxima Sprint Recomendada

O Frota está no caminho certo e tem uma identidade de produto muito mais defensável que a dos concorrentes. O momento agora não é de inventar um novo paradigma visual, mas de **colocar dentes na proposta de valor**:

| Prioridade | Iniciativa | Impacto | Esforço |
|---|---|---|---|
| **P1** | **Budget Guard (Teto de Custo Ativo com Freio)** | Altíssimo (diferencial de mercado) | Médio |
| **P2** | **Medidor de Quotas por Tempo de Reset no Dock** | Alto (dor real de quem usa Claude/Antigravity) | Baixo |
| **P3** | **Quote-Reply (`❝ Citar`) no Fio** | Alto (ergonomia diária comprovada no Maestri) | Baixo |
| **P4** | **Decisão Remota no Companion (Aprovar / Responder / Diff)** | Alto (fecha o ciclo de monitoramento mobile) | Médio |
| **P5** | **Compactar sem Humano em Background (I3)** | Médio-Alto (estabilidade de missões longas) | Baixo |
