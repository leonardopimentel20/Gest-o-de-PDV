function ehTextoValido(v, min = 1, max = 255) {
    return typeof v === 'string' && v.trim().length >= min && v.trim().length <= max;
}
function ehNumeroPositivo(v) {
    return (typeof v === 'number' || (typeof v === 'string' && v.trim() !== '')) && Number.isFinite(Number(v)) && Number(v) >= 0;
}
function ehInteiroPositivo(v) {
    return ehNumeroPositivo(v) && Number.isSafeInteger(Number(v)) && Number(v) > 0;
}
function estoqueValido(v) { return ehNumeroPositivo(v) && Number.isSafeInteger(Number(v)); }
function validarProduto(body) {
    const erros = [];
    if (!ehTextoValido(body.codigo_barras, 1, 50)) erros.push('Código de barras inválido.');
    if (!ehTextoValido(body.nome, 1, 150)) erros.push('Nome do produto inválido.');
    if (body.categoria_id != null && body.categoria_id !== '' && !ehInteiroPositivo(body.categoria_id)) erros.push('Categoria inválida.');
    if (!ehNumeroPositivo(body.preco_custo) || !ehNumeroPositivo(body.preco_venda) || Number(body.preco_venda) <= 0) erros.push('Preços inválidos.');
    if (Number(body.preco_venda) < Number(body.preco_custo)) erros.push('Preço de venda menor que o custo.');
    if (!estoqueValido(body.estoque_atual)) erros.push('Estoque deve ser um inteiro não negativo.');
    if (body.estoque_minimo !== undefined && !estoqueValido(body.estoque_minimo)) erros.push('Estoque mínimo inválido.');
    return erros;
}
function validarItensVenda(itens) {
    if (!Array.isArray(itens) || !itens.length) return ['A venda precisa ter ao menos um item.'];
    const erros = [];
    itens.forEach((item, i) => {
        if (!item || typeof item !== 'object') { erros.push(`Item ${i + 1} inválido.`); return; }
        if (item.produto_id != null && !ehInteiroPositivo(item.produto_id)) erros.push('Produto inválido.');
        if (!ehInteiroPositivo(item.quantidade)) erros.push('Quantidade inválida.');
        if (!ehNumeroPositivo(item.preco_unitario)) erros.push('Preço inválido.');
        if (item.nome !== undefined && !ehTextoValido(item.nome)) erros.push('Nome do item inválido.');
    });
    return erros;
}
module.exports = { ehTextoValido, ehNumeroPositivo, ehInteiroPositivo, validarProduto, validarItensVenda };
