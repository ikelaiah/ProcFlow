/* proc>flow v2.6.0 — ERD query persistence (saved state and versioned query files).
   Pure serialization and validation for the query builder. The browser store
   itself lives in src/workspace.ts (storage is opt-in and local-only); this
   module never touches the DOM or storage, so the file format is testable and
   deterministic.

   Rules (matching the v2 accuracy contract):
   - Files carry a format, a version, and a schema fingerprint. Foreign,
     future-version, and malformed payloads are rejected with diagnostics.
   - Stale references are pruned against the current schema and reported; a
     changed schema never blocks a restore.
   - Serialization is deterministic: same state in, identical JSON out. */

var QUERY_FILE_FORMAT = 'procflow-erd-query';
/* Version 1 shipped without aggregates; version 2 adds them and still reads
   version-1 files by defaulting the missing field. */
var QUERY_FILE_VERSION = 2;
var QUERY_FILE_MIN_VERSION = 1;
var QUERY_NAME_MAX = 80;
var QUERY_DIALECTS: QueryDialect[] = ['tsql','postgres','db2','sqlite'];

function querySavedName(value: string | undefined): string {
  var name=String(value==null?'':value).replace(/\s+/g,' ').trim();
  return name.length>QUERY_NAME_MAX?name.slice(0,QUERY_NAME_MAX):name;
}

function queryValidRowLimit(value: unknown): number {
  var limit=typeof value==='number'&&isFinite(value)?Math.floor(value):0;
  return limit>0?limit:0;
}

function queryCloneJoinTypes(value: Record<string, QueryJoinType>): Record<string, QueryJoinType> {
  var out: Record<string, QueryJoinType>={};
  if(!value||typeof value!=='object') return out;
  Object.keys(value).forEach(function(key){
    var entry=value[key];
    if(entry==='inner'||entry==='left'||entry==='cross') out[key]=entry;
  });
  return out;
}

function queryClonePathChoices(value: Record<string, number>): Record<string, number> {
  var out: Record<string, number>={};
  if(!value||typeof value!=='object') return out;
  Object.keys(value).forEach(function(key){
    var entry=value[key];
    if(typeof entry==='number'&&isFinite(entry)&&entry>=0) out[key]=Math.floor(entry);
  });
  return out;
}

function queryCloneAggregates(
    value: Record<string, QueryAggregateFn>): Record<string, QueryAggregateFn> {
  var out: Record<string, QueryAggregateFn>={};
  if(!value||typeof value!=='object') return out;
  Object.keys(value).forEach(function(key){
    var entry=value[key];
    if(QUERY_AGGREGATE_FNS.indexOf(entry)>=0) out[key]=entry;
  });
  return out;
}

function querySavedSorts(value: QuerySort[] | undefined): QuerySort[] {
  var sorts: QuerySort[]=[];
  (value||[]).forEach(function(sort){
    if(!sort||typeof sort.entityId!=='string'||typeof sort.column!=='string') return;
    sorts.push({entityId:sort.entityId,column:sort.column,
      direction:sort.direction==='desc'?'desc':'asc'});
  });
  return sorts;
}

/* The panel's live state → a complete, deterministic saved payload. */
function queryStateBuild(result: SchemaResult, input: ErdQueryStoreInput): ErdQuerySavedState {
  var name=querySavedName(input.name);
  var state: ErdQuerySavedState={
    format:QUERY_FILE_FORMAT,
    version:QUERY_FILE_VERSION,
    fingerprint:schemaFingerprint(result),
    selections:(input.selections||[]).map(function(entry){
      return {entityId:entry.entityId,column:entry.column};
    }),
    manual:(input.manual||[]).map(function(entry){
      var join: QueryManualJoin={id:entry.id,leftId:entry.leftId,
        leftColumn:entry.leftColumn,rightId:entry.rightId,
        rightColumn:entry.rightColumn};
      if(entry.predicate) join.predicate=entry.predicate;
      if(entry.selfColumns&&entry.selfColumns.length){
        join.selfColumns=entry.selfColumns.slice();
      }
      return join;
    }),
    cross:(input.cross||[]).slice(),
    excluded:(input.excluded||[]).slice(),
    joinTypes:queryCloneJoinTypes(input.joinTypes),
    pathChoices:queryClonePathChoices(input.pathChoices),
    options:{
      dialect:QUERY_DIALECTS.indexOf(input.options.dialect)>=0?input.options.dialect:'tsql',
      comments:input.options.comments!==false,
      distinct:!!input.options.distinct,
      rowLimit:queryValidRowLimit(input.options.rowLimit),
      onlyUsed:!!input.options.onlyUsed,
      sorts:querySavedSorts(input.options.sorts),
      aggregates:queryCloneAggregates(input.options.aggregates)
    }
  };
  if(name) state.name=name;
  return state;
}

