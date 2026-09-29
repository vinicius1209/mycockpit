# Plano · Estudo do Maestri, lote 2

> **Status (29/09/2026):** E1 e E2 entregues. Decisões respondidas (tabela no fim).
> Mock canônico: `docs/mocks/maestri-lote-2.html`. Origem: §11 de
> `docs/prototipos-maestri-plan.md` e o estudo
> `docs/competitors-maestri-2026-09-27.md`.

## Regras que valem para todas as etapas

- Agnosticismo: nada compara nome de motor; o que depende de motor pergunta ao
  registry (`adapters.rs` e `lib/agents.ts`), com teste-gêmeo.
- Estado real: nada inventado (cota sem leitura não aparece, arquivo que sumiu
  diz que sumiu, segredo que não abriu não é pulado em silêncio).
- A decisão é humana: o agente pode pedir; quem abre acesso é a pessoa.
- Cada etapa fecha com `bun run test`, `bunx tsc -b --force`, `cargo test`,
  `bun run check`, ADR quando for estrutural, e commit por etapa.

## E1 · F1, a cota no Companion (P) · ✅ entregue

O painel do app fica como está (decisão da pessoa, 29/09).

1. `lib/companionPlanos.ts`, puro: a pior janela de cada motor pela MESMA
   regra da faixa (`planosDaFaixa`), com o texto pronto (nome do motor, janela,
   percentual, "volta às 18:00") e o tom da régua (`usageTone`).
2. Snapshot: campo `planos` em `CompanionSnapshot`, montado no builder; a
   ponte passa a acordar também com o store de uso.
3. Página: faixa no topo do início, abaixo do pulso, só com leitura fresca. Sem
   leitura, a faixa não existe. Só leitura: nenhuma ação nova.
4. `sw.js` com versão nova; `companion/AGENTS.md` atualizado (formato do
   snapshot).

Aceite: com Claude em 72% da sessão, o celular mostra "Claude · 5h · 72% ·
volta às 18:00" em âmbar; motor sem leitura fresca some; teste do builder e do
núcleo puro.

## E2 · F6, Mermaid no fio (P) · ✅ entregue (ADR-284)

1. Bloco ` ```mermaid ` no `Markdown`, com import dinâmico da lib só quando o
   bloco aparece e tema neutro com os tokens do app.
2. Cabeça do bloco: "Código", "Copiar fonte", "Copiar imagem" (PNG 2×).
3. Erro de compilação: código com a linha do erro, nunca tela quebrada.
4. Notas (ADR-270) pelo mesmo componente.

Aceite: diagrama real renderiza; sintaxe inválida mostra a linha; o bundle
principal não cresce (a lib vira chunk próprio).

## E3 · Tamanho da página no navegador da Frota (M) · depende de D8 e D9

1. Rust: viewport por projeto por CDP (`Emulation.setDeviceMetricsOverride`,
   toque e user agent no modo "como celular"), guardada por projeto; o padrão
   continua 1280×800 (ADR-229).
2. Seletor na barra do navegador: cinco tamanhos, personalizado e girar; o
   quadro se ajusta ao espaço e diz a medida.
3. Ferramenta `browser_resize` no `frota-browser`, visível no fio (D9).
4. Emulação completa (D8): `setDeviceMetricsOverride` com `mobile` e
   `deviceScaleFactor`, `setTouchEmulationEnabled`, `setUserAgentOverride`
   com a plataforma, orientação em `screenOrientation`; o toque do quadro vira
   evento de toque na página quando o modo celular está ligado.

Aceite: página responsiva real muda de layout no celular; o agente captura a
mesma viewport; reabrir o projeto mantém o tamanho.

## E4 · F5, entrega declarada (M) · depende de D5 e D6

1. Ferramenta `deliver` no `frota-work` (caminho e frase), conferida no disco.
2. Cartão do G1 no fim do turno com a frase; declarada substitui a inferida no
   turno em que existir (D5). Sem linha "Entregou" no grupo de ações e sem
   seção na aba Conversa (decisão da pessoa, 29/09).
3. "Não está mais no disco" conferido na hora de mostrar.
4. Comando Rust que abre só documento (resolve também o `openPath` do
   `ProjectFileViewer`), se D6 = sim.

## E5 · F4, @conversa (G) · depende de D1, D2, D3 e D13

1. Menu do `@`: seção "Conversas", só do mesmo projeto (D1), e o item
   "Todas as conversas deste projeto" (D13).
2. Envio: a concessão de leitura vai no plano do turno, uma lista de ids.
3. MCP de contexto: `context_search` e `context_read` aceitam a conversa da
   concessão, e só ela; fora dela, recusa com motivo.
4. "O que o agente vê" e o recibo dizem quais conversas foram citadas.

Aceite: sem citação, nada muda (teste que segura o filtro atual); com
citação, busca e leitura da citada funcionam e a de outra é recusada.

## E6 · F8, segredos no Keychain (G) · depende de D10, D11 e D12

1. Seção "Segredos" em Configurações › Deste projeto; valor no Keychain (Secret
   Service no Linux), nome no banco.
2. No turno: variável de ambiente do processo, em todos os motores; os nomes
   entram na doutrina.
3. Máscara por valor no fio, nos Bastidores, no log e no Companion, e no banco
   já mascarado.
4. Fail-closed: segredo que não abre segura o envio com o aviso da tira.

## Decisões (respondidas em 29/09/2026)

| # | decisão |
|---|---|
| D1 | Só conversas do MESMO projeto no menu do `@`. Outros projetos ficam fora. |
| D2 | Busca e leitura pelo MCP de contexto, não resumo colado (eficiência). |
| D3 | Sem limite de citações por envio: citar muitas é escolha de quem cita. |
| D5 | A entrega declarada substitui a inferida no turno em que existir. |
| D6 | Entrega fora do projeto é aceita, com o comando Rust que abre só documento. |
| D7 | Mermaid no fio e nas notas agora; Companion depois. |
| D8 | Tamanho guardado por projeto, padrão 1280×800. O navegador da Frota simula um navegador de verdade: a emulação tem de ser completa e funcional (viewport, escala de tela, toque, user agent de celular, orientação), não só a janela menor. |
| D9 | Sim: o agente muda o tamanho por ferramenta, visível no fio. |
| D10 | Por projeto, todos os motores. |
| D11 | Sim. Os VALORES vão como variável de ambiente do processo a cada turno (custo zero de token). Os NOMES seguem a cadência da doutrina (`shouldInjectDoctrine`, `lib/doctrine.ts`): motor que retoma sessão sem canal de sistema recebe só no 1º turno e de novo se a lista mudar; com canal de sistema vai no canal, fora do prompt; motor sem retomada precisa a cada turno, porque cada turno é sessão nova. |
| D12 | Manter "Enviar sem este segredo", valendo só para aquele envio. |
| D13 | A busca em todas as conversas do projeto existe só quando mencionada: um item "Todas as conversas deste projeto" no menu do `@`, por envio. Sem menção, nada muda. |
