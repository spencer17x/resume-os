import nextVitals from 'eslint-config-next/core-web-vitals'

const config = [
  {
    ignores: ['.next/**', 'out/**', 'next-env.d.ts']
  },
  ...nextVitals
]

export default config
