import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ShieldCheck, Shield, MapPin, Check, X } from '@phosphor-icons/react';
import { useAuth } from '../context/AuthContext';
import { api } from '../services/api';
import { Button } from '../components/ui/button';
import { useToast } from '../components/toast-context';

export default function SuperAdmin() {
  const { user, isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const addToast = useToast();
  const [users, setUsers] = useState([]);
  const [municipios, setMunicipios] = useState([]);
  const [saving, setSaving] = useState({});

  useEffect(() => {
    if (!isAuthenticated) { navigate('/login'); return; }
    if (!['admin_municipal', 'super_admin'].includes(user?.papel)) { navigate('/mapa'); return; }
    Promise.all([
      api.adminListUsers(),
      api.listMunicipios(),
    ]).then(([us, muns]) => {
      setUsers(us);
      setMunicipios(muns);
    }).catch(() => addToast('Erro ao carregar dados', 'error'));
  }, [isAuthenticated, user, navigate, addToast]);

  const toggleAdmin = async (u) => {
    if (u.super_admin) return;
    setSaving(prev => ({ ...prev, [`admin-${u.id}`]: true }));
    try {
      await api.adminToggleAdmin(u.id, !u.admin);
      setUsers(prev => prev.map(x => x.id === u.id ? { ...x, admin: !u.admin } : x));
      addToast(u.admin ? 'Admin removido' : 'Usuário promovido a admin');
    } catch (err) { addToast('Erro: ' + err.message, 'error'); }
    finally { setSaving(prev => { const n = { ...prev }; delete n[`admin-${u.id}`]; return n; }); }
  };

  const setMunicipio = async (u, municipioId) => {
    setSaving(prev => ({ ...prev, [`mun-${u.id}`]: true }));
    try {
      await api.adminSetMunicipio(u.id, municipioId);
      const mun = municipios.find(m => m.codigo === municipioId);
      setUsers(prev => prev.map(x => x.id === u.id ? { ...x, municipio: mun ? { codigo: mun.codigo, nome: mun.nome, uf_sigla: mun.uf_sigla } : null } : x));
      addToast('Município atualizado');
    } catch (err) { addToast('Erro: ' + err.message, 'error'); }
    finally { setSaving(prev => { const n = { ...prev }; delete n[`mun-${u.id}`]; return n; }); }
  };

  return (
    <div className="p-5 max-w-5xl mx-auto">
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="text-lg font-bold mb-1" style={{ color: 'var(--color-text-primary)' }}>Gerenciar Usuários</h1>
        <p className="text-sm mb-5" style={{ color: 'var(--color-text-muted)' }}>Administre usuários, vínculo municipal e permissões de admin</p>

        <div className="overflow-x-auto rounded-md border" style={{ borderColor: 'var(--color-border-default)' }}>
          <table className="w-full text-sm" style={{ color: 'var(--color-text-primary)' }}>
            <thead>
              <tr style={{ background: 'var(--color-bg-elevated)' }}>
                <th className="px-4 py-2.5 text-left font-semibold whitespace-nowrap" style={{ color: 'var(--color-text-muted)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Usuário</th>
                <th className="px-4 py-2.5 text-left font-semibold whitespace-nowrap" style={{ color: 'var(--color-text-muted)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Email</th>
                <th className="px-4 py-2.5 text-left font-semibold whitespace-nowrap" style={{ color: 'var(--color-text-muted)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Município</th>
                <th className="px-4 py-2.5 text-right font-semibold whitespace-nowrap" style={{ color: 'var(--color-text-muted)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Admin</th>
              </tr>
            </thead>
            <tbody>
              {users.map(u => (
                <tr key={u.id} style={{ borderTop: '1px solid var(--color-border-default)' }}>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium" style={{ color: 'var(--color-text-primary)' }}>{u.nome}</span>
                      {u.super_admin && (
                        <span className="text-[10px] font-bold px-1.5 py-0.5 uppercase tracking-wide" style={{ background: 'var(--color-gold-muted)', color: 'var(--color-gold-text)' }}>SUPER</span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-xs" style={{ color: 'var(--color-text-muted)' }}>{u.email}</td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <div className="flex items-center gap-1.5">
                      <MapPin size={12} style={{ color: 'var(--color-text-muted)' }} />
                       <select value={u.municipio?.codigo || ''} disabled={saving[`mun-${u.id}`]}
                         onChange={e => setMunicipio(u, e.target.value || null)}
                        className="text-xs bg-transparent border-none outline-none cursor-pointer max-w-[180px]"
                        style={{ color: u.municipio ? 'var(--color-text-primary)' : 'var(--color-text-muted)' }}>
                        <option value="">— Sem município —</option>
                        {municipios.map(m => (
                          <option key={m.codigo} value={m.codigo}>{m.nome} / {m.uf_sigla}</option>
                        ))}
                      </select>
                      {saving[`mun-${u.id}`] && <span className="text-[10px]" style={{ color: 'var(--color-text-muted)' }}>...</span>}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    <div className="flex items-center justify-end gap-2">
                      {u.admin || u.super_admin ? (
                        <span className="text-xs font-medium flex items-center gap-1" style={{ color: 'var(--color-success)' }}>
                          <ShieldCheck size={13} /> Admin
                        </span>
                      ) : (
                        <span className="text-xs flex items-center gap-1" style={{ color: 'var(--color-text-muted)' }}>
                          <Shield size={13} /> Comum
                        </span>
                      )}
                      {!u.super_admin && (
                        <Button variant={u.admin ? 'danger' : 'secondary'} size="xs" onClick={() => toggleAdmin(u)} disabled={saving[`admin-${u.id}`]}
                          className="flex items-center gap-1">
                          {saving[`admin-${u.id}`] ? '...' : u.admin ? <><X size={11} /> Remover</> : <><Check size={11} /> Tornar Admin</>}
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </motion.div>
    </div>
  );
}
