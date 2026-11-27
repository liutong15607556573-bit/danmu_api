import test from 'node:test';
import assert from 'node:assert/strict';
import { alignSourceTimelines } from '../../utils/merge-util.js';

test('alignSourceTimelines aligns sources without requiring dandan as the reference', () => {
  const sourceA = [
    { m: '开场介绍', t: 10 },
    { m: '嘉宾登场', t: 80 },
    { m: '第一轮开始', t: 160 },
  ];
  const sourceB = [
    { m: '开场介绍', t: 130 },
    { m: '嘉宾登场', t: 200 },
    { m: '第一轮开始', t: 280 },
    { m: '额外弹幕', t: 310 },
  ];

  const results = [sourceA, sourceB];
  alignSourceTimelines(results, ['iqiyi', 'youku'], ['iqiyi-1', 'youku-1']);

  assert.deepEqual(sourceA.map(item => item.t), [130, 200, 280]);
  assert.deepEqual(sourceB.map(item => item.t), [130, 200, 280, 310]);
});

test('alignSourceTimelines leaves sources unchanged when shared evidence is insufficient', () => {
  const sourceA = [{ m: '完全不同的评论甲', t: 10 }, { m: '完全不同的评论乙', t: 20 }];
  const sourceB = [{ m: '另一组评论甲', t: 100 }, { m: '另一组评论乙', t: 200 }];
  const before = structuredClone([sourceA, sourceB]);

  alignSourceTimelines([sourceA, sourceB], ['iqiyi', 'tencent'], ['a', 'b']);

  assert.deepEqual([sourceA, sourceB], before);
});
