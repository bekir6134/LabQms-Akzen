-- ============================================================
-- LabQMS Pro - Neon.tech PostgreSQL Başlangıç Script'i
-- Railway deployment için tüm tabloları oluşturur.
-- Neon.tech SQL Editor'de veya psql ile çalıştırın.
-- ============================================================

-- 1. KATEGORİLER
CREATE TABLE IF NOT EXISTS kategoriler (
    id SERIAL PRIMARY KEY,
    kategori_adi VARCHAR(200) NOT NULL
);

-- 2. AYARLAR (key-value store)
CREATE TABLE IF NOT EXISTS ayarlar (
    id SERIAL PRIMARY KEY,
    anahtar VARCHAR(100) UNIQUE NOT NULL,
    deger TEXT
);

-- 3. PERSONELLER
CREATE TABLE IF NOT EXISTS personeller (
    id SERIAL PRIMARY KEY,
    ad_soyad VARCHAR(200) NOT NULL,
    kullanici_adi VARCHAR(100) UNIQUE NOT NULL,
    sifre VARCHAR(200) NOT NULL,
    roller JSONB DEFAULT '[]',
    erisimler JSONB DEFAULT '[]',
    varsayilan_onaylayici BOOLEAN DEFAULT false
);

-- 4. TAKVİM
CREATE TABLE IF NOT EXISTS takvim (
    id SERIAL PRIMARY KEY,
    baslik VARCHAR(255) NOT NULL,
    aciklama TEXT,
    baslangic DATE NOT NULL,
    bitis DATE,
    atanan_id INTEGER,
    renk VARCHAR(20) DEFAULT '#1E40AF',
    tip VARCHAR(50) DEFAULT 'genel',
    olusturan_id INTEGER
);

-- 5. TALİMATLAR (Kalibrasyon Prosedürleri)
CREATE TABLE IF NOT EXISTS talimatlar (
    id SERIAL PRIMARY KEY,
    talimat_adi VARCHAR(300) NOT NULL,
    talimat_kodu VARCHAR(100),
    olcme_araligi VARCHAR(200)
);

-- 6. REFERANS CİHAZLAR
CREATE TABLE IF NOT EXISTS referans_cihazlar (
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
);

-- 7. REFERANS TAKİP (Kalibrasyon geçmişi)
CREATE TABLE IF NOT EXISTS referans_takip (
    id SERIAL PRIMARY KEY,
    referans_id INTEGER REFERENCES referans_cihazlar(id) ON DELETE CASCADE,
    islem_tipi VARCHAR(100),
    sertifika_no VARCHAR(200),
    izlenebilirlik TEXT,
    kal_tarihi DATE,
    sonraki_kal_tarihi DATE
);

-- 8. ÇEVRE KOŞULLARI
CREATE TABLE IF NOT EXISTS cevre_kosullari (
    id SERIAL PRIMARY KEY,
    kategori_id INTEGER REFERENCES kategoriler(id),
    sicaklik_merkez NUMERIC,
    sicaklik_tolerans NUMERIC,
    nem_merkez NUMERIC,
    nem_tolerans NUMERIC,
    basinc_merkez NUMERIC,
    basinc_tolerans NUMERIC
);

-- ── KALİTE SİSTEMİ TABLOLARI ────────────────────────────────

-- 9. KALİTE DOKÜMAN YÖNETİMİ
CREATE TABLE IF NOT EXISTS kalite_dokuman (
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
    parent_id INTEGER REFERENCES kalite_dokuman(id) ON DELETE CASCADE,
    olusturma_tarihi TIMESTAMP DEFAULT NOW()
);

-- 10. UYGUNSUZLUK
CREATE TABLE IF NOT EXISTS uygunsuzluk (
    id SERIAL PRIMARY KEY,
    kayit_no VARCHAR(50),
    tarih DATE,
    kaynak VARCHAR(50),
    aciklama TEXT,
    tespit_eden VARCHAR(100),
    durum VARCHAR(30) DEFAULT 'acik',
    kapatis_tarihi DATE,
    esas_alinan_sart TEXT,
    sinif VARCHAR(20),
    olusturma_tarihi TIMESTAMP DEFAULT NOW()
);

-- 11. DÖF (Düzeltici ve Önleyici Faaliyet)
CREATE TABLE IF NOT EXISTS dof (
    id SERIAL PRIMARY KEY,
    uygunsuzluk_id INTEGER REFERENCES uygunsuzluk(id) ON DELETE CASCADE,
    kok_neden TEXT,
    kapsam_etki TEXT,
    yayilma_etki TEXT,
    faaliyet_tanimi TEXT,
    sorumlu VARCHAR(100),
    termin DATE,
    tamamlandi_tarihi DATE,
    sonuc TEXT
);

