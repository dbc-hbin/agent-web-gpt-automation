 # Documentation

 이 문서는 TypeScript/Node.js 1.0.0 (`awgpt`) 구현을 기준으로 하는 전체 문서 색인입니다.

 ## 시작하기 및 설치

 | 문서 | 내용 |
 |---|---|
 | [README](../README.md) | 전체 개요, 3분 설치, CLI 레퍼런스, 안전 계약 |
 | [최초 설치 가이드](FIRST_INSTALL.md) | Tailscale, DevSpace, Oracle 프로필 및 ChatGPT 앱 등록 7단계 |
 | [DevSpace + Tailscale 설정](DEVSPACE_TAILSCALE_SETUP.md) | 워크스페이스 진단 및 고정 HTTPS Funnel 연동 |

 ## 운영 및 아키텍처

 | 문서 | 내용 |
 |---|---|
 | [아키텍처 개요](ARCHITECTURE.md) | 로컬 에이전트와 웹 세션 간 실행·소유권·복구 경계 |
 | [전역 ChatGPT 라우팅](GLOBAL_CHATGPT_ROUTING.md) | 작업 유형별 모드 분류 및 실행 라우팅 |
 | [초절약모드 가이드](ULTRA_ECONOMY_MODE.md) | Luna Max 로컬 지휘 + 웹 GPT 단계 분리 실행 |
 | [Phase 4: 상태 머신](PHASE4_ARCHITECTURE.md) | 워크스페이스 및 워크플로 상태 머신 규격 |
 | [Phase 5: 프로세스 감사 및 복구](PHASE5_PROCESS_RECOVERY.md) | 프로세스 감사 계약 및 exact-session 회수 |
 | [Phase 6: 진단 및 수명주기](PHASE6_DOCTOR_LIFECYCLE.md) | doctor, WAL, 영수증(receipt) 기반 수명주기 |

 ## 거버넌스 및 릴리스

 | 문서 | 내용 |
 |---|---|
 | [버전 정책](VERSIONING.md) | npm 릴리즈 및 SemVer 정책 |
 | [브랜드 가이드](BRAND.md) | 제품명 및 시각 자산 가이드 |
 | [변경 기록](CHANGELOG.md) | 릴리스별 변경 사항 |

 ## 문서 규칙

 - 제품명: **Agent Web GPT Automation**
 - npm 패키지 및 CLI: `awgpt`
 - 저장소: `agent-web-gpt-automation`
 - 현재 구현 언어: TypeScript, Node.js 22.16+
 - 운영 데이터와 내부 schema ID는 exact-session 복구를 위해 안정적으로 유지합니다.
 - 호스트명, 비밀번호, 토큰, 브라우저 프로필, 개인 프로젝트 경로를 커밋하지 않습니다.
