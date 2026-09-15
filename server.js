process.on('uncaughtException', (err) => {
    console.error('💥 Erro não tratado (Crash):', err);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('💥 Promessa rejeitada não tratada:', reason);
});

const express = require('express');
const cors = require('cors');
const db = require('./db');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const app = express();
app.use(express.json());
app.use(cors());
app.use(express.static('public'));
app.use(express.urlencoded({ extended: true }));

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

    if (!codigo_barras || !nome || !preco_venda) {
        return res.status(400).json({ erro: 'Preencha os campos obrigatórios do produto.' });
    }

    const precoCustoNum = Number(preco_custo);
    const precoVendaNum = Number(preco_venda);
    const estoqueNum = Number(estoque_atual);

    if (isNaN(precoCustoNum) || isNaN(precoVendaNum) || isNaN(estoqueNum)) {
        return res.status(400).json({ erro: 'Preços e estoque devem ser números válidos.' });
    }

    if (estoqueNum < 0) {
        return res.status(400).json({ erro: 'O estoque inicial não pode ser negativo.' });
    }
    if (precoVendaNum < precoCustoNum) {
        return res.status(400).json({ erro: 'O preço de venda não pode ser menor que o preço de custo.' });
    }

    try {
        const [result] = await db.query(
            `INSERT INTO produtos (codigo_barras, nome, categoria_id, preco_custo, preco_venda, estoque_atual, estoque_minimo) 
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [codigo_barras, nome, categoria_id || null, precoCustoNum, precoVendaNum, estoqueNum, estoque_minimo || 5]
        );
        res.status(201).json({ mensagem: 'Produto cadastrado com sucesso!', id: result.insertId });
    } catch (error) {
        console.error('Erro ao cadastrar produto:', error);
        res.status(500).json({ erro: 'Erro ao cadastrar produto.' });
    }
});

// 3. Rota Única e Segura para Registrar Venda (PDV) com Validação de Crediário e Estoque[cite: 1]
app.post('/vendas', async (req, res) => {
    const connection = await db.getConnection();
    try {
        await connection.beginTransaction();

        const { sessao_caixa_id, usuario_id, cliente_id, forma_pagamento, itens } = req.body;

        if (!itens || itens.length === 0) {
            await connection.release();
            return res.status(400).json({ erro: 'O carrinho está vazio.' });
        }

        // Calcular valor total da venda
        let valor_total = 0;
        for (let item of itens) {
            if (item.quantidade <= 0 || item.preco_unitario < 0) {
                await connection.release();
                return res.status(400).json({ erro: 'Valores ou quantidades inválidas nos itens.' });
            }
            valor_total += item.quantidade * item.preco_unitario;
        }

        // Validação estrita de Limite para Crediário
        if (forma_pagamento === 'crediario') {
            if (!cliente_id) {
                await connection.release();
                return res.status(400).json({ erro: 'É obrigatório selecionar um cliente para vendas no crediário.' });
            }

            const [clienteRows] = await connection.query('SELECT limite_credito FROM clientes WHERE id = ?', [cliente_id]);
            if (clienteRows.length === 0) {
                await connection.release();
                return res.status(400).json({ erro: 'Cliente não encontrado.' });
            }
            const limiteTotal = Number(clienteRows[0].limite_credito);

            const [dividasRows] = await connection.query(
                "SELECT SUM(valor_total) as total_devido FROM vendas WHERE cliente_id = ? AND forma_pagamento = 'crediario'",
                [cliente_id]
            );
            const totalDevido = Number(dividasRows[0].total_devido || 0);
            const limiteDisponivel = limiteTotal - totalDevido;

            if (valor_total > limiteDisponivel) {
                await connection.release();
                return res.status(400).json({
                    erro: `Limite insuficiente! O cliente possui R$ ${limiteDisponivel.toFixed(2)} disponíveis de R$ ${limiteTotal.toFixed(2)}.`
                });
            }
        }

        // Inserir a venda
        const [vendaResult] = await connection.query(
            'INSERT INTO vendas (sessao_caixa_id, usuario_id, cliente_id, valor_total, forma_pagamento, criado_em) VALUES (?, ?, ?, ?, ?, NOW())',
            [sessao_caixa_id, usuario_id, cliente_id || null, valor_total, forma_pagamento]
        );
        const vendaId = vendaResult.insertId;

        // Inserir itens e validar o estoque de forma segura
        for (let item of itens) {
            let nomeItem = item.nome || 'Item Avulso';

            if (item.produto_id) {
                const [produtoRows] = await connection.query(
                    'SELECT estoque_atual, nome FROM produtos WHERE id = ?',
                    [item.produto_id]
                );

                if (produtoRows.length === 0) {
                    throw new Error(`Produto ID ${item.produto_id} não encontrado.`);
                }

                const estoqueAtual = Number(produtoRows[0].estoque_atual);
                if (estoqueAtual < item.quantidade) {
                    throw new Error(`Estoque insuficiente para o produto "${produtoRows[0].nome}". Disponível: ${estoqueAtual}, Solicitado: ${item.quantidade}`);
                }

                nomeItem = produtoRows[0].nome;

                await connection.query(
                    'UPDATE produtos SET estoque_atual = estoque_atual - ? WHERE id = ?',
                    [item.quantidade, item.produto_id]
                );
            }

            await connection.query(
                'INSERT INTO itens_venda (venda_id, produto_id, quantidade, preco_unitario, nome_produto_avulso) VALUES (?, ?, ?, ?, ?)',
                [vendaId, item.produto_id || null, item.quantidade, item.preco_unitario, nomeItem]
            );
        }

        await connection.commit();
        connection.release();
        res.status(201).json({ mensagem: 'Venda realizada com sucesso!', venda_id: vendaId, valor_total });

    } catch (error) {
        await connection.rollback();
        connection.release();
        console.error('Erro ao processar venda:', error);
        res.status(500).json({ erro: error.message || 'Erro ao processar a venda no servidor.' });
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
    const { usuario_id, valor_abertura } = req.body;
    try {
        const [rows] = await db.query("SELECT * FROM sessoes_caixa WHERE status = 'aberto'");
        if (rows.length > 0) {
            return res.status(400).json({ error: 'Já existe um caixa aberto no momento!' });
        }

        const [result] = await db.query(
            "INSERT INTO sessoes_caixa (usuario_id, valor_abertura, status, data_abertura) VALUES (?, ?, 'aberto', NOW())",
            [usuario_id, valor_abertura]
        );
        res.json({ success: true, sessao_id: result.insertId });
    } catch (error) {
        console.error('Erro ao abrir caixa:', error);
        res.status(500).json({ error: 'Erro ao abrir o caixa' });
    }
});

// Fechar caixa
app.post('/sessoes/fechar/:id', async (req, res) => {
    const { id } = req.params;
    const { valor_fechamento } = req.body;
    try {
        await db.query(
            "UPDATE sessoes_caixa SET valor_fechamento = ?, status = 'fechado', data_fechamento = NOW() WHERE id = ?",
            [valor_fechamento, id]
        );
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
        if (!nome) {
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
    console.log("🚨 ATENÇÃO: A NOVA ROTA DE CREDIARIOS FOI CHAMADA!");
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
        console.log("📦 Dados gerados com JOIN:", results);
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
        const identificador = (nome || email || '').trim();

        if (!identificador || !senha) {
            return res.status(400).json({ error: 'Preencha todos os campos.' });
        }

        const [rows] = await db.query(
            'SELECT * FROM usuarios WHERE LOWER(nome) = LOWER(?) OR LOWER(email) = LOWER(?)',
            [identificador, identificador]
        );

        if (rows.length === 0) {
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

        const [result] = await db.query(
            `UPDATE produtos SET codigo_barras = ?, nome = ?, categoria_id = ?, preco_custo = ?, preco_venda = ?, estoque_atual = ? WHERE id = ?`,
            [codigo_barras, nome, categoria_id || null, preco_custo, preco_venda, estoque_atual, id]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({ erro: 'Produto não encontrado.' });
        }
        res.json({ mensagem: 'Produto atualizado com sucesso!' });
    } catch (error) {
        console.error('Erro ao atualizar produto:', error);
        res.status(500).json({ erro: 'Erro ao atualizar produto.' });
    }
});

// Iniciar Servidor
const PORT = process.env.PORT || 3000;
app.listen(PORT, '127.0.0.1', () => {
    console.log(`Servidor local em http://127.0.0.1:${PORT}`);
});