# Missão em voo — avaliação da superfície (insumo para a reconstrução)

> 13/08/2026, do build 193, missão "UI-first" rodando (fase 1/3, Planejar).
> **Não implementado de propósito**: a frente de Missões está reconstruindo
> essa área. Isto é insumo, não patch.

## 1. As repetições do ADR-037 estão vivas aqui
A passada de despoluição do fio não alcançou a linha do tempo da missão:
- **"Claude · Claude · Opus 5"** — nome do motor duas vezes na mesma linha.
- **"Agora: Criar landing-plan.md"** repete a linha imediatamente acima.
- Cabeçalho de fase + sub-bloco repetem identidade de motor/modelo.
Regra a aplicar (mesma do fio): o cabeçalho diz o quê; o filho mostra só o
**delta**. Ver `docs/mocks/fio-despoluicao-README.md` e ADR-037.

## 2. "Executar ferramenta" ×3 — regressão de capacidade, não só ruído
Três linhas idênticas sem identidade, enquanto a quarta diz **"Criar
landing-plan.md"**. Ou seja: o nome real da ação CHEGA em alguns casos e não
em outros. Num painel cujo propósito é acompanhar, linha sem identidade é
pior que linha ausente. Investigar por que o rótulo se perde (tool sem nome
mapeado? shell genérico? evento antes do nome chegar?) e, no pior caso,
mostrar o que se sabe (o comando, o arquivo) em vez de um rótulo genérico
repetido.

## 3. `US$ 0,000` depois de 16min de Opus — número não medido com cara de medido
Viola a doutrina que acabamos de aplicar no Painel (o derivado "por entrega"
some quando não há writer: *"número cujo denominador não pode crescer não é
instrumento, é ficção com atraso"*). Enquanto o custo da missão não aterrissa
no ledger **durante o voo**, o campo deve dizer "—" ou "medindo…", nunca
`0,000`. Relacionado: o revisor do Painel registrou que custo de missões
concluídas antes do MH2.1 não entra no ledger — provável mesma origem.
Formato: 3 casas decimais também diverge do padrão da casa (2).

## 4. O composer travado é a questão de produto
`"Missão em andamento; pare a missão para enviar manualmente…"` — copy
honesta, comportamento fire-and-forget: durante uma missão de 16 minutos o
humano só pode **abortar tudo**, não corrigir o rumo. Contradiz a alma do
produto (supervisão humana) e é inferior ao que o app já faz no turno normal
("Enfileirar próxima mensagem"). Proposta mínima: permitir **enfileirar para a
próxima fase** — o ponto de junção onde a mensagem não atropela execução em
curso. O gesto "parar tudo" continua existindo para quem quer cortar.

## 5. Menores
- Falta tempo decorrido da MISSÃO (só o sub-bloco tem "16min 19s").
- Fases na fila dizendo "na fila" está correto e honesto — manter.
- Aplicar o STYLEGUIDE: escala 11/12/13/14, ≤2 cores de status por recorte,
  uma primária brass (hoje "Parar" e o badge competem).
