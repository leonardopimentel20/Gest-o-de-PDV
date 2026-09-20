# Gestão de PDV

Sistema de ponto de venda para pequenos comércios, com interface web, execução local ou em Docker e hospedagem na Railway. Desenvolvido com Node.js, Express e MySQL/MariaDB.

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

Com `HOST=127.0.0.1`, o servidor escuta apenas na interface local. Em contêineres, use `HOST=0.0.0.0`.

## Docker e Railway

O `Dockerfile` existente constrói a aplicação com `node:18-alpine`, instala as dependências e executa `npm start`. O banco é configurado pelas variáveis `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD` e `DB_NAME`; ele não faz parte da imagem da aplicação.

Para construir e executar com um banco já existente:

```sh
docker build -t gestao-pdv .
docker run --name gestao-pdv --env-file .env -e HOST=0.0.0.0 -e PORT=3000 -p 3000:3000 -d gestao-pdv
docker logs -f gestao-pdv
```

Configure uma `JWT_SECRET` própria no `.env`. Dentro do contêiner, `127.0.0.1` aponta para o próprio contêiner: use o endereço acessível do banco em `DB_HOST` (no Docker Desktop, `host.docker.internal` para um banco no computador). Acesse `http://localhost:3000/login.html`.

O `docker-compose.yml` inclui a aplicação e um MariaDB com volume persistente `db_data`. Antes de usá-lo, substitua os valores de exemplo de usuário, senha e banco nos dois serviços e acrescente `HOST=0.0.0.0`, `PORT=3000` e `JWT_SECRET=${JWT_SECRET}` ao `environment` do serviço `app`. Defina essa chave no `.env`. Então execute:

```sh
docker compose up -d --build
docker compose logs -f app
docker compose down
```

O Compose publica a aplicação na porta `3000` e o banco na porta `3307` do computador; entre os serviços, a aplicação usa `db:3306`. O volume preserva o banco ao recriar contêineres. `docker compose down -v` remove esse volume e seus dados. Ainda é necessário importar a estrutura e os dados compatíveis: o Compose não cria as tabelas do PDV.

Na Railway, a implantação usa o `Dockerfile` do repositório. Configure as variáveis de banco e `JWT_SECRET` no serviço, use `HOST=0.0.0.0` e mantenha a porta do processo alinhada à porta de destino do domínio (`PORT`). O endereço do banco deve ser acessível pelo serviço da aplicação. Para publicar alterações de interface, envie o commit para a branch conectada e faça uma nova implantação da imagem.

## Uso no celular

As seis telas carregam `public/css/responsivo.css`: menus quebram linha, formulários ficam em uma coluna e a frente de caixa permite rolagem vertical em telas menores. Tabelas largas têm rolagem horizontal própria, preservando todas as colunas. Login e janelas de diálogo se ajustam à largura disponível. As regras de celular são limitadas à mídia de tela para preservar a impressão dos relatórios.

## Testes e verificação

```sh
npm test
```

A suíte usa um banco simulado e não altera o MySQL. Cobre autenticação, validação de entradas, transações, estoque insuficiente, caixa fechado, limite de crédito, itens avulsos e prevenção de envios simultâneos na tela.

Para conferir as rotas e o banco configurado, execute as verificações de leitura (o script abre e encerra uma instância temporária em porta livre):

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

Para montar a pasta de transferência no Windows, execute `powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts\gerar-entrega.ps1`. A pasta `PDV-CLIENTE` é criada ao lado do projeto, com os arquivos necessários e dependências, sem `.env`, dados, testes ou ferramentas administrativas de limpeza/migração. O gerador recusa sobrescrever uma entrega existente.

O [guia do cliente](LEIA-ME-CLIENTE.md) explica a preservação do banco, os filtros de relatórios e a configuração opcional de backups automáticos. O backup não é ativado até que `BACKUP_DIR` seja definido no `.env`.

## Limites conhecidos

- A prevenção de clique duplo cobre requisições simultâneas na mesma tela. Após uma queda de conexão, confira o histórico antes de reenviar uma venda.
- A conferência de caixa mantém a regra de abertura mais todas as vendas, incluindo pagamentos eletrônicos e crediário; não representa apenas o dinheiro físico na gaveta.
- A revisão não inclui integração fiscal ou processamento de pagamentos.
