# Modelos novos sem trabalho manual — plano

> Proposto em 14/08/2026. Gatilho: "toda semana pode haver novidade (Gemini 3.7
> etc); como automatizar isso de forma 100% sozinha?". A resposta honesta: dá
> para automatizar quase tudo, **mas só se a automação virar empírica** — e uma
> parte NÃO deve ser automatizada (ver §5).

## O diagnóstico

Hoje são três camadas com autonomias diferentes:

1. **Preço** — já automático (`catalog.rs` puxa `models.dev/api.json`, 166
   providers, refresh 1×/dia). Modelo novo já sai com custo certo.
2. **Entrar no seletor** — semiautomático: o curador propõe
   (`model_proposals`), o humano aprova. O portão existe porque o app **não
   tem como verificar** se o modelo funciona.
3. **Lista curada** (`agents.ts`: `CLAUDE_MODELS`, `CODEX_MODELS`…) — escrita
   à mão, e o valor dela é conhecimento que catálogo nenhum publica:
   *"`gpt-5.6` puro é ID de API, rejeitado com auth ChatGPT"*, *"contexto
   DENTRO do Codex é 272k; na API os mesmos modelos têm 1M"*, *"sem família
   `-codex` desde o 5.4"*.

**A causa raiz do trabalho manual**: aquele conhecimento vem de alguém
TESTANDO contra o CLI. O portão humano é o substituto da verificação que não
existe. Logo: **crie a verificação e o portão vira burocracia.**

## M1 — Perguntar ao CLI, não só ao catálogo

Capability nova no registry (`adapters.rs` + espelho TS + teste-gêmeo):
`lists_models: Option<ModelListSource>`. Quem sabe listar, lista:

- **agy**: `agy models` (já existe, já usado na detecção).
- **codex**: canal RPC local do app-server (o MESMO que o medidor de uso já
  abre — reusar, não abrir outro).
- **claude**: verificar empiricamente o que existe hoje; se não houver fonte,
  capability `None` e o catálogo continua sendo a fonte (degradação honesta).

Efeito: modelo que o CLI não conhece **nunca é proposto**, e slug aposentado
**some sozinho** da lista em vez de virar erro no meio de um turno.

## M2 — Fumaça de um token (a peça que substitui o humano)

Para cada candidato, uma chamada mínima que **classifica o desfecho**:

| desfecho | significado |
|---|---|
| `ok` | aceito e respondeu |
| `auth-rejected` | slug existe mas a sua autenticação não o alcança |
| `unknown-slug` | o CLI não reconhece |
| `context-mismatch` | aceito, mas o teto difere do catálogo |
| `unreachable` | não deu para saber (nunca vira veredito, vira "não sei") |

Isso produz **exatamente** o conhecimento que hoje está escrito à mão — com
data, versão do CLI e evidência, no padrão ADR-016 da casa. Custo: centavos
por lançamento (prompt de 1 token).

Guardas: só roda por gesto/agenda (nunca em laço), com teto de N candidatos
por rodada; resultado gravado com carimbo; falha de rede = `unreachable`, que
**não** rebaixa nem promove nada.

## M3 — O portão vira AVISO

Regra: candidato que passa nos três (o CLI lista **e** a fumaça deu `ok`
**e** o preço existe no catálogo) **entra sozinho** no seletor. O humano
recebe um aviso no sino: *"2 modelos novos validados e disponíveis"*.

O que **falha** vai para o humano **com o motivo** — *"o Codex rejeitou este
slug com a sua autenticação"* — que é infinitamente mais útil que
"aprovar/dispensar" às cegas.

Reuso: o aviso usa o sino (`toolHealth`, já entregue). Nada de superfície
nova. E o item **não conta no badge** (é conveniência, não impedimento —
mesma régua do "atualização disponível").

## M4 — A descrição deixa de ser editorial

Hoje cada opção carrega uma frase escrita à mão. Depois de M1+M2, quase tudo
é derivável: preço (catálogo), contexto (sonda), quirks (fumaça). O texto
humano encolhe para o que sobra de opinião — e o §5 mostra que até isso pode
virar dado.

## M5 (frente futura) — a recomendação vem do SEU ledger

"Qual modelo é bom?" hoje é opinião escrita ("o mais capaz", "equilíbrio
custo"). Mas temos `turn_costs` e `deliveries`: dá para derivar do uso REAL
— qual modelo entregou mais barato, qual falhou mais, qual exigiu mais
retomadas. **Benchmark de fabricante mente; o seu histórico não.**
Fora do escopo de M1-M3 porque muda como o app opina.

## §5 — O que NÃO automatizar (a parte que segura o "100%")

- **Modelo novo NUNCA vira o seu padrão sozinho.** Entrar como opção é
  reversível e barato; trocar o motor das suas tarefas é decisão de custo e
  de qualidade que o app não tem como tomar por você.
- **"É bom?" não se responde por catálogo.** Só o M5 (dado seu) chega perto.
- **Fumaça não vira laço.** Testar automático a cada boot seria queimar
  dinheiro para descobrir o que muda uma vez por mês.

## Guardas gerais

- Agnosticismo por capability: nada de comparar nome de fornecedor em código
  genérico; o dialeto (como listar, como testar) fica confinado.
- Sem fonte confiável ⇒ capability `None` e o comportamento de hoje, intacto.
- Nada some do seletor sem aviso: slug aposentado vira estado explicado, não
  desaparecimento silencioso.
