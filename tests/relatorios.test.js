const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Periodos = require('../public/js/periodos');
const { validarDestino } = require('../utils/backup');
const vendas = [
    { id: 1, data_local: '2026-09-13', valor_total: 100, forma_pagamento: 'pix' },
    { id: 2, data_local: '2026-09-14', valor_total: .1, forma_pagamento: 'pix' },
    { id: 3, data_local: '2026-09-18', criado_em: '2026-09-19T02:59:59Z', data_exibicao: '18/09/2026 23:59:59', valor_total: .2, forma_pagamento: 'dinheiro' },
    { id: 4, data_local: '2026-09-20', valor_total: 20, forma_pagamento: 'pix' },
    { id: 5, data_local: '2026-09-21', valor_total: 50, forma_pagamento: 'pix' },
    { id: 6, valor_total: 500, forma_pagamento: 'pix' }
];
test('dia 18 inclui venda noturna sem deslocamento para dia 19 UTC', () => {
    assert.deepEqual(Periodos.filtrar(vendas, '2026-09-18').map(v => v.id), [3]);
});
test('semana inclui segunda e domingo e exclui semanas vizinhas', () => {
    assert.deepEqual(Periodos.semana(new Date(2026, 8, 20, 23, 59)), { inicio: '2026-09-14', fim: '2026-09-20' });
    assert.equal(Periodos.totais(vendas, new Date(2026, 8, 20)).semana, 20.3);
    assert.equal(Periodos.totais(vendas, new Date(2026, 8, 21)).semana, 50);
    assert.equal(Periodos.totais(vendas.slice(0, 4), new Date(2026, 8, 21)).semana, 0);
});
test('semana atravessa mês e ano sem apagar histórico', () => {
    assert.deepEqual(Periodos.semana(new Date(2027, 0, 1)), { inicio: '2026-12-28', fim: '2027-01-03' });
    assert.equal(Periodos.filtrar(vendas).length, 6);
});
test('intervalo e pagamento se combinam e excluem datas ausentes', () => {
    assert.deepEqual(Periodos.filtrar(vendas, '2026-09-14', '2026-09-20', 'pix').map(v => v.id), [2, 4]);
    assert.equal(Periodos.filtrar(vendas, '2026-09-20', '2026-09-14').length, 0);
});
test('tela filtra dia, intervalo, limpa e mantém cartões do período atual', () => {
    const html = fs.readFileSync(path.join(__dirname, '../public/relatorio.html'), 'utf8');
    const elementos = {};
    const elemento = id => elementos[id] ||= { value: '', innerText: '', innerHTML: '' };
    const contexto = vm.createContext({ Periodos, vendasGlobal: vendas, pagamentoAtual: 'todos',
        document: { getElementById: elemento }, formatarMoeda: v => String(v),
        calcularTotaisResumo: () => { elemento('totalDia').innerText = 'hoje'; } });
    const inicio = html.indexOf('        function limparFiltroData()');
    vm.runInContext(html.slice(inicio, html.indexOf('        function sair()', inicio)), contexto);
    elemento('filtroData').value = '2026-09-18';
    contexto.renderizarTabelaVendas();
    assert.match(elemento('tabelaVendasRelatorio').innerHTML, /18\/09\/2026 23:59:59/);
    assert.equal(elemento('valorTotalVendasFiltradas').innerText, '0.2');
    assert.equal(elemento('totalDia').innerText, 'hoje');
    elemento('filtroDataFim').value = '2026-09-20';
    contexto.renderizarTabelaVendas();
    assert.equal(elemento('valorTotalVendasFiltradas').innerText, '20.2');
    elemento('filtroDataFim').value = '2026-09-17';
    contexto.renderizarTabelaVendas();
    assert.match(elemento('periodoExibido').innerText, /anterior ou igual/);
    contexto.limparFiltroData();
    assert.equal(elemento('filtroDataFim').value, '');
    assert.equal(elemento('valorTotalVendasFiltradas').innerText, '670.3');
});
test('backup rejeita destino relativo, aplicação e pasta de dados', () => {
    assert.throws(() => validarDestino('backups'));
    assert.throws(() => validarDestino(path.resolve(__dirname, '../backups')));
    const dados = path.resolve(__dirname, '../../dados-simulados');
    assert.throws(() => validarDestino(path.join(dados, 'backups'), dados));
    assert.equal(validarDestino(path.resolve(__dirname, '../../backups-separados'), dados), path.resolve(__dirname, '../../backups-separados'));
});
test('scripts de todas as telas têm sintaxe válida', () => {
    const publicDir = path.join(__dirname, '../public');
    for (const nome of fs.readdirSync(publicDir).filter(n => n.endsWith('.html'))) {
        const html = fs.readFileSync(path.join(publicDir, nome), 'utf8');
        for (const trecho of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)) new vm.Script(trecho[1], { filename: nome });
    }
});