function queryStateToJSON(state: ErdQuerySavedState): string {
  return JSON.stringify(state,null,1);
}

function queryStateFromJSON(text: string): ErdQueryStoreParseResult {
  var diagnostics: Diagnostic[]=[];
  function fail(code: string, message: string): ErdQueryStoreParseResult {
    diagnostics.push({severity:'error',code:code,message:message,span:null,
                      scope:'document'});
    return {state:null,diagnostics:diagnostics};
  }
  var parsed: any;
  try {
    parsed=JSON.parse(text);
  } catch(err){
    return fail('erd_query_parse_error','Query file is not valid JSON.');
  }
  if(!parsed||typeof parsed!=='object'||parsed.format!==QUERY_FILE_FORMAT){
    return fail('erd_query_format_error','File is not a ProcFlow query.');
  }
  var fileVersion=typeof parsed.version==='number'?parsed.version:0;
  if(fileVersion<QUERY_FILE_MIN_VERSION||fileVersion>QUERY_FILE_VERSION){
    return fail('erd_query_version_error',
      'Query file version '+String(parsed.version)+' is not supported.');
  }
  var ignored=0;

  var selections: QueryColumnRef[]=[];
  if(parsed.selections===undefined){
    /* absent is fine */
  } else if(!Array.isArray(parsed.selections)){
    ignored++;
  } else {
    parsed.selections.forEach(function(entry: any){
      if(entry&&typeof entry.entityId==='string'&&entry.entityId&&
         typeof entry.column==='string'&&entry.column){
        selections.push({entityId:entry.entityId,column:entry.column});
      } else ignored++;
    });
  }

  var manual: QueryManualJoin[]=[];
  if(parsed.manual===undefined){
    /* absent is fine */
  } else if(!Array.isArray(parsed.manual)){
    ignored++;
  } else {
    parsed.manual.forEach(function(entry: any){
      if(entry&&typeof entry.id==='string'&&typeof entry.leftId==='string'&&
         typeof entry.leftColumn==='string'&&typeof entry.rightId==='string'&&
         typeof entry.rightColumn==='string'){
        var join: QueryManualJoin={id:entry.id,leftId:entry.leftId,
          leftColumn:entry.leftColumn,rightId:entry.rightId,
          rightColumn:entry.rightColumn};
        if(typeof entry.predicate==='string'&&entry.predicate){
          join.predicate=entry.predicate;
        }
        if(Array.isArray(entry.selfColumns)){
          var self=entry.selfColumns.filter(function(name: any){
            return typeof name==='string'&&!!name;
          });
          if(self.length) join.selfColumns=self;
        }
        manual.push(join);
      } else ignored++;
    });
  }

  function stringList(value: any): string[] {
    if(value===undefined) return [];
    if(!Array.isArray(value)){ ignored++; return []; }
    var list=value.filter(function(entry: any){
      return typeof entry==='string'&&!!entry;
    });
    ignored+=value.length-list.length;
    return list;
  }
  var cross=stringList(parsed.cross);
  var excluded=stringList(parsed.excluded);

  var joinTypes=queryCloneJoinTypes(parsed.joinTypes);
  if(parsed.joinTypes!==undefined){
    if(!parsed.joinTypes||typeof parsed.joinTypes!=='object'||Array.isArray(parsed.joinTypes)){
      ignored++;
    } else {
      ignored+=Object.keys(parsed.joinTypes).length-Object.keys(joinTypes).length;
    }
  }
  var pathChoices=queryClonePathChoices(parsed.pathChoices);
  if(parsed.pathChoices!==undefined){
    if(!parsed.pathChoices||typeof parsed.pathChoices!=='object'||Array.isArray(parsed.pathChoices)){
      ignored++;
    } else {
      ignored+=Object.keys(parsed.pathChoices).length-Object.keys(pathChoices).length;
    }
  }

  var rawOptions=parsed.options&&typeof parsed.options==='object'?parsed.options:{};
  var options: ErdQuerySavedOptions={
    dialect:QUERY_DIALECTS.indexOf(rawOptions.dialect)>=0?rawOptions.dialect:'tsql',
    comments:rawOptions.comments!==false,
    distinct:!!rawOptions.distinct,
    rowLimit:queryValidRowLimit(rawOptions.rowLimit),
    onlyUsed:!!rawOptions.onlyUsed,
    sorts:querySavedSorts(Array.isArray(rawOptions.sorts)?rawOptions.sorts:[]),
    aggregates:queryCloneAggregates(rawOptions.aggregates)
  };
  if(rawOptions.sorts!==undefined&&!Array.isArray(rawOptions.sorts)) ignored++;
  if(rawOptions.aggregates!==undefined){
    if(!rawOptions.aggregates||typeof rawOptions.aggregates!=='object'||
       Array.isArray(rawOptions.aggregates)){
      ignored++;
    } else {
      ignored+=Object.keys(rawOptions.aggregates).length-
        Object.keys(options.aggregates).length;
    }
  }

  var name=querySavedName(parsed.name);
  var state: ErdQuerySavedState={
    format:QUERY_FILE_FORMAT,
    version:QUERY_FILE_VERSION,
    fingerprint:typeof parsed.fingerprint==='string'?parsed.fingerprint:'',
    selections:selections,
    manual:manual,
    cross:cross,
    excluded:excluded,
    joinTypes:joinTypes,
    pathChoices:pathChoices,
    options:options
  };
  if(name) state.name=name;
  if(ignored){
    diagnostics.push({severity:'info',code:'erd_query_entries_ignored',
      message:ignored+' saved entr'+(ignored===1?'y was':'ies were')+
        ' not readable and ignored.',span:null,scope:'document'});
  }
  return {state:state,diagnostics:diagnostics};
}

