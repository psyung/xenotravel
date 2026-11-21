# XenoTravel 브랜드 로고 및 파비콘 가이드라인

이 문서는 XenoTravel의 공식 브랜드 심볼 규격과 SVG 소스 코드를 정의합니다.

---

## 1. 공식 브랜드 심볼 컨셉
* **심볼 명칭:** Xeno Route Mark (`logo-xeno-route.svg`)
* **조형 의미:**
  * 좌상단에서 우하단으로 유연하게 흐르는 S-곡선 경로와 좌하단 출발지 링(Origin Ring)이 교차하며 브랜드 이니셜 **`X`**와 여정의 동선을 형성합니다.
  * 우상단 대각선 끝에는 간격을 두고 분리된 **오션 블루 목적지 포인트(Destination Beacon)** (2026-11 테라코타 코랄에서 변경)가 배치되어, 새로운 여행지 발견의 설렘을 상징합니다.
* **상표권 및 시각적 차별성:**
  * 일반 여행사의 비행기/지구본 클리셰를 배제했습니다.
  * X(구 트위터)의 직선 이중선 글리프, Airbnb의 단일 폐곡선 루프, Google Maps의 물방울 핀과 조형적으로 명확히 구분되는 비대칭 경로 마크입니다.

---

## 2. 표준 SVG 코드

### A. 파비콘 및 PWA 아이콘용 (`public/icons/logo-xeno-route.svg`)
OS·브라우저 테마와 무관하게 같은 대비가 나오도록 밝은 원형 배지를 내장합니다 (Phase 3 B8 → Phase 4 대비 보완).
배지(`#FAF9F6`)는 다크 탭(`#202124`) 대비 약 16:1, 테두리(`#A1A1AA`, 1.5px)는 흰 탭(`#FFFFFF`)에서도 배지 윤곽을 보이게 합니다.

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" fill="none">
  <circle cx="16" cy="16" r="15.25" fill="#FAF9F6" stroke="#A1A1AA" stroke-width="1.5"/>
  <path d="M9.5 10.5C14.5 10.5 17.5 23.5 23 23.5" stroke="#18181B" stroke-width="3.2" stroke-linecap="round"/>
  <path d="M11.3 21.7L19.6 13.4" stroke="#18181B" stroke-width="3.2" stroke-linecap="butt"/>
  <circle cx="9.5" cy="23.5" r="2.6" stroke="#18181B" stroke-width="2.4"/>
  <circle cx="23.3" cy="9.7" r="3.4" fill="#0B84E3"/>
</svg>
```

### B. 앱 상단 헤더 인라인 컴포넌트용 (`currentColor` 연동)
앱 내부 다크 모드 토글 시 `currentColor`를 통해 즉시 색상이 전환되며, 목적지 점은 `--accent-primary` 변수를 따릅니다.

```svg
<svg width="24" height="24" viewBox="0 0 32 32" fill="none" aria-hidden="true">
  <path d="M9.5 10.5C14.5 10.5 17.5 23.5 23 23.5" stroke="currentColor" stroke-width="3.2" stroke-linecap="round"/>
  <path d="M11.3 21.7L19.6 13.4" stroke="currentColor" stroke-width="3.2" stroke-linecap="butt"/>
  <circle cx="9.5" cy="23.5" r="2.6" stroke="currentColor" stroke-width="2.4"/>
  <circle cx="23.3" cy="9.7" r="3.4" fill="var(--accent-primary, #0A6FC2)"/>
</svg>
```

---

## 3. 사용 및 변형 금지 규칙
1. **분리 간격 유지:** 우상단 직선 획 끝(`19.6, 13.4`)과 블루 원(`23.3, 9.7`) 사이의 여백은 16px 파비콘에서도 점이 뭉개지지 않도록 의도된 공간이므로 임의로 붙이지 마세요.
2. **단색 강제 변환 제한:** 단색 인쇄물 등 특수한 예외를 제외하고 웹 UI에서는 반드시 목적지 점에 오션 블루(`#0B84E3` 파비콘 · UI는 `--accent-primary` `#0A6FC2` / 다크 `#4AA8F5`) 포인트를 유지합니다.
3. **최소 렌더링 크기:** 브라우저 탭 파비콘(`16px × 16px`)에서도 선 두께가 뭉개지지 않도록 `viewBox="0 0 32 32"` 비율과 `stroke-width="3.2"`를 유지합니다.