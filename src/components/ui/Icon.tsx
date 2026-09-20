import type { StyleProp, ViewStyle } from "react-native";
import Svg, { Circle, Path, Rect } from "react-native-svg";

export type IconName =
  | "user"
  | "users"
  | "chevR"
  | "chevL"
  | "check"
  | "close"
  | "plus"
  | "alert"
  | "calendar"
  | "clipboard"
  | "clock"
  | "home"
  | "search"
  | "message"
  | "sparkle"
  | "pencil"
  | "camera"
  | "shield"
  | "settings"
  | "bell"
  | "verified"
  | "star"
  | "starOutline"
  | "qr"
  | "send"
  | "download"
  | "upload"
  | "lock"
  | "eye"
  | "eyeOff";

type Props = {
  name: IconName;
  size?: number;
  color?: string;
  strokeWidth?: number;
  /** Per orientare l'icona (una chevron ruotata) o allinearla otticamente. */
  style?: StyleProp<ViewStyle>;
};

/** Line icons ported from the prototype (aura-shared.jsx). 24×24 viewBox. */
export function Icon({
  name,
  size = 22,
  color = "currentColor",
  strokeWidth = 1.6,
  style,
}: Props) {
  const p = {
    fill: "none",
    stroke: color,
    strokeWidth,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" style={style}>
      {name === "user" && (
        <>
          <Circle {...p} cx={12} cy={8} r={4} />
          <Path {...p} d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8" />
        </>
      )}
      {name === "users" && (
        <>
          <Circle {...p} cx={9} cy={8} r={3.5} />
          <Path {...p} d="M2 21c0-3.9 3.1-7 7-7s7 3.1 7 7" />
          <Circle {...p} cx={17} cy={7} r={2.5} />
          <Path {...p} d="M22 18c0-2.5-2-4.5-4.5-4.5" />
        </>
      )}
      {name === "chevR" && <Path {...p} d="M9 6l6 6-6 6" />}
      {name === "chevL" && <Path {...p} d="M15 6l-6 6 6 6" />}
      {name === "check" && <Path {...p} d="M5 12l5 5 9-10" strokeWidth={2.2} />}
      {name === "close" && <Path {...p} d="M6 6l12 12M18 6L6 18" />}
      {name === "plus" && <Path {...p} d="M12 5v14M5 12h14" />}
      {name === "alert" && (
        <Path {...p} d="M12 3l10 18H2L12 3zM12 10v5M12 18v.1" />
      )}
      {name === "calendar" && (
        <>
          <Rect {...p} x={3} y={5} width={18} height={16} rx={2.5} />
          <Path {...p} d="M3 9.5h18M8 3v4M16 3v4" />
        </>
      )}
      {name === "clipboard" && (
        <>
          <Rect {...p} x={5} y={4.5} width={14} height={16} rx={2.5} />
          <Rect {...p} x={9} y={3} width={6} height={3.5} rx={1.2} />
          <Path {...p} d="M9 11h6M9 15h4" />
        </>
      )}
      {name === "clock" && (
        <>
          <Circle {...p} cx={12} cy={12} r={9} />
          <Path {...p} d="M12 7.5V12l3 1.8" />
        </>
      )}
      {name === "home" && (
        <Path {...p} d="M4 10.5L12 4l8 6.5M6 9.5V20h12V9.5" />
      )}
      {name === "search" && (
        <>
          <Circle {...p} cx={11} cy={11} r={7} />
          <Path {...p} d="M20 20l-3.5-3.5" />
        </>
      )}
      {name === "message" && (
        <Path
          {...p}
          d="M4 6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H9l-4 4V6z"
        />
      )}
      {name === "sparkle" && (
        <Path
          {...p}
          d="M12 3l1.8 7.2L21 12l-7.2 1.8L12 21l-1.8-7.2L3 12l7.2-1.8L12 3z"
        />
      )}
      {name === "pencil" && (
        <>
          <Path {...p} d="M12 20h9" />
          <Path
            {...p}
            d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"
          />
        </>
      )}
      {name === "camera" && (
        <>
          <Path
            {...p}
            d="M4 8.5a2 2 0 0 1 2-2h1.5l1-2h5l1 2H18a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-8z"
          />
          <Circle {...p} cx={12} cy={12.5} r={3} />
        </>
      )}
      {name === "shield" && (
        <Path {...p} d="M12 3l7 3v5c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6l7-3zM9 12l2 2 4-4" />
      )}
      {name === "lock" && (
        <>
          <Rect {...p} x={4.5} y={10.5} width={15} height={10} rx={2.5} />
          <Path {...p} d="M8 10.5V7.5a4 4 0 0 1 8 0v3" />
        </>
      )}
      {name === "settings" && (
        <>
          <Circle {...p} cx={12} cy={12} r={3} />
          <Path
            {...p}
            d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"
          />
        </>
      )}
      {name === "bell" && (
        <>
          <Path {...p} d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
          <Path {...p} d="M13.73 21a2 2 0 0 1-3.46 0" />
        </>
      )}
      {name === "verified" && (
        <Path
          fill={color}
          fillRule="evenodd"
          d="M23 12l-2.44-2.79.34-3.69-3.61-.82-1.89-3.2L12 2.96 8.6 1.5 6.71 4.69 3.1 5.5l.34 3.7L1 12l2.44 2.79-.34 3.7 3.61.82L8.6 22.5l3.4-1.47 3.4 1.46 1.89-3.19 3.61-.82-.34-3.69L23 12zm-12.91 4.72l-3.8-3.81 1.48-1.48 2.32 2.33 5.85-5.87 1.48 1.48-7.33 7.35z"
        />
      )}
      {name === "star" && (
        <Path
          {...p}
          fill={color}
          d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"
        />
      )}
      {name === "starOutline" && (
        <Path
          {...p}
          d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"
        />
      )}
      {name === "qr" && (
        <>
          <Rect {...p} x={3.5} y={3.5} width={6.5} height={6.5} rx={1.6} />
          <Rect {...p} x={14} y={3.5} width={6.5} height={6.5} rx={1.6} />
          <Rect {...p} x={3.5} y={14} width={6.5} height={6.5} rx={1.6} />
          <Rect x={14} y={14} width={2.6} height={2.6} rx={0.6} fill={color} />
          <Rect x={17.9} y={14} width={2.6} height={2.6} rx={0.6} fill={color} />
          <Rect x={14} y={17.9} width={2.6} height={2.6} rx={0.6} fill={color} />
          <Rect x={17.9} y={17.9} width={2.6} height={2.6} rx={0.6} fill={color} />
        </>
      )}
      {name === "send" && (
        <Path {...p} d="M22 2 11 13M22 2l-7 20-4-9-9-4 20-7z" />
      )}
      {name === "download" && (
        <Path
          {...p}
          d="M12 3v11M8 10l4 4 4-4M5 19a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2"
        />
      )}
      {name === "upload" && (
        <Path
          {...p}
          d="M12 21V10M8 14l4-4 4 4M5 5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2"
        />
      )}
      {name === "eye" && (
        <>
          <Path {...p} d="M2 12s3.8-6.5 10-6.5S22 12 22 12s-3.8 6.5-10 6.5S2 12 2 12z" />
          <Circle {...p} cx={12} cy={12} r={3} />
        </>
      )}
      {name === "eyeOff" && (
        <>
          <Path
            {...p}
            d="M10.7 6.1A9.9 9.9 0 0 1 12 5.5c6.2 0 10 6.5 10 6.5a18 18 0 0 1-2.9 3.6M6.5 7.6A17.6 17.6 0 0 0 2 12s3.8 6.5 10 6.5a9.6 9.6 0 0 0 3.9-.8"
          />
          <Path {...p} d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
          <Path {...p} d="M3 3l18 18" />
        </>
      )}
    </Svg>
  );
}
