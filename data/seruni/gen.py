# Simulated daily progress reports for Seruni Waterflood (FEED RWD SLO, WO-133) — for 4D demonstration only.
import csv, datetime as dt, math, random

random.seed(133)
D0 = dt.date(2026, 9, 1)
TODAY = dt.date(2026, 11, 23)
d = lambda s: dt.date.fromisoformat(s)

# package_id, area, name, hint (object names/layers in the 3D model), delay (days), activities [(desc, unit, bq, plan start, plan finish)]
P = [
 ('MOB', 'ONPLOT', 'Mobilisasi & site preparation', '', -2, [
   ('Mobilisasi alat & personel', 'ls', 1, '2026-09-01', '2026-09-14'),
   ('Survey & stake out', 'ls', 1, '2026-09-03', '2026-09-12'),
   ('Site clearing & grubbing', 'm2', 6500, '2026-09-05', '2026-09-25'),
   ('Cut & fill, pemadatan tanah', 'm3', 4200, '2026-09-10', '2026-10-10'),
   ('Site office & laydown area', 'ls', 1, '2026-09-04', '2026-09-20')]),
 ('CIV-FDN', 'ONPLOT', 'Pondasi tank & equipment', 'pondasi|pedestal|fdn', 0, [
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
 ('CIV-DRN', 'ONPLOT', 'Drainage, jalan & paving', '', 0, [
   ('Saluran drainase U-ditch', 'm', 420, '2026-11-10', '2026-12-20'),
   ('Lapis base course jalan', 'm3', 640, '2026-11-20', '2026-12-30'),
   ('Paving / gravel area plant', 'm2', 3200, '2026-12-10', '2027-01-25')]),
 ('MEC-T0103', 'ONPLOT', 'Tank T-0103', 't-0103', 0, [
   ('Fabrikasi plat tank T-0103', 'ton', 46, '2026-10-01', '2026-10-30'),
   ('Erection bottom plate T-0103', 'm2', 320, '2026-10-20', '2026-11-05'),
   ('Erection shell course 1-3 T-0103', 'course', 3, '2026-11-01', '2026-11-22'),
   ('Erection shell course 4-6 T-0103', 'course', 3, '2026-11-20', '2026-12-12'),
   ('Erection roof plate T-0103', 'm2', 330, '2026-12-08', '2026-12-28'),
   ('Nozzle, manhole & appurtenance T-0103', 'set', 18, '2026-12-10', '2027-01-05'),
   ('Radiografi las T-0103', 'film', 240, '2026-11-05', '2027-01-05'),
   ('Hydrotest tank T-0103', 'ls', 1, '2027-01-05', '2027-01-15'),
   ('Coating tank T-0103', 'm2', 1350, '2027-01-10', '2027-02-05')]),
 ('MEC-T0302', 'ONPLOT', 'Tank T-0302', 't-0302|t0302', 4, [
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
 ('MEC-PUMP', 'ONPLOT', 'Pompa injeksi, transfer & shipping', 'pump|p-2001|p-0501', 14, [
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
 ('PIP-UT', 'ONPLOT', 'Piping utility (NG, SO, drain)', 'srni-', 0, [
   ('Fabrikasi spool utility', 'dia-inch', 820, '2026-11-01', '2026-12-15'),
   ('Erection pipa utility', 'm', 640, '2026-11-20', '2027-01-15')]),
 ('TIE', 'ONPLOT', 'Tie-in & modifikasi line existing', '-pw-b-|-so-c-|-so-b-|-ng-b|-pf-b-|-co-b|-ww-b', 0, [
   ('Persiapan tie-in & hot tap', 'pts', 6, '2026-11-15', '2026-12-20'),
   ('Modifikasi line existing', 'm', 380, '2026-12-01', '2027-01-15'),
   ('Shutdown tie-in', 'ls', 1, '2027-01-15', '2027-01-25')]),
 ('PS', 'ONPLOT', 'Pipe support onplot', 'pipe-support', 0, [
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
 ('PRECOM', 'ONPLOT', 'Pre-commissioning', '', 0, [
   ('Hydrotest system piping', 'test pack', 24, '2026-12-28', '2027-02-05'),
   ('Flushing & drying', 'system', 6, '2027-01-25', '2027-02-15'),
   ('Punch list & mechanical completion', 'ls', 1, '2027-02-05', '2027-02-26')]),
]

def smooth(x):
    x = max(0.0, min(1.0, x))
    return x * x * (3 - 2 * x)

days = [D0 + dt.timedelta(i) for i in range((TODAY - D0).days + 1)]
# rainy days (Nov is the wet season) slow the work
rain = {x for x in days if random.random() < (0.12 if x.month < 11 else 0.32)}

rows, cur = [], {}
for di, day in enumerate(days):
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
            rows.append([day.isoformat(), area, name, pid, hint, desc, unit, bq, v])
    mp = int(round((22 + active * 4.2) * (0.62 if sun else 1.0) * (0.85 if day in rain else 1.0) * random.uniform(0.93, 1.07)))
    for r in rows[-sum(len(p[5]) for p in P):]: r.append(mp)
    concerns = []
    if day in rain: concerns.append('Hujan di lokasi, pekerjaan galian & pengecoran terhenti sebagian')
    if d('2026-10-20') <= day <= d('2026-11-14'): concerns.append('Pembebasan lahan ROW pipeline Seruni-Sintong KM 2+300 belum selesai')
    if day >= d('2026-11-01'): concerns.append('Pompa injeksi P-2001A/B/C belum tiba di site (ETA vendor mundur 2 minggu)')
    if d('2026-11-16') <= day: concerns.append('Repair rate radiografi pipeline 6,8% (target < 5%)')
    day_rows = rows[-sum(len(p[5]) for p in P):]
    for i, c in enumerate(concerns): day_rows[i].append(c)

hdr = ['date', 'area', 'package', 'package_id', 'hint', 'activity', 'unit', 'bq', 'progress', 'manpower', 'concern']
with open('/home/claude/seruni/Seruni_WF_daily_report_SIMULASI.csv', 'w', newline='') as f:
    w = csv.writer(f); w.writerow(hdr)
    for r in rows: w.writerow(r + [''] * (len(hdr) - len(r)))
with open('/home/claude/seruni/Seruni_WF_baseline_SIMULASI.csv', 'w', newline='') as f:
    w = csv.writer(f); w.writerow(['package', 'start', 'finish'])
    for pid, area, name, hint, delay, acts in P:
        w.writerow([name, min(a[3] for a in acts), max(a[4] for a in acts)])
print(len(rows), 'rows', len(days), 'days')
# overall at today
tot = sum(len(p[5]) for p in P)
print('overall today %.1f' % (sum(cur.values()) / tot))
for pid, *_ , acts in P: print(pid, round(sum(cur[(pid, a[0])] for a in acts) / len(acts), 1))
