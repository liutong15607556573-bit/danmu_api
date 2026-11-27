import test from 'node:test';
import assert from 'node:assert/strict';
import { Globals } from '../../configs/globals.js';

test('TMDB remains a fallback source while 4K precedes Aiyifan without overriding explicit source order', () => {
  const previousSourceOrder = process.env.SOURCE_ORDER;
  try {
    delete process.env.SOURCE_ORDER;
    Globals.init({});
    assert.deepEqual(
      Globals.envs.sourceOrderArr,
      ['iqiyi', 'tencent', 'youku', 'douban', '360', 'renren', 'hanjutv', 'acfun', 'tmdb', '4k', 'aiyifan'],
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
