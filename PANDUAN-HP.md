# Menjalankan Vaul hanya dengan HP + GitHub + Vercel

Tidak perlu komputer atau server. Yang dibutuhkan:
- aplikasi wallet di HP (MetaMask, Rabby, atau Coinbase Wallet) dengan jaringan Robinhood Chain,
- akun GitHub (repo ini),
- Vercel yang sudah terhubung ke repo ini.

> ⚠️ Kontrak belum diaudit. Mulai dengan dana kecil.

## Langkah 1: Siapkan 3 akun di wallet HP

Di MetaMask, buat akun tambahan lewat ketuk nama akun → **Add account**.

| Akun | Untuk apa | Isi ETH (Robinhood Chain) |
| --- | --- | --- |
| **Owner** | Deploy dan mengatur kontrak | ±0.002 ETH |
| **Keeper** | Dipakai bot otomatis di GitHub | ±0.01 ETH untuk gas |
| **Treasury** | Menerima 20% fee | tidak perlu |

## Langkah 2: Deploy kontrak dari HP

1. Buka aplikasi wallet → menu **Browser** → buka `https://<domain-vercel-anda>/admin.html`.
2. Pilih akun **Owner** dan pastikan jaringannya **Robinhood Chain**.
3. Ketuk **Connect wallet**.
4. Isi **Keeper address** dengan alamat akun Keeper, dan **Treasury address** dengan alamat akun Treasury.
5. Ketuk **Deploy**, lalu setujui transaksinya satu per satu di wallet (maksimal 6 transaksi kecil).
6. Setelah muncul **Deployed ✓**, ketuk **Copy**. Hasilnya berisi `launcher` dan `startBlock`.

Kalau browser tertutup di tengah jalan, buka lagi halaman Admin dan ketuk Deploy. Proses akan lanjut dari langkah terakhir.

## Langkah 3: Sambungkan website ke kontrak

Di github.com (dari browser HP):
1. Buka repo → file **`config.js`** → ikon pensil (Edit).
2. Isi `launcher: "0x…"` dan `startBlock: …` dengan hasil copy tadi.
3. **Commit changes**. Vercel otomatis deploy ulang dalam 1–2 menit.

## Langkah 4: Daftarkan koleksi NFT

Di halaman Admin (masih pakai akun Owner):
1. Tempel alamat kontrak koleksi NFT di **Collection address**.
2. Ketuk **List collection** dan setujui transaksinya.

Pilih koleksi yang aktif diperdagangkan di OpenSea (Robinhood Chain).

## Langkah 5: Nyalakan keeper (GitHub Actions)

Di github.com → repo → **Settings** → **Secrets and variables** → **Actions**:

**Tab Secrets** → *New repository secret*:
| Name | Value |
| --- | --- |
| `KEEPER_PRIVATE_KEY` | private key akun **Keeper** (MetaMask: ⋮ → Account details → Show private key) |
| `OPENSEA_API_KEY` | API key OpenSea Anda |

**Tab Variables** → *New repository variable*:
| Name | Value |
| --- | --- |
| `LAUNCHER` | alamat Launcher |
| `START_BLOCK` | angka startBlock |
| `DRY_RUN` | `1` untuk percobaan pertama |

Lalu buka tab **Actions** → **keeper** → **Run workflow**. Buka hasil run-nya dan cek log. Kalau aman, ubah variable `DRY_RUN` menjadi `0`.

Setelah itu keeper berjalan otomatis **setiap 30 menit**: harvest fee, membeli NFT floor, dan menjalankan raffle. Snapshot raffle di-commit ke folder `snapshots/`, lalu Vercel ikut menyajikannya.

### Batas dan biaya
- Repo **public**: GitHub Actions gratis tanpa batas.
- Repo **private**: gratis 2.000 menit/bulan. Jadwal 30 menit memakai sekitar 1.500 menit/bulan.
- Jadwal GitHub kadang telat beberapa menit. Itu normal.
- `MAX_CEILING_ETH` (variable, default 0.5): harga maksimal satu NFT yang boleh dibeli.

## Keamanan
- Private key **Owner** tidak pernah ditaruh di mana pun. Owner hanya dipakai lewat wallet HP.
- Akun **Keeper** hanya berisi ETH untuk gas. Kalau key-nya bocor, ganti lewat Admin → **Change keeper**, lalu update secret `KEEPER_PRIVATE_KEY`.
- Jangan pernah mengirim private key lewat chat, termasuk ke AI.
