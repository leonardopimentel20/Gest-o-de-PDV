// Inclui a autenticação em todas as chamadas locais, inclusive relatórios e caixa.
(() => {
    const originalFetch = window.fetch.bind(window);
    window.fetch = async (input, options = {}) => {
        const url = new URL(input instanceof Request ? input.url : input, location.href);
        if (url.origin !== location.origin) return originalFetch(input, options);
        const headers = new Headers(options.headers || (input instanceof Request ? input.headers : undefined));
        const token = localStorage.getItem('token');
        if (token) headers.set('Authorization', `Bearer ${token}`);
        const response = await originalFetch(input, { ...options, headers });
        if (response.status === 401) {
            localStorage.removeItem('token');
            localStorage.removeItem('usuario');
            location.replace('/login.html');
            throw new Error('Sessão expirada. Faça login novamente.');
        }
        return response;
    };
})();
