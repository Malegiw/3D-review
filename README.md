# NEXUS//3D Review — by YMD

App review desain 3D untuk proyek fasilitas Oil & Gas: **plot plan 2D (PDF) → model 3D dengan motion**, import model kontraktor, **clash detection**, **MTO volume**, dan **deliverable list** per project. Jalan di **iPhone, iPad, Android, dan laptop** (PWA — bisa di-install ke home screen), tema cyberpunk.

## Fitur v0.1

| Modul | Isi |
|---|---|
| **Project grid** | Banyak project, KPI progress, overdue, open clash. Backup / restore project (`.nexus.zip`, termasuk PDF & model). |
| **Deliverable list** | Doc No, title, discipline, type, rev, **status** (Not started → IFR → IFA → IFC/AFC → As-built, On hold), **review code** A/B/C/D, **plan date & actual date**, PIC, remarks. Weighted progress (IFR 60%, IFA 80%, IFC/AFC 100%), overdue otomatis, filter, import CSV (`,` atau `;`, format tanggal dd/mm/yyyy OK), export **XLSX**. |
| **Plot plan → 3D** | Upload PDF plot plan. Garis vektor (rect, circle, polygon, polyline) dibaca otomatis dari PDF CAD, tag equipment (mis. `T-101`) diambil dari teks di dalam outline. Tap outline → pilih kategori (tank, vessel, equipment, building, pipe rack, foundation, paving, bund wall, pit, pipe, fence, existing) → tinggi & elevasi. "Add all similar" untuk outline identik. PDF hasil scan? Trace manual pakai Rect / Circle / Polygon / Line. **Calibrate** skala dari dimensi yang diketahui. |
| **Motion** | Build-up sinematik: blueprint neon → scan beam → objek naik dari tanah sesuai urutan konstruksi → kamera dari plan view ke orbit. Plus 360° orbit dan fly-through viewpoint. **Record ke video** (MP4/WebM). |
| **Convert NWD / DWFx / SKP** | Langsung dari app: upload → GitHub Actions + Autodesk APS di repo private kamu → GLB otomatis masuk ke 3D Review. |
| **3D Review** (ala Navisworks) | Federated model (plot plan + beberapa model kontraktor), model tree + search, properties (dimensi, E/N/Elev, volume, luas), **section box**, **measure** (jarak, H, V), **X-ray**, viewpoints + komentar, offset/rotasi/unit per layer. |
| **Clash detective** | Hard, containment, dan clearance (mm). Selection A vs B per layer, status workflow (New → Active → Reviewed → Approved → Resolved), zoom ke clash, export **XLSX** clash report. |
| **MTO** | Volume (m³), luas permukaan (m²), L×W×H, berat per material (density bisa diubah). Klasifikasi otomatis concrete/steel dari nama object, override per object. Flag mesh terbuka. Export **XLSX**. |

### Format file

- **Langsung di app:** GLB, glTF (+bin/texture), FBX, OBJ (+MTL), DAE, STL, PLY.
- **Lewat converter (GitHub Actions + Autodesk APS):** **NWD, NWC, DWFx, DWF, SKP**, RVT, IFC, DWG 3D.
  Format ini closed/proprietary — tidak ada browser yang bisa membacanya langsung, jadi dikonversi ke GLB terkompresi dulu.
- Alternatif cepat: minta kontraktor export **FBX** (Navisworks: *Output → Export Scene → FBX*), SketchUp: *File → Export → 3D Model → glTF/DAE/FBX*.

## Jalankan lokal

```bash
npm install
npm run dev        # buka http://localhost:5173 (atau IP laptop dari HP di Wi-Fi yang sama)
npm test           # unit test: PDF vector, clash, MTO, XLSX
npm run build      # output ke dist/
npm run build:single  # + dist/nexus3d.html (1 file, offline)
```

## Deploy ke GitHub Pages

1. Buat repo baru di GitHub (mis. `nexus3d-review`), push isi folder ini ke branch `main`.
2. Repo → **Settings → Pages → Source: GitHub Actions**.
3. Workflow `Deploy to GitHub Pages` jalan otomatis tiap push. URL: `https://<username>.github.io/nexus3d-review/`.

### Install di device

- **iPhone / iPad:** buka URL di Safari → Share → **Add to Home Screen**.
- **Android:** Chrome → menu → **Install app**.
- **Laptop:** ikon install di address bar Chrome/Edge.

