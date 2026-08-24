# Mocks das Configurações (24/08/2026)

> Pedido do usuário, depois de ver as telas rodando no build #275:
> *"que confusão esse UX! difícil de entender! acho que teríamos que começar a
> trabalhar com um mock em HTML para eu ir validando algumas melhorias."*
>
> **Nada aqui está implementado.** São propostas para você aprovar, recusar ou
> misturar antes de virar código.

Abrir: `open docs/mocks/config-modelos-a.html` (idem `-b` e `config-servicos`).

---

## 1. Modelos — um mock só, `config-modelos.html`

**As duas opções A/B foram apagadas.** Eu tinha mandado duas telas e a pergunta
"qual você prefere?", o que é empurrar a decisão de design pra você. E as duas
partiam de uma contagem ERRADA.

### O erro que eu corrigi ao medir

Eu escrevi que eram "9 modelos, cabem sem abas". São **27**:

| agent | modelos |
|---|---|
| Claude Code | 8 |
| Codex | 7 |
| Antigravity | **12** |

Com 27, lista chapada vira rolagem — o argumento que eu usei pra recomendar a
opção A caiu junto com o número.

### O diagnóstico (esse continua valendo)

A tela promete no subtítulo *"quais modelos entram no seletor dos agents"* e
**nunca lista os modelos do seletor**. Mostra só EVENTOS: aposentou, entrou
sozinho, espera você, não passou. É o changelog, não o estado — você abre pra
saber o que tem e sai sabendo o que mudou.

### A proposta

O mock mostra **hoje × proposta lado a lado**, com os SEUS dados lidos do banco
(as 2 propostas pendentes do Codex e as 2 aposentadorias são reais).

1. **Precisam de você** primeiro, e é o único bloco com peso. Some quando vazio.
2. **No seu seletor · 27** — um cartão por agent, fechado, com a contagem no
   cabeçalho. É a resposta da pergunta do título, e o vocabulário de cartão é o
   mesmo que você aprovou em Serviços.
3. **A aposentadoria mora na LINHA do modelo**, não num bloco no topo: é ali que
   ela muda a sua decisão, ao lado do modelo que você usaria.
4. **Histórico** fechado no rodapé. Continua auditável, sai da frente.

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
