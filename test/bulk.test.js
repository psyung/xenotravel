import test from 'node:test';
import assert from 'node:assert/strict';
import { parseLocationList, parseCsv } from '../public/lib/links.js';

test('parseLocationList: 글 안의 여러 링크, 좌표 줄, 짧은 링크, 중복', () => {
  const text = `오사카 가볼 곳
이치란 도톤보리 https://www.google.com/maps/place/Ichiran/@34.6687,135.5013,17z/data=!3m1!4b1!4m6!3m5!1s0x0:0x0!8m2!3d34.66871!4d135.50128
https://maps.apple.com/?ll=34.6873,135.5262&q=Osaka%20Castle
34.6525, 135.5063
https://maps.app.goo.gl/AbCdEf123
https://example.com/not-a-map
https://www.google.com/maps/place/Ichiran/@34.6687,135.5013,17z/data=!3d34.66871!4d135.50128
https://www.google.com/maps/search/?api=1&query=Kuromon%20Market`;
  const r = parseLocationList(text);
  assert.equal(r.places.length, 3);
  assert.equal(r.places[0].name, 'Ichiran'); // 링크 안 장소 이름이 먼저
  assert.equal(r.places[0].lat, 34.66871);
  assert.equal(r.places[1].name, 'Osaka Castle');
  assert.deepEqual([r.places[2].lat, r.places[2].lng], [34.6525, 135.5063]);
  assert.equal(r.shortLinks, 1);
  assert.equal(r.unsupported, 1);
  assert.deepEqual(r.names, [{ name: 'Kuromon Market', memo: '' }]);
});

test('parseLocationList: 링크 앞 글자를 이름으로 (링크에 이름이 없을 때)', () => {
  const r = parseLocationList('숙소 근처 편의점: https://www.google.com/maps?q=34.665,135.501');
  assert.equal(r.places[0].name, '숙소 근처 편의점');
});

test('parseLocationList: 구글 테이크아웃 Saved Places.json (GeoJSON)', () => {
  const geo = JSON.stringify({
    type: 'FeatureCollection',
    features: [
      { geometry: { coordinates: [135.5013, 34.6687] }, properties: { location: { name: '이치란', address: '道頓堀1-4-16' } } },
      { geometry: { coordinates: [0, 0] }, properties: { Title: '좌표 없는 곳', google_maps_url: 'http://maps.google.com/?cid=123' } },
      { geometry: { coordinates: [135.5262, 34.6873] }, properties: { Title: 'Osaka Castle' } },
    ],
  });
  const r = parseLocationList(geo);
  assert.equal(r.places.length, 2);
  assert.deepEqual(r.places[0], { name: '이치란', lat: 34.6687, lng: 135.5013, address: '道頓堀1-4-16', memo: '' });
  assert.equal(r.places[1].name, 'Osaka Castle');
  assert.deepEqual(r.names.map((x) => x.name), ['좌표 없는 곳']);
});

test('parseLocationList: 테이크아웃 저장 목록 CSV (좌표 없으면 이름으로)', () => {
  const csv = `﻿Title,Note,URL,Comment
"Ichiran Dotonbori","줄 서기, 오래 걸림",https://www.google.com/maps/place/Ichiran/data=!4m2!3m1!1s0x6000e7:0x1,
Osaka Castle,,"https://www.google.com/maps/place/Osaka+Castle/@34.6873,135.5262,17z",
`;
  const r = parseLocationList(csv);
  assert.equal(r.places.length, 1);
  assert.equal(r.places[0].name, 'Osaka Castle');
  assert.deepEqual(r.names, [{ name: 'Ichiran Dotonbori', memo: '줄 서기, 오래 걸림' }]);
});

test('parseCsv: 따옴표 안 쉼표·줄바꿈·"" ', () => {
  assert.deepEqual(parseCsv('a,"b, c","d ""e"""\n"x\ny",z\n'), [['a', 'b, c', 'd "e"'], ['x\ny', 'z']]);
});

test('parseLocationList: 빈 글, 지도와 상관없는 글', () => {
  assert.deepEqual(parseLocationList(''), { places: [], names: [], shortLinks: 0, unsupported: 0 });
  assert.equal(parseLocationList('그냥 메모\n내일 10시 출발').places.length, 0);
});
