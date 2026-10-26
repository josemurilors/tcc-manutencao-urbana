import { formDataToOfflinePayload } from './offline-payload';

const API_URL = import.meta.env.VITE_API_URL || '';

function extractError(err) {
  if (!err) return 'Erro na requisição';
  if (typeof err === 'string') return err;
  if (err.detail) return err.detail;
  if (err.error) return err.error;
  const field = Object.values(err)[0];
  if (Array.isArray(field)) return field[0];
  if (typeof field === 'string') return field;
  return 'Erro na requisição';
}

async function request(endpoint, options = {}) {
  // Endpoint público (options.publico): não manda o token — um token velho no
  // navegador daria 401 à toa.
  const token = options.publico ? null : localStorage.getItem('token');

  const headers = {
    ...(token && { Authorization: `Bearer ${token}` }),
    ...options.headers,
  };

  const fetchOptions = {
    method: options.method || 'GET',
    headers,
  };

  const isFormData = options.body instanceof FormData;
  if (options.body && !isFormData) {
    headers['Content-Type'] = 'application/json';
    fetchOptions.body = JSON.stringify(options.body);
  } else if (isFormData) {
    fetchOptions.body = options.body;
  }

  const res = await fetch(`${API_URL}${endpoint}`, fetchOptions);

  if (!res.ok) {
    if (res.status === 401) {
      const refreshToken = localStorage.getItem('refresh');
      if (refreshToken && !endpoint.includes('/auth/login/') && !endpoint.includes('/auth/register/')) {
        const refreshRes = await fetch(`${API_URL}/api/v1/auth/refresh/`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refresh: refreshToken }),
        });
        if (refreshRes.ok) {
          const { access, refresh } = await refreshRes.json();
          localStorage.setItem('token', access);
          // O backend rotaciona o refresh (ROTATE_REFRESH_TOKENS): guardar o
          // novo é o que faz a sessão "deslizar" em vez de cair 7 dias após o login.
          if (refresh) localStorage.setItem('refresh', refresh);
          options.headers = { ...options.headers, Authorization: `Bearer ${access}` };
          headers.Authorization = `Bearer ${access}`;
          const retryRes = await fetch(`${API_URL}${endpoint}`, { ...fetchOptions, headers });
          if (retryRes.status === 401) {
            // Token novo e ainda 401: a conta não existe mais. Sai da sessão.
            localStorage.removeItem('token');
            localStorage.removeItem('refresh');
            localStorage.removeItem('userData');
            window.location.href = '/login';
            throw new Error('Sessão expirada. Faça login novamente.');
          }
          if (!retryRes.ok) {
            const retryErr = await retryRes.json().catch(() => ({}));
            throw new Error(extractError(retryErr));
          }
          return retryRes.json();
        }
        localStorage.removeItem('token');
        localStorage.removeItem('refresh');
        localStorage.removeItem('userData');
        window.location.href = '/login';
        throw new Error('Sessão expirada. Faça login novamente.');
      }
    }
    const err = await res.json().catch(() => ({}));
    throw new Error(extractError(err));
  }

  return res.json();
}

async function paginated(endpoint, options = {}) {
  const data = await request(endpoint, options);
  return data?.results ?? data;
}

async function salvarOffline(formData) {
  const db = await openOfflineDB();
  const tx = db.transaction('defeitos', 'readwrite');
  tx.objectStore('defeitos').add({
    dados: await formDataToOfflinePayload(formData),
    token: localStorage.getItem('token'),
    criado_em: new Date().toISOString(),
  });
  await tx.done;
  if ('serviceWorker' in navigator && 'SyncManager' in window) {
    const reg = await navigator.serviceWorker.ready;
    await reg.sync.register('sync-defeitos');
  }
}

