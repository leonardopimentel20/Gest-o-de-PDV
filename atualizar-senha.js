const db = require('./db');
const bcrypt = require('bcrypt');

async function atualizarSenhas() {
    try {
        const novaSenha = 'eduarda123456';
        const hash = await bcrypt.hash(novaSenha, 10);

        await db.query(
            'UPDATE usuarios SET senha_hash = ? WHERE nome IN (?, ?)',
            [hash, 'Camila', 'Eduardo']
        );

        console.log('Sucesso! As senhas da Camila e do Eduardo foram atualizadas para "eduarda123456".');
        process.exit(0);
    } catch (error) {
        console.error('Erro ao atualizar senha:', error);
        process.exit(1);
    }
}

atualizarSenhas();