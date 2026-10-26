import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const localStorageMock = (() => {
  let store = {};
  return {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
    clear: () => { store = {}; },
  };
})();

Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock, writable: true });

const fetchMock = vi.fn();
globalThis.fetch = fetchMock;

const apiModule = await import('./api');

describe('api request helper com FormData', () => {
  beforeEach(() => {
    localStorage.clear();
    fetchMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('envia FormData sem Content-Type e com Authorization', async () => {
    localStorage.setItem('token', 'tok123');
    const fd = new FormData();
    fd.append('status', 'atendido');
    fd.append('foto_resolucao', new File(['x'], 'foto.jpg', { type: 'image/jpeg' }));

    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ status: 'atendido' }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    );

    const res = await apiModule.api.updateDefeitoComArquivo('abc-123', fd);

    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/v1/defeitos/abc-123/status/');
    expect(opts.method).toBe('PATCH');
    expect(opts.headers.Authorization).toBe('Bearer tok123');
    expect(opts.headers['Content-Type']).toBeUndefined();
    expect(opts.body).toBe(fd);
    expect(res).toEqual({ status: 'atendido' });
  });

  it('renova token no 401 e reenvia FormData com novo token', async () => {
    localStorage.setItem('token', 'token-expirado');
    localStorage.setItem('refresh', 'refresh-tok');
    const fd = new FormData();
    fd.append('status', 'atendido');

    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ detail: 'Token expirado' }), { status: 401, headers: { 'Content-Type': 'application/json' } }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ access: 'novo-token', refresh: 'refresh-novo' }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ status: 'atendido' }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
      );

    const res = await apiModule.api.updateDefeitoComArquivo('abc-123', fd);

    expect(localStorage.getItem('token')).toBe('novo-token');
    // Refresh rotacionado pelo backend precisa substituir o antigo.
    expect(localStorage.getItem('refresh')).toBe('refresh-novo');
    const retryCall = fetchMock.mock.calls[2];
    expect(retryCall[1].headers.Authorization).toBe('Bearer novo-token');
    expect(retryCall[1].headers['Content-Type']).toBeUndefined();
    expect(retryCall[1].body).toBe(fd);
    expect(res).toEqual({ status: 'atendido' });
  });

  it('envia FormData no POST de novo defeito (createDefeito)', async () => {
    localStorage.setItem('token', 'tok123');
    const fd = new FormData();
    fd.append('titulo', 'Buraco na rua');
    fd.append('file', new File(['img'], 'img.jpg', { type: 'image/jpeg' }));

    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ id: 'def-1', titulo: 'Buraco na rua' }), { status: 201, headers: { 'Content-Type': 'application/json' } }),
    );

    const res = await apiModule.api.createDefeito(fd);

    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/v1/defeitos/');
    expect(opts.method).toBe('POST');
    expect(opts.body).toBe(fd);
    expect(opts.headers['Content-Type']).toBeUndefined();
    expect(res.id).toBe('def-1');
  });

  it('lança erro com mensagem do servidor quando PATCH falha', async () => {
    localStorage.setItem('token', 'tok123');
    const fd = new FormData();
    fd.append('status', 'atendido');

    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'Foto de resolucao obrigatoria' }), { status: 400, headers: { 'Content-Type': 'application/json' } }),
    );

    await expect(apiModule.api.updateDefeitoComArquivo('abc-123', fd)).rejects.toThrow(
      'Foto de resolucao obrigatoria',
    );
  });
});

describe('api.batchStatusDefeitos', () => {
  beforeEach(() => {
    localStorage.clear();
    fetchMock.mockReset();
  });

  it('envia PATCH em batch_status com ids e status', async () => {
    localStorage.setItem('token', 'tok123');
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ updated: 2 }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    );

    const res = await apiModule.api.batchStatusDefeitos(['a-1', 'b-2'], 'em_andamento');

    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/v1/defeitos/batch_status/');
    expect(opts.method).toBe('PATCH');
    expect(opts.headers.Authorization).toBe('Bearer tok123');
    expect(opts.headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(opts.body)).toEqual({ ids: ['a-1', 'b-2'], status: 'em_andamento' });
    expect(res).toEqual({ updated: 2 });
  });
});

describe('api.gerarOS', () => {
  beforeEach(() => {
    localStorage.clear();
    fetchMock.mockReset();
    vi.unstubAllGlobals();
    delete globalThis.Blob;
    delete globalThis.URL;
  });

  it('busca o PDF como blob com Authorization', async () => {
    localStorage.setItem('token', 'tok123');
    const clickFn = vi.fn();
    const removeFn = vi.fn();
    globalThis.document = {
      createElement: vi.fn(() => ({ click: clickFn, remove: removeFn, set href(v) {}, set download(v) {} })),
      body: { appendChild: vi.fn() },
    };
    globalThis.Blob = class { constructor(parts, opts) { this.parts = parts; this.type = opts?.type; } };
    globalThis.URL = { createObjectURL: vi.fn(() => 'blob:os'), revokeObjectURL: vi.fn() };
    globalThis.window = { location: { href: '' } };
    fetchMock.mockResolvedValueOnce(
      new Response(new Blob(['%PDF'], { type: 'application/pdf' }), {
        status: 200,
        headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': 'attachment; filename="OS-abc123.pdf"' },
      }),
    );

    const blob = await apiModule.api.gerarOS('abc-123');

    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/v1/operacao/chamados/abc-123/ordem-servico/');
    expect(opts.method ?? 'GET').toBe('GET');
    expect(opts.headers.Authorization).toBe('Bearer tok123');
    expect(blob.type).toBe('application/pdf');
    expect(clickFn).toHaveBeenCalled();
    expect(globalThis.URL.revokeObjectURL).toHaveBeenCalledWith('blob:os');
  });
});