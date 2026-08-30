"use strict";
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

   Combined report dependency views and report export were delivered in
   v1.13.0; this module retains the parser, report→dataset linkage, XML source
   locations, and the E diagnostics. */
/* Local-name search across a DOM root, namespace-agnostic (RDL elements may
   carry a default namespace). */
function rdlLocal(root, local) {
    var out = [];
    Array.prototype.forEach.call(root.getElementsByTagName('*'), function (el) {
        var ln = (el.localName || el.tagName || '').replace(/^.*:/, '');
        if (ln === local)
            out.push(el);
    });
    return out;
}
function rdlText(el, local) {
    if (!el)
        return null;
    var found = rdlLocal(el, local);
    return found.length ? (found[0].textContent || '').trim() : null;
}
function rdlChild(el, local) {
    if (!el)
        return null;
    var found = rdlLocal(el, local);
    return found.length ? found[0] : null;
}
/* Read an attribute by name from a captured open-tag attribute string. */
function rdlAttr(attrText, name) {
    var re = new RegExp('\\b' + name + '\\s*=\\s*(["\'])(.*?)\\1', 'i');
    var m = re.exec(attrText);
    return m ? m[2] : null;
}
/* End of an XML open tag starting at `start`, respecting quoted attribute
   values so `>` inside quotes never terminates the tag early. */
function rdlOpenTagEnd(text, start) {
    var i = start, n = text.length, q = '';
    while (i < n) {
        var c = text.charAt(i);
        if (q) {
            if (c === q)
                q = '';
            i++;
            continue;
        }
        if (c === '"' || c === "'") {
            q = c;
            i++;
            continue;
        }
        if (c === '>')
            return i + 1;
        i++;
    }
    return n;
}
/* Locate every open tag `<local>` (optionally namespace-prefixed) in the raw
   report text and the span of the whole element (open tag through close tag).
   `DataSet` never matches `DataSets` because the regex demands a boundary. */
function rdlOpenTags(text, local) {
    var re = new RegExp('<((?:[\\w.-]+:)?' + local + ')([\\s>\\/])', 'g');
    var out = [];
    var m;
    while ((m = re.exec(text)) !== null) {
        var start = m.index;
        var openEnd = rdlOpenTagEnd(text, start);
        if (openEnd < 0)
            break;
        var openText = text.slice(start, openEnd);
        var attrText = text.slice(start + m[1].length + 1, openEnd - 1);
        var selfClosing = /\/\s*$/.test(openText.slice(0, openEnd - start - 1));
        var end = openEnd;
        if (!selfClosing) {
            var close = text.indexOf('</' + local, openEnd);
            var closeEnd = close < 0 ? -1 : text.indexOf('>', close) + 1;
            if (closeEnd > 0)
                end = closeEnd;
        }
        out.push({ start: start, end: end, attrText: attrText, openEnd: openEnd, selfClosing: selfClosing });
    }
    return out;
}
/* Pick the element span whose open-tag Name attribute equals `name` (RDL
   dataset/data-source names are unique within a report). Falls back to order
   when no Name attribute is present. */
function rdlSpanForName(spans, name, index) {
    if (!spans || !spans.length)
        return null;
    if (name) {
        for (var i = 0; i < spans.length; i++) {
            if (rdlAttr(spans[i].attrText, 'Name') === name)
                return { start: spans[i].start, end: spans[i].end };
        }
    }
    var s = spans[index];
    return s ? { start: s.start, end: s.end } : null;
}
/* The dataset command-text span: the innermost <CommandText> element fully
   inside the dataset's own span, matched by attribute-free ordering. */
function rdlInnerSpan(text, outer, local) {
    if (!outer)
        return null;
    var all = rdlOpenTags(text, local).filter(function (s) {
        return s.start >= outer.start && s.end <= outer.end;
    });
    if (!all.length)
        return null;
    var s = all[0];
    return { start: s.start, end: s.end };
}
/* Determine the SQL command text inside a dataset's <Query>. Returns the
   decoded text and its span (the <CommandText> element). */
function rdlDatasetCommand(text, dsEl, outer) {
    var query = rdlChild(dsEl, 'Query');
    var cmd = query ? rdlChild(query, 'CommandText') : null;
    var sql = cmd ? (cmd.textContent || '').trim() : '';
    var sqlSpan = rdlInnerSpan(text, outer, 'CommandText');
    var dataSourceName = query ? rdlText(query, 'DataSourceName') : null;
    return { sql: sql, sqlSpan: sqlSpan, dataSourceName: dataSourceName };
}
/* Parse a report definition (RDL/XML text) into a ReportParseResult. Every
   embedded dataset's command text is run through the existing SQL analysis so
   each dataset links to its analysis; shared and unresolved datasets stay
   explicit. Returns diagnostics with correct region/document scope. */
