// Bitbucket Cloud user resolution for reviewer lists.
//
// Cloud dropped `username` as a user identifier: a reviewer sent as
// `{ username }` is rejected with "reviewers: Malformed reviewers list".
// It only accepts `{ uuid }` or `{ account_id }`, so every reviewer is resolved
// against the workspace members and sent as `{ uuid }`. Cloud does not expose
// member e-mails, so an e-mail cannot be resolved here.

export interface CloudMember {
  nickname?: string;
  display_name?: string;
  account_id?: string;
  uuid: string;
}

export class CloudUserResolutionError extends Error {}

const BRACED_UUID = /^\{[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\}$/i;

export function isCloudUuid(identifier: string): boolean {
  return BRACED_UUID.test(identifier);
}

function describe(member: CloudMember): string {
  return `${member.nickname ?? member.display_name ?? '?'} (${member.uuid})`;
}

// Resolution order is strongest identifier first: account_id and uuid are
// unique, then nickname, and display_name last because it is not unique.
function findMember(identifier: string, members: CloudMember[]): CloudMember {
  const lower = identifier.toLowerCase();
  const bareUuid = `{${lower}}`;
  const exact = members.find(
    (m) => m.account_id === identifier || m.uuid.toLowerCase() === lower || m.uuid.toLowerCase() === bareUuid
  );
  if (exact) return exact;

  const byNickname = members.filter((m) => m.nickname?.toLowerCase() === lower);
  if (byNickname.length === 1) return byNickname[0];

  const candidates = byNickname.length > 1 ? byNickname : members.filter((m) => m.display_name?.toLowerCase() === lower);
  if (candidates.length === 1) return candidates[0];
  if (candidates.length > 1) {
    throw new CloudUserResolutionError(
      `Reviewer "${identifier}" is ambiguous; pass a nickname, account_id or uuid instead. ` +
        `Candidates: ${candidates.map(describe).join(', ')}.`
    );
  }
  throw new CloudUserResolutionError(
    `Reviewer "${identifier}" is not a member of this workspace. ` +
      'Pass a nickname, display name, account_id or {uuid}; Bitbucket Cloud does not expose e-mail addresses, so an e-mail cannot be resolved.'
  );
}

/**
 * Turns reviewer identifiers into the `{ uuid }` objects Cloud accepts.
 * Every identifier is resolved before anything is returned, so an unknown one
 * fails the whole call instead of creating a PR with a partial reviewer list.
 */
export function resolveCloudReviewers(identifiers: string[], members: CloudMember[]): { uuid: string }[] {
  const uuids = new Set<string>();
  for (const identifier of identifiers) {
    const uuid = isCloudUuid(identifier) ? identifier : findMember(identifier, members).uuid;
    uuids.add(uuid.toLowerCase());
  }
  return [...uuids].map((uuid) => ({ uuid }));
}
