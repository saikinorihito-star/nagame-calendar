#!/usr/bin/env python3
"""内閣府・JRA・地方競馬公式資料の公表済み日程を安全に同期する。

取得・解析に失敗した年/区分の既存データを消さず、不確実な日程を補完しない。
外部ネットワークがない環境でも、解析処理のユニットテストを実行できる。
"""
import csv
import datetime as dt
import io
import json
import re
import sys
import urllib.request
from pathlib import Path

from bs4 import BeautifulSoup

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / 'data'
HEADERS = {'User-Agent': 'NagameCalendar/2.1 (official public schedules)'}
HOLIDAY_URL = 'https://www8.cao.go.jp/chosei/shukujitsu/syukujitsu.csv'
JRA_URL = 'https://www.jra.go.jp/datafile/seiseki/replay/{year}/g1.html'
NAR_URL = 'https://www.keiba.go.jp/dirtgraderace/{year}/rating/prerating/index.html'
DATE_PATTERN = re.compile(r'(?P<m>\d{1,2})月(?P<d>\d{1,2})日')
GREGORIAN_PATTERN = re.compile(r'(?P<y>\d{4})[/-](?P<m>\d{1,2})[/-](?P<d>\d{1,2})')
GRADE_PATTERN = re.compile(r'^(?P<grade>J[・-]?G[ⅠI1]|G[ⅠI1])')
CENTRAL_VENUES = {'東京','中山','中京','京都','阪神','新潟','小倉','札幌','函館','福島'}
LOCAL_VENUES = {'大井','川崎','船橋','浦和','金沢','盛岡','門別','高知','佐賀','名古屋','園田','姫路','笠松','水沢','帯広','荒尾'}
JRA_FULL_NAMES = {
    'フェブラリーS':'フェブラリーステークス',
    'NHKマイルC':'NHKマイルカップ',
    'スプリンターズS':'スプリンターズステークス',
    'ジャパンC':'ジャパンカップ',
    'チャンピオンズC':'チャンピオンズカップ',
    '阪神ジュベナイルF':'阪神ジュベナイルフィリーズ',
    '朝日杯フューチュリティS':'朝日杯フューチュリティステークス',
    'ホープフルS':'ホープフルステークス',
}

def get(url):
    req=urllib.request.Request(url,headers=HEADERS)
    with urllib.request.urlopen(req,timeout=20) as response:
        raw=response.read(2_000_001)
        if len(raw)>2_000_000: raise ValueError('公開資料が大きすぎます')
        return raw

def parse_holidays(raw):
    text=None
    for encoding in ('utf-8-sig','cp932'):
        try: text=raw.decode(encoding);break
        except UnicodeDecodeError: pass
    if text is None:raise ValueError('CSV文字コードの判定に失敗')
    records={}
    for row in csv.reader(io.StringIO(text)):
        if len(row)<2:continue
        match=GREGORIAN_PATTERN.search(row[0])
        if not match:continue
        y,m,d=map(int,match.groups())
        if not 1955<=y<=2100:continue
        try: day=dt.date(y,m,d)
        except ValueError:continue
        title=row[1].strip()
        if not title or len(title)>32:continue
        records[day]=title
    if len(records)<100:raise ValueError('公式CSVのデータ件数が不足')
    result={}
    for day,title in records.items():
        if day.year<2025:continue
        if title=='休日':
            before=day-dt.timedelta(days=1)
            after=day+dt.timedelta(days=1)
            title=('国民の休日' if before in records and after in records
                   and records[before]!='休日' and records[after]!='休日'
                   else '振替休日')
        result[day.isoformat()]=title
    counts={}
    for key in result:
        year=key[:4];counts[year]=counts.get(year,0)+1
    if not counts or any(not 15<=count<=23 for count in counts.values()):
        raise ValueError('公表年の祝日件数が想定外')
    return result

def clean(cell):
    return re.sub(r'\s+','',cell.get_text(' ',strip=True))

def column_positions(headers):
    # 実施場/競走名とレース名/競馬場では順序が異なる。
    fields={}
    for idx,title in enumerate(headers):
        if title in ('月日','日付','実施日','開催日'):fields['date']=idx
        if title in ('レース名','競走名'):fields['name']=idx
        if title in ('競馬場','実施場','開催場'):fields['venue']=idx
    return fields if len(fields)==3 else None

