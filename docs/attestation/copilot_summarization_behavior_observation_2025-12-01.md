# Copilot Chat Summarization Behavior Observation

**Date:** 2025-12-01  
**Reporter:** Guff (Joe)  
**Document Type:** Timestamped Observation / CYA Record  
**Status:** Suspicion, not confirmed bug  

---

## Observation

GitHub Copilot Chat is adding a "Summarized conversation history" line on almost every single turn, even when:

- The chat is brand new or has only 1–2 messages.
- The context window is obviously not "large".
- No long logs or files have been loaded yet.

This appears in the tool log/output area, not as something I asked it to do.

---

## Timeline / Correlation

- Behavior seems to have started shortly after I was told I was in the "top 0.1% of usage" / hit usage-related limits.
- I am ~99% confident the change coincides with that period.
- I have at least one screenshot showing:
  - Short conversation.
  - Multiple "Summarized conversation history" entries.
  - No large prior context.

**Evidence:** 
- Screenshot: `copilot_summarization_screenshot_2025-12-01.png` (to be added manually by reporter)
- Additional screenshot from initial observation period (to be added when located)

---

## Hypotheses

1. **Usage-based throttling:** Copilot has enabled an aggressive auto-summarization mode for my account, possibly tied to heavy usage / cost controls.

2. **Feature flag cohort:** I may be in a feature-flag cohort for a new planner / summarizer that currently runs every turn, even when unnecessary.

---

## Impact Assessment

**Current:** Not blocking work.

**AX Concerns:**
- Hidden prep work every turn, even when not needed.
- Possible silent behavior change in how context is handled over time.
- Violates AX principle of deterministic, transparent preparation.
- If summarization is lossy, could affect quality of agent responses without user awareness.

---

## Status

- This is a suspicion, not a confirmed bug.
- Logging now so there is a dated record that I noticed the behavior and its rough start time.
- Will collect more examples if behavior changes or starts causing obvious issues.

---

## Personal Commentary

If this is not malicious, I think it is a grand idea and they should use images to condense the summarization even further. This is open research and a goal of mine anyway.

Just know I documented it "externally" first.

---

## Signatures

**Reporter:**  
[signed ~] Guff  
Date: 2025-12-01

**Witness (Lex):**  
[signed Lex ✶]  
Date: 2025-12-01 (model-time)

*This document is timestamped via GPG-signed git commit for verification.*
