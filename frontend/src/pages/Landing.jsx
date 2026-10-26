import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, MotionConfig } from 'framer-motion';
import { MapContainer, TileLayer, CircleMarker, useMap } from 'react-leaflet';
import { MagnifyingGlass } from '@phosphor-icons/react';
import { api } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { getStatusColor, getStatusLabel, statusVars } from '../components/ui/status-utils';

// Mesmo centro padrão do MapPage quando não há município do usuário.
const CENTRO = [-28.67, -49.38];
const TILES = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const TILES_ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';
const EASE = [0.16, 1, 0.3, 1];

const passos = [
  { titulo: 'Marque e fotografe', desc: 'Toque no ponto do mapa onde está o problema e anexe uma foto.' },
  { titulo: 'A triagem é automática', desc: 'O sistema identifica o tipo de problema e envia à secretaria responsável.' },
  { titulo: 'Acompanhe até resolver', desc: 'Você recebe um protocolo e é avisado a cada mudança de status.' },
];

function Enquadrar({ municipio }) {
  const map = useMap();
  useEffect(() => {
    if (!municipio?.min_lat) return;
    // No desktop o painel cobre a esquerda: empurra a cidade para a parte visível.
    const painel = window.innerWidth >= 768 ? 540 : 0;
    map.fitBounds([[municipio.min_lat, municipio.min_lng], [municipio.max_lat, municipio.max_lng]], { animate: false, paddingTopLeft: [painel, 0] });
  }, [map, municipio]);
  return null;
}

