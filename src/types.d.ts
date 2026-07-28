/* Shared compile-time model for Procflow's ordered browser scripts. */

type Dialect = 'tsql' | 'db2' | 'plpgsql' | 'sqlite';
type DialectChoice = Dialect | 'auto';
type DiagramDirection = 'TD' | 'LR';
type DiagramMode = 'auto' | 'flow' | 'query';
type DiagnosticSeverity = 'error' | 'warning';

interface SourceSpan {
  start: number;
  end: number;
}

interface Diagnostic {
  severity: DiagnosticSeverity;
  code: string;
  message: string;
  span: SourceSpan | null;
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
}

interface ParserState {
  t: TokenList;
  i: number;
  d: Dialect;
  hard: StringSet;
  diagnostics: Diagnostic[];
  exhausted: boolean;
}

interface AstNode {
  type: string;
  toks?: TokenList;
  body?: AstNode | AstNode[];
  cond?: TokenList;
  head?: TokenList;
  sel?: TokenList;
  when?: TokenList;
  then?: AstNode | null;
  else?: AstNode | AstNode[] | null;
  branches?: Array<{cond: TokenList; body: AstNode[]}>;
  handlers?: Array<{cond: TokenList | null; body: AstNode[]}>;
  dynamic?: boolean;
  name?: string;
  target?: string;
  [property: string]: any;
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
}

interface GraphEdge {
  from: string;
  to: string;
  label: string;
  style: string;
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

interface QueryReferenceInfo {
  refs: string[];
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

interface AnalysisResult {
  dialect: Dialect;
  detected: DialectDetection;
  confidence: number;
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

interface Window {
  mermaid: {
    initialize(options: Record<string, unknown>): void;
    render(id: string, definition: string): Promise<{svg: string}>;
  };
  PROCFLOW_TSQL_FIXTURE_COUNT?: number;
}

declare var mermaid: Window['mermaid'];
