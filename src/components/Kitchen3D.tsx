'use client';

import React, { useEffect, useMemo, useState } from 'react';
import * as THREE from 'three';
import { Canvas, useFrame } from '@react-three/fiber';
import { Edges, OrbitControls } from '@react-three/drei';
import { buildScene, type Prism } from '@/lib/plan/scene3d';
import type { Project } from '@/lib/plan/schemas';

/** Plan millimetres to scene metres. Plan x is scene x, plan y is scene z, height is scene y. */
const M = 1 / 1000;
const OUTLINED = new Set<Prism['kind']>(['cabinet', 'appliance', 'furniture', 'slab']);

function webglAvailable(): boolean {
  try {
    const canvas = document.createElement('canvas');
    return Boolean(canvas.getContext('webgl2') || canvas.getContext('webgl'));
  } catch {
    return false;
  }
}

/** One prism as a mesh. A wall piece hides itself while the camera is outside the room, so it never blocks the view. */
function PrismMesh({ prism }: { prism: Prism }) {
  const geometry = useMemo(() => {
    // The shape lives in the XY plane; rotating -90° about X lays it flat and sends shape y to scene -z, so negate it.
    const shape = new THREE.Shape(prism.footprint.map(([x, y]) => new THREE.Vector2(x * M, -y * M)));
    const g = new THREE.ExtrudeGeometry(shape, { depth: (prism.top - prism.bottom) * M, bevelEnabled: false });
    g.rotateX(-Math.PI / 2);
    g.translate(0, prism.bottom * M, 0);
    return g;
  }, [prism]);
  useEffect(() => () => geometry.dispose(), [geometry]);

  const centre = useMemo(() => {
    const n = prism.footprint.length;
    return {
      x: (prism.footprint.reduce((s, p) => s + p[0], 0) / n) * M,
      z: (prism.footprint.reduce((s, p) => s + p[1], 0) / n) * M,
    };
  }, [prism]);

  const meshRef = React.useRef<THREE.Mesh>(null);
  useFrame(({ camera }) => {
    const out = prism.outward;
    if (!out || !meshRef.current) return;
    const dx = camera.position.x - centre.x;
    const dz = camera.position.z - centre.z;
    meshRef.current.visible = out[0] * dx + out[1] * dz <= 0;
  });

  const opacity = prism.opacity ?? 1;
  return (
    <mesh ref={meshRef} geometry={geometry}>
      <meshStandardMaterial
        color={prism.color}
        transparent={opacity < 1}
        opacity={opacity}
        depthWrite={opacity >= 1}
        side={THREE.DoubleSide}
        roughness={0.85}
      />
      {OUTLINED.has(prism.kind) && <Edges threshold={25} color="#6b7280" />}
    </mesh>
  );
}

/**
 * The kitchen as an orbitable 3D model: walls with their door and window
 * openings, cabinets, appliances and furniture as blocks at their standard
 * heights, in the project's finishes. Read-only; the scene comes from
 * `buildScene`.
 */
export default function Kitchen3D({ project }: { project: Project }) {
  const scene = useMemo(() => buildScene(project), [project]);
  const [webgl, setWebgl] = useState<boolean | null>(null);
  const [viewKey, setViewKey] = useState(0);
  useEffect(() => setWebgl(webglAvailable()), []);

  const { bounds } = scene;
  const cx = ((bounds.minX + bounds.maxX) / 2) * M;
  const cz = ((bounds.minY + bounds.maxY) / 2) * M;
  const span = Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY, 1000) * M;
  const boxes = scene.prisms.filter((p) => p.kind === 'cabinet' || p.kind === 'appliance' || p.kind === 'furniture').length;
  const walls = scene.prisms.filter((p) => p.kind === 'wall').length;

  if (webgl === false) {
    return (
      <p role="status" className="rounded border bg-gray-50 p-3 text-sm text-gray-700">
        The 3D view needs WebGL, which this browser or device doesn’t have. The plan and the wall elevations show the same design.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div
        role="img"
        aria-label="3D view of the kitchen"
        data-testid="kitchen-3d"
        data-boxes={boxes}
        data-walls={walls}
        className="aspect-[4/3] w-full overflow-hidden rounded border bg-gradient-to-b from-sky-50 to-gray-100"
      >
        {webgl && (
          <Canvas
            key={viewKey}
            frameloop="demand"
            dpr={[1, 2]}
            camera={{ position: [cx, span * 0.85 + 1.2, cz + span * 1.15], fov: 40, near: 0.1, far: 200 }}
          >
            <ambientLight intensity={1.1} />
            <directionalLight position={[cx + span, span * 2 + 3, cz + span]} intensity={1.4} />
            <directionalLight position={[cx - span, span + 2, cz - span]} intensity={0.5} />
            {scene.prisms.map((p, i) => (
              <PrismMesh key={`${i}-${p.kind}-${p.sourceId ?? ''}`} prism={p} />
            ))}
            <OrbitControls makeDefault target={[cx, 0.9, cz]} maxPolarAngle={Math.PI / 2 - 0.03} minDistance={1} maxDistance={span * 4 + 4} />
          </Canvas>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <button type="button" className="rounded border px-3 py-1" onClick={() => setViewKey((k) => k + 1)}>
          Reset view
        </button>
        <span className="text-gray-500">Drag to turn · scroll or pinch to zoom · right-drag or two fingers to move</span>
      </div>
    </div>
  );
}
