import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Camera, CheckCircle, WarningCircle, User, Lock, Bell, Sliders, Trash } from '@phosphor-icons/react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/toast-context';
import { api } from '../services/api';
import { Button } from '../components/ui/button';
import SearchableSelect from '../components/ui/searchable-select';

const navItems = [
  { id: 'conta', icon: User, label: 'Minha Conta' },
  { id: 'seguranca', icon: Lock, label: 'Segurança' },
  { id: 'notificacoes', icon: Bell, label: 'Notificações' },
  { id: 'preferencias', icon: Sliders, label: 'Preferências' },
];

export default function ProfileSettings() {
  const { user, isAuthenticated, updateUser } = useAuth();
  const navigate = useNavigate();
  const addToast = useToast();
  const fileRef = useRef(null);
  const [nome, setNome] = useState('');
  const [email, setEmail] = useState('');
  const [senhaAtual, setSenhaAtual] = useState('');
  const [novaSenha, setNovaSenha] = useState('');
  const [fotoPreview, setFotoPreview] = useState(null);
  const [saving, setSaving] = useState(false);
  const [municipios, setMunicipios] = useState([]);
  const [municipioId, setMunicipioId] = useState('');
  const municipioOptions = municipios.map(m => ({ value: m.codigo, label: m.nome, group: m.uf_sigla }));
  const [codigoVerificacao, setCodigoVerificacao] = useState('');
  const [verificando, setVerificando] = useState(false);
  const [activeSection, setActiveSection] = useState('conta');

  useEffect(() => {
    if (!isAuthenticated) { navigate('/login'); return; }
    if (user) { setNome(user.nome || ''); setEmail(user.email || ''); setMunicipioId(user.municipio_id || ''); }
    api.listMunicipios().then(setMunicipios).catch(() => {});
  }, [isAuthenticated, user, navigate]);

  const handleFoto = useCallback((e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { addToast('Arquivo muito grande. Máximo 5MB.', 'error'); return; }
    const reader = new FileReader();
    reader.onload = () => setFotoPreview(reader.result);
    reader.readAsDataURL(file);
  }, [addToast]);

  const handleVerificarEmail = useCallback(async () => {
    if (!codigoVerificacao) { addToast('Digite o código de verificação.', 'error'); return; }
    setVerificando(true);
    try {
      await api.verificarEmail(codigoVerificacao);
      updateUser({ email_verificado: true });
      addToast('Email verificado com sucesso!');
      setCodigoVerificacao('');
    } catch (err) { addToast('Erro: ' + err.message, 'error'); }
    finally { setVerificando(false); }
  }, [codigoVerificacao, addToast, updateUser]);

  const handleReenviarCodigo = useCallback(async () => {
    try {
      await api.reenviarCodigo();
      addToast('Código reenviado para seu email.');
    } catch (err) { addToast('Erro: ' + err.message, 'error'); }
  }, [addToast]);

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      if (nome !== user?.nome) {
        await api.updateProfile({ nome });
      }
      if (senhaAtual && novaSenha) {
        await api.updatePassword(senhaAtual, novaSenha);
        setSenhaAtual('');
        setNovaSenha('');
      }
      if (municipioId !== user?.municipio_id && municipioId) {
        const res = await api.updateMunicipio(municipioId);
        updateUser({ municipio_id: municipioId, municipio: res.municipio });
      }
      addToast('Alterações salvas com sucesso!');
    } catch (err) { addToast('Erro ao salvar: ' + err.message, 'error'); }
    finally { setSaving(false); }
  }, [nome, senhaAtual, novaSenha, municipioId, user, addToast, updateUser]);

  return (
    <div className="p-5 max-w-4xl mx-auto">
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="text-lg font-bold mb-1" style={{ color: 'var(--color-text-primary)' }}>Configurações</h1>
        <p className="text-sm mb-6" style={{ color: 'var(--color-text-muted)' }}>Gerencie sua conta e preferências</p>

        <div className="flex flex-wrap gap-6">
          {/* Sidebar Navigation */}
          <nav className="flex flex-col gap-1" style={{ minWidth: '12rem' }}>
            {navItems.map(item => (
              <button key={item.id} onClick={() => setActiveSection(item.id)}
                className="flex items-center gap-2 px-3 py-2 text-sm text-left transition-colors"
                style={activeSection === item.id
                  ? { background: 'var(--color-gold-muted)', color: 'var(--color-gold-text)' }
                  : { color: 'var(--color-text-secondary)' }}
                onMouseEnter={e => { if (activeSection !== item.id) { e.currentTarget.style.background = 'var(--color-bg-hover)'; e.currentTarget.style.color = 'var(--color-text-primary)'; } }}
                onMouseLeave={e => { if (activeSection !== item.id) { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--color-text-secondary)'; } }}>
                <item.icon size={16} />
                {item.label}
              </button>
            ))}
          </nav>

          {/* Content */}
          <div style={{ flex: 1, minWidth: '300px' }}>
          {activeSection === 'conta' && (
          <div className="border p-6 space-y-6" style={{ background: 'var(--color-bg-surface)', borderColor: 'var(--color-border-default)' }}>
            <h2 className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>Perfil</h2>
            <p className="text-xs -mt-4" style={{ color: 'var(--color-text-muted)' }}>Informações da sua conta</p>
            <div className="flex items-center gap-4">
            <div className="relative w-16 h-16 rounded-full overflow-hidden cursor-pointer group" style={{ background: 'var(--color-bg-elevated)' }}
              onClick={() => fileRef.current?.click()}>
              {fotoPreview ? <img src={fotoPreview} alt="" className="w-full h-full object-cover" />
                : <div className="w-full h-full flex items-center justify-center text-lg font-semibold" style={{ color: 'var(--color-text-muted)' }}>
                    {user?.nome?.charAt(0)?.toUpperCase() || '?'}
                  </div>}
              <div className="absolute inset-0 bg-black/50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                <Camera size={20} weight="bold" style={{ color: 'white' }} />
              </div>
              <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={handleFoto} />
            </div>
            <div>
              <p className="text-sm font-medium" style={{ color: 'var(--color-text-primary)' }}>{user?.nome || 'Usuário'}</p>
              <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>Arraste ou clique para enviar</p>
            </div>
          </div>

          <div className="space-y-4">
            <div className="relative">
              <input id="nome" type="text" value={nome} onChange={e => setNome(e.target.value)}
                className="peer w-full h-12 px-4 pt-4 rounded-lg border text-sm outline-none transition-colors bg-[var(--color-bg-input)]"
                style={{ borderColor: 'var(--color-border-default)', color: 'var(--color-text-primary)' }}
                onFocus={e => e.target.style.borderColor = 'var(--color-gold-500)'}
                onBlur={e => e.target.style.borderColor = 'var(--color-border-default)'} placeholder=" " />
              <label htmlFor="nome" className="absolute left-4 top-0 text-xs transition-all peer-placeholder-shown:text-sm peer-placeholder-shown:top-3.5 peer-focus:top-0 peer-focus:text-xs"
                style={{ color: nome ? 'var(--color-gold-500)' : 'var(--color-text-muted)' }}>Nome completo</label>
            </div>

            <div className="relative">
              <input id="email" type="email" value={email} disabled
                className="peer w-full h-12 px-4 pt-4 rounded-lg border text-sm outline-none bg-[var(--color-bg-input)] opacity-70 cursor-not-allowed"
                style={{ borderColor: 'var(--color-border-default)', color: 'var(--color-text-primary)' }} placeholder=" " />
              <label htmlFor="email" className="absolute left-4 top-0 text-xs"
                style={{ color: 'var(--color-text-muted)' }}>E-mail</label>
              <div className="absolute right-3 top-3">
                {user?.email_verificado ? (
                  <span className="flex items-center gap-1 text-xs" style={{ color: 'var(--color-success)' }}>
                    <CheckCircle size={14} /> Verificado
                  </span>
                ) : (
                  <span className="flex items-center gap-1 text-xs" style={{ color: 'var(--color-gold-text)' }}>
                    <WarningCircle size={14} /> Não verificado
                  </span>
                )}
              </div>
            </div>

            {user?.cpf && (
              <div className="relative">
                <input id="cpf" type="text" value={user.cpf.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4')} disabled
                  className="peer w-full h-12 px-4 pt-4 rounded-lg border text-sm outline-none bg-[var(--color-bg-input)] opacity-70 cursor-not-allowed"
                  style={{ borderColor: 'var(--color-border-default)', color: 'var(--color-text-primary)' }} placeholder=" " />
                <label htmlFor="cpf" className="absolute left-4 top-0 text-xs"
                  style={{ color: 'var(--color-text-muted)' }}>CPF</label>
              </div>
            )}

            <SearchableSelect options={municipioOptions} value={municipioId} onChange={setMunicipioId}
              placeholder="Selecione um município" label="Município" />

            {!user?.email_verificado && (
              <div className="rounded-lg border p-4" style={{ borderColor: 'var(--color-gold-500)', background: 'rgba(212,160,23,0.06)' }}>
                <h4 className="text-xs font-semibold mb-2" style={{ color: 'var(--color-gold-text)' }}>Verificação de Email</h4>
                <p className="text-xs mb-2" style={{ color: 'var(--color-text-muted)' }}>Digite o código enviado para seu email.</p>
                <div className="flex gap-2">
                  <input type="text" placeholder="000000" maxLength={6} value={codigoVerificacao}
                    onChange={e => setCodigoVerificacao(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    className="flex-1 h-10 px-3 rounded-lg border text-sm outline-none text-center tracking-widest font-mono bg-[var(--color-bg-input)]"
                    style={{ borderColor: 'var(--color-border-default)', color: 'var(--color-text-primary)' }} />
                  <Button variant="primary" size="sm" onClick={handleVerificarEmail} disabled={verificando || codigoVerificacao.length < 6}>
                    {verificando ? '...' : 'Verificar'}
                  </Button>
                </div>
                <button onClick={handleReenviarCodigo} className="text-xs mt-2 hover:underline"
                  style={{ color: 'var(--color-gold-text)' }}>Reenviar código</button>
              </div>
            )}
          </div>

          <div className="border-t pt-4" style={{ borderColor: 'var(--color-border-default)' }}>
            <h3 className="text-sm font-semibold mb-3" style={{ color: 'var(--color-text-primary)' }}>Alterar Senha</h3>
            <div className="space-y-3">
              <input type="password" placeholder="Senha atual" value={senhaAtual} onChange={e => setSenhaAtual(e.target.value)}
                className="w-full h-11 px-4 rounded-lg border text-sm outline-none bg-[var(--color-bg-input)]"
                style={{ borderColor: 'var(--color-border-default)', color: 'var(--color-text-primary)' }}
                onFocus={e => e.target.style.borderColor = 'var(--color-gold-500)'}
                onBlur={e => e.target.style.borderColor = 'var(--color-border-default)'} />
              <input type="password" placeholder="Nova senha" value={novaSenha} onChange={e => setNovaSenha(e.target.value)}
                className="w-full h-11 px-4 rounded-lg border text-sm outline-none bg-[var(--color-bg-input)]"
                style={{ borderColor: 'var(--color-border-default)', color: 'var(--color-text-primary)' }}
                onFocus={e => e.target.style.borderColor = 'var(--color-gold-500)'}
                onBlur={e => e.target.style.borderColor = 'var(--color-border-default)'} />
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={() => navigate('/mapa')}>Cancelar</Button>
            <Button variant="primary" onClick={handleSave} disabled={saving}>{saving ? 'Salvando...' : 'Salvar Alterações'}</Button>
          </div>
          </div>
          )}

          {activeSection === 'seguranca' && (
            <div className="border p-6" style={{ background: 'var(--color-bg-surface)', borderColor: 'var(--color-border-default)' }}>
              <h2 className="text-sm font-semibold mb-1" style={{ color: 'var(--color-text-primary)' }}>Segurança</h2>
              <p className="text-xs mb-4" style={{ color: 'var(--color-text-muted)' }}>Gerencie sua senha e autenticação</p>
              <div className="flex flex-col">
                <div className="flex items-center justify-between py-3" style={{ borderBottom: '1px solid var(--color-border-default)' }}>
                  <div>
                    <div className="text-sm" style={{ color: 'var(--color-text-primary)' }}>Alterar senha</div>
                    <div className="text-xs mt-0.5" style={{ color: 'var(--color-text-muted)' }}>Atualize sua senha de acesso</div>
                  </div>
                  <Button variant="secondary" size="sm" onClick={() => { setActiveSection('conta'); window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' }); }}>Alterar</Button>
                </div>
                <div className="flex items-center justify-between py-3">
                  <div>
                    <div className="text-sm" style={{ color: 'var(--color-text-primary)' }}>Autenticação de dois fatores (2FA)</div>
                    <div className="text-xs mt-0.5" style={{ color: 'var(--color-text-muted)' }}>Em desenvolvimento</div>
                  </div>
                  <Button variant="ghost" size="sm" onClick={() => addToast('Função em desenvolvimento.', 'info')}>Gerenciar</Button>
                </div>
              </div>
            </div>
          )}

          {activeSection === 'notificacoes' && (
            <div className="border p-6" style={{ background: 'var(--color-bg-surface)', borderColor: 'var(--color-border-default)' }}>
              <h2 className="text-sm font-semibold mb-1" style={{ color: 'var(--color-text-primary)' }}>Notificações</h2>
              <p className="text-xs mb-4" style={{ color: 'var(--color-text-muted)' }}>Controle como você recebe alertas</p>
              <div className="flex flex-col">
                <div className="flex items-center justify-between py-3" style={{ borderBottom: '1px solid var(--color-border-default)' }}>
                  <div>
                    <div className="text-sm" style={{ color: 'var(--color-text-primary)' }}>Notificações push</div>
                    <div className="text-xs mt-0.5" style={{ color: 'var(--color-text-muted)' }}>Receba alertas no navegador</div>
                  </div>
                  <Button variant="secondary" size="sm" onClick={() => addToast('Configuração de push em desenvolvimento.', 'info')}>Gerenciar</Button>
                </div>
                <div className="flex items-center justify-between py-3">
                  <div>
                    <div className="text-sm" style={{ color: 'var(--color-text-primary)' }}>Atualizações de chamados</div>
                    <div className="text-xs mt-0.5" style={{ color: 'var(--color-text-muted)' }}>Quando um chamado que você apoiou mudar de status</div>
                  </div>
                  <Button variant="ghost" size="sm" onClick={() => addToast('Função em desenvolvimento.', 'info')}>Gerenciar</Button>
                </div>
              </div>
            </div>
          )}

          {activeSection === 'preferencias' && (
            <div className="border p-6" style={{ background: 'var(--color-bg-surface)', borderColor: 'var(--color-border-default)' }}>
              <h2 className="text-sm font-semibold mb-1" style={{ color: 'var(--color-text-primary)' }}>Preferências</h2>
              <p className="text-xs mb-4" style={{ color: 'var(--color-text-muted)' }}>Personalize sua experiência</p>
              <div className="flex flex-col">
                <div className="flex items-center justify-between py-3">
                  <div>
                    <div className="text-sm" style={{ color: 'var(--color-text-primary)' }}>Idioma</div>
                    <div className="text-xs mt-0.5" style={{ color: 'var(--color-text-muted)' }}>Idioma da interface</div>
                  </div>
                  <span className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>Português (BR)</span>
                </div>
              </div>
            </div>
          )}

          {activeSection === 'conta' && (
            <div className="border p-6 mt-6" style={{ background: 'var(--color-bg-surface)', borderColor: 'rgba(207,68,68,0.3)' }}>
              <h2 className="text-sm font-semibold mb-1" style={{ color: 'var(--color-error)' }}>Zona de perigo</h2>
              <p className="text-xs mb-4" style={{ color: 'var(--color-text-muted)' }}>Ações irreversíveis</p>
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm" style={{ color: 'var(--color-text-primary)' }}>Excluir conta</div>
                  <div className="text-xs mt-0.5" style={{ color: 'var(--color-text-muted)' }}>Remove permanentemente todos os seus dados</div>
                </div>
                <Button variant="danger" size="sm" onClick={() => addToast('Função em desenvolvimento.', 'info')}>
                  <Trash size={12} /> Excluir
                </Button>
              </div>
            </div>
          )}
          </div>
        </div>
      </motion.div>
    </div>
  );
}
