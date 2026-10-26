import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Card } from '../components/ui/card';

export default function GeneralSettings() {
  const { isAuthenticated } = useAuth();
  const navigate = useNavigate();
  useEffect(() => { if (!isAuthenticated) { navigate('/login'); } }, [isAuthenticated, navigate]);
  return (
    <div className="p-5 max-w-2xl mx-auto">
      <h1 className="text-lg font-bold mb-1" style={{ color: 'var(--color-text-primary)' }}>Configurações Gerais</h1>
      <p className="text-sm mb-6" style={{ color: 'var(--color-text-muted)' }}>Preferências do sistema</p>
      <Card className="p-6">
        <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>Em desenvolvimento.</p>
      </Card>
    </div>
  );
}
