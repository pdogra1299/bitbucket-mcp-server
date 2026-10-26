import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveCloudReviewers, isCloudUuid, CloudUserResolutionError } from '../core/cloud-users.js';

const members = [
  { nickname: 'sistemas', display_name: 'sistemas', account_id: '5d407ffc5e485d0dab01d907', uuid: '{d18f3086-f0ac-4a14-8fcc-904fc95a4879}' },
  { nickname: 'Pablo Miguez', display_name: 'Pablo Miguez', account_id: '712020:9d26b0dd-cd40-4f48-9f68-2e4817102f37', uuid: '{769e045c-f99e-4d3f-9551-c1a5c4065d01}' },
  { nickname: 'kevin', display_name: 'Kevin Toranzo', account_id: '6123b222db2b4e006afeafc5', uuid: '{2d41f37e-90ee-471c-8107-4d5b7b1e7be6}' },
  { nickname: 'ktoranzo', display_name: 'Kevin Toranzo', account_id: '6123b222db2b4e006afeaf00', uuid: '{00000000-90ee-471c-8107-4d5b7b1e7be6}' },
];

test('isCloudUuid: braced UUIDs only', () => {
  assert.equal(isCloudUuid('{d18f3086-f0ac-4a14-8fcc-904fc95a4879}'), true);
  assert.equal(isCloudUuid('d18f3086-f0ac-4a14-8fcc-904fc95a4879'), false);
  assert.equal(isCloudUuid('sistemas'), false);
});

test('resolveCloudReviewers: never sends username, which Cloud rejects as malformed', () => {
  const out = resolveCloudReviewers(['sistemas'], members);
  assert.deepEqual(out, [{ uuid: '{d18f3086-f0ac-4a14-8fcc-904fc95a4879}' }]);
  assert.ok(!('username' in out[0]));
});

test('resolveCloudReviewers: matches nickname and display name case-insensitively, account_id and bare uuid exactly', () => {
  assert.deepEqual(resolveCloudReviewers(['pablo miguez'], members), [{ uuid: '{769e045c-f99e-4d3f-9551-c1a5c4065d01}' }]);
  assert.deepEqual(resolveCloudReviewers(['KEVIN'], members), [{ uuid: '{2d41f37e-90ee-471c-8107-4d5b7b1e7be6}' }]);
  assert.deepEqual(resolveCloudReviewers(['712020:9d26b0dd-cd40-4f48-9f68-2e4817102f37'], members), [{ uuid: '{769e045c-f99e-4d3f-9551-c1a5c4065d01}' }]);
  assert.deepEqual(resolveCloudReviewers(['769e045c-f99e-4d3f-9551-c1a5c4065d01'], members), [{ uuid: '{769e045c-f99e-4d3f-9551-c1a5c4065d01}' }]);
});

test('resolveCloudReviewers: a braced uuid passes through without a member match', () => {
  assert.deepEqual(resolveCloudReviewers(['{aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee}'], []), [{ uuid: '{aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee}' }]);
});

test('resolveCloudReviewers: nickname wins over a shared display name, so it is not ambiguous', () => {
  assert.deepEqual(resolveCloudReviewers(['ktoranzo'], members), [{ uuid: '{00000000-90ee-471c-8107-4d5b7b1e7be6}' }]);
});

test('resolveCloudReviewers: an ambiguous display name names every candidate', () => {
  assert.throws(
    () => resolveCloudReviewers(['Kevin Toranzo'], members),
    (e: any) => e instanceof CloudUserResolutionError && /ambiguous/.test(e.message) && /kevin/.test(e.message) && /ktoranzo/.test(e.message)
  );
});

test('resolveCloudReviewers: an unknown identifier fails before any write and explains e-mails', () => {
  assert.throws(
    () => resolveCloudReviewers(['sistemas', 'nobody@example.com'], members),
    (e: any) => e instanceof CloudUserResolutionError && /nobody@example\.com/.test(e.message) && /e-mail/.test(e.message)
  );
});

test('resolveCloudReviewers: duplicates collapse to one reviewer', () => {
  assert.deepEqual(resolveCloudReviewers(['sistemas', 'SISTEMAS', '{d18f3086-f0ac-4a14-8fcc-904fc95a4879}'], members), [{ uuid: '{d18f3086-f0ac-4a14-8fcc-904fc95a4879}' }]);
});
