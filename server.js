const express = require('express');
const db = require('./db');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const path = require('path');
const { verificarToken } = require('./middleware/auth');
const { validarProduto, validarItensVenda, ehNumeroPositivo, ehInteiroPositivo } = require('./utils/validacao');
const app = express();
const backup = require('./utils/backup');
app.use(express.json());
app.disable('x-powered-by');
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true }));

app.get('/health', async (req, res) => {
    try {
        await db.query('SELECT 1');
        res.json({ servico: 'loja-sistema', instancia: require('crypto').createHash('sha256').update(__dirname.toLowerCase()).digest('hex') });
    } catch { res.status(503).json({ erro: 'Banco de dados indisponível.' }); }
});

app.use((req, res, next) => req.path === '/login' && req.method === 'POST' ? next() : verificarToken(req, res, next));

app.get('/backup/status', (req, res) => {
    const { configurado, executando, ultimoSucesso, erro } = backup.estado;
    res.json({ configurado, executando, ultimoSucesso, falha: Boolean(erro) });
});

// 1. Rota para Listar Produtos
app.get('/produtos', async (req, res) => {
    try {
        const [rows] = await db.query(`
            SELECT p.*, c.nome as categoria_nome 
            FROM produtos p 
            LEFT JOIN categorias c ON p.categoria_id = c.id 
            ORDER BY p.id DESC
        `);
        res.json(rows);
    } catch (error) {
        console.error('Erro ao buscar produtos:', error);
        res.status(500).json({ erro: 'Erro ao buscar produtos.' });
    }
});

// Rota para Listar Categorias
app.get('/categorias', async (req, res) => {
    try {
        const [rows] = await db.query('SELECT * FROM categorias');
        res.json(rows);
    } catch (error) {
        console.error('Erro ao buscar categorias:', error);
        res.status(500).json({ erro: 'Erro ao buscar categorias.' });
    }
});

