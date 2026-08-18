 # DevSpace + Tailscale Funnel 설정 가이드

 이 문서는 DevSpace MCP 서버와 Tailscale Funnel을 연동하여 웹 ChatGPT가 로컬 프로젝트에 안전하게 접근할 수 있도록 설정하는 가이드입니다.

 ## 사전 요구 사항

 - Node.js 22.16 이상, npm
 - Tailscale 계정 및 MagicDNS, HTTPS, Funnel 활성화
 - 고정 기기 도메인 (예: `your-device.your-tailnet.ts.net`)

 ## 1. 워크스페이스 검사 및 설정

 `awgpt workspace` 명령을 통해 DevSpace와 Tailscale Funnel 상태를 진단하고 설정할 수 있습니다.

 ```bash
 # 1) 현재 설정 및 진단 (읽기 전용)
 awgpt workspace doctor --root "$PWD"

 # 2) 설정 계획 미리보기 (dry-run)
 awgpt workspace setup --root "$PWD"

 # 3) 설정 적용
 awgpt workspace setup --root "$PWD" --apply
 ```

 ## 2. DevSpace 허용 루트 (allowedRoots) 원칙

 - 전체 드라이브(예: `C:\` 또는 `/`)나 상위 홈 디렉터리 전체를 등록하지 마십시오.
 - 작업에 필요한 exact project root만 등록합니다.
 - 새로운 프로젝트를 추가할 때는 기존 등록된 루트를 보존하면서 추가합니다.

