/* proc>flow v2.5.0 — ERD query-builder browser interaction suite.
   Drives erd.html in an iframe: query mode, on-card picking, join and problem
   cards, teaching by clicks, self joins, SQL options, highlighting, resize,
   Find, and the only-used filter. Publishes pass/fail on the page body so the
   correctness workflow can gate on it. */
(function(){
  var frame=document.getElementById('app') as HTMLIFrameElement,
      output=document.getElementById('results') as HTMLElement;
  var results: Array<{name: string; pass: boolean; detail?: unknown}>=[];
  function record(name: string, pass: boolean, detail?: unknown): void {
    results.push({name:name,pass:pass,detail:pass?'':detail});
  }
  function finish(): void {
    var passed=results.filter(function(entry){ return entry.pass; }).length;
    document.body.className=passed===results.length?'pass':'fail';
    document.getElementById('summary').textContent=passed+'/'+results.length+' tests passed';
    output.textContent=JSON.stringify(results,null,2);
  }
  function wait(ms: number): Promise<void> {
    return new Promise(function(resolve){ setTimeout(resolve,ms); });
  }
  /* Overlay drawing is animation-frame driven; poll for the expected state
     instead of assuming a fixed delay. */
  function until(check: () => boolean, timeoutMs: number): Promise<boolean> {
    var deadline=Date.now()+timeoutMs;
    return new Promise(function(resolve){
      (function poll(){
        if(check()){ resolve(true); return; }
        if(Date.now()>=deadline){ resolve(false); return; }
        setTimeout(poll,50);
      })();
    });
  }
  function ready(d: Document): boolean {
    return d.documentElement.getAttribute('data-procflow-ready')==='true';
  }

  frame.addEventListener('load',function(){
    var d=frame.contentDocument as Document;
    var body=frame.contentWindow as any;
    body.onerror=function(message: string){ record('no runtime errors: '+message,false); };
    (async function(){
      var tries=0;
      while(!ready(d)&&tries++<150) await wait(100);
      if(!ready(d)){
        record('erd page initializes',false,'data-procflow-ready never set');
        finish();
        return;
      }
      var get=function(id: string): any { return d.getElementById(id); };
      var sql=function(): string { return get('qb-sql-out').textContent||''; };
      var pick=function(entity: string, column: string): boolean {
        var box=d.querySelector('#erd-cards .erd-card[data-entity-id="'+
          entity+'"] input.qb-pick[data-column="'+column+'"]') as HTMLInputElement;
        if(!box) return false;
        box.click();
        return true;
      };
      var rowPick=function(entity: string, column: string): boolean {
        var row=d.querySelector('#erd-cards .erd-card[data-entity-id="'+
          entity+'"] li[data-column="'+column+'"]') as HTMLElement;
        if(!row) return false;
        row.click();
        return true;
      };

      get('btn-erd-sample').click();
      await wait(250);

      /* ---- query mode ---- */
      record('query button exists and starts unpressed',
        !!get('btn-erd-query')&&
          get('btn-erd-query').getAttribute('aria-pressed')==='false'&&
          d.querySelectorAll('#erd-cards input.qb-pick').length===0);
      get('btn-erd-query').click();
      await wait(250);
      record('query mode adds checkboxes and opens the window',
        get('btn-erd-query').getAttribute('aria-pressed')==='true'&&
          get('qb-float').hidden===false&&
          d.querySelectorAll('#erd-cards input.qb-pick').length>10);
      record('query mode suspends compact boxes',
        get('erd-compact').disabled===true);
      record('empty state explains picking',
        sql().indexOf('Pick columns on the diagram')>=0);
      record('empty mode announces a concise status',
        (get('qb-status').textContent||'').indexOf('No columns picked')>=0);
      record('query file menu is available',
        !!get('qb-query-menu')&&!!get('qb-query-name')&&
          !!get('btn-qb-export')&&!!get('btn-qb-import')&&
          !!get('btn-qb-download'));
      record('export and download are disabled with no picks',
        get('btn-qb-export').disabled===true&&
          get('btn-qb-download').disabled===true);
      d.dispatchEvent(new KeyboardEvent('keydown',{key:'q',bubbles:true}));
      record('Q toggles query mode off',get('qb-float').hidden===true);
      d.dispatchEvent(new KeyboardEvent('keydown',{key:'q',bubbles:true}));
      record('Q toggles query mode back on',get('qb-float').hidden===false);
      await wait(150);

      /* ---- picking ---- */
      record('picking via checkbox works',pick('DBO.CUSTOMER','Email'));
      await wait(150);
      record('single-table SQL is generated',
        sql().indexOf('FROM [dbo].[Customer] AS customer;')>=0,sql());
      record('status line summarizes the plan',
        (get('qb-status').textContent||'').indexOf('SQL updated')>=0);
      record('export and download enable with picks',
        get('btn-qb-export').disabled===false&&
          get('btn-qb-download').disabled===false);
      /* Anchor clicks are stubbed: a real download would block headless. */
      var downloadNames: string[]=[];
      var realAnchorClick=body.HTMLAnchorElement.prototype.click;
      body.HTMLAnchorElement.prototype.click=function(this: HTMLAnchorElement){
        downloadNames.push(this.download);
      };
      get('btn-qb-export').click();
      record('export reports the file name',
        (get('qb-store-status').textContent||'').indexOf('Exported')>=0,
        get('qb-store-status').textContent);
      get('btn-qb-download').click();
      body.HTMLAnchorElement.prototype.click=realAnchorClick;
      record('export and sql download produce named files',
        downloadNames.length===2&&
          downloadNames[0].indexOf('.json')>=0&&
          downloadNames[1].indexOf('.sql')>=0,
        downloadNames);
      record('sql download reports the file name',
        (get('qb-store-status').textContent||'').indexOf('.sql')>=0,
        get('qb-store-status').textContent);
      record('picked row and card badge update',
        !!d.querySelector('#erd-cards .erd-card[data-entity-id="DBO.CUSTOMER"] li.qb-picked')&&
          (d.querySelector('#erd-cards .erd-card[data-entity-id="DBO.CUSTOMER"] .erd-qbcount')||
            {textContent:''}).textContent==='1 picked');
      record('picked-column chip renders',
        d.querySelectorAll('#qb-picks .qb-chip').length===1);
      record('picking via row click works',
        rowPick('DBO.ORDERHEADER','PlacedAt'));
      await wait(250);
      record('declared FK join is emitted',
        sql().indexOf('LEFT JOIN [dbo].[OrderHeader] AS orderheader')>=0,sql());
      record('plan edge is highlighted on the diagram',
        await until(function(){
          return d.querySelectorAll('#erd-overlay path[stroke-width="3"]').length>=1;
        },3000));
      record('join card shows condition and explanation',
        (function(){
          var card=d.querySelector('#qb-plan-body .qb-join');
          return !!card&&card.textContent.indexOf('OrderHeader.CustomerId')>=0&&
            card.textContent.indexOf('references')>=0;
        })());
      var joinSelect=d.querySelector('#qb-plan-body select[data-role="join-type"]') as HTMLSelectElement;
      joinSelect.value='inner';
      joinSelect.dispatchEvent(new Event('change',{bubbles:true}));
      record('join type switch applies INNER',
        sql().indexOf('INNER JOIN [dbo].[OrderHeader] AS orderheader')>=0,sql());
      await until(function(){
        return !!d.querySelector('#erd-overlay path[data-relationship]');
      },3000);
      record('hovering a join card highlights its edge and endpoints',
        (function(){
          var card=d.querySelector('#qb-plan-body .qb-join[data-edge]') as HTMLElement;
          card.dispatchEvent(new MouseEvent('mouseover',{bubbles:true}));
          var lit=d.querySelectorAll('#erd-overlay path.qb-hover').length>=1&&
            d.querySelectorAll('#erd-cards .erd-card.qb-hover-card').length===2;
          card.dispatchEvent(new MouseEvent('mouseout',{bubbles:true,relatedTarget:d.body}));
          return lit&&d.querySelectorAll('#erd-overlay path.qb-hover').length===0;
        })());

      /* ---- SQL options ---- */
      get('qb-distinct').checked=true;
      get('qb-distinct').dispatchEvent(new Event('change'));
      record('distinct reaches the SQL',sql().indexOf('SELECT DISTINCT')>=0);
      var limitSelect=get('qb-limit') as HTMLSelectElement;
      limitSelect.value='100';
      limitSelect.dispatchEvent(new Event('change'));
      record('row cap reaches the SQL',sql().indexOf('TOP 100')>=0,sql());
      (d.querySelector('#qb-picks .qb-chip-sort') as HTMLElement).click();
      record('sort cycles to ascending',
        sql().indexOf('ORDER BY')>=0&&sql().indexOf(' ASC')>=0,sql());
      (d.querySelector('#qb-picks .qb-chip-sort') as HTMLElement).click();
      record('sort cycles to descending',sql().indexOf(' DESC')>=0);
      (d.querySelector('#qb-picks .qb-chip-sort') as HTMLElement).click();
      record('sort cycles off',sql().indexOf('ORDER BY')<0);
      record('SQL is syntax highlighted',
        (d.querySelector('#qb-sql-out .sql-kw')||{textContent:''}).textContent==='SELECT'&&
          !!d.querySelector('#qb-sql-out .sql-ident')&&
          !!d.querySelector('#qb-sql-out .sql-comment'));

      /* ---- resize ---- */
      var floatRect=get('qb-float').getBoundingClientRect();
      var grip=get('qb-resize') as HTMLElement;
      var gripRect=grip.getBoundingClientRect();
      grip.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,button:0,
        clientX:gripRect.left,clientY:gripRect.top,pointerId:7}));
      grip.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,button:0,
        clientX:gripRect.left+90,clientY:gripRect.top+70,pointerId:7}));
      grip.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,button:0,pointerId:7}));
      var grownRect=get('qb-float').getBoundingClientRect();
      record('pointer resize grows the window',
        grownRect.width>floatRect.width+50&&grownRect.height>floatRect.height+30);
      grip.focus();
      grip.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowLeft',bubbles:true}));
      record('keyboard resize shrinks the window',
        get('qb-float').getBoundingClientRect().width<grownRect.width);

      /* ---- disconnected problem and resolutions ---- */
      record('picking an unjoinable table works',pick('DBO.VORDERVALUE','OrderId'));
      await wait(250);
      record('problem card and coral ring appear',
        !!d.querySelector('#qb-plan-body .qb-problem')&&
          !!d.querySelector('#erd-cards .erd-card[data-entity-id="DBO.VORDERVALUE"].qb-problem-card'));
      record('unjoined picks stay out of the SQL',
        sql().indexOf('vordervalue')<0,sql());
      record('teaching mode starts from the problem card',
        !!d.querySelector('#qb-plan-body [data-action="teach-click"]'));
      (d.querySelector('#qb-plan-body [data-action="teach-click"]') as HTMLElement).click();
      record('teach banner shows',!!d.querySelector('#qb-plan-body .qb-teach-banner'));
      rowPick('DBO.CUSTOMER','Email');
      record('first taught column is marked',
        !!d.querySelector('#erd-cards li.qb-teach-first'));
      rowPick('DBO.VORDERVALUE','OrderId');
      await wait(200);
      record('taught join appears as not declared',
        sql().indexOf('ON customer.[Email] = vordervalue.[OrderId]')>=0&&
          sql().indexOf('taught join')>=0,sql());
      record('taught join clears the problem',
        !d.querySelector('#qb-plan-body .qb-problem'));

      /* ---- self join ---- */
      get('btn-qb-clear').click();
      pick('DBO.CUSTOMER','DisplayName');
      pick('DBO.CUSTOMER','ReferredBy');
      await wait(150);
      get('btn-qb-teach').click();
      rowPick('DBO.CUSTOMER','ReferredBy');
      rowPick('DBO.CUSTOMER','CustomerId');
      await wait(200);
      record('self join adds a second alias',
        sql().indexOf('INNER JOIN [dbo].[Customer] AS customer_2')>=0&&
          sql().indexOf('ON customer.[ReferredBy] = customer_2.[CustomerId]')>=0,
        sql());
      var copyBox=d.querySelector('#qb-plan-body input[data-role="copy-column"][data-column="DisplayName"]') as HTMLInputElement;
      record('self join lists picked columns for the second copy',!!copyBox);
      copyBox.checked=true;
      copyBox.dispatchEvent(new Event('change',{bubbles:true}));
      await wait(150);
      record('copy columns route to the second alias',
        sql().indexOf('customer_2.[DisplayName]')>=0&&
          sql().indexOf('second copy, self join: DisplayName')>=0,sql());

      /* ---- escape and clear ---- */
      get('btn-qb-teach').click();
      record('teach toggle is pressed',
        get('btn-qb-teach').getAttribute('aria-pressed')==='true');
      d.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
      record('escape cancels teaching',
        get('btn-qb-teach').getAttribute('aria-pressed')==='false');
      get('btn-qb-clear').click();
      record('clear resets picks and chips',
        d.querySelectorAll('#qb-picks .qb-chip').length===0&&
          sql().indexOf('Pick columns on the diagram')>=0);

      /* ---- dialect, comments, copy state ---- */
      pick('DBO.CUSTOMER','Email');
      await wait(100);
      var dialectSelect=get('qb-dialect') as HTMLSelectElement;
      dialectSelect.value='postgres';
      dialectSelect.dispatchEvent(new Event('change'));
      record('dialect switch requotes identifiers',
        sql().indexOf('"dbo"."Customer"')>=0,sql());
      dialectSelect.value='tsql';
      dialectSelect.dispatchEvent(new Event('change'));
      get('qb-comments').checked=false;
      get('qb-comments').dispatchEvent(new Event('change'));
      record('comments toggle strips the provenance header',
        sql().indexOf('/*')<0&&sql().indexOf('SELECT')===0,sql());
      get('qb-comments').checked=true;
      get('qb-comments').dispatchEvent(new Event('change'));

      /* ---- find and only-used filter ---- */
      var findBox=get('erd-find') as HTMLInputElement;
      findBox.value='Email';
      findBox.dispatchEvent(new Event('input'));
      record('find matches columns and marks the rows',
        d.querySelectorAll('#erd-cards li.col-match').length>=1&&
          (get('erd-find-count').textContent||'').indexOf('column')>=0);
      findBox.value='';
      findBox.dispatchEvent(new Event('input'));
      record('find clears',d.querySelectorAll('#erd-cards li.col-match').length===0);
      pick('DBO.ORDERHEADER','PlacedAt');
      await wait(150);
      var onlyUsedBox=get('qb-only-used') as HTMLInputElement;
      onlyUsedBox.checked=true;
      onlyUsedBox.dispatchEvent(new Event('change'));
      var productCard=d.querySelector('#erd-cards .erd-card[data-entity-id="DBO.PRODUCT"]') as HTMLElement;
      record('only-used filter hides unused tables',
        !!productCard&&productCard.offsetParent===null);
      record('only-used filter keeps query tables',
        (d.querySelector('#erd-cards .erd-card[data-entity-id="DBO.CUSTOMER"]') as HTMLElement)
          .offsetParent!==null);
      onlyUsedBox.checked=false;
      onlyUsedBox.dispatchEvent(new Event('change'));
      record('only-used filter restores tables',
        !!productCard&&productCard.offsetParent!==null);

      /* ---- query file import ---- */
      var importPayload=JSON.stringify({
        format:'procflow-erd-query',version:1,fingerprint:'stale-hash',
        name:'imported smoke',
        selections:[
          {entityId:'DBO.CUSTOMER',column:'Email'},
          {entityId:'DBO.ORDERHEADER',column:'PlacedAt'}
        ],
        manual:[],cross:[],excluded:[],joinTypes:{},pathChoices:{},
        options:{dialect:'postgres',comments:true,distinct:true,rowLimit:0,
          onlyUsed:false,sorts:[]}
      });
      var importFile=new File([importPayload],'query.json',
        {type:'application/json'});
      var transfer=new DataTransfer();
      transfer.items.add(importFile);
      var fileInput=get('qb-query-file') as HTMLInputElement;
      fileInput.files=transfer.files;
      fileInput.dispatchEvent(new Event('change',{bubbles:true}));
      await until(function(){
        return (get('qb-query-name') as HTMLInputElement).value==='imported smoke';
      },3000);
      record('importing a query file applies picks and options',
        (get('qb-query-name') as HTMLInputElement).value==='imported smoke'&&
          (get('qb-dialect') as HTMLSelectElement).value==='postgres'&&
          sql().indexOf('"dbo"."Customer"')>=0&&
          sql().indexOf('SELECT DISTINCT')>=0&&
          sql().indexOf('TOP')<0&&sql().indexOf('LIMIT')<0,
        sql());
      record('importing a stale file reports pruning and schema change',
        (get('qb-store-status').textContent||'').indexOf('schema changed')>=0,
        get('qb-store-status').textContent);

      /* ---- browser save, restore, forget ---- */
      get('btn-qb-clear').click();
      pick('DBO.CUSTOMER','Email');
      pick('DBO.ORDERHEADER','PlacedAt');
      await wait(120);
      get('btn-qb-save').click();
      record('saving to the browser reports success',
        (get('qb-store-status').textContent||'').indexOf('saved to this browser')>=0,
        get('qb-store-status').textContent);
      get('btn-qb-clear').click();
      record('restore becomes available after saving',
        get('btn-qb-restore').disabled===false);
      get('btn-qb-restore').click();
      await until(function(){
        return d.querySelectorAll('#qb-picks .qb-chip').length===2&&
          sql().indexOf('JOIN "dbo"."OrderHeader" AS orderheader')>=0;
      },3000);
      record('restoring brings back picks and SQL',
        (get('qb-store-status').textContent||'').indexOf('Restored')>=0&&
          d.querySelectorAll('#qb-picks .qb-chip').length===2,
        get('qb-store-status').textContent);
      get('btn-qb-forget').click();
      record('forget clears the saved query',
        (get('qb-store-status').textContent||'').indexOf('forgotten')>=0&&
          get('btn-qb-restore').disabled===true,
        get('qb-store-status').textContent);
      get('btn-qb-save').click();
      get('btn-qb-clear').click();
      get('btn-qb-close').click();
      get('btn-erd-query').click();
      await wait(250);
      record('activation hints at a saved query',
        (get('qb-store-status').textContent||'').indexOf('Restore saved')>=0,
        get('qb-store-status').textContent);
      get('btn-qb-restore').click();
      await until(function(){
        return d.querySelectorAll('#qb-picks .qb-chip').length===2;
      },3000);
      get('btn-qb-forget').click();

      /* ---- close and reopen ---- */
      get('btn-qb-close').click();
      await wait(200);
      record('closing resets mode, cards, and compact',
        get('qb-float').hidden===true&&
          get('btn-erd-query').getAttribute('aria-pressed')==='false'&&
          d.querySelectorAll('#erd-cards input.qb-pick').length===0&&
          get('erd-compact').disabled===false);
      get('btn-erd-query').click();
      await wait(200);
      record('reopening keeps picks and rebuilds SQL',
        d.querySelectorAll('#qb-picks .qb-chip').length===2&&
          sql().indexOf('ORDER')<0&&sql().indexOf('FROM')>=0,sql());

      finish();
    })().catch(function(err){
      record('suite completed without exceptions',false,String(err&&err.stack||err));
      finish();
    });
  });
})();



