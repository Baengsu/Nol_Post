# Nol-Post

NOL 포스트시즌 예매 Rec 전용 Chrome MV3 확장.  
PostLab UI/Sync/예약 패턴을 가져왔고, **NOL만** 남김.

## 로드

1. `chrome://extensions` → 개발자 모드 ON  
2. **압축해제된 확장 프로그램 로드** → 이 폴더 (`Nol-Post`)  
3. 아이콘 → 사이드패널  
4. 변경 후: 확장 새로고침 + NOL 탭 새로고침

> PostLab과 **동시에** 쓸 수 있음 (별도 확장). 둘 다 NOL Rec를 켜면 겹칠 수 있으니 하나만 ON.

## 사용

1. Sync URL (`https://nol.yanolja.com`) → **Start**  
2. 포스트시즌 페이지 열기  
3. **목록** → 경기 선택 (goodsCode/placeCode 자동 채움)  
4. 값 수정 가능 → **활성화·값교체** (disabled 해제 + fiber `match` 패치)  
5. **● NOL Rec** 또는 예약 Rec

## 구성

| 파일 | 역할 |
|------|------|
| `background.js` | Sync · 예약 · 스캔/활성화 · MAIN onClick |
| `content-nol.js` | 예매 버튼 감시 |
| `sidepanel.html` / `.js` / `.css` | UI |

버전: `0.1.1`
