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

Card Vaults memakai ExternalLauncher yang sudah ada, jadi **tidak perlu deploy kontrak baru**. Kartunya adalah kartu graded asli (PSA/CGC/BGS) yang disimpan di vault, dalam bentuk NFT. Ada dua sumber:

| Kategori | Sumber | Chain | Registry key |
| --- | --- | --- | --- |
| Pokémon Cards | **Collector Crypt** | Solana | `0xbbd35e1566c79795901E942c62C2c76E7c83babb` |
| One Piece Cards | **Collector Crypt** | Solana | `0x322CdFF4A70f64a58C4222c762c13D7e9aC5a5E3` |
| Pokémon Cards | Courtyard | Polygon | `0x4A427aD3bFa8AB3602744ed397c90Aa1c03f2508` |
| One Piece Cards | Courtyard | Polygon | `0x4CFFE73c164c2059F6055074BdE8021Ab6B84bff` |

Keempat kategori ini **sudah terdaftar** di Registry (5 Okt 2026), jadi tombol launch di halaman Cards sudah aktif. Kalau suatu saat perlu menambah kategori baru, panggil `setCollection(key, true)` di Registry dengan akun Owner (lihat `DEPLOY.md`).

**Untuk Collector Crypt (Solana) keeper butuh wallet Solana:**
1. Buat akun Solana baru khusus keeper (misalnya di Phantom → Add account), lalu ekspor private key-nya.
2. GitHub → Settings → Secrets and variables → Actions → **New repository secret**: `KEEPER_SOLANA_KEY` = private key itu. Wallet ini tidak perlu diisi: keeper sendiri yang mengirim USDC dan sedikit SOL dari vault.
3. Opsional: `COLLECTOR_CRYPT_API_KEY` (diawali `ccsk_`). Minta lewat email ke support@collectorcrypt.com. Tanpa key pun API-nya jalan, key hanya menaikkan batas request 10×.

Cara keeper membeli kartu:
- **Collector Crypt:** lewat API resmi Collector Crypt, keeper memilih kartu graded termurah di kategori itu (saat ini Pokémon mulai ±$12, One Piece mulai ±$20), membayar dengan USDC di Solana, lalu memastikan kartunya masuk ke wallet keeper.
- **Courtyard:** lewat OpenSea, keeper mengecek nama dan traits tiap listing agar kartu kategori lain tidak terbeli.
- ETH vault selalu diumumkan 1 jam sebelum ditarik (bisa dibatalkan Owner), lalu di-bridge ke chain kartunya.
- Pemenang raffle kartu Collector Crypt mengisi alamat Solana di halaman **Giveaways**. Pemenang kartu Courtyard menerima di alamat wallet yang sama di Polygon. Kartu fisiknya bisa ditebus di situs Collector Crypt atau Courtyard.
- Opsi **Burn** tidak tersedia untuk kartu.

## Grail Mode (vault menabung untuk satu kartu incaran)

Koin Grail Mode tidak membeli kartu termurah terus-menerus. Vault-nya menabung sampai cukup untuk **satu grail**, lalu membeli kartu termurah di Collector Crypt yang memenuhi spesifikasi grail itu, dan kartu itu di-raffle ke satu holder. Spesifikasinya ada di `collections.json` (`kind: "grail"`):

| Grail | Spesifikasi | Registry key |
| --- | --- | --- |
| Charizard PSA 10 | Charizard apa saja, PSA 10, harga ≥ $1.000 | `0xfd0B2b59E4b75e2F9C292C0cdA6c37a7e7C59b1d` |
| Luffy Manga Art | Monkey D. Luffy Manga Art, grade 10 | `0x140b9E015c0051a692A41FC6f3a80D61F85C72e2` |
| Shanks OP01-120 PSA 10 | Shanks OP01-120 Romance Dawn, PSA 10 | `0xd3D07F20cB93B4973446cFE33c52c245E3514988` |
| Umbreon 10 | Umbreon apa saja, grade 10, harga ≥ $1.000 | `0x1D95DFceedA6510C8Db434227256471c3375C52B` |

