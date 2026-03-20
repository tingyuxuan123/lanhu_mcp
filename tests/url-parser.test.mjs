import test from 'node:test';
import assert from 'node:assert/strict';
import { buildApiUrl, parseLanhuUrl } from '../dist/utils/url-parser.js';

test('parseLanhuUrl accepts detail page URLs without tid and buildApiUrl omits team_id', () => {
  const parsed = parseLanhuUrl(
    'https://lanhuapp.com/web/#/item/project/detailDetach?project_id=project-123&image_id=image-456&fromEditor=true',
  );

  assert.deepEqual(parsed, {
    teamId: undefined,
    projectId: 'project-123',
    imageId: 'image-456',
  });

  const apiUrl = buildApiUrl(parsed);
  const url = new URL(apiUrl);

  assert.equal(url.origin, 'https://lanhuapp.com');
  assert.equal(url.pathname, '/api/project/image');
  assert.equal(url.searchParams.get('image_id'), 'image-456');
  assert.equal(url.searchParams.get('project_id'), 'project-123');
  assert.equal(url.searchParams.has('team_id'), false);
});

test('parseLanhuUrl keeps explicit team identifiers and buildApiUrl forwards them', () => {
  const parsed = parseLanhuUrl(
    'https://lanhuapp.com/web/#/item/project/detailDetach?pid=project-789&image_id=image-999&tid=team-321',
  );

  assert.deepEqual(parsed, {
    teamId: 'team-321',
    projectId: 'project-789',
    imageId: 'image-999',
  });

  const apiUrl = buildApiUrl(parsed);
  const url = new URL(apiUrl);

  assert.equal(url.searchParams.get('team_id'), 'team-321');
});
