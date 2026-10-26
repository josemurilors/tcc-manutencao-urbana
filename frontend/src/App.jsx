import { lazy, Suspense, useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { IconContext, Sun, Moon, MagnifyingGlass } from '@phosphor-icons/react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ToastProvider } from './components/Toast';
import { useToast } from './components/toast-context';
import ErrorBoundary from './components/ErrorBoundary';
import { ThemeProvider, useTheme } from './context/ThemeContext';
import { useKeyboardNav } from './hooks/useKeyboardNav';
import UserDropdown from './components/ui/user-dropdown';
import { CommandMenu } from './components/ui/command-menu';
import SyncIndicator from './components/ui/sync-indicator';
import './styles/tokens.css';
import './styles/globals.css';

const Landing = lazy(() => import('./pages/Landing'));
const Login = lazy(() => import('./pages/Login'));
const Register = lazy(() => import('./pages/Register'));
const EscolherNome = lazy(() => import('./pages/EscolherNome'));
const MapPage = lazy(() => import('./pages/MapPage'));
const DefectList = lazy(() => import('./pages/DefectList'));
const Settings = lazy(() => import('./pages/Settings'));
const ProfileSettings = lazy(() => import('./pages/ProfileSettings'));
const AdminDashboardMetrics = lazy(() => import('./pages/AdminDashboardMetrics'));
const SuperAdmin = lazy(() => import('./pages/SuperAdmin'));
const GeneralSettings = lazy(() => import('./pages/GeneralSettings'));

function ProtectedRoute({ children }) {
  const { isAuthenticated, loading } = useAuth();
  if (loading) return <div className="flex items-center justify-center min-h-dvh bg-[var(--color-bg-primary)]"><div className="animate-pulse text-sm" style={{ color: 'var(--color-text-muted)' }}>Carregando...</div></div>;
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  return children;
}

function PageFallback() {
  return (
    <div className="flex items-center justify-center min-h-dvh bg-[var(--color-bg-primary)]">
      <div className="text-center">
        <div className="w-9 h-9 rounded-full mx-auto mb-2 animate-pulse" style={{ background: 'var(--color-bg-elevated)' }} />
        <div className="h-3 w-40 rounded mx-auto animate-pulse" style={{ background: 'var(--color-bg-elevated)' }} />
      </div>
    </div>
  );
}

function AnimatedRoute({ children }) {
  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }} style={{ height: '100%' }}>
      {children}
    </motion.div>
  );
}

function KeyboardNav() {
  const addToast = useToast();
  const { toggle } = useTheme();
  useKeyboardNav({ addToast, toggleTheme: toggle });
  return null;
}

