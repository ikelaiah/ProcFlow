"use strict";
/* v2.0.0 hostile-input regression suite. The parser treats all fixture text
   as data; browser rendering is checked asynchronously in security.html with
   Mermaid's strict security level. */
(function () {
    var results = [];
    function record(name, pass, detail) {
        results.push({ name: name, pass: pass, detail: detail });
    }
    var payloads = ['<script>alert(1)</script>', '<img src=x onerror=alert(1)>',
        'javascript:alert(1)', '</foreignObject><script>alert(1)</script>'];
    function containsExecutableMarkup(text, doc) {
        if (/<\s*(script|img|foreignObject)\b/i.test(text))
            return true;
        if (!doc)
            return false;
        return Array.prototype.some.call(doc.querySelectorAll('*'), function (el) {
            for (var i = 0; i < el.attributes.length; i++) {
                var attr = el.attributes[i];
                if (/^(onerror|onload|onclick)$/i.test(attr.name))
                    return true;
                if (/^(href|xlink:href|src)$/i.test(attr.name) && /^javascript:/i.test(attr.value))
                    return true;
            }
            return false;
        });
    }
    function xmlEscape(text) {
        return text.replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
    }
    var hostileSql = 'CREATE VIEW [<script>alert(1)</script>] AS\n' +
        "SELECT [javascript:alert(1)] AS [<img src=x onerror=alert(1)>], " +
        "'<script>alert(1)</script>' AS literal_payload " +
        'FROM [dbo].[</foreignObject><script>alert(1)</script>] -- ' + payloads[0];
    var analysed = analyse(hostileSql, { dialect: 'tsql', mode: 'query', sources: true });
    var mermaidCode = analysed.mermaid;
    var drawio = toDrawio(analysed.graph, { title: payloads[2], dir: 'TD' });
    var xmlDoc = new DOMParser().parseFromString(drawio, 'application/xml');
    record('hostile SQL remains escaped in exports', !containsExecutableMarkup(mermaidCode) && !containsExecutableMarkup(drawio) &&
        !xmlDoc.querySelector('parsererror') && drawio.indexOf('data-procflow=') >= 0, { mermaidHasRaw: payloads.some(function (p) { return mermaidCode.indexOf(p) >= 0; }),
        drawioHasExecutableMarkup: containsExecutableMarkup(drawio) });
    var catalogue = parseCatalogue(JSON.stringify({ objects: [
            { name: payloads[0], kind: 'TABLE' }, { name: payloads[1], kind: 'TABLE' }
        ] }));
    var catAnalysis = analyse('SELECT id FROM [' + payloads[0] + '];', { dialect: 'tsql', mode: 'query', sources: true, catalogue: catalogue.catalogue,
        catalogueDiagnostics: catalogue.diagnostics });
    var catalogueMermaid = catAnalysis.mermaid;
    var catalogueDrawio = toDrawio(catAnalysis.graph, { title: payloads[1] });
    record('hostile catalogue names stay data', !containsExecutableMarkup(catalogueMermaid) &&
        !containsExecutableMarkup(catalogueDrawio, xmlDoc), { diagnostics: catAnalysis.diagnostics.length,
        mermaidBad: containsExecutableMarkup(catalogueMermaid),
        drawioBad: containsExecutableMarkup(catalogueDrawio, xmlDoc),
        mermaid: catalogueMermaid });
    var originalRdl = '<Report Name="' + xmlEscape(payloads[0]) + '"><DataSets>' +
        '<DataSet Name="' + xmlEscape(payloads[1]) + '"><Query><CommandText>' + xmlEscape(hostileSql) +
        '</CommandText></Query></DataSet></DataSets></Report>';
    var parsedReport = parseReport(originalRdl);
    var reportGraph = buildReportGraph(parsedReport, {});
    var reportMermaid = toMermaid(reportGraph, 'TD');
    var reportXml = toDrawio(reportGraph, { title: payloads[3], dir: 'TD' });
    var reportDoc = new DOMParser().parseFromString(reportXml, 'application/xml');
    record('hostile RDL names do not become executable markup', parsedReport.reportCount === 1 && parsedReport.datasetCount === 1 &&
        !containsExecutableMarkup(reportMermaid) && !containsExecutableMarkup(reportXml, reportDoc) &&
        !reportDoc.querySelector('parsererror'), { reports: parsedReport.reportCount, datasets: parsedReport.datasetCount,
        diagnostics: parsedReport.diagnostics.length,
        mermaidBad: containsExecutableMarkup(reportMermaid),
        xmlBad: containsExecutableMarkup(reportXml, reportDoc),
        mermaid: reportMermaid });
    record('source and diagnostic strings remain plain data', hostileSql.indexOf(payloads[0]) >= 0 &&
        analysed.diagnostics.every(function (d) { return typeof d.message === 'string'; }), { sourcePreserved: hostileSql.indexOf(payloads[0]) >= 0 });
    function finish(extra) {
        if (extra)
            record(extra.name, extra.pass, extra.detail);
        var passed = results.filter(function (r) { return r.pass; }).length;
        window.PROCFLOW_SECURITY_PASS = passed === results.length;
        window.PROCFLOW_SECURITY_RESULT = { passed: passed, total: results.length };
        window.PROCFLOW_SECURITY_DETAIL = results;
        document.body.className = passed === results.length ? 'pass' : 'fail';
        var out = document.getElementById('security-results');
        if (out)
            out.textContent = JSON.stringify({ passed: passed, total: results.length,
                failures: results.filter(function (r) { return !r.pass; }) }, null, 2);
        var summary = document.getElementById('security-summary');
        if (summary)
            summary.textContent = 'v2.0.0 hostile-input security · ' + passed + '/' + results.length;
    }
    if (typeof mermaid === 'undefined') {
        finish({ name: 'Mermaid strict security runtime available', pass: false,
            detail: 'vendor/mermaid/mermaid.min.js was not loaded' });
    }
    else {
        mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', flowchart: { htmlLabels: true } });
        mermaid.render('security-hostile', mermaidCode).then(function (rendered) {
            var holder = document.createElement('div');
            holder.innerHTML = rendered.svg;
            var svg = holder.querySelector('svg');
            finish({ name: 'Mermaid strict rendering contains no executable payload',
                pass: !!svg && !holder.querySelector('script') && !holder.querySelector('[onerror]') &&
                    !holder.querySelector('[onclick]') &&
                    !Array.prototype.some.call(holder.querySelectorAll('[href],[xlink\\:href]'), function (el) {
                        return /^javascript:/i.test(el.getAttribute('href') || el.getAttribute('xlink:href') || '');
                    }),
                detail: { svg: !!svg, scripts: holder.querySelectorAll('script').length } });
        }).catch(function (err) {
            finish({ name: 'Mermaid strict rendering contains no executable payload', pass: false,
                detail: String(err && err.stack || err) });
        });
    }
})();
//# sourceMappingURL=security.js.map