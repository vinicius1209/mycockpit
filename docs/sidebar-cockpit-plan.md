# Sidebar do cockpit, arquivos e memória operacional da conversa

> Status: primeira entrega implementada e validada por testes em 03/09/2026;
> inspeção visual no aplicativo promovido ainda pendente.
> Origem visual: `docs/mocks/sidebar-cockpit-mock.html`.
> Correção de escopo: o mock foi versionado, mas as abas Arquivos e a meta da
> conversa não chegaram ao app. O próprio mock ainda marcava a implementação
> modular como próximo passo. Este plano descreve o produto real, não declara o
> HTML de validação como entrega.

> **Correção de produto, 04/09/2026:** a primeira implementação de Arquivos
> agrupou caminhos pela primeira pasta e abriu o conteúdo dentro da coluna.
> Isso não é um explorador de arquivos. O contrato corrigido é uma árvore real,
> hierárquica e expansível, no padrão de Zed e VS Code. A coluna funciona como
> índice; clicar num arquivo abre uma aba transitória no palco principal, pela
> mesma fronteira já validada por Alterações. Código recebe realce de sintaxe,
> Markdown é renderizado e imagens compatíveis ganham pré-visualização segura.
> Este bloco substitui os itens divergentes do plano original abaixo.

## O problema

O painel direito atual reúne contexto do projeto, alterações e a checklist do
último plano. Em conversas longas, isso responde onde o trabalho tocou e quais
etapas o agente publicou, mas não responde rapidamente três perguntas básicas:

1. qual pedido abriu esta conversa;
2. onde ela ficou no último turno concluído;
3. quais arquivos reais existem no projeto.

O resultado é perda de orientação. A pessoa precisa reler o fio para recuperar
o norte, e precisa sair da conversa para consultar um arquivo que já faz parte
do contexto do trabalho.

## Contrato de verdade

As informações têm donos diferentes e não podem ser fundidas num “resumo de IA”
sem proveniência:

| informação | fonte | comportamento |
|---|---|---|
| Pedido inicial | primeiro item `user` da conversa | texto original, apenas encurtado visualmente |
| Título | metadado persistido da conversa | identificação curta, não substitui o pedido |
| Estado atual | último plano derivado de `TaskCreate`/`TaskUpdate` | nenhuma etapa ativa é inventada |
| Último checkpoint | última resposta textual encerrada por `result` | fonte e horário visíveis; streaming parcial não vira checkpoint |
| Trabalho em segundo plano | `DeferredWork` ainda vivo | some quando deixa de estar vivo; replay interrompido não aparece rodando |
| Arquivos | `list_project_files` do backend | respeita `.gitignore`, tem limite e nunca lista árvore fictícia |

Nesta primeira entrega não existe um campo novo de “meta consolidada”. A pessoa
vê o pedido inicial e o checkpoint observado. Uma meta editável exige uma ação
humana própria e persistência versionada; entra numa etapa posterior, sem ser
inferida nem sobrescrita pelo agente.

## Composição

Ordem das abas: **Arquivos, Plano, Alterações, Contexto**.

### Arquivos

- busca pelo caminho;
- árvore hierárquica real, com pastas expansíveis, ordenação natural e navegação
  por teclado;
- a coluna só indexa; seleção abre uma aba transitória no painel principal;
- Markdown usa o renderer canônico, código usa fonte monoespaçada e realce de
  sintaxe, PNG, JPEG, GIF, WebP, BMP e ICO usam visualização de imagem;
- imagens chegam por IPC binário, com teto de bytes e validação de dimensões
  antes da decodificação;
- falha de leitura é mostrada na superfície, nunca engolida.

### Plano

- **Norte da conversa:** título e trecho do pedido inicial;
- **Último checkpoint:** última resposta realmente concluída, com horário;
- **Etapas:** `TaskChecklist` canônico, sem uma segunda representação do plano;
- **Trabalho em segundo plano:** somente itens ainda vivos.

O checkpoint é orientação, não substituto do transcript. O conteúdo completo
continua a um gesto, na conversa.

### Alterações e Contexto

Permanecem com seus donos atuais. A nova navegação só os reposiciona na tira de
abas; não reimplementa diff, doutrina, memória, missões nem permissões.

## Implementação modular

1. Extrair a projeção pura da conversa para `lib/conversationBrief.ts`, com
   fixtures reais de itens e testes para impedir streaming ou erro de parecerem
   checkpoint concluído.
2. Criar `ConversationPlanPanel.tsx`, consumidor da projeção e da checklist
   existente.
3. Criar `ProjectFilesPanel.tsx` como árvore e índice, consumidor apenas de
   `listProjectFiles`; criar a variante `arquivo` de `MainTab` e o leitor largo
   no palco principal.
4. Acrescentar `arquivos` ao estado efêmero `ContextPanelTab` e integrar os dois
   painéis sem aumentar o arquivo monolítico `ContextPanel.tsx`.
5. Cobrir a ordem e os rótulos das abas, os estados vazio/erro e os call sites
   do estado compartilhado.

## Fora desta entrega

- gerar resumo por modelo automaticamente;
- persistir meta editável sem confirmação humana;
- edição de código ou terminal na sidebar;
- inventar atividade de arquivo com base no foco da UI;
- editar o arquivo dentro do visualizador, que permanece somente leitura.

## Validação

- `cd app && bun run test`;
- `cd app && bunx tsc -b --force`;
- `cd app && bun run check`;
- `cd app/src-tauri && cargo test`;
- inspeção nos temas claro e escuro, no mínimo de 240 px e numa largura com
  rótulos completos;
- grep dos consumidores de `ContextPanelTab`, `listProjectFiles`,
  `readTextFile`, `deriveTasks` e `pendingDeferred`.
