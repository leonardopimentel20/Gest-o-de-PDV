// Verificacao local sem escrita: nao imprime tokens nem dados de clientes.
const assert = require('node:assert/strict');
const db = require('../db');
const jwt = require('jsonwebtoken');
const app = require('../server');
(async () => {
    let servidor;
    try {
        servidor = app.listen(0, '127.0.0.1');
        await new Promise((resolve, reject) => { servidor.once('listening', resolve); servidor.once('error', reject); });
        const base = `http://127.0.0.1:${servidor.address().port}`;
        const [usuarios] = await db.query('SELECT id, cargo FROM usuarios WHERE ativo = 1 LIMIT 1');
        assert.ok(usuarios.length, 'Nenhum usuario ativo para validar as consultas');
        const token = jwt.sign({ id: usuarios[0].id, cargo: usuarios[0].cargo }, process.env.JWT_SECRET, { expiresIn: '1m' });
        for (const rota of ['/health', '/produtos', '/categorias', '/vendas', '/sessoes/ativa', '/api/clientes', '/relatorios/caixas', '/relatorios/estoque-baixo', '/relatorios/mais-vendidos', '/backup/status']) {
            const res = await fetch(base + rota, { headers: { Authorization: `Bearer ${token}` } });
            assert.equal(res.status, 200, rota);
            await res.json();
            console.log(rota + ': OK');
        }
        const [clientes] = await db.query('SELECT id FROM clientes LIMIT 1');
        if (clientes.length) {
            const res = await fetch(base + '/api/clientes/' + clientes[0].id + '/crediarios', { headers: { Authorization: `Bearer ${token}` } });
            assert.equal(res.status, 200); await res.json(); console.log('Historico de crediario: OK');
        }
        const negado = await fetch(base + '/produtos'); assert.equal(negado.status, 401);
        console.log('Acesso sem login bloqueado: OK');
    } finally {
        if (servidor) await new Promise(resolve => servidor.close(resolve));
        await db.end();
    }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
