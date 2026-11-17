import Constants, { ExecutionEnvironment } from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import { darkColors } from "@/constants/colors";

function getProjectId(): string | undefined {
  return (
    Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId
  );
}

/**
 * Richiede il permesso e restituisce l'Expo push token del device, oppure `null`
 * (Expo Go, emulatore, permesso negato, projectId mancante). Best-effort: non
 * lancia mai, la registrazione push non deve poter bloccare l'avvio dell'app.
 */
export async function registerForPushNotificationsAsync(): Promise<string | null> {
  // Expo Go (dal SDK 53) non supporta le push remote: le API lanciano.
  if (Constants.executionEnvironment === ExecutionEnvironment.StoreClient) {
    return null;
  }
  // Le push remote non arrivano su emulatore/simulatore.
  if (!Device.isDevice) return null;

  // Android richiede un canale prima di poter mostrare notifiche.
  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("default", {
      name: "default",
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: darkColors.gold, // il LED non segue il tema: è il colore del marchio
    });
  }

  const existing = await Notifications.getPermissionsAsync();
  let granted = existing.granted;
  if (!granted && existing.canAskAgain) {
    const req = await Notifications.requestPermissionsAsync();
    granted = req.granted;
  }
  if (!granted) return null;

  const projectId = getProjectId();
  if (!projectId) return null;

  try {
    const { data } = await Notifications.getExpoPushTokenAsync({ projectId });
    return data;
  } catch {
    return null;
  }
}
