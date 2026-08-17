/* ===== v1.12.0 Report import (README post-v1.0.0 item 4) =====
   SSRS/RDL import: parse report definitions (RDL/XML) and link reports to
   datasets, and each dataset to its SQL analysis.

   A report definition is an XML document whose root is a <Report>. It lists
   data sources and datasets. Each dataset is one of:

     - embedded:  it carries a <Query><CommandText> whose SQL is analysed here
                  (result attached as dataset.analysis);
     - shared:    it references an external shared dataset definition via
                  <SharedDataSet><SharedDataSetReference>, so there is no SQL
                  to analyse in this file;
     - unresolved:it has neither a command text nor a shared reference, so it
                  cannot be linked to any SQL analysis (reported with a
                  region- or document-scoped diagnostic).

   XML source locations are preserved as byte spans over the raw report text
   wherever the element tags can be located deterministically (report, data
   source, dataset, and command-text regions). Parser uncertainty is scoped:
   a malformed document or a missing <Report> is a document-scoped diagnostic
   (no fabricated span), while an individual dataset that cannot be linked is a
   region-scoped diagnostic at its own element span when that span is known.

   Combined report dependency views and report export are deferred to v1.13.0;
   this release ships the parser, the report→dataset linkage, XML source
   locations, and the E diagnostics. */

/* Local-name search across a DOM root, namespace-agnostic (RDL elements may
   carry a default namespace). */
function rdlLocal(root: Element | Document, local: string): Element[] {
  var out: Element[]=[];
  Array.prototype.forEach.call(root.getElementsByTagName('*'),function(el: Element){
    var ln=(el.localName||el.tagName||'').replace(/^.*:/,'');
    if(ln===local) out.push(el);
  });
  return out;
}

function rdlText(el: Element | null | undefined, local: string): string | null {
  if(!el) return null;
  var found=rdlLocal(el,local);
  return found.length?(found[0].textContent||'').trim():null;
}

function rdlChild(el: Element | null | undefined, local: string): Element | null {
  if(!el) return null;
  var found=rdlLocal(el,local);
  return found.length?found[0]:null;
}

/* Read an attribute by name from a captured open-tag attribute string. */
function rdlAttr(attrText: string, name: string): string | null {
  var re=new RegExp('\\b'+name+'\\s*=\\s*(["\'])(.*?)\\1','i');
  var m=re.exec(attrText);
  return m?m[2]:null;
}

/* End of an XML open tag starting at `start`, respecting quoted attribute
   values so `>` inside quotes never terminates the tag early. */
function rdlOpenTagEnd(text: string, start: number): number {
  var i=start, n=text.length, q='';
  while(i<n){
    var c=text.charAt(i);
    if(q){ if(c===q) q=''; i++; continue; }
    if(c==='"'||c==="'"){ q=c; i++; continue; }
    if(c==='>') return i+1;
    i++;
  }
  return n;
}

/* Locate every open tag `<local>` (optionally namespace-prefixed) in the raw
   report text and the span of the whole element (open tag through close tag).
   `DataSet` never matches `DataSets` because the regex demands a boundary. */
function rdlOpenTags(text: string, local: string): Array<{start: number; end: number;
    attrText: string; openEnd: number; selfClosing: boolean}> {
  var re=new RegExp('<((?:[\\w.-]+:)?'+local+')([\\s>\\/])','g');
  var out: Array<{start: number; end: number; attrText: string;
                  openEnd: number; selfClosing: boolean}>=[];
  var m: RegExpExecArray | null;
  while((m=re.exec(text))!==null){
    var start=m.index;
    var openEnd=rdlOpenTagEnd(text,start);
    if(openEnd<0) break;
    var openText=text.slice(start,openEnd);
    var attrText=text.slice(start+m[1].length+1,openEnd-1);
    var selfClosing=/\/\s*$/.test(openText.slice(0,openEnd-start-1));
    var end=openEnd;
    if(!selfClosing){
      var close=text.indexOf('</'+local,openEnd);
      var closeEnd=close<0?-1:text.indexOf('>',close)+1;
      if(closeEnd>0) end=closeEnd;
    }
    out.push({start:start,end:end,attrText:attrText,openEnd:openEnd,selfClosing:selfClosing});
  }
  return out;
}

