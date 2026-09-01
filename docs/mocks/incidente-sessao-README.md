# Incidente de sessão, três direções

Comparador: [`incidente-sessao-comparador.html`](./incidente-sessao-comparador.html).

> Direção escolhida em 31/08/2026: **C, Sequência temporal**. A passagem do
> mock para produção é governada por
> [`../incidente-sessao-plan.md`](../incidente-sessao-plan.md). A e B ficam como
> exploração histórica, não como especificações concorrentes.

## Diagnóstico visual

O aviso atual comunica a mesma urgência pelo fundo âmbar, borda, ícone, título,
telemetria colorida e pela faixa de retomada logo abaixo. A soma parece um
cartão de resposta gerado por IA porque quase tudo recebe tratamento visual e
quase nada recua.

Os estudos conservam a semântica aprovada pela ADR-140:

- limite esperado e erro real continuam diferentes;
- horário autoritativo não vira contagem ou progresso inventado;
- conversa, contexto e arquivos só são declarados preservados porque esse é o
  contrato real;
- telemetria continua disponível, mas recolhida;
- revezamento permanece uma ação secundária e não ganha cor de decisão.

## A, Corte seco

O incidente muda o ritmo do fio com duas linhas e espaço. Não há cartão. O
horário é o único número grande, e um ponto âmbar é o único sinal cromático.

É a direção mais cinematográfica e menos parecida com software SaaS. Depende de
uma largura mínima para conservar a tensão entre texto e horário.

## B, Claquete operacional

Agente, turno, estado e horário ocupam trilhos estáveis dentro de uma única
superfície E1. A assimetria cria assinatura sem depender de ilustração, brilho
ou animação.

É a direção mais segura para produção e a que melhor acomoda novos metadados,
desde que eles permaneçam recolhidos.

## C, Sequência temporal

O aviso vira três fatos em ordem: o turno encerrou, o estado foi preservado e
há uma informação de retorno. A linha representa ordem temporal, nunca
percentual de progresso.

É a direção mais operacional e mais calma. Em compensação, ocupa mais largura
e exige uma composição própria para telas estreitas.

## Limite do mock

Os HTMLs decidem linguagem, hierarquia, densidade e copy. Eles não alteram o
app, não iniciam build e não promovem uma versão. A implementação escolhida
deve reutilizar os tokens e controles do Frota, cobrir claro e escuro e manter
o erro real em vermelho.
