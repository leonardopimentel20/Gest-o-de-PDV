const express = require('express');
const db = require('./db');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const path = require('path');
const { verificarToken } = require('./middleware/auth');
const { validarProduto, validarItensVenda, ehNumeroPositivo, ehInteiroPositivo } = require('./utils/validacao');
const app = express();
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

// 1. Rota para Listar Produtos corrigida para retornar os dados corretamente
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

// 2. Rota para Cadastrar um Novo Produto (Com validação estrita de números e estoque positivo)
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

// 3. Rota Única e Segura para Registrar Venda (PDV) com Validação de Crediário e Estoque[cite: 1]
app.post('/vendas', async (req, res) => {
    const { sessao_caixa_id, cliente_id, forma_pagamento, itens } = req.body;
    const usuario_id = req.usuario.id;
    const erros = validarItensVenda(itens);
    if (!ehInteiroPositivo(sessao_caixa_id)) erros.push('Caixa inválido.');
    if (!['dinheiro', 'cartao_credito', 'cartao_debito', 'pix', 'crediario'].includes(forma_pagamento)) erros.push('Forma de pagamento inválida.');
    if (cliente_id != null && !ehInteiroPositivo(cliente_id)) erros.push('Cliente inválido.');
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
        const totalCentavos = itens.reduce((total, item) => total + Math.round(Number(item.preco_unitario) * 100) * Number(item.quantidade), 0);
        if (!Number.isSafeInteger(totalCentavos) || totalCentavos <= 0) recusar('Total da venda inválido.');
        const valor_total = totalCentavos / 100;
        if (cliente_id) {
            const [clientes] = await connection.query('SELECT limite_credito FROM clientes WHERE id = ? FOR UPDATE', [cliente_id]);
            if (!clientes.length) recusar('Cliente não encontrado.');
            if (forma_pagamento === 'crediario') {
                const [dividas] = await connection.query("SELECT COALESCE(SUM(valor_total), 0) AS total_devido FROM vendas WHERE cliente_id = ? AND forma_pagamento = 'crediario'", [cliente_id]);
                const disponivel = Math.round(Number(clientes[0].limite_credito) * 100) - Math.round(Number(dividas[0].total_devido) * 100);
                if (totalCentavos > disponivel) recusar(`Limite insuficiente! Disponível: R$ ${(disponivel / 100).toFixed(2)}.`);
            }
        }
        const [venda] = await connection.query('INSERT INTO vendas (sessao_caixa_id, usuario_id, cliente_id, valor_total, forma_pagamento, criado_em) VALUES (?, ?, ?, ?, ?, NOW())', [sessao_caixa_id, usuario_id, cliente_id || null, valor_total, forma_pagamento]);
        for (const item of [...itens].sort((a, b) => Number(a.produto_id || 0) - Number(b.produto_id || 0))) {
            let nome = item.nome || 'Item Avulso';
            if (item.produto_id) {
                const [produtos] = await connection.query('SELECT estoque_atual, nome FROM produtos WHERE id = ? FOR UPDATE', [item.produto_id]);
                if (!produtos.length) recusar('Produto não encontrado.');
                if (Number(produtos[0].estoque_atual) < Number(item.quantidade)) recusar(`Estoque insuficiente para "${produtos[0].nome}".`);
                nome = produtos[0].nome;
                await connection.query('UPDATE produtos SET estoque_atual = estoque_atual - ? WHERE id = ?', [item.quantidade, item.produto_id]);
            }
            await connection.query('INSERT INTO itens_venda (venda_id, produto_id, quantidade, preco_unitario, nome_produto_avulso) VALUES (?, ?, ?, ?, ?)', [venda.insertId, item.produto_id || null, item.quantidade, Math.round(Number(item.preco_unitario) * 100) / 100, nome]);
        }
        await connection.commit();
        transacao = false;
        res.status(201).json({ mensagem: 'Venda realizada com sucesso!', venda_id: venda.insertId, valor_total });
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

// 4. Rota para Listar Vendas (para relatórios)
app.get('/vendas', async (req, res) => {
    try {
        const [rows] = await db.query(`
            SELECT v.*, c.nome as cliente_nome 
            FROM vendas v 
            LEFT JOIN clientes c ON v.cliente_id = c.id 
            ORDER BY v.id DESC
        `);
       // Calcula o total geral das vendas
       const [totalResult] = await db.query('SELECT SUM(valor_total) as total FROM vendas');
       const totalGeral = totalResult[0]?.total || 0;

       // Retorna um objeto contendo a lista e o total
       res.json({ vendas: rows, totalGeral });
   } catch (error) {
       console.error('Erro ao buscar vendas:', error);
       res.status(500).json({ erro: 'Erro ao buscar vendas.' });
   }
});

// Verificar se há caixa aberto
app.get('/sessoes/ativa', async (req, res) => {
    try {
        const [rows] = await db.query("SELECT * FROM sessoes_caixa WHERE status = 'aberto' ORDER BY id DESC LIMIT 1");
        if (rows.length === 0) {
            return res.json({ aberta: false });
        }
        res.json({ aberta: true, sessao: rows[0] });
    } catch (error) {
        console.error('Erro ao verificar caixa:', error);
        res.status(500).json({ error: 'Erro ao verificar caixa' });
    }
});

// Abrir novo caixa
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
        const [result] = await connection.query("INSERT INTO sessoes_caixa (usuario_id, valor_abertura, status, data_abertura) VALUES (?, ?, 'aberto', NOW())", [usuario_id, valor_abertura]);
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

// Fechar caixa
app.post('/sessoes/fechar/:id', async (req, res) => {
    const { id } = req.params;
    const { valor_fechamento } = req.body;
    if (!ehInteiroPositivo(id) || !ehNumeroPositivo(valor_fechamento)) return res.status(400).json({ error: 'Valor de fechamento ou caixa inválido.' });
    try {
        const [result] = await db.query(
            "UPDATE sessoes_caixa SET valor_fechamento = ?, status = 'fechado', data_fechamento = NOW() WHERE id = ? AND status = 'aberto'",
            [valor_fechamento, id]
        );
        if (!result.affectedRows) return res.status(409).json({ error: 'Caixa inexistente ou já fechado.' });
        res.json({ success: true });
    } catch (error) {
        console.error('Erro ao fechar caixa:', error);
        res.status(500).json({ error: 'Erro ao fechar o caixa' });
    }
});

// Listar todos os clientes cadastrados com cálculo automático do débito
app.get('/api/clientes', async (req, res) => {
    try {
        const query = `
            SELECT c.*, 
            COALESCE(SUM(CASE WHEN v.forma_pagamento = 'crediario' THEN v.valor_total ELSE 0 END), 0) as total_devido
            FROM clientes c
            LEFT JOIN vendas v ON c.id = v.cliente_id
            GROUP BY c.id
            ORDER BY c.nome ASC
        `;
        const [results] = await db.query(query);
        res.json(results);
    } catch (err) {
        console.error('Erro ao buscar clientes:', err);
        res.status(500).json({ erro: 'Erro ao buscar clientes' });
    }
});

// Cadastrar um novo cliente de confiança
app.post('/api/clientes', async (req, res) => {
    try {
        const { nome, telefone, limite_credito } = req.body;
        if (typeof nome !== 'string' || !nome.trim() || nome.trim().length > 150 || !ehNumeroPositivo(limite_credito ?? 0)) {
            return res.status(400).json({ erro: 'O nome do cliente é obrigatório.' });
        }
        const query = 'INSERT INTO clientes (nome, telefone, limite_credito) VALUES (?, ?, ?)';
        const [result] = await db.query(query, [nome, telefone, limite_credito || 0.00]);
        res.json({ id: result.insertId, mensagem: 'Cliente cadastrado com sucesso!' });
    } catch (err) {
        console.error('Erro ao cadastrar cliente:', err);
        res.status(500).json({ erro: 'Erro ao cadastrar cliente' });
    }
});

// Buscar compras pendentes (crediário) de um cliente específico com todos os campos da venda e itens detalhados
app.get('/api/clientes/:id/crediarios', async (req, res) => {
    try {
        const clienteId = req.params.id;
        const query = `
            SELECT v.id, v.sessao_caixa_id, v.usuario_id, v.cliente_id, v.valor_total, v.forma_pagamento, v.data_venda, v.criado_em,
                   COALESCE(
                       NULLIF(GROUP_CONCAT(CONCAT(iv.quantidade, 'x ', COALESCE(p.nome, iv.nome_produto_avulso, 'Item')) SEPARATOR ', '), ''), 
                       'Venda sem itens detalhados'
                   ) as itens_descricao
            FROM vendas v
            LEFT JOIN itens_venda iv ON v.id = iv.venda_id
            LEFT JOIN produtos p ON iv.produto_id = p.id
            WHERE v.cliente_id = ? AND v.forma_pagamento = 'crediario'
            GROUP BY v.id, v.sessao_caixa_id, v.usuario_id, v.cliente_id, v.valor_total, v.forma_pagamento, v.data_venda, v.criado_em
            ORDER BY v.criado_em DESC
        `;
        const [results] = await db.query(query, [clienteId]);
        res.json(results);
    } catch (err) {
        console.error('❌ Erro na query de crediários:', err);
        res.status(500).json({ erro: 'Erro ao consultar o histórico de crediário.' });
    }
});

// Relatório de Fechamento de Caixa
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
                COALESCE(SUM(v.valor_total), 0) as total_vendas
            FROM sessoes_caixa s
            JOIN usuarios u ON s.usuario_id = u.id
            LEFT JOIN vendas v ON v.sessao_caixa_id = s.id
            GROUP BY s.id
            ORDER BY s.id DESC
        `);

        const resultado = sessoes.map(sessao => {
            const abertura = Number(sessao.valor_abertura) || 0;
            const vendas = Number(sessao.total_vendas) || 0;
            const esperado = abertura + vendas;
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
                valor_esperado: esperado,
                diferenca,
                situacao_caixa: status_caixa
            };
        });

        res.json(resultado);
    } catch (error) {
        console.error('Erro ao gerar relatório de caixas:', error);
        res.status(500).json({ error: 'Erro ao gerar relatório de caixas' });
    }
});

// Relatório de Produtos com Estoque Baixo
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

// Relatório de Ranking de Produtos Mais Vendidos
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

// Rota de Login
app.post('/login', async (req, res) => {
    try {
        const { nome, email, senha } = req.body;
        const entrada = nome || email;
        if (typeof entrada !== 'string' || typeof senha !== 'string') return res.status(400).json({ error: 'Preencha os campos corretamente.' });
        const identificador = entrada.trim();

        if (!identificador || !senha) {
            return res.status(400).json({ error: 'Preencha todos os campos.' });
        }

        const [rows] = await db.query(
            'SELECT * FROM usuarios WHERE LOWER(nome) = LOWER(?) OR LOWER(email) = LOWER(?)',
            [identificador, identificador]
        );

        if (rows.length === 0 || !rows[0].ativo) {
            return res.status(401).json({ error: 'Usuário ou senha incorretos.' });
        }

        const usuario = rows[0];
        const senhaCorreta = await bcrypt.compare(senha, usuario.senha_hash);

        if (!senhaCorreta) {
            return res.status(401).json({ error: 'Usuário ou senha incorretos.' });
        }

        const jwtSecret = process.env.JWT_SECRET;
        if (!jwtSecret) {
            console.error('JWT_SECRET não definido no arquivo .env');
            return res.status(500).json({ error: 'Erro interno no servidor.' });
        }

        const token = jwt.sign(
            { id: usuario.id, cargo: usuario.cargo },
            jwtSecret,
            { expiresIn: process.env.JWT_EXPIRES_IN || '8h' }
        );

        res.json({
            token,
            usuario: {
                id: usuario.id,
                nome: usuario.nome,
                email: usuario.email,
                cargo: usuario.cargo
            }
        });

    } catch (error) {
        console.error('Erro crítico no login:', error);
        res.status(500).json({ error: 'Erro interno no servidor.' });
    }
});

// Rota para Excluir Produto
app.delete('/produtos/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const [result] = await db.query('DELETE FROM produtos WHERE id = ?', [id]);

        if (result.affectedRows === 0) {
            return res.status(404).json({ erro: 'Produto não encontrado.' });
        }
        res.json({ mensagem: 'Produto excluído com sucesso!' });
    } catch (error) {
        console.error('Erro ao excluir produto:', error);
        res.status(500).json({ erro: 'Não é possível excluir este produto pois ele já possui vendas registradas.' });
    }
});

// Rota para Atualizar Produto
app.put('/produtos/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { codigo_barras, nome, categoria_id, preco_custo, preco_venda, estoque_atual } = req.body;
        const erros = validarProduto(req.body);
        if (erros.length) return res.status(400).json({ erro: erros.join(' ') });

        const [result] = await db.query(
            `UPDATE produtos SET codigo_barras = ?, nome = ?, categoria_id = ?, preco_custo = ?, preco_venda = ?, estoque_atual = ? WHERE id = ?`,
            [codigo_barras, nome, categoria_id || null, preco_custo, preco_venda, estoque_atual, id]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({ erro: 'Produto não encontrado.' });
        }
        res.json({ mensagem: 'Produto atualizado com sucesso!' });
    } catch (error) {
        if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ erro: 'Código de barras já cadastrado.' });
        console.error('Erro ao atualizar produto:', error);
        res.status(500).json({ erro: 'Erro ao atualizar produto.' });
    }
});

// Iniciar Servidor
const PORT = process.env.PORT || 3000;
if (require.main === module) app.listen(PORT, '127.0.0.1', () => {
    console.log(`Servidor local em http://127.0.0.1:${PORT}`);
});
module.exports = app;