/* Stale references are dropped against the current join graph; every drop is
   reported so the UI can say what changed instead of failing the restore. */
function queryStatePrune(state: ErdQuerySavedState,
                         graph: QueryGraph): ErdQueryPruneResult {
  var dropped: string[]=[];
  function nodeOf(id: string): QueryGraphNode | null {
    return graph.nodes[id]||null;
  }
  var selections=state.selections.filter(function(entry){
    var node=nodeOf(entry.entityId);
    if(!node){
      dropped.push(entry.entityId+'.'+entry.column+' (table not declared)');
      return false;
    }
    if(!queryNodeHasColumn(node,entry.column)){
      dropped.push(queryNameOf(graph,entry.entityId)+'.'+entry.column+
        ' (column not declared)');
      return false;
    }
    return true;
  });
  var manual=state.manual.filter(function(entry){
    var left=nodeOf(entry.leftId), right=nodeOf(entry.rightId);
    if(!left||!right){
      dropped.push('taught join '+entry.id+' (table not declared)');
      return false;
    }
    if(!queryNodeHasColumn(left,entry.leftColumn)||
       !queryNodeHasColumn(right,entry.rightColumn)){
      dropped.push('taught join '+entry.id+' (column not declared)');
      return false;
    }
    return true;
  });
  var cross=state.cross.filter(function(id){
    if(nodeOf(id)) return true;
    dropped.push(id+' (cross join, table not declared)');
    return false;
  });
  var excluded=state.excluded.filter(function(id){
    if(nodeOf(id)) return true;
    dropped.push(id+' (excluded, table not declared)');
    return false;
  });
  var picked: StringSet={};
  selections.forEach(function(entry){
    picked[entry.entityId+'|'+schemaNormColumn(entry.column)]=1;
  });
  var aggregates: Record<string, QueryAggregateFn>={};
  Object.keys(state.options.aggregates||{}).forEach(function(key){
    if(picked[key]) aggregates[key]=state.options.aggregates[key];
    else dropped.push(key+' (aggregate, column not picked)');
  });
  var sorts=state.options.sorts.filter(function(sort){
    if(picked[sort.entityId+'|'+schemaNormColumn(sort.column)]) return true;
    dropped.push(queryNameOf(graph,sort.entityId)+'.'+sort.column+
      ' (sort, column not picked)');
    return false;
  });
  var pathChoices: Record<string, number>={};
  Object.keys(state.pathChoices).forEach(function(key){
    var parts=key.split('->');
    if(parts.length===2&&nodeOf(parts[0])&&nodeOf(parts[1])&&
       isFinite(state.pathChoices[key])){
      pathChoices[key]=state.pathChoices[key];
    } else {
      dropped.push('path choice '+key+' (table not declared)');
    }
  });
  var options: ErdQuerySavedOptions={dialect:state.options.dialect,
    comments:state.options.comments,distinct:state.options.distinct,
    rowLimit:state.options.rowLimit,onlyUsed:state.options.onlyUsed,
    sorts:sorts,aggregates:aggregates};
  var pruned: ErdQuerySavedState={format:state.format,version:state.version,
    fingerprint:state.fingerprint,selections:selections,manual:manual,
    cross:cross,excluded:excluded,joinTypes:state.joinTypes,
    pathChoices:pathChoices,options:options};
  if(state.name) pruned.name=state.name;
  return {state:pruned,dropped:dropped};
}

/* Filename base for exports: the name slug when present, otherwise a
   deterministic fingerprint fallback. */
function queryFileBaseName(state: ErdQuerySavedState): string {
  var slug=querySavedName(state.name||'').toLowerCase()
    .replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'');
  return slug||('procflow-query-'+state.fingerprint);
}

