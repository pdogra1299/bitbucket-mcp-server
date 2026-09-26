#!/usr/bin/env node

// Validates a commit message against Conventional Commits: type(scope)!: description
//
// One rule set, two callers — so the local hook and CI can never disagree:
//   .husky/commit-msg                     node scripts/validate-commit-msg.js <msg-file>
//   .github/workflows/commit-policy.yml   node scripts/validate-commit-msg.js --strict <msg-file>
//
// semantic-release reads these messages on main to pick the next version:
// fix/refactor → patch, feat → minor, `!` or a BREAKING CHANGE footer → major.
//
// --strict (CI) rejects git's own "Merge …" / "fixup! …" subjects, which are
// allowed locally so pulls and autosquash rebases keep working.

import { readFileSync } from 'fs';

const TYPES = [
  'feat', // new feature                → minor
  'fix', // bug fix                     → patch
  'refactor', // restructure, no behavior change → patch
  'perf', // performance improvement
  'docs', // documentation only
  'test', // tests only
  'build', // build system / packaging
  'ci', // CI/CD workflows
  'chore', // maintenance
  'deps', // dependency updates
  'security', // security hardening
  'style', // formatting only
  'revert', // revert a previous commit
];

// A scope outside this list is a warning, never an error.
const SCOPES = [
  'config', 'core', 'formatting', 'handlers', 'tools', 'types', 'tests',
  'grep', 'search', 'pr', 'diff', 'files', 'branches', 'commits', 'attachments',
  'ci', 'deps', 'docs', 'release',
];

const MAX_HEADER = 100;
const GIT_GENERATED = /^(Merge |fixup! |squash! |amend! )/;
const HEADER = /^(?<type>[a-z]+)(?:\((?<scope>[^()\s][^()]*)\))?(?<breaking>!)?: (?<description>.+)$/;

function validate(message, { strict = false } = {}) {
  const errors = [];
  const warnings = [];
  const header = message
    .split('\n')
    .filter(line => !line.startsWith('#'))
    .join('\n')
    .trim()
    .split('\n')[0] ?? '';

  if (!header) return { header, errors: ['Commit message is empty'], warnings };
  if (!strict && GIT_GENERATED.test(header)) return { header, errors, warnings };

  const match = HEADER.exec(header);
  if (!match) {
    errors.push('Header does not match "type(scope): description" (scope and "!" are optional)');
    return { header, errors, warnings };
  }

  const { type, scope, description } = match.groups;
  if (!TYPES.includes(type)) errors.push(`Unknown type "${type}". Valid types: ${TYPES.join(', ')}`);
  if (description.trim().length < 3) errors.push('Description must be at least 3 characters');
  if (header.length > MAX_HEADER) errors.push(`Header is ${header.length} characters; keep it within ${MAX_HEADER}`);

  if (scope && !SCOPES.includes(scope)) warnings.push(`Uncommon scope "${scope}". Common scopes: ${SCOPES.join(', ')}`);
  if (/^[A-Z]/.test(description)) warnings.push('Description should start with a lowercase letter');
  if (description.endsWith('.')) warnings.push('Description should not end with a period');

  return { header, errors, warnings };
}

const args = process.argv.slice(2);
const strict = args.includes('--strict');
const file = args.find(a => a !== '--strict');
if (!file) {
  console.error('usage: validate-commit-msg.js [--strict] <commit-msg-file>');
  process.exit(2);
}

const { header, errors, warnings } = validate(readFileSync(file, 'utf8'), { strict });
for (const w of warnings) console.warn(`⚠️  ${w}`);
if (errors.length) {
  console.error(`❌ Invalid commit message: "${header}"`);
  for (const e of errors) console.error(`   - ${e}`);
  console.error(`
Expected: type(scope): description
Examples:
  feat(grep): add multiline regex support
  fix(pr): keep version on 409 retry
  feat(tools)!: rename get_file_content window params   (breaking → major)
  docs: document rate-limit exemption`);
  process.exit(1);
}
console.log(`✅ Commit message OK: "${header}"`);
