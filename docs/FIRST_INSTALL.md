# Agent Web GPT Automation 최초 설치

이 문서는 설치, 공개 주소, DevSpace, Oracle 전용 브라우저, ChatGPT 앱 등록을
한 번에 끝내는 기준 절차입니다. 순서를 바꾸면 OAuth 주소나 허용 루트가 어긋날
수 있으므로 1번부터 진행합니다.

## 결론부터

- 제품 이름: **Agent Web GPT Automation**
- 저장소: `agent-web-gpt-automation`
- ChatGPT에 표시할 앱 이름: **`codex`**
- 권장 공개 경로: **Tailscale Funnel**
- DevSpace 기본 로컬 주소: `http://127.0.0.1:7676/mcp`
- ChatGPT 등록 주소: 고정 HTTPS 주소의 `/mcp`

`codexpro-*` 파일명, 상태 스키마, 설치 영수증은 기존 실행 복구와 롤백을 위해
내부 호환 ID로 유지합니다. 새 작업을 CodexPro 엔진으로 보내는 뜻이 아닙니다.

## 0. 공개 경로 선택

| 경로 | 지원 수준 | 완료 조건 | 주의점 |
|---|---|---|---|
| Tailscale CLI + Funnel | **권장·자동화** | 고정 `*.ts.net` 주소와 로그인 시작 복구 | 이 저장소가 설정·진단하는 기준 경로 |
| Cloudflare named tunnel | **수동 구성** | named tunnel과 고정 hostname, OS 서비스 | 저장소 자동화·readiness 보장 밖이며 임시 `*.trycloudflare.com` URL은 금지 |
| ngrok static/reserved domain | **수동 구성** | 고정 도메인과 OS 시작 서비스 | 저장소 자동화·readiness 보장 밖이며 실행할 때마다 바뀌는 URL은 금지 |
| custom HTTPS proxy | **수동 구성** | 고정 HTTPS `/mcp`, OAuth 전달, 재부팅 복구 | 구성·운영·검증 책임은 사용자에게 있음 |

이 저장소의 기준 절차는 Tailscale CLI + Funnel입니다. DevSpace OAuth, 로그인
복구, onboarding readiness도 이 경로를 기준으로 자동화·검증합니다.
Cloudflare/ngrok/custom은 대체 자동화 경로가 아니라 수동 구성 옵션입니다.
선택한 경우 고정 주소, OS 부팅 서비스, OAuth 전달, local/public endpoint,
재부팅 복구를 사용자가 직접 구성하고 검증해야 합니다.

## 1. 저장소 설치

Windows PowerShell:

```powershell
git clone https://github.com/dbc-hbin/agent-web-gpt-automation.git
cd agent-web-gpt-automation
python install.py --dry-run
python install.py
python doctor.py
```

macOS:

```bash
git clone https://github.com/dbc-hbin/agent-web-gpt-automation.git
cd agent-web-gpt-automation
python3 install.py --dry-run
python3 install.py
python3 doctor.py
```

설치기는 기존 전역 파일을 백업하고 `.codex/receipts`에 영수증을 기록합니다.
`rollback.py`와 `uninstall.py`는 그 영수증을 기준으로 동작합니다.

## 2. 전체 계획을 먼저 출력

허용할 프로젝트 루트를 모두 넣습니다. 드라이브 전체는 허용하지 않습니다.

```powershell
python onboard.py plan `
  --provider tailscale `
  --public-url https://your-device.your-tailnet.ts.net/mcp `
  --root C:\projects\alpha `
  --root D:\projects\beta
```

계획은 설치부터 최종 gate까지 8개 단계를 JSON으로 출력합니다. 암호나 토큰을
인자로 받지 않습니다. 이 onboarding plan/status의 권장·검증 기준은 Tailscale
CLI + Funnel입니다. Cloudflare, ngrok, 기존 프록시는 아래 수동 경계를 따릅니다.

## 3. 고정 HTTPS 주소와 DevSpace를 먼저 설정

### Tailscale 권장 경로

먼저 미리보기합니다.

```powershell
python skills/chatgpt-workspace-setup/scripts/devspace_tailscale_setup.py setup `
  --root C:\projects\alpha `
  --root D:\projects\beta `
  --hostname your-device.your-tailnet.ts.net `
  --dry-run
```

기존 DevSpace 설정이 있으면 현재 `allowedRoots`와 새 루트를 합친 전체 목록이
표시됩니다. 목록을 확인한 뒤에만 `--apply`를 사용합니다.

```powershell
python skills/chatgpt-workspace-setup/scripts/devspace_tailscale_setup.py setup `
  --root C:\projects\alpha `
  --root D:\projects\beta `
  --hostname your-device.your-tailnet.ts.net `
  --apply
```