-- 12. İÇ DENETİM
CREATE TABLE IF NOT EXISTS ic_denetim (
    id SERIAL PRIMARY KEY,
    denetim_no VARCHAR(50),
    plan_tarihi DATE,
    tamamlandi_tarihi DATE,
    kapsam TEXT,
    denetci VARCHAR(150),
    durum VARCHAR(30) DEFAULT 'planlandı',
    aciklama TEXT,
    olusturma_tarihi TIMESTAMP DEFAULT NOW()
);

-- 13. İÇ DENETİM BULGU
CREATE TABLE IF NOT EXISTS ic_denetim_bulgu (
    id SERIAL PRIMARY KEY,
    denetim_id INTEGER REFERENCES ic_denetim(id) ON DELETE CASCADE,
    bulgu_turu VARCHAR(30),
    madde_no VARCHAR(50),
    aciklama TEXT,
    durum VARCHAR(20) DEFAULT 'acik',
    kapanis_tarihi DATE
);

-- 14. RİSK KAYDI
CREATE TABLE IF NOT EXISTS risk_kaydi (
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
);

-- 15. MÜŞTERİ ŞİKAYETİ
CREATE TABLE IF NOT EXISTS musteri_sikayet (
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
);

-- 16. DIŞ TEDARİKÇİ
CREATE TABLE IF NOT EXISTS dis_tedarikci (
    id SERIAL PRIMARY KEY,
    firma_adi VARCHAR(200) NOT NULL,
    hizmet_turu VARCHAR(100),
    iletisim VARCHAR(200),
    onay_durumu VARCHAR(30) DEFAULT 'beklemede',
    aciklama TEXT,
    olusturma_tarihi TIMESTAMP DEFAULT NOW()
);

-- 17. DIŞ TEDARİKÇİ DEĞERLENDİRME
CREATE TABLE IF NOT EXISTS dis_tedarikci_degerlendirme (
    id SERIAL PRIMARY KEY,
    tedarikci_id INTEGER REFERENCES dis_tedarikci(id) ON DELETE CASCADE,
    tarih DATE,
    puan SMALLINT,
    degerlendiren VARCHAR(100),
    notlar TEXT
);

-- 18. YETERLİLİK TESTİ (PT / LAP)
CREATE TABLE IF NOT EXISTS yeterlilik_testi (
    id SERIAL PRIMARY KEY,
    program_adi VARCHAR(200),
    organizator VARCHAR(200),
    katilim_tarihi DATE,
    parametreler TEXT,
    sonuc VARCHAR(30) DEFAULT 'beklemede',
    z_skoru VARCHAR(50),
    aciklama TEXT,
    olusturma_tarihi TIMESTAMP DEFAULT NOW()
);

-- 19. YÖNETİMİN GÖZDEN GEÇİRMESİ (YGG)
CREATE TABLE IF NOT EXISTS ygg_toplanti (
    id SERIAL PRIMARY KEY,
    toplanti_no VARCHAR(50),
    tarih DATE,
    katilimcilar TEXT,
    gundem TEXT,
    kararlar TEXT,
    durum VARCHAR(30) DEFAULT 'planlandı',
    bir_sonraki_tarih DATE,
    olusturma_tarihi TIMESTAMP DEFAULT NOW()
);

-- 20. PERSONEL ARASI KARŞILAŞTIRMA (PAK)
CREATE TABLE IF NOT EXISTS pak (
    id SERIAL PRIMARY KEY,
    konu VARCHAR(500) NOT NULL,
    karsilastirma_tarihi DATE,
    katilimcilar TEXT,
    metot VARCHAR(300),
    sonuc VARCHAR(50) DEFAULT 'beklemede',
    aciklama TEXT,
    olusturma_tarihi TIMESTAMP DEFAULT NOW()
);

-- ── VARSAYILAN VERİLER ───────────────────────────────────────

-- Varsayılan admin kullanıcısı (şifre: admin123)
INSERT INTO personeller (ad_soyad, kullanici_adi, sifre, roller, erisimler, varsayilan_onaylayici)
VALUES ('Sistem Yöneticisi', 'admin', 'admin123', '["admin"]', '[]', true)
ON CONFLICT (kullanici_adi) DO NOTHING;

-- Varsayılan ayarlar
INSERT INTO ayarlar (anahtar, deger) VALUES
    ('lab_adi', 'Laboratuvar Adı'),
    ('adres', ''),
    ('telefon', ''),
    ('email', ''),
    ('website', '')
ON CONFLICT (anahtar) DO NOTHING;
