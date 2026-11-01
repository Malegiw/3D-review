# Review 3D — by Yan Malegi Diardi

App review desain 3D untuk proyek fasilitas Oil & Gas: **plot plan 2D (PDF) → model 3D dengan motion**, import model kontraktor, **clash detection**, **MTO volume**, dan **deliverable list** per project. Jalan di **iPhone, iPad, Android, dan laptop** (PWA — bisa di-install ke home screen).

**Tampilan:** 3 tema — *Cloud* (terang, default), *Night* (gelap), *Cyberpunk* (neon klasik) — dan bahasa **Indonesia / English**. Ganti lewat tombol ID/EN dan ikon palet di kanan atas; pilihan tersimpan per perangkat.

Tema 2026/27: putih *Cloud Dancer* (Pantone 2026), aksen *Transformative Teal* (WGSN 2026), oranye safety hi-vis sebagai satu-satunya warna aksi, font Archivo (lebar untuk judul), panel kaca di atas tampilan 3D.

## Fitur v0.3

| Modul | Isi |
|---|---|
| **Project grid** | Banyak project, KPI progress, overdue, open clash. Backup / restore project (`.nexus.zip`, termasuk PDF & model). |
| **Deliverable list** | Doc No, title, discipline, type, rev, **status** (Not started → IFR → IFA → IFC/AFC → As-built, On hold), **review code** A/B/C/D, **plan date & actual date**, PIC, remarks. Weighted progress (IFR 60%, IFA 80%, IFC/AFC 100%), overdue otomatis, filter, import CSV (`,` atau `;`, format tanggal dd/mm/yyyy OK), export **XLSX**. |
| **Plot plan → 3D** | Upload PDF plot plan. Garis vektor (rect, circle, polygon, polyline) dibaca otomatis dari PDF CAD, tag equipment (mis. `T-101`) diambil dari teks di dalam outline. Tap outline → pilih kategori (tank, vessel, equipment, building, pipe rack, foundation, paving, bund wall, pit, pipe, fence, existing) → tinggi & elevasi. "Add all similar" untuk outline identik. PDF hasil scan? Trace manual pakai Rect / Circle / Polygon / Line. **Calibrate** skala dari dimensi yang diketahui. |
| **Motion** | Build-up sinematik: blueprint neon → scan beam → objek naik dari tanah sesuai urutan konstruksi → kamera dari plan view ke orbit. Plus 360° orbit dan fly-through viewpoint. **Record ke video** (MP4/WebM). |
| **Convert NWD / DWFx / SKP** | Langsung dari app: upload → GitHub Actions di repo GitHub kamu → GLB otomatis masuk ke 3D Review. NWD/NWC tanpa akun Autodesk. |
| **3D Review** (ala Navisworks) | Federated model (plot plan + beberapa model kontraktor). Model besar digambar per material (BatchedMesh) — 16 ribu objek = ±16 draw call, ringan di HP. Pilih per **Bagian / Komponen / Item** (pipa+tutup, branch, equipment), model tree bertingkat (layer → item → komponen) + cari tag/nomor line, properti dengan **koordinat site asli** (E/N/Elev, origin converter dikembalikan), sumber file, volume solid. **Section box**, **X-ray**, hide/isolate, viewpoints + komentar, offset/rotasi/unit per layer. |
| **Measure** | Snap ke sudut ■ / tepi ▲ / permukaan ●, garis preview, jarak + H / V + ΔE / ΔN, mode **Titik** (koordinat E/N/Elev), mode **Terdekat** (jarak bersih antar dua objek), m / mm, hapus per ukuran, ekspor CSV. |
| **Clash detective** | Hard (dengan toleransi mm: kontak/sentuhan diabaikan, tembus dilaporkan), containment, clearance. Bisa cek di dalam satu model; abaikan dalam satu item (branch/equipment); satu hasil per pasangan komponen. Status workflow, zoom ke clash, export **XLSX**. |
| **MTO** | Per komponen: volume (m³) hanya untuk solid tertutup, luas (m²), berat per material. Equipment & pipa E3D (envelope pejal) = Other, baja = struktur, beton = pondasi/slab/bund. Override per komponen di Properti. Export **XLSX**. |