/* Pick the element span whose open-tag Name attribute equals `name` (RDL
   dataset/data-source names are unique within a report). Falls back to order
   when no Name attribute is present. */
function rdlSpanForName(spans: Array<{start: number; end: number; attrText: string;
    openEnd: number; selfClosing: boolean}>, name: string | null,
    index: number): {start: number; end: number} | null {
  if(!spans||!spans.length) return null;
  if(name){
    for(var i=0;i<spans.length;i++){
      if(rdlAttr(spans[i].attrText,'Name')===name) return {start:spans[i].start,end:spans[i].end};
    }
  }
  var s=spans[index];
  return s?{start:s.start,end:s.end}:null;
}

/* The dataset command-text span: the innermost <CommandText> element fully
   inside the dataset's own span, matched by attribute-free ordering. */
function rdlInnerSpan(text: string, outer: {start: number; end: number} | null,
    local: string): {start: number; end: number} | null {
  if(!outer) return null;
  var all=rdlOpenTags(text,local).filter(function(s){
    return s.start>=outer.start&&s.end<=outer.end;
  });
  if(!all.length) return null;
  var s=all[0];
  return {start:s.start,end:s.end};
}

/* Determine the SQL command text inside a dataset's <Query>. Returns the
   decoded text and its span (the <CommandText> element). */
function rdlDatasetCommand(text: string, dsEl: Element, outer: {start: number; end: number} | null):
    {sql: string; sqlSpan: {start: number; end: number} | null; dataSourceName: string | null} {
  var query=rdlChild(dsEl,'Query');
  var cmd=query?rdlChild(query,'CommandText'):null;
  var sql=cmd?(cmd.textContent||'').trim():'';
  var sqlSpan=rdlInnerSpan(text,outer,'CommandText');
  var dataSourceName=query?rdlText(query,'DataSourceName'):null;
  return {sql:sql, sqlSpan:sqlSpan, dataSourceName:dataSourceName};
}

/* Parse a report definition (RDL/XML text) into a ReportParseResult. Every
   embedded dataset's command text is run through the existing SQL analysis so
   each dataset links to its analysis; shared and unresolved datasets stay
   explicit. Returns diagnostics with correct region/document scope. */
