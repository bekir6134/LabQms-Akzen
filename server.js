require('dotenv').config();
const express = require('express');
const nodemailer = require('nodemailer');
const https = require('https');
const aws4  = require('aws4');

const R2_BUCKET   = process.env.R2_BUCKET_NAME || 'labqms-pdfs';
const R2_ACCOUNT  = process.env.R2_ACCOUNT_ID  || '';
const R2_HOST     = `${R2_ACCOUNT}.r2.cloudflarestorage.com`;

function r2Request(method, key, body) {
    return new Promise((resolve, reject) => {
        const encodedKey = key.split('/').map(encodeURIComponent).join('/');
        const opts = aws4.sign({
            service:  's3',
            region:   'auto',
            method,
            host:     R2_HOST,
            path:     `/${R2_BUCKET}/${encodedKey}`,
            headers:  body ? { 'Content-Type': 'application/pdf', 'Content-Length': body.length } : {},
            body
        }, {
            accessKeyId:     process.env.R2_ACCESS_KEY_ID,
            secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
        });

        const req = https.request({
            hostname: R2_HOST,
            path:     `/${R2_BUCKET}/${encodedKey}`,
            method,
            headers:  opts.headers
        }, res => {
            const chunks = [];
            res.on('data', c => chunks.push(c));
            res.on('end', () => {
                if(res.statusCode >= 300) {
                    reject(new Error(`R2 HTTP ${res.statusCode}: ${Buffer.concat(chunks).toString()}`));
                } else {
                    resolve(Buffer.concat(chunks));
                }
            });
        });
        req.on('error', reject);
        if(body) req.write(body);
        req.end();
    });
}

async function r2Yukle(key, buffer) {
    await r2Request('PUT', key, buffer);
    return key;
}

async function r2Indir(key) {
    return await r2Request('GET', key, null);
}
const puppeteer = require('puppeteer-core');
const QRCode    = require('qrcode');

function chromiumExecPath() {
    if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
    const candidates = [
        '/nix/var/nix/profiles/default/bin/chromium',
        '/run/current-system/sw/bin/chromium',
        '/usr/bin/chromium',
        '/usr/bin/chromium-browser',
        '/usr/bin/google-chrome',
        '/usr/bin/google-chrome-stable',
    ];
    const found = candidates.find(p => { try { require('fs').accessSync(p); return true; } catch(e) { return false; } });
    if (found) return found;
    try { return require('child_process').execSync('which chromium || which chromium-browser || which google-chrome 2>/dev/null', { timeout: 3000 }).toString().trim(); }
    catch(e) { return 'chromium'; }
}
const { PDFDocument, StandardFonts, rgb, degrees } = require('pdf-lib');
const { Pool } = require('pg');
const path = require('path');
const cors = require('cors');

const app = express(); // İŞTE HATAYA SEBEP OLAN EKSİK SATIR BUYDU!
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: "100mb" }));
app.use(express.urlencoded({ extended: true, limit: "100mb" }));
app.use(express.static(path.join(__dirname, 'public'))); 

// Neon.tech PostgreSQL Bağlantısı
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

// TEST YOLU
// Test: ölçüm PDF footer - ?id=SERTIFIKA_ID ile çağır
app.get('/api/test-footer', async (req, res) => {
    let browser;
    try {
        const id = req.params.id || req.query.id;
        if (!id) return res.status(400).send('?id=SERTIFIKA_ID parametresi gerekli');

        const row = await pool.query('SELECT olcum_pdf_url FROM sertifikalar WHERE id=$1', [id]);
        if (!row.rows.length || !row.rows[0].olcum_pdf_url)
            return res.status(404).send('Ölçüm PDF bulunamadı');

        const olcumBytes = Buffer.from(row.rows[0].olcum_pdf_url, 'base64');

        const ayarRows = await pool.query('SELECT anahtar, deger FROM ayarlar');
        const ayar = ayarRows.rows.reduce((o, r) => { o[r.anahtar] = r.deger; return o; }, {});
        const labAdi   = ayar.lab_adi   || 'LAB ADI';
        const labAdres = ayar.adres     || '';
        const labTel   = ayar.telefon   || '';
        const labWeb   = ayar.website   || '';
        const labMail  = ayar.email     || '';

        browser = await puppeteer.launch({
            executablePath: chromiumExecPath(),
            headless: 'new',
            args: ['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage','--disable-gpu','--no-zygote','--single-process'],
        });

        const footerHtml = `<!DOCTYPE html><html><head><meta charset="UTF-8">
        <style>*{margin:0;padding:0;box-sizing:border-box}
        body{width:794px;height:72px;background:white;font-family:Arial,sans-serif;padding:4px 15px 2px}
        .line1{border-top:0.6px solid #aaa;padding-top:3px;display:flex;justify-content:space-between;font-size:7px;color:#555}
        .line2{border-top:0.3px solid #ccc;margin-top:3px;padding-top:2px;font-size:6px;color:#555;line-height:1.45}
        </style></head><body>
        <div class="line1"><span>${labAdi}  ${labAdres}</span><span>${[labTel?'Tel: '+labTel:'',labWeb,labMail].filter(Boolean).join('  |  ')}</span></div>
        <div class="line2">
          Bu sertifika, laboratuvarin yazili izni olmadan kismen kopyalanip cogaltilamaz. | Imzasiz ve TURKAK Dogrulama Kare Kodu bulunmayan sertifikalar gecersizdir.<br>
          Bu sertifikanin kullanimindan once asist.turkak.org.tr uzerinden kare kodu okutarak dogrulayiniz.<br>
          This certificate shall not be reproduced other than in full except with the permission of the laboratory. | Certificates unsigned or without TURKAK QR code are invalid.<br>
          Before using this certificate, verify it by scanning the QR code via asist.turkak.org.tr.
        </div></body></html>`;

        const footerPage = await browser.newPage();
        await footerPage.setViewport({ width: 794, height: 72 });
        await footerPage.setContent(footerHtml, { waitUntil: 'networkidle0' });
        const footerBuffer = await footerPage.pdf({
            width: '794px', height: '72px',
            margin: { top: '0', right: '0', bottom: '0', left: '0' },
            printBackground: true,
        });
        await browser.close(); browser = null;

        const { PDFDocument } = require('pdf-lib');
        const sonDoc = await PDFDocument.create();
        const [embFooter] = await sonDoc.embedPdf(footerBuffer, [0]);
        const embOlcumPages = await sonDoc.embedPdf(olcumBytes);
        const pageW = 595.28, pageH = 841.89;
        const footerH = 72 * (pageH / 1122.52);

        for (const embOlcum of embOlcumPages) {
            const pg = sonDoc.addPage([pageW, pageH]);
            const { width: oW, height: oH } = embOlcum;
            const scale = Math.min(pageW / oW, (pageH - footerH) / oH);
            pg.drawPage(embOlcum, { x: (pageW - oW*scale)/2, y: footerH, width: oW*scale, height: oH*scale });
            pg.drawPage(embFooter, { x: 0, y: 0, width: pageW, height: footerH });
        }

        const pdfBytes = await sonDoc.save();
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', 'inline; filename="test-footer.pdf"');
        res.send(Buffer.from(pdfBytes));
    } catch(err) {
        if(browser) try { await browser.close(); } catch(e) {}
        res.status(500).send('HATA: ' + err.message + '\n' + err.stack);
    }
});