### Format file

- **Langsung di app:** GLB, glTF (+bin/texture), FBX, OBJ (+MTL), DAE, STL, PLY.
- **Lewat converter (GitHub Actions):** **NWD, NWC** (tanpa Autodesk), **DWFx, DWF, SKP**, RVT, IFC, DWG 3D (via Autodesk APS).
  Format ini closed/proprietary — tidak bisa dibaca langsung di browser, jadi dikonversi ke GLB terkompresi dulu.
- Alternatif cepat: minta kontraktor export **FBX** (Navisworks: *Output → Export Scene → FBX*), SketchUp: *File → Export → 3D Model → glTF/DAE/FBX*.

## Jalankan lokal

```bash
npm install
npm run dev        # buka http://localhost:5173 (atau IP laptop dari HP di Wi-Fi yang sama)
npm test           # unit test: PDF vector, clash, MTO, XLSX
npm run build      # output ke dist/
npm run build:single  # + dist/review3d.html (1 file, offline)
```

## Deploy ke GitHub Pages

1. Buat repo baru di GitHub (mis. `3D-review`), push isi folder ini ke branch `main`.
2. Repo → **Settings → Pages → Source: GitHub Actions**.
3. Workflow `Deploy to GitHub Pages` jalan otomatis tiap push. URL: `https://<username>.github.io/3D-review/`.

### Install di device

- **iPhone / iPad:** buka URL di Safari → Share → **Add to Home Screen**.
- **Android:** Chrome → menu → **Install app**.
- **Laptop:** ikon install di address bar Chrome/Edge.

Data (project, PDF, model) tersimpan **di device masing-masing** (IndexedDB, offline). Pindah device → **Backup** di halaman project, lalu **Restore backup** di device lain.

## Model kontraktor NWD / DWFx / SKP

Tombol **3D Review → Models → Convert NWD · DWFx · SKP** mengirim file ke repo GitHub milikmu (boleh repo yang sama dengan app ini), dikonversi di server GitHub, lalu GLB-nya otomatis masuk ke 3D Review.

