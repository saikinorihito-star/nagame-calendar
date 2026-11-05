'use strict';
(() => {
  const STORAGE_KEY = 'nagame-calendar-v1'; // Keep unchanged across app updates to preserve data.
  const RECORDS_KEY = 'nagame-calendar-records-v1'; // 別キーへ保存し、既存の予定は移行・上書きしない。
  const COLORS = [
    {id:'blue',name:'青',hex:'#3474d5'},
    {id:'mint',name:'緑',hex:'#008e74'},
    {id:'orange',name:'オレンジ',hex:'#ce802d'},
    {id:'pink',name:'ピンク',hex:'#cc5a86'},
    {id:'purple',name:'紫',hex:'#7958bd'},
    {id:'gray',name:'グレー',hex:'#65758c'}
  ];
  const DEFAULT_TEMPLATES = [
    {id:'default-off',title:'休み',color:'mint'},
    {id:'default-work',title:'仕事',color:'blue'},
    {id:'default-shopping',title:'買い物',color:'orange'},
    {id:'default-appointment',title:'通院',color:'pink'},
    {id:'default-trip',title:'旅行',color:'purple'}
  ];

  // 月表示のみ短縮。公式データと日付詳細は正式名称のまま。
  const RACE_SHORT_NAMES = Object.freeze({
    "フェブラリーステークス": "フェブラリー",
    "中山グランドジャンプ": "中山GJ",
    "NHKマイルカップ": "NHKマイル",
    "ヴィクトリアマイル": "ヴィクトリア",
    "スプリンターズステークス": "スプリンター",
    "ジャパンダートクラシック": "JダートC",
    "マイルチャンピオンシップ南部杯": "南部杯",
    "JBCクラシック": "JBCクラ",
    "JBCスプリント": "JBCスプ",
    "JBCレディスクラシック": "JBCレディス",
    "エリザベス女王杯": "エリザベス杯",
    "マイルチャンピオンシップ": "マイルCS",
    "ジャパンカップ": "ジャパンC",
    "チャンピオンズカップ": "チャンピオン",
    "阪神ジュベナイルフィリーズ": "阪神JF",
    "全日本2歳優駿": "全日本2歳",
    "朝日杯フューチュリティステークス": "朝日杯FS",
    "ホープフルステークス": "ホープフルS"
  });
  const shortRaceName = name => RACE_SHORT_NAMES[name] ?? name;
  // 祝日・競馬日程は公開データと手元のキャッシュを組み合わせる。
  let HOLIDAYS = {...(window.CALENDAR_HOLIDAYS || {})};
  let RACES = [...(window.CALENDAR_RACES || [])];
  const OFFICIAL_KEY = 'nagame-calendar-official-v2';
  const DISPLAY_KEY = 'nagame-calendar-display-v2';
  let holidayRevision='', raceRevision='';
  let display = {central:true,local:true};
  try {
    const flags=JSON.parse(localStorage.getItem(DISPLAY_KEY)||'{}');
    if(typeof flags.central==='boolean')display.central=flags.central;
    if(typeof flags.local==='boolean')display.local=flags.local;
    const old=JSON.parse(localStorage.getItem(OFFICIAL_KEY)||'{}');
    if(old.holidays && Object.keys(old.holidays).length>=30){
      HOLIDAYS=mergeHolidayYears(HOLIDAYS,old.holidays);
      holidayRevision=typeof old.holidayRevision==='string'?old.holidayRevision:'';
    }
    if(Array.isArray(old.races) && old.races.length>=10){
      RACES=mergeRaceYears(RACES,old.races);
      raceRevision=typeof old.raceRevision==='string'?old.raceRevision:'';
    }
  }catch(err){console.warn('表示設定の読込に失敗',err);}
  function mergeHolidayYears(previous,incoming){
    const years=new Set(Object.keys(incoming).map(date=>date.slice(0,4)));
    return {...Object.fromEntries(Object.entries(previous).filter(([date])=>!years.has(date.slice(0,4)))),...incoming};
  }
  function mergeRaceYears(previous,incoming){
    // 年だけでなく競馬区分も一致するグループを置換する。片方の未公表データを消さない。
    const groups=new Set(incoming.map(x=>String(x.date||'').slice(0,4)+'/'+x.category));
    return previous.filter(x=>!groups.has(x.date.slice(0,4)+'/'+x.category)).concat(incoming);
  }
  // 内容が同じ公開データなら再描画を行わず、スクロール位置を保持する。
  function sameHolidayData(a,b){
    const keys=Object.keys(a);
    return keys.length===Object.keys(b).length && keys.every(k=>a[k]===b[k]);
  }
  function sameRaceData(a,b){
    if(a.length!==b.length)return false;
    const key=x=>[x.date,x.category,x.name,x.venue,x.grade].join('\u0001');
    const left=a.map(key).sort(),right=b.map(key).sort();
    return left.every((k,i)=>k===right[i]);
  }
  function raceAt(day) {return RACES.filter(x=>x.date===day && display[x.category]);}
  function latestHolidayYear(){return Math.max(0,...Object.keys(HOLIDAYS).map(x=>Number(x.slice(0,4))));}
  function latestRaceYear(){return Math.max(0,...RACES.map(x=>Number(x.date.slice(0,4))));}
  const TODAY = () => new Date();
  const el = id => document.getElementById(id);
  const refs = {
    scroll:el('scrollArea'),months:el('months'),visibleMonth:el('visibleMonth'),
    dayOverlay:el('dayOverlay'),dayHeading:el('dayHeading'),dayHoliday:el('dayHoliday'),
    existingWrap:el('existingWrap'),existingEvents:el('existingEvents'),quickWrap:el('quickWrap'),quickTemplates:el('quickTemplates'),
    eventForm:el('eventForm'),eventTitle:el('eventTitle'),eventPalette:el('eventPalette'),
    useTime:el('useTime'),eventTime:el('eventTime'),repeatBlock:el('repeatBlock'),repeatMode:el('repeatMode'),
    formHeading:el('formHeading'),saveEventBtn:el('saveEventBtn'),deleteEventBtn:el('deleteEventBtn'),cancelEditBtn:el('cancelEditBtn'),
    settingsOverlay:el('settingsOverlay'),templateList:el('templateList'),templateForm:el('templateForm'),templateTitle:el('templateTitle'),templatePalette:el('templatePalette'),
    saveTemplateBtn:el('saveTemplateBtn'),cancelTemplateBtn:el('cancelTemplateBtn'),jumpOverlay:el('jumpOverlay'),jumpForm:el('jumpForm'),
    jumpYear:el('jumpYear'),jumpMonth:el('jumpMonth'),toast:el('toast'),toastText:el('toastText'),undoBtn:el('undoBtn'),
    showCentral:el('showCentral'),showLocal:el('showLocal'),holidayStatus:el('holidayStatus'),raceStatus:el('raceStatus'),
    recordOverlay:el('recordOverlay'),recordHeading:el('recordHeading'),recordForm:el('recordForm'),
    recordTitle:el('recordTitle'),recordBody:el('recordBody'),recordPalette:el('recordPalette'),
    recordFormHeading:el('recordFormHeading'),saveRecordBtn:el('saveRecordBtn'),deleteRecordBtn:el('deleteRecordBtn'),
    cancelRecordEditBtn:el('cancelRecordEditBtn'),existingRecordsWrap:el('existingRecordsWrap'),
    existingRecords:el('existingRecords'),recordTitles:el('recordTitles'),recordViewSwitch:el('recordViewSwitch')
  };
  const fmt = (y,m,d) => `${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
  const dateKey = d => fmt(d.getFullYear(),d.getMonth()+1,d.getDate());
  const monthKey = d => fmt(d.getFullYear(),d.getMonth()+1,1).slice(0,7);
  const monthDate = (d,offset) => new Date(d.getFullYear(),d.getMonth()+offset,1);
  const dateFromKey = k => {const [y,m,d]=k.split('-').map(Number);return new Date(y,m-1,d);};
  const isRealDate = k => /^\d{4}-\d{2}-\d{2}$/.test(k) && dateKey(dateFromKey(k)) === k;
  const colorHex = id => COLORS.find(c=>c.id===id)?.hex || COLORS[0].hex;
  const normalizeColor = id => COLORS.some(c=>c.id===id) ? id : 'blue';
  const makeId = () => (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : 'id-'+Date.now()+'-'+Math.random().toString(36).slice(2);
  const japaneseDate = k => { const d=dateFromKey(k); return `${d.getFullYear()}年${d.getMonth()+1}月${d.getDate()}日（${'日月火水木金土'[d.getDay()]}）`; };
  const safeTrim = value => typeof value==='string' ? value.trim() : '';

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return {events:[],templates:DEFAULT_TEMPLATES.map(x=>({...x}))};
      const v = JSON.parse(raw);
      if (!v || !Array.isArray(v.events) || !Array.isArray(v.templates)) throw new Error('Invalid data');
      return {
        events:v.events.filter(e=>e && typeof e.id==='string' && isRealDate(e.date) && safeTrim(e.title)).map(e=>({id:e.id,date:e.date,title:safeTrim(e.title).slice(0,80),color:normalizeColor(e.color),time:/^([01]\d|2[0-3]):[0-5]\d$/.test(e.time||'') ? e.time : ''})),
        templates:v.templates.filter(t=>t && typeof t.id==='string' && safeTrim(t.title)).map(t=>({id:t.id,title:safeTrim(t.title).slice(0,40),color:normalizeColor(t.color)}))
      };
    } catch (err) { console.error('データの読込失敗',err); return {events:[],templates:DEFAULT_TEMPLATES.map(x=>({...x}))}; }
  }
  function loadRecords() {
    try {
      const raw=localStorage.getItem(RECORDS_KEY);
      if(!raw)return [];
      const data=JSON.parse(raw);
      if(!data||data.version!==1||!Array.isArray(data.records))throw Error('記録データの形式が異なります');
      return data.records.filter(x=>x&&typeof x.id==='string'&&isRealDate(x.date)&&
        safeTrim(x.title)&&typeof x.body==='string').map(x=>({
          id:x.id,date:x.date,title:safeTrim(x.title).slice(0,80),body:x.body.slice(0,10000),
          color:normalizeColor(x.color),createdAt:typeof x.createdAt==='string'?x.createdAt:'',
          updatedAt:typeof x.updatedAt==='string'?x.updatedAt:''
        }));
    }catch(err){console.error('記録の読み込みに失敗',err);return [];}
  }
  let state=loadState();
  let records=loadRecords();
  let screenMode='plans',recordView='calendar',editingRecordId=null,recordColor='blue';
  let lastRecordMonth=monthKey(TODAY());
  const openTitleGroups=new Set();
  let selectedDate=dateKey(TODAY());
  let editingEventId=null,editingTemplateId=null,eventColor='blue',templateColor='blue';
  let rangeStart=monthDate(TODAY(),-6),rangeEnd=monthDate(TODAY(),17);
  let undoIds=[],toastTimer=0,scrollFrame=0;

  function store() {
    try {localStorage.setItem(STORAGE_KEY,JSON.stringify(state));return true;}
    catch(err) {console.error('保存に失敗',err);notify('保存できません。端末の空き容量を確認してください');return false;}
  }
  function saveRecords(){
    try{localStorage.setItem(RECORDS_KEY,JSON.stringify({version:1,records}));return true;}
    catch(err){console.error('記録を保存できません',err);notify('記録を保存できません。端末の空き容量を確認してください');return false;}
  }
  function notify(message,ids=[]) {
    clearTimeout(toastTimer);undoIds=ids;
    refs.toastText.textContent=message;
    refs.undoBtn.classList.toggle('hidden',ids.length===0);
    refs.toast.classList.remove('hidden');
    toastTimer=setTimeout(()=>{refs.toast.classList.add('hidden');undoIds=[];},5500);
  }
  el('undoBtn').addEventListener('click',()=>{
    if (!undoIds.length)return;
    const removed=new Set(undoIds);state.events=state.events.filter(e=>!removed.has(e.id));
    store();refreshMonthSet([...new Set([...document.querySelectorAll('.month-card')].map(x=>x.dataset.month))]);
    refs.toast.classList.add('hidden');undoIds=[];
  });
  const eventSort = (a,b) => (a.time||'').localeCompare(b.time||'') || a.title.localeCompare(b.title,'ja');
  const recordSort=(a,b)=>(a.createdAt||'').localeCompare(b.createdAt||'')||a.title.localeCompare(b.title,'ja');
  const recordsAt=date=>records.filter(r=>r.date===date).sort(recordSort);
  const eventsAt = date => state.events.filter(e=>e.date===date).sort(eventSort);
  function make(tag,className,text) {
    const node=document.createElement(tag);
    if(className)node.className=className;
    if(text!==undefined)node.textContent=text;
    return node;
  }

  function renderMonth(date) {
    const y=date.getFullYear(),mo=date.getMonth(),mk=monthKey(date);
    const startDay=new Date(y,mo,1).getDay();
    const nDays=new Date(y,mo+1,0).getDate();
    const rows=Math.ceil((startDay+nDays)/7);
    const monthItems=screenMode==='plans'
      ?state.events.filter(e=>e.date.startsWith(mk+'-'))
      :records.filter(r=>r.date.startsWith(mk+'-'));
    const byDay=new Map();
    for(const item of monthItems){if(!byDay.has(item.date))byDay.set(item.date,[]);byDay.get(item.date).push(item);}
    for(const list of byDay.values())list.sort(screenMode==='plans'?eventSort:recordSort);
    const section=make('section','month-card');section.id='month-'+mk;section.dataset.month=mk;
    const top=make('div','month-top');const left=make('div');
    left.append(make('span','month-name',`${mo+1}月`),make('span','month-year',`${y}年`));
    top.append(left,make('span','month-count',`${monthItems.length}件の${screenMode==='plans'?'予定':'記録'}`));section.append(top);
    const week=make('div','weekday-grid');for(const w of '日月火水木金土')week.append(make('div','weekday',w));section.append(week);
    const grid=make('div','day-grid');
    for(let idx=0;idx<rows*7;idx++){
      const dayNum=idx-startDay+1;
      if(dayNum<1||dayNum>nDays) {grid.append(make('div','day empty'));continue;}
      const key=fmt(y,mo+1,dayNum),dayOfWeek=idx%7,holiday=HOLIDAYS[key];
      const classes=['day'];if(dayOfWeek===0)classes.push('is-sunday');if(dayOfWeek===6)classes.push('is-saturday');
      if(holiday)classes.push('is-holiday');if(key===dateKey(TODAY()))classes.push('today');
      const btn=make('button',classes.join(' '));btn.type='button';btn.dataset.date=key;
      btn.setAttribute('aria-label',japaneseDate(key)+(holiday?` ${holiday}`:'')+(screenMode==='plans'?' 予定を入力':' 記録を書く'));
      btn.append(make('span','day-number',String(dayNum)));
      if(holiday)btn.append(make('span','holiday-label',holiday));
      const entries=byDay.get(key)||[];
      if(screenMode==='records'){
        entries.slice(0,3).forEach(record=>{
          const pill=make('span','record-pill',record.title);
          pill.style.setProperty('--event-color',colorHex(record.color));btn.append(pill);
        });
        if(entries.length>3)btn.append(make('span','event-extra',`＋${entries.length-3}件`));
      }else{
        // 従来どおり予定を優先し、3件までの空き枠にGⅠ日程を表示する。
        const races=raceAt(key),count=Math.min(3,entries.length);
        entries.slice(0,count).forEach(e=>{
          const pill=make('span','event-pill',(e.time?e.time+' ':'')+e.title);
          pill.style.setProperty('--event-color',colorHex(e.color));btn.append(pill);
        });
        races.slice(0,3-count).forEach(r=>{
          const pill=make('span','race-pill'+(r.category==='local'?' local':''),shortRaceName(r.name));
          pill.title=`${r.grade} ${r.name}（${r.venue}）`;btn.append(pill);
        });
        const allCount=entries.length+races.length;
        if(allCount>3)btn.append(make('span','event-extra',`＋${allCount-3}件`));
      }
      btn.addEventListener('click',()=>screenMode==='records'?openRecordDay(key):openDay(key));grid.append(btn);
    }
    section.append(grid);
    if(!Object.keys(HOLIDAYS).some(k=>k.startsWith(y+'-')))section.append(make('div','holiday-warning','この年の祝日データは未収録です'));
    return section;
  }
  function addMonths(count,where) {
    const frag=document.createDocumentFragment();
    if(where==='after') {
      for(let i=0;i<count;i++){const d=monthDate(rangeEnd,i+1);frag.append(renderMonth(d));}
      rangeEnd=monthDate(rangeEnd,count);refs.months.append(frag);
    } else {
      for(let i=count;i>=1;i--){const d=monthDate(rangeStart,-i);frag.append(renderMonth(d));}
      rangeStart=monthDate(rangeStart,-count);
      const prior=refs.scroll.scrollHeight;
      refs.months.prepend(frag);
      refs.scroll.scrollTop+=refs.scroll.scrollHeight-prior;
    }
  }
  function buildCalendar() {
    refs.months.replaceChildren();let cur=rangeStart;
    const frag=document.createDocumentFragment();
    while(cur<=rangeEnd){frag.append(renderMonth(cur));cur=monthDate(cur,1);}
    refs.months.append(frag);
  }
  function refreshMonth(mk) {
    const old=el('month-'+mk);if(!old)return;
    const date=dateFromKey(mk+'-01');old.replaceWith(renderMonth(date));
  }
  function refreshMonthSet(months) {for(const mk of months)refreshMonth(mk);}

  function setChoice(id,active){
    const node=el(id);
    node.classList.toggle('active',active);
    node.setAttribute('aria-pressed',String(active));
  }
  function displayedMonth(){
    const match=refs.visibleMonth.textContent.match(/(\d{4})年(\d+)月/);
    return match?`${match[1]}-${String(Number(match[2])).padStart(2,'0')}`:monthKey(TODAY());
  }
  function applyView(mk=monthKey(TODAY())){
    const list=screenMode==='records'&&recordView==='titles';
    refs.recordViewSwitch.classList.toggle('hidden',screenMode!=='records');
    el('marketQuickLinks').classList.toggle('hidden',screenMode!=='records');
    refs.months.classList.toggle('hidden',list);
    el('scrollEnding').classList.toggle('hidden',list);
    el('startTip').classList.toggle('hidden',list);
    refs.recordTitles.classList.toggle('hidden',!list);
    const add=el('quickAddBtn');
    add.setAttribute('aria-label',screenMode==='records'?'今日の記録を追加':'今日の予定を追加');
    add.querySelector('.floating-add-label').textContent=screenMode==='records'?'今日に記録':'今日に追加';
    setChoice('showPlansBtn',screenMode==='plans');
    setChoice('showRecordsBtn',screenMode==='records');
    setChoice('calendarViewBtn',!list);
    setChoice('titleViewBtn',list);
    if(list){
      refs.visibleMonth.textContent='記録・タイトル別';
      el('todayBtn').classList.add('hidden');
      renderRecordTitles();
      refs.scroll.scrollTop=0;
    }else{
      el('todayBtn').classList.remove('hidden');
      buildCalendar();
      scrollToMonth(mk,'instant');
      el('startTip').textContent=screenMode==='plans'
        ?'日付をタップすると予定を追加できます。月は上下にスクロールできます。'
        :'日付をタップすると記録を書けます。タイトル別の一覧にも切り替えできます。';
    }
  }
  function switchMode(mode){
    if(mode===screenMode)return;
    const mk=displayedMonth();
    screenMode=mode;
    if(mode==='plans')recordView='calendar';
    applyView(mk);
  }
  el('showPlansBtn').addEventListener('click',()=>switchMode('plans'));
  el('showRecordsBtn').addEventListener('click',()=>switchMode('records'));
  el('calendarViewBtn').addEventListener('click',()=>{
    if(screenMode==='records'){recordView='calendar';applyView(lastRecordMonth);}
  });
  el('titleViewBtn').addEventListener('click',()=>{
    if(screenMode==='records'){lastRecordMonth=displayedMonth();recordView='titles';applyView();}
  });
  function scrollToMonth(mk,behavior='smooth') {
    if(screenMode==='records')lastRecordMonth=mk;
    const targetDate=dateFromKey(mk+'-01');
    if(!el('month-'+mk)) {
      rangeStart=monthDate(targetDate,-6);rangeEnd=monthDate(targetDate,17);
      buildCalendar();
    }
    const target=el('month-'+mk);
    if(target){
      const offset=target.getBoundingClientRect().top-refs.scroll.getBoundingClientRect().top;
      refs.scroll.scrollTo({top:Math.max(0,refs.scroll.scrollTop+offset-12),behavior});
    }
    refs.visibleMonth.textContent=`${targetDate.getFullYear()}年${targetDate.getMonth()+1}月`;
  }
  function handleScroll() {
    // タイトル別一覧のスクロールを月カレンダーの無限スクロール処理に渡さない。
    if(screenMode==='records'&&recordView==='titles')return;
    if(scrollFrame)return;
    scrollFrame=requestAnimationFrame(()=>{
      scrollFrame=0;
      const sc=refs.scroll;
      if(sc.scrollTop<450)addMonths(6,'before');
      if(sc.scrollHeight-sc.clientHeight-sc.scrollTop<650)addMonths(6,'after');
      const visibleLine=sc.getBoundingClientRect().top+70;
      let current=null;
      for(const node of refs.months.children){
        const bounds=node.getBoundingClientRect();
        if(bounds.bottom>visibleLine){current=node;break;}
      }
      if(current){const [year,m]=current.dataset.month.split('-');refs.visibleMonth.textContent=`${year}年${Number(m)}月`;if(screenMode==='records')lastRecordMonth=current.dataset.month;}
    });
  }
  refs.scroll.addEventListener('scroll',handleScroll,{passive:true});
  el('todayBtn').addEventListener('click',()=>scrollToMonth(monthKey(TODAY())));
  el('quickAddBtn').addEventListener('click',()=>screenMode==='records'?openRecordDay(dateKey(TODAY())):openDay(dateKey(TODAY())));

  function setColorPalette(container,selected,onSelect) {
    container.replaceChildren();
    for(const c of COLORS){
      const btn=make('button','color-option'+(c.id===selected?' selected':''),c.id===selected?'✓':'');
      btn.type='button';btn.title=c.name;btn.setAttribute('aria-label',c.name);btn.setAttribute('aria-pressed',String(c.id===selected));
      btn.style.setProperty('--option-color',c.hex);
      btn.addEventListener('click',()=>onSelect(c.id));container.append(btn);
    }
  }
  function chooseEventColor(id) {eventColor=id;setColorPalette(refs.eventPalette,eventColor,chooseEventColor);}
  function chooseTemplateColor(id) {templateColor=id;setColorPalette(refs.templatePalette,templateColor,chooseTemplateColor);}
  function showOverlay(overlay){overlay.classList.remove('hidden');document.body.style.overflow='hidden';}
  function hideOverlay(overlay){overlay.classList.add('hidden');document.body.style.overflow='';}
  function closeDay(){hideOverlay(refs.dayOverlay);editingEventId=null;}
  function resetEventForm(){
    editingEventId=null;refs.eventForm.reset();refs.eventTitle.value='';refs.useTime.checked=false;refs.eventTime.classList.add('hidden');
    refs.eventTime.value='09:00';refs.repeatMode.value='none';refs.repeatBlock.classList.remove('hidden');
    refs.formHeading.textContent='新しい予定を入力';refs.saveEventBtn.textContent='予定を登録';
    refs.deleteEventBtn.classList.add('hidden');refs.cancelEditBtn.classList.add('hidden');refs.quickWrap.classList.remove('hidden');
    chooseEventColor(eventColor);
  }
  function renderDay() {
    refs.dayHeading.textContent=japaneseDate(selectedDate);
    refs.dayHoliday.textContent=HOLIDAYS[selectedDate]||'';
    const raceContainer=el('raceDetails');raceContainer.replaceChildren();
    const races=raceAt(selectedDate);
    if(races.length){
      raceContainer.append(make('div','section-heading','競馬のGⅠ開催日'));
      for(const race of races){
        const line=make('div','race-detail'+(race.category==='local'?' local':''));
        line.append(make('span','race-label',race.category==='local'?'地方 '+race.grade:'中央 '+race.grade));
        line.append(make('span','',`${race.name}（${race.venue}）`));raceContainer.append(line);
      }
    }
    raceContainer.classList.toggle('hidden',!races.length);
    const list=eventsAt(selectedDate);refs.existingEvents.replaceChildren();
    refs.existingWrap.classList.toggle('hidden',!list.length);
    for(const item of list){
      const btn=make('button','existing-item');btn.type='button';
      const dot=make('span','existing-dot');dot.style.setProperty('--event-color',colorHex(item.color));
      btn.append(dot,make('span','existing-text',item.title));
      if(item.time)btn.append(make('span','existing-time',item.time));
      btn.append(make('span','edit-cue','編集 ›'));
      btn.addEventListener('click',()=>editEvent(item.id));refs.existingEvents.append(btn);
    }
    refs.quickTemplates.replaceChildren();
    if(!state.templates.length)refs.quickTemplates.append(make('div','no-presets','「設定」から登録ボタンを追加できます'));
    for(const t of state.templates){
      const btn=make('button','preset-btn',t.title);btn.type='button';btn.style.setProperty('--event-color',colorHex(t.color));
      btn.addEventListener('click',()=>quickCreate(t));refs.quickTemplates.append(btn);
    }
  }
  function openDay(key) {
    selectedDate=key;resetEventForm();renderDay();showOverlay(refs.dayOverlay);
    refs.dayOverlay.querySelector('.day-sheet-body').scrollTop=0;
  }
  function addEvents(specs,msg) {
    const added=specs.map(spec=>({id:makeId(),...spec}));
    state.events.push(...added);
    if(!store()){state.events.splice(-added.length);return false;}
    refreshMonthSet([...new Set(added.map(e=>e.date.slice(0,7)))]);
    closeDay();notify(msg,added.map(e=>e.id));return true;
  }
  function quickCreate(template) {
    addEvents([{date:selectedDate,title:template.title,color:template.color,time:''}],`「${template.title}」を登録しました`);
  }
  function editEvent(id) {
    const item=state.events.find(e=>e.id===id);if(!item)return;
    editingEventId=id;refs.eventTitle.value=item.title;chooseEventColor(item.color);
    refs.useTime.checked=!!item.time;refs.eventTime.classList.toggle('hidden',!item.time);
    refs.eventTime.value=item.time||'09:00';refs.repeatBlock.classList.add('hidden');
    refs.formHeading.textContent='予定を編集';refs.saveEventBtn.textContent='変更を保存';
    refs.deleteEventBtn.classList.remove('hidden');refs.cancelEditBtn.classList.remove('hidden');refs.quickWrap.classList.add('hidden');
    refs.eventTitle.scrollIntoView({block:'nearest',behavior:'smooth'});
  }
  refs.useTime.addEventListener('change',()=>refs.eventTime.classList.toggle('hidden',!refs.useTime.checked));
  refs.cancelEditBtn.addEventListener('click',()=>resetEventForm());
  function repeatDates(key,mode) {
    const original=dateFromKey(key),result=[key];
    const match=/^(daily|weekly|monthly)(\d+)$/.exec(mode);if(!match)return result;
    const limit=Math.min(24,Number(match[2]));
    for(let i=1;i<limit;i++){
      let d;
      if(match[1]==='monthly') {
        const targetFirst=new Date(original.getFullYear(),original.getMonth()+i,1);
        const last=new Date(targetFirst.getFullYear(),targetFirst.getMonth()+1,0).getDate();
        d=new Date(targetFirst.getFullYear(),targetFirst.getMonth(),Math.min(original.getDate(),last));
      } else d=new Date(original.getFullYear(),original.getMonth(),original.getDate()+i*(match[1]==='weekly'?7:1));
      result.push(dateKey(d));
    }
    return result;
  }
  refs.eventForm.addEventListener('submit',e=>{
    e.preventDefault();const title=refs.eventTitle.value.trim();if(!title)return;
    const time=refs.useTime.checked ? refs.eventTime.value : '';
    if(refs.useTime.checked&&!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)){notify('時刻を確認してください');return;}
    if(editingEventId){
      const item=state.events.find(x=>x.id===editingEventId);if(!item)return;
      const old={...item};item.title=title;item.color=eventColor;item.time=time;
      if(!store()){Object.assign(item,old);return;}
      refreshMonth(item.date.slice(0,7));closeDay();notify('予定を変更しました');
    } else {
      const dates=repeatDates(selectedDate,refs.repeatMode.value);
      addEvents(dates.map(date=>({date,title,color:eventColor,time})),dates.length>1?`${dates.length}件の予定を登録しました`:'予定を登録しました');
    }
  });
  refs.deleteEventBtn.addEventListener('click',()=>{
    const target=state.events.find(e=>e.id===editingEventId);if(!target)return;
    if(!confirm(`「${target.title}」を削除しますか？`))return;
    const old=state.events;state.events=old.filter(e=>e.id!==target.id);
    if(!store()){state.events=old;return;}
    refreshMonth(target.date.slice(0,7));closeDay();notify('予定を削除しました');
  });


  // 日記の本文はtextContentで描画し、HTMLとして実行されない。
  // 予定は別のキーに保存されるので、この操作で既存の予定を変更しない。
  function chooseRecordColor(id){
    recordColor=id;
    setColorPalette(refs.recordPalette,recordColor,chooseRecordColor);
  }
  function closeRecordDay(){
    hideOverlay(refs.recordOverlay);
    editingRecordId=null;
  }
  function resetRecordForm(){
    editingRecordId=null;
    refs.recordForm.reset();
    refs.recordTitle.value='';
    refs.recordBody.value='';
    refs.recordFormHeading.textContent='新しい記録を入力';
    refs.saveRecordBtn.textContent='記録を保存';
    refs.deleteRecordBtn.classList.add('hidden');
    refs.cancelRecordEditBtn.classList.add('hidden');
    chooseRecordColor(recordColor);
  }
  function renderRecordDay(){
    refs.recordHeading.textContent=japaneseDate(selectedDate);
    const list=recordsAt(selectedDate);
    refs.existingRecords.replaceChildren();
    refs.existingRecordsWrap.classList.toggle('hidden',list.length===0);
    for(const item of list){
      const btn=make('button','record-item');
      btn.type='button';
      const dot=make('span','existing-dot');
      dot.style.setProperty('--event-color',colorHex(item.color));
      const content=make('span','record-item-content');
      content.append(make('span','record-item-title',item.title));
      if(item.body)content.append(make('span','record-item-preview',item.body));
      btn.append(dot,content,make('span','edit-cue','編集 ›'));
      btn.addEventListener('click',()=>editRecord(item.id));
      refs.existingRecords.append(btn);
    }
  }
  function openRecordDay(key,id=null){
    selectedDate=key;
    resetRecordForm();
    renderRecordDay();
    showOverlay(refs.recordOverlay);
    if(id)editRecord(id);
    const body=refs.recordOverlay.querySelector('.day-sheet-body');
    if(body)body.scrollTop=0;
  }
  function editRecord(id){
    const item=records.find(r=>r.id===id);
    if(!item)return;
    editingRecordId=id;
    selectedDate=item.date;
    refs.recordTitle.value=item.title;
    refs.recordBody.value=item.body;
    chooseRecordColor(item.color);
    refs.recordFormHeading.textContent='記録を編集';
    refs.saveRecordBtn.textContent='変更を保存';
    refs.deleteRecordBtn.classList.remove('hidden');
    refs.cancelRecordEditBtn.classList.remove('hidden');
  }
  function refreshRecordDisplay(key){
    refreshMonth(key.slice(0,7));
    if(screenMode==='records'&&recordView==='titles')renderRecordTitles();
  }
  function renderRecordTitles(){
    const container=refs.recordTitles;
    container.replaceChildren();
    container.append(make('h2','record-list-heading','タイトル別の記録'));
    if(!records.length){
      container.append(make('div','record-empty','記録はまだありません。今日に記録から追加できます。'));
      return;
    }
    const groups=new Map();
    for(const record of records){
      if(!groups.has(record.title))groups.set(record.title,[]);
      groups.get(record.title).push(record);
    }
    const sorted=[...groups].sort((a,b)=>{
      const aDate=a[1].reduce((m,r)=>r.date>m?r.date:m,'');
      const bDate=b[1].reduce((m,r)=>r.date>m?r.date:m,'');
      return bDate.localeCompare(aDate)||a[0].localeCompare(b[0],'ja');
    });
    container.append(make('div','record-list-note',`${groups.size}タイトル・${records.length}件の記録。タイトルを押すと内容が開きます。`));
    for(const [title,group] of sorted){
      const ordered=[...group].sort((a,b)=>b.date.localeCompare(a.date)||b.createdAt.localeCompare(a.createdAt));
      const box=make('section','record-group');
      const header=make('button','record-group-toggle');
      header.type='button';
      const dot=make('span','record-group-dot');
      dot.style.setProperty('--event-color',colorHex(ordered[0].color));
      header.append(dot,make('span','record-group-title',title),
        make('span','record-group-count',`${group.length}件 ${openTitleGroups.has(title)?'▲':'▼'}`));
      header.setAttribute('aria-expanded',String(openTitleGroups.has(title)));
      header.addEventListener('click',()=>{
        if(openTitleGroups.has(title))openTitleGroups.delete(title);
        else openTitleGroups.add(title);
        renderRecordTitles();
      });
      box.append(header);
      if(openTitleGroups.has(title)){
        const entries=make('div','record-group-entries');
        for(const item of ordered){
          const button=make('button','record-group-entry');
          button.type='button';
          const inner=make('span','record-group-entry-meta');
          inner.append(make('span','record-group-entry-date',japaneseDate(item.date)));
          if(item.body)inner.append(make('span','record-group-entry-text',item.body.slice(0,160)));
          button.append(inner,make('span','edit-cue','詳細・編集 ›'));
          button.addEventListener('click',()=>openRecordDay(item.date,item.id));
          entries.append(button);
        }
        box.append(entries);
      }
      container.append(box);
    }
  }
  refs.recordForm.addEventListener('submit',event=>{
    event.preventDefault();
    const title=safeTrim(refs.recordTitle.value).slice(0,80);
    if(!title){notify('記録のタイトルを入力してください');return;}
    const body=String(refs.recordBody.value||'').slice(0,10000);
    const oldRecords=records.map(r=>({...r}));
    const now=new Date().toISOString(),editing=!!editingRecordId;
    if(editing){
      const item=records.find(r=>r.id===editingRecordId);
      if(!item)return;
      item.title=title;item.body=body;item.color=recordColor;item.updatedAt=now;
    }else{
      records.push({id:makeId(),date:selectedDate,title,body,color:recordColor,createdAt:now,updatedAt:now});
    }
    if(!saveRecords()){records=oldRecords;return;}
    refreshRecordDisplay(selectedDate);
    closeRecordDay();
    notify(editing?'記録を更新しました':'記録を保存しました');
  });
  refs.deleteRecordBtn.addEventListener('click',()=>{
    const item=records.find(r=>r.id===editingRecordId);
    if(!item)return;
    if(!confirm(`「${item.title}」の記録を削除しますか？`))return;
    const before=records;
    records=records.filter(r=>r.id!==item.id);
    if(!saveRecords()){records=before;return;}
    refreshRecordDisplay(item.date);
    closeRecordDay();
    notify('記録を削除しました');
  });
  refs.cancelRecordEditBtn.addEventListener('click',resetRecordForm);
  function resetTemplateForm() {
    editingTemplateId=null;refs.templateForm.reset();refs.templateTitle.value='';
    refs.saveTemplateBtn.textContent='ボタンを追加';refs.cancelTemplateBtn.classList.add('hidden');chooseTemplateColor(templateColor);
  }
  function renderTemplates(){
    refs.templateList.replaceChildren();
    state.templates.forEach((t,index)=>{
      const line=make('div','template-item');
      const dot=make('span','template-item-color');dot.style.setProperty('--event-color',colorHex(t.color));
      line.append(dot,make('span','template-item-title',t.title));
      const up=make('button','mini-btn','↑');up.type='button';up.title='上へ';up.disabled=index===0;
      up.addEventListener('click',()=>moveTemplate(index,-1));
      const down=make('button','mini-btn','↓');down.type='button';down.title='下へ';down.disabled=index===state.templates.length-1;
      down.addEventListener('click',()=>moveTemplate(index,1));
      const edit=make('button','mini-btn','編集');edit.type='button';edit.title='編集';
      edit.addEventListener('click',()=>{
        editingTemplateId=t.id;refs.templateTitle.value=t.title;chooseTemplateColor(t.color);
        refs.saveTemplateBtn.textContent='変更を保存';refs.cancelTemplateBtn.classList.remove('hidden');refs.templateTitle.focus();
      });
      const del=make('button','mini-btn danger','×');del.type='button';del.title='削除';
      del.addEventListener('click',()=>{
        if(!confirm(`登録ボタン「${t.title}」を削除しますか？\n※過去に入力した予定は消えません。`))return;
        const before=state.templates;state.templates=before.filter(a=>a.id!==t.id);
        if(!store()){state.templates=before;return;}
        if(editingTemplateId===t.id)resetTemplateForm();renderTemplates();notify('登録ボタンを削除しました');
      });
      line.append(up,down,edit,del);refs.templateList.append(line);
    });
  }
  function moveTemplate(index,move){
    const copy=[...state.templates],other=index+move;
    if(other<0||other>=copy.length)return;
    [copy[index],copy[other]]=[copy[other],copy[index]];
    const old=state.templates;state.templates=copy;
    if(!store()){state.templates=old;return;}renderTemplates();
  }
  refs.templateForm.addEventListener('submit',e=>{
    e.preventDefault();const title=refs.templateTitle.value.trim();if(!title)return;
    if(editingTemplateId){
      const item=state.templates.find(t=>t.id===editingTemplateId);if(!item)return;
      const old={...item};item.title=title;item.color=templateColor;
      if(!store()){Object.assign(item,old);return;}
      notify('登録ボタンを変更しました');
    } else {
      const t={id:makeId(),title,color:templateColor};state.templates.push(t);
      if(!store()){state.templates.pop();return;}
      notify('登録ボタンを追加しました');
    }
    resetTemplateForm();renderTemplates();
  });
  refs.cancelTemplateBtn.addEventListener('click',resetTemplateForm);
  function showSettings(){resetTemplateForm();renderTemplates();refs.showCentral.checked=display.central;refs.showLocal.checked=display.local;renderOfficialStatus();showOverlay(refs.settingsOverlay);}
  el('settingsBtn').addEventListener('click',showSettings);

  for(const [name,field] of [['central','showCentral'],['local','showLocal']]){
    refs[field].addEventListener('change',()=>{
      display[name]=refs[field].checked;
      try{localStorage.setItem(DISPLAY_KEY,JSON.stringify(display));}
      catch(err){notify('表示設定を保存できませんでした');}
      const oldTop=refs.scroll.scrollTop;buildCalendar();refs.scroll.scrollTop=oldTop;
    });
  }
  let syncState='';
  function renderOfficialStatus(){
    refs.holidayStatus.textContent=`祝日：${latestHolidayYear()}年までの正式データを収録${syncState?' ／ '+syncState:''}`;
    refs.raceStatus.textContent=`競馬：${latestRaceYear()}年までの開催日を収録（最新の公表分のみ）`;
  }
  async function refreshOfficialData(manual=false){
    if(manual){el('refreshDataBtn').disabled=true;syncState='確認中';renderOfficialStatus();}
    let fetched=0,changed=false,cacheNeedsSave=false;
    try{
      const [h,r]=await Promise.allSettled([
        fetch('./data/holidays.json',{cache:'no-store'}).then(x=>{if(!x.ok)throw Error('祝日データの取得失敗');return x.json();}),
        fetch('./data/races.json',{cache:'no-store'}).then(x=>{if(!x.ok)throw Error('競馬データの取得失敗');return x.json();})
      ]);
      if(h.status==='fulfilled' && h.value.version===1 && h.value.holidays && Object.keys(h.value.holidays).length>=30){
        const valid=Object.entries(h.value.holidays).every(([date,name])=>isRealDate(date)&&typeof name==='string'&&name.length<50);
        if(valid){
          fetched++;
          const newRevision=typeof h.value.updatedAt==='string'?h.value.updatedAt:'';
          if(newRevision>=holidayRevision){
            const merged=mergeHolidayYears(HOLIDAYS,h.value.holidays);
            if(!sameHolidayData(HOLIDAYS,merged)){
              HOLIDAYS=merged;changed=true;cacheNeedsSave=true;
            }
            if(holidayRevision!==newRevision){holidayRevision=newRevision;cacheNeedsSave=true;}
          }
        }
      }
      if(r.status==='fulfilled' && r.value.version===1 && Array.isArray(r.value.races) && r.value.races.length>=10){
        const valid=r.value.races.every(x=>x&&isRealDate(x.date)&&typeof x.name==='string'&&x.name.length<90&&typeof x.venue==='string'&&x.venue.length<40&&(x.category==='central'||x.category==='local')&&typeof x.grade==='string'&&x.grade.length<15);
        if(valid){
          fetched++;
          const newRevision=typeof r.value.updatedAt==='string'?r.value.updatedAt:'';
          if(newRevision>=raceRevision){
            const merged=mergeRaceYears(RACES,r.value.races);
            if(!sameRaceData(RACES,merged)){
              RACES=merged;changed=true;cacheNeedsSave=true;
            }
            if(raceRevision!==newRevision){raceRevision=newRevision;cacheNeedsSave=true;}
          }
        }
      }
      if(cacheNeedsSave){
        try{localStorage.setItem(OFFICIAL_KEY,JSON.stringify({holidays:HOLIDAYS,races:RACES,holidayRevision,raceRevision}));}
        catch(err){console.warn('公開日程のキャッシュ保存に失敗',err);}
      }
      if(changed){
        const oldTop=refs.scroll.scrollTop;buildCalendar();refs.scroll.scrollTop=oldTop;
        if(!refs.dayOverlay.classList.contains('hidden'))renderDay();
      }
      syncState=fetched===2?'公開データを確認済み':fetched===1?'一部のみ確認':'取得できず（保存済みを使用）';
      if(manual)notify(syncState);
    }catch(err){syncState='取得できず（保存済みを使用）';if(manual)notify(syncState);}
    finally{renderOfficialStatus();el('refreshDataBtn').disabled=false;}
  }
  el('refreshDataBtn').addEventListener('click',()=>refreshOfficialData(true));


  // Export and import are deliberately manual: no account, network sync or external access.
  el('exportBtn').addEventListener('click',()=>{
    const payload={app:'nagame-calendar',version:2,exportedAt:new Date().toISOString(),events:state.events,templates:state.templates,records};
    const blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json;charset=utf-8'});
    const url=URL.createObjectURL(blob);const a=document.createElement('a');
    a.href=url;a.download=`ながめるカレンダー-バックアップ-${dateKey(TODAY())}.json`;
    document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
    notify('バックアップファイルを保存しました');
  });
  el('importBtn').addEventListener('click',()=>el('importFile').click());
  el('importFile').addEventListener('change',async e=>{
    const file=e.target.files?.[0];if(!file)return;
    try{
      const v=JSON.parse(await file.text());
      if(v.app!=='nagame-calendar'||![1,2].includes(v.version)||!Array.isArray(v.events)||!Array.isArray(v.templates)||(v.version===2&&!Array.isArray(v.records)))throw Error('形式が異なります');
      if(v.events.length>50000||v.templates.length>200||(v.version===2&&v.records.length>50000))throw Error('データ件数が多すぎます');
      if(!v.events.every(x=>x&&typeof x.id==='string'&&isRealDate(x.date)&&safeTrim(x.title)&&safeTrim(x.title).length<=80&&(!x.time||/^([01]\d|2[0-3]):[0-5]\d$/.test(x.time))))throw Error('予定データに不正な値があります');
      if(!v.templates.every(x=>x&&typeof x.id==='string'&&safeTrim(x.title)&&safeTrim(x.title).length<=40))throw Error('登録ボタンに不正な値があります');
      if(v.version===2&&!v.records.every(x=>x&&typeof x.id==='string'&&isRealDate(x.date)&&
        typeof x.title==='string'&&safeTrim(x.title)&&safeTrim(x.title).length<=80&&
        typeof x.body==='string'&&x.body.length<=10000))throw Error('記録データに不正な値があります');
      const hasRecords=v.version===2;
      const message=hasRecords
        ?`予定${v.events.length}件・記録${v.records.length}件を復元しますか？\n現在の予定と記録は置き換えられます。`
        :`予定${v.events.length}件を復元しますか？\n従来形式なので、現在の記録は保持します。`;
      if(!confirm(message))return;
      const old=state,oldRecords=records,oldRecordRaw=localStorage.getItem(RECORDS_KEY);
      const imported={events:v.events.map(x=>({id:x.id,date:x.date,title:x.title.trim(),color:normalizeColor(x.color),time:x.time||''})),
        templates:v.templates.map(x=>({id:x.id,title:x.title.trim(),color:normalizeColor(x.color)}))};
      // 古いversion 1バックアップは予定・登録ボタンのみ復元し、記録は保持。
      if(hasRecords){
        records=v.records.map(x=>({id:x.id,date:x.date,title:x.title.trim(),body:x.body,
          color:normalizeColor(x.color),createdAt:typeof x.createdAt==='string'?x.createdAt:'',
          updatedAt:typeof x.updatedAt==='string'?x.updatedAt:''}));
        if(!saveRecords()){records=oldRecords;return;}
      }
      state=imported;
      if(!store()){
        state=old;
        if(hasRecords){
          records=oldRecords;
          try{
            if(oldRecordRaw===null)localStorage.removeItem(RECORDS_KEY);
            else localStorage.setItem(RECORDS_KEY,oldRecordRaw);
          }catch(err){console.error('復元失敗時の巻き戻しに失敗',err);}
        }
        return;
      }
      buildCalendar();renderTemplates();renderRecordTitles();hideOverlay(refs.settingsOverlay);
      applyView(monthKey(TODAY()));
      notify(`${state.events.length}件の予定${hasRecords?'・'+records.length+'件の記録':''}を読み込みました`);
    } catch(error){notify('読み込めません：'+error.message);}finally{e.target.value='';}
  });

  function showJump(){
    const visible=(refs.visibleMonth.textContent.match(/(\d{4})年(\d+)月/)||[]);
    const year=Number(visible[1])||TODAY().getFullYear(),month=Number(visible[2])||TODAY().getMonth()+1;
    refs.jumpYear.replaceChildren();for(let y=2000;y<=2100;y++){const opt=new Option(`${y}年`,String(y));refs.jumpYear.append(opt);}
    refs.jumpMonth.replaceChildren();for(let m=1;m<=12;m++)refs.jumpMonth.append(new Option(`${m}月`,String(m)));
    refs.jumpYear.value=String(year);refs.jumpMonth.value=String(month);showOverlay(refs.jumpOverlay);
  }
  el('jumpBtn').addEventListener('click',showJump);
  refs.jumpForm.addEventListener('submit',e=>{
    e.preventDefault();const mk=`${refs.jumpYear.value}-${String(refs.jumpMonth.value).padStart(2,'0')}`;
    hideOverlay(refs.jumpOverlay);
    if(screenMode==='records'&&recordView==='titles'){recordView='calendar';applyView(mk);}
    else scrollToMonth(mk,'instant');
  });
  document.querySelectorAll('[data-close]').forEach(btn=>btn.addEventListener('click',()=>{
    const type=btn.dataset.close;
    if(type==='day')closeDay();else if(type==='record')closeRecordDay();else if(type==='settings')hideOverlay(refs.settingsOverlay);else if(type==='jump')hideOverlay(refs.jumpOverlay);
  }));
  document.addEventListener('keydown',e=>{
    if(e.key!=='Escape')return;
    if(!refs.recordOverlay.classList.contains('hidden'))closeRecordDay();
    else if(!refs.dayOverlay.classList.contains('hidden'))closeDay();
    else if(!refs.settingsOverlay.classList.contains('hidden'))hideOverlay(refs.settingsOverlay);
    else if(!refs.jumpOverlay.classList.contains('hidden'))hideOverlay(refs.jumpOverlay);
  });

  buildCalendar();chooseEventColor('blue');chooseTemplateColor('blue');chooseRecordColor('blue');
  renderOfficialStatus();
  if(location.protocol!=='file:')refreshOfficialData();
  requestAnimationFrame(()=>scrollToMonth(monthKey(TODAY()),'instant'));
  if('serviceWorker' in navigator && location.protocol!=='file:'){
    window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js').catch(err=>console.warn('オフライン準備に失敗',err)));
  }
})();
