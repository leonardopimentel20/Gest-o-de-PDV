const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const raiz = path.resolve(__dirname, '..');
const estado = { configurado: false, executando: false, ultimoSucesso: null, erro: null };

function dentro(pasta, pai) {
    const relativo = path.relative(pai, pasta);
    return relativo === '' || (!relativo.startsWith('..' + path.sep) && relativo !== '..' && !path.isAbsolute(relativo));
}
function validarDestino(destino, pastaDados) {
    if (!destino || !path.isAbsolute(destino)) throw new Error('Configure BACKUP_DIR com uma pasta absoluta fora da aplicação.');
    const absoluto = path.resolve(destino);
    if (dentro(absoluto, raiz) || (pastaDados && dentro(absoluto, path.resolve(pastaDados)))) {
        throw new Error('A pasta de backup deve ficar fora da aplicação e dos arquivos do banco.');
    }
    return absoluto;
}
async function localizarDump() {
    if (process.env.BACKUP_DUMP_EXE) {
        if (!path.isAbsolute(process.env.BACKUP_DUMP_EXE)) throw new Error('BACKUP_DUMP_EXE deve ser um caminho absoluto.');
        await fs.access(process.env.BACKUP_DUMP_EXE);
        return process.env.BACKUP_DUMP_EXE;
    }
    // A instalação pode ficar em outra unidade: nesse caso configure BACKUP_DUMP_EXE.
    for (const base of [process.env.ProgramFiles, process.env['ProgramFiles(x86)']].filter(Boolean)) {
        const pastas = await fs.readdir(base, { withFileTypes: true }).catch(() => []);
        for (const pasta of pastas.filter(p => p.isDirectory() && /^MariaDB/i.test(p.name))) {
            const exe = path.join(base, pasta.name, 'bin', 'mariadb-dump.exe');
            if (await fs.access(exe).then(() => true, () => false)) return exe;
        }
    }
    throw new Error('Informe o caminho de mariadb-dump.exe ou mysqldump.exe em BACKUP_DUMP_EXE.');
}
function executarDump(exe, args, senha) {
    return new Promise((resolve, reject) => {
        // A senha não aparece na linha de comando nem nos logs.
        const child = spawn(exe, args, { windowsHide: true, shell: false,
            env: { ...process.env, MYSQL_PWD: senha }, stdio: ['ignore', 'ignore', 'pipe'] });
        let diagnostico = '';
        child.stderr.on('data', chunk => { diagnostico = (diagnostico + chunk.toString()).slice(-3000); });
        const timer = setTimeout(() => child.kill(), 10 * 60 * 1000);
        child.once('error', () => { clearTimeout(timer); reject(new Error('Não foi possível iniciar o utilitário de backup.')); });
        child.once('close', code => {
            clearTimeout(timer);
            if (code === 0) resolve();
            else {
                const detalhe = senha ? diagnostico.split(senha).join('[senha omitida]') : diagnostico;
                reject(new Error('Backup não concluído. ' + detalhe.trim()));
            }
        });
    });
}
async function fazerBackup(db) {
    if (estado.executando) throw new Error('Já existe um backup em andamento.');
    estado.executando = true;
    let temporario;
    try {
        const [config] = await db.query('SELECT @@datadir AS pasta_dados');
        const destino = validarDestino(process.env.BACKUP_DIR, config[0].pasta_dados);
        const [engines] = await db.query("SELECT ENGINE FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_TYPE='BASE TABLE'");
        if (!engines.length || engines.some(t => t.ENGINE !== 'InnoDB')) throw new Error('O backup automático exige tabelas InnoDB; solicite revisão da estrutura do banco.');
        const exe = await localizarDump();
        await fs.mkdir(destino, { recursive: true });
        // Resolve links/junções para não gravar acidentalmente dentro da aplicação/banco.
        validarDestino(await fs.realpath(destino), config[0].pasta_dados);
        const nome = 'pdv-' + new Date().toISOString().replace(/[:.]/g, '-') + '-' + crypto.randomBytes(4).toString('hex') + '.sql';
        const final = path.join(destino, nome);
        temporario = final + '.partial';
        const args = ['--no-defaults', '--protocol=tcp', '--host=' + (process.env.DB_HOST || 'localhost'),
            '--port=' + (process.env.DB_PORT || '3306'), '--user=' + (process.env.DB_USER || 'root'),
            '--single-transaction', '--quick', '--routines', '--events', '--triggers', '--hex-blob',
            '--default-character-set=utf8mb4', '--result-file=' + temporario,
            '--databases', process.env.DB_NAME || 'loja_variedades'];
        // O PDV local usa conexão sem TLS. MariaDB recente tenta TLS por padrão.
        if (/^(localhost|127\.0\.0\.1|::1)$/i.test(process.env.DB_HOST || 'localhost')) {
            args.splice(1, 0, /mariadb/i.test(exe) ? '--skip-ssl' : '--ssl-mode=DISABLED');
        }
        await executarDump(exe, args, process.env.DB_PASSWORD || '');
        if ((await fs.stat(temporario)).size === 0) throw new Error('O arquivo de backup ficou vazio.');
        const arquivo = await fs.open(temporario, 'r+');
        try { await arquivo.sync(); } finally { await arquivo.close(); }
        await fs.rename(temporario, final);
        temporario = null;
        estado.ultimoSucesso = new Date().toISOString();
        estado.erro = null;
        console.log('Backup do PDV concluído em ' + estado.ultimoSucesso);
        return final;
    } catch (erro) {
        estado.erro = erro.message;
        throw erro;
    } finally {
        if (temporario) await fs.unlink(temporario).catch(() => {});
        estado.executando = false;
    }
}
function iniciarBackups(db) {
    estado.configurado = Boolean(process.env.BACKUP_DIR);
    if (!estado.configurado) return;
    const minutos = Number(process.env.BACKUP_INTERVAL_MINUTES || 30);
    if (!Number.isInteger(minutos) || minutos < 5 || minutos > 1440) {
        estado.erro = 'BACKUP_INTERVAL_MINUTES deve ser um inteiro entre 5 e 1440.';
        return;
    }
    const executar = () => {
        if (!estado.executando) fazerBackup(db).catch(e => console.error('Backup: ' + e.message));
    };
    executar();
    const timer = setInterval(executar, minutos * 60 * 1000);
    timer.unref();
}
module.exports = { fazerBackup, iniciarBackups, estado, validarDestino };
