// Oikres entry point:  npm start
const major = Number(process.versions.node.split('.')[0]);
if (major < 24) {
  console.error('\nOikres needs Node.js 24 or newer (this is ' + process.versions.node + ').\n  Fix: nvm install 24   (or install Node 24 LTS from https://nodejs.org)\n');
  process.exit(1);
}

const { start } = require('./src/start');
const cfg = require('./src/config');

console.log('\nOikres ' + require('./package.json').version + ' (' + cfg.nodeEnv + ')');
start().then(({ close }) => {
  const shutdown = (signal) => { console.log('\n' + signal + ' received, shutting down...'); close().then(() => process.exit(0)); };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}).catch((err) => {
  console.error('\n' + (err.startup ? err.message : 'Oikres failed to start: ' + (err && err.message ? err.message : err)) + '\n');
  process.exit(1);
});
process.on('unhandledRejection', (err) => console.error('Unhandled error:', err && err.message ? err.message : err));
