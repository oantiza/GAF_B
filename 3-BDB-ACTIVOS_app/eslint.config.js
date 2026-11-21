import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores([
    'dist',
    'output/**',
    'runs/**',
    'tmp/**',
    // Worktrees de otras sesiones (.claude/worktrees/*): copias con sus propios tsconfig.
    '.claude/**',
    'design_handoff_oaa_plataforma',
    'design_handoff_oaa_plataforma/**',
    'design_handoff_oaa_v2',
    'design_handoff_oaa_v2/**',
  ]),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
    },
    rules: {
      'react-hooks/set-state-in-effect': 'off',
    },
  },
])
