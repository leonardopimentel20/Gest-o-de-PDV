const fs = require('node:fs');

function configuracao(env = process.env) {
    const nuvem = env.DEPLOY_TARGET === 'azure' || env.RAILWAY_ENVIRONMENT;
    
    if (env.DEPLOY_TARGET === 'azure') {
        for (const nome of ['DB_HOST', 'DB_USER', 'DB_PASSWORD', 'DB_NAME', 'JWT_SECRET']) {
            if (!env[nome]) throw new Error(`Configure ${nome} nas variáveis do App Service.`);
        }
        if (env.JWT_SECRET.length < 32) throw new Error('JWT_SECRET deve ter pelo menos 32 caracteres na Azure.');
        if (env.DB_SSL !== 'true') throw new Error('A conexão Azure exige DB_SSL=true.');
        if (env.BACKUP_DIR) throw new Error('Não use BACKUP_DIR local no App Service. Configure backups no serviço de banco.');
    }

    const fuso = env.DB_TIMEZONE || (nuvem ? '-03:00' : 'local');
    if (fuso !== 'local' && !/^[+-](?:0\d|1[0-3]):[0-5]\d$/.test(fuso)) {
        throw new Error('DB_TIMEZONE deve ser local ou um deslocamento, por exemplo -03:00.');
    }

    const ssl = env.DB_SSL === 'true' ? {
        rejectUnauthorized: true,
        minVersion: 'TLSv1.2',
        ...(env.DB_SSL_CA_PATH ? { ca: fs.readFileSync(env.DB_SSL_CA_PATH, 'utf8') } : {})
    } : undefined;

    return {
        host: env.HOST || '0.0.0.0',
        port: env.PORT || 3000,
        fuso,
        banco: {
            host: env.MYSQLHOST || env.DB_HOST || 'localhost',
            port: Number(env.MYSQLPORT || env.DB_PORT || 3306),
            user: env.MYSQLUSER || env.DB_USER || 'root',
            password: env.MYSQLPASSWORD || env.DB_PASSWORD || '',
            database: env.MYSQLDATABASE || env.DB_NAME || 'loja_variedades',
            timezone: fuso,
            ...(ssl ? { ssl } : {}),
            waitForConnections: true,
            connectionLimit: 10,
            queueLimit: 0
        }
    };
}

module.exports = { configuracao };