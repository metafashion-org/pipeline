# CLAUDE.md

The instructions for this repo are in `AGENTS.md`, shared with other coding agents. Claude Code loads it through the import below. The sections after the import apply to Claude only.

@AGENTS.md

## Writing style

Never write mannered prose. This covers chat replies, PR descriptions, docs, comments and commit titles. Every sentence states a fact, a number, a file, a command or an instruction.

Banned:

- Em-dash reversals: "It was measured — and it's small."
- Negate-then-assert: "Not a guess; a measurement."
- Punchy fragments: "That's the finding." "Done."
- Rhetorical questions: "Why does it fail? Because..."
- Groups of three used for rhythm: "every file, every route, every test".
- Summary openers: "In short:", "Put together:", "Bottom line:".
- Stakes-raising words: "critical", "the real problem", "the thing to decide".
- Metaphors standing in for a number or a mechanism.
- Talk about the reply itself: "Let me walk you through", "Here's the breakdown".

## Explanations

- Keep replies short by default: the result, then what the user has to do, if anything.
- Explain in depth only when the user asks for it.
- When the user does ask for depth, format it for fast scanning:
  - Lead with the answer in one line.
  - Use short bullet points, one idea per bullet.
  - Keep sentences under about 20 words.
  - Use bold labels to split sections (**Done**, **Not done**, **Next**).
  - Put actions the user must take in a numbered list, apart from the explanation.
  - Give one example, not several.
  - Leave out background the user doesn't need to act.
