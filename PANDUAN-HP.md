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

## Langkah 2–3: Deploy kontrak (sudah selesai, 3 Okt 2026)

Kontrak Vaul sudah di-deploy dan semua koleksi di `collections.json` sudah didaftarkan:

| Kontrak | Alamat |
| --- | --- |
| Launcher | `0xc3fcb48dfcc3716cdc57312646046cd01dfaa477` |
| External launcher | `0xfc33e6b4200038984d3f6d5333b690d064294550` |
| Registry | `0x73235cfd5c8ea0a8177ec3f61467c6452613f586` |
| Start block | `78887766` |

Alamat ini sudah terisi di `config.js`. Halaman Admin yang dipakai untuk deploy sudah dihapus dari website. Kalau suatu saat perlu lagi (ganti keeper, daftarkan koleksi baru), halaman itu bisa dikembalikan dari riwayat git (commit "Switch to Vaul's own contracts"), atau lakukan lewat `cast send` ke Registry dengan akun Owner (lihat `DEPLOY.md`).

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

## Card Vaults (koin yang mengumpulkan kartu asli)

Card Vaults memakai ExternalLauncher yang sudah ada, jadi **tidak perlu deploy kontrak baru**. Kartunya adalah kartu graded asli yang disimpan oleh Courtyard dan dijadikan NFT di Polygon. Kategorinya:

| Kategori | Registry key |
| --- | --- |
| Pokémon Cards | `0x4A427aD3bFa8AB3602744ed397c90Aa1c03f2508` |
| One Piece Cards | `0x4CFFE73c164c2059F6055074BdE8021Ab6B84bff` |

**Sekali saja, dari HP:** buka `vaul.app/cards?setup`, sambungkan wallet **Owner**, lalu tekan **List it** untuk tiap kategori (2 transaksi kecil). Setelah itu tombol launch di halaman Cards langsung aktif.

Cara keeper membeli kartu:
- membaca 50 listing termurah Courtyard di OpenSea, lalu memilih yang namanya atau traits-nya cocok dengan kategori (kartu basket dan lainnya dilewati);
- ETH vault diumumkan 1 jam sebelum ditarik (bisa dibatalkan Owner), lalu di-bridge ke Polygon dalam bentuk USDC atau POL, sesuai mata uang listing kartunya;
- pemenang raffle menerima NFT kartu di Polygon, di alamat wallet yang sama. Kartu fisiknya bisa ditebus lewat courtyard.io.

Tidak ada secret baru. `POLYGON_RPC` (variable, opsional) bisa diisi kalau RPC publik bawaan sedang lambat.

## Keamanan
- Private key **Owner** tidak pernah ditaruh di mana pun. Owner hanya dipakai lewat wallet HP.
- Akun **Keeper** hanya berisi ETH untuk gas. Kalau key-nya bocor, panggil `setKeeper(address)` di Registry dengan akun Owner, lalu update secret `KEEPER_PRIVATE_KEY`.
- Owner **tidak bisa** menarik ETH atau NFT dari vault. Ini disengaja.
