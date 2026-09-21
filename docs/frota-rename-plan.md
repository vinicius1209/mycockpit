# Plano de migração de marca — MyCockpit → Frota

Status: **fase de MARCA VISÍVEL entregue em 22/08/2026** (guarda no CI). Em **21/09/2026 o dono decidiu renomear TUDO**, inclusive identificador, banco e contratos persistidos: ver "A virada de 21/09/2026" no fim, que revoga a matriz de nomes abaixo e a seção "O que NÃO foi feito, e por quê". O texto original fica como história.  
Escopo: marca pública, app, empacotamento, documentação, compatibilidade e ambiente de demonstração

## Decisão

**Frota** passa a ser o nome público e o nome exibido pelo produto. A marca usa o
símbolo do horizonte artificial criado para a landing.

O rename não será uma substituição global de texto. O repositório mistura três
categorias diferentes:

1. **Marca visível** — pode e deve virar `Frota` agora.
2. **Identificadores internos** — podem ser renomeados depois, com aliases.
3. **Contratos persistidos** — precisam permanecer estáveis até existir migração
   testada, porque mudar o nome pode criar um segundo app vazio ou desconectar
   dados, permissões, hooks e integrações existentes.

## Estado atual confirmado

- O `productName` e o título da janela no Tauri já são `Frota`.
- O bundle identifier ainda é `dev.vinicius.mycockpit`.
- O banco é `mycockpit.db` e vive no diretório de dados derivado do bundle id.
- O OAuth MCP usa o serviço de Keychain
  `dev.vinicius.mycockpit.mcp-oauth`.
- O estado web persistido usa a chave `mc.app`.
- O protocolo por projeto usa `.mycockpit/` para contexto, doutrina, agentes,
  missões e comandos.
- Há nomes de integração como `mc-work`, headers `x-mycockpit-*`, formato
  `mycockpit.flight-plan`, scripts de hooks e o sidecar `mycockpit-stt`.

## Matriz de nomes

> **REVOGADA em 21/09/2026.** Toda linha "manter" abaixo virou "renomear". A
> matriz vigente está em "A virada de 21/09/2026", no fim deste documento. Esta
> fica porque o raciocínio dela ainda explica o CUSTO de cada troca, que não
> mudou: só a decisão mudou.

| Superfície | Decisão | Motivo |
| --- | --- | --- |
| Nome público, UI, notificações e landing | `Frota` agora | Marca percebida pelo usuário |
| Símbolo no titlebar e materiais | horizonte artificial | Marca própria, simples e reconhecível |
| `productName` / `Frota.app` | manter `Frota` | Já está correto |
| Bundle id `dev.vinicius.mycockpit` | manter na primeira época | Preserva diretório de dados, permissões e upgrade |
| Banco `mycockpit.db` | manter na primeira época | Evita banco novo/vazio e quebra de readers |
| Keychain MCP | manter e documentar como legado | Preserva credenciais sem pedir novo login |
| localStorage `mc.app` | manter | É um contrato de upgrade, não uma marca |
| `.mycockpit/` | manter como protocolo v1 | Já está espalhado por projetos e handoffs |
| `mc-work` e demais MCPs | manter com alias futuro opcional | Tool names são API pública para agentes |
| sidecar `mycockpit-stt` | manter inicialmente | Nome coordenado entre build, bundle e runtime |
| módulos/variáveis `mycockpit.*` | renomear apenas em limpeza posterior | Não agrega valor de marca agora |

## Fase 0 — contrato e inventário

Objetivo: congelar o comportamento que não pode se perder no rename.

- Adicionar uma lista gerada de ocorrências `MyCockpit`, `mycockpit` e
  `dev.vinicius.mycockpit`, classificada em `marca`, `interno` ou `persistência`.
- Criar uma allowlist para identificadores legados intencionais; qualquer nova
  ocorrência fora dela falha no CI.
- Registrar um fixture de upgrade contendo:
  - banco existente;
  - `mc.app` existente;
  - projeto com `.mycockpit/config.toml`, agentes, comandos e contexto;
  - credencial MCP referenciada pelo serviço antigo;
  - hooks/statusline instalados com os marcadores atuais.
- Salvar checksum e contagens do banco antes/depois do upgrade.

Critério de saída: o rename visual pode acontecer sem tocar nos contratos acima.

## Fase 1 — marca visível