| Format | Mesin konversi | Butuh akun Autodesk? |
|---|---|---|
| **.nwd, .nwc** | [nwd-reader](https://github.com/1817716374/nwd-reader) + `tools/nwd2glb` (C++, jalan di runner GitHub). Mesh + primitif silinder/lingkaran E3D/PDMS (pipa, kolom, tangki) | **Tidak** |
| .dwfx, .dwf, .skp, .rvt, .ifc, .nwf | Autodesk APS Model Derivative + svf-utils | Ya (2 secret) |

**Setup sekali** (panduan juga ada di dialog ⚙ di panel Models):

1. Pakai repo app ini (mis. `Malegiw/3D-review`) atau repo lain. Di repo **publik**, file NWD dan GLB bisa diunduh siapa pun — centang *Encrypt uploads* di dialog kalau perlu (token butuh *Secrets: Read & write*).
2. Buat **fine-grained token** (<https://github.com/settings/personal-access-tokens/new>) hanya untuk repo itu: *Contents: Read & write*, *Actions: Read*, *Workflows: Read & write*.
3. Di app: isi repo + token → **Install converter** → **Save**. Selesai untuk NWD/NWC.
4. *(Opsional, untuk DWFx/SKP/RVT/IFC)* <https://aps.autodesk.com/hubs> → Create application → **Traditional Web App** → callback = alamat app → API access *Data Management* + *Model Derivative* → simpan `APS_CLIENT_ID` dan `APS_CLIENT_SECRET` di repo → *Settings → Secrets and variables → Actions*.

Pemakaian: pilih file (≤ 75 MB) → upload ke `models/incoming/` → GitHub Actions mengonversi (build reader pertama kali ±3–5 menit, berikutnya ter-cache) → GLB di `converted/glb/` → app mengunduh dan menambahkannya otomatis. Konversi tetap jalan walau app ditutup.

Hasil uji: file FEED piping 9,6 MB → 14.349 objek, 1,66 juta segitiga, 244 × 28 × 170 m, GLB terkompresi 16 MB, waktu baca < 1 detik.

**Lisensi nwd-reader:** PolyForm Noncommercial 1.0.0 — gratis untuk penggunaan pribadi/non-komersial; penggunaan komersial (termasuk untuk pekerjaan perusahaan) memerlukan lisensi dari pembuatnya. Workflow mengunduh nwd-reader saat dijalankan; kodenya tidak disertakan di repo ini.

Alternatif tanpa converter: Navisworks Manage/Simulate → *Output → Export Scene → FBX* → import FBX langsung.

Lokal: `NWD2GLB=/path/nwd2glb node tools/nwd-convert.mjs file.nwd --out converted` (build nwd-reader + `tools/nwd2glb` dengan CMake), atau `cd tools && APS_CLIENT_ID=… APS_CLIENT_SECRET=… node aps-convert.mjs file.dwfx --out ../converted`.

## Versi 1 file (offline)

`npm run build:single` → `dist/review3d.html`: satu file HTML (CSS, font, app, pdf.js worker, sample) yang bisa dibuka langsung di laptop dengan double-click, tanpa server.

## Struktur

```
src/
  main.js            shell, routing (#home, #p-<id>-<tab>), boot
  core/              db (IndexedDB), domain (status, kategori, material), xlsx writer, backup, UI helpers,
                     theme (Cloud/Night/Cyberpunk), i18n + i18n-id (kamus Bahasa Indonesia)
  engine/            viewer (Three.js), pdf + pdfvector (ekstraksi vektor), plotbuild (2D→3D),
                     motion (build-up, orbit, tour), clash (three-mesh-bvh), mto, loaders
  views/             home, project (overview + docs), plotplan editor, review (3D tools)
  styles/theme.css   token 3 tema; fonts.css (Archivo, JetBrains Mono — subset Latin)
tools/               aps-convert.mjs (APS → SVF → glTF → GLB meshopt), make-sample.mjs
public/              manifest, service worker, icon, pdf.js fonts/wasm, sample PDF & GLB
.github/workflows/   deploy.yml (Pages), convert-models.yml (APS)
```

## Catatan teknis

- Satuan internal meter, Y ke atas, **north = −Z**. Properties menampilkan E / N / Elev.
- Model ber-koordinat besar (UTM): pakai tombol **Centre on origin** di layer, lalu atur offset agar overlay dengan plot plan.
- Hard clash ikut menghitung permukaan yang bersentuhan (seperti Navisworks hard tanpa tolerance). Gunakan *Ignore clashes inside the same layer* untuk kurangi noise.
- Volume MTO akurat untuk solid tertutup. Objek plot plan selain foundation/paving/bund adalah *envelope* (ruang), jadi masuk kategori *Other*.
- iOS membatasi ukuran canvas (~16,7 MP) — render PDF dibatasi 3000 px di HP, 4096 px di laptop.

## Roadmap

1. IFC native di browser (web-ifc) + properti BIM dari SVF (property DB).
2. Sync multi-user (Supabase/Firebase) — komentar & status clash bareng kontraktor.
3. 4D TimeLiner: link deliverable/schedule ke objek 3D, animasi progres konstruksi.
4. Redline markup di viewpoint, export PDF clash report dengan screenshot.
5. Auto-recognition plot plan (AI) dari PDF scan + layer CAD.
6. Compare revisi model kontraktor (added / removed / moved).
7. AR di lapangan (USDZ Quick Look iPad/iPhone, WebXR Android).
8. Build native App Store / Play Store via Capacitor.

---
© 2026 Yan Malegi Diardi. All rights reserved. · Review 3D
