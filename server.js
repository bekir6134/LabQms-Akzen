// ... (diğer kısımlar aynı)
app.post('/api/musteriler', async (req, res) => {
    try {
        const { id, firma_adi, yetkililer, telefonlar, sertifika_mailleri, fatura_mailleri, il, ilce, adres, vergi_dairesi, vergi_no } = req.body;
        
        if (id) {
            const query = `UPDATE musteriler SET firma_adi=$1, yetkililer=$2, telefonlar=$3, sertifika_mailleri=$4, fatura_mailleri=$5, il=$6, ilce=$7, adres=$8, vergi_dairesi=$9, vergi_no=$10 WHERE id=$11 RETURNING *`;
            const result = await pool.query(query, [firma_adi, JSON.stringify(yetkililer), JSON.stringify(telefonlar), JSON.stringify(sertifika_mailleri), JSON.stringify(fatura_mailleri), il, ilce, adres, vergi_dairesi, vergi_no, id]);
            res.json(result.rows[0]);
        } else {
            const query = `INSERT INTO musteriler (firma_adi, yetkililer, telefonlar, sertifika_mailleri, fatura_mailleri, il, ilce, adres, vergi_dairesi, vergi_no) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`;
            const result = await pool.query(query, [firma_adi, JSON.stringify(yetkililer), JSON.stringify(telefonlar), JSON.stringify(sertifika_mailleri), JSON.stringify(fatura_mailleri), il, ilce, adres, vergi_dairesi, vergi_no]);
            res.json(result.rows[0]);
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});