Objetivo: para uma pessoa nova, o produto se chama somente **Frota**.

- Landing, metadados, formulário beta e documentação de entrada.
- Onboarding, configurações, empty states, mensagens, erros, tooltips,
  notificações, tray, menus e labels de acessibilidade.
- README, docs de instalação e screenshots públicas.
- Componente SVG único `FrotaMark`; usar o mesmo desenho no titlebar, onboarding,
  about, landing e tray quando o contraste permitir.
- Gerar os ícones de plataforma a partir de um arquivo mestre versionado:
  PNGs, `.icns`, `.ico` e variantes de tray template.
- Testar o símbolo em 16, 20, 24, 32, 128 e 1024 px, nos temas claro e escuro.

Critério de saída: busca visual e testes de copy não mostram `MyCockpit`, exceto
em uma nota de migração ou caminho técnico explicitamente rotulado como legado.

### Ícones — entregue

O desenho passou a ter uma fonte só, e as quatro superfícies saem dela.

**Fonte de verdade:** `scripts/brand/frota_mark.py` guarda a geometria no mesmo
espaço 44 x 44 do `FrotaMark.tsx` (círculo r=20, horizonte, mastro, barra) mais
duas réguas: nível de detalhe por tamanho de render e peso de traço por tamanho.
`scripts/brand/gen_icons.py --write` escreve todos os ativos; `--preview DIR`
gera as folhas de contato usadas para decidir. Só Pillow (já instalado) e
`iconutil` (nativo); nenhuma dependência nova entrou.

**Régua de detalhe.** O símbolo cheio precisa de espaço: o horizonte (y=24,5) e
a barra (y=29) ficam a 4,5 unidades um do outro, então abaixo de ~96 px de
símbolo eles encostam. O desenho perde elementos de baixo para cima, nunca o
círculo e o horizonte: cheio ≥ 96 px · sem barra 32–96 px · só círculo e
horizonte < 32 px.

| Superfície | Arquivo | O que mudou |
| --- | --- | --- |
| Dock/Finder/Cmd+Tab | `icons/{32x32,64x64,128x128,128x128@2x,icon}.png`, `icon.icns`, `icon.ico` | Squircle grafite (gradiente `#22262c` → `#0b0d11`) com o símbolo em brass `#e4a862`, fio de luz de 10% na borda e sombra própria a partir de 64 px |
| Barra de menus | `icons/tray-template.png` (36) e `@2x` (72) | Template de verdade (RGB zerado, silhueta no alfa), silhueta reduzida |
| UI | `app/public/favicon.svg` | Mesmo ícone em SVG; o `index.html` ganhou o `<link rel="icon">` que faltava (o arquivo estava órfão) |
| Mestre | `assets/brand/frota-mark.svg` e `frota-icon.svg` | Símbolo em `currentColor` e ícone completo, gerados da mesma geometria |

`FrotaMark.tsx` não precisou mudar: a geometria dele é exatamente a do mestre, e
o traço fino (1.8) é o certo para 24 px na UI. Não há variante em React — quem
varia é o gerador, por tamanho de saída.

**Por que o tray perdeu a barra.** O `tray-icon` escala a NSImage para 18pt de
altura (`platform_impl/macos/mod.rs:296`), então a arte de 72 px vira 36 px
físicos em Retina e 18 px numa tela 1x. Nesses 36 px, 1 unidade do viewBox vale
0,77 px: horizonte e barra ficam a 3,46 px de centro a centro e o traço já tem
2,46 px, sobrando 1 px de respiro em Retina (que o antialias fecha) e 0,5 px em
1x. Legibilidade ganhou de fidelidade: o tray leva círculo + horizonte + mastro,
com traço 3,2 (contra 2,4 do ícone grande) para compensar a escala.

**Como foi conferido.** Folha de contato com os candidatos (cheio, sem barra, só
horizonte) renderizados no tamanho real de render — 36 px e 18 px, não os 72 px
do arquivo — e compostos como o macOS compõe um template: cor descartada, alfa
pintado de preto sobre barra clara (`#f6f6f6`) e de branco sobre barra escura
(`#262628`). O candidato "só horizonte" caiu porque a dobra central do horizonte
vira ruído nessa escala; o "cheio" fica sujo no 1x. A prova final foi feita a
partir do arquivo que o `tray.rs` embute, não do renderizador. O quadro do ícone
de app foi calibrado contra o `AppIcon.icns` do Notes.app: mesma caixa de arte
(824 de 1024) e raio efetivo de canto 0,226 contra 0,220 do sistema. O
`favicon.svg` foi rasterizado pelo Chromium e batido contra o PNG de 128 px: a
silhueta do squircle bate em 4 px de 16.384 e o símbolo fica centrado no mesmo
ponto.