`devspace init` 화면에는 표시된 **전체 exact root**와 public origin
`https://your-device.your-tailnet.ts.net`을 입력합니다. 여기에는 `/mcp`를 붙이지
않습니다. 첫 설치의 `init`은 숨겨진 서비스 창이 아니라 현재 터미널에 표시됩니다.
초기화 직후 Owner 암호 검토도 같은 TTY에서 이어집니다. 기존 설정에 root만 추가할
때는 `auth.json`을 읽거나 바꾸지 않습니다.

### Cloudflare/ngrok/custom 수동 경로

이 경로들은 저장소가 설치·복구·readiness를 보장하는 자동화 대상이 아닙니다.
아래 항목은 호환에 필요한 최소 조건이며, 실제 구성과 최종 검증은 사용자가
선택한 provider의 공식 절차와 운영 환경에 맞게 직접 수행합니다.

1. 먼저 고정 hostname을 만들고 `http://127.0.0.1:7676`으로 전달합니다.
2. 터널 클라이언트를 OS 로그인/서비스로 등록합니다.
3. `npx --yes @waishnav/devspace@1.0.4 init`을 실행합니다.
4. exact roots와 public origin을 입력합니다. public origin에는 `/mcp`를 빼고,
   ChatGPT 등록 URL에는 `/mcp`를 붙입니다.
5. DevSpace 관리 실행 환경에 아래 두 값을 유지합니다.

```text
DEVSPACE_TOOL_MODE=full
DEVSPACE_OAUTH_SCOPES=devspace,offline_access
```

임시 URL은 앱 등록 후 바뀌므로 설치 완료 조건을 만족하지 않습니다.

## 4. Owner 암호 처리

DevSpace는 `init` 중 Owner 암호를 생성해 자체 로컬 `auth.json`에 저장합니다.

- 생성된 고엔트로피 암호를 유지하는 것이 기본 권장값입니다.
- 첫 설치 안내에서 `K`를 선택하면 기존 값을 유지하고, `C`를 선택한 경우에만 숨김
  입력으로 custom 암호와 확인값을 받습니다. custom 값은 16자 이상, 공백 없음,
  문자 종류 3개 이상이어야 하며 숫자 전용 값은 거부합니다.
- 별도로 다시 확인해야 하면 사용자 본인이 열린 터미널에서만 아래 명령을 실행합니다.

```powershell
python skills/chatgpt-workspace-setup/scripts/devspace_tailscale_setup.py owner-password
```

- 최종 Owner 암호는 대화형 TTY에 한 번만 표시되므로 즉시 암호 관리자에 저장합니다.
- CLI 인자, 환경 파일, 스크립트, Git, 이슈, 로그에 복사하지 않습니다.
- ChatGPT의 최초 OAuth 승인 페이지에서만 직접 입력합니다.
- 암호를 바꾸거나 재생성하면 기존 ChatGPT 연결도 다시 승인해야 합니다.

## 5. 재부팅 복구와 endpoint 확인

Tailscale 경로의 `setup --apply`는 로그인 시 시작되는 숨김 watchdog을 등록하고
즉시 실행합니다. watchdog은 현재 `.devspace/config.json`을 5분마다 다시 읽고,
DevSpace가 로그인 후 예기치 않게 종료돼도 서비스와 정확한 Funnel을 복구합니다.
root 목록을 wrapper나 시작 명령에 별도로 하드코딩하지 않습니다. 로그인 때 한 번만
실행하고 끝나는 시작 명령은 지속 복구로 인정하지 않습니다.

```powershell
python skills/chatgpt-workspace-setup/scripts/devspace_tailscale_setup.py doctor `
  --root C:\projects\alpha `
  --root D:\projects\beta `
  --hostname your-device.your-tailnet.ts.net
```

정상 DevSpace OAuth endpoint는 인증 없는 GET에 보통 `401`을 반환합니다. 연결
거부나 timeout은 정상으로 보지 않습니다. 현재 config roots와 bootstrap roots가
완전히 같아야 합니다.

## 6. Oracle 전용 브라우저에 한 번 로그인

일상 Chrome 프로필이 아닌 Oracle 전용 프로필을 초기화합니다.

```powershell
npx --yes @steipete/oracle@0.17.1 --engine browser `
  --browser-manual-login --browser-keep-browser `
  --browser-manual-login-profile-dir "$env:USERPROFILE\.oracle\browser-profile" `
  -p "HI"
```

열린 전용 브라우저에서 ChatGPT 로그인만 완료합니다. 이후 실제 실행은 이 프로필의
throwaway copy를 사용하므로 동시 프로젝트가 같은 브라우저 상태를 공유하지 않습니다.

## 7. ChatGPT 앱을 마지막에 수동 등록

고정 URL, DevSpace, OAuth, 재부팅 복구, Oracle 로그인이 모두 준비된 뒤 진행합니다.