async function openOfflineDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('ciu-offline', 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore('defeitos', { keyPath: 'id', autoIncrement: true });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function uploadDefeito(formData) {
  try {
    return await request('/api/v1/defeitos/', { method: 'POST', body: formData });
  } catch (err) {
    if (!navigator.onLine || err.message === 'Failed to fetch' || err.message.includes('NetworkError')) {
      await salvarOffline(formData);
      return { offline: true, message: 'Chamado salvo offline. Será enviado quando houver conexão.' };
    }
    throw err;
  }
}

export const api = {
  login: (email, senha) =>
    request('/api/v1/auth/login/', { method: 'POST', body: { email, password: senha } }),

  /** Client IDs do Google por plataforma (vazios = login com Google desligado). */
  googleConfig: () => request('/api/v1/auth/google/', { publico: true }),

  loginGoogle: (idToken) =>
    request('/api/v1/auth/google/', { method: 'POST', body: { id_token: idToken }, publico: true }),

  register: (nome, email, senha, municipioId, cpf) =>
    request('/api/v1/auth/register/', { method: 'POST', body: {
      nome, email, password: senha, confirm_password: senha,
      ...(municipioId && { municipio_id: municipioId }),
      ...(cpf && { cpf }),
    } }),

  listDefeitos: (params = {}) => {
    const q = new URLSearchParams();
    if (params.ordenar) q.set('ordering', params.ordenar === 'recentes' ? '-criado_em' : '-curtidas');
    if (params.status) q.set('status', params.status);
    const qs = q.toString();
    return paginated(`/api/v1/defeitos/${qs ? '?' + qs : ''}`);
  },

  createDefeito: uploadDefeito,

  updateDefeito: (id, data) =>
    request(`/api/v1/defeitos/${id}/`, { method: 'PATCH', body: data }),

  updateDefeitoComArquivo: (id, formData) =>
    request(`/api/v1/defeitos/${id}/status/`, { method: 'PATCH', body: formData }),

  listMunicipios: () =>
    request('/api/v1/municipios/lista/'),

  getMunicipio: (codigo) =>
    request(`/api/v1/municipios/${codigo}/`),

  listCategorias: () =>
    paginated('/api/v1/categorias/'),

  meusDefeitos: () =>
    paginated('/api/v1/defeitos/meus/'),

  pushKey: () =>
    request('/api/v1/auth/public-key/'),

  pushSubscribe: (subscription) =>
    request('/api/v1/auth/subscribe/', { method: 'POST', body: { subscription } }),

  updateProfile: (data) =>
    request('/api/v1/auth/profile/', { method: 'PATCH', body: data }),

  updatePassword: async (senhaAtual, novaSenha) => {
    const res = await request('/api/v1/auth/senha/', { method: 'PATCH', body: { senha_atual: senhaAtual, nova_senha: novaSenha } });
    // Trocar a senha derruba os tokens antigos: guarda os novos desta sessão.
    if (res?.access) localStorage.setItem('token', res.access);
    if (res?.refresh) localStorage.setItem('refresh', res.refresh);
    return res;
  },

  updateMunicipio: (municipioId) =>
    request('/api/v1/auth/municipio/', { method: 'PATCH', body: { municipio_id: municipioId } }),

  verificarEmail: (codigo) =>
    request('/api/v1/auth/verificar-email/', { method: 'POST', body: { codigo } }),

  reenviarCodigo: () =>
    request('/api/v1/auth/reenviar-codigo/', { method: 'POST' }),

  apoiarDefeito: (id) =>
    request(`/api/v1/defeitos/${id}/apoiar/`, { method: 'POST' }),

  apoiei: () =>
    request('/api/v1/defeitos/apoiei/'),

  detalharDefeito: (id) =>
    request(`/api/v1/defeitos/${id}/`),

  anexarImagem: (id, file) => {
    const fd = new FormData();
    fd.append('file', file);
    return request(`/api/v1/defeitos/${id}/anexar/`, { method: 'POST', body: fd });
  },

  atenderDefeito: (id) =>
    request(`/api/v1/defeitos/${id}/atender/`, { method: 'PATCH' }),

  batchStatusDefeitos: (ids, status) =>
    request('/api/v1/defeitos/batch_status/', { method: 'PATCH', body: { ids, status } }),

  gerarOS: async (id) => {
    const token = localStorage.getItem('token');
    const headers = {
      ...(token && { Authorization: `Bearer ${token}` }),
    };
    const res = await fetch(`${API_URL}/api/v1/defeitos/${id}/ordem_servico/`, { headers });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Erro ao gerar OS' }));
      throw new Error(err.error || 'Erro ao gerar OS');
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const filename = (res.headers.get('Content-Disposition') || '').match(/filename="([^"]+)"/)?.[1] || `OS-${id}.pdf`;
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    return blob;
  },

  adminListUsers: () =>
    request('/api/v1/auth/admin/users/'),

  adminToggleAdmin: (id, admin) =>
    request(`/api/v1/auth/admin/users/${id}/admin/`, { method: 'PATCH', body: { admin } }),

  adminSetMunicipio: (id, municipioId) =>
    request(`/api/v1/auth/admin/users/${id}/municipio/`, { method: 'PATCH', body: { municipio_id: municipioId } }),

  adminEstatisticas: () =>
    request('/api/v1/auth/admin/estatisticas/'),

  getMunicipiosComAdmin: () =>
    request('/api/v1/municipios/com_admin/'),
};
