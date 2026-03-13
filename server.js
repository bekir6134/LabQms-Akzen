require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const path = require('path');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public'))); 

// Neon.tech PostgreSQL Bağlantısı
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

// TEST YOLU
app.get('/api/test', async (req, res) => {
    try {
        const result = await pool.query('SELECT NOW()');
        res.json({ success: true, message: "Bağlantı Başarılı!", time: result.rows[0].now });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- MÜŞTERİLER API ---

// 1. LİSTELEME
app.get('/api/musteriler', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM musteriler ORDER BY id DESC');
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 2. KAYDET VEYA GÜNCELLE
app.post('/api/musteriler', async (req, res) => {
    try {
        const { id, firma_adi, sube_adi, yetkililer, telefonlar, sertifika_mailleri, fatura_mailleri, il, ilce, adres, vergi_dairesi, vergi_no } = req.body;
        
        if (id) {
            // GÜNCELLEME
            const query = `UPDATE musteriler SET firma_adi=$1, sube_adi=$2, yetkililer=$3, telefonlar=$4, sertifika_mailleri=$5, fatura_mailleri=$6, il=$7, ilce=$8, adres=$9, vergi_dairesi=$10, vergi_no=$11 WHERE id=$12 RETURNING *`;
            const result = await pool.query(query, [firma_adi, sube_adi||null, JSON.stringify(yetkililer), JSON.stringify(telefonlar), JSON.stringify(sertifika_mailleri), JSON.stringify(fatura_mailleri), il, ilce, adres, vergi_dairesi, vergi_no, id]);
            res.json(result.rows[0]);
        } else {
            // YENİ KAYIT
            const query = `INSERT INTO musteriler (firma_adi, sube_adi, yetkililer, telefonlar, sertifika_mailleri, fatura_mailleri, il, ilce, adres, vergi_dairesi, vergi_no) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`;
            const result = await pool.query(query, [firma_adi, sube_adi||null, JSON.stringify(yetkililer), JSON.stringify(telefonlar), JSON.stringify(sertifika_mailleri), JSON.stringify(fatura_mailleri), il, ilce, adres, vergi_dairesi, vergi_no]);
            res.json(result.rows[0]);
        }
    } catch (err) {
        console.error("Hata:", err.message);
        res.status(500).json({ error: "Sunucu Hatası" });
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

app.delete('/api/musteriler/:id', async (req, res) => {
    try {
        await pool.query('DELETE FROM musteriler WHERE id=$1', [req.params.id]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// CİHAZ KÜTÜPHANESİ API YOLLARI

// 1. Listeleme (Kategorilerle Birlikte)
app.get('/api/cihaz-kutuphanesi', async (req, res) => {
    try {
        const query = `
            SELECT ck.*, k.kategori_adi 
            FROM cihaz_kutuphanesi ck 
            INNER JOIN kategoriler k ON ck.kategori_id = k.id 
            ORDER BY ck.cihaz_adi ASC`;
        const result = await pool.query(query);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 2. Kaydetme
app.post('/api/cihaz-kutuphanesi', async (req, res) => {
    try {
        const { kategori_id, cihaz_adi, periyot, fiyat, para_birimi } = req.body;
        const query = `
            INSERT INTO cihaz_kutuphanesi (kategori_id, cihaz_adi, periyot, fiyat, para_birimi) 
            VALUES ($1, $2, $3, $4, $5) RETURNING *`;
        const result = await pool.query(query, [kategori_id, cihaz_adi, periyot, fiyat, para_birimi]);
        res.json(result.rows[0]);
    } catch (err) {
        console.error("Kayıt Hatası:", err.message);
        res.status(500).json({ error: "Veritabanı kayıt hatası." });
    }
});

// 3. Cihaz Güncelle
app.put('/api/cihaz-kutuphanesi/:id', async (req, res) => {
    try {
        const { kategori_id, cihaz_adi, periyot, fiyat, para_birimi } = req.body;
        const result = await pool.query(
            'UPDATE cihaz_kutuphanesi SET kategori_id=$1, cihaz_adi=$2, periyot=$3, fiyat=$4, para_birimi=$5 WHERE id=$6 RETURNING *',
            [kategori_id, cihaz_adi, periyot, fiyat, para_birimi, req.params.id]
        );
        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 4. Cihaz Sil
app.delete('/api/cihaz-kutuphanesi/:id', async (req, res) => {
    try {
        await pool.query('DELETE FROM cihaz_kutuphanesi WHERE id=$1', [req.params.id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// TEKLİF HAZIRLAMA API'LERİ

// 1. Teklif için müşteri ve cihaz bilgilerini getiren endpoint
app.get('/api/teklif-on-veriler', async (req, res) => {
    try {
        const musteriler = await pool.query('SELECT id, firma_adi FROM musteriler ORDER BY firma_adi ASC');
        const cihazlar = await pool.query(`
            SELECT ck.id, ck.cihaz_adi, ck.fiyat, ck.para_birimi, k.kategori_adi 
            FROM cihaz_kutuphanesi ck 
            JOIN kategoriler k ON ck.kategori_id = k.id 
            ORDER BY ck.cihaz_adi ASC`);
        
        res.json({
            musteriler: musteriler.rows,
            cihazlar: cihazlar.rows
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});


// --- TEKLİFLER ---
app.get('/api/teklifler', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT t.*, m.firma_adi, m.sube_adi
            FROM teklifler t
            LEFT JOIN musteriler m ON t.musteri_id = m.id
            ORDER BY t.olusturulma_tarihi DESC`);
        res.json(result.rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/teklifler/:id', async (req, res) => {
    try {
        const { musteri_id, teklif_tarihi, gecerlilik_gun, teklif_notu, indirim_oran, ara_toplam, genel_toplam, para_birimi, kalemler, durum } = req.body;
        const result = await pool.query(
            `UPDATE teklifler SET musteri_id=$1, teklif_tarihi=$2, gecerlilik_gun=$3, teklif_notu=$4, indirim_oran=$5, ara_toplam=$6, genel_toplam=$7, para_birimi=$8, kalemler=$9, durum=$10 WHERE id=$11 RETURNING *`,
            [musteri_id, teklif_tarihi, gecerlilik_gun, teklif_notu, indirim_oran, ara_toplam, genel_toplam, para_birimi, JSON.stringify(kalemler), durum||'Taslak', req.params.id]
        );
        res.json(result.rows[0]);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/teklifler/:id', async (req, res) => {
    try {
        await pool.query('DELETE FROM teklifler WHERE id=$1', [req.params.id]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/teklifler', async (req, res) => {
    try {
        const { musteri_id, teklif_tarihi, gecerlilik_gun, teklif_notu, indirim_oran, ara_toplam, genel_toplam, para_birimi, kalemler } = req.body;
        // Teklif no oluştur: TKL-2026-001
        const yil = new Date().getFullYear();
        const sayac = await pool.query(`SELECT COUNT(*) FROM teklifler WHERE EXTRACT(YEAR FROM olusturulma_tarihi) = $1`, [yil]);
        const no = String(parseInt(sayac.rows[0].count) + 1).padStart(3, '0');
        const teklif_no = `TKL-${yil}-${no}`;

        const result = await pool.query(
            `INSERT INTO teklifler (musteri_id, teklif_no, teklif_tarihi, gecerlilik_gun, teklif_notu, indirim_oran, ara_toplam, genel_toplam, para_birimi, kalemler)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
            [musteri_id, teklif_no, teklif_tarihi, gecerlilik_gun, teklif_notu, indirim_oran, ara_toplam, genel_toplam, para_birimi, JSON.stringify(kalemler)]
        );
        res.json(result.rows[0]);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Firmaya göre müşteri cihazlarını getir (teklif için)
app.get('/api/musteri-cihazlari-firma/:musteri_id', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT mc.id, mc.cihaz_adi, mc.marka, mc.model, mc.seri_no, mc.envanter_no,
                   ck.fiyat, ck.para_birimi
            FROM musteri_cihazlari mc
            LEFT JOIN cihaz_kutuphanesi ck ON LOWER(ck.cihaz_adi) = LOWER(mc.cihaz_adi)
            WHERE mc.musteri_id = $1
            ORDER BY mc.cihaz_adi ASC`,
            [req.params.musteri_id]
        );
        res.json(result.rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
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

app.delete('/api/referans-cihazlar/:id', async (req, res) => {
    try {
        await pool.query('DELETE FROM referans_cihazlar WHERE id=$1', [req.params.id]);
        res.json({ success: true });
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


// --- KALİBRASYON METOTLARI API ---

// LİSTELE
app.get('/api/metotlar', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT km.*, 
                COALESCE(
                    (SELECT json_agg(json_build_object('id', t.id, 'talimat_kodu', t.talimat_kodu, 'talimat_adi', t.talimat_adi))
                     FROM talimatlar t WHERE t.id = ANY(km.talimatlar)), '[]'
                ) as talimat_detay,
                COALESCE(
                    (SELECT json_agg(json_build_object('id', rc.id, 'cihaz_adi', rc.cihaz_adi, 'seri_no', rc.seri_no))
                     FROM referans_cihazlar rc WHERE rc.id = ANY(km.referanslar)), '[]'
                ) as referans_detay
            FROM kalibrasyon_metotlari km
            ORDER BY km.id DESC
        `);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// KAYDET
app.post('/api/metotlar', async (req, res) => {
    try {
        const { metot_adi, metot_kodu, talimatlar, referanslar } = req.body;
        const result = await pool.query(
            `INSERT INTO kalibrasyon_metotlari (metot_adi, metot_kodu, talimatlar, referanslar)
             VALUES ($1, $2, $3, $4) RETURNING *`,
            [metot_adi, metot_kodu, talimatlar.map(Number), referanslar.map(Number)]
        );
        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GÜNCELLE
app.put('/api/metotlar/:id', async (req, res) => {
    try {
        const { metot_adi, metot_kodu, talimatlar, referanslar } = req.body;
        const result = await pool.query(
            `UPDATE kalibrasyon_metotlari SET metot_adi=$1, metot_kodu=$2, talimatlar=$3, referanslar=$4 WHERE id=$5 RETURNING *`,
            [metot_adi, metot_kodu, talimatlar.map(Number), referanslar.map(Number), req.params.id]
        );
        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// SİL
app.delete('/api/metotlar/:id', async (req, res) => {
    try {
        await pool.query('DELETE FROM kalibrasyon_metotlari WHERE id=$1', [req.params.id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- MÜŞTERİ CİHAZLARI API ---

app.get('/api/musteri-cihazlari-on-veriler', async (req, res) => {
    try {
        const musteriler = await pool.query('SELECT id, firma_adi FROM musteriler ORDER BY firma_adi ASC');
        const kategoriler = await pool.query('SELECT id, kategori_adi FROM kategoriler ORDER BY kategori_adi ASC');
        const cihazlar = await pool.query('SELECT id, cihaz_adi FROM cihaz_kutuphanesi ORDER BY cihaz_adi ASC');
        const metotlar = await pool.query('SELECT id, metot_adi, metot_kodu FROM kalibrasyon_metotlari ORDER BY metot_kodu ASC');
        res.json({ musteriler: musteriler.rows, kategoriler: kategoriler.rows, cihazlar: cihazlar.rows, metotlar: metotlar.rows });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/musteri-cihazlari', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT mc.*, 
                m.firma_adi, 
                k.kategori_adi,
                km.metot_kodu, km.metot_adi as metot_adi_full
            FROM musteri_cihazlari mc
            LEFT JOIN musteriler m ON mc.musteri_id = m.id
            LEFT JOIN kategoriler k ON mc.kategori_id = k.id
            LEFT JOIN kalibrasyon_metotlari km ON mc.metot_id = km.id
            ORDER BY mc.id DESC
        `);
        res.json(result.rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/musteri-cihazlari', async (req, res) => {
    try {
        const { musteri_id, kategori_id, cihaz_adi, marka, model, seri_no, envanter_no, olcum_araligi, cozunurluk, metot_id, degerlendirme_kriteri, kalibrasyon_yeri } = req.body;
        const result = await pool.query(
            `INSERT INTO musteri_cihazlari (musteri_id, kategori_id, cihaz_adi, marka, model, seri_no, envanter_no, olcum_araligi, cozunurluk, metot_id, degerlendirme_kriteri, kalibrasyon_yeri)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
            [musteri_id, kategori_id||null, cihaz_adi, marka, model, seri_no||null, envanter_no||null, olcum_araligi, cozunurluk, metot_id||null, degerlendirme_kriteri, kalibrasyon_yeri]
        );
        res.json(result.rows[0]);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/musteri-cihazlari/:id', async (req, res) => {
    try {
        const { musteri_id, kategori_id, cihaz_adi, marka, model, seri_no, envanter_no, olcum_araligi, cozunurluk, metot_id, degerlendirme_kriteri, kalibrasyon_yeri } = req.body;
        const result = await pool.query(
            `UPDATE musteri_cihazlari SET musteri_id=$1, kategori_id=$2, cihaz_adi=$3, marka=$4, model=$5, seri_no=$6, envanter_no=$7, olcum_araligi=$8, cozunurluk=$9, metot_id=$10, degerlendirme_kriteri=$11, kalibrasyon_yeri=$12 WHERE id=$13 RETURNING *`,
            [musteri_id, kategori_id||null, cihaz_adi, marka, model, seri_no||null, envanter_no||null, olcum_araligi, cozunurluk, metot_id||null, degerlendirme_kriteri, kalibrasyon_yeri, req.params.id]
        );
        res.json(result.rows[0]);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/musteri-cihazlari/:id', async (req, res) => {
    try {
        await pool.query('DELETE FROM musteri_cihazlari WHERE id=$1', [req.params.id]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
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

// --- İŞ EMİRLERİ ---
app.get('/api/is-emirleri-on-veriler', async (req, res) => {
    try {
        const musteriler = await pool.query('SELECT id, firma_adi, sube_adi FROM musteriler ORDER BY firma_adi');
        // KATEGORİ HATASI GİDERİLDİ! Artık sadece id ve cihaz_adi çekiliyor:
        const cihazKutuphanesi = await pool.query('SELECT id, cihaz_adi FROM cihaz_kutuphanesi ORDER BY cihaz_adi');
        res.json({ musteriler: musteriler.rows, cihazlar: cihazKutuphanesi.rows });
    } catch (err) { 
        console.error("İş Emirleri API Hatası:", err.message);
        res.status(500).json({ error: err.message }); 
    }
});

app.get('/api/is-emirleri', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT ie.*, m.firma_adi, m.sube_adi
            FROM is_emirleri ie
            LEFT JOIN musteriler m ON ie.musteri_id = m.id
            ORDER BY ie.olusturulma DESC`);
        res.json(result.rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/is-emirleri', async (req, res) => {
    try {
        const { musteri_id, kabul_tarihi, teslim_tarihi, cihazlar, notlar } = req.body;
        // IE no üret: IE-2026-001
        const yil = new Date().getFullYear();
        const sayacRes = await pool.query(
            `SELECT COUNT(*) FROM is_emirleri WHERE ie_no LIKE $1`, [`IE-${yil}-%`]);
        const sira = parseInt(sayacRes.rows[0].count) + 1;
        const ie_no = `IE-${yil}-${String(sira).padStart(3,'0')}`;
        const result = await pool.query(
            `INSERT INTO is_emirleri (ie_no, musteri_id, kabul_tarihi, teslim_tarihi, cihazlar, notlar, asama)
             VALUES ($1,$2,$3,$4,$5,$6,'kabul_edildi') RETURNING *`,
            [ie_no, musteri_id, kabul_tarihi, teslim_tarihi||null, JSON.stringify(cihazlar), notlar||'']
        );
        res.json(result.rows[0]);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/is-emirleri/:id/asama', async (req, res) => {
    try {
        const { asama } = req.body;
        const result = await pool.query(
            `UPDATE is_emirleri SET asama=$1 WHERE id=$2 RETURNING *`,
            [asama, req.params.id]
        );
        res.json(result.rows[0]);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/is-emirleri/:id', async (req, res) => {
    try {
        const { musteri_id, kabul_tarihi, teslim_tarihi, cihazlar, notlar, asama } = req.body;
        const result = await pool.query(
            `UPDATE is_emirleri SET musteri_id=$1, kabul_tarihi=$2, teslim_tarihi=$3, cihazlar=$4, notlar=$5, asama=$6 WHERE id=$7 RETURNING *`,
            [musteri_id, kabul_tarihi, teslim_tarihi||null, JSON.stringify(cihazlar), notlar||'', asama, req.params.id]
        );
        res.json(result.rows[0]);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/is-emirleri/:id', async (req, res) => {
    try {
        await pool.query('DELETE FROM is_emirleri WHERE id=$1', [req.params.id]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- YENİ EKLENEN OPERASYON API: TEKİL CİHAZ İŞLEM KAYDI ---
app.put('/api/is-emirleri/:id/cihaz-islem', async (req, res) => {
    try {
        const { cihaz_index, personel, metot_id, sicaklik, nem, sertifika_asamasi } = req.body;
        
        // 1. İş emrini bul
        const { rows } = await pool.query('SELECT cihazlar FROM is_emirleri WHERE id = $1', [req.params.id]);
        if (rows.length === 0) return res.status(404).json({ error: "İş emri bulunamadı" });
        
        let cihazlar = rows[0].cihazlar;
        if (typeof cihazlar === 'string') cihazlar = JSON.parse(cihazlar);

        // 2. Sadece ilgili cihazın verilerini güncelle
        cihazlar[cihaz_index] = {
            ...cihazlar[cihaz_index],
            islem_durumu: sertifika_asamasi,
            kalibrasyon_verileri: { personel, metot_id, sicaklik, nem, islem_tarihi: new Date() }
        };

        // 3. Güncel listeyi kaydet
        const result = await pool.query('UPDATE is_emirleri SET cihazlar = $1 WHERE id = $2 RETURNING *', [JSON.stringify(cihazlar), req.params.id]);
        res.json(result.rows[0]);
    } catch (err) { 
        res.status(500).json({ error: err.message }); 
    }
});


// --- PERSONEL YÖNETİMİ API ---
app.get('/api/personeller', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM personeller ORDER BY id DESC');
        res.json(result.rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/personeller', async (req, res) => {
    try {
        const { ad_soyad, kullanici_adi, sifre, roller, erisimler, varsayilan_onaylayici } = req.body;
        
        // Eğer bu kişi varsayılan onaylayıcı yapıldıysa, diğer herkesin varsayılanlığını kaldır
        if (varsayilan_onaylayici) {
            await pool.query('UPDATE personeller SET varsayilan_onaylayici = false');
        }

        const query = `
            INSERT INTO personeller (ad_soyad, kullanici_adi, sifre, roller, erisimler, varsayilan_onaylayici) 
            VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`;
        const result = await pool.query(query, [ad_soyad, kullanici_adi, sifre, JSON.stringify(roller), JSON.stringify(erisimler), varsayilan_onaylayici]);
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

// Personel Güncelleme (PUT)
app.put('/api/personeller/:id', async (req, res) => {
    try {
        const { ad_soyad, kullanici_adi, sifre, roller, erisimler, varsayilan_onaylayici } = req.body;
        
        if (varsayilan_onaylayici) {
            await pool.query('UPDATE personeller SET varsayilan_onaylayici = false');
        }

        const query = `
            UPDATE personeller 
            SET ad_soyad=$1, kullanici_adi=$2, sifre=$3, roller=$4, erisimler=$5, varsayilan_onaylayici=$6
            WHERE id=$7 RETURNING *`;
        const result = await pool.query(query, [ad_soyad, kullanici_adi, sifre, JSON.stringify(roller), JSON.stringify(erisimler), varsayilan_onaylayici, req.params.id]);
        res.json(result.rows[0]);
    } catch (err) { 
        if (err.code === '23505') return res.status(400).json({ error: "Bu kullanıcı adı zaten kullanılıyor!" });
        res.status(500).json({ error: err.message }); 
    }
});

// --- GİRİŞ (LOGIN) API ---
app.post('/api/login', async (req, res) => {
    try {
        const { kullanici_adi, sifre } = req.body;
        
        // Veritabanında bu kullanıcı adı ve şifreyle eşleşen biri var mı bakıyoruz
        const result = await pool.query(
            'SELECT id, ad_soyad, kullanici_adi, roller, erisimler FROM personeller WHERE kullanici_adi = $1 AND sifre = $2',
            [kullanici_adi, sifre]
        );

        if (result.rows.length > 0) {
            // Kullanıcı bulundu! Şifre hariç bilgileri frontend'e gönder
            res.json({ success: true, user: result.rows[0] });
        } else {
            // Kullanıcı bulunamadı veya şifre yanlış
            res.status(401).json({ success: false, error: "Kullanıcı adı veya şifre hatalı!" });
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});


app.listen(PORT, () => {
    console.log(`🚀 Sunucu ${PORT} portunda başarıyla ayağa kalktı.`);
});