# Nol-Post 가이드 · 조사 전부

포스트시즌 NOL 예매 조사 + 확장 사용법 모음.  
(waiting / onestop `key` 토큰은 저장·공유하지 말 것)

---

## 성공 판정 (당신이 말한 그거)

**다른 페이지/경기의 `(오픈예정)` 버튼**에  
**지금 열려 있는 포스트시즌 경기의 코드**를 넣고 → **활성화·값교체** → **Rec(또는 클릭)**  
→ 인터파크 `partner` → `waiting` → `onestop/seat` 까지 들어가면 **성공**.

코드는 이미 알고 있으면 수동 입력해도 됨.

| 넣을 값 | 예시 | 비고 |
|---------|------|------|
| `goodsCode` | `26014425` | URL `gc` / ticket path |
| `placeCode` | `26000514` | URL `pc` |
| (참고) `bizCode` | `25104` | 목록 API용. **partner의 `bc`와 다름** |
| (참고) 실제 `bc` | `61776` | onClick이 알아서 씀. 우리가 조립할 필요 없음 |

---

## URL 이동 루트 (실제 기록)

같은 탭. 새 창 아님.

```
nol.yanolja.com/ticket/genre/sports/postseason
        │  예매하기 클릭 또는 MAIN onClick Invoke
        ▼
tickets.interpark.com/gates/partner
        ?bc=61776
        &gc={goodsCode}          ← match.goodsCode
        &pc={placeCode}          ← match.placeCode
        &cc=Gates
        │
        ▼
tickets.interpark.com/gates/ticket/{goodsCode}
        ?bc=61776
        &pc={placeCode}
        &ps=
        &pass_code=
        │
        ▼
tickets.interpark.com/waiting
        ?key={대기열토큰}         ← 저장 금지
        &lang=ko
        &from=NOL
        │  (+ 가끔 &nw=Y)
        ▼
tickets.interpark.com/onestop
        ?key={세션UUID}           ← 저장 금지
        &app_tapbar_state=hide
        &app_header_state=hide
        │
        ▼
tickets.interpark.com/onestop/seat
```

### 타임라인에서 본 이벤트 순서 (요약)

1. NOL 목록에서 click / Invoke  
2. `gates/partner?...` (수동 클릭 시 ~100ms, Invoke 시 `server_redirect`로 진입하기도 함)  
3. `gates/ticket/{gc}?...`  
4. `waiting?key=…&from=NOL`  
5. `onestop?key={uuid}`  
6. `onestop/seat`

### bc ≠ bizCode (중요)

- fiber `match.bizCode` = `25104` (스포츠 목록 API)  
- 실제 partner URL `bc` = `61776`  
→ **URL을 우리가 조립하지 말고**, 사이트 `onClick`을 호출하는 쪽이 안전.

---

## React / fiber에서 확인한 것

| 항목 | 결과 |
|------|------|
| 스택 | React (Vue 아님). isolated에는 fiber 키 없음 → **MAIN** 필요 |
| 버튼 | `<button>` 텍스트 `예매하기` / 오픈예정 등 |
| 위젯 | `#GOODS_RESERVATION-492`, `widgetType: GOODS_RESERVATION` |
| 클릭 핸들러 | fiber `onClick` (depth 0~3 근처) |
| 경기 데이터 | 상위 fiber props `match` (한 경기), `matches` (목록) |
| 목록 API | `/sports/goods?page=0&size=10&bizCode=25104&…&relationCode=14731` |

### match 필드 (티켓링크 SID/PID 대응)

| 필드 | 역할 |
|------|------|
| `goodsCode` | 상품/경기 → `gc` |
| `placeCode` | 장소 → `pc` |
| `goodsName` | 표시 이름 |
| `bookingOpenTime` / `bookingEndTime` | 예매 창 |
| `placeName` | 경기장 |
| `sport.homeOrganization` / `awayOrganization` | 팀 |
| `property` / `propertyList` | 난수쿠폰·라벨 등 플래그 |
| `bizCode` | 목록용 (partner `bc` 아님) |
| `relationCode` | 시리즈/관계 |

### Invoke 실험 결과

- 사이드패널 **Invoke onClick**만으로도 수동 클릭과 **동일 경로** 진입 확인.  
- → PostLab/Nol-Post 1순위 = **MAIN에서 fiber onClick 호출**.

---

## 도구 역할 정리

| 폴더 | 역할 |
|------|------|
| `research_web/` | 조사 확장 (Pick / Deep / Invoke / URL timeline) |
| `PostLab/` | 티켓링크 + (실험용) NOL 탭 |
| `Nol-Post/` | **NOL 포스트시즌 전용** 확장 (이 가이드 대상) |

---

## Nol-Post 사용법

1. `chrome://extensions` → **Nol-Post** 폴더 로드 (PostLab과 별개)  
2. NOL 포스트시즌 탭 연 뒤 확장·페이지 새로고침  
3. Sync URL `https://nol.yanolja.com` → **Start** (예약 쓸 때)  
4. **목록** → 열린 경기 선택 (또는 코드를 직접 입력)  
5. 오픈예정 쪽을 시험하려면:  
   - 오픈예정 버튼이 있는 화면에서 **목록**  
   - 오픈예정 항목 선택  
   - `goodsCode` / `placeCode`를 **열린 경기 값으로 수정**  
   - **활성화·값교체**  
   - **● NOL Rec**  
6. partner → waiting → seat 가면 성공.

### UI 버튼

| 버튼 | 하는 일 |
|------|---------|
| 목록 | MAIN 스캔 — 예매/오픈예정 버튼 + match 덤프 |
| 활성화·값교체 | disabled 해제, 라벨 `예매하기`, fiber `match`에 gc/pc 패치, 오픈시각 과거로 밀기 시도 |
| ● NOL Rec | 감시 후 MAIN `onClick` 호출 |
| 예약 | 서버 시각에 Rec ON |

### 한계

- 가드가 **서버만**이면 클라이언트 패치로는 안 들어갈 수 있음.  
- 가드가 **프론트(disabled / bookingOpenTime 체크)** 면 활성화가 먹는지 바로 판별 가능.  
- waiting `key`는 세션 토큰 — 로그에 있어도 외부 공유·영구 저장 금지.

---

## research_web으로 다시 찍을 때

1. URL timeline Clear  
2. Pick → Deep match → JSON 보관(로컬)  
3. Click arm ON → 수동 클릭 → timeline 복사  
4. (또는) Invoke onClick → timeline 복사  

샘플/메모: `research_web/nol/`

---

## 한 줄 요약

**열린 경기의 gc/pc를 오픈예정 박스에 심고 onClick으로 들어가면 성공.**  
이동 루트는 항상  
`NOL 목록 → partner(bc,gc,pc) → ticket → waiting → onestop → seat`.
