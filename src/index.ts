#!/usr/bin/env node
import { loadEnvFilesFromArgv } from './cli/env-file.js';
import { loadConfig } from './config/index.js';
import { BitbucketMcpServer } from './server.js';

// Entry point: optional `--env-file` -> load config (all policy lives there),
// validate credentials, start the server. Everything else is wired inside
// BitbucketMcpServer.

try {
  loadEnvFilesFromArgv();
} catch (error) {
  console.error(`Error: ${error instanceof Error ? error.message : error}`);
  process.exit(1);
}

const config = loadConfig();

if (!config.auth.username || (!config.auth.appPassword && !config.auth.token)) {
  console.error(
    'Error: BITBUCKET_USERNAME and either BITBUCKET_APP_PASSWORD (Cloud) or BITBUCKET_TOKEN (Server/DC) are required.'
  );
  process.exit(1);
}

new BitbucketMcpServer(config).run().catch(error => {
  console.error('Fatal:', error);
  process.exit(1);
});