// 2. Rota para Cadastrar um Novo Produto
app.post('/produtos', async (req, res) => {
    const { codigo_barras, nome, categoria_id, preco_custo, preco_venda, estoque_atual, estoque_minimo } = req.body;

    const erros = validarProduto(req.body);
    if (erros.length) return res.status(400).json({ erro: erros.join(' ') });
    const precoCustoNum = Number(preco_custo);
    const precoVendaNum = Number(preco_venda);
    const estoqueNum = Number(estoque_atual);

    try {
        const [result] = await db.query(
            `INSERT INTO produtos (codigo_barras, nome, categoria_id, preco_custo, preco_venda, estoque_atual, estoque_minimo) 
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [codigo_barras, nome, categoria_id || null, precoCustoNum, precoVendaNum, estoqueNum, estoque_minimo ?? 5]
        );
        res.status(201).json({ mensagem: 'Produto cadastrado com sucesso!', id: result.insertId });
    } catch (error) {
        if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ erro: 'Código de barras já cadastrado.' });
        console.error('Erro ao cadastrar produto:', error);
        res.status(500).json({ erro: 'Erro ao cadastrar produto.' });
    }
});

// 3. Rota para Registrar Venda com Abatimento de Crédito em Haver
app.post('/vendas', async (req, res) => {
    const { sessao_caixa_id, cliente_id, forma_pagamento, itens, crediario, usar_credito } = req.body;
    const usuario_id = req.usuario.id;
    const erros = validarItensVenda(itens);
    if (!ehInteiroPositivo(sessao_caixa_id)) erros.push('Caixa inválido.');
    if (!['dinheiro', 'cartao_credito', 'cartao_debito', 'pix', 'crediario'].includes(forma_pagamento)) erros.push('Forma de pagamento inválida.');
    if (cliente_id != null && cliente_id !== '' && !ehInteiroPositivo(cliente_id)) erros.push('Cliente inválido.');
    if (forma_pagamento === 'crediario' && !cliente_id) erros.push('Selecione um cliente para o crediário.');
    if (erros.length) return res.status(400).json({ erro: erros.join(' ') });

    let connection;
    let transacao = false;
    const recusar = mensagem => { const erro = new Error(mensagem); erro.status = 400; throw erro; };

    try {
        connection = await db.getConnection();
        await connection.beginTransaction();
        transacao = true;

        const [sessoes] = await connection.query("SELECT id FROM sessoes_caixa WHERE id = ? AND status = 'aberto' FOR UPDATE", [sessao_caixa_id]);
        if (!sessoes.length) recusar('O caixa está fechado. Abra um caixa antes de vender.');

        let totalCentavos = itens.reduce((total, item) => {
            const precoCentavos = Math.round(Number(item.preco_unitario) * 100);
            return total + (precoCentavos * Number(item.quantidade));
        }, 0);

        if (!Number.isSafeInteger(totalCentavos) || totalCentavos <= 0) recusar('Total da venda inválido.');

        let descontoCreditoCentavos = 0;
        let nomeClienteStr = 'Cliente Avulso';
        let telefoneClienteStr = '';
        let clienteIdReal = cliente_id ? Number(cliente_id) : null;

        if (clienteIdReal) {
            const [clientes] = await connection.query('SELECT nome, telefone, limite_credito, saldo_credito FROM clientes WHERE id = ? FOR UPDATE', [clienteIdReal]);
            if (!clientes.length) recusar('Cliente não encontrado.');
            const clienteRegistro = clientes[0];
            nomeClienteStr = clienteRegistro.nome;
            telefoneClienteStr = clienteRegistro.telefone || '';

            if (usar_credito && Number(clienteRegistro.saldo_credito) > 0) {
                const saldoClienteCentavos = Math.round(Number(clienteRegistro.saldo_credito) * 100);
                descontoCreditoCentavos = Math.min(totalCentavos, saldoClienteCentavos);
                totalCentavos -= descontoCreditoCentavos;
            }

            if (forma_pagamento === 'crediario') {
                const [dividas] = await connection.query("SELECT COALESCE(SUM(saldo_restante), 0) AS total_devido FROM parcelas_venda WHERE cliente_id = ? AND status != 'pago'", [clienteIdReal]);
                const disponivel = Math.round(Number(clienteRegistro.limite_credito) * 100) - Math.round(Number(dividas[0].total_devido) * 100);
                if (totalCentavos > disponivel) recusar(`Limite insuficiente! Disponível: R$ ${(disponivel / 100).toFixed(2)}.`);
            }
        } else if (usar_credito) {
            recusar('É necessário selecionar um cliente para utilizar o crédito em haver.');
        }

        const valor_total = totalCentavos / 100;
        let qtdParcelas = 1;
        let dataVencimento = null;
        let valorFinalVenda = valor_total;
        let dadosParcelasParaInserir = [];
        let infoCrediarioRetorno = null;

        if (forma_pagamento === 'crediario' && crediario) {
            qtdParcelas = parseInt(crediario.qtd_parcelas) || 1;
            dataVencimento = crediario.data_vencimento || null;

            const entrada = parseFloat(crediario.valor_entrada) || 0;
            let valorFinanciado = totalCentavos - Math.round(entrada * 100);
            if (valorFinanciado < 0) valorFinanciado = 0;

            let totalComJurosCentavos = totalCentavos;
            let valorParcelaCentavos = 0;
            let taxaJurosMes = Number(crediario.taxa_juros) || 0;

            if (crediario.tipo_juros === 'com_juros' && taxaJurosMes > 0 && valorFinanciado > 0) {
                const i = taxaJurosMes / 100;
                const n = qtdParcelas;
                const p = valorFinanciado * (i * Math.pow(1 + i, n)) / (Math.pow(1 + i, n) - 1);
                valorParcelaCentavos = Math.round(p);
                totalComJurosCentavos = Math.round(entrada * 100) + (valorParcelaCentavos * qtdParcelas);
            } else {
                valorParcelaCentavos = qtdParcelas > 0 ? Math.round(valorFinanciado / qtdParcelas) : valorFinanciado;
                totalComJurosCentavos = Math.round(entrada * 100) + (valorParcelaCentavos * qtdParcelas);
            }

            valorFinalVenda = totalComJurosCentavos / 100;

            let dataBaseVenda = new Date();
            let primeiraDataVenc = dataVencimento ? new Date(dataVencimento + 'T00:00:00') : new Date(dataBaseVenda);
            if (isNaN(primeiraDataVenc.getTime())) primeiraDataVenc = new Date(dataBaseVenda);

            const diffTempo = primeiraDataVenc.getTime() - dataBaseVenda.getTime();
            const diffDias = Math.round(diffTempo / (1000 * 60 * 60 * 24));
            const intervaloDias = diffDias > 0 ? diffDias : 30;

            for (let i = 1; i <= qtdParcelas; i++) {
                let dataVencParc = new Date(primeiraDataVenc);
                if (i > 1) {
                    dataVencParc.setDate(primeiraDataVenc.getDate() + (intervaloDias * (i - 1)));
                }
                const dataFmtSql = dataVencParc.toISOString().split('T')[0];

                dadosParcelasParaInserir.push({
                    numero: i,
                    total: qtdParcelas,
                    valor: Number((valorParcelaCentavos / 100).toFixed(2)),
                    vencimento: dataFmtSql
                });
            }

            infoCrediarioRetorno = {
                valor_entrada: entrada,
                valor_financiado: valorFinanciado / 100,
                tipo_juros: crediario.tipo_juros,
                taxa_juros: taxaJurosMes,
                parcelas: dadosParcelasParaInserir
            };
        }

        const [venda] = await connection.query(
            'INSERT INTO vendas (sessao_caixa_id, usuario_id, cliente_id, valor_total, forma_pagamento, qtd_parcelas, data_vencimento, criado_em) VALUES (?, ?, ?, ?, ?, ?, ?, NOW())',
            [sessao_caixa_id, usuario_id, clienteIdReal, Number(valorFinalVenda.toFixed(2)), forma_pagamento, qtdParcelas, dataVencimento]
        );

        const vendaIdInserida = venda.insertId;

        if (descontoCreditoCentavos > 0 && clienteIdReal) {
            await connection.query(
                'UPDATE clientes SET saldo_credito = saldo_credito - ? WHERE id = ?',
                [descontoCreditoCentavos / 100, clienteIdReal]
            );
        }

        if (forma_pagamento === 'crediario') {
            for (const p of dadosParcelasParaInserir) {
                await connection.query(
                    'INSERT INTO parcelas_venda (venda_id, cliente_id, numero_parcela, total_parcelas, valor_parcela, valor_pago, saldo_restante, data_vencimento, status) VALUES (?, ?, ?, ?, ?, 0.00, ?, ?, ?)',
                    [vendaIdInserida, clienteIdReal, p.numero, p.total, p.valor, p.valor, p.vencimento, 'pendente']
                );
            }
        }

        let itensProcessadosParaComprovante = [];
        for (const item of [...itens].sort((a, b) => Number(a.produto_id || 0) - Number(b.produto_id || 0))) {
            let nome = item.nome || 'Item Avulso';
            const precoUnitNum = Number(item.preco_unitario);
            if (item.produto_id) {
                const [produtos] = await connection.query('SELECT estoque_atual, nome FROM produtos WHERE id = ? FOR UPDATE', [item.produto_id]);
                if (!produtos.length) recusar('Produto não encontrado.');
                if (Number(produtos[0].estoque_atual) < Number(item.quantidade)) recusar(`Estoque insuficiente para "${produtos[0].nome}".`);
                nome = produtos[0].nome;
                await connection.query('UPDATE produtos SET estoque_atual = estoque_atual - ? WHERE id = ?', [item.quantidade, item.produto_id]);
            }
            await connection.query('INSERT INTO itens_venda (venda_id, produto_id, quantidade, preco_unitario, nome_produto_avulso) VALUES (?, ?, ?, ?, ?)', [vendaIdInserida, item.produto_id || null, item.quantidade, Number(precoUnitNum.toFixed(2)), nome]);

            itensProcessadosParaComprovante.push({
                nome: nome,
                quantidade: item.quantidade,
                preco_unitario: precoUnitNum,
                subtotal: item.quantidade * precoUnitNum
            });
        }

        await connection.commit();
        transacao = false;

        res.status(201).json({
            mensagem: 'Venda realizada com sucesso!',
            venda_id: vendaIdInserida,
            valor_total: Number(valorFinalVenda.toFixed(2)),
            comprovante: {
                venda_id: vendaIdInserida,
                data: new Date().toLocaleString('pt-BR'),
                cliente: nomeClienteStr,
                telefone: telefoneClienteStr,
                forma_pagamento: forma_pagamento,
                itens: itensProcessadosParaComprovante,
                desconto_credito: descontoCreditoCentavos / 100,
                crediario: infoCrediarioRetorno
            }
        });
    } catch (error) {
        if (transacao) {
            try { await connection.rollback(); } catch (rollbackError) { console.error('Erro no rollback:', rollbackError); }
        }
        if (!error.status) console.error('Erro ao processar venda:', error);
        res.status(error.status || 500).json({ erro: error.status ? error.message : 'Não foi possível registrar a venda. Consulte o histórico antes de tentar novamente.' });
    } finally {
        if (connection) connection.release();
    }
});

// 4. Rota para Listar Vendas
app.get('/vendas', async (req, res) => {
    try {
        const [rows] = await db.query(`
            SELECT v.*, c.nome as cliente_nome,
                   DATE_FORMAT(v.criado_em, '%Y-%m-%d') AS data_local,
                   DATE_FORMAT(v.criado_em, '%d/%m/%Y %H:%i:%s') AS data_exibicao,
                   DATE_FORMAT(v.data_vencimento, '%d/%m/%Y') AS vencimento_exibicao
            FROM vendas v 
            LEFT JOIN clientes c ON v.cliente_id = c.id 
            ORDER BY v.id DESC
        `);
        const [totalResult] = await db.query('SELECT SUM(valor_total) as total FROM vendas');
        const totalGeral = Number(totalResult[0]?.total || 0).toFixed(2);

        res.json({ vendas: rows, totalGeral });
    } catch (error) {
        console.error('Erro ao buscar vendas:', error);
        res.status(500).json({ erro: 'Erro ao buscar vendas.' });
    }
});

app.get('/sessoes/ativa', async (req, res) => {
    try {
        const [rows] = await db.query("SELECT * FROM sessoes_caixa WHERE status = 'aberto' ORDER BY id DESC LIMIT 1");
        if (rows.length === 0) return res.json({ aberta: false });
        res.json({ aberta: true, sessao: rows[0] });
    } catch (error) {
        console.error('Erro ao verificar caixa:', error);
        res.status(500).json({ error: 'Erro ao verificar caixa' });
    }
});

app.post('/sessoes/abrir', async (req, res) => {
    const usuario_id = req.usuario.id;
    const { valor_abertura } = req.body;
    if (!ehNumeroPositivo(valor_abertura)) return res.status(400).json({ error: 'Valor de abertura invalido.' });
    let connection;
    let bloqueado = false;
    try {
        connection = await db.getConnection();
        const [lock] = await connection.query("SELECT GET_LOCK(CONCAT(DATABASE(), ':abrir_caixa'), 5) AS adquirido");
        bloqueado = Number(lock[0].adquirido) === 1;
        if (!bloqueado) return res.status(409).json({ error: 'Outra abertura em andamento. Aguarde.' });
        const [rows] = await connection.query("SELECT id FROM sessoes_caixa WHERE status = 'aberto'");
        if (rows.length) return res.status(409).json({ error: 'Ja existe um caixa aberto.' });
        const [result] = await connection.query("INSERT INTO sessoes_caixa (usuario_id, valor_abertura, status, data_abertura) VALUES (?, ?, 'aberto', NOW())", [usuario_id, Number(valor_abertura)]);
        res.json({ success: true, sessao_id: result.insertId });
    } catch (error) {
        console.error('Erro ao abrir caixa:', error);
        res.status(500).json({ error: 'Erro ao abrir o caixa.' });
    } finally {
        if (connection) {
            try { if (bloqueado) await connection.query("SELECT RELEASE_LOCK(CONCAT(DATABASE(), ':abrir_caixa'))"); }
            finally { connection.release(); }
        }
    }
});

app.post('/sessoes/fechar/:id', async (req, res) => {
    const { id } = req.params;
    const { valor_fechamento } = req.body;
    if (!ehInteiroPositivo(id) || !ehNumeroPositivo(valor_fechamento)) return res.status(400).json({ error: 'Valor de fechamento ou caixa inválido.' });
    try {
        const [result] = await db.query(
            "UPDATE sessoes_caixa SET valor_fechamento = ?, status = 'fechado', data_fechamento = NOW() WHERE id = ? AND status = 'aberto'",
            [Number(valor_fechamento), id]
        );
        if (!result.affectedRows) return res.status(409).json({ error: 'Caixa inexistente ou já fechado.' });
        res.json({ success: true });
    } catch (error) {
        console.error('Erro ao fechar caixa:', error);
        res.status(500).json({ error: 'Erro ao fechar o caixa' });
    }
});

app.get('/api/clientes', async (req, res) => {
    try {
        const [clientes] = await db.query('SELECT * FROM clientes ORDER BY nome ASC');

        const [debitos] = await db.query(`
            SELECT cliente_id, SUM(saldo_restante) as total_devido 
            FROM parcelas_venda 
            WHERE status != 'pago' AND cliente_id IS NOT NULL 
            GROUP BY cliente_id
        `);

        const mapaDebitos = {};
        debitos.forEach(d => {
            mapaDebitos[d.cliente_id] = Number(d.total_devido || 0);
        });

        const resultadoFinal = clientes.map(c => ({
            ...c,
            total_devido: mapaDebitos[c.id] || 0,
            saldo_credito: Number(c.saldo_credito || 0),
            origem_saldo_credito: Number(c.saldo_credito || 0) > 0 ? 'Crédito referente a aquisição de roupas/peças' : 'Nenhum'
        }));

        res.json(resultadoFinal);
    } catch (err) {
        console.error('Erro ao buscar clientes:', err);
        res.status(500).json({ erro: 'Erro ao buscar clientes' });
    }
});

app.post('/api/clientes', async (req, res) => {
    try {
        const { nome, telefone, limite_credito, cep, logradouro, numero, bairro, cidade, estado, complemento } = req.body;
        if (typeof nome !== 'string' || !nome.trim() || nome.trim().length > 150) {
            return res.status(400).json({ erro: 'O nome do cliente é obrigatório e deve ter no máximo 150 caracteres.' });
        }
        if (typeof telefone !== 'string' || !telefone.trim()) {
            return res.status(400).json({ erro: 'O telefone / WhatsApp do cliente é obrigatório.' });
        }
        if (!ehNumeroPositivo(limite_credito ?? 0)) {
            return res.status(400).json({ erro: 'O limite de crédito deve ser um valor válido.' });
        }
        const query = `
            INSERT INTO clientes (nome, telefone, limite_credito, saldo_credito, cep, logradouro, numero, bairro, cidade, estado, complemento) 
            VALUES (?, ?, ?, 0.00, ?, ?, ?, ?, ?, ?, ?)
        `;
        const [result] = await db.query(query, [
            nome.trim(), telefone || '', Number(limite_credito || 0).toFixed(2),
            cep || '', logradouro || '', numero || '', bairro || '', cidade || '', estado || '', complemento || ''
        ]);
        res.json({ id: result.insertId, mensagem: 'Cliente cadastrado com sucesso!' });
    } catch (err) {
        console.error('Erro ao cadastrar cliente:', err);
        res.status(500).json({ erro: 'Erro ao cadastrar cliente' });
    }
});

app.put('/api/clientes/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { nome, telefone, limite_credito, cep, logradouro, numero, bairro, cidade, estado, complemento } = req.body;
        if (!ehInteiroPositivo(id)) return res.status(400).json({ erro: 'ID de cliente inválido.' });
        if (typeof nome !== 'string' || !nome.trim() || nome.trim().length > 150 || !ehNumeroPositivo(limite_credito ?? 0)) {
            return res.status(400).json({ erro: 'O nome do cliente e o limite são obrigatórios.' });
        }
        const query = `
            UPDATE clientes 
            SET nome = ?, telefone = ?, limite_credito = ?, cep = ?, logradouro = ?, numero = ?, bairro = ?, cidade = ?, estado = ?, complemento = ?
            WHERE id = ?
        `;
        const [result] = await db.query(query, [
            nome.trim(), telefone || '', Number(limite_credito || 0).toFixed(2),
            cep || '', logradouro || '', numero || '', bairro || '', cidade || '', estado || '', complemento || '', id
        ]);
        if (result.affectedRows === 0) return res.status(404).json({ erro: 'Cliente não encontrado.' });
        res.json({ mensagem: 'Cliente atualizado com sucesso!' });
    } catch (err) {
        console.error('Erro ao atualizar cliente:', err);
        res.status(500).json({ erro: 'Erro ao atualizar cliente.' });
    }
});

app.get('/api/clientes/:id/crediarios', async (req, res) => {
    try {
        const clienteId = req.params.id;
        const query = `
            SELECT v.id, v.sessao_caixa_id, v.usuario_id, v.cliente_id, v.valor_total, v.forma_pagamento, v.criado_em,
                   COALESCE(v.qtd_parcelas, 1) AS qtd_parcelas,
                   COALESCE(
                       NULLIF(GROUP_CONCAT(CONCAT(iv.quantidade, 'x ', COALESCE(p.nome, iv.nome_produto_avulso, 'Item')) SEPARATOR ', '), ''), 
                       'Venda sem itens detalhados'
                   ) as itens_descricao,
                   (
                       SELECT JSON_ARRAYAGG(
                           JSON_OBJECT(
                               'id', pv.id,
                               'numero', pv.numero_parcela,
                               'totalParcelas', pv.total_parcelas,
                               'valor', ROUND(pv.valor_parcela, 2),
                               'valor_pago', ROUND(COALESCE(pv.valor_pago, 0.00), 2),
                               'saldo_restante', ROUND(COALESCE(pv.saldo_restante, pv.valor_parcela), 2),
                               'vencimento', DATE_FORMAT(pv.data_vencimento, '%d/%m/%Y'),
                               'status', pv.status
                           )
                       )
                       FROM parcelas_venda pv WHERE pv.venda_id = v.id
                   ) as parcelas_json
            FROM vendas v
            LEFT JOIN itens_venda iv ON v.id = iv.venda_id
            LEFT JOIN produtos p ON iv.produto_id = p.id
            WHERE v.cliente_id = ? AND v.forma_pagamento = 'crediario'
            GROUP BY v.id
            ORDER BY v.criado_em DESC
        `;
        const [results] = await db.query(query, [clienteId]);

        const formatados = results.map(row => ({
            ...row,
            valor_total: Number(row.valor_total).toFixed(2),
            parcelas: typeof row.parcelas_json === 'string' ? JSON.parse(row.parcelas_json) : (row.parcelas_json || [])
        }));

        res.json(formatados);
    } catch (err) {
        console.error('❌ Erro na query de crediários:', err);
        res.status(500).json({ erro: 'Erro ao consultar o histórico de crediário.' });
    }
});

app.post('/api/parcelas/:id/pagar', async (req, res) => {
    const { id } = req.params;
    const { valor_pagamento } = req.body;

    const parcId = Number(id);
    const valPag = Number(valor_pagamento);

    if (!Number.isInteger(parcId) || parcId <= 0 || isNaN(valPag) || valPag <= 0) {
        return res.status(400).json({ erro: 'ID da parcela ou valor de pagamento inválido.' });
    }

    let connection;
    try {
        connection = await db.getConnection();
        await connection.beginTransaction();

        const [parcelasAlvo] = await connection.query('SELECT * FROM parcelas_venda WHERE id = ? FOR UPDATE', [parcId]);
        if (!parcelasAlvo.length) {
            await connection.rollback();
            return res.status(404).json({ erro: 'Parcela não encontrada.' });
        }

        const vendaId = parcelasAlvo[0].venda_id;
        const clienteId = parcelasAlvo[0].cliente_id;

        const [parcelasVenda] = await connection.query(
            "SELECT * FROM parcelas_venda WHERE venda_id = ? AND status != 'pago' ORDER BY numero_parcela ASC FOR UPDATE",
            [vendaId]
        );

        let dinheiroRestanteCentavos = Math.round(valPag * 100);
        let parcelasAtualizadasCount = 0;

        for (const parc of parcelasVenda) {
            if (dinheiroRestanteCentavos <= 0) break;

            let saldoParcCentavos = Math.round(Number(parc.saldo_restante || parc.valor_parcela) * 100);
            const valorAplicarCentavos = Math.min(dinheiroRestanteCentavos, saldoParcCentavos);

            const novoValorPagoCentavos = Math.round(Number(parc.valor_pago || 0) * 100) + valorAplicarCentavos;
            const novoSaldoRestanteCentavos = Math.max(0, saldoParcCentavos - valorAplicarCentavos);
            const novoStatus = novoSaldoRestanteCentavos === 0 ? 'pago' : 'parcial';

            await connection.query(
                'UPDATE parcelas_venda SET valor_pago = ?, saldo_restante = ?, status = ? WHERE id = ?',
                [novoValorPagoCentavos / 100, novoSaldoRestanteCentavos / 100, novoStatus, parc.id]
            );

            dinheiroRestanteCentavos -= valorAplicarCentavos;
            parcelasAtualizadasCount++;
        }

        let mensagemRetorno = `Pagamento processado com sucesso! ${parcelasAtualizadasCount} parcela(s) afetada(s).`;

        if (dinheiroRestanteCentavos > 0 && clienteId) {
            const creditoAdicional = dinheiroRestanteCentavos / 100;
            if (creditoAdicional > 1000000) {
                throw new Error('O valor excedente de crédito é excessivamente alto.');
            }
            await connection.query(
                'UPDATE clientes SET saldo_credito = COALESCE(saldo_credito, 0) + ? WHERE id = ?',
                [creditoAdicional, clienteId]
            );
            mensagemRetorno += ` O excedente de R$ ${creditoAdicional.toFixed(2)} foi adicionado como crédito em haver para o cliente!`;
        }

        await connection.commit();
        res.json({
            mensagem: mensagemRetorno,
            parcelas_atualizadas: parcelasAtualizadasCount,
            credito_gerado: dinheiroRestanteCentavos > 0 ? (dinheiroRestanteCentavos / 100) : 0
        });

    } catch (error) {
        if (connection) {
            try { await connection.rollback(); } catch (rbErr) { console.error('Erro no rollback:', rbErr); }
        }
        console.error('Erro ao registrar pagamento da parcela:', error);
        res.status(500).json({ erro: error.message || 'Erro interno ao registrar o pagamento.' });
    } finally {
        if (connection) connection.release();
    }
});

// Rota para listar o relatório consolidado de compras de peças / lotes (Brechó) com criação automática de tabelas
app.get('/api/relatorios/compras-brecho', async (req, res) => {
    let connection;
    try {
        connection = await db.getConnection();

        await connection.query(`
            CREATE TABLE IF NOT EXISTS compras_brecho (
                id INT AUTO_INCREMENT PRIMARY KEY,
                sessao_caixa_id INT,
                cliente_id INT,
                nome_cliente_avulso VARCHAR(150),
                valor_total DECIMAL(10,2),
                forma_pagamento VARCHAR(50),
                criado_em DATETIME
            )
        `);

        await connection.query(`
            CREATE TABLE IF NOT EXISTS itens_compra_brecho (
                id INT AUTO_INCREMENT PRIMARY KEY,
                compra_brecho_id INT,
                nome_produto VARCHAR(150),
                quantidade INT,
                preco_custo DECIMAL(10,2)
            )
        `);

        const [rows] = await connection.query(`
            SELECT cb.id, cb.valor_total, cb.forma_pagamento,
                   DATE_FORMAT(cb.criado_em, '%d/%m/%Y %H:%i') AS data,
                   COALESCE(c.nome, cb.nome_cliente_avulso, 'Cliente Avulso') AS cliente_nome,
                   COALESCE(
                       NULLIF(GROUP_CONCAT(CONCAT(cp.quantidade, 'x ', cp.nome_produto) SEPARATOR ', '), ''), 
                       'Lote de Roupas'
                   ) as itens_descricao
            FROM compras_brecho cb
            LEFT JOIN clientes c ON cb.cliente_id = c.id
            LEFT JOIN itens_compra_brecho cp ON cb.id = cp.compra_brecho_id
            GROUP BY cb.id
            ORDER BY cb.id DESC
        `);
        res.json(rows);
    } catch (err) {
        console.error('Erro ao gerar relatório de compras de brechó:', err);
        res.status(500).json({ erro: 'Erro ao gerar relatório.' });
    } finally {
        if (connection) connection.release();
    }
});

// Relatório de Conferência de Caixas atualizado com o abatimento das compras de brechó pagas em dinheiro/Pix
app.get('/relatorios/caixas', async (req, res) => {
    try {
        const [sessoes] = await db.query(`
            SELECT 
                s.id as sessao_id,
                u.nome as operador,
                s.valor_abertura,
                s.valor_fechamento,
                s.status,
                s.data_abertura,
                s.data_fechamento,
                COALESCE((SELECT SUM(v.valor_total) FROM vendas v WHERE v.sessao_caixa_id = s.id), 0) as total_vendas,
                COALESCE((SELECT SUM(cb.valor_total) FROM compras_brecho cb WHERE cb.sessao_caixa_id = s.id AND cb.forma_pagamento != 'credito_loja'), 0) as total_compras
            FROM sessoes_caixa s
            JOIN usuarios u ON s.usuario_id = u.id
            GROUP BY s.id
            ORDER BY s.id DESC
        `);

        const resultado = sessoes.map(sessao => {
            const abertura = Number(sessao.valor_abertura) || 0;
            const vendas = Number(sessao.total_vendas) || 0;
            const compras = Number(sessao.total_compras) || 0;
            
            const esperado = abertura + vendas - compras;
            const fechamento = sessao.valor_fechamento !== null ? Number(sessao.valor_fechamento) : null;

            let diferenca = 0;
            let status_caixa = 'Aberto';

            if (sessao.status === 'fechado' && fechamento !== null) {
                diferenca = fechamento - esperado;
                if (diferenca > 0) status_caixa = `Sobra (R$ ${diferenca.toFixed(2)})`;
                else if (diferenca < 0) status_caixa = `Falta (R$ ${Math.abs(diferenca).toFixed(2)})`;
                else status_caixa = 'Bateu Certo';
            }

            return {
                ...sessao,
                valor_abertura: abertura.toFixed(2),
                valor_fechamento: fechamento !== null ? fechamento.toFixed(2) : null,
                total_vendas: vendas.toFixed(2),
                total_compras: compras.toFixed(2),
                valor_esperado: esperado.toFixed(2),
                diferenca: diferenca.toFixed(2),
                situacao_caixa: status_caixa
            };
        });

        res.json(resultado);
    } catch (error) {
        console.error('Erro ao gerar relatório de caixas:', error);
        res.status(500).json({ error: 'Erro ao gerar relatório de caixas' });
    }
});

app.get('/relatorios/estoque-baixo', async (req, res) => {
    try {
        const [rows] = await db.query(`
            SELECT p.*, c.nome as categoria_nome 
            FROM produtos p 
            LEFT JOIN categorias c ON p.categoria_id = c.id 
            WHERE p.estoque_atual <= p.estoque_minimo 
            ORDER BY p.estoque_atual ASC
        `);
        res.json(rows);
    } catch (error) {
        console.error('Erro ao buscar estoque baixo:', error);
        res.status(500).json({ erro: 'Erro ao gerar relatório de estoque baixo.' });
    }
});

app.get('/relatorios/mais-vendidos', async (req, res) => {
    try {
        const [rows] = await db.query(`
            SELECT p.id, p.nome, p.codigo_barras, 
            SUM(iv.quantidade) as total_vendido, 
            SUM(iv.quantidade * iv.preco_unitario) as faturamento_total
            FROM itens_venda iv
            JOIN produtos p ON iv.produto_id = p.id
            GROUP BY p.id, p.nome, p.codigo_barras
            ORDER BY total_vendido DESC
            LIMIT 10
        `);
        res.json(rows);
    } catch (error) {
        console.error('Erro ao buscar mais vendidos:', error);
        res.status(500).json({ erro: 'Erro ao gerar relatório de mais vendidos.' });
    }
});

app.post('/login', async (req, res) => {
    try {
        const { nome, email, senha } = req.body;
        const entrada = nome || email;
        if (typeof entrada !== 'string' || typeof senha !== 'string') return res.status(400).json({ error: 'Preencha os campos corretamente.' });
        const identificador = entrada.trim();

        if (!identificador || !senha) return res.status(400).json({ error: 'Preencha todos os campos.' });

        const [rows] = await db.query(
            'SELECT * FROM usuarios WHERE LOWER(nome) = LOWER(?) OR LOWER(email) = LOWER(?)',
            [identificador, identificador]
        );

        if (rows.length === 0 || !rows[0].ativo) return res.status(401).json({ error: 'Usuário ou senha incorretos.' });

        const usuario = rows[0];
        const senhaCorreta = await bcrypt.compare(senha, usuario.senha_hash);
        if (!senhaCorreta) return res.status(401).json({ error: 'Usuário ou senha incorretos.' });

        const jwtSecret = process.env.JWT_SECRET;
        if (!jwtSecret) return res.status(500).json({ error: 'Erro interno no servidor.' });

        const token = jwt.sign({ id: usuario.id, cargo: usuario.cargo }, jwtSecret, { expiresIn: process.env.JWT_EXPIRES_IN || '8h' });

        res.json({ token, usuario: { id: usuario.id, nome: usuario.nome, email: usuario.email, cargo: usuario.cargo } });
    } catch (error) {
        console.error('Erro crítico no login:', error);
        res.status(500).json({ error: 'Erro interno no servidor.' });
    }
});

app.delete('/produtos/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const [result] = await db.query('DELETE FROM produtos WHERE id = ?', [id]);
        if (result.affectedRows === 0) return res.status(404).json({ erro: 'Produto não encontrado.' });
        res.json({ mensagem: 'Produto excluído com sucesso!' });
    } catch (error) {
        console.error('Erro ao excluir produto:', error);
        res.status(500).json({ erro: 'Não é possível excluir este produto pois ele já possui vendas registradas.' });
    }
});

app.put('/produtos/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { codigo_barras, nome, categoria_id, preco_custo, preco_venda, estoque_atual } = req.body;
        const erros = validarProduto(req.body);
        if (erros.length) return res.status(400).json({ erro: erros.join(' ') });

        const [result] = await db.query(
            `UPDATE produtos SET codigo_barras = ?, nome = ?, categoria_id = ?, preco_custo = ?, preco_venda = ?, estoque_atual = ? WHERE id = ?`,
            [codigo_barras, nome, categoria_id || null, Number(preco_custo), Number(preco_venda), Number(estoque_atual), id]
        );

        if (result.affectedRows === 0) return res.status(404).json({ erro: 'Produto não encontrado.' });
        res.json({ mensagem: 'Produto atualizado com sucesso!' });
    } catch (error) {
        if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ erro: 'Código de barras já cadastrado.' });
        console.error('Erro ao atualizar produto:', error);
        res.status(500).json({ erro: 'Erro ao atualizar produto.' });
    }
});

// Rota para Registrar Compra de Peças / Lotes com Suporte a Nome Avulso, Comprovante e Gravação Consolidada
app.post('/compras-brecho', async (req, res) => {
    const { sessao_caixa_id, cliente_id, nome_cliente_avulso, forma_pagamento, itens } = req.body;

    if (!ehInteiroPositivo(sessao_caixa_id)) return res.status(400).json({ erro: 'Caixa inválido.' });
    if (!['dinheiro', 'pix', 'credito_loja'].includes(forma_pagamento)) return res.status(400).json({ erro: 'Forma de pagamento inválida.' });
    if (!Array.isArray(itens) || itens.length === 0) return res.status(400).json({ erro: 'Nenhum item informado para compra.' });

    let clienteIdReal = (cliente_id != null && cliente_id !== '') ? Number(cliente_id) : null;
    if (forma_pagamento === 'credito_loja' && !clienteIdReal) {
        return res.status(400).json({ erro: 'Para deixar em crédito em haver, é necessário selecionar um cliente cadastrado.' });
    }

    let connection;
    let transacao = false;
    const recusar = mensagem => { const erro = new Error(mensagem); erro.status = 400; throw erro; };

    try {
        connection = await db.getConnection();
        await connection.beginTransaction();
        transacao = true;

        const [sessoes] = await connection.query("SELECT id FROM sessoes_caixa WHERE id = ? AND status = 'aberto' FOR UPDATE", [sessao_caixa_id]);
        if (!sessoes.length) recusar('O caixa está fechado. Abra um caixa antes de registrar compras.');

        let nomeClienteStr = nome_cliente_avulso ? nome_cliente_avulso.trim() : 'Cliente Avulso';
        let telefoneClienteStr = '';

        if (clienteIdReal) {
            const [clientes] = await connection.query('SELECT nome, telefone FROM clientes WHERE id = ? FOR UPDATE', [clienteIdReal]);
            if (clientes.length) {
                nomeClienteStr = clientes[0].nome;
                telefoneClienteStr = clientes[0].telefone || '';
            }
        }

        let totalCentavos = itens.reduce((total, item) => {
            const precoCentavos = Math.round(Number(item.preco_custo) * 100);
            return total + (precoCentavos * Number(item.quantidade));
        }, 0);

        if (!Number.isSafeInteger(totalCentavos) || totalCentavos <= 0) recusar('Valor total da compra inválido.');
        const valorTotalReais = totalCentavos / 100;

        if (forma_pagamento === 'credito_loja' && clienteIdReal) {
            await connection.query(
                'UPDATE clientes SET saldo_credito = COALESCE(saldo_credito, 0) + ? WHERE id = ?',
                [valorTotalReais, clienteIdReal]
            );
        }

        await connection.query(`
            CREATE TABLE IF NOT EXISTS compras_brecho (
                id INT AUTO_INCREMENT PRIMARY KEY,
                sessao_caixa_id INT,
                cliente_id INT,
                nome_cliente_avulso VARCHAR(150),
                valor_total DECIMAL(10,2),
                forma_pagamento VARCHAR(50),
                criado_em DATETIME
            )
        `);

        const [resCompra] = await connection.query(
            `INSERT INTO compras_brecho (sessao_caixa_id, cliente_id, nome_cliente_avulso, valor_total, forma_pagamento, criado_em) 
             VALUES (?, ?, ?, ?, ?, NOW())`,
            [sessao_caixa_id, clienteIdReal, clienteIdReal ? null : nomeClienteStr, valorTotalReais, forma_pagamento]
        );
        const compraBrechoId = resCompra.insertId;

        let itensProcessadosParaComprovante = [];
        for (const item of itens) {
            const nomeProduto = item.nome || 'Saco de Roupas / Lote';
            const precoCusto = Number(item.preco_custo) || 0;
            const precoVenda = Number(item.preco_venda) || (precoCusto * 2);
            const qtd = Number(item.quantidade) || 1;
            const codigoBarras = `COMPRA-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

            await connection.query(
                `INSERT INTO produtos (codigo_barras, nome, preco_custo, preco_venda, estoque_atual, estoque_minimo) 
                 VALUES (?, ?, ?, ?, ?, 1)`,
                [codigoBarras, nomeProduto, precoCusto, precoVenda, qtd]
            );

            await connection.query(`
                CREATE TABLE IF NOT EXISTS itens_compra_brecho (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    compra_brecho_id INT,
                    nome_produto VARCHAR(150),
                    quantidade INT,
                    preco_custo DECIMAL(10,2)
                )
            `);

            await connection.query(
                `INSERT INTO itens_compra_brecho (compra_brecho_id, nome_produto, quantidade, preco_custo) VALUES (?, ?, ?, ?)`,
                [compraBrechoId, nomeProduto, qtd, precoCusto]
            );

            itensProcessadosParaComprovante.push({
                nome: nomeProduto,
                quantidade: qtd,
                subtotal: precoCusto * qtd
            });
        }

        await connection.commit();
        transacao = false;

        res.status(201).json({
            mensagem: 'Aquisição de lote registrada com sucesso e estoque atualizado!',
            valor_total: valorTotalReais,
            comprovante: {
                data: new Date().toLocaleString('pt-BR'),
                cliente: nomeClienteStr,
                telefone: telefoneClienteStr,
                forma_pagamento: forma_pagamento,
                itens: itensProcessadosParaComprovante,
                valor_total: valorTotalReais
            }
        });

    } catch (error) {
        if (transacao) {
            try { await connection.rollback(); } catch (rbErr) { console.error('Erro no rollback:', rbErr); }
        }
        console.error('Erro ao registrar compra de lote:', error);
        res.status(error.status || 500).json({ erro: error.message || 'Erro ao registrar a aquisição de lote.' });
    } finally {
        if (connection) connection.release();
    }
});

// Rota para consultar o histórico de compras/lotes de roupas de um cliente específico
app.get('/api/clientes/:id/compras-brecho', async (req, res) => {
    try {
        const clienteId = req.params.id;
        const [rows] = await db.query(`
            SELECT cb.id, cb.valor_total, cb.forma_pagamento,
                   DATE_FORMAT(cb.criado_em, '%d/%m/%Y %H:%i') AS data
            FROM compras_brecho cb
            WHERE cb.cliente_id = ?
            ORDER BY cb.id DESC
        `, [clienteId]);
        res.json(rows);
    } catch (err) {
        res.json([]);
    }
});

if (require.main === module) {
    const config = require('./utils/configuracao').configuracao();
    app.listen(config.port, config.host, () => {
        backup.iniciarBackups(db);
        console.log(`Servidor iniciado em ${config.host}:${config.port}`);
    });
}

module.exports = app;