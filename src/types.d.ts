/* Shared compile-time model for Procflow's ordered browser scripts. */

type Dialect = 'tsql' | 'db2' | 'plpgsql' | 'sqlite';
type DialectChoice = Dialect | 'auto';
type DiagramDirection = 'TD' | 'LR';
type DiagramMode = 'auto' | 'flow' | 'query';
type DiagnosticSeverity = 'error' | 'warning' | 'info';
type DiagnosticScope = 'document' | 'region';
type NodeProvenance = 'source' | 'external' | 'synthetic';
type EdgeKind = 'control' | 'exception' | 'data' | 'dependency' | 'call';
type QueryReferenceRole = 'read' | 'write' | 'call' | 'produce';
type QueryResolution = 'exact' | 'heuristic' | 'opaque';

interface SourceSpan {
  start: number;
  end: number;
}

interface Diagnostic {
  severity: DiagnosticSeverity;
  code: string;
  message: string;
  span: SourceSpan | null;
  scope?: DiagnosticScope;
}

type TokenType = 'word' | 'op' | 'str' | 'num' | 'dollar';

interface Token {
  type: TokenType;
  v: string;
  u: string;
  nl: boolean;
  pos: number;
  end: number;
}

interface TokenList extends Array<Token> {
  diagnostics?: Diagnostic[];
}

type StringSet = Record<string, 1 | undefined>;

interface DialectScores {
  tsql: number;
  db2: number;
  plpgsql: number;
  sqlite: number;
}

interface DialectDetection {
  dialect: Dialect;
  scores: DialectScores;
  score: number;
  confident: boolean;
  tied?: boolean;
}

interface ParserState {
  t: TokenList;
  i: number;
  d: Dialect;
  hard: StringSet;
  diagnostics: Diagnostic[];
  exhausted: boolean;
}

interface AstBase {
  label?: string;
}

interface BlockNode extends AstBase {
  type: 'block';
  body: AstNode[];
  atomic?: boolean;
}

interface StatementNode extends AstBase {
  type: 'stmt';
  toks: TokenList;
}

interface DynamicSqlNode extends AstBase {
  type: 'dynamic';
  toks: TokenList;
}

interface IfNode extends AstBase {
  type: 'if';
  cond: TokenList;
  then: AstNode | null;
  else: AstNode | null;
}

interface CaseNode extends AstBase {
  type: 'case';
  sel: TokenList;
  branches: Array<{cond: TokenList; body: AstNode[]}>;
  else: AstNode[] | null;
}

interface LoopNode extends AstBase {
  type: 'while' | 'for' | 'loop' | 'repeat';
  body: AstNode | null;
  cond?: TokenList;
  head?: TokenList;
}

interface ExceptionHandler {
  cond: TokenList | null;
  body: AstNode[];
}

interface TryNode extends AstBase {
  type: 'try';
  body: AstNode[];
  handlers: ExceptionHandler[];
}

type Db2HandlerKind = 'CONTINUE' | 'EXIT' | 'UNDO';

interface Db2HandlerNode extends AstBase {
  type: 'handler';
  kind: Db2HandlerKind;
  conds: TokenList;
  body: AstNode | null;
}

interface ReturnNode extends AstBase {
  type: 'return';
  toks: TokenList;
}

interface ThrowNode extends AstBase {
  type: 'throw';
  toks: TokenList;
}

type SqliteRaiseAction = 'IGNORE' | 'FAIL' | 'ABORT' | 'ROLLBACK';

interface SqliteRaiseNode extends AstBase {
  type: 'sqlite_raise';
  action: SqliteRaiseAction;
  toks: TokenList;
}

interface LoopControlNode extends AstBase {
  type: 'break' | 'continue';
  target: string | null;
  when: TokenList | null;
  word: string;
  span: SourceSpan;
  toks: TokenList;
}

interface LabelNode extends AstBase {
  type: 'label';
  label: string;
  span: SourceSpan;
  toks: TokenList;
}

interface GotoNode extends AstBase {
  type: 'goto';
  label: string;
  span: SourceSpan;
  toks: TokenList;
}

interface BatchSeparatorNode extends AstBase {
  type: 'go';
}

interface UnknownNode extends AstBase {
  type: 'unknown';
  toks: TokenList;
  reason: string;
}

type AstNode =
  | BlockNode
  | StatementNode
  | DynamicSqlNode
  | IfNode
  | CaseNode
  | LoopNode
  | TryNode
  | Db2HandlerNode
  | ReturnNode
  | ThrowNode
  | SqliteRaiseNode
  | LoopControlNode
  | LabelNode
  | GotoNode
  | BatchSeparatorNode
  | UnknownNode;

