# Auditoria de persuasão — landing Frota

Data: 2026-08-14  
Público: builders, founders técnicos e pequenos times que já usam agentes de código  
Objetivo único: gerar inscrições qualificadas para a beta privada

## Verificação desta rodada

- Revisão completa da narrativa e das alegações no código: concluída.
- Build e lint: aprovados.
- Servidor local: saudável.
- Três capturas reais do navegador fornecidas pelo usuário: inspecionadas em
  resolução original.
- Controle direto do navegador, desktop e mobile: pendente porque a ferramenta
  de conexão não está exposta nesta sessão.

Esta separação importa: os julgamentos abaixo cobrem estratégia, copy,
sequência e implementação. Layout final, quebras, contraste e sensação de
scroll ainda precisam da passada visual real.

## Segunda rodada visual

As capturas de 2026-08-14 revelaram problemas que build/lint não detectam:

- o gráfico curvo do hero parecia uma ilustração de dashboard, não trabalho real;
- a headline da Cabine ocupava quatro linhas e empurrava a prova para fora da
  área útil;
- os controles da Cabine alinhavam pelo rodapé da janela, separando texto e tela;
- o conteúdo interno do app estava pequeno demais para servir como prova;
- o símbolo da Frota aparecia no header, no CTA final e novamente no footer.

Correções aplicadas:

- missão do hero refeita como plano vivo com arquivo, diff e processo de teste;
- headline e espaçamento da Cabine reduzidos, controles alinhados pelo topo e
  janela limitada a uma largura legível;
- tipografia da demonstração ampliada e sidebar ocultada no mobile;
- símbolo removido do CTA final e do footer; o header volta a ser o dono da marca.

## Avaliação por seção

### Header

**Função:** orientar sem competir com a tese e manter o CTA disponível.  
**Avaliação:** correta para beta. A marca é clara, a navegação descreve a página
e Especialistas ganhou uma âncora própria. O CTA “Lista beta” é direto.

### Hero

**Função:** dizer a dor, a diferença e pedir uma ação em uma dobra.  
**Avaliação:** forte. “Troque o agente. Não recomece o trabalho.” é a promessa
mais distintiva do produto. A frase de apoio explica o mecanismo sem jargão. O
formulário curto reduz fricção. O instrumento à direita torna a tese concreta.

**Correção desta rodada:** as métricas do cenário passaram a dizer explicitamente
`DEMO FICTÍCIA`; a página não sugere que números inventados são prova de clientes.

### Cabine / demonstração do produto

**Função:** provar que existe uma interface e que trabalho e retrospectiva fazem
parte do mesmo sistema.  
**Avaliação:** boa como demonstração de beta. As duas vistas são interativas e
rotuladas como dados fictícios. Ainda não substituem capturas reais do app; o
ativo final deve ser gerado pelo modo demo isolado.

### Mudança de eixo

**Função:** reenquadrar a categoria de “mais um chat” para “sistema de trabalho”.  
**Avaliação:** persuasiva. O contraste antes/depois prepara as features seguintes
e transforma conceitos técnicos em perdas reconhecíveis.

### Três pilares

**Função:** tornar a promessa escaneável.  
**Avaliação:** clara, mas propositalmente resumida. Continuidade, controle e
custo por entrega são os três argumentos certos. As seções profundas abaixo
precisam carregar a prova — o que agora acontece com Handoff e Especialistas.

### Revezamento

**Função:** provar o diferencial central.  
**Avaliação:** uma das seções mais fortes. Expõe uma sequência verificável:
contexto preparado, sessão de destino aberta e continuidade confirmada. Evita a
promessa vaga de “memória mágica”.

### Especialistas

**Função:** apresentar um segundo diferencial proprietário.  
**Avaliação:** agora é prova de fluxo, não uma feature em lista. A pessoa escolhe
Aline, Nina ou Caio, dirige uma pergunta, vê parecer e rubrica e pode anexar o
resultado ao próximo turno do executor. Também esclarece que o parecer é
read-only e não altera código sozinho.

### Modos de trabalho

**Função:** mostrar amplitude sem fragmentar a marca.  
**Avaliação:** adequada para early adopters. Linear, Fusion e SDD são descritos
pelo tipo de processo, não por nomes de modelos. Deve continuar depois das
provas principais; antes delas pareceria complexidade prematura.

### Local-first

**Função:** responder objeções de segurança, migração e custo.  
**Avaliação:** necessária e crível. A alegação absoluta “sem API key” foi trocada
por “sem chave nova na Frota”: o produto usa as CLIs e autenticações existentes,
sem prometer que todo provedor do mercado funciona sem credencial.

### Chamada para a beta

**Função:** converter interesse em inscrição com expectativa honesta.  
**Avaliação:** correta para produto em beta. Explica acesso em ondas, canal de
feedback, macOS e ausência de cartão. Não inventa vagas, clientes ou urgência.

## Veredito

A narrativa está persuasiva para **beta privada de early adopters**: dor clara,
tese própria, demonstrações fictícias transparentes e CTA coerente. Ainda não é
uma landing de lançamento pago. Para chegar lá faltam provas externas reais:
capturas/vídeos do modo demo executando no app, depoimentos verdadeiros, casos
de uso e informações comerciais. Nada disso deve ser simulado.

## Próximo gate

Abrir a página no navegador em 1440, 1024, 768 e 390 px; percorrer todas as
âncoras, alternar Trabalho/Retrospectiva, testar os três Especialistas, enviar o
formulário local, revisar console e validar `prefers-reduced-motion`.
