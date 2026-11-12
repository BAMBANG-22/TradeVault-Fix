import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.tradevault.journal.next',
  appName: 'TradeVault Next',
  webDir: 'dist',
  backgroundColor: '#050607',
  server: {
    androidScheme: 'https'
  },
  plugins: {
    SystemBars: {
      insetsHandling: 'disable',
      style: 'DARK',
      hidden: false
    }
  }
};

export default config;