**O que sobra:**

- `icons/Square*.png`, `icons/android/` e `icons/ios/` continuam com a arte
  antiga. Nenhum é declarado no `tauri.conf.json` e nenhum alvo de bundle os usa
  (Windows Store e mobile não são alvo hoje); regerar é trabalho de quando
  alguma dessas plataformas existir.
- `icons/tray-template.png` (1x) é regerado mas o `tray.rs` embute só o `@2x`.
  Ficou coerente de propósito, para quem for mexer não achar arte velha.
- O `.ico` saiu com entradas PNG (16, 24, 32, 48, 64, 128, 256), que é o mesmo
  formato que o `tauri icon` tinha gerado. Windows não é alvo de bundle, então
  não deu para provar em cima do sistema real.
- A landing ainda usa o próprio ativo; o `frota-icon.svg` do `assets/brand/`
  existe para ela, mas ninguém apontou para lá ainda.
- Não existe teste automático de marca. A régua de legibilidade continua sendo
  `--preview` mais olho humano.

## Fase 2 — distribuição e documentação técnica

Objetivo: alinhar os artefatos que podem mudar sem deslocar os dados do usuário.

- Confirmar bundle, DMG, nomes de download e instruções como `Frota`.
- Atualizar descrições do Cargo/package e comentários voltados ao usuário.
- Atualizar scripts de release para aceitar e promover apenas `Frota.app`.
- Manter leitura do app data atual e do `mycockpit.db`.
- Se o sidecar virar `frota-stt`, entregar uma versão que procure primeiro o
  novo nome e faça fallback para `mycockpit-stt`; remover o fallback somente
  depois de pelo menos uma versão estável.

Critério de saída: instalação limpa e upgrade sobre a versão atual abrem a
mesma base, com os mesmos projetos e conversas.

## Fase 3 — aliases de protocolo

Objetivo: permitir nomenclatura nova sem quebrar projetos e automações antigas.

- Se houver valor real em `.frota/`, implementar **dual read**:
  `.frota/` vence quando existe; `.mycockpit/` continua sendo fallback.
- Não fazer dual write silencioso. Oferecer migração explícita, com preview,
  backup e rollback.
- Para formatos exportáveis, aceitar `mycockpit.flight-plan` e emitir uma versão
  nova somente com versionamento de schema.
- Para headers, hook markers, drag MIME types e MCP tools, aceitar o nome antigo
  durante toda a janela de compatibilidade.
- Nunca renomear branches, pastas de missões ou backups existentes no lugar.

Critério de saída: um projeto antigo e um projeto novo passam a mesma suíte de
continuidade e handoff.

## Fase 4 — bundle id e diretório de dados (opcional)

Esta fase só deve existir se houver uma razão operacional forte. O usuário não
vê o bundle id, e alterá-lo tem custo alto no macOS.

Caso seja aprovada:

1. Detectar a instalação antiga antes do primeiro boot.
2. Fazer backup versionado do diretório antigo.
3. Copiar o banco e anexos para o novo app data de forma atômica.
4. Validar schema, integridade SQLite, contagens e anexos.
5. Migrar ou relogar credenciais de Keychain de forma explícita.
6. Explicar e retestar permissões macOS que podem estar vinculadas à identidade.
7. Marcar a migração concluída sem apagar a origem.
8. Manter um comando de rollback que reabre a época anterior.

Critério de saída: teste de upgrade em máquina limpa e máquina com dados reais
anonimizados, com rollback ensaiado.

## Ambiente público de demonstração

As imagens devem ser **reais no sentido correto**: renderizadas pelo app e pelos
componentes de produção, mas alimentadas apenas por fixtures fictícias. Não se
usa a base pessoal para “depois borrar”.

### Universo fictício

- Pessoa: `Marina Vale`.
- Projetos: `atlas-commerce`, `lumen-mobile`, `northstar-docs`.
- Missão principal: revisão e implementação do checkout da Atlas.
- Conversas, decisões, custos e horários são determinísticos e coerentes entre
  todas as telas.
