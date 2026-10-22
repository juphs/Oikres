// npm run admin:create   create the first (or another) administrator
// npm run admin:reset    set a new password for an existing administrator
// These need access to the server's terminal and data folder, so visitors cannot use them.
const readline = require('readline');
const { open, cfg, db } = require('./boot');

function ask(question, hidden) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (hidden) rl._writeToOutput = (s) => { if (s.includes(question)) process.stdout.write(s); };
    rl.question(question, (a) => { rl.close(); if (hidden) process.stdout.write('\n'); resolve(a.trim()); });
  });
}

async function main() {
  const mode = process.argv[2];
  if (!['create', 'reset'].includes(mode)) throw new Error('Use: npm run admin:create   or   npm run admin:reset');
  if (!process.stdin.isTTY) throw new Error('Run this in a terminal so you can type the details.');
  open();
  const boot = require('../services/bootstrap');
  const users = require('../repositories/users');
  console.log('');
  if (mode === 'create') {
    if (users.adminExists()) console.log('  Note: an administrator already exists. This will add another one.\n');
    const name = (await ask('Name [' + cfg.admin.name + ']: ')) || cfg.admin.name;
    const email = (await ask('Email: ')).toLowerCase();
    const pw = await ask('Password (12+ characters): ', true);
    if (pw !== (await ask('Repeat the password: ', true))) throw new Error('The passwords did not match. Nothing was created.');
    await boot.createAdmin({ name, email, password: pw });
    console.log('\n  Administrator created: ' + email + '\n  Sign in at /login.\n');
  } else {
    const email = await ask('Administrator email: ');
    const pw = await ask('New password (12+ characters): ', true);
    if (pw !== (await ask('Repeat the new password: ', true))) throw new Error('The passwords did not match. Nothing was changed.');
    await boot.resetAdminPassword(email, pw);
    console.log('\n  Password changed. That administrator was signed out everywhere.\n');
  }
  db.close();
}
main().catch((err) => { console.error('\n  Stopped: ' + err.message + '\n'); process.exit(1); });
