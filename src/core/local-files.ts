import { realpath, stat } from 'node:fs/promises';
import { basename, resolve, sep } from 'node:path';
import type { ConfigAttachments, LocalFileResolution } from '../types/index.js';

// Attachment uploads read from the LOCAL filesystem of the host running this
// server, on behalf of an LLM-supplied path. Without a boundary that is an
// arbitrary-file exfiltration primitive (/proc/self/environ, SSH keys, k8s
// tokens → uploaded to a PR). Uploads are therefore OPT-IN: a root directory
// must be configured, the real path must resolve inside it, it must be a
// regular file, and it must fit the size cap. The rejection message is the
// same for every failure so the tool is not a filesystem existence oracle.

function sanitizeName(name: string): string {
  return name.replace(/[\u0000-\u001f\u007f"\\]/g, '_') || 'attachment';
}

export async function resolveAttachmentFile(cfg: ConfigAttachments, filePath: string): Promise<LocalFileResolution> {
  if (!cfg.uploadRoot) {
    return {
      ok: false,
      error:
        'Attachment uploads are disabled. Set BITBUCKET_ATTACHMENT_ROOT to the one directory files may be uploaded from.',
    };
  }
  let rootReal: string;
  try {
    rootReal = await realpath(cfg.uploadRoot);
    if (!(await stat(rootReal)).isDirectory()) throw new Error('not a directory');
  } catch {
    return { ok: false, error: 'BITBUCKET_ATTACHMENT_ROOT is not an accessible directory.' };
  }

  const maxBytes = cfg.maxUploadMb * 1024 * 1024;
  const generic = {
    ok: false as const,
    error:
      `Attachment rejected: file_path must be a regular file inside BITBUCKET_ATTACHMENT_ROOT (${rootReal}) ` +
      `no larger than ${cfg.maxUploadMb} MB.`,
  };

  if (typeof filePath !== 'string' || filePath.length === 0 || /[\u0000]/.test(filePath)) return generic;

  let real: string;
  try {
    real = await realpath(resolve(rootReal, filePath));
  } catch {
    return generic;
  }
  if (!real.startsWith(rootReal + sep)) return generic;

  try {
    const st = await stat(real);
    if (!st.isFile() || st.size > maxBytes) return generic;
    return { ok: true, file: { path: real, size: st.size, dev: st.dev, ino: st.ino, name: sanitizeName(basename(real)) } };
  } catch {
    return generic;
  }
}
