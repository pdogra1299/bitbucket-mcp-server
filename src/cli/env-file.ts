import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import dotenv from 'dotenv';

// Application-level `--env-file` support so MCP clients can pass credentials
// via args (e.g. `npx ... --env-file /path/to/.env`) without relying on Node's
// built-in flag (Node ≥20.6) or embedding secrets in mcpServers.env.

type Env = Record<string, string | undefined>;

/**
 * Collect `--env-file` / `--env-file=path` values from argv.
 * Supports multiple flags; returns paths in appearance order.
 */
export function collectEnvFilePaths(argv: string[]): string[] {
  const paths: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--env-file') {
      const next = argv[i + 1];
      if (!next || next.startsWith('-')) {
        throw new Error('Missing path after --env-file');
      }
      paths.push(next);
      i++;
      continue;
    }
    if (arg.startsWith('--env-file=')) {
      const path = arg.slice('--env-file='.length);
      if (!path) throw new Error('Missing path after --env-file=');
      paths.push(path);
    }
  }
  return paths;
}

/**
 * Apply env-file values into `env` via dotenv.
 * Keys already present are never overwritten. Multiple files: later files
 * override earlier file values for unprotected keys (paths are reversed so
 * dotenv's first-wins semantics match that).
 */
export function applyEnvFiles(paths: string[], env: Env = process.env, cwd: string = process.cwd()): void {
  const resolved: string[] = [];
  for (const p of paths) {
    const abs = resolve(cwd, p);
    if (!existsSync(abs)) {
      throw new Error(`Env file not found: ${p}`);
    }
    resolved.push(abs);
  }

  // dotenv without `override`: first value wins (including keys already in env).
  // Reverse so the last --env-file takes precedence among files.
  const result = dotenv.config({
    path: [...resolved].reverse(),
    processEnv: env as dotenv.DotenvPopulateInput,
    quiet: true,
  });
  if (result.error) {
    throw result.error;
  }
}

/** Parse argv for `--env-file` and load into `env`. No-op when flag absent. */
export function loadEnvFilesFromArgv(
  argv: string[] = process.argv.slice(2),
  env: Env = process.env,
  cwd: string = process.cwd()
): string[] {
  const paths = collectEnvFilePaths(argv);
  if (paths.length > 0) applyEnvFiles(paths, env, cwd);
  return paths;
}
