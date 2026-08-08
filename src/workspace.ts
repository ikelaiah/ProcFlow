/* ===== v1.8.0 Usable local workspace (README post-v1.0.0 item 7) =====
   Optional local workspace persistence and dependency filtering.

   Persistence is opt-in: nothing is ever written to storage automatically.
   Save, Restore, Export, Import, and Forget all require an explicit user
   action. A saved snapshot is versioned (WORKSPACE_SCHEMA_VERSION) so a future
   release can migrate it, and exportable so it never becomes locked to a
   browser. Corrupt or malformed stored data is recovered rather than crashing
   the app: parseWorkspace returns an error so the caller can drop it and
   start clean.

   Dependency filtering is presentation-only: filterDependencyGraph derives a
   filtered copy at render time and never mutates the underlying estate graph.
   Disabling a filter changes the view only — never the analysis result.
*/
/* v1.8.0 schema was version 1. v1.9.0 adds the optional catalogue text (an
   analysis input) as a top-level snapshot field, so a saved workspace still
   reproduces an identical analysis when a catalogue was in use. */
var WORKSPACE_SCHEMA_VERSION = 2;
var WORKSPACE_STORAGE_KEY = 'procflow.workspace'; /* schema base key; versioned payload */

var DIALECT_SELECT_ORDER = ['auto','tsql','db2','plpgsql','sqlite'];

function defaultWorkspaceOptions(): WorkspaceSnapshot['options'] {
  return {
    dialect:'auto',
    scope:'internal',
    view:'auto',
    detail:'summary',
    dir:'TD',
    group:true,
    number:false,
    fanIn:false,
    sources:true
  };
}

/* Serialize the current in-memory workspace into a plain, JSON-safe, versioned
   snapshot. The files array carries every source the estate needs, and options
   carry every control that influences analysis, so an identical analysis is
   guaranteed on Restore. */
function buildWorkspaceSnapshot(state: {
  files: WorkspaceFile[];
  options: Record<string, unknown>;
  activeObjectId: string | null;
  catalogue?: string | null;
}): WorkspaceSnapshot {
  var opt: WorkspaceSnapshot['options'] = {
    dialect:String(state.options.dialect==null?'auto':state.options.dialect),
    scope:String(state.options.scope==null?'internal':state.options.scope),
    view:String(state.options.view==null?'auto':state.options.view),
    detail:String(state.options.detail==null?'summary':state.options.detail),
    dir:String(state.options.dir==null?'TD':state.options.dir),
    group:!!state.options.group,
    number:!!state.options.number,
    fanIn:!!state.options.fanIn,
    sources:!!state.options.sources
  };
  var snap: WorkspaceSnapshot = {
    version:WORKSPACE_SCHEMA_VERSION,
    savedAt:new Date().toISOString(),
    files:(state.files||[]).map(function(f){
      return {name:String(f.name||''), text:String(f.text==null?'':f.text)};
    }),
    options:opt,
    catalogue:state.catalogue==null?null:String(state.catalogue),
    activeObjectId:state.activeObjectId||null
  };
  return snap;
}

function serializeWorkspace(snapshot: WorkspaceSnapshot): string {
  return JSON.stringify(snapshot);
}

/* Migrate an older-version payload forward to the current schema. Currently
   only the initial schema exists, so migration is structural: repair missing
   or wrong-shaped fields to current defaults. Future schema versions add their
   step here (and bump WORKSPACE_SCHEMA_VERSION). */
function migrateWorkspace(raw: any): WorkspaceSnapshot {
  var migrated = {
    version:WORKSPACE_SCHEMA_VERSION,
    savedAt:raw&&raw.savedAt?String(raw.savedAt):new Date().toISOString(),
    files:Array.isArray(raw&&raw.files)?raw.files.filter(function(f){
      return f&&(typeof f.name==='string')&&f.text!==undefined;
    }).map(function(f){ return {name:String(f.name), text:String(f.text)}; }):[],
    options:{}
  } as WorkspaceSnapshot;
  var d=defaultWorkspaceOptions();
  var src=raw&&raw.options?raw.options:{};
  migrated.options={
    dialect:DIALECT_SELECT_ORDER.indexOf(String(src.dialect))>=0?String(src.dialect):d.dialect,
    scope:['internal','dependencies'].indexOf(String(src.scope))>=0?String(src.scope):d.scope,
    view:['auto','flow','query'].indexOf(String(src.view))>=0?String(src.view):d.view,
    detail:['summary','full'].indexOf(String(src.detail))>=0?String(src.detail):d.detail,
    dir:['TD','LR'].indexOf(String(src.dir))>=0?String(src.dir):d.dir,
    group:src.group===undefined?d.group:!!src.group,
    number:src.number===undefined?d.number:!!src.number,
    fanIn:src.fanIn===undefined?d.fanIn:!!src.fanIn,
    sources:src.sources===undefined?d.sources:!!src.sources
  };
  migrated.catalogue=raw&&raw.catalogue!=null?String(raw.catalogue):null;
  migrated.activeObjectId=raw&&raw.activeObjectId?String(raw.activeObjectId):null;
  return migrated;
}

/* Parse a serialized or exported workspace string with corrupt-state recovery.
   Returns {snapshot} on success, or {error} on corrupt/malformed input so the
   caller can drop the bad state and start clean instead of crashing. */
