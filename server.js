require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const path = require('path');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
// "public" klasöründeki HTML/CSS dosyalarını dışarıya sunar
app.use(express.static(path.join(__dirname, 'public'))); 

// Neon.tech PostgreSQL Bağlantı Havuzu
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false } // Neon için SSL zorunludur
});

// Veritabanı bağlantı testi (Tarayıcıda /api/test yazarak kontrol edebilirsin)
app.get('/api/test', async (req, res) => {
    try {
        const result = await pool.query('SELECT NOW()');
        res.json({ success: true, message: "Neon.tech Veritabanı Bağlantısı Başarılı!", time: result.rows[0].now });
    } catch (err) {
        res.status(500).json({ error: "Veritabanı Hatası: " + err.message });
    }
});

app.listen(PORT, () => {
    console.log(`🚀 LabQMS Sunucusu ${PORT} portunda çalışıyor.`);
});