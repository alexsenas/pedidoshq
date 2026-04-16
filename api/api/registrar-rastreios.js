export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).end(); return; }

  const SUPA_URL = process.env.SUPA_URL;
  const SUPA_KEY = process.env.SUPA_KEY;
  const TRACK_KEY = process.env.TRACK_KEY;
  const SH = { 'Content-Type': 'application/json', 'apikey': SUPA_KEY, 'Authorization': 'Bearer ' + SUPA_KEY };

  try {
    // Busca todos os pedidos com rastreio que não estão entregues
    const r = await fetch(`${SUPA_URL}/rest/v1/pedidos?select=rastreio1,rastreio2&status=neq.entregue&rastreio1=neq.`, { headers: SH });
    const pedidos = await r.json();

    const codigos = [];
    for (const p of pedidos) {
      if (p.rastreio1) codigos.push({ number: p.rastreio1 });
      if (p.rastreio2) codigos.push({ number: p.rastreio2 });
    }

    if (!codigos.length) { res.status(200).json({ ok: true, msg: 'Nenhum rastreio para registrar' }); return; }

    // Envia em lotes de 40 para o 17Track
    const lote = 40;
    let registrados = 0;
    for (let i = 0; i < codigos.length; i += lote) {
      const batch = codigos.slice(i, i + lote);
      const resp = await fetch('https://api.17track.net/track/v2.2/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', '17token': TRACK_KEY },
        body: JSON.stringify(batch)
      });
      const data = await resp.json();
      registrados += batch.length;
    }

    res.status(200).json({ ok: true, registrados, total: codigos.length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
