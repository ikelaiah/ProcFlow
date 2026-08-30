"use strict";
/* proc>flow: confidence scoring and health-band policy */
function confidenceBand(confidence) {
    return confidence >= 0.85 ? 'high' : (confidence >= 0.6 ? 'medium' : 'low');
}
function walkConfidenceAst(list, visit) {
    (list || []).forEach(function (st) {
        visit(st);
        if (st.type === 'block')
            walkConfidenceAst(st.body, visit);
        else if (st.type === 'if') {
            if (st.then)
                walkConfidenceAst([st.then], visit);
            if (st.else)
                walkConfidenceAst([st.else], visit);
        }
        else if (st.type === 'case') {
            st.branches.forEach(function (branch) {
                walkConfidenceAst(branch.body, visit);
            });
            if (st.else)
                walkConfidenceAst(st.else, visit);
        }
        else if ((st.type === 'while' || st.type === 'for' || st.type === 'loop' || st.type === 'repeat') && st.body)
            walkConfidenceAst([st.body], visit);
        else if (st.type === 'try') {
            walkConfidenceAst(st.body, visit);
            st.handlers.forEach(function (handler) {
                walkConfidenceAst(handler.body, visit);
            });
        }
        else if (st.type === 'handler' && st.body)
            walkConfidenceAst([st.body], visit);
    });
}
function confidenceSpanOfTokens(toks) {
    if (!toks || !toks.length)
        return null;
    return { start: toks[0].pos, end: toks[toks.length - 1].end };
}
function confidenceTokensOf(node) {
    switch (node.type) {
        case 'stmt':
        case 'dynamic':
        case 'return':
        case 'throw':
        case 'sqlite_raise':
        case 'break':
        case 'continue':
        case 'label':
        case 'goto':
        case 'unknown':
            return node.toks;
        default:
            return undefined;
    }
}
/* v1.6.0 confidence re-score: a versioned formula derived from per-region
   signals. Every statement region is scored by its resolution state:
     resolved → 1.00   clean, verified construct
     approx   → 0.75   region-scoped warning (an estimated resolution)
     opaque   → 0.40   dynamic/unresolved node
     error    → 0.15   region-scoped error diagnostic
   The headline number is dialect certainty × token-weighted region quality
   × a coverage factor (0.6 + 0.4·coverage). Coverage alone can therefore
   never raise confidence without resolved constructs: 100 % coverage of
   opaque regions still caps confidence at 0.4. */
function analyseConfidence(ast, diagnostics, dialectConfidence, coverage) {
    var regionBreakdown = { total: 0, resolved: 0, approx: 0,
        opaque: 0, error: 0 };
    var regionTokens = 0, regionWeighted = 0;
    var REGION_SCORE = { resolved: 1, approx: 0.75,
        opaque: 0.4, error: 0.15 };
    function statusOf(span, node) {
        if (!span)
            return 'resolved';
        var spanStart = span.start, spanEnd = span.end;
        function overlaps(severity) {
            return diagnostics.some(function (d) {
                return d.scope === 'region' && d.severity === severity && !!d.span &&
                    d.span.start < spanEnd && d.span.end > spanStart;
            });
        }
        if (overlaps('error'))
            return 'error';
        if (node.type === 'dynamic' || node.type === 'unknown')
            return 'opaque';
        if (overlaps('warning'))
            return 'approx';
        return 'resolved';
    }
    walkConfidenceAst(ast, function (st) {
        var toks = confidenceTokensOf(st);
        var span = confidenceSpanOfTokens(toks);
        if (!toks || !toks.length || !span)
            return;
        var regionSpan = span;
        var status = statusOf(regionSpan, st);
        regionBreakdown.total++;
        regionBreakdown[status]++;
        regionTokens += toks.length;
        regionWeighted += toks.length * REGION_SCORE[status];
    });
    var regionQuality = regionTokens ? regionWeighted / regionTokens : 1;
    return {
        confidence: Math.max(0, Math.min(1, dialectConfidence * regionQuality * (0.6 + 0.4 * coverage))),
        version: '1.6.0',
        signals: { dialect: dialectConfidence, coverage: coverage,
            regionQuality: regionQuality, regionBreakdown: regionBreakdown }
    };
}
//# sourceMappingURL=confidence.js.map