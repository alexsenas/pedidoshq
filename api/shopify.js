export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  const { store, secret, start, end, page = 1 } = req.query;
  if (!store || !secret) { res.status(400).json({ error: 'Missing params' }); return; }

  try {
    const url = `https://${store}/admin/api/2024-01/orders.json?status=any&created_at_min=${start}T00:00:00-03:00&created_at_max=${end}T23:59:59-03:00&limit=250&page=${page}&fields=id,name,created_at,total_price,customer,fulfillments,fulfillment_status`;
    const resp = await fetch(url, {
      headers: { 'X-Shopify-Access-Token': secret, 'Content-Type': 'application/json' }
    });
    if (!resp.ok) {
      const txt = await resp.text();
      res.status(resp.status).json({ error: 'Shopify: ' + resp.status, detail: txt });
      return;
    }
    const data = await resp.json();
    res.status(200).json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