- Toda tela inclui um selo discreto `Ambiente demonstrativo · dados fictícios`.

### Implementação

1. Criar um modo `demo` isolado do Tauri e do banco pessoal.
2. Semear projects, conversations, messages, tasks, decisions, deliveries e
   usage a partir de fixtures versionadas.
3. Fixar relógio, timezone, viewport, tema e versões de fonte.
4. Bloquear escrita em paths fora de `/demo` e bloquear qualquer chamada de
   agente/rede nesse modo.
5. Criar roteiros reproduzíveis de captura:
   - `01-trabalho`: brief no composer e plano vivo;
   - `02-handoff`: troca Codex → Claude Code com contexto preservado;
   - `03-decisao`: pergunta esperando o usuário;
   - `04-retrospectiva`: custo por entrega e por agente;
   - `05-missao`: progresso, gates e entrega concluída.
6. Capturar WebP 2x e vídeos MP4/WebM curtos diretamente da interface real.
7. Gerar um manifesto ao lado dos ativos com seed, commit, viewport e roteiro.

### Gate de privacidade

Antes de copiar um ativo para `landing/public/`:

- procurar por `/Users/`, nome do usuário, e-mails, telefones, chaves, tokens,
  nomes dos projetos privados e paths fora de `/demo`;
- remover EXIF e metadados de origem;
- verificar OCR do frame inicial, intermediário e final de cada vídeo;
- reprovar ativos sem o selo de demonstração;
- reprovar qualquer captura feita com o app conectado ao banco pessoal.

## Testes obrigatórios

| Gate | Prova |
| --- | --- |
| Frontend | typecheck, lint, unit e build |
| Rust/Tauri | `cargo test` e build de bundle |
| Upgrade | versão atual → Frota preserva banco, anexos e preferências |
| Continuidade | handoff mantém origem até sessão de destino confirmar |
| Projeto | `.mycockpit/` existente continua legível e gravável |
| Integrações | MCP, hooks, statusline, companion e STT continuam saudáveis |
| macOS | tray, notificações, ditado e permissões após upgrade |
| Visual | marca em claro/escuro, escala e contraste |
| Marketing | captura reproduzível + gate de privacidade sem ocorrências |

## Ordem recomendada de entregas

1. **PR Marca:** símbolo, copy pública e UI `Frota`; zero migração de storage.
2. **PR Demo:** fixtures isoladas, roteiros e capturas reais do app.
3. **PR Release:** empacotamento/documentação e teste de upgrade.
4. **PR Compatibilidade:** aliases internos que tenham benefício comprovado.
5. **RFC separada:** bundle id, `.frota/` e banco — somente se necessários.

## Regra de rollback

Nenhuma etapa apaga ou renomeia dados existentes. Toda migração de persistência
é copiar → validar → alternar, mantendo a origem intacta até uma versão posterior
e com comando documentado de retorno.

## O que foi feito em 22/08/2026 — e o que deliberadamente NÃO foi

### Feito: a marca que o usuário lê

Treze strings viraram Frota: copy de UI (Configurações, o cartão de pausa do
agente), prompts enviados a agentes (doutrina, renovação de sessão), rótulos de
MCP e o cabeçalho de handoff. Zero ocorrência de `MyCockpit` restou em string
fora de comentário.

**Duas foram verificadas antes de trocar**, porque pareciam copy e podiam ser
contrato:

- `"## Continuidade MyCockpit"` (handoff) — é só ESCRITO, nunca lido de volta.
  Seguro.
- `MISSION_PLAN_FORMAT = "mycockpit.flight-plan"` — é o formato PERSISTIDO dos
  planos de voo em disco. **Não mudou.** Só a frase de erro ao lado dele mudou.

### Feito: a guarda (`scripts/check-marca.mjs`, 7ª)

O plano pedia "qualquer nova ocorrência fora da allowlist falha no CI". A
implementação achou um caminho melhor que allowlist: **varrer só `MyCockpit` com
maiúsculas**. Todos os identificadores persistidos são minúsculos
(`mycockpit.db`, `.mycockpit/`, `dev.vinicius.mycockpit`,
`mycockpit.flight-plan`), então ficam de fora **por construção** — não por uma
lista que alguém precisa lembrar de manter, e que envelhece calada.

