import { Display } from "@/components/ui/Display";
import { Icon } from "@/components/ui/Icon";
import { Mono } from "@/components/ui/Mono";
import { REVIEW_SITE_URL, reviewUrlFor } from "@/features/reviews/config";
import { useWaiterPublicCard } from "@/features/reviews/hooks";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/providers/Toast";
import { Pressable, ScrollView, Text, View } from "@/tw";
import * as FileSystem from "expo-file-system/legacy";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { useRef } from "react";
import { Share } from "react-native";
import QRCode from "react-native-qrcode-svg";
import { useSafeAreaInsets } from "react-native-safe-area-context";

type QRRef = { toDataURL: (cb: (data: string) => void) => void };

export default function WaiterQRScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const { session, profile } = useAuth();
  const userId = session!.user.id;
  const name = profile?.full_name ?? "Cameriere";

  const card = useWaiterPublicCard(userId).data;
  const roleCity = [card?.primary_role, card?.city].filter(Boolean).join(" · ");
  const url = reviewUrlFor(userId);
  const host = REVIEW_SITE_URL.replace(/^https?:\/\//, "");

  const qrRef = useRef<QRRef | null>(null);

  async function onShare() {
    try {
      await Share.share({
        message: `Lascia una recensione a ${name} su KlokShift: ${url}`,
      });
    } catch {
      // condivisione annullata
    }
  }

  async function onSave() {
    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const ref = qrRef.current;
        if (!ref?.toDataURL) return reject(new Error("QR non pronto"));
        ref.toDataURL((data) => resolve(data));
      });
      // expo-media-library è un modulo nativo: import dinamico + guardia così la
      // schermata non si rompe se non è ancora nella build (serve un rebuild).
      // Usa l'API legacy: saveToLibraryAsync dal path principale è deprecata.
      const MediaLibrary = await import("expo-media-library/legacy");
      // writeOnly + solo 'photo': qui si salva e basta, mai letta la galleria.
      // Senza questo il modulo chiede accesso in lettura a foto, video e audio —
      // che con la Photo and Video Permissions policy di Google Play va
      // giustificato e per un'app di turni non è giustificabile.
      // ⚠️ L'API legacy vuole argomenti POSIZIONALI, non l'oggetto dei doc.
      const perm = await MediaLibrary.requestPermissionsAsync(true, ["photo"]);
      if (!perm.granted) {
        toast.show("Concedi l'accesso alle foto per salvare", "error");
        return;
      }
      const uri = `${FileSystem.cacheDirectory}klokshift-qr.png`;
      await FileSystem.writeAsStringAsync(uri, base64, {
        encoding: FileSystem.EncodingType.Base64,
      });
      await MediaLibrary.saveToLibraryAsync(uri);
      toast.show("QR salvato nella galleria");
    } catch {
      toast.show("Salvataggio non riuscito", "error");
    }
  }

  return (
    <View className="flex-1 bg-bg-0">
      {/* Header */}
      <View
        className="flex-row items-center px-5 pb-3"
        style={{ paddingTop: insets.top + 8 }}
      >
        <Pressable
          onPress={() => router.back()}
          hitSlop={8}
          className="h-11 w-11 items-center justify-center rounded-full border border-border-2 bg-bg-2"
        >
          <Icon name="close" size={20} color="#F8F4ED" />
        </Pressable>
        <View className="flex-1 items-center">
          <Mono>Il tuo QR</Mono>
        </View>
        <Pressable
          onPress={onShare}
          hitSlop={8}
          className="h-11 w-11 items-center justify-center rounded-full border border-border-2 bg-bg-2"
        >
          <Icon name="send" size={17} color="#F8F4ED" />
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={{
          flexGrow: 1,
          paddingHorizontal: 16,
          paddingTop: 16,
          paddingBottom: insets.bottom + 20,
          alignItems: "center",
          justifyContent: "space-between",
        }}
        showsVerticalScrollIndicator={false}
      >
        {/* Titolo */}
        <View className="items-center gap-1.5">
          <Mono gold>Recensione certificata</Mono>
          <Display className="text-center text-3xl leading-9">
            Mostra questo{"\n"}al tuo cliente
          </Display>
        </View>

        {/* QR card + descrizione */}
        <View className="w-full items-center gap-6">
          <View
            className="items-center"
            style={{
              backgroundColor: "#F6F1E3",
              borderRadius: 28,
              padding: 24,
              width: "100%",
              maxWidth: 320,
              shadowColor: "#EAB54C",
              shadowOpacity: 0.18,
              shadowRadius: 40,
              shadowOffset: { width: 0, height: 12 },
            }}
          >
            <View style={{ position: "relative" }}>
              <QRCode
                value={url}
                size={228}
                backgroundColor="#F6F1E3"
                color="#1A1611"
                ecl="H"
                getRef={(c) => {
                  qrRef.current = (c as unknown as QRRef) ?? null;
                }}
              />
            </View>

            <View
              style={{
                alignSelf: "stretch",
                marginTop: 18,
                paddingTop: 16,
                borderTopWidth: 1,
                borderStyle: "dashed",
                borderColor: "rgba(26,18,6,0.18)",
                alignItems: "center",
                gap: 3,
              }}
            >
              <Display style={{ color: "#1A1611" }} className="text-xl">
                {name}
              </Display>
              {roleCity ? (
                <Mono style={{ color: "#5B4A2E" }}>{roleCity}</Mono>
              ) : null}
            </View>
          </View>

          <Text
            className="text-center text-sm leading-5 text-t3"
            style={{ maxWidth: 300 }}
          >
            Mostra questo al cliente a fine servizio per ricevere una{" "}
            <Text className="font-sans-semibold text-gold">
              recensione certificata
            </Text>{" "}
            sul tuo profilo.
          </Text>
        </View>

        {/* Azioni + footer */}
        <View className="w-full items-center gap-4">
          <View className="w-full flex-row gap-2.5">
            <Pressable
              onPress={onSave}
              style={{ flex: 1 }}
              className="flex-row items-center justify-center gap-2 rounded-full border border-border-2 py-3.5"
            >
              <Icon name="download" size={16} color="#F8F4ED" />
              <Text className="text-sm font-sans-semibold text-t1">Salva</Text>
            </Pressable>
            <Pressable
              onPress={onShare}
              style={{ flex: 1.3 }}
              className="overflow-hidden rounded-full"
            >
              <LinearGradient
                colors={["#F5C765", "#D9A23F"]}
                start={{ x: 0, y: 0 }}
                end={{ x: 0, y: 1 }}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 8,
                  paddingVertical: 14,
                }}
              >
                <Icon name="send" size={16} color="#1A1206" />
                <Text
                  className="text-sm font-sans-semibold"
                  style={{ color: "#1A1206" }}
                >
                  Condividi link
                </Text>
              </LinearGradient>
            </Pressable>
          </View>

          <Mono style={{ color: "#5F5849" }}>Codice unico · {host}</Mono>
        </View>
      </ScrollView>
    </View>
  );
}
