# XenoTravel

가볍고 웹 친화적인 해외여행 일정 플래너. 첫 버전은 **혼자 쓰는 버전**이며, 여행은 이 브라우저(localStorage)에만 저장된다.

## 실행

```bash
npm start        # http://localhost:5173
npm test         # 모델·링크 파서 단위 테스트
```

빌드 과정과 설치할 패키지가 없다. Node 20 이상만 있으면 된다.

## 기능

- 여행 만들기: 여행지, 날짜를 넣으면 날짜 수만큼 일차(Day)가 생긴다.
- 장소 추가 (해외 어디든)
  - 검색: OpenStreetMap 기반 Photon API, 지도 중심 근처 결과 우선
  - 링크 붙여넣기: 구글맵 장소 링크, 애플맵, OpenStreetMap, `위도, 경도`
    - 구글맵 짧은 링크(`maps.app.goo.gl`)는 브라우저 보안 정책(CORS) 때문에 열 수 없어서 안내 문구를 보여준다.
  - 지도에서 직접 찍기
- 끌어서 순서·날짜 변경, 장소 보관함(날짜 미정), 시간·메모·링크 입력, 시간순 정렬
- 지도: 일차별 색상과 번호, 동선 선. 일차 제목을 누르면 그날만 강조한다.
- 내보내기
  - 엑셀(.xlsx): 일차, 날짜, 순서, 시간, 장소, 주소, 메모, 링크, 구글맵 링크
  - PDF: 일차별 지도와 일정표가 담긴 인쇄 미리보기를 연 뒤 브라우저의 "PDF로 저장"을 쓴다.
  - 백업(JSON): 다른 브라우저나 기기로 옮길 때 쓴다.

## 구조

```
server.js            정적 파일 서버 (의존성 없음)
public/index.html    화면
public/app.js        UI·지도·이벤트
public/lib/model.js  여행 데이터 모델 (순수 함수, 테스트 대상)
public/lib/links.js  지도 링크 / 좌표 파서 (테스트 대상)
public/lib/geo.js    장소 검색 / 역지오코딩 (Photon)
public/lib/store.js  localStorage 저장
public/lib/export.js 엑셀·JSON 내보내기
test/                node:test 단위 테스트
```

외부 라이브러리는 CDN(cdnjs)에서 고정 버전으로 불러온다: Leaflet 1.9.4, SortableJS 1.15.2, SheetJS 0.18.5.

## 알려진 한계와 다음 단계

- 지도 타일(OpenStreetMap)과 검색(Photon)은 무료 공개 서버다. 개인 사용은 괜찮지만 사용자가 늘면 키 기반 서비스(MapTiler, Stadia, Google Places 등)로 바꿔야 한다.
- 검색 결과 이름은 영어나 현지어로 나온다 (Photon은 한국어를 지원하지 않는다).
- 작은 가게나 맛집은 OSM 데이터에 없을 수 있다. 이럴 때는 구글맵 링크를 붙여넣는 게 가장 확실하다.
- 다음 단계: 친구와 함께 편집하기 (링크 공유와 실시간 동기화, 서버 필요)
