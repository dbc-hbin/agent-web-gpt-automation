 # Agent Web GPT Automation 최초 설치 가이드

 이 문서는 Node.js/TypeScript 기반 `awgpt` CLI를 사용하여 설치, 공개 주소, DevSpace, Oracle 전용 브라우저, ChatGPT 앱 등록을 한 번에 완료하는 기준 절차입니다. 순서를 바꾸면 OAuth 주소나 허용 루트가 어긋날 수 있으므로 1단계부터 순서대로 진행합니다.

 ## 핵심 요약

 - 제품 이름: **Agent Web GPT Automation**
 - 패키지 / CLI 이름: **`awgpt`**
 - 저장소: `agent-web-gpt-automation`
 - ChatGPT에 표시할 앱 이름: **`codex`** (또는 사용자 지정 이름)
 - 권장 공개 경로: **Tailscale Funnel**
 - DevSpace 기본 로컬 주소: `http://127.0.0.1:7676/mcp`
 - ChatGPT 등록 주소: 고정 HTTPS 주소의 `/mcp` (`https://<고정주소>/mcp`)

 ---

 ## 0. 공개 경로 선택

 | 경로 | 지원 수준 | 완료 조건 | 주의점 |
 |---|---|---|---|
 | **Tailscale CLI + Funnel** | **권장·자동화** | 고정 `*.ts.net` 주소와 로그인 시작 시 복구 | 이 저장소가 설정·진단하는 기준 경로 |
 | **Cloudflare named tunnel** | **수동 구성** | named tunnel과 고정 hostname, OS 서비스 등록 | 임시 `*.trycloudflare.com` URL은 금지 |
 | **ngrok static domain** | **수동 구성** | 고정 도메인과 OS 시작 서비스 등록 | 매번 바뀌는 임시 URL은 금지 |
 | **custom HTTPS proxy** | **수동 구성** | 고정 HTTPS `/mcp`, OAuth 헤더 전달, 재부팅 복구 | 구성 및 운영 책임은 사용자에게 있음 |

 저장소의 기본 권장 경로는 **Tailscale CLI + Funnel**입니다. `awgpt workspace doctor` 및 `awgpt workspace setup`은 이 경로를 기준으로 환경을 진단합니다.

 ---

 ## 1. CLI 설치 및 빌드

 ### 소스에서 전역 설치 (권장)

 ```bash
 git clone https://github.com/dbc-hbin/agent-web-gpt-automation.git
 cd agent-web-gpt-automation
 npm ci
 npm run build
 npm install -g .
 awgpt --help
 ```

 ### 영수증 기반 Agent Home 관리 파일 설치

 에이전트 홈(`~/.codex` 또는 지정 경로)에 관리 파일과 번들 스킬을 설치하려면:

 ```bash
 awgpt install --source . --agent-home "$HOME/.codex"
 awgpt doctor
 ```

 ---

 ## 2. DevSpace 및 고정 HTTPS 터널 설정

 ### Tailscale 권장 경로

 ```bash
 # 1) 설정 미리보기
 awgpt workspace setup --root "$PWD"

 # 2) 설정 적용
 awgpt workspace setup --root "$PWD" --apply
 ```

 `devspace init` 화면이 열리면 사용할 **모든 exact project root**와 public origin (`https://your-device.your-tailnet.ts.net`, `/mcp` 제외)을 입력합니다.

 ---

 ## 3. DevSpace Owner 암호 관리

 DevSpace 초기화 시 고엔트로피 Owner 암호가 생성되어 로컬 `auth.json`에 저장됩니다.

 - 생성된 암호를 즉시 암호 관리자에 안전하게 저장합니다.
 - 암호는 CLI 인자, 스크립트, Git, 이슈, 로그에 절대 복사하지 않습니다.
 - ChatGPT의 최초 OAuth 승인 웹 페이지에서만 직접 입력합니다.

 ---

 ## 4. 상주 복구 및 엔드포인트 진단

 ```bash
 awgpt doctor --project-root "$PWD" --devspace-url http://127.0.0.1:7676/mcp
 awgpt workspace doctor --root "$PWD"
 ```

 - 정상 상태의 DevSpace OAuth endpoint는 비인증 GET 요청에 `401`을 반환합니다.
 - `awgpt doctor`가 `PASS` 상태를 반환해야 합니다.

 ---

 ## 5. Oracle 전용 격리 브라우저 수동 로그인

 일상 Chrome 프로필과 분리된 수동 로그인 전용 프로필을 생성하고 엽니다.

 ```bash
 awgpt doctor --open-profile-login
 ```

 열린 브라우저 창에서 ChatGPT 로그인을 완료합니다. 실제 작업 실행 시에는 이 프로필의 임시 복제본(throwaway copy)을 사용하므로 동시 작업 간 브라우저 상태가 오염되지 않습니다.

 ---

 ## 6. ChatGPT Developer Mode 앱 수동 등록

 고정 URL, DevSpace, OAuth, Oracle 로그인이 모두 준비된 후 진행합니다.

 1. ChatGPT **Settings** → **Security and login**에서 **Developer mode**를 켭니다.
 2. ChatGPT Plugins / Apps 화면에서 **+**를 선택합니다.
 3. 앱 이름은 **`codex`** (또는 사용자 지정 이름)를 입력합니다.
 4. Connection URL에 `https://<고정주소>/mcp`를 입력합니다.
 5. 발견된 도구와 메타데이터를 확인하고 연결을 생성합니다.
 6. 표시되는 DevSpace Owner 승인 화면에서 암호를 입력하고 승인합니다.

 > [!IMPORTANT]
 > ChatGPT 앱 등록은 최초 1회 수동으로 수행하는 절차입니다. 자동화 스크립트로 ChatGPT 설정 UI를 조작하지 않습니다.

 ---

 ## 7. 일반 GPT 연결 및 작동 검증

 첫 연결 테스트에는 Pro를 소비하지 않고 일반 모델에서 `@codex` 읽기 검증을 수행합니다.

 ```bash
 # dry-run으로 미션 바인딩 및 계획 검증
 awgpt run --project-root "$PWD" --mission "$PWD/mission.md" --dry-run
 ```

 인증 상태를 사전 점검하려면:

 ```bash
 awgpt auth-preflight --copy-profile "$HOME/.oracle/login-profiles/manual-login-..."
 ```

 만약 격리 프로필의 로그인이 풀렸다면 메인 Chrome 쿠키에서 안전하게 복구할 수 있습니다:

 ```bash
 awgpt auth-recover --copy-profile "$HOME/.oracle/login-profiles/manual-login-..."
 ```

