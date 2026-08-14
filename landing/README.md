# Frota Landing

Landing page independente para testar o posicionamento e captar interessados na beta da Frota.

## Rodar localmente

```bash
cd landing
bun install
bun run dev
```

Acesse `http://localhost:5173`.

## Formulário da beta

Por padrão, o formulário funciona como protótipo local e guarda a inscrição no `localStorage` do navegador. Para enviar as inscrições a um serviço real, copie `.env.example` para `.env.local` e configure `VITE_BETA_ENDPOINT` com uma URL que aceite `POST` JSON:

```json
{
  "email": "pessoa@exemplo.com",
  "profile": "Solo builder",
  "source": "frota-landing"
}
```

O endpoint não está incluído nesta pasta para manter a landing desacoplada do app desktop.

## Comandos

```bash
bun run build
bun run lint
bun run preview
```

## Decisões de produto

- Público inicial: builders, founders técnicos e pequenos times que já usam duas ou mais CLIs de agentes.
- Trabalho principal da página: levar uma pessoa qualificada para a lista beta.
- Território: continuidade operacional entre agentes, contexto pertencendo ao projeto e custo por entrega.
- Direção visual: aviação instrumental contemporânea; sem partículas, cérebros, robôs ou gradientes “de IA”.
- A animação foi implementada com Motion e CSS. Three.js não foi adicionado porque a prova do produto e a rota de missão comunicam melhor a proposta com menos peso.

## Política das demonstrações

- A landing nunca usa o banco, os caminhos ou os projetos pessoais do ambiente de desenvolvimento.
- A vitrine atual é uma demonstração declarada, com projetos e métricas fictícios.
- Capturas e vídeos finais devem vir do app real iniciado em modo de demonstração determinístico.
- Todo ativo passa por uma varredura de nomes, caminhos, e-mails e metadados antes de entrar em `public/`.
