import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { MapPin, Plus, X, Camera, ThumbsUp, Sun, Moon, MagnifyingGlass, Fire, Funnel, Handshake, Crosshair } from '@phosphor-icons/react';
import { MapContainer, TileLayer, Marker, Polygon, Circle, useMapEvents, useMap } from 'react-leaflet';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/toast-context';
import { api } from '../services/api';
import { StatusBadge } from '../components/ui/status-badge';
import { STATUS_ABERTOS, STATUS_FECHADOS } from '../components/ui/status-utils';
import UserDropdown from '../components/ui/user-dropdown';
import { CommandMenu } from '../components/ui/command-menu';
import { useTheme } from '../context/ThemeContext';
import { createPlacementPinIcon, createDefectIcon, createOpenCallIcon } from '../utils/map-markers';
import { getTimelineItems } from '../utils/timeline';
import { filterByRadius } from '../utils/map-heatmap';
import { Timeline } from '../components/ui/timeline';
import HeatmapLayer from '../components/HeatmapLayer';
import SyncIndicator from '../components/ui/sync-indicator';

// OSM não exige chave (Carto passou a exigir); tema escuro = filtro CSS `.tiles-escuro`.
const TILES = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const TILES_ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';
const BRAZIL_BOUNDS = [[-33.75, -73.99], [5.27, -28.85]];

function MapClickHandler({ creatingRef, promptRef, setCoords, setShowForm }) {
  useMapEvents({
    click(e) {
      if (!creatingRef.current) return;
      // Qualquer cidade vale: em qual município o ponto caiu é o backend que
      // resolve (PostGIS) e grava no chamado.
      setCoords({ lat: e.latlng.lat, lng: e.latlng.lng });
      // com o balão "Abrir Chamado" na tela, o toque apenas reposiciona o alfinete
      if (promptRef.current) return;
      setShowForm(true);
    },
  });
  return null;
}

const LONG_PRESS_MS = 500;
const LONG_PRESS_TOLERANCE = 12;

function isInteractiveTarget(target) {
  return !!(target && target.closest && target.closest('.leaflet-marker-icon, .leaflet-popup, .leaflet-control'));
}

// Pressionar e segurar (touch) ou botão direito (desktop) sobre o mapa abre o fluxo de novo chamado.
function MapQuickAddHandler({ onQuickAdd }) {
  const map = useMap();
  const onQuickAddRef = useRef(onQuickAdd);
  useEffect(() => { onQuickAddRef.current = onQuickAdd; }, [onQuickAdd]);

  useEffect(() => {
    const container = map.getContainer();
    let timer = null;
    let start = null;
    let suppressContextMenuUntil = 0;

    const cancel = () => {
      if (timer) { clearTimeout(timer); timer = null; }
      start = null;
    };

    const trigger = (clientX, clientY, viaTouch) => {
      const latlng = map.mouseEventToLatLng({ clientX, clientY });
      onQuickAddRef.current({ lat: latlng.lat, lng: latlng.lng, x: clientX, y: clientY, viaTouch });
    };

    const onTouchStart = (ev) => {
      cancel();
      if (ev.touches.length !== 1 || isInteractiveTarget(ev.target)) return;
      const t = ev.touches[0];
      start = { x: t.clientX, y: t.clientY };
      timer = setTimeout(() => {
        timer = null;
        suppressContextMenuUntil = performance.now() + 800;
        if (navigator.vibrate) navigator.vibrate(25);
        trigger(start.x, start.y, true);
        start = null;
      }, LONG_PRESS_MS);
    };

    const onTouchMove = (ev) => {
      if (!start || !timer) return;
      const t = ev.touches[0];
      if (Math.abs(t.clientX - start.x) > LONG_PRESS_TOLERANCE || Math.abs(t.clientY - start.y) > LONG_PRESS_TOLERANCE) cancel();
    };

    const onContextMenu = (ev) => {
      ev.preventDefault();
      if (isInteractiveTarget(ev.target)) return;
      if (performance.now() < suppressContextMenuUntil) return; // long-press já disparou
      trigger(ev.clientX, ev.clientY, false);
    };

    container.addEventListener('touchstart', onTouchStart, { passive: true });
    container.addEventListener('touchmove', onTouchMove, { passive: true });
    container.addEventListener('touchend', cancel, { passive: true });
    container.addEventListener('touchcancel', cancel, { passive: true });
    container.addEventListener('contextmenu', onContextMenu);
    return () => {
      cancel();
      container.removeEventListener('touchstart', onTouchStart);
      container.removeEventListener('touchmove', onTouchMove);
      container.removeEventListener('touchend', cancel);
      container.removeEventListener('touchcancel', cancel);
      container.removeEventListener('contextmenu', onContextMenu);
    };
  }, [map]);

  return null;
}

const QUICK_POPOVER_W = 320;
const QUICK_POPOVER_H = 400;

