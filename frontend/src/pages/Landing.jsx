import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { MapPin, Brain, ShieldCheck, DeviceMobile, ArrowRight } from '@phosphor-icons/react';

const features = [
  { icon: MapPin, title: 'Reporte com GPS', desc: 'Localização precisa do defeito' },
  { icon: Brain, title: 'Classificação IA', desc: 'Categorização automática por Inteligência Artificial' },
  { icon: ShieldCheck, title: 'Transparente', desc: 'Acompanhe o status do seu chamado em tempo real' },
  { icon: DeviceMobile, title: 'Offline-First', desc: 'Reporte mesmo sem conexão com internet' },
];

const EASE = [0.16, 1, 0.3, 1];

export default function Landing() {
  const navigate = useNavigate();

  return (
    <div className="min-h-dvh flex flex-col" style={{ background: 'var(--color-bg-primary)', color: 'var(--color-text-primary)' }}>
      {/* Header */}
      <header className="flex items-center justify-between px-5" style={{ height: 56, borderBottom: '1px solid var(--color-border-default)', background: 'var(--color-bg-elevated)', zIndex: 1000 }}>
        <div className="flex items-center gap-2">
          <div style={{ width: '1.75rem', height: '1.75rem', background: 'transparent', border: '1px solid var(--color-icon)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <img src="/icon.svg" alt="Central de Inteligência Urbana" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          </div>
          <div className="max-sm:hidden">
            <h1 className="text-sm font-medium" style={{ color: 'var(--color-text-primary)' }}>Central de Inteligência Urbana</h1>
            <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>Chamados para Serviços Públicos</p>
          </div>
        </div>
        <button
          onClick={() => navigate('/login')}
          className="text-xs font-medium h-8 px-4 transition-colors"
          style={{ background: 'var(--color-gold-500)', color: 'var(--color-text-inverse)' }}
          onMouseEnter={e => { e.currentTarget.style.background = 'var(--color-gold-400)'; }}
          onMouseLeave={e => { e.currentTarget.style.background = 'var(--color-gold-500)'; }}
          aria-label="Entrar"
        >
          Entrar
        </button>
      </header>

      <main className="flex-1 overflow-y-auto">
        {/* Hero */}
        <section className="px-5 py-20 text-center" style={{ maxWidth: 880, margin: '0 auto' }}>
          <motion.span
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, ease: EASE }}
            className="inline-block text-[0.6875rem] font-semibold uppercase tracking-wider mb-6 px-3 py-1"
            style={{ background: 'var(--color-gold-muted)', color: 'var(--color-gold-500)' }}
          >
            Plataforma GovTech
          </motion.span>

          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, ease: EASE }}
            className="text-4xl md:text-5xl font-bold uppercase tracking-wide mb-4"
            style={{ lineHeight: 1.15 }}
          >
            Central de Inteligência Urbana
          </motion.h1>

          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.2, duration: 0.4 }}
            className="text-lg mb-10"
            style={{ color: 'var(--color-text-secondary)' }}
          >
            Reporte defeitos de infraestrutura urbana e acompanhe a resolução
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3, duration: 0.4, ease: EASE }}
            className="flex flex-col sm:flex-row gap-3 justify-center"
          >
            <button
              onClick={() => navigate('/login')}
              className="h-12 px-8 text-sm font-semibold transition-colors flex items-center justify-center gap-2"
              style={{ background: 'var(--color-gold-500)', color: 'var(--color-text-inverse)' }}
              onMouseEnter={e => { e.currentTarget.style.background = 'var(--color-gold-400)'; }}
              onMouseLeave={e => { e.currentTarget.style.background = 'var(--color-gold-500)'; }}
              aria-label="Entrar no sistema"
            >
              Entrar <ArrowRight size={16} />
            </button>
          </motion.div>

        </section>

        {/* Features */}
        <section className="px-5 pb-20" style={{ maxWidth: 1080, margin: '0 auto' }}>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {features.map((f, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: '-60px' }}
                transition={{ delay: 0.08 * i, duration: 0.4, ease: EASE }}
                className="p-6 text-left"
                style={{ background: 'var(--color-bg-surface)', border: '1px solid var(--color-border-default)', transition: 'border-color 0.2s cubic-bezier(0.16,1,0.3,1)' }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--color-gold-500)'; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--color-border-default)'; }}
              >
                <div className="w-11 h-11 flex items-center justify-center mb-4" style={{ background: 'var(--color-gold-muted)' }}>
                  <f.icon size={24} style={{ color: 'var(--color-gold-500)' }} />
                </div>
                <h3 className="text-sm font-semibold uppercase tracking-wide mb-1.5" style={{ color: 'var(--color-text-primary)' }}>{f.title}</h3>
                <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>{f.desc}</p>
              </motion.div>
            ))}
          </div>
        </section>

      </main>

      {/* Footer */}
      <footer className="text-center px-5 py-6" style={{ position: 'relative', borderTop: '1px solid var(--color-border-default)', color: 'var(--color-text-muted)', fontSize: '0.75rem' }}>
        <p>Central de Inteligência Urbana</p>
        <p className="mt-1">Design System: AMOLED Dark Premium / Gold Accent</p>
        <span
          className="absolute bottom-2 right-3 font-mono"
          style={{ fontSize: '0.6rem', color: 'var(--color-text-muted)' }}
          title="Commit e data do último deploy (automação GitHub Actions)"
        >
          {import.meta.env.VITE_GIT_SHA || 'dev'} · {import.meta.env.VITE_BUILD_DATE || 'dev'}
        </span>
      </footer>
    </div>
  );
}