function parseReport(text) {
    var src = String(text == null ? '' : text);
    var diagnostics = [];
    var reports = [];
    var allDatasets = [];
    var embedded = 0, shared = 0, unresolved = 0;
    if (!src.trim()) {
        diagnostics.push({ severity: 'warning', code: 'report_empty',
            message: 'The report definition is empty.',
            span: null, scope: 'document' });
        return { reports: reports, datasets: allDatasets, diagnostics: diagnostics,
            reportCount: 0, datasetCount: 0, embeddedCount: 0, sharedCount: 0, unresolvedCount: 0 };
    }
    var doc = null;
    try {
        doc = new DOMParser().parseFromString(src, 'application/xml');
    }
    catch (e) {
        diagnostics.push({ severity: 'error', code: 'report_parse_error',
            message: 'The report definition could not be parsed as XML: ' +
                (e instanceof Error ? e.message : String(e)),
            span: null, scope: 'document' });
        return { reports: reports, datasets: allDatasets, diagnostics: diagnostics,
            reportCount: 0, datasetCount: 0, embeddedCount: 0, sharedCount: 0, unresolvedCount: 0 };
    }
    if (!doc || rdlLocal(doc, 'parsererror').length) {
        diagnostics.push({ severity: 'error', code: 'report_parse_error',
            message: 'The report definition is not well-formed XML. Check the file for unclosed tags, quoting, or encoding.',
            span: null, scope: 'document' });
        return { reports: reports, datasets: allDatasets, diagnostics: diagnostics,
            reportCount: 0, datasetCount: 0, embeddedCount: 0, sharedCount: 0, unresolvedCount: 0 };
    }
    var reportEls = rdlLocal(doc, 'Report');
    if (!reportEls.length) {
        diagnostics.push({ severity: 'warning', code: 'report_not_report',
            message: 'The XML is well formed but contains no <Report> root element, so it is not an SSRS report definition.',
            span: null, scope: 'document' });
        return { reports: reports, datasets: allDatasets, diagnostics: diagnostics,
            reportCount: 0, datasetCount: 0, embeddedCount: 0, sharedCount: 0, unresolvedCount: 0 };
    }
    reportEls.forEach(function (reportEl) {
        var name = reportEl.getAttribute('Name') || 'Report';
        var reportSpan = rdlSpanForName(rdlOpenTags(src, 'Report'), name, 0);
        var dataSources = [];
        var dsSpans = rdlOpenTags(src, 'DataSource');
        rdlLocal(reportEl, 'DataSource').forEach(function (dsEl, i) {
            var dsName = dsEl.getAttribute('Name') || '';
            var dsSpan = rdlSpanForName(dsSpans, dsName, i);
            var kind = rdlChild(dsEl, 'DataSourceReference')
                ? 'shared' : 'embedded';
            var provider = rdlText(dsEl, 'DataProvider');
            dataSources.push({ name: dsName, kind: kind, provider: provider, xmlSpan: dsSpan });
        });
        var datasets = [];
        var setSpans = rdlOpenTags(src, 'DataSet');
        rdlLocal(reportEl, 'DataSet').forEach(function (dsEl, i) {
            var dsName = dsEl.getAttribute('Name') || '';
            var dsSpan = rdlSpanForName(setSpans, dsName, i);
            var sharedRef = rdlText(dsEl, 'SharedDataSetReference');
            var cmd = rdlDatasetCommand(src, dsEl, dsSpan);
            var source;
            if (cmd.sql && cmd.sql.length)
                source = 'embedded';
            else if (sharedRef && sharedRef.length)
                source = 'shared';
            else
                source = 'unresolved';
            var ds = {
                name: dsName, source: source,
                dataSourceName: cmd.dataSourceName,
                sql: cmd.sql || null, sqlSpan: cmd.sqlSpan,
                sharedReference: sharedRef || null, xmlSpan: dsSpan, analysis: null
            };
            if (source === 'embedded') {
                embedded++;
                try {
                    ds.analysis = analyse(ds.sql, { dialect: 'auto', mode: 'auto', group: false, sources: true });
                }
                catch (e) {
                    ds.analysis = null;
                    diagnostics.push({ severity: 'warning', code: 'report_dataset_analysis_error',
                        message: 'Dataset "' + dsName + '" command text could not be analysed: ' +
                            (e instanceof Error ? e.message : String(e)),
                        span: cmd.sqlSpan || dsSpan, scope: cmd.sqlSpan || dsSpan ? 'region' : 'document' });
                }
            }
            else if (source === 'shared') {
                shared++;
            }
            else {
                unresolved++;
                diagnostics.push({ severity: 'warning', code: 'report_dataset_unresolved',
                    message: 'Dataset "' + dsName + '" has neither a command text nor a shared dataset reference, so it cannot be linked to any SQL analysis.',
                    span: dsSpan, scope: dsSpan ? 'region' : 'document' });
            }
            datasets.push(ds);
            allDatasets.push(ds);
        });
        if (!datasets.length) {
            diagnostics.push({ severity: 'info', code: 'report_empty',
                message: 'Report "' + name + '" defines no datasets; there is nothing to link to an analysis.',
                span: reportSpan, scope: reportSpan ? 'region' : 'document' });
        }
        reports.push({ name: name, dataSources: dataSources, datasets: datasets, xmlSpan: reportSpan });
    });
    return { reports: reports, datasets: allDatasets, diagnostics: diagnostics,
        reportCount: reports.length, datasetCount: allDatasets.length,
        embeddedCount: embedded, sharedCount: shared, unresolvedCount: unresolved };
}
/* Short human-readable summary used by the report status panel. */
function reportSummary(parse) {
    if (!parse || !parse.reportCount)
        return 'No report definition loaded.';
    var bits = [parse.reportCount + ' report' + (parse.reportCount === 1 ? '' : 's'),
        parse.datasetCount + ' dataset' + (parse.datasetCount === 1 ? '' : 's')];
    if (parse.embeddedCount)
        bits.push(parse.embeddedCount + ' embedded');
    if (parse.sharedCount)
        bits.push(parse.sharedCount + ' shared');
    if (parse.unresolvedCount)
        bits.push(parse.unresolvedCount + ' unresolved');
    var nDiag = (parse.diagnostics || []).filter(function (d) { return d.severity !== 'info'; }).length;
    if (nDiag)
        bits.push(nDiag + (nDiag === 1 ? ' diagnostic' : ' diagnostics'));
    return bits.join(' · ');
}
/* ===== v1.13.0 Report intelligence (report → dataset → object → column) =====
   A report dependency graph built on the v1.9.0 catalogue and the v1.11.0
   column contract: each report links to its datasets, each embedded dataset's
   SQL analysis links to the objects it reads/writes/calls (catalogue-verified
   where possible), and each object links to the columns its query references
   (from the column-lineage model, only when the columns are known — never
   invented). Shared datasets keep their external shared-dataset identity and
   unresolved datasets stay explicit. The graph is a plain `Graph` exported on
   its own documented `report` layout class with full provenance metadata
   (F export fidelity). filterReportGraph is presentation-only: it derives a
   filtered view at render time and never mutates the underlying graph.
   Large-graph convergence stays deferred to v1.14.0. */
