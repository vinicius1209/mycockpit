# PRD, Configurações que se explicam

> Status: **entregue** (F1 a F4), ADR-268 em `docs/decisions.md`. Mock em
> `docs/mocks/configuracoes.html` (a proposta aprovada em 26/09/2026).
> Origem: 26/09/2026. O Agy não nomeava a conversa no primeiro turno, e a causa
> era um cadastro (`frota-work`) que a pessoa não achou nas Configurações.
>
> **Correção de 26/09, na entrega:** três pontos saíram diferentes do texto
> abaixo. (1) "Todos os motores" continua existindo como primeira página do
> grupo Motores: é para onde o guia de setup e o sino levam quando a pergunta
> é "quais CLIs existem aqui". (2) O modelo auxiliar por projeto e as pastas
> permitidas **não** foram para a zona do projeto; seguem no painel de
> contexto. (3) A tabela MCP × motor do mock não foi redesenhada: a lista
> existente já é uma linha por MCP com um chip por motor, e ela só perdeu os
> internos e os blocos repetidos.

## 1. O problema, nas palavras de quem usa

> "mas não vejo o frota-work aqui listado como MCP nas configurações que temos"
>
> "isso? meu deus que confuso hein, na verdade acho tudo aqui nessa parte de
> configurações muito confuso"

O incidente é pequeno, e por isso serve de medida. Para descobrir por que um
motor não fazia uma coisa que o outro faz, foi preciso ler o
`~/.gemini/config/mcp_config.json`, o `agent.rs` e a transcrição do Agy. A tela
que deveria responder a pergunta tinha o botão certo, mas escondido no rodapé,
com um nome que não bate com o aviso que mandou a pessoa até lá.

## 2. Evidência

Mapa atual: **20 seções em 7 grupos** (`app/src/components/settings/sections.ts`).

| # | achado | onde |
|---|---|---|
| E1 | O conserto do título do Agy (`frota-work`) é um cartão **abaixo** da lista de 11 MCPs e do inventário. O aviso do turno manda para "Configurações > MCPs", e lá o `frota-work` não é uma linha da lista. | `McpSettings.tsx:544`, `agent.rs:614` |
| E2 | Um motor fica espalhado em até **5 seções**. Deixar o Agy completo pede: Agentes na máquina (CLI e login), Modelos, MCPs (acompanhamento), Navegador e desktop (`frota-browser`, `frota-desktop`) e Sessões no terminal (hooks). Nenhuma delas responde "o Agy está pronto?". | `sections.ts`, `WorkMcpSettings.tsx`, `NavegadorPorMotor.tsx`, `ComputadorPorMotor.tsx`, `HooksSettings.tsx` |
| E3 | Os canais internos da Frota aparecem de **três jeitos**: `frota-approval` e `frota-context` são linhas "interno" na lista de MCPs, `frota-work` é um cartão no rodapé, e `frota-browser` e `frota-desktop` são cartões em outra seção. No inventário, os três aparecem ainda como MCPs comuns do agy. | `McpServerRow.tsx:29`, `ProviderMcpInventoryPanel.tsx:48` |
| E4 | A mesma lista de MCPs aparece **três vezes** na mesma página: linhas com pílulas por motor, o cartão de acompanhamento e "Estado nos providers", que repete tudo agrupado por motor. | `McpSettings.tsx` |
| E5 | O ponto de atenção do rail só acende para **login de CLI faltando** e **gh sem conta**. Canal da Frota desconectado, MCP pedindo login e permissão do sistema faltando nunca acendem nada. | `sections.ts:400` |
| E6 | Escopo misturado. É um modal global, mas três seções (MCPs, Navegador e desktop, Skills e plugins) têm seletor de projeto próprio, cada uma com seu estado. O modelo auxiliar vale por projeto via `.frota/config.toml`. Parte da configuração de projeto vive fora do modal, no painel de contexto. | `LocalResourcesSettings.tsx`, `ExtensionsSettings.tsx`, `helperDoProjeto.ts`, `ContextoDoProjeto.tsx` |
| E7 | "Sugestões" esconde o **modelo auxiliar**, que também nomeia a conversa, escreve o recibo da notificação, destila as lições do feedback no fio, rascunha skill pela paleta, roda nas missões e decide os chips do composer. O título da seção descreve 1 dos 7 usos. | `SettingsDialog.tsx:452`, consumidores de `helperDoProjeto` |
| E8 | Textos que **citam caminhos que não existem mais**: a pasta de config e a de Especialistas com o nome antigo do produto (hoje são `.frota/config.toml` e `.frota/agents`; a pasta legada só é lida como fallback). | `SettingsDialog.tsx:458`, `PresetSettings.tsx:212,270`, `EspecialistaCreateView.tsx:178,413`, `frota_dir.rs:25` |
| E9 | Vocabulário do código na tela: binding, stdio, provider, run, "materialização forte por run", fingerprint, capability, ledger, "depende do provider", "Cadastro confirmado no CLI". | `LocalResourcesSettings.tsx:109,120`, `lib/tooling.ts:210`, `workMcpSetup.ts` |
| E10 | Grupo com uma seção só (Extensões, App), e grupo com seis seções sem nada em comum (Conversas: padrões, automação, Especialistas, helper, ditado, missões). | `sections.ts` |

