# Frontend web — design system e acessibilidade

Conteúdo movido do Apêndice Técnico do README. Refere-se ao frontend Vite
(`frontend/`), hoje legado: as telas da v3 vivem no app (`mobile/`).

## Design System

Tema dark-first com CSS custom properties (`tokens.css`):

- **Fonte:** Inter (sans-serif) + JetBrains Mono (mono)
- **Tipografia:** escala 12px a 36px
- **Espaçamento:** escala 4px a 64px (8 passos)
- **Dark:** `--bg-primary: #0d0d0f`, `--text-primary: #fafafa`, `--accent-green: #22c55e`
- **Light:** `--bg-primary: #f5f5f0`, `--text-primary: #1a1a1c`, contraste ~16.4:1 (AAA)

## Acessibilidade (WCAG AA)

| Critério | Implementação |
|---|---|
| Focus visible | `:focus-visible` outline verde 2px em todos os elementos interativos |
| Icon labels | `aria-label` em todo botão somente-ícone |
| Modal semantics | `role="dialog"` + `aria-modal="true"` + `aria-label` |
| Live regions | `aria-live="polite"` em notificações toast |
| Combobox | WAI-ARIA completo `role="combobox"` com `aria-expanded` |
| Skip link | link skip-to-content no topo (`#main-content`) |
| Escape key | fecha todos os modais e limpa buffer de nav por teclado |
| Error messages | `role="alert"` em validação inline |
| Contrast (dark) | AA+ em todos os combos (7.58:1 AAA primary/secondary) |
| Contrast (light) | 16.4:1 AAA primary |
| Keyboard nav | atalhos `g+key` com overlay de ajuda visual (`?`) |
| Reduced motion | `prefers-reduced-motion` respeitado via framer-motion |

## Navegação por Teclado

Pressione `g`, solte, depois a tecla de destino (janela de buffer de 1s):

| Atalho | Página | Atalho | Página |
|---|---|---|---|
| `g+m` | Mapa | `g+d` | Dashboard |
| `g+l` | Lista | `g+u` | Usuários |
| `g+a` | Admin | `g+s` | Configurações |
| `g+i` | Login | `g+c` | Conta |
| `g+r` | Registro | `g+t` | Alternar tema |
| `?` | Mostrar ajuda | `Esc` | Limpar buffer |

Os atalhos são desabilitados quando o foco está em elemento input/textarea/select.
