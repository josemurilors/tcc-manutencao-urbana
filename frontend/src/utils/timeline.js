function maskName(nome) {
  if (!nome) return 'Anônimo';
  return `${nome.charAt(0)}${'*'.repeat(Math.max(nome.length - 1, 2))}`;
}

export function getTimelineItems(d) {
  const items = [{ id: 'criado', active: true, title: 'Chamado Criado', description: d.descricao?.slice(0, 120), date: new Date(d.criado_em).toLocaleString(), meta: `Por ${maskName(d.usuario?.nome)}` }];
  if (d.atendente_id || d.tem_atendente)
    items.push({ id: 'vinculado', active: true, title: 'Profissional Vinculado', date: d.atualizado_em ? new Date(d.atualizado_em).toLocaleString() : undefined });
  if (d.resposta_publica)
    items.push({ id: 'resposta', active: true, title: 'Resposta Enviada', description: d.resposta_publica.slice(0, 120) });
  if (d.status === 'concluido')
    items.push({ id: 'concluido', active: true, title: 'Chamado Concluído', date: d.atendido_em ? new Date(d.atendido_em).toLocaleString() : undefined });
  if (d.status === 'rejeitado')
    items.push({ id: 'rejeitado', active: true, title: 'Chamado Rejeitado' });
  return items;
}
