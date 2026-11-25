# XenoTravel AI 개발 에이전트(Codex) 작업 가이드

이 문서는 `C:\proj\xenotravel` 저장소에서 작업하는 AI 코딩 에이전트(Codex 등)가 반드시 숙지하고 준수해야 하는 최상위 안내서입니다.

---

## 1. 프로젝트 개요
* **서비스명:** XenoTravel (`https://xenotravel.vercel.app/`)
* **아키텍처 원칙:** 로그인 및 백엔드 DB 없이 브라우저 `localStorage` 기반으로 즉시 동작하는 로컬 퍼스트(Local-First) 해외여행 플래너 웹 애플리케이션
* **지원 언어:** 4개 국어 (`KO` 한국어, `EN` 영어, `ZH` 중국어 간체, `JA` 일본어)
* **지원 뷰포트:** 초소형 모바일(`337px`~`449px`) ~ 태블릿/데스크톱 반응형, 라이트 모드 및 다크 모드

---

## 2. 문서 체계 및 우선순위 (`docs/` & `public/`)

작업을 시작하기 전에 아래 문서를 순서대로 확인하세요.

0. **`docs/qa-2026-11-23.md` *(현재 최우선 활성 지시서 — 2026-11-23 QA, Phase 0~6)***
   * 진행(2026-11-24): Phase 0~6, PART F(F-1~F-10, F-5는 측정 메모만), PART I(I-0 noindex 단계, I-0b, I-1~I-5) 완료. **보류: A-1 도메인 xenoday.com 연결 + A-1b 앱 이름 XenoDay 변경(같은 배포로).**
   * 진행(2026-11-25, PART J "지금 바로"): 1단계 완료 — I-6·J-18 보드 깨짐, J-17 동선 정리 버튼 상시 표시, J-19 보드 끌어 이동(`ui/board-pan.js`), J-20 준비 중 안내 맨 끝, J-21 지도 토글 아이콘(목록 `mapHidden`·보드 `mapHiddenBoard`, M 키), J-22 소개 문구(`SITE_NAME`), J-10 1단계(직선 30km 이상 구간은 합계·경고에서 빼고 "장거리 n구간(수단 미정)"). 회귀 테스트 `test/qa1125.test.js`. 2단계 완료 — J-4 오늘 카드 숙소(`todayPlan`의 `tonight`·`checkOut`), J-10·J-16 구간별 이동 수단(`lib/segments.js`, `trip.segments['fromId>toId']`, 공유 링크는 자리 기준 `segs`로 실음, 지도 선: 도보 점선·차량 실선·수단 미정 긴 점선). 3단계 완료 — J-12 기본/회색 전환 삭제(예전 `prefs.mapStyle`은 지움), J-13 핀 ↔ 목록 연동(`focusMapPlace`·`markListActive`, 겹친 핀 벌리기), J-14 PDF 표(colgroup 8mm·16mm·40%, 숙소는 번호 없는 줄). **PART L(L-0) 매핑표에 `segments`를 넣을 것. 다음: PART L(L-0 설계 확정 → L-P → L-1), 그다음 J-2 이하 UI.**
   * 보드 레이아웃: 칸은 화면 높이(보관함 높이 `--dock-h` 제외)에 맞추고 `.timeline`이 칸 안에서 세로 스크롤한다. 하루 ⋯ 메뉴(`.day-more`)는 칸 스크롤에 잘리지 않게 fixed로 띄운다.
   * 배포 단계(I-0): `SITE_STAGE` 환경 변수. 없으면 preview = 전체 noindex·robots `Disallow: /`·빈 sitemap(+ vercel.json이 *.vercel.app에 `X-Robots-Tag: noindex`). 정식 오픈 배포에서 Vercel에 `SITE_STAGE=production`을 넣는다 — 이때 공개 가이드(draft: false)에 `TODO(확인 필요)`가 남아 있으면 빌드가 멈춘다(지금 13곳).
   * 정적 페이지(I-2): `tokens.css`(색 토큰, 앱과 공용) + `site.css` + `site.js`(밝기·메뉴·복사). `styles.css`는 앱 전용. 개인정보 모달은 없앴고 앱은 `/{lang}/privacy/`로 링크한다. 문의 메일은 site-config의 CONTACT_EMAIL.
   * 코스(I-5): `content/guides/<id>-course.json` = `{ id, destination, title, days[{ items[{ name, lat, lng, time, memo }] }], checklist }`(4개 국어 맵), 넣는 로직은 `lib/courses.js`. 회귀 테스트 `test/qa1124.test.js`.
   * 회귀 테스트: `test/security.test.js`, `test/qa1123*.test.js`(p2·p3·p3b·p3c·p4·p4-server·p5·p6), `test/qa1124.test.js`. 앱 소스 정규식 검사는 `test/helpers/app-source.js`(app.js + pages/ + ui/ + map/)를 쓴다.
   * 구조(F-4): `app.js`는 진입점·화면 전환. `pages/`(plan·budget·check), `map/`(지도·찍기), `ui/`(고정 검색 바·맨 위로)는 `init(ctx)` + getter로 살아 있는 상태를 읽는다.
   * 사이트: `scripts/build-site.mjs`가 `content/guides/*.md` → 정적 가이드·개인정보·소개·문의·약관·robots·sitemap·ads.txt를 만든다(생성물은 .gitignore). 사이트 주소·게시자 ID·광고 스위치(ADS_ENABLED=false)·문의 메일은 `public/lib/site-config.js` 한 곳.
   * 도메인 작업 체크리스트(A-1/A-1b): ① site-config의 SITE_ORIGIN을 https://xenoday.com 으로 ② vercel.json에 xenotravel.vercel.app·www → xenoday.com 301(해시·/s/<id> 보존) ③ 화면·메타·manifest·OG·공유 문구의 앱 이름을 XenoDay로(4개 국어, 로마자 그대로) ④ **localStorage 키 `xenotravel:*`와 SW 캐시 접두어는 바꾸지 않는다** ⑤ 첫 방문 1회 "XenoTravel이 XenoDay로 이름을 바꿨어요" 토스트 ⑥ og.png·로고 글자 확인 ⑦ Search Console 주소 변경은 사용자가 직접.
   * 애드센스: ads.txt는 `pub-` + 숫자 16자리 게시자 ID가 필요하다(지금 값 'xenoday'는 주석 처리 + 빌드 경고). CSP는 아직 Report-Only — 위반이 없으면 강제 모드로.
   * 공용 UI: `lib/select.js`(`<select data-ui-select>` → 팝오버/바텀시트), `lib/timefield.js`(flatpickr 시간 입력). 새 select·시간 칸은 이것을 쓴다.
   * 패치 주의: Node 스크립트로 소스를 고칠 때 `String.replace(a, b)`의 b에 `$$`가 있으면 `$`로 바뀐다 → `replace(a, () => b)`를 쓴다.
   * 결정: P0-5 막대 폭 축소+라벨 간격(Codex 협의), P0-7 그 밖의 언어는 영어, P0-8 데이터 없으면 접힌 한 줄 안내.
