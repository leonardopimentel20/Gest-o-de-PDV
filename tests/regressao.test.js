const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const { validarItensVenda, validarProduto, ehNumeroPositivo } = require('../utils/validacao');

// Banco simulado: esta suite nunca importa db.js nem se conecta ao MySQL.
let consultas = [], eventos = [], falhaConexao = false, caixaAberto = true, estoque = 10, limite = 100;
const conexao = {
    async beginTransaction() { eventos.push('begin'); },
    async commit() { eventos.push('commit'); },
    async rollback() { eventos.push('rollback'); },
    release() { eventos.push('release'); },
    async query(sql, args) {
        consultas.push({ sql, args });
        if (sql.includes('GET_LOCK')) return [[{ adquirido: 1 }]];
        if (sql.includes('FROM sessoes_caixa')) return [caixaAberto ? [{ id: 1 }] : []];
        if (sql.includes('FROM clientes')) return [[{ limite_credito: limite }]];
        if (sql.includes('total_devido')) return [[{ total_devido: 0 }]];
        if (sql.includes('FROM produtos')) return [[{ estoque_atual: estoque, nome: 'Produto' }]];
        if (sql.startsWith('UPDATE produtos')) estoque -= Number(args[0]);
        return [{ insertId: 20, affectedRows: 1 }];
    }
};
const dbPath = require.resolve('../db');
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: {
    async getConnection() { if (falhaConexao) throw new Error('Banco indisponivel'); return conexao; },
    query: (...args) => conexao.query(...args)
} };
process.env.JWT_SECRET = 'chave-apenas-para-teste-isolado';
const app = require('../server');
let servidor, base;
test.before(async () => { servidor = app.listen(0, '127.0.0.1'); await new Promise(r => servidor.once('listening', r)); base = `http://127.0.0.1:${servidor.address().port}`; });
test.after(() => new Promise(r => servidor.close(r)));
test.beforeEach(() => { consultas = []; eventos = []; falhaConexao = false; caixaAberto = true; estoque = 10; limite = 100; });
const token = jwt.sign({ id: 7, cargo: 'admin' }, process.env.JWT_SECRET);
function enviar(body, autenticado = true, rota = '/vendas', method = 'POST') {
    return fetch(base + rota, { method, headers: { 'Content-Type': 'application/json', ...(autenticado ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
}
const venda = () => ({ sessao_caixa_id: 1, usuario_id: 999, forma_pagamento: 'dinheiro', itens: [{ produto_id: 1, quantidade: 2, preco_unitario: 0.1 }] });
test('numeros invalidos nao sao convertidos silenciosamente', () => { for (const v of [null, '', ' ', true, [], {}, Infinity, -1]) assert.equal(ehNumeroPositivo(v), false); });
test('validacao aceita avulso e rejeita itens malformados', () => {
    assert.deepEqual(validarItensVenda([{ produto_id: null, nome: 'Avulso', quantidade: 1, preco_unitario: 5 }]), []);
    for (const itens of [null, {}, [], [null], [{ quantidade: 1 }], [{ quantidade: 0.5, preco_unitario: 2 }]]) assert.ok(validarItensVenda(itens).length);
});
test('produto rejeita estoque fracionario e custo negativo', () => {
    const produto = { codigo_barras: '123', nome: 'Produto', preco_custo: 1, preco_venda: 2, estoque_atual: 0, estoque_minimo: 0 };
    assert.deepEqual(validarProduto(produto), []);
    assert.ok(validarProduto({ ...produto, estoque_atual: 1.5 }).length);
    assert.ok(validarProduto({ ...produto, preco_custo: -1 }).length);
});
test('API exige login', async () => { const res = await enviar(venda(), false); assert.equal(res.status, 401); assert.equal(consultas.length, 0); });
test('token expirado e rejeitado', async () => { const res = await fetch(base + '/produtos', { headers: { Authorization: 'Bearer ' + jwt.sign({ id: 7 }, process.env.JWT_SECRET, { expiresIn: -1 }) } }); assert.equal(res.status, 401); });
test('carrinho invalido nao abre transacao', async () => { assert.equal((await enviar({ ...venda(), itens: [null] })).status, 400); assert.deepEqual(eventos, []); });
test('caixa fechado desfaz e libera conexao', async () => { caixaAberto = false; assert.equal((await enviar(venda())).status, 400); assert.deepEqual(eventos, ['begin', 'rollback', 'release']); });
test('estoque insuficiente desfaz a venda', async () => { estoque = 1; assert.equal((await enviar(venda())).status, 400); assert.deepEqual(eventos, ['begin', 'rollback', 'release']); });
test('produto repetido respeita estoque acumulado', async () => { estoque = 3; const body = venda(); body.itens.push({ ...body.itens[0] }); assert.equal((await enviar(body)).status, 400); assert.ok(eventos.includes('rollback')); });
test('limite de credito e validado sob bloqueio', async () => { limite = 0; assert.equal((await enviar({ ...venda(), forma_pagamento: 'crediario', cliente_id: 1 })).status, 400); assert.ok(consultas.some(q => q.sql.includes('FROM clientes') && q.sql.includes('FOR UPDATE'))); assert.deepEqual(eventos, ['begin', 'rollback', 'release']); });
test('venda usa usuario autenticado e centavos', async () => {
    const res = await enviar(venda()); assert.equal(res.status, 201); assert.equal((await res.json()).valor_total, 0.2);
    assert.equal(consultas.find(q => q.sql.startsWith('INSERT INTO vendas')).args[1], 7);
    assert.ok(consultas.some(q => q.sql.includes('FROM produtos') && q.sql.includes('FOR UPDATE')));
    assert.deepEqual(eventos, ['begin', 'commit', 'release']);
});
test('nome avulso e preservado', async () => { const body = venda(); body.itens = [{ produto_id: null, nome: 'Presente', quantidade: 1, preco_unitario: 7 }]; assert.equal((await enviar(body)).status, 201); assert.equal(consultas.find(q => q.sql.startsWith('INSERT INTO itens_venda')).args[4], 'Presente'); });
test('falha de conexao retorna erro sem travar requisicao', async () => { falhaConexao = true; assert.equal((await enviar(venda())).status, 500); assert.deepEqual(eventos, []); });
test('edicao de produto tambem valida estoque', async () => { assert.equal((await enviar({ estoque_atual: -1 }, true, '/produtos/1', 'PUT')).status, 400); assert.equal(consultas.length, 0); });
test('abertura e fechamento rejeitam valores invalidos', async () => { assert.equal((await enviar({ valor_abertura: -1 }, true, '/sessoes/abrir')).status, 400); assert.equal((await enviar({ valor_fechamento: '' }, true, '/sessoes/fechar/1')).status, 400); });
test('pagina de login e acessivel sem token', async () => { const res = await fetch(base + '/login.html'); assert.equal(res.status, 200); assert.match(await res.text(), /<html/); });

test('abertura duplicada e recusada e libera bloqueio', async () => {
    const res = await enviar({ valor_abertura: 10 }, true, '/sessoes/abrir');
    assert.equal(res.status, 409);
    assert.ok(consultas.some(q => q.sql.includes('RELEASE_LOCK')));
    assert.deepEqual(eventos, ['release']);
});
test('tela impede envio simultaneo e permite tentar novamente apos recusa', async () => {
    const fs = require('node:fs'), vm = require('node:vm');
    const html = fs.readFileSync(require('node:path').join(__dirname, '../public/caixa.html'), 'utf8');
    const trecho = html.slice(html.indexOf('        let vendaEmAndamento'), html.indexOf('        function sair()', html.indexOf('        let vendaEmAndamento')));
    let requisicoes = 0, responder;
    const contexto = vm.createContext({
        carrinho: [{ produto_id: null, nome: 'Avulso', quantidade: 1, preco_unitario: 5 }],
        sessaoCaixaAtiva: { id: 1 }, usuarioLogado: { id: 7 }, API_URL: '', token: 'teste',
        document: { getElementById: id => ({ value: id === 'formaPagamento' ? 'dinheiro' : '' }) },
        mostrarAlerta() {}, console,
        fetch: async (_, options) => { requisicoes++; assert.equal(JSON.parse(options.body).itens[0].nome, 'Avulso'); return new Promise(resolve => { responder = () => resolve({ ok: false, json: async () => ({ erro: 'Recusada' }) }); }); }
    });
    vm.runInContext(trecho, contexto);
    const primeiro = contexto.finalizarVenda();
    await contexto.finalizarVenda(); assert.equal(requisicoes, 1);
    responder(); await primeiro;
    const segundo = contexto.finalizarVenda(); assert.equal(requisicoes, 2);
    responder(); await segundo;
});