app.get('/api/test', async (req, res) => {
    try {
        const result = await pool.query('SELECT NOW()');
        res.json({ success: true, message: "Bağlantı Başarılı!", time: result.rows[0].now });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- KATEGORİ YÖNETİMİ API ---

// 1. Tüm Kategorileri Getir
app.get('/api/kategoriler', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM kategoriler ORDER BY kategori_adi ASC');
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 2. Yeni Kategori Ekle
app.post('/api/kategoriler', async (req, res) => {
    try {
        const { kategori_adi } = req.body;
        const result = await pool.query(
            'INSERT INTO kategoriler (kategori_adi) VALUES ($1) RETURNING *',
            [kategori_adi]
        );
        res.json(result.rows[0]);
    } catch (err) {
        if (err.code === '23505') { // Benzersizlik hatası
            return res.status(400).json({ error: "Bu kategori zaten mevcut." });
        }
        res.status(500).json({ error: err.message });
    }
});

// 3. Kategori Güncelle
app.put('/api/kategoriler/:id', async (req, res) => {
    try {
        const { kategori_adi } = req.body;
        const result = await pool.query('UPDATE kategoriler SET kategori_adi=$1 WHERE id=$2 RETURNING *', [kategori_adi, req.params.id]);
        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 4. Kategori Sil
app.delete('/api/kategoriler/:id', async (req, res) => {
    try {
        const { id } = req.params;
        await pool.query('DELETE FROM kategoriler WHERE id = $1', [id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- TALİMATLAR (PROSEDÜR) API ---

app.get('/api/talimatlar', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM talimatlar ORDER BY talimat_kodu ASC');
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/talimatlar', async (req, res) => {
    try {
        const { talimat_adi, talimat_kodu, olcme_araligi } = req.body;
        const result = await pool.query(
            'INSERT INTO talimatlar (talimat_adi, talimat_kodu, olcme_araligi) VALUES ($1, $2, $3) RETURNING *',
            [talimat_adi, talimat_kodu, olcme_araligi]
        );
        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/talimatlar/:id', async (req, res) => {
    try {
        const { talimat_adi, talimat_kodu, olcme_araligi } = req.body;
        const result = await pool.query(
            'UPDATE talimatlar SET talimat_adi=$1, talimat_kodu=$2, olcme_araligi=$3 WHERE id=$4 RETURNING *',
            [talimat_adi, talimat_kodu, olcme_araligi, req.params.id]
        );
        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/talimatlar/:id', async (req, res) => {
    try {
        await pool.query('DELETE FROM talimatlar WHERE id=$1', [req.params.id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- REFERANS CİHAZLAR API GRUBU ---

// Tüm cihazları listele (Son işlem bilgisiyle beraber)
app.get('/api/referans-cihazlar', async (req, res) => {
    try {
        const query = `
            SELECT rc.*, k.kategori_adi, rt.sertifika_no, rt.sonraki_kal_tarihi
            FROM referans_cihazlar rc
            LEFT JOIN kategoriler k ON rc.kategori_id = k.id
            LEFT JOIN (
                SELECT DISTINCT ON (referans_id) * FROM referans_takip 
                ORDER BY referans_id, kal_tarihi DESC
            ) rt ON rc.id = rt.referans_id
            ORDER BY rc.id DESC`;
        const result = await pool.query(query);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Yeni Referans Cihaz Kaydet (Sabit Veriler)
app.post('/api/referans-cihazlar', async (req, res) => {
    try {
        const { kategori_id, cihaz_adi, marka, model, seri_no, envanter_no, olcme_araligi, kalibrasyon_kriteri, ara_kontrol_kriteri } = req.body;
        const query = `INSERT INTO referans_cihazlar (kategori_id, cihaz_adi, marka, model, seri_no, envanter_no, olcme_araligi, kalibrasyon_kriteri, ara_kontrol_kriteri) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`;
        const result = await pool.query(query, [kategori_id, cihaz_adi, marka, model, seri_no, envanter_no, olcme_araligi, kalibrasyon_kriteri, ara_kontrol_kriteri]);
        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// TOPLU EXCEL İMPORT
app.post('/api/referans-cihazlar-toplu', async (req, res) => {
    try {
        const { cihazlar } = req.body; // array
        if (!Array.isArray(cihazlar) || !cihazlar.length) return res.status(400).json({ error: 'Veri yok' });

        // Tüm kategorileri çek (isimle eşleştirme için)
        // NOT: SQL LOWER() yerine JS toLowerCase() kullanıyoruz —
        // PostgreSQL Türkçe locale'de LOWER('I')='ı' ama JS 'I'.toLowerCase()='i' — tutarsızlık!
        const katRes = await pool.query('SELECT id, kategori_adi FROM kategoriler');
        const normalize = s => (s || '').replace(/\s+/g, ' ').trim().toLowerCase();
        const katMap = {};
        katRes.rows.forEach(k => { katMap[normalize(k.kategori_adi)] = k.id; });

        let basarili = 0, hatali = 0, hatalar = [];
        const kategoriEslesmedi = new Set();

        for (const c of cihazlar) {
            try {
                if (!c.cihaz_adi) { hatali++; hatalar.push(`Satır atlandı: cihaz adı boş`); continue; }
                const katAd = normalize(c.kategori_adi);
                let kategori_id = katAd ? (katMap[katAd] || null) : null;
                if (katAd && !kategori_id) kategoriEslesmedi.add(c.kategori_adi);

                const ins = await pool.query(
                    `INSERT INTO referans_cihazlar (kategori_id, cihaz_adi, marka, model, seri_no, envanter_no, olcme_araligi, kalibrasyon_kriteri, ara_kontrol_kriteri)
                     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
                    [kategori_id, c.cihaz_adi, c.marka||null, c.model||null, c.seri_no||null, c.envanter_no||null, c.olcme_araligi||null, c.kalibrasyon_kriteri||null, c.ara_kontrol_kriteri||null]
                );
                const refId = ins.rows[0].id;

                // Kalibrasyon takip kaydı (sertifika no veya kal tarihi varsa)
                if (c.sertifika_no || c.kal_tarihi) {
                    await pool.query(
                        `INSERT INTO referans_takip (referans_id, islem_tipi, sertifika_no, izlenebilirlik, kal_tarihi, sonraki_kal_tarihi)
                         VALUES ($1,$2,$3,$4,$5,$6)`,
                        [refId, c.islem_tipi||'kalibrasyon', c.sertifika_no||null, c.izlenebilirlik||null, c.kal_tarihi||null, c.sonraki_kal_tarihi||null]
                    );
                }
                basarili++;
            } catch(e) {
                hatali++;
                hatalar.push(`"${c.cihaz_adi}": ${e.message}`);
            }
        }
        res.json({ basarili, hatali, hatalar, kategoriEslesmedi: [...kategoriEslesmedi] });
    } catch(err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/referans-cihazlar/:id', async (req, res) => {
    try {
        const { kategori_id, cihaz_adi, marka, model, seri_no, envanter_no, olcme_araligi, kalibrasyon_kriteri, ara_kontrol_kriteri } = req.body;
        const query = `UPDATE referans_cihazlar SET kategori_id=$1, cihaz_adi=$2, marka=$3, model=$4, seri_no=$5, envanter_no=$6, olcme_araligi=$7, kalibrasyon_kriteri=$8, ara_kontrol_kriteri=$9 WHERE id=$10 RETURNING *`;
        const result = await pool.query(query, [kategori_id, cihaz_adi, marka, model, seri_no, envanter_no, olcme_araligi, kalibrasyon_kriteri, ara_kontrol_kriteri, req.params.id]);
        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Toplu silme
app.delete('/api/referans-cihazlar-toplu', async (req, res) => {
    try {
        const { ids } = req.body;
        if (!Array.isArray(ids) || !ids.length) return res.status(400).json({ error: 'ID listesi boş' });
        const result = await pool.query('DELETE FROM referans_cihazlar WHERE id = ANY($1::int[])', [ids]);
        res.json({ silindi: result.rowCount });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/referans-cihazlar/:id', async (req, res) => {
    try {
        await pool.query('DELETE FROM referans_cihazlar WHERE id=$1', [req.params.id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/referans-takip', async (req, res) => {
    try {
        const { referans_id, islem_tipi, sertifika_no, izlenebilirlik, kal_tarihi, sonraki_kal_tarihi } = req.body;
        const query = `INSERT INTO referans_takip (referans_id, islem_tipi, sertifika_no, izlenebilirlik, kal_tarihi, sonraki_kal_tarihi) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`;
        const result = await pool.query(query, [referans_id, islem_tipi, sertifika_no, izlenebilirlik, kal_tarihi, sonraki_kal_tarihi]);
        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/referans-takip-guncelle', async (req, res) => {
    try {
        const { id, sertifika_no, izlenebilirlik, kal_tarihi, sonraki_kal_tarihi } = req.body;
        const query = `
            UPDATE referans_takip 
            SET sertifika_no = $2, izlenebilirlik = $3, kal_tarihi = $4, sonraki_kal_tarihi = $5 
            WHERE id = $1 RETURNING *`;
        const result = await pool.query(query, [id, sertifika_no, izlenebilirlik, kal_tarihi, sonraki_kal_tarihi]);
        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Cihazın Tüm Tarihçesini Getir (Tıklayınca açılan kısım için KRİTİK)
app.get('/api/referans-tarihce/:id', async (req, res) => {
    try {
        const { id } = req.params;
        // Sorguya rt.id'yi ekledik
        const query = `SELECT id, islem_tipi, sertifika_no, izlenebilirlik, kal_tarihi, sonraki_kal_tarihi 
                       FROM referans_takip 
                       WHERE referans_id = $1 
                       ORDER BY kal_tarihi DESC`;
        const result = await pool.query(query, [id]);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/metot-yardimci-veriler', async (req, res) => {
    try {
        // Tablo adını 'talimatlar' olarak güncelledik
        const talimatlar = await pool.query('SELECT id, talimat_adi, talimat_kodu FROM talimatlar');
        
        // Referanslar (En güncel SKT ile)
        const referanslar = await pool.query(`
            SELECT rc.id, rc.cihaz_adi, rc.seri_no, rt.sonraki_kal_tarihi
            FROM referans_cihazlar rc
            LEFT JOIN (
                SELECT DISTINCT ON (referans_id) referans_id, sonraki_kal_tarihi 
                FROM referans_takip 
                ORDER BY referans_id, kal_tarihi DESC
            ) rt ON rc.id = rt.referans_id
        `);

        res.json({
            talimatlar: talimatlar.rows,
            referanslar: referanslar.rows
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});


// --- AYARLAR ---
app.get('/api/ayarlar', async (req, res) => {
    try {
        const result = await pool.query('SELECT anahtar, deger FROM ayarlar');
        const ayarlar = {};
        result.rows.forEach(r => ayarlar[r.anahtar] = r.deger);
        res.json(ayarlar);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/ayarlar', async (req, res) => {
    try {
        const ayarlar = req.body;
        for (const [anahtar, deger] of Object.entries(ayarlar)) {
            await pool.query(
                `INSERT INTO ayarlar (anahtar, deger) VALUES ($1, $2)
                 ON CONFLICT (anahtar) DO UPDATE SET deger = $2`,
                [anahtar, deger]
            );
        }
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- DASHBOARD İSTATİSTİKLERİ ---
app.get('/api/dashboard', async (req, res) => {
    try {
        const [referanslar, takvimleri, revizyonlar] = await Promise.all([
            // Referans cihazlar: KALİBRASYON için 30 gün, ARA_KONTROL için 30 gün eşiği
            pool.query(`
                SELECT rc.cihaz_adi, rc.seri_no, rt.sonraki_kal_tarihi, rt.islem_tipi,
                    (rt.sonraki_kal_tarihi - CURRENT_DATE) as kalan_gun
                FROM referans_cihazlar rc
                JOIN (
                    SELECT DISTINCT ON (referans_id) referans_id, sonraki_kal_tarihi, islem_tipi
                    FROM referans_takip ORDER BY referans_id, kal_tarihi DESC
                ) rt ON rc.id = rt.referans_id
                WHERE rt.sonraki_kal_tarihi <= CURRENT_DATE + INTERVAL '30 days'
                ORDER BY rt.sonraki_kal_tarihi ASC
                LIMIT 15`),
            // Takvim: yarın başlayacak etkinlikler (1 gün kala bildirimi)
            pool.query(`
                SELECT t.*, p.ad_soyad as atanan_adi
                FROM takvim t
                LEFT JOIN personeller p ON t.atanan_id = p.id
                WHERE t.baslangic = CURRENT_DATE + INTERVAL '1 day'
                ORDER BY t.baslangic ASC`),
            // Son 7 günde revize edilen dokümanlar
            pool.query(`
                SELECT p.baslik, p.dok_no, p.revizyon_no, p.gecerlilik_tarihi as revizyon_tarihi
                FROM kalite_dokuman p
                WHERE p.parent_id IS NULL
                AND p.gecerlilik_tarihi >= CURRENT_DATE - INTERVAL '7 days'
                AND EXISTS (SELECT 1 FROM kalite_dokuman c WHERE c.parent_id = p.id)
                ORDER BY p.gecerlilik_tarihi DESC
                LIMIT 10`)
        ]);
        res.json({
            yaklasan_aktiviteler: referanslar.rows,
            yaklasan_etkinlikler: takvimleri.rows,
            son_revizyonlar: revizyonlar.rows
        });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- TAKVİM ---
app.get('/api/takvim', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT t.*, p.ad_soyad as atanan_adi
            FROM takvim t
            LEFT JOIN personeller p ON t.atanan_id = p.id
            ORDER BY t.baslangic ASC`);
        res.json(result.rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/takvim', async (req, res) => {
    try {
        const { baslik, aciklama, baslangic, bitis, atanan_id, renk, tip } = req.body;
        const result = await pool.query(
            `INSERT INTO takvim (baslik, aciklama, baslangic, bitis, atanan_id, renk, tip, olusturan_id)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
            [baslik, aciklama||'', baslangic, bitis||baslangic, atanan_id||null, renk||'#1E40AF', tip||'genel', null]
        );
        res.json(result.rows[0]);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/takvim/:id', async (req, res) => {
    try {
        const { baslik, aciklama, baslangic, bitis, atanan_id, renk, tip } = req.body;
        const result = await pool.query(
            `UPDATE takvim SET baslik=$1, aciklama=$2, baslangic=$3, bitis=$4, atanan_id=$5, renk=$6, tip=$7 WHERE id=$8 RETURNING *`,
            [baslik, aciklama||'', baslangic, bitis||baslangic, atanan_id||null, renk||'#1E40AF', tip||'genel', req.params.id]
        );
        res.json(result.rows[0]);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/takvim/:id', async (req, res) => {
    try {
        await pool.query('DELETE FROM takvim WHERE id=$1', [req.params.id]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- PERSONEL YÖNETİMİ ---
app.get('/api/personeller', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM personeller ORDER BY id DESC');
        res.json(result.rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/personeller', async (req, res) => {
    try {
        const { ad_soyad, kullanici_adi, sifre, roller, erisimler, varsayilan_onaylayici } = req.body;
        if (varsayilan_onaylayici) {
            await pool.query('UPDATE personeller SET varsayilan_onaylayici = false');
        }
        const result = await pool.query(
            `INSERT INTO personeller (ad_soyad, kullanici_adi, sifre, roller, erisimler, varsayilan_onaylayici)
             VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
            [ad_soyad, kullanici_adi, sifre, JSON.stringify(roller), JSON.stringify(erisimler), varsayilan_onaylayici]
        );
        res.json(result.rows[0]);
    } catch (err) {
        if (err.code === '23505') return res.status(400).json({ error: "Bu kullanıcı adı zaten kullanılıyor!" });
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/personeller/:id', async (req, res) => {
    try {
        const { ad_soyad, kullanici_adi, sifre, roller, erisimler, varsayilan_onaylayici } = req.body;
        if (varsayilan_onaylayici) {
            await pool.query('UPDATE personeller SET varsayilan_onaylayici = false');
        }
        const result = await pool.query(
            `UPDATE personeller SET ad_soyad=$1, kullanici_adi=$2, sifre=$3, roller=$4, erisimler=$5, varsayilan_onaylayici=$6 WHERE id=$7 RETURNING *`,
            [ad_soyad, kullanici_adi, sifre, JSON.stringify(roller), JSON.stringify(erisimler), varsayilan_onaylayici, req.params.id]
        );
        res.json(result.rows[0]);
    } catch (err) {
        if (err.code === '23505') return res.status(400).json({ error: "Bu kullanıcı adı zaten kullanılıyor!" });
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/personeller/:id', async (req, res) => {
    try {
        await pool.query('DELETE FROM personeller WHERE id=$1', [req.params.id]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- GİRİŞ (LOGIN) ---
app.post('/api/login', async (req, res) => {
    try {
        const { kullanici_adi, sifre } = req.body;
        const result = await pool.query(
            'SELECT id, ad_soyad, kullanici_adi, roller, erisimler FROM personeller WHERE kullanici_adi=$1 AND sifre=$2',
            [kullanici_adi, sifre]
        );
        if (result.rows.length > 0) {
            res.json({ success: true, user: result.rows[0] });
        } else {
            res.status(401).json({ success: false, error: "Kullanıcı adı veya şifre hatalı!" });
        }
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── TÜM TABLOLARI OLUŞTUR ───────────────────────────────────────────────────
async function createKaliteTables() {
    const sqls = [
        // TEMEL TABLOLAR
        `CREATE TABLE IF NOT EXISTS kategoriler (
            id SERIAL PRIMARY KEY,
            kategori_adi VARCHAR(200) NOT NULL
        )`,
        `CREATE TABLE IF NOT EXISTS ayarlar (
            id SERIAL PRIMARY KEY,
            anahtar VARCHAR(100) UNIQUE NOT NULL,
            deger TEXT
        )`,
        `CREATE TABLE IF NOT EXISTS personeller (
            id SERIAL PRIMARY KEY,
            ad_soyad VARCHAR(200) NOT NULL,
            kullanici_adi VARCHAR(100) UNIQUE NOT NULL,
            sifre VARCHAR(200) NOT NULL,
            roller JSONB DEFAULT '[]',
            erisimler JSONB DEFAULT '[]',
            varsayilan_onaylayici BOOLEAN DEFAULT false
        )`,
        `CREATE TABLE IF NOT EXISTS takvim (
            id SERIAL PRIMARY KEY,
            baslik VARCHAR(255) NOT NULL,
            aciklama TEXT,
            baslangic DATE NOT NULL,
            bitis DATE,
            atanan_id INTEGER,
            renk VARCHAR(20) DEFAULT '#1E40AF',
            tip VARCHAR(50) DEFAULT 'genel',
            olusturan_id INTEGER
        )`,
        `CREATE TABLE IF NOT EXISTS talimatlar (
            id SERIAL PRIMARY KEY,
            talimat_adi VARCHAR(300) NOT NULL,
            talimat_kodu VARCHAR(100),
            olcme_araligi VARCHAR(200)
        )`,
        `CREATE TABLE IF NOT EXISTS referans_cihazlar (
            id SERIAL PRIMARY KEY,
            kategori_id INTEGER REFERENCES kategoriler(id),
            cihaz_adi VARCHAR(300) NOT NULL,
            marka VARCHAR(200),
            model VARCHAR(200),
            seri_no VARCHAR(200),
            envanter_no VARCHAR(200),
            olcme_araligi VARCHAR(300),
            kalibrasyon_kriteri VARCHAR(300),
            ara_kontrol_kriteri VARCHAR(300)
        )`,
        `CREATE TABLE IF NOT EXISTS referans_takip (
            id SERIAL PRIMARY KEY,
            referans_id INTEGER REFERENCES referans_cihazlar(id) ON DELETE CASCADE,
            islem_tipi VARCHAR(100),
            sertifika_no VARCHAR(200),
            izlenebilirlik TEXT,
            kal_tarihi DATE,
            sonraki_kal_tarihi DATE
        )`,
        `CREATE TABLE IF NOT EXISTS cevre_kosullari (
            id SERIAL PRIMARY KEY,
            kategori_id INTEGER REFERENCES kategoriler(id),
            sicaklik_merkez NUMERIC,
            sicaklik_tolerans NUMERIC,
            nem_merkez NUMERIC,
            nem_tolerans NUMERIC,
            basinc_merkez NUMERIC,
            basinc_tolerans NUMERIC
        )`,
        // KALİTE SİSTEMİ TABLOLARI
        `CREATE TABLE IF NOT EXISTS kalite_dokuman (
            id SERIAL PRIMARY KEY,
            dok_no VARCHAR(50),
            baslik VARCHAR(255) NOT NULL,
            tur VARCHAR(50),
            revizyon_no VARCHAR(20),
            yayin_tarihi DATE,
            gecerlilik_tarihi DATE,
            durum VARCHAR(30) DEFAULT 'taslak',
            sorumlu VARCHAR(100),
            aciklama TEXT,
            olusturma_tarihi TIMESTAMP DEFAULT NOW()
        )`,
        `CREATE TABLE IF NOT EXISTS uygunsuzluk (
            id SERIAL PRIMARY KEY,
            kayit_no VARCHAR(50),
            tarih DATE,
            kaynak VARCHAR(50),
            aciklama TEXT,
            tespit_eden VARCHAR(100),
            durum VARCHAR(30) DEFAULT 'acik',
            kapatis_tarihi DATE,
            olusturma_tarihi TIMESTAMP DEFAULT NOW()
        )`,
        `CREATE TABLE IF NOT EXISTS dof (
            id SERIAL PRIMARY KEY,
            uygunsuzluk_id INTEGER REFERENCES uygunsuzluk(id) ON DELETE CASCADE,
            kok_neden TEXT,
            faaliyet_tanimi TEXT,
            sorumlu VARCHAR(100),
            termin DATE,
            tamamlandi_tarihi DATE,
            sonuc TEXT
        )`,
        `CREATE TABLE IF NOT EXISTS ic_denetim (
            id SERIAL PRIMARY KEY,
            denetim_no VARCHAR(50),
            plan_tarihi DATE,
            tamamlandi_tarihi DATE,
            kapsam TEXT,
            denetci VARCHAR(150),
            durum VARCHAR(30) DEFAULT 'planlandı',
            aciklama TEXT,
            olusturma_tarihi TIMESTAMP DEFAULT NOW()
        )`,
        `CREATE TABLE IF NOT EXISTS ic_denetim_bulgu (
            id SERIAL PRIMARY KEY,
            denetim_id INTEGER REFERENCES ic_denetim(id) ON DELETE CASCADE,
            bulgu_turu VARCHAR(30),
            madde_no VARCHAR(50),
            aciklama TEXT,
            durum VARCHAR(20) DEFAULT 'acik',
            kapanis_tarihi DATE
        )`,
        `CREATE TABLE IF NOT EXISTS risk_kaydi (
            id SERIAL PRIMARY KEY,
            risk_no VARCHAR(50),
            tarih DATE,
            tur VARCHAR(20) DEFAULT 'risk',
            kategori VARCHAR(50),
            tanim TEXT,
            etki SMALLINT,
            olasilik SMALLINT,
            risk_skoru SMALLINT,
            onlem TEXT,
            sorumlu VARCHAR(100),
            termin DATE,
            durum VARCHAR(30) DEFAULT 'acik',
            olusturma_tarihi TIMESTAMP DEFAULT NOW()
        )`,
        `CREATE TABLE IF NOT EXISTS musteri_sikayet (
            id SERIAL PRIMARY KEY,
            sikayet_no VARCHAR(50),
            tarih DATE,
            musteri_id INTEGER,
            musteri_adi VARCHAR(200),
            aciklama TEXT,
            oncelik VARCHAR(20) DEFAULT 'orta',
            durum VARCHAR(30) DEFAULT 'acik',
            kapatis_tarihi DATE,
            sonuc TEXT,
            olusturma_tarihi TIMESTAMP DEFAULT NOW()
        )`,
        `CREATE TABLE IF NOT EXISTS dis_tedarikci (
            id SERIAL PRIMARY KEY,
            firma_adi VARCHAR(200) NOT NULL,
            hizmet_turu VARCHAR(100),
            iletisim VARCHAR(200),
            onay_durumu VARCHAR(30) DEFAULT 'beklemede',
            aciklama TEXT,
            olusturma_tarihi TIMESTAMP DEFAULT NOW()
        )`,
        `CREATE TABLE IF NOT EXISTS dis_tedarikci_degerlendirme (
            id SERIAL PRIMARY KEY,
            tedarikci_id INTEGER REFERENCES dis_tedarikci(id) ON DELETE CASCADE,
            tarih DATE,
            puan SMALLINT,
            degerlendiren VARCHAR(100),
            notlar TEXT
        )`,
        `CREATE TABLE IF NOT EXISTS yeterlilik_testi (
            id SERIAL PRIMARY KEY,
            program_adi VARCHAR(200),
            organizator VARCHAR(200),
            katilim_tarihi DATE,
            parametreler TEXT,
            sonuc VARCHAR(30) DEFAULT 'beklemede',
            z_skoru VARCHAR(50),
            aciklama TEXT,
            olusturma_tarihi TIMESTAMP DEFAULT NOW()
        )`,
        `CREATE TABLE IF NOT EXISTS ygg_toplanti (
            id SERIAL PRIMARY KEY,
            toplanti_no VARCHAR(50),
            tarih DATE,
            katilimcilar TEXT,
            gundem TEXT,
            kararlar TEXT,
            durum VARCHAR(30) DEFAULT 'planlandı',
            bir_sonraki_tarih DATE,
            olusturma_tarihi TIMESTAMP DEFAULT NOW()
        )`,
        `CREATE TABLE IF NOT EXISTS pak (
            id SERIAL PRIMARY KEY,
            konu VARCHAR(500) NOT NULL,
            karsilastirma_tarihi DATE,
            katilimcilar TEXT,
            metot VARCHAR(300),
            sonuc VARCHAR(50) DEFAULT 'beklemede',
            aciklama TEXT,
            olusturma_tarihi TIMESTAMP DEFAULT NOW()
        )`,
        `CREATE TABLE IF NOT EXISTS satin_alma (
            id SERIAL PRIMARY KEY,
            talep_no         VARCHAR(50),
            talep_tarihi     DATE NOT NULL,
            talep_eden       VARCHAR(200),
            tur              VARCHAR(20) NOT NULL DEFAULT 'urun',
            konu             VARCHAR(500) NOT NULL,
            aciklama         TEXT,
            miktar           NUMERIC(10,2),
            birim            VARCHAR(50),
            tahmini_tutar    NUMERIC(12,2),
            para_birimi      VARCHAR(10) DEFAULT 'TRY',
            tedarikci_id     INTEGER REFERENCES dis_tedarikci(id),
            durum            VARCHAR(30) DEFAULT 'talep',
            onay_notu        TEXT,
            onaylayan        VARCHAR(200),
            onay_tarihi      DATE,
            siparis_tarihi   DATE,
            tahmini_teslimat DATE,
            gercek_teslimat  DATE,
            kabul_durumu     VARCHAR(30) DEFAULT 'beklemede',
            kabul_eden       VARCHAR(200),
            kabul_notu       TEXT,
            olusturma_tarihi TIMESTAMP DEFAULT NOW()
        )`,
        `CREATE TABLE IF NOT EXISTS personel_egitim (
            id                SERIAL PRIMARY KEY,
            personel_id       INTEGER REFERENCES personeller(id) ON DELETE CASCADE,
            egitim_adi        VARCHAR(300) NOT NULL,
            egitim_turu       VARCHAR(50),
            kurum             VARCHAR(200),
            tarih             DATE,
            gecerlilik_tarihi DATE,
            sonuc             VARCHAR(30) DEFAULT 'tamamlandi',
            aciklama          TEXT,
            olusturma_tarihi  TIMESTAMP DEFAULT NOW()
        )`
    ];
    for (const sql of sqls) { await pool.query(sql); }
    console.log('✅ Tüm tablolar hazır.');
}

// ── GROQ AI ASISTAN ──
app.post('/api/ai/sor', async (req, res) => {
    const { mesaj, gecmis = [] } = req.body;
    if (!mesaj) return res.status(400).json({ hata: 'Mesaj boş olamaz.' });
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) return res.status(500).json({ hata: 'GROQ_API_KEY tanımlı değil.' });

    const sistem = `Sen LabQMS Pro adlı laboratuvar kalite yönetim sisteminin yapay zeka asistanısın.
Kullanıcılar laboratuvar kalite yönetimi, ISO 17025, kalibrasyon, uygunsuzluk, DÖF (Düzeltici ve Önleyici Faaliyet),
doküman yönetimi, sertifika süreçleri gibi konularda sana soru sorabilir.
Kısa, net ve pratik cevaplar ver. Türkçe konuş.`;

    const mesajlar = [
        { role: 'system', content: sistem },
        ...gecmis.slice(-6),
        { role: 'user', content: mesaj }
    ];

    const body = JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: mesajlar,
        max_tokens: 1024,
        temperature: 0.7
    });

    const options = {
        hostname: 'api.groq.com',
        path: '/openai/v1/chat/completions',
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
            'Content-Length': Buffer.byteLength(body)
        }
    };

    const apiReq = https.request(options, (apiRes) => {
        let data = '';
        apiRes.on('data', chunk => data += chunk);
        apiRes.on('end', () => {
            try {
                const parsed = JSON.parse(data);
                const cevap = parsed.choices?.[0]?.message?.content;
                if (cevap) res.json({ cevap });
                else res.status(500).json({ hata: 'Yanıt alınamadı.', detay: data });
            } catch(e) { res.status(500).json({ hata: 'Parse hatası.' }); }
        });
    });
    apiReq.on('error', e => res.status(500).json({ hata: e.message }));
    apiReq.write(body);
    apiReq.end();
});

app.listen(PORT, async () => {
    console.log(`🚀 Sunucu ${PORT} portunda başarıyla ayağa kalktı.`);
    await createKaliteTables().catch(e => console.error('Tablo oluşturma hatası:', e.message));
    // Türkçe karakter normalizasyonu: "yayında" → "yayinda", "i̇ptal" → "iptal"
    await pool.query(`UPDATE kalite_dokuman SET durum='yayinda' WHERE durum='yayında'`).catch(()=>{});
    await pool.query(`UPDATE kalite_dokuman SET durum='iptal' WHERE durum='i̇ptal'`).catch(()=>{});
    // Revizyon yapısı için parent_id kolonu ekle
    await pool.query(`ALTER TABLE kalite_dokuman ADD COLUMN IF NOT EXISTS parent_id INTEGER REFERENCES kalite_dokuman(id) ON DELETE CASCADE`).catch(()=>{});
    // Uygunsuzluk yeni alanlar
    await pool.query(`ALTER TABLE uygunsuzluk ADD COLUMN IF NOT EXISTS esas_alinan_sart TEXT`).catch(()=>{});
    await pool.query(`ALTER TABLE uygunsuzluk ADD COLUMN IF NOT EXISTS sinif VARCHAR(20)`).catch(()=>{});
    await pool.query(`ALTER TABLE dof ADD COLUMN IF NOT EXISTS kapsam_etki TEXT`).catch(()=>{});
    await pool.query(`ALTER TABLE dof ADD COLUMN IF NOT EXISTS yayilma_etki TEXT`).catch(()=>{});
});

// ─── KALİTE SİSTEMİ API ROTALARI ────────────────────────────────────────────

// --- DOKÜMAN YÖNETİMİ ---
app.get('/api/kalite-dokuman', async (req, res) => {
    try {
        const r = await pool.query(`
            SELECT d.*,
                (SELECT COUNT(*) FROM kalite_dokuman r WHERE r.parent_id = d.id) AS revizyon_sayisi
            FROM kalite_dokuman d
            WHERE d.parent_id IS NULL
            ORDER BY d.olusturma_tarihi DESC`);
        res.json(r.rows);
    } catch(e) { res.status(500).json({ error: e.message }); }
});
app.get('/api/kalite-dokuman/:id/revizyonlar', async (req, res) => {
    try {
        const r = await pool.query(
            'SELECT * FROM kalite_dokuman WHERE parent_id=$1 ORDER BY olusturma_tarihi ASC',
            [req.params.id]
        );
        res.json(r.rows);
    } catch(e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/kalite-dokuman/:id/revize', async (req, res) => {
    try {
        const parent = await pool.query('SELECT * FROM kalite_dokuman WHERE id=$1', [req.params.id]);
        if (!parent.rows.length) return res.status(404).json({ error: 'Doküman bulunamadı' });
        const p = parent.rows[0];
        const { revizyon_no, yayin_tarihi } = req.body;
        // Eski veriyi alt kayıt olarak iptal durumunda kaydet
        await pool.query(
            `INSERT INTO kalite_dokuman (dok_no,baslik,tur,revizyon_no,yayin_tarihi,gecerlilik_tarihi,durum,aciklama,parent_id)
             VALUES ($1,$2,$3,$4,$5,$6,'iptal',$7,$8)`,
            [p.dok_no, p.baslik, p.tur, p.revizyon_no, p.yayin_tarihi||null, p.gecerlilik_tarihi||null, p.aciklama, p.id]
        );
        // Ana kaydı yeni revizyon no ve revizyon tarihiyle güncelle
        const r = await pool.query(
            `UPDATE kalite_dokuman SET revizyon_no=$1, gecerlilik_tarihi=$2 WHERE id=$3 RETURNING *`,
            [revizyon_no, yayin_tarihi||null, p.id]
        );
        res.json(r.rows[0]);
    } catch(e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/kalite-dokuman', async (req, res) => {
    try {
        const { dok_no, baslik, tur, revizyon_no, yayin_tarihi, gecerlilik_tarihi, durum, aciklama } = req.body;
        const r = await pool.query(
            `INSERT INTO kalite_dokuman (dok_no,baslik,tur,revizyon_no,yayin_tarihi,gecerlilik_tarihi,durum,aciklama)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
            [dok_no, baslik, tur, revizyon_no, yayin_tarihi||null, gecerlilik_tarihi||null, durum||'taslak', aciklama]
        );
        res.json(r.rows[0]);
    } catch(e) { res.status(500).json({ error: e.message }); }
});
app.put('/api/kalite-dokuman/:id', async (req, res) => {
    try {
        const { dok_no, baslik, tur, revizyon_no, yayin_tarihi, gecerlilik_tarihi, durum, aciklama } = req.body;
        const r = await pool.query(
            `UPDATE kalite_dokuman SET dok_no=$1,baslik=$2,tur=$3,revizyon_no=$4,yayin_tarihi=$5,gecerlilik_tarihi=$6,durum=$7,aciklama=$8 WHERE id=$9 RETURNING *`,
            [dok_no, baslik, tur, revizyon_no, yayin_tarihi||null, gecerlilik_tarihi||null, durum, aciklama, req.params.id]
        );
        res.json(r.rows[0]);
    } catch(e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/kalite-dokuman-toplu', async (req, res) => {
    try {
        const { kayitlar } = req.body;
        let basarili = 0, hatali = 0, hatalar = [];
        for (const k of kayitlar) {
            try {
                if (!k.baslik) { hatalar.push(`Başlık boş: ${JSON.stringify(k)}`); hatali++; continue; }
                await pool.query(
                    `INSERT INTO kalite_dokuman (dok_no,baslik,tur,revizyon_no,yayin_tarihi,gecerlilik_tarihi,durum,aciklama)
                     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
                    [k.dok_no||null, k.baslik, k.tur||null, k.revizyon_no||null, k.yayin_tarihi||null, k.gecerlilik_tarihi||null, k.durum||'taslak', k.aciklama||null]
                );
                basarili++;
            } catch(e) { hatalar.push(k.baslik + ': ' + e.message); hatali++; }
        }
        res.json({ basarili, hatali, hatalar });
    } catch(e) { res.status(500).json({ error: e.message }); }
});
app.delete('/api/kalite-dokuman-toplu-sil', async (req, res) => {
    try {
        const { ids } = req.body;
        await pool.query('DELETE FROM kalite_dokuman WHERE id=ANY($1)', [ids]);
        res.json({ success: true });
    } catch(e) { res.status(500).json({ error: e.message }); }
});
app.delete('/api/kalite-dokuman/:id', async (req, res) => {
    try {
        await pool.query('DELETE FROM kalite_dokuman WHERE id=$1', [req.params.id]);
        res.json({ success: true });
    } catch(e) { res.status(500).json({ error: e.message }); }
});

// --- UYGUNSUZLUK ---
app.get('/api/uygunsuzluk', async (req, res) => {
    try {
        const r = await pool.query('SELECT * FROM uygunsuzluk ORDER BY olusturma_tarihi DESC');
        res.json(r.rows);
    } catch(e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/uygunsuzluk', async (req, res) => {
    try {
        const { kayit_no, tarih, kaynak, aciklama, tespit_eden, durum, kapatis_tarihi, esas_alinan_sart, sinif } = req.body;
        const r = await pool.query(
            `INSERT INTO uygunsuzluk (kayit_no,tarih,kaynak,aciklama,tespit_eden,durum,kapatis_tarihi,esas_alinan_sart,sinif)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
            [kayit_no, tarih||null, kaynak, aciklama, tespit_eden, durum||'acik', kapatis_tarihi||null, esas_alinan_sart||null, sinif||null]
        );
        res.json(r.rows[0]);
    } catch(e) { res.status(500).json({ error: e.message }); }
});
app.put('/api/uygunsuzluk/:id', async (req, res) => {
    try {
        const { kayit_no, tarih, kaynak, aciklama, tespit_eden, durum, kapatis_tarihi, esas_alinan_sart, sinif } = req.body;
        const r = await pool.query(
            `UPDATE uygunsuzluk SET kayit_no=$1,tarih=$2,kaynak=$3,aciklama=$4,tespit_eden=$5,durum=$6,kapatis_tarihi=$7,esas_alinan_sart=$8,sinif=$9 WHERE id=$10 RETURNING *`,
            [kayit_no, tarih||null, kaynak, aciklama, tespit_eden, durum, kapatis_tarihi||null, esas_alinan_sart||null, sinif||null, req.params.id]
        );
        res.json(r.rows[0]);
    } catch(e) { res.status(500).json({ error: e.message }); }
});
app.delete('/api/uygunsuzluk/:id', async (req, res) => {
    try {
        await pool.query('DELETE FROM uygunsuzluk WHERE id=$1', [req.params.id]);
        res.json({ success: true });
    } catch(e) { res.status(500).json({ error: e.message }); }
});

// --- DÖF ---
app.get('/api/dof/:uygunsuzluk_id', async (req, res) => {
    try {
        const r = await pool.query('SELECT * FROM dof WHERE uygunsuzluk_id=$1 ORDER BY id', [req.params.uygunsuzluk_id]);
        res.json(r.rows);
    } catch(e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/dof', async (req, res) => {
    try {
        const { uygunsuzluk_id, kok_neden, kapsam_etki, yayilma_etki, faaliyet_tanimi, sorumlu, termin, tamamlandi_tarihi, sonuc } = req.body;
        const r = await pool.query(
            `INSERT INTO dof (uygunsuzluk_id,kok_neden,kapsam_etki,yayilma_etki,faaliyet_tanimi,sorumlu,termin,tamamlandi_tarihi,sonuc)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
            [uygunsuzluk_id, kok_neden, kapsam_etki, yayilma_etki, faaliyet_tanimi, sorumlu, termin||null, tamamlandi_tarihi||null, sonuc]
        );
        res.json(r.rows[0]);
    } catch(e) { res.status(500).json({ error: e.message }); }
});
app.put('/api/dof/:id', async (req, res) => {
    try {
        const { kok_neden, kapsam_etki, yayilma_etki, faaliyet_tanimi, sorumlu, termin, tamamlandi_tarihi, sonuc } = req.body;
        const r = await pool.query(
            `UPDATE dof SET kok_neden=$1,kapsam_etki=$2,yayilma_etki=$3,faaliyet_tanimi=$4,sorumlu=$5,termin=$6,tamamlandi_tarihi=$7,sonuc=$8 WHERE id=$9 RETURNING *`,
            [kok_neden, kapsam_etki, yayilma_etki, faaliyet_tanimi, sorumlu, termin||null, tamamlandi_tarihi||null, sonuc, req.params.id]
        );
        res.json(r.rows[0]);
    } catch(e) { res.status(500).json({ error: e.message }); }
});
app.delete('/api/dof/:id', async (req, res) => {
    try {
        await pool.query('DELETE FROM dof WHERE id=$1', [req.params.id]);
        res.json({ success: true });
    } catch(e) { res.status(500).json({ error: e.message }); }
});

// --- İÇ DENETİM ---
app.get('/api/ic-denetim', async (req, res) => {
    try {
        const r = await pool.query('SELECT * FROM ic_denetim ORDER BY olusturma_tarihi DESC');
        res.json(r.rows);
    } catch(e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/ic-denetim', async (req, res) => {
    try {
        const { denetim_no, plan_tarihi, tamamlandi_tarihi, kapsam, denetci, durum, aciklama } = req.body;
        const r = await pool.query(
            `INSERT INTO ic_denetim (denetim_no,plan_tarihi,tamamlandi_tarihi,kapsam,denetci,durum,aciklama)
             VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
            [denetim_no, plan_tarihi||null, tamamlandi_tarihi||null, kapsam, denetci, durum||'planlandı', aciklama]
        );
        res.json(r.rows[0]);
    } catch(e) { res.status(500).json({ error: e.message }); }
});
app.put('/api/ic-denetim/:id', async (req, res) => {
    try {
        const { denetim_no, plan_tarihi, tamamlandi_tarihi, kapsam, denetci, durum, aciklama } = req.body;
        const r = await pool.query(
            `UPDATE ic_denetim SET denetim_no=$1,plan_tarihi=$2,tamamlandi_tarihi=$3,kapsam=$4,denetci=$5,durum=$6,aciklama=$7 WHERE id=$8 RETURNING *`,
            [denetim_no, plan_tarihi||null, tamamlandi_tarihi||null, kapsam, denetci, durum, aciklama, req.params.id]
        );
        res.json(r.rows[0]);
    } catch(e) { res.status(500).json({ error: e.message }); }
});
app.delete('/api/ic-denetim/:id', async (req, res) => {
    try {
        await pool.query('DELETE FROM ic_denetim WHERE id=$1', [req.params.id]);
        res.json({ success: true });
    } catch(e) { res.status(500).json({ error: e.message }); }
});

// --- İÇ DENETİM BULGU ---
app.get('/api/ic-denetim-bulgu/:denetim_id', async (req, res) => {
    try {
        const r = await pool.query('SELECT * FROM ic_denetim_bulgu WHERE denetim_id=$1 ORDER BY id', [req.params.denetim_id]);
        res.json(r.rows);
    } catch(e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/ic-denetim-bulgu', async (req, res) => {
    try {
        const { denetim_id, bulgu_turu, madde_no, aciklama, durum, kapanis_tarihi } = req.body;
        const r = await pool.query(
            `INSERT INTO ic_denetim_bulgu (denetim_id,bulgu_turu,madde_no,aciklama,durum,kapanis_tarihi)
             VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
            [denetim_id, bulgu_turu, madde_no, aciklama, durum||'acik', kapanis_tarihi||null]
        );
        res.json(r.rows[0]);
    } catch(e) { res.status(500).json({ error: e.message }); }
});
app.put('/api/ic-denetim-bulgu/:id', async (req, res) => {
    try {
        const { bulgu_turu, madde_no, aciklama, durum, kapanis_tarihi } = req.body;
        const r = await pool.query(
            `UPDATE ic_denetim_bulgu SET bulgu_turu=$1,madde_no=$2,aciklama=$3,durum=$4,kapanis_tarihi=$5 WHERE id=$6 RETURNING *`,
            [bulgu_turu, madde_no, aciklama, durum, kapanis_tarihi||null, req.params.id]
        );
        res.json(r.rows[0]);
    } catch(e) { res.status(500).json({ error: e.message }); }
});
app.delete('/api/ic-denetim-bulgu/:id', async (req, res) => {
    try {
        await pool.query('DELETE FROM ic_denetim_bulgu WHERE id=$1', [req.params.id]);
        res.json({ success: true });
    } catch(e) { res.status(500).json({ error: e.message }); }
});

// --- RİSK KAYDI ---
app.get('/api/risk-kaydi', async (req, res) => {
    try {
        const r = await pool.query('SELECT * FROM risk_kaydi ORDER BY olusturma_tarihi DESC');
        res.json(r.rows);
    } catch(e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/risk-kaydi', async (req, res) => {
    try {
        const { risk_no, tarih, tur, kategori, tanim, etki, olasilik, onlem, sorumlu, termin, durum } = req.body;
        const skor = (parseInt(etki)||0) * (parseInt(olasilik)||0);
        const r = await pool.query(
            `INSERT INTO risk_kaydi (risk_no,tarih,tur,kategori,tanim,etki,olasilik,risk_skoru,onlem,sorumlu,termin,durum)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
            [risk_no, tarih||null, tur||'risk', kategori, tanim, etki||null, olasilik||null, skor||null, onlem, sorumlu, termin||null, durum||'acik']
        );
        res.json(r.rows[0]);
    } catch(e) { res.status(500).json({ error: e.message }); }
});
app.put('/api/risk-kaydi/:id', async (req, res) => {
    try {
        const { risk_no, tarih, tur, kategori, tanim, etki, olasilik, onlem, sorumlu, termin, durum } = req.body;
        const skor = (parseInt(etki)||0) * (parseInt(olasilik)||0);
        const r = await pool.query(
            `UPDATE risk_kaydi SET risk_no=$1,tarih=$2,tur=$3,kategori=$4,tanim=$5,etki=$6,olasilik=$7,risk_skoru=$8,onlem=$9,sorumlu=$10,termin=$11,durum=$12 WHERE id=$13 RETURNING *`,
            [risk_no, tarih||null, tur||'risk', kategori, tanim, etki||null, olasilik||null, skor||null, onlem, sorumlu, termin||null, durum, req.params.id]
        );
        res.json(r.rows[0]);
    } catch(e) { res.status(500).json({ error: e.message }); }
});
app.delete('/api/risk-kaydi/:id', async (req, res) => {
    try {
        await pool.query('DELETE FROM risk_kaydi WHERE id=$1', [req.params.id]);
        res.json({ success: true });
    } catch(e) { res.status(500).json({ error: e.message }); }
});

// --- MÜŞTERİ ŞİKAYETİ ---
app.get('/api/musteri-sikayet', async (req, res) => {
    try {
        const r = await pool.query('SELECT * FROM musteri_sikayet ORDER BY olusturma_tarihi DESC');
        res.json(r.rows);
    } catch(e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/musteri-sikayet', async (req, res) => {
    try {
        const { sikayet_no, tarih, musteri_id, musteri_adi, aciklama, oncelik, durum, kapatis_tarihi, sonuc } = req.body;
        const r = await pool.query(
            `INSERT INTO musteri_sikayet (sikayet_no,tarih,musteri_id,musteri_adi,aciklama,oncelik,durum,kapatis_tarihi,sonuc)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
            [sikayet_no, tarih||null, musteri_id||null, musteri_adi, aciklama, oncelik||'orta', durum||'acik', kapatis_tarihi||null, sonuc]
        );
        res.json(r.rows[0]);
    } catch(e) { res.status(500).json({ error: e.message }); }
});
app.put('/api/musteri-sikayet/:id', async (req, res) => {
    try {
        const { sikayet_no, tarih, musteri_id, musteri_adi, aciklama, oncelik, durum, kapatis_tarihi, sonuc } = req.body;
        const r = await pool.query(
            `UPDATE musteri_sikayet SET sikayet_no=$1,tarih=$2,musteri_id=$3,musteri_adi=$4,aciklama=$5,oncelik=$6,durum=$7,kapatis_tarihi=$8,sonuc=$9 WHERE id=$10 RETURNING *`,
            [sikayet_no, tarih||null, musteri_id||null, musteri_adi, aciklama, oncelik, durum, kapatis_tarihi||null, sonuc, req.params.id]
        );
        res.json(r.rows[0]);
    } catch(e) { res.status(500).json({ error: e.message }); }
});
app.delete('/api/musteri-sikayet/:id', async (req, res) => {
    try {
        await pool.query('DELETE FROM musteri_sikayet WHERE id=$1', [req.params.id]);
        res.json({ success: true });
    } catch(e) { res.status(500).json({ error: e.message }); }
});

// --- DIŞ TEDARİKÇİ ---
app.get('/api/dis-tedarikci', async (req, res) => {
    try {
        const r = await pool.query('SELECT * FROM dis_tedarikci ORDER BY olusturma_tarihi DESC');
        res.json(r.rows);
    } catch(e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/dis-tedarikci', async (req, res) => {
    try {
        const { firma_adi, hizmet_turu, iletisim, onay_durumu, aciklama } = req.body;
        const r = await pool.query(
            `INSERT INTO dis_tedarikci (firma_adi,hizmet_turu,iletisim,onay_durumu,aciklama) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
            [firma_adi, hizmet_turu, iletisim, onay_durumu||'beklemede', aciklama]
        );
        res.json(r.rows[0]);
    } catch(e) { res.status(500).json({ error: e.message }); }
});
app.put('/api/dis-tedarikci/:id', async (req, res) => {
    try {
        const { firma_adi, hizmet_turu, iletisim, onay_durumu, aciklama } = req.body;
        const r = await pool.query(
            `UPDATE dis_tedarikci SET firma_adi=$1,hizmet_turu=$2,iletisim=$3,onay_durumu=$4,aciklama=$5 WHERE id=$6 RETURNING *`,
            [firma_adi, hizmet_turu, iletisim, onay_durumu, aciklama, req.params.id]
        );
        res.json(r.rows[0]);
    } catch(e) { res.status(500).json({ error: e.message }); }
});
app.delete('/api/dis-tedarikci/:id', async (req, res) => {
    try {
        await pool.query('DELETE FROM dis_tedarikci WHERE id=$1', [req.params.id]);
        res.json({ success: true });
    } catch(e) { res.status(500).json({ error: e.message }); }
});
app.get('/api/dis-tedarikci-degerlendirme/:tedarikci_id', async (req, res) => {
    try {
        const r = await pool.query('SELECT * FROM dis_tedarikci_degerlendirme WHERE tedarikci_id=$1 ORDER BY tarih DESC', [req.params.tedarikci_id]);
        res.json(r.rows);
    } catch(e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/dis-tedarikci-degerlendirme', async (req, res) => {
    try {
        const { tedarikci_id, tarih, puan, degerlendiren, notlar } = req.body;
        const r = await pool.query(
            `INSERT INTO dis_tedarikci_degerlendirme (tedarikci_id,tarih,puan,degerlendiren,notlar) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
            [tedarikci_id, tarih||null, puan||null, degerlendiren, notlar]
        );
        res.json(r.rows[0]);
    } catch(e) { res.status(500).json({ error: e.message }); }
});
app.delete('/api/dis-tedarikci-degerlendirme/:id', async (req, res) => {
    try {
        await pool.query('DELETE FROM dis_tedarikci_degerlendirme WHERE id=$1', [req.params.id]);
        res.json({ success: true });
    } catch(e) { res.status(500).json({ error: e.message }); }
});

// --- YETERLİLİK TESTİ ---
app.get('/api/yeterlilik-testi', async (req, res) => {
    try {
        const r = await pool.query('SELECT * FROM yeterlilik_testi ORDER BY olusturma_tarihi DESC');
        res.json(r.rows);
    } catch(e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/yeterlilik-testi', async (req, res) => {
    try {
        const { program_adi, organizator, katilim_tarihi, parametreler, sonuc, z_skoru, aciklama } = req.body;
        const r = await pool.query(
            `INSERT INTO yeterlilik_testi (program_adi,organizator,katilim_tarihi,parametreler,sonuc,z_skoru,aciklama)
             VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
            [program_adi, organizator, katilim_tarihi||null, parametreler, sonuc||'beklemede', z_skoru, aciklama]
        );
        res.json(r.rows[0]);
    } catch(e) { res.status(500).json({ error: e.message }); }
});
app.put('/api/yeterlilik-testi/:id', async (req, res) => {
    try {
        const { program_adi, organizator, katilim_tarihi, parametreler, sonuc, z_skoru, aciklama } = req.body;
        const r = await pool.query(
            `UPDATE yeterlilik_testi SET program_adi=$1,organizator=$2,katilim_tarihi=$3,parametreler=$4,sonuc=$5,z_skoru=$6,aciklama=$7 WHERE id=$8 RETURNING *`,
            [program_adi, organizator, katilim_tarihi||null, parametreler, sonuc, z_skoru, aciklama, req.params.id]
        );
        res.json(r.rows[0]);
    } catch(e) { res.status(500).json({ error: e.message }); }
});
app.delete('/api/yeterlilik-testi/:id', async (req, res) => {
    try {
        await pool.query('DELETE FROM yeterlilik_testi WHERE id=$1', [req.params.id]);
        res.json({ success: true });
    } catch(e) { res.status(500).json({ error: e.message }); }
});

// --- PERSONEL ARASI KARŞILAŞTIRMA (PAK) ---
app.get('/api/pak', async (req, res) => {
    try {
        const r = await pool.query('SELECT * FROM pak ORDER BY olusturma_tarihi DESC');
        res.json(r.rows);
    } catch(e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/pak', async (req, res) => {
    try {
        const { konu, karsilastirma_tarihi, katilimcilar, metot, sonuc, aciklama } = req.body;
        const r = await pool.query(
            `INSERT INTO pak (konu, karsilastirma_tarihi, katilimcilar, metot, sonuc, aciklama)
             VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
            [konu, karsilastirma_tarihi||null, katilimcilar, metot, sonuc||'beklemede', aciklama]
        );
        res.json(r.rows[0]);
    } catch(e) { res.status(500).json({ error: e.message }); }
});
app.put('/api/pak/:id', async (req, res) => {
    try {
        const { konu, karsilastirma_tarihi, katilimcilar, metot, sonuc, aciklama } = req.body;
        const r = await pool.query(
            `UPDATE pak SET konu=$1, karsilastirma_tarihi=$2, katilimcilar=$3, metot=$4, sonuc=$5, aciklama=$6 WHERE id=$7 RETURNING *`,
            [konu, karsilastirma_tarihi||null, katilimcilar, metot, sonuc, aciklama, req.params.id]
        );
        res.json(r.rows[0]);
    } catch(e) { res.status(500).json({ error: e.message }); }
});
app.delete('/api/pak/:id', async (req, res) => {
    try {
        await pool.query('DELETE FROM pak WHERE id=$1', [req.params.id]);
        res.json({ success: true });
    } catch(e) { res.status(500).json({ error: e.message }); }
});

// --- EĞİTİM & YETERLİLİK KAYITLARI (ISO 17025:2017 §6.2) ---
app.get('/api/egitim/personel-listesi', async (req, res) => {
    try {
        const r = await pool.query('SELECT id, ad_soyad FROM personeller ORDER BY ad_soyad ASC');
        res.json(r.rows);
    } catch(e) { res.status(500).json({ error: e.message }); }
});
app.get('/api/egitim', async (req, res) => {
    try {
        const r = await pool.query(`
            SELECT pe.*, p.ad_soyad
            FROM personel_egitim pe
            LEFT JOIN personeller p ON pe.personel_id = p.id
            ORDER BY pe.olusturma_tarihi DESC`);
        res.json(r.rows);
    } catch(e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/egitim', async (req, res) => {
    try {
        const { personel_id, egitim_adi, egitim_turu, kurum, tarih, gecerlilik_tarihi, sonuc, aciklama } = req.body;
        const r = await pool.query(
            `INSERT INTO personel_egitim (personel_id,egitim_adi,egitim_turu,kurum,tarih,gecerlilik_tarihi,sonuc,aciklama)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
            [personel_id||null, egitim_adi, egitim_turu||null, kurum||null,
             tarih||null, gecerlilik_tarihi||null, sonuc||'tamamlandi', aciklama||null]
        );
        res.json(r.rows[0]);
    } catch(e) { res.status(500).json({ error: e.message }); }
});
app.put('/api/egitim/:id', async (req, res) => {
    try {
        const { personel_id, egitim_adi, egitim_turu, kurum, tarih, gecerlilik_tarihi, sonuc, aciklama } = req.body;
        const r = await pool.query(
            `UPDATE personel_egitim SET personel_id=$1,egitim_adi=$2,egitim_turu=$3,kurum=$4,
             tarih=$5,gecerlilik_tarihi=$6,sonuc=$7,aciklama=$8 WHERE id=$9 RETURNING *`,
            [personel_id||null, egitim_adi, egitim_turu||null, kurum||null,
             tarih||null, gecerlilik_tarihi||null, sonuc||'tamamlandi', aciklama||null, req.params.id]
        );
        res.json(r.rows[0]);
    } catch(e) { res.status(500).json({ error: e.message }); }
});
app.delete('/api/egitim/:id', async (req, res) => {
    try {
        await pool.query('DELETE FROM personel_egitim WHERE id=$1', [req.params.id]);
        res.json({ success: true });
    } catch(e) { res.status(500).json({ error: e.message }); }
});

// --- SATIN ALMA ---
app.get('/api/satin-alma/tedarikci-listesi', async (req, res) => {
    try {
        const r = await pool.query('SELECT id, firma_adi FROM dis_tedarikci ORDER BY firma_adi');
        res.json(r.rows);
    } catch(e) { res.status(500).json({ error: e.message }); }
});
app.get('/api/satin-alma', async (req, res) => {
    try {
        const r = await pool.query(`
            SELECT sa.*, dt.firma_adi as tedarikci_adi
            FROM satin_alma sa
            LEFT JOIN dis_tedarikci dt ON sa.tedarikci_id = dt.id
            ORDER BY sa.olusturma_tarihi DESC`);
        res.json(r.rows);
    } catch(e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/satin-alma', async (req, res) => {
    try {
        const { talep_tarihi, talep_eden, tur, konu, aciklama, miktar, birim,
                tahmini_tutar, para_birimi, tedarikci_id, tahmini_teslimat } = req.body;
        const r = await pool.query(
            `INSERT INTO satin_alma (talep_tarihi,talep_eden,tur,konu,aciklama,miktar,birim,
             tahmini_tutar,para_birimi,tedarikci_id,tahmini_teslimat)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
            [talep_tarihi, talep_eden, tur, konu, aciklama || null, miktar || null, birim || null,
             tahmini_tutar || null, para_birimi || 'TRY', tedarikci_id || null, tahmini_teslimat || null]
        );
        const id = r.rows[0].id;
        const year = new Date().getFullYear();
        const talep_no = `SA-${year}-${String(id).padStart(4, '0')}`;
        await pool.query('UPDATE satin_alma SET talep_no=$1 WHERE id=$2', [talep_no, id]);
        res.json({ id, talep_no });
    } catch(e) { res.status(500).json({ error: e.message }); }
});
app.put('/api/satin-alma/:id', async (req, res) => {
    try {
        const { talep_tarihi, talep_eden, tur, konu, aciklama, miktar, birim,
                tahmini_tutar, para_birimi, tedarikci_id, durum, onay_notu, onaylayan,
                onay_tarihi, siparis_tarihi, tahmini_teslimat, gercek_teslimat,
                kabul_durumu, kabul_eden, kabul_notu } = req.body;
        const r = await pool.query(
            `UPDATE satin_alma SET talep_tarihi=$1,talep_eden=$2,tur=$3,konu=$4,aciklama=$5,
             miktar=$6,birim=$7,tahmini_tutar=$8,para_birimi=$9,tedarikci_id=$10,durum=$11,
             onay_notu=$12,onaylayan=$13,onay_tarihi=$14,siparis_tarihi=$15,
             tahmini_teslimat=$16,gercek_teslimat=$17,kabul_durumu=$18,kabul_eden=$19,kabul_notu=$20
             WHERE id=$21 RETURNING *`,
            [talep_tarihi, talep_eden, tur, konu, aciklama || null, miktar || null, birim || null,
             tahmini_tutar || null, para_birimi || 'TRY', tedarikci_id || null, durum || 'talep',
             onay_notu || null, onaylayan || null, onay_tarihi || null, siparis_tarihi || null,
             tahmini_teslimat || null, gercek_teslimat || null, kabul_durumu || 'beklemede',
             kabul_eden || null, kabul_notu || null, req.params.id]
        );
        res.json(r.rows[0]);
    } catch(e) { res.status(500).json({ error: e.message }); }
});
app.delete('/api/satin-alma/:id', async (req, res) => {
    try {
        await pool.query('DELETE FROM satin_alma WHERE id=$1', [req.params.id]);
        res.json({ success: true });
    } catch(e) { res.status(500).json({ error: e.message }); }
});

// --- YÖNETİMİN GÖZDEN GEÇİRMESİ ---
app.get('/api/ygg-toplanti', async (req, res) => {
    try {
        const r = await pool.query('SELECT * FROM ygg_toplanti ORDER BY olusturma_tarihi DESC');
        res.json(r.rows);
    } catch(e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/ygg-toplanti', async (req, res) => {
    try {
        const { toplanti_no, tarih, katilimcilar, gundem, kararlar, durum, bir_sonraki_tarih } = req.body;
        const r = await pool.query(
            `INSERT INTO ygg_toplanti (toplanti_no,tarih,katilimcilar,gundem,kararlar,durum,bir_sonraki_tarih)
             VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
            [toplanti_no, tarih||null, katilimcilar, gundem, kararlar, durum||'planlandı', bir_sonraki_tarih||null]
        );
        res.json(r.rows[0]);
    } catch(e) { res.status(500).json({ error: e.message }); }
});
app.put('/api/ygg-toplanti/:id', async (req, res) => {
    try {
        const { toplanti_no, tarih, katilimcilar, gundem, kararlar, durum, bir_sonraki_tarih } = req.body;
        const r = await pool.query(
            `UPDATE ygg_toplanti SET toplanti_no=$1,tarih=$2,katilimcilar=$3,gundem=$4,kararlar=$5,durum=$6,bir_sonraki_tarih=$7 WHERE id=$8 RETURNING *`,
            [toplanti_no, tarih||null, katilimcilar, gundem, kararlar, durum, bir_sonraki_tarih||null, req.params.id]
        );
        res.json(r.rows[0]);
    } catch(e) { res.status(500).json({ error: e.message }); }
});
app.delete('/api/ygg-toplanti/:id', async (req, res) => {
    try {
        await pool.query('DELETE FROM ygg_toplanti WHERE id=$1', [req.params.id]);
        res.json({ success: true });
    } catch(e) { res.status(500).json({ error: e.message }); }
});

// --- TÜRKAK API ---
app.post('/api/turkak-token-test', async (req, res) => {
    try {
        const { username, password } = req.body;
        if (!username || !password) 
            return res.status(400).json({ error: "Kullanıcı adı ve şifre zorunludur!" });

        const response = await fetch('https://api.turkak.org.tr/SSO/signin', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ Username: username, Password: password })
        });

        if (!response.ok) 
            return res.status(401).json({ error: "TÜRKAK kullanıcı adı veya şifre hatalı!" });

        const data = await response.json();
        const token = data.Token || data.token;

        if (!token) 
            return res.status(401).json({ error: "Token alınamadı. Bilgilerinizi kontrol edin." });

        // Token'ı geçici olarak sakla (ayarlar tablosuna)
        const zaman = new Date().toLocaleString('tr-TR');
        await pool.query(
            `INSERT INTO ayarlar (anahtar, deger) VALUES ($1, $2)
             ON CONFLICT (anahtar) DO UPDATE SET deger = $2`,
            ['turkak_token', token]
        );
        await pool.query(
            `INSERT INTO ayarlar (anahtar, deger) VALUES ($1, $2)
             ON CONFLICT (anahtar) DO UPDATE SET deger = $2`,
            ['turkak_token_zaman', zaman]
        );

        res.json({ success: true, zaman });
    } catch (err) { 
        res.status(500).json({ error: "TÜRKAK sunucusuna ulaşılamadı: " + err.message }); 
    }
});

// Token yenile (12 saatte bir çağrılır)
app.post('/api/turkak-token-yenile', async (req, res) => {
    try {
        const result = await pool.query(
            "SELECT deger FROM ayarlar WHERE anahtar IN ('turkak_username','turkak_password')"
        );
        const ayarlar = {};
        result.rows.forEach(r => ayarlar[r.anahtar] = r.deger);

        if (!ayarlar.turkak_username || !ayarlar.turkak_password)
            return res.status(400).json({ error: "Türkak bilgileri kayıtlı değil!" });

        const response = await fetch('https://api.turkak.org.tr/SSO/signin', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                Username: ayarlar.turkak_username, 
                Password: ayarlar.turkak_password 
            })
        });

        const rawText = await response.text();

console.log('TÜRKAK token status:', response.status);
console.log('TÜRKAK token raw response:', rawText);

let data;
try {
    data = JSON.parse(rawText);
} catch (e) {
    return res.status(500).json({
        error: `TÜRKAK token cevabı JSON değil. Status: ${response.status}`,
        raw: rawText
    });
}

const token = data.Token || data.token;
        if (!token) return res.status(401).json({ error: "Token yenilenemedi!" });

        const zaman = new Date().toLocaleString('tr-TR');
        await pool.query(
            `INSERT INTO ayarlar (anahtar, deger) VALUES ('turkak_token', $1)
             ON CONFLICT (anahtar) DO UPDATE SET deger = $1`, [token]);
        await pool.query(
            `INSERT INTO ayarlar (anahtar, deger) VALUES ('turkak_token_zaman', $1)
             ON CONFLICT (anahtar) DO UPDATE SET deger = $1`, [zaman]);

        res.json({ success: true, zaman });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Aktif token getir
app.get('/api/turkak-token', async (req, res) => {
    try {
        const result = await pool.query(
            "SELECT deger FROM ayarlar WHERE anahtar='turkak_token'"
        );
        if (!result.rows.length) 
            return res.status(404).json({ error: "Token bulunamadı. Ayarlardan bağlantı kurun." });
        res.json({ token: result.rows[0].deger });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- ÇEVRE KOŞULLARI ---
app.get('/api/cevre-kosullari', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT ck.*, k.kategori_adi
            FROM cevre_kosullari ck
            LEFT JOIN kategoriler k ON ck.kategori_id = k.id
            ORDER BY k.kategori_adi ASC`);
        res.json(result.rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/cevre-kosullari/kategori/:kategori_id', async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT ck.*, k.kategori_adi FROM cevre_kosullari ck
             LEFT JOIN kategoriler k ON ck.kategori_id = k.id
             WHERE ck.kategori_id = $1`,
            [req.params.kategori_id]
        );
        res.json(result.rows[0] || null);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/cevre-kosullari', async (req, res) => {
    try {
        const { kategori_id, sicaklik_merkez, sicaklik_tolerans,
                nem_merkez, nem_tolerans, basinc_merkez, basinc_tolerans } = req.body;
        const result = await pool.query(
            `INSERT INTO cevre_kosullari
             (kategori_id, sicaklik_merkez, sicaklik_tolerans, nem_merkez, nem_tolerans, basinc_merkez, basinc_tolerans)
             VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
            [kategori_id, sicaklik_merkez||null, sicaklik_tolerans||null,
             nem_merkez||null, nem_tolerans||null, basinc_merkez||null, basinc_tolerans||null]
        );
        res.json(result.rows[0]);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/cevre-kosullari/:id', async (req, res) => {
    try {
        const { kategori_id, sicaklik_merkez, sicaklik_tolerans,
                nem_merkez, nem_tolerans, basinc_merkez, basinc_tolerans } = req.body;
        const result = await pool.query(
            `UPDATE cevre_kosullari SET
             kategori_id=$1, sicaklik_merkez=$2, sicaklik_tolerans=$3,
             nem_merkez=$4, nem_tolerans=$5, basinc_merkez=$6, basinc_tolerans=$7
             WHERE id=$8 RETURNING *`,
            [kategori_id, sicaklik_merkez||null, sicaklik_tolerans||null,
             nem_merkez||null, nem_tolerans||null, basinc_merkez||null, basinc_tolerans||null,
             req.params.id]
        );
        res.json(result.rows[0]);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/cevre-kosullari/:id', async (req, res) => {
    try {
        await pool.query('DELETE FROM cevre_kosullari WHERE id=$1', [req.params.id]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});


// SMTP transporter oluştur (ayarlardan)
async function smtpTransporter() {
    const res = await pool.query(
        "SELECT anahtar, deger FROM ayarlar WHERE anahtar IN ('smtp_host','smtp_port','smtp_user','smtp_pass','smtp_from_name','smtp_secure')"
    );
    const a = {};
    res.rows.forEach(r => a[r.anahtar] = r.deger);
    if(!a.smtp_host || !a.smtp_user || !a.smtp_pass)
        throw new Error('SMTP ayarları eksik. Lütfen Ayarlar sayfasından yapılandırın.');
    return nodemailer.createTransport({
        host: a.smtp_host,
        port: parseInt(a.smtp_port || '587'),
        secure: a.smtp_secure === 'true',
        auth: { user: a.smtp_user, pass: a.smtp_pass },
        connectionTimeout: 10000,
        socketTimeout: 10000,
        tls: { rejectUnauthorized: false }
    });
}
