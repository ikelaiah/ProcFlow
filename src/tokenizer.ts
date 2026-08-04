/* proc>flow: tokenization and source positions */
var S = function(a: string[]): StringSet {
  var o: StringSet={};
  for(var i=0;i<a.length;i++) o[a[i]]=1;
  return o;
};
/* ---------- tokeniser ---------- */
function tokenize(sql: string): TokenList {
  var toks: TokenList=[], diagnostics: Diagnostic[]=[], i=0, n=sql.length, nl=true;
  function issue(code: string, message: string, start: number, end: number): void {
    diagnostics.push({severity:'error',code:code,message:message,
                      span:{start:start,end:Math.max(start+1,Math.min(n,end))}});
  }
  while(i<n){
    var c=sql[i];
    if(c==='\n'){ nl=true; i++; continue; }
    if(c===' '||c==='\t'||c==='\r'){ i++; continue; }
    if(c==='-'&&sql[i+1]==='-'){ while(i<n&&sql[i]!=='\n') i++; continue; }
    if(c==='/'&&sql[i+1]==='*'){
      var commentStart=i, d=1; i+=2;
      while(i<n&&d>0){
        if(sql[i]==='/'&&sql[i+1]==='*'){ d++; i+=2; }
        else if(sql[i]==='*'&&sql[i+1]==='/'){ d--; i+=2; }
        else { if(sql[i]==='\n') nl=true; i++; }
      }
      if(d>0) issue('unterminated_comment','Block comment is not closed.',commentStart,n);
      continue;
    }
    var start=i, type: TokenType='op';
    var dq=c==='$'?/^\$[A-Za-z_]*\$/.exec(sql.slice(i)):null;
    if(dq){                                        /* $$ … $$ dollar quote */
      var tag=dq[0], close=sql.indexOf(tag, i+tag.length);
      if(close<0){
        issue('unterminated_dollar_quote','Dollar-quoted body '+tag+' is not closed.',start,n);
        i=n;
      } else i=close+tag.length;
      type='dollar';
    } else if(c==="'"||(/[NnEeBbXx]/.test(c)&&sql[i+1]==="'")){
      var escapeBackslash=c==='E'||c==='e', stringClosed=false;
      if(c!=="'") i++;
      i++;
      while(i<n){
        if(escapeBackslash&&sql[i]==='\\'&&i+1<n){ i+=2; continue; }
        if(sql[i]==="'"){
          if(sql[i+1]==="'"){ i+=2; continue; }
          i++; stringClosed=true; break;
        }
        i++;
      }
      if(!stringClosed) issue('unterminated_string','String literal is not closed.',start,n);
      type='str';
    } else if(c==='['){
      var bracketClosed=false; i++;
      while(i<n){
        if(sql[i]===']'&&sql[i+1]===']'){ i+=2; continue; }
        if(sql[i]===']'){ i++; bracketClosed=true; break; }
        i++;
      }
      if(!bracketClosed) issue('unterminated_identifier','Bracketed identifier is not closed.',start,n);
      type='word';
    } else if(c==='"'){
      var quoteClosed=false; i++;
      while(i<n){
        if(sql[i]==='"'&&sql[i+1]==='"'){ i+=2; continue; }
        if(sql[i]==='"'){ i++; quoteClosed=true; break; }
        i++;
      }
      if(!quoteClosed) issue('unterminated_identifier','Quoted identifier is not closed.',start,n);
      type='word';
    } else if(c==='`'){
      var tickClosed=false; i++;
      while(i<n){
        if(sql[i]==='`'&&sql[i+1]==='`'){ i+=2; continue; }
        if(sql[i]==='`'){ i++; tickClosed=true; break; }
        i++;
      }
      if(!tickClosed) issue('unterminated_identifier','Backtick identifier is not closed.',start,n);
      type='word';
    } else if(/[A-Za-z_@#:]/.test(c)&&!(c===':'&&sql[i+1]!==':')){
      if(c===':') i+=2;
      while(i<n&&/[A-Za-z_@#$0-9]/.test(sql[i])) i++;
      type = start===i ? 'op' : 'word';
      if(type==='op') i++;
    } else if(/[0-9]/.test(c)||(c==='.'&&/[0-9]/.test(sql[i+1]||''))){
      var isHex=false;
      if(c==='0'&&(sql[i+1]==='x'||sql[i+1]==='X')){ isHex=true; i+=2; }
      else if(c==='.') i++;
      if(isHex){
        while(i<n&&/[0-9a-fA-F]/.test(sql[i])) i++;
      } else {
        while(i<n&&/[0-9]/.test(sql[i])) i++;
        if(sql[i]==='.'&&sql[i+1]!=='.'){ i++; while(i<n&&/[0-9]/.test(sql[i])) i++; }
        if(sql[i]==='e'||sql[i]==='E'){
          var ex=i+1;
          if(sql[ex]==='+'||sql[ex]==='-') ex++;
          if(/[0-9]/.test(sql[ex]||'')){ i=ex; while(i<n&&/[0-9]/.test(sql[i])) i++; }
        }
      }
      while(i<n&&sql[i]==='_'&&/[0-9a-fA-F]/.test(sql[i+1]||'')){
        i+=2;
        while(i<n&&/[0-9a-fA-F]/.test(sql[i])) i++;
      }
      type='num';
    } else {
      var two=sql.substr(i,2);
      if(['<=','>=','<>','!=','!<','!>','+=','-=','*=','/=','||','::','<<','>>','->','=>',':='].indexOf(two)>=0) i+=2;
      else i++;
      type='op';
    }
    var v=sql.slice(start,i);
    toks.push({type:type, v:v, u:type==='word'?v.toUpperCase():v, nl:nl, pos:start, end:i});
    nl=false;
  }
  var parens: Token[]=[];
  toks.forEach(function(t: Token){
    if(t.v==='(') parens.push(t);
    else if(t.v===')'){
      if(parens.length) parens.pop();
      else diagnostics.push({severity:'error',code:'unexpected_closing_parenthesis',
        message:'Closing parenthesis has no matching opening parenthesis.',
        span:{start:t.pos,end:t.end}});
    }
  });
  parens.forEach(function(t){
    diagnostics.push({severity:'error',code:'unclosed_parenthesis',
      message:'Opening parenthesis is not closed.',span:{start:t.pos,end:t.end}});
  });
  toks.diagnostics=diagnostics;
  return toks;
}
