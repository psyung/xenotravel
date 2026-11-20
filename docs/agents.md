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

1. **`docs/CODEX_PHASE2_POLISH_AND_ROADMAP_SPEC.md` *(현재 최우선 활성 지시서)***
   * 라이브 QA에서 도출된 **잔여 엣지 케이스 10건 정밀 수정(Part A)**과 **차기 핵심 기능 고도화 로드맵 P0~P2(Part B)**를 정의합니다.
2. **`docs/WARNINGS_AND_GUARDRAILS.md`**
   * 과거 결함의 재발을 막기 위한 절대 금지 규칙과 QA 방어 가드레일입니다.
3. **`docs/DESIGN_AND_BRAND_PRINCIPLES.md`**
   * 확정된 브랜드 컬러(`Charcoal Monochrome + Terracotta Coral`), 인라인 언어 스위처(`KO EN 中 日`), 카드 및 지도 필터 시각 원칙입니다.
4. **`docs/ARCHITECTURE_AND_I18N_PRINCIPLES.md`**
   * 단일 상태 원천, 1-클릭 다크모드, 샘플 여행 사용자 수정 보호 플래그(`isUserModified`), 4개 국어 스키마 원칙입니다.
5. **`docs/LOGO_GUIDELINES.md` & `public/icons/logo-xeno-route.svg`**
   * 최종 확정된 비대칭 S-곡선 경로 + 출발 링 + 테라코타 코랄 목적지 포인트 로고 규격입니다.
6. **`docs/CODEX_INTEGRATED_PATCH_SPEC.md`**
   * 1차 브랜드 리뉴얼 및 핵심 패치 완료 기준 아카이브 문서입니다.
7. **`docs/QA_AND_NEXT_STEPS_PROMPT.md`**
   * 배포 후 라이브 서버 검증 및 다음 사이클 분석을 위한 QA 프롬프트입니다.

---

## 3. 에이전트 실행 체크리스트

1. `docs/CODEX_PHASE2_POLISH_AND_ROADMAP_SPEC.md`의 **Part A(안정화 10건)**와 **Part B(고도화 P0~P2)** 요구사항을 빠짐없이 구현합니다.
2. `docs/WARNINGS_AND_GUARDRAILS.md`에 명시된 회귀 방지 항목(파란색/비행기 아이콘 금지, 다크모드 1클릭 전환, 샘플 수정 보호 플래그, `8px` 터치 드래그 임계값, 모바일 지도 높이 제한)을 코드 수준에서 검증합니다.
3. `337px`, `375px`, `768px`, `1280px` 뷰포트 및 `KO`, `EN`, `ZH`, `JA` 4개 국어, 라이트/다크 모드에서 레이아웃 깨짐이 없는지 확인하고 프로덕션 빌드(`npm run build`) 통과 후 커밋합니다.