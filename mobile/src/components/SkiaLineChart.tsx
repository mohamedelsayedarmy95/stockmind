import React from 'react';
import { Canvas, Path, Skia, LinearGradient as SkiaGradient, vec } from '@shopify/react-native-skia';
import { BRAND_GRADIENT } from '@/theme/colors';

interface SkiaLineChartProps {
  data: number[];
  width: number;
  height: number;
}

/**
 * Smooth (Catmull-Rom → Bezier) line chart drawn with Skia, plus a
 * gradient area fill beneath the curve.
 */
export function SkiaLineChart({ data, width, height }: SkiaLineChartProps) {
  const pad = 12;
  const max = Math.max(...data, 1);
  const min = Math.min(...data, 0);
  const range = max - min || 1;
  const stepX = (width - pad * 2) / Math.max(data.length - 1, 1);

  const points = data.map((v, i) => ({
    x: pad + i * stepX,
    y: pad + (height - pad * 2) * (1 - (v - min) / range),
  }));

  const line = Skia.Path.Make();
  const area = Skia.Path.Make();

  if (points.length > 0) {
    line.moveTo(points[0].x, points[0].y);
    area.moveTo(points[0].x, height - pad);
    area.lineTo(points[0].x, points[0].y);

    for (let i = 0; i < points.length - 1; i++) {
      const p0 = points[i];
      const p1 = points[i + 1];
      const cx = (p0.x + p1.x) / 2;
      line.cubicTo(cx, p0.y, cx, p1.y, p1.x, p1.y);
      area.cubicTo(cx, p0.y, cx, p1.y, p1.x, p1.y);
    }
    area.lineTo(points[points.length - 1].x, height - pad);
    area.close();
  }

  return (
    <Canvas style={{ width, height }}>
      <Path path={area} style="fill" opacity={0.18}>
        <SkiaGradient
          start={vec(0, 0)}
          end={vec(0, height)}
          colors={[BRAND_GRADIENT[0], 'transparent']}
        />
      </Path>
      <Path path={line} style="stroke" strokeWidth={3} strokeCap="round" strokeJoin="round">
        <SkiaGradient
          start={vec(0, 0)}
          end={vec(width, 0)}
          colors={[BRAND_GRADIENT[0], BRAND_GRADIENT[1]]}
        />
      </Path>
    </Canvas>
  );
}
