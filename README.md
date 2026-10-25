# SyncMusic

삼성 뮤직처럼 생긴 **나만의 Windows 음악 플레이어**와, 같은 Wi-Fi에서 **갤럭시 폰(삼성 뮤직)과 자동으로 음악·재생목록을 맞추는 동반 앱**이에요.

- 디자인: One UI 스타일 (트랙·재생목록·앨범·아티스트·폴더 탭, 둥근 카드, 플로팅 미니 플레이어, 앨범 색이 배어 나오는 재생 화면, 라이트/다크)
- 셔플·반복: 삼성 뮤직에서 볼 수 있는 규칙을 그대로 재현하고 테스트로 고정 ([docs/PLAN.md](docs/PLAN.md) 5장)
- 동기화: 삼성 뮤직 재생목록을 **순서 그대로** PC로 가져오고, 양쪽에서 고쳐도 3-way 병합으로 순서 보존
- 이어듣기: 폰에서 듣던 곡·위치·섞인 대기열을 PC에서 그대로 이어서 재생

자세한 설계는 [docs/PLAN.md](docs/PLAN.md)에 있어요.

## 폴더

| 폴더 | 내용 |
|------|------|
| `pc/` | Windows 플레이어 (Node.js 서버 + Edge 앱 창 UI) |
| `android/` | 폰 동반 앱 (Kotlin) |
| `docs/PLAN.md` | 개발 계획서 |
| `.github/workflows/` | APK 빌드, PC 테스트 |

---

## 1. PC 플레이어 실행

필요한 것: Node.js 22.12 이상 (이 PC에는 24가 설치돼 있어요), Microsoft Edge

1. `pc\SyncMusic.cmd`를 더블클릭하세요. 처음 실행하면 필요한 파일을 설치하고, 주소창 없는 앱 창이 열려요.
   - 터미널에서는 `cd pc` 후 `npm install`, `node launch.js`
2. 설정(⋮ → 설정)에서 **음악 폴더**를 확인하세요. 기본은 `내 음악`(`C:\Users\<이름>\Music`)이에요.
3. 원하면 설정 → Windows에서
   - **바탕화면 바로가기 만들기**
   - **로그인할 때 백그라운드로 실행** (창을 안 열어도 폰 동기화)
4. 창을 닫아도 서버는 동기화를 위해 계속 돌아요. 끄려면 설정 → **SyncMusic 완전히 종료**.

데이터(라이브러리·재생목록·재생 상태)는 `%LOCALAPPDATA%\SyncMusic`에 저장돼요. 폰에서 받은 곡은 첫 번째 음악 폴더의 `From Phone` 폴더에 들어가요.

### 단축키

| 키 | 동작 |
|----|------|
| Space | 재생/일시정지 |
| Ctrl + → / ← | 다음 곡 / 이전 곡 (3초 지났으면 처음부터) |
| Ctrl + ↑ / ↓ | 음량 |
| Ctrl + S / Ctrl + R | 셔플 / 반복 바꾸기 |
| Ctrl + L | 재생 화면 열고 닫기 |
| Ctrl + F 또는 / | 검색 (한글 초성 가능) |
| Ctrl·Shift + 클릭 | 여러 곡 선택 |

Windows 미디어 키와 볼륨 팝업의 재생 컨트롤도 동작해요.

### Windows 방화벽

폰이 PC에 접속하려면 Node.js가 들어오는 연결을 받을 수 있어야 해요 (TCP 47811, UDP 47812).

- 이 PC는 지금 Wi-Fi가 **공용 네트워크**이고, Node.js가 공용 네트워크에서 이미 허용돼 있어요.
- Wi-Fi를 **개인 네트워크**로 바꾸면 처음 실행 때 방화벽 창이 뜰 수 있어요. 그때 개인 네트워크를 허용하세요.

---

## 2. 폰 동반 앱 설치

