// Datas civis do comércio: o banco fornece data_local sem conversão para UTC.
(function (root) {
    const chave = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    function dataVenda(venda) {
        if (venda.data_local) return venda.data_local;
        if (!venda.criado_em) return '';
        const data = new Date(venda.criado_em);
        return Number.isNaN(data.getTime()) ? '' : chave(data);
    }
    function semana(agora = new Date()) {
        const inicio = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate());
        inicio.setDate(inicio.getDate() - (inicio.getDay() + 6) % 7);
        const fim = new Date(inicio);
        fim.setDate(fim.getDate() + 6);
        return { inicio: chave(inicio), fim: chave(fim) };
    }
    function filtrar(vendas, inicio = '', fim = inicio, pagamento = 'todos') {
        return vendas.filter(v => {
            const data = dataVenda(v);
            return (pagamento === 'todos' || v.forma_pagamento === pagamento) &&
                ((!inicio && !fim) || (data && (!inicio || data >= inicio) && (!fim || data <= fim)));
        });
    }
    function totais(vendas, agora = new Date()) {
        const hoje = chave(agora), periodo = semana(agora);
        const resultado = { dia: 0, semana: 0, mes: 0 };
        vendas.forEach(v => {
            const data = dataVenda(v), centavos = Math.round((Number(v.valor_total) || 0) * 100);
            if (data === hoje) resultado.dia += centavos;
            if (data >= periodo.inicio && data <= periodo.fim) resultado.semana += centavos;
            if (data.slice(0, 7) === hoje.slice(0, 7)) resultado.mes += centavos;
        });
        for (const campo in resultado) resultado[campo] /= 100;
        return resultado;
    }
    const api = { chave, dataVenda, semana, filtrar, totais };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.Periodos = api;
})(typeof window !== 'undefined' ? window : globalThis);