## 3. Princípio

**Configurações responde perguntas da pessoa, não espelha camadas do código.**
São três perguntas, nesta ordem:

1. *Tem algo esperando por mim?* (gesto pendente, primeiro)
2. *Este motor está pronto para trabalhar?* (um lugar por motor)
3. *Como eu quero que o app se comporte?* (preferências, sem pressa)

Consequência: o que é **da Frota** (canais internos, sondas, cadastros) aparece
como um **estado do motor**, nunca como item na lista de ferramentas da
pessoa.

## 4. Decisões propostas

- **D1. Uma página por motor**: Claude Code, Codex, Antigravity e OpenCode,
  cada um com um checklist do que a Frota precisa dele: instalado, conta
  conectada, canal da Frota (acompanhamento, navegador, controle do computador),
  sessões no terminal, e os modelos dele. Cada linha diz o estado e traz o gesto.
  Motor que recebe canal por turno mostra "automático, a cada turno" e não tem
  botão. O motor de cadastro global mostra "Conectar". **É o que teria resolvido
  o incidente em um clique.** Deriva de `Capabilities` (`work_mcp_global_env`
  etc.), nunca do nome.
- **D2. "Precisa de você" abre Configurações**: uma lista curta com todo gesto
  pendente, cada item com o botão que resolve. Quando não há nada, uma linha
  diz isso. O ponto do rail passa a ler a mesma fonte (fecha E5).
- **D3. MCPs lista só os MCPs da pessoa**: uma tabela, MCP × motor, com a
  origem (`codex · usuário`) como coluna e sem o bloco repetido. Canais da
  Frota saem daqui e vão para D1. `frota-approval` e `frota-context` somem da
  lista: são por turno e ninguém liga ou desliga (fecha E3, E4).
- **D4. Escopo na cara**: o rail se divide em **Neste Mac** e
  **No projeto ▾**. Um seletor só, no topo do bloco de projeto. Tudo que vale
  por projeto mora ali: MCPs do projeto, Skills, navegador do projeto, modelo
  auxiliar do projeto, pastas permitidas. Nenhuma seção tem seletor próprio
  (fecha E6; segue a memória "escopo explícito em Configurações").
- **D5. "Sugestões" vira "Modelo auxiliar"**, e a página lista para que ele
  serve (sugestões, nome da conversa, recibo da notificação, lições, missões). Desligado, ela diz o
  que deixa de acontecer (fecha E7).
- **D6. Copy**: glossário de troca, aplicado em todas as seções, e os caminhos
  corrigidos para `.frota/` (fecha E8, E9).

