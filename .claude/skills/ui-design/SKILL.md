---
name: ui-design
description: Propose the layout and copy of a new screen, menu, form field or message, settle it with the owner in as few rounds as possible, and record the decision. Use before building UI whose shape or wording is not already fixed by a docs/*-requirements.md.
---

The conventions are in `docs/project-status.md` §3 ("画面の部品と文言は、既にある型に合わせる"), each pointing at the section that owns it. This skill is the order of work. The owner's time is the bottleneck, so the aim is one round: everything they need to decide, decided from one message.

1. **Sort the decisions before drawing anything.** A choice an existing convention or an existing screen already answers is yours: make it and list it under 「既存の型で決めたこと」, so the owner can veto it without being asked. Only what is genuinely new goes to the owner.
2. **A new screen or look gets three options in the first round, never more**, visibly different in kind, not in degree: A built from existing parts only, and two that each buy something A cannot (say what). A single option costs a second round asking for alternatives; five left the card art undecided. A small choice (one field, one string, the empty state) gets no drawings, only a question with your default in step 5. If none of the three fits, ask what is missing rather than drawing a fourth.
3. **Render them in the real app where you can** (swap the component, screenshot, restore), otherwise as one mock-up page. Put the options side by side at 360px and desktop width, light and dark, with the empty state and the longest allowed value. Look at every shot yourself first: a wrapped heading or a doubled header the owner spots is a wasted round.
4. **Lead with the recommendation** and the reason each other option loses, before the pictures.
5. **Put every remaining decision in the same message**, each with your default: the option, then any sub-choice (colour, wording, what happens when empty). The owner should be able to answer "A, defaults otherwise". Include the table of every string the screen shows (heading and tab title, labels, help text, counters, success and error messages), reusing existing strings word for word.
6. **STOP and wait.** Then implement the choice without reopening what was settled.
7. **Record the decision** in the feature's `docs/<name>-requirements.md` under AGENTS.md's rules, with a line on why the losing options lost. If the decision is a pattern the next screen will meet again, add it to the `docs/project-status.md` §3 list as well, so it moves into step 1's pile next time.