function QuickAddPopover({ position, coords, formData, setFormData, categorias, file, setFile, geocoding, submitting, onSubmit, onClose, onExpand }) {
  const ref = useRef(null);
  const fileRef = useRef(null);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    const onDown = (e) => { if (ref.current && !ref.current.contains(e.target)) onClose(); };
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onDown);
    };
  }, [onClose]);

  const left = Math.max(8, Math.min(position.x + 8, window.innerWidth - QUICK_POPOVER_W - 8));
  const top = Math.max(8, Math.min(position.y + 8, window.innerHeight - QUICK_POPOVER_H - 8));
  const valido = formData.titulo.trim().length > 0 && formData.descricao.length >= 20;

  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.12 }}
      onContextMenu={e => e.preventDefault()}
      className="fixed z-[2000] rounded-lg border shadow-2xl p-4"
      style={{ left, top, width: QUICK_POPOVER_W, background: 'var(--color-bg-surface)', borderColor: 'var(--color-border-default)' }}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-1.5 text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>
          <MapPin size={15} weight="fill" style={{ color: 'var(--color-gold-text)' }} /> Novo chamado aqui
        </div>
        <button onClick={onClose} aria-label="Fechar" className="w-6 h-6 rounded-full flex items-center justify-center"
          style={{ color: 'var(--color-text-secondary)' }}>
          <X size={14} />
        </button>
      </div>

      <div className="space-y-2">
        <input autoFocus placeholder="Título" value={formData.titulo} onChange={e => setFormData(p => ({ ...p, titulo: e.target.value }))}
          className="w-full h-9 px-3 rounded-md border text-sm outline-none bg-[var(--color-bg-input)] text-[var(--color-text-primary)]"
          style={{ borderColor: 'var(--color-border-default)' }}
          onFocus={e => e.target.style.borderColor = 'var(--color-gold-500)'}
          onBlur={e => e.target.style.borderColor = 'var(--color-border-default)'} />

        <textarea placeholder="Descrição (mín. 20 caracteres)" rows={3} value={formData.descricao}
          onChange={e => setFormData(p => ({ ...p, descricao: e.target.value }))}
          className="w-full px-3 py-2 rounded-md border text-sm outline-none resize-none bg-[var(--color-bg-input)] text-[var(--color-text-primary)]"
          style={{ borderColor: 'var(--color-border-default)' }}
          onFocus={e => e.target.style.borderColor = 'var(--color-gold-500)'}
          onBlur={e => e.target.style.borderColor = 'var(--color-border-default)'} />

        <div className="flex items-center gap-2">
          <div className="flex-1 h-1 rounded-full overflow-hidden" style={{ background: 'var(--color-bg-hover)' }}>
            <div className="h-full rounded-full transition-all duration-300"
              style={{
                width: `${Math.min(100, (formData.descricao.length / 20) * 100)}%`,
                background: formData.descricao.length >= 20 ? 'var(--color-success)' : 'var(--color-error)',
              }} />
          </div>
          <span className="text-[10px] font-mono shrink-0"
            style={{ color: formData.descricao.length >= 20 ? 'var(--color-success)' : 'var(--color-error)' }}>
            {formData.descricao.length}/20
          </span>
        </div>

        <select value={formData.categoria} onChange={e => setFormData(p => ({ ...p, categoria: e.target.value }))}
          className="w-full h-9 px-3 rounded-md border text-sm outline-none bg-[var(--color-bg-input)] text-[var(--color-text-primary)]"
          style={{ borderColor: 'var(--color-border-default)' }}>
          {categorias.map(c => (
            <option key={c.nome} value={c.nome}>{c.icone} {c.nome}</option>
          ))}
        </select>

        <div className="flex items-center gap-2">
          <button onClick={() => fileRef.current?.click()}
            className="flex items-center gap-1.5 h-9 px-3 rounded-md border text-xs transition-colors shrink-0"
            style={{ borderColor: 'var(--color-border-default)', color: 'var(--color-text-muted)' }}>
            <Camera size={14} /> {file ? file.name.slice(0, 12) : 'Foto'}
          </button>
          <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden"
            onChange={e => setFile(e.target.files?.[0] || null)} />
          <span className="text-[10px] font-mono truncate" style={{ color: 'var(--color-text-secondary)' }}>
            {geocoding ? 'Buscando endereço...' : (formData.rua || `${coords.lat.toFixed(4)}, ${coords.lng.toFixed(4)}`)}
          </span>
        </div>

        <div className="flex items-center justify-between pt-1">
          <button onClick={onExpand} className="text-xs underline underline-offset-2"
            style={{ color: 'var(--color-text-muted)' }}>Mais campos</button>
          <button onClick={onSubmit} disabled={submitting || !valido}
            className="h-9 px-5 rounded-md text-sm font-semibold transition-all disabled:opacity-50"
            style={{ background: 'var(--color-gold-500)', color: 'var(--color-on-primary)' }}>
            {submitting ? 'Enviando...' : 'Enviar'}
          </button>
        </div>
      </div>
    </motion.div>
  );
}

