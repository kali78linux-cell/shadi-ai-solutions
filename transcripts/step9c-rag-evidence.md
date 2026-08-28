# STEP 9C — RAG Investigation Evidence

Read-only diagnostic. Harness: `scripts/step9c-rag-diagnose.mjs` (demo-dental-clinic
`c92da4ab-9a27-a35c-ec35-f511c0110811`). No writes, no appointments, no schema/migration/RLS/code changes.

## Provider / data
- Active provider: `gemini`; `embed()` supported; **query embeddings = 1536 dims** (valid).
- `clinic_ai_knowledge` for demo = 15 rows, but content is **duplicated**: e.g.
  `ba4d6aa4` & `e2ca46fa` = identical "خدماتنا…"; `dd90c551` & `d36604ca` = identical "عيادة ديمو…".
  ~6 unique FAQ/placeholder pieces repeated 2× (plus 3 `doc_chunk` placeholders).
- KB content is **administrative FAQ only** (services/prices, hours, booking/cancel policy,
  arrival instructions) + placeholders. **No dental-hygiene/"prevention" knowledge.**

## Per-layer evidence (3 queries)

### Q1 — service_in_kb: «بدي أعرف أسعار تنظيف الأسنان عندكم»
- keyword: 4 rows, kwScore 0.17–0.33, similarity=`null` (keyword path never sets similarity).
- vector/RPC threshold 0.78: 2 rows **sim=0.8164** (above threshold) → PASS.
- direct RPC (threshold 0.0): best sim=0.8164; next 0.689, 0.604, 0.55 …
- hybrid: carries the 0.8164 pair (vectorScore 0.8164, corpus-hybrid=0.6215).
- ranking: dedups the duplicate pair → **1 kept**, rankingScore=0.8164, **confidence=0.6694**.
- assembleContext(0.7): **1 chunk, 1 citation, totalTokens=23, hasSufficientContext=FALSE**
  (0.6694 < 0.7).

### Q2 — knowledge_in_kb: «شو إجراءات الوقاية من تسوس الأسنان»
- keyword: 2 rows kwScore=0.25 (weak; no stemming for Arabic).
- vector/RPC 0.78: **0 rows**; direct RPC best sim=0.6211 (< 0.78).
- hybrid: keyword-only (vectorScore 0), hybrid ≤0.075.
- ranking: **0 kept** (kw<0.35, sim<0.75).
- assembleContext: 0 chunks / 0 citations / hasSufficientContext=false.
- ⇒ The prevention content does NOT exist in the demo KB (best possible vector sim 0.62).

### Q3 — not_in_kb: «…جراحة الفم والفكين… الفرع الثاني…»
- vector best sim=0.6218 (<0.78) → 0 accepted; ranking 0 kept; 0 chunks/citations. Correct.

## Root-cause facts
1. **Content/data gap (primary):** the demo KB has no content answering the Phase 1B
   "clinic knowledge" (prevention) or "anti-hallucination" (NewTom) queries. Even at
   threshold 0.0 the best vector similarity for those is ≈0.62, so every layer correctly
   returns 0. This alone explains 0 citations in Phase 1B for those turns.
2. **Real code defect — threshold inconsistency (affects the LIVE path):**
   - `hybridSearchClinic`/RPC uses `MATCH_THRESHOLD = 0.78` (`retrieval.ts`), and
     `assembleContext` uses a default `confidenceThreshold = 0.7` (`contextAssembly.ts`).
   - `computeConfidenceScore` (`ranking.ts`) penalizes with `countFactor = min(1, n/5)`;
     with only 2 results this drops a strong 0.8164 → **0.6694**, which is *below* the 0.7
     assembly threshold, so `hasSufficientContext=false` even for the strongest match.
   - `orchestrator.ts:425` and `streamingOrchestrator.ts:88` both call
     `retrieveContext(clinicId, text, 5)` **without passing the clinic-configured
     confidence_threshold (0.25)** — so retrieval always runs against the hard-coded 0.7.
   - Non-streaming orchestrator then **re-derives** `hasSufficientContext` with the clinic
     threshold 0.25 → would accept Q1's chunk. But **streamingOrchestrator.ts:109** uses the
     internal `assembled.hasSufficientContext` (from 0.7) → **would reject Q1 and return
     "لا أملك معلومات"** despite a 0.8164 chunk existing. This is a genuine bug in the
     streaming path used by the live UI.
3. **Keyword recall is weak for Arabic** (naive space-split + len>2, no stemming): kw scores
   0.125–0.33, so keyword cannot rescue queries when vector fails.

## Severity
- Content gap: data/coverage, not a code crash.
- Threshold/countFactor defect: medium — it silently suppresses RAG grounding in the
  streaming path (answers "unavailable" instead of grounding), and causes inconsistent
  behavior between streaming and non-streaming paths.