/* Build the report dependency graph for a parsed report definition. The
   `analysis` attached to each embedded dataset (v1.12.0) provides the object
   facts (reads/writes/calls) and the column-lineage sources that name the
   columns each query actually references. */
function buildReportGraph(parse, opts) {
    var nodes = [], edges = [];
    var seq = 0;
    var repIds = {};
    var dsIds = {};
    var objIds = {};
    var colIds = {};
    var cat = opts && opts.catalogue || null;
    function add(text, cls, shape, source, provenance, objectId, reason, lines, resolution, resolvedName) {
        var id = 'r' + (++seq);
        var structured = lines && lines.length
            ? lines.map(function (l) { return String(l).trim(); }).filter(function (l) { return l.length > 0; })
            : undefined;
        var node = { id: id, shape: shape,
            text: structured ? structured.join('\n') : text,
            cls: cls,
            source: source || null, objectId: objectId || null,
            provenance: provenance || (source ? 'source' : 'synthetic'),
            reason: reason || undefined };
        if (structured)
            node.lines = structured;
        if (resolution)
            node.resolution = resolution;
        if (resolvedName)
            node.resolvedName = resolvedName;
        nodes.push(node);
        return id;
    }
    function datasetNode(ds, reportName) {
        var dkey = reportName.toUpperCase() + '|' + ds.name.toUpperCase();
        if (dsIds[dkey])
            return dsIds[dkey];
        var cls = ds.source === 'shared' ? 'dsshared' :
            (ds.source === 'unresolved' ? 'dsunresolved' : 'dsembedded');
        var lines = [ds.name, ds.source];
        if (ds.source === 'shared' && ds.sharedReference)
            lines[1] = lines[1] + ' · ' + ds.sharedReference;
        if (ds.dataSourceName)
            lines.push(ds.dataSourceName);
        var id = add(ds.name, cls, 'io', ds.xmlSpan, 'source', undefined, ds.source === 'unresolved' ? 'no command text or shared dataset reference' : undefined, lines);
        dsIds[dkey] = id;
        return id;
    }
    function objectNode(name, readType) {
        var key = name.toUpperCase();
        if (objIds[key])
            return objIds[key];
        var id;
        if (name.charAt(0) === '#') {
            id = add(name, 'repobj', 'io', null, 'synthetic', name, 'temporary table placeholder', [name, 'temp table']);
        }
        else {
            var remote = name.split('.').length >= 3;
            var res = cat ? resolveCatalogue(cat, name) : { resolution: 'external' };
            if (res.resolution === 'verified' && res.resolvedName) {
                id = add(res.resolvedName, 'repobj', 'io', null, 'external', name, undefined, [res.resolvedName, 'verified'], 'verified', res.resolvedName);
            }
            else {
                id = add(remote ? 'external: ' + name : name, 'repobj', 'io', null, 'external', name, res.resolution === 'conflict' ? 'conflicting catalogue evidence; identity unresolved' : undefined, [remote ? 'external: ' + name : name,
                    readType === 'call' ? 'call' : (readType === 'write' ? 'write' : 'read')], res.resolution === 'conflict' ? 'conflict' : undefined, undefined);
            }
        }
        objIds[key] = id;
        return id;
    }
    function columnNode(objName, colName, span) {
        var key = objName.toUpperCase() + '|' + colName.toUpperCase();
        if (colIds[key])
            return colIds[key];
        var id = add(colName, 'repcol', 'rect', span, 'source');
        colIds[key] = id;
        return id;
    }
    (parse && parse.reports || []).forEach(function (report) {
        var rid = add(report.name, 'report', 'rect', report.xmlSpan, 'source', undefined, undefined, [report.name, 'report']);
        repIds[report.name.toUpperCase()] = rid;
        (report.datasets || []).forEach(function (ds) {
            var did = datasetNode(ds, report.name);
            edges.push({ from: rid, to: did, label: '', style: 'solid', kind: 'dependency' });
            if (ds.source !== 'embedded' || !ds.analysis)
                return;
            /* Object facts come from the dataset's SQL analysis (v1.12.0). */
            var unit = { id: 'dataset-' + ds.name, sql: ds.sql || '', name: ds.name, file: 'report' };
            var facts = buildObjectIR(ds.analysis, unit);
            var seen = {};
            function link(type, name) {
                var key = type + ':' + name.toUpperCase();
                if (seen[key])
                    return;
                seen[key] = 1;
                var oid = objectNode(name, type);
                var kind = type === 'call' ? 'call' : (type === 'write' ? 'data' : 'dependency');
                edges.push({ from: did, to: oid, label: type, style: type === 'write' ? 'dotted' : 'solid', kind: kind });
            }
            (facts.reads || []).forEach(function (n) { link('read', n); });
            (facts.writes || []).forEach(function (n) { link('write', n); });
            (facts.calls || []).forEach(function (n) { link('call', n); });
            /* Columns referenced by the query, from the v1.11.0 column contract.
               Two provable sources contribute and nothing is ever invented:
                 - sources with known columns (catalogue/CTE-backed wildcards);
                 - exact output bindings (binding.source is the source key, mapped
                   back to its object name; binding.column is the referenced column).
               Column keys (aliases) are resolved to their real object name so a
               column node hangs off the object it belongs to. */
            var srcKeyToName = {};
            (ds.analysis.columns || []).forEach(function (lin) {
                (lin.sources || []).forEach(function (src) {
                    if (src.key)
                        srcKeyToName[String(src.key).toUpperCase()] = src.name;
                });
            });
            function linkColumn(objName, colName, span) {
                var okey = objName.toUpperCase();
                if (!objIds[okey])
                    return;
                var cid = columnNode(objName, colName, span);
                edges.push({ from: objIds[okey], to: cid, label: '', style: 'solid', kind: 'data' });
            }
            (ds.analysis.columns || []).forEach(function (lin) {
                (lin.sources || []).forEach(function (src) {
                    if (!src.columnsKnown || !src.columns || !src.columns.length)
                        return;
                    src.columns.forEach(function (cname) { linkColumn(src.name, cname, src.span); });
                });
                (lin.outputs || []).forEach(function (out) {
                    (out.bindings || []).forEach(function (b) {
                        var objName = srcKeyToName[String(b.source).toUpperCase()] || b.source;
                        if (b.column)
                            linkColumn(objName, b.column, b.span);
                    });
                });
            });
        });
    });
    return { nodes: nodes, edges: edges, stats: {
            reports: Object.keys(repIds).length,
            datasets: Object.keys(dsIds).length,
            embedded: (parse && parse.embeddedCount) || 0,
            shared: (parse && parse.sharedCount) || 0,
            unresolved: (parse && parse.unresolvedCount) || 0,
            objects: Object.keys(objIds).length,
            columns: Object.keys(colIds).length
        } };
}
/* Presentation-only filtering over a report graph. The returned graph is a
   fresh copy; the input graph is never mutated, so toggling a filter or
   clearing the focus never changes the analysis. A non-empty focus keeps a
   report, dataset, or object and its direct neighbours (one hop). */
