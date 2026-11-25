# Simulated daily progress reports for Seruni Waterflood (FEED RWD SLO, WO-133) — for 4D demonstration only.
import csv, datetime as dt, math, random

random.seed(133)
D0 = dt.date(2026, 9, 1)
END_CAP = dt.date(2027, 4, 30)  # run the reports until every activity reaches 100 %
d = lambda s: dt.date.fromisoformat(s)

# package_id, area, name, hint (object names/layers in the 3D model), delay (days), activities [(desc, unit, bq, plan start, plan finish)]
P = [
 ('MOB', 'ONPLOT', 'Mobilisasi & site preparation', '', -2, [
   ('Mobilisasi alat & personel', 'ls', 1, '2026-09-01', '2026-09-14'),
   ('Survey & stake out', 'ls', 1, '2026-09-03', '2026-09-12'),
   ('Site clearing & grubbing', 'm2', 6500, '2026-09-05', '2026-09-25'),
   ('Cut & fill, pemadatan tanah', 'm3', 4200, '2026-09-10', '2026-10-10'),
   ('Site office & laydown area', 'ls', 1, '2026-09-04', '2026-09-20')]),
 ('CIV-FDN', 'ONPLOT', 'Pondasi tank & equipment', 'pondasi|pedestal|fdn|wo-133-s/structure|*civil-structure', 0, [
   ('Pemancangan mini pile', 'titik', 96, '2026-09-20', '2026-10-20'),
   ('Galian pondasi', 'm3', 380, '2026-09-25', '2026-10-15'),
   ('Lean concrete', 'm3', 28, '2026-10-01', '2026-10-18'),
   ('Pembesian pondasi', 'kg', 42000, '2026-10-01', '2026-11-05'),
   ('Bekisting', 'm2', 860, '2026-10-03', '2026-11-08'),
   ('Pengecoran K-300', 'm3', 410, '2026-10-08', '2026-11-15'),
   ('Anchor bolt & grouting', 'set', 64, '2026-10-25', '2026-11-30')]),
 ('CIV-PIT', 'ONPLOT', 'Sump pit & oil catcher', '/pit', 3, [
   ('Galian sump pit', 'm3', 160, '2026-10-05', '2026-10-20'),
   ('Pembesian sump pit', 'kg', 9800, '2026-10-15', '2026-11-05'),
   ('Pengecoran sump pit', 'm3', 85, '2026-10-22', '2026-11-15'),
   ('Waterproofing & cover grating', 'm2', 240, '2026-11-10', '2026-12-05')]),
 ('CIV-BUND', 'ONPLOT', 'Bund wall tank area', 'bundwall', 5, [
   ('Galian bund wall', 'm3', 210, '2026-10-15', '2026-11-01'),
   ('Pembesian bund wall', 'kg', 14500, '2026-10-25', '2026-11-25'),
   ('Pengecoran bund wall', 'm3', 165, '2026-11-01', '2026-12-05'),
   ('Coating bund wall', 'm2', 620, '2026-12-01', '2026-12-20')]),
 ('CIV-DRN', 'ONPLOT', 'Drainage, jalan & paving', '/drain', 0, [
   ('Saluran drainase U-ditch', 'm', 420, '2026-11-10', '2026-12-20'),
   ('Lapis base course jalan', 'm3', 640, '2026-11-20', '2026-12-30'),
   ('Paving / gravel area plant', 'm2', 3200, '2026-12-10', '2027-01-25')]),
 ('BLDG', 'ONPLOT', 'Control room, MCC room & pos jaga', 'operator_room|security_post|control_room|mcc_room', 0, [
   ('Pondasi & sloof bangunan', 'm3', 64, '2026-10-20', '2026-11-20'),
   ('Struktur kolom & balok bangunan', 'm3', 48, '2026-11-15', '2026-12-25'),
   ('Dinding bata & plester', 'm2', 620, '2026-12-15', '2027-01-25'),
   ('Atap, plafon & finishing', 'm2', 410, '2027-01-10', '2027-02-15'),
   ('MEP bangunan (AC, lampu, stop kontak)', 'ls', 1, '2027-01-25', '2027-02-25')]),
 ('MEC-T0103', 'ONPLOT', 'Tank T-0103', 't-0103|t0103', 0, [
   ('Fabrikasi plat tank T-0103', 'ton', 46, '2026-10-01', '2026-10-30'),
   ('Erection bottom plate T-0103', 'm2', 320, '2026-10-20', '2026-11-05'),
   ('Erection shell course 1-3 T-0103', 'course', 3, '2026-11-01', '2026-11-22'),
   ('Erection shell course 4-6 T-0103', 'course', 3, '2026-11-20', '2026-12-12'),
   ('Erection roof plate T-0103', 'm2', 330, '2026-12-08', '2026-12-28'),
   ('Nozzle, manhole & appurtenance T-0103', 'set', 18, '2026-12-10', '2027-01-05'),
   ('Radiografi las T-0103', 'film', 240, '2026-11-05', '2027-01-05'),
   ('Hydrotest tank T-0103', 'ls', 1, '2027-01-05', '2027-01-15'),
   ('Coating tank T-0103', 'm2', 1350, '2027-01-10', '2027-02-05')]),
 ('MEC-T0302', 'ONPLOT', 'Tank T-0302', 't-0302|t0302|_0302|0302b', 4, [
   ('Fabrikasi plat tank T-0302', 'ton', 52, '2026-10-10', '2026-11-10'),
   ('Erection bottom plate T-0302', 'm2', 360, '2026-11-01', '2026-11-18'),
   ('Erection shell course 1-3 T-0302', 'course', 3, '2026-11-15', '2026-12-08'),
   ('Erection shell course 4-6 T-0302', 'course', 3, '2026-12-05', '2026-12-28'),
   ('Erection roof plate T-0302', 'm2', 370, '2026-12-22', '2027-01-10'),
   ('Nozzle, manhole & appurtenance T-0302', 'set', 20, '2026-12-28', '2027-01-20'),
   ('Radiografi las T-0302', 'film', 260, '2026-11-18', '2027-01-20'),
   ('Hydrotest tank T-0302', 'ls', 1, '2027-01-20', '2027-01-30'),
   ('Coating tank T-0302', 'm2', 1480, '2027-01-25', '2027-02-20')]),
 ('MEC-T0301', 'ONPLOT', 'Surge tank T-0301', 't-0301', 2, [
   ('Fabrikasi surge tank T-0301', 'ton', 14, '2026-10-20', '2026-11-15'),
   ('Erection surge tank T-0301', 'ton', 14, '2026-11-15', '2026-12-15'),
   ('Nozzle & instrument connection T-0301', 'set', 8, '2026-12-10', '2027-01-05'),
   ('Hydrotest & coating T-0301', 'ls', 1, '2027-01-05', '2027-01-25')]),
 ('MEC-V0103', 'ONPLOT', 'Vessel V-0103 & filter skid', 'v-0103|flad-2000|sc-t2001|ro-2001', 6, [
   ('Setting vessel V-0103', 'unit', 1, '2026-11-20', '2026-12-10'),
   ('Setting filter skid', 'unit', 2, '2026-12-01', '2026-12-28'),
   ('Nozzle & instrument hook-up vessel', 'set', 12, '2026-12-20', '2027-01-25')]),
 ('MEC-PUMP', 'ONPLOT', 'Pompa injeksi, transfer & shipping', 'pump|p-2001|p-0501|/2001|*mechanical', 14, [
   ('Setting pompa injeksi P-2001A/B/C', 'unit', 3, '2026-11-10', '2026-12-05'),
   ('Setting transfer pump', 'unit', 2, '2026-11-12', '2026-12-05'),
   ('Setting shipping pump', 'unit', 2, '2026-11-15', '2026-12-10'),
   ('Setting recycle pump & P-0501', 'unit', 2, '2026-11-20', '2026-12-12'),
   ('Grouting & alignment pompa', 'unit', 9, '2026-12-01', '2026-12-28')]),
 ('MEC-TOWER', 'ONPLOT', 'Water tower', 'water_tower', 0, [
   ('Fabrikasi struktur water tower', 'ton', 9, '2026-10-15', '2026-11-10'),
   ('Erection water tower', 'ton', 9, '2026-11-05', '2026-11-30')]),
 ('STL', 'ONPLOT', 'Steel structure, platform & stair', 'acces|ladder|platform|stair', 0, [
   ('Fabrikasi steel structure', 'ton', 38, '2026-10-10', '2026-11-25'),
   ('Erection steel structure', 'ton', 38, '2026-11-01', '2026-12-20'),
   ('Pemasangan grating', 'm2', 180, '2026-11-25', '2026-12-28'),
   ('Pemasangan handrail & ladder', 'm', 260, '2026-12-01', '2027-01-05')]),
 ('OFF-SNTG', 'OFFPLOT', 'Pipeline Seruni - Sintong', 'sntg-|stng-|sintong', 10, [
   ('ROW clearing & survey', 'km', 4.8, '2026-09-20', '2026-10-25'),
   ('Stringing pipa 16"/12"', 'm', 4800, '2026-10-15', '2026-11-25'),
   ('Welding joint pipeline', 'joint', 420, '2026-10-25', '2026-12-20'),
   ('NDT radiografi pipeline', 'joint', 420, '2026-11-01', '2026-12-28'),
   ('Field joint coating', 'joint', 420, '2026-11-10', '2027-01-05'),
   ('Pipe support & sleeper pipeline', 'set', 380, '2026-10-20', '2026-12-20'),
   ('Road / canal crossing', 'nos', 6, '2026-11-15', '2027-01-10'),
   ('Hydrotest pipeline', 'section', 3, '2027-01-05', '2027-01-25')]),
 ('PIP-WI', 'ONPLOT', 'Piping water injection (WI)', '-wi-d3|-wi-b3', 0, [
   ('Fabrikasi spool WI', 'dia-inch', 2600, '2026-10-15', '2026-11-30'),
   ('Welding joint WI', 'dia-inch', 2600, '2026-10-25', '2026-12-15'),
   ('Erection pipa WI', 'm', 1450, '2026-11-05', '2026-12-28'),
   ('NDT & PWHT WI', 'joint', 310, '2026-11-10', '2027-01-05')]),
 ('PIP-WW', 'ONPLOT', 'Piping water well / WW', '-ww-b3', 0, [
   ('Fabrikasi spool WW', 'dia-inch', 1900, '2026-10-20', '2026-12-05'),
   ('Welding joint WW', 'dia-inch', 1900, '2026-10-30', '2026-12-20'),
   ('Erection pipa WW', 'm', 980, '2026-11-10', '2027-01-05')]),
 ('PIP-PF', 'ONPLOT', 'Piping produced fluid / produced water', '-pf-b3|-pw-b3', 3, [
   ('Fabrikasi spool PF/PW', 'dia-inch', 2200, '2026-10-25', '2026-12-10'),
   ('Welding joint PF/PW', 'dia-inch', 2200, '2026-11-05', '2026-12-28'),
   ('Erection pipa PF/PW', 'm', 1120, '2026-11-15', '2027-01-10')]),
 ('PIP-UT', 'ONPLOT', 'Piping utility (NG, SO, drain)', 'srni-|*piping', 0, [
   ('Fabrikasi spool utility', 'dia-inch', 820, '2026-11-01', '2026-12-15'),
   ('Erection pipa utility', 'm', 640, '2026-11-20', '2027-01-15')]),
 ('TIE', 'ONPLOT', 'Tie-in & modifikasi line existing', '-pw-b-|-so-c-|-so-b-|-ng-b|-pf-b-|-co-b|-ww-b', 0, [
   ('Persiapan tie-in & hot tap', 'pts', 6, '2026-11-15', '2026-12-20'),
   ('Modifikasi line existing', 'm', 380, '2026-12-01', '2027-01-15'),
   ('Shutdown tie-in', 'ls', 1, '2027-01-15', '2027-01-25')]),
 ('PS', 'ONPLOT', 'Pipe support onplot', 'pipe-support|/ps-', 0, [
   ('Pondasi pipe support', 'titik', 140, '2026-10-05', '2026-11-10'),
   ('Fabrikasi pipe support', 'kg', 18500, '2026-10-15', '2026-11-30'),
   ('Pemasangan pipe support', 'set', 320, '2026-10-30', '2026-12-28')]),
 ('ELEC', 'ONPLOT', 'Electrical & transformer yard', 'transformer|electrical', 0, [
   ('Pondasi & setting transformer', 'unit', 1, '2026-11-01', '2026-11-30'),
   ('Cable tray & ladder', 'm', 460, '2026-11-15', '2026-12-28'),
   ('Penarikan kabel power & kontrol', 'm', 3800, '2026-12-01', '2027-01-20'),
   ('Grounding system', 'set', 1, '2026-11-20', '2026-12-30'),
   ('Lampu penerangan area', 'titik', 48, '2026-12-15', '2027-01-25')]),
 ('SAFE', 'ONPLOT', 'Safety equipment', 'safety', 0, [
   ('Safety shower & eye wash', 'unit', 2, '2026-12-15', '2027-01-15'),
   ('APAR & fire box', 'unit', 12, '2027-01-05', '2027-01-25')]),
 ('PRECOM', 'ONPLOT', 'Pre-commissioning', '', 10, [
   ('Hydrotest system piping', 'test pack', 24, '2026-12-28', '2027-02-05'),
   ('Flushing & drying', 'system', 6, '2027-01-25', '2027-02-15'),
   ('Punch list & mechanical completion', 'ls', 1, '2027-02-05', '2027-02-26')]),
]

