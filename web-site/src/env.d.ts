/*
 * `process.env.EXPO_PUBLIC_*` non esiste nel browser: Vite lo sostituisce a
 * build-time (`define` in vite.config.mts). Qui si dichiara solo ciò che il
 * codice legge davvero, senza tirare dentro i tipi di Node.
 */
declare const process: {
  env: {
    EXPO_PUBLIC_APP_URL?: string;
  };
};