APK는 비공개 저장소 [beua777/SyncMusic](https://github.com/beua777/SyncMusic)의 GitHub Actions(**Android 동반 앱** 워크플로)가 만들어요. 코드를 올릴 때마다 Kotlin 단위 테스트를 돌리고 APK를 빌드해요.

- 받는 곳: 저장소 → Actions → 가장 최근 **Android 동반 앱** 실행 → Artifacts의 `syncmusic-companion-apk`
- 이 PC에는 내려받아 둔 파일이 `dist\SyncMusic-companion-0.1.0.apk`에 있어요 (git에는 안 올라감)

폰에 설치하기:
1. APK를 폰으로 옮겨요 (USB 복사, Quick Share, 구글 드라이브 등).
2. 내 파일 앱에서 APK를 눌러요. "출처를 알 수 없는 앱 설치"를 허용해요.
3. Play 프로텍트가 알 수 없는 앱이라고 경고하면 "무시하고 설치"를 눌러요. 개인용이라 디버그 키로 서명돼 있어요.

직접 빌드하려면 Android Studio에서 `android` 폴더를 열고 ▶ 실행하세요 (Gradle 8.9, JDK 17). 명령줄로는 `gradle assembleDebug`.

### 폰 설정 (처음 한 번)

1. **삼성 뮤직** → ⋮ → 설정 → **플레이리스트 관리**
   - **모든 플레이리스트 자동 백업**을 켜요.
   - **폴더 선택**에서 저장 폴더를 확인해요 (예: `Music/Playlists`).
2. **SyncMusic 동반 앱**에서
   - 음악 파일·알림 권한을 허용해요.
   - **폴더 선택** → 1번과 같은 폴더를 골라요.
   - **PC 연결** → PC 설정의 **새 휴대폰 연결**에 보이는 6자리 코드를 입력해요.
   - (선택) **이어듣기 허용**에서 SyncMusic을 켜면 폰에서 듣던 곡을 PC로 보낼 수 있어요.
3. 갤럭시는 오래 안 쓴 앱의 백그라운드 작업을 멈출 수 있어요. 자동 동기화가 늦으면 설정 → 배터리 → 백그라운드 사용 제한에서 SyncMusic을 절전 예외로 두세요.

그다음부터는 같은 Wi-Fi에 있으면 약 15분마다, 그리고 앱을 열 때마다 동기화돼요.

---

## 3. 동기화가 하는 일

| 방향 | 내용 |
|------|------|
| 폰 → PC 음악 | 폰에만 있는 곡을 PC `From Phone` 폴더로 (기기별로 끌 수 있음) |
| PC → 폰 음악 | 동기화하는 재생목록에 든 곡(기본) 또는 전체를 폰 `Music/SyncMusic`으로. 삼성 뮤직이 바로 인식 |
| 폰 → PC 재생목록 | 삼성 뮤직 자동 백업 파일을 읽어 **순서 그대로** |
| PC → 폰 재생목록 | 백업 폴더에 `.m3u`로 저장 → 삼성 뮤직에서 **플레이리스트 가져오기**를 한 번 누르면 반영 |
| 양쪽에서 수정 | 3-way 병합: 최근에 바꾼 쪽 순서 + 반대쪽에서 넣고 뺀 곡 반영 |
| 이어듣기 | 폰에서 듣던 곡·위치·대기열 순서·셔플/반복 → PC 화면의 **PC에서 이어 듣기** |

안전을 위해 **음악 파일 삭제는 동기화하지 않아요.** 한쪽에서 지워도 다른 쪽에는 남아요.

### 알아 둘 한계

- 삼성 뮤직은 다른 앱이 재생목록에 직접 쓰는 기능을 주지 않아요. 그래서 PC에서 바꾼 재생목록은 삼성 뮤직에서 **가져오기**를 눌러야 반영돼요. 바뀌면 폰에 알림이 떠요.
- 삼성 뮤직의 셔플 알고리즘은 공개돼 있지 않아요. 공식 도움말과 화면에서 볼 수 있는 규칙(한 바퀴 동안 중복 없음, 셔플 켜도 지금 곡 유지, 반복 3단계, 이전 버튼 두 번 등)을 재현했어요.
- 폰 앱은 GitHub Actions에서 빌드와 단위 테스트를 통과했지만, 실제 갤럭시에서는 아직 시험하지 않았어요. 아래 체크리스트로 확인이 필요해요.

---

## 4. 테스트

```bash
cd pc
npm test
```

PC 테스트 55개:

| 파일 | 확인하는 것 |
|------|-------------|
| `test/queue.test.js` | 셔플·반복 규칙 S1~S13 |
| `test/merge.test.js` | 재생목록 3-way 병합 |
| `test/m3u.test.js` | `.m3u` / `.m3u8` / `.smpl` 읽기·쓰기 |
| `test/sync.e2e.test.js` | 가짜 폰으로 실제 UDP·HTTP 동기화 전체 흐름과 보안 |

폰 앱의 단위 테스트(`android/app/src/test`)는 PC가 만든 기준값(`pc/tools/protocol-vectors.js`)과 서명·키 교환·곡 ID 계산이 바이트 단위로 같은지 확인해요. GitHub Actions에서 APK를 빌드할 때 같이 돌아요.

UI를 데모 음악으로 보려면:

```bash
node tools/make-test-music.js demo-music
```

그다음 설정 → 음악 폴더에 `pc\demo-music`을 추가하세요.

### 실제 폰 체크리스트 (계획서 5단계)

- [ ] 삼성 뮤직 자동 백업 파일의 이름과 형식 (`.m3u` / `.smpl`), 안의 경로 형식
- [ ] 우리가 쓴 `.m3u`를 **플레이리스트 가져오기**로 불러오는지, 같은 이름이 있으면 어떻게 되는지
- [ ] 가져온 뒤 자동 백업이 같은 내용으로 다시 쓰는지 (PC 기록에 기준점 확정이 남음)
- [ ] 화면이 꺼진 상태에서 15분 주기 동기화가 도는지
- [ ] 이어듣기: 삼성 뮤직이 대기열과 셔플 상태를 알려 주는지

---

## 조사 출처

- 삼성전자서비스: [삼성 뮤직 플레이리스트 내보내기/가져오기](https://www.samsungsvc.co.kr/solution/993290)
- Samsung AU: [Importing and Exporting Samsung Music Playlists](https://www.samsung.com/au/support/apps-services/import-export-playlist-samsung-music/)
- Samsung UK: [How to use Samsung Music player app](https://www.samsung.com/uk/support/mobile-devices/samsung-music-app/)
- Samsung Community: [Samsung Music 재생목록 가져오기 관련 글](https://r1.community.samsung.com/t5/galaxy-a/samsung-music/td-p/19109801), [삼성뮤직 플레이리스트 백업 팁](https://r1.community.samsung.com/t5/%EA%B0%A4%EB%9F%AD%EC%8B%9C-s/tip-%EC%82%BC%EC%84%B1%EB%AE%A4%EC%A7%81-%ED%94%8C%EB%A0%88%EC%9D%B4%EB%A6%AC%EC%8A%A4%ED%8A%B8-%EB%B0%B1%EC%97%85%ED%95%98%EB%8A%94-%EB%B0%A9%EB%B2%95/m-p/5501503/highlight/true)
- Android: [MediaStore.Audio.Playlists (deprecated, M3U 권장)](https://developer.android.com/reference/android/provider/MediaStore.Audio.Playlists)

삼성, 갤럭시, 삼성 뮤직, One UI는 삼성전자의 상표예요. 이 프로젝트는 삼성과 관계없는 개인 프로젝트이고, 삼성의 아이콘이나 이미지는 쓰지 않았어요.
