export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).end(); return; }

  const SUPA_URL = process.env.SUPA_URL;
  const SUPA_KEY = process.env.SUPA_KEY;
  const TRACK_KEY = process.env.TRACK_KEY;
  const SH = { 'Content-Type': 'application/json', 'apikey': SUPA_KEY, 'Authorization': 'Bearer ' + SUPA_KEY };

  try {
    // Busca todos os pedidos que não estão entregues
    const r = await fetch(`${SUPA_URL}/rest/v1/pedidos?select=rastreio1,rastreio2&status=neq.entregue`, { headers: SH });
    const pedidos = await r.json();

    const codigos = [];
    for (const p of pedidos) {
      if (p.rastreio1 && p.rastreio1.trim() !== '') codigos.push({ number: p.rastreio1.trim() });
      if (p.rastreio2 && p.rastreio2.trim() !== '') codigos.push({ number: p.rastreio2.trim() });
    }

    if (!codigos.length) {
      res.status(200).json({ ok: true, msg: 'Nenhum rastreio para registrar', total_pedidos: pedidos.length });
      return;
    }

    // Envia em lotes de 40 para o 17Track
    let registrados = 0;
    let erros = 0;
    for (let i = 0; i < codigos.length; i += 40) {
      const batch = codigos.slice(i, i + 40);
      const resp = await fetch('https://api.17track.net/track/v2.2/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', '17token': TRACK_KEY },
        body: JSON.stringify(batch)
      });
      const data = await resp.json();
      if (data.code === 0) {
        registrados += (data.data?.accepted?.length || batch.length);
        erros += (data.data?.rejected?.length || 0);
      } else {
        erros += batch.length;
      }
    }

    res.status(200).json({ ok: true, registrados, erros, total: codigos.length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
