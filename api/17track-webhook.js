export default async function handler(req, res) {
  // Responde imediatamente para evitar timeout
  res.status(200).json({ ok: true });

  if (req.method !== 'POST') return;

  const SUPA_URL = process.env.SUPA_URL;
  const SUPA_KEY = process.env.SUPA_KEY;
  const SH = { 'Content-Type': 'application/json', 'apikey': SUPA_KEY, 'Authorization': 'Bearer ' + SUPA_KEY };

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const packages = body?.data?.accepted || body?.data || [];
    const list = Array.isArray(packages) ? packages : [packages];

    for (const pkg of list) {
      const trackingNo = pkg.number || pkg.tracking_number;
      if (!trackingNo) continue;

      const stage = pkg.track_info?.latest_status?.status || '';
      const lastEvent = (pkg.track_info?.latest_event?.description || '').toLowerCase();

      let novoStatus = null;
      let motivo = '';

      if (stage === 'Delivered') {
        novoStatus = 'entregue';
      } else if (['InTransit','PickedUp','InfoReceived','Received'].includes(stage)) {
        novoStatus = 'transito';
      } else if (['Undelivered','Exception','Alert','NotDelivered'].includes(stage)) {
        if (lastEvent.includes('receita') || lastEvent.includes('aduaneiro') || lastEvent.includes('alfand')) {
          novoStatus = 'atencao'; motivo = 'Retido — Receita Federal';
        } else if (lastEvent.includes('autenticidade') || lastEvent.includes('marca') || lastEvent.includes('falsif')) {
          novoStatus = 'atencao'; motivo = 'Autenticidade da marca';
        } else if (lastEvent.includes('nao autorizada') || lastEvent.includes('não autorizada')) {
          novoStatus = 'atencao'; motivo = 'Importação não autorizada';
        } else if (lastEvent.includes('devolvido') || lastEvent.includes('retorno ao remetente')) {
          novoStatus = 'devolvido'; motivo = 'Devolvido ao remetente';
        } else if (lastEvent.includes('extravi') || lastEvent.includes('roubado')) {
          novoStatus = 'extraviado'; motivo = 'Extraviado / roubado';
        } else if (lastEvent.includes('pagamento') || lastEvent.includes('taxa')) {
          novoStatus = 'atencao'; motivo = 'Aguardando pagamento de taxas';
        } else {
          novoStatus = 'atencao'; motivo = lastEvent.slice(0, 60) || 'Verificar rastreio';
        }
      }

      if (!novoStatus) continue;

      const [r1, r2] = await Promise.all([
        fetch(`${SUPA_URL}/rest/v1/pedidos?rastreio1=eq.${encodeURIComponent(trackingNo)}&select=id,status`, { headers: SH }),
        fetch(`${SUPA_URL}/rest/v1/pedidos?rastreio2=eq.${encodeURIComponent(trackingNo)}&select=id,status`, { headers: SH })
      ]);
      const [d1, d2] = await Promise.all([r1.json(), r2.json()]);
      const pedido = d1[0] || d2[0];
      if (!pedido) continue;

      const prioridade = { aguardando: 0, transito: 1, reenviado: 2, atencao: 3, devolvido: 3, extraviado: 3, entregue: 4 };
      if ((prioridade[novoStatus] ?? 0) >= (prioridade[pedido.status] ?? 0)) {
        const updateObj = { status: novoStatus };
        if (motivo) updateObj.motivo = motivo;
        await fetch(`${SUPA_URL}/rest/v1/pedidos?id=eq.${pedido.id}`, {
          method: 'PATCH', headers: SH, body: JSON.stringify(updateObj)
        });
      }
    }
  } catch (e) {
    console.error('17track webhook error:', e.message);
  }
}
