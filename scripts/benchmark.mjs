/* Repeatable, non-gating v2.0.0 benchmark. It measures the built runtime in a
   fresh VM without network access. Numbers are indicative; structural limits
   belong to tests/scalability.ts so ordinary correctness runs are not timing
   sensitive. */
import { readFileSync } from "node:fs";
import { hrtime } from "node:process";
import { runInNewContext, createContext } from "node:vm";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const sourceRoot = join(root, "dist", "src");
const context = createContext({ console });
[
  "tokenizer.js", "catalogue.js", "dialects.js", "lineage.js",
  "analysis/confidence.js", "ir.js", "columns.js", "columnflow.js",
  "exporters.js"
].forEach((file) => {
  runInNewContext(readFileSync(join(sourceRoot, file), "utf8"), context,
    { filename: file });
});

function elapsed(fn) {
  const start = hrtime.bigint();
  const value = fn();
  const ms = Number(hrtime.bigint() - start) / 1e6;
  return { value, ms: Math.round(ms * 1000) / 1000 };
}

function repeatedSql(target) {
  const prefix = "SELECT id, status FROM dbo.benchmark_source WHERE id > 0 /* ";
  const suffix = " */;";
  return prefix + " ".repeat(Math.max(0, target - prefix.length - suffix.length)) + suffix;
}

function graphFor(count, cls = "stmt") {
  const nodes = [];
  const edges = [];
  for (let i = 0; i < count; i++) {
    nodes.push({ id: `bench-${cls}-${i}`, shape: "rect", text: `${cls} ${i}`,
      cls, source: null, provenance: "synthetic" });
  }
  for (let i = 1; i < count; i++) {
    edges.push({ from: nodes[i - 1].id, to: nodes[i].id, label: "next",
      style: "solid", kind: "dependency" });
  }
  return { nodes, edges, stats: { nodes: count, edges: edges.length } };
}

function measureSql(target) {
  const sql = repeatedSql(target);
  const tokens = elapsed(() => context.tokenize(sql));
  const analysis = elapsed(() => context.analyse(sql,
    { dialect: "tsql", mode: "auto", group: false, sources: true }));
  const graph = analysis.value.graph;
  const mermaid = elapsed(() => context.toMermaid(graph, "TD"));
  const layout = elapsed(() => context.layoutAnalysis(graph, "TD"));
  const drawio = elapsed(() => context.toDrawio(graph, { title: `sql-${target}` }));
  return {
    inputBytes: sql.length,
    tokens: tokens.value.length,
    tokenizationMs: tokens.ms,
    analysisMs: analysis.ms,
    graphNodes: graph.nodes.length,
    graphEdges: graph.edges.length,
    mermaidMs: mermaid.ms,
    drawioMs: drawio.ms,
    layoutMs: layout.ms,
    layoutOverlaps: layout.value.overlaps,
    layoutCrossings: layout.value.crossings
  };
}

function measureEstate() {
  const newline = String.fromCharCode(10);
  const text = Array.from({ length: 100 }, (_, i) =>
    `CREATE VIEW dbo.benchmark_view_${i} AS SELECT id FROM dbo.benchmark_source_${i};`)
    .join(newline);
  const estate = elapsed(() => context.analyseEstate(
    [{ name: "benchmark-100.sql", text }],
    { dialect: "tsql", mode: "auto", group: false, sources: true }));
  const mermaid = elapsed(() => context.toMermaid(estate.value.graph, "TD"));
  const drawio = elapsed(() => context.toDrawio(estate.value.graph,
    { title: "benchmark-estate" }));
  return {
    objects: estate.value.objects.length,
    graphNodes: estate.value.graph.nodes.length,
    graphEdges: estate.value.graph.edges.length,
    analysisMs: estate.ms,
    mermaidMs: mermaid.ms,
    drawioMs: drawio.ms
  };
}

function measureGraph(count, cls = "stmt") {
  const graph = graphFor(count, cls);
  const layout = elapsed(() => context.layoutAnalysis(graph, "TD"));
  const mermaid = elapsed(() => context.toMermaid(graph, "TD"));
  const drawio = elapsed(() => context.toDrawio(graph,
    { title: `benchmark-${cls}-${count}` }));
  return { nodes: count, edges: graph.edges.length, layoutMs: layout.ms,
    mermaidMs: mermaid.ms, drawioMs: drawio.ms,
    overlaps: layout.value.overlaps, crossings: layout.value.crossings };
}

const reportGraph = graphFor(25, "dsembedded");
reportGraph.nodes.unshift({ id: "report-1", shape: "rect", text: "Report 1",
  cls: "report", source: null, provenance: "synthetic" });
const reportLayout = elapsed(() => context.layoutAnalysis(reportGraph, "TD"));
const reportExport = elapsed(() => context.toDrawio(reportGraph,
  { title: "benchmark-report-25-datasets" }));

const output = {
  version: "2.0.0",
  note: "Indicative local timings; no thresholds or telemetry.",
  sql: [measureSql(100_000), measureSql(500_000)],
  estate100: measureEstate(),
  graphs: [100, 250, 500].map((count) => measureGraph(count)),
  report25Datasets: {
    datasets: 25,
    graphNodes: reportGraph.nodes.length,
    layoutMs: reportLayout.ms,
    drawioMs: reportExport.ms,
    overlaps: reportLayout.value.overlaps,
    crossings: reportLayout.value.crossings
  }
};
console.log(JSON.stringify(output, null, 2));
