import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type PropsWithChildren,
} from "react";
import Animated, { FadeInDown, FadeOutUp } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { View, Text } from "@/tw";
import { Icon, type IconName } from "@/components/ui/Icon";
import { useColors } from "@/lib/theme";
import type { ThemeColors } from "@/constants/colors";

type ToastVariant = "success" | "error" | "info";

type ToastApi = { show: (message: string, variant?: ToastVariant) => void };

const ToastContext = createContext<ToastApi | null>(null);

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast deve essere usato dentro <ToastProvider />");
  return ctx;
}

const toastVariants = (
  colors: ThemeColors,
): Record<ToastVariant, { icon: IconName; iconColor: string; chip: string }> => ({
  success: { icon: "check", iconColor: colors.goldInk, chip: colors.goldFill },
  error: { icon: "close", iconColor: colors.t1, chip: colors.error },
  info: { icon: "alert", iconColor: colors.goldInk, chip: colors.goldFill },
});

type ToastItem = { id: number; message: string; variant: ToastVariant };

export function ToastProvider({ children }: PropsWithChildren) {
  const [toast, setToast] = useState<ToastItem | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const insets = useSafeAreaInsets();
  const colors = useColors();

  const show = useCallback((message: string, variant: ToastVariant = "success") => {
    setToast({ id: Date.now(), message, variant });
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(null), 2600);
  }, []);

  const v = toast ? toastVariants(colors)[toast.variant] : null;

  return (
    <ToastContext.Provider value={{ show }}>
      {children}
      {toast && v ? (
        <Animated.View
          key={toast.id}
          entering={FadeInDown.duration(220)}
          exiting={FadeOutUp.duration(180)}
          pointerEvents="none"
          style={{
            position: "absolute",
            left: 20,
            right: 20,
            top: insets.top + 12,
            alignItems: "center",
          }}
        >
          <View className="max-w-full flex-row items-center gap-2.5 rounded-2xl border border-border-2 bg-bg-2 px-4 py-3">
            <View
              style={{ backgroundColor: v.chip }}
              className="h-6 w-6 items-center justify-center rounded-full"
            >
              <Icon name={v.icon} size={14} color={v.iconColor} strokeWidth={2.6} />
            </View>
            <Text className="font-sans-medium text-sm text-t1">{toast.message}</Text>
          </View>
        </Animated.View>
      ) : null}
    </ToastContext.Provider>
  );
}
