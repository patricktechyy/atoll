// Local romanization: Korean (Revised Romanization with real pronunciation rules), kana (Hepburn), Cyrillic, Greek.
const assert = require('node:assert/strict');
const { romanizeLine } = require('../src/romanize');

const korean = {
  '안녕하세요': 'Annyeonghaseyo', '사랑해': 'Saranghae', '너를 사랑해': 'Neoreul saranghae', '좋아': 'Joa',
  '같이': 'Gachi', '먹어': 'Meogeo', '읽어': 'Ilgeo', '읽고': 'Ilgo', '학교': 'Hakgyo', '국물': 'Gungmul',
  '신라': 'Silla', '설날': 'Seollal', '종로': 'Jongno', '있어': 'Isseo', '꽃이': 'Kkochi', '앉아': 'Anja',
  '많아': 'Mana', '좋다': 'Jota', '놓고': 'Noko', '입학': 'Ipak', '믿는': 'Minneun', '한국': 'Hanguk',
  '감사합니다': 'Gamsahamnida', '괜찮아': 'Gwaenchana', '값이': 'Gapsi', '없어': 'Eopseo', '닭': 'Dak',
  '닫히다': 'Dachida', '좋네': 'Jonne', '밖에': 'Bakke', '달이': 'Dari', '독립': 'Dongnip', '심리': 'Simni',
  '달빛': 'Dalbit', '나의 마음': 'Naui maeum', '보고 싶어': 'Bogo sipeo', '사랑해, baby': 'Saranghae, baby'
};
for (const [text, want] of Object.entries(korean)) assert.equal(romanizeLine(text), want, text);
// ㄹ is "r" before a vowel (Google writes "neoleul salanghae"), "l" at the end of a syllable
assert.ok(!/leul|salang/i.test(romanizeLine('너를 사랑해')));

const kana = {
  'こんにちは': 'Konnichiwa', 'ありがとう': 'Arigatou', 'さようなら': 'Sayounara', 'がっこう': 'Gakkou',
  'まっちゃ': 'Matcha', 'しんあい': "Shin'ai", 'スター': 'Sutaa', 'ファイト': 'Faito', 'ちょっと': 'Chotto',
  'きゃりー': 'Kyarii', 'わたしは': 'Watashiwa', 'ここへ': 'Kokoe'
};
for (const [text, want] of Object.entries(kana)) assert.equal(romanizeLine(text), want, text);
assert.equal(romanizeLine('はな'), 'Hana', 'は inside a word stays "ha"');

assert.equal(romanizeLine('Привет, мир'), 'Privet, mir');
assert.equal(romanizeLine('Щастя їжак'), 'Shchastya yizhak');
assert.equal(romanizeLine('Ελληνικά τραγούδι'), 'Ellinika tragoudi');

// Latin text passes through; anything that needs a dictionary is declined so another source can handle it
assert.equal(romanizeLine('Hello there'), 'Hello there');
assert.equal(romanizeLine('愛してる'), null, 'kanji need a dictionary');
assert.equal(romanizeLine('你好'), null);
assert.equal(romanizeLine('สวัสดี'), null);
console.log('Local romanization passed.');
