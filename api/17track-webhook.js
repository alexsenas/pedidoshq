export default async function handler(req, res) {
  res.status(200).json({ ok: true });
  if (req.method !== 'POST') return;

  const SUPA_URL = process.env.SUPA_URL;
  const SUPA_KEY = process.env.SUPA_KEY;
  const SH = { 'Content-Type': 'application/json', 'apikey': SUPA_KEY, 'Authorization': 'Bearer ' + SUPA_KEY };

  const PRI = { aguardando:0, novo:0, transito:1, reenviado:2, retirada:2, taxado:3, atencao:3, devolvido:3, extraviado:3, entregue:4 };

  function temChines(texto) {
    return /[\u4e00-\u9fff]/.test(texto);
  }

  async function traduzir(texto) {
    if (!temChines(texto)) return texto;
    try {
      const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=zh&tl=pt&dt=t&q=${encodeURIComponent(texto)}`;
      const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      const d = await r.json();
      return d?.[0]?.[0]?.[0] || texto;
    } catch { return texto; }
  }

  function mapear(stage, sub, ev, todosEventos) {
    const e = ev.toLowerCase();
    const historico = todosEventos.join(' ').toLowerCase();
    const pagamentoNaoEfetuado = historico.includes('pagamento não efetuado') || historico.includes('pagamento nao efetuado');

    // ENTREGUE
    if (stage === 'Delivered' || e.includes('entregue ao destinatário') || e.includes('recebido por') || e.includes('assinar pelo próprio'))
      return ['entregue', '', ev];

    // AGUARDANDO RETIRADA
    if (stage === 'AvailableForPickup' || e.includes('aguardando retirada') || e.includes('caixa postal'))
      return ['retirada', 'Objeto aguardando retirada', ev];

    // TAXADO
    if (sub === 'InTransit_CustomsRequiringInformation' || e.includes('aguardando pagamento') || e.includes('retidas na alfândega aguardando inspeção'))
      return ['taxado', 'Aguardando pagamento de taxas', ev];

    if (e.includes('pagamento confirmado'))
      return ['taxado', 'Taxa paga', ev];

    // ATENÇÃO — pagamento não efetuado
    if (e.includes('pagamento não efetuado no prazo') || e.includes('pagamento nao efetuado no prazo'))
      return ['atencao', 'Pagamento não efetuado no prazo — pedido perdido', ev];

    // ATENÇÃO — devolução
    if (e.includes('devolução determinada') || e.includes('devolucao determinada'))
      return pagamentoNaoEfetuado
        ? ['atencao', 'Devolução determinada — pagamento não efetuado', ev]
        : ['atencao', 'Devolução determinada — pedido para reenviar', ev];

    // ATENÇÃO — devolvido ao país
    if (e.includes('devolvido ao país de origem') || e.includes('objeto entregue ao remetente') || stage === 'Exception_Returned')
      return pagamentoNaoEfetuado
        ? ['atencao', 'Pedido devolvido — pagamento não efetuado', ev]
        : ['atencao', 'Pedido devolvido — para reenviar', ev];

    // ATENÇÃO — cliente recusou em PR
    if (e.includes('destinatário recusou') && e.includes(', pr'))
      return ['atencao', 'Cliente recusou a taxação — pedido retido em Curitiba', ev];

    // ATENÇÃO — destinatário recusou na entrega
    if (e.includes('destinatário recusou'))
      return ['atencao', 'Destinatário recusou o objeto na entrega', ev];

    // ATENÇÃO — autenticidade
    if (e.includes('autenticidade da marca') || e.includes('verificação de autenticidade'))
      return ['atencao', 'Objeto retido — verificação de autenticidade da marca', ev];

    // ATENÇÃO — importação não autorizada
    if (e.includes('importação não autorizada') || sub === 'Exception_Security')
      return ['atencao', 'Importação não autorizada — pedido para reenviar', ev];

    // ATENÇÃO — falta de informações
    if (e.includes('falta de envio de informações') || e.includes('falta de informações'))
      return ['atencao', 'Objeto em devolução — falta de informações', ev];

    // ATENÇÃO — fiscalização
    if (e.includes('selecionado para fiscalização') || e.includes('objeto em fiscalização'))
      return ['atencao', 'Objeto selecionado para fiscalização — aguardando resultado', ev];

    if (e.includes('fiscalização aduaneira de exportação'))
      return ['atencao', 'Objeto encaminhado para fiscalização aduaneira', ev];

    // EM TRÂNSITO — saiu para entrega
    if (e.includes('saiu para entrega') || e.includes('entrega por transportadora'))
      return ['transito', 'Objeto saiu para entrega ao destinatário', ev];

    // EM TRÂNSITO — tentativa
    if (e.includes('tentativa de entrega não efetuada'))
      return ['transito', 'Tentativa de entrega não efetuada', ev];

    if (e.includes('carteiro não atendido') || e.includes('não entregue'))
      return ['transito', 'Objeto não entregue — carteiro não atendido', ev];

    // EM TRÂNSITO — dentro do Brasil
    if (e.includes('saída do centro internacional') || e.includes('desembaraçada pela aduana') ||
        e.includes('revisão de tributo concluída') || e.includes('pacote presente em trânsito no brasil') ||
        e.includes('voo pousou'))
      return ['transito', 'Objeto em trânsito de Curitiba para a cidade do cliente', ev];

    // EM TRÂNSITO — chegou ao Brasil
    if (e.includes('objeto recebido pelos correios do brasil') || e.includes('chegada ao destino') ||
        e.includes('chegada ao centro de processamento') || e.includes('submetido à alfândega de importação'))
      return ['transito', 'Objeto recebido pelos Correios do Brasil', ev];

    // EM TRÂNSITO — análise
    if (e.includes('análise concluída') && e.includes('importação autorizada'))
      return ['transito', 'Análise concluída — importação autorizada', ev];

    if (e.includes('informações enviadas para análise') || e.includes('iniciado o processo de desembaraço') ||
        e.includes('informações prestadas pelo cliente em análise'))
      return ['transito', 'Informações enviadas para análise aduaneira', ev];

    // EM TRÂNSITO — China/exterior
    if (['InTransit','InfoReceived','PickedUp','Received'].includes(stage) ||
        e.includes('objeto postado') || e.includes('objeto em transferência') ||
        e.includes('objeto recebido na unidade de exportação') || e.includes('detalhes do pacote recebido') ||
        e.includes('partiu do aeroporto') || e.includes('aviões chegando') ||
        e.includes('partida da companhia aérea') || e.includes('companhias aéreas recebem') ||
        e.includes('saem do centro de operações') || e.includes('pre alertado') ||
        e.includes('horário estimado de partida'))
      return ['transito', 'Objeto em trânsito do exterior para o Brasil', ev];

    // DESCONHECIDO — mantém texto original
    return [null, ev, ev];
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const packages = body?.data?.accepted || body?.data || [];
    const list = Array.isArray(packages) ? packages : [packages];

    for (const pkg of list) {
      const trackingNo = pkg.number;
      if (!trackingNo) continue;

      const ti = pkg.track_info || {};
      const stage = ti.latest_status?.status || '';
      const sub = ti.latest_status?.sub_status || '';
      let evOrig = ti.latest_event?.description || '';
      const ultimaData = ti.latest_event?.time_iso?.substring(0, 10) || '';

      evOrig = await traduzir(evOrig);

      const todosEventos = [];
      for (const prov of ti.tracking?.providers || []) {
        for (const e of prov.events || []) {
          if (e.description) todosEventos.push(await traduzir(e.description));
        }
      }

      const [ns, mot] = mapear(stage, sub, evOrig, todosEventos);

      const [r1, r2] = await Promise.all([
        fetch(`${SUPA_URL}/rest/v1/pedidos?rastreio1=eq.${encodeURIComponent(trackingNo)}&select=id,status`, { headers: SH }),
        fetch(`${SUPA_URL}/rest/v1/pedidos?rastreio2=eq.${encodeURIComponent(trackingNo)}&select=id,status`, { headers: SH })
      ]);
      const [d1, d2] = await Promise.all([r1.json(), r2.json()]);
      const pedido = d1[0] || d2[0];
      if (!pedido) continue;

      const upd = {};
      if (ultimaData) upd.atualizado_em = ultimaData;

      if (ns && (PRI[ns] ?? 0) >= (PRI[pedido.status] ?? 0)) {
        upd.status = ns;
        if (mot) upd.motivo = mot;
      }

      if (Object.keys(upd).length > 0) {
        await fetch(`${SUPA_URL}/rest/v1/pedidos?id=eq.${pedido.id}`, {
          method: 'PATCH', headers: SH, body: JSON.stringify(upd)
        });
      }
    }
  } catch (e) {
    console.error('17track webhook error:', e.message);
  }
}
