import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { api } from '../services/api';

const AuthContext = createContext(null);

function decodeToken(token) {
  try {
    return JSON.parse(atob(token.split('.')[1]));
  } catch {
    return null;
  }
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(localStorage.getItem('token'));
  const [loading, setLoading] = useState(true);

  const subscribeToPush = useCallback(async () => {
    try {
      if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
      const reg = await navigator.serviceWorker.ready;
      let sub = await reg.pushManager.getSubscription();
      if (!sub) {
        const keyRes = await api.pushKey();
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: keyRes.publicKey,
        });
      }
      await api.pushSubscribe(sub);
    } catch {
      // falha silenciosa - notificações são auxiliares
    }
  }, []);

  useEffect(() => {
    const payload = decodeToken(token);
    if (payload) {
      const stored = localStorage.getItem('userData');
      const userData = stored ? JSON.parse(stored) : {};
      const userBase = {
        id: userData.id || payload.user_id,
        email: userData.email || payload.email,
        municipio_id: userData.municipio_id || null,
        admin: userData.admin || false,
        papel: userData.papel || 'cidadao',
        municipio: userData.municipio || null,
        nome: userData.nome || '',
        cpf: userData.cpf || null,
        email_verificado: userData.email_verified || false,
      };
      setUser(userBase);
      subscribeToPush();
      const precisaMunicipio = userBase.municipio_id && (
        !userBase.municipio ||
        !userBase.municipio.poligono_json ||
        typeof userBase.municipio.min_lat !== 'number' ||
        typeof userBase.municipio.max_lat !== 'number' ||
        typeof userBase.municipio.min_lng !== 'number' ||
        typeof userBase.municipio.max_lng !== 'number'
      );
      if (precisaMunicipio) {
        api.getMunicipio(userBase.municipio_id).then(mun => {
          const flat = { ...mun.properties, id: mun.id };
          setUser(prev => ({ ...prev, municipio: flat }));
          const stored2 = JSON.parse(localStorage.getItem('userData') || '{}');
          stored2.municipio = flat;
          localStorage.setItem('userData', JSON.stringify(stored2));
        }).catch(() => {});
      }
    } else if (token) {
      logout();
    }
    setLoading(false);
  }, [token, subscribeToPush]);

  const login = useCallback((responseData) => {
    const { access, refresh, user } = responseData;
    localStorage.setItem('token', access);
    if (refresh) localStorage.setItem('refresh', refresh);
    if (user) localStorage.setItem('userData', JSON.stringify(user));
    setToken(access);
    setUser(user || null);
    subscribeToPush();
  }, [subscribeToPush]);

  const updateUser = useCallback((updates) => {
    setUser(prev => {
      const next = { ...prev, ...updates };
      const stored = { ...JSON.parse(localStorage.getItem('userData') || '{}'), ...updates };
      localStorage.setItem('userData', JSON.stringify(stored));
      return next;
    });
  }, []);

  function logout() {
    localStorage.removeItem('token');
    localStorage.removeItem('refresh');
    localStorage.removeItem('userData');
    setToken(null);
    setUser(null);
  }

  return (
      <AuthContext.Provider value={{ user, token, login, updateUser, logout, isAuthenticated: !!token, loading }}>
      {children}
    </AuthContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export const useAuth = () => useContext(AuthContext);
