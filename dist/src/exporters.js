"use strict";
var CANONICAL_NODE_STYLE = {
    start: { mermaid: 'fill:#2b3d4a,stroke:#8ea3b4,color:#e7eef3', fill: '#e2e8f0', stroke: '#64748b', font: '#0f172a' },
    stmt: { mermaid: 'fill:#1e2b35,stroke:#516878,color:#e7eef3', fill: '#f8fafc', stroke: '#64748b', font: '#0f172a' },
    notice: { mermaid: 'fill:#25313a,stroke:#7b91a3,color:#d7e2ea', fill: '#f1f5f9', stroke: '#94a3b8', font: '#334155' },
    io: { mermaid: 'fill:#1b3140,stroke:#7ea6e0,color:#dcebff', fill: '#dbeafe', stroke: '#3b82f6', font: '#172554' },
    cursor: { mermaid: 'fill:#172d36,stroke:#4fb3a5,color:#d9fff8', fill: '#ccfbf1', stroke: '#14b8a6', font: '#134e4a' },
    call: { mermaid: 'fill:#20303c,stroke:#7ea6e0,color:#dcebff', fill: '#e0e7ff', stroke: '#6366f1', font: '#1e1b4b' },
    tran: { mermaid: 'fill:#232f2b,stroke:#54c39b,color:#dff5ec', fill: '#dcfce7', stroke: '#22c55e', font: '#14532d' },
    cond: { mermaid: 'fill:#3a2c15,stroke:#e8a33d,color:#ffeccc', fill: '#fef3c7', stroke: '#d97706', font: '#451a03' },
    loop: { mermaid: 'fill:#152b3d,stroke:#7ea6e0,color:#dcebff', fill: '#dbeafe', stroke: '#3b82f6', font: '#172554' },
    try: { mermaid: 'fill:#1f2c33,stroke:#54c39b,color:#dff5ec', fill: '#dcfce7', stroke: '#16a34a', font: '#14532d' },
    catch: { mermaid: 'fill:#39231f,stroke:#e4645e,color:#ffdedc', fill: '#fee2e2', stroke: '#dc2626', font: '#450a0a' },
    ret: { mermaid: 'fill:#1f3329,stroke:#54c39b,color:#dff5ec', fill: '#dcfce7', stroke: '#16a34a', font: '#14532d' },
    err: { mermaid: 'fill:#3a2320,stroke:#e4645e,color:#ffdedc', fill: '#fee2e2', stroke: '#dc2626', font: '#450a0a' },
    halt: { mermaid: 'fill:#2a2438,stroke:#a98fd6,color:#ece4ff', fill: '#f3e8ff', stroke: '#9333ea', font: '#3b0764' },
    opaque: { mermaid: 'fill:#332b1f,stroke:#f59e0b,color:#fef3c7,stroke-dasharray:5 3', fill: '#fff7ed', stroke: '#f59e0b', font: '#451a03' },
    flowctl: { mermaid: 'fill:#2a2438,stroke:#a98fd6,color:#ece4ff', fill: '#f3e8ff', stroke: '#9333ea', font: '#3b0764' },
    cte: { mermaid: 'fill:#1c2f3f,stroke:#7ea6e0,color:#dcebff', fill: '#dbeafe', stroke: '#3b82f6', font: '#172554' },
    src: { mermaid: 'fill:#1b242c,stroke:#4c6274,color:#a9bccb', fill: '#f1f5f9', stroke: '#64748b', font: '#0f172a' },
    final: { mermaid: 'fill:#3a2c15,stroke:#e8a33d,color:#ffeccc', fill: '#fef3c7', stroke: '#d97706', font: '#451a03' }
};
var CANONICAL_EDGE_STYLE = {
    control: 'solid', exception: 'dotted', data: 'solid', dependency: 'solid', call: 'solid'
};
var CANONICAL_EDGE_COLOR = {
    control: '#64748b', exception: '#e4645e', data: '#54c39b', dependency: '#64748b', call: '#7ea6e0'
};
var CANONICAL_EDGE_WIDTH = {
    control: 1, exception: 1, data: 2, dependency: 1, call: 1
};
/* Structured label lines (v1.7.0): multi-line labels are carried as an explicit
   array on the node; exporters render from it instead of an embedded sentinel. */
