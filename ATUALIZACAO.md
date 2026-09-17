# Revisao de estabilidade do PDV

## Abrir neste computador

Use o atalho **Sistema-PDV** da area de trabalho. Ele aponta para esta pasta.
O inicializador descobre a pasta automaticamente, inicia o servidor oculto,
aguarda servidor e MySQL e abre http://127.0.0.1:3001/login.html.
A porta local foi ajustada no .env porque 3000 pertence a outro projeto.
O atalho **Gestao PDV** aponta para outra versao e nao foi alterado.
Se ocorrer erro de abertura, consulte logs/erros.log e confira o servico MySQL.
Cliques adicionais reutilizam a instancia desta pasta. Outra aplicacao na mesma
porta gera uma mensagem; o inicializador nao encerra processos de terceiros.

## Correcoes

- API exige token valido; telas enviam token inclusive em caixa e relatorios.
- Venda usa o operador autenticado e verifica se o caixa continua aberto.
- Transacoes sempre sao confirmadas ou desfeitas; conexoes sao liberadas.
- Estoque e limite de credito sao consultados com bloqueio durante a venda.
- Abertura simultanea de caixas e serializada por bloqueio no MySQL.
- Validacao de numeros, quantidades, estoque e valores de abertura/fechamento.
- Total de vendas calculado em centavos; codigo de barras duplicado retorna aviso.
- Clique repetido/F10 nao envia duas vendas simultaneas na mesma tela.
- Nome de produto avulso preservado; estoque e clientes recarregados apos venda.
- Se mudar o texto da busca de cliente, a selecao anterior e descartada.
- Caminhos de arquivos estaticos e .env independem da pasta de execucao.
- Usuarios inativos nao conseguem fazer novo login.

## Atualizar o computador do comercio

1. Termine as operacoes e encerre o servidor do PDV antes de copiar arquivos.
2. Faca backup completo do banco MySQL e copie a pasta atual para permitir retorno.
3. Copie os arquivos desta revisao para a pasta instalada, preservando o .env do
   cliente. Nao copie o .env deste computador: credenciais e porta sao locais.
4. Mantenha as dependencias instaladas. Esta revisao nao adiciona dependencias
   nem exige alteracao de tabelas. Node.js e MySQL precisam estar disponiveis.
5. Mantenha o atalho apontando para iniciar.vbs na pasta instalada. O lancador
   le a porta no .env; as telas usam automaticamente o endereco de abertura.
6. Abra o atalho e faca login novamente. Confira produtos, clientes, historico,
   caixa e relatorios antes de retomar o atendimento.
7. Para voltar, encerre o servidor e recoloque a pasta anterior preservada.
   Nao restaure um backup antigo do banco sobre vendas feitas apos a atualizacao.

## Verificacao

- `npm test`: testes isolados com banco simulado; nao escreve no MySQL.
- `node scripts/verificar-leitura.js`: com servidor iniciado, verifica consultas
  no banco configurado, sem alterar registros e sem imprimir dados pessoais.
- A suite antiga tests/api.test.js foi removida por estar desatualizada e
  poder alterar dados reais. Use a suite isolada executada por npm test.

## Limites desta revisao

Os testes isolados nao substituem um ensaio de venda, crediario e fechamento
em copia descartavel do banco. Nao foram lancadas vendas no banco existente.
A prevencao de clique duplo nao garante idempotencia apos queda de conexao;
consulte o historico antes de reenviar uma venda cujo resultado ficou incerto.
O relatorio de caixa conserva a regra atual de abertura mais total de vendas,
incluindo pagamentos eletronicos e crediario; nao representa somente dinheiro
fisico na gaveta. A regra deve ser combinada antes de mudar a conferencia.

Validacao executada: 18 testes passaram; consultas reais de produtos, categorias,
vendas, caixa, clientes, crediario e relatorios responderam corretamente.
Sintaxe dos scripts das seis telas verificada. Inicializador executado duas vezes
com sucesso. Inspecao visual completa indisponivel: navegador nao conectado.

O arquivo entregas/PDV-revisao.zip contem os arquivos da revisao e este guia,
sem .env, dados do banco, logs ou node_modules. Extraia na pasta do sistema
seguindo o procedimento de backup acima. Nao e um instalador independente.
