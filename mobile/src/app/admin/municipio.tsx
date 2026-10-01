/**
 * Configuração do município (contrato v3, 7.6 `municipio/`): identidade que o
 * cidadão vê, contato da prefeitura e regras de atendimento.
 *
 * Gestor e operador consultam; só o administrador salva. Envia apenas os
 * campos alterados, e `parametros` vai inteiro (mesclado com o que veio do
 * servidor) para não apagar chaves que o app não conhece.
 */

import { useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { confirmar, mensagemDeErro } from '@/components/gestao/confirmar';
import { EstadoCarga } from '@/components/gestao/estado-carga';
import { GestaoShell } from '@/components/gestao/gestao-shell';
import { usePapel } from '@/components/gestao/papeis';
import { SwitchRow } from '@/components/gestao/switch-row';
import { useDados } from '@/components/gestao/use-dados';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { SectionHeader } from '@/components/ui/section-header';
import { TextField } from '@/components/ui/text-field';
import { AppText } from '@/components/ui/text';
import { Layout, Radius, Spacing } from '@/constants/theme';
import { useColors } from '@/context/theme-context';
import { useToast } from '@/context/toast-context';
import { apiGestao } from '@/services/api-gestao';
import type { ConfigMunicipio, ConfigMunicipioAlteracao } from '@/types/gestao';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const COR_RE = /^#[0-9a-fA-F]{6}$/;
const URL_RE = /^https?:\/\/\S+\.\S+/;
// Limites do backend (`MunicipioConfigSerializer`).
const RAIO_MIN = 5;
const RAIO_MAX = 500;
// Foto de evidência: até onde a foto pode ter sido tirada do ponto do chamado.
const RAIO_EVIDENCIA_PADRAO = 150;
const RAIO_EVIDENCIA_MIN = 20;
const RAIO_EVIDENCIA_MAX = 2000;

type Form = {
  nome_exibicao: string;
  cor_primaria: string;
  email_contato: string;
  telefone: string;
  site: string;
  raio_duplicado_m: string;
  exigir_foto_conclusao: boolean;
  raio_evidencia_m: string;
};

function paraForm(c: ConfigMunicipio): Form {
  return {
    nome_exibicao: c.nome_exibicao ?? '',
    cor_primaria: c.cor_primaria ?? '',
    email_contato: c.email_contato ?? '',
    telefone: c.telefone ?? '',
    site: c.site ?? '',
    raio_duplicado_m: String(c.raio_duplicado_m ?? 30),
    // Ausente = exigida: é o padrão que a operação aplica (operacao/views.py).
    exigir_foto_conclusao: c.parametros?.exigir_foto_conclusao !== false,
    raio_evidencia_m: String(
      typeof c.parametros?.raio_evidencia_m === 'number'
        ? c.parametros.raio_evidencia_m
        : RAIO_EVIDENCIA_PADRAO,
    ),
  };
}

function validar(f: Form) {
  const erros: Partial<Record<keyof Form, string>> = {};
  if (f.cor_primaria && !COR_RE.test(f.cor_primaria)) erros.cor_primaria = 'Use o formato #RRGGBB.';
  if (f.email_contato && !EMAIL_RE.test(f.email_contato)) erros.email_contato = 'E-mail inválido.';
  if (f.site && !URL_RE.test(f.site)) erros.site = 'Comece com https://';
  const raio = Number.parseInt(f.raio_duplicado_m, 10);
  if (!Number.isFinite(raio) || raio < RAIO_MIN || raio > RAIO_MAX)
    erros.raio_duplicado_m = `De ${RAIO_MIN} a ${RAIO_MAX} metros.`;
  const evidencia = Number.parseInt(f.raio_evidencia_m, 10);
  if (!Number.isFinite(evidencia) || evidencia < RAIO_EVIDENCIA_MIN || evidencia > RAIO_EVIDENCIA_MAX)
    erros.raio_evidencia_m = `De ${RAIO_EVIDENCIA_MIN} a ${RAIO_EVIDENCIA_MAX} metros.`;
  return erros;
}

export default function MunicipioScreen() {
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const toast = useToast();
  const { ehAdmin } = usePapel();
  const dados = useDados(apiGestao.municipio);
  // Rascunho só existe depois da primeira edição; antes, o formulário é o
  // que veio do servidor. Salvar zera o rascunho e o form volta a refletir
  // a configuração gravada.
  const [rascunho, setRascunho] = useState<Form | null>(null);
  const [tentou, setTentou] = useState(false);
  const [salvando, setSalvando] = useState(false);

  const config = dados.dados;
  const so = !ehAdmin;

  if (dados.estado !== 'pronto' || !config) {
    return (
      <GestaoShell title="Município" minimo="gestor">
        <EstadoCarga
          estado={dados.estado === 'pronto' ? 'carregando' : dados.estado}
          erro={dados.erro}
          onRetry={dados.recarregar}
          oQue="a configuração"
        />
      </GestaoShell>
    );
  }

  const original = paraForm(config);
  const form = rascunho ?? original;
  const erros = validar(form);
  const valido = Object.keys(erros).length === 0;
  const mudou = (Object.keys(form) as (keyof Form)[]).some((k) => form[k] !== original[k]);

  function campo<K extends keyof Form>(k: K) {
    return (v: Form[K]) => setRascunho((f) => ({ ...(f ?? original), [k]: v }));
  }

  function erroDe(k: keyof Form) {
    return tentou ? erros[k] : undefined;
  }

  async function salvar() {
    if (!config) return;
    setTentou(true);
    if (!valido) {
      toast.warning('Corrija os campos destacados');
      return;
    }
    const corpo: ConfigMunicipioAlteracao = {};
    if (form.nome_exibicao !== original.nome_exibicao) corpo.nome_exibicao = form.nome_exibicao.trim();
    if (form.cor_primaria !== original.cor_primaria) corpo.cor_primaria = form.cor_primaria.trim();
    if (form.email_contato !== original.email_contato) corpo.email_contato = form.email_contato.trim();
    if (form.telefone !== original.telefone) corpo.telefone = form.telefone.trim();
    if (form.site !== original.site) corpo.site = form.site.trim();
    if (form.raio_duplicado_m !== original.raio_duplicado_m)
      corpo.raio_duplicado_m = Number.parseInt(form.raio_duplicado_m, 10);
    // `parametros` vai inteiro (o backend substitui o objeto), mesclado com o
    // que veio do servidor para não apagar chaves que o app não conhece.
    if (
      form.exigir_foto_conclusao !== original.exigir_foto_conclusao ||
      form.raio_evidencia_m !== original.raio_evidencia_m
    ) {
      corpo.parametros = {
        ...config.parametros,
        exigir_foto_conclusao: form.exigir_foto_conclusao,
        raio_evidencia_m: Number.parseInt(form.raio_evidencia_m, 10),
      };
    }

    const ok = await confirmar({
      titulo: 'Salvar configuração?',
      mensagem:
        'As mudanças valem na hora para cidadãos e equipe do município e ficam registradas na auditoria.',
      confirmar: 'Salvar',
    });
    if (!ok) return;

    setSalvando(true);
    try {
      const nova = await apiGestao.salvarMunicipio(corpo);
      dados.setDados(() =>
        nova && typeof nova === 'object' && 'municipio_id' in nova
          ? nova
          : { ...config, ...corpo, parametros: corpo.parametros ?? config.parametros },
      );
      setRascunho(null);
      setTentou(false);
      toast.success('Configuração salva');
    } catch (err) {
      toast.error(`Não foi possível salvar: ${mensagemDeErro(err)}`);
    } finally {
      setSalvando(false);
    }
  }

  const titulo = config.nome ? `${config.nome}${config.uf_sigla ? ` - ${config.uf_sigla}` : ''}` : 'Município';
  const corValida = COR_RE.test(form.cor_primaria);

  return (
    <GestaoShell title="Município" subtitle={titulo} minimo="gestor">
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + Spacing[16] }]}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl refreshing={dados.atualizando} onRefresh={dados.atualizar} />
        }>
        <View style={styles.selos}>
          <Badge
            label={config.contratado ? 'Contrato ativo' : 'Sem contrato ativo'}
            tone={config.contratado ? 'success' : 'neutral'}
            icon={config.contratado ? 'checkmark-circle' : 'information-circle'}
          />
          {so ? <Badge label="Somente consulta" tone="info" icon="eye" /> : null}
        </View>

        <Card>
          <SectionHeader title="Identidade" subtitle="Como a prefeitura aparece para o cidadão." />
          <TextField
            label="Nome de exibição"
            value={form.nome_exibicao}
            onChangeText={campo('nome_exibicao')}
            placeholder={config.nome ? `Prefeitura de ${config.nome}` : 'Prefeitura Municipal'}
            editable={!so}
            maxLength={80}
          />
          <View style={styles.linhaCor}>
            <TextField
              label="Cor principal"
              value={form.cor_primaria}
              onChangeText={(t) => campo('cor_primaria')(t.trim())}
              placeholder="#1F6FEB"
              autoCapitalize="none"
              autoCorrect={false}
              maxLength={7}
              editable={!so}
              invalid={!!erroDe('cor_primaria')}
              hint={erroDe('cor_primaria') ?? 'Hexadecimal, usada em relatórios e no portal.'}
              containerStyle={styles.flex}
            />
            <View
              accessible
              accessibilityLabel={corValida ? `Amostra da cor ${form.cor_primaria}` : 'Sem cor definida'}
              style={[
                styles.amostra,
                {
                  backgroundColor: corValida ? form.cor_primaria : colors.bgSubtle,
                  borderColor: colors.border,
                },
              ]}
            />
          </View>
        </Card>

        <Card>
          <SectionHeader
            title="Contato"
            subtitle="Aparece no detalhe do chamado e no portal de transparência."
          />
          <TextField
            label="E-mail da ouvidoria"
            value={form.email_contato}
            onChangeText={campo('email_contato')}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            editable={!so}
            invalid={!!erroDe('email_contato')}
            hint={erroDe('email_contato')}
          />
          <TextField
            label="Telefone"
            value={form.telefone}
            onChangeText={campo('telefone')}
            keyboardType="phone-pad"
            placeholder="156 ou (11) 3333-4444"
            editable={!so}
            maxLength={30}
          />
          <TextField
            label="Site"
            value={form.site}
            onChangeText={campo('site')}
            keyboardType="url"
            autoCapitalize="none"
            autoCorrect={false}
            placeholder="https://www.prefeitura.gov.br"
            editable={!so}
            invalid={!!erroDe('site')}
            hint={erroDe('site')}
          />
        </Card>

        <Card>
          <SectionHeader title="Regras de atendimento" />
          <TextField
            label="Raio para detectar duplicado (metros)"
            value={form.raio_duplicado_m}
            onChangeText={(t) => campo('raio_duplicado_m')(t.replace(/\D/g, ''))}
            keyboardType="number-pad"
            maxLength={3}
            editable={!so}
            invalid={!!erroDe('raio_duplicado_m')}
            hint={
              erroDe('raio_duplicado_m') ??
              'Ao reportar, o cidadão vê os chamados da mesma categoria dentro deste raio e pode apoiar em vez de abrir outro.'
            }
          />
          <SwitchRow
            label="Exigir foto ao concluir"
            descricao="A equipe só conclui um chamado anexando a foto do serviço feito. Dá mais confiança ao cidadão."
            valor={form.exigir_foto_conclusao}
            onChange={campo('exigir_foto_conclusao')}
            disabled={so}
          />
          <TextField
            label="Distância máxima da foto de evidência (metros)"
            value={form.raio_evidencia_m}
            onChangeText={(t) => campo('raio_evidencia_m')(t.replace(/\D/g, ''))}
            keyboardType="number-pad"
            maxLength={4}
            editable={!so}
            invalid={!!erroDe('raio_evidencia_m')}
            hint={
              erroDe('raio_evidencia_m') ??
              'A foto do serviço feito precisa ter sido tirada a até esta distância do ponto do chamado.'
            }
          />
        </Card>

        {so ? (
          <AppText variant="bodySm" tone="muted">
            Só o administrador do município altera estas informações.
          </AppText>
        ) : (
          <Button onPress={salvar} loading={salvando} disabled={!mudou} block>
            {mudou ? 'Salvar alterações' : 'Nada para salvar'}
          </Button>
        )}
      </ScrollView>
    </GestaoShell>
  );
}

const styles = StyleSheet.create({
  scroll: {
    paddingHorizontal: Layout.gutter,
    gap: Spacing[4],
  },
  selos: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing[2],
  },
  linhaCor: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing[3],
  },
  amostra: {
    width: 48,
    height: 48,
    marginTop: 20,
    borderWidth: 1,
    borderRadius: Radius.md,
  },
  flex: {
    flex: 1,
  },
});
