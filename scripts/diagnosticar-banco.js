const db = require('../db');
(async () => {
    try {
        const [config] = await db.query('SELECT @@datadir AS pasta_dados, @@innodb_flush_log_at_trx_commit AS gravacao_commit, @@system_time_zone AS fuso_sistema, @@session.time_zone AS fuso_sessao');
        const [engines] = await db.query('SELECT ENGINE, COUNT(*) AS tabelas FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() GROUP BY ENGINE');
        console.log(JSON.stringify({ configuracao: config, tabelas: engines }, null, 2));
    } finally { await db.end(); }
})().catch(e => { console.error(e.code || 'Falha no diagnóstico'); process.exitCode = 1; });
