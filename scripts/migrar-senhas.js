// Este script converte, uma única vez, as senhas que ainda estão em texto puro
// na tabela `usuarios` para hashes bcrypt. É seguro rodar mais de uma vez: ele
// pula qualquer senha que já esteja no formato bcrypt (começa com "$2").
//
// FAÇA UM BACKUP DO BANCO ANTES DE RODAR.
//
// Como usar:
//   node scripts/migrar-senhas.js

require('dotenv').config();
const bcrypt = require('bcryptjs');
const db = require('../db');

async function migrar() {
    const [usuarios] = await db.query('SELECT id, nome, senha_hash FROM usuarios');

    let convertidos = 0;

    for (const usuario of usuarios) {
        const jaEhHash = typeof usuario.senha_hash === 'string' && usuario.senha_hash.startsWith('$2');

        if (jaEhHash) {
            console.log(`- ${usuario.nome}: já está em formato hash, pulando.`);
            continue;
        }

        const novoHash = bcrypt.hashSync(usuario.senha_hash, 10);
        await db.query('UPDATE usuarios SET senha_hash = ? WHERE id = ?', [novoHash, usuario.id]);
        console.log(`- ${usuario.nome}: senha convertida para hash com sucesso.`);
        convertidos++;
    }

    console.log(`\nMigração concluída. ${convertidos} senha(s) convertida(s).`);
    process.exit(0);
}

migrar().catch(err => {
    console.error('Erro ao migrar senhas:', err);
    process.exit(1);
});
