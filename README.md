<p align="center">
  <img src="docs/assets/brand/banner.svg" alt="Agent Web GPT Automation" width="100%">
</p>

<p align="center">
  <a href="https://github.com/dbc-hbin/agent-web-gpt-automation/actions/workflows/release-portability.yml"><img alt="CI" src="https://github.com/dbc-hbin/agent-web-gpt-automation/actions/workflows/release-portability.yml/badge.svg"></a>
  <a href="LICENSE"><img alt="License" src="https://img.shields.io/github/license/dbc-hbin/agent-web-gpt-automation"></a>
  <img alt="Runtime" src="https://img.shields.io/badge/Node.js-%3E%3D22.16-339933">
  <img alt="Platforms" src="https://img.shields.io/badge/platform-Windows%20%7C%20macOS-334155">
  <img alt="CLI" src="https://img.shields.io/badge/CLI-awgpt-8B5CF6">
</p>

<p align="center">
  <strong>웹 ChatGPT 세션의 상태·소유권·복구를 안전하게 다루는 TypeScript CLI</strong>
</p>

<p align="center">
  <a href="docs/README.md">문서 전체 보기</a> ·
  <a href="docs/README.md">문서 색인</a>
</p>

> [!IMPORTANT]
> 이 저장소는 커뮤니티 프로젝트이며 OpenAI, Oracle 또는 DevSpace의 공식 제품이
> 아닙니다. ChatGPT 로그인과 DevSpace 권한 승인은 사용자가 직접 관리해야 하며,
> 브라우저 프로필·토큰·Owner 암호를 저장소나 로그에 넣으면 안 됩니다.

이 배포물은 **Node.js/TypeScript 1.0.0 전용 구현**입니다. Python 운영 정책과
호스트 통합 지침은 `AGENTS.md`에 남아 있으며, 이 패키지의 런타임은 TypeScript로
단일화되어 있습니다.

## 왜 awgpt를 쓰나요?

| Guarded | Recoverable | Evidence-based | Cross-platform |
|---|---|---|---|
| exact project root와 mission identity를 상태와 receipt에 고정합니다. | 중단된 작업을 새로 제출하지 않고 저장된 exact slug로 관찰·회수합니다. | 종료 코드만 믿지 않고 receipt, hash, durable output과 session authority를 검증합니다. | 같은 TypeScript 코드와 npm 게이트를 Windows와 macOS에서 검증합니다. |

