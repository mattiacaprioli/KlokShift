import { createClient } from '@supabase/supabase-js';
import * as SecureStore from 'expo-secure-store';
import { AppState, Platform } from 'react-native';
import type { Database } from '@/types/database';
import { createSecureStoreAdapter } from '@/lib/secureStoreAdapter';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!;

const SecureStoreAdapter = createSecureStoreAdapter(SecureStore);

export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: Platform.OS === 'web' ? undefined : SecureStoreAdapter,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

// `autoRefreshToken` avvia un timer che, su React Native, continua a girare con
// l'app in background: ogni refresh riscrive una riga in `auth.refresh_tokens`
// (WAL, cioè scrittura su disco) e rifà i chunk in SecureStore, per un'app che
// nessuno sta guardando. Il pattern raccomandato è legarlo al ciclo di vita:
// attivo quando l'app è in primo piano, fermo altrimenti. Alla riapertura
// Supabase rinfresca subito se il token è scaduto, quindi non si perde nulla.
if (Platform.OS !== 'web') {
  AppState.addEventListener('change', (state) => {
    if (state === 'active') {
      supabase.auth.startAutoRefresh();
    } else {
      supabase.auth.stopAutoRefresh();
    }
  });
}
