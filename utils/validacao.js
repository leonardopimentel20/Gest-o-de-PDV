// Validações simples de entrada, sem depender de bibliotecas externas.

function ehTextoValido(valor, tamanhoMinimo = 1, tamanhoMaximo = 255) {
    return typeof valor === 'string' &&
        valor.trim().length >= tamanhoMinimo &&
        valor.trim().length <= tamanhoMaximo;
}

function ehNumeroPositivo(valor) {
    const n = Number(valor);
    return !Number.isNaN(n) && n >= 0;
}

function ehInteiroPositivo(valor) {
    const n = Number(valor);
    return Number.isInteger(n) && n > 0;
}

function validarProduto(body) {
    const erros = [];
    if (!ehTextoValido(body.codigo_barras, 1, 100)) erros.push('Código de barras inválido.');
    if (!ehTextoValido(body.nome, 1, 150)) erros.push('Nome do produto inválido.');
    if (!body.categoria_id || !ehInteiroPositivo(body.categoria_id)) erros.push('Categoria inválida.');
    if (!ehNumeroPositivo(body.preco_custo)) erros.push('Preço de custo inválido.');
    if (!ehNumeroPositivo(body.preco_venda)) erros.push('Preço de venda inválido.');
    if (body.estoque_atual !== undefined && Number(body.estoque_atual) < 0) erros.push('Estoque inicial não pode ser negativo.');
    return erros;
}

function validarItensVenda(itens) {
    const erros = [];
    if (!Array.isArray(itens) || itens.length === 0) {
        erros.push('A venda precisa ter ao menos um item.');
        return erros;
    }
    itens.forEach((item, i) => {
        if (!item.produto_id || !ehInteiroPositivo(item.produto_id)) {
            erros.push(`Item ${i + 1}: produto inválido.`);
        }
        if (!ehInteiroPositivo(item.quantidade)) {
            erros.push(`Item ${i + 1}: quantidade inválida.`);
        }
    });
    return erros;
}

module.exports = {
    ehTextoValido,
    ehNumeroPositivo,
    ehInteiroPositivo,
    validarProduto,
    validarItensVenda
};