import re as _re
def rate(desc, unit):
    # simulated unit rates (IDR), construction / installation only (no equipment supply)
    s = desc.lower()
    R = {
      'm3': [('galian', 85e3), ('cut & fill', 120e3), ('lean', 1.25e6), ('base course', 450e3)], 'kg': [('pipe support', 32e3)],
      'm2': [('clearing', 12e3), ('bekisting', 285e3), ('bottom plate', 950e3), ('roof plate', 950e3), ('coating', 210e3), ('waterproofing', 160e3), ('grating', 1.35e6), ('dinding', 165e3), ('atap', 420e3), ('paving', 210e3)],
      'titik': [('mini pile', 4.5e6), ('pipe support', 2.8e6), ('lampu', 3.2e6)],
      'set': [('anchor', 1.8e6), ('nozzle', 6.5e6), ('hook-up', 6.5e6), ('instrument', 6.5e6), ('pipe support', 1.65e6), ('sleeper', 1.65e6), ('grounding', 185e6)],
      'ton': [('fabrikasi plat', 38e6), ('fabrikasi surge', 42e6), ('erection surge', 15e6), ('fabrikasi struktur', 36e6), ('erection water', 12e6), ('fabrikasi steel', 32e6), ('erection steel', 11e6)],
      'ls': [('mobilisasi', 850e6), ('survey', 95e6), ('site office', 380e6), ('hydrotest tank', 225e6), ('shutdown', 450e6), ('mep', 350e6), ('punch', 250e6), ('hydrotest & coating', 280e6)],
      'unit': [('setting pompa', 85e6), ('pump', 85e6), ('grouting', 18e6), ('transformer', 180e6), ('vessel', 120e6), ('filter', 95e6), ('safety shower', 45e6), ('apar', 3.5e6)],
      'm': [('stringing', 95e3), ('u-ditch', 1.15e6), ('erection pipa', 425e3), ('modifikasi', 650e3), ('cable tray', 850e3), ('kabel', 210e3), ('handrail', 650e3)],
      'joint': [('welding', 2.65e6), ('ndt', 1.15e6), ('coating', 850e3)], 'dia-inch': [('fabrikasi', 385e3), ('welding', 520e3)],
      'course': [('', 165e6)], 'film': [('', 450e3)], 'km': [('', 280e6)], 'nos': [('', 165e6)], 'section': [('', 175e6)], 'pts': [('', 145e6)], 'test pack': [('', 22e6)], 'system': [('', 48e6)],
    }
    for k, v in R.get(unit, []):
        if k in s: return int(v)
    return int({'m3': 1.85e6, 'kg': 18.5e3, 'm2': 250e3, 'ton': 30e6, 'set': 5e6, 'unit': 60e6, 'ls': 200e6, 'm': 400e3}.get(unit, 1e6))

