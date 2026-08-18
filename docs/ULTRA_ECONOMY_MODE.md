 # 초절약모드 가이드 (Ultra Economy Mode)

 초절약모드는 로컬 에이전트(Codex 등)의 모델 비용을 최소화하면서, 복잡한 설계·구현·검토는 웹 ChatGPT 세션에 격리 위임하는 실행 모드입니다.

 ## 동작 원리

 ```text
 로컬 지휘관 (Luna Max)
   ├─ exact root 자격 검증
   ├─ 최소 미션·영수증·상태 관리
   └─ 최종 결정론적 로컬 게이트 검증

 웹 ChatGPT 세션
   ├─ 설계 (Plan / Architecture)
   ├─ 구현 (Edit / Implementation)
   └─ 검토 (Review / Verification)
 ```

 ## 활성화 방법

 작업 시작 시 프롬프트 또는 스킬을 통해 요청합니다:

 ```text
 $ultra-economy-mode 초절약모드로 이 작업을 진행해줘.
 ```

 1. 로컬 지휘관은 최초 1회 `GPT-5.6 Luna` / reasoning effort `Max` 선택을 안내합니다.
 2. 사용자가 확인하면 이후 동일 작업에서는 재확인 없이 경제적인 실행 파이프라인을 유지합니다.

