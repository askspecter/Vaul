# Memasang kontrak Vaul sendiri (cukup HP + GitHub + Vercel)

Website Vaul tidak lagi memakai kontrak Olka. Setelah langkah di bawah, semua kontrak (Registry, Launcher, vault, fee router, raffle) milik Anda, dan 20% fee protokol masuk ke wallet treasury Anda.

Yang dibutuhkan:
- aplikasi wallet di HP (MetaMask, Rabby, atau Coinbase Wallet) dengan jaringan Robinhood Chain,
- akun GitHub (repo ini),
- Vercel yang sudah terhubung ke repo ini.

> ⚠️ Kontrak belum diaudit. Mulai dengan dana kecil.
> **Jangan pernah mengirim private key lewat chat, termasuk ke AI.**

## Langkah 1: Siapkan 3 akun di wallet HP

Di MetaMask, buat akun tambahan lewat ketuk nama akun → **Add account**.

| Akun | Untuk apa | Isi ETH (Robinhood Chain) |
| --- | --- | --- |
| **Owner** | Deploy dan mengatur kontrak | ±0.005 ETH (deploy + mendaftarkan ±440 koleksi) |
| **Keeper** | Dipakai bot otomatis di GitHub | ±0.01 ETH untuk gas |
| **Treasury** | Menerima 20% fee | tidak perlu |

## Langkah 2: Deploy kontrak dari halaman Admin

1. Buka aplikasi wallet → menu **Browser** → buka `https://<domain-vercel-anda>/admin`.
2. Pilih akun **Owner**, pastikan jaringannya **Robinhood Chain**, lalu ketuk **Connect wallet**.
3. **Kartu 1 – Deploy contracts:** isi **Keeper address** (alamat akun Keeper) dan **Treasury address** (alamat akun Treasury), ketuk **Deploy**, lalu setujui transaksinya satu per satu (6 transaksi kecil). Setelah muncul **Deployed ✓**, salin teks yang muncul (`launcher` dan `startBlock`).
4. **Kartu 3 – Other chains:** ketuk **Deploy other-chain contracts** (2 transaksi). Salin `externalLauncher` yang muncul.
5. **Kartu 5 – List every collection:** ketuk **List all** dan setujui transaksinya (±16 transaksi). Ini mendaftarkan semua koleksi di `collections.json` ke Registry Anda, supaya bisa dipilih saat launch.

Semua langkah tersimpan di browser. Kalau terputus di tengah jalan, buka lagi halaman Admin dan ketuk tombol yang sama: proses lanjut dari langkah terakhir.

## Langkah 3: Sambungkan website ke kontrak Vaul

Di github.com (dari browser HP):
1. Buka repo → file **`config.js`** → ikon pensil (Edit).
2. Isi tiga baris ini dengan hasil salinan tadi:
   ```js
   launcher: "0x…",
   startBlock: 12345678,
   externalLauncher: "0x…",
   ```
3. **Commit changes**. Vercel otomatis deploy ulang dalam 1–2 menit.

Website dan fungsi API (`/api/launches`, `/api/video`) membaca alamat dari file yang sama, jadi tidak ada tempat lain yang perlu diubah. Daftar koin di KV otomatis dipisah per kontrak, jadi mulai dari kosong.

## Langkah 4: Nyalakan keeper (GitHub Actions)

Di github.com → repo → **Settings** → **Secrets and variables** → **Actions**:

**Tab Secrets** → *New repository secret*:
| Name | Value |
| --- | --- |
| `KEEPER_PRIVATE_KEY` | private key akun **Keeper** (MetaMask: ⋮ → Account details → Show private key) |
| `OPENSEA_API_KEY` | API key OpenSea (boleh kosong) |

**Tab Variables** → *New repository variable*:
| Name | Value |
| --- | --- |
| `LAUNCHER` | alamat `launcher` |
| `START_BLOCK` | angka `startBlock` |
| `EXTERNAL_LAUNCHER` | alamat `externalLauncher` |

Keeper tidak akan berjalan sebelum `LAUNCHER` diisi. Setelah diisi: tab **Actions** → **keeper** → **Run workflow**, centang **dry_run** untuk percobaan pertama, lalu cek log-nya. Setelah itu keeper berjalan otomatis **setiap 30 menit**: harvest fee, membeli NFT floor, dan menjalankan raffle.

### Batas dan biaya
- Repo **public**: GitHub Actions gratis tanpa batas.
- Repo **private**: gratis 2.000 menit/bulan. Jadwal 30 menit memakai sekitar 1.500 menit/bulan.
- `MAX_CEILING_ETH` (variable, default 0.5): harga maksimal satu NFT yang boleh dibeli.

## Langkah 5: Cek

- [ ] Halaman **Docs** → bagian Contracts menampilkan Launcher, Registry, Treasury dan Keeper milik Anda.
- [ ] Launch 1 koin percobaan, lalu cek muncul di **Coins**.

## Keamanan
- Private key **Owner** tidak pernah ditaruh di mana pun. Owner hanya dipakai lewat wallet HP.
- Akun **Keeper** hanya berisi ETH untuk gas. Kalau key-nya bocor, ganti lewat Admin → **Change keeper**, lalu update secret `KEEPER_PRIVATE_KEY`.
- Owner **tidak bisa** menarik ETH atau NFT dari vault. Ini disengaja.
