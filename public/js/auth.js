// Helper de autenticação usado por todas as páginas.
// O front-end é servido pelo próprio servidor, então a API está na mesma origem.
const API_URL = window.location.origin;

function getToken() {
    return localStorage.getItem('token');
}

function getUsuario() {
    try {
        return JSON.parse(localStorage.getItem('usuario'));
    } catch {
        return null;
    }
}

// Garante que existe um usuário logado e, opcionalmente, que ele tem um dos
// cargos permitidos para aquela página. Redireciona automaticamente caso contrário.
function exigirLogin(cargosPermitidos = null) {
    const usuario = getUsuario();
    const token = getToken();

    if (!token || !usuario) {
        window.location.href = 'login.html';
        return null;
    }

    if (cargosPermitidos && !cargosPermitidos.includes(usuario.cargo)) {
        alert('Acesso restrito!');
        window.location.href = usuario.cargo === 'admin' ? 'index.html' : 'caixa.html';
        return null;
    }

    return usuario;
}

// Wrapper do fetch que já inclui o token de autenticação e trata sessão expirada.
async function apiFetch(caminho, opcoes = {}) {
    const token = getToken();
    const headers = {
        'Content-Type': 'application/json',
        ...(opcoes.headers || {})
    };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const resposta = await fetch(`${API_URL}${caminho}`, { ...opcoes, headers });

    if (resposta.status === 401 || resposta.status === 403) {
        localStorage.removeItem('token');
        localStorage.removeItem('usuario');
        alert('Sua sessão expirou. Faça login novamente.');
        window.location.href = 'login.html';
        throw new Error('Sessão expirada');
    }

    return resposta;
}

function sair() {
    localStorage.removeItem('token');
    localStorage.removeItem('usuario');
    window.location.href = 'login.html';
}
