import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend, LineChart, Line } from 'recharts';
import { ChartLineUp, Warning, WarningOctagon, Timer, Buildings, ChartBar, Article, Clock, CheckCircle, TrendUp } from '@phosphor-icons/react';
import { motion } from 'framer-motion';
import { api } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/toast-context';
import { getStatusColor, getStatusLabel } from '../components/ui/status-utils';
import { KpiCard } from '../components/ui/kpi-card';
import { StatusBadge } from '../components/ui/status-badge';
const GOLD = '#D4AF37', GOLD_DARK = '#AA7C11', SUCCESS = '#4CAF7D', ERROR = '#CF4444';

const impactoLabel = { alta: 'Alto', media: 'Médio', baixa: 'Baixo' };

function VariacaoBadge({ valor }) {
  if (valor == null) return <span className="text-xs font-bold" style={{ color: 'var(--color-text-muted)' }}>—</span>;
  if (valor > 0) return <span className="text-xs font-bold" style={{ color: SUCCESS }}>↑ {valor}%</span>;
  if (valor < 0) return <span className="text-xs font-bold" style={{ color: ERROR }}>↓ {Math.abs(valor)}%</span>;
  return <span className="text-xs font-bold" style={{ color: 'var(--color-text-muted)' }}>→ 0%</span>;
}

function ImpactoTag({ impacto }) {
  const c = impacto === 'alta' ? ERROR : impacto === 'media' ? GOLD : SUCCESS;
  return <span className="text-xs font-bold px-2 py-0.5 rounded-full uppercase" style={{ background: `${c}15`, color: c }}>{impactoLabel[impacto] || impacto}</span>;
}

