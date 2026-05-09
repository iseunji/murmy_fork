# Project Rules

## ABSOLUTE DO NOT TOUCH

game-data.js 내의 아래 항목들은 커맨더가 직접적으로 말하기 전에 절대로 임의로 건드리지 않는다:

- **prologue > narrative > shared** (사건 개요 공통 내러티브)
- **roles > culprit > briefing** (하진 비밀지령)
- **roles > innocent > briefing** (도현 비밀지령)

이 세 항목은 어떤 이유로든, 리팩터링/개선/버그수정/줄바꿈 조정/시간 표기 변경/문체 수정 명목이든, 커맨더의 직접적이고 명시적인 요청 없이는 한 글자도 변경 금지.
