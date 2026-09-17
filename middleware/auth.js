const jwt = require('jsonwebtoken');

/**
 * Verifica se a requisição possui um token JWT válido no header:
 * Authorization: Bearer <token>
 * Se válido, disponibiliza os dados do usuário em req.usuario.
 */
function verificarToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ error: 'Acesso negado. Faça login para continuar.' });
    }

    jwt.verify(token, process.env.JWT_SECRET, (err, usuario) => {
        if (err) {
            return res.status(401).json({ error: 'Sessão expirada ou inválida. Faça login novamente.' });
        }
        req.usuario = usuario; // { id, nome, cargo }
        next();
    });
}

/**
 * Restringe a rota a determinados cargos.
 * Uso: permitir('admin') ou permitir('admin', 'operador')
 */
function permitir(...cargosPermitidos) {
    return (req, res, next) => {
        if (!req.usuario || !cargosPermitidos.includes(req.usuario.cargo)) {
            return res.status(403).json({ error: 'Você não tem permissão para acessar este recurso.' });
        }
        next();
    };
}

module.exports = { verificarToken, permitir };