Data (project, PDF, model) tersimpan **di device masing-masing** (IndexedDB, offline). Pindah device → **Backup** di halaman project, lalu **Restore backup** di device lain.

## Model kontraktor NWD / DWFx / SKP

NWD adalah stream biner terkompresi milik Autodesk (`LcUStream`), tidak ada parser open-source — konversinya harus lewat Autodesk.

**Jalur cepat (tanpa setup):** buka di Navisworks Manage/Simulate → *Output → Export Scene → FBX* → import FBX di app. (Navisworks Freedom tidak bisa export.) SketchUp: *File → Export → 3D Model → glTF/DAE/FBX*.

**Konversi langsung dari app (GitHub Actions + Autodesk APS):** tombol **3D Review → Models → Convert NWD · DWFx · SKP**.

Setup sekali (±10 menit), panduannya juga ada di dialog **Model converter** di app:

1. Autodesk: <https://aps.autodesk.com/hubs> → kalau diminta, buat **developer hub** dengan plan **Free** (checkout tetap minta metode pembayaran, tapi tidak ditagih selama di kuota Free) → **Applications → Create application** → tipe **Traditional Web App** (Server-to-Server juga bisa kalau muncul; keduanya mendukung token 2-legged yang dipakai converter) → *Callback URL*: alamat app, mis. `https://malegiw.github.io/3D-review/` (wajib diisi walau tidak dipakai) → *API access*: centang **Data Management** dan **Model Derivative** → catat **Client ID** & **Client Secret** (secret hanya tampil sekali).
2. GitHub: buat repo **PRIVATE** (mis. `nexus3d-converter`, centang *Add a README*). Model PHR/SKK Migas adalah dokumen perusahaan — **jangan** pakai repo publik.
3. Buat **fine-grained token** (<https://github.com/settings/personal-access-tokens/new>) hanya untuk repo itu: *Contents: Read & write*, *Actions: Read*, *Workflows: Read & write* (opsional *Secrets: Read* agar app bisa cek langkah 5).
4. Di app: isi repo + token → **Install converter** (app memasang workflow + script converter ke repo) → **Save**.
5. Repo → **Settings → Secrets and variables → Actions** → tambah `APS_CLIENT_ID` dan `APS_CLIENT_SECRET`.

Pemakaian: pilih file .nwd/.dwfx/.skp/.rvt/.ifc (≤ 75 MB) → app meng-upload ke `models/incoming/` → GitHub Actions menerjemahkan via Autodesk → GLB tersimpan di `converted/glb/` (repo private) → app mengunduh dan menambahkannya ke 3D Review otomatis. Status tampil di panel Models; konversi tetap jalan walau app ditutup dan diambil saat app dibuka lagi. Token GitHub hanya tersimpan di device ini; secret Autodesk hanya ada di GitHub.

File > 75 MB: di GitHub → **Actions → Convert models → Run workflow** → isi *direct download link*, lalu import GLB dari *Artifacts*.

Catatan: file diunggah ke bucket *transient* Autodesk (terhapus otomatis ±24 jam) — pastikan sesuai kebijakan data perusahaan. Opsi `PUBLISH_MODELS=true` (repository variable) menaruh GLB di `public/models` untuk GitHub Pages (**Models → From repository**) — hanya untuk model yang boleh publik.

Lokal juga bisa: `cd tools && npm ci && APS_CLIENT_ID=… APS_CLIENT_SECRET=… node aps-convert.mjs file.nwd --out ../converted`.

## Versi 1 file (offline)

`npm run build:single` → `dist/nexus3d.html`: satu file HTML (CSS, font, app, pdf.js worker, sample) yang bisa dibuka langsung di laptop dengan double-click, tanpa server.

## Struktur

```
src/
  main.js            shell, routing (#home, #p-<id>-<tab>), boot
  core/              db (IndexedDB), domain (status, kategori, material), xlsx writer, backup, UI helpers
  engine/            viewer (Three.js), pdf + pdfvector (ekstraksi vektor), plotbuild (2D→3D),
                     motion (build-up, orbit, tour), clash (three-mesh-bvh), mto, loaders
  views/             home, project (overview + docs), plotplan editor, review (3D tools)
  styles/theme.css   tema cyberpunk
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
© 2026 Yan Malegi Diardi · NEXUS//3D Review
