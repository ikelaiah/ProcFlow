"use strict";
/* proc>flow: Mermaid, draw.io, and narration exporters */
function toMermaid(graph, dir) {
    var L = ['flowchart ' + (dir || 'TD')];
    var wrap = { rect: ['["', '"]'], diamond: ['{"', '"}'], hex: ['{{"', '"}}'],
        round: ['(["', '"])'], marker: ['>"', '"]'], io: ['[("', '")]'], call: ['[["', '"]]'] };
    graph.nodes.forEach(function (n) { if (n.shape === 'io')
        n.cls = n.cls || 'io'; });
    graph.nodes.forEach(function (n) {
        var shape = n.shape;
        if (shape === 'rect' && n.cls === 'io')
            shape = 'io';
        if (shape === 'rect' && n.cls === 'call')
            shape = 'call';
        var w = wrap[shape] || wrap.rect;
        L.push('  ' + n.id + w[0] + escLabel(n.text).replace(/<BR>/g, '<br/>') + w[1]);
    });
    graph.edges.forEach(function (e) {
        var arrow = e.style === 'dotted' ? '-.->' : '-->';
        L.push('  ' + e.from + ' ' + arrow + (e.label ? '|' + escLabel(e.label) + '|' : '') + ' ' + e.to);
    });
    var styles = {
        start: 'fill:#2b3d4a,stroke:#8ea3b4,color:#e7eef3',
        stmt: 'fill:#1e2b35,stroke:#516878,color:#e7eef3',
        notice: 'fill:#25313a,stroke:#7b91a3,color:#d7e2ea',
        io: 'fill:#1b3140,stroke:#7ea6e0,color:#dcebff',
        cursor: 'fill:#172d36,stroke:#4fb3a5,color:#d9fff8',
        call: 'fill:#20303c,stroke:#7ea6e0,color:#dcebff',
        tran: 'fill:#232f2b,stroke:#54c39b,color:#dff5ec',
        cond: 'fill:#3a2c15,stroke:#e8a33d,color:#ffeccc',
        loop: 'fill:#152b3d,stroke:#7ea6e0,color:#dcebff',
        try: 'fill:#1f2c33,stroke:#54c39b,color:#dff5ec',
        catch: 'fill:#39231f,stroke:#e4645e,color:#ffdedc',
        ret: 'fill:#1f3329,stroke:#54c39b,color:#dff5ec',
        err: 'fill:#3a2320,stroke:#e4645e,color:#ffdedc',
        halt: 'fill:#2a2438,stroke:#a98fd6,color:#ece4ff',
        opaque: 'fill:#332b1f,stroke:#f59e0b,color:#fef3c7,stroke-dasharray:5 3',
        flowctl: 'fill:#2a2438,stroke:#a98fd6,color:#ece4ff',
        cte: 'fill:#1c2f3f,stroke:#7ea6e0,color:#dcebff',
        src: 'fill:#1b242c,stroke:#4c6274,color:#a9bccb',
        final: 'fill:#3a2c15,stroke:#e8a33d,color:#ffeccc'
    };
    var byClass = {};
    graph.nodes.forEach(function (n) { (byClass[n.cls] = byClass[n.cls] || []).push(n.id); });
    Object.keys(byClass).forEach(function (c) {
        if (!styles[c])
            return;
        var safe = 'pf' + c.charAt(0).toUpperCase() + c.slice(1); /* 'call', 'class', 'end' are reserved */
        L.push('  classDef ' + safe + ' ' + styles[c] + ',stroke-width:1px;');
        L.push('  class ' + byClass[c].join(',') + ' ' + safe + ';');
    });
    return L.join('\n');
}
/* ---------- draw.io export ---------- */
function xmlAttr(s) {
    return String(s === undefined || s === null ? '' : s)
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/[\r\n]+/g, '&#xa;');
}
function layoutDrawio(graph, dir) {
    var nodes = graph.nodes || [], edges = graph.edges || [], rank = {}, byId = {}, out = {}, queue = [];
    nodes.forEach(function (n) { byId[n.id] = n; out[n.id] = []; });
    edges.forEach(function (e) { if (out[e.from] && byId[e.to])
        out[e.from].push(e.to); });
    if (nodes.length) {
        rank[nodes[0].id] = 0;
        queue.push(nodes[0].id);
    }
    while (queue.length) {
        var id = queue.shift(), next = out[id] || [];
        next.forEach(function (to) {
            if (rank[to] === undefined) {
                rank[to] = rank[id] + 1;
                queue.push(to);
            }
        });
    }
    var maxRank = 0;
    nodes.forEach(function (n) {
        if (rank[n.id] === undefined)
            rank[n.id] = maxRank + 1;
        maxRank = Math.max(maxRank, rank[n.id]);
    });
    var levels = [];
    nodes.forEach(function (n) { (levels[rank[n.id]] = levels[rank[n.id]] || []).push(n); });
    var pos = {}, topDown = dir !== 'LR', rankGap = topDown ? 145 : 255, itemGap = topDown ? 220 : 115;
    levels.forEach(function (level, r) {
        if (!level)
            return;
        var span = (level.length - 1) * itemGap;
        level.forEach(function (n, i) {
            var w = 180, h = 60;
            if (n.shape === 'diamond') {
                w = 180;
                h = 90;
            }
            else if (n.shape === 'hex') {
                w = 180;
                h = 70;
            }
            else if (n.shape === 'round') {
                w = 150;
                h = 58;
            }
            else if (n.shape === 'marker') {
                w = 145;
                h = 52;
            }
            var cross = i * itemGap - span / 2;
            pos[n.id] = topDown
                ? { x: 520 + cross - w / 2, y: 45 + r * rankGap, w: w, h: h }
                : { x: 45 + r * rankGap, y: 420 + cross - h / 2, w: w, h: h };
        });
    });
    return pos;
}
function toDrawio(graph, opts) {
    opts = opts || {};
    var pos = layoutDrawio(graph, opts.dir || 'TD');
    var fills = {
        start: ['#e2e8f0', '#64748b', '#0f172a'], stmt: ['#f8fafc', '#64748b', '#0f172a'],
        notice: ['#f1f5f9', '#94a3b8', '#334155'],
        io: ['#dbeafe', '#3b82f6', '#172554'], call: ['#e0e7ff', '#6366f1', '#1e1b4b'],
        cursor: ['#ccfbf1', '#14b8a6', '#134e4a'],
        tran: ['#dcfce7', '#22c55e', '#14532d'], cond: ['#fef3c7', '#d97706', '#451a03'],
        loop: ['#dbeafe', '#3b82f6', '#172554'], try: ['#dcfce7', '#16a34a', '#14532d'],
        catch: ['#fee2e2', '#dc2626', '#450a0a'], ret: ['#dcfce7', '#16a34a', '#14532d'],
        err: ['#fee2e2', '#dc2626', '#450a0a'], halt: ['#f3e8ff', '#9333ea', '#3b0764'],
        flowctl: ['#f3e8ff', '#9333ea', '#3b0764'],
        opaque: ['#fff7ed', '#f59e0b', '#451a03'],
        cte: ['#dbeafe', '#3b82f6', '#172554'], src: ['#f1f5f9', '#64748b', '#0f172a'],
        final: ['#fef3c7', '#d97706', '#451a03']
    };
    function nodeStyle(n) {
        var c = fills[n.cls] || fills.stmt;
        var s = 'whiteSpace=wrap;html=0;align=center;verticalAlign=middle;' +
            'fontFamily=IBM Plex Sans;fontSize=13;fillColor=' + c[0] + ';strokeColor=' + c[1] +
            ';fontColor=' + c[2] + ';strokeWidth=1.5;';
        if (n.shape === 'round')
            s += 'ellipse;perimeter=ellipsePerimeter;';
        else if (n.shape === 'diamond')
            s += 'rhombus;perimeter=rhombusPerimeter;';
        else if (n.shape === 'hex')
            s += 'shape=hexagon;perimeter=hexagonPerimeter2;';
        else if (n.shape === 'io' || n.cls === 'io' || n.cls === 'src')
            s += 'shape=cylinder3;boundedLbl=1;backgroundOutline=1;';
        else if (n.shape === 'call' || n.cls === 'call')
            s += 'shape=process;';
        else if (n.shape === 'marker')
            s += 'rounded=1;arcSize=20;dashed=1;';
        else
            s += 'rounded=1;arcSize=8;';
        return s;
    }
    var title = opts.title || 'Procflow';
    var L = ['<?xml version="1.0" encoding="UTF-8"?>',
        '<mxfile host="app.diagrams.net" agent="Procflow">',
        '  <diagram id="procflow-page" name="' + xmlAttr(title) + '">',
        '    <mxGraphModel dx="1200" dy="900" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="1169" pageHeight="827" math="0" shadow="0">',
        '      <root>',
        '        <mxCell id="0"/>',
        '        <mxCell id="1" parent="0"/>'];
    graph.nodes.forEach(function (n) {
        var p = pos[n.id] || { x: 0, y: 0, w: 180, h: 60 };
        L.push('        <mxCell id="pf-' + xmlAttr(n.id) + '" value="' + xmlAttr(n.text).replace(/\u0001/g, '&#xa;') +
            '" style="' + xmlAttr(nodeStyle(n)) + '" vertex="1" parent="1">');
        L.push('          <mxGeometry x="' + Math.round(p.x) + '" y="' + Math.round(p.y) +
            '" width="' + p.w + '" height="' + p.h + '" as="geometry"/>');
        L.push('        </mxCell>');
    });
    graph.edges.forEach(function (e, i) {
        var style = 'edgeStyle=orthogonalEdgeStyle;rounded=1;orthogonalLoop=1;jettySize=auto;' +
            'html=0;endArrow=block;endFill=1;strokeColor=#64748b;fontColor=#334155;';
        if (e.style === 'dotted')
            style += 'dashed=1;';
        L.push('        <mxCell id="pf-e' + (i + 1) + '" value="' + xmlAttr(e.label || '') +
            '" style="' + xmlAttr(style) + '" edge="1" parent="1" source="pf-' + xmlAttr(e.from) +
            '" target="pf-' + xmlAttr(e.to) + '">');
        L.push('          <mxGeometry relative="1" as="geometry"/>');
        L.push('        </mxCell>');
    });
    L.push('      </root>', '    </mxGraphModel>', '  </diagram>', '</mxfile>');
    return L.join('\n');
}
function narrationPrompt(mermaid, sql, dialect) {
    var src = String(sql || '');
    var cut = 40000;
    if (src.length > cut)
        src = src.slice(0, cut) + '\n-- […truncated for length…]';
    return [
        'Task: rewrite the labels on a flowchart that has already been verified against its source SQL.',
        '',
        'A heuristic parser extracted the code below and produced the diagram marked STRUCTURE.',
        'Keep that structure unchanged while rewriting labels, but do not claim that it is compiler-verified.',
        'Unsupported or dynamic SQL may be represented as opaque steps.',
        '',
        'Rules:',
        '1. Keep every node id, every edge, every arrow style and every node shape exactly as given.',
        '   Do not add, delete, merge, split or reorder anything.',
        '2. Replace only the text inside each node\'s quotes with a short plain-English description of what',
        '   that step does, in the language of the business rather than the language of SQL. Under 12 words.',
        '3. Phrase decision nodes as questions. Leave edge labels (yes / no / loop / error) unchanged.',
        '   If a label already starts with a step number such as "7. ", keep that prefix exactly.',
        '4. Do not put double quotes, pipe characters or angle brackets inside a label.',
        '5. Return the complete Mermaid diagram and nothing else.',
        '',
        'STRUCTURE (heuristic — do not alter):',
        '```mermaid',
        mermaid,
        '```',
        '',
        'SOURCE (' + (DIALECT_NAMES[dialect] || dialect) + ', for meaning only):',
        '```sql',
        src,
        '```'
    ].join('\n');
}
//# sourceMappingURL=exporters.js.map