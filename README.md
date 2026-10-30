# NEXUS//3D Review — by YMD

App review desain 3D untuk proyek fasilitas Oil & Gas: **plot plan 2D (PDF) → model 3D dengan motion**, import model kontraktor, **clash detection**, **MTO volume**, dan **deliverable list** per project. Jalan di **iPhone, iPad, Android, dan laptop** (PWA — bisa di-install ke home screen), tema cyberpunk.

## Fitur v0.1

| Modul | Isi |
|---|---|
| **Project grid** | Banyak project, KPI progress, overdue, open clash. Backup / restore project (`.nexus.zip`, termasuk PDF & model). |
| **Deliverable list** | Doc No, title, discipline, type, rev, **status** (Not started → IFR → IFA → IFC/AFC → As-built, On hold), **review code** A/B/C/D, **plan date & actual date**, PIC, remarks. Weighted progress (IFR 60%, IFA 80%, IFC/AFC 100%), overdue otomatis, filter, import CSV (`,` atau `;`, format tanggal dd/mm/yyyy OK), export **XLSX**. |
| **Plot plan → 3D** | Upload PDF plot plan. Garis vektor (rect, circle, polygon, polyline) dibaca otomatis dari PDF CAD, tag equipment (mis. `T-101`) diambil dari teks di dalam outline. Tap outline → pilih kategori (tank, vessel, equipment, building, pipe rack, foundation, paving, bund wall, pit, pipe, fence, existing) → tinggi & elevasi. "Add all similar" untuk outline identik. PDF hasil scan? Trace manual pakai Rect / Circle / Polygon / Line. **Calibrate** skala dari dimensi yang diketahui. |
| **Motion** | Build-up sinematik: blueprint neon → scan beam → objek naik dari tanah sesuai urutan konstruksi → kamera dari plan view ke orbit. Plus 360° orbit dan fly-through viewpoint. **Record ke video** (MP4/WebM). |
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

## Converter NWD / DWFx / SKP (sekali setup)

1. Daftar gratis di <https://aps.autodesk.com> → buat **Application** → catat **Client ID** & **Client Secret**. Model Derivative masuk kuota Free tier APS; pemakaian di atas kuota bulanan perlu paket berbayar.
2. Repo GitHub → **Settings → Secrets and variables → Actions** → tambah `APS_CLIENT_ID` dan `APS_CLIENT_SECRET`.
3. Pakai:
   - File ≤ 100 MB: commit ke `models/incoming/` → workflow **Convert models** jalan → GLB muncul di `public/models/` + `index.json` → app ter-deploy ulang.
   - File besar: **Actions → Convert models → Run workflow** → isi *direct download link*.
4. Di app: **3D Review → Models → From repository** → pilih model.

Lokal juga bisa: `cd tools && npm ci && APS_CLIENT_ID=… APS_CLIENT_SECRET=… node aps-convert.mjs file.nwd --out ../public/models`.

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