export default function MapPage() {
  const { isAuthenticated, user } = useAuth();
  const navigate = useNavigate();
  const addToast = useToast();
  const mapRef = useRef(null);
  const finalizarFotoRef = useRef(null);
  const finalizarIdRef = useRef(null);
  const [defeitos, setDefeitos] = useState([]);
  const [filtro, setFiltro] = useState('todos');
  const [heatmap, setHeatmap] = useState(true);
  const [pertoDeMim, setPertoDeMim] = useState(null); // { ativo, lat, lng, raio }
  const [showForm, setShowForm] = useState(false);
  const [creating, setCreating] = useState(false);
  const creatingRef = useRef(false);
  useEffect(() => { creatingRef.current = creating; }, [creating]);
  const [coords, setCoords] = useState(null);
  const [quickAdd, setQuickAdd] = useState(null); // { x, y } — popover de criação rápida (desktop)
  const [openCallPrompt, setOpenCallPrompt] = useState(false); // balão "Abrir Chamado" (long-press no mobile)
  const openCallPromptRef = useRef(false);
  useEffect(() => { openCallPromptRef.current = openCallPrompt; }, [openCallPrompt]);
  const [formData, setFormData] = useState({ titulo: '', descricao: '', categoria: 'Buraco', rua: '', bairro: '' });
  const [file, setFile] = useState(null);
  const fileRef = useRef(null);
  const [submitting, setSubmitting] = useState(false);
  const [geocoding, setGeocoding] = useState(false);
  const [selected, setSelected] = useState(null);
  const [cmdOpen, setCmdOpen] = useState(false);
  const [categorias, setCategorias] = useState([]);
  const [polygonCoords, setPolygonCoords] = useState(null);
  const [atendendo, setAtendendo] = useState(null);
  const [apoiando, setApoiando] = useState(null);
  const [apoiei, setApoiei] = useState(new Set());
  const [selectedImage, setSelectedImage] = useState(null);
  const anexarRef = useRef(null);
  const [anexando, setAnexando] = useState(null);
  const [finalizando, setFinalizando] = useState(null);
  const [userLocation, setUserLocation] = useState(null);
  const { theme, toggle: toggleTheme } = useTheme();

  const hasMunicipio = !!user?.municipio?.min_lat && user.municipio.min_lat !== 0;
  const mapCenter = hasMunicipio
    ? [(user.municipio.min_lat + user.municipio.max_lat) / 2, (user.municipio.min_lng + user.municipio.max_lng) / 2]
    : (userLocation || [-28.67, -49.38]);

  const filteredDefeitos = useMemo(() => {
    let f = defeitos;
    if (filtro === 'abertos') f = f.filter(d => STATUS_ABERTOS.includes(d.status));
    if (filtro === 'encerrados') f = f.filter(d => STATUS_FECHADOS.includes(d.status));
    if (filtro === 'meus' && user) f = f.filter(d => d.usuario?.id === user.id);
    if (pertoDeMim?.ativo) f = filterByRadius(f, pertoDeMim.lat, pertoDeMim.lng, pertoDeMim.raio);
    return f;
  }, [defeitos, filtro, user, pertoDeMim]);

  const leafletPolyCoords = useMemo(() => {
    if (!polygonCoords) return [];
    return polygonCoords.map(([lng, lat]) => [lat, lng]);
  }, [polygonCoords]);

  const leafletMaskCoords = useMemo(() => {
    if (!leafletPolyCoords.length) return null;
    const worldRing = [[90, -180], [90, 180], [-90, 180], [-90, -180], [90, -180]];
    return [worldRing, [...leafletPolyCoords].reverse()];
  }, [leafletPolyCoords]);

  const handleMapReady = useCallback((ev) => {
    mapRef.current = ev.target;
  }, []);

  useEffect(() => {
    const m = mapRef.current;
    if (!m || !hasMunicipio) return;
    const center = [(user.municipio.min_lat + user.municipio.max_lat) / 2, (user.municipio.min_lng + user.municipio.max_lng) / 2];
    const current = m.getCenter();
    if (Math.abs(current.lat - center[0]) > 0.001 || Math.abs(current.lng - center[1]) > 0.001) {
      m.setView(center, 12, { animate: true });
    }
  }, [hasMunicipio, user?.municipio?.min_lat, user?.municipio?.max_lat, user?.municipio?.min_lng, user?.municipio?.max_lng]);

  useEffect(() => {
    if (!user?.municipio?.poligono_json) { setPolygonCoords(null); return; }
    const raw = user.municipio.poligono_json;
    const poly = typeof raw === 'string' ? JSON.parse(raw) : raw;
    const coords = poly.type === 'Polygon' ? poly.coordinates[0] : poly.coordinates?.[0]?.[0];
    if (coords) setPolygonCoords(coords); else setPolygonCoords(null);
  }, [user?.municipio?.poligono_json]);

  useEffect(() => {
    const m = mapRef.current;
    if (!m) return;
    const timer = setTimeout(() => m.invalidateSize(), 100);
    return () => clearTimeout(timer);
  }, [isAuthenticated, showForm, creating, theme]);

  useEffect(() => {
    let cancelled = false;
    api.listDefeitos().then(d => { if (!cancelled) setDefeitos(d); }).catch(() => {});
    api.listCategorias().then(c => { if (!cancelled) setCategorias(c); }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!isAuthenticated) return;
    let cancelled = false;
    api.apoiei().then(r => { if (!cancelled) setApoiei(new Set(r.ids)); }).catch(() => {});
    return () => { cancelled = true; };
  }, [isAuthenticated]);

  useEffect(() => {
  }, [selected]);

  useEffect(() => {
    if (isAuthenticated) return;
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        setUserLocation([latitude, longitude]);
      },
      () => {
        // falha silenciosa — mantém fallback
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 600000 }
    );
  }, [isAuthenticated]);

  useEffect(() => {
    const m = mapRef.current;
    if (!m || !userLocation) return;
    m.setView(userLocation, 12, { animate: true });
  }, [userLocation]);

  async function reverseGeocode(lat, lng) {
    setGeocoding(true);
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&addressdetails=1`,
        { headers: { 'User-Agent': 'CentralInteligenciaUrbana/1.0' } }
      );
      if (!res.ok) return;
      const data = await res.json();
      if (data?.address) {
        const rua = data.address.road || data.address.street || '';
        const bairro = data.address.suburb || data.address.neighbourhood || data.address.city_district || '';
        setFormData(p => ({ ...p, rua, bairro }));
      }
    } catch (err) { void err; } finally {
      setGeocoding(false);
    }
  }

  useEffect(() => {
    if ((showForm || quickAdd) && coords) reverseGeocode(coords.lat, coords.lng);
  }, [showForm, quickAdd, coords]);

  const handleSubmit = useCallback(async () => {
    if (!formData.titulo || formData.descricao.length < 20) {
      addToast('Título obrigatório e descrição mínima de 20 caracteres.', 'error');
      return;
    }
    if (!coords) {
      addToast('Selecione uma localização no mapa.', 'error');
      return;
    }
    if (!formData.categoria) {
      addToast('Selecione uma categoria.', 'error');
      return;
    }
    if (!file) {
      addToast('Tire uma foto do problema para abrir o chamado.', 'error');
      return;
    }
    setSubmitting(true);
    try {
      const fd = new FormData();
      fd.append('titulo', formData.titulo);
      fd.append('descricao', formData.descricao);
      fd.append('categoria', formData.categoria);
      fd.append('rua', formData.rua);
      fd.append('bairro', formData.bairro);
      fd.append('latitude', coords.lat);
      fd.append('longitude', coords.lng);
      fd.append('imagem', file);
      await api.createDefeito(fd);
      addToast('Chamado criado com sucesso!');
      setShowForm(false);
      setQuickAdd(null);
      setOpenCallPrompt(false);
      setCreating(false);
      setCoords(null);
      setFile(null);
      setFormData({ titulo: '', descricao: '', categoria: 'Buraco', rua: '', bairro: '' });
      const d = await api.listDefeitos();
      setDefeitos(d);
    } catch (err) {
      addToast('Erro: ' + (err.message || 'Erro ao criar chamado'), 'error');
    } finally {
      setSubmitting(false);
    }
  }, [formData, coords, file, addToast]);

  const handleAtender = useCallback(async (id, e) => {
    e?.stopPropagation();
    setAtendendo(id);
    try {
      await api.atenderDefeito(id);
      addToast('Chamado vinculado com sucesso!');
      const atualizado = { status: 'em_andamento', atendente_id: user?.id };
      setDefeitos(prev => prev.map(d => d.id === id ? { ...d, ...atualizado } : d));
      setSelected(prev => prev?.id === id ? { ...prev, ...atualizado } : prev);
    } catch (err) { addToast('Erro: ' + err.message, 'error'); }
    finally { setAtendendo(null); }
  }, [addToast, user]);

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
        setSelected(prev => prev?.id === id ? { ...prev, total_apoios: (prev.total_apoios || 0) + 1 } : prev);
      } else {
        addToast('Apoio removido.');
        setDefeitos(prev => prev.map(d => d.id === id ? { ...d, total_apoios: Math.max(0, (d.total_apoios || 0) - 1) } : d));
        setSelected(prev => prev?.id === id ? { ...prev, total_apoios: Math.max(0, (prev.total_apoios || 0) - 1) } : prev);
      }
    } catch (err) { addToast('Erro: ' + err.message, 'error'); }
    finally { setApoiando(null); }
  }, [addToast]);

  // Igual ao /lista: pede a foto do serviço feito e conclui pelo /status/.
  const handleFinalizarMap = useCallback((id, e) => {
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
      setSelected(prev => prev?.id === id ? { ...prev, ...d } : prev);
      setDefeitos(prev => prev.map(x => x.id === id ? { ...x, ...d } : x));
    } catch (err) { addToast('Erro: ' + err.message, 'error'); }
    finally { setFinalizando(null); }
  }, [addToast]);

  const fecharCriacao = useCallback(() => {
    setQuickAdd(null);
    setOpenCallPrompt(false);
    setShowForm(false);
    setCreating(false);
    setCoords(null);
    setFile(null);
  }, []);

  useEffect(() => {
    if (!creating) return;
    const onKey = (e) => { if (e.key === 'Escape') fecharCriacao(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [creating, fecharCriacao]);

  const abrirFormularioDoPonto = useCallback(() => {
    setOpenCallPrompt(false);
    setShowForm(true);
  }, []);

  const handleQuickAdd = useCallback(({ lat, lng, x, y, viaTouch }) => {
    if (!isAuthenticated) {
      addToast('Faça login para registrar um chamado.', 'error');
      return;
    }
    // Qualquer cidade vale: o município do chamado é resolvido pelo backend (PostGIS).
    setCreating(true);
    setCoords({ lat, lng });
    if (viaTouch) {
      // no toque, confirma pelo balão "Abrir Chamado" acima do alfinete
      setQuickAdd(null);
      setShowForm(false);
      setOpenCallPrompt(true);
    } else {
      setOpenCallPrompt(false);
      setShowForm(false);
      setQuickAdd({ x, y });
    }
  }, [isAuthenticated, addToast]);

  const mapKey = `${theme}-${hasMunicipio ? `${user?.municipio_id}-${user?.municipio?.min_lat}-${user?.municipio?.min_lng}` : 'default'}`;

  const ativarPertoDeMim = () => {
    if (!navigator.geolocation) {
      addToast('Geolocalização não suportada neste navegador.', 'error');
      return;
    }
    addToast('Buscando sua localização...');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        setPertoDeMim({ ativo: true, lat: latitude, lng: longitude, raio: 500 });
        addToast('Filtro "Perto de Mim" ativado.');
      },
      () => addToast('Não foi possível obter sua localização.', 'error'),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 }
    );
  };

  const desativarPertoDeMim = () => {
    setPertoDeMim(null);
    addToast('Filtro "Perto de Mim" desativado.');
  };

  return (
    <div className="flex flex-col" style={{ height: '100%', minHeight: 0, position: 'relative' }}>
      <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: 56, padding: '0 16px', flexShrink: 0, borderBottom: '1px solid var(--color-border-default)', background: 'var(--color-bg-elevated)', zIndex: 1000 }}>
        <div className="flex items-center gap-2">
          <div style={{ width: '1.75rem', height: '1.75rem', background: 'transparent', border: '1px solid var(--color-icon)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <img src="/icon.svg" alt="Central de Inteligência Urbana" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          </div>
          <div className="max-sm:hidden">
            <h1 className="text-sm font-medium" style={{ color: 'var(--color-text-primary)' }}>Central de Inteligência Urbana</h1>
            <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>Chamados para Serviços Públicos</p>
          </div>
        </div>
        {(
          <div className="flex items-center gap-2">
            <SyncIndicator />
            {isAuthenticated && (
              <button onClick={() => setCmdOpen(true)} className="flex items-center gap-1.5 h-8 px-3 rounded-md text-xs transition-colors"
                style={{ color: 'var(--color-text-secondary)', background: 'transparent' }}
                onMouseEnter={e => e.currentTarget.style.background = 'var(--color-bg-hover)'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                aria-label="Buscar (Cmd+K)">
                <MagnifyingGlass size={14} />
                <span className="hidden sm:inline opacity-60">Cmd+K</span>
              </button>
            )}
            <button onClick={toggleTheme} className="flex items-center justify-center w-8 h-8 rounded-md transition-colors"
              style={{ color: 'var(--color-text-secondary)' }}
              onMouseEnter={e => e.currentTarget.style.background = 'var(--color-bg-hover)'}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
              aria-label={theme === 'dark' ? 'Tema claro' : 'Tema escuro'}>
              {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
            </button>
            {isAuthenticated ? <UserDropdown /> : (
              <button onClick={() => navigate('/login')} className="text-xs font-medium h-8 px-3 rounded-md transition-colors"
                style={{ color: 'var(--color-text-secondary)' }}
                onMouseEnter={e => { e.currentTarget.style.background = 'var(--color-bg-hover)'; e.currentTarget.style.color = 'var(--color-text-primary)'; }}
                onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--color-text-secondary)'; }}>
                Entrar
              </button>
            )}
          </div>
        )}
      </header>

      <div className={`flex-1 relative${creating ? ' map-shell--creating' : ''}`} style={{ minHeight: 0 }}>
        {creating && (
          <div className="hidden sm:flex items-center absolute top-4 left-1/2 -translate-x-1/2 z-[1600] h-9 pl-3 pr-3.5 rounded-md text-xs border shadow-lg pointer-events-none"
            style={{
              background: 'var(--color-bg-elevated)',
              borderColor: 'var(--color-border-default)',
              borderLeft: '2px solid var(--color-gold-500)',
              color: 'var(--color-text-primary)',
            }}>
            {coords ? 'Ponto marcado — clique em outro lugar para mover' : 'Clique no mapa para marcar o ponto'}
          </div>
        )}
        {!isAuthenticated && (
          <div className="absolute top-4 left-1/2 -translate-x-1/2 z-[1500] px-4 py-2 rounded-md text-xs border"
            style={{ background: 'var(--color-bg-elevated)', borderColor: 'var(--color-border-default)', color: 'var(--color-text-muted)' }}>
            Faça login para ver detalhes
          </div>
        )}
        <MapContainer
          key={mapKey}
          center={mapCenter}
          zoom={12}
          className=""
          style={{ width: '100%', height: '100%', position: 'absolute', inset: 0, background: '#1a1a14', WebkitTouchCallout: 'none', WebkitUserSelect: 'none', userSelect: 'none' }}
          maxBounds={BRAZIL_BOUNDS}
          minZoom={3}
          maxBoundsViscosity={1.0}
          zoomControl={true}
          whenReady={handleMapReady}>
          <TileLayer url={TILES} attribution={TILES_ATTR} className={theme === 'dark' ? 'tiles-escuro' : undefined} noWrap />
          <MapClickHandler
            creatingRef={creatingRef}
            promptRef={openCallPromptRef}
            setCoords={setCoords}
            setShowForm={setShowForm}
          />
          <MapQuickAddHandler onQuickAdd={handleQuickAdd} />
          {coords && !openCallPrompt && (
            <Marker position={[coords.lat, coords.lng]} icon={createPlacementPinIcon()} />
          )}
          {coords && openCallPrompt && (
            <Marker
              position={[coords.lat, coords.lng]}
              icon={createOpenCallIcon()}
              zIndexOffset={1000}
              title="Abrir chamado neste ponto"
              alt="Abrir chamado neste ponto"
              eventHandlers={{
                click: abrirFormularioDoPonto,
                keypress: (e) => { if (e.originalEvent?.key === 'Enter') abrirFormularioDoPonto(); },
              }}
            />
          )}
          {leafletPolyCoords.length > 0 && (
            <>
              <Polygon positions={leafletPolyCoords} pathOptions={{ color: '#D4A017', weight: 2, fillColor: 'rgb(180,140,50)', fillOpacity: 0.15, interactive: false }} />
              {leafletMaskCoords && (
                <Polygon positions={leafletMaskCoords} pathOptions={{ color: 'none', fillColor: 'rgba(0,0,0,0.55)', fillRule: 'evenodd', interactive: false }} />
              )}
            </>
          )}
          {pertoDeMim?.ativo && (
            <Circle
              center={[pertoDeMim.lat, pertoDeMim.lng]}
              radius={pertoDeMim.raio}
              pathOptions={{ color: '#D4A017', weight: 2, fillColor: 'rgb(212,160,23)', fillOpacity: 0.15 }}
            />
          )}
          {(heatmap || !isAuthenticated) ? (
            <HeatmapLayer pontos={filteredDefeitos} ativo={true} />
          ) : (
            filteredDefeitos.map(d => (
              <Marker
                key={d.id}
                position={[d.latitude, d.longitude]}
                icon={createDefectIcon(d.status, d.atendido_em || d.atualizado_em)}
                eventHandlers={{
                  click: () => {
                    setSelected(d);
                    api.detalharDefeito(d.id).then(full => setSelected(full)).catch(() => {});
                  },
                }}
              />
            ))
          )}
        </MapContainer>
        {isAuthenticated && !creating && (
          <div className="fixed right-5 z-[1500]" style={{ bottom: '5.5rem' }}>
            <MapControlsDropdown filtro={filtro} setFiltro={setFiltro} heatmap={heatmap} setHeatmap={setHeatmap} direction="up" />
          </div>
        )}

        {isAuthenticated && !creating && (
          <div className="fixed right-5 z-[1500] flex flex-col items-end gap-2" style={{ bottom: '8rem' }}>
            {pertoDeMim?.ativo ? (
              <>
                <div className="flex items-center gap-2 px-3 py-2 rounded-lg border shadow-lg"
                  style={{ background: 'var(--color-bg-elevated)', borderColor: 'var(--color-gold-500)' }}>
                  <span className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>
                    {filteredDefeitos.length} no raio de {pertoDeMim.raio}m
                  </span>
                  <select
                    value={pertoDeMim.raio}
                    onChange={e => setPertoDeMim(p => ({ ...p, raio: Number(e.target.value) }))}
                    className="h-7 px-1 rounded border text-xs outline-none bg-[var(--color-bg-input)] text-[var(--color-text-primary)]"
                    style={{ borderColor: 'var(--color-border-default)' }}
                    aria-label="Raio de busca">
                    <option value={200}>200m</option>
                    <option value={500}>500m</option>
                    <option value={1000}>1km</option>
                  </select>
                  <button onClick={desativarPertoDeMim} className="flex items-center justify-center w-6 h-6 rounded-full transition-colors"
                    style={{ color: 'var(--color-text-secondary)' }}
                    onMouseEnter={e => e.currentTarget.style.background = 'var(--color-bg-hover)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                    aria-label="Desativar filtro Perto de Mim">
                    <X size={14} />
                  </button>
                </div>
              </>
            ) : (
              <button onClick={ativarPertoDeMim}
                className="flex items-center gap-1.5 h-8 px-3 rounded-full border text-xs font-semibold transition-colors select-none"
                style={{ background: 'var(--color-bg-surface)', borderColor: 'var(--color-border-default)', color: 'var(--color-text-secondary)' }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--color-gold-500)'; e.currentTarget.style.color = 'var(--color-gold-500)'; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--color-border-default)'; e.currentTarget.style.color = 'var(--color-text-secondary)'; }}>
                <Crosshair size={14} /> Perto de Mim
              </button>
            )}
          </div>
        )}

        {!creating && isAuthenticated && (
          <button onClick={() => setCreating(true)}
            title="Novo chamado — ou segure o dedo / clique com o botão direito no mapa"
            aria-label="Novo chamado"
            className="fixed bottom-6 right-5 z-[1500] w-12 h-12 rounded-full flex items-center justify-center shadow-lg transition-transform hover:scale-105 active:scale-95"
            style={{ background: 'var(--color-gold-500)', color: 'var(--color-on-primary)' }}>
            <Plus size={22} weight="bold" />
          </button>
        )}

        {creating && (
          <div className="fixed bottom-6 left-5 right-5 z-[1500] flex items-center justify-end gap-2">
            <button onClick={fecharCriacao}
              className="h-12 px-5 rounded-full flex items-center gap-2 shadow-lg shrink-0 transition-colors"
              style={{ background: 'var(--color-bg-surface)', border: '1px solid var(--color-border-default)', color: 'var(--color-text-secondary)' }}>
              <X size={16} weight="bold" />
              <span className="text-xs font-bold uppercase tracking-[0.1em]">Cancelar</span>
            </button>
            <button onClick={abrirFormularioDoPonto} disabled={!coords}
              className="h-12 px-5 rounded-full flex items-center justify-center gap-2 shadow-lg flex-1 sm:flex-none transition-opacity disabled:opacity-40"
              style={{ background: 'var(--color-gold-500)', color: 'var(--color-on-primary)' }}>
              <Plus size={16} weight="bold" />
              <span className="text-xs font-bold uppercase tracking-[0.1em] whitespace-nowrap">Adicionar chamado</span>
            </button>
          </div>
        )}

        {quickAdd && coords && (
          <QuickAddPopover
            position={quickAdd}
            coords={coords}
            formData={formData}
            setFormData={setFormData}
            categorias={categorias}
            file={file}
            setFile={setFile}
            geocoding={geocoding}
            submitting={submitting}
            onSubmit={handleSubmit}
            onClose={fecharCriacao}
            onExpand={() => { setQuickAdd(null); setShowForm(true); }}
          />
        )}

        {showForm && coords && (
          <motion.div initial={{ y: 300, opacity: 0 }} animate={{ y: 0, opacity: 1 }} className="fixed bottom-0 left-0 right-0 z-[2000] max-h-[85vh] overflow-y-auto rounded-t-2xl border p-6 pb-safe"
            style={{ background: 'var(--color-bg-surface)', borderColor: 'var(--color-border-default)' }}>
            <h3 className="text-base font-semibold mb-4" style={{ color: 'var(--color-text-primary)' }}>Novo Chamado</h3>
            <div className="space-y-3">
              <input placeholder="Título" value={formData.titulo} onChange={e => setFormData(p => ({ ...p, titulo: e.target.value }))}
                className="w-full h-11 px-4 rounded-md border text-sm outline-none transition-colors bg-[var(--color-bg-input)] text-[var(--color-text-primary)]"
                style={{ borderColor: 'var(--color-border-default)' }}
                onFocus={e => e.target.style.borderColor = 'var(--color-gold-500)'}
                onBlur={e => e.target.style.borderColor = 'var(--color-border-default)'} />
              <textarea placeholder="Descrição (mín. 20 caracteres)" value={formData.descricao} onChange={e => setFormData(p => ({ ...p, descricao: e.target.value }))} rows={3}
                className="w-full px-4 py-3 rounded-md border text-sm outline-none transition-colors resize-none bg-[var(--color-bg-input)] text-[var(--color-text-primary)]"
                style={{ borderColor: 'var(--color-border-default)' }}
                onFocus={e => e.target.style.borderColor = 'var(--color-gold-500)'}
                onBlur={e => e.target.style.borderColor = 'var(--color-border-default)'} />
              <div className="flex items-center gap-2">
                <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--color-bg-hover)' }}>
                  <div className="h-full rounded-full transition-all duration-300"
                    style={{
                      width: `${Math.min(100, (formData.descricao.length / 20) * 100)}%`,
                      background: formData.descricao.length >= 20
                        ? 'var(--color-success)'
                        : 'var(--color-error)',
                    }} />
                </div>
                <span className="text-xs font-mono shrink-0"
                  style={{ color: formData.descricao.length >= 20 ? 'var(--color-success)' : 'var(--color-error)' }}>
                  {formData.descricao.length}/20
                </span>
              </div>
              <select value={formData.categoria} onChange={e => setFormData(p => ({ ...p, categoria: e.target.value }))}
                className="w-full h-11 px-4 rounded-md border text-sm outline-none bg-[var(--color-bg-input)] text-[var(--color-text-primary)]"
                style={{ borderColor: 'var(--color-border-default)' }}>
                {categorias.map(c => (
                  <option key={c.nome} value={c.nome}>{c.icone} {c.nome}</option>
                ))}
              </select>
              <div className="flex flex-col sm:flex-row gap-2 flex-1">
                <input placeholder="Rua" value={formData.rua} onChange={e => setFormData(p => ({ ...p, rua: e.target.value }))}
                  className="flex-1 h-11 px-4 rounded-md border text-sm outline-none bg-[var(--color-bg-input)] text-[var(--color-text-primary)]"
                  style={{ borderColor: 'var(--color-border-default)' }} />
                <input placeholder="Bairro" value={formData.bairro} onChange={e => setFormData(p => ({ ...p, bairro: e.target.value }))}
                  className="flex-1 h-11 px-4 rounded-md border text-sm outline-none bg-[var(--color-bg-input)] text-[var(--color-text-primary)]"
                  style={{ borderColor: 'var(--color-border-default)' }} />
              </div>
              {geocoding && (
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 border-2 rounded-full animate-spin" style={{ borderColor: 'var(--color-text-muted)', borderTopColor: 'transparent' }} />
                  <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>Buscando endereço...</span>
                </div>
              )}
              <div className="flex items-center gap-2">
                <label className="flex items-center gap-2 px-4 h-11 rounded-md border text-sm cursor-pointer transition-colors"
                  style={{ borderColor: 'var(--color-border-default)', color: 'var(--color-text-muted)' }}
                  onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--color-gold-500)'}
                  onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--color-border-default)'}>
                  <Camera size={16} /> {file ? file.name.slice(0, 20) : 'Foto (obrigatória)'}
                  {/* `capture` abre a câmera direto no celular; no desktop o navegador ignora e abre o seletor. */}
                  <input ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden"
                    onChange={e => setFile(e.target.files?.[0] || null)} />
                </label>
                <span className="text-xs font-mono" style={{ color: 'var(--color-text-secondary)' }}>{coords.lat.toFixed(4)}, {coords.lng.toFixed(4)}</span>
              </div>
              <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>Ao enviar, você autoriza o uso da imagem para fins de serviço público.</p>
              <div className="flex justify-end gap-2 pt-2">
                <button onClick={fecharCriacao}
                  className="h-10 px-6 rounded-md text-sm font-medium transition-all"
                  style={{ background: 'transparent', color: 'var(--color-text-secondary)' }}>Cancelar</button>
                <button onClick={handleSubmit} disabled={submitting || formData.descricao.length < 20}
                  className="h-10 px-6 rounded-md text-sm font-semibold transition-all disabled:opacity-50"
                  style={{ background: 'var(--color-gold-500)', color: 'var(--color-on-primary)' }}>
                  {submitting ? 'Enviando...' : 'Enviar'}
                </button>
              </div>
            </div>
          </motion.div>
        )}

        {selected && (
          <div className="fixed inset-0 z-[2000] bg-black/50 backdrop-blur-sm flex items-end justify-center"
            onClick={() => setSelected(null)}>
            <motion.div initial={{ y: 100, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 100, opacity: 0 }}
              className="w-full max-w-md rounded-t-2xl border p-5 pb-safe"
              style={{ background: 'var(--color-bg-surface)', borderColor: 'rgba(180,140,50,0.3)' }}
              onClick={e => e.stopPropagation()}>
              <div className="flex items-start justify-between mb-3">
                <div className="flex-1 min-w-0 pr-2">
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="text-sm font-semibold truncate" style={{ color: 'var(--color-text-primary)' }}>{selected.titulo}</h3>
                  </div>
                  <div className="flex items-center gap-2">
                    <StatusBadge status={selected.status} concluido_em={selected.atendido_em || selected.atualizado_em} />
                    <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                      {selected.usuario?.nome ? `${selected.usuario.nome.charAt(0)}${'*'.repeat(selected.usuario.nome.length - 1)}` : 'Anônimo'}
                    </span>
                  </div>
                </div>
                <button onClick={() => setSelected(null)} className="w-7 h-7 rounded-full flex items-center justify-center shrink-0 transition-colors"
                  style={{ color: 'var(--color-text-muted)' }}
                  onMouseEnter={e => e.currentTarget.style.background = 'var(--color-bg-hover)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                  <X size={14} />
                </button>
              </div>
              <p className="text-xs mb-3 line-clamp-2" style={{ color: 'var(--color-text-secondary)', lineHeight: 1.5 }}>{selected.descricao}</p>
              {selected.imagem_thumbnail && (
                <img src={selected.imagem_thumbnail} alt="" className="w-full h-32 object-cover rounded-md mb-3 cursor-pointer"
                  onClick={() => setSelectedImage(selected.imagem_thumbnail)} />
              )}
              {selected.imagens_extra && (() => {
                try { return JSON.parse(selected.imagens_extra); } catch { return []; }
              })().map((url, i) => (
                <img key={i} src={url} alt="" className="w-full h-32 object-cover rounded-md mb-2 cursor-pointer"
                  onClick={() => setSelectedImage(url)} />
              ))}
              <div className="mb-4 mt-4">
                <h4 className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--color-text-muted)' }}>Histórico</h4>
                <Timeline items={getTimelineItems(selected)} />
              </div>
              <div className="flex items-center gap-3 text-xs mb-4" style={{ color: 'var(--color-text-muted)' }}>
                <span>{new Date(selected.criado_em).toLocaleDateString()}</span>
                {selected.apoios_total > 0 && <span className="flex items-center gap-1"><ThumbsUp size={12} /> {selected.apoios_total}</span>}
              </div>
              <div className="flex flex-col sm:flex-row gap-2">
                {user?.admin && !selected.atendente_id && STATUS_ABERTOS.includes(selected.status) && (
                  <button onClick={e => handleAtender(selected.id, e)} disabled={atendendo === selected.id}
                    className="w-full sm:w-auto h-9 px-4 rounded-md text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors disabled:opacity-50"
                    style={{ background: 'rgba(59,130,246,0.12)', color: '#3B82F6' }}
                    onMouseEnter={e => e.currentTarget.style.background = 'rgba(59,130,246,0.2)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'rgba(59,130,246,0.12)'}>
                    <Handshake size={14} /> {atendendo === selected.id ? '...' : 'Atender Chamado'}
                  </button>
                )}
                {user?.admin && selected.atendente_id && STATUS_ABERTOS.includes(selected.status) && (
                  <button onClick={e => handleFinalizarMap(selected.id, e)} disabled={finalizando === selected.id}
                    className="flex-1 h-9 rounded-md text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors disabled:opacity-50"
                    style={{ background: 'var(--color-error)', color: 'var(--color-on-danger)' }}>
                    {finalizando === selected.id ? '...' : 'Finalizar'}
                  </button>
                )}
                <button onClick={() => handleApoiar(selected.id)} disabled={apoiando === selected.id}
                  className="flex-1 h-9 rounded-md text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors disabled:opacity-50"
                  style={{
                    background: apoiei.has(selected.id) ? 'rgba(212,160,23,0.2)' : 'rgba(212,160,23,0.12)',
                    color: 'var(--color-gold-text)',
                    border: apoiei.has(selected.id) ? '1px solid var(--color-gold-500)' : 'none',
                  }}
                  onMouseEnter={e => { e.currentTarget.style.background = 'rgba(212,160,23,0.2)'; }}
                  onMouseLeave={e => { e.currentTarget.style.background = apoiei.has(selected.id) ? 'rgba(212,160,23,0.2)' : 'rgba(212,160,23,0.12)'; }}>
                  {apoiei.has(selected.id) ? <ThumbsUp size={14} weight="fill" /> : <ThumbsUp size={14} />}
                  {apoiando === selected.id ? '...' : apoiei.has(selected.id) ? 'Apoiado' : 'Apoiar'}
                </button>
                <button onClick={() => anexarRef.current?.click()} disabled={anexando === selected.id}
                  className="flex-1 h-9 rounded-md text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors disabled:opacity-50"
                  style={{ background: 'transparent', border: '1px solid var(--color-border-default)', color: 'var(--color-text-secondary)' }}
                  onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--color-gold-500)'; e.currentTarget.style.color = 'var(--color-gold-500)'; }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--color-border-default)'; e.currentTarget.style.color = 'var(--color-text-secondary)'; }}>
                  <Camera size={14} /> {anexando === selected.id ? '...' : 'Anexar'}
                </button>
                <input ref={anexarRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden"
                  onChange={async e => {
                    const f = e.target.files?.[0];
                    if (!f) return;
                    setAnexando(selected.id);
                    try {
                      await api.anexarImagem(selected.id, f);
                      addToast('Imagem anexada!');
                      const d = await api.detalharDefeito(selected.id);
                      setSelected(d);
                      setDefeitos(prev => prev.map(x => x.id === d.id ? d : x));
                    } catch (err) { addToast('Erro: ' + err.message, 'error'); }
                    finally { setAnexando(null); e.target.value = ''; }
                  }} />
              </div>
            </motion.div>
          </div>
        )}
      </div>
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
      <input ref={finalizarFotoRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden"
        aria-label="Foto do serviço concluído" onChange={handleFinalizarFoto} />
      <CommandMenu open={cmdOpen} onClose={() => setCmdOpen(false)} isAdmin={user?.admin} isAdminMunicipal={['admin_municipal', 'super_admin'].includes(user?.papel)} />
    </div>
  );
}

function MapControlsDropdown({ filtro, setFiltro, heatmap, setHeatmap, direction = 'down' }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    function handleClick(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    if (open) document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  const dropdownPos = direction === 'up'
    ? 'absolute right-0 bottom-full mb-2'
    : 'absolute right-0 top-full mt-2';

  function activeDot(isActive) {
    return isActive
      ? <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: 'var(--color-gold-500)' }} />
      : <span className="w-1.5 h-1.5 shrink-0" />;
  }

  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen(o => !o)}
        className="flex items-center justify-center w-8 h-8 rounded-full border text-xs font-semibold transition-colors select-none"
        style={{
          borderColor: open ? 'var(--color-gold-500)' : 'var(--color-border-default)',
          color: 'var(--color-text-secondary)',
          background: open ? 'var(--color-bg-surface)' : 'var(--color-bg-surface)',
        }}>
        <Funnel size={14} weight={open ? 'fill' : 'regular'} />
      </button>
      {open && (
        <motion.div initial={{ opacity: 0, y: direction === 'up' ? 4 : -4, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: direction === 'up' ? 4 : -4, scale: 0.96 }} transition={{ duration: 0.15, ease: [0.16,1,0.3,1] }}
          className={`${dropdownPos} min-w-[180px] rounded-md border p-1.5 shadow-lg z-[3000]`}
          style={{ background: 'var(--color-bg-elevated)', borderColor: 'var(--color-border-default)' }}>
          <button onClick={() => { setHeatmap(h => !h); setOpen(false); }}
            className="flex items-center gap-2.5 w-full px-3 py-2 rounded-md text-sm transition-colors"
            style={{ color: heatmap ? 'var(--color-gold-500)' : 'var(--color-text-secondary)' }}
            onMouseEnter={e => { e.currentTarget.style.background = 'var(--color-bg-hover)'; e.currentTarget.style.color = 'var(--color-text-primary)'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = heatmap ? 'var(--color-gold-500)' : 'var(--color-text-secondary)'; }}>
            <Fire size={16} weight={heatmap ? 'fill' : 'regular'} /> Mapa de Calor
          </button>
          <div className="h-px mx-2 my-1" style={{ background: 'var(--color-border-default)' }} />
          <p className="px-3 pt-1 pb-0.5 text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--color-text-muted)' }}>Filtros</p>
          {['todos','abertos','encerrados', 'meus'].map(f => (
            <button key={f} onClick={() => { setFiltro(f); setOpen(false); }}
              className="flex items-center gap-2.5 w-full px-3 py-2 rounded-md text-sm transition-colors"
              style={{ color: filtro === f ? 'var(--color-gold-500)' : 'var(--color-text-secondary)' }}
              onMouseEnter={e => { e.currentTarget.style.background = 'var(--color-bg-hover)'; e.currentTarget.style.color = 'var(--color-text-primary)'; }}
              onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = filtro === f ? 'var(--color-gold-500)' : 'var(--color-text-secondary)'; }}>
              {activeDot(filtro === f)}
              {f === 'todos' ? 'Todos' : f === 'abertos' ? 'Abertos' : f === 'encerrados' ? 'Encerrados' : 'Meus Chamados'}
            </button>
          ))}
        </motion.div>
      )}
    </div>
  );
}
