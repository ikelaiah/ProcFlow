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

interface AstBase {
  label?: string;
}

interface BlockNode extends AstBase {
  type: 'block';
  body: AstNode[];
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

interface LoopControlNode extends AstBase {
  type: 'break' | 'continue';
  target: string | null;
  when: TokenList | null;
  word: string;
}

interface LabelNode extends AstBase {
  type: 'label';
  label: string;
}

interface GotoNode extends AstBase {
  type: 'goto';
  label: string;
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
}

interface FlowContext {
  parent: FlowContext | null;
  loop?: LoopFlowContext | null;
  handlers: Db2HandlerFlow[];
  handlerExits: FlowExit[];
}

interface EmitResult {
  entry: string | null;
  exits: FlowExit[];
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

interface ExpectedGraphWire {
  fromText: string;
  toText: string;
  label?: string;
  style?: 'solid' | 'dotted';
}

interface Db2GraphFixture extends ProcflowFixture {
  graphExpect: {
    required: ExpectedGraphWire[];
    forbidden: ExpectedGraphWire[];
  };
}

interface Window {
  mermaid: {
    initialize(options: Record<string, unknown>): void;
    render(id: string, definition: string): Promise<{svg: string}>;
  };
  PROCFLOW_TSQL_FIXTURE_COUNT?: number;
}

declare var mermaid: Window['mermaid'];
