import crypto from 'crypto';

export const config = { api: { bodyParser: false } };

async function getRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).end(); return; }

  const SUPA_URL = process.env.SUPA_URL;
  const SUPA_KEY = process.env.SUPA_KEY;
  const SHOPIFY_SECRET = process.env.SHOPIFY_SECRET;

  const rawBody = await getRawBody(req);
  const hmac = req.headers['x-shopify-hmac-sha256'];
  const topic = req.headers['x-shopify-topic'];

  const hash = crypto.createHmac('sha256', SHOPIFY_SECRET).update(rawBody).digest('base64');
  if (hash !== hmac) { res.status(401).json({ error: 'HMAC invalido' }); return; }

  const order = JSON.parse(rawBody.toString());
  const SH = { 'Content-Type': 'application/json', 'apikey': SUPA_KEY, 'Authorization': 'Bearer ' + SUPA_KEY };

  if (order.cancelled_at || order.financial_status === 'pending' || order.financial_status === 'voided') {
    res.status(200).json({ ok: true, msg: 'Ignorado' });
    return;
  }

  const fulfill = order.fulfillments && order.fulfillments[0];
  const novoRastreio = fulfill && fulfill.tracking_numbers && fulfill.tracking_numbers[0] || '';
  const transp = fulfill && fulfill.tracking_company || 'Correios';
  const c = order.customer || {};
  const nome = ((c.first_name || '') + ' ' + (c.last_name || '')).trim() || 'Cliente';
  const fs = order.fulfillment_status;
  const status = fs === 'fulfilled' ? 'entregue' : fs === 'partial' ? 'transito' : fs ? 'transito' : 'aguardando';
  const data = order.created_at ? order.created_at.split('T')[0] : '';
  const mes = data ? parseInt(data.split('-')[1]) - 1 : 0;

  const getResp = await fetch(`${SUPA_URL}/rest/v1/pedidos?pedido=eq.${encodeURIComponent(order.name)}&select=*`, { headers: SH });
  const existing = await getResp.json();
  const existente = existing[0] || null;

  if (existente) {
    const obj = { status, transp };
    if (novoRastreio && novoRastreio !== existente.rastreio1 && novoRastreio !== existente.rastreio2) {
      if (existente.rastreio1 && !existente.rastreio2) {
        obj.rastreio2 = novoRastreio;
        obj.status = 'reenviado';
      } else {
        obj.rastreio1 = novoRastreio;
      }
    } else if (novoRastreio) {
      obj.rastreio1 = novoRastreio;
    }
    await fetch(`${SUPA_URL}/rest/v1/pedidos?id=eq.${existente.id}`, { method: 'PATCH', headers: SH, body: JSON.stringify(obj) });
  } else {
    await fetch(`${SUPA_URL}/rest/v1/pedidos`, {
      method: 'POST',
      headers: { ...SH, 'Prefer': 'resolution=merge-duplicates' },
      body: JSON.stringify({ pedido: order.name, cliente: nome, status, transp, rastreio1: novoRastreio, rastreio2: '', motivo: '', data, valor: parseFloat(order.total_price || 0), mes, obs: '' })
    });
  }

  res.status(200).json({ ok: true, topic, pedido: order.name });
}
