# Dois gaps reais, achados comparando com o design system do Linear

Origem: leitura de `styles.refero.design/style/90ce5883-bb24-4466-93f7-801cd617b0d1`
(18/08/2026, abas DESIGN.md/Tailwind v4/CSS Variables lidas via browser real —
a primeira tentativa por `WebFetch` só pegou a aba visível por padrão).

A maior parte do que o documento prega já é doutrina nossa (acento cromático
único pro gesto primário — brass; elevação por hairline + sombra sutil, nunca
drop-shadow — §4; escala tipográfica apertada com guarda automática). Os dois
itens abaixo são os únicos onde medi deriva real no nosso código.

---

## 1. Vocabulário de raio de borda

### O que o Linear prescreve

> "Set card radius to 12px, button radius to 6px, pill radius to 9999px —
> three radii is the entire radius system." + badges em 2px.
> "Do not use large radii (16px+) on cards or panels."

Quatro valores, ponto final: `2px` (badge) · `6px` (botão/input) · `12px`
(card) · `9999px` (pill).

### O que medimos no nosso código (18/08/2026)

```
174× rounded-md   129× rounded-full   78× rounded-lg   32× rounded-xl
9× rounded-sm     7× rounded-[2px]    6× rounded-2xl   4× rounded-[9px]
1× rounded-[4px]  1× rounded-[3px]    1× rounded-[13px] 1× rounded-[10px]
```

Os quatro grandes buckets (`md`/`full`/`lg`/`xl`) já são as classes utilitárias
do Tailwind — não sabemos, sem abrir `tailwind.config`, se elas resolvem pros
MESMOS px em todo lugar (Tailwind v4 permite override por tema). O problema
comprovado são os **6 valores arbitrários soltos** (`[2px]`, `[3px]`, `[4px]`,
`[9px]`, `[10px]`, `[13px]`) — nenhum documentado, nenhum guardado, cada um
escolhido no calor da hora de um componente específico.

### Decisão proposta

1. **Auditar o que `rounded-md/lg/xl/sm` resolvem hoje** (checar
   `tailwind.config`/tema v4) e documentar os quatro valores resultantes no
   STYLEGUIDE §4, do lado da regra de elevação que já existe — não inventar
   valor novo, só nomear o que já está em uso majoritário.
2. **Fechar os 6 arbitrários** um a um: cada `rounded-[Npx]` vira o bucket
   mais próximo (majoritariamente vão colar em `sm`/`md`), com Diff pequeno
   por arquivo — não é refactor, é 6 substituições pontuais + o teste do
   componente tocado rodando de novo.
3. **Guarda automática**, seguindo o MESMO molde do `check-type-scale.mjs`
   já existente: `scripts/check-radius.mjs`, falha se achar `rounded-\[` fora
   dos 4 valores nomeados. Trava a régua pra não voltar a derivar — a mesma
   régua que já vale pra tipografia, paleta e tamanho de arquivo.

### O que NÃO faria

Não tocaria nos 174/129/78/32 usos das classes nomeadas — não há evidência de
que estejam errados, só de que os 6 arbitrários são o ponto fora da curva.
Auditar tema antes de mexer evita reescrever algo que já está certo.

### Custo

Baixo. É achar-e-substituir em 6 sítios + escrever um script de ~40 linhas
igual ao de tipografia (que já existe como modelo) + uma linha no STYLEGUIDE.
Nenhuma mudança visual esperada (os arbitrários já estavam próximos do bucket
que vão herdar).

---

## 2. Geist sem OpenType features ligadas

### O que o Linear prescreve

> "Use Inter Variable with font-feature-settings 'cv01' on, 'ss03' on, 'zero'
> on — these alternate glyphs improve legibility at UI sizes."

### O que medimos no nosso código

`app/src/index.css` só liga `font-feature-settings` pro **mono** (`code`,
`kbd`, `pre`, `.font-mono`), e é pra DESLIGAR ligadura (`"liga" 0, "calt" 0,
"dlig" 0` — assunto diferente, não mexer). O Geist Sans — a fonte de toda a
UI — não liga feature nenhuma.

**Verificado antes de propor**: os `.woff2` do Geist são bundlados via npm
(`dist/assets/geist-*-wght-normal-*.woff2`), não carregados de CDN — a fonte
está self-hosted, então o jogo completo de OpenType features do Geist
(stylistic sets `ss01`–`ss10`, `zero`, `tnum`) está disponível de verdade, não
é promessa que a versão CDN do Google Fonts corta.

`cv01`/`ss03` são tags específicas da Inter (não necessariamente presentes no
Geist — fontes diferentes numeram stylistic sets diferente); o que dá pra
prometer sem verificar de novo é o que já está confirmado por fonte
independente: Geist tem `ss01`–`ss10` e `zero`. **Precisa abrir o `.woff2`
(ou testar visualmente cada `ss0N`) pra saber qual set muda o quê antes de
declarar qual liga** — não vou copiar `cv01`/`ss03` cegamente só porque é o
que a Inter usa.

### Decisão proposta

1. Rodar `bun run check` normalmente não pega isso (não é guarda, é feature
   tipográfica) — então é uma sessão de teste visual: ligar `ss01` a `ss10`
   um de cada vez num texto de UI real (números tabulares, "1", "I", "l"), e
   `zero` separado (zero cortado vs não), decidir quais mudam algo que
   importa pra legibilidade em 11-14px (a régua §3 do STYLEGUIDE).
2. Se algum set melhorar leitura de verdade, uma linha em `index.css`
   (`body { font-feature-settings: "ssXX" 1, "zero" 1; }`), do lado do bloco
   que já existe pro mono — mesmo padrão, escopo maior (body inteiro, não só
   código).
3. Se nenhum mudar nada perceptível: documentar a checagem feita e a decisão
   de não mexer, pra não virar pergunta recorrente (mesma disciplina do
   `docs/hooks-plan.md` com o `--json-schema` do agy).

### Custo

Muito baixo — uma linha de CSS, SE o teste visual achar um set que vale a
pena. A maior parte do custo é a sessão de olhar, não de codar.