function parseWorkspace(json: string): {snapshot: WorkspaceSnapshot | null; migrated: boolean; error?: string} {
  var raw: any;
  try {
    raw=JSON.parse(String(json==null?'':json));
  }catch(e){
    return {snapshot:null,migrated:false,error:'corrupt_json'};
  }
  if(!raw||typeof raw!=='object'||Array.isArray(raw))
    return {snapshot:null,migrated:false,error:'not_workspace'};
  var version=typeof raw.version==='number'?raw.version:0;
  var migrated=version!==WORKSPACE_SCHEMA_VERSION;
  var snapshot=migrateWorkspace(raw);
  if(!snapshot.files.length&&!snapshot.activeObjectId)
    return {snapshot:null,migrated:false,error:'empty_workspace'};
  snapshot.version=WORKSPACE_SCHEMA_VERSION;
  return {snapshot:snapshot,migrated:migrated};
}

/* ---- local-only storage (opt-in, versioned) ---- */
function readWorkspace(): WorkspaceSnapshot | null {
  try {
    var raw=window.localStorage.getItem(WORKSPACE_STORAGE_KEY);
    if(!raw) return null;
    var parsed=parseWorkspace(raw);
    if(parsed.error||!parsed.snapshot){
      try { window.localStorage.removeItem(WORKSPACE_STORAGE_KEY); } catch(e){}
      return null;
    }
    return parsed.snapshot;
  }catch(e){
    return null;
  }
}

function hasSavedWorkspace(): boolean {
  try { return !!window.localStorage.getItem(WORKSPACE_STORAGE_KEY); } catch(e){ return false; }
}

function writeWorkspace(snapshot: WorkspaceSnapshot): boolean {
  try {
    window.localStorage.setItem(WORKSPACE_STORAGE_KEY,serializeWorkspace(snapshot));
    return true;
  }catch(e){
    return false;
  }
}

function clearWorkspace(): void {
  try { window.localStorage.removeItem(WORKSPACE_STORAGE_KEY); } catch(e){}
}

function workspaceExportText(): string {
  var snap=readWorkspace();
  return snap?serializeWorkspace(snap):'';
}

/* ===== v1.8.0 dependency filtering (presentation-only) ===== */
function defaultWorkspaceFilter(): WorkspaceFilter {
  return {reads:true,writes:true,calls:true,external:true,temp:true,focus:''};
}

/* Derive a filtered view of the dependency graph. Never mutates the input:
   the returned object contains fresh node/edge arrays (shallow-cloned nodes),
   so toggling a filter cannot change the underlying estate graph or any later
   export. An edge is shown only when its semantic kind passes the matching
   toggle and both endpoints survive node-kind filtering. A non-empty focus
   keeps matching nodes plus their immediate neighbours (one hop). */
function filterDependencyGraph(graph: Graph, filter?: WorkspaceFilter): Graph {
  var f: WorkspaceFilter={
    reads:filter&&filter.reads!==undefined?filter.reads:true,
    writes:filter&&filter.writes!==undefined?filter.writes:true,
    calls:filter&&filter.calls!==undefined?filter.calls:true,
    external:filter&&filter.external!==undefined?filter.external:true,
    temp:filter&&filter.temp!==undefined?filter.temp:true,
    focus:filter&&filter.focus?String(filter.focus):''
  };
  if(!graph||!graph.nodes||!graph.nodes.length)
    return {nodes:[],edges:[],stats:graph&&graph.stats||{}};

  var keep: Record<string, 1|undefined>={};
  graph.nodes.forEach(function(n){
    if(n.provenance==='external'&&!f.external) return;
    if(n.provenance==='synthetic'&&!f.temp) return;
    keep[n.id]=1;
  });

  var focus=String(f.focus||'').trim().toUpperCase();
  if(focus){
    var matched: Record<string, 1|undefined>={};
    var neighbour: Record<string, 1|undefined>={};
    graph.nodes.forEach(function(n){
      if(keep[n.id]&&(String(n.text||'').toUpperCase().indexOf(focus)>=0||
         String(n.objectId||'').toUpperCase().indexOf(focus)>=0))
        matched[n.id]=1;
    });
    if(focus&&!Object.keys(matched).length){
      /* A focus that matches nothing shows no neighbourhood. */
      return {nodes:[],edges:[],stats:graph.stats,empty:true};
    }
    graph.edges.forEach(function(e){
      if(matched[e.from]) neighbour[e.to]=1;
      if(matched[e.to]) neighbour[e.from]=1;
    });
    var narrowed: Record<string, 1|undefined>={};
    graph.nodes.forEach(function(n){
      if(keep[n.id]&&(matched[n.id]||neighbour[n.id])) narrowed[n.id]=1;
    });
    keep=narrowed;
  }

  var nodes=(graph.nodes||[]).filter(function(n){
    return keep[n.id]===1;
  }).map(function(n){
    var c: any={};
    for(var k in n) c[k]=n[k];
    return c;
  });

  function edgePass(e: GraphEdge): boolean {
    if(e.kind==='data') return !!f.writes;
    if(e.kind==='call') return !!f.calls;
    if(e.kind==='dependency') return !!f.reads;
    return true;
  }

  var edges=(graph.edges||[]).filter(function(e){
    return keep[e.from]===1&&keep[e.to]===1&&edgePass(e);
  }).map(function(e){
    var c: any={};
    for(var k in e) c[k]=e[k];
    return c;
  });

  /* Stats are presentation-independent: keep the original estate stats so a
     filter never changes what the analysis reports, only what the view draws. */
  return {nodes:nodes, edges:edges, stats:graph.stats};
}
