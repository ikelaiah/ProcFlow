# v1.14.0 scalability evidence

Run the repeatable benchmark after compiling the checked-in runtime:

```text
npm run build
npm run benchmark
```

The command measures tokenization, semantic analysis, Mermaid generation,
draw.io generation, and deterministic layout for 100 KB and 500 KB SQL input;
a 100-object estate; 100-, 250-, and 500-node dependency graphs; and a
25-dataset report-shaped graph. It prints indicative wall-clock timings and
does not submit input or write telemetry. Timing is intentionally not part of
the normal correctness gate because browser and runner variation is expected.

The v1.14.0 reference run on the release development machine was:

| Case | Result |
|---|---:|
| 100 KB tokenization / analysis | 3.5 ms / 14.3 ms |
| 500 KB tokenization / analysis | 5.8 ms / 8.3 ms |
| 100-object estate analysis | 59.1 ms |
| 500-node layout / draw.io export | 148.0 ms / 155.9 ms |
| 25-dataset-shaped layout / draw.io export | 4.6 ms / 2.8 ms |

These numbers are indicative rather than a compatibility promise. The
structural regression suite in `tests/scalability.ts` is the release guard: it
asserts input is not truncated, output is deterministic, layouts have no node
overlaps on the bounded fixtures, and every realistic-corpus dialect remains
attributed and visible when unresolved.

The editor safeguard uses a documented 100,000-character threshold. Below it,
the existing 350 ms automatic refresh remains unchanged. At or above it,
editing pauses automatic analysis and shows a notice; **Refresh** still runs
the analysis explicitly and never discards the source.