def smooth(x):
    x = max(0.0, min(1.0, x))
    return x * x * (3 - 2 * x)

days = [D0 + dt.timedelta(i) for i in range((END_CAP - D0).days + 1)]
# rainy days (Nov is the wet season) slow the work
rain = {x for x in days if random.random() < (0.12 if x.month < 11 else 0.32)}

rows, cur = [], {}
last_day = None
for di, day in enumerate(days):
    if cur and all(v >= 100 for v in cur.values()): break
    last_day = day
    sun = day.weekday() == 6
    active = 0
    for pid, area, name, hint, delay, acts in P:
        for (desc, unit, bq, a, z) in acts:
            k = (pid, desc)
            A, Z = d(a) + dt.timedelta(delay), d(z) + dt.timedelta(delay + (delay // 2))
            target = 100 * smooth(((day - A).days + 1) / max(1, (Z - A).days + 1))
            prev = cur.get(k, 0.0)
            step = max(0.0, target - prev)
            if step > 0:
                f = 0.35 if day in rain else 1.0
                f *= 0.6 if sun else 1.0
                step = step * f * random.uniform(0.75, 1.05) + (0 if target < 100 else 0)
                if 0 < prev and target - prev < 0.6: step = target - prev
            v = min(100.0, prev + step)
            if unit in ('ls', 'unit', 'course', 'section', 'system', 'pts', 'nos') and bq <= 12:
                v = round(v / (100 / bq / 2)) * (100 / bq / 2) if v < 99.5 else 100.0  # lumpy items move in halves of a unit
                v = max(v, prev)
            v = round(v, 1)
            cur[k] = v
            if prev < v < 100 or (0 < v and prev < 100 and v >= 100): active += 1
            rows.append([day.isoformat(), area, name, pid, hint, desc, unit, bq, rate(desc, unit), v])
    mp = int(round((22 + active * 4.2) * (0.62 if sun else 1.0) * (0.85 if day in rain else 1.0) * random.uniform(0.93, 1.07)))
    for r in rows[-sum(len(p[5]) for p in P):]: r.append(mp)
    concerns = []
    if day in rain: concerns.append('Hujan di lokasi, pekerjaan galian & pengecoran terhenti sebagian')
    if d('2026-10-20') <= day <= d('2026-11-14'): concerns.append('Pembebasan lahan ROW pipeline Seruni-Sintong KM 2+300 belum selesai')
    if d('2026-11-01') <= day <= d('2026-11-28'): concerns.append('Pompa injeksi P-2001A/B/C belum tiba di site (ETA vendor mundur 2 minggu)')
    if d('2026-11-29') <= day <= d('2026-12-03'): concerns.append('Pompa P-2001A/B/C tiba di site, inspeksi kedatangan (MRIR) OK')
    if d('2026-11-16') <= day <= d('2026-12-20'): concerns.append('Repair rate radiografi pipeline 6,8% (target < 5%), welder di-requalify')
    if d('2027-01-14') <= day <= d('2027-01-27'): concerns.append('Persiapan shutdown tie-in: koordinasi jadwal dengan Operation')
    if d('2027-02-20') <= day: concerns.append('Punch list kategori A diselesaikan sebelum mechanical completion')
    day_rows = rows[-sum(len(p[5]) for p in P):]
    for i, c in enumerate(concerns): day_rows[i].append(c)

hdr = ['date', 'area', 'package', 'package_id', 'hint', 'activity', 'unit', 'bq', 'rate', 'progress', 'manpower', 'concern']
with open(__import__('os').path.join(__import__('os').path.dirname(__import__('os').path.abspath(__file__)), 'Seruni_WF_daily_report_SIMULASI.csv'), 'w', newline='') as f:
    w = csv.writer(f); w.writerow(hdr)
    for r in rows: w.writerow(r + [''] * (len(hdr) - len(r)))
with open(__import__('os').path.join(__import__('os').path.dirname(__import__('os').path.abspath(__file__)), 'Seruni_WF_baseline_SIMULASI.csv'), 'w', newline='') as f:
    w = csv.writer(f); w.writerow(['package', 'start', 'finish'])
    for pid, area, name, hint, delay, acts in P:
        w.writerow([name, min(a[3] for a in acts), max(a[4] for a in acts)])
print(len(rows), 'rows', len(days), 'days')
# overall at today
tot = sum(len(p[5]) for p in P)
print('last report', last_day, 'overall %.1f' % (sum(cur.values()) / tot))

# contract value
tv = sum(a[2] * rate(a[0], a[1]) for p in P for a in p[5])
print('contract value (simulated) Rp %.1f M' % (tv / 1e9))
for pid, area, name, hint, delay, acts in P:
    print('  %-10s Rp %6.2f M' % (pid, sum(a[2] * rate(a[0], a[1]) for a in acts) / 1e9))

# baseline schedules: Primavera P6 (XER) and Microsoft Project (XML), activity level, WBS = work package
import os, html as _html
here = os.path.dirname(os.path.abspath(__file__))
xer = ['ERMHDR\t19.12\t2026-08-25\tProject\tadmin\tSIMULASI\tdbxDatabaseNoName\tProject Management\tIDR',
       '%T\tPROJECT', '%F\tproj_id\tproj_short_name\tplan_start_date\tplan_end_date',
       '%R\t1001\tSRN-WF\t2026-09-01 08:00\t2027-02-26 17:00',
       '%T\tPROJWBS', '%F\twbs_id\tproj_id\tparent_wbs_id\twbs_short_name\twbs_name',
       '%R\t2000\t1001\t\tSRN-WF\tSeruni Waterflood (SIMULASI)']
for i, (pid, area, name, hint, delay, acts) in enumerate(P):
    xer.append(f'%R\t{2001 + i}\t1001\t2000\t{pid}\t{name}')
xer += ['%T\tTASK', '%F\ttask_id\tproj_id\twbs_id\ttask_code\ttask_name\ttask_type\ttarget_start_date\ttarget_end_date']
tid = 5000
for i, (pid, area, name, hint, delay, acts) in enumerate(P):
    for j, (desc, unit, bq, a, z) in enumerate(acts):
        tid += 1
        xer.append(f'%R\t{tid}\t1001\t{2001 + i}\t{pid}-{(j + 1) * 10:03d}\t{desc}\tTT_Task\t{a} 08:00\t{z} 17:00')
xer.append('%E')
open(os.path.join(here, 'Seruni_WF_baseline_SIMULASI.xer'), 'w').write('\n'.join(xer) + '\n')

T = []
uid = 0
T.append('<Task><UID>0</UID><ID>0</ID><Name>Seruni Waterflood (SIMULASI)</Name><OutlineLevel>0</OutlineLevel><Summary>1</Summary><Start>2026-09-01T08:00:00</Start><Finish>2027-02-26T17:00:00</Finish></Task>')
for i, (pid, area, name, hint, delay, acts) in enumerate(P):
    uid += 1
    T.append(f'<Task><UID>{uid}</UID><ID>{uid}</ID><Name>{_html.escape(name)}</Name><WBS>{i + 1}</WBS><OutlineLevel>1</OutlineLevel><Summary>1</Summary><Start>{min(a[3] for a in acts)}T08:00:00</Start><Finish>{max(a[4] for a in acts)}T17:00:00</Finish></Task>')
    for j, (desc, unit, bq, a, z) in enumerate(acts):
        uid += 1
        T.append(f'<Task><UID>{uid}</UID><ID>{uid}</ID><Name>{_html.escape(desc)}</Name><WBS>{i + 1}.{j + 1}</WBS><OutlineLevel>2</OutlineLevel><Summary>0</Summary><Start>{a}T08:00:00</Start><Finish>{z}T17:00:00</Finish></Task>')
xml = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Project xmlns="http://schemas.microsoft.com/project">'
       '<Name>Seruni Waterflood (SIMULASI)</Name><StartDate>2026-09-01T08:00:00</StartDate><FinishDate>2027-02-26T17:00:00</FinishDate><Tasks>\n'
       + '\n'.join(T) + '\n</Tasks></Project>\n')
open(os.path.join(here, 'Seruni_WF_baseline_SIMULASI.xml'), 'w').write(xml)
print('xer/xml written', tid - 5000, 'activities')
