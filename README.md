# Gestão de PDV

Sistema de ponto de venda para pequenos comércios, com interface web e execução local. Desenvolvido com Node.js, Express e MySQL/MariaDB.

## Funcionalidades

- Cadastro e edição de produtos, categorias e controle de estoque.
- Frente de caixa com busca por nome ou código de barras e itens avulsos.
- Vendas em dinheiro, Pix, cartão de crédito, cartão de débito e crediário.
- Cadastro de clientes, limite de crédito e consulta de compras pendentes.
- Abertura e fechamento de caixa.
- Relatórios de vendas, caixas, estoque baixo e produtos mais vendidos.
- Login com senha protegida por bcrypt e autenticação da API com JWT.

## Executar localmente

Requisitos: Node.js compatível com o executor nativo de testes (a revisão foi validada com Node.js 24), npm e MySQL/MariaDB.

**O repositório ainda não inclui um script de criação do banco.** Para executar, é necessário ter uma base com a estrutura compatível e um usuário ativo cadastrado. Não use o banco comercial para testes que alteram dados.

1. Clone o repositório e entre na pasta do projeto.
2. Instale as dependências:

   ```sh
   npm ci
   ```

3. Copie `.env.example` para `.env` e configure a conexão com o banco, uma chave `JWT_SECRET` própria e a porta HTTP.
4. Inicie o servidor:

   ```sh
   npm start
   ```

5. Abra `http://127.0.0.1:3000/login.html`, substituindo `3000` pelo valor de `PORT` do seu `.env`.

No Windows, execute **iniciar.vbs** ou crie um atalho para ele. O inicializador localiza a pasta, aguarda o servidor e o banco e abre o navegador. Se a mesma instância já estiver disponível, ela é reutilizada. Erros de inicialização ficam na pasta `logs/`.

O servidor escuta apenas na interface local. Esta configuração não publica o sistema na internet.

## Testes e verificação

```sh
npm test
```

A suíte usa um banco simulado e não altera o MySQL. Cobre autenticação, validação de entradas, transações, estoque insuficiente, caixa fechado, limite de crédito, itens avulsos e prevenção de envios simultâneos na tela.

Com o servidor iniciado, execute as verificações de leitura:

```sh
node scripts/verificar-leitura.js
```

Esse comando consulta o banco configurado sem modificar registros ou imprimir dados pessoais. Não substitui um ensaio completo em uma base de testes.

## Organização

| Caminho | Responsabilidade |
| --- | --- |
| `server.js` | API e regras de negócio |
| `db.js` | Conexão com MySQL/MariaDB |
| `middleware/` | Autenticação |
| `utils/` | Validação de entradas |
| `public/` | Telas, estilos e JavaScript do navegador |
| `scripts/` | Inicialização e ferramentas de manutenção |
| `tests/` | Testes de regressão isolados |

Os utilitários de geração de hash e migração de senhas são ferramentas administrativas manuais. A migração altera o banco: exige backup prévio e não faz parte da inicialização normal.

## Atualização de uma instalação

Consulte [ATUALIZACAO.md](ATUALIZACAO.md) para o procedimento de backup, instalação e retorno à versão anterior. Preserve o `.env` do cliente. Credenciais, banco, dependências instaladas, logs e pacotes locais não são versionados.

## Limites conhecidos

- A prevenção de clique duplo cobre requisições simultâneas na mesma tela. Após uma queda de conexão, confira o histórico antes de reenviar uma venda.
- A conferência de caixa mantém a regra de abertura mais todas as vendas, incluindo pagamentos eletrônicos e crediário; não representa apenas o dinheiro físico na gaveta.
- A revisão não inclui integração fiscal, processamento de pagamentos ou implantação em nuvem.
