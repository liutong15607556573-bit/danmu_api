import test from 'node:test';
import assert from 'node:assert/strict';
import { Globals } from '../../configs/globals.js';

test('TMDB is the last fallback search source without overriding explicit source order', () => {
  const previousSourceOrder = process.env.SOURCE_ORDER;
  try {
    delete process.env.SOURCE_ORDER;
    Globals.init({});
    assert.deepEqual(
      Globals.envs.sourceOrderArr,
      ['douban', '360', 'renren', 'aiyifan', 'hanjutv', 'acfun', 'tmdb'],
      'TMDB should be appended after all existing default sources'
    );

    Globals.init({ SOURCE_ORDER: 'douban,360,renren,hanjutv,acfun' });
    assert.deepEqual(
      Globals.envs.sourceOrderArr,
      ['douban', '360', 'renren', 'hanjutv', 'acfun'],
      'an explicitly configured source order must remain unchanged'
    );
  } finally {
    if (previousSourceOrder === undefined) delete process.env.SOURCE_ORDER;
    else process.env.SOURCE_ORDER = previousSourceOrder;
    Globals.init({});
  }
});