function parseReport(text: string): ReportParseResult {
  var src=String(text==null?'':text);
  var diagnostics: Diagnostic[]=[];
  var reports: ReportDefinition[]=[];
  var allDatasets: ReportDataset[]=[];
  var embedded=0, shared=0, unresolved=0;

  if(!src.trim()){
    diagnostics.push({severity:'warning',code:'report_empty',
      message:'The report definition is empty.',
      span:null, scope:'document'});
    return {reports:reports,datasets:allDatasets,diagnostics:diagnostics,
      reportCount:0,datasetCount:0,embeddedCount:0,sharedCount:0,unresolvedCount:0};
  }

  var doc: Document | null=null;
  try{
    doc=new DOMParser().parseFromString(src,'application/xml');
  }catch(e){
    diagnostics.push({severity:'error',code:'report_parse_error',
      message:'The report definition could not be parsed as XML: '+
        (e instanceof Error?e.message:String(e)),
      span:null, scope:'document'});
    return {reports:reports,datasets:allDatasets,diagnostics:diagnostics,
      reportCount:0,datasetCount:0,embeddedCount:0,sharedCount:0,unresolvedCount:0};
  }
  if(!doc||rdlLocal(doc,'parsererror').length){
    diagnostics.push({severity:'error',code:'report_parse_error',
      message:'The report definition is not well-formed XML. Check the file for unclosed tags, quoting, or encoding.',
      span:null, scope:'document'});
    return {reports:reports,datasets:allDatasets,diagnostics:diagnostics,
      reportCount:0,datasetCount:0,embeddedCount:0,sharedCount:0,unresolvedCount:0};
  }

  var reportEls=rdlLocal(doc,'Report');
  if(!reportEls.length){
    diagnostics.push({severity:'warning',code:'report_not_report',
      message:'The XML is well formed but contains no <Report> root element, so it is not an SSRS report definition.',
      span:null, scope:'document'});
    return {reports:reports,datasets:allDatasets,diagnostics:diagnostics,
      reportCount:0,datasetCount:0,embeddedCount:0,sharedCount:0,unresolvedCount:0};
  }

  reportEls.forEach(function(reportEl){
    var name=reportEl.getAttribute('Name')||'Report';
    var reportSpan=rdlSpanForName(rdlOpenTags(src,'Report'),name,0);
    var dataSources: ReportDataSource[]=[];
    var dsSpans=rdlOpenTags(src,'DataSource');
    rdlLocal(reportEl,'DataSource').forEach(function(dsEl,i){
      var dsName=dsEl.getAttribute('Name')||'';
      var dsSpan=rdlSpanForName(dsSpans,dsName,i);
      var kind: 'embedded' | 'shared' = rdlChild(dsEl,'DataSourceReference')
        ? 'shared' : 'embedded';
      var provider=rdlText(dsEl,'DataProvider');
      dataSources.push({name:dsName,kind:kind,provider:provider,xmlSpan:dsSpan});
    });

    var datasets: ReportDataset[]=[];
    var setSpans=rdlOpenTags(src,'DataSet');
    rdlLocal(reportEl,'DataSet').forEach(function(dsEl,i){
      var dsName=dsEl.getAttribute('Name')||'';
      var dsSpan=rdlSpanForName(setSpans,dsName,i);
      var sharedRef=rdlText(dsEl,'SharedDataSetReference');
      var cmd=rdlDatasetCommand(src,dsEl,dsSpan);
      var source: ReportDatasetSource;
      if(cmd.sql&&cmd.sql.length) source='embedded';
      else if(sharedRef&&sharedRef.length) source='shared';
      else source='unresolved';

      var ds: ReportDataset={
        name:dsName, source:source,
        dataSourceName:cmd.dataSourceName,
        sql:cmd.sql||null, sqlSpan:cmd.sqlSpan,
        sharedReference:sharedRef||null, xmlSpan:dsSpan, analysis:null
      };

      if(source==='embedded'){
        embedded++;
        try{
          ds.analysis=analyse(ds.sql as string,
            {dialect:'auto', mode:'auto', group:false, sources:true});
        }catch(e){
          ds.analysis=null;
          diagnostics.push({severity:'warning',code:'report_dataset_analysis_error',
            message:'Dataset "'+dsName+'" command text could not be analysed: '+
              (e instanceof Error?e.message:String(e)),
            span:cmd.sqlSpan||dsSpan, scope:cmd.sqlSpan||dsSpan?'region':'document'});
        }
      } else if(source==='shared'){
        shared++;
      } else {
        unresolved++;
        diagnostics.push({severity:'warning',code:'report_dataset_unresolved',
          message:'Dataset "'+dsName+'" has neither a command text nor a shared dataset reference, so it cannot be linked to any SQL analysis.',
          span:dsSpan, scope:dsSpan?'region':'document'});
      }
      datasets.push(ds);
      allDatasets.push(ds);
    });

    if(!datasets.length){
      diagnostics.push({severity:'info',code:'report_empty',
        message:'Report "'+name+'" defines no datasets; there is nothing to link to an analysis.',
        span:reportSpan, scope:reportSpan?'region':'document'});
    }

    reports.push({name:name,dataSources:dataSources,datasets:datasets,xmlSpan:reportSpan});
  });

  return {reports:reports,datasets:allDatasets,diagnostics:diagnostics,
    reportCount:reports.length,datasetCount:allDatasets.length,
    embeddedCount:embedded,sharedCount:shared,unresolvedCount:unresolved};
}

/* Short human-readable summary used by the report status panel. */
function reportSummary(parse: ReportParseResult | null): string {
  if(!parse||!parse.reportCount) return 'No report definition loaded.';
  var bits=[parse.reportCount+' report'+(parse.reportCount===1?'':'s'),
            parse.datasetCount+' dataset'+(parse.datasetCount===1?'':'s')];
  if(parse.embeddedCount) bits.push(parse.embeddedCount+' embedded');
  if(parse.sharedCount) bits.push(parse.sharedCount+' shared');
  if(parse.unresolvedCount) bits.push(parse.unresolvedCount+' unresolved');
  var nDiag=(parse.diagnostics||[]).filter(function(d){return d.severity!=='info';}).length;
  if(nDiag) bits.push(nDiag+(nDiag===1?' diagnostic':' diagnostics'));
  return bits.join(' · ');
}