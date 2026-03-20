import test from 'node:test';
import assert from 'node:assert/strict';
import { LanhuClient } from '../dist/services/lanhu-client.js';

function createJsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
    },
  });
}

test('LanhuClient.getImageInfo resolves missing team_id from user settings', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];

  globalThis.fetch = async (url, init = {}) => {
    const href = String(url);
    calls.push({ href, init });

    if (href.includes('/api/account/user_settings?settings_type=web_main')) {
      return createJsonResponse({
        code: '00000',
        msg: 'success',
        result: JSON.stringify({
          teamStatus: {
            team_id: 'team-from-settings',
          },
        }),
      });
    }

    if (href.includes('/api/project/image?')) {
      assert.match(href, /team_id=team-from-settings/);

      return createJsonResponse({
        code: '00000',
        result: {
          id: 'image-1',
          name: 'Example',
          url: 'https://example.com/reference.png',
          latest_version: 'version-1',
          versions: [
            {
              id: 'version-1',
              type: 'image',
              height: 100,
              width: 200,
              create_time: 'Thu, 20 Mar 2026 10:00:00 UTC',
              version_info: '版本1',
              url: 'https://example.com/reference.png',
              json_url: 'https://example.com/design.json',
              d2c_url: null,
              version_layout_data: '{}',
              md5: null,
              updated: true,
              editor_info: {
                nickname: 'tester',
                avatar: 'https://example.com/avatar.png',
                color: 'orange',
              },
              comments: [],
            },
          ],
          batch: '0',
          category_cover: [],
          create_time: '2026-03-20T10:00:00Z',
          dds_jump_status: 4,
          group: [],
          height: 100,
          home: false,
          is_replaced: false,
          last_version_num: 1,
          lat: [],
          layout_data: '{}',
          order: 0,
          pinyinname: 'example',
          position_x: 0,
          position_y: 0,
          positions: [],
          pre: [],
          share_id: 'image-1',
          sketch_id: 'sketch-1',
          source: false,
          text_scale: null,
          trash_recovery: false,
          type: 'image',
          update_time: '2026-03-20T10:00:00Z',
          user_id: 'user-1',
          user_in_project: true,
          width: 200,
        },
      });
    }

    throw new Error(`Unexpected fetch URL: ${href}`);
  };

  try {
    const client = new LanhuClient('cookie=value');
    const result = await client.getImageInfo({
      projectId: 'project-1',
      imageId: 'image-1',
    });

    assert.equal(result.id, 'image-1');
    assert.equal(calls.length, 2);
    assert.match(calls[0].href, /\/api\/account\/user_settings\?settings_type=web_main$/);
    assert.match(calls[1].href, /\/api\/project\/image\?/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('LanhuClient.getImageInfo uses provided team_id directly', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];

  globalThis.fetch = async (url) => {
    const href = String(url);
    calls.push(href);

    if (href.includes('/api/account/user_settings?settings_type=web_main')) {
      throw new Error('user_settings should not be requested when teamId is present');
    }

    if (href.includes('/api/project/image?')) {
      assert.match(href, /team_id=team-explicit/);

      return createJsonResponse({
        code: '00000',
        result: {
          id: 'image-2',
          name: 'Example 2',
          url: 'https://example.com/reference-2.png',
          latest_version: 'version-2',
          versions: [],
          batch: '0',
          category_cover: [],
          create_time: '2026-03-20T10:00:00Z',
          dds_jump_status: 4,
          group: [],
          height: 100,
          home: false,
          is_replaced: false,
          last_version_num: 0,
          lat: [],
          layout_data: '{}',
          order: 0,
          pinyinname: 'example2',
          position_x: 0,
          position_y: 0,
          positions: [],
          pre: [],
          share_id: 'image-2',
          sketch_id: 'sketch-2',
          source: false,
          text_scale: null,
          trash_recovery: false,
          type: 'image',
          update_time: '2026-03-20T10:00:00Z',
          user_id: 'user-1',
          user_in_project: true,
          width: 200,
        },
      });
    }

    throw new Error(`Unexpected fetch URL: ${href}`);
  };

  try {
    const client = new LanhuClient('cookie=value');
    const result = await client.getImageInfo({
      teamId: 'team-explicit',
      projectId: 'project-2',
      imageId: 'image-2',
    });

    assert.equal(result.id, 'image-2');
    assert.equal(calls.length, 1);
    assert.match(calls[0], /\/api\/project\/image\?/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
