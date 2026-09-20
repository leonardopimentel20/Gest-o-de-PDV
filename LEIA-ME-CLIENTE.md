# Instalação e proteção dos dados do PDV

## Atualizar o computador do cliente

1. Termine o atendimento e encerre o servidor antigo antes de substituir a aplicação. Fechar apenas a aba do navegador não encerra o servidor. Reiniciar o Windows antes da troca é uma alternativa, desde que o PDV não seja iniciado automaticamente.
2. Preserve a pasta anterior e o `.env` do cliente. Faça uma cópia de segurança do banco do cliente antes da atualização.
3. Copie a pasta **PDV-CLIENTE** para o computador. Ela contém a aplicação e suas dependências; não contém banco, usuários, vendas, `.env` de desenvolvimento nem ferramentas de limpeza.
4. Coloque o **`.env` do cliente** ao lado de `iniciar.vbs`. Mantenha DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD, JWT_SECRET e PORT existentes se o banco e a porta continuarem os mesmos. Não substitua pelo `.env` do computador de desenvolvimento.
5. Node.js e o serviço MySQL/MariaDB precisam estar instalados. As dependências incluídas foram verificadas no Windows com Node.js 24. Se houver incompatibilidade de arquitetura ou módulo nativo, execute `npm.cmd ci` nesta pasta para reinstalá-las na máquina do cliente (requer internet).
6. Abra **iniciar.vbs**. Se usar atalho, aponte-o para esse arquivo na nova pasta. Faça login e confira o histórico, produtos e clientes antes de retomar as vendas.

Esta revisão não altera tabelas nem apaga registros na inicialização. Os usuários e senhas pertencem ao banco do cliente e continuam nele. Não restaure o banco de testes sobre a instalação do cliente.

## Onde ficam os dados

O banco é administrado pelo serviço MySQL/MariaDB, fora da aplicação. O `.env` indica a conexão, não a pasta física dos dados. A pasta de dados é definida pelo `datadir` da instância do servidor de banco.

Para conferir a instância realmente acessada pelo `.env`, execute:

```bat
node scripts\diagnosticar-banco.js
```

Isso apenas consulta a pasta em uso, a configuração de gravação e os tipos das tabelas. Não move nem altera o banco. Preserve a pasta retornada e o serviço correspondente nas atualizações. Não copie arquivos internos do banco em funcionamento como se fossem um backup válido.

Se o computador for outro, só copiar a aplicação e o `.env` não transporta o banco. É necessário restaurar uma cópia do banco do cliente na nova instância e ajustar a conexão.

## Ativar backups

Adicione estas linhas ao `.env` do cliente, escolhendo um destino real **fora da aplicação e fora da pasta de dados do banco**:

```dotenv
BACKUP_DIR="D:/BackupsPDV"
BACKUP_INTERVAL_MINUTES=30
```

`D:/BackupsPDV` é um exemplo: não funcionará se a unidade não existir. Prefira outra unidade física ou uma pasta sincronizada já configurada pelo responsável. Uma pasta no mesmo disco ajuda contra exclusão acidental, mas não protege contra defeito desse disco. O sistema grava somente no destino escolhido; ele não configura nem envia dados para serviços de nuvem por conta própria.

O utilitário MariaDB é procurado em Program Files. Se estiver em outro local, ou se usar MySQL, informe também:

```dotenv
BACKUP_DUMP_EXE="C:/Program Files/MariaDB 12.3/bin/mariadb-dump.exe"
```

Use o caminho da instalação do cliente; o exemplo não deve ser copiado sem conferir. O usuário do banco precisa ter permissão para exportar as tabelas, views, rotinas, eventos e gatilhos.

Reinicie o servidor depois de editar o `.env`. Com BACKUP_DIR configurado, o PDV faz uma cópia ao iniciar e repete a cada 30 minutos **enquanto o servidor estiver funcionando**. Para executar imediatamente, abra **backup-agora.cmd**. Esse comando também funciona com o PDV fechado, desde que o banco esteja em funcionamento.

Confira a situação na página de Relatórios. Um arquivo `.sql` só recebe o nome definitivo após o utilitário terminar com sucesso. Arquivos `.partial` deixados por uma interrupção não são cópias completas. Cada backup usa um nome novo; cópias anteriores não são sobrescritas nem apagadas automaticamente. Acompanhe o espaço disponível e mantenha versões recentes e históricas em outro dispositivo.

Sem BACKUP_DIR o backup automático fica **desativado** e a tela informa isso. Esta entrega não define o destino do cliente, pois ele ainda não foi informado.

## Queda de energia e recuperação

As vendas confirmadas são gravadas pelo banco durante o uso, não apenas quando o PDV fecha. Backups são uma proteção adicional. Não é possível executar uma cópia depois que a energia já caiu. Em caso de perda do disco, podem faltar as operações posteriores ao último backup válido; com intervalo de 30 minutos, pode haver até 30 minutos de operações sem cópia, ou mais se um backup tiver falhado.

Após uma interrupção durante uma venda, consulte o histórico antes de reenviá-la. Um nobreak ajuda a permitir desligamento correto, mas não substitui cópias externas.

Para recuperar dados, peça ao responsável técnico para:

1. Parar o PDV e preservar o banco atual, se ainda estiver acessível.
2. Escolher uma cópia `.sql` completa e restaurá-la primeiro em uma instância isolada, compatível com a versão do banco. O dump inclui o nome do banco e comandos de recriação de tabelas; não importe sobre o banco em uso sem avaliar o que será substituído.
3. Conferir usuários, produtos, clientes, vendas e saldos restaurados antes de ajustar o `.env` e retomar o atendimento.

Os dumps contêm dados do negócio e hashes de senhas dos usuários. Proteja o acesso à pasta e não os envie ao Git. Uma exportação concluída deve ser complementada por ensaios periódicos de restauração em ambiente separado.

Referência: [documentação oficial do mariadb-dump](https://mariadb.com/docs/server/clients-and-utilities/backup-restore-and-import-clients/mariadb-dump).

## Relatórios

- Use **Ontem**, **Esta semana**, **Semana passada** ou um intervalo em **De / Até**. Somente **De** preenchido busca aquele dia. A data final é inclusiva.
- O filtro de pagamento combina com o período. Abaixo da tabela aparecem a quantidade e o total das vendas exibidas.
- Os três cartões mostram hoje, semana atual e mês atual, considerando todas as formas de pagamento. O total filtrado fica separado abaixo da tabela.
- A semana vai de segunda a domingo. Na segunda o total considera a nova semana automaticamente, preservando todo o histórico. Não exige fechar o caixa semanalmente.
- **Atualizar dados** busca as vendas mais recentes. **Todo o histórico** limpa o período; o filtro de pagamento continua selecionado.
- O botão PDF abre a impressão do navegador; escolha “Salvar como PDF”.