0-1. **`docs/phase4_qa_fixes_and_core_features.md` *(직전 완료 작업 — Phase 4 QA 잔여 결함 + 핵심 기능 4종)***
   * 회귀 테스트: `test/phase4.test.js`. 배포 식별자는 `scripts/build-version.mjs`(Vercel buildCommand)가 넣습니다.
1. **`docs/CODEX_PHASE3_FINAL_POLISH_SPEC.md` *(Phase 3 마감 지시서)***
   * 2차 QA에서 도출된 **잔여 결함 10건(`B1`~`B10`)**과 **보완 2건(`C1` 기준 통화 선택, `C2` 체크리스트 개별 삭제 Undo)**을 정의한 최종 마감 명세서입니다.
2. **`docs/WARNINGS_AND_GUARDRAILS.md`**
   * 과거 결함의 재발을 막기 위한 절대 금지 규칙과 QA 방어 가드레일입니다.
3. **`docs/DESIGN_AND_BRAND_PRINCIPLES.md`**
   * 확정된 브랜드 컬러(`Ink Navy + Ocean Blue`, 2026-11 변경), 인라인 언어 스위처(`KO EN 中 日`), 카드 및 지도 필터 시각 원칙입니다.
4. **`docs/ARCHITECTURE_AND_I18N_PRINCIPLES.md`**
   * 단일 상태 원천, 1-클릭 다크모드, 샘플 여행 사용자 수정 보호 플래그(`isUserModified`), 4개 국어 스키마 원칙입니다.
5. **`docs/brand_logo_and_favicon_guidelines.md` & `public/icons/logo-xeno-route.svg`**
   * 최종 확정된 비대칭 S-곡선 경로 + 출발 링 + 오션 블루 목적지 포인트 로고 규격입니다.
6. **`docs/CODEX_PHASE2_POLISH_AND_ROADMAP_SPEC.md` & `docs/codex_integrated_patch_specification.md`**
   * 1·2차 완료 패치 및 기능 구현 기준 아카이브 문서입니다.
7. **`docs/QA_AND_NEXT_STEPS_PROMPT.md`**
   * 3차 마감 패치 배포 후 최종 검증에 사용하는 라이브 QA 프롬프트입니다.

---

## 3. 에이전트 실행 체크리스트

1. `docs/CODEX_PHASE3_FINAL_POLISH_SPEC.md`의 모든 항목(`B1`~`B10`, `C1`~`C2`)을 빠짐없이 구현합니다.
2. `docs/WARNINGS_AND_GUARDRAILS.md`의 회귀 방지 규칙과 기존 단위/회귀 테스트 스위트(`128개` 이상) 전체 통과를 확인합니다.
3. 수정 완료 후 변경된 문서와 소스를 함께 커밋합니다.