interface FlowExit {
  id: string;
  label?: string;
}

interface LoopFlowContext {
  cond: string;
  breaks: FlowExit[];
  label: string | null;
}

interface Db2HandlerFlow {
  id: string;
  kind: Db2HandlerKind;
  label: string;
  conditionKey: string;
  scopeExit: string | null;
  summarySource: string | null;
  terminal: string;
  resumeSources: string[];
}

interface PgErrorCondition {
  name: string;
  code: string;
}

interface PgTransactionAssessment {
  invalid: boolean;
  label: string;
  code: string | null;
  severity: DiagnosticSeverity | null;
  message: string;
}

interface TsqlTransactionDepth {
  min: number;
  max: number | null;
}

interface TempTableDef {
  id: string;
  name: string;
  multi: boolean;
}

interface FlowContext {
  parent: FlowContext | null;
  loop?: LoopFlowContext | null;
  handlers: Db2HandlerFlow[];
  handlerExits: FlowExit[];
  xactStates?: number;
  tranDepth?: TsqlTransactionDepth;
  xactAbort?: boolean;
  savepoints?: StringSet;
  pgSubtransaction?: boolean;
  temps?: Record<string, TempTableDef>;
  inCatch?: boolean;
}

interface EmitResult {
  entry: string | null;
  exits: FlowExit[];
  endTemps?: Record<string, TempTableDef> | null;
  endSavepoints?: StringSet | null;
}

interface SqlHeader {
  name: string;
  kind?: string;
  index?: number;
  gate?: TokenList;
  inner?: string;
  innerOffset?: number;
  [property: string]: any;
}

interface GraphNode {
  id: string;
  shape: string;
  text: string;
  cls: string;
  source: SourceSpan | null;
  objectId?: string | null;
  provenance?: NodeProvenance;
  reason?: string;
  sources?: SourceSpan[];
  /* v1.9.0 — catalogue resolution on external/source nodes. `resolution` is
     'verified' when the catalogue proves the object identity, 'conflict' when
     catalogue evidence is ambiguous, and 'external' (default) when it is not
     present. `resolvedName` is the canonical catalogue name a synonym or
     cross-database reference resolves to. */
  resolution?: CatalogueResolution;
  resolvedName?: string;
  /* Structured label lines (v1.7.0): multi-line labels are carried as an
     explicit array instead of an embedded \u0001 sentinel. When present,
     `text` is lines.join('\n') and exporters render from `lines`. */
  lines?: string[];
}

interface GraphEdge {
  from: string;
  to: string;
  label: string;
  style: string;
  kind?: EdgeKind;
}

interface GraphStats {
  [metric: string]: number;
}

interface Graph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  stats: GraphStats;
  empty?: boolean;
}

interface StructuredQueryReference {
  name: string;
  span: SourceSpan | null;
  role: QueryReferenceRole;
  resolution: QueryResolution;
  apply?: boolean;
}

interface QueryReferenceInfo {
  refs: string[];
  structuredRefs?: StructuredQueryReference[];
  joins: number;
  unions: number;
  subs: number;
  filtered: boolean;
  agg: boolean;
}

interface CteDefinition {
  name: string;
  body: Token[];
  info?: QueryReferenceInfo;
}

interface CteSplit {
  ctes: CteDefinition[];
  finalStart: number;
  recursive?: boolean;
}

interface AnalyseOptions {
  dialect?: DialectChoice;
  mode?: DiagramMode;
  dir?: DiagramDirection;
  detail?: 'summary' | 'full';
  group?: boolean;
  sources?: boolean;
  fanIn?: boolean;
  number?: boolean;
  finalLabel?: string;
  /* v1.9.0 — resolve by catalogue. When a parsed catalogue is present, unmatched
     object references that the catalogue proves are 'verified' instead of the
     conservative v1.5.0 'external' label; partial or conflicting catalogue
     evidence stays conservative and attaches a region-scoped diagnostic. */
  catalogue?: Catalogue;
  /* Document-scoped catalogue parse diagnostics surfaced alongside the
     analysis (set by the caller after parseCatalogue). */
  catalogueDiagnostics?: Diagnostic[];
}

interface DrawioOptions {
  title?: string;
  dir?: DiagramDirection;
}

