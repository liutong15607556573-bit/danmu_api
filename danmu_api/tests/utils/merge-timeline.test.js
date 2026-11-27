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

test('alignSourceTimelines does not extrapolate before unique anchor coverage with repeated comments', () => {
  const reference = [
    { m: '哈哈', t: 10 },
    { m: '嘉宾登场', t: 80 },
    { m: '哈哈', t: 160 },
    { m: '第一轮开始', t: 220 },
  ];
  const shifted = [
    { m: '哈哈', t: 40 },
    { m: '嘉宾登场', t: 110 },
    { m: '哈哈', t: 190 },
    { m: '第一轮开始', t: 250 },
  ];

  alignSourceTimelines([reference, shifted], ['iqiyi', 'youku'], ['a', 'b']);

  // The first comment is before the unique-anchor coverage (110s), so it must remain unchanged.
  assert.deepEqual(shifted.map(item => item.t), [40, 80, 160, 220]);
});

test('alignSourceTimelines does not calibrate from a single repeated phrase', () => {
  const reference = [{ m: '哈哈', t: 10 }, { m: '哈哈', t: 80 }, { m: '哈哈', t: 160 }];
  const shifted = [{ m: '哈哈', t: 40 }, { m: '哈哈', t: 110 }, { m: '哈哈', t: 190 }];
  const before = structuredClone(shifted);

  alignSourceTimelines([reference, shifted], ['iqiyi', 'youku'], ['a', 'b']);

  assert.deepEqual(shifted, before);
});

test('alignSourceTimelines skips calibration when unique text anchors disagree on the offset', () => {
  const reference = [
    { m: '唯一锚点甲', t: 10 },
    { m: '唯一锚点乙', t: 100 },
    { m: '唯一锚点丙', t: 200 },
  ];
  const shifted = [
    { m: '唯一锚点甲', t: 40 },
    { m: '唯一锚点乙', t: 130 },
    { m: '唯一锚点丙', t: 280 },
  ];
  const before = structuredClone(shifted);

  alignSourceTimelines([reference, shifted], ['iqiyi', 'youku'], ['a', 'b']);

  assert.deepEqual(shifted, before);
});


test('alignSourceTimelines uses separate offsets before and after an edit point', () => {
  const reference = [
    { m: '片段一锚点甲', t: 10 },
    { m: '片段一锚点乙', t: 80 },
    { m: '片段二锚点甲', t: 160 },
    { m: '片段二锚点乙', t: 220 },
    { m: '片段二锚点丙', t: 300 },
    { m: '片段二锚点丁', t: 360 },
    { m: '参照源独有弹幕甲', t: 400 },
    { m: '参照源独有弹幕乙', t: 430 },
  ];
  const edited = [
    { m: '片段一锚点甲', t: 40 },
    { m: '片段一锚点乙', t: 110 },
    { m: '片段二锚点甲', t: 220 },
    { m: '片段二锚点乙', t: 280 },
    { m: '片段二锚点丙', t: 360 },
    { m: '片段二锚点丁', t: 420 },
    { m: '剪辑点前弹幕', t: 150 },
    { m: '剪辑点后弹幕', t: 240 },
  ];

  alignSourceTimelines([reference, edited], ['iqiyi', 'youku'], ['a', 'b']);

  assert.deepEqual(edited.map(item => item.t), [10, 80, 160, 220, 300, 360, 150, 180]);
});

test('alignSourceTimelines refuses to calibrate when matching anchors reverse their order', () => {
  const reference = [
    { m: '顺序锚点甲', t: 10 },
    { m: '顺序锚点乙', t: 80 },
    { m: '顺序锚点丙', t: 160 },
  ];
  const reordered = [
    { m: '顺序锚点甲', t: 40 },
    { m: '顺序锚点乙', t: 180 },
    { m: '顺序锚点丙', t: 100 },
  ];
  const before = structuredClone(reordered);

  alignSourceTimelines([reference, reordered], ['iqiyi', 'youku'], ['a', 'b']);

  assert.deepEqual(reordered, before);
});


test('alignSourceTimelines keeps p, t and progress timestamps synchronized', () => {
  const reference = [
    { m: '时间格式锚点甲', p: '10,1,25,16777215', t: 10 },
    { m: '时间格式锚点乙', p: '80,1,25,16777215', t: 80 },
    { m: '参照源独有内容甲', p: '120,1,25,16777215', t: 120 },
  ];
  const shifted = [
    { m: '时间格式锚点甲', p: '40,1,25,16777215', t: 40, progress: 40000 },
    { m: '时间格式锚点乙', p: '110,1,25,16777215', t: 110, progress: 110000 },
    { m: '需要同步更新的弹幕', p: '100,1,25,16777215', t: 100, progress: 100000 },
  ];

  alignSourceTimelines([reference, shifted], ['iqiyi', 'youku'], ['a', 'b']);

  assert.deepEqual(shifted.map(item => item.p.split(',')[0]), ['10.00', '80.00', '70.00']);
  assert.deepEqual(shifted.map(item => item.t), [10, 80, 70]);
  assert.deepEqual(shifted.map(item => item.progress), [10000, 80000, 70000]);
});

test('alignSourceTimelines does not extrapolate a constant offset beyond anchor coverage', () => {
  const reference = [
    { m: '固定偏移锚点甲', t: 10 },
    { m: '固定偏移锚点乙', t: 80 },
    { m: '参照源独有弹幕', t: 120 },
  ];
  const shifted = [
    { m: '固定偏移锚点甲', t: 40 },
    { m: '固定偏移锚点乙', t: 110 },
    { m: '锚点覆盖内', t: 100 },
    { m: '锚点覆盖前', t: 5 },
    { m: '锚点覆盖后', t: 150 },
  ];

  alignSourceTimelines([reference, shifted], ['iqiyi', 'youku'], ['a', 'b']);

  // The longer shifted list is selected as the reference; align only sourceA's
  // unique-anchor coverage and do not extrapolate its third, out-of-range comment.
  assert.deepEqual(reference.map(item => item.t), [40, 110, 120]);
  assert.deepEqual(shifted.map(item => item.t), [40, 110, 100, 5, 150]);
});

test('alignSourceTimelines does not extrapolate piecewise offsets beyond anchor coverage', () => {
  const reference = [
    { m: '覆盖内锚点甲', t: 10 },
    { m: '覆盖内锚点乙', t: 80 },
    { m: '覆盖内锚点丙', t: 160 },
    { m: '覆盖内锚点丁', t: 220 },
    { m: '覆盖内锚点戊', t: 300 },
    { m: '覆盖内锚点己', t: 360 },
    { m: '参照源独有内容甲', t: 400 },
    { m: '参照源独有内容乙', t: 430 },
  ];
  const edited = [
    { m: '覆盖内锚点甲', t: 40 },
    { m: '覆盖内锚点乙', t: 110 },
    { m: '覆盖内锚点丙', t: 220 },
    { m: '覆盖内锚点丁', t: 280 },
    { m: '覆盖内锚点戊', t: 360 },
    { m: '覆盖内锚点己', t: 420 },
    { m: '锚点范围之前', t: 5 },
    { m: '锚点范围之后', t: 500 },
  ];

  alignSourceTimelines([reference, edited], ['iqiyi', 'youku'], ['a', 'b']);

  assert.equal(edited[6].t, 5);
  assert.equal(edited[7].t, 500);
});
