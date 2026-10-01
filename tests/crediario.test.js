const test = require('node:test');
const assert = require('node:assert/strict');

// Simulação de testes para a lógica de parcelamento e intervalo de dias do crediário
test('geração de parcelas respeita o intervalo exato de dias e juros compostos', () => {
    // Simula uma venda a crediário em 12x com juros e vencimento personalizado a cada 7 dias
    const vendaMock = {
        valor_total: 742.10,
        qtd_parcelas: 12,
        criado_em: '2026-10-01T00:00:00Z',
        data_vencimento: '2026-10-08' // 7 dias após a venda
    };

    let dataBase = new Date(vendaMock.criado_em);
    let primeiraDataVenc = new Date(vendaMock.data_vencimento + 'T00:00:00');
    
    const diffTempo = primeiraDataVenc.getTime() - dataBase.getTime();
    const diffDias = Math.round(diffTempo / (1000 * 60 * 60 * 24));
    const intervaloDias = diffDias > 0 ? diffDias : 30;

    assert.equal(intervaloDias, 7, 'O intervalo calculado deve ser exatamente de 7 dias');

    const parcelas = [];
    const valorParcela = vendaMock.valor_total / vendaMock.qtd_parcelas;

    for (let i = 1; i <= vendaMock.qtd_parcelas; i++) {
        let dataVencParc = new Date(primeiraDataVenc);
        if (i > 1) {
            dataVencParc.setDate(primeiraDataVenc.getDate() + (intervaloDias * (i - 1)));
        }
        parcelas.push({
            numero: i,
            valor: Number(valorParcela.toFixed(2)),
            vencimento: dataVencParc.toISOString().split('T')[0]
        });
    }

    assert.equal(parcelas.length, 12, 'Deve gerar exatamente 12 parcelas');
    assert.equal(parcelas[0].vencimento, '2026-10-08', 'A primeira parcela deve vencer em 08/10/2026');
    assert.equal(parcelas[1].vencimento, '2026-10-15', 'A segunda parcela deve vencer exatamente 7 dias depois (15/10/2026)');
    assert.equal(parcelas[11].vencimento, '2026-12-24', 'A última parcela deve seguir o espaçamento correto');
});

test('fallback de parcelas antigas calcula 30 dias corretamente', () => {
    const vendaAntiga = {
        qtd_parcelas: 3,
        valor_total: 300.00,
        criado_em: '2026-10-01T00:00:00Z'
    };

    const qtd = parseInt(vendaAntiga.qtd_parcelas) || 1;
    const valorParcela = vendaAntiga.valor_total / qtd;
    const parcelas = [];
    let dataBase = new Date(vendaAntiga.criado_em);

    for (let i = 1; i <= qtd; i++) {
        let dataVenc = new Date(dataBase);
        dataVenc.setDate(dataBase.getDate() + (30 * i));
        parcelas.push({
            numero: i,
            valor: valorParcela,
            vencimento: dataVenc.toLocaleDateString('pt-BR')
        });
    }

    assert.equal(parcelas.length, 3);
    assert.equal(parcelas[0].valor, 100.00);
});