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

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

// MÜŞTERİ LİSTELEME
app.get('/api/musteriler', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM musteriler ORDER BY id DESC');
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// MÜŞTERİ KAYDET VEYA GÜNCELLE
app.post('/api/musteriler', async (req, res) => {
    try {
        const { id, firma_adi, sube_adi, yetkililer, telefonlar, sertifika_mailleri, fatura_mailleri, il, ilce, adres, vergi_dairesi_vkn } = req.body;
        
        if (id) {
            // GÜNCELLEME
            const updateQuery = `
                UPDATE musteriler SET 
                firma_adi=$1, sube_adi=$2, yetkililer=$3, telefonlar=$4, sertifika_mailleri=$5, 
                fatura_mailleri=$6, il=$7, ilce=$8, adres=$9, vergi_dairesi_vkn=$10 
                WHERE id=$11 RETURNING *`;
            const result = await pool.query(updateQuery, [firma_adi, sube_adi, JSON.stringify(yetkililer), JSON.stringify(telefonlar), JSON.stringify(sertifika_mailleri), JSON.stringify(fatura_mailleri), il, ilce, adres, vergi_dairesi_vkn, id]);
            res.json(result.rows[0]);
        } else {
            // YENİ KAYIT
            const insertQuery = `
                INSERT INTO musteriler (firma_adi, sube_adi, yetkililer, telefonlar, sertifika_mailleri, fatura_mailleri, il, ilce, adres, vergi_dairesi_vkn) 
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`;
            const result = await pool.query(insertQuery, [firma_adi, sube_adi, JSON.stringify(yetkililer), JSON.stringify(telefonlar), JSON.stringify(sertifika_mailleri), JSON.stringify(fatura_mailleri), il, ilce, adres, vergi_dairesi_vkn]);
            res.json(result.rows[0]);
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.listen(PORT, () => console.log(`🚀 LabQMS Pro ${PORT} üzerinde aktif.`));