Supaya bisa di-launch, tiap key di atas perlu didaftarkan sekali dengan akun Owner: `setCollection(key, true)` di Registry `0x73235cfd5c8ea0a8177ec3f61467c6452613f586`.

- Harga grail dibaca langsung dari Collector Crypt lewat `/api/grails` dan diperbarui tiap beberapa menit. Halaman koin menampilkan progresnya, misalnya "64% to grail".
- `ceilingEth` per grail (3 / 1 / 4 / 3 ETH) menggantikan `MAX_CEILING_ETH` khusus grail itu, karena grail bisa lebih mahal dari batas biasa. Penarikan dana tetap diumumkan 1 jam sebelumnya dan bisa dibatalkan Owner.
- Kalau tidak ada kartu yang memenuhi spesifikasi sedang dijual, vault tetap menabung dan menunggu.

## $VAUL Sweep Hook (Uniswap v4)

Hook Uniswap v4 untuk satu pool ETH/$VAUL di Robinhood Chain. Selain fee LP 0,3%, setiap swap di pool ini membayar **1%**:
- **Buy $VAUL:** 1% diambil dalam $VAUL lalu dikirim ke alamat dead (**dibakar**).
- **Sell $VAUL:** 1% diambil dalam ETH lalu dikirim ke **vault kartu** (Pokémon dari Collector Crypt) yang di-raffle ke **holder $VAUL**.

Fee, token, vault, dan pool dikunci di kontrak, jadi tidak ada yang bisa mengubah atau mengalihkannya. Kontraknya sudah dites di fork mainnet terhadap PoolManager Uniswap v4 dan token $VAUL yang asli.

| | Alamat |
| --- | --- |
| Uniswap v4 PoolManager | `0x8366a39CC670B4001A1121B8F6A443A643e40951` |
| Sweep Hook | `0x7898b3113bb01bF380118481e623A27B4A2EE044` |
| Vault kartu holder $VAUL | `0x69Ca559436CbcAf34aA35D65a6d0Bcd413653DBE` |

**Cara deploy dari HP** (wallet **Owner** `0xc109…8C97`): buka `vaul.app/cards?setup`, lalu di bagian **$VAUL Sweep Hook** tekan tombol berurutan:
1. **Deploy** vault kartu (vault dibuat dan langsung diatur dalam 1 transaksi).
2. **Deploy** Sweep Hook.
3. **Create pool**: membuat pool ETH/$VAUL dengan harga yang sama dengan pool Pons saat itu. Sebelum mengirim, kamu akan diminta mengonfirmasi harganya.

**Setelah itu, tambahkan likuiditas.** Hook hanya menghasilkan burn dan kartu kalau orang trading di pool ini, jadi pool perlu likuiditas yang cukup. Caranya: Uniswap → Pool → New position → **v4** → ETH / $VAUL → fee **0,3%** → isi hook `0x7898b3113bb01bF380118481e623A27B4A2EE044`. Likuiditas yang kamu tambahkan tetap milikmu dalam bentuk NFT posisi Uniswap, dan kamu juga mendapat fee LP 0,3%.

Supaya vault bisa membeli kartu, keeper membutuhkan `KEEPER_SOLANA_KEY` (lihat bagian Collector Crypt). Raffle-nya otomatis memakai snapshot holder $VAUL, tanpa memasukkan alamat dead, pool, dan kontrak lain.

## Keamanan
- Private key **Owner** tidak pernah ditaruh di mana pun. Owner hanya dipakai lewat wallet HP.
- Akun **Keeper** hanya berisi ETH untuk gas. Kalau key-nya bocor, panggil `setKeeper(address)` di Registry dengan akun Owner, lalu update secret `KEEPER_PRIVATE_KEY`.
- Owner **tidak bisa** menarik ETH atau NFT dari vault. Ini disengaja.
