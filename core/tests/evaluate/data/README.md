# Authored long dictations

`cleanup_long_cases.jsonl` contains fifteen fictional dictations written for this
evaluation. None is copied from the owner's private cases, transcripts or results.
The subjects, people, amounts, decisions and conditions are invented test data.
Unlike the private baseline sets, this synthetic set is intentionally versioned.

Each dictation has three topics, fillers, a correction or change of mind, loosely
spoken enumerations, and details that must survive editing. `expected_facts` is a
semantic inventory floor; `must_contain` supplies conservative literal anchors.
The judge must include every declared fact ID and may add other intended input
facts. It must assess whole facts, including all conditions and negations.

`structure` declares topics, diagnostic anchors, a minimum numbered-item count,
an opening statement of purpose, and distinct paragraph blocks for each topic.
The judge scores lead sentence, topic separation and formatting of every
enumeration. Deterministic checks also count paragraphs and list lines; literal
topic-to-paragraph mappings are evidence, not a substitute for semantic review.
The paragraph minimum includes the opening paragraph plus the topic blocks.

The duration estimate counts each Chinese character, English word and number as
one speech unit, at an explicit 220 units per minute. The scripts estimate about
2.8–3.3 minutes each, within the requested 2–5 minutes. These are text scripts,
not recorded audio or measured speech durations. They intentionally remain
below the production 1500-character chunk size so this comparison measures one
complete cleanup request rather than introducing a separate chunking experiment.

From `core/`, add `tests/evaluate/data/cleanup_long_cases.jsonl` as the third
`--cases` path to `python -m raphael_core.evaluate.cleanup_compare`. The complete
run contains the integrator's 76 private cases plus these 15 synthetic cases.
Results still belong under the ignored `eval/data/`, never beside this fixture.
The output includes overall fact/clarity measures and separate structure counts
for the fifteen annotated long cases. No candidate is automatically installed.
