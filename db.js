const mysql = require('mysql2/promise');
require('dotenv').config({ path: require('path').join(__dirname, '.env') });

const { configuracao } = require('./utils/configuracao');
const config = configuracao();
const pool = mysql.createPool(config.banco);
if (config.fuso !== 'local') {
    // Enfileirada antes de entregar a conexão: NOW() e as datas do driver usam o mesmo fuso.
    pool.on('connection', connection => {
        connection.query('SET time_zone = ?', [config.fuso], error => {
            if (error) {
                console.error('Não foi possível configurar o fuso horário da conexão.');
                connection.destroy();
            }
        });
    });
}

// Testa a conexão ao iniciar sem derrubar a aplicação
pool.getConnection()
    .then(connection => {
        console.log('📦 Conectado ao banco de dados MySQL/MariaDB com sucesso!');
        connection.release();
    })
    .catch(err => {
        console.error('❌ Erro ao conectar ao banco de dados:', err.message);
    });

module.exports = pool;
