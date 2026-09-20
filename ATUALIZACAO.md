# Atualização do PDV

Transfira somente a pasta PDV-CLIENTE, gerada por scripts/gerar-entrega.ps1.
Siga [LEIA-ME-CLIENTE.md](LEIA-ME-CLIENTE.md) para preservar o .env, o banco e os usuários do cliente, configurar backups e recuperar dados.

A revisão corrige as datas do relatório, adota semana de segunda a domingo, acrescenta filtros por período, melhora o layout e oferece backups periódicos opcionais.

A entrega não contém dados de testes, credenciais, dumps, logs, histórico Git nem scripts de limpeza. Não executa migrações ou limpezas na inicialização. Os fontes e testes permanecem na pasta de desenvolvimento.
