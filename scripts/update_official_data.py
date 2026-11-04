#!/usr/bin/env python3
"""日本の祝日、JRA GⅠ/J・GⅠ、地方GI/JpnIを公式公開資料から更新する。"""
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
HOLIDAY_URL = 'https://www8.cao.go.jp/chosei/shukujitsu/syukujitsu.csv'
JRA_URLS = [
    'https://www.jra.go.jp/datafile/seiseki/replay/{year}/g1.html',
    'https://www.jra.go.jp/datafile/ranking/g1/{year}.html',
]
NAR_URL = 'https://www.keiba.go.jp/dirtgraderace/{year}/rating/prerating/index.html'
HEADERS = {'User-Agent': 'Mozilla/5.0 (compatible; PersonalCalendar/2.2)'}
DATE_RE = re.compile(r'(\d{1,2})月(\d{1,2})日')
ISO_RE = re.compile(r'(\d{4})[/-](\d{1,2})[/-](\d{1,2})')
GRADE_RE = re.compile(r'^(J[・.\-]?G[ⅠI1]|G[ⅠI1])')
CENTRAL = {'東京','中山','中京','京都','阪神','新潟','小倉','札幌','函館','福島'}
LOCAL = {'大井','川崎','船橋','浦和','金沢','盛岡','門別','高知','佐賀','名古屋','園田','姫路','笠松','水沢','帯広'}
SHORT_NAMES = {
    'フェブラリーS':'フェブラリーステークス',
    'NHKマイルC':'NHKマイルカップ',
    'スプリンターズS':'スプリンターズステークス',
    'ジャパンC':'ジャパンカップ',
    'チャンピオンズC':'チャンピオンズカップ',
    '阪神ジュベナイルF':'阪神ジュベナイルフィリーズ',
    '朝日杯フューチュリティS':'朝日杯フューチュリティステークス',
    'ホープフルS':'ホープフルステークス',
    '優駿牝馬（オークス）':'オークス',
    '東京優駿（日本ダービー）':'日本ダービー',
}


def download(url):
    request = urllib.request.Request(url, headers=HEADERS)
    with urllib.request.urlopen(request, timeout=20) as response:
        content = response.read(2_000_001)
    if len(content) > 2_000_000:
        raise ValueError('公式資料のデータが大きすぎます')
    return content


def decode(content):
    for encoding in ('utf-8-sig', 'cp932', 'euc-jp'):
        try:
            return content.decode(encoding)
        except UnicodeDecodeError:
            pass
    raise ValueError('文字コードを判定できません')


def read_json(filename):
    return json.loads((DATA / filename).read_text(encoding='utf-8'))


def write_json(filename, obj):
    obj['updatedAt'] = dt.datetime.now(dt.timezone.utc).isoformat(timespec='seconds')
    (DATA / filename).write_text(json.dumps(obj, indent=2, ensure_ascii=False)+'\n', encoding='utf-8')


def parse_holidays(content):
    found = {}
    for row in csv.reader(io.StringIO(decode(content))):
        if len(row) < 2:
            continue
        match = ISO_RE.search(row[0])
        if not match:
            continue
        try:
            date = dt.date(*map(int, match.groups()))
        except ValueError:
            continue
        title = row[1].strip()
        if 1955 <= date.year <= 2100 and 0 < len(title) <= 32:
            found[date] = title
    if len(found) < 100:
        raise ValueError('祝日CSVのデータ件数が少なすぎます')
    result = {}
    for day, title in found.items():
        if day.year < 2025:
            continue
        if title == '休日':
            previous = found.get(day - dt.timedelta(days=1))
            following = found.get(day + dt.timedelta(days=1))
            title = '国民の休日' if previous and following and previous != '休日' and following != '休日' else '振替休日'
        result[day.isoformat()] = title
    counts = {}
    for day in result:
        year = day[:4]
        counts[year] = counts.get(year, 0) + 1
    if not counts or any(count < 15 or count > 23 for count in counts.values()):
        raise ValueError('公表された祝日件数が想定外です')
    return result


