import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'ai.pickmo.chat',
  appName: 'Pickmo.ai',
  webDir: 'dist',
  server: {
    androidScheme: 'https'
  },
  android: {
    icon: 'public/pickmo-ai.png'
  }
};

export default config;