function filterReportGraph(graph, filter) {
    var f = {
        columns: filter && filter.columns !== undefined ? filter.columns : true,
        embedded: filter && filter.embedded !== undefined ? filter.embedded : true,
        shared: filter && filter.shared !== undefined ? filter.shared : true,
        unresolved: filter && filter.unresolved !== undefined ? filter.unresolved : true,
        external: filter && filter.external !== undefined ? filter.external : true,
        focus: filter && filter.focus ? String(filter.focus) : ''
    };
    if (!graph || !graph.nodes || !graph.nodes.length)
        return { nodes: [], edges: [], stats: graph && graph.stats || {} };
    var keep = {};
    graph.nodes.forEach(function (n) {
        if (n.cls === 'report') {
            keep[n.id] = 1;
            return;
        }
        if (n.cls === 'repcol') {
            if (f.columns)
                keep[n.id] = 1;
            return;
        }
        if (n.cls === 'dsembedded') {
            if (f.embedded)
                keep[n.id] = 1;
            return;
        }
        if (n.cls === 'dsshared') {
            if (f.shared)
                keep[n.id] = 1;
            return;
        }
        if (n.cls === 'dsunresolved') {
            if (f.unresolved)
                keep[n.id] = 1;
            return;
        }
        if (n.cls === 'repobj') {
            if (n.provenance === 'external' && !f.external)
                return;
            keep[n.id] = 1;
            return;
        }
        keep[n.id] = 1;
    });
    var focus = String(f.focus || '').trim().toUpperCase();
    if (focus) {
        var matched = {};
        var neighbour = {};
        graph.nodes.forEach(function (n) {
            if (keep[n.id] && (String(n.text || '').toUpperCase().indexOf(focus) >= 0 ||
                String(n.objectId || '').toUpperCase().indexOf(focus) >= 0))
                matched[n.id] = 1;
        });
        if (focus && !Object.keys(matched).length)
            return { nodes: [], edges: [], stats: graph.stats, empty: true };
        graph.edges.forEach(function (e) {
            if (matched[e.from])
                neighbour[e.to] = 1;
            if (matched[e.to])
                neighbour[e.from] = 1;
        });
        var narrowed = {};
        graph.nodes.forEach(function (n) {
            if (keep[n.id] && (matched[n.id] || neighbour[n.id]))
                narrowed[n.id] = 1;
        });
        keep = narrowed;
    }
    var nodes = (graph.nodes || []).filter(function (n) {
        return keep[n.id] === 1;
    }).map(function (n) {
        var c = {};
        for (var k in n)
            c[k] = n[k];
        return c;
    });
    var edges = (graph.edges || []).filter(function (e) {
        return keep[e.from] === 1 && keep[e.to] === 1;
    }).map(function (e) {
        var c = {};
        for (var k in e)
            c[k] = e[k];
        return c;
    });
    return { nodes: nodes, edges: edges, stats: graph.stats };
}
//# sourceMappingURL=report.js.map