export default function AdminDashboardMetrics() {
  const { user, isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const addToast = useToast();
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);

  const loadStats = useCallback(async () => {
    try { setStats(await api.adminEstatisticas()); }
    catch (err) { addToast('Erro ao carregar estatísticas: ' + err.message, 'error'); }
    finally { setLoading(false); }
  }, [addToast]);

  useEffect(() => { if (!isAuthenticated) { navigate('/login'); return; } if (!user?.admin) { navigate('/mapa'); return; } loadStats(); }, [isAuthenticated, user, navigate, loadStats]);

  if (loading) return <div className="flex items-center justify-center min-h-[50vh]"><div className="animate-pulse text-sm" style={{ color: 'var(--color-text-muted)' }}>Carregando...</div></div>;
  if (!stats) return null;

  const statusData = (stats.por_status || []).map(s => ({ name: getStatusLabel(s.status), value: s.total, color: getStatusColor(s.status) }));
  const catData = (stats.por_categoria || []).slice(0, 10);
  const tendenciaData = (stats.tendencia_mensal || []);
  const slaCatData = (stats.sla_por_categoria || []);
  const bairrosData = (stats.top_bairros || []);
  const recomendacoes = (stats.recomendacoes || []);
  const medias = stats.medias_moveis || {};
  const anomalias = (stats.anomalias || []);
  const mesesComparativo = [
    { name: 'Mês Anterior', total: stats.sazonalidade?.mes_anterior || 0 },
    { name: 'Mês Atual', total: stats.sazonalidade?.mes_atual || 0 },
  ];

  return (
    <div className="p-5 max-w-6xl mx-auto">
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="mb-6">
        <h1 className="text-lg font-bold mb-1" style={{ color: 'var(--color-text-primary)' }}>Dashboard de Métricas</h1>
        <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>Visão geral dos chamados de serviços públicos</p>
      </motion.div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
        <KpiCard title="Total de Chamados" value={stats.total} icon={Article} />
        <KpiCard title="Pendentes" value={stats.pendentes} icon={Clock} variation={stats.sazonalidade?.variacao_percentual} />
        <KpiCard title="Resolvidos" value={stats.resolvidos} icon={CheckCircle} />
        <KpiCard title="Taxa de Resolução" value={stats.taxa_resolucao} format="percent" icon={TrendUp} />
        <KpiCard title="Tempo Médio (SLA)" value={stats.sla_medio_minutos < 60 ? `${stats.sla_medio_minutos}min` : `${(stats.sla_medio_minutos / 60).toFixed(1)}h`} format="time" icon={Timer} />
        <KpiCard title="Este Mês" value={stats.sazonalidade?.mes_atual || 0} icon={ChartBar} variation={stats.sazonalidade?.variacao_percentual} />
        <KpiCard title="SLA Vencidos" value={stats.sla_vencidos_total || 0} icon={WarningOctagon} className="!before:bg-[var(--color-error)]" />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        <div className="rounded-xl border p-5" style={{ background: 'var(--color-bg-surface)', borderColor: 'var(--color-border-default)' }}>
          <h3 className="text-sm font-semibold mb-4" style={{ color: 'var(--color-text-primary)' }}>Chamados por Status</h3>
          <ResponsiveContainer width="100%" height={260}>
            <PieChart>
              <Pie data={statusData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={90} label={({ name, value }) => `${name}: ${value}`}>
                {statusData.map((e, i) => <Cell key={i} fill={e.color} />)}
              </Pie>
              <Tooltip /><Legend />
            </PieChart>
          </ResponsiveContainer>
        </div>
        <div className="rounded-xl border p-5" style={{ background: 'var(--color-bg-surface)', borderColor: 'var(--color-border-default)' }}>
          <h3 className="text-sm font-semibold mb-4" style={{ color: 'var(--color-text-primary)' }}>Comparativo Mensal</h3>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={mesesComparativo}><XAxis dataKey="name" tick={{ fontSize: 12 }} /><YAxis /><Tooltip /><Bar dataKey="total" fill={GOLD} radius={[4,4,0,0]} /></BarChart>
          </ResponsiveContainer>
        </div>
        <div className="rounded-xl border p-5" style={{ background: 'var(--color-bg-surface)', borderColor: 'var(--color-border-default)' }}>
          <h3 className="text-sm font-semibold mb-4" style={{ color: 'var(--color-text-primary)' }}>Chamados por Categoria</h3>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={catData} margin={{ bottom: 60 }}>
              <XAxis dataKey="categoria" tick={{ fontSize: 10 }} angle={-25} textAnchor="end" height={70} />
              <YAxis /><Tooltip /><Bar dataKey="total" fill={GOLD} radius={[4,4,0,0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="rounded-xl border p-5" style={{ background: 'var(--color-bg-surface)', borderColor: 'var(--color-border-default)' }}>
          <h3 className="text-sm font-semibold mb-4" style={{ color: 'var(--color-text-primary)' }}>Variação por Categoria</h3>
          <div className="space-y-2">
            {catData.filter(c => c.variacao != null).slice(0, 8).map(c => (
              <div key={c.categoria} className="flex items-center gap-2 p-2 rounded-lg" style={{ background: 'var(--color-bg-primary)' }}>
                <span className="text-xs flex-1">{c.categoria}</span>
                <VariacaoBadge valor={c.variacao} />
                <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>{c.mes_atual} · {c.mes_anterior}</span>
              </div>
            ))}
            {catData.filter(c => c.variacao != null).length === 0 && (
              <p className="text-xs text-center py-6" style={{ color: 'var(--color-text-muted)' }}>Dados insuficientes para comparação mensal.</p>
            )}
          </div>
        </div>
      </div>

      {tendenciaData.length > 1 && (
        <div className="mb-6">
          <h2 className="text-sm font-bold mb-1 flex items-center gap-1.5" style={{ color: 'var(--color-text-primary)' }}><ChartLineUp size={18} /> Tendência Mensal (12 meses)</h2>
          <p className="text-xs mb-3" style={{ color: 'var(--color-text-muted)' }}>Volume de chamados por mês</p>
          <div className="rounded-xl border p-5" style={{ background: 'var(--color-bg-surface)', borderColor: 'var(--color-border-default)' }}>
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={tendenciaData}>
                <XAxis dataKey="mes" tick={{ fontSize: 11 }} /><YAxis />
                <Tooltip formatter={v => [`${v} chamados`, 'Total']} labelFormatter={(l, p) => { const item = p?.[0]?.payload; return item ? `${item.mes}/${item.ano}` : l; }} />
                <Line type="monotone" dataKey="total" stroke={GOLD} strokeWidth={2} dot={{ fill: GOLD, r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {medias.semana_atual != null && (
        <div className="mb-6">
          <h2 className="text-sm font-bold mb-3 flex items-center gap-1.5" style={{ color: 'var(--color-text-primary)' }}><ChartBar size={18} /> Médias Móveis</h2>
          <div className="grid grid-cols-3 gap-3">
            <KpiCard title="Esta semana" value={medias.semana_atual} icon={Clock} />
            <KpiCard title="Média 4 semanas" value={medias.media_4_semanas} icon={ChartBar} />
            <KpiCard title="Variação" value={Math.abs(medias.variacao_percentual || 0)} format="percent" icon={TrendUp} />
          </div>
        </div>
      )}

      {anomalias.length > 0 && (
        <div className="mb-6">
          <h2 className="text-sm font-bold mb-1 flex items-center gap-1.5" style={{ color: 'var(--color-text-primary)' }}><Warning size={18} /> Anomalias Detectadas</h2>
          <p className="text-xs mb-3" style={{ color: 'var(--color-text-muted)' }}>Bairros com aumento anormal de chamados</p>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {anomalias.map((a, i) => (
              <div key={i} className="rounded-xl border p-4 border-l-4" style={{
                background: 'var(--color-bg-surface)', borderColor: 'var(--color-border-default)',
                borderLeftColor: a.intensidade === 'alta' ? ERROR : GOLD,
              }}>
                <div className="flex justify-between items-center mb-2">
                  <span className="text-sm font-semibold">{a.bairro}</span>
                  <ImpactoTag impacto={a.intensidade === 'alta' ? 'alta' : 'media'} />
                </div>
                <div className="flex gap-3 text-xs" style={{ color: 'var(--color-text-secondary)' }}>
                  <span><strong style={{ color: 'var(--color-text-primary)' }}>{a.total_mes}</strong> este mês</span>
                  <span>Média: <strong>{a.media_historica}</strong></span>
                  <span>Z-Score: <strong>{a.z_score}</strong></span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {slaCatData.length > 0 && (
        <div className="mb-6">
          <h2 className="text-sm font-bold mb-1 flex items-center gap-1.5" style={{ color: 'var(--color-text-primary)' }}><Timer size={18} /> Tempo Médio por Categoria</h2>
          <div className="rounded-xl border p-5" style={{ background: 'var(--color-bg-surface)', borderColor: 'var(--color-border-default)' }}>
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={slaCatData} layout="vertical" margin={{ left: 100 }}>
                <XAxis type="number" /><YAxis type="category" dataKey="categoria" tick={{ fontSize: 11 }} width={90} />
                <Tooltip formatter={v => [v < 60 ? `${v}min` : `${(v/60).toFixed(1)}h`, 'SLA Médio']} />
                <Bar dataKey="sla_medio_minutos" fill={GOLD_DARK} radius={[0,4,4,0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {stats.sla_vencidos && stats.sla_vencidos.length > 0 && (
        <div className="mb-6">
          <h2 className="text-sm font-bold mb-1 flex items-center gap-1.5" style={{ color: 'var(--color-text-primary)' }}>
            <WarningOctagon size={18} style={{ color: 'var(--color-error)' }} /> Chamados com SLA Vencido
          </h2>
          <p className="text-xs mb-3" style={{ color: 'var(--color-text-muted)' }}>
            Prazo de atendimento ultrapassado. Priorizar resolução.
          </p>
          <div className="space-y-2">
            {stats.sla_vencidos.map(v => (
              <div key={v.id} className="flex items-center gap-3 p-3 rounded-xl border" style={{ background: 'var(--color-bg-surface)', borderColor: 'rgba(107,18,26,0.5)', borderLeftColor: 'var(--color-error)' }}>
                <div className="flex-1 min-w-0">
                  <span className="text-sm font-semibold block truncate" style={{ color: 'var(--color-text-primary)' }}>{v.titulo}</span>
                  <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                    {v.categoria} · {new Date(v.criado_em).toLocaleDateString()} · prazo {v.prazo_sla_dias}d
                  </span>
                </div>
                <StatusBadge status={v.status} />
              </div>
            ))}
          </div>
        </div>
      )}

      {bairrosData.length > 0 && (
        <div className="mb-6">
          <h2 className="text-sm font-bold mb-1 flex items-center gap-1.5" style={{ color: 'var(--color-text-primary)' }}><Buildings size={18} /> Bairros com Mais Chamados</h2>
          <div className="space-y-2">
            {bairrosData.map((b, i) => (
              <div key={i} className="flex items-center gap-3 p-3 rounded-xl border" style={{ background: 'var(--color-bg-surface)', borderColor: 'var(--color-border-default)' }}>
                <span className="text-xs font-bold min-w-[24px]" style={{ color: 'var(--color-text-muted)' }}>#{i+1}</span>
                <div className="flex-1 min-w-0">
                  <span className="text-sm font-semibold block">{b.bairro}</span>
                  <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>{b.total} chamados · {b.taxa_resolucao}% resolvidos</span>
                </div>
                <div className="w-24 h-1.5 rounded-full overflow-hidden flex-shrink-0" style={{ background: 'var(--color-bg-elevated)' }}>
                  <div className="h-full rounded-full transition-all" style={{ width: `${b.taxa_resolucao}%`, background: GOLD }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {recomendacoes.length > 0 && (
        <div className="mb-6">
          <h2 className="text-sm font-bold mb-3" style={{ color: 'var(--color-text-primary)' }}>Recomendações Inteligentes</h2>
          <div className="space-y-3">
            {recomendacoes.map((r, i) => (
              <div key={i} className="rounded-xl border p-4 border-l-4" style={{
                background: 'var(--color-bg-surface)', borderColor: 'var(--color-border-default)',
                borderLeftColor: r.impacto === 'alta' ? ERROR : r.impacto === 'media' ? GOLD : SUCCESS,
              }}>
                <div className="flex items-center gap-2 mb-1">
                  <ImpactoTag impacto={r.impacto} />
                  <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--color-text-muted)' }}>
                    {r.tipo === 'recapeamento' ? 'Recapeamento' : r.tipo === 'sazonalidade' ? 'Sazonalidade' : 'Bairro Crítico'}
                  </span>
                </div>
                <p className="text-sm" style={{ color: 'var(--color-text-primary)' }}>{r.sugestao}</p>
                <div className="flex gap-3 mt-1 text-xs" style={{ color: 'var(--color-text-muted)' }}>
                  {r.local && <span>{r.local}</span>}{r.bairro && <span>{r.bairro}</span>}<span>{r.ocorrencias} ocorrências</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
