import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'ai.pickmo.chat',
  appName: 'Pickmo.ai',
  webDir: 'dist',
  server: {
    androidScheme: 'https'
  }
};

export default config;