Verificado que morde (reintroduzir uma string reprova) e que os três
identificadores não geram falso positivo.

### NÃO feito: o bundle identifier — e eu estava errado sobre isso

Eu havia recomendado trocar `dev.vinicius.mycockpit` "enquanto é barato, porque
depois do primeiro usuário pagante vira migração". **O plano já dizia o
contrário, e a razão dele é melhor:** trocar o identifier custa a MESMA migração
agora ou depois, porque ele define onde ficam o banco, as permissões e o
Keychain. E ele é invisível ao usuário — não há ganho de marca nenhum em mexer.

Ou seja: não há relógio correndo ali. O relógio estava no que aparece, e isso
foi feito hoje.

### Achado de brinde: uma guarda não rodava no CI

Ao registrar a 7ª, a contagem não bateu: `bun run check` tinha 7 scripts, o CI
listava 6. **A `paletaCrua` rodava no Mac e não no CI** — uma cor crua passaria
por um CI verde. O job lista as guardas UMA A UMA, então a agregada do
`package.json` não protege ninguém lá. Corrigido.

**A lição é sobre a forma da guarda, não sobre o esquecimento:** uma lista
duplicada em dois lugares diverge, e diverge em silêncio. Só apareceu porque
alguém foi contar.

---

# A virada de 21/09/2026

> **Decisão do dono:** *"quero que o projeto se chame FROTA e não mais MyCockpit"*,
> e depois, explicitamente: *"iremos RENOMEAR TUDO, ou seja `mycockpit.db` →
> `frota.db` e assim por diante"*. Registrada em **ADR-222**.
> **Isto revoga:** a matriz de nomes acima, a seção "O que NÃO foi feito, e por
> quê", e a "Nota de marca" que vivia no `README.md` (removida, e guardada
> inteira dentro da ADR-222).

Eu recomendei deixar a camada do identificador de fora, pelo mesmo argumento que
o plano de agosto já fazia: o usuário não vê o bundle id, e a migração custa o
mesmo agora ou depois. O dono reafirmou. Reafirmação é decisão, e o argumento
fecha aqui.

O que mudou de verdade não foi o gosto, foi a arquitetura: a **memória durável
do projeto** (`docs/memoria-do-projeto-spec.md`) precisa de `.frota/memory/`
versionada no git. Sem renomear a pasta, a Frota passa a ter duas casas no
repositório para a mesma preocupação, e `.mycockpit/.gitignore` é `*` com
allowlist, então uma `memory/` criada lá dentro nasce fora do git. O rename
deixou de ser cosmético.

## Matriz vigente

Toda linha renomeia. A coluna que importa agora é **como**, não **se**.

| Superfície | Onde | Como |
|---|---|---|
| `.mycockpit/` → `.frota/` | 240 referências, 26 construções do path na mão | centralizar a resolução da raiz em UMA função que conhece os dois nomes; repo próprio por `git mv`, repo de terceiro por gesto |
| Banco `mycockpit.db` → `frota.db` | `lib.rs:144`, `lib.rs:883`, backups `lib.rs:152` | cópia de db+wal+shm no boot, antes de o plugin SQL abrir, no padrão de `lib.rs:137-178`. **Copiar, nunca mover** |
| Bundle id `dev.vinicius.mycockpit` → `dev.vinicius.frota` | `tauri.conf.json:5` | por último, e só depois do resto estável. Arrasta os cinco itens da §"O que o identificador carrega" |
| Keychain `dev.vinicius.mycockpit.mcp-oauth` | `mcp_auth.rs:28` | ler os dois serviços por uma versão, reescrever no novo ao renovar. Sem isso, cada server OAuth pede login de novo |
| localStorage `mc.app` | `main.tsx:23`, `browser.tsx:14`, `tray.tsx:23` | ler os dois, escrever no novo. É lido ANTES do React para não piscar tema: cuidado com a ordem |
| `MISSION_PLAN_FORMAT = "mycockpit.flight-plan"` | `missionPlans.ts:13` | discriminador GRAVADO dentro de plano salvo. Aceitar o valor antigo na leitura para sempre, ou até migração explícita dos arquivos |
| Servers `mc-context`/`mc-work`/`mc-approval`/`mc-tools` → `frota-*` | `context_gateway.rs:16`, `work_gateway.rs:19`, `approval.rs:51`, `tool_gateway.rs:22` | os quatro num commit só. Tool names mudam de `mcp__mc_context__*` para `mcp__frota_context__*`, e allowlist salva no settings do usuário para de casar |
| 8 vars `MYCOCKPIT_*` → `FROTA_*` | uma `const` por var, menos `MYCOCKPIT_RUN_ID` (5 arquivos) | escreve o novo, aceita os dois na leitura |
| Headers `X-Mycockpit-*` → `X-Frota-*` | `hooks_install.rs:347` | **o mais perigoso**: o snippet está instalado em `~/.claude/settings.json` dos DOIS Macs. Aceitar os dois headers desde o dia um |
| sidecar `mycockpit-stt` | build, bundle e runtime | nome coordenado nos três; troca junto ou não troca |
| texto, comentário, doc, fixture | ~300 arquivos | varredura, depois da catraca |
| **SQL de migração** | `lib.rs`, `conversation_items.rs:31` e vizinhas | **não muda, nunca.** Migração é história: a string já rodou no banco de alguém. Única exceção permanente da catraca |

