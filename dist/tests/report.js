"use strict";
/* proc>flow v1.12.0 — report import (README post-v1.0.0 item 4).
   Fixtures assert that an SSRS/RDL report definition parses into a report
   linked to its datasets, that embedded, shared, and unresolved datasets are
   distinguished, that XML source locations are preserved where the element
   tags are locatable, and that parser uncertainty is region- or
   document-scoped as appropriate (report parse failures and a missing <Report>
   root are document-scoped with no fabricated span; an unresolved dataset is
   region-scoped at its own element span). Each embedded dataset's command text
   is analysed and linked via dataset.analysis, and analyse() attaches the
   parsed report plus its diagnostics.

   After this suite runs, PROCFLOW_REPORT_PASS and PROCFLOW_REPORT_RESULT gate
   the golden suite (tests/tests.ts) and feed the fixture-corpus metrics
   (tests/metrics.ts). */
(function () {
    var results = [];
    function record(name, pass, detail) {
        results.push({ name: name, pass: pass, detail: pass ? '' : detail });
    }
    function hasDiag(list, code) {
        return (list || []).some(function (d) { return d.code === code; });
    }
    var RDL_NS = 'http' + '://schemas.microsoft.com/sqlserver/reporting/2008/01/reportdefinition';
    function rdl(head, body) {
        return '<?xml version="1.0" encoding="utf-8"?>\n' +
            '<Report xmlns="' + RDL_NS + '" xmlns:rd="http' + '://schemas.microsoft.com/SQLServer/reporting/reportdesigner">\n' +
            head + '\n' + body + '\n</Report>\n';
    }
    var DS_SCHOOL = '<DataSources>\n' +
        '  <DataSource Name="SchoolDB">\n' +
        '    <ConnectionProperties>\n' +
        '      <DataProvider>SQL</DataProvider>\n' +
        '      <ConnectString>Data Source=.;Initial Catalog=School</ConnectString>\n' +
        '    </ConnectionProperties>\n' +
        '  </DataSource>\n' +
        '  <DataSource Name="SharedStore">\n' +
        '    <DataSourceReference>Shared/Store</DataSourceReference>\n' +
        '  </DataSource>\n' +
        '</DataSources>';
    var PROCFLOW_REPORT_FIXTURES = [
        /* ---- report → dataset linking + XML source locations ---- */
        {
            name: 'embedded dataset links to its SQL analysis with source locations',
            rdl: rdl(DS_SCHOOL, '<DataSets>\n' +
                '  <DataSet Name="Students">\n' +
                '    <Query>\n' +
                '      <DataSourceName>SchoolDB</DataSourceName>\n' +
                '      <CommandText>SELECT StudentId, StudentName FROM dbo.Student WHERE SchoolYear = @Year</CommandText>\n' +
                '    </Query>\n' +
                '    <Fields>\n' +
                '      <Field Name="StudentId"><DataField>StudentId</DataField></Field>\n' +
                '      <Field Name="StudentName"><DataField>StudentName</DataField></Field>\n' +
                '    </Fields>\n' +
                '  </DataSet>\n' +
                '</DataSets>'),
            expect: {
                reportCount: 1, datasetCount: 1, embeddedCount: 1, sharedCount: 0, unresolvedCount: 0,
                datasets: [
                    { name: 'Students', source: 'embedded', sql: 'SELECT StudentId, StudentName FROM dbo.Student WHERE SchoolYear = @Year',
                        dataSourceName: 'SchoolDB', hasAnalysis: true, analysisReads: ['dbo.student'] }
                ],
                noDiags: true, spansOk: true
            }
        },
        {
            name: 'data sources distinguish embedded and shared by reference',
            rdl: rdl(DS_SCHOOL, '<DataSets>\n' +
                '  <DataSet Name="AllStudents">\n' +
                '    <Query>\n' +
                '      <DataSourceName>SchoolDB</DataSourceName>\n' +
                '      <CommandText>SELECT * FROM dbo.Student</CommandText>\n' +
                '    </Query>\n' +
                '  </DataSet>\n' +
                '</DataSets>'),
            expect: {
                reportCount: 1, datasetCount: 1, embeddedCount: 1,
                datasets: [{ name: 'AllStudents', source: 'embedded', dataSourceName: 'SchoolDB' }],
                noDiags: true, spansOk: true
            }
        },
        {
            name: 'shared dataset is distinguished from embedded (no SQL to analyse)',
            rdl: rdl('<DataSources></DataSources>', '<DataSets>\n' +
                '  <DataSet Name="Rollup">\n' +
                '    <SharedDataSet>\n' +
                '      <SharedDataSetReference>Shared/Rollup</SharedDataSetReference>\n' +
                '    </SharedDataSet>\n' +
                '  </DataSet>\n' +
                '</DataSets>'),
            expect: {
                reportCount: 1, datasetCount: 1, embeddedCount: 0, sharedCount: 1, unresolvedCount: 0,
                datasets: [{ name: 'Rollup', source: 'shared', sharedReference: 'Shared/Rollup', hasAnalysis: false }],
                noDiags: true, spansOk: true
            }
        },
        {
            name: 'unresolved dataset stays explicit with a region-scoped diagnostic',
            rdl: rdl('<DataSources></DataSources>', '<DataSets>\n' +
                '  <DataSet Name="Orphan">\n' +
                '    <Query>\n' +
                '      <DataSourceName>SchoolDB</DataSourceName>\n' +
                '    </Query>\n' +
                '  </DataSet>\n' +
                '</DataSets>'),
            expect: {
                reportCount: 1, datasetCount: 1, embeddedCount: 0, sharedCount: 0, unresolvedCount: 1,
                datasets: [{ name: 'Orphan', source: 'unresolved', hasAnalysis: false }],
                diags: ['report_dataset_unresolved'],
                regionScoped: ['report_dataset_unresolved'], spansOk: true
            }
        },
        {
            name: 'mixed report links embedded, shared, and unresolved datasets',
            rdl: rdl(DS_SCHOOL, '<DataSets>\n' +
                '  <DataSet Name="Students">\n' +
                '    <Query>\n' +
                '      <DataSourceName>SchoolDB</DataSourceName>\n' +
                '      <CommandText>SELECT StudentId FROM dbo.Student</CommandText>\n' +
                '    </Query>\n' +
                '  </DataSet>\n' +
                '  <DataSet Name="Rollup">\n' +
                '    <SharedDataSet>\n' +
                '      <SharedDataSetReference>Shared/Rollup</SharedDataSetReference>\n' +
                '    </SharedDataSet>\n' +
                '  </DataSet>\n' +
                '  <DataSet Name="Broken">\n' +
                '  </DataSet>\n' +
                '</DataSets>'),
            expect: {
                reportCount: 1, datasetCount: 3, embeddedCount: 1, sharedCount: 1, unresolvedCount: 1,
                datasets: [
                    { name: 'Students', source: 'embedded', hasAnalysis: true, dataSourceName: 'SchoolDB' },
                    { name: 'Rollup', source: 'shared', sharedReference: 'Shared/Rollup' },
                    { name: 'Broken', source: 'unresolved' }
                ],
                diags: ['report_dataset_unresolved'], spansOk: true
            }
        },
        {
            name: 'multiple reports in one document each link their own datasets',
            rdl: '<?xml version="1.0" encoding="utf-8"?>\n' +
                '<Documents>\n' +
                '  <Report Name="A"><DataSets>\n' +
                '    <DataSet Name="A1"><Query><CommandText>SELECT 1 AS x</CommandText></Query></DataSet>\n' +
                '  </DataSets></Report>\n' +
                '  <Report Name="B"><DataSets>\n' +
                '    <DataSet Name="B1"><Query><CommandText>SELECT 2 AS y</CommandText></Query></DataSet>\n' +
                '  </DataSets></Report>\n' +
                '</Documents>',
            expect: {
                reportCount: 2, datasetCount: 2, embeddedCount: 2,
                datasets: [
                    { name: 'A1', source: 'embedded', hasAnalysis: true },
                    { name: 'B1', source: 'embedded', hasAnalysis: true }
                ],
                noDiags: true, spansOk: true
            }
        },
        /* ---- parser uncertainty: region vs document scope ---- */
        {
            name: 'malformed XML is a document-scoped parse error without a span',
            rdl: '<?xml version="1.0" encoding="utf-8"?>\n<Report><DataSets>',
            expect: {
                reportCount: 0, datasetCount: 0,
                diags: ['report_parse_error'],
                docScoped: ['report_parse_error']
            }
        },
        {
            name: 'well-formed XML without a Report root is document-scoped',
            rdl: '<?xml version="1.0" encoding="utf-8"?>\n<NotAReport><DataSets></DataSets></NotAReport>',
            expect: {
                reportCount: 0, datasetCount: 0,
                diags: ['report_not_report'],
                docScoped: ['report_not_report']
            }
        },
        {
            name: 'empty report text is reported without crashing',
            rdl: '   ',
            expect: {
                reportCount: 0, datasetCount: 0,
                diags: ['report_empty'],
                docScoped: ['report_empty']
            }
        },
        {
            name: 'report with no datasets is an informational annotation, not a finding',
            rdl: rdl('<DataSources></DataSources>', '<DataSets></DataSets>'),
            expect: {
                reportCount: 1, datasetCount: 0, embeddedCount: 0, sharedCount: 0, unresolvedCount: 0,
                diags: ['report_empty'], noDiags: true, spansOk: true
            }
        }
    ];
    function runReport(f) {
        return parseReport(f.rdl);
    }
    PROCFLOW_REPORT_FIXTURES.forEach(function (f) {
        try {
            var got = runReport(f);
            var e = f.expect;
            var ok = true;
            var detail = { reports: got.reports.map(function (r) {
                    return { name: r.name, datasets: r.datasets.map(function (d) { return d.name; }) };
                }), counts: { report: got.reportCount, dataset: got.datasetCount,
                    embedded: got.embeddedCount, shared: got.sharedCount, unresolved: got.unresolvedCount },
                diags: got.diagnostics.map(function (d) { return d.code; }) };
            if (e.reportCount !== undefined)
                ok = ok && got.reportCount === e.reportCount;
            if (e.datasetCount !== undefined)
                ok = ok && got.datasetCount === e.datasetCount;
            if (e.embeddedCount !== undefined)
                ok = ok && got.embeddedCount === e.embeddedCount;
            if (e.sharedCount !== undefined)
                ok = ok && got.sharedCount === e.sharedCount;
            if (e.unresolvedCount !== undefined)
                ok = ok && got.unresolvedCount === e.unresolvedCount;
            (e.datasets || []).forEach(function (exp) {
                var ds = (got.datasets || []).filter(function (d) { return d.name === exp.name; })[0];
                var missing = !ds;
                var match = !!ds &&
                    ds.source === exp.source &&
                    (exp.sql === undefined || ds.sql === exp.sql) &&
                    (exp.sharedReference === undefined || ds.sharedReference === exp.sharedReference) &&
                    (exp.dataSourceName === undefined || ds.dataSourceName === exp.dataSourceName) &&
                    (exp.hasAnalysis === undefined || !!ds.analysis === exp.hasAnalysis);
                if (exp.hasAnalysis && exp.analysisReads) {
                    var reads = (ds.analysis && ds.analysis.graph && ds.analysis.graph.nodes || [])
                        .map(function (n) { return n.text.toLowerCase(); });
                    (exp.analysisReads || []).forEach(function (r) {
                        match = match && reads.some(function (t) { return t.indexOf(r) >= 0; });
                    });
                }
                ok = ok && !missing && match;
                detail['dataset:' + exp.name] = { found: !missing, source: ds && ds.source,
                    sql: ds && ds.sql, analysis: !!(ds && ds.analysis),
                    reads: ds && ds.analysis && ds.analysis.graph &&
                        ds.analysis.graph.nodes.map(function (n) { return n.text; }) };
            });
            if (e.diags)
                ok = ok && (e.diags || []).every(function (code) { return hasDiag(got.diagnostics, code); });
            if (e.noDiags) {
                var findings = got.diagnostics.filter(function (d) { return d.severity !== 'info'; });
                ok = ok && findings.length === 0;
                detail.findings = findings.map(function (d) { return d.code; });
            }
            if (e.docScoped) {
                (e.docScoped || []).forEach(function (code) {
                    var d = (got.diagnostics || []).filter(function (x) { return x.code === code; })[0];
                    ok = ok && !!d && d.scope === 'document' && d.span === null;
                });
            }
            if (e.regionScoped) {
                (e.regionScoped || []).forEach(function (code) {
                    var d = (got.diagnostics || []).filter(function (x) { return x.code === code; })[0];
                    ok = ok && !!d && d.scope === 'region' && !!d.span &&
                        d.span.start >= 0 && d.span.end > d.span.start &&
                        d.span.end <= f.rdl.length;
                });
            }
            if (e.spansOk) {
                var src = f.rdl;
                var spanOk = (got.datasets || []).every(function (d) {
                    var dsOk = !!d.xmlSpan && d.xmlSpan.start >= 0 && d.xmlSpan.end > d.xmlSpan.start &&
                        d.xmlSpan.end <= src.length &&
                        src.slice(d.xmlSpan.start, d.xmlSpan.end).indexOf('<DataSet') >= 0;
                    var sqlOk = d.source !== 'embedded' ||
                        (!!d.sqlSpan && d.sqlSpan.start >= 0 && d.sqlSpan.end > d.sqlSpan.start &&
                            d.sqlSpan.end <= src.length &&
                            src.slice(d.sqlSpan.start, d.sqlSpan.end).indexOf('<CommandText') >= 0);
                    return dsOk && sqlOk;
                });
                var reportSpanOk = (got.reports || []).every(function (r) {
                    return !!r.xmlSpan && r.xmlSpan.start >= 0 && r.xmlSpan.end > r.xmlSpan.start &&
                        r.xmlSpan.end <= src.length &&
                        src.slice(r.xmlSpan.start, r.xmlSpan.end).indexOf('<Report') >= 0;
                });
                ok = ok && spanOk && reportSpanOk;
                detail.spans = { dataset: spanOk, report: reportSpanOk };
            }
            record(f.name, ok, JSON.stringify(detail));
        }
        catch (err) {
            record(f.name, false, String(err && err.stack || err));
        }
    });
    /* ---- integration: analyse() attaches the report model and diagnostics ---- */
    try {
        var rdlSrc = rdl(DS_SCHOOL, '<DataSets>\n' +
            '  <DataSet Name="Students">\n' +
            '    <Query>\n' +
            '      <DataSourceName>SchoolDB</DataSourceName>\n' +
            '      <CommandText>SELECT StudentId FROM dbo.Student</CommandText>\n' +
            '    </Query>\n' +
            '  </DataSet>\n' +
            '  <DataSet Name="Broken"></DataSet>\n' +
            '</DataSets>');
        var report = parseReport(rdlSrc);
        var ir = analyse('CREATE PROC dbo.report_proc AS BEGIN\n  SELECT 1;\nEND', { dialect: 'tsql', mode: 'flow', group: false, sources: true, reports: report });
        var integrated = !!ir.reportParse && ir.reportParse.reportCount === 1 &&
            !!ir.reportDiagnostics && ir.reportDiagnostics.length >= 1 &&
            ir.reportDiagnostics.some(function (d) { return d.code === 'report_dataset_unresolved'; }) &&
            ir.diagnostics.some(function (d) { return d.code === 'report_dataset_unresolved'; });
        record('v1.12.0 analyse() attaches the report model and merges its diagnostics', integrated, JSON.stringify({
            reportParse: ir.reportParse && { reports: ir.reportParse.reportCount,
                datasets: ir.reportParse.datasetCount },
            reportDiags: ir.reportDiagnostics && ir.reportDiagnostics.map(function (d) { return d.code; }),
            merged: ir.diagnostics.map(function (d) { return d.code; })
        }));
    }
    catch (err) {
        record('v1.12.0 analyse() attaches the report model and merges its diagnostics', false, String(err && err.stack || err));
    }
    /* ---- E: document-scoped report findings carry no fabricated span ---- */
    try {
        var docScoped = parseReport('<Report><DataSets>');
        var spanless = (docScoped.diagnostics || []).filter(function (d) { return d.scope === 'document'; })
            .every(function (d) { return d.span === null; });
        var regionless = (docScoped.diagnostics || []).filter(function (d) { return d.scope === 'region'; })
            .every(function (d) { return !!d.span; });
        record('v1.12.0 report diagnostics respect region/document scope and spans', spanless && regionless, JSON.stringify({
            diags: docScoped.diagnostics.map(function (d) { return { code: d.code, scope: d.scope, span: d.span }; })
        }));
    }
    catch (err) {
        record('v1.12.0 report diagnostics respect region/document scope and spans', false, String(err && err.stack || err));
    }
    var passed = results.filter(function (r) { return r.pass; }).length;
    window.PROCFLOW_REPORT_RESULT = { passed: passed, total: results.length };
    window.PROCFLOW_REPORT_PASS = passed === results.length;
    window.PROCFLOW_REPORT_DETAIL = results;
    var out = document.getElementById('report-results');
    if (out)
        out.textContent = JSON.stringify({
            reports: passed + '/' + results.length,
            failures: results.filter(function (r) { return !r.pass; }).map(function (r) {
                return { name: r.name, detail: r.detail };
            })
        }, null, 2);
    var sum = document.getElementById('report-summary');
    if (sum)
        sum.textContent = 'v1.12.0 reports · ' + (passed + '/' + results.length);
})();
//# sourceMappingURL=report.js.map