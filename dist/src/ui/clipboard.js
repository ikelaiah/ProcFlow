"use strict";
/* proc>flow v2.4.0 — clipboard helper shared by the flowchart and ERD pages. */
function copyText(text, done) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done, function () {
            fallbackCopyText(text, done);
        });
    }
    else {
        fallbackCopyText(text, done);
    }
}
/* Clipboard permission is unavailable in some local-file contexts; a hidden
   textarea plus execCommand is the documented fallback. */
function fallbackCopyText(text, done) {
    var area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'absolute';
    area.style.left = '-9999px';
    document.body.appendChild(area);
    area.select();
    try {
        document.execCommand('copy');
        done();
    }
    catch (err) { /* clipboard unavailable */ }
    document.body.removeChild(area);
}
//# sourceMappingURL=clipboard.js.map