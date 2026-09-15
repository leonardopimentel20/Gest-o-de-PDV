// Utilitário para gerar o hash de uma senha (uso manual, para cadastrar usuários no banco).
//
// Como usar:
//   node scripts/gerar-hash-senha.js "minhaSenha123"
//
// O hash gerado deve ser colocado na coluna `senha_hash` da tabela `usuarios`.

const bcrypt = require('bcryptjs');

const senha = process.argv[2];

if (!senha) {
    console.log('Uso: node scripts/gerar-hash-senha.js "suaSenhaAqui"');
    process.exit(1);
}

const hash = bcrypt.hashSync(senha, 10);
console.log('\nHash gerado (copie e cole na coluna senha_hash do usuário no banco):\n');
console.log(hash);
console.log('');