## O que o identificador carrega, além do caminho do banco

Trocar `identifier` muda `app_data_dir()`, e isso arrasta cinco coisas. Três não
estavam mapeadas no plano de agosto:

1. **O banco.** Sem cópia explícita, o app abre num diretório vazio, cria banco
   novo e roda as 59 migrações do zero, com suas conversas, custos e lições
   intactos no diretório antigo e invisíveis.
2. **Os perfis de navegador.** Vivem em `app_data_dir/browser-profiles/<uuid>`,
   e o caçador de órfãos casa processo **pelo caminho do perfil**
   (`browser_orfaos.rs:25`); `browser_orfaos.rs:123` tem teste afirmando que
   raiz diferente não devolve órfão nenhum. Trocar o identificador faz qualquer
   Chromium vivo com perfil antigo deixar de ser reconhecido como nosso: fica
   com `ppid=1` comendo CPU e o app não o enxerga para matar. A varredura
   precisa aceitar as duas raízes durante a janela.
3. **As permissões do macOS.** `Info.plist` declara
   `NSMicrophoneUsageDescription` e `NSSpeechRecognitionUsageDescription`, e o
   TCC é chaveado por bundle id: microfone e reconhecimento de fala voltam a
   pedir permissão.
4. **O Keychain.** O OAuth dos MCPs (`mcp_auth.rs:28`) e o certificado
   auto-assinado da ADR-201.
5. **Dois apps instalados.** O bundle antigo continua no disco com identidade
   diferente, e dá para abrir o velho sem perceber, escrevendo no banco antigo.
   Remover o bundle antigo faz parte do mesmo gesto.

## A catraca, e o que precisa mudar nela

`scripts/check-marca.mjs` já existe e já roda no CI, mas o **comentário de
cabeçalho dela codifica a decisão revogada**: lista `mycockpit.db`, `.mycockpit/`,
`mc.app`, `dev.vinicius.mycockpit`, `mycockpit.flight-plan` e `mc-work` sob
"PERSISTÊNCIA: NÃO MUDAM". Enquanto essa linha existir, a guarda ensina o
contrário do que foi decidido, e o próximo agente a obedece.

A guarda também varre só `app/src`, só `MyCockpit` com maiúsculas, e só fora de
comentário e de teste. Isso era correto para "marca visível"; para "o nome sai de
tudo", ela precisa:

- varrer `app/src`, `app/src-tauri/src`, `scripts/`, `docs/` e a raiz;
- pegar qualquer casing (`mycockpit`, `MyCockpit`, `MYCOCKPIT`);
- trocar a allowlist por construção (minúsculas ficam de fora) por **baseline
  JSON que só desce**, no molde de `file-size-baseline.json`;
- manter UMA exceção permanente, a SQL de migração, e dar **prazo escrito** às
  exceções da janela de compatibilidade.

A catraca com baseline no estado de hoje é o **passo 1**, antes da primeira
substituição. Sem ela, cada camada entregue é uma janela para o nome voltar.

## Ordem

> **Andamento em 21/09/2026:** passos 1 a 7 ENTREGUES e verificados
> (`cargo test` 937, `bun run test` 4.568, `tsc -b --force` 0, `bun run check`
> verde). A catraca saiu de 1.239 para **780** ocorrências. O passo 8 é o que
> falta, e ele espera os DOIS Macs rodarem o build novo: fechar a janela antes
> disso faz o app do outro Mac deixar de reconhecer o próprio hook.

