import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/toast-context';
import { api } from '../services/api';

/** Único passo depois do login com Google: como a pessoa quer ser chamada. */
export default function EscolherNome() {
  const { user, updateUser } = useAuth();
  const navigate = useNavigate();
  const addToast = useToast();
  const [nome, setNome] = useState(user?.nome || '');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e) {
    e.preventDefault();
    const limpo = nome.trim();
    if (limpo.length < 2) { setError('Informe um nome com pelo menos 2 caracteres.'); return; }
    setLoading(true);
    setError('');
    try {
      await api.updateProfile({ nome: limpo });
      updateUser({ nome: limpo });
      addToast('Tudo pronto!');
      navigate('/mapa');
    } catch (err) {
      setError(err.message || 'Erro ao salvar o nome.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-dvh flex items-center justify-center bg-[var(--color-bg-primary)] p-4">
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}
        className="w-full max-w-md border p-8" style={{ background: 'var(--color-bg-surface)', borderColor: 'var(--color-border-default)' }}>
        <h1 className="text-lg font-semibold" style={{ color: 'var(--color-text-primary)' }}>Como quer ser chamado?</h1>
        <p className="text-sm mt-2 mb-6" style={{ color: 'var(--color-text-muted)' }}>
          Esse nome aparece nos seus chamados. Você pode mudar depois em Conta.
        </p>
        <form onSubmit={handleSubmit} className="space-y-4">
          <input
            autoFocus
            type="text"
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            maxLength={80}
            className="w-full h-12 px-4 border text-sm outline-none transition-colors bg-[var(--color-bg-input)] text-[var(--color-text-primary)]"
            style={{ borderColor: error ? 'var(--color-error)' : 'var(--color-border-default)' }}
            onFocus={(e) => { e.target.style.borderColor = 'var(--color-gold-500)'; }}
            onBlur={(e) => { e.target.style.borderColor = error ? 'var(--color-error)' : 'var(--color-border-default)'; }}
            placeholder="Seu nome"
          />
          {error && <p className="text-xs" style={{ color: 'var(--color-error)' }}>{error}</p>}
          <button type="submit" disabled={loading}
            className="w-full h-12 font-semibold text-sm transition-all disabled:opacity-50"
            style={{ background: 'var(--color-gold-500)', color: 'var(--color-on-primary)' }}>
            {loading ? 'Salvando...' : 'Continuar'}
          </button>
        </form>
      </motion.div>
    </div>
  );
}
