const test = require('node:test');
const assert = require('node:assert/strict');
const { configuracao } = require('../utils/configuracao');
const azure = { DEPLOY_TARGET: 'azure', DB_HOST: 'exemplo.mysql.database.azure.com', DB_USER: 'pdv',
    DB_PASSWORD: 'somente-teste', DB_NAME: 'pdv_demo', JWT_SECRET: 'x'.repeat(48), DB_SSL: 'true' };
test('execução local permanece restrita a localhost e sem alterar fuso', () => {
    const config = configuracao({});
    assert.equal(config.host, '127.0.0.1');
    assert.equal(config.fuso, 'local');
    assert.equal(config.banco.ssl, undefined);
});
test('Azure escuta a porta fornecida e exige TLS com validação', () => {
    const config = configuracao({ ...azure, PORT: '8080' });
    assert.equal(config.host, '0.0.0.0');
    assert.equal(config.port, '8080');
    assert.equal(config.banco.ssl.rejectUnauthorized, true);
    assert.equal(config.banco.ssl.minVersion, 'TLSv1.2');
    assert.equal(config.fuso, '-03:00');
    assert.equal(config.banco.timezone, '-03:00');
});
test('Azure recusa segredo curto, senha ausente e conexão sem TLS', () => {
    for (const alteracao of [{ JWT_SECRET: 'curta' }, { DB_PASSWORD: '' }, { DB_SSL: 'false' }]) {
        assert.throws(() => configuracao({ ...azure, ...alteracao }));
    }
});
test('Azure não grava backups no disco local do App Service', () => {
    assert.throws(() => configuracao({ ...azure, BACKUP_DIR: '/home/backups' }));
});
test('fuso inválido é recusado antes de criar conexões', () => {
    assert.throws(() => configuracao({ DB_TIMEZONE: 'abc' }));
});
