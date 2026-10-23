# Live trial result — BoxAPI `gpt-6-luna` (2026-10-23, owner-run, local, real catalog)

**Verdict: LIVE TOOL-CALL SMOKE + HOLDOUT PASSED (6/6) on the final run.** Provider-side billing was not independently checked (read the BoxAPI panel). Not enabled on the public site.

| item | value |
|---|---|
| host / model | `ai.boxapi.ir/ai/v1` · `gpt-6-luna` (bare name accepted; hackathon page lists it) |
| wire (needed by this model) | `max_completion_tokens`, no `temperature`, `reasoning_effort:"none"` (BoxAPI 400: *Function tools with reasoning_effort are not supported for gpt-6-luna in /v1/chat/completions*) |
| usage object | returned on every successful call |
| runs | 5 owner-run attempts: #1–#2 rejected (HTTP 400, parameters), #3 4/6, #4 4/6 (loop limit; scenario order + repeated tool calls), #5 **6/6** |
| final run | 18 live calls · 38,591 in / 1,161 out tokens ≈ $0.0051 (at $0.115 / $0.575 per 1M) · no refusals · no HTTP errors |
| ledger (cumulative, conservative: failed calls charged at worst case) | 74 requests · $0.0243 of the approved 100 requests / $0.25 |
| tools used live | understand_or_clarify_need, search_products, get_product_details, find_sellers_for_product, compare_sellers, advise_products, compose_seller_inquiry |
| safety scan (6 turns) | 0 false availability · 0 false contact/sent claims · 0 phone/coordinate leaks · 0 external links; the grounding validator rejected unsupported text twice (number in a model code — since fixed, and an absolute claim) |
| latency | 3.8–13.5 s per turn, one 29.9 s turn (undecided-need, 3 calls); turn deadline raised to 60 s for live |
| not done | public/admin-only exposure on Liara; more than 6 cases; Firefox/WebKit; billing cross-check |
