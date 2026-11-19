import test from 'node:test';
import assert from 'node:assert/strict';
import { parseLocationInput as parse } from '../public/lib/links.js';

test('링크·좌표가 아닌 텍스트는 null (일반 검색)', () => {
  assert.equal(parse('Osaka Castle'), null);
  assert.equal(parse(''), null);
});

test('위도, 경도 텍스트', () => {
  assert.deepEqual(parse('34.6873, 135.5262'), { lat: 34.6873, lng: 135.5262, name: null });
  assert.deepEqual(parse('-33.8568,151.2153'), { lat: -33.8568, lng: 151.2153, name: null });
  assert.deepEqual(parse('95, 10'), { error: 'range' }); // 범위 밖 좌표는 따로 안내한다 (I03)
});

test('구글맵 장소 링크: !3d!4d 좌표와 장소 이름 우선', () => {
  const url =
    'https://www.google.com/maps/place/Eiffel+Tower/@48.8583701,2.2919064,17z/data=!3m1!4b1!4m6!3m5!1s0x47e66e2964e34e2d:0x8ddca9ee380ef7e0!8m2!3d48.8583701!4d2.2944813!16zL20vMDJqODE';
  assert.deepEqual(parse(url), { lat: 48.8583701, lng: 2.2944813, name: 'Eiffel Tower' });
});

test('구글맵 한글 장소 이름 디코딩', () => {
  const url = 'https://www.google.co.kr/maps/place/%EC%98%A4%EC%82%AC%EC%B9%B4%EC%84%B1/@34.6872571,135.5258546,17z';
  assert.deepEqual(parse(url), { lat: 34.6872571, lng: 135.5258546, name: '오사카성' });
});

test('구글맵 q/query 좌표, 좌표 없는 검색어', () => {
  assert.deepEqual(parse('https://maps.google.com/?q=35.6586,139.7454'), { lat: 35.6586, lng: 139.7454, name: null });
  assert.deepEqual(parse('https://www.google.com/maps/search/?api=1&query=35.6586,139.7454'), {
    lat: 35.6586,
    lng: 139.7454,
    name: null,
  });
  assert.deepEqual(parse('https://www.google.com/maps/search/?api=1&query=Tokyo+Tower'), { query: 'Tokyo Tower' });
});

test('구글 짧은 링크는 안내 메시지용 에러', () => {
  assert.deepEqual(parse('https://maps.app.goo.gl/AbCdEf123'), { error: 'short-link' });
  assert.deepEqual(parse('https://goo.gl/maps/xyz'), { error: 'short-link' });
});

test('애플맵, OpenStreetMap', () => {
  assert.deepEqual(parse('https://maps.apple.com/?ll=41.4036,2.1744&q=Sagrada%20Fam%C3%ADlia'), {
    lat: 41.4036,
    lng: 2.1744,
    name: 'Sagrada Família',
  });
  assert.deepEqual(parse('https://www.openstreetmap.org/?mlat=51.5007&mlon=-0.1246#map=17/51.5007/-0.1246'), {
    lat: 51.5007,
    lng: -0.1246,
    name: null,
  });
  assert.deepEqual(parse('https://www.openstreetmap.org/#map=16/41.8902/12.4922'), { lat: 41.8902, lng: 12.4922, name: null });
});

test('지원하지 않는 링크', () => {
  assert.deepEqual(parse('https://map.naver.com/p/entry/place/1234'), { error: 'unsupported' });
});
