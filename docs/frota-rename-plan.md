# Plano de migração de marca — MyCockpit → Frota

Status: proposta executável  
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