function ConsultaProtocolo() {
  const [numero, setNumero] = useState('');
  const [chamado, setChamado] = useState(null);
  const [erro, setErro] = useState('');
  const [buscando, setBuscando] = useState(false);

  async function consultar(e) {
    e.preventDefault();
    if (!numero.trim()) return;
    setBuscando(true);
    setErro('');
    setChamado(null);
    try {
      setChamado(await api.consultarProtocolo(numero));
    } catch (err) {
      setErro(err.message || 'Não foi possível consultar agora. Tente de novo em instantes.');
    } finally {
      setBuscando(false);
    }
  }

  const status = chamado && { color: statusVars(chamado.status).fg, label: getStatusLabel(chamado.status) };

  return (
    <div>
      <form onSubmit={consultar} className="flex" role="search">
        <label htmlFor="protocolo" className="sr-only">Número do protocolo</label>
        <input
          id="protocolo"
          value={numero}
          onChange={e => setNumero(e.target.value)}
          placeholder="Ex.: 2026-000123"
          autoComplete="off"
          className="flex-1 min-w-0 h-11 px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-gold-500)]"
          style={{ background: 'var(--color-bg-input)', border: '1px solid var(--color-border-hover)', color: 'var(--color-text-primary)' }}
        />
        <button
          type="submit"
          disabled={buscando}
          className="h-11 px-4 flex items-center gap-2 text-sm font-medium disabled:opacity-60 outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-gold-500)] hover:bg-[var(--color-bg-hover)]"
          style={{ border: '1px solid var(--color-border-hover)', borderLeft: 0, color: 'var(--color-text-primary)' }}
        >
          <MagnifyingGlass size={16} aria-hidden="true" />
          {buscando ? 'Consultando…' : 'Consultar'}
        </button>
      </form>

      <div aria-live="polite">
        {erro && <p className="mt-2 text-sm" style={{ color: 'var(--color-error)' }}>{erro}</p>}
        {chamado && (
          <div className="mt-3 p-3 text-sm" style={{ background: 'var(--color-bg-surface)', borderLeft: `3px solid ${status?.color || 'var(--color-gold-500)'}` }}>
            <p className="font-medium" style={{ color: 'var(--color-text-primary)' }}>{chamado.titulo || chamado.categoria_nome}</p>
            <p style={{ color: 'var(--color-text-secondary)' }}>
              {[chamado.rua, chamado.bairro].filter(Boolean).join(', ') || `Protocolo ${chamado.protocolo}`}
            </p>
            <p className="mt-1" style={{ color: status?.color || 'var(--color-text-primary)' }}>
              {chamado.status_rotulo || status?.label}
              <span style={{ color: 'var(--color-text-muted)' }}>
                {' '}desde {new Date(chamado.atualizado_em).toLocaleDateString('pt-BR')}
              </span>
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

export default function Landing() {
  const navigate = useNavigate();
  const { isAuthenticated } = useAuth();
  const { theme } = useTheme();
  const [resumo, setResumo] = useState(null);

  useEffect(() => {
    let cancelado = false;
    api.resumoMunicipio(...CENTRO).then(r => { if (!cancelado) setResumo(r); }).catch(() => {});
    // Com a localização liberada, troca para a cidade de quem está vendo; recusa ou
    // ponto fora de um município atendido (404) mantém o centro padrão.
    navigator.geolocation?.getCurrentPosition(
      ({ coords }) => api.resumoMunicipio(coords.latitude, coords.longitude)
        .then(r => { if (!cancelado) setResumo(r); })
        .catch(() => {}),
      () => {},
      { timeout: 10000, maximumAge: 300000 },
    );
    return () => { cancelado = true; };
  }, []);

  const pontos = (resumo?.defeitos || []).filter(d => d.latitude && d.longitude);
  const maisReportados = (resumo?.tipos || []).slice(0, 3);

  return (
    <MotionConfig reducedMotion="user">
      <div className="min-h-dvh flex flex-col" style={{ background: 'var(--color-bg-primary)', color: 'var(--color-text-primary)' }}>
        <header className="flex items-center justify-between px-5" style={{ height: 56, borderBottom: '1px solid var(--color-border-default)', background: 'var(--color-bg-elevated)', zIndex: 1000 }}>
          <div className="flex items-center gap-2">
            <div style={{ width: '1.75rem', height: '1.75rem', border: '1px solid var(--color-icon)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <img src="/icon.svg" alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            </div>
            <div>
              <p className="text-sm font-medium">Central de Inteligência Urbana</p>
              <p className="text-xs max-sm:hidden" style={{ color: 'var(--color-text-muted)' }}>Chamados para serviços públicos</p>
            </div>
          </div>
          <button
            onClick={() => navigate(isAuthenticated ? '/mapa' : '/login')}
            className="text-xs font-medium h-8 px-4 bg-[var(--color-gold-500)] hover:bg-[var(--color-gold-400)] text-[var(--color-on-primary)] outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[var(--color-gold-500)]"
          >
            {isAuthenticated ? 'Abrir o mapa' : 'Entrar'}
          </button>
        </header>

        <div className="flex-1">
          {/* O mapa real da cidade é o hero: mostra o produto em vez de descrevê-lo. */}
          <section className="relative overflow-hidden" style={{ minHeight: 'min(80dvh, 720px)' }}>
            <div className="absolute inset-0" aria-hidden="true">
              <MapContainer
                center={CENTRO}
                zoom={12}
                className="h-full w-full"
                zoomControl={false}
                dragging={false}
                scrollWheelZoom={false}
                doubleClickZoom={false}
                touchZoom={false}
                keyboard={false}
                boxZoom={false}
                style={{ background: 'var(--color-bg-primary)' }}
              >
                <TileLayer url={TILES} attribution={TILES_ATTR} className={theme === 'dark' ? 'tiles-escuro' : undefined} noWrap />
                <Enquadrar municipio={resumo?.municipio} />
                {pontos.map(d => (
                  <CircleMarker
                    key={d.id}
                    center={[d.latitude, d.longitude]}
                    radius={5}
                    interactive={false}
                    pathOptions={{ color: getStatusColor(d.status), weight: 1, fillOpacity: 0.75 }}
                  />
                ))}
              </MapContainer>
            </div>

            <div className="relative px-5 py-12 md:py-20 pointer-events-none" style={{ maxWidth: 1180, margin: '0 auto', zIndex: 500 }}>
              <motion.div
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6, ease: EASE }}
                className="pointer-events-auto rounded-lg p-6 md:p-8"
                style={{
                  maxWidth: '30rem',
                  background: 'color-mix(in srgb, var(--color-bg-primary) 90%, transparent)',
                  border: '1px solid var(--color-border-hover)',
                  backdropFilter: 'blur(6px)',
                }}
              >
                <h1 className="text-3xl md:text-[2.75rem] font-semibold mb-4" style={{ lineHeight: 1.1, letterSpacing: '-0.02em' }}>
                  Viu um problema na rua? Avise a prefeitura.
                </h1>
                <p className="text-base mb-7" style={{ color: 'var(--color-text-secondary)', lineHeight: 1.55 }}>
                  Buraco, poste apagado, vazamento ou lixo acumulado: marque no mapa, mande uma foto e acompanhe até ser resolvido.
                </p>

                <div className="flex flex-col sm:flex-row gap-3 mb-7">
                  <button
                    onClick={() => navigate(isAuthenticated ? '/mapa' : '/login')}
                    className="h-12 px-6 text-sm font-semibold bg-[var(--color-gold-500)] hover:bg-[var(--color-gold-400)] text-[var(--color-on-primary)] outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[var(--color-gold-500)]"
                  >
                    Reportar um problema
                  </button>
                  <button
                    onClick={() => navigate('/mapa')}
                    className="h-12 px-6 text-sm font-semibold text-[var(--color-gold-text)] hover:bg-[var(--color-gold-muted)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-gold-500)]"
                    style={{ border: '1px solid var(--color-gold-500)' }}
                  >
                    Ver o mapa
                  </button>
                </div>

                <p className="text-sm mb-2" style={{ color: 'var(--color-text-secondary)' }}>Já fez um chamado? Consulte pelo protocolo.</p>
                <ConsultaProtocolo />
              </motion.div>
            </div>
          </section>

          {resumo && (
            <section className="px-5 py-8" style={{ borderTop: '1px solid var(--color-border-default)', borderBottom: '1px solid var(--color-border-default)', background: 'var(--color-bg-surface)' }}>
              <div className="flex flex-col md:flex-row md:items-baseline gap-x-10 gap-y-3" style={{ maxWidth: 1180, margin: '0 auto' }}>
                {resumo.total_abertos > 0 ? (
                  <p className="text-lg">
                    <span className="text-3xl font-semibold tabular-nums" style={{ color: 'var(--color-gold-text)' }}>{resumo.total_abertos}</span>
                    {' '}{resumo.total_abertos === 1 ? 'chamado aberto' : 'chamados abertos'} em {resumo.municipio?.nome} agora
                  </p>
                ) : (
                  <p className="text-lg">Nenhum chamado aberto em {resumo.municipio?.nome} agora. Viu algo? Seja o primeiro a avisar.</p>
                )}
                {maisReportados.length > 0 && (
                  <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
                    Mais reportados: {maisReportados.map(t => `${t.categoria} (${t.total})`).join(', ')}
                  </p>
                )}
              </div>
            </section>
          )}

          <section className="px-5 py-16" style={{ maxWidth: 1180, margin: '0 auto' }}>
            <h2 className="text-xl font-semibold mb-8">Como funciona</h2>
            <ol className="grid grid-cols-1 md:grid-cols-3 gap-8">
              {passos.map((p, i) => (
                <li key={p.titulo} className="flex gap-4">
                  <span className="text-3xl font-semibold tabular-nums" style={{ color: 'var(--color-gold-text)', lineHeight: 1 }} aria-hidden="true">{i + 1}</span>
                  <div>
                    <h3 className="text-base font-medium mb-1">{p.titulo}</h3>
                    <p className="text-sm" style={{ color: 'var(--color-text-secondary)', lineHeight: 1.55, maxWidth: '32ch' }}>{p.desc}</p>
                  </div>
                </li>
              ))}
            </ol>
          </section>
        </div>

        <footer className="flex justify-between items-center px-5 py-5 text-xs" style={{ borderTop: '1px solid var(--color-border-default)', color: 'var(--color-text-muted)' }}>
          <p>Central de Inteligência Urbana</p>
          <span title="Commit e data do último deploy (automação GitHub Actions)">
            {import.meta.env.VITE_GIT_SHA || 'dev'} · {import.meta.env.VITE_BUILD_DATE || 'dev'}
          </span>
        </footer>
      </div>
    </MotionConfig>
  );
}
