# Project Rules

## ABSOLUTE DO NOT TOUCH

game-data.js 내의 아래 항목들은 사용자가 직접 요청하기 전까지 절대로 수정하지 않는다:

- **prologue > narrative > shared** (사건 개요 공통 내러티브)
- **roles > culprit > briefing** (하진 비밀지령)
- **roles > innocent > briefing** (도현 비밀지령)

이 세 항목은 어떤 이유로든, 리팩터링/개선/버그수정 명목이든, 사용자의 명시적 요청 없이는 한 글자도 변경 금지.
