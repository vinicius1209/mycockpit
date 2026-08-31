# Instrumento expandido, três direções

Mock comparável: [`hud-expandido-variacoes.html`](./hud-expandido-variacoes.html).

## Brief

O instrumento mede 540 × 320 e fica acoplado ao topo da tela. A pessoa quer
entender em segundos o que está vivo e agir sem abrir a janela principal. A
cena é a do incidente visual enviado em 31/08/2026, sem dado inventado:

- 1 tarefa em voo, `revisao de branches`, projeto Maclan, 16 min;
- detalhe vivo `Redigindo resposta`;
- nenhuma automação, 0 ativas;
- Codex observado no terminal, ocioso;
- ações reais: abrir, parar, nova tarefa e configurações.

## Sistema visual

- Casco preto absoluto, Geist para interface e Geist Mono para tempo/dados.
- Corpo em 11, 12, 13 e 14 px; 20/30 px somente onde a variação assume uma
  leitura de métrica.
- Azul apenas para o estado vivo. Brass não colore estado nem seleção.
- Uma aresta externa e divisores internos, sem cartões com borda dentro de
  cartões.
- Movimento serve apenas à entrada do mock e à linha viva; `reduced-motion`
  desliga ambos.

## As três teses

### A, Pista de voo

A tarefa vira uma faixa única com tempo, título, detalhe e parada. Automações e
terminal ficam como dois instrumentos secundários sem moldura própria.

É a recomendação inicial: dá prioridade ao trabalho vivo sem esconder os
outros dois domínios e ainda cabe na geometria atual.

### B, Matriz operacional

Nome, detalhe, tempo e ação seguem trilhos fixos; uma rail lateral reúne os
sistemas observados. É a direção que cresce melhor quando houver várias
tarefas simultâneas.

O custo é parecer mais operacional com apenas uma tarefa.

### C, Foco adaptativo

O tempo real é o instrumento principal. Título e detalhe ocupam o centro;
estados vazios recuam para uma frase. É a direção com menos ruído e a assinatura
mais forte.

O custo é estrutural: múltiplas tarefas ou uma decisão pendente exigem outra
composição, não apenas acrescentar linhas.

## O que o mock não decide

Nenhuma variação está aprovada para produção. O HTML decide hierarquia,
densidade, copy e orçamento de cor; a implementação escolhida ainda precisa
usar o `TraySnapshot` real, ações existentes, teclado, hover e presenter nativo.
