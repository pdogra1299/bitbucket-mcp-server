#!/usr/bin/env node
import { loadConfig } from './config/index.js';
import { BitbucketMcpServer } from './server.js';
import { tlsAgentOptions } from './core/api-client.js';

// Entry point: load config (all policy lives there), validate credentials,
// start the server. Everything else is wired inside BitbucketMcpServer.

const config = loadConfig();

if (!config.auth.username || (!config.auth.appPassword && !config.auth.token && !config.tls.clientCertPath)) {
  console.error(
    'Error: BITBUCKET_USERNAME and one of BITBUCKET_APP_PASSWORD (Cloud), BITBUCKET_TOKEN (Server/DC), ' +
      'or BITBUCKET_TLS_CLIENT_CERT + BITBUCKET_TLS_CLIENT_KEY (mTLS Server/DC) are required.'
  );
  process.exit(1);
}

try {
  tlsAgentOptions(config.tls);
} catch (error: any) {
  console.error(`Error: ${error.message}`);
  process.exit(1);
}

new BitbucketMcpServer(config).run().catch(error => {
  console.error('Fatal:', error);
  process.exit(1);
});
