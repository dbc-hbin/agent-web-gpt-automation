# Documentation

이 문서는 TypeScript/npm 1.0.0 구현을 기준으로 하는 독립 문서 색인입니다.

## 시작하기

| 문서 | 내용 |
|---|---|
| [README](../README.md) | 설치, 실행, 기능 상태 |
| [Architecture](ARCHITECTURE.md) | 실행, 소유권, 복구 경계 |
| [Phase 4](PHASE4_ARCHITECTURE.md) | 워크플로 상태 머신 |
| [Phase 5](PHASE5_PROCESS_RECOVERY.md) | 프로세스 감사와 exact-session 복구 |
| [Phase 6](PHASE6_DOCTOR_LIFECYCLE.md) | doctor와 lifecycle 계약 |
| [Versioning](VERSIONING.md) | npm 릴리즈 버전 정책 |
| [Brand guide](BRAND.md) | 이름과 시각 자산 |

## 문서 규칙

- 제품명: **Agent Web GPT Automation**
- npm 패키지 및 CLI: `awgpt`
- 저장소: `agent-web-gpt-automation`
- 현재 구현 언어: TypeScript, Node.js 22.16+
- 운영 데이터와 내부 schema ID는 exact-session 복구를 위해 안정적으로 유지합니다.
- 호스트명, 비밀번호, 토큰, 브라우저 프로필, 개인 프로젝트 경로를 커밋하지 않습니다.
