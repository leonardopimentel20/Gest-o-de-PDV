const db = require('../db');
const { fazerBackup } = require('../utils/backup');
fazerBackup(db).catch(error => {
    console.error(error.message);
    process.exitCode = 1;
}).finally(() => db.end());
