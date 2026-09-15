const db = require('./db');
const bcrypt = require('bcrypt');

async function testarConsulta() {
    try {
        const [rows] = await db.query('SELECT * FROM usuarios');
        console.log('--- USUÁRIOS CADASTRADOS NO BANCO ---');
        console.table(rows);

        const usuario = rows.find(u => u.nome.toLowerCase() === 'eduardo');
        if (!usuario) {
            console.log('❌ Usuário "Eduardo" não foi encontrado na tabela usuarios!');
            process.exit(0);
        }

        console.log('✅ Usuário encontrado:', usuario.nome);
        console.log('Hash no banco:', usuario.senha_hash);

        const senhaValida = await bcrypt.compare('eduarda123456', usuario.senha_hash);
        console.log('🔒 A senha "eduarda123456" confere com o hash?', senhaValida ? 'SIM (Correto)' : 'NÃO (Incompatível)');
        
        process.exit(0);
    } catch (error) {
        console.error('Erro no teste:', error);
        process.exit(1);
    }
}

testarConsulta();