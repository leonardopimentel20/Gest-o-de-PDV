# PDV na Azure — preparação de demonstração

Esta revisão prepara a conexão e o pacote para App Service Linux + Azure Database for MySQL Flexible Server. Não cria recursos, não publica o sistema, não migra dados ou usuários e não modifica a entrega local PDV-CLIENTE.

## Conta e custo

O Azure for Students oferece US$ 100 por 12 meses e pode ser renovado enquanto os requisitos de estudante forem atendidos. O crédito é da assinatura inteira: outras aplicações e recursos compartilham o saldo. Benefícios gratuitos têm limites e prazos próprios, não são renovados automaticamente por criar outro aplicativo.

A Microsoft limita a finalidade da oferta a ensino, pesquisa não comercial e desenvolvimento/testes associados. Use-a para demonstração educacional. Para o PDV comercial do cliente, escolha uma assinatura apropriada ao uso e um orçamento de produção.

Referências: [oferta Students](https://azure.microsoft.com/en-us/free/students/) e [FAQ oficial](https://learn.microsoft.com/en-us/azure/education-hub/faq).

Não há uma previsão de preço fechada sem verificar a assinatura, a região, a elegibilidade e as opções selecionadas. US$ 100 divididos por 12 meses equivalem a aproximadamente US$ 8,33 por mês: isso é uma divisão do saldo, não uma estimativa de custo nem uma franquia mensal. Recursos cobrados por hora podem consumir crédito mesmo sem alguém abrir o PDV. Se o crédito acabar, os serviços podem ser desativados se a assinatura não for atualizada.

## Informações necessárias, sem segredos

- Nome da oferta da assinatura (por exemplo, Azure for Students), saldo e validade.
- Regiões disponíveis para criar App Service e MySQL e benefícios gratuitos exibidos no portal.
- Nome desejado para a aplicação e se o ambiente será apenas de demonstração.
- Para produção, orçamento mensal e quantidade de lojas/operadores simultâneos.

Não envie senha Microsoft, códigos de MFA, senhas do banco, JWT_SECRET, tokens ou arquivos de perfil de publicação. Faça login diretamente no portal ou com `az login` no seu terminal. Os exemplos abaixo usam nomes fictícios.

## Caminho de implantação pelo portal

1. Entre em [portal.azure.com](https://portal.azure.com). Abra **Assinaturas**, selecione a oferta e confira o saldo no portal de créditos/Sponsorships indicado pela sua assinatura. Confira também as cotas de serviços gratuitos e regiões disponíveis. Esta é a primeira etapa antes de criar qualquer recurso.
2. Crie um grupo de recursos de demonstração, por exemplo `rg-pdv-demo`. Use a mesma região para aplicação e banco quando possível.
3. Crie **Azure Database for MySQL Flexible Server**. Para uma demonstração elegível ao benefício, confira **Burstable B1ms**, **32 GB** e as condições mostradas no portal. A oferta Students anuncia 750 horas/mês, 32 GB de armazenamento e 32 GB de backup para MySQL durante 12 meses para clientes elegíveis. Se a opção não aparecer ou apresentar cobrança inesperada, pare para revisar a estimativa; não substitua automaticamente por um plano maior. Não selecione alta disponibilidade ou recursos extras sem calcular o custo.
4. Mantenha TLS obrigatório. Configure o fuso do banco e da aplicação para a loja. Este projeto configura cada conexão com `DB_TIMEZONE=-03:00`, inclusive as gravações com NOW(). Para demonstração com acesso público do banco, libere somente seu IP e os IPs de saída da aplicação. Não libere todas as origens nem toda a Azure por conveniência.
5. Crie o banco `pdv_demo`, importe **somente a estrutura** das tabelas e crie um usuário de demonstração no PDV. O banco local e seus cinco usuários ficam preservados. Esta etapa exige preparar e validar o esquema MariaDB no MySQL escolhido; não use o dump com dados do cliente. O projeto ainda não contém um instalador de esquema nem criação automática do primeiro usuário. Não publique como operacional antes de concluir essa etapa.
6. Crie **App Service / Aplicativo Web**, publicação por **Código**, sistema **Linux** e runtime Node.js compatível (o projeto foi testado com Node.js 24; confira a disponibilidade no portal). Use `npm start` como comando de inicialização. Para demonstração, selecione **F1 Free** somente se estiver disponível. É um plano de desenvolvimento/testes com cotas de CPU; não é a indicação para manter o caixa do cliente em produção. Se F1 não estiver disponível, revise os custos antes de escolher outro plano.
7. No aplicativo, ative **HTTPS Only**. Em **Rede / Restrições de acesso**, restrinja o acesso de demonstração ao seu IP. Restrinja também o site de implantação (SCM) conforme o método de deploy escolhido. Esta preparação ainda não libera a aplicação para produção pública.
8. Em **Variáveis de ambiente / Configurações do aplicativo**, adicione os valores da tabela abaixo. Digite os segredos diretamente no portal; não faça upload do `.env` local. Salve e reinicie o aplicativo.
9. Abra as propriedades do App Service e obtenha os IPs de saída possíveis. Cadastre os IPs necessários no firewall do MySQL. Em produção, planeje conectividade privada e os planos necessários. Alterações de plano/infraestrutura podem exigir revisão desses IPs.
10. Gere o pacote no computador de desenvolvimento:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/gerar-pacote-azure.ps1
```

O ZIP em `entregas/` contém somente fontes, sem `.env`, banco, node_modules do Windows ou dados. No App Service, configure `SCM_DO_BUILD_DURING_DEPLOYMENT=true` para instalar as dependências na implantação.

11. Com Azure CLI instalado, faça o login interativo e confira a assinatura selecionada. Publique substituindo os exemplos pelo recurso e ZIP efetivos:

```powershell
az login
az account show --query "{nome:name, id:id}" --output table
az webapp deploy --resource-group rg-pdv-demo --name NOME-REAL-DO-APP --src-path CAMINHO-DO-ZIP --type zip
```

O comando de publicação deve ser executado somente após revisar os recursos, o custo e as variáveis. O login usa sua conta diretamente; não precisa me passar credenciais.

12. Consulte os logs de inicialização e abra o endereço HTTPS mostrado no portal seguido de `/login.html`. Confira login, perfis, uma venda de demonstração, estoque, fechamento e filtros de data. Teste uma venda perto da meia-noite no ambiente de testes. Valide restauração do banco antes de considerar uso real.

## Variáveis do App Service

| Nome | Valor / finalidade |
| --- | --- |
| DEPLOY_TARGET | `azure` |
| NODE_ENV | `production` |
| HOST | `0.0.0.0` |
| DB_HOST | Nome completo do servidor `...mysql.database.azure.com` |
| DB_PORT | `3306` |
| DB_NAME | `pdv_demo` |
| DB_USER | Usuário de banco exclusivo para a aplicação, com permissões limitadas |
| DB_PASSWORD | Senha do usuário, cadastrada diretamente no portal |
| DB_SSL | `true` |
| DB_SSL_CA_PATH | Opcional: caminho do bundle PEM público de CAs, se necessário |
| DB_TIMEZONE | `-03:00` para esta loja |
| JWT_SECRET | Chave nova, aleatória e exclusiva, com pelo menos 32 caracteres |
| JWT_EXPIRES_IN | `8h` |
| SCM_DO_BUILD_DURING_DEPLOYMENT | `true` |

Não fixe PORT: a aplicação usa a porta fornecida pelo App Service. Não copie HOST=127.0.0.1, DB_SSL=false ou DB_TIMEZONE=local do ambiente local. A validação TLS fica sempre ativa; caso falte uma autoridade certificadora, configure as CAs públicas indicadas pela Microsoft em vez de desativar a verificação.

Não defina BACKUP_DIR na Azure. O script de dumps locais não é a estratégia de backup para App Service; o armazenamento local da aplicação não substitui um serviço de backup. A mensagem de backup local na tela não verifica os backups gerenciados da Azure.

## Backups e continuidade

No MySQL Flexible Server, configure retenção e confira os backups automáticos no portal. O serviço permite restauração para um ponto no tempo dentro da retenção configurada; ela não substitui ensaios de recuperação nem retenção independente. Consulte as condições e custos da redundância/armazenamento antes de ampliar opções.

Uma queda de energia no computador da loja não desliga o banco hospedado na Azure. Porém este PDV **não funciona offline**: sem internet na loja, não será possível consultar ou registrar vendas pelo sistema. Não existe sincronização automática entre o banco local e o da Azure. Use um banco como fonte oficial e planeje a migração em uma janela sem atendimento.

## Antes de produção pública

A preparação de conexão não é uma aprovação de segurança. A revisão identificou permissões de operador aplicadas na interface, sem uma política completa por rota na API. Também precisam ser revisados limitação de tentativas de login, invalidação de sessões de usuários desativados, renderização de entradas em HTML, dependências e recuperação em caso de requisições repetidas. Mantenha a demonstração restrita e sem dados reais até concluir essa revisão e validar a migração.

## Fontes oficiais

- [Planos App Service e compartilhamento de recursos entre aplicações](https://learn.microsoft.com/en-us/azure/app-service/overview-hosting-plans)
- [Configuração Node.js](https://learn.microsoft.com/en-us/azure/app-service/configure-language-nodejs)
- [Implantação ZIP e build](https://learn.microsoft.com/en-us/azure/app-service/deploy-zip)
- [TLS do MySQL Flexible Server](https://learn.microsoft.com/en-us/azure/mysql/flexible-server/security-tls-how-to-connect)
- [Backup e restauração](https://learn.microsoft.com/en-us/azure/mysql/flexible-server/concepts-backup-restore)
