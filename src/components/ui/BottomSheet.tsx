import { useEffect, useState, type ReactNode } from "react";
import { Modal, useWindowDimensions } from "react-native";
import {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Pressable, View } from "@/tw";
import { Animated } from "@/tw/animated";

type Props = {
  visible: boolean;
  onClose: () => void;
  /** Falso mentre un'azione è in corso: tocco fuori e «indietro» non chiudono. */
  dismissable?: boolean;
  children: ReactNode;
};

/**
 * Pannello che sale dal basso. Lo sfondo scuro compare in dissolvenza **sul
 * posto** e sale solo il pannello; alla chiusura il contrario.
 *
 * Non `animationType="slide"` del `Modal`: quella fa scorrere l'intera finestra,
 * sfondo compreso, e lo scuro saliva dal fondo con un bordo netto dietro al
 * pannello. Il `Modal` resta montato finché l'uscita non è finita.
 */
export function BottomSheet({
  visible,
  onClose,
  dismissable = true,
  children,
}: Props) {
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const [mounted, setMounted] = useState(visible);
  if (visible && !mounted) setMounted(true);

  const progress = useSharedValue(0);
  const sheetHeight = useSharedValue(0);

  useEffect(() => {
    if (!mounted) return;
    if (visible) {
      progress.set(
        withTiming(1, { duration: 280, easing: Easing.out(Easing.cubic) })
      );
    } else {
      progress.set(
        withTiming(
          0,
          { duration: 200, easing: Easing.in(Easing.cubic) },
          (finished) => {
            if (finished) scheduleOnRN(setMounted, false);
          }
        )
      );
    }
  }, [visible, mounted, progress]);

  const backdropStyle = useAnimatedStyle(() => ({
    opacity: progress.get(),
  }));
  // Finché il pannello non è misurato parte da fuori schermo.
  const sheetStyle = useAnimatedStyle(() => ({
    transform: [
      {
        translateY: (1 - progress.get()) * (sheetHeight.get() || windowHeight),
      },
    ],
  }));

  const close = dismissable ? onClose : undefined;

  return (
    <Modal
      visible={mounted}
      transparent
      animationType="none"
      statusBarTranslucent
      onRequestClose={() => close?.()}
    >
      <View className="flex-1 justify-end">
        <Animated.View
          pointerEvents="none"
          className="absolute inset-0"
          style={[{ backgroundColor: "rgba(0,0,0,0.6)" }, backdropStyle]}
        />
        <Pressable className="absolute inset-0" onPress={close} />
        <Animated.View
          style={sheetStyle}
          onLayout={(e) => sheetHeight.set(e.nativeEvent.layout.height)}
        >
          <View
            className="rounded-t-3xl border-t border-border-2 bg-bg-card px-6 pt-3"
            style={{ paddingBottom: insets.bottom + 24 }}
          >
            <View className="mb-5 h-1 w-10 self-center rounded-full bg-border-2" />
            {children}
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}
