'use strict';
(() => {
  // 個人用の終値履歴。外部サイトから数値を収集せず、本人の入力データのみ保存する。
  const STORAGE_KEY='nagame-market-closes-v1';
  const METRICS=[
    {id:'nikkei',name:'日経平均',close:'marketNikkeiClose',delta:'marketNikkeiDelta'},
    {id:'topix',name:'TOPIX',close:'marketTopixClose',delta:'marketTopixDelta'},
    {id:'growth250',name:'グロース250',close:'marketGrowthClose',delta:'marketGrowthDelta'}
  ];
  const el=id=>document.getElementById(id);
  const numeric=x=>typeof x==='number'&&Number.isFinite(x)&&Math.abs(x)<100000000;
  const realDate=s=>{
    if(typeof s!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(s))return false;
    const [y,m,d]=s.split('-').map(Number),v=new Date(y,m-1,d);
    return v.getFullYear()===y&&v.getMonth()===m-1&&v.getDate()===d;
  };
  const japaneseDate=s=>{
    const [y,m,d]=s.split('-').map(Number);
    return y+'年'+m+'月'+d+'日';
  };
  function cleanRow(row){
    if(!row||!realDate(row.date))throw Error('日付が正しくありません');
    const record={date:row.date};
    for(const m of METRICS){
      const close=row[m.id],change=row[m.id+'Change'];
      if(close!==null&&close!==undefined&&(!numeric(close)||close<=0))throw Error(m.name+'の終値を確認してください');
      if(change!==null&&change!==undefined&&!numeric(change))throw Error(m.name+'の前日比を確認してください');
      if(change!==null&&change!==undefined&&(close===null||close===undefined))throw Error(m.name+'の前日比には終値が必要です');
      record[m.id]=close===undefined?null:close;
      record[m.id+'Change']=change===undefined?null:change;
      if(record[m.id]!==null&&record[m.id+'Change']!==null&&record[m.id]-record[m.id+'Change']<=0)
        throw Error(m.name+'の前日比が終値と矛盾しています');
    }
    return record;
  }
  let loadError='';
  const records=new Map();
  try{
    const source=localStorage.getItem(STORAGE_KEY);
    if(source){
      const parsed=JSON.parse(source);
      if(parsed.version!==1||!Array.isArray(parsed.entries))throw Error('終値データの形式が異なります');
      if(parsed.entries.length>10000)throw Error('終値データの件数が多すぎます');
      for(const row of parsed.entries){
        const valid=cleanRow(row);
        records.set(valid.date,valid);
      }
    }
  }catch(err){loadError='保存済み終値データを読み取れません：'+err.message;console.error(err);}
  const snapshot=()=>[...records.values()].sort((a,b)=>a.date.localeCompare(b.date)).map(r=>({...r}));
  function persist(next){
    if(loadError)throw Error(loadError+'。バックアップを確認してください');
    localStorage.setItem(STORAGE_KEY,JSON.stringify({version:1,entries:[...next.values()].sort((a,b)=>a.date.localeCompare(b.date))}));
    records.clear();
    for(const [key,value] of next)records.set(key,value);
  }
  const indexFormat=new Intl.NumberFormat('ja-JP',{minimumFractionDigits:2,maximumFractionDigits:2});
  const displayValue=x=>x===null||x===undefined?'—':indexFormat.format(x);
  function previousOpenDay(date){
    const [y,m,d]=date.split('-').map(Number);
    const current=new Date(y,m-1,d);
    const holidays=window.CALENDAR_HOLIDAYS||{};
    for(let n=0;n<11;n++){
      current.setDate(current.getDate()-1);
      const dow=current.getDay(),year=current.getFullYear(),month=current.getMonth()+1,day=current.getDate();
      const candidate=[year,String(month).padStart(2,'0'),String(day).padStart(2,'0')].join('-');
      if(dow===0||dow===6||holidays[candidate]||month===12&&day===31||month===1&&day<=3)continue;
      return candidate;
    }
    return null;
  }
  function deltaFor(row,metric){
    if(row[metric.id]===null)return {diff:null,source:''};
    if(row[metric.id+'Change']!==null)return {diff:row[metric.id+'Change'],source:'入力した前日比'};
    const prevDate=previousOpenDay(row.date);
    const prev=prevDate&&records.get(prevDate);
    if(prev&&prev[metric.id]!==null)return {diff:Number((row[metric.id]-prev[metric.id]).toFixed(2)),source:'保存済み前営業日との差（参考）'};
    return {diff:null,source:''};
  }
  function changeNode(diff,close,source){
    const v=document.createElement('div');v.className='market-value-change';
    if(diff===null){
      v.textContent='前日比 —';
    }else{
      const prior=close-diff;
      const pct=prior>0?(diff/prior*100):null;
      v.classList.add(diff>0?'positive':diff<0?'negative':'neutral');
      v.textContent=(diff>0?'+':'')+indexFormat.format(diff)+(pct===null?'': ' ('+(pct>0?'+':'')+pct.toFixed(2)+'%)');
      v.title=source;
      v.setAttribute('aria-label',source+' '+v.textContent);
    }
    return v;
  }
  function cards(row){
    const grid=document.createElement('div');grid.className='market-daily-values';
    for(const metric of METRICS){
      const card=document.createElement('div');card.className='market-value-card';
      const title=document.createElement('div');title.className='market-value-name';title.textContent=metric.name;
      const value=document.createElement('div');value.className='market-value-number';
      value.textContent=displayValue(row?row[metric.id]:null);
      card.append(title,value);
      const {diff,source}=row?deltaFor(row,metric):{diff:null,source:''};
      card.append(changeNode(diff,row?row[metric.id]:null,source));
      grid.append(card);
    }
    return grid;
  }
  let chosenDate='';
  const inputValue=v=>v===null||v===undefined?'':String(v);
  function showForDate(date){
    if(!realDate(date))return;
    chosenDate=date;
    el('marketForm').classList.add('hidden');
    el('marketDailyValues').replaceChildren(cards(records.get(date)));
    const existing=records.get(date);
    el('marketDateStatus').textContent=loadError||(
      existing?'登録済み・'+japaneseDate(date)+'（前日比が未入力の場合は、保存済み前営業日から計算できるときだけ参考表示）'
        :'この日の指数値は未登録です。終値を入力・保存できます。');
    el('marketEditBtn').disabled=!!loadError;
    el('marketDeleteBtn').classList.toggle('hidden',!existing);
  }
  const blankOrNumber=(text,label,positive=false)=>{
    const s=text.trim();
    if(!s)return null;
    const v=Number(s);
    if(!Number.isFinite(v)||Math.abs(v)>=100000000||(positive&&v<=0))throw Error(label+'の数値を確認してください');
    return Math.round(v*100)/100;
  };
  el('marketEditBtn').addEventListener('click',()=>{
    if(!chosenDate||loadError)return;
    const row=records.get(chosenDate)||{};
    for(const metric of METRICS){
      el(metric.close).value=inputValue(row[metric.id]);
      el(metric.delta).value=inputValue(row[metric.id+'Change']);
    }
    el('marketForm').classList.remove('hidden');
  });
  el('marketCancelBtn').addEventListener('click',()=>el('marketForm').classList.add('hidden'));
  el('marketForm').addEventListener('submit',event=>{
    event.preventDefault();
    if(!chosenDate||loadError)return;
    try{
      const row={date:chosenDate};
      for(const metric of METRICS){
        row[metric.id]=blankOrNumber(el(metric.close).value,metric.name+'の終値',true);
        row[metric.id+'Change']=blankOrNumber(el(metric.delta).value,metric.name+'の前日比');
      }
      const clean=cleanRow(row);
      if(METRICS.every(metric=>clean[metric.id]===null))throw Error('少なくとも1つの指数の終値を入力してください');
      const next=new Map(records);
      next.set(chosenDate,clean);
      persist(next);
      showForDate(chosenDate);
    }catch(err){window.alert('保存できません：'+err.message);}
  });
  el('marketDeleteBtn').addEventListener('click',()=>{
    if(!chosenDate||loadError||!records.has(chosenDate))return;
    if(!window.confirm(japaneseDate(chosenDate)+'の3指数データを削除しますか？（日記と予定は消えません）'))return;
    try{const next=new Map(records);next.delete(chosenDate);persist(next);showForDate(chosenDate);}
    catch(err){window.alert('削除できません：'+err.message);}
  });
  function history(){
    const list=el('marketHistoryList');list.replaceChildren();
    if(loadError){const block=document.createElement('p');block.className='market-history-empty';block.textContent=loadError;list.append(block);return;}
    const dates=[...records.keys()].sort().reverse();
    if(!dates.length){
      const empty=document.createElement('p');empty.className='market-history-empty';
      empty.textContent='終値はまだ登録されていません。記録カレンダーの日付をタップし、終値を入力してください。';
      list.append(empty);return;
    }
    for(const date of dates){
      const button=document.createElement('button');button.type='button';button.className='market-history-entry';
      const head=document.createElement('div');head.className='market-history-date';
      head.textContent=japaneseDate(date)+'　詳細・編集 ›';
      button.append(head,cards(records.get(date)));
      button.addEventListener('click',()=>{
        closeHistory();
        window.openCalendarRecordDate?.(date);
      });
      list.append(button);
    }
  }
  function openHistory(){
    history();
    el('marketHistoryOverlay').classList.remove('hidden');
    document.body.style.overflow='hidden';
  }
  function closeHistory(){
    el('marketHistoryOverlay').classList.add('hidden');
    document.body.style.overflow='';
  }
  el('marketHistoryBtn').addEventListener('click',openHistory);
  el('marketHistoryCloseBtn').addEventListener('click',closeHistory);
  document.querySelectorAll('[data-market-close]').forEach(node=>node.addEventListener('click',closeHistory));
  document.addEventListener('keydown',event=>{
    if(event.key==='Escape'&&!el('marketHistoryOverlay').classList.contains('hidden'))closeHistory();
  });
  function parseCsv(text){
    const lines=text.replace(/^\uFEFF/,'').replace(/\r\n?/g,'\n').trim().split('\n');
    if(lines.length<2)throw Error('CSVのデータ行がありません');
    if(lines.length>10001)throw Error('CSVの行数が多すぎます');
    function split(line){
      let token='',quoted=false,columns=[];
      for(let i=0;i<line.length;i++){
        const c=line[i];
        if(c==='"'){
          if(quoted&&line[i+1]==='"'){token+='"';i++;}
          else quoted=!quoted;
        }else if(c===','&&!quoted){columns.push(token.trim());token='';}
        else token+=c;
      }
      if(quoted)throw Error('CSVの引用符を確認してください');
      columns.push(token.trim());
      return columns;
    }
    const header=split(lines[0]);
    const names=['date','nikkei','nikkeiChange','topix','topixChange','growth250','growth250Change'];
    if(new Set(header).size!==header.length||!['date','nikkei','topix','growth250'].every(h=>header.includes(h)))throw Error('CSVの見出しを確認してください');
    const result=[];
    for(let i=1;i<lines.length;i++){
      if(!lines[i].trim())continue;
      const values=split(lines[i]);
      if(values.length!==header.length)throw Error((i+1)+'行目の列数が異なります');
      const o=Object.fromEntries(header.map((h,j)=>[h,values[j]]));
      const row={date:o.date};
      for(const metric of METRICS){
        const raw=o[metric.id],delta=o[metric.id+'Change'];
        row[metric.id]=raw===undefined||raw===''?null:blankOrNumber(raw,metric.name+'の終値',true);
        row[metric.id+'Change']=delta===undefined||delta===''?null:blankOrNumber(delta,metric.name+'の前日比');
      }
      const clean=cleanRow(row);
      if(METRICS.every(m=>clean[m.id]===null))throw Error((i+1)+'行目に終値がありません');
      result.push(clean);
    }
    if(!result.length)throw Error('登録できる日付がありません');
    const dates=result.map(x=>x.date);
    if(new Set(dates).size!==dates.length)throw Error('CSVの同じ日付が重複しています');
    return result;
  }
  el('marketImportBtn').addEventListener('click',()=>el('marketImportFile').click());
  el('marketImportFile').addEventListener('change',async event=>{
    const file=event.target.files?.[0];
    if(!file)return;
    try{
      if(loadError)throw Error(loadError);
      if(file.size>2000000)throw Error('CSVは2MB以下にしてください');
      const rows=parseCsv(await file.text());
      const overwritten=rows.filter(r=>records.has(r.date)).length;
      if(!window.confirm(rows.length+'営業日分を取り込みます（既存の日付 '+overwritten+'件は上書き）。続行しますか？'))return;
      const next=new Map(records);
      rows.forEach(r=>next.set(r.date,r));
      persist(next);
      history();
      window.alert(rows.length+'営業日分の終値を保存しました');
    }catch(err){window.alert('CSVを読み込めません：'+err.message);}
    finally{event.target.value='';}
  });
  // バックアップv3からのみ呼び出す。旧バックアップからの復元ではこの関数を呼ばない。
  function replaceAll(entries){
    if(!Array.isArray(entries)||entries.length>10000)throw Error('指数履歴の件数を確認してください');
    const next=new Map();
    for(const item of entries){
      const row=cleanRow(item);
      if(next.has(row.date))throw Error('指数履歴の日付が重複しています');
      next.set(row.date,row);
    }
    persist(next);
    if(chosenDate)showForDate(chosenDate);
    return true;
  }
  window.MarketArchive={showForDate,getAll:snapshot,replaceAll};
})();