function nodeLabelLines(n) {
    if (n.lines && n.lines.length)
        return n.lines;
    return String(n.text || '').split('\u0001').join('\n').split('\n');
}
function provenanceComment(graph) {
    var lines = ['%% proc>flow provenance'];
    (graph.nodes || []).forEach(function (n) {
        var bits = [n.id + ':' + n.cls];
        if (n.provenance)
            bits.push('provenance=' + n.provenance);
        if (n.sources && n.sources.length) {
            /* Aggregated nodes keep every contributing span rather than one. */
            bits.push('spans=' + n.sources.map(function (s) { return s.start + '-' + s.end; }).join(','));
        }
        else if (n.source) {
            bits.push('span=' + n.source.start + '-' + n.source.end);
        }
        if (n.objectId)
            bits.push('object=' + n.objectId);
        if (n.reason)
            bits.push('reason=' + n.reason);
        lines.push('%% ' + bits.join(' '));
    });
    return lines.join('\n');
}
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
        var label = nodeLabelLines(n).map(escLabel).join('<br/>');
        L.push('  ' + n.id + w[0] + label + w[1]);
    });
    graph.edges.forEach(function (e) {
        var kind = e.kind || 'control';
        var dashed = e.style === 'dotted' || CANONICAL_EDGE_STYLE[kind] === 'dotted';
        var arrow = dashed ? '-.->' : '-->';
        L.push('  ' + e.from + ' ' + arrow + (e.label ? '|' + escLabel(e.label) + '|' : '') + ' ' + e.to);
    });
    /* Data-flow edges get a distinct style derived from the semantic edge kind. */
    var dataIdx = [];
    graph.edges.forEach(function (e, i) { if (e.kind === 'data')
        dataIdx.push(i); });
    if (dataIdx.length)
        L.push('  linkStyle ' + dataIdx.join(',') + ' stroke:' + CANONICAL_EDGE_COLOR.data +
            ',stroke-width:' + CANONICAL_EDGE_WIDTH.data + 'px;');
    /* Provenance metadata as a Mermaid comment block. */
    L.push(provenanceComment(graph));
    /* Class styling comes from the same canonical registry as draw.io. */
    var byClass = {};
    graph.nodes.forEach(function (n) { (byClass[n.cls] = byClass[n.cls] || []).push(n.id); });
    Object.keys(byClass).forEach(function (c) {
        var box = CANONICAL_NODE_STYLE[c];
        if (!box)
            return;
        var safe = 'pf' + c.charAt(0).toUpperCase() + c.slice(1); /* 'call', 'class', 'end' are reserved */
        L.push('  classDef ' + safe + ' ' + box.mermaid + ',stroke-width:1px;');
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
/* ---------- deterministic layered layout (v1.7.0) ----------
   Replaces the naive BFS with a layered, crossing-reducing, data-flow-aware
   layout. Backbone edges (control, exception, dependency, call, and
   dependency-graph write edges) drive layer assignment so the control spine is
   monotonic. Temp-table `data` edges are long edges that ride on top of the
   ranks and are routed through a dedicated lane with explicit waypoints. All
   ordering choices are deterministic: neighbours are visited in node-creation
   order and ties break on creation order, so the same graph always produces
   the same positions. */
var LAYOUT_RANK_GAP = 145, LAYOUT_ITEM_GAP = 220;
var LAYOUT_LR_RANK_GAP = 255, LAYOUT_LR_ITEM_GAP = 115;
var LAYOUT_CENTER_X = 520, LAYOUT_CENTER_Y = 420, LAYOUT_MARGIN = 45;
var LAYOUT_DATA_LANE_OFFSET = 70, LAYOUT_DATA_LANE_STEP = 44;
function nodeBox(n) {
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
    else if (n.shape === 'io' || n.cls === 'src') {
        w = 190;
        h = 64;
    }
    return { w: w, h: h };
}
/* A dependency-graph write edge (style 'dotted') is structure and drives the
   ranking; a temp-table producer→consumer data edge (style 'solid') is a routed
   long edge and does not. */
function isBackboneEdge(e) {
    return e.kind !== 'data' || e.style === 'dotted';
}
function countLayerCrossings(graph, ranks, order) {
    var edges = (graph.edges || []).filter(function (e) {
        return ranks[e.from] !== undefined && ranks[e.to] !== undefined;
    });
    var crossings = 0;
    for (var i = 0; i < edges.length; i++) {
        for (var j = i + 1; j < edges.length; j++) {
            var a = edges[i], b = edges[j];
            if (a.from === b.from || a.from === b.to || a.to === b.from || a.to === b.to)
                continue;
            var sameForward = ranks[a.from] === ranks[b.from] && ranks[a.to] === ranks[b.to];
            var sameReverse = ranks[a.from] === ranks[b.to] && ranks[a.to] === ranks[b.from];
            if (!sameForward && !sameReverse)
                continue;
            var l20 = sameForward ? (order[a.from] < order[b.from]) : (order[a.from] < order[b.to]);
            var l21 = sameForward ? (order[a.to] < order[b.to]) : (order[a.to] < order[b.from]);
            if (l20 !== l21)
                crossings++;
        }
    }
    return crossings;
}
function countNodeOverlaps(positions) {
    var ids = Object.keys(positions), n = 0;
    for (var i = 0; i < ids.length; i++) {
        var a = positions[ids[i]];
        for (var j = i + 1; j < ids.length; j++) {
            var b = positions[ids[j]];
            if (a.x < b.x + b.w - 0.5 && b.x < a.x + a.w - 0.5 &&
                a.y < b.y + b.h - 0.5 && b.y < a.y + a.h - 0.5)
                n++;
        }
    }
    return n;
}
function layoutAnalysis(graph, dir) {
    var nodes = graph.nodes || [], edges = graph.edges || [];
    var byId = {}, created = {};
    nodes.forEach(function (n, i) { byId[n.id] = n; created[n.id] = i; });
    var creationOf = function (id) { return created[id] !== undefined ? created[id] : 0; };
    /* Undirected backbone adjacency for connected components. */
    var und = {};
    nodes.forEach(function (n) { und[n.id] = []; });
    edges.forEach(function (e) {
        if (!isBackboneEdge(e))
            return;
        if (!byId[e.from] || !byId[e.to])
            return;
        und[e.from].push(e.to);
        und[e.to].push(e.from);
    });
    /* Deterministic components: neighbours in creation order. */
    var seen = {}, components = [];
    nodes.forEach(function (n) {
        if (seen[n.id])
            return;
        var comp = [], stack = [n.id];
        seen[n.id] = 1;
        while (stack.length) {
            var id = stack.pop();
            comp.push(id);
            und[id].slice().sort(function (a, b) { return creationOf(a) - creationOf(b); })
                .forEach(function (t) { if (!seen[t]) {
                seen[t] = 1;
                stack.push(t);
            } });
        }
        components.push(comp.sort(function (a, b) { return creationOf(a) - creationOf(b); }));
    });
    var ranks = {}, backEdges = [];
    var band = 0;
    components.forEach(function (comp) {
        var inComp = {};
        comp.forEach(function (id) { inComp[id] = 1; });
        var adj = {};
        comp.forEach(function (id) { adj[id] = []; });
        edges.forEach(function (e) {
            if (!isBackboneEdge(e))
                return;
            if (!inComp[e.from] || !inComp[e.to])
                return;
            adj[e.from].push(e.to);
        });
        /* Deterministic DFS cycle detection for the component. */
        var state = {}, localBack = [];
        function dfs(id, guard) {
            if (guard > comp.length * 2 + 2 || state[id] === 2)
                return;
            state[id] = 1;
            adj[id].slice().sort(function (a, b) { return creationOf(a) - creationOf(b); })
                .forEach(function (to) {
                if (state[to] === 1)
                    localBack.push({ from: id, to: to });
                else if (state[to] !== 2)
                    dfs(to, guard + 1);
            });
            state[id] = 2;
        }
        comp.forEach(function (id) { if (!state[id])
            dfs(id, 0); });
        /* Remove back edges; Kahn longest-path layering (creation-order ties). */
        var backSet = {};
        localBack.forEach(function (e) { backSet[e.from + '|' + e.to] = 1; });
        var indeg = {};
        comp.forEach(function (id) { indeg[id] = 0; });
        var acyclic = {};
        comp.forEach(function (id) { acyclic[id] = []; });
        comp.forEach(function (id) {
            adj[id].forEach(function (to) {
                if (backSet[id + '|' + to])
                    return;
                acyclic[id].push(to);
                indeg[to]++;
            });
        });
        var ready = [];
        comp.forEach(function (id) { if (!indeg[id])
            ready.push(id); });
        ready.sort(function (a, b) { return creationOf(a) - creationOf(b); });
        var topo = [], qi = 0;
        while (qi < ready.length) {
            var id = ready[qi++];
            topo.push(id);
            acyclic[id].slice().sort(function (a, b) { return creationOf(a) - creationOf(b); })
                .forEach(function (to) { if (--indeg[to] === 0)
                ready.push(to); });
        }
        comp.forEach(function (id) { if (topo.indexOf(id) < 0)
            topo.push(id); });
        var pred = {};
        comp.forEach(function (id) { pred[id] = []; });
        comp.forEach(function (id) {
            acyclic[id].forEach(function (to) { pred[to].push(id); });
        });
        var compRanks = {}, maxLayer = 0;
        topo.forEach(function (id) {
            var best = 0;
            pred[id].forEach(function (p) {
                if (compRanks[p] !== undefined)
                    best = Math.max(best, compRanks[p] + 1);
            });
            compRanks[id] = best;
            if (best > maxLayer)
                maxLayer = best;
        });
        comp.forEach(function (id) { ranks[id] = band + compRanks[id]; });
        backEdges = backEdges.concat(localBack);
        band += maxLayer + 1;
    });
    /* Group nodes into layers, initial order by creation. */
    var layerCount = band;
    var layers = [];
    for (var g = 0; g < layerCount; g++)
        layers.push([]);
    nodes.forEach(function (n) {
        var r = ranks[n.id];
        if (r === undefined) {
            r = band;
            ranks[n.id] = band;
            band++;
            layers.push([]);
        }
        layers[r].push(n.id);
    });
    layers.forEach(function (L) { L.sort(function (a, b) { return creationOf(a) - creationOf(b); }); });
    /* Crossing reduction via barycenter sweeps over every edge (data-flow-aware:
       data neighbours count as much as backbone neighbours when they are adjacent). */
    var orderById = {};
    function refresh() {
        layers.forEach(function (L) { L.forEach(function (id, i) { orderById[id] = i; }); });
    }
    refresh();
    function sweepLayer(g, refLayer) {
        var L = layers[g], prev = orderById;
        var withIx = L.map(function (id) {
            var total = 0, n = 0;
            edges.forEach(function (e) {
                if (ranks[e.from] !== refLayer && ranks[e.to] !== refLayer)
                    return;
                if (e.to === id && ranks[e.from] === refLayer) {
                    total += prev[e.from];
                    n++;
                }
                else if (e.from === id && ranks[e.to] === refLayer) {
                    total += prev[e.to];
                    n++;
                }
            });
            return { id: id, b: n ? total / n : NaN, i: prev[id] };
        });
        withIx.sort(function (a, b) {
            if (isNaN(a.b) && isNaN(b.b))
                return a.i - b.i;
            if (isNaN(a.b))
                return 1;
            if (isNaN(b.b))
                return -1;
            if (a.b !== b.b)
                return a.b - b.b;
            return a.i - b.i;
        });
        layers[g] = withIx.map(function (x) { return x.id; });
        refresh();
    }
    for (var it = 0; it < 4; it++) {
        for (var g = 1; g < layers.length; g++)
            sweepLayer(g, g - 1);
        for (var g = layers.length - 2; g >= 0; g--)
            sweepLayer(g, g + 1);
    }
    /* Final order record. */
    var order = {};
    layers.forEach(function (L) { L.forEach(function (id, i) { order[id] = i; }); });
    /* Coordinates: each layer is centred so the control spine stays a monotonic
       column and no two boxes can overlap. */
    var topDown = dir !== 'LR';
    var rankGap = topDown ? LAYOUT_RANK_GAP : LAYOUT_LR_RANK_GAP;
    var itemGap = topDown ? LAYOUT_ITEM_GAP : LAYOUT_LR_ITEM_GAP;
    var positions = {};
    layers.forEach(function (L, g) {
        var span = (L.length - 1) * itemGap;
        L.forEach(function (id, i) {
            var box = nodeBox(byId[id]);
            var cross = i * itemGap - span / 2;
            positions[id] = topDown
                ? { x: LAYOUT_CENTER_X + cross - box.w / 2, y: LAYOUT_MARGIN + g * rankGap, w: box.w, h: box.h }
                : { x: LAYOUT_MARGIN + g * rankGap, y: LAYOUT_CENTER_Y + cross - box.h / 2, w: box.w, h: box.h };
        });
    });
    var monotonic = 0, backboneCount = 0;
    edges.forEach(function (e) {
        if (!isBackboneEdge(e))
            return;
        if (ranks[e.from] === undefined || ranks[e.to] === undefined)
            return;
        backboneCount++;
        if (ranks[e.to] > ranks[e.from])
            monotonic++;
    });
    return {
        ranks: ranks, order: order, layers: layers, backEdges: backEdges,
        positions: positions,
        crossings: countLayerCrossings(graph, ranks, order),
        overlaps: countNodeOverlaps(positions),
        backboneEdges: backboneCount, monotonicEdges: monotonic,
        pathEdges: (graph.edges || []).filter(function (e) {
            return e.kind === 'data' && e.style !== 'dotted';
        }).length,
        warnings: (countLayerCrossings(graph, ranks, order) > 0
            ? ['crossings detected; layout does not claim planarity for this graph class']
            : [])
    };
}
function layoutDrawio(graph, dir) {
    return layoutAnalysis(graph, dir).positions;
}
/* Deterministic routing for temp-table data edges: each such edge gets a pair of
   waypoints on a dedicated lane beyond the widest content, so the routed data
   flow never pierces a node box and stays separate from the control spine. */
function edgeWaypoints(graph, positions, dir) {
    var out = {};
    var topDown = dir !== 'LR';
    var maxHalf = 0;
    Object.keys(positions).forEach(function (id) {
        var p = positions[id];
        if (topDown)
            maxHalf = Math.max(maxHalf, Math.abs(p.x + p.w / 2 - LAYOUT_CENTER_X));
        else
            maxHalf = Math.max(maxHalf, Math.abs(p.y + p.h / 2 - LAYOUT_CENTER_Y));
    });
    var lane = 0;
    (graph.edges || []).forEach(function (e, idx) {
        if (!(e.kind === 'data' && e.style !== 'dotted'))
            return;
        var a = positions[e.from], b = positions[e.to];
        if (!a || !b)
            return;
        if (topDown) {
            var laneX = Math.round(LAYOUT_CENTER_X + maxHalf + LAYOUT_DATA_LANE_OFFSET + lane * LAYOUT_DATA_LANE_STEP);
            out['e' + (idx + 1)] = [
                { x: laneX, y: Math.round(a.y + a.h / 2) },
                { x: laneX, y: Math.round(b.y + b.h / 2) }
            ];
        }
        else {
            var laneY = Math.round(LAYOUT_CENTER_Y + maxHalf + LAYOUT_DATA_LANE_OFFSET + lane * LAYOUT_DATA_LANE_STEP);
            out['e' + (idx + 1)] = [
                { x: Math.round(a.x + a.w / 2), y: laneY },
                { x: Math.round(b.x + b.w / 2), y: laneY }
            ];
        }
        lane++;
    });
    return out;
}
function nodeStyle(n) {
    var box = CANONICAL_NODE_STYLE[n.cls];
    var c = box ? [box.fill, box.stroke, box.font] : ['#f8fafc', '#64748b', '#0f172a'];
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
function toDrawio(graph, opts) {
    opts = opts || {};
    var dir = opts.dir || 'TD';
    var analysis = layoutAnalysis(graph, dir);
    var pos = analysis.positions;
    var waypoints = edgeWaypoints(graph, pos, dir);
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
        /* Provenance metadata on draw.io vertices: node class, source spans, object
           identity, synthetic origin, and multi-span provenance survive the
           round-trip. `cls` is carried explicitly because several classes share a
           fill colour; tests recover the class from metadata, not from style. */
        var meta = [];
        meta.push('cls=' + n.cls);
        if (n.provenance)
            meta.push('provenance=' + n.provenance);
        if (n.sources && n.sources.length)
            meta.push('spans=' + n.sources.map(function (s) { return s.start + '-' + s.end; }).join(','));
        else if (n.source)
            meta.push('span=' + n.source.start + '-' + n.source.end);
        if (n.objectId)
            meta.push('object=' + n.objectId);
        if (n.reason)
            meta.push('reason=' + n.reason);
        var metaAttr = meta.length ? ' data-procflow="' + xmlAttr(meta.join(' ')) + '"' : '';
        L.push('        <mxCell id="pf-' + xmlAttr(n.id) + '" value="' +
            xmlAttr(nodeLabelLines(n).join('\n')) +
            '" style="' + xmlAttr(nodeStyle(n)) + '" vertex="1" parent="1"' + metaAttr + '>');
        L.push('          <mxGeometry x="' + Math.round(p.x) + '" y="' + Math.round(p.y) +
            '" width="' + p.w + '" height="' + p.h + '" as="geometry"/>');
        L.push('        </mxCell>');
    });
    graph.edges.forEach(function (e, i) {
        var kind = e.kind || 'control';
        var boxColor = CANONICAL_EDGE_COLOR[kind] || '#64748b';
        var dash = CANONICAL_EDGE_STYLE[kind] === 'dotted' || e.style === 'dotted';
        var style = 'edgeStyle=orthogonalEdgeStyle;rounded=1;orthogonalLoop=1;jettySize=auto;' +
            'html=0;endArrow=block;endFill=1;strokeColor=' + boxColor + ';fontColor=#334155;' +
            'strokeWidth=' + CANONICAL_EDGE_WIDTH[kind] + ';';
        if (dash)
            style += 'dashed=1;';
        var kindAttr = e.kind ? ' data-procflow-kind="' + xmlAttr(e.kind) + '"' : '';
        L.push('        <mxCell id="pf-e' + (i + 1) + '" value="' + xmlAttr(e.label || '') +
            '" style="' + xmlAttr(style) + '" edge="1" parent="1" source="pf-' + xmlAttr(e.from) +
            '" target="pf-' + xmlAttr(e.to) + '"' + kindAttr + '>');
        var pts = waypoints['e' + (i + 1)];
        if (pts && pts.length) {
            L.push('          <mxGeometry relative="1" as="geometry">');
            L.push('            <Array as="points">');
            pts.forEach(function (p) { L.push('              <mxPoint x="' + p.x + '" y="' + p.y + '"/>'); });
            L.push('            </Array>');
            L.push('          </mxGeometry>');
        }
        else {
            L.push('          <mxGeometry relative="1" as="geometry"/>');
        }
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