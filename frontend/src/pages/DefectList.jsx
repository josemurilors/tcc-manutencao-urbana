import { useEffect, useState, useCallback, useRef } from 'react';
import { Handshake, Calendar, User as UserIcon, MapPin, Camera, ThumbsUp, X, CaretUp, CaretDown, FilePdf } from '@phosphor-icons/react';
import { motion, AnimatePresence } from 'framer-motion';
import { api } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/toast-context';
import { StatusBadge } from '../components/ui/status-badge';
import { STATUS_ABERTOS, STATUS_FECHADOS } from '../components/ui/status-utils';
import { Timeline } from '../components/ui/timeline';
import { cn } from '../lib/utils';
import { Button } from '../components/ui/button';
import { FilterChips } from '../components/ui/filter-chips';
import { getTimelineItems } from '../utils/timeline';

export default function DefectList() {
  const { isAuthenticated, user } = useAuth();
  const addToast = useToast();
  const [defeitos, setDefeitos] = useState([]);
  const [meusDefeitos, setMeusDefeitos] = useState([]);
  const [filtro, setFiltro] = useState('todos');
  const [loading, setLoading] = useState(true);
  const [atendendo, setAtendendo] = useState(null);
  const [respondendo, setRespondendo] = useState(null);
  const [finalizando, setFinalizando] = useState(null);
  const [apoiando, setApoiando] = useState(null);
  const [selectedDefect, setSelectedDefect] = useState(null);
  const [apoiei, setApoiei] = useState(new Set());
  const [selectedImage, setSelectedImage] = useState(null);
  const [ordemCol, setOrdemCol] = useState('criado_em');
  const [ordemDir, setOrdemDir] = useState('desc');
  const anexarRef = useRef(null);
  const finalizarFotoRef = useRef(null);
  const finalizarIdRef = useRef(null);
  const [anexando, setAnexando] = useState(null);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [batchStatusPending, setBatchStatusPending] = useState(null);
  const [enviandoBatch, setEnviandoBatch] = useState(false);
  const [gerandoOS, setGerandoOS] = useState(null);

  // Rejeitar fica fora do lote: o backend exige motivo por chamado.
  const BATCH_STATUS_OPTIONS = [
    ['em_analise', 'Em triagem'],
    ['agendado', 'Programado'],
    ['em_andamento', 'Em execução'],
    ['concluido', 'Concluir'],
  ];

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([
      api.listDefeitos(),
      isAuthenticated ? api.meusDefeitos() : Promise.resolve([]),
    ]).then(([defs, meus]) => { if (!cancelled) { setDefeitos(defs); setMeusDefeitos(meus || []); } })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [isAuthenticated]);

  useEffect(() => {
    if (!isAuthenticated) return;
    let cancelled = false;
    api.apoiei().then(r => { if (!cancelled) setApoiei(new Set(r.ids)); }).catch(() => {});
    return () => { cancelled = true; };
  }, [isAuthenticated]);

  useEffect(() => {
  }, [selectedDefect]);

  const handleAtender = useCallback(async (id, e) => {
    e?.stopPropagation();
    setAtendendo(id);
    try {
      await api.atenderDefeito(id);
      addToast('Chamado vinculado com sucesso!');
      const atualizado = { status: 'em_andamento', atendente_id: user?.id };
      setDefeitos(prev => prev.map(d => d.id === id ? { ...d, ...atualizado } : d));
      setSelectedDefect(prev => prev?.id === id ? { ...prev, ...atualizado } : prev);
    } catch (err) { addToast('Erro: ' + err.message, 'error'); }
    finally { setAtendendo(null); }
  }, [addToast, user]);

  // Resposta pública não muda status: vai pelo endpoint próprio da operação.
  const handleResponder = useCallback(async (id, e) => {
    e?.stopPropagation();
    const texto = window.prompt('Resposta pública ao cidadão:')?.trim();
    if (!texto) return;
    setRespondendo(id);
    try {
      await api.responderDefeito(id, texto);
      addToast('Resposta registrada!');
      setDefeitos(prev => prev.map(d => d.id === id ? { ...d, resposta_publica: texto } : d));
      setSelectedDefect(prev => prev?.id === id ? { ...prev, resposta_publica: texto } : prev);
    } catch (err) { addToast('Erro: ' + err.message, 'error'); }
    finally { setRespondendo(null); }
  }, [addToast]);

  // Finalizar pede a foto do serviço feito (o município pode exigir) e manda no /status/.
  const handleFinalizar = useCallback((id, e) => {
    e?.stopPropagation();
    finalizarIdRef.current = id;
    finalizarFotoRef.current?.click();
  }, []);

  const handleFinalizarFoto = useCallback(async (e) => {
    const foto = e.target.files?.[0];
    const id = finalizarIdRef.current;
    e.target.value = '';
    if (!foto || !id) return;
    const resposta = window.prompt('Resposta pública ao concluir (opcional):');
    if (resposta === null) return;
    setFinalizando(id);
    try {
      const fd = new FormData();
      fd.append('status', 'concluido');
      fd.append('foto_resolucao', foto);
      if (resposta.trim()) fd.append('resposta_publica', resposta.trim());
      const d = await api.updateDefeitoComArquivo(id, fd);
      addToast('Chamado concluído!');
      setDefeitos(prev => prev.map(x => x.id === id ? { ...x, ...d } : x));
      setSelectedDefect(prev => prev?.id === id ? { ...prev, ...d } : prev);
    } catch (err) { addToast('Erro: ' + err.message, 'error'); }
    finally { setFinalizando(null); }
  }, [addToast]);

  const handleApoiar = useCallback(async (id) => {
    setApoiando(id);
    try {
      const res = await api.apoiarDefeito(id);
      setApoiei(prev => {
        const next = new Set(prev);
        if (res.apoiado) next.add(id); else next.delete(id);
        return next;
      });
      if (res.apoiado) {
        addToast('Apoio registrado!');
        setDefeitos(prev => prev.map(d => d.id === id ? { ...d, total_apoios: (d.total_apoios || 0) + 1 } : d));
        setSelectedDefect(prev => prev?.id === id ? { ...prev, total_apoios: (prev.total_apoios || 0) + 1 } : prev);
      } else {
        addToast('Apoio removido.');
        setDefeitos(prev => prev.map(d => d.id === id ? { ...d, total_apoios: Math.max(0, (d.total_apoios || 0) - 1) } : d));
        setSelectedDefect(prev => prev?.id === id ? { ...prev, total_apoios: Math.max(0, (prev.total_apoios || 0) - 1) } : prev);
      }
    } catch (err) { addToast('Erro: ' + err.message, 'error'); }
    finally { setApoiando(null); }
  }, [addToast]);

  const handleAnexarClick = useCallback((id) => {
    setSelectedDefect(null);
    document.getElementById(`anexar-${id}`)?.click();
  }, []);

  const handleAnexarFile = useCallback(async (id, e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setAnexando(id);
    try {
      await api.anexarImagem(id, f);
      addToast('Imagem anexada!');
      const d = await api.detalharDefeito(id);
      setDefeitos(prev => prev.map(x => x.id === d.id ? d : x));
    } catch (err) { addToast('Erro: ' + err.message, 'error'); }
    finally { setAnexando(null); e.target.value = ''; }
  }, [addToast]);

  function toggleSelecao(id) {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleSelecaoTudo() {
    setSelectedIds(prev => {
      const visiveis = sorted.map(d => d.id);
      const todosSelecionados = visiveis.length > 0 && visiveis.every(id => prev.has(id));
      const next = new Set(prev);
      if (todosSelecionados) {
        visiveis.forEach(id => next.delete(id));
      } else {
        visiveis.forEach(id => next.add(id));
      }
      return next;
    });
  }

  const handleBatchConfirm = useCallback(async () => {
    if (!batchStatusPending || selectedIds.size === 0) return;
    setEnviandoBatch(true);
    try {
      const res = await api.batchStatusDefeitos([...selectedIds], batchStatusPending);
      const falhas = Object.keys(res.erros || {});
      addToast(`Status atualizado em ${res.updated} chamado(s)!`);
      if (falhas.length) addToast(`${falhas.length} não mudaram: ${Object.values(res.erros)[0]}`, 'error');
      setDefeitos(prev => prev.map(d => selectedIds.has(d.id) && !falhas.includes(String(d.id)) ? { ...d, status: batchStatusPending } : d));
      setSelectedIds(new Set());
      setBatchStatusPending(null);
    } catch (err) { addToast('Erro: ' + err.message, 'error'); }
    finally { setEnviandoBatch(false); }
  }, [addToast, batchStatusPending, selectedIds]);

  const handleGerarOS = useCallback(async (id, e) => {
    e?.stopPropagation();
    setGerandoOS(id);
    try {
      await api.gerarOS(id);
      addToast('Ordem de Serviço gerada!');
    } catch (err) { addToast('Erro: ' + err.message, 'error'); }
    finally { setGerandoOS(null); }
  }, [addToast]);

  const filtrados = defeitos.filter(d => {
    if (filtro === 'todos') return true;
    if (filtro === 'abertos') return STATUS_ABERTOS.includes(d.status);
    if (filtro === 'encerrados') return STATUS_FECHADOS.includes(d.status);
    if (filtro === 'vinculados') return d.atendente_id != null;
    if (filtro === 'meus') return meusDefeitos.some(m => m.id === d.id);
    return true;
  });

  const sorted = [...filtrados].sort((a, b) => {
    let va, vb;
    if (ordemCol === 'criado_em') { va = a.criado_em; vb = b.criado_em; }
    else if (ordemCol === 'total_apoios') { va = a.total_apoios || 0; vb = b.total_apoios || 0; }
    else if (ordemCol === 'titulo') { va = a.titulo?.toLowerCase(); vb = b.titulo?.toLowerCase(); }
    else if (ordemCol === 'status') { va = a.status; vb = b.status; }
    else return 0;
    if (va < vb) return ordemDir === 'asc' ? -1 : 1;
    if (va > vb) return ordemDir === 'asc' ? 1 : -1;
    return 0;
  });

  function toggleSort(col) {
    if (ordemCol === col) setOrdemDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setOrdemCol(col); setOrdemDir('desc'); }
  }

  function renderSortIcon(col) {
    if (ordemCol !== col) return null;
    return ordemDir === 'asc' ? <CaretUp size={11} /> : <CaretDown size={11} />;
  }

  const isAdmin = user?.admin;

  return (
    <div className="p-5 max-w-6xl mx-auto">
      <h1 className="text-lg font-bold mb-1" style={{ color: 'var(--color-text-primary)' }}>Lista de Chamados</h1>
      <p className="text-sm mb-4" style={{ color: 'var(--color-text-muted)' }}>Acompanhe todos os chamados de serviços públicos</p>

      <FilterChips label="Filtrar chamados" className="mb-4" value={filtro} onChange={setFiltro}
        options={[['todos','Todos'],['abertos','Abertos'],['encerrados','Encerrados'],['vinculados','Vinculados'],['meus','Meus Chamados']]
          .filter(([k]) => (isAuthenticated || k !== 'meus') && (isAdmin || k !== 'vinculados'))
          .map(([value, label]) => ({ value, label }))} />

      {loading ? (
        <div className="h-40 rounded-md border animate-pulse" style={{ background: 'var(--color-bg-surface)', borderColor: 'var(--color-border-default)' }} />
      ) : sorted.length === 0 ? (
        <div className="text-center py-12 text-sm" style={{ color: 'var(--color-text-muted)' }}>Nenhum chamado encontrado.</div>
      ) : (
        <div className="overflow-x-auto rounded-md border" style={{ borderColor: 'var(--color-border-default)' }}>
          <table className="w-full text-sm" style={{ color: 'var(--color-text-primary)' }}>
            <thead>
              <tr style={{ background: 'var(--color-bg-elevated)' }}>
                {isAdmin && (
                  <th className="px-3 py-2.5 w-8">
                    <input type="checkbox" aria-label="Selecionar todos os chamados"
                      checked={sorted.length > 0 && sorted.every(d => selectedIds.has(d.id))}
                      onChange={toggleSelecaoTudo}
                      style={{ accentColor: 'var(--color-gold-500)', cursor: 'pointer' }} />
                  </th>
                )}
                <th className="px-3 py-2.5 text-left font-semibold whitespace-nowrap cursor-pointer select-none" onClick={() => toggleSort('status')} style={{ color: 'var(--color-text-muted)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  Status {renderSortIcon("status")}
                </th>
                <th className="px-3 py-2.5 text-left font-semibold whitespace-nowrap cursor-pointer select-none" onClick={() => toggleSort('titulo')} style={{ color: 'var(--color-text-muted)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  Título {renderSortIcon("titulo")}
                </th>
                <th className="px-3 py-2.5 text-left font-semibold whitespace-nowrap hidden md:table-cell" style={{ color: 'var(--color-text-muted)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  Categoria
                </th>
                <th className="px-3 py-2.5 text-left font-semibold whitespace-nowrap hidden sm:table-cell" style={{ color: 'var(--color-text-muted)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  Autor
                </th>
                <th className="px-3 py-2.5 text-left font-semibold whitespace-nowrap cursor-pointer select-none hidden md:table-cell" onClick={() => toggleSort('criado_em')} style={{ color: 'var(--color-text-muted)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  Data {renderSortIcon("criado_em")}
                </th>
                <th className="px-3 py-2.5 text-right font-semibold whitespace-nowrap cursor-pointer select-none" onClick={() => toggleSort('total_apoios')} style={{ color: 'var(--color-text-muted)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  <ThumbsUp size={11} /> {renderSortIcon("total_apoios")}
                </th>
                <th className="px-3 py-2.5 text-right font-semibold whitespace-nowrap" style={{ color: 'var(--color-text-muted)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  Ações
                </th>
              </tr>
            </thead>
            <tbody>
              {sorted.map(d => (
                <tr key={d.id} className="cursor-pointer transition-colors hover:opacity-80"
                  style={{ borderTop: '1px solid var(--color-border-default)' }}
                  onClick={() => {
                    setSelectedDefect(d);
                    api.detalharDefeito(d.id).then(full => setSelectedDefect(full)).catch(() => {});
                  }}>
                  {isAdmin && (
                    <td className="px-3 py-3 w-8" onClick={e => e.stopPropagation()}>
                      <input type="checkbox" aria-label={`Selecionar chamado ${d.titulo}`}
                        checked={selectedIds.has(d.id)}
                        onChange={() => toggleSelecao(d.id)}
                        style={{ accentColor: 'var(--color-gold-500)', cursor: 'pointer' }} />
                    </td>
                  )}
                  <td className="px-3 py-3 whitespace-nowrap">
                    <span className="inline-flex items-center gap-1.5">
                      <StatusBadge status={d.status} concluido_em={d.atendido_em || d.atualizado_em} />
                      {d.sla_vencido && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-xs font-semibold"
                          style={{ borderColor: 'var(--color-error)', color: 'var(--color-error)', background: 'rgba(207,68,68,0.1)' }}>
                          SLA VENCIDO
                        </span>
                      )}
                    </span>
                  </td>
                  <td className="px-3 py-3 max-w-[200px]">
                    <span className="text-sm font-medium truncate block" style={{ color: 'var(--color-text-primary)' }}>{d.titulo}</span>
                  </td>
                  <td className="px-3 py-3 whitespace-nowrap hidden md:table-cell">
                    <span className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>{d.categoria_nome || d.categoria || '—'}</span>
                  </td>
                  <td className="px-3 py-3 whitespace-nowrap hidden sm:table-cell">
                    <span className="text-xs flex items-center gap-1" style={{ color: 'var(--color-text-muted)' }}>
                      <UserIcon size={11} />{d.usuario?.nome ? `${d.usuario.nome.charAt(0)}${'*'.repeat(Math.max(d.usuario.nome.length - 1, 2))}` : d.autor_nome || 'Anônimo'}
                    </span>
                  </td>
                  <td className="px-3 py-3 whitespace-nowrap hidden md:table-cell" style={{ color: 'var(--color-text-muted)', fontSize: 12 }}>
                    <span className="flex items-center gap-1"><Calendar size={11} />{new Date(d.criado_em).toLocaleDateString()}</span>
                  </td>
                  <td className="px-3 py-3 text-right whitespace-nowrap">
                    <span className="text-xs font-medium" style={{ color: apoiei.has(d.id) ? 'var(--color-gold-500)' : 'var(--color-text-muted)' }}>{d.total_apoios || 0}</span>
                  </td>
                  <td className="px-3 py-3 text-right whitespace-nowrap">
                    <div className="flex items-center justify-end gap-1" onClick={e => e.stopPropagation()}>
                      <button onClick={() => handleApoiar(d.id)} disabled={apoiando === d.id}
                        className="w-7 h-7 rounded-md flex items-center justify-center transition-colors disabled:opacity-50 hover:bg-[var(--color-bg-hover)]"
                        style={{ color: apoiei.has(d.id) ? 'var(--color-gold-500)' : 'var(--color-text-muted)' }}
                        title={apoiei.has(d.id) ? 'Remover apoio' : 'Apoiar'}>
                        <ThumbsUp size={13} weight={apoiei.has(d.id) ? 'fill' : 'regular'} />
                      </button>
                      {isAdmin && !d.atendente_id && STATUS_ABERTOS.includes(d.status) && (
                        <Button variant="secondary" size="xs" onClick={e => handleAtender(d.id, e)} disabled={atendendo === d.id}>
                          <Handshake size={11} /> {atendendo === d.id ? '...' : 'Atender'}
                        </Button>
                      )}
                      {isAdmin && d.atendente_id && STATUS_ABERTOS.includes(d.status) && (
                        <Button variant="secondary" size="xs" onClick={e => handleResponder(d.id, e)} disabled={respondendo === d.id}>
                          {respondendo === d.id ? '...' : 'Responder'}
                        </Button>
                      )}
                      {isAdmin && d.atendente_id && STATUS_ABERTOS.includes(d.status) && (
                        <Button variant="danger" size="xs" onClick={e => handleFinalizar(d.id, e)} disabled={finalizando === d.id}>
                          {finalizando === d.id ? '...' : 'Finalizar'}
                        </Button>
                      )}
                      <button onClick={() => handleAnexarClick(d.id)}
                        className="w-7 h-7 rounded-md flex items-center justify-center transition-colors hover:bg-[var(--color-bg-hover)]"
                        style={{ color: 'var(--color-text-muted)' }}
                        title="Anexar imagem">
                        <Camera size={13} />
                      </button>
                      {isAdmin && (
                        <button onClick={e => handleGerarOS(d.id, e)} disabled={gerandoOS === d.id}
                          className="w-7 h-7 rounded-md flex items-center justify-center transition-colors disabled:opacity-50 hover:bg-[var(--color-bg-hover)]"
                          style={{ color: 'var(--color-text-muted)' }}
                          title="Gerar Ordem de Serviço (PDF)">
                          {gerandoOS === d.id ? '...' : <FilePdf size={13} />}
                        </button>
                      )}
                      <input id={`anexar-${d.id}`} type="file" accept="image/jpeg,image/png,image/webp" className="hidden"
                        onChange={e => handleAnexarFile(d.id, e)} />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {isAdmin && selectedIds.size > 0 && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[1500] flex items-center gap-3 px-4 py-2.5 rounded-lg border"
          style={{ background: 'rgba(10,10,10,0.95)', borderColor: 'rgba(180,140,50,0.4)', boxShadow: '0 8px 30px rgba(0,0,0,0.5)' }}>
          <span className="text-sm font-semibold whitespace-nowrap" style={{ color: 'var(--color-gold-text)' }}>
            {selectedIds.size} selecionado{selectedIds.size === 1 ? '' : 's'}
          </span>
          <span className="w-px h-5" style={{ background: 'var(--color-border-default)' }} />
          <FilterChips label="Novo status do lote" value={batchStatusPending} onChange={setBatchStatusPending} disabled={enviandoBatch}
            options={BATCH_STATUS_OPTIONS.map(([value, label]) => ({ value, label }))} />
          {batchStatusPending && (
            <div className="flex items-center gap-1.5">
              <span className="w-px h-5" style={{ background: 'var(--color-border-default)' }} />
              <span className="text-xs whitespace-nowrap" style={{ color: 'var(--color-text-muted)' }}>
                Aplicar "{BATCH_STATUS_OPTIONS.find(([v]) => v === batchStatusPending)?.[1]}" em {selectedIds.size}?
              </span>
              <Button variant="secondary" size="xs" onClick={handleBatchConfirm} disabled={enviandoBatch}
                className="flex items-center gap-1">
                {enviandoBatch ? '...' : 'Confirmar'}
              </Button>
              <Button variant="ghost" size="xs" onClick={() => setBatchStatusPending(null)} disabled={enviandoBatch}>Voltar</Button>
            </div>
          )}
          <span className="w-px h-5" style={{ background: 'var(--color-border-default)' }} />
          <button onClick={() => { setSelectedIds(new Set()); setBatchStatusPending(null); }}
            className="text-xs font-medium whitespace-nowrap transition-colors text-[var(--color-text-muted)] hover:text-[var(--color-error)]">
            Cancelar
          </button>
        </div>
      )}

      <AnimatePresence>
        {selectedDefect && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[2000] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
            onClick={() => setSelectedDefect(null)}>
            <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
              className="w-full max-w-lg rounded-lg border p-6 max-h-[85vh] overflow-y-auto" style={{ background: 'var(--color-bg-surface)', borderColor: 'rgba(180,140,50,0.3)' }}
              onClick={e => e.stopPropagation()}>
              <div className="flex items-start justify-between mb-4">
                <div className="flex-1 min-w-0 pr-3">
                  <h3 className="text-base font-semibold" style={{ color: 'var(--color-text-primary)' }}>{selectedDefect.titulo}</h3>
                  <div className="flex items-center gap-2 mt-1">
                    <StatusBadge status={selectedDefect.status} concluido_em={selectedDefect.atendido_em || selectedDefect.atualizado_em} />
                    {selectedDefect.sla_vencido && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-xs font-semibold"
                        style={{ borderColor: 'var(--color-error)', color: 'var(--color-error)', background: 'rgba(207,68,68,0.1)' }}>
                        SLA VENCIDO
                      </span>
                    )}
                    <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                      {selectedDefect.usuario?.nome ? `${selectedDefect.usuario.nome.charAt(0)}${'*'.repeat(selectedDefect.usuario.nome.length - 1)}` : 'Anônimo'}
                    </span>
                  </div>
                </div>
                <button onClick={() => setSelectedDefect(null)} className="w-7 h-7 rounded-full flex items-center justify-center shrink-0 transition-colors hover:bg-[var(--color-bg-hover)]"
                  style={{ color: 'var(--color-text-muted)' }}>
                  <X size={14} />
                </button>
              </div>
              <p className="text-sm mb-3" style={{ color: 'var(--color-text-secondary)', lineHeight: 1.6 }}>{selectedDefect.descricao}</p>
              <div className="flex flex-wrap gap-3 mb-4 text-xs" style={{ color: 'var(--color-text-muted)' }}>
                <span className="flex items-center gap-1"><Calendar size={12} /> {new Date(selectedDefect.criado_em).toLocaleDateString()}</span>
                {selectedDefect.latitude && <span className="flex items-center gap-1"><MapPin size={12} /> {selectedDefect.latitude.toFixed(4)}, {selectedDefect.longitude.toFixed(4)}</span>}
                {selectedDefect.total_apoios > 0 && <span className="flex items-center gap-1"><ThumbsUp size={12} /> {selectedDefect.total_apoios} apoios</span>}
              </div>
              {selectedDefect.imagem_thumbnail && (
                <img src={selectedDefect.imagem_thumbnail} alt="" className="w-full h-40 object-cover rounded-md mb-4 cursor-pointer"
                  onClick={() => setSelectedImage(selectedDefect.imagem_thumbnail)} />
              )}
              {selectedDefect.imagens_extra && (() => {
                try { return JSON.parse(selectedDefect.imagens_extra); } catch { return []; }
              })().map((url, i) => (
                <img key={i} src={url} alt="" className="w-full h-40 object-cover rounded-md mb-3 cursor-pointer"
                  onClick={() => setSelectedImage(url)} />
              ))}
              <div className="mb-4">
                <h4 className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--color-text-muted)' }}>Histórico</h4>
                <Timeline items={getTimelineItems(selectedDefect)} />
              </div>
              <div className="flex gap-2">
                {user?.admin && !selectedDefect.atendente_id && STATUS_ABERTOS.includes(selectedDefect.status) && (
                  <Button variant="secondary" onClick={e => handleAtender(selectedDefect.id, e)} disabled={atendendo === selectedDefect.id}
                    className="flex items-center gap-1.5">
                    <Handshake size={14} /> {atendendo === selectedDefect.id ? '...' : 'Atender Chamado'}
                  </Button>
                )}
                {user?.admin && selectedDefect.atendente_id && STATUS_ABERTOS.includes(selectedDefect.status) && (
                  <Button variant="secondary" onClick={e => handleResponder(selectedDefect.id, e)} disabled={respondendo === selectedDefect.id}
                    className="flex items-center gap-1.5">
                    {respondendo === selectedDefect.id ? '...' : 'Responder'}
                  </Button>
                )}
                {user?.admin && selectedDefect.atendente_id && STATUS_ABERTOS.includes(selectedDefect.status) && (
                  <Button variant="danger" onClick={e => handleFinalizar(selectedDefect.id, e)} disabled={finalizando === selectedDefect.id}
                    className="flex items-center gap-1.5">
                    {finalizando === selectedDefect.id ? '...' : 'Finalizar'}
                  </Button>
                )}
                {user?.admin && (
                  <Button variant="secondary" onClick={e => handleGerarOS(selectedDefect.id, e)} disabled={gerandoOS === selectedDefect.id}
                    className="flex items-center gap-1.5">
                    <FilePdf size={14} /> {gerandoOS === selectedDefect.id ? '...' : 'Gerar OS'}
                  </Button>
                )}
                <Button variant="secondary" onClick={() => handleApoiar(selectedDefect.id)} disabled={apoiando === selectedDefect.id}
                  aria-pressed={apoiei.has(selectedDefect.id)}
                  className={cn('flex-1', apoiei.has(selectedDefect.id) && 'bg-[var(--color-gold-muted)]')}>
                  <ThumbsUp size={14} weight={apoiei.has(selectedDefect.id) ? 'fill' : 'regular'} />
                  {apoiando === selectedDefect.id ? '...' : apoiei.has(selectedDefect.id) ? 'Apoiado' : 'Apoiar'}
                </Button>
                <Button variant="outline" onClick={() => handleAnexarClick(selectedDefect.id)} disabled={anexando === selectedDefect.id}
                  className="flex-1">
                  <Camera size={14} /> {anexando === selectedDefect.id ? 'Enviando...' : 'Anexar'}
                </Button>
                <input ref={anexarRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden"
                  onChange={async e => {
                    const f = e.target.files?.[0];
                    if (!f) return;
                    setAnexando(selectedDefect.id);
                    try {
                      await api.anexarImagem(selectedDefect.id, f);
                      addToast('Imagem anexada!');
                      const d = await api.detalharDefeito(selectedDefect.id);
                      setSelectedDefect(d);
                      setDefeitos(prev => prev.map(x => x.id === d.id ? d : x));
                    } catch (err) { addToast('Erro: ' + err.message, 'error'); }
                    finally { setAnexando(null); e.target.value = ''; }
                  }} />
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
      <input ref={finalizarFotoRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden"
        aria-label="Foto do serviço concluído" onChange={handleFinalizarFoto} />
      {selectedImage && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/80 cursor-pointer"
          onClick={() => setSelectedImage(null)}>
          <img src={selectedImage} alt="" className="max-w-[90vw] max-h-[90vh] object-contain rounded-md"
            onClick={e => e.stopPropagation()} />
          <button onClick={() => setSelectedImage(null)}
            className="absolute top-4 right-4 w-10 h-10 rounded-full flex items-center justify-center text-white bg-black/40 hover:bg-black/60 transition-colors text-xl">
            ✕
          </button>
        </div>
      )}
    </div>
  );
}