`awgpt`는 [Oracle](https://github.com/steipete/oracle) 세션과
[DevSpace](https://github.com/Waishnav/devspace) 연결을 위한 상태·진단·복구
구성요소를 제공합니다. `run`은 exact root를 먼저 확인한 뒤 Oracle을 한 번
실행하고, 결과를 receipt/state/output으로 검증합니다. 핵심 목적은 편리한 재시도보다
**중복 제출 방지, 정확한 소유권, 안전한 복구**를 우선하는 것입니다.

```text
실행 경로
  └─ exact project root + UTF-8 mission + SHA-256
       └─ Oracle 브라우저 세션 → 웹 ChatGPT
            └─ DevSpace → 승인된 exact root만 접근
                 └─ receipt/state/output 검증 → 다음 단계 또는 attention_required
```

## 현재 구현 상태

현재 `1.0.0` TypeScript 기반에는 다음 기능이 구현되어 있습니다.

- `StateStore`: atomic JSON write, append-only receipt chain, 최신 receipt와 상태 일치 검증
- `LockManager`: 프로젝트별 단일 소유자, owner token 검증, 명시적 settled evidence 기반 회수
- `StageGate`와 workflow FSM: 합법적인 단계 전이, input/output SHA-256 chain, exact binding 검증
- `ProcessSupervisor`: POSIX process group과 Windows process tree 추적, 4,800초 audit-only 계약
- `ProfileManager`: 수동 로그인 seed의 throwaway copy, symlink 거부, 제한된 파일 권한
- `doctor`: DevSpace endpoint/profile/state/project lock 진단과 한 번에 하나의 안전한 복구 동작
- `auth-preflight`: 제출 없이 ChatGPT 인증·composer·model·thinking DOM 확인
- `auth-recover`: 메인 Chrome에서 ChatGPT/OpenAI 쿠키 행만 가져와 seed 로그인을 검증하고 실패 시 원복
- `install`/`update`/`rollback`: manifest, WAL, receipt, hash 충돌 보존 lifecycle
- 저장된 run state가 있을 때 `doctor --recover`가 선택하는 exact-session
  live/harvest recovery와 fail-closed no-submission evidence 판별

> [!NOTE]
> `run`은 신규 Oracle workflow를 실제로 실행합니다. 제출 전 DevSpace exact-root
> qualification이 실패하면 Oracle 프로세스를 시작하지 않습니다. npm registry
> publish는 아직 수행하지 않았으므로 아래 소스 설치 경로를 사용하세요.

## 요구 사항

- Node.js 22.16 이상
- npm
- Chrome 또는 Chromium 계열 브라우저
- exact-session 복구에는 별도로 설치·로그인된 Oracle 필요
- DevSpace 진단에는 실행 중인 MCP endpoint 필요

[release-portability CI](https://github.com/dbc-hbin/agent-web-gpt-automation/actions/workflows/release-portability.yml)는
`windows-latest`와 `macos-14`에서 Vitest, TypeScript build, CLI help, `npm pack`을
실행합니다. 실제 ChatGPT 계정이나 브라우저 프로필을 사용하는 외부 E2E는 공개
CI에서 실행하지 않습니다.

## 소스에서 설치

```sh
git clone https://github.com/dbc-hbin/agent-web-gpt-automation.git
cd agent-web-gpt-automation
npm ci
npm run build
npm install -g .
awgpt --help
```

전역 설치 없이 바로 확인하려면 다음 명령을 사용합니다.

```sh
node dist/index.js --help
node dist/index.js doctor --help
```

Windows PowerShell에서 실행 정책이 `npm.ps1`을 차단하면 `npm.cmd`와
`npx.cmd`를 사용하세요.

## 최초 진단 순서

### 1. 수동 로그인용 격리 프로필 열기

```sh
awgpt doctor --open-profile-login
```

명령은 일반 ChatGPT 로그인 URL과 새 `profile_path`를 JSON으로 출력하고 Chrome을
엽니다. 해당 창에서 사용자가 직접 로그인한 뒤 출력된 경로를 보관합니다. URL에는
프로젝트 경로, run ID, token 또는 exact slug가 포함되지 않습니다.

### 2. DevSpace와 로컬 상태 점검

```sh
awgpt doctor \
  --project-root "$PWD" \
  --copy-profile "$HOME/.oracle/login-profiles/manual-login-..." \
  --devspace-url http://127.0.0.1:7676/mcp
```

`doctor`는 다음 순서로 fail-closed 점검합니다.

1. DevSpace MCP endpoint 응답
2. 수동 로그인 profile seed의 필수 파일
3. 명시하거나 기본 state 경로에서 발견한 Oracle run/workflow state; workflow라면 receipt chain
4. exact project lock 소유권

출력은 `codex.chatgpt.agent-web-gpt-doctor/v1` JSON입니다.

| 상태 | 종료 코드 | 의미 |
|---|---:|---|
| `PASS` | `0` | 요청된 진단이 통과함. 웹 task 성공을 뜻하지는 않음 |
| `FAIL` | `1` | malformed state, I/O 또는 계약 위반처럼 먼저 고쳐야 할 오류 |
| `BLOCKED` | `2` | 로그인, DevSpace, lock owner 또는 exact recovery 관찰이 필요함 |

### 3. 제출 없는 인증 프리플라이트

```sh
awgpt auth-preflight \
  --copy-profile "$HOME/.oracle/login-profiles/manual-login-..."
```

원본 profile을 직접 사용하지 않고 throwaway copy를 만든 다음 ChatGPT 인증 endpoint와
composer/model/thinking DOM을 확인합니다. 프리플라이트는 prompt를 입력하거나 제출하지
않으며, 완료 후 임시 profile을 정리합니다.

### 4. 로그인이 풀렸을 때 메인 Chrome 쿠키로 복구

메인 Chrome에는 로그인되어 있지만 awgpt seed만 로그아웃된 경우 다음 명령을
사용합니다.

```sh
awgpt auth-recover \
  --copy-profile "$HOME/.oracle/login-profiles/manual-login-..."
```

기본 Chrome user-data 경로와 마지막 사용 profile을 자동으로 찾습니다. 다른 위치나
profile을 사용한다면 명시할 수 있습니다.

```sh
awgpt auth-recover \
  --copy-profile "$HOME/.oracle/login-profiles/manual-login-..." \
  --chrome-user-data "$HOME/Library/Application Support/Google/Chrome" \
  --chrome-profile "Profile 1"
```

이 명령은 source Cookies SQLite를 일관된 snapshot으로 읽고 `chatgpt.com` 및
`openai.com` cookie 행과 복호화에 필요한 `os_crypt` key metadata만 seed에
적용합니다. 다른 사이트 cookie는 가져오지 않습니다. 이후 throwaway copy에서
`/backend-api/me` 로그인을 검사하며, 실패하거나 Chrome이 cookie를 복호화하지
못하면 seed의 Cookies와 Local State를 원본 그대로 복원합니다. Cookie 값은 JSON
출력이나 로그에 기록하지 않습니다. 복구 대상 seed를 사용 중인 Chrome 창은 먼저
닫아야 합니다.

## CLI 명령

| 명령 | 현재 역할 |
|---|---|
| `awgpt doctor` | DevSpace, profile, 상태, exact project lock 진단 |
| `awgpt doctor --recover` | 한 번에 하나의 안전한 다음 복구 동작 수행 또는 안내 |
| `awgpt doctor --open-profile-login` | 식별자가 없는 일반 ChatGPT 로그인 창과 격리 profile 생성 |
| `awgpt auth-preflight` | throwaway profile에서 인증 및 필수 UI 증거 확인 |
| `awgpt auth-recover` | 메인 Chrome의 ChatGPT/OpenAI cookie만 seed로 가져오고 로그인 검증·실패 원복 |
| `awgpt install` | `install-manifest.json` 파일을 agent home에 WAL/receipt와 함께 설치 |
| `awgpt update` | 기존 파일을 백업한 뒤 hash 검증과 함께 갱신 |
| `awgpt rollback` | 마지막 또는 지정 receipt를 사용해 변경되지 않은 파일만 복원 |
| `awgpt run` | exact root/mission을 검증하고 Oracle을 한 번 실행 |
| `awgpt recover` | 저장된 state의 exact slug를 `live` 관찰 또는 `harvest` 회수 |
| `awgpt audit` | Oracle을 실행하지 않고 no-submission evidence 확인 |
| `awgpt stop` | 소유권과 live 상태가 확인된 경우에만 기록된 프로세스 중지 |

각 명령의 실제 옵션은 설치된 버전에서 확인하세요.

```sh
awgpt doctor --help
awgpt auth-preflight --help
awgpt auth-recover --help
awgpt install --help
awgpt rollback --help
awgpt run --help
awgpt recover --help
```

`run`은 `--project-root`와 `--mission`을 필수로 받고, `--run-root`, `--manifest`,
`--oracle-home`, `--oracle-command`, 반복 가능한 `--oracle-arg`, `--devspace-url`을
선택적으로 받습니다. `--oracle-command`를 생략하면 PATH의 `oracle`을 사용합니다.
`recover`는 `--state`와 `--action live|harvest`만 받으며 저장된 command/slug 외의
prompt·restart 인자를 받지 않습니다. 4,800초 audit 시점은 종료 deadline이 아니며,
elapsed time만으로 kill·lock 해제·재제출을 하지 않습니다.

## 복구 계약

세션 권위는 아래 허용 간선으로만 진행합니다.

```text
pre_submit ─┬→ submitted_unknown ─→ terminal_observed ─→ settled
            ├→ live ──────────────→ terminal_observed ─→ settled
            ├→ terminal_observed
            └→ settled
```

- `submitted_unknown`은 실패나 미제출로 자동 간주하지 않습니다.
- `terminal_observed`는 다시 `live`로 낮아질 수 없습니다.
- 4,800초는 상태를 감사하는 시점일 뿐 timeout이나 kill 조건이 아닙니다.
- elapsed time만으로 lock을 해제하거나 새로운 submission을 만들지 않습니다.
- 복구는 저장된 Oracle command와 exact slug만 사용하며 prompt/restart 인자를 허용하지 않습니다.
- v1 terminal output은 비어 있지 않고 정확히 하나의
  `TASK_OUTCOME: EXECUTED|NOT_EXECUTED|BLOCKED` marker를 가져야 합니다. Marker 뒤에는
  단일 행 HTTP(S) Markdown reference definition만 허용됩니다.
- observer가 충돌하면 동일한 project lock 아래 `attention_required`로 남깁니다.

## 설치·업데이트·롤백

`install-manifest.json`이 있는 저장소 루트에서 agent home으로 관리 파일을 설치할
수 있습니다.

```sh
awgpt install --source . --agent-home "$HOME/.codex"
awgpt update --source . --agent-home "$HOME/.codex"
awgpt rollback --agent-home "$HOME/.codex"
```

lifecycle은 설치 전 backup과 write-ahead log를 만들고, 파일별 SHA-256과 action을
receipt에 기록합니다. rollback 시 설치 이후 사용자가 수정한 파일은 덮어쓰지 않고
`CONFLICT`로 보존합니다. 경로 탈출과 symlink destination은 거부합니다.

> [!CAUTION]
> npm 전역 설치와 `awgpt install --agent-home`은 목적이 다릅니다. 전자는 CLI 실행
> 파일을 npm prefix에 설치하고, 후자는 manifest가 소유하는 파일을 지정한 agent
> home에 receipt 기반으로 배치합니다. 전역 설치 위치를 lifecycle `--source`로
> 자동 추론하지 않으므로 lifecycle 예시는 저장소 checkout 루트에서 실행하세요.

## 개발과 검증

```sh
npm ci
npx tsc --noEmit
npm run test:run
npm run build
node dist/index.js --help
npm pack --dry-run
```

현재 contract suite는 state/receipt consistency, lock ownership, legal FSM edges,
exact-slug monotonicity, process audit, profile safety, doctor JSON, lifecycle crash
recovery와 package identity를 검증합니다.

## 안전 계약

- 한 프로젝트에는 활성 또는 불확실한 submission owner를 하나만 둡니다.
- DevSpace를 실제 workflow에 연결하는 caller는 parent/child/similar-name 대체 없이
  allowed root의 exact equality를 별도로 확인해야 합니다. 현재 `doctor`는 endpoint만
  probe하며 DevSpace 설정의 allowed-roots 목록을 검증하지 않습니다.
- 원본 수동 로그인 profile에 credential이나 cookie를 다시 쓰지 않습니다.
- provider exit code만으로 task 성공이나 실패를 판정하지 않습니다.
- 제출 후 오류는 기존 run/slug를 유지하며 자동 재제출하지 않습니다.
- modified destination, unrelated configuration과 credential-bearing state를 보존합니다.
- Pro 사용이나 외부 계정·앱 설정 변경은 사용자의 명시적 승인 없이 수행하지 않습니다.

보안 문제는 공개 이슈 대신 [SECURITY.md](SECURITY.md)의 비공개 신고 절차를
사용하세요.

## 브랜치와 문서

| 항목 | 위치 |
|---|---|
| TypeScript/npm 구현 | `main` |
| 문서 인덱스 | [docs/README.md](docs/README.md) |
| 아키텍처 | [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) |
| 상태 머신 | [docs/PHASE4_ARCHITECTURE.md](docs/PHASE4_ARCHITECTURE.md) |
| 프로세스와 복구 | [docs/PHASE5_PROCESS_RECOVERY.md](docs/PHASE5_PROCESS_RECOVERY.md) |
| doctor/lifecycle | [docs/PHASE6_DOCTOR_LIFECYCLE.md](docs/PHASE6_DOCTOR_LIFECYCLE.md) |
| 구현 상태 | TypeScript 1.0.0 패키지와 `docs/`의 현재 문서 |
| 버전 정책 | [docs/VERSIONING.md](docs/VERSIONING.md) |
| 기여 가이드 | [CONTRIBUTING.md](CONTRIBUTING.md) |

공통 wire contract와 JSON schema만 `contracts/`에 유지합니다. Python 또는
PowerShell 런타임 파일을 `main`에 다시 추가하지 않습니다.

## 버전과 라이선스

현재 패키지명과 CLI 이름은 `awgpt`, 버전은 `1.0.0`입니다. npm registry publish는
별도 릴리즈 단계이며, publish 전까지 Git checkout과 생성한 tarball이 권위 있는
배포물입니다.

[MIT License](LICENSE). Oracle, DevSpace 및 npm 의존성의 저작권·라이선스는
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)에 정리되어 있습니다.
