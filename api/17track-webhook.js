export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).end(); return; }

  const SUPA_URL = process.env.SUPA_URL;
  const SUPA_KEY = process.env.SUPA_KEY;
  const SH = { 'Content-Type': 'application/json', 'apikey': SUPA_KEY, 'Authorization': 'Bearer ' + SUPA_KEY };

  try {
    const body = req.body;
    const packages = body?.data?.accepted || body?.data || [];
    const list = Array.isArray(packages) ? packages : [packages];

    for (const pkg of list) {
      const trackingNo = pkg.number || pkg.tracking_number;
      const lastEvent = pkg.track_info?.latest_event?.description?.toLowerCase() || '';
      const stage = pkg.track_info?.latest_status?.status || '';

      if (!trackingNo) continue;

      // Mapear status do 17Track para nosso sistema
      let novoStatus = null;
      let motivo = '';

      if (stage === 'Delivered') {
        novoStatus = 'entregue';
      } else if (stage === 'PickedUp' || stage === 'InTransit') {
        novoStatus = 'transito';
      } else if (stage === 'Undelivered' || stage === 'Exception') {
        // Verificar motivos de atenção
        if (lastEvent.includes('receita') || lastEvent.includes('fiscal') || lastEvent.includes('aduaneiro') || lastEvent.includes('aduana')) {
          novoStatus = 'atencao';
          motivo = 'Retido — Receita Federal';
        } else if (lastEvent.includes('autenticidade') || lastEvent.includes('marca') || lastEvent.includes('contrafacao') || lastEvent.includes('falsif')) {
          novoStatus = 'atencao';
          motivo = 'Autenticidade da marca';
        } else if (lastEvent.includes('nao autorizada') || lastEvent.includes('não autorizada') || lastEvent.includes('importacao') || lastEvent.includes('importação')) {
          novoStatus = 'atencao';
          motivo = 'Importação não autorizada';
        } else if (lastEvent.includes('devolvido') || lastEvent.includes('retorno') || lastEvent.includes('devolution')) {
          novoStatus = 'devolvido';
          motivo = 'Devolvido ao remetente';
        } else if (lastEvent.includes('extravi') || lastEvent.includes('roubado') || lastEvent.includes('perdido')) {
          novoStatus = 'extraviado';
          motivo = 'Extraviado / roubado';
        } else {
          novoStatus = 'atencao';
          motivo = lastEvent.slice(0, 60) || 'Verificar rastreio';
        }
      } else if (stage === 'NotFound') {
        novoStatus = 'aguardando';
      }

      if (!novoStatus) continue;

      // Buscar pedido pelo rastreio1 ou rastreio2
      const r1 = await fetch(`${SUPA_URL}/rest/v1/pedidos?rastreio1=eq.${encodeURIComponent(trackingNo)}&select=id,status,motivo`, { headers: SH });
      const d1 = await r1.json();
      const r2 = await fetch(`${SUPA_URL}/rest/v1/pedidos?rastreio2=eq.${encodeURIComponent(trackingNo)}&select=id,status,motivo`, { headers: SH });
      const d2 = await r2.json();

      const pedido = d1[0] || d2[0];
      if (!pedido) continue;

      // Não rebaixar status — só atualizar se for mais relevante
      const prioridade = { aguardando: 0, transito: 1, reenviado: 2, atencao: 3, devolvido: 3, extraviado: 3, entregue: 4 };
      const priorAtual = prioridade[pedido.status] ?? 0;
      const priorNovo = prioridade[novoStatus] ?? 0;

      if (priorNovo >= priorAtual) {
        const updateObj = { status: novoStatus };
        if (motivo) updateObj.motivo = motivo;
        await fetch(`${SUPA_URL}/rest/v1/pedidos?id=eq.${pedido.id}`, {
          method: 'PATCH', headers: SH, body: JSON.stringify(updateObj)
        });
      }
    }

    res.status(200).json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
}
