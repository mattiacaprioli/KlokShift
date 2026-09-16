import Svg, { Circle, Path } from "react-native-svg";

type Props = {
  size?: number;
  color?: string;
};

/** KlokShift mark — a filled dot with concentric arcs (ported from the prototype). */
export function Logo({ size = 48, color = "#EAB54C" }: Props) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Circle cx={12} cy={12} r={3.5} fill={color} />
      <Path
        d="M12 4a8 8 0 0 1 8 8"
        stroke={color}
        strokeWidth={1.6}
        fill="none"
        strokeLinecap="round"
      />
      <Path
        d="M5 12a7 7 0 0 1 1.4-4.2"
        stroke={color}
        strokeWidth={1.6}
        fill="none"
        strokeLinecap="round"
        opacity={0.55}
      />
    </Svg>
  );
}