def parse_races(html, year, category):
    soup = BeautifulSoup(html, 'html.parser')
    rows = {}
    for table in soup.select('table'):
        positions = None
        for tr in table.select('tr'):
            cells = tr.find_all(['th', 'td'], recursive=False)
            if not cells:
                continue
            values = [re.sub(r'\s+', '', c.get_text(' ', strip=True)) for c in cells]
            headers = {}
            for i, label in enumerate(values):
                if label in ('月日', '日付', '実施日', '開催日'):
                    headers['date'] = i
                elif label in ('レース名', '競走名'):
                    headers['name'] = i
                elif label in ('競馬場', '実施場', '開催場'):
                    headers['venue'] = i
            if len(headers) == 3:
                positions = headers
                continue
            if not positions or max(positions.values()) >= len(values):
                continue
            match = DATE_RE.search(values[positions['date']])
            if not match:
                continue
            try:
                day = dt.date(year, int(match[1]), int(match[2]))
            except ValueError:
                continue
            venue = values[positions['venue']]
            name = values[positions['name']]
            if venue not in (CENTRAL if category == 'central' else LOCAL) or not name:
                continue
            if category == 'central':
                grade_match = GRADE_RE.match(name)
                grade = 'J・GⅠ' if grade_match and name.startswith('J') else 'GⅠ'
                if grade_match:
                    name = name[grade_match.end():]
                # JRAプレレーティング一覧は名称にグレード表記がない。
                name = SHORT_NAMES.get(name, name)
            else:
                # GI/JpnIの公式専用表からのみ抽出する。
                grade = 'GⅠ' if name == '東京大賞典' else 'JpnⅠ'
            if not 2 <= len(name) <= 85:
                continue
            record = {'date': day.isoformat(), 'name': name, 'venue': venue,
                      'category': category, 'grade': grade}
            rows[(record['date'], record['name'], category)] = record
    return sorted(rows.values(), key=lambda r: (r['date'], r['name']))


def update_holidays():
    doc = read_json('holidays.json')
    try:
        incoming = parse_holidays(download(HOLIDAY_URL))
        official_years = {date[:4] for date in incoming}
        kept = {date: name for date, name in doc['holidays'].items() if date[:4] not in official_years}
        kept.update(incoming)
        kept = dict(sorted(kept.items()))
        if kept != doc['holidays']:
            doc['holidays'] = kept
            write_json('holidays.json', doc)
            print('祝日を更新しました')
        else:
            print('祝日に変更はありません')
    except Exception as exc:
        print('祝日の取得に失敗。以前のデータを維持:', exc, file=sys.stderr)


def get_official_races(year, category):
    urls = JRA_URLS if category == 'central' else [NAR_URL]
    candidates = []
    for url_template in urls:
        try:
            html = decode(download(url_template.format(year=year)))
            found = parse_races(html, year, category)
            if len(found) >= (20 if category == 'central' else 10):
                candidates.append(found)
            else:
                print(f'{year}年 {category}: 公開表が未完成か解析不可 ({len(found)}件)')
        except Exception as exc:
            print(f'{year}年 {category}: 取得先を確認できません: {exc}', file=sys.stderr)
    return max(candidates, key=len) if candidates else []


def update_races():
    doc = read_json('races.json')
    races = doc['races']
    this_year = dt.date.today().year
    for year in range(max(2026, this_year), min(2101, this_year + 2)):
        for category in ('central', 'local'):
            fresh = get_official_races(year, category)
            previous = [r for r in races if r['category'] == category and r['date'].startswith(f'{year}-')]
            # 取得失敗・不完全な公開表で、登録済み日程を消さない。
            if not fresh or len(fresh) < len(previous):
                print(f'{year}年 {category}: 保存済み日程を維持')
                continue
            if sorted(previous, key=lambda r: (r['date'],r['name'])) == fresh:
                continue
            races = [r for r in races if not (r['category'] == category and r['date'].startswith(f'{year}-'))]
            races.extend(fresh)
            print(f'{year}年 {category}: {len(fresh)}競走を更新')
    result = sorted(races, key=lambda r: (r['date'], r['category'], r['name']))
    if result != doc['races']:
        doc['races'] = result
        write_json('races.json', doc)
    else:
        print('競馬日程に変更はありません')


if __name__ == '__main__':
    update_holidays()
    update_races()