interface DrawioPosition {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface DrawioWaypoint {
  x: number;
  y: number;
}

/* Deterministic layered-layout report (v1.7.0 workstream F). Exposed so layout
   fixtures can assert the overlap, monotonic-spine, label-bound, and crossing
   budgets against one canonical measurement. */
interface LayoutAnalysis {
  ranks: Record<string, number>;
  order: Record<string, number>;
  layers: string[][];
  backEdges: Array<{from: string; to: string}>;
  positions: Record<string, DrawioPosition>;
  crossings: number;
  overlaps: number;
  backboneEdges: number;
  monotonicEdges: number;
  pathEdges: number;
  warnings: string[];
}

interface TokenAttribution {
  total: number;
  resolved: number;
  ignored: number;
  unresolved: number;
  opaque: number;
  ignoredCategories: Record<string, number>;
}

interface ConstructCoverage {
  constructs: number;
  resolved: number;
  opaque: number;
  byKind: Record<string, {detected: number; resolved: number; opaque: number}>;
}

/* v1.6.0 per-region confidence signals. Every statement region is scored by
   its resolution state so the headline number is honest about what was
   verified versus estimated. */
interface ConfidenceRegionBreakdown {
  total: number;
  resolved: number;
  approx: number;
  opaque: number;
  error: number;
}

interface ConfidenceSignals {
  dialect: number;
  coverage: number;
  regionQuality: number;
  regionBreakdown: ConfidenceRegionBreakdown;
}

interface AnalysisResult {
  dialect: Dialect;
  detected: DialectDetection;
  confidence: number;
  confidenceFormulaVersion: string;
  confidenceSignals: ConfidenceSignals;
  dialectConfidence: number;
  coverage: number;
  consumedTokens: number;
  totalTokens: number;
  diagnostics: Diagnostic[];
  header: SqlHeader;
  ast: AstNode[];
  mode: Exclude<DiagramMode, 'auto'>;
  graph: Graph;
  stats: GraphStats;
  mermaid: string;
  attribution?: TokenAttribution;
  constructCoverage?: ConstructCoverage;
}

interface WorkspaceFile {
  name: string;
  text: string;
}

interface SqlUnit {
  id?: string;
  name: string;
  kind: string;
  file: string;
  sql: string;
  start: number;
  end: number;
}

interface ObjectIR {
  id: string;
  name: string;
  kind: string;
  file: string;
  source: string;
  dialect: Dialect;
  sql: string;
  span: SourceSpan;
  statements: unknown[];
  reads: string[];
  writes: string[];
  calls: string[];
  resultSets: unknown[];
  branches: unknown[];
  diagnostics: Diagnostic[];
  result?: AnalysisResult;
}

interface EstateResult {
  objects: ObjectIR[];
  graph: Graph;
  stats: GraphStats;
  diagnostics: Diagnostic[];
}

/* v1.8.0 — usable local workspace (README post-v1.0.0 item 7).
   Persistence is opt-in, versioned, and exportable. A snapshot captures every
   input needed to reproduce an identical analysis: the workspace files plus
   the analysis/UI options. The schema is versioned so future releases can
   migrate stored workspaces instead of dropping them. */
interface WorkspaceSnapshot {
  version: number;
  savedAt: string;
  files: WorkspaceFile[];
  options: {
    dialect: string;
    scope: string;
    view: string;
    detail: string;
    dir: string;
    group: boolean;
    number: boolean;
    fanIn: boolean;
    sources: boolean;
  };
  /* v1.9.0 — the raw catalogue text (JSON or the simple line format). It is an
     analysis input, so it is captured with the snapshot so Restore reproduces
     an identical analysis. Null/absent means no catalogue. */
  catalogue?: string | null;
  activeObjectId: string | null;
}

/* v1.8.0 — presentation-only dependency filtering. Filters derive a filtered
   graph at render time and must never mutate the underlying estate graph:
   disabling a filter affects the view only, never the analysis result. */
interface WorkspaceFilter {
  reads?: boolean;
  writes?: boolean;
  calls?: boolean;
  external?: boolean;
  temp?: boolean;
  focus?: string;
}

/* v1.9.0 — resolve by catalogue (README post-v1.0.0 item 5).
   A catalogue carries table/view/column metadata so unmatched object
   references can be resolved to their exact identity instead of a conservative
   'external' label. Only full-name and explicit-synonym matches count as
   'verified'; partial (suffix-only) or conflicting evidence stays conservative
   and is reported with a region-scoped diagnostic. Column metadata is accepted
   and validated now, and used for lineage in a later release. */
type CatalogueKind =
  | 'TABLE' | 'VIEW' | 'PROC' | 'FUNCTION' | 'TRIGGER' | 'SYNONYM'
  | 'TYPE' | 'SEQUENCE' | 'OTHER';

type CatalogueResolution = 'verified' | 'external' | 'conflict';

interface CatalogueObject {
  name: string;          /* canonical object name (possibly multi-part) */
  kind: CatalogueKind;
  synonyms: string[];    /* alternative names that resolve to this object */
}

interface CatalogueColumn {
  table: string;         /* owning object name (matches a CatalogueObject.name) */
  name: string;
  kind?: CatalogueKind;
}

interface Catalogue {
  objects: CatalogueObject[];
  columns: CatalogueColumn[];
  /* Normalized lookup indexes, filled by buildCatalogueIndex so resolution is
     O(1). byName maps normalized full names to objects; bySynonym maps
     normalized synonym names to their owning object. */
  byName: Record<string, CatalogueObject>;
  bySynonym: Record<string, CatalogueObject>;
  /* Normalized names with conflicting catalogue entries (duplicate objects or
     a synonym colliding with an object name). */
  conflicts: StringSet;
}

interface CatalogueParseResult {
  catalogue: Catalogue;
  diagnostics: Diagnostic[];
  format: 'json' | 'text';
  objectCount: number;
  columnCount: number;
}

interface FixtureExpectation {
  mode?: 'flow' | 'query';
  branch?: number;
  loop?: number;
  cat?: number;
  exit?: number;
  opaque?: number;
  ctes?: number;
  tables?: number;
  resultSets?: number;
  call?: string;
  write?: string;
  write2?: string;
  read?: string;
  read2?: string;
  object?: string;
  diagnostic?: string;
  noErrors?: boolean;
  coverageMin?: number;
}

interface ProcflowFixture {
  name: string;
  dialect: Dialect;
  sql: string;
  expect: FixtureExpectation;
}

interface ExpectedGraphWire {
  fromText: string;
  toText: string;
  fromOccurrence?: number;
  toOccurrence?: number;
  label?: string;
  style?: 'solid' | 'dotted';
  kind?: EdgeKind;
}

interface ExpectedGraphNode {
  text: string;
  occurrence?: number;
}

interface GraphFixture extends ProcflowFixture {
  graphExpect: {
    required: ExpectedGraphWire[];
    forbidden: ExpectedGraphWire[];
    sourced?: Array<string | ExpectedGraphNode>;
  };
}

interface RangeFixture {
  name: string;
  dialect: Dialect;
  sql: string;
  statements: string[];
  diagnostic?: string;
}

interface Db2GraphFixture extends GraphFixture {}

interface Window {
  mermaid: {
    initialize(options: Record<string, unknown>): void;
    render(id: string, definition: string): Promise<{svg: string}>;
  };
  PROCFLOW_TSQL_FIXTURE_COUNT?: number;
  PROCFLOW_METRICS_OUTPUT?: string;
  PROCFLOW_METRICS_READY?: boolean;
  /* v1.7.0 export-parity / layout suite results, published for the golden and
     metrics pages. */
  PROCFLOW_PARITY_PASS?: boolean;
  PROCFLOW_PARITY_RESULT?: {
    passed: number;
    total: number;
    traceabilityPassed: number;
    traceabilityTotal: number;
  };
  PROCFLOW_PARITY_FAILURES?: string[];
  PROCFLOW_LAYOUT_PASS?: boolean;
  PROCFLOW_LAYOUT_RESULT?: {passed: number; total: number};
  /* v1.8.0 workspace-persistence / dependency-filtering suite results,
     published for the golden and metrics pages. */
  PROCFLOW_WORKSPACE_PASS?: boolean;
  PROCFLOW_WORKSPACE_RESULT?: {
    passed: number;
    total: number;
  };
  /* v1.9.0 catalogue suite results, published for the golden and metrics pages. */
  PROCFLOW_CATALOGUE_PASS?: boolean;
  PROCFLOW_CATALOGUE_RESULT?: {
    passed: number;
    total: number;
  };
  /* v1.8.0 opt-in workspace persistence globals (src/workspace.ts), exposed for
     the browser UI tests. */
  clearWorkspace(): void;
  hasSavedWorkspace(): boolean;
  readWorkspace(): WorkspaceSnapshot | null;
  writeWorkspace(snapshot: WorkspaceSnapshot): boolean;
  buildWorkspaceSnapshot(state: {
    files: WorkspaceFile[];
    options: Record<string, unknown>;
    activeObjectId: string | null;
    catalogue?: string | null;
  }): WorkspaceSnapshot;
}

declare var mermaid: Window['mermaid'];