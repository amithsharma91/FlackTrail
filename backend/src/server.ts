import app, { initializeApp } from './index';
import { config, validateConfig } from './config/env';
import { closeDatabase } from './persistence/database';

async function startServer(): Promise<void> {
  const errors = validateConfig();
  if (errors.length > 0) {
    throw new Error('Configuration validation failed:\n' + errors.map((error) => '- ' + error).join('\n'));
  }
  await initializeApp();
  const server = app.listen(config.port, '0.0.0.0', () => {
    console.log('FlackTrail API listening on port ' + config.port);
  });
  const shutdown = (): void => {
    server.close(() => closeDatabase());
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}
startServer().catch((error: unknown) => {
  console.error('FlackTrail startup failed:', error);
  closeDatabase();
  process.exitCode = 1;
});