| passo | o quê | gate |
|---|---|---|
| 1 | Catraca ampliada, baseline = estado de hoje. Cabeçalho de `check-marca.mjs` reescrito para refletir a ADR-222 | `bun run check` verde e acusando "mycockpit" novo em qualquer casing |
| 2 | Texto (comentário, doc, fixture) | suítes completas verdes, baseline desce |
| 3 | `.mycockpit/` → `.frota/`, raiz centralizada, leitura dupla, `!memory/` na allowlist do `.gitignore` | app abre em repo `.frota/` e em repo `.mycockpit/` |
| 4 | Vars, headers, servers MCP, com janela | run real em Claude Code e Codex, hook correlacionado NA TELA |
| 5 | **Memória durável destravada** (Fase 1 de `memoria-do-projeto-spec.md`) | `.frota/memory/` existe e está no git |
| 6 | `mc.app`, `mycockpit.flight-plan`, sidecar: leitura dupla e escrita no novo | tema não pisca, plano de missão antigo ainda abre |
| 7 | Identificador e nome do banco | banco antigo intacto **E** banco novo com as mesmas conversas, custos e lições; órfão de perfil antigo ainda detectado; OAuth dos MCPs sem pedir login |
| 8 | Fim da janela: leituras duplas saem, por ADR | catraca sem exceção temporária |

A irreversível é a última de propósito: quando ela rodar, tudo o mais já está
estável, e se algo quebrar o único suspeito é ela.

## O que a execução acrescentou ao plano (21/09/2026)

Sete coisas que só apareceram ao mexer, e que o plano não previa:

1. **O caçador de órfãos casa processo pelo caminho do perfil**
   (`browser_orfaos.rs`), e o identificador É esse caminho. Sem aceitar as duas
   raízes, um Chromium de antes do rename some da varredura. Tem contraprova em
   teste: com só a raiz nova, o órfão da captura REAL do incidente desaparece.
2. **`entry_is_ours` identifica nosso hook pelo caminho do script.** Renomear
   `mycockpit-hook.sh` sem reconhecer o nome antigo faria a instalação somar a
   entrada nova SEM remover a velha: o hook dispararia DUAS vezes por evento.
3. **`ORIGINAL_MARKER` guarda a statusline original da pessoa** dentro do script
   que instalamos. É a única cópia. Trocar sem ler os dois perde o comando dela.
4. **O slot da statusline casava por path exato.** Com o nome novo, uma
   statusline já instalada viraria "não instalada", e instalar de novo
   encadearia o NOSSO script velho como se fosse de terceiro.
5. **`DOCTRINE_PATH` era constante no front e vai DENTRO do prompt.** Num
   projeto legado mandaria o agente ler um arquivo que não existe. Virou campo
   resolvido (`Doctrine.path`), e o mesmo valeu para a copy da tela
   (`ProjectConfig.pasta`).
6. **O marcador de órfão no `ps`** (`FROTA_RUN_ID=`) não acha processo spawnado
   antes do upgrade. O app passou a setar as duas variáveis, e a busca aceita as
   duas.
7. **O `sqlite3` do macOS (3.51) acusa `malformed inverted index` no FTS** do
   banco construído pelo SQLite 3.46 do app. É FALSO ALARME (o check pela 3.46
   diz `ok`), mas quase virou caça a uma corrupção inexistente no meio da
   migração do banco. Não use o CLI do sistema como gate deste banco.

## Ainda aberto

- **Passo 8**, que espera os dois Macs no build novo.
- **`CONTATO_VAPID`** (`companion_push.rs`) aponta para
  `github.com/vinicius1209/mycockpit`. A URL está CERTA: o repositório ainda se
  chama assim. Só muda com `gh repo rename` (o GitHub redireciona o nome
  antigo). Separado disso: o repo é PRIVADO, então essa URL não abre para o
  serviço de push, que é justamente quem deveria poder falar com o dono se algo
  der errado. Decisão de produto, não do rename.
- **~145 ocorrências em código de produção** que são comentário e identificador
  interno, sem contrato nenhum. Limpeza tranquila, a catraca cobra o resto.