| hoje | proposta |
|---|---|
| binding | ligação (MCP ligado a um motor) |
| provider | motor, ou o nome dele |
| run | turno |
| stdio / http | só no detalhe da linha, nunca na lista |
| "Cadastro confirmado no CLI" | "Conectado" |
| "Acompanhamento não conectado" | "Não conectado: sem título automático, plano e etapas" |
| "depende do provider" | "o motor decide" |
| "materialização forte por run" | (sai; diz o que a pessoa pode fazer) |

## 5. Nova arquitetura

```
Precisa de você            (só aparece com pendência; senão vira uma linha)

NESTE MAC
  Você        Perfil · Aparência · Ditado · Barra de menus
  Motores     Claude Code · Codex · Antigravity · OpenCode · Modelos e preços
  Uso e custo
  Conversas   Novas conversas · Especialistas · Modelo auxiliar
  Automação   Vigias e automação · Missões (beta)
  Segurança   Confinamento · Permissões do computador
  Conexões    Serviços (GitHub) · Companion
  Sobre

NO PROJETO  [frota ▾]
  MCPs · Skills e plugins · Navegador · Modelo auxiliar · Pastas permitidas
```

"Sessões no terminal" deixa de ser seção: vira uma linha no checklist de cada
motor que tem hooks (capability), que é onde o gesto pertence.

## 6. Requisitos com aceite

- **R1** (D1) Cada motor detectado tem página própria, e o checklist sai de
  capability. *Aceite:* no Agy sem `frota-work`, a linha "Acompanhamento" diz
  "Não conectado" com o botão Conectar, e o Claude diz "automático, a cada
  turno". Teste-gêmeo por capability, nenhum `agent ===`.
- **R2** (D2) "Precisa de você" junta toda pendência de R1, login de MCP e
  permissão do sistema. *Aceite:* o ponto no rail e a lista leem a mesma
  função pura, e o teste cobre os quatro tipos.
- **R3** (D3) A página de MCPs não mostra servidor de origem `interno` nem
  canal da Frota, e não tem mais o bloco de inventário separado. *Aceite:*
  cada MCP aparece uma vez.
- **R4** (D4) Nenhuma seção tem seletor de projeto próprio, e o projeto
  escolhido no rail vale para todo o bloco. *Aceite:* trocar o projeto e ir de
  MCPs para Skills mantém o mesmo projeto.
- **R5** (D4) Deep links antigos (`integrations`, `resources`, `hooks`,
  `suggestions`) continuam chegando pelo mapa de legado de `resolveSection`.
  *Aceite:* nenhum id antigo abre painel vazio.
- **R6** (D6) Nenhuma copy de Configurações cita a pasta com o nome antigo,
  exceto o sufixo real do backup dos hooks, que precisa de decisão
  própria. *Aceite:* `check-marca` desce.
- **R7** O aviso do turno aponta para a página do motor, não para "MCPs".

## 7. Fora do escopo

- Mudar o que cada ajuste faz. Isto só reorganiza onde ele mora e como ele se
  chama.
- Conectar `frota-work` automaticamente. A decisão é humana: o gesto fica mais
  perto, mas continua sendo da pessoa.

## 8. Fatiamento sugerido

1. **F1, barato e isolado:** R6 (copy e caminhos) e R7 (aviso aponta para o
   lugar certo). Não mexe na estrutura.
2. **F2:** D1 e D2 (página por motor e "Precisa de você"). Maior valor; resolve
   a classe do incidente.
3. **F3:** D3 (MCPs só da pessoa).
4. **F4:** D4 (escopo no rail) e nova árvore, com mapa de legado.

## 9. Double check

- Nenhuma decisão compara nome de motor: D1 lê `work_mcp`,
  `work_mcp_global_env`, hooks e as capabilities de navegador e desktop.
- Nada sintetiza estado: cada linha do checklist é leitura real (sondas que já
  existem em `work_mcp_setup.rs`, `detected`, permissões do sistema).
- Não há despacho: "Conectar" continua sendo gesto da pessoa.
