 # 기술 변경 기록 (Changelog)

 ## 1.0.0 - TypeScript/Node.js 완전 마이그레이션 및 단일화

 - **Pure TypeScript & Node.js 1.0.0 릴리스**: Python 런타임을 완전히 대체하는 독립 TypeScript 패키지 `awgpt`를 배포했습니다.
 - **포괄적인 CLI 도구군**:
   - `awgpt doctor`: DevSpace, 프로필, 상태 파일, 프로젝트 락 통합 진단
   - `awgpt doctor --open-profile-login`: 식별자 없는 안전한 수동 로그인 창 오픈
   - `awgpt auth-preflight`: 프롬프트 제출 없는 인증 및 DOM 사전 점검
   - `awgpt auth-recover`: 메인 Chrome 쿠키에서 ChatGPT/OpenAI 쿠키만 추출·복호화하여 복구하고 실패 시 자동 원복
   - `awgpt workspace`: DevSpace 워크스페이스 및 Tailscale Funnel 진단/설정
   - `awgpt local-gate`: 셸 우회 없는 결정론적 로컬 게이트 실행 및 해시 증명
   - `awgpt install` / `update` / `rollback`: WAL 및 영수증(receipt) 기반 원자적 수명주기 관리
   - `awgpt run` / `recover` / `audit` / `stop`: exact-session 기반 단조적 세션 권위 및 프로세스 감독
 - **플랫폼 지원**: Node.js >= 22.16, macOS 및 Windows 11 완벽 지원.