function AppHeader({ onToggleTheme, onOpenCmd, theme }) {
  const { isAuthenticated } = useAuth();
  const navigate = useNavigate();

  return (
    <header style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      height: 56, padding: '0 20px', flexShrink: 0,
      borderBottom: '1px solid var(--color-border-default)',
      background: 'var(--color-bg-elevated)', zIndex: 1000,
    }}>
      <div className="flex items-center gap-2 cursor-pointer" onClick={() => navigate('/mapa')} role="button" aria-label="Ir para o mapa">
        <div style={{ width: '1.75rem', height: '1.75rem', background: 'transparent', border: '1px solid var(--color-icon)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <img src="/icon.svg" alt="Central de Inteligência Urbana" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        </div>
        <div className="max-sm:hidden">
          <h1 className="text-sm font-medium" style={{ color: 'var(--color-text-primary)' }}>Central de Inteligência Urbana</h1>
          <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>Chamados para Serviços Públicos</p>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <SyncIndicator />
        {isAuthenticated && (
          <button onClick={onOpenCmd} className="flex items-center gap-1.5 h-8 px-3 rounded-md text-xs transition-colors bg-transparent hover:bg-[var(--color-bg-hover)]"
            style={{ color: 'var(--color-text-secondary)' }}
            aria-label="Buscar (Cmd+K)">
            <MagnifyingGlass size={14} />
            <span className="hidden sm:inline opacity-60">Cmd+K</span>
          </button>
        )}
        <button onClick={onToggleTheme} className="flex items-center justify-center w-8 h-8 rounded-md transition-colors hover:bg-[var(--color-bg-hover)]"
          style={{ color: 'var(--color-text-secondary)' }}
          aria-label={theme === 'dark' ? 'Tema claro' : 'Tema escuro'}>
          {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
        </button>
        {isAuthenticated ? <UserDropdown /> : (
          <button onClick={() => navigate('/login')} className="text-xs font-medium h-8 px-3 rounded-md transition-colors text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)]">
            Entrar
          </button>
        )}
      </div>
    </header>
  );
}

function AppLayout() {
  const { user, isAuthenticated } = useAuth();
  const location = useLocation();
  const { theme, toggle } = useTheme();
  const [cmdOpen, setCmdOpen] = useState(false);
  const isMapPage = location.pathname === '/mapa';
  const isAuthPage = location.pathname === '/login' || location.pathname === '/registro';
  const isLanding = location.pathname === '/';

  useEffect(() => {
    function handleKeyDown(e) {
      if (!isAuthenticated) return;
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setCmdOpen(o => !o);
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isAuthenticated]);

  const shouldRenderHeader = isAuthenticated && !isAuthPage && !isMapPage && !isLanding;

  return (
    <div style={{ height: '100dvh', display: 'flex', flexDirection: 'column', background: 'var(--color-bg-primary)' }}>
      {shouldRenderHeader && (
        <AppHeader
          theme={theme}
          onToggleTheme={toggle}
          onOpenCmd={() => setCmdOpen(true)}
        />
      )}

      <main id="main-content" style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'auto' }}>
        <Suspense fallback={<PageFallback />}>
          <Routes>
            <Route path="/" element={<AnimatedRoute><Landing /></AnimatedRoute>} />
            <Route path="/mapa" element={<div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}><MapPage /></div>} />
            <Route path="/login" element={<AnimatedRoute><Login /></AnimatedRoute>} />
            <Route path="/registro" element={<AnimatedRoute><Register /></AnimatedRoute>} />
            <Route path="/escolher-nome" element={<ProtectedRoute><AnimatedRoute><EscolherNome /></AnimatedRoute></ProtectedRoute>} />
            <Route path="/lista" element={<ProtectedRoute><AnimatedRoute><DefectList /></AnimatedRoute></ProtectedRoute>} />
            <Route path="/config" element={<ProtectedRoute><AnimatedRoute><Settings /></AnimatedRoute></ProtectedRoute>} />
            <Route path="/conta" element={<ProtectedRoute><AnimatedRoute><ProfileSettings /></AnimatedRoute></ProtectedRoute>} />
            <Route path="/configuracoes" element={<ProtectedRoute><AnimatedRoute><GeneralSettings /></AnimatedRoute></ProtectedRoute>} />
            <Route path="/admin/dashboard" element={<ProtectedRoute><AnimatedRoute><AdminDashboardMetrics /></AnimatedRoute></ProtectedRoute>} />
            <Route path="/admin/usuarios" element={<ProtectedRoute><AnimatedRoute><SuperAdmin /></AnimatedRoute></ProtectedRoute>} />
            <Route path="*" element={<Navigate to="/" />} />
          </Routes>
        </Suspense>
      </main>

      <CommandMenu open={cmdOpen} onClose={() => setCmdOpen(false)} isAdmin={user?.admin} isAdminMunicipal={['admin_municipal', 'super_admin'].includes(user?.papel)} />
    </div>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <IconContext.Provider value={{ weight: 'light', size: 20 }}>
        <ThemeProvider>
        <AuthProvider>
          <ToastProvider>
            <BrowserRouter>
              <KeyboardNav />
              <AppLayout />
            </BrowserRouter>
          </ToastProvider>
        </AuthProvider>
        </ThemeProvider>
      </IconContext.Provider>
    </ErrorBoundary>
  );
}

export default App;