def parse_races(html,year,category):
    """表見出しから列を判定。別順序の表、誤った開催場は受け付けない。"""
    soup=BeautifulSoup(html,'html.parser')
    races=[]
    for table in soup.select('table'):
        pos=None
        for tr in table.select('tr'):
            cells=tr.find_all(['th','td'],recursive=False)
            if not cells:continue
            row=[clean(x) for x in cells]
            new_pos=column_positions(row)
            if new_pos:
                pos=new_pos
                continue
            if not pos or len(row)<=max(pos.values()):continue
            md=DATE_PATTERN.search(row[pos['date']])
            if not md:continue
            try:day=dt.date(year,int(md['m']),int(md['d']))
            except ValueError:continue
            venue=row[pos['venue']].strip()
            name=row[pos['name']].strip()
            valid_venues=CENTRAL_VENUES if category=='central' else LOCAL_VENUES
            if venue not in valid_venues or not name or len(name)>85:continue
            if category=='central':
                grade_match=GRADE_PATTERN.match(name)
                if not grade_match:continue
                grade='J・GⅠ' if grade_match['grade'].startswith('J') else 'GⅠ'
                name=name[grade_match.end():].strip()
                name=JRA_FULL_NAMES.get(name,name)
            else:
                # 2026年のGI/JpnI公開一覧では東京大賞典のみGI。
                # それ以外は同資料のJpnI競走として扱う。
                grade='GⅠ' if name=='東京大賞典' else 'JpnⅠ'
            races.append({'date':day.isoformat(),'name':name,'venue':venue,'category':category,'grade':grade})
    distinct={(r['date'],r['name'],r['category']):r for r in races}
    return sorted(distinct.values(),key=lambda r:(r['date'],r['name']))

def load(path):
    return json.loads(path.read_text(encoding='utf-8'))

def save(path,obj):
    path.write_text(json.dumps(obj,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')

def mark_updated(obj):
    obj['updatedAt']=dt.datetime.now(dt.timezone.utc).isoformat(timespec='seconds')

def update_holidays():
    path=DATA/'holidays.json';doc=load(path)
    try:
        incoming=parse_holidays(get(HOLIDAY_URL))
        years={day[:4] for day in incoming}
        new={day:title for day,title in doc['holidays'].items() if day[:4] not in years}
        new.update(incoming)
        if doc['holidays']!=new:
            doc['holidays']=dict(sorted(new.items()))
            mark_updated(doc);save(path,doc)
            print('祝日データ更新',max(years),len(incoming),'件')
        else:print('祝日データ：変更なし')
    except Exception as exc:
        print('祝日：公式資料の取得・解析失敗、保存済みを維持:',exc,file=sys.stderr)

def update_races():
    path=DATA/'races.json';doc=load(path);races=doc['races']
    today=dt.date.today()
    for year in range(max(2026,today.year),min(today.year+2,2101)):
        for category,url in (('central',JRA_URL),('local',NAR_URL)):
            try:
                html=get(url.format(year=year)).decode('utf-8',errors='replace')
                new=parse_races(html,year,category)
                minimum=20 if category=='central' else 10
                if len(new)<minimum:
                    print(f'{year}年{category}：未公開か解析不可（{len(new)}件）・既存データ維持')
                    continue
                part=[r for r in races if r['date'].startswith(f'{year}-') and r['category']==category]
                if sorted(part,key=lambda r:(r['date'],r['name']))==new:continue
                races=[r for r in races if not (r['date'].startswith(f'{year}-') and r['category']==category)]+new
                print(f'{year}年{category}：{len(new)}件を更新')
            except Exception as exc:
                print(f'{year}年{category}：公式資料の取得・解析失敗、既存データ維持: {exc}',file=sys.stderr)
    new_sorted=sorted(races,key=lambda r:(r['date'],r['category'],r['name']))
    if doc['races']!=new_sorted:
        doc['races']=new_sorted;mark_updated(doc);save(path,doc)
    else:print('競馬データ：変更なし')

if __name__=='__main__':
    update_holidays()
    update_races()