1. ChatGPT `Settings` → `Security and login`에서 Developer mode를 켭니다.
2. ChatGPT Plugins 화면에서 `+`를 선택합니다.
3. 이름은 기본값 **`codex`** 또는 사용자가 정한 이름(예: `dongju`)을 입력합니다.
4. Connection URL에 `https://고정주소/mcp`를 입력합니다.
5. 발견된 도구와 metadata를 확인하고 연결을 생성합니다.
6. 표시되는 DevSpace Owner 승인 화면에서 암호를 직접 입력합니다.

자동화는 ChatGPT 설정, 앱 생성·삭제, 권한 선택, 도구 선택 UI를 조작하지 않습니다.
공식 연결 순서는 [OpenAI의 Connect and test your plugin 문서](https://developers.openai.com/plugins/deploy/connect-chatgpt)를 기준으로 합니다.

등록 또는 사용자가 요청한 재연결 직후에는 기존 설정·Owner 암호·OAuth DB·허용
루트를 보존한 채 관리 DevSpace 프로세스를 정확히 한 번 재순환합니다.

```powershell
python skills/chatgpt-workspace-setup/scripts/devspace_tailscale_setup.py post-register `
  --root C:\projects\alpha `
  --hostname your-device.your-tailnet.ts.net
```

그 다음 새 일반(non-Pro) Oracle `@<앱이름>` 읽기 전용 검사로 exact 프로젝트를 열고
작은 디렉터리 목록을 읽습니다. Codex Desktop에 내장된 `DevSpace` 플러그인은 수동
등록한 ChatGPT 앱과 다른 연결이므로 그 도구 결과로 앱 등록을 판정하지 않습니다.
첫 연결 검증에 Pro 세션을 사용하지 않습니다.

설치 후 일반 웹 작업은 최고 지원 비-Pro 추론 강도를 사용합니다. Pro는 횟수 제한이
있으므로 사용자가 명시적으로 요청한 경우에만 선택하며 자동 승격하지 않습니다. 명시
선택된 Pro는 저장소 안전 규칙 아래 exact root에서 미션이 허용한 쓰기와 명령 실행을
사용할 수 있습니다.

Oracle이 같은 이름을 사용하도록 로컬 공개 설정을 기록합니다.

```powershell
python onboard.py configure-app-name --app-name codex
```

## 8. 최종 상태 확인

```powershell
python onboard.py status `
  --provider tailscale `
  --public-url https://your-device.your-tailnet.ts.net/mcp `
  --root C:\projects\alpha `
  --root D:\projects\beta `
  --app-name codex
```

`ready: true`여야 최초 질문을 제출합니다. 새 프로젝트에서는 첫 Oracle 질문 전에
exact folder가 `allowedRoots`에 있는지만 가볍게 확인하고, config hash가 그대로면
후속 질문마다 endpoint·앱 설정을 다시 검사하지 않습니다. parent, child, 비슷한
이름의 폴더는 exact root를 대신할 수 없습니다.

## 변경별 재연결 기준

| 변경 | 필요한 조치 |
|---|---|
| 프로젝트 root 추가 | DevSpace와 bootstrap의 전체 root 목록 갱신 및 서비스 재시작; 앱 재등록 불필요 |
| 공개 hostname 또는 `/mcp` URL 변경 | ChatGPT 앱 연결 갱신 필요 |
| Owner 암호/OAuth metadata 변경 | ChatGPT 앱 재승인 또는 재연결 필요 |
| Oracle 전용 프로필 로그아웃 | 전용 브라우저에서 다시 로그인 |
| 자동화 코드 업데이트만 수행 | lifecycle install·doctor 후 Codex 앱 재시작 |

## 장애 시 중단 위치

- `DEVSPACE_EXACT_ROOT_UNAVAILABLE`: Oracle/browser를 시작하지 말고 exact root부터 등록합니다.
- local `/mcp` 실패: 터널이 아니라 DevSpace 서비스부터 복구합니다.
- public `/mcp` 실패: 고정 터널 mapping과 OS 시작 서비스를 복구합니다.
- `DEVSPACE_NATIVE_BINDING_UNAVAILABLE`: `npm install-scripts ls`에서 정확한 DevSpace
  native dependency만 검토·승인한 뒤 `better-sqlite3`를 재빌드합니다. doctor가 실제
  메모리 DB 로드에 성공하기 전에는 서비스를 시작하지 않습니다.
- 앱이 도구를 찾지 못함: 동일 URL의 MCP/OAuth 상태를 확인합니다. 자동으로 앱을
  삭제하거나 다시 만들지 않습니다. 방금 등록·재연결했다면 `post-register`를 한 번만
  실행하고 일반 Oracle 읽기 검사를 반복합니다.
- Oracle manual-login profile 미초기화: 전용 로그인만 완료합니다. 제출 전 실패는
  안전하게 pre-submit으로 정산되어야 합니다.
