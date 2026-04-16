export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).end(); return; }

  const SUPA_URL = process.env.SUPA_URL;
  const SUPA_KEY = process.env.SUPA_KEY;
  const TRACK_KEY = process.env.TRACK_KEY;
  const SH = { 'Content-Type': 'application/json', 'apikey': SUPA_KEY, 'Authorization': 'Bearer ' + SUPA_KEY };

  try {
    // Busca todos pedidos não entregues com rastreio
    const r = await fetch(`${SUPA_URL}/rest/v1/pedidos?select=id,rastreio1,rastreio2,status&status=neq.entregue&limit=1000`, { headers: SH });
    const pedidos = await r.json();

    // Monta lista de rastreios únicos
    const rastreioMap = {};
    for (const p of pedidos) {
      if (p.rastreio1?.trim()) rastreioMap[p.rastreio1.trim()] = p;
      if (p.rastreio2?.trim()) rastreioMap[p.rastreio2.trim()] = p;
    }
    const codigos = Object.keys(rastreioMap);
    if (!codigos.length) { res.status(200).json({ ok: true, msg: 'Nenhum rastreio para sincronizar' }); return; }

    let atualizados = 0;
    // Processa em lotes de 40
    for (let i = 0; i < codigos.length; i += 40) {
      const batch = codigos.slice(i, i + 40).map(n => ({ number: n }));
      const trackResp = await fetch('https://api.17track.net/track/v2.2/gettrackinfo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', '17token': TRACK_KEY },
        body: JSON.stringify(batch)
      });
      const trackData = await trackResp.json();
      const accepted = trackData?.data?.accepted || [];

      for (const pkg of accepted) {
        const trackingNo = pkg.number;
        const stage = pkg.track_info?.latest_status?.status || '';
        const lastEvent = (pkg.track_info?.latest_event?.description || '').toLowerCase();
        const pedido = rastreioMap[trackingNo];
        if (!pedido) continue;

        let novoStatus = null;
        let motivo = '';

        if (stage === 'Delivered') {
          novoStatus = 'entregue';
        } else if (['InTransit','PickedUp','InfoReceived','Received'].includes(stage)) {
          novoStatus = 'transito';
        } else if (['Undelivered','Exception','Alert','NotDelivered'].includes(stage)) {
          if (lastEvent.includes('receita') || lastEvent.includes('aduaneiro') || lastEvent.includes('alfand')) {
            novoStatus = 'atencao'; motivo = 'Retido — Receita Federal';
          } else if (lastEvent.includes('autenticidade') || lastEvent.includes('marca')) {
            novoStatus = 'atencao'; motivo = 'Autenticidade da marca';
          } else if (lastEvent.includes('nao autorizada') || lastEvent.includes('não autorizada')) {
            novoStatus = 'atencao'; motivo = 'Importação não autorizada';
          } else if (lastEvent.includes('devolvido') || lastEvent.includes('retorno')) {
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

        const prioridade = { aguardando: 0, transito: 1, reenviado: 2, atencao: 3, devolvido: 3, extraviado: 3, entregue: 4 };
        if ((prioridade[novoStatus] ?? 0) >= (prioridade[pedido.status] ?? 0)) {
          const updateObj = { status: novoStatus };
          if (motivo) updateObj.motivo = motivo;
          await fetch(`${SUPA_URL}/rest/v1/pedidos?id=eq.${pedido.id}`, {
            method: 'PATCH', headers: SH, body: JSON.stringify(updateObj)
          });
          atualizados++;
        }
      }
    }

    res.status(200).json({ ok: true, atualizados, total: codigos.length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
