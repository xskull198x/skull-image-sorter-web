const test = require('node:test');
const assert = require('node:assert/strict');

const formatter = require('./png-info.js');

test('formats basic A1111 info without showing generation parameters', () => {
  const output = formatter.formatPngInfo('girl, blonde hair, blue eyes\nNegative prompt: low quality, bad hands\nSteps: 30, Sampler: Euler a, Model: TestModel');

  assert.match(output, /Model: TestModel/);
  assert.match(output, /Hair:\nblonde hair/);
  assert.match(output, /Eyes:\nblue eyes/);
  assert.match(output, /Negative Prompt:\nlow quality, bad hands/);
  assert.doesNotMatch(output, /Steps:/);
  assert.doesNotMatch(output, /Sampler:/);
});

test('detects and formats couple mode', () => {
  const output = formatter.formatPngInfo('girl one, blonde hair|girl two, black hair|bedroom, dim lighting\nNegative prompt: bad hands\nModel: CoupleModel');

  assert.match(output, /Couple Mode/);
  assert.match(output, /Character Slot 1:/);
  assert.match(output, /Character Slot 2:/);
  assert.match(output, /Global:/);
});

test('treats everything after the final pipe as global', () => {
  const split = formatter.splitCouplePrompt('slot1|slot2|global text');

  assert.deepEqual(split.slots, ['slot1', 'slot2']);
  assert.equal(split.global, 'global text');
});

test('does not split protected commas', () => {
  const tags = formatter.splitTags('(tag one, tag two:1.2), <lora:test:0.8>, blonde hair');

  assert.deepEqual(tags, ['(tag one, tag two:1.2)', '<lora:test:0.8>', 'blonde hair']);
});

test('hides extension metadata in simplified display', () => {
  const output = formatter.formatPngInfo('girl\nNegative prompt: bad\nSoft Regional: enabled, Soft Regional Version: v8.30, ADetailer model: face_yolov8n.pt, Lora hashes: "test: abc123", Version: webui version, Model: TestModel');

  assert.match(output, /Model: TestModel/);
  assert.doesNotMatch(output, /Soft Regional/);
  assert.doesNotMatch(output, /ADetailer/);
  assert.doesNotMatch(output, /Lora hashes/);
  assert.doesNotMatch(output, /Version:/);
});

test('preserves inline LoRA prompt token under Other', () => {
  const output = formatter.formatPngInfo('girl, <lora:test:0.8>, blonde hair\nNegative prompt: bad\nModel: LoraModel');

  assert.match(output, /Other:\n.*<lora:test:0.8>/s);
});

test('does not classify full character preset details as Characters', () => {
  const presets = {
    Characters: {
      Cassie: 'cassiestt, blonde hair, blue eyes, athletic body, thick, fit.'
    },
    Hair: {
      'Long Hair': 'blonde hair.'
    }
  };
  const output = formatter.formatPngInfo('sub, cassiestt, blonde hair, blue eyes, athletic body, thick, fit\nNegative prompt: bad\nModel: TestModel', presets);
  const charactersBlock = output.match(/Characters:\n([^\n]+)/)?.[1] || '';

  assert.match(output, /Characters:\nsub, cassiestt/);
  assert.doesNotMatch(charactersBlock, /blonde hair/);
  assert.match(output, /Hair:\nblonde hair/);
  assert.match(output, /Eyes:\nblue eyes/);
  assert.match(output, /Body:\nathletic body, thick, fit/);
});

test('does not match unsafe substrings such as abs inside absurdres', () => {
  const output = formatter.formatPngInfo('incredibly absurdres, soft_abs, visible abs\nNegative prompt: bad\nModel: TestModel');

  assert.match(output, /Styles:\nincredibly absurdres/);
  assert.match(output, /Body:\nsoft_abs, visible abs/);
});

test('applies explicit global category corrections', () => {
  const output = formatter.formatPngInfo('adult, 2girls, dim_light, tense, cash_piles, gold_bars, bed, casino_vault, secure_room, reinforced_steel_walls, metal_door\nNegative prompt: bad\nModel: TestModel');

  assert.match(output, /BG:\ncasino_vault, secure_room, reinforced_steel_walls, metal_door/);
  assert.match(output, /Styles:\nadult, 2girls/);
  assert.match(output, /Emotion:\ntense/);
  assert.match(output, /Lighting:\ndim_light/);
  assert.match(output, /Props:\ncash_piles, gold_bars, bed/);
  assert.doesNotMatch(output, /Characters:\n.*adult/s);
  assert.doesNotMatch(output, /Sex:\n.*2girls/s);
});

test('classifies parenthesized sex tags', () => {
  const output = formatter.formatPngInfo('(cunnilingus), tongue in pussy\nNegative prompt: bad\nModel: TestModel');

  assert.match(output, /Sex:\n\(cunnilingus\), tongue in pussy/);
});

test('classifies weighted sex tags', () => {
  const output = formatter.formatPngInfo('(fellatio:1.3), penis\nNegative prompt: bad\nModel: TestModel');

  assert.match(output, /Sex:\n\(fellatio:1.3\), penis/);
});

test('classifies parenthesized style tags', () => {
  const output = formatter.formatPngInfo('(kittew), western comics \\(style\\)\nNegative prompt: bad\nModel: TestModel');

  assert.ok(output.includes('Styles:\n(kittew), western comics \\(style\\)'));
});

test('keeps absurdres out of Body while preserving safe abs matches', () => {
  const output = formatter.formatPngInfo('incredibly absurdres, soft_abs\nNegative prompt: bad\nModel: TestModel');

  assert.match(output, /Styles:\nincredibly absurdres/);
  assert.match(output, /Body:\nsoft_abs/);
});

test('classifies penetration variants as Sex', () => {
  const output = formatter.formatPngInfo('penetration, (penetration:1.3), anal sex, vaginal sex\nNegative prompt: bad\nModel: TestModel');

  assert.match(output, /Sex:\npenetration, \(penetration:1.3\), anal sex, vaginal sex/);
});
