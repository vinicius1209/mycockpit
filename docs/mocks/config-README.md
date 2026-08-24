# Mocks das Configurações (24/08/2026)

> Pedido do usuário, depois de ver as telas rodando no build #275:
> *"que confusão esse UX! difícil de entender! acho que teríamos que começar a
> trabalhar com um mock em HTML para eu ir validando algumas melhorias."*
>
> **Nada aqui está implementado.** São propostas para você aprovar, recusar ou
> misturar antes de virar código.

Abrir: `open docs/mocks/config-modelos-a.html` (idem `-b` e `config-servicos`).

---

## 1. Modelos — o diagnóstico antes das opções

A tela de hoje promete, no próprio subtítulo, *"quais modelos entram no seletor
dos agents"* — e **nunca lista os modelos do seletor**. Ela mostra só EVENTOS:

- aposentadoria anunciada
- entraram sozinhos
- esperando você
- não passaram
- catálogo de preços

Ou seja: **é o changelog, não o estado.** Você abre pra saber o que tem e sai
sabendo o que mudou. E para ler isso são três níveis de hierarquia (bloco →
subgrupo → linha) com três estilos de rótulo diferentes, mais um parágrafo denso
no rodapé explicando o que o botão faz.

O defeito não é feiura: é que **a pergunta do título fica sem resposta**.

### A — "estado primeiro" (`config-modelos-a.html`)

1. **No seu seletor** — a resposta da pergunta, primeira coisa na tela. Por agent,
   com preço e o padrão marcado. "Tirar" aparece no hover.
2. **Precisam de você** — o único bloco com peso visual, e **some quando está
   vazio**. Bloco que aparece sempre ninguém lê.
3. **Histórico de mudanças** — o changelog inteiro, `<details>` fechado. Continua
   auditável ("nada some daqui sem motivo escrito"), mas sai da frente.

O modelo aposentando aparece **na própria linha dele**, dentro do seletor, não
num bloco separado no topo — é lá que a informação importa.

### B — "um agent por vez" (`config-modelos-b.html`)

Uma trilha de agents no topo (Claude / Codex / Antigravity) e a lista daquele
agent embaixo, com "esperando você" acima de "no seletor".

**O argumento a favor:** é o mesmo caminho mental do composer, onde você já
escolhe o agent antes do modelo. E o pino de "precisa de você" na trilha é o
mesmo vocabulário do ponto no rail.

**O argumento contra:** esconde dois terços da informação atrás de um clique, e
"quantos modelos eu tenho no total" deixa de ser respondível de relance.

### Minha recomendação

**A**, com uma peça do B: a trilha do B só compensa se a lista crescer muito. Hoje
são 9 modelos ao todo — cabem na tela sem abas, e A responde a pergunta do
título sem clique nenhum. Se um dia forem 40, B vira a resposta certa.

---

## 2. Serviços — aqui eu errei duas vezes, e as duas você apontou

### Erro 1: uma seção por FORNECEDOR

Criei "GitHub" como item do menu. Sua pergunta: *"e se amanhã eu quiser um novo
app para integrar?"* — o rail cresceria **um item por vendor**.

O engraçado é que eu tinha escrito a crítica certa na análise do Orca (eles têm
UM painel `Integrations` com cartões por provedor) e **construí o contrário**.

`config-servicos.html` mostra a correção: uma seção **Serviços**, cujo cartão é o
provedor. GitHub hoje, GitLab de exemplo, e espaço declarado pro próximo — sem
item novo no menu.

### Erro 2: a tela só lê, não deixa fazer

Sua pergunta: *"não consigo mudar, não faço nada? apenas leio?"*

Eu tinha decidido não rodar `gh auth switch` pelo app, com o argumento de que
"mexer na conta ativa global é efeito fora do nosso quintal". **O argumento não
se sustenta**, por um motivo que estava no próprio repo: em *Agentes na máquina*
o app já roda `npm i -g` e `brew upgrade` no seu clique. Instalar pacote global é
muito mais invasivo que trocar de conta. Recusar aqui era incoerência, não
princípio.

O que o cuidado real exige não é recusar — é **dizer a consequência**: trocar
aqui vale pro seu terminal também, porque a conta ativa é do `gh`, não do Frota.
No mock isso está na tela, ao lado do botão, não escondido num tooltip.

*(Detalhe da sua leitura: quem está ativa é a `vinicius1209`. A `viniimachadoprime`
aparece embaixo, sem selo. Se isso não ficou claro no build, é sintoma do mesmo
problema — o selo é discreto demais.)*

---

## O que eu preciso de você

1. **Modelos: A, B, ou uma mistura?**
2. **Serviços: fecho a seção "GitHub" e abro "Serviços" com cartões?** (a seção
   `github` vira legado em `LEGACY_SECTION_IDS`, então deep link antigo não
   quebra)
3. **Trocar conta pelo app: pode?** Com o aviso da consequência na tela.

Nada disso entra em código antes da sua resposta.
