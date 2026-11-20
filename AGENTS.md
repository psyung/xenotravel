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

0. **`docs/phase4_qa_fixes_and_core_features.md` *(최신 완료 작업 — Phase 4 QA 잔여 결함 + 핵심 기능 4종)***
   * 회귀 테스트: `test/phase4.test.js`. 배포 식별자는 `scripts/build-version.mjs`(Vercel buildCommand)가 넣습니다.
1. **`docs/CODEX_PHASE3_FINAL_POLISH_SPEC.md` *(Phase 3 마감 지시서)***
   * 2차 QA에서 도출된 **잔여 결함 10건(`B1`~`B10`)**과 **보완 2건(`C1` 기준 통화 선택, `C2` 체크리스트 개별 삭제 Undo)**을 정의한 최종 마감 명세서입니다.
2. **`docs/WARNINGS_AND_GUARDRAILS.md`**
   * 과거 결함의 재발을 막기 위한 절대 금지 규칙과 QA 방어 가드레일입니다.
3. **`docs/DESIGN_AND_BRAND_PRINCIPLES.md`**
   * 확정된 브랜드 컬러(`Charcoal Monochrome + Terracotta Coral`), 인라인 언어 스위처(`KO EN 中 日`), 카드 및 지도 필터 시각 원칙입니다.
4. **`docs/ARCHITECTURE_AND_I18N_PRINCIPLES.md`**
   * 단일 상태 원천, 1-클릭 다크모드, 샘플 여행 사용자 수정 보호 플래그(`isUserModified`), 4개 국어 스키마 원칙입니다.
5. **`docs/brand_logo_and_favicon_guidelines.md` & `public/icons/logo-xeno-route.svg`**
   * 최종 확정된 비대칭 S-곡선 경로 + 출발 링 + 테라코타 코랄 목적지 포인트 로고 규격입니다.
6. **`docs/CODEX_PHASE2_POLISH_AND_ROADMAP_SPEC.md` & `docs/codex_integrated_patch_specification.md`**
   * 1·2차 완료 패치 및 기능 구현 기준 아카이브 문서입니다.
7. **`docs/QA_AND_NEXT_STEPS_PROMPT.md`**
   * 3차 마감 패치 배포 후 최종 검증에 사용하는 라이브 QA 프롬프트입니다.

---

## 3. 에이전트 실행 체크리스트

1. `docs/CODEX_PHASE3_FINAL_POLISH_SPEC.md`의 모든 항목(`B1`~`B10`, `C1`~`C2`)을 빠짐없이 구현합니다.
2. `docs/WARNINGS_AND_GUARDRAILS.md`의 회귀 방지 규칙과 기존 단위/회귀 테스트 스위트(`128개` 이상) 전체 통과를 확인합니다.
3. 수정 완료 후 변경된 문서와 소스를 함께 커밋합니다.