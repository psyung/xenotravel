# XenoTravel AI 개발 에이전트(Codex) 작업 가이드

이 문서는 `C:\proj\xenotravel` 저장소에서 작업하는 AI 코딩 에이전트(Codex 등)가 반드시 숙지하고 준수해야 하는 최상위 안내서입니다. 모든 코드 수정과 기능 추가는 아래 정의된 문서 체계와 원칙을 기준으로 수행합니다.

---

## 1. 프로젝트 개요
* **서비스명:** XenoTravel (`https://xenotravel.vercel.app/`)
* **서비스 성격:** 로그인 없이 브라우저 로컬 저장소(`localStorage`) 기반으로 즉시 동작하는 해외여행 일정 플래너, 동선 지도, 다중 통화 가계부, 카테고리별 체크리스트 통합 웹 애플리케이션
* **지원 언어:** 4개 국어 (`KO` 한국어, `EN` 영어, `ZH` 중국어 간체, `JA` 일본어)
* **지원 환경:** 초소형 모바일(`337px`~`449px`) ~ 태블릿/데스크톱 반응형, 라이트 모드 및 다크 모드

---

## 2. 핵심 문서 맵 (`docs/` & `public/`)

작업을 시작하기 전에 아래 문서를 순서대로 읽고 요구사항과 제약 조건을 확인하세요.

1. **`docs/CODEX_INTEGRATED_PATCH_SPEC.md`**
   * 이번 배포에 반드시 반영해야 하는 8가지 핵심 수정 및 UI/UX 개편 통합 작업 지시서입니다.
2. **`docs/DESIGN_AND_BRAND_PRINCIPLES.md`**
   * 확정된 브랜드 컬러(`Charcoal Monochrome + Terracotta Coral`), 인라인 언어 스위처, 타이포그래피, 카드 인터랙션 원칙을 정의합니다.
3. **`docs/ARCHITECTURE_AND_I18N_PRINCIPLES.md`**
   * 단일 상태 원천(Single Source of Truth), 1-클릭 다크모드 동기화, 4개 국어 UI 및 프리셋 데이터 스키마 원칙을 정의합니다.
4. **`docs/WARNINGS_AND_GUARDRAILS.md`**
   * 과거 발생했던 회귀 버그와 절대 금지 사항(파란색 컬러/비행기 로고 재사용 금지, 2번 클릭 다크모드 금지, 가짜 걸음 수 부활 금지 등)을 명시합니다.
5. **`docs/LOGO_GUIDELINES.md`**
   * 최종 확정된 브랜드 심볼(`logo-xeno-route.svg`)의 SVG 원본 코드, 파비콘 및 헤더 인라인 적용 규격을 정의합니다.
6. **`docs/QA_AND_NEXT_STEPS_PROMPT.md`**
   * 구현 및 배포 완료 후 라이브 서버를 재검증하고 차기 고도화(P0~P2)를 기획하기 위한 검증 프롬프트입니다.

---

## 3. 에이전트 필수 작업 절차

1. **원칙 및 지시서 숙지:** `docs/CODEX_INTEGRATED_PATCH_SPEC.md`와 `docs/WARNINGS_AND_GUARDRAILS.md`를 먼저 읽고 기존 코드베이스 구조를 파악합니다.
2. **에셋 배치:** `docs/LOGO_GUIDELINES.md`에 명시된 최종 SVG 로고를 `public/icons/logo-xeno-route.svg`에 저장하고 파비콘, PWA 매니페스트, 앱 상단 헤더에 연결합니다.
3. **일괄 구현 및 타입/빌드 검증:**
   * 브랜드 컬러 토큰 교체 (파란색 제거 -> 차콜 + 테라코타 코랄)
   * 헤더 인라인 언어 스위처(`KO EN 中 日`) 및 다크모드 1-클릭 토글 수정
   * 장소 상세 카드 바깥 클릭 닫기 및 상단 접기 버튼 추가
   * 지도 `'종류별'` 카테고리 필터 버튼화 및 핀 하이라이트 연동
   * 외국어 헤더 줄바꿈 깨짐 수정 및 추천 장소/샘플 일정 4개 국어 데이터 구조 반영
4. **자가 검증 체크리스트:**
   * 뷰포트 너비 `337px`, `375px`, `768px`, `1280px`에서 가로 스크롤 및 텍스트 세로 찢어짐이 없는지 확인합니다.
   * 라이트/다크 모드가 첫 클릭에 즉시 전환되는지 확인합니다.
   * `KO`, `EN`, `ZH`, `JA` 전환 시 UI와 기본 샘플/인기 장소 데이터가 모두 해당 언어로 자연스럽게 표시되는지 확인합니다.
   * 프로덕션 빌드(`npm run build`) 및 린트/테스트를 통과해야 합니다.
5. **Git 커밋 규칙:**
   * 작업 완료 후 의미 단위로 깔끔하게 커밋합니다. (예: `feat: apply charcoal-coral brand system, route logo